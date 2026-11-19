import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { handleAdminRequest } from "./admin-service.ts";
import { createSupabaseAdminBackend } from "./supabase-admin-backend.ts";

function corsHeaders(origin: string | undefined, allowedOrigin: string) {
  const allow =
    allowedOrigin === "*"
      ? origin || "*"
      : allowedOrigin
          .split(",")
          .map((s) => s.trim())
          .includes(origin || "")
        ? origin!
        : allowedOrigin.split(",")[0].trim();
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 1_000_000) throw new Error("Request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

export function createAdminHttpServer(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  publishableKey?: string;
  corsOrigin?: string;
}) {
  const backend = createSupabaseAdminBackend({
    supabaseUrl: options.supabaseUrl,
    serviceRoleKey: options.serviceRoleKey,
    publishableKey: options.publishableKey,
  });
  const allowedOrigin = options.corsOrigin || "*";

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const headers = corsHeaders(req.headers.origin, allowedOrigin);
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const parsed = new URL(req.url || "/", "http://localhost");
    let subpath = parsed.pathname;
    if (subpath.startsWith("/functions/v1/admin-api")) {
      subpath = subpath.slice("/functions/v1/admin-api".length) || "/";
    } else if (subpath.startsWith("/admin-api")) {
      subpath = subpath.slice("/admin-api".length) || "/";
    } else if (
      subpath === "/functions/v1/collect-facebook" ||
      subpath === "/collect-facebook"
    ) {
      subpath = "/collect-facebook";
    }

    let body: unknown = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        body = await readJsonBody(req);
      } catch {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ error: "صيغة JSON غير صالحة.", code: "bad_json" }));
        return;
      }
    }

    const result = await handleAdminRequest(backend, {
      method: req.method || "GET",
      path: subpath,
      authHeader: req.headers.authorization,
      body,
    });

    res.writeHead(result.status, headers);
    res.end(JSON.stringify(result.body));
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    "";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  const port = Number(process.env.ADMIN_API_PORT || process.env.PORT || 8787);

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const server = createAdminHttpServer({
    supabaseUrl,
    serviceRoleKey,
    publishableKey,
    corsOrigin: process.env.CORS_ORIGIN || "*",
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Kashida Admin API listening on http://127.0.0.1:${port}`);
  });
}
