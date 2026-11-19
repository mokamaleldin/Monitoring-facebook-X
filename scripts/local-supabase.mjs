/**
 * Local Supabase-compatible development & testing server backed by real PostgreSQL (PGlite).
 * Runs the exact production SQL migrations, PostgreSQL RLS policies, real HMAC-SHA256 JWTs,
 * GoTrue-compatible Auth/Admin API, PostgREST RPC/table API, and Edge Function routes.
 *
 * Strictly for local development & automated testing when Docker / hosted Supabase is absent.
 */
import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  createEnvSocialApisClient,
  handleAdminRequest,
  HttpError,
} from "../server/admin-service.ts";
import { createPgCollectorStore } from "../server/pg-collector-store.ts";
import { loadLocalEnv } from "./env-loader.mjs";

const DEFAULT_PUBLISHABLE_KEY = "kashida-local-publishable-key";
const DEFAULT_SERVICE_KEY = "kashida-local-service-role-key";
const DEFAULT_JWT_SECRET = "kashida-local-jwt-secret-change-not-for-prod";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && Date.now() / 1000 >= payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored || "").split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const requested = req.headers["access-control-request-headers"];
  const baseHeaders =
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": requested
      ? `${baseHeaders}, ${requested}`
      : baseHeaders,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 2_000_000) throw new Error("Body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function mapPgError(err) {
  const code = err?.code || "P0001";
  const message = err?.message || "Database error";
  if (code === "42501") return { status: 403, body: { code, message, details: null, hint: null } };
  if (code === "22023" || code === "22P02" || code === "23514") {
    return { status: 400, body: { code, message, details: null, hint: null } };
  }
  if (code === "23505") return { status: 409, body: { code, message, details: null, hint: null } };
  return { status: 500, body: { code, message, details: null, hint: null } };
}

function formatAuthUser(row) {
  const iso =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at || new Date().toISOString());
  return {
    id: String(row.id),
    aud: "authenticated",
    role: "authenticated",
    email: String(row.email),
    email_confirmed_at: iso,
    confirmed_at: iso,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: iso,
    updated_at: iso,
  };
}

export async function startLocalSupabase(options = {}) {
  const dataDir = options.dataDir ?? null;
  if (dataDir) mkdirSync(dataDir, { recursive: true });

  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  const publishableKey =
    options.publishableKey ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    DEFAULT_PUBLISHABLE_KEY;
  const serviceRoleKey =
    options.serviceRoleKey ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    DEFAULT_SERVICE_KEY;
  const jwtSecret = options.jwtSecret || DEFAULT_JWT_SECRET;
  const port = options.port ?? 54321;
  const host = options.host || "127.0.0.1";
  const socialApisClientOverride = options.socialApisClient;
  const hooks = options.hooks || {};

  // Serialize PGlite transactions cleanly across concurrent HTTP requests
  let dbChain = Promise.resolve();
  function withDbLock(fn) {
    const next = dbChain.then(fn, fn);
    dbChain = next.catch(() => {});
    return next;
  }

  // Bootstrap auth schema & apply SQL migrations idempotently
  await withDbLock(async () => {
    await db.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end $$;
      create schema if not exists auth;
      create table if not exists auth.users (
        id uuid primary key,
        email text not null unique,
        encrypted_password text not null,
        created_at timestamptz not null default now()
      );
      create table if not exists auth.refresh_tokens (
        token text primary key,
        user_id uuid not null references auth.users on delete cascade,
        created_at timestamptz not null default now()
      );
      create table if not exists auth.revoked_jtis (
        jti text primary key,
        revoked_at timestamptz not null default now()
      );
      create or replace function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);

    const hasOrgTable = await db.query(
      "select to_regclass('newsroom.organizations') as t",
    );
    if (!hasOrgTable.rows[0]?.t) {
      const m1 = await readFile(
        new URL("../supabase/migrations/202611190001_newsroom.sql", import.meta.url),
        "utf8",
      );
      await db.exec(m1);
    }

    const hasRuntimeCfg = await db.query(
      "select to_regclass('newsroom.runtime_config') as t",
    );
    if (!hasRuntimeCfg.rows[0]?.t) {
      const m2 = await readFile(
        new URL("../supabase/migrations/202611190002_platform_v1.sql", import.meta.url),
        "utf8",
      );
      await db.exec(m2);
    }

    const hasRenameFn = await db.query(
      "select exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'newsroom_admin_rename_source') as ok",
    );
    if (!hasRenameFn.rows[0]?.ok) {
      const m3 = await readFile(
        new URL("../supabase/migrations/202611200003_rename_source.sql", import.meta.url),
        "utf8",
      );
      await db.exec(m3);
    }
  });

  async function issueSession(userRow) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;
    const jti = randomUUID();
    const accessToken = signJwt(
      {
        aud: "authenticated",
        role: "authenticated",
        sub: String(userRow.id),
        email: String(userRow.email),
        jti,
        iat: nowSec,
        exp: nowSec + expiresIn,
      },
      jwtSecret,
    );
    const refreshToken = randomBytes(24).toString("base64url");
    await withDbLock(() =>
      db.query("insert into auth.refresh_tokens(token, user_id) values ($1, $2)", [
        refreshToken,
        userRow.id,
      ]),
    );
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      expires_at: nowSec + expiresIn,
      refresh_token: refreshToken,
      user: formatAuthUser(userRow),
    };
  }

  async function resolveCaller(req) {
    const authHeader = req.headers.authorization || "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const bearer = bearerMatch ? bearerMatch[1].trim() : "";
    const apiKey = String(req.headers.apikey || "").trim();

    if (bearer === serviceRoleKey || (!bearer && apiKey === serviceRoleKey)) {
      return { role: "service_role", userId: null, email: null, jti: null };
    }
    if (bearer && bearer !== publishableKey) {
      const payload = verifyJwt(bearer, jwtSecret);
      if (!payload || !payload.sub) {
        return { role: "invalid", userId: null, email: null, jti: null };
      }
      const revoked = await withDbLock(() =>
        db.query("select 1 from auth.revoked_jtis where jti = $1", [
          payload.jti || "",
        ]),
      );
      if (revoked.rows.length > 0) {
        return { role: "invalid", userId: null, email: null, jti: null };
      }
      return {
        role: "authenticated",
        userId: String(payload.sub),
        email: payload.email ? String(payload.email) : null,
        jti: payload.jti ? String(payload.jti) : null,
      };
    }
    return { role: "anon", userId: null, email: null, jti: null };
  }

  async function runAsRole(caller, fn) {
    return withDbLock(async () => {
      await db.exec("begin");
      try {
        if (caller.role === "authenticated" && caller.userId) {
          await db.exec("set local role authenticated");
          await db.query(
            "select set_config('request.jwt.claim.sub', $1, true)",
            [caller.userId],
          );
        } else if (caller.role === "service_role") {
          await db.exec("set local role service_role");
        } else {
          await db.exec("set local role anon");
        }
        const out = await fn();
        await db.exec("commit");
        return out;
      } catch (err) {
        await db.exec("rollback").catch(() => {});
        throw err;
      }
    });
  }

  async function callRpc(caller, fnName, argsObj) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(fnName)) {
      throw Object.assign(new Error("Invalid RPC name"), { code: "22023" });
    }
    return runAsRole(caller, async () => {
      const meta = await db.query(
        `select p.proargnames, p.pronargs, p.proargtypes::oid[] as argtypes
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1
         limit 1`,
        [fnName],
      );
      if (!meta.rows.length) {
        throw Object.assign(new Error(`Function public.${fnName} not found`), {
          code: "42883",
        });
      }
      const argNames = meta.rows[0].proargnames || [];
      const supplied = argsObj && typeof argsObj === "object" ? argsObj : {};
      const params = [];
      const placeholders = [];
      for (const name of argNames) {
        if (Object.hasOwn(supplied, name)) {
          params.push(supplied[name]);
          placeholders.push(`${name} => $${params.length}`);
        }
      }
      const sql = `select public.${fnName}(${placeholders.join(", ")}) as result`;
      const { rows } = await db.query(sql, params);
      return rows.length ? rows[0].result : null;
    });
  }

  const lockedSqlRunner = {
    query(sql, params = []) {
      return withDbLock(() => db.query(sql, params));
    },
  };
  const collectorStore = createPgCollectorStore(lockedSqlRunner);

  // AdminBackend backed directly by this PGlite instance
  const adminBackend = {
    async verifyAdminJwt(jwt) {
      const payload = verifyJwt(jwt, jwtSecret);
      if (!payload || !payload.sub) {
        throw new HttpError(401, "جلسة الدخول غير صالحة أو منتهية.", "unauthenticated");
      }
      const revoked = await withDbLock(() =>
        db.query("select 1 from auth.revoked_jtis where jti = $1", [
          payload.jti || "",
        ]),
      );
      if (revoked.rows.length > 0) {
        throw new HttpError(401, "تم تسجيل الخروج من هذه الجلسة.", "unauthenticated");
      }
      const check = await withDbLock(() =>
        db.query(
          "select 1 from newsroom.members where user_id = $1 and role = 'platform_admin'",
          [payload.sub],
        ),
      );
      if (!check.rows.length) {
        throw new HttpError(403, "هذا الإجراء مخصص لأدمن كشيدة فقط.", "forbidden");
      }
      return {
        userId: String(payload.sub),
        email: payload.email ? String(payload.email) : null,
        jwt,
      };
    },

    async getOverview(admin) {
      const caller = { role: "authenticated", userId: admin.userId };
      const ov = await callRpc(caller, "newsroom_admin_overview", {});
      const orphans = await withDbLock(() =>
        db.query("select public.newsroom_service_orphan_users() as o"),
      );
      return { ...ov, orphanUsers: orphans.rows[0]?.o ?? [] };
    },

    async createOrg(admin, input) {
      const caller = { role: "authenticated", userId: admin.userId };
      return callRpc(caller, "newsroom_admin_create_org", {
        p_name: input.name,
        p_max_sources: input.maxSources,
        p_allow_add: input.allowAdd,
        p_feed_days: input.feedDays,
      });
    },

    async updateOrg(admin, orgId, input) {
      const caller = { role: "authenticated", userId: admin.userId };
      return callRpc(caller, "newsroom_admin_update_org", {
        p_org: orgId,
        p_name: input.name ?? null,
        p_max_sources: input.maxSources ?? null,
        p_allow_add: input.allowAdd ?? null,
        p_feed_days: input.feedDays ?? null,
      });
    },

    async orgExists(orgId) {
      const { rows } = await withDbLock(() =>
        db.query("select exists(select 1 from newsroom.organizations where id = $1) as ok", [orgId]),
      );
      return Boolean(rows[0]?.ok);
    },

    async findAuthUserByEmail(email) {
      const { rows } = await withDbLock(() =>
        db.query("select id, email from auth.users where lower(email) = lower($1)", [email]),
      );
      return rows.length ? { id: String(rows[0].id), email: String(rows[0].email) } : null;
    },

    async createAuthUser(email, password) {
      const id = randomUUID();
      const hashed = hashPassword(password);
      const { rows } = await withDbLock(() =>
        db.query(
          "insert into auth.users(id, email, encrypted_password) values ($1, $2, $3) returning id, email",
          [id, email.toLowerCase(), hashed],
        ),
      );
      return { id: String(rows[0].id), email: String(rows[0].email) };
    },

    async getMembership(userId) {
      const { rows } = await withDbLock(() =>
        db.query("select org_id, role from newsroom.members where user_id = $1", [userId]),
      );
      if (!rows.length) return null;
      return {
        orgId: rows[0].org_id ? String(rows[0].org_id) : null,
        role: String(rows[0].role),
      };
    },

    async assignEditorMembership(userId, orgId) {
      if (typeof hooks.beforeAssignMembership === "function") {
        await hooks.beforeAssignMembership({ userId, orgId });
      }
      await withDbLock(() =>
        db.query(
          "insert into newsroom.members(user_id, org_id, role) values ($1, $2, 'editor')",
          [userId, orgId],
        ),
      );
    },

    async followForOrg(admin, orgId, locator) {
      const caller = { role: "authenticated", userId: admin.userId };
      return callRpc(caller, "newsroom_follow", { p_org: orgId, p_locator: locator });
    },

    async pauseForOrg(admin, orgId, sourceId) {
      const caller = { role: "authenticated", userId: admin.userId };
      await callRpc(caller, "newsroom_pause", { p_org: orgId, p_source: sourceId });
    },

    async cancelRequestForOrg(admin, orgId, locator) {
      const caller = { role: "authenticated", userId: admin.userId };
      await callRpc(caller, "newsroom_cancel_request", { p_org: orgId, p_locator: locator });
    },

    async approveRequestForOrg(admin, orgId, locator, name) {
      const caller = { role: "authenticated", userId: admin.userId };
      return callRpc(caller, "newsroom_admin_resolve_request", {
        p_org: orgId,
        p_locator: locator,
        p_name: name,
        p_native_key: null,
      });
    },

    async renameSource(admin, sourceId, name) {
      const caller = { role: "authenticated", userId: admin.userId };
      return callRpc(caller, "newsroom_admin_rename_source", {
        p_source: sourceId,
        p_name: name,
      });
    },

    async setReferenceDate(admin, referenceAt, label) {
      const caller = { role: "authenticated", userId: admin.userId };
      return callRpc(caller, "newsroom_admin_set_reference", {
        p_reference_at: referenceAt,
        p_label: label,
      });
    },

    getCollectorStore() {
      return collectorStore;
    },

    getSocialApisClient() {
      if (socialApisClientOverride !== undefined) return socialApisClientOverride;
      return createEnvSocialApisClient();
    },
  };

  const server = createServer(async (req, res) => {
    const headers = corsHeaders(req);
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const parsed = new URL(req.url || "/", `http://${host}:${port}`);
    const pathname = parsed.pathname;
    const method = (req.method || "GET").toUpperCase();

    const send = (status, body) => {
      res.writeHead(status, headers);
      res.end(body === null ? "" : JSON.stringify(body));
    };

    try {
      // Health check
      if (method === "GET" && pathname === "/health") {
        send(200, { ok: true, mode: "local-pglite-supabase" });
        return;
      }

      // Public signup disabled!
      if (method === "POST" && pathname === "/auth/v1/signup") {
        send(422, {
          error: "signup_disabled",
          error_description: "Signups not allowed for this instance",
          msg: "Signups not allowed for this instance",
        });
        return;
      }

      // Auth: password & refresh token sign-in
      if (method === "POST" && pathname === "/auth/v1/token") {
        const grantType = parsed.searchParams.get("grant_type");
        const body = await readJsonBody(req);

        if (grantType === "password") {
          const email = String(body.email || "").trim().toLowerCase();
          const password = String(body.password || "");
          const { rows } = await withDbLock(() =>
            db.query(
              "select id, email, encrypted_password, created_at from auth.users where lower(email) = $1",
              [email],
            ),
          );
          if (!rows.length || !verifyPassword(password, rows[0].encrypted_password)) {
            send(400, {
              error: "invalid_grant",
              error_description: "Invalid login credentials",
              msg: "Invalid login credentials",
            });
            return;
          }
          const session = await issueSession(rows[0]);
          send(200, session);
          return;
        }

        if (grantType === "refresh_token") {
          const token = String(body.refresh_token || "");
          const { rows } = await withDbLock(() =>
            db.query(
              `select u.id, u.email, u.created_at
               from auth.refresh_tokens rt
               join auth.users u on u.id = rt.user_id
               where rt.token = $1`,
              [token],
            ),
          );
          if (!rows.length) {
            send(400, {
              error: "invalid_grant",
              error_description: "Invalid refresh token",
            });
            return;
          }
          await withDbLock(() =>
            db.query("delete from auth.refresh_tokens where token = $1", [token]),
          );
          const session = await issueSession(rows[0]);
          send(200, session);
          return;
        }

        send(400, { error: "unsupported_grant_type" });
        return;
      }

      // Auth: GET /auth/v1/user
      if (method === "GET" && pathname === "/auth/v1/user") {
        const caller = await resolveCaller(req);
        if (caller.role !== "authenticated" || !caller.userId) {
          send(401, { error: "not_authenticated", message: "Invalid or expired JWT" });
          return;
        }
        const { rows } = await withDbLock(() =>
          db.query("select id, email, created_at from auth.users where id = $1", [
            caller.userId,
          ]),
        );
        if (!rows.length) {
          send(401, { error: "user_not_found" });
          return;
        }
        send(200, formatAuthUser(rows[0]));
        return;
      }

      // Auth: POST /auth/v1/logout
      if (method === "POST" && pathname === "/auth/v1/logout") {
        const caller = await resolveCaller(req);
        if (caller.role === "authenticated" && caller.userId) {
          await withDbLock(async () => {
            if (caller.jti) {
              await db.query(
                "insert into auth.revoked_jtis(jti) values ($1) on conflict do nothing",
                [caller.jti],
              );
            }
            await db.query("delete from auth.refresh_tokens where user_id = $1", [
              caller.userId,
            ]);
          });
        }
        res.writeHead(204, headers);
        res.end();
        return;
      }

      // Auth Admin API (requires service_role key)
      if (pathname.startsWith("/auth/v1/admin/users")) {
        const caller = await resolveCaller(req);
        if (caller.role !== "service_role") {
          send(403, { error: "not_admin", message: "User not allowed" });
          return;
        }

        if (method === "GET" && pathname === "/auth/v1/admin/users") {
          const { rows } = await withDbLock(() =>
            db.query("select id, email, created_at from auth.users order by created_at asc"),
          );
          send(200, { users: rows.map(formatAuthUser), aud: "authenticated" });
          return;
        }

        if (method === "POST" && pathname === "/auth/v1/admin/users") {
          const body = await readJsonBody(req);
          const email = String(body.email || "").trim().toLowerCase();
          const password = String(body.password || "");
          if (!email || !password) {
            send(422, { msg: "Email and password required" });
            return;
          }
          const existing = await withDbLock(() =>
            db.query("select id from auth.users where lower(email) = $1", [email]),
          );
          if (existing.rows.length > 0) {
            send(422, {
              code: "email_exists",
              msg: "A user with this email address has already been registered",
            });
            return;
          }
          const id = randomUUID();
          const hashed = hashPassword(password);
          const { rows } = await withDbLock(() =>
            db.query(
              "insert into auth.users(id, email, encrypted_password) values ($1, $2, $3) returning id, email, created_at",
              [id, email, hashed],
            ),
          );
          send(200, formatAuthUser(rows[0]));
          return;
        }

        const delMatch = pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
        if (method === "DELETE" && delMatch) {
          await withDbLock(() =>
            db.query("delete from auth.users where id = $1", [delMatch[1]]),
          );
          send(200, {});
          return;
        }

        send(404, { error: "not_found" });
        return;
      }

      // PostgREST RPC endpoint
      const rpcMatch = pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
      if (method === "POST" && rpcMatch) {
        const caller = await resolveCaller(req);
        if (caller.role === "invalid") {
          send(401, { code: "PGRST301", message: "Invalid JWT" });
          return;
        }
        const body = await readJsonBody(req);
        try {
          const result = await callRpc(caller, rpcMatch[1], body);
          send(200, result);
        } catch (err) {
          const mapped = mapPgError(err);
          send(mapped.status, mapped.body);
        }
        return;
      }

      // PostgREST direct table SELECT probe (for testing real RLS on direct REST table access)
      const tableMatch = pathname.match(/^\/rest\/v1\/([a-z_][a-z0-9_]*)$/i);
      if (method === "GET" && tableMatch) {
        const caller = await resolveCaller(req);
        if (caller.role === "invalid") {
          send(401, { code: "PGRST301", message: "Invalid JWT" });
          return;
        }
        const schema = String(req.headers["accept-profile"] || "public").trim();
        const table = tableMatch[1];
        if (!["public", "newsroom"].includes(schema)) {
          send(406, { message: "Invalid schema" });
          return;
        }
        const selectRaw = parsed.searchParams.get("select") || "*";
        const cols =
          selectRaw === "*"
            ? "*"
            : selectRaw
                .split(",")
                .map((c) => c.trim())
                .filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c))
                .join(", ") || "*";
        const whereClauses = [];
        const params = [];
        for (const [k, v] of parsed.searchParams.entries()) {
          if (k === "select" || k === "limit") continue;
          if (!/^[a-z_][a-z0-9_]*$/i.test(k)) continue;
          if (v.startsWith("eq.")) {
            params.push(v.slice(3));
            whereClauses.push(`${k} = $${params.length}`);
          }
        }
        const whereSql = whereClauses.length ? ` where ${whereClauses.join(" and ")}` : "";
        try {
          const rows = await runAsRole(caller, async () => {
            const r = await db.query(
              `select ${cols} from ${schema}.${table}${whereSql} limit 100`,
              params,
            );
            return r.rows;
          });
          send(200, rows);
        } catch (err) {
          const mapped = mapPgError(err);
          send(mapped.status, mapped.body);
        }
        return;
      }

      // Edge Function routes: /functions/v1/admin-api/* & /functions/v1/collect-facebook
      if (
        pathname.startsWith("/functions/v1/admin-api") ||
        pathname === "/functions/v1/collect-facebook"
      ) {
        const subpath =
          pathname === "/functions/v1/collect-facebook"
            ? "/collect-facebook"
            : pathname.slice("/functions/v1/admin-api".length) || "/";
        const body =
          method === "GET" || method === "HEAD" ? {} : await readJsonBody(req);
        const result = await handleAdminRequest(adminBackend, {
          method,
          path: subpath,
          authHeader: req.headers.authorization,
          body,
        });
        send(result.status, result.body);
        return;
      }

      send(404, { error: "Not found", path: pathname });
    } catch (err) {
      send(500, {
        error: err instanceof Error ? err.message : "Internal server error",
      });
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => resolveListen());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;

  return {
    url: baseUrl,
    port: actualPort,
    publishableKey,
    serviceRoleKey,
    db,
    withDbLock,
    async close() {
      await new Promise((r) => server.close(() => r()));
      await db.close();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadLocalEnv();
  const port = Number(process.env.LOCAL_SUPABASE_PORT || 54321);
  const dataDir = resolve(process.cwd(), ".local-supabase/pgdata");
  const instance = await startLocalSupabase({ port, dataDir });
  console.log(`Local Supabase (PGlite) ready at ${instance.url}`);
  console.log(`Data directory: ${dataDir}`);
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
