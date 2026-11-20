import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { analyzeFacebookTrends, isNoisePost } from "../lib/trends-engine.ts";
import {
  checkRobotsAllows,
  parseGetDayTrendsEgypt,
  parseGoogleTrendsRss,
} from "../server/trends-service.ts";
import { LEGACY_SOURCE_UUIDS, MAZID_ORG_ID, RASD_ORG_ID } from "../lib/snapshot.ts";
import { startLocalSupabase } from "../scripts/local-supabase.mjs";
import { bootstrapKashida } from "../scripts/bootstrap-auth.mjs";

function makePost(overrides = {}) {
  return {
    id: overrides.id || "p-1",
    platform: "facebook",
    text: overrides.text ?? "",
    media: "photo",
    mediaUrl: null,
    originalUrl: overrides.originalUrl || "https://www.facebook.com/Youm7/posts/1",
    publishedAt: "2026-11-20T10:00:00Z",
    seenAt: "2026-11-20T11:00:00Z",
    sources: overrides.sources || [{ id: "s1", name: "اليوم السابع" }],
    engagement: overrides.engagement || { reactions: 20, comments: 5, shares: 2, views: null },
  };
}

test("noise gatekeeper drops Facebook member-welcome spam, giveaways, and WhatsApp ads", () => {
  assert.equal(isNoisePost("دعونا نرحب بأعضائنا الجدد! لا تنسى الصلاة على النبي تامر محمد، سوسن سعد، أحمد علي"), true);
  assert.equal(isNoisePost("مين هيكسب الـ300 جنيه؟ مسابقة المهندس للأحذية وجائزتين نقديتين"), true);
  assert.equal(isNoisePost("فرخه وخلطة https://chat.whatsapp.com/abc123"), true);
  assert.equal(isNoisePost(""), true);
  assert.equal(
    isNoisePost("وزارة الصحة تكشف عن خطة لتوطين 60% من أجهزة التصوير الطبي في مصر بحلول 2030"),
    false,
  );
});

test("trends engine excludes publisher self-tags, counts each hashtag once per post, clusters multi-source Egyptian stories, and never fabricates topics", () => {
  const posts = [
    makePost({
      id: "p1",
      text: "انطلاق فعاليات مهرجان القاهرة السينمائي الدولي وسط حضور فني كبير #مهرجان_القاهرة #مهرجان_القاهرة #اليوم_السابع #عاجل",
      sources: [{ id: "s1", name: "اليوم السابع" }],
    }),
    makePost({
      id: "p2",
      text: "تغطية خاصة لأبرز أفلام مهرجان القاهرة السينمائي في دورته الجديدة #مزيد #مهرجان_القاهرة",
      sources: [{ id: "s2", name: "مزيد" }],
    }),
    makePost({
      id: "p3",
      text: "وزارة الصحة تعلن خطة لتوطين أجهزة التصوير الطبي في المستشفيات المصرية بحلول 2030",
      sources: [{ id: "s1", name: "اليوم السابع" }],
    }),
    makePost({
      id: "p4",
      text: "دعونا نرحب بأعضائنا الجدد! أحمد علي، محمود حسن، سارة محمد",
      sources: [{ id: "s3", name: "جروب عام" }],
    }),
  ];

  const signals = [
    {
      rank: 1,
      name: "مهرجان القاهرة السينمائي",
      kind: "topic",
      platform: "X",
      url: "https://x.com/search?q=test",
    },
  ];

  const analysis = analyzeFacebookTrends(posts, signals, { country: "EG", maxTopics: 15 });
  assert.equal(analysis.totalPostsConsidered, 4);
  assert.equal(analysis.noiseFilteredCount, 1);
  assert.equal(analysis.analyzedPosts, 3);

  // Explicit hashtags: only #مهرجان_القاهرة (NOT #اليوم_السابع, NOT #مزيد, NOT #عاجل) counted across 2 posts
  assert.equal(analysis.hashtags.length, 1);
  assert.equal(analysis.hashtags[0].tag, "#مهرجان_القاهرة");
  assert.equal(analysis.hashtags[0].postCount, 2);
  assert.equal(analysis.hashtags[0].sourceCount, 2);

  // Topics: ONLY the 2 genuine topics (never fabricated up to 15!)
  assert.equal(analysis.topics.length, 2);
  assert.equal(analysis.topics[0].postCount, 2);
  assert.equal(analysis.topics[0].sourceCount, 2);
  assert.equal(analysis.topics[0].tier, "high");
  assert.equal(analysis.topics[0].egyptRelated, true);
  assert.equal(analysis.topics[0].matchedTrends.length, 1);
  assert.equal(analysis.topics[0].matchedTrends[0].platform, "X");

  // Empty input -> 0 topics, 0 hashtags
  const empty = analyzeFacebookTrends([], signals);
  assert.deepEqual(empty.topics, []);
  assert.deepEqual(empty.hashtags, []);
});

test("Google RSS, GetDayTrends Egypt heading check, and robots.txt parser behave strictly", () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
      <item>
        <title>الأهلي اليوم</title>
        <ht:approx_traffic>50K+</ht:approx_traffic>
        <pubDate>Fri, 20 Nov 2026 12:00:00 +0000</pubDate>
        <ht:news_item>
          <ht:news_item_title>موعد مباراة الأهلي القادمة</ht:news_item_title>
          <ht:news_item_source>اليوم السابع</ht:news_item_source>
          <ht:news_item_url>https://www.youm7.com/1</ht:news_item_url>
        </ht:news_item>
      </item>
    </channel></rss>`;
  const gItems = parseGoogleTrendsRss(rss);
  assert.equal(gItems.length, 1);
  assert.equal(gItems[0].name, "الأهلي اليوم");
  assert.equal(gItems[0].trafficLabel, "50K+");
  assert.equal(gItems[0].newsSource, "اليوم السابع");
  assert.ok(gItems[0].url.includes("geo=EG"));

  const html = `<h1>Twitter Trends<span> in Egypt</span></h1>
    <table><tr><td><a href="/egypt/trend/%23test/">#مصر_النهاردة</a></td></tr>
    <tr><td><a href="/egypt/trend/topic/">مهرجان القاهرة</a></td></tr></table>
    <table><tr><td><a href="/egypt/trend/old/">يجب تجاهله</a></td></tr></table>`;
  const xItems = parseGetDayTrendsEgypt(html);
  assert.equal(xItems.length, 2);
  assert.equal(xItems[0].kind, "hashtag");
  assert.equal(xItems[1].kind, "topic");
  assert.throws(() => parseGetDayTrendsEgypt(html.replace("Egypt", "Germany")));

  assert.equal(checkRobotsAllows("User-agent: *\nDisallow: /private/\n", "KashidaResearch/0.1", "/egypt/"), true);
  assert.equal(checkRobotsAllows("User-agent: *\nDisallow: /egypt/\n", "KashidaResearch/0.1", "/egypt/"), false);
});

test("/functions/v1/trends-api enforces tenant RLS and returns isolated Facebook analysis + Egypt X & Google trends", async () => {
  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("robots.txt")) {
      return new Response("User-agent: *\nAllow: /\n", { status: 200 });
    }
    if (u.includes("getdaytrends.com/egypt/")) {
      return new Response(
        `<h1>Twitter Trends in Egypt</h1><table><tr><td><a href="/egypt/trend/1/">#الدوري_المصري</a></td></tr></table>`,
        { status: 200 },
      );
    }
    if (u.includes("trends.google.com")) {
      return new Response(
        `<rss xmlns:ht="https://trends.google.com/trending/rss"><channel><item><title>أسعار الذهب</title><ht:approx_traffic>20K+</ht:approx_traffic></item></channel></rss>`,
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };

  const srv = await startLocalSupabase({ port: 0, trendsFetchFn: mockFetch });
  try {
    await bootstrapKashida({
      supabaseUrl: srv.url,
      serviceRoleKey: srv.serviceRoleKey,
      adminPassword: "AdminStrong!2026",
      user1Password: "EditorOne!2026",
      user2Password: "EditorTwo!2026",
    });

    const service = createClient(srv.url, srv.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const nowIso = new Date().toISOString();
    // Seed 1 Mazid-only post and 1 Rasd-only post
    await service.rpc("newsroom_service_upsert_post", {
      p_platform: "facebook",
      p_native_key: "mazid-trend-1",
      p_source_id: LEGACY_SOURCE_UUIDS.mazid,
      p_body: "مناقشة عاجلة داخل مجلس النواب حول تدريس التربية العسكرية #التربية_العسكرية",
      p_media: "text",
      p_raw_media_type: "text",
      p_media_url: null,
      p_media_items: [],
      p_original_url: "https://www.facebook.com/mazidstories/posts/mazid-trend-1",
      p_published_at: nowIso,
      p_seen_at: nowIso,
      p_engagement: { reactions: 40, comments: 5, shares: 2, views: null },
      p_shared_post: false,
      p_time_origin: "test",
      p_time_semantics_verified: true,
    });
    await service.rpc("newsroom_service_upsert_post", {
      p_platform: "facebook",
      p_native_key: "rasd-trend-1",
      p_source_id: LEGACY_SOURCE_UUIDS.rassd,
      p_body: "بيان وزارة الخارجية المصرية حول استهداف المدينة المنورة #الخارجية_المصرية",
      p_media: "text",
      p_raw_media_type: "text",
      p_media_url: null,
      p_media_items: [],
      p_original_url: "https://www.facebook.com/RassdNewsN/posts/rasd-trend-1",
      p_published_at: nowIso,
      p_seen_at: nowIso,
      p_engagement: { reactions: 60, comments: 10, shares: 3, views: null },
      p_shared_post: false,
      p_time_origin: "test",
      p_time_semantics_verified: true,
    });

    // Unauthenticated call -> 401
    const unauth = await fetch(`${srv.url}/functions/v1/trends-api?org=${MAZID_ORG_ID}`);
    assert.equal(unauth.status, 401);

    // Editor 1 (Mazid) sign-in
    const c1 = createClient(srv.url, srv.publishableKey, { auth: { persistSession: false } });
    const s1 = await c1.auth.signInWithPassword({ email: "user1@gmail.com", password: "EditorOne!2026" });
    const jwt1 = s1.data.session.access_token;

    // Cross-tenant probe: Mazid asking for Rasd trends -> 403!
    const cross = await fetch(`${srv.url}/functions/v1/trends-api?org=${RASD_ORG_ID}`, {
      headers: { Authorization: `Bearer ${jwt1}` },
    });
    assert.equal(cross.status, 403);

    // Own org: Mazid sees ONLY Mazid's Facebook hashtag/topic + Egypt X & Google trends
    const own = await fetch(`${srv.url}/functions/v1/trends-api?org=${MAZID_ORG_ID}`, {
      headers: { Authorization: `Bearer ${jwt1}` },
    });
    assert.equal(own.status, 200);
    const report = await own.json();
    assert.equal(report.country, "EG");
    assert.equal(report.facebook.hashtags[0].tag, "#التربية_العسكرية");
    assert.ok(!JSON.stringify(report.facebook).includes("الخارجية_المصرية"));
    assert.equal(report.x.items[0].name, "#الدوري_المصري");
    assert.equal(report.google.items[0].name, "أسعار الذهب");
  } finally {
    await srv.close();
  }
});
