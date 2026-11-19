/**
 * Manual, bounded single-cycle Facebook collection CLI.
 * Strict caps: limit=3, maxRequests<=5, maxCredits<=5, 1 page per source, NO cron, NO auto-retry.
 *
 * Usage:
 *   SOCIALAPIS_API_KEY=... node scripts/collect-facebook.mjs --run-key live-check-1
 */
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runBoundedFacebookCollection } from "../server/collector.ts";
import { createSocialApisClient } from "../server/socialapis.ts";
import { createSupabaseCollectorStore } from "../server/supabase-admin-backend.ts";
import { loadLocalEnv } from "./env-loader.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadLocalEnv();
  const apiKey = process.env.SOCIALAPIS_API_KEY?.trim() || "";
  if (!apiKey) {
    console.error(
      "Blocked: SOCIALAPIS_API_KEY is not set. Set SOCIALAPIS_API_KEY in the server environment to run a single bounded Facebook collection cycle (max 5 requests / 5 credits).",
    );
    process.exit(2);
  }
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let runKey = `cli-live-${new Date().toISOString().slice(0, 16)}`;
  let maxRequests = 5;
  let maxCredits = 5;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--run-key" && args[i + 1]) {
      runKey = args[i + 1];
      i += 1;
    } else if (args[i] === "--max-requests" && args[i + 1]) {
      maxRequests = Number(args[i + 1]);
      i += 1;
    } else if (args[i] === "--max-credits" && args[i + 1]) {
      maxCredits = Number(args[i + 1]);
      i += 1;
    }
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await runBoundedFacebookCollection(
    createSupabaseCollectorStore(service),
    createSocialApisClient(apiKey),
    { runKey, maxRequests, maxCredits },
  );
  console.log(JSON.stringify(result, null, 2));
}
