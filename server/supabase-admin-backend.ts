import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminOverview,
  CollectionRun,
  FollowResult,
  OrphanAuthUser,
} from "../lib/model.ts";
import {
  createEnvSocialApisClient,
  HttpError,
  type AdminBackend,
} from "./admin-service.ts";
import type { ActiveFacebookSource, CollectorStore } from "./collector.ts";
import type {
  NormalizedProviderPost,
  ProviderUsage,
  SocialApisClient,
} from "./socialapis.ts";

export function createSupabaseCollectorStore(
  serviceClient: SupabaseClient,
): CollectorStore {
  return {
    async getRunByKey(runKey: string): Promise<CollectionRun | null> {
      const { data, error } = await serviceClient.rpc(
        "newsroom_service_get_run",
        { p_run_key: runKey },
      );
      if (error) throw new Error(error.message);
      return (data as CollectionRun | null) ?? null;
    },

    async claimRun(input) {
      const { data, error } = await serviceClient.rpc(
        "newsroom_service_claim_run",
        {
          p_run_key: input.runKey,
          p_triggered_by: input.triggeredBy,
          p_request_cap: input.requestCap,
          p_credit_cap: input.creditCap,
        },
      );
      if (error) throw new Error(error.message);
      return data as { claimed: boolean; runId: string | null };
    },

    async listUniqueActiveFacebookSources(): Promise<ActiveFacebookSource[]> {
      const { data, error } = await serviceClient.rpc(
        "newsroom_service_list_active_fb_sources",
      );
      if (error) throw new Error(error.message);
      return (data as ActiveFacebookSource[]) ?? [];
    },

    async claimRunItem(input) {
      const { data, error } = await serviceClient.rpc(
        "newsroom_service_claim_run_item",
        {
          p_run_id: input.runId,
          p_source_id: input.sourceId,
          p_source_name: input.sourceName,
          p_source_kind: input.sourceKind,
          p_endpoint: input.endpoint,
        },
      );
      if (error) throw new Error(error.message);
      return Boolean(data);
    },

    async updateRunItem(input) {
      const { error } = await serviceClient.rpc(
        "newsroom_service_update_run_item",
        {
          p_run_id: input.runId,
          p_source_id: input.sourceId,
          p_status: input.status,
          p_http_status: input.httpStatus,
          p_returned_count: input.returnedCount,
          p_inserted_count: input.insertedCount,
          p_updated_count: input.updatedCount,
          p_empty_response: input.emptyResponse,
          p_old_posts_count: input.oldPostsCount,
          p_missing_time_count: input.missingTimeCount,
          p_invalid_count: input.invalidCount,
          p_credits_charged: input.creditsCharged,
          p_credits_uncertain: input.creditsUncertain,
          p_has_next: input.hasNext,
          p_error_message: input.errorMessage,
          p_elapsed_ms: input.elapsedMs,
          p_details: input.details ?? {},
        },
      );
      if (error) throw new Error(error.message);
    },

    async upsertPostAppearance(post: NormalizedProviderPost) {
      const { data, error } = await serviceClient.rpc(
        "newsroom_service_upsert_post",
        {
          p_platform: post.platform,
          p_native_key: post.nativeKey,
          p_source_id: post.sourceId,
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
        },
      );
      if (error) throw new Error(error.message);
      return data as {
        postId: string;
        inserted: boolean;
        appearanceInserted: boolean;
      };
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
      const { error } = await serviceClient.rpc(
        "newsroom_service_finish_run",
        {
          p_run_id: input.runId,
          p_status: input.status,
          p_requests_made: input.requestsMade,
          p_usage_checks: input.usageChecks,
          p_credits_charged: input.creditsCharged,
          p_credits_uncertain: input.creditsUncertain,
          p_credits_remaining: input.creditsRemaining,
          p_usage_before: input.usageBefore,
          p_usage_after: input.usageAfter,
          p_account_usage_delta: input.accountUsageDelta,
          p_inserted_count: input.insertedCount,
          p_updated_count: input.updatedCount,
          p_stop_reason: input.stopReason,
        },
      );
      if (error) throw new Error(error.message);
    },
  };
}

export function createSupabaseAdminBackend(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  publishableKey?: string;
  socialApisClient?: SocialApisClient | null;
}): AdminBackend {
  const serviceClient = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const collectorStore = createSupabaseCollectorStore(serviceClient);

  function userClient(jwt: string): SupabaseClient {
    return createClient(
      options.supabaseUrl,
      options.publishableKey || options.serviceRoleKey,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      },
    );
  }

  return {
    async verifyAdminJwt(jwt: string) {
      const { data, error } = await serviceClient.auth.getUser(jwt);
      if (error || !data?.user?.id) {
        throw new HttpError(401, "جلسة الدخول غير صالحة أو منتهية.", "unauthenticated");
      }
      const { data: isAdmin, error: roleErr } = await serviceClient.rpc(
        "newsroom_service_is_admin",
        { p_user: data.user.id },
      );
      if (roleErr) {
        throw new HttpError(500, roleErr.message, "role_check_failed");
      }
      if (!isAdmin) {
        throw new HttpError(
          403,
          "هذا الإجراء مخصص لأدمن كشيدة فقط.",
          "forbidden",
        );
      }
      return { userId: data.user.id, email: data.user.email ?? null, jwt };
    },

    async getOverview(admin): Promise<AdminOverview> {
      const [ov, orphans] = await Promise.all([
        userClient(admin.jwt).rpc("newsroom_admin_overview"),
        serviceClient.rpc("newsroom_service_orphan_users"),
      ]);
      if (ov.error) throw new HttpError(403, ov.error.message, "overview_failed");
      return {
        ...(ov.data as AdminOverview),
        orphanUsers: (orphans.data as OrphanAuthUser[]) ?? [],
      };
    },

    async createOrg(admin, input) {
      const { data, error } = await userClient(admin.jwt).rpc("newsroom_admin_create_org", {
        p_name: input.name,
        p_max_sources: input.maxSources,
        p_allow_add: input.allowAdd,
        p_feed_days: input.feedDays,
      });
      if (error) throw new HttpError(400, error.message, "create_org_failed");
      return data;
    },

    async updateOrg(admin, orgId, input) {
      const { data, error } = await userClient(admin.jwt).rpc("newsroom_admin_update_org", {
        p_org: orgId,
        p_name: input.name ?? null,
        p_max_sources: input.maxSources ?? null,
        p_allow_add: input.allowAdd ?? null,
        p_feed_days: input.feedDays ?? null,
      });
      if (error) throw new HttpError(400, error.message, "update_org_failed");
      return data;
    },

    async orgExists(orgId) {
      const { data, error } = await serviceClient.rpc(
        "newsroom_service_org_exists",
        { p_org: orgId },
      );
      if (error) throw new HttpError(500, error.message, "org_check_failed");
      return Boolean(data);
    },

    async findAuthUserByEmail(email) {
      let page = 1;
      const target = email.toLowerCase();
      while (page <= 20) {
        const { data, error } = await serviceClient.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (error) throw new HttpError(500, error.message, "list_users_failed");
        const users = data?.users ?? [];
        const match = users.find((u) => (u.email || "").toLowerCase() === target);
        if (match) return { id: match.id, email: match.email || target };
        if (users.length < 200) break;
        page += 1;
      }
      return null;
    },

    async createAuthUser(email, password) {
      const { data, error } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data?.user?.id) {
        throw new HttpError(
          400,
          error?.message || "تعذّر إنشاء حساب الدخول.",
          "create_user_failed",
        );
      }
      return { id: data.user.id, email: data.user.email || email };
    },

    async getMembership(userId) {
      const { data, error } = await serviceClient.rpc(
        "newsroom_service_get_membership",
        { p_user: userId },
      );
      if (error) throw new HttpError(500, error.message, "membership_check_failed");
      return data as { orgId: string | null; role: string } | null;
    },

    async assignEditorMembership(userId, orgId) {
      const { error } = await serviceClient.rpc(
        "newsroom_service_assign_member",
        {
          p_user: userId,
          p_org: orgId,
          p_role: "editor",
          p_ignore_conflict: false,
        },
      );
      if (error) throw new Error(error.message);
    },

    async followForOrg(admin, orgId, locator): Promise<FollowResult> {
      const { data, error } = await userClient(admin.jwt).rpc("newsroom_follow", {
        p_org: orgId,
        p_locator: locator,
      });
      if (error) throw new HttpError(400, error.message, "follow_failed");
      return data as FollowResult;
    },

    async pauseForOrg(admin, orgId, sourceId) {
      const { error } = await userClient(admin.jwt).rpc("newsroom_pause", {
        p_org: orgId,
        p_source: sourceId,
      });
      if (error) throw new HttpError(400, error.message, "pause_failed");
    },

    async cancelRequestForOrg(admin, orgId, locator) {
      const { error } = await userClient(admin.jwt).rpc("newsroom_cancel_request", {
        p_org: orgId,
        p_locator: locator,
      });
      if (error) throw new HttpError(400, error.message, "cancel_failed");
    },

    async approveRequestForOrg(admin, orgId, locator, name) {
      const { data, error } = await userClient(admin.jwt).rpc(
        "newsroom_admin_resolve_request",
        {
          p_org: orgId,
          p_locator: locator,
          p_name: name,
          p_native_key: null,
        },
      );
      if (error) throw new HttpError(400, error.message, "approve_failed");
      return data;
    },

    async setReferenceDate(admin, referenceAt, label) {
      const { data, error } = await userClient(admin.jwt).rpc(
        "newsroom_admin_set_reference",
        {
          p_reference_at: referenceAt,
          p_label: label,
        },
      );
      if (error) throw new HttpError(400, error.message, "reference_failed");
      return data;
    },

    getCollectorStore() {
      return collectorStore;
    },

    getSocialApisClient() {
      if (options.socialApisClient !== undefined) {
        return options.socialApisClient;
      }
      return createEnvSocialApisClient();
    },
  };
}
