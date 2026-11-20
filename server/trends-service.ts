import type {
  ExternalTrendItem,
  ExternalTrendsFeed,
  Post,
  TrendsReport,
} from "../lib/model.ts";
import { analyzeFacebookTrends } from "../lib/trends-engine.ts";

const USER_AGENT = "KashidaResearch/0.1";
const GOOGLE_EG_RSS = "https://trends.google.com/trending/rss?geo=EG";
const GETDAY_EG_URL = "https://getdaytrends.com/egypt/";
const GETDAY_ROBOTS_URL = "https://getdaytrends.com/robots.txt";
const X_OFFICIAL_EG_URL =
  "https://api.x.com/2/trends/by/woeid/23424802?max_trends=20&trend.fields=trend_name,tweet_count";
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_BYTES = 2_000_000;

function decodeHtmlEntities(input: string): string {
  return (input || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .trim();
}

function safeHttps(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "https:" && !u.username && !u.password) return u.href;
  } catch {
    /* ignore */
  }
  return null;
}

export function checkRobotsAllows(
  robotsText: string,
  userAgent: string,
  targetPath: string,
): boolean {
  const ua = userAgent.toLowerCase();
  const lines = robotsText.split(/\r?\n/);
  let applies = false;
  let matchedSpecific = false;
  const disallows: string[] = [];
  const allows: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      const agent = val.toLowerCase();
      if (agent === ua || ua.startsWith(agent + "/")) {
        applies = true;
        matchedSpecific = true;
      } else if (agent === "*" && !matchedSpecific) {
        applies = true;
      } else {
        applies = false;
      }
    } else if (applies && key === "disallow" && val) {
      disallows.push(val);
    } else if (applies && key === "allow" && val) {
      allows.push(val);
    }
  }

  let bestDisallow = -1;
  for (const rule of disallows) {
    if (targetPath.startsWith(rule)) bestDisallow = Math.max(bestDisallow, rule.length);
  }
  let bestAllow = -1;
  for (const rule of allows) {
    if (targetPath.startsWith(rule)) bestAllow = Math.max(bestAllow, rule.length);
  }
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

export function parseGoogleTrendsRss(xmlText: string): ExternalTrendItem[] {
  const items: ExternalTrendItem[] = [];
  const itemMatches = xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);
  const seen = new Set<string>();

  for (const match of itemMatches) {
    if (items.length >= 15) break;
    const block = match[1];
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    const name = decodeHtmlEntities(titleMatch[1]);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const trafficMatch = block.match(
      /<(?:[\w-]+:)?approx_traffic\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?approx_traffic>/i,
    );
    const pubMatch = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i);
    const newsBlockMatch = block.match(
      /<(?:[\w-]+:)?news_item\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?news_item>/i,
    );

    let newsHeadline: string | null = null;
    let newsSource: string | null = null;
    let newsUrl: string | null = null;
    if (newsBlockMatch) {
      const nb = newsBlockMatch[1];
      const nt = nb.match(
        /<(?:[\w-]+:)?news_item_title\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?news_item_title>/i,
      );
      const ns = nb.match(
        /<(?:[\w-]+:)?news_item_source\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?news_item_source>/i,
      );
      const nu = nb.match(
        /<(?:[\w-]+:)?news_item_url\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?news_item_url>/i,
      );
      if (nt) newsHeadline = decodeHtmlEntities(nt[1]) || null;
      if (ns) newsSource = decodeHtmlEntities(ns[1]) || null;
      if (nu) newsUrl = safeHttps(decodeHtmlEntities(nu[1]));
    }

    let publishedAt: string | null = null;
    if (pubMatch) {
      const d = new Date(decodeHtmlEntities(pubMatch[1]));
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }

    items.push({
      rank: items.length + 1,
      name,
      kind: "search_topic",
      platform: "Google",
      trafficLabel: trafficMatch ? decodeHtmlEntities(trafficMatch[1]) : null,
      publishedAt,
      newsHeadline,
      newsSource,
      newsUrl,
      url: `https://trends.google.com/trends/explore?geo=EG&q=${encodeURIComponent(name)}`,
    });
  }

  if (!items.length) {
    throw new Error("لم يرجع Google Trends RSS أي موضوعات حاليًا.");
  }
  return items;
}

export function parseGetDayTrendsEgypt(htmlText: string): ExternalTrendItem[] {
  const h1Match = htmlText.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Clean = h1Match
    ? decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, " ")).toLowerCase()
    : "";
  if (!h1Clean.includes("egypt")) {
    throw new Error("تعذّر التحقق من عنوان دولة مصر في مصدر ترندات X.");
  }

  const tableMatch = htmlText.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) {
    throw new Error("تغيّرت بنية صفحة ترندات X العامة أو لم تُعد نتائج.");
  }

  const items: ExternalTrendItem[] = [];
  const seen = new Set<string>();
  const anchorMatches = tableMatch[1].matchAll(
    /<a\b[^>]*href=["']([^"']*\/trend\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  );

  for (const m of anchorMatches) {
    if (items.length >= 15) break;
    const rawName = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, " "));
    if (!rawName || seen.has(rawName.toLowerCase())) continue;
    seen.add(rawName.toLowerCase());
    items.push({
      rank: items.length + 1,
      name: rawName,
      kind: rawName.startsWith("#") ? "hashtag" : "topic",
      platform: "X",
      url: `https://x.com/search?q=${encodeURIComponent(rawName)}`,
    });
  }

  if (!items.length) {
    throw new Error("لم تُعد صفحة ترندات X لمصر أي عناصر.");
  }
  return items;
}

async function fetchBoundedText(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<string> {
  const response = await fetchFn(url, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error("تجاوز حجم الرد الحد المسموح.");
  }
  return new TextDecoder("utf-8").decode(buf);
}

async function fetchEgyptXTrends(
  fetchFn: typeof fetch,
): Promise<ExternalTrendsFeed> {
  const token = (process.env.X_BEARER_TOKEN || "").trim();
  const fetchedAt = new Date().toISOString();

  if (token) {
    try {
      const raw = await fetchBoundedText(
        X_OFFICIAL_EG_URL,
        { Authorization: `Bearer ${token}` },
        fetchFn,
      );
      const parsed = JSON.parse(raw) as {
        data?: { trend_name?: string; tweet_count?: number }[];
      };
      if (!Array.isArray(parsed.data)) {
        throw new Error("صيغة رد X API غير متوقعة.");
      }
      const items: ExternalTrendItem[] = parsed.data
        .filter((r) => typeof r.trend_name === "string" && r.trend_name.trim())
        .slice(0, 15)
        .map((r, idx) => {
          const name = r.trend_name!.trim();
          return {
            rank: idx + 1,
            name,
            kind: name.startsWith("#") ? "hashtag" : "topic",
            platform: "X",
            tweetCount:
              typeof r.tweet_count === "number" ? r.tweet_count : null,
            url: `https://x.com/search?q=${encodeURIComponent(name)}`,
          };
        });
      return {
        platform: "X",
        provider: "X API الرسمي (مصر)",
        coverage: "official_country_trends",
        country: "EG",
        url: "https://x.com/explore/tabs/trending",
        fetchedAt,
        items,
        error: null,
      };
    } catch (err) {
      return {
        platform: "X",
        provider: "X API الرسمي (مصر)",
        coverage: "official_country_trends",
        country: "EG",
        url: "https://x.com/explore/tabs/trending",
        fetchedAt,
        items: [],
        error:
          err instanceof Error
            ? `تعذّر جلب ترندات X الرسمية: ${err.message}`
            : "تعذّر جلب ترندات X.",
      };
    }
  }

  try {
    const robots = await fetchBoundedText(GETDAY_ROBOTS_URL, {}, fetchFn);
    if (!checkRobotsAllows(robots, USER_AGENT, "/egypt/")) {
      throw new Error("قواعد robots.txt لا تسمح بالوصول الآلي حاليًا.");
    }
    const html = await fetchBoundedText(GETDAY_EG_URL, {}, fetchFn);
    const items = parseGetDayTrendsEgypt(html);
    return {
      platform: "X",
      provider: "GetDayTrends (قائمة مصر العامة)",
      coverage: "third_party_country_list",
      country: "EG",
      url: GETDAY_EG_URL,
      fetchedAt,
      items,
      error: null,
    };
  } catch (err) {
    return {
      platform: "X",
      provider: "GetDayTrends (قائمة مصر العامة)",
      coverage: "third_party_country_list",
      country: "EG",
      url: GETDAY_EG_URL,
      fetchedAt,
      items: [],
      error:
        err instanceof Error
          ? `ترندات X لمصر غير متاحة حاليًا (${err.message}).`
          : "ترندات X لمصر غير متاحة حاليًا.",
    };
  }
}

async function fetchEgyptGoogleTrends(
  fetchFn: typeof fetch,
): Promise<ExternalTrendsFeed> {
  const fetchedAt = new Date().toISOString();
  try {
    const xml = await fetchBoundedText(GOOGLE_EG_RSS, {}, fetchFn);
    const items = parseGoogleTrendsRss(xml);
    return {
      platform: "Google",
      provider: "Google Trends RSS الرسمي (مصر)",
      coverage: "country_search_interest",
      country: "EG",
      url: "https://trends.google.com/trending?geo=EG",
      fetchedAt,
      items,
      error: null,
    };
  } catch (err) {
    return {
      platform: "Google",
      provider: "Google Trends RSS الرسمي (مصر)",
      coverage: "country_search_interest",
      country: "EG",
      url: "https://trends.google.com/trending?geo=EG",
      fetchedAt,
      items: [],
      error:
        err instanceof Error
          ? `عمليات بحث Google لمصر غير متاحة حاليًا (${err.message}).`
          : "عمليات بحث Google لمصر غير متاحة حاليًا.",
    };
  }
}

let cachedExternal: {
  expiresAt: number;
  x: ExternalTrendsFeed;
  google: ExternalTrendsFeed;
} | null = null;

export function clearTrendsCache(): void {
  cachedExternal = null;
}

export async function fetchEgyptExternalTrends(
  options: { forceRefresh?: boolean; fetchFn?: typeof fetch } = {},
): Promise<{
  cached: boolean;
  x: ExternalTrendsFeed;
  google: ExternalTrendsFeed;
}> {
  const now = Date.now();
  const useCustomFetch = Boolean(options.fetchFn);
  if (
    !useCustomFetch &&
    !options.forceRefresh &&
    cachedExternal &&
    cachedExternal.expiresAt > now
  ) {
    return {
      cached: true,
      x: cachedExternal.x,
      google: cachedExternal.google,
    };
  }

  const fetchFn = options.fetchFn || fetch;
  const [x, google] = await Promise.all([
    fetchEgyptXTrends(fetchFn),
    fetchEgyptGoogleTrends(fetchFn),
  ]);

  if (!useCustomFetch) {
    cachedExternal = {
      expiresAt: now + CACHE_TTL_MS,
      x,
      google,
    };
  }
  return { cached: false, x, google };
}

export async function buildTenantTrendsReport(input: {
  posts: Post[];
  referenceAt?: string | null;
  referenceLabel?: string | null;
  forceRefresh?: boolean;
  fetchFn?: typeof fetch;
}): Promise<TrendsReport> {
  const { cached, x, google } = await fetchEgyptExternalTrends({
    forceRefresh: input.forceRefresh,
    fetchFn: input.fetchFn,
  });

  const externalSignals: ExternalTrendItem[] = [...x.items, ...google.items];
  const facebook = analyzeFacebookTrends(input.posts, externalSignals, {
    country: "EG",
    maxTopics: 15,
    maxHashtags: 15,
    referenceAt: input.referenceAt ?? null,
    referenceLabel: input.referenceLabel ?? null,
  });

  return {
    country: "EG",
    generatedAt: new Date().toISOString(),
    cached,
    facebook,
    x,
    google,
  };
}
