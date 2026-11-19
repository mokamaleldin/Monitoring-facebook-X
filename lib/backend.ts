import { createClient } from "@supabase/supabase-js";
import type { FollowResult, Snapshot, Space } from "./model.ts";

export const mode = process.env.NEXT_PUBLIC_DATA_MODE || "demo";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const client =
  mode === "supabase" && url && key ? createClient(url, key) : null;
export async function workspaces(): Promise<Space[]> {
  if (!client) throw new Error("Database configuration missing");
  const { data, error } = await client.rpc("newsroom_workspaces");
  if (error) throw error;
  return data ?? [];
}
export async function snapshot(org: string): Promise<Snapshot> {
  if (!client) throw new Error("Database configuration missing");
  const { data, error } = await client.rpc("newsroom_snapshot", { p_org: org });
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
