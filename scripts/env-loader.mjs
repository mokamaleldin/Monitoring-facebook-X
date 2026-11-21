import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads key=value pairs from .env.local (if present) into process.env
 * without overwriting variables already set in the environment.
 * Never logs values.
 */
export function loadLocalEnv(cwd = process.cwd()) {
  const candidates = [resolve(cwd, ".env.local")];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Z0-9_]+$/i.test(key)) continue;
      if (process.env[key] !== undefined && process.env[key] !== "") continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
