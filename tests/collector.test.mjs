import { test } from "node:test";
import assert from "node:assert/strict";
import { runBoundedFacebookCollection } from "../server/collector.ts";
import { createPgCollectorStore } from "../server/pg-collector-store.ts";
import {
  normalizeFacebookPost,
  TransportError,
} from "../server/socialapis.ts";
import { startLocalSupabase } from "../scripts/local-supabase.mjs";
import { bootstrapKashida } from "../scripts/bootstrap-auth.mjs";

function makeRawPost(id, text, publishTime = "2026-11-19T16:30:00Z") {
  return {
    details: {
      post_id: id,
      post_link: `https://www.facebook.com/Youm7/posts/${id}`,
      comments_count: "4",
      share_count: "1",
    },
    values: {
      text,
      is_media: "Photo",
      publish_time: publishTime,
      shared_post: false,
    },
    reactions: { total_reaction_count: "19" },
    attachments: [
      { image: { uri: `https://scontent.fbcdn.net/v/${id}.jpg` } },
    ],
    user_details: {
      avatar: "https://scontent.fbcdn.net/v/avatar-must-ignore.jpg",
    },
  };
}

test("normalizeFacebookPost strips avatars, keeps missing time null, and validates URLs", () => {
  const raw = makeRawPost("12345", "خبر تجريبي", null);
  const norm = normalizeFacebookPost(raw, "src-1", "2026-11-19T17:00:00Z");
  assert.equal(norm.nativeKey, "12345");
  assert.equal(norm.publishedAt, null);
  assert.equal(norm.media, "photo");
  assert.equal(norm.mediaItems.length, 1);
  assert.ok(!norm.mediaItems[0].url.includes("avatar"));
  assert.equal(norm.engagement.reactions, 19);
  assert.equal(norm.engagement.views, null);
});

test("bounded collector runs 5 unique requests for 6 subscriptions, logs /usage separately, and replays same runKey with 0 extra HTTP calls", async () => {
  const srv = await startLocalSupabase({ port: 0 });
  try {
    await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      adminPassword: "AdminStrong!2026",
      user1Password: "EditorOne!2026",
      user2Password: "EditorTwo!2026",
    });

    const store = createPgCollectorStore({
      query: (sql, params) => srv.withDbLock(() => srv.db.query(sql, params)),
    });

    let usageCalls = 0;
    const calls = [];
    const mockClient = {
      async getUsage() {
        usageCalls += 1;
        return usageCalls === 1
          ? { creditsUsed: 10, creditsRemaining: 190, creditsLimit: 200 }
          : { creditsUsed: 15, creditsRemaining: 185, creditsLimit: 200 };
      },
      async fetchFacebookPosts({ kind, url, afterDate, limit }) {
        calls.push({ kind, url, afterDate, limit });
        assert.equal(limit, 3);
        assert.match(afterDate, /^\d{4}-\d{2}-\d{2}$/);
        if (calls.length === 1) {
          // Simulate empty response on source 1
          return {
            posts: [],
            hasNext: false,
            creditsCharged: 1,
            creditsRemaining: 189,
            creditsUncertain: false,
            httpStatus: 200,
          };
        }
        return {
          posts: [
            makeRawPost(`p-${calls.length}-a`, `خبر ${calls.length} أ`),
            makeRawPost(`p-${calls.length}-b`, `خبر قديم ${calls.length}`, "2026-11-10T00:00:00Z"),
            makeRawPost(`p-${calls.length}-c`, `خبر بلا تاريخ ${calls.length}`, null),
            makeRawPost(`p-${calls.length}-overflow`, "يجب تجاهله لأن الحد 3"),
          ],
          hasNext: true,
          creditsCharged: 1,
          creditsRemaining: 190 - calls.length,
          creditsUncertain: false,
          httpStatus: 200,
        };
      },
    };

    // Run once with fixed runKey (also test concurrent invocation with same runKey!)
    const [resA, resB] = await Promise.all([
      runBoundedFacebookCollection(store, mockClient, {
        runKey: "bounded-cycle-1",
        maxRequests: 5,
        maxCredits: 5,
        nowFn: () => new Date("2026-11-19T17:00:00Z"),
      }),
      runBoundedFacebookCollection(store, mockClient, {
        runKey: "bounded-cycle-1",
        maxRequests: 5,
        maxCredits: 5,
        nowFn: () => new Date("2026-11-19T17:00:00Z"),
      }),
    ]);

    // Exactly 5 unique FB sources (3 pages + 2 groups), NEVER duplicated across concurrent calls!
    assert.equal(calls.length, 5);
    assert.equal(calls.filter((c) => c.kind === "page").length, 3);
    assert.equal(calls.filter((c) => c.kind === "group").length, 2);
    assert.equal(usageCalls, 2);
    assert.equal([resA.replayed, resB.replayed].filter(Boolean).length, 1);

    const completed = resA.replayed ? resB.run : resA.run;
    assert.equal(completed.status, "completed");
    assert.equal(completed.requestsMade, 5);
    assert.equal(completed.usageChecks, 2);
    assert.equal(completed.creditsCharged, 5);
    assert.equal(completed.accountUsageDelta, 5);
    assert.equal(completed.insertedCount, 12); // 4 non-empty sources x 3 capped posts = 12
    assert.equal(completed.items.filter((i) => i.emptyResponse).length, 1);
    assert.equal(completed.items.reduce((s, i) => s + i.oldPostsCount, 0), 4);
    assert.equal(completed.items.reduce((s, i) => s + i.missingTimeCount, 0), 4);

    // Second click with same runKey returns saved result with ZERO additional HTTP calls
    const replay = await runBoundedFacebookCollection(store, mockClient, {
      runKey: "bounded-cycle-1",
    });
    assert.equal(replay.replayed, true);
    assert.equal(calls.length, 5);
  } finally {
    await srv.close();
  }
});

test("collector stops immediately on 401/429 and marks network drop as uncertain without auto-retry", async () => {
  const srv = await startLocalSupabase({ port: 0 });
  try {
    await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      adminPassword: "AdminStrong!2026",
      user1Password: "EditorOne!2026",
      user2Password: "EditorTwo!2026",
    });
    const store = createPgCollectorStore({
      query: (sql, params) => srv.withDbLock(() => srv.db.query(sql, params)),
    });

    // Case 1: 429 rate limit stops after 1 request with 0 retries
    let calls429 = 0;
    const res429 = await runBoundedFacebookCollection(
      store,
      {
        async getUsage() {
          return { creditsUsed: 5, creditsRemaining: 195, creditsLimit: 200 };
        },
        async fetchFacebookPosts() {
          calls429 += 1;
          throw new TransportError(429);
        },
      },
      { runKey: "rate-limit-check" },
    );
    assert.equal(calls429, 1);
    assert.equal(res429.run.status, "stopped");
    assert.equal(res429.run.items[0].status, "error");
    assert.equal(res429.run.items[0].httpStatus, 429);

    // Case 2: Network drop after send marks attempt uncertain & stops without retry
    let callsDrop = 0;
    const resDrop = await runBoundedFacebookCollection(
      store,
      {
        async getUsage() {
          return { creditsUsed: 5, creditsRemaining: 195, creditsLimit: 200 };
        },
        async fetchFacebookPosts() {
          callsDrop += 1;
          throw new TransportError(null);
        },
      },
      { runKey: "network-drop-check" },
    );
    assert.equal(callsDrop, 1);
    assert.equal(resDrop.run.status, "stopped");
    assert.equal(resDrop.run.creditsUncertain, true);
    assert.equal(resDrop.run.items[0].status, "uncertain");
    assert.equal(resDrop.run.items[0].creditsUncertain, true);
  } finally {
    await srv.close();
  }
});
