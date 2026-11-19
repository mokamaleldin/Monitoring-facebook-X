/**
 * Idempotent importer for the private facebook-snapshot.json test input.
 * Keeps original published_at and collected_at timestamps intact (no relative shifting).
 * Never commits or bundles snapshot contents into client files.
 *
 * Usage:
 *   node scripts/import-snapshot.mjs [--file path/to/facebook-snapshot.json] [--set-reference-date | --live-reference]
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  MAZID_ORG_ID,
  parseSnapshotPayload,
  RASD_ORG_ID,
  SNAPSHOT_SUBSCRIPTIONS,
  X_YOUM7_SOURCE,
} from "../lib/snapshot.ts";
import { loadLocalEnv } from "./env-loader.mjs";

export async function importSnapshotToSupabase(options) {
  const {
    supabaseUrl,
    serviceRoleKey,
    snapshotPath,
    setReferenceDate = false,
    clearReferenceDate = false,
  } = options;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const rawText = await readFile(snapshotPath, "utf8");
  const parsed = parseSnapshotPayload(JSON.parse(rawText));

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Ensure orgs exist
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
    if (error) throw new Error(`Upsert org failed: ${error.message}`);
  }

  // 2) Upsert the 5 snapshot sources + X catalog source
  const sourceIdMap = new Map();
  for (const src of parsed.sources) {
    const { data, error } = await service.rpc("newsroom_service_upsert_source", {
      p_id: src.id,
      p_platform: src.platform,
      p_kind: src.kind,
      p_native_key: src.nativeKey,
      p_locator: src.locator,
      p_name: src.name,
      p_legacy_id: src.legacyId,
    });
    if (error) throw new Error(`Upsert source ${src.legacyId} failed: ${error.message}`);
    sourceIdMap.set(src.legacyId, String(data));
  }
  await service.rpc("newsroom_service_upsert_source", {
    p_id: X_YOUM7_SOURCE.id,
    p_platform: X_YOUM7_SOURCE.platform,
    p_kind: X_YOUM7_SOURCE.kind,
    p_native_key: X_YOUM7_SOURCE.nativeKey,
    p_locator: X_YOUM7_SOURCE.locator,
    p_name: X_YOUM7_SOURCE.name,
    p_legacy_id: X_YOUM7_SOURCE.legacyId,
  });

  // 3) Ensure the 6 tenant subscriptions exist
  for (const [orgId, srcIds] of Object.entries(SNAPSHOT_SUBSCRIPTIONS)) {
    for (const srcId of srcIds) {
      const { error } = await service.rpc("newsroom_service_subscribe", {
        p_org: orgId,
        p_source: srcId,
      });
      if (error) throw new Error(`Subscribe failed: ${error.message}`);
    }
  }

  // 4) Idempotently upsert all posts & appearances (preserves first seen_at)
  let inserted = 0;
  let updated = 0;
  const mediaCounts = { text: 0, photo: 0, video: 0 };

  for (const post of parsed.posts) {
    const resolvedSourceId = sourceIdMap.get(post.legacySourceId) || post.sourceId;
    const { data, error } = await service.rpc("newsroom_service_upsert_post", {
      p_platform: post.platform,
      p_native_key: post.nativeKey,
      p_source_id: resolvedSourceId,
      p_body: post.text,
      p_media: post.media,
      p_raw_media_type: post.rawMediaType,
      p_media_url: post.mediaUrl,
      p_media_items: post.mediaItems,
      p_original_url: post.originalUrl,
      p_published_at: post.publishedAt,
      p_seen_at: post.seenAt,
      p_engagement: post.engagement,
      p_shared_post: post.sharedPost,
      p_time_origin: post.timeOrigin,
      p_time_semantics_verified: post.timeSemanticsVerified,
    });
    if (error) throw new Error(`Upsert post ${post.nativeKey} failed: ${error.message}`);
    if (data?.inserted) inserted += 1;
    else updated += 1;
    mediaCounts[post.media] = (mediaCounts[post.media] || 0) + 1;
  }

  // 5) Optional reference date setting (keeps original 6 Nov timestamps intact)
  let referenceMeta = null;
  if (clearReferenceDate) {
    const { data, error } = await service.rpc("newsroom_service_set_reference", {
      p_reference_at: null,
      p_label: null,
    });
    if (error) throw new Error(`Clear reference date failed: ${error.message}`);
    referenceMeta = data;
  } else if (setReferenceDate && parsed.referenceAt) {
    const { data, error } = await service.rpc("newsroom_service_set_reference", {
      p_reference_at: parsed.referenceAt,
      p_label: `لقطة ${parsed.collectedOnUtc}`,
    });
    if (error) throw new Error(`Set reference date failed: ${error.message}`);
    referenceMeta = data;
  }

  return {
    collectedOnUtc: parsed.collectedOnUtc,
    sourcesImported: parsed.sources.length,
    postsProcessed: parsed.posts.length,
    inserted,
    updated,
    mediaCounts,
    referenceMeta,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadLocalEnv();
  const args = process.argv.slice(2);
  let fileArg = "";
  let setReferenceDate = false;
  let clearReferenceDate = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--file" && args[i + 1]) {
      fileArg = args[i + 1];
      i += 1;
    } else if (args[i] === "--set-reference-date") {
      setReferenceDate = true;
    } else if (args[i] === "--live-reference") {
      clearReferenceDate = true;
    }
  }
  const snapshotPath = resolve(
    process.cwd(),
    fileArg ||
      process.env.KASHIDA_SNAPSHOT_PATH ||
      "docs/context/handoff/facebook-snapshot.json",
  );
  const report = await importSnapshotToSupabase({
    supabaseUrl:
      process.env.SUPABASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
      "",
    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.SUPABASE_SECRET_KEY?.trim() ||
      "",
    snapshotPath,
    setReferenceDate,
    clearReferenceDate,
  });
  console.log(JSON.stringify(report, null, 2));
}
