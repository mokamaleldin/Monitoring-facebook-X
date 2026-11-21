import type { Engagement, Media, MediaItem } from "../lib/model.ts";

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export class TransportError extends ProviderError {
  status: number | null;
  uncertain: boolean;

  constructor(status: number | null = null, message?: string) {
    super(
      message ||
        (status
          ? `HTTP ${status}`
          : "Network error; delivery and billing outcome are uncertain"),
    );
    this.name = "TransportError";
    this.status = status;
    this.uncertain = status === null || status >= 500;
  }
}

export function safeUrl(value: unknown, media = false): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const roots = media
      ? ["fbcdn.net", "fbsbx.com"]
      : ["facebook.com", "fb.watch"];
    if (roots.some((r) => host === r || host.endsWith("." + r))) {
      return u.href;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseIsoUtc(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/Z$/i, "+00:00");
  // Require explicit timezone offset to avoid naive local-time misinterpretation
  if (!/(?:[+-]\d{2}:?\d{2})$/.test(normalized)) return null;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseNullableInt(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }
  const cleaned = String(value).replaceAll(",", "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

export function extractMedia(post: Record<string, unknown>): MediaItem[] {
  const found: MediaItem[] = [];
  const seen = new Set<string>();

  function walk(node: unknown, key = "", depth = 0): void {
    if (depth > 12 || found.length >= 20 || node === null || node === undefined)
      return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 50)) walk(item, key, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, k, depth + 1);
      }
      return;
    }
    if (typeof node === "string") {
      if (node.startsWith("{")) {
        try {
          walk(JSON.parse(node), key, depth + 1);
        } catch {
          /* ignore non-JSON strings */
        }
      }
      const url = safeUrl(node, true);
      if (url && !seen.has(url)) {
        seen.add(url);
        const lowerKey = key.toLowerCase();
        const isVideo =
          ["video", "playable", "browser_native", "hd_src", "sd_src"].some(
            (token) => lowerKey.includes(token),
          ) || new URL(url).pathname.toLowerCase().includes(".mp4");
        found.push({ type: isVideo ? "video" : "photo", url });
      }
    }
  }

  walk(post.attachments);
  const values =
    post.values && typeof post.values === "object"
      ? (post.values as Record<string, unknown>)
      : {};
  walk(values.photo_image, "photo_image");
  for (const key of ["video_url", "playable_url", "video_hd_url", "video_sd_url"]) {
    walk(values[key], key);
  }
  return found.slice(0, 20);
}

export type NormalizedProviderPost = {
  platform: "facebook";
  nativeKey: string;
  sourceId: string;
  text: string;
  missingText: boolean;
  media: Media;
  rawMediaType: string;
  mediaUrl: string | null;
  mediaItems: MediaItem[];
  originalUrl: string;
  publishedAt: string | null;
  seenAt: string;
  engagement: Engagement;
  sharedPost: boolean;
  timeOrigin: string;
  timeSemanticsVerified: boolean;
};

export function normalizeFacebookPost(
  rawPost: unknown,
  sourceId: string,
  collectedAt: string,
): NormalizedProviderPost {
  if (!rawPost || typeof rawPost !== "object") {
    throw new ProviderError("Post entry is not an object");
  }
  const post = rawPost as Record<string, unknown>;
  const details =
    post.details && typeof post.details === "object"
      ? (post.details as Record<string, unknown>)
      : {};
  const values =
    post.values && typeof post.values === "object"
      ? (post.values as Record<string, unknown>)
      : {};
  const reactions =
    post.reactions && typeof post.reactions === "object"
      ? (post.reactions as Record<string, unknown>)
      : {};

  const ident = details.post_id ?? values.post_id;
  const originalUrl = safeUrl(details.post_link, false);
  if (ident === null || ident === undefined || !String(ident).trim() || !originalUrl) {
    throw new ProviderError("Post missing stable id or valid Facebook permalink");
  }

  const rawText = typeof values.text === "string" ? values.text : "";
  const mediaItems = extractMedia(post);
  const declared = String(values.is_media ?? "").toLowerCase();

  let rawMediaType: string;
  if (
    mediaItems.some((m) => m.type === "video") ||
    declared.includes("video") ||
    declared.includes("reel")
  ) {
    rawMediaType = "video";
  } else if (
    mediaItems.length > 0 ||
    declared.includes("photo") ||
    declared.includes("image")
  ) {
    rawMediaType = "photo";
  } else if (declared.includes("link")) {
    rawMediaType = "link";
  } else if (rawText.trim()) {
    rawMediaType = "text";
  } else {
    rawMediaType = "unknown";
  }

  const media: Media =
    rawMediaType === "video"
      ? "video"
      : rawMediaType === "photo"
        ? "photo"
        : "text";

  const matchingMedia = mediaItems.find((m) => m.type === media);
  const publishedAt = parseIsoUtc(values.publish_time);

  return {
    platform: "facebook",
    nativeKey: String(ident).trim(),
    sourceId,
    text: rawText,
    missingText: !rawText.trim(),
    media,
    rawMediaType,
    mediaUrl: matchingMedia ? matchingMedia.url : null,
    mediaItems,
    originalUrl,
    publishedAt,
    seenAt: collectedAt,
    engagement: {
      reactions: parseNullableInt(reactions.total_reaction_count),
      comments: parseNullableInt(details.comments_count),
      shares: parseNullableInt(details.share_count),
      views: parseNullableInt(details.play_count),
    },
    sharedPost: Boolean(values.shared_post),
    timeOrigin: "provider.values.publish_time",
    timeSemanticsVerified: false,
  };
}

export type ProviderUsage = {
  creditsUsed: number | null;
  creditsRemaining: number | null;
  creditsLimit: number | null;
};

export type SourcePostsResponse = {
  posts: unknown[];
  hasNext: boolean;
  creditsCharged: number | null;
  creditsRemaining: number | null;
  creditsUncertain: boolean;
  httpStatus: number;
};

export interface SocialApisClient {
  getUsage(): Promise<ProviderUsage>;
  fetchFacebookPosts(params: {
    kind: "page" | "group";
    url: string;
    afterDate: string;
    limit: 3;
  }): Promise<SourcePostsResponse>;
}

const MAX_RESPONSE_BYTES = 5_000_000;
const REQUEST_TIMEOUT_MS = 40_000;

async function readBoundedJson(
  url: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<{ data: Record<string, unknown>; headers: Headers; status: number }> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "x-api-token": token,
        "User-Agent": "Kashida-Monitor/1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TransportError(null);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new TransportError(response.status, `Unexpected redirect HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new TransportError(response.status);
  }

  let buf: ArrayBuffer;
  try {
    buf = await response.arrayBuffer();
  } catch {
    throw new TransportError(null);
  }
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    throw new ProviderError("Response exceeds 5 MB limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(buf));
  } catch {
    throw new ProviderError("Response is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderError("Expected a JSON object");
  }
  return {
    data: parsed as Record<string, unknown>,
    headers: response.headers,
    status: response.status,
  };
}

export function createSocialApisClient(
  token: string,
  options: { baseUrl?: string; fetchFn?: typeof fetch } = {},
): SocialApisClient {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new ProviderError("SOCIALAPIS_API_KEY is required");
  }
  const baseUrl = (options.baseUrl || "https://api.socialapis.io").replace(
    /\/$/,
    "",
  );
  const fetchFn = options.fetchFn || fetch;

  return {
    async getUsage(): Promise<ProviderUsage> {
      const { data } = await readBoundedJson(
        `${baseUrl}/usage`,
        cleanToken,
        fetchFn,
      );
      const block =
        data.data && typeof data.data === "object"
          ? (data.data as Record<string, unknown>)
          : data;
      return {
        creditsUsed: parseNullableInt(block.creditsUsed),
        creditsRemaining: parseNullableInt(block.creditsRemaining),
        creditsLimit: parseNullableInt(block.creditsLimit),
      };
    },

    async fetchFacebookPosts({
      kind,
      url,
      afterDate,
      limit,
    }): Promise<SourcePostsResponse> {
      if (limit !== 3) {
        throw new ProviderError("Bounded collection fixes limit=3");
      }
      const endpoint =
        kind === "page" ? "/facebook/pages/posts" : "/facebook/groups/posts";
      const qs = new URLSearchParams({
        link: url,
        limit: "3",
        after_time: afterDate,
        timezone: "UTC",
      });
      const { data, headers, status } = await readBoundedJson(
        `${baseUrl}${endpoint}?${qs.toString()}`,
        cleanToken,
        fetchFn,
      );
      const meta =
        data.meta && typeof data.meta === "object"
          ? (data.meta as Record<string, unknown>)
          : {};
      const deducted =
        parseNullableInt(meta.creditsCharged) ??
        parseNullableInt(headers.get("x-socialapis-credits-deducted"));
      const remaining =
        parseNullableInt(meta.creditsRemaining) ??
        parseNullableInt(headers.get("x-socialapis-credits-remaining"));
      const creditsUncertain = deducted === null;

      const block = data.data;
      if (
        !block ||
        typeof block !== "object" ||
        !Array.isArray((block as Record<string, unknown>).posts)
      ) {
        throw new ProviderError(
          "Provider response schema does not contain data.posts list",
        );
      }
      const dataObj = block as Record<string, unknown>;
      const pageInfo =
        dataObj.page_info && typeof dataObj.page_info === "object"
          ? (dataObj.page_info as Record<string, unknown>)
          : {};

      return {
        posts: dataObj.posts as unknown[],
        hasNext: Boolean(pageInfo.has_next),
        creditsCharged: deducted,
        creditsRemaining: remaining,
        creditsUncertain,
        httpStatus: status,
      };
    },
  };
}
