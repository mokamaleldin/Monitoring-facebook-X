/**
 * Idempotent server-side bootstrap for organizations, sources, subscriptions,
 * and the 3 test accounts in Supabase Auth.
 *
 * Required env vars (loaded from environment or .env.local):
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
 *   KASHIDA_TEST_ADMIN_PASSWORD   -> kashida@admin.com (platform_admin)
 *   KASHIDA_TEST_USER1_PASSWORD   -> user1@gmail.com (editor, مزيد)
 *   KASHIDA_TEST_USER2_PASSWORD   -> user2@gmail.com (editor, رصد)
 *
 * Safe to re-run: preserves existing passwords and memberships. Never logs secrets.
 */
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  LEGACY_SOURCE_UUIDS,
  MAZID_ORG_ID,
  RASD_ORG_ID,
  SNAPSHOT_SUBSCRIPTIONS,
  X_YOUM7_SOURCE,
} from "../lib/snapshot.ts";
import { loadLocalEnv } from "./env-loader.mjs";

export const DEFAULT_SOURCES = [
  {
    id: LEGACY_SOURCE_UUIDS.youm7,
    legacyId: "youm7",
    platform: "facebook",
    kind: "page",
    nativeKey: "youm7",
    locator: "facebook:page:youm7",
    name: "اليوم السابع",
  },
  {
    id: LEGACY_SOURCE_UUIDS.mazid,
    legacyId: "mazid",
    platform: "facebook",
    kind: "page",
    nativeKey: "mazidstories",
    locator: "facebook:page:mazidstories",
    name: "مزيد",
  },
  {
    id: LEGACY_SOURCE_UUIDS.rassd,
    legacyId: "rassd",
    platform: "facebook",
    kind: "page",
    nativeKey: "rassdnewsn",
    locator: "facebook:page:rassdnewsn",
    name: "شبكة رصد",
  },
  {
    id: LEGACY_SOURCE_UUIDS["group-783"],
    legacyId: "group-783",
    platform: "facebook",
    kind: "group",
    nativeKey: "783030320118289",
    locator: "facebook:group:783030320118289",
    name: "جروب Facebook 783030320118289",
  },
  {
    id: LEGACY_SOURCE_UUIDS["group-230"],
    legacyId: "group-230",
    platform: "facebook",
    kind: "group",
    nativeKey: "230664764330181",
    locator: "facebook:group:230664764330181",
    name: "جروب Facebook 230664764330181",
  },
  X_YOUM7_SOURCE,
];

export async function bootstrapKashida(options) {
  const {
    supabaseUrl,
    serviceRoleKey,
    adminPassword,
    user1Password,
    user2Password,
  } = options;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  const missingPw = [];
  if (!adminPassword) missingPw.push("KASHIDA_TEST_ADMIN_PASSWORD");
  if (!user1Password) missingPw.push("KASHIDA_TEST_USER1_PASSWORD");
  if (!user2Password) missingPw.push("KASHIDA_TEST_USER2_PASSWORD");
  if (missingPw.length) {
    throw new Error(`Missing required password env vars: ${missingPw.join(", ")}`);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Organizations (idempotent)
  for (const org of [
    { id: MAZID_ORG_ID, name: "مزيد" },
    { id: RASD_ORG_ID, name: "رصد" },
  ]) {
    const { error } = await service.rpc("newsroom_service_upsert_org", {
      p_id: org.id,
      p_name: org.name,
      p_max_sources: 10,
      p_allow_add: true,
      p_feed_days: 7,
    });
    if (error) throw new Error(`Upsert org ${org.name} failed: ${error.message}`);
  }

  // 2) Sources catalog (5 Facebook sources + 1 X source)
  for (const src of DEFAULT_SOURCES) {
    const { error } = await service.rpc("newsroom_service_upsert_source", {
      p_id: src.id,
      p_platform: src.platform,
      p_kind: src.kind,
      p_native_key: src.nativeKey,
      p_locator: src.locator,
      p_name: src.name,
      p_legacy_id: src.legacyId,
    });
    if (error) throw new Error(`Upsert source ${src.locator} failed: ${error.message}`);
  }

  // 3) Subscriptions (6 Facebook subscriptions across 2 orgs = 5 unique sources)
  for (const [orgId, sourceIds] of Object.entries(SNAPSHOT_SUBSCRIPTIONS)) {
    for (const sourceId of sourceIds) {
      const { error } = await service.rpc("newsroom_service_subscribe", {
        p_org: orgId,
        p_source: sourceId,
      });
      if (error) throw new Error(`Subscribe failed: ${error.message}`);
    }
  }

  // 4) Auth users + memberships (idempotent: preserve existing password & membership)
  const existingUsers = new Map();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const list = data?.users ?? [];
    for (const u of list) {
      if (u.email) existingUsers.set(u.email.toLowerCase(), u);
    }
    if (list.length < 200) break;
    page += 1;
  }

  const accounts = [
    {
      email: "kashida@admin.com",
      password: adminPassword,
      role: "platform_admin",
      orgId: null,
    },
    {
      email: "user1@gmail.com",
      password: user1Password,
      role: "editor",
      orgId: MAZID_ORG_ID,
    },
    {
      email: "user2@gmail.com",
      password: user2Password,
      role: "editor",
      orgId: RASD_ORG_ID,
    },
  ];

  const report = [];
  for (const acc of accounts) {
    let user = existingUsers.get(acc.email);
    let authStatus = "existing";
    if (!user) {
      const { data, error } = await service.auth.admin.createUser({
        email: acc.email,
        password: acc.password,
        email_confirm: true,
      });
      if (error || !data?.user?.id) {
        throw new Error(`createUser ${acc.email} failed: ${error?.message}`);
      }
      user = data.user;
      authStatus = "created";
    }

    const { error: memErr } = await service.rpc("newsroom_service_assign_member", {
      p_user: user.id,
      p_org: acc.orgId,
      p_role: acc.role,
      p_ignore_conflict: true,
    });
    if (memErr) {
      throw new Error(`assign member ${acc.email} failed: ${memErr.message}`);
    }

    report.push({
      email: acc.email,
      role: acc.role,
      orgId: acc.orgId,
      authStatus,
      userId: user.id,
    });
  }

  return {
    organizations: 2,
    facebookSources: 5,
    facebookSubscriptions: 6,
    accounts: report,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadLocalEnv();
  const result = await bootstrapKashida({
    supabaseUrl:
      process.env.SUPABASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
      "",
    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.SUPABASE_SECRET_KEY?.trim() ||
      "",
    adminPassword: process.env.KASHIDA_TEST_ADMIN_PASSWORD || "",
    user1Password: process.env.KASHIDA_TEST_USER1_PASSWORD || "",
    user2Password: process.env.KASHIDA_TEST_USER2_PASSWORD || "",
  });
  console.log(JSON.stringify(result, null, 2));
}
