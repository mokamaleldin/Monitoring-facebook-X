// Supabase Edge Function: trends-api
// Returns tenant-scoped Facebook NLP topics/hashtags + live Egypt X & Google trends.
// Zero SocialAPIs credits consumed. Enforces caller's JWT & PostgreSQL RLS via newsroom_snapshot.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildTenantTrendsReport } from "../../../server/trends-service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";
  if (!supabaseUrl || !anonKey) {
    return json(500, { error: "إعداد الخادم غير مكتمل." });
  }

  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return json(401, { error: "يرجى تسجيل الدخول أولًا." });
  }

  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") || "";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const asUser = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${match[1].trim()}` } },
  });

  const { data: snap, error } = await asUser.rpc("newsroom_snapshot", {
    p_org: orgId,
  });
  if (error) {
    return json(error.code === "42501" ? 403 : 400, { error: error.message });
  }

  const report = await buildTenantTrendsReport({
    posts: Array.isArray(snap?.posts) ? snap.posts : [],
    referenceAt: snap?.referenceAt ?? null,
    referenceLabel: snap?.referenceLabel ?? null,
    forceRefresh,
  });

  return json(200, report);
});
