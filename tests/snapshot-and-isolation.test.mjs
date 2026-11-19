import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  LEGACY_SOURCE_UUIDS,
  MAZID_ORG_ID,
  parseSnapshotPayload,
  RASD_ORG_ID,
  SNAPSHOT_SUBSCRIPTIONS,
} from "../lib/snapshot.ts";
import { startLocalSupabase } from "../scripts/local-supabase.mjs";
import { bootstrapKashida } from "../scripts/bootstrap-auth.mjs";
import { importSnapshotToSupabase } from "../scripts/import-snapshot.mjs";

function buildSyntheticMirrorSnapshot() {
  const sources = [
    { id: "rassd", name: "شبكة رصد", kind: "page", url: "https://www.facebook.com/RassdNewsN" },
    { id: "youm7", name: "اليوم السابع", kind: "page", url: "https://www.facebook.com/Youm7" },
    { id: "mazid", name: "مزيد", kind: "page", url: "https://www.facebook.com/mazidstories" },
    { id: "group-783", name: "جروب Facebook 783030320118289", kind: "group", url: "https://www.facebook.com/groups/783030320118289" },
    { id: "group-230", name: "جروب Facebook 230664764330181", kind: "group", url: "https://www.facebook.com/groups/230664764330181" },
  ];
  const spec = [
    ["youm7", "photo", 1, "أخبار معرض الكتاب الأول"],
    ["youm7", "video", 2, "فيديو اليوم السابع"],
    ["youm7", "video", 3, "مقطع ثانٍ من اليوم السابع"],
    ["youm7", "video", 4, "مقطع ثالث من اليوم السابع"],
    ["mazid", "photo", 5, "تقرير مزيد الأول"],
    ["mazid", "photo", 6, "تقرير مزيد الثاني"],
    ["mazid", "video", 7, "فيديو مزيد"],
    ["mazid", "photo", 8, "تقرير مزيد الرابع"],
    ["group-783", "video", 9, "مقطع من الجروب الأول"],
    ["group-783", "video", 10, "مقطع ثانٍ من الجروب الأول"],
    ["group-783", "photo", 11, ""], // textless media post
    ["group-783", "photo", 12, "منشور مصور من الجروب الأول"],
    ["rassd", "photo", 13, "خبر حصري لشبكة رصد"],
    ["group-230", "photo", 14, "خبر محلي من الدقهلية"],
    ["group-230", "photo", 15, "متابعة خدمية من الجروب الثاني"],
    ["group-230", "photo", 16, "إعلان محلي من الجروب الثاني"],
  ];
  const posts = spec.map(([source_id, media_type, idx, text]) => {
    const mm = String(10 + idx).padStart(2, "0");
    return {
      source_id,
      source_name: sources.find((s) => s.id === source_id).name,
      platform: "Facebook",
      id: `9900000000000${String(idx).padStart(2, "0")}`,
      url: `https://www.facebook.com/${source_id}/posts/synthetic-${idx}`,
      published_at: `2026-11-06T08:${mm}:00+00:00`,
      collected_at: `2026-11-06T14:${mm}:15.123456+00:00`,
      text,
      media_type,
      media: [
        {
          type: media_type,
          url: `https://scontent.fbcdn.net/synthetic/${idx}.${media_type === "video" ? "mp4" : "jpg"}`,
        },
      ],
      shared_post: idx !== 10,
      time_origin: "provider.values.publish_time",
      time_semantics_verified: false,
      engagement: { reactions: idx * 3, comments: idx, shares: 1, views: null },
    };
  });
  return {
    schema_version: 1,
    collected_on_utc: "2026-11-06",
    exported_on: "2026-11-19",
    source_count: 5,
    post_count: 16,
    sources,
    posts,
  };
}

async function seedParsedSnapshot(service, parsed, setRef = true) {
  for (const org of [
    { id: MAZID_ORG_ID, name: "مزيد" },
    { id: RASD_ORG_ID, name: "رصد" },
  ]) {
    await service.rpc("newsroom_service_upsert_org", {
      p_id: org.id, p_name: org.name, p_max_sources: 10, p_allow_add: true, p_feed_days: 7,
    });
  }
  for (const s of parsed.sources) {
    await service.rpc("newsroom_service_upsert_source", {
      p_id: s.id, p_platform: s.platform, p_kind: s.kind, p_native_key: s.nativeKey,
      p_locator: s.locator, p_name: s.name, p_legacy_id: s.legacyId,
    });
  }
  for (const [orgId, ids] of Object.entries(SNAPSHOT_SUBSCRIPTIONS)) {
    for (const sid of ids) {
      await service.rpc("newsroom_service_subscribe", { p_org: orgId, p_source: sid });
    }
  }
  for (const p of parsed.posts) {
    await service.rpc("newsroom_service_upsert_post", {
      p_platform: p.platform, p_native_key: p.nativeKey, p_source_id: p.sourceId,
      p_body: p.text, p_media: p.media, p_raw_media_type: p.rawMediaType,
      p_media_url: p.mediaUrl, p_media_items: p.mediaItems, p_original_url: p.originalUrl,
      p_published_at: p.publishedAt, p_seen_at: p.seenAt, p_engagement: p.engagement,
      p_shared_post: p.sharedPost, p_time_origin: p.timeOrigin,
      p_time_semantics_verified: p.timeSemanticsVerified,
    });
  }
  if (setRef && parsed.referenceAt) {
    await service.rpc("newsroom_service_set_reference", {
      p_reference_at: parsed.referenceAt, p_label: `لقطة ${parsed.collectedOnUtc}`,
    });
  }
}

test("snapshot import twice keeps 16 unique posts, 12 Mazid / 8 Rasd, pause drops 12->8, and pagination is stable", async () => {
  const srv = await startLocalSupabase({ port: 0 });
  try {
    const passwords = {
      adminPassword: "TestAdmin!Pass123",
      user1Password: "TestUser1!Pass123",
      user2Password: "TestUser2!Pass123",
    };
    await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      ...passwords,
    });

    const service = createClient(srv.url, srv.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const realPath = resolve(process.cwd(), "docs/context/handoff/facebook-snapshot.json");
    if (existsSync(realPath)) {
      const r1 = await importSnapshotToSupabase({
        supabaseUrl: srv.url,
        serviceRoleKey: srv.serviceRoleKey,
        snapshotPath: realPath,
        setReferenceDate: true,
      });
      assert.equal(r1.sourcesImported, 5);
      assert.equal(r1.postsProcessed, 16);
      assert.equal(r1.inserted, 16);
      assert.equal(r1.mediaCounts.photo, 10);
      assert.equal(r1.mediaCounts.video, 6);

      // Re-import must be idempotent (0 new inserts, still 16 total!)
      const r2 = await importSnapshotToSupabase({
        supabaseUrl: srv.url,
        serviceRoleKey: srv.serviceRoleKey,
        snapshotPath: realPath,
        setReferenceDate: true,
      });
      assert.equal(r2.inserted, 0);
      assert.equal(r2.updated, 16);
    } else {
      const parsed = parseSnapshotPayload(buildSyntheticMirrorSnapshot());
      await seedParsedSnapshot(service, parsed, true);
      await seedParsedSnapshot(service, parsed, true);
    }

    // Verify 6 subscriptions map to 5 unique active Facebook sources and 5 plan_slot jobs
    const counts = await srv.withDbLock(async () => {
      const subs = await srv.db.query("select count(*)::int as c from newsroom.subscriptions where active");
      const posts = await srv.db.query("select count(*)::int as c from newsroom.posts");
      const media = await srv.db.query("select media, count(*)::int as c from newsroom.posts group by media");
      const jobs = await srv.db.query("select newsroom.plan_slot('2026-11-19T12:00:00Z') as c");
      const retry = await srv.db.query("select newsroom.plan_slot('2026-11-19T12:15:00Z') as c");
      return {
        subs: subs.rows[0].c,
        posts: posts.rows[0].c,
        media: Object.fromEntries(media.rows.map((r) => [r.media, r.c])),
        jobs: jobs.rows[0].c,
        retry: retry.rows[0].c,
      };
    });
    assert.equal(counts.subs, 6);
    assert.equal(counts.posts, 16);
    assert.equal(counts.media.photo, 10);
    assert.equal(counts.media.video, 6);
    assert.equal(counts.jobs, 5);
    assert.equal(counts.retry, 0);

    // Sign in as Mazid editor and Rasd editor with real JWTs
    const c1 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const c2 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    await c1.auth.signInWithPassword({ email: "user1@gmail.com", password: passwords.user1Password });
    await c2.auth.signInWithPassword({ email: "user2@gmail.com", password: passwords.user2Password });

    // Paginate through ALL of Mazid's feed with limit=5 -> 5 + 5 + 2 = 12 unique posts
    const mazidIds = [];
    let cursor = null;
    let pages = 0;
    let totalReported = 0;
    do {
      const { data, error } = await c1.rpc("newsroom_feed", {
        p_org: MAZID_ORG_ID,
        p_platform: "facebook",
        p_media: "all",
        p_source: null,
        p_query: "",
        p_cursor_seen: cursor?.seenAt ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_limit: 5,
      });
      assert.ifError(error);
      totalReported = data.totalCount;
      for (const p of data.posts) mazidIds.push(p.id);
      cursor = data.nextCursor;
      pages += 1;
      if (!data.hasMore) break;
    } while (pages < 10);

    assert.equal(totalReported, 12);
    assert.equal(pages, 3);
    assert.equal(mazidIds.length, 12);
    assert.equal(new Set(mazidIds).size, 12);

    // Rasd sees 8 posts
    const rasdFeed = await c2.rpc("newsroom_feed", {
      p_org: RASD_ORG_ID,
      p_platform: "facebook",
      p_media: "all",
      p_limit: 20,
    });
    assert.ifError(rasdFeed.error);
    assert.equal(rasdFeed.data.totalCount, 8);
    assert.equal(rasdFeed.data.posts.length, 8);

    // Pause Youm7 for Mazid -> drops 12 to 8; Rasd stays at 8
    const pauseRes = await c1.rpc("newsroom_pause", {
      p_org: MAZID_ORG_ID,
      p_source: LEGACY_SOURCE_UUIDS.youm7,
    });
    assert.ifError(pauseRes.error);

    const mazidAfterPause = await c1.rpc("newsroom_feed", {
      p_org: MAZID_ORG_ID,
      p_platform: "facebook",
      p_limit: 20,
    });
    assert.equal(mazidAfterPause.data.totalCount, 8);

    const rasdAfterMazidPause = await c2.rpc("newsroom_feed", {
      p_org: RASD_ORG_ID,
      p_platform: "facebook",
      p_limit: 20,
    });
    assert.equal(rasdAfterMazidPause.data.totalCount, 8);

    // Resume Youm7 for Mazid -> returns to 12
    const resumeRes = await c1.rpc("newsroom_follow", {
      p_org: MAZID_ORG_ID,
      p_locator: "facebook:page:youm7",
    });
    assert.equal(resumeRes.data, "added");
    const mazidResumed = await c1.rpc("newsroom_feed", {
      p_org: MAZID_ORG_ID,
      p_platform: "facebook",
      p_limit: 20,
    });
    assert.equal(mazidResumed.data.totalCount, 12);

    // Verify textless post exists in Mazid's feed with originalUrl & empty text
    const textless = mazidResumed.data.posts.find((p) => p.text === "");
    assert.ok(textless, "Expected textless media post in Mazid feed");
    assert.ok(textless.originalUrl?.startsWith("https://www.facebook.com/"));

    // Clear reference date (live mode = now()) -> 6 Nov posts are outside 7-day window without mutating dates!
    await service.rpc("newsroom_service_set_reference", {
      p_reference_at: null,
      p_label: null,
    });
    const mazidLive = await c1.rpc("newsroom_feed", {
      p_org: MAZID_ORG_ID,
      p_platform: "facebook",
      p_limit: 20,
    });
    assert.equal(mazidLive.data.totalCount, 0);

    // Confirm timestamps in DB were NOT shifted to today
    const minPub = await srv.withDbLock(() =>
      srv.db.query("select min(published_at)::text as d from newsroom.posts"),
    );
    assert.match(minPub.rows[0].d, /^2026-11-06/);
  } finally {
    await srv.close();
  }
});

test("re-importing/updating a post preserves identity & first seen_at; identical text across 2 post IDs retains both; synthetic X model works", async () => {
  const srv = await startLocalSupabase({ port: 0 });
  try {
    await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      adminPassword: "TestAdmin!Pass123",
      user1Password: "TestUser1!Pass123",
      user2Password: "TestUser2!Pass123",
    });
    const service = createClient(srv.url, srv.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const firstSeen = new Date(Date.now() - 3600_000).toISOString();
    const laterSeen = new Date().toISOString();
    const r1 = await service.rpc("newsroom_service_upsert_post", {
      p_platform: "facebook",
      p_native_key: "fb-post-alpha",
      p_source_id: LEGACY_SOURCE_UUIDS.youm7,
      p_body: "نص عاجل مطابق",
      p_media: "text",
      p_raw_media_type: "text",
      p_media_url: null,
      p_media_items: [],
      p_original_url: "https://www.facebook.com/Youm7/posts/fb-post-alpha",
      p_published_at: firstSeen,
      p_seen_at: firstSeen,
      p_engagement: { reactions: 5, comments: 1, shares: 0, views: null },
      p_shared_post: false,
      p_time_origin: "provider.values.publish_time",
      p_time_semantics_verified: false,
    });
    assert.equal(r1.data.inserted, true);

    // Update same post later -> keeps same UUID and FIRST seen_at!
    const r2 = await service.rpc("newsroom_service_upsert_post", {
      p_platform: "facebook",
      p_native_key: "fb-post-alpha",
      p_source_id: LEGACY_SOURCE_UUIDS.youm7,
      p_body: "نص عاجل مطابق (محدّث)",
      p_media: "text",
      p_raw_media_type: "text",
      p_media_url: null,
      p_media_items: [],
      p_original_url: "https://www.facebook.com/Youm7/posts/fb-post-alpha",
      p_published_at: laterSeen,
      p_seen_at: laterSeen,
      p_engagement: { reactions: 25, comments: 4, shares: 2, views: null },
      p_shared_post: false,
      p_time_origin: "provider.values.publish_time",
      p_time_semantics_verified: false,
    });
    assert.equal(r2.data.inserted, false);
    assert.equal(r2.data.postId, r1.data.postId);

    const appRow = await srv.withDbLock(() =>
      srv.db.query("select seen_at, last_seen_at from newsroom.appearances where post_id = $1", [r1.data.postId]),
    );
    assert.equal(new Date(appRow.rows[0].seen_at).toISOString(), firstSeen);
    assert.equal(new Date(appRow.rows[0].last_seen_at).toISOString(), laterSeen);

    // Different publisher/native_key with IDENTICAL text -> retained as separate post!
    const r3 = await service.rpc("newsroom_service_upsert_post", {
      p_platform: "facebook",
      p_native_key: "fb-post-beta",
      p_source_id: LEGACY_SOURCE_UUIDS.mazid,
      p_body: "نص عاجل مطابق (محدّث)",
      p_media: "text",
      p_raw_media_type: "text",
      p_media_url: null,
      p_media_items: [],
      p_original_url: "https://www.facebook.com/mazidstories/posts/fb-post-beta",
      p_published_at: laterSeen,
      p_seen_at: laterSeen,
      p_engagement: null,
      p_shared_post: false,
      p_time_origin: "provider.values.publish_time",
      p_time_semantics_verified: false,
    });
    assert.equal(r3.data.inserted, true);
    assert.notEqual(r3.data.postId, r1.data.postId);

    // Synthetic X model test (strictly labeled & isolated inside tests)
    const c1 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    await c1.auth.signInWithPassword({ email: "user1@gmail.com", password: "TestUser1!Pass123" });
    assert.equal(
      (await c1.rpc("newsroom_follow", { p_org: MAZID_ORG_ID, p_locator: "x:account:youm7" })).data,
      "added",
    );
    // Honest empty X feed before any X posts exist
    const emptyX = await c1.rpc("newsroom_feed", {
      p_org: MAZID_ORG_ID, p_platform: "x", p_limit: 10,
    });
    assert.equal(emptyX.data.totalCount, 0);
    assert.deepEqual(emptyX.data.posts, []);

    // Insert 1 labeled synthetic X post -> visible on X tab, NOT on Facebook tab
    await service.rpc("newsroom_service_upsert_post", {
      p_platform: "x",
      p_native_key: "synthetic-x-tweet-1",
      p_source_id: "20000000-0000-4000-9000-000000000004",
      p_body: "[عينة اختبار X] خبر عاجل من القاهرة",
      p_media: "text",
      p_raw_media_type: "text",
      p_media_url: null,
      p_media_items: [],
      p_original_url: "https://x.com/Youm7/status/1001",
      p_published_at: laterSeen,
      p_seen_at: laterSeen,
      p_engagement: { reactions: 12, comments: 2, shares: 3, views: 500 },
      p_shared_post: false,
      p_time_origin: "synthetic.test",
      p_time_semantics_verified: true,
    });
    const xFeed = await c1.rpc("newsroom_feed", {
      p_org: MAZID_ORG_ID, p_platform: "x", p_query: "إلقاهِرة", p_limit: 10,
    });
    assert.equal(xFeed.data.totalCount, 1);
    assert.equal(xFeed.data.posts[0].platform, "x");
    const fbFeed = await c1.rpc("newsroom_feed", {
      p_org: MAZID_ORG_ID, p_platform: "facebook", p_limit: 10,
    });
    assert.equal(fbFeed.data.totalCount, 2);
  } finally {
    await srv.close();
  }
});

test("50-org scale deduplication (50x100 -> 100 unique jobs; 2x100 with 50 shared -> 150 unique jobs) and concurrent quota cap", async () => {
  const srv = await startLocalSupabase({ port: 0 });
  try {
    // Part A: 50 organizations following the exact same 100 sources = 5,000 subscriptions -> 100 unique collection jobs
    const scaleA = await srv.withDbLock(async () => {
      await srv.db.exec(`
        with orgs as (
          insert into newsroom.organizations(name, max_sources)
          select 'جهة-' || g, 200 from generate_series(1, 50) g
          returning id
        ), srcs as (
          insert into newsroom.sources(platform, kind, native_key, locator, name)
          select 'facebook', 'page', 'scale' || g, 'facebook:page:scale' || g, 'مصدر ' || g
          from generate_series(1, 100) g
          returning id
        )
        insert into newsroom.subscriptions(org_id, source_id, active)
        select o.id, s.id, true from orgs o cross join srcs s;
      `);
      const subCount = (await srv.db.query("select count(*)::int as c from newsroom.subscriptions where active")).rows[0].c;
      const planned = (await srv.db.query("select newsroom.plan_slot('2026-11-19T14:00:00Z') as c")).rows[0].c;
      return { subCount, planned };
    });
    assert.equal(scaleA.subCount, 5000);
    assert.equal(scaleA.planned, 100);

    // Part B: 2 organizations each following 100 sources with 50 shared -> 150 unique sources
    const scaleB = await srv.withDbLock(async () => {
      await srv.db.exec("truncate newsroom.collection_jobs, newsroom.subscriptions, newsroom.sources, newsroom.organizations cascade;");
      await srv.db.exec(`
        insert into newsroom.organizations(id, name, max_sources) values
          ('aaaaaaaa-0000-4000-9000-000000000001', 'ألف', 200),
          ('aaaaaaaa-0000-4000-9000-000000000002', 'باء', 200);
        with srcs as (
          insert into newsroom.sources(platform, kind, native_key, locator, name)
          select 'facebook', 'page', 'overlap' || g, 'facebook:page:overlap' || g, 'مشترك ' || g
          from generate_series(1, 150) g
          returning id, native_key
        )
        insert into newsroom.subscriptions(org_id, source_id, active)
        select 'aaaaaaaa-0000-4000-9000-000000000001'::uuid, id, true from srcs where substring(native_key from 8)::int <= 100
        union all
        select 'aaaaaaaa-0000-4000-9000-000000000002'::uuid, id, true from srcs where substring(native_key from 8)::int > 50;
      `);
      const subCount = (await srv.db.query("select count(*)::int as c from newsroom.subscriptions where active")).rows[0].c;
      const planned = (await srv.db.query("select newsroom.plan_slot('2026-11-19T14:30:00Z') as c")).rows[0].c;
      return { subCount, planned };
    });
    assert.equal(scaleB.subCount, 200);
    assert.equal(scaleB.planned, 150);

    // Part C: Concurrency test near quota cap (max_sources = 4, currently 3 active -> 3 concurrent adds -> ONLY 1 succeeds!)
    await srv.withDbLock(() =>
      srv.db.exec("truncate newsroom.collection_jobs, newsroom.subscriptions, newsroom.sources, newsroom.organizations cascade;"),
    );
    await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      adminPassword: "TestAdmin!Pass123",
      user1Password: "TestUser1!Pass123",
      user2Password: "TestUser2!Pass123",
    });
    await srv.withDbLock(() =>
      srv.db.query("update newsroom.organizations set max_sources = 4 where id = $1", [MAZID_ORG_ID]),
    );
    const c1 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    await c1.auth.signInWithPassword({ email: "user1@gmail.com", password: "TestUser1!Pass123" });

    const concurrent = await Promise.all([
      c1.rpc("newsroom_follow", { p_org: MAZID_ORG_ID, p_locator: "x:account:youm7" }),
      c1.rpc("newsroom_follow", { p_org: MAZID_ORG_ID, p_locator: "facebook:group:555001" }),
      c1.rpc("newsroom_follow", { p_org: MAZID_ORG_ID, p_locator: "facebook:group:555002" }),
    ]);
    const outcomes = concurrent.map((r) => r.data);
    const accepted = outcomes.filter((x) => x === "added" || x === "queued");
    const limited = outcomes.filter((x) => x === "limit");
    assert.equal(accepted.length, 1, `Expected exactly 1 accepted, got ${JSON.stringify(outcomes)}`);
    assert.equal(limited.length, 2, `Expected 2 rate-limited by cap, got ${JSON.stringify(outcomes)}`);
  } finally {
    await srv.close();
  }
});
