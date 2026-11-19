// Supabase Edge Function: admin-api
// Deploy with: supabase functions deploy admin-api --no-verify-jwt
// Verifies the caller's Supabase Auth JWT and platform_admin membership on every request.
// Required server secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided automatically by Supabase).
// Optional: SUPABASE_ANON_KEY (for user-scoped RPC calls), SOCIALAPIS_API_KEY (for status check).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const reservedFacebook = new Set([
  "profile.php", "pages", "groups", "home.php", "watch", "reel", "login",
  "events", "marketplace", "share", "photo", "photo.php", "permalink.php",
  "story.php", "facebook", "help", "me", "gaming",
]);
const reservedX = new Set([
  "home", "search", "explore", "i", "settings", "messages", "notifications",
  "intent", "share", "compose", "login", "logout", "hashtag",
]);
const resultText: Record<string, string> = {
  added: "بدأت المتابعة",
  already: "متابَع بالفعل",
  pending: "قيد التحقق بالفعل",
  queued: "أُرسل للتحقق من المصدر العام",
  limit: "اكتمل عدد المصادر المتاحة للجهة",
  disabled: "إضافة المصادر موقوفة لهذه الجهة",
};

function parseSource(raw: string): string | null {
  try {
    const value = raw.trim();
    if (!value || value.length > 500 || /[\\\s]/u.test(value)) return null;
    const url = new URL(/^[a-z]+:/i.test(value) ? value : "https://" + value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/$/, "").toLowerCase();
    if (host === "facebook.com" || host === "m.facebook.com") {
      const group = path.match(/^\/groups\/([0-9]{1,32})$/);
      if (group) return "facebook:group:" + group[1];
      const page = path.match(/^\/([a-z0-9.]{2,75})$/);
      if (page && !reservedFacebook.has(page[1])) return "facebook:page:" + page[1];
    }
    if (host === "twitter.com" || host === "x.com") {
      const account = path.match(/^\/([a-z0-9_]{1,15})$/);
      if (account && !reservedX.has(account[1])) return "x:account:" + account[1];
    }
  } catch {
    return null;
  }
  return null;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceKey;
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "إعداد الخادم غير مكتمل.", code: "config_missing" });
  }

  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return json(401, { error: "يرجى تسجيل الدخول أولًا.", code: "unauthenticated" });
  const jwt = match[1].trim();

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await service.auth.getUser(jwt);
  if (userErr || !userData?.user?.id) {
    return json(401, { error: "جلسة الدخول غير صالحة أو منتهية.", code: "unauthenticated" });
  }
  const { data: isAdmin } = await service.rpc("newsroom_service_is_admin", {
    p_user: userData.user.id,
  });
  if (!isAdmin) {
    return json(403, { error: "هذا الإجراء مخصص لأدمن كشيدة فقط.", code: "forbidden" });
  }

  const asAdmin = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const url = new URL(req.url);
  let path = url.pathname;
  const marker = "/admin-api";
  const idx = path.indexOf(marker);
  if (idx >= 0) path = path.slice(idx + marker.length);
  path = path.replace(/\/+$/, "") || "/";

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? {}
      : await req.json().catch(() => ({}));

  if (req.method === "GET" && (path === "/overview" || path === "/")) {
    const [ov, orphans] = await Promise.all([
      asAdmin.rpc("newsroom_admin_overview"),
      service.rpc("newsroom_service_orphan_users"),
    ]);
    if (ov.error) return json(403, { error: ov.error.message });
    return json(200, {
      ...(ov.data as Record<string, unknown>),
      orphanUsers: orphans.data ?? [],
      collectorConfigured: Boolean((Deno.env.get("SOCIALAPIS_API_KEY") || "").trim()),
    });
  }

  if (req.method === "POST" && path === "/orgs") {
    const { data, error } = await asAdmin.rpc("newsroom_admin_create_org", {
      p_name: String(body.name ?? "").trim(),
      p_max_sources: Number(body.maxSources ?? 10),
      p_allow_add: typeof body.allowAdd === "boolean" ? body.allowAdd : true,
      p_feed_days: Number(body.feedDays ?? 7),
    });
    if (error) return json(400, { error: error.message });
    return json(201, data);
  }

  const patchOrg = path.match(/^\/orgs\/([^/]+)$/);
  if (req.method === "PATCH" && patchOrg) {
    const orgId = decodeURIComponent(patchOrg[1]);
    if (!UUID_RE.test(orgId)) return json(400, { error: "معرّف الجهة غير صالح." });
    const { data, error } = await asAdmin.rpc("newsroom_admin_update_org", {
      p_org: orgId,
      p_name: body.name !== undefined ? String(body.name).trim() : null,
      p_max_sources: body.maxSources !== undefined ? Number(body.maxSources) : null,
      p_allow_add: body.allowAdd !== undefined ? Boolean(body.allowAdd) : null,
      p_feed_days: body.feedDays !== undefined ? Number(body.feedDays) : null,
    });
    if (error) return json(400, { error: error.message });
    return json(200, data);
  }

  if (req.method === "POST" && path === "/editors") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const orgId = String(body.orgId ?? "").trim();
    if (!EMAIL_RE.test(email)) return json(400, { error: "البريد الإلكتروني غير صالح." });
    if (!UUID_RE.test(orgId)) return json(400, { error: "اختر جهة صالحة." });
    const { data: orgExists } = await service.rpc("newsroom_service_org_exists", { p_org: orgId });
    if (!orgExists) return json(404, { error: "الجهة غير موجودة." });

    const { data: listData } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = (listData?.users ?? []).find((u) => (u.email || "").toLowerCase() === email);
    if (existing) {
      const { data: member } = await service.rpc("newsroom_service_get_membership", { p_user: existing.id });
      if (member) return json(409, { error: "هذا البريد مسجل بالفعل ومرتبط بعضوية.", code: "already_member" });
      const { error: assignErr } = await service.rpc("newsroom_service_assign_member", {
        p_user: existing.id, p_org: orgId, p_role: "editor", p_ignore_conflict: false,
      });
      if (assignErr) return json(500, { error: assignErr.message, code: "membership_pending" });
      return json(200, { status: "recovered", userId: existing.id, email: existing.email, orgId });
    }

    if (password.length < 8) return json(400, { error: "كلمة السر يجب أن لا تقل عن ٨ أحرف." });
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr || !created?.user?.id) {
      return json(400, { error: createErr?.message || "تعذّر إنشاء الحساب." });
    }
    const { error: memErr } = await service.rpc("newsroom_service_assign_member", {
      p_user: created.user.id, p_org: orgId, p_role: "editor", p_ignore_conflict: false,
    });
    if (memErr) {
      return json(500, {
        error: "تم إنشاء حساب الدخول لكن تعذّر ربط العضوية. أعد المحاولة لاستكمال الربط بأمان.",
        code: "membership_pending", userId: created.user.id, email, orgId,
      });
    }
    return json(201, { status: "created", userId: created.user.id, email, orgId });
  }

  const addSrc = path.match(/^\/orgs\/([^/]+)\/sources$/);
  if (req.method === "POST" && addSrc) {
    const orgId = decodeURIComponent(addSrc[1]);
    const lines: unknown[] = Array.isArray(body.lines) ? body.lines : [];
    const rows: { url: string; status: string }[] = [];
    for (const raw of lines.slice(0, 100)) {
      const line = String(raw ?? "").trim();
      if (!line) continue;
      const loc = parseSource(line);
      if (!loc) { rows.push({ url: line, status: "رابط غير مدعوم" }); continue; }
      const { data, error } = await asAdmin.rpc("newsroom_follow", { p_org: orgId, p_locator: loc });
      rows.push({ url: line, status: error ? error.message : (resultText[String(data)] || String(data)) });
    }
    return json(200, { rows });
  }

  const toggleSrc = path.match(/^\/orgs\/([^/]+)\/sources\/toggle$/);
  if (req.method === "POST" && toggleSrc) {
    const orgId = decodeURIComponent(toggleSrc[1]);
    if (body.active) {
      const { error } = await asAdmin.rpc("newsroom_pause", { p_org: orgId, p_source: body.sourceId });
      if (error) return json(400, { error: error.message });
      return json(200, { message: "أُوقفت المتابعة لهذه الجهة" });
    }
    const { data, error } = await asAdmin.rpc("newsroom_follow", { p_org: orgId, p_locator: body.locator });
    if (error) return json(400, { error: error.message });
    return json(200, { message: resultText[String(data)] || String(data) });
  }

  const cancelReq = path.match(/^\/orgs\/([^/]+)\/requests\/cancel$/);
  if (req.method === "POST" && cancelReq) {
    const orgId = decodeURIComponent(cancelReq[1]);
    const { error } = await asAdmin.rpc("newsroom_cancel_request", { p_org: orgId, p_locator: body.locator });
    if (error) return json(400, { error: error.message });
    return json(200, { message: "تم إلغاء الطلب" });
  }

  const approveReq = path.match(/^\/orgs\/([^/]+)\/requests\/approve$/);
  if (req.method === "POST" && approveReq) {
    const orgId = decodeURIComponent(approveReq[1]);
    const { data, error } = await asAdmin.rpc("newsroom_admin_resolve_request", {
      p_org: orgId, p_locator: body.locator, p_name: body.name, p_native_key: null,
    });
    if (error) return json(400, { error: error.message });
    return json(200, data);
  }

  const renameSrc = path.match(/^\/sources\/([^/]+)$/);
  if (req.method === "PATCH" && renameSrc) {
    const sourceId = decodeURIComponent(renameSrc[1]);
    if (!UUID_RE.test(sourceId)) return json(400, { error: "معرّف المصدر غير صالح." });
    const { data, error } = await asAdmin.rpc("newsroom_admin_rename_source", {
      p_source: sourceId, p_name: String(body.name ?? "").trim(),
    });
    if (error) return json(400, { error: error.message });
    return json(200, data);
  }

  if (req.method === "POST" && path === "/reference-date") {
    const { data, error } = await asAdmin.rpc("newsroom_admin_set_reference", {
      p_reference_at: body.referenceAt || null, p_label: body.label || null,
    });
    if (error) return json(400, { error: error.message });
    return json(200, data);
  }

  return json(404, { error: "المسار غير موجود." });
});
