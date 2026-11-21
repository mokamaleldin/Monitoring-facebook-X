// Supabase Edge Function: collect-facebook
// Bounded, manual, single-cycle Facebook collector (max 5 requests, max 5 credits, limit=3, 1 page).
// Verifies platform_admin JWT. Never retries automatically. Requires server secret SOCIALAPIS_API_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function sourceUrl(locator: string): string {
  const [platform, kind, key] = locator.split(":");
  if (platform === "x") return "https://x.com/" + key;
  return "https://www.facebook.com/" + (kind === "group" ? "groups/" : "") + key;
}

function safeUrl(value: unknown, media = false): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const roots = media ? ["fbcdn.net", "fbsbx.com"] : ["facebook.com", "fb.watch"];
    if (roots.some((r) => host === r || host.endsWith("." + r))) return u.href;
  } catch { /* ignore */ }
  return null;
}

function nullableInt(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const n = Number(String(v).replaceAll(",", "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function extractMedia(post: Record<string, unknown>) {
  const found: { type: "photo" | "video"; url: string }[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, key = "", depth = 0) => {
    if (depth > 12 || found.length >= 20 || node == null) return;
    if (Array.isArray(node)) { for (const x of node.slice(0, 50)) walk(x, key, depth + 1); return; }
    if (typeof node === "object") { for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k, depth + 1); return; }
    if (typeof node === "string") {
      if (node.startsWith("{")) { try { walk(JSON.parse(node), key, depth + 1); } catch { /* ignore */ } }
      const u = safeUrl(node, true);
      if (u && !seen.has(u)) {
        seen.add(u);
        const lk = key.toLowerCase();
        const isVid = ["video", "playable", "browser_native", "hd_src", "sd_src"].some((t) => lk.includes(t)) || new URL(u).pathname.toLowerCase().includes(".mp4");
        found.push({ type: isVid ? "video" : "photo", url: u });
      }
    }
  };
  walk(post.attachments);
  const values = (post.values && typeof post.values === "object" ? post.values : {}) as Record<string, unknown>;
  walk(values.photo_image, "photo_image");
  for (const k of ["video_url", "playable_url", "video_hd_url", "video_sd_url"]) walk(values[k], k);
  return found.slice(0, 20);
}

async function fetchJsonBounded(url: string, token: string) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "x-api-token": token, "User-Agent": "Kashida-Monitor/1.0" },
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) return { ok: false as const, status: res.status, data: null, headers: res.headers };
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 5_000_000) throw new Error("Response exceeds 5 MB limit");
  const data = JSON.parse(new TextDecoder().decode(buf));
  return { ok: true as const, status: res.status, data, headers: res.headers };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const socialKey = (Deno.env.get("SOCIALAPIS_API_KEY") || "").trim();
  if (!supabaseUrl || !serviceKey) return json(500, { error: "إعداد الخادم غير مكتمل." });

  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return json(401, { error: "يرجى تسجيل الدخول أولًا." });

  const service = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userErr } = await service.auth.getUser(match[1].trim());
  if (userErr || !userData?.user?.id) return json(401, { error: "جلسة غير صالحة." });
  const { data: isAdmin } = await service.rpc("newsroom_service_is_admin", { p_user: userData.user.id });
  if (!isAdmin) return json(403, { error: "هذا الإجراء مخصص لأدمن كشيدة فقط." });

  if (!socialKey) {
    return json(400, {
      error: "مفتاح SOCIALAPIS_API_KEY غير مضبوط على الخادم.",
      code: "socialapis_key_missing",
    });
  }

  const body = await req.json().catch(() => ({}));
  const runKey = typeof body.runKey === "string" && body.runKey.trim()
    ? body.runKey.trim()
    : `manual-${new Date().toISOString().slice(0, 16)}`;
  const requestCap = Math.max(1, Math.min(Number(body.maxRequests ?? 5) || 5, 5));
  const creditCap = Math.max(1, Math.min(Number(body.maxCredits ?? 5) || 5, 5));

  const { data: existing } = await service.rpc("newsroom_service_get_run", { p_run_key: runKey });
  if (existing) return json(200, { replayed: true, run: existing });

  const { data: claim } = await service.rpc("newsroom_service_claim_run", {
    p_run_key: runKey, p_triggered_by: userData.user.id, p_request_cap: requestCap, p_credit_cap: creditCap,
  });
  if (!claim?.claimed || !claim?.runId) {
    const { data: saved } = await service.rpc("newsroom_service_get_run", { p_run_key: runKey });
    return json(200, { replayed: true, run: saved });
  }

  const runId = claim.runId as string;
  const sinceMs = Date.now() - 60 * 60_000;
  const afterDate = new Date(sinceMs).toISOString().slice(0, 10);
  let requestsMade = 0, usageChecks = 0, creditsCharged = 0, insertedCount = 0, updatedCount = 0;
  let creditsUncertain = false, creditsRemaining: number | null = null;
  let usageBefore: Record<string, number | null> | null = null;
  let usageAfter: Record<string, number | null> | null = null;
  let accountUsageDelta: number | null = null;
  let stopReason: string | null = null;
  let status = "completed";

  try {
    usageChecks += 1;
    const u = await fetchJsonBounded("https://api.socialapis.io/usage", socialKey);
    if (!u.ok) {
      stopReason = `توقف قبل السحب بسبب استجابة /usage (${u.status}).`;
      status = "stopped";
    } else {
      const b = u.data?.data ?? u.data ?? {};
      usageBefore = {
        creditsUsed: nullableInt(b.creditsUsed),
        creditsRemaining: nullableInt(b.creditsRemaining),
        creditsLimit: nullableInt(b.creditsLimit),
      };
      creditsRemaining = usageBefore.creditsRemaining;
      if (creditsRemaining !== null && creditsRemaining < 1) {
        stopReason = "الرصيد المجاني المتبقي غير كافٍ.";
        status = "stopped";
      }
    }
  } catch (e) {
    stopReason = `تعذّر فحص /usage: ${e instanceof Error ? e.message : "error"}`;
    status = "failed";
  }

  if (!stopReason) {
    const { data: sources } = await service.rpc("newsroom_service_list_active_fb_sources");
    for (const s of (sources ?? []) as { id: string; name: string; kind: "page" | "group"; locator: string }[]) {
      if (requestsMade >= requestCap || creditsCharged + 1 > creditCap) {
        stopReason = `بلغت الدورة السقف (${requestCap} طلبات / ${creditCap} Credits).`;
        status = "stopped";
        break;
      }
      const endpoint = s.kind === "page" ? "/facebook/pages/posts" : "/facebook/groups/posts";
      const { data: claimed } = await service.rpc("newsroom_service_claim_run_item", {
        p_run_id: runId, p_source_id: s.id, p_source_name: s.name, p_source_kind: s.kind, p_endpoint: endpoint,
      });
      if (!claimed) continue;

      const t0 = Date.now();
      requestsMade += 1;
      try {
        const qs = new URLSearchParams({ link: sourceUrl(s.locator), limit: "3", after_time: afterDate, timezone: "UTC" });
        const r = await fetchJsonBounded(`https://api.socialapis.io${endpoint}?${qs}`, socialKey);
        if (!r.ok) {
          const knownFree = r.status >= 400 && r.status < 500;
          if (!knownFree) creditsUncertain = true;
          await service.rpc("newsroom_service_update_run_item", {
            p_run_id: runId, p_source_id: s.id, p_status: knownFree ? "error" : "uncertain",
            p_http_status: r.status, p_returned_count: 0, p_inserted_count: 0, p_updated_count: 0,
            p_empty_response: false, p_old_posts_count: 0, p_missing_time_count: 0, p_invalid_count: 0,
            p_credits_charged: knownFree ? 0 : null, p_credits_uncertain: !knownFree, p_has_next: false,
            p_error_message: `HTTP ${r.status}`, p_elapsed_ms: Date.now() - t0, p_details: { afterDate },
          });
          if ([401, 403, 429].includes(r.status) || !knownFree) {
            stopReason = `توقفت الدورة بدون إعادة محاولة (HTTP ${r.status}).`;
            status = "stopped";
            break;
          }
          continue;
        }
        const meta = r.data?.meta ?? {};
        const deducted = nullableInt(meta.creditsCharged) ?? nullableInt(r.headers.get("x-socialapis-credits-deducted"));
        const rem = nullableInt(meta.creditsRemaining) ?? nullableInt(r.headers.get("x-socialapis-credits-remaining"));
        const itemUncertain = deducted === null;
        creditsCharged += deducted ?? 1;
        if (rem !== null) creditsRemaining = rem;
        if (itemUncertain) creditsUncertain = true;

        const posts: unknown[] = Array.isArray(r.data?.data?.posts) ? r.data.data.posts.slice(0, 3) : [];
        let ins = 0, upd = 0, old = 0, missing = 0, inv = 0;
        const collectedAt = new Date().toISOString();
        for (const rawPost of posts) {
          const p = (rawPost ?? {}) as Record<string, unknown>;
          const d = (p.details ?? {}) as Record<string, unknown>;
          const v = (p.values ?? {}) as Record<string, unknown>;
          const rx = (p.reactions ?? {}) as Record<string, unknown>;
          const pid = d.post_id ?? v.post_id;
          const link = safeUrl(d.post_link, false);
          if (!pid || !link) { inv += 1; continue; }
          const items = extractMedia(p);
          const decl = String(v.is_media ?? "").toLowerCase();
          const rawType = items.some((m) => m.type === "video") || decl.includes("video") || decl.includes("reel") ? "video"
            : items.length > 0 || decl.includes("photo") || decl.includes("image") ? "photo" : "text";
          const media = rawType === "video" ? "video" : rawType === "photo" ? "photo" : "text";
          const pub = typeof v.publish_time === "string" && !Number.isNaN(Date.parse(v.publish_time)) ? new Date(v.publish_time).toISOString() : null;
          if (!pub) missing += 1; else if (Date.parse(pub) < sinceMs) old += 1;
          const { data: up } = await service.rpc("newsroom_service_upsert_post", {
            p_platform: "facebook", p_native_key: String(pid), p_source_id: s.id,
            p_body: typeof v.text === "string" ? v.text : "", p_media: media, p_raw_media_type: rawType,
            p_media_url: items.find((m) => m.type === media)?.url ?? null, p_media_items: items,
            p_original_url: link, p_published_at: pub, p_seen_at: collectedAt,
            p_engagement: {
              reactions: nullableInt(rx.total_reaction_count), comments: nullableInt(d.comments_count),
              shares: nullableInt(d.share_count), views: nullableInt(d.play_count),
            },
            p_shared_post: Boolean(v.shared_post), p_time_origin: "provider.values.publish_time", p_time_semantics_verified: false,
          });
          if (up?.inserted) ins += 1; else upd += 1;
        }
        insertedCount += ins; updatedCount += upd;
        await service.rpc("newsroom_service_update_run_item", {
          p_run_id: runId, p_source_id: s.id, p_status: "ok", p_http_status: r.status,
          p_returned_count: posts.length, p_inserted_count: ins, p_updated_count: upd,
          p_empty_response: posts.length === 0, p_old_posts_count: old, p_missing_time_count: missing,
          p_invalid_count: inv, p_credits_charged: deducted, p_credits_uncertain: itemUncertain,
          p_has_next: Boolean(r.data?.data?.page_info?.has_next), p_error_message: null,
          p_elapsed_ms: Date.now() - t0, p_details: { afterDate },
        });
        if (itemUncertain) { stopReason = "الخصم غير مؤكد في الرد؛ توقفت الدورة."; status = "stopped"; break; }
      } catch (e) {
        creditsUncertain = true;
        await service.rpc("newsroom_service_update_run_item", {
          p_run_id: runId, p_source_id: s.id, p_status: "uncertain", p_http_status: null,
          p_returned_count: 0, p_inserted_count: 0, p_updated_count: 0, p_empty_response: false,
          p_old_posts_count: 0, p_missing_time_count: 0, p_invalid_count: 0,
          p_credits_charged: null, p_credits_uncertain: true, p_has_next: false,
          p_error_message: e instanceof Error ? e.message : "Network error",
          p_elapsed_ms: Date.now() - t0, p_details: { afterDate },
        });
        stopReason = "نتيجة المحاولة غير مؤكدة بعد الإرسال؛ توقفت الدورة دون إعادة محاولة.";
        status = "stopped";
        break;
      }
    }
  }

  if (usageBefore) {
    try {
      usageChecks += 1;
      const u = await fetchJsonBounded("https://api.socialapis.io/usage", socialKey);
      if (u.ok) {
        const b = u.data?.data ?? u.data ?? {};
        usageAfter = {
          creditsUsed: nullableInt(b.creditsUsed),
          creditsRemaining: nullableInt(b.creditsRemaining),
          creditsLimit: nullableInt(b.creditsLimit),
        };
        if (usageAfter.creditsRemaining !== null) creditsRemaining = usageAfter.creditsRemaining;
        if (usageBefore.creditsUsed !== null && usageAfter.creditsUsed !== null) {
          accountUsageDelta = usageAfter.creditsUsed - usageBefore.creditsUsed;
        }
      }
    } catch { creditsUncertain = true; }
  }

  await service.rpc("newsroom_service_finish_run", {
    p_run_id: runId, p_status: status, p_requests_made: requestsMade, p_usage_checks: usageChecks,
    p_credits_charged: creditsCharged, p_credits_uncertain: creditsUncertain,
    p_credits_remaining: creditsRemaining, p_usage_before: usageBefore, p_usage_after: usageAfter,
    p_account_usage_delta: accountUsageDelta, p_inserted_count: insertedCount,
    p_updated_count: updatedCount, p_stop_reason: stopReason,
  });

  const { data: run } = await service.rpc("newsroom_service_get_run", { p_run_key: runKey });
  return json(200, { replayed: false, run });
});
