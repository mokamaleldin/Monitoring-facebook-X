/**
 * Single-command local launcher: starts the local PGlite Supabase server (port 54321)
 * if not already running, then starts Next.js dev server (port 3000).
 */
import { spawn } from "node:child_process";

async function isLocalSupabaseUp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const port = Number(process.env.LOCAL_SUPABASE_PORT || 54321);
const children = [];

if (await isLocalSupabaseUp(port)) {
  console.log(`Local Supabase already running on http://127.0.0.1:${port}`);
} else {
  const supa = spawn(process.execPath, ["scripts/local-supabase.mjs"], {
    stdio: "inherit",
    env: process.env,
  });
  children.push(supa);
  for (let i = 0; i < 30; i += 1) {
    if (await isLocalSupabaseUp(port)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const nextBin = process.platform === "win32" ? "npx.cmd" : "npx";
const nextProc = spawn(nextBin, ["next", "dev"], {
  stdio: "inherit",
  env: process.env,
});
children.push(nextProc);

function cleanup(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));
nextProc.on("exit", (code) => cleanup(code ?? 0));
