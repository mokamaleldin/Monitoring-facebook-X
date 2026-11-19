import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { LEGACY_SOURCE_UUIDS, MAZID_ORG_ID, RASD_ORG_ID } from "../lib/snapshot.ts";
import { startLocalSupabase } from "../scripts/local-supabase.mjs";
import { bootstrapKashida } from "../scripts/bootstrap-auth.mjs";

const PW = {
  adminPassword: "AdminStrong!2026",
  user1Password: "EditorOne!2026",
  user2Password: "EditorTwo!2026",
};

test("bootstrap is idempotent, public signup is disabled, and real sessions enforce strict tenant & admin isolation", async () => {
  const srv = await startLocalSupabase({ port: 0 });
  try {
    const first = await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      ...PW,
    });
    assert.equal(first.accounts.filter((a) => a.authStatus === "created").length, 3);

    // Re-running bootstrap with different password input MUST preserve existing accounts & passwords
    const second = await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      adminPassword: "DifferentUnused!999",
      user1Password: "DifferentUnused!999",
      user2Password: "DifferentUnused!999",
    });
    assert.equal(second.accounts.filter((a) => a.authStatus === "existing").length, 3);

    // Public signup MUST be rejected
    const anonClient = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const signup = await anonClient.auth.signUp({
      email: "intruder@example.com",
      password: "Password!1234",
    });
    assert.ok(signup.error, "Public signup should be disabled");

    // Seed one exclusive post for Rasd
    const service = createClient(srv.url, srv.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const nowIso = new Date().toISOString();
    const rasdPost = await service.rpc("newsroom_service_upsert_post", {
      p_platform: "facebook",
      p_native_key: "rasd-only-post-1",
      p_source_id: LEGACY_SOURCE_UUIDS.rassd,
      p_body: "خبر حصري لجهة رصد فقط",
      p_media: "text",
      p_raw_media_type: "text",
      p_media_url: null,
      p_media_items: [],
      p_original_url: "https://www.facebook.com/RassdNewsN/posts/rasd-only-post-1",
      p_published_at: nowIso,
      p_seen_at: nowIso,
      p_engagement: null,
      p_shared_post: false,
      p_time_origin: "test",
      p_time_semantics_verified: true,
    });
    const rasdPostId = rasdPost.data.postId;

    // Sign in all 3 accounts using original passwords (proving re-bootstrap preserved them!)
    const adminClient = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const editor1 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const editor2 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });

    const sAdmin = await adminClient.auth.signInWithPassword({ email: "kashida@admin.com", password: PW.adminPassword });
    const s1 = await editor1.auth.signInWithPassword({ email: "user1@gmail.com", password: PW.user1Password });
    const s2 = await editor2.auth.signInWithPassword({ email: "user2@gmail.com", password: PW.user2Password });
    assert.ifError(sAdmin.error);
    assert.ifError(s1.error);
    assert.ifError(s2.error);

    const adminJwt = sAdmin.data.session.access_token;
    const editor1Jwt = s1.data.session.access_token;

    // Editor 1 sees ONLY Mazid
    const ws1 = await editor1.rpc("newsroom_workspaces");
    assert.deepEqual(ws1.data.map((w) => w.id), [MAZID_ORG_ID]);

    // Editor 1 attempts to read/mutate Rasd workspace -> DENIED
    assert.ok((await editor1.rpc("newsroom_feed", { p_org: RASD_ORG_ID })).error);
    assert.ok((await editor1.rpc("newsroom_org_meta", { p_org: RASD_ORG_ID })).error);
    assert.ok((await editor1.rpc("newsroom_follow", { p_org: RASD_ORG_ID, p_locator: "x:account:youm7" })).error);
    assert.ok((await editor1.rpc("newsroom_pause", { p_org: RASD_ORG_ID, p_source: LEGACY_SOURCE_UUIDS.youm7 })).error);
    assert.ok((await editor1.rpc("newsroom_service_orphan_users")).error);

    // Editor 1 direct REST probe for Rasd's exclusive post ID -> 0 rows
    const directProbe = await fetch(
      `${srv.url}/rest/v1/posts?select=id&id=eq.${rasdPostId}`,
      {
        headers: {
          Authorization: `Bearer ${editor1Jwt}`,
          apikey: srv.publishableKey,
          "Accept-Profile": "newsroom",
        },
      },
    );
    assert.equal(directProbe.status, 200);
    assert.deepEqual(await directProbe.json(), []);

    // Editor 2 CAN read Rasd's exclusive post
    const rasdFeed = await editor2.rpc("newsroom_feed", { p_org: RASD_ORG_ID, p_platform: "facebook" });
    assert.equal(rasdFeed.data.totalCount, 1);
    assert.equal(rasdFeed.data.posts[0].id, rasdPostId);

    // Editor 1 attempting ANY admin API endpoint -> HTTP 403
    for (const [method, path, body] of [
      ["GET", "/functions/v1/admin-api/overview", undefined],
      ["POST", "/functions/v1/admin-api/orgs", { name: "حساب مخترق" }],
      ["POST", "/functions/v1/admin-api/editors", { email: "hack@example.com", password: "Password!123", orgId: MAZID_ORG_ID }],
      ["POST", "/functions/v1/collect-facebook", { runKey: "unauthorized" }],
    ]) {
      const r = await fetch(`${srv.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${editor1Jwt}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(r.status, 403, `Expected 403 for editor calling ${method} ${path}`);
    }

    // Admin creates a new org + new editor account + verifies new editor can sign in & is isolated!
    const createOrgRes = await fetch(`${srv.url}/functions/v1/admin-api/orgs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "الشروق", maxSources: 5, allowAdd: false, feedDays: 7 }),
    });
    assert.equal(createOrgRes.status, 201);
    const newOrg = await createOrgRes.json();

    const createEdRes = await fetch(`${srv.url}/functions/v1/admin-api/editors`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "shorouk@example.com", password: "Shorouk!Password1", orgId: newOrg.id }),
    });
    assert.equal(createEdRes.status, 201);
    const createdEditor = await createEdRes.json();
    assert.equal(createdEditor.status, "created");

    const editor3 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const s3 = await editor3.auth.signInWithPassword({ email: "shorouk@example.com", password: "Shorouk!Password1" });
    assert.ifError(s3.error);
    const ws3 = await editor3.rpc("newsroom_workspaces");
    assert.deepEqual(ws3.data.map((w) => w.id), [newOrg.id]);

    // Because admin set allowAdd=false on الشروق, editor3 CANNOT add sources on the server
    const blockedFollow = await editor3.rpc("newsroom_follow", {
      p_org: newOrg.id,
      p_locator: "facebook:page:youm7",
    });
    assert.equal(blockedFollow.data, "disabled");

    // Admin CAN add sources for الشروق on the editor's behalf!
    const adminAddRes = await fetch(`${srv.url}/functions/v1/admin-api/orgs/${newOrg.id}/sources`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lines: ["https://www.facebook.com/Youm7", "https://example.com/bad"] }),
    });
    assert.equal(adminAddRes.status, 200);
    const receipts = await adminAddRes.json();
    assert.equal(receipts.rows[0].status, "بدأت المتابعة");
    assert.equal(receipts.rows[1].status, "رابط غير مدعوم");

    // Sign out revokes session access immediately
    await editor1.auth.signOut();
    const afterLogout = await fetch(`${srv.url}/rest/v1/rpc/newsroom_workspaces`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${editor1Jwt}`,
        apikey: srv.publishableKey,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(afterLogout.status, 401);
  } finally {
    await srv.close();
  }
});

test("partial failure after auth.admin.createUser is safely recoverable without duplicating user", async () => {
  let failOnce = true;
  const srv = await startLocalSupabase({
    port: 0,
    hooks: {
      beforeAssignMembership() {
        if (failOnce) {
          failOnce = false;
          throw new Error("Simulated transient DB failure on newsroom.members insert");
        }
      },
    },
  });
  try {
    await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      ...PW,
    });
    const adminClient = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const sAdmin = await adminClient.auth.signInWithPassword({ email: "kashida@admin.com", password: PW.adminPassword });
    const adminJwt = sAdmin.data.session.access_token;

    // First attempt: Auth user created, membership fails -> returns 500 with code=membership_pending
    const r1 = await fetch(`${srv.url}/functions/v1/admin-api/editors`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "recover@example.com", password: "Recover!Password1", orgId: MAZID_ORG_ID }),
    });
    assert.equal(r1.status, 500);
    const body1 = await r1.json();
    assert.equal(body1.code, "membership_pending");
    assert.ok(body1.userId);

    // Overview lists the orphaned Auth user so admin can see it
    const ov = await (
      await fetch(`${srv.url}/functions/v1/admin-api/overview`, {
        headers: { Authorization: `Bearer ${adminJwt}` },
      })
    ).json();
    assert.ok(ov.orphanUsers.some((u) => u.email === "recover@example.com"));

    // Retry safely completes membership linking without failing with "already registered"
    const r2 = await fetch(`${srv.url}/functions/v1/admin-api/editors`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "recover@example.com", password: "", orgId: MAZID_ORG_ID }),
    });
    assert.equal(r2.status, 200);
    const body2 = await r2.json();
    assert.equal(body2.status, "recovered");
    assert.equal(body2.userId, body1.userId);

    // Recovered editor can immediately log in and access Mazid!
    const edClient = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const login = await edClient.auth.signInWithPassword({
      email: "recover@example.com",
      password: "Recover!Password1",
    });
    assert.ifError(login.error);
    const ws = await edClient.rpc("newsroom_workspaces");
    assert.deepEqual(ws.data.map((w) => w.id), [MAZID_ORG_ID]);
  } finally {
    await srv.close();
  }
});
