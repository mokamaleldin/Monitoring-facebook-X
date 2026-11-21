import {
  parseSource,
  resultText,
  type AdminOverview,
  type FollowResult,
} from "../lib/model.ts";
import {
  runBoundedFacebookCollection,
  type CollectorStore,
} from "./collector.ts";
import { createSocialApisClient, type SocialApisClient } from "./socialapis.ts";

export class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code = "error",
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type VerifiedAdmin = {
  userId: string;
  email: string | null;
  jwt: string;
};

export interface AdminBackend {
  verifyAdminJwt(jwt: string): Promise<VerifiedAdmin>;
  getOverview(admin: VerifiedAdmin): Promise<AdminOverview>;
  createOrg(
    admin: VerifiedAdmin,
    input: {
      name: string;
      maxSources: number;
      allowAdd: boolean;
      feedDays: number;
    },
  ): Promise<{
    id: string;
    name: string;
    maxSources: number;
    allowAdd: boolean;
    feedDays: number;
  }>;
  updateOrg(
    admin: VerifiedAdmin,
    orgId: string,
    input: {
      name?: string;
      maxSources?: number;
      allowAdd?: boolean;
      feedDays?: number;
    },
  ): Promise<{
    id: string;
    name: string;
    maxSources: number;
    allowAdd: boolean;
    feedDays: number;
  }>;
  orgExists(orgId: string): Promise<boolean>;
  findAuthUserByEmail(email: string): Promise<{ id: string; email: string } | null>;
  createAuthUser(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string }>;
  getMembership(
    userId: string,
  ): Promise<{ orgId: string | null; role: string } | null>;
  assignEditorMembership(userId: string, orgId: string): Promise<void>;
  followForOrg(
    admin: VerifiedAdmin,
    orgId: string,
    locator: string,
  ): Promise<FollowResult>;
  pauseForOrg(
    admin: VerifiedAdmin,
    orgId: string,
    sourceId: string,
  ): Promise<void>;
  cancelRequestForOrg(
    admin: VerifiedAdmin,
    orgId: string,
    locator: string,
  ): Promise<void>;
  approveRequestForOrg(
    admin: VerifiedAdmin,
    orgId: string,
    locator: string,
    name: string,
  ): Promise<{ sourceId: string; locator: string; name: string }>;
  renameSource(
    admin: VerifiedAdmin,
    sourceId: string,
    name: string,
  ): Promise<{ id: string; name: string; locator: string }>;
  setReferenceDate(
    admin: VerifiedAdmin,
    referenceAt: string | null,
    label: string | null,
  ): Promise<{ referenceAt: string | null; referenceLabel: string | null }>;
  getCollectorStore(): CollectorStore;
  getSocialApisClient(): SocialApisClient | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractBearer(authHeader: string | null | undefined): string {
  if (!authHeader) {
    throw new HttpError(401, "يرجى تسجيل الدخول أولًا.", "unauthenticated");
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].trim()) {
    throw new HttpError(401, "رمز الجلسة مفقود أو غير صالح.", "unauthenticated");
  }
  return match[1].trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "بيانات الطلب غير صالحة.", "bad_request");
  }
  return value as Record<string, unknown>;
}

export type ServiceResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function handleAdminRequest(
  backend: AdminBackend,
  req: {
    method: string;
    path: string;
    authHeader?: string | null;
    body?: unknown;
  },
): Promise<ServiceResponse> {
  try {
    const jwt = extractBearer(req.authHeader);
    const admin = await backend.verifyAdminJwt(jwt);
    const method = req.method.toUpperCase();
    const path = req.path.replace(/\/+$/, "") || "/";

    // GET /overview
    if (method === "GET" && (path === "/overview" || path === "/")) {
      const overview = await backend.getOverview(admin);
      return {
        status: 200,
        body: {
          ...overview,
          collectorConfigured: backend.getSocialApisClient() !== null,
        },
      };
    }

    // POST /orgs
    if (method === "POST" && path === "/orgs") {
      const data = asObject(req.body);
      const name = String(data.name ?? "").trim();
      const maxSources = Number(data.maxSources ?? 10);
      const allowAdd =
        typeof data.allowAdd === "boolean" ? data.allowAdd : true;
      const feedDays = Number(data.feedDays ?? 7);
      if (!name || name.length > 120) {
        throw new HttpError(400, "اسم الجهة مطلوب (حتى ١٢٠ حرفًا).", "invalid_name");
      }
      if (!Number.isInteger(maxSources) || maxSources < 0 || maxSources > 5000) {
        throw new HttpError(400, "حد المصادر غير صالح.", "invalid_max_sources");
      }
      if (!Number.isInteger(feedDays) || feedDays < 1 || feedDays > 90) {
        throw new HttpError(400, "نافذة العرض يجب أن تكون بين ١ و٩٠ يومًا.", "invalid_feed_days");
      }
      const created = await backend.createOrg(admin, {
        name,
        maxSources,
        allowAdd,
        feedDays,
      });
      return { status: 201, body: created };
    }

    // PATCH /orgs/:orgId
    const patchOrgMatch = path.match(/^\/orgs\/([^/]+)$/);
    if (method === "PATCH" && patchOrgMatch) {
      const orgId = decodeURIComponent(patchOrgMatch[1]);
      if (!UUID_RE.test(orgId)) {
        throw new HttpError(400, "معرّف الجهة غير صالح.", "invalid_org");
      }
      const data = asObject(req.body);
      const patch: {
        name?: string;
        maxSources?: number;
        allowAdd?: boolean;
        feedDays?: number;
      } = {};
      if (data.name !== undefined) {
        const name = String(data.name).trim();
        if (!name || name.length > 120) {
          throw new HttpError(400, "اسم الجهة غير صالح.", "invalid_name");
        }
        patch.name = name;
      }
      if (data.maxSources !== undefined) {
        const ms = Number(data.maxSources);
        if (!Number.isInteger(ms) || ms < 0 || ms > 5000) {
          throw new HttpError(400, "حد المصادر غير صالح.", "invalid_max_sources");
        }
        patch.maxSources = ms;
      }
      if (data.allowAdd !== undefined) {
        if (typeof data.allowAdd !== "boolean") {
          throw new HttpError(400, "قيمة السماح بالإضافة غير صالحة.", "invalid_allow_add");
        }
        patch.allowAdd = data.allowAdd;
      }
      if (data.feedDays !== undefined) {
        const fd = Number(data.feedDays);
        if (!Number.isInteger(fd) || fd < 1 || fd > 90) {
          throw new HttpError(400, "نافذة العرض يجب أن تكون بين ١ و٩٠ يومًا.", "invalid_feed_days");
        }
        patch.feedDays = fd;
      }
      const updated = await backend.updateOrg(admin, orgId, patch);
      return { status: 200, body: updated };
    }

    // POST /editors — create Auth user via auth.admin.createUser + link membership with recovery
    if (method === "POST" && path === "/editors") {
      const data = asObject(req.body);
      const email = String(data.email ?? "").trim().toLowerCase();
      const password = String(data.password ?? "");
      const orgId = String(data.orgId ?? "").trim();

      if (!EMAIL_RE.test(email) || email.length > 254) {
        throw new HttpError(400, "البريد الإلكتروني غير صالح.", "invalid_email");
      }
      if (!UUID_RE.test(orgId)) {
        throw new HttpError(400, "اختر جهة صالحة قبل إنشاء المحرر.", "invalid_org");
      }
      const existsOrg = await backend.orgExists(orgId);
      if (!existsOrg) {
        throw new HttpError(404, "الجهة المحددة غير موجودة.", "org_not_found");
      }

      const existingAuth = await backend.findAuthUserByEmail(email);
      if (existingAuth) {
        const membership = await backend.getMembership(existingAuth.id);
        if (membership) {
          throw new HttpError(
            409,
            "هذا البريد الإلكتروني مسجل بالفعل ومرتبط بعضوية.",
            "already_member",
          );
        }
        // Safe recovery: Auth user was created earlier, membership failed — complete it now!
        await backend.assignEditorMembership(existingAuth.id, orgId);
        return {
          status: 200,
          body: {
            status: "recovered",
            userId: existingAuth.id,
            email: existingAuth.email,
            orgId,
          },
        };
      }

      if (password.length < 8 || password.length > 128) {
        throw new HttpError(
          400,
          "كلمة السر يجب أن لا تقل عن ٨ أحرف.",
          "invalid_password",
        );
      }

      const createdUser = await backend.createAuthUser(email, password);
      try {
        await backend.assignEditorMembership(createdUser.id, orgId);
      } catch {
        throw new HttpError(
          500,
          "تم إنشاء حساب الدخول في Auth لكن تعذّر ربط العضوية بالجهة. أعد المحاولة بنفس البريد والجهة لاستكمال الربط بأمان.",
          "membership_pending",
          { userId: createdUser.id, email: createdUser.email, orgId },
        );
      }

      return {
        status: 201,
        body: {
          status: "created",
          userId: createdUser.id,
          email: createdUser.email,
          orgId,
        },
      };
    }

    // POST /orgs/:orgId/sources
    const addSourcesMatch = path.match(/^\/orgs\/([^/]+)\/sources$/);
    if (method === "POST" && addSourcesMatch) {
      const orgId = decodeURIComponent(addSourcesMatch[1]);
      if (!UUID_RE.test(orgId)) {
        throw new HttpError(400, "معرّف الجهة غير صالح.", "invalid_org");
      }
      const data = asObject(req.body);
      if (!Array.isArray(data.lines) || data.lines.length === 0 || data.lines.length > 100) {
        throw new HttpError(400, "أدخل من رابط واحد إلى ١٠٠ رابط في الدفعة.", "invalid_lines");
      }
      const rows: { url: string; status: string }[] = [];
      for (const rawLine of data.lines) {
        const line = String(rawLine ?? "").trim();
        if (!line) continue;
        const loc = parseSource(line);
        if (!loc) {
          rows.push({ url: line, status: "رابط غير مدعوم" });
          continue;
        }
        const res = await backend.followForOrg(admin, orgId, loc);
        rows.push({ url: line, status: resultText[res] });
      }
      return { status: 200, body: { rows } };
    }

    // POST /orgs/:orgId/sources/toggle
    const toggleSourceMatch = path.match(/^\/orgs\/([^/]+)\/sources\/toggle$/);
    if (method === "POST" && toggleSourceMatch) {
      const orgId = decodeURIComponent(toggleSourceMatch[1]);
      if (!UUID_RE.test(orgId)) {
        throw new HttpError(400, "معرّف الجهة غير صالح.", "invalid_org");
      }
      const data = asObject(req.body);
      const sourceId = String(data.sourceId ?? "");
      const locator = String(data.locator ?? "");
      const active = Boolean(data.active);
      if (active) {
        if (!UUID_RE.test(sourceId)) {
          throw new HttpError(400, "معرّف المصدر غير صالح.", "invalid_source");
        }
        await backend.pauseForOrg(admin, orgId, sourceId);
        return { status: 200, body: { message: "أُوقفت المتابعة لهذه الجهة" } };
      }
      const res = await backend.followForOrg(admin, orgId, locator);
      return { status: 200, body: { message: resultText[res] } };
    }

    // POST /orgs/:orgId/requests/cancel
    const cancelReqMatch = path.match(/^\/orgs\/([^/]+)\/requests\/cancel$/);
    if (method === "POST" && cancelReqMatch) {
      const orgId = decodeURIComponent(cancelReqMatch[1]);
      if (!UUID_RE.test(orgId)) {
        throw new HttpError(400, "معرّف الجهة غير صالح.", "invalid_org");
      }
      const data = asObject(req.body);
      const locator = String(data.locator ?? "").trim();
      await backend.cancelRequestForOrg(admin, orgId, locator);
      return { status: 200, body: { message: "تم إلغاء الطلب" } };
    }

    // POST /orgs/:orgId/requests/approve
    const approveReqMatch = path.match(/^\/orgs\/([^/]+)\/requests\/approve$/);
    if (method === "POST" && approveReqMatch) {
      const orgId = decodeURIComponent(approveReqMatch[1]);
      if (!UUID_RE.test(orgId)) {
        throw new HttpError(400, "معرّف الجهة غير صالح.", "invalid_org");
      }
      const data = asObject(req.body);
      const locator = String(data.locator ?? "").trim();
      const name = String(data.name ?? "").trim();
      if (!name || name.length > 120) {
        throw new HttpError(400, "اسم المصدر مطلوب لاعتماده.", "invalid_name");
      }
      const approved = await backend.approveRequestForOrg(
        admin,
        orgId,
        locator,
        name,
      );
      return { status: 200, body: approved };
    }

    // PATCH /sources/:sourceId — rename a source (e.g. give a real Arabic name to a Facebook group)
    const renameSrcMatch = path.match(/^\/sources\/([^/]+)$/);
    if (method === "PATCH" && renameSrcMatch) {
      const sourceId = decodeURIComponent(renameSrcMatch[1]);
      if (!UUID_RE.test(sourceId)) {
        throw new HttpError(400, "معرّف المصدر غير صالح.", "invalid_source");
      }
      const data = asObject(req.body);
      const name = String(data.name ?? "").trim();
      if (!name || name.length > 120) {
        throw new HttpError(400, "اكتب اسمًا صالحًا للمصدر (حتى ١٢٠ حرفًا).", "invalid_name");
      }
      const renamed = await backend.renameSource(admin, sourceId, name);
      return { status: 200, body: renamed };
    }

    // POST /reference-date
    if (method === "POST" && path === "/reference-date") {
      const data = asObject(req.body);
      const referenceAt =
        data.referenceAt === null || data.referenceAt === undefined || data.referenceAt === ""
          ? null
          : String(data.referenceAt);
      if (referenceAt !== null && Number.isNaN(Date.parse(referenceAt))) {
        throw new HttpError(400, "التاريخ المرجعي غير صالح.", "invalid_date");
      }
      const label =
        data.label === null || data.label === undefined
          ? null
          : String(data.label).trim() || null;
      const updated = await backend.setReferenceDate(
        admin,
        referenceAt,
        label,
      );
      return { status: 200, body: updated };
    }

    // POST /collect-facebook
    if (method === "POST" && path === "/collect-facebook") {
      const socialClient = backend.getSocialApisClient();
      if (!socialClient) {
        throw new HttpError(
          400,
          "مفتاح SOCIALAPIS_API_KEY غير مضبوط على الخادم. أضف المفتاح في بيئة الخادم قبل تشغيل دورة الجمع الحية.",
          "socialapis_key_missing",
        );
      }
      const data = asObject(req.body ?? {});
      const runKey =
        typeof data.runKey === "string" && data.runKey.trim()
          ? data.runKey.trim()
          : `manual-${new Date().toISOString().slice(0, 16)}`;
      const maxRequests = Math.max(
        1,
        Math.min(Number(data.maxRequests ?? 5) || 5, 5),
      );
      const maxCredits = Math.max(
        1,
        Math.min(Number(data.maxCredits ?? 5) || 5, 5),
      );
      const result = await runBoundedFacebookCollection(
        backend.getCollectorStore(),
        socialClient,
        {
          runKey,
          triggeredBy: admin.userId,
          maxRequests,
          maxCredits,
        },
      );
      return { status: 200, body: result };
    }

    throw new HttpError(404, "المسار غير موجود.", "not_found");
  } catch (err) {
    if (err instanceof HttpError) {
      return {
        status: err.status,
        body: { error: err.message, code: err.code, ...err.extra },
      };
    }
    return {
      status: 500,
      body: {
        error:
          err instanceof Error ? err.message : "حدث خطأ غير متوقع على الخادم.",
        code: "internal_error",
      },
    };
  }
}

export function createEnvSocialApisClient(): SocialApisClient | null {
  const key = process.env.SOCIALAPIS_API_KEY?.trim();
  return key ? createSocialApisClient(key) : null;
}
