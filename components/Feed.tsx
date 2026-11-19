import { useState } from "react";
import {
  cairoTime,
  filterPosts,
  mediaName,
  platformName,
  sourceUrl,
  type Media,
  type Platform,
  type Post,
  type Snapshot,
} from "../lib/model";

const options = [
  ["all", "الكل"],
  ["text", "نصوص"],
  ["photo", "صور"],
  ["video", "فيديوهات"],
] as const;
function safeLink(value: string | null, local = false) {
  if (!value) return undefined;
  if (local && /^\/demo\/[\w.-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {}
  return undefined;
}
function Article({ post, fallbackUrl }: { post: Post; fallbackUrl?: string }) {
  const [broken, setBroken] = useState(false);
  const media = safeLink(post.mediaUrl, true);
  const original = safeLink(post.originalUrl);
  return (
    <article className="story">
      <div className="byline">
        <span className="source-avatar" aria-hidden>
          {post.sources[0].name.charAt(0)}
        </span>
        <div>
          <strong>{post.sources.map((s) => s.name).join(" · ")}</strong>
          <div className="observed">
            رُصد <time dateTime={post.seenAt}>{cairoTime(post.seenAt)}</time>
          </div>
        </div>
        <span className="kind">{mediaName[post.media]}</span>
      </div>
      <p className="story-body">{post.text || "منشور وسائط"}</p>
      {media && !broken && post.media === "photo" && (
        <img
          className="story-media"
          src={media}
          alt="الصورة المرفقة بالمنشور"
          width={media === "/demo/program.png" ? 900 : undefined}
          height={media === "/demo/program.png" ? 300 : undefined}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      )}
      {media && !broken && post.media === "video" && (
        <video
          className="story-media"
          aria-label="الفيديو المرفق بالمنشور"
          controls
          playsInline
          preload="none"
          onError={() => setBroken(true)}
          src={media}
        />
      )}
      {post.media !== "text" && (broken || !media) && (
        <p className="minor">معاينة الوسائط غير متاحة.</p>
      )}
      <div className="story-foot">
        <details>
          <summary>تفاصيل المنشور</summary>
          <dl>
            <dt>وقت النشر</dt>
            <dd>{cairoTime(post.publishedAt)}</dd>
            <dt>وقت الرصد</dt>
            <dd>{cairoTime(post.seenAt)}</dd>
            <dt>المنصة</dt>
            <dd>{platformName[post.platform]}</dd>
          </dl>
        </details>
        {(original || fallbackUrl) && (
          <a
            href={original || fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {original ? "فتح المنشور الأصلي" : "صفحة المصدر"}
          </a>
        )}
      </div>
    </article>
  );
}
export function Feed({
  data,
  openSources,
}: {
  data: Snapshot;
  openSources: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [media, setMedia] = useState<Media | "all">("all");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const active = data.sources.filter(
    (s) => s.active && s.platform === platform,
  );
  const matches = filterPosts(data.posts, platform, media, source, query);
  return (
    <>
      <div className="filter-card">
        <div className="filter-row">
          <div className="platforms" role="group" aria-label="المنصة">
            {(["facebook", "x"] as const).map((p) => (
              <button
                aria-pressed={platform === p}
                key={p}
                onClick={() => {
                  setPlatform(p);
                  setSource("");
                  setMedia("all");
                }}
              >
                {platformName[p]}
              </button>
            ))}
          </div>
          <div className="media-tabs" role="group" aria-label="نوع المحتوى">
            {options.map(([id, name]) => (
              <button
                key={id}
                aria-pressed={media === id}
                onClick={() => setMedia(id)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="search-row">
          <label className="search">
            <span aria-hidden>⌕</span>
            <input
              type="search"
              aria-label="بحث في الأخبار"
              placeholder="ابحث في الأخبار أو باسم المصدر"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="فلتر المصدر"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">كل المصادر</option>
            {active.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="feed-grid">
        <section aria-label="المنشورات">
          <div className="section-row">
            <h2>أحدث المنشورات</h2>
            <span aria-live="polite">
              عدد المنشورات {matches.length.toLocaleString("ar-EG")}
            </span>
          </div>
          {matches.length ? (
            matches.map((p) => {
              const s = active.find((s) => s.id === p.sources[0].id);
              return (
                <Article
                  key={p.id}
                  post={p}
                  fallbackUrl={s ? sourceUrl(s.locator) : undefined}
                />
              );
            })
          ) : (
            <div className="empty">
              <h3>لا توجد منشورات هنا</h3>
              <p>
                {active.length
                  ? "جرّب تغيير البحث أو نوع المحتوى."
                  : "أضف مصدرًا على " + platformName[platform] + " لعرض محتواه."}
              </p>
              {!active.length && (
                <button className="secondary" onClick={openSources}>
                  إضافة مصدر
                </button>
              )}
            </div>
          )}
        </section>
        <aside className="source-box">
          <h2>مصادر التيار</h2>
          <ul>
            {active.map((s) => (
              <li key={s.id}>
                <button
                  aria-pressed={source === s.id}
                  onClick={() => setSource(source === s.id ? "" : s.id)}
                >
                  <span className="tiny-dot" />
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
          <button className="link" onClick={openSources}>
            إدارة المصادر
          </button>
        </aside>
      </div>
    </>
  );
}
