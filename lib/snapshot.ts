import {
  parseSource,
  type Engagement,
  type Media,
  type MediaItem,
  type Platform,
} from "./model.ts";

export const MAZID_ORG_ID = "10000000-0000-4000-9000-000000000001";
export const RASD_ORG_ID = "10000000-0000-4000-9000-000000000002";

export const LEGACY_SOURCE_UUIDS: Record<string, string> = {
  youm7: "20000000-0000-4000-9000-000000000001",
  mazid: "20000000-0000-4000-9000-000000000002",
  rassd: "20000000-0000-4000-9000-000000000003",
  "group-783": "20000000-0000-4000-9000-000000000005",
  "group-230": "20000000-0000-4000-9000-000000000006",
};

export const X_YOUM7_SOURCE = {
  id: "20000000-0000-4000-9000-000000000004",
  legacyId: "x-youm7",
  name: "اليوم السابع",
  platform: "x" as Platform,
  kind: "account" as const,
  nativeKey: "youm7",
  locator: "x:account:youm7",
};

export const SNAPSHOT_SUBSCRIPTIONS: Record<string, string[]> = {
  [MAZID_ORG_ID]: [
    LEGACY_SOURCE_UUIDS.youm7,
    LEGACY_SOURCE_UUIDS.mazid,
    LEGACY_SOURCE_UUIDS["group-783"],
  ],
  [RASD_ORG_ID]: [
    LEGACY_SOURCE_UUIDS.youm7,
    LEGACY_SOURCE_UUIDS.rassd,
    LEGACY_SOURCE_UUIDS["group-230"],
  ],
};

export type NormalizedSnapshotSource = {
  id: string;
  legacyId: string;
  name: string;
  platform: Platform;
  kind: "page" | "group" | "account";
  nativeKey: string;
  locator: string;
};

export type NormalizedSnapshotPost = {
  platform: Platform;
  nativeKey: string;
  sourceId: string;
  legacySourceId: string;
  text: string;
  media: Media;
  rawMediaType: string;
  mediaUrl: string | null;
  mediaItems: MediaItem[];
  originalUrl: string | null;
  publishedAt: string | null;
  seenAt: string;
  engagement: Engagement | null;
  sharedPost: boolean | null;
  timeOrigin: string | null;
  timeSemanticsVerified: boolean | null;
};

export type ParsedSnapshot = {
  collectedOnUtc: string | null;
  referenceAt: string | null;
  sources: NormalizedSnapshotSource[];
  posts: NormalizedSnapshotPost[];
};

function safeHttpsUrl(value: unknown, allowedRoots: string[]): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return null;
    const host = parsed.hostname.toLowerCase();
    if (
      allowedRoots.some((root) => host === root || host.endsWith("." + root))
    ) {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean")
    return null;
  const n = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : value.trim();
}

function mapMediaCategory(raw: unknown, items: MediaItem[]): Media {
  const s = String(raw ?? "").toLowerCase();
  if (s === "video") return "video";
  if (s === "photo" || s === "image") return "photo";
  if (items.some((m) => m.type === "video")) return "video";
  if (items.some((m) => m.type === "photo")) return "photo";
  return "text";
}

export function parseSnapshotPayload(raw: unknown): ParsedSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new Error("Snapshot payload must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.sources) || !Array.isArray(obj.posts)) {
    throw new Error("Snapshot payload must contain sources[] and posts[]");
  }

  const collectedOnUtc =
    typeof obj.collected_on_utc === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(obj.collected_on_utc)
      ? obj.collected_on_utc
      : null;

  const sourceByLegacyId = new Map<string, NormalizedSnapshotSource>();
  const sources: NormalizedSnapshotSource[] = [];

  for (const item of obj.sources) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const legacyId = String(s.id ?? "").trim();
    const url = String(s.url ?? "").trim();
    const locator = parseSource(url);
    if (!legacyId || !locator) {
      throw new Error(`Invalid snapshot source entry: ${legacyId || url}`);
    }
    const [platformRaw, kindRaw, keyPart] = locator.split(":");
    const platform = platformRaw as Platform;
    const kind = kindRaw as "page" | "group" | "account";
    const id = LEGACY_SOURCE_UUIDS[legacyId];
    if (!id) {
      throw new Error(`Unmapped legacy source id: ${legacyId}`);
    }
    const rawName = typeof s.name === "string" ? s.name.trim() : "";
    const name =
      rawName || (kind === "group" ? `جروب Facebook ${keyPart}` : keyPart);
    const normalized: NormalizedSnapshotSource = {
      id,
      legacyId,
      name,
      platform,
      kind,
      nativeKey: keyPart,
      locator,
    };
    sourceByLegacyId.set(legacyId, normalized);
    sources.push(normalized);
  }

  const seenPostIds = new Set<string>();
  const posts: NormalizedSnapshotPost[] = [];

  for (const item of obj.posts) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const legacySourceId = String(p.source_id ?? "").trim();
    const source = sourceByLegacyId.get(legacySourceId);
    if (!source) {
      throw new Error(
        `Post references unknown source_id: ${legacySourceId}`,
      );
    }
    const nativeKey = String(p.id ?? "").trim();
    if (!nativeKey) {
      throw new Error("Snapshot post missing id");
    }

    const platformRaw = String(p.platform ?? "facebook").toLowerCase();
    const platform: Platform = platformRaw === "x" ? "x" : "facebook";

    const dedupeKey = `${platform}:${nativeKey}`;
    if (seenPostIds.has(dedupeKey)) continue;
    seenPostIds.add(dedupeKey);

    const mediaItems: MediaItem[] = [];
    if (Array.isArray(p.media)) {
      for (const m of p.media) {
        if (!m || typeof m !== "object") continue;
        const entry = m as Record<string, unknown>;
        const mType = entry.type === "video" ? "video" : "photo";
        const mUrl = safeHttpsUrl(entry.url, ["fbcdn.net", "fbsbx.com"]);
        if (mUrl) mediaItems.push({ type: mType, url: mUrl });
      }
    }

    const rawMediaType = String(p.media_type ?? "text").toLowerCase();
    const media = mapMediaCategory(rawMediaType, mediaItems);
    const matchingMedia = mediaItems.find((m) => m.type === media);
    const mediaUrl = matchingMedia ? matchingMedia.url : null;

    const originalUrl = safeHttpsUrl(p.url, ["facebook.com", "fb.watch"]);
    const publishedAt = normalizeIsoTimestamp(p.published_at);
    const seenAt = normalizeIsoTimestamp(p.collected_at);
    if (!seenAt) {
      throw new Error(`Snapshot post ${nativeKey} missing valid collected_at`);
    }

    const rawEng =
      p.engagement && typeof p.engagement === "object"
        ? (p.engagement as Record<string, unknown>)
        : null;
    const engagement: Engagement | null = rawEng
      ? {
          reactions: nullableInt(rawEng.reactions),
          comments: nullableInt(rawEng.comments),
          shares: nullableInt(rawEng.shares),
          views: nullableInt(rawEng.views),
        }
      : null;

    posts.push({
      platform,
      nativeKey,
      sourceId: source.id,
      legacySourceId,
      text: typeof p.text === "string" ? p.text : "",
      media,
      rawMediaType,
      mediaUrl,
      mediaItems,
      originalUrl,
      publishedAt,
      seenAt,
      engagement,
      sharedPost: typeof p.shared_post === "boolean" ? p.shared_post : null,
      timeOrigin: typeof p.time_origin === "string" ? p.time_origin : null,
      timeSemanticsVerified:
        typeof p.time_semantics_verified === "boolean"
          ? p.time_semantics_verified
          : null,
    });
  }

  const referenceAt = collectedOnUtc
    ? `${collectedOnUtc}T23:59:59+00:00`
    : null;

  return { collectedOnUtc, referenceAt, sources, posts };
}
