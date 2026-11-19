export type Platform = "facebook" | "x";
export type Media = "text" | "photo" | "video";
export type Role = "editor" | "platform_admin";
export type Space = { id: string; name: string; role: Role };
export type Source = {
  id: string;
  name: string;
  platform: Platform;
  kind: "page" | "group" | "account";
  locator: string;
};
export type Subscription = Source & { active: boolean };
export type Post = {
  id: string;
  platform: Platform;
  text: string;
  media: Media;
  mediaUrl: string | null;
  originalUrl: string | null;
  publishedAt: string | null;
  seenAt: string;
  sources: { id: string; name: string }[];
};
export type Snapshot = {
  sources: Subscription[];
  pending: string[];
  posts: Post[];
  canAdd: boolean;
};
export type FollowResult =
  "added" | "already" | "pending" | "queued" | "limit" | "disabled";
export const platformName = { facebook: "فيسبوك", x: "X" };
export const mediaName = { text: "نص", photo: "صورة", video: "فيديو" };
export const resultText: Record<FollowResult, string> = {
  added: "بدأت المتابعة",
  already: "متابَع بالفعل",
  pending: "قيد التحقق بالفعل",
  queued: "أُرسل للتحقق من المصدر العام",
  limit: "اكتمل عدد المصادر المتاحة للجهة",
  disabled: "إضافة المصادر موقوفة لهذه الجهة",
};

const reservedFacebook = new Set([
  "profile.php",
  "pages",
  "groups",
  "home.php",
  "watch",
  "reel",
  "login",
  "events",
  "marketplace",
  "share",
  "photo",
  "photo.php",
  "permalink.php",
  "story.php",
  "facebook",
  "help",
  "me",
  "gaming",
]);
const reservedX = new Set([
  "home",
  "search",
  "explore",
  "i",
  "settings",
  "messages",
  "notifications",
  "intent",
  "share",
  "compose",
  "login",
  "logout",
  "hashtag",
]);
export function parseSource(raw: string): string | null {
  try {
    const value = raw.trim();
    if (!value || value.length > 500 || /[\\\s]/u.test(value)) return null;
    const url = new URL(/^[a-z]+:/i.test(value) ? value : "https://" + value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/$/, "").toLowerCase();
    if (host === "facebook.com" || host === "m.facebook.com") {
      const group = path.match(/^\/groups\/([0-9]{1,32})$/);
      if (group) return "facebook:group:" + group[1];
      const page = path.match(/^\/([a-z0-9.]{2,75})$/);
      if (page && !reservedFacebook.has(page[1]))
        return "facebook:page:" + page[1];
    }
    if (host === "twitter.com" || host === "x.com") {
      const account = path.match(/^\/([a-z0-9_]{1,15})$/);
      if (account && !reservedX.has(account[1]))
        return "x:account:" + account[1];
    }
  } catch {
    return null;
  }
  return null;
}
export function sourceUrl(locator: string): string {
  const [platform, kind, key] = locator.split(":");
  if (platform === "x") return "https://x.com/" + key;
  return (
    "https://www.facebook.com/" + (kind === "group" ? "groups/" : "") + key
  );
}
export function foldArabic(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670\u0640]/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .trim();
}
export function filterPosts(
  posts: Post[],
  platform: Platform,
  media: Media | "all",
  sourceId: string,
  query: string,
): Post[] {
  const needle = foldArabic(query);
  return posts.filter(
    (post) =>
      post.platform === platform &&
      (media === "all" || post.media === media) &&
      (!sourceId || post.sources.some((s) => s.id === sourceId)) &&
      (!needle ||
        foldArabic(
          [post.text, ...post.sources.map((s) => s.name)].join(" "),
        ).includes(needle)),
  );
}
const cairo = new Intl.DateTimeFormat("ar-EG", {
  timeZone: "Africa/Cairo",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export function cairoTime(value: string | null): string {
  return value ? cairo.format(new Date(value)) : "غير متاح";
}
