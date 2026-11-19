import { catalog, fixtures, demoSpaces, startingFollows } from "./fixtures.ts";
import type { FollowResult, Post, Snapshot } from "./model.ts";
export type DemoState = Record<string, { follows: Record<string, boolean>; pending: string[] }>;
export function initialDemo(): DemoState {
  return Object.fromEntries(demoSpaces.map(space => [space.id, {
    follows: Object.fromEntries(startingFollows[space.id].map(id => [id, true])), pending: []
  }]));
}
export function readDemo(stored: string | null): DemoState {
  const base = initialDemo();
  if (!stored) return base;
  try {
    const input = JSON.parse(stored);
    for (const space of demoSpaces) {
      const saved = input?.[space.id];
      if (!saved || !Array.isArray(saved.pending) || !saved.follows || typeof saved.follows !== "object") continue;
      for (const source of catalog) {
        if (typeof saved.follows[source.id] === "boolean") base[space.id].follows[source.id] = saved.follows[source.id];
      }
      base[space.id].pending = [...new Set<string>(saved.pending.filter((v: unknown) => typeof v === "string" && /^(facebook:(page|group)|x:account):[a-z0-9_.]+$/.test(v)).slice(0, 10))];
    }
  } catch { /* Discard an obsolete browser fixture and keep the original sample. */ }
  return base;
}
export function snapshotDemo(state: DemoState, org: string): Snapshot {
  const {follows, pending} = state[org];
  const sources = catalog.filter(s => Object.hasOwn(follows, s.id)).map(s => ({ ...s, active: follows[s.id] }));
  const posts: Post[] = [];
  for (const p of fixtures) {
    const visible = p.appearances.filter(a => follows[a.sourceId]);
    if (!visible.length) continue;
    const names = visible.map(a => { const s = catalog.find(s => s.id === a.sourceId)!; return { id: s.id, name: s.name }; });
    posts.push({id:p.id, platform:p.platform, text:p.text, media:p.media, mediaUrl:p.asset,
      originalUrl:null, publishedAt:p.published, seenAt:visible.map(a => a.seen).sort().at(-1)!, sources:names});
  }
  posts.sort((a,b) => b.seenAt.localeCompare(a.seenAt) || a.id.localeCompare(b.id));
  return {sources, pending:[...pending], posts, canAdd:true};
}
export function followDemo(state: DemoState, org: string, locator: string): FollowResult {
  const selection = state[org];
  const s = catalog.find(item => item.locator === locator);
  if (s && selection.follows[s.id]) return "already";
  if (selection.pending.includes(locator)) return "pending";
  if (Object.values(selection.follows).filter(Boolean).length + selection.pending.length >= 10) return "limit";
  if (s) { selection.follows[s.id] = true; return "added"; }
  selection.pending.push(locator);
  return "queued";
}
