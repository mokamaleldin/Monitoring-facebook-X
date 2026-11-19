import { sourceUrl, type CollectionRun, type CollectionRunItem } from "../lib/model.ts";
import {
  normalizeFacebookPost,
  ProviderError,
  TransportError,
  type NormalizedProviderPost,
  type ProviderUsage,
  type SocialApisClient,
} from "./socialapis.ts";

export type ActiveFacebookSource = {
  id: string;
  name: string;
  kind: "page" | "group";
  locator: string;
};

export interface CollectorStore {
  getRunByKey(runKey: string): Promise<CollectionRun | null>;
  claimRun(input: {
    runKey: string;
    triggeredBy: string | null;
    requestCap: number;
    creditCap: number;
  }): Promise<{ claimed: boolean; runId: string | null }>;
  listUniqueActiveFacebookSources(): Promise<ActiveFacebookSource[]>;
  claimRunItem(input: {
    runId: string;
    sourceId: string;
    sourceName: string;
    sourceKind: string;
    endpoint: string;
  }): Promise<boolean>;
  updateRunItem(input: {
    runId: string;
    sourceId: string;
    status: CollectionRunItem["status"];
    httpStatus: number | null;
    returnedCount: number;
    insertedCount: number;
    updatedCount: number;
    emptyResponse: boolean;
    oldPostsCount: number;
    missingTimeCount: number;
    invalidCount: number;
    creditsCharged: number | null;
    creditsUncertain: boolean;
    hasNext: boolean;
    errorMessage: string | null;
    elapsedMs: number;
    details: Record<string, unknown>;
  }): Promise<void>;
  upsertPostAppearance(
    post: NormalizedProviderPost,
  ): Promise<{ postId: string; inserted: boolean; appearanceInserted: boolean }>;
  finishRun(input: {
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
  }): Promise<void>;
}

export type BoundedCollectionOptions = {
  runKey: string;
  triggeredBy?: string | null;
  maxRequests?: number;
  maxCredits?: number;
  lookbackMinutes?: number;
  nowFn?: () => Date;
};

export async function runBoundedFacebookCollection(
  store: CollectorStore,
  client: SocialApisClient,
  options: BoundedCollectionOptions,
): Promise<{ replayed: boolean; run: CollectionRun }> {
  const runKey = options.runKey.trim();
  if (!runKey || runKey.length > 120) {
    throw new ProviderError("runKey is required (max 120 chars)");
  }

  const requestCap = Math.max(1, Math.min(Math.trunc(options.maxRequests ?? 5), 5));
  const creditCap = Math.max(1, Math.min(Math.trunc(options.maxCredits ?? 5), 5));
  const lookbackMinutes = Math.max(
    1,
    Math.min(Math.trunc(options.lookbackMinutes ?? 60), 1440),
  );
  const nowFn = options.nowFn || (() => new Date());

  const existing = await store.getRunByKey(runKey);
  if (existing) {
    return { replayed: true, run: existing };
  }

  const claim = await store.claimRun({
    runKey,
    triggeredBy: options.triggeredBy ?? null,
    requestCap,
    creditCap,
  });

  if (!claim.claimed || !claim.runId) {
    const saved = await store.getRunByKey(runKey);
    if (!saved) {
      throw new ProviderError("Collection run already in progress");
    }
    return { replayed: true, run: saved };
  }

  const runId = claim.runId;
  const startedNow = nowFn();
  const sinceMs = startedNow.getTime() - lookbackMinutes * 60_000;
  const afterDate = new Date(sinceMs).toISOString().slice(0, 10);

  let requestsMade = 0;
  let usageChecks = 0;
  let creditsCharged = 0;
  let creditsUncertain = false;
  let creditsRemaining: number | null = null;
  let usageBefore: ProviderUsage | null = null;
  let usageAfter: ProviderUsage | null = null;
  let accountUsageDelta: number | null = null;
  let totalInserted = 0;
  let totalUpdated = 0;
  let stopReason: string | null = null;
  let status: CollectionRun["status"] = "completed";

  // 1) Check provider usage BEFORE sending any post requests (logged separately)
  try {
    usageChecks += 1;
    usageBefore = await client.getUsage();
    creditsRemaining = usageBefore.creditsRemaining;
    if (creditsRemaining !== null && creditsRemaining < 1) {
      stopReason = "الرصيد المجاني المتبقي غير كافٍ للبدء.";
      status = "stopped";
    }
  } catch (err) {
    const httpStatus = err instanceof TransportError ? err.status : null;
    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
      stopReason = `توقف قبل السحب بسبب استجابة /usage (${httpStatus}).`;
      status = "stopped";
    } else {
      stopReason =
        err instanceof Error
          ? `تعذّر التحقق من رصيد المزود (/usage): ${err.message}`
          : "تعذّر التحقق من رصيد المزود (/usage).";
      status = "failed";
    }
  }

  // 2) Process unique active Facebook sources across ALL orgs (deduplicated)
  if (!stopReason) {
    const sources = await store.listUniqueActiveFacebookSources();
    if (sources.length === 0) {
      stopReason = "لا توجد مصادر Facebook نشطة.";
    }

    for (const source of sources) {
      if (requestsMade >= requestCap) {
        stopReason = `بلغت الدورة سقف الطلبات (${requestCap}).`;
        status = "stopped";
        break;
      }
      if (creditsCharged + 1 > creditCap) {
        stopReason = `بلغت الدورة سقف الرصيد المتفق عليه (${creditCap} Credits).`;
        status = "stopped";
        break;
      }

      const endpoint =
        source.kind === "page"
          ? "/facebook/pages/posts"
          : "/facebook/groups/posts";
      const itemClaimed = await store.claimRunItem({
        runId,
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        endpoint,
      });
      if (!itemClaimed) continue;

      const t0 = Date.now();
      requestsMade += 1;

      try {
        const response = await client.fetchFacebookPosts({
          kind: source.kind,
          url: sourceUrl(source.locator),
          afterDate,
          limit: 3,
        });

        const charged = response.creditsCharged ?? 1;
        creditsCharged += charged;
        if (response.creditsRemaining !== null) {
          creditsRemaining = response.creditsRemaining;
        }
        if (response.creditsUncertain) {
          creditsUncertain = true;
        }

        const slice = response.posts.slice(0, 3);
        let inserted = 0;
        let updated = 0;
        let oldPosts = 0;
        let missingTime = 0;
        let invalid = 0;
        const collectedAt = nowFn().toISOString();

        for (const rawPost of slice) {
          let normalized: NormalizedProviderPost;
          try {
            normalized = normalizeFacebookPost(rawPost, source.id, collectedAt);
          } catch {
            invalid += 1;
            continue;
          }
          if (!normalized.publishedAt) {
            missingTime += 1;
          } else if (Date.parse(normalized.publishedAt) < sinceMs) {
            oldPosts += 1;
          }
          const upsertResult = await store.upsertPostAppearance(normalized);
          if (upsertResult.inserted) inserted += 1;
          else updated += 1;
        }

        totalInserted += inserted;
        totalUpdated += updated;

        await store.updateRunItem({
          runId,
          sourceId: source.id,
          status: "ok",
          httpStatus: response.httpStatus,
          returnedCount: slice.length,
          insertedCount: inserted,
          updatedCount: updated,
          emptyResponse: slice.length === 0,
          oldPostsCount: oldPosts,
          missingTimeCount: missingTime,
          invalidCount: invalid,
          creditsCharged: response.creditsCharged,
          creditsUncertain: response.creditsUncertain,
          hasNext: response.hasNext,
          errorMessage: null,
          elapsedMs: Date.now() - t0,
          details: { afterDate, rawReturned: response.posts.length },
        });

        if (response.creditsUncertain) {
          stopReason =
            "الخصم غير محدد في رد المزود؛ أُوقفت المحاولات المتبقية منعًا لتجاوز السقف.";
          status = "stopped";
          break;
        }
      } catch (err) {
        const elapsedMs = Date.now() - t0;
        const isTransport = err instanceof TransportError;
        const httpStatus = isTransport ? err.status : null;
        const isUncertain = isTransport ? err.uncertain : true;
        const knownFree =
          isTransport && httpStatus !== null && httpStatus >= 400 && httpStatus < 500;

        if (!knownFree) {
          creditsUncertain = true;
        }

        await store.updateRunItem({
          runId,
          sourceId: source.id,
          status: isUncertain ? "uncertain" : "error",
          httpStatus,
          returnedCount: 0,
          insertedCount: 0,
          updatedCount: 0,
          emptyResponse: false,
          oldPostsCount: 0,
          missingTimeCount: 0,
          invalidCount: 0,
          creditsCharged: knownFree ? 0 : null,
          creditsUncertain: !knownFree,
          hasNext: false,
          errorMessage:
            err instanceof Error ? err.message : "Unknown provider error",
          elapsedMs,
          details: { afterDate },
        });

        if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
          stopReason = `توقفت الدورة بدون إعادة محاولة (HTTP ${httpStatus}).`;
          status = "stopped";
          break;
        }
        if (isUncertain) {
          stopReason =
            "نتيجة المحاولة غير مؤكدة بعد الإرسال؛ أُوقفت الدورة دون إعادة محاولة تلقائية.";
          status = "stopped";
          break;
        }
      }
    }
  }

  // 3) Check provider usage AFTER loop (if we did at least one request or usage check worked)
  if (usageBefore !== null) {
    try {
      usageChecks += 1;
      usageAfter = await client.getUsage();
      if (usageAfter.creditsRemaining !== null) {
        creditsRemaining = usageAfter.creditsRemaining;
      }
      if (
        usageBefore.creditsUsed !== null &&
        usageAfter.creditsUsed !== null
      ) {
        accountUsageDelta = usageAfter.creditsUsed - usageBefore.creditsUsed;
      }
    } catch {
      creditsUncertain = true;
    }
  }

  await store.finishRun({
    runId,
    status,
    requestsMade,
    usageChecks,
    creditsCharged,
    creditsUncertain,
    creditsRemaining,
    usageBefore,
    usageAfter,
    accountUsageDelta,
    insertedCount: totalInserted,
    updatedCount: totalUpdated,
    stopReason,
  });

  const saved = await store.getRunByKey(runKey);
  if (!saved) {
    throw new ProviderError("Failed to read persisted collection run");
  }
  return { replayed: false, run: saved };
}
