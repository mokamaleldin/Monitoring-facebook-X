import type { CollectionRun, CollectionRunItem } from "../lib/model.ts";
import type { ActiveFacebookSource, CollectorStore } from "./collector.ts";
import type { NormalizedProviderPost, ProviderUsage } from "./socialapis.ts";

export interface SqlRunner {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

function mapRunRow(
  r: Record<string, unknown>,
  items: CollectionRunItem[],
): CollectionRun {
  return {
    id: String(r.id),
    runKey: String(r.run_key),
    platform: (r.platform === "x" ? "x" : "facebook") as CollectionRun["platform"],
    status: r.status as CollectionRun["status"],
    requestCap: Number(r.request_cap),
    creditCap: Number(r.credit_cap),
    requestsMade: Number(r.requests_made),
    usageChecks: Number(r.usage_checks),
    creditsCharged: Number(r.credits_charged),
    creditsUncertain: Boolean(r.credits_uncertain),
    creditsRemaining:
      r.credits_remaining === null || r.credits_remaining === undefined
        ? null
        : Number(r.credits_remaining),
    usageBefore: (r.usage_before as Record<string, unknown> | null) ?? null,
    usageAfter: (r.usage_after as Record<string, unknown> | null) ?? null,
    accountUsageDelta:
      r.account_usage_delta === null || r.account_usage_delta === undefined
        ? null
        : Number(r.account_usage_delta),
    insertedCount: Number(r.inserted_count),
    updatedCount: Number(r.updated_count),
    stopReason: r.stop_reason ? String(r.stop_reason) : null,
    startedAt:
      r.started_at instanceof Date
        ? r.started_at.toISOString()
        : String(r.started_at),
    finishedAt: r.finished_at
      ? r.finished_at instanceof Date
        ? r.finished_at.toISOString()
        : String(r.finished_at)
      : null,
    items,
  };
}

function mapItemRow(i: Record<string, unknown>): CollectionRunItem {
  return {
    sourceId: String(i.source_id),
    sourceName: String(i.source_name),
    sourceKind: String(i.source_kind),
    endpoint: String(i.endpoint),
    status: i.status as CollectionRunItem["status"],
    httpStatus:
      i.http_status === null || i.http_status === undefined
        ? null
        : Number(i.http_status),
    returnedCount: Number(i.returned_count),
    insertedCount: Number(i.inserted_count),
    updatedCount: Number(i.updated_count),
    emptyResponse: Boolean(i.empty_response),
    oldPostsCount: Number(i.old_posts_count),
    missingTimeCount: Number(i.missing_time_count),
    invalidCount: Number(i.invalid_count),
    creditsCharged:
      i.credits_charged === null || i.credits_charged === undefined
        ? null
        : Number(i.credits_charged),
    creditsUncertain: Boolean(i.credits_uncertain),
    hasNext: Boolean(i.has_next),
    errorMessage: i.error_message ? String(i.error_message) : null,
    elapsedMs:
      i.elapsed_ms === null || i.elapsed_ms === undefined
        ? null
        : Number(i.elapsed_ms),
  };
}

export function createPgCollectorStore(db: SqlRunner): CollectorStore {
  return {
    async getRunByKey(runKey: string): Promise<CollectionRun | null> {
      const { rows } = await db.query(
        "select * from newsroom.collection_runs where run_key = $1",
        [runKey],
      );
      if (!rows.length) return null;
      const runRow = rows[0];
      const itemRes = await db.query(
        "select * from newsroom.collection_run_items where run_id = $1 order by started_at asc, source_name asc",
        [runRow.id],
      );
      return mapRunRow(runRow, itemRes.rows.map(mapItemRow));
    },

    async claimRun(input) {
      const { rows } = await db.query(
        `insert into newsroom.collection_runs (run_key, platform, triggered_by, status, request_cap, credit_cap)
         values ($1, 'facebook', $2, 'running', $3, $4)
         on conflict (run_key) do nothing
         returning id`,
        [input.runKey, input.triggeredBy, input.requestCap, input.creditCap],
      );
      if (!rows.length) return { claimed: false, runId: null };
      return { claimed: true, runId: String(rows[0].id) };
    },

    async listUniqueActiveFacebookSources(): Promise<ActiveFacebookSource[]> {
      const { rows } = await db.query(
        `select distinct s.id, s.name, s.kind, s.locator
         from newsroom.subscriptions t
         join newsroom.sources s on s.id = t.source_id
         where t.active = true
           and s.platform = 'facebook'
           and s.kind in ('page', 'group')
         order by s.name asc, s.id asc`,
      );
      return rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        kind: (r.kind === "group" ? "group" : "page") as "page" | "group",
        locator: String(r.locator),
      }));
    },

    async claimRunItem(input) {
      const { rows } = await db.query(
        `insert into newsroom.collection_run_items
          (run_id, source_id, source_name, source_kind, endpoint, status)
         values ($1, $2, $3, $4, $5, 'attempted')
         on conflict (run_id, source_id) do nothing
         returning source_id`,
        [
          input.runId,
          input.sourceId,
          input.sourceName,
          input.sourceKind,
          input.endpoint,
        ],
      );
      return rows.length > 0;
    },

    async updateRunItem(input) {
      await db.query(
        `update newsroom.collection_run_items set
          status = $3,
          http_status = $4,
          returned_count = $5,
          inserted_count = $6,
          updated_count = $7,
          empty_response = $8,
          old_posts_count = $9,
          missing_time_count = $10,
          invalid_count = $11,
          credits_charged = $12,
          credits_uncertain = $13,
          has_next = $14,
          error_message = $15,
          elapsed_ms = $16,
          details = $17::jsonb,
          finished_at = now()
         where run_id = $1 and source_id = $2`,
        [
          input.runId,
          input.sourceId,
          input.status,
          input.httpStatus,
          input.returnedCount,
          input.insertedCount,
          input.updatedCount,
          input.emptyResponse,
          input.oldPostsCount,
          input.missingTimeCount,
          input.invalidCount,
          input.creditsCharged,
          input.creditsUncertain,
          input.hasNext,
          input.errorMessage,
          input.elapsedMs,
          JSON.stringify(input.details ?? {}),
        ],
      );
    },

    async upsertPostAppearance(post: NormalizedProviderPost) {
      const { rows } = await db.query<{
        res: { postId: string; inserted: boolean; appearanceInserted: boolean };
      }>(
        `select newsroom.upsert_post_appearance(
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::timestamptz,
          $11::timestamptz, $12::jsonb, $13, $14, $15
        ) as res`,
        [
          post.platform,
          post.nativeKey,
          post.sourceId,
          post.text,
          post.media,
          post.rawMediaType,
          post.mediaUrl,
          JSON.stringify(post.mediaItems),
          post.originalUrl,
          post.publishedAt,
          post.seenAt,
          JSON.stringify(post.engagement),
          post.sharedPost,
          post.timeOrigin,
          post.timeSemanticsVerified,
        ],
      );
      return rows[0].res;
    },

    async finishRun(input: {
      runId: string;
      status: CollectionRun["status"];
      requestsMade: number;
      usageChecks: number;
      creditsCharged: number;
      creditsUncertain: boolean;
      creditsRemaining: number | null;
      usageBefore: ProviderUsage | null;
      usageAfter: ProviderUsage | null;
      accountUsageDelta: number | null;
      insertedCount: number;
      updatedCount: number;
      stopReason: string | null;
    }) {
      await db.query(
        `update newsroom.collection_runs set
          status = $2,
          requests_made = $3,
          usage_checks = $4,
          credits_charged = $5,
          credits_uncertain = $6,
          credits_remaining = $7,
          usage_before = $8::jsonb,
          usage_after = $9::jsonb,
          account_usage_delta = $10,
          inserted_count = $11,
          updated_count = $12,
          stop_reason = $13,
          finished_at = now()
         where id = $1`,
        [
          input.runId,
          input.status,
          input.requestsMade,
          input.usageChecks,
          input.creditsCharged,
          input.creditsUncertain,
          input.creditsRemaining,
          input.usageBefore ? JSON.stringify(input.usageBefore) : null,
          input.usageAfter ? JSON.stringify(input.usageAfter) : null,
          input.accountUsageDelta,
          input.insertedCount,
          input.updatedCount,
          input.stopReason,
        ],
      );
    },
  };
}
