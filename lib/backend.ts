import { createClient } from "@supabase/supabase-js";
import type {
  AdminOverview,
  CollectionRun,
  FeedCursor,
  FeedPage,
  FollowResult,
  Media,
  OrgMeta,
  Platform,
  Snapshot,
  Space,
} from "./model.ts";

export const mode = process.env.NEXT_PUBLIC_DATA_MODE || "supabase";
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const url = rawUrl.replace(/\/$/, "");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";

export const missingSupabaseConfig =
  mode === "supabase" && (!url || !key);

export const client =
  mode === "supabase" && url && key ? createClient(url, key) : null;

const adminApiBase = (
  process.env.NEXT_PUBLIC_ADMIN_API_URL?.trim() ||
  (url ? `${url}/functions/v1/admin-api` : "")
).replace(/\/$/, "");

const collectApiUrl = (
  process.env.NEXT_PUBLIC_COLLECT_API_URL?.trim() ||
  (url ? `${url}/functions/v1/collect-facebook` : "")
).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number,
    code = "api_error",
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function getAccessToken(): Promise<string> {
  if (!client) throw new ApiError("إعداد اتصال المنصة غير مكتمل.", 500, "config_missing");
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ApiError("انتهت الجلسة. يرجى تسجيل الدخول مجددًا.", 401, "unauthenticated");
  }
  return data.session.access_token;
}

async function callServerJson<T>(
  endpoint: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!endpoint) {
    throw new ApiError("عنوان خدمة الإدارة غير مضبوط.", 500, "config_missing");
  }
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (key) headers.apikey = key;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(endpoint, {
    method: init.method || "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const obj =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const msg =
      typeof obj.error === "string"
        ? obj.error
        : typeof obj.message === "string"
          ? obj.message
          : `فشل الطلب (${response.status})`;
    const code = typeof obj.code === "string" ? obj.code : "api_error";
    throw new ApiError(msg, response.status, code, obj);
  }

  return payload as T;
}

export async function workspaces(): Promise<Space[]> {
  if (!client) throw new Error("Database configuration missing");
  const { data, error } = await client.rpc("newsroom_workspaces");
  if (error) throw error;
  return data ?? [];
}

export async function orgMeta(org: string): Promise<OrgMeta> {
  if (!client) throw new Error("Database configuration missing");
  const { data, error } = await client.rpc("newsroom_org_meta", { p_org: org });
  if (error) throw error;
  return data;
}

export async function snapshot(org: string): Promise<Snapshot> {
  if (!client) throw new Error("Database configuration missing");
  const { data, error } = await client.rpc("newsroom_snapshot", { p_org: org });
  if (error) throw error;
  return data;
}

export type FeedQuery = {
  org: string;
  platform: Platform;
  media: Media | "all";
  sourceId: string;
  query: string;
  cursor?: FeedCursor | null;
  limit?: number;
};

export async function feed(params: FeedQuery): Promise<FeedPage> {
  if (!client) throw new Error("Database configuration missing");
  const { data, error } = await client.rpc("newsroom_feed", {
    p_org: params.org,
    p_platform: params.platform,
    p_media: params.media,
    p_source: params.sourceId || null,
    p_query: params.query || "",
    p_cursor_seen: params.cursor?.seenAt ?? null,
    p_cursor_id: params.cursor?.id ?? null,
    p_limit: params.limit ?? 8,
  });
  if (error) throw error;
  return data;
}

export async function follow(
  org: string,
  locator: string,
): Promise<FollowResult> {
  if (!client) throw new Error("Database configuration missing");
  const { data, error } = await client.rpc("newsroom_follow", {
    p_org: org,
    p_locator: locator,
  });
  if (error) throw error;
  return data;
}

export async function pause(org: string, source: string): Promise<void> {
  if (!client) throw new Error("Database configuration missing");
  const { error } = await client.rpc("newsroom_pause", {
    p_org: org,
    p_source: source,
  });
  if (error) throw error;
}

export async function cancelRequest(
  org: string,
  locator: string,
): Promise<void> {
  if (!client) throw new Error("Database configuration missing");
  const { error } = await client.rpc("newsroom_cancel_request", {
    p_org: org,
    p_locator: locator,
  });
  if (error) throw error;
}

export async function adminOverview(): Promise<AdminOverview> {
  return callServerJson<AdminOverview>(`${adminApiBase}/overview`);
}

export async function adminCreateOrg(input: {
  name: string;
  maxSources: number;
  allowAdd: boolean;
  feedDays: number;
}) {
  return callServerJson<{
    id: string;
    name: string;
    maxSources: number;
    allowAdd: boolean;
    feedDays: number;
  }>(`${adminApiBase}/orgs`, { method: "POST", body: input });
}

export async function adminUpdateOrg(
  orgId: string,
  input: {
    name?: string;
    maxSources?: number;
    allowAdd?: boolean;
    feedDays?: number;
  },
) {
  return callServerJson<{
    id: string;
    name: string;
    maxSources: number;
    allowAdd: boolean;
    feedDays: number;
  }>(`${adminApiBase}/orgs/${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    body: input,
  });
}

export type CreateEditorResponse = {
  status: "created" | "recovered";
  userId: string;
  email: string;
  orgId: string;
};

export async function adminCreateEditor(input: {
  email: string;
  password: string;
  orgId: string;
}): Promise<CreateEditorResponse> {
  return callServerJson<CreateEditorResponse>(`${adminApiBase}/editors`, {
    method: "POST",
    body: input,
  });
}

export async function adminAddSources(
  orgId: string,
  lines: string[],
): Promise<{ rows: { url: string; status: string }[] }> {
  return callServerJson<{ rows: { url: string; status: string }[] }>(
    `${adminApiBase}/orgs/${encodeURIComponent(orgId)}/sources`,
    { method: "POST", body: { lines } },
  );
}

export async function adminToggleSource(
  orgId: string,
  sourceId: string,
  locator: string,
  active: boolean,
): Promise<{ message: string }> {
  return callServerJson<{ message: string }>(
    `${adminApiBase}/orgs/${encodeURIComponent(orgId)}/sources/toggle`,
    { method: "POST", body: { sourceId, locator, active } },
  );
}

export async function adminCancelRequest(
  orgId: string,
  locator: string,
): Promise<{ message: string }> {
  return callServerJson<{ message: string }>(
    `${adminApiBase}/orgs/${encodeURIComponent(orgId)}/requests/cancel`,
    { method: "POST", body: { locator } },
  );
}

export async function adminApproveRequest(
  orgId: string,
  locator: string,
  name: string,
): Promise<{ sourceId: string; locator: string; name: string }> {
  return callServerJson<{ sourceId: string; locator: string; name: string }>(
    `${adminApiBase}/orgs/${encodeURIComponent(orgId)}/requests/approve`,
    { method: "POST", body: { locator, name } },
  );
}

export async function adminSetReference(
  referenceAt: string | null,
  label: string | null,
): Promise<{ referenceAt: string | null; referenceLabel: string | null }> {
  return callServerJson<{
    referenceAt: string | null;
    referenceLabel: string | null;
  }>(`${adminApiBase}/reference-date`, {
    method: "POST",
    body: { referenceAt, label },
  });
}

export async function adminCollectFacebook(input: {
  runKey: string;
  maxRequests?: number;
  maxCredits?: number;
}): Promise<{ replayed: boolean; run: CollectionRun }> {
  return callServerJson<{ replayed: boolean; run: CollectionRun }>(
    collectApiUrl,
    { method: "POST", body: input },
  );
}
