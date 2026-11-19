"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cairoTime,
  mediaName,
  platformName,
  sourceUrl,
  type FeedCursor,
  type FeedPage,
  type Media,
  type Platform,
  type Post,
  type Subscription,
} from "../lib/model";
import {
  ExternalIcon,
  MediaTypeIcon,
  shortSourceDisplay,
  SourceKindIcon,
} from "./Icons";

const options = [
  ["all", "الكل"],
  ["text", "نصوص"],
  ["photo", "صور"],
  ["video", "فيديوهات"],
] as const;

const PAGE_SIZE = 8;

const kindLabel: Record<"page" | "group" | "account", string> = {
  page: "صفحة",
  group: "جروب عام",
  account: "حساب",
};

function safeLink(value: string | null | undefined, local = false) {
  if (!value) return undefined;
  if (local && /^\/demo\/[\w.-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {
    /* ignore invalid URL */
  }
  return undefined;
}

function uniqueSafeUrls(
  urls: (string | null | undefined)[],
  allowLocal = false,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const clean = safeLink(raw, allowLocal);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function Article({
  post,
  sourceMap,
}: {
  post: Post;
  sourceMap: Map<string, Subscription>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [videoIdx, setVideoIdx] = useState(0);
  const [thumbIdx, setThumbIdx] = useState(0);

  const enrichedSources = post.sources.map((s) => {
    const meta = sourceMap.get(s.id);
    return {
      id: s.id,
      name: meta?.name || s.name,
      platform: meta?.platform || post.platform,
      kind: meta?.kind || (post.platform === "x" ? "account" : "page"),
      locator: meta?.locator || null,
      url: meta?.locator ? sourceUrl(meta.locator) : undefined,
    };
  });

  const primarySource = enrichedSources[0];
  const fallbackUrl = primarySource?.url;

  const items = post.mediaItems ?? [];
  const photoUrls = uniqueSafeUrls(
    [
      post.media === "photo" ? post.mediaUrl : null,
      ...items.filter((m) => m.type === "photo").map((m) => m.url),
    ],
    true,
  );
  const videoUrls = uniqueSafeUrls(
    [
      post.media === "video" ? post.mediaUrl : null,
      ...items.filter((m) => m.type === "video").map((m) => m.url),
    ],
    true,
  );

  const activePhoto = photoUrls[photoIdx];
  const activeVideo = videoUrls[videoIdx];
  const activeThumb = post.media === "video" ? photoUrls[thumbIdx] : undefined;
  const original = safeLink(post.originalUrl);
  const targetUrl = original || fallbackUrl;

  const trimmedText = post.text.trim();
  const isLongText =
    trimmedText.length > 260 || trimmedText.split(/\r?\n/).length > 4;
  const firstLineTitle =
    trimmedText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean)
      ?.slice(0, 90) || "";

  const eng = post.engagement;
  const hasEngagement =
    eng &&
    (eng.reactions !== null || eng.comments !== null || eng.shares !== null);

  const mediaHeading =
    post.media === "video"
      ? "فيديو مرفق بالمنشور"
      : photoUrls.length > 1
        ? `${photoUrls.length.toLocaleString("ar-EG")} صور مرفقة بالمنشور`
        : "صورة مرفقة بالمنشور";

  const mediaActionLabel =
    post.media === "video"
      ? "اضغط هنا لمشاهدة الفيديو"
      : "اضغط هنا لمشاهدة الصورة";

  const avatarVariant =
    primarySource?.platform === "x"
      ? "x"
      : primarySource?.kind === "group"
        ? "group"
        : "page";

  return (
    <article className="story">
      <header className="byline">
        <span
          className={`source-avatar kind-${avatarVariant}`}
          title={
            primarySource
              ? `${platformName[primarySource.platform]} · ${kindLabel[primarySource.kind]}`
              : undefined
          }
        >
          <SourceKindIcon
            platform={primarySource?.platform || post.platform}
            kind={primarySource?.kind || "page"}
            size={21}
          />
        </span>

        <div className="byline-meta">
          <div className="source-title-row">
            {enrichedSources.map((src, idx) => (
              <span key={src.id} className="source-title-item">
                {idx > 0 && <span className="sep">·</span>}
                {src.url ? (
                  <a
                    className="source-title-link"
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {src.name}
                  </a>
                ) : (
                  <strong>{src.name}</strong>
                )}
                <span className={`source-type-pill kind-${src.kind}`}>
                  {kindLabel[src.kind]}
                </span>
              </span>
            ))}
          </div>

          <div className="observed-row">
            <span className="observed">
              رُصد <time dateTime={post.seenAt}>{cairoTime(post.seenAt)}</time>
            </span>
            {primarySource?.locator && primarySource.url && (
              <>
                <span className="dot-sep" aria-hidden>
                  •
                </span>
                <a
                  className="source-handle-link"
                  dir="ltr"
                  href={primarySource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {shortSourceDisplay(primarySource.locator)}
                </a>
              </>
            )}
          </div>
        </div>

        <div className="kind-group">
          <span className={`kind media-${post.media}`}>
            <MediaTypeIcon media={post.media} size={13} />
            {mediaName[post.media]}
          </span>
          {items.length > 1 && (
            <span className="kind subtle">
              {items.length.toLocaleString("ar-EG")} مرفقات
            </span>
          )}
        </div>
      </header>

      {trimmedText ? (
        <div className="story-text-wrap">
          <p
            className={
              isLongText && !expanded ? "story-body clamped" : "story-body"
            }
          >
            {trimmedText}
          </p>
          {isLongText && (
            <button
              type="button"
              className="read-more-btn"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "عرض أقل ↑" : "اقرأ المزيد ↓"}
            </button>
          )}
        </div>
      ) : (
        <p className="story-body muted-body">
          منشور {post.media === "video" ? "فيديو" : "صورة"} بدون نص.
        </p>
      )}

      {post.media === "photo" && activePhoto && (
        <img
          className="story-media"
          src={activePhoto}
          alt="الصورة المرفقة بالمنشور"
          width={activePhoto === "/demo/program.png" ? 900 : undefined}
          height={activePhoto === "/demo/program.png" ? 300 : undefined}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setPhotoIdx((i) => i + 1)}
        />
      )}

      {post.media === "video" && activeVideo && (
        <video
          className="story-media"
          aria-label="الفيديو المرفق بالمنشور"
          controls
          playsInline
          preload="metadata"
          poster={activeThumb}
          onError={() => setVideoIdx((i) => i + 1)}
          src={activeVideo}
        />
      )}

      {post.media === "video" && !activeVideo && activeThumb && (
        <figure className="media-fallback">
          <img
            className="story-media"
            src={activeThumb}
            alt="لقطة معاينة للفيديو"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbIdx((i) => i + 1)}
          />
          {targetUrl && (
            <figcaption>
              <a
                className="media-link-cta"
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MediaTypeIcon media="video" size={14} /> {mediaActionLabel}{" "}
                <ExternalIcon size={13} />
              </a>
            </figcaption>
          )}
        </figure>
      )}

      {((post.media === "photo" && !activePhoto) ||
        (post.media === "video" && !activeVideo && !activeThumb)) &&
        targetUrl && (
          <a
            className={`media-link-card media-${post.media}`}
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="media-link-icon" aria-hidden>
              <MediaTypeIcon media={post.media} size={19} />
            </span>
            <span className="media-link-copy">
              <strong>{mediaHeading}</strong>
              {firstLineTitle && (
                <span className="media-link-sub">{firstLineTitle}</span>
              )}
            </span>
            <span className="media-link-cta">
              {mediaActionLabel} <ExternalIcon size={13} />
            </span>
          </a>
        )}

      {hasEngagement && (
        <div className="engagement-row" aria-label="التفاعل المتاح وقت الرصد">
          {eng.reactions !== null && (
            <span className="eng-pill">
              تفاعل <strong>{eng.reactions.toLocaleString("ar-EG")}</strong>
            </span>
          )}
          {eng.comments !== null && (
            <span className="eng-pill">
              تعليقات <strong>{eng.comments.toLocaleString("ar-EG")}</strong>
            </span>
          )}
          {eng.shares !== null && (
            <span className="eng-pill">
              مشاركات <strong>{eng.shares.toLocaleString("ar-EG")}</strong>
            </span>
          )}
        </div>
      )}

      <footer className="story-foot">
        <details>
          <summary>تفاصيل المنشور</summary>
          <dl>
            <dt>وقت النشر</dt>
            <dd>
              {cairoTime(post.publishedAt)}
              {post.publishedAt &&
                (post.sharedPost || post.timeSemanticsVerified === false) && (
                  <span className="minor detail-note">
                    {" "}
                    (وفق وقت المزود؛ قد يعود للأصل عند إعادة المشاركة)
                  </span>
                )}
            </dd>
            <dt>وقت الرصد</dt>
            <dd>{cairoTime(post.seenAt)}</dd>
            <dt>المنصة</dt>
            <dd>{platformName[post.platform]}</dd>
            {primarySource?.url && (
              <>
                <dt>رابط المصدر</dt>
                <dd>
                  <a
                    dir="ltr"
                    href={primarySource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {primarySource.url}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </details>
        {targetUrl && (
          <a
            className="open-original-btn"
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {original ? "فتح المنشور الأصلي" : "صفحة المصدر"}{" "}
            <ExternalIcon size={13} />
          </a>
        )}
      </footer>
    </article>
  );
}

export function Feed({
  sources,
  feedVersion,
  loadFeedPage,
  openSources,
}: {
  sources: Subscription[];
  feedVersion: number;
  loadFeedPage: (params: {
    platform: Platform;
    media: Media | "all";
    sourceId: string;
    query: string;
    cursor?: FeedCursor | null;
    limit?: number;
  }) => Promise<FeedPage>;
  openSources: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [media, setMedia] = useState<Media | "all">("all");
  const [source, setSource] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [posts, setPosts] = useState<Post[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<FeedCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const requestSeq = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const active = sources.filter((s) => s.active && s.platform === platform);
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(queryInput), 220);
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    if (source && !active.some((s) => s.id === source)) {
      setSource("");
    }
  }, [active, source]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(false);

    void loadFeedPage({
      platform,
      media,
      sourceId: source,
      query: debouncedQuery,
      cursor: null,
      limit: PAGE_SIZE,
    })
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setPosts(page.posts);
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        setLoading(false);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setLoadError(true);
        setLoading(false);
      });
  }, [platform, media, source, debouncedQuery, feedVersion, loadFeedPage]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore || !nextCursor) return;
    const seq = requestSeq.current;
    setLoadingMore(true);

    void loadFeedPage({
      platform,
      media,
      sourceId: source,
      query: debouncedQuery,
      cursor: nextCursor,
      limit: PAGE_SIZE,
    })
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setPosts((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          const uniqueNext = page.posts.filter((p) => !existing.has(p.id));
          return [...prev, ...uniqueNext];
        });
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setLoadingMore(false);
      });
  }, [
    loading,
    loadingMore,
    hasMore,
    nextCursor,
    loadFeedPage,
    platform,
    media,
    source,
    debouncedQuery,
  ]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading || loadingMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadMore]);

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
              aria-label="ابحث في المنشورات"
              placeholder="ابحث في نص الخبر أو اسم المصدر…"
              enterKeyHint="search"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
            />
          </label>
          <select
            aria-label="فلترة حسب المصدر"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">
              كل المصادر ({active.length.toLocaleString("ar-EG")})
            </option>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
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
              {loading
                ? "جارٍ التحديث…"
                : posts.length < totalCount
                  ? `عرض ${posts.length.toLocaleString("ar-EG")} من ${totalCount.toLocaleString("ar-EG")} منشور`
                  : `عدد المنشورات ${totalCount.toLocaleString("ar-EG")}`}
            </span>
          </div>

          {loadError ? (
            <div className="empty" role="alert">
              <h3>تعذّر تحميل المنشورات</h3>
              <p>حاول إعادة التحديث بعد لحظات.</p>
            </div>
          ) : loading ? (
            <div className="empty" role="status">
              جارٍ تحميل المنشورات…
            </div>
          ) : posts.length > 0 ? (
            <>
              {posts.map((p) => (
                <Article key={p.id} post={p} sourceMap={sourceMap} />
              ))}
              <div ref={sentinelRef} className="pager-foot">
                {hasMore ? (
                  <button
                    className="secondary"
                    disabled={loadingMore}
                    onClick={loadMore}
                  >
                    {loadingMore
                      ? "جارٍ تحميل الدفعة التالية…"
                      : "تحميل المزيد"}
                  </button>
                ) : (
                  <span className="minor">
                    تم عرض جميع المنشورات المطابقة (
                    {totalCount.toLocaleString("ar-EG")}).
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="empty">
              <h3>لا توجد منشورات هنا</h3>
              <p>
                {platform === "x" && active.length > 0
                  ? "لا توجد منشورات مرصودة على X حاليًا. حسابات X محفوظة في المصادر، وربط موصل X الحي في المرحلة التالية."
                  : active.length > 0
                    ? "جرّب تغيير البحث أو نوع المحتوى أو اختيار مصدر آخر."
                    : `أضف مصدرًا على ${platformName[platform]} لعرض محتواه.`}
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
          <h2>مصادر التيار ({platformName[platform]})</h2>
          {active.length ? (
            <ul>
              {active.map((s) => (
                <li key={s.id} className="source-side-item">
                  <button
                    className="source-side-btn"
                    aria-pressed={source === s.id}
                    onClick={() => setSource(source === s.id ? "" : s.id)}
                  >
                    <span
                      className={`side-icon kind-${s.platform === "x" ? "x" : s.kind}`}
                    >
                      <SourceKindIcon
                        platform={s.platform}
                        kind={s.kind}
                        size={14}
                      />
                    </span>
                    <span className="side-name">{s.name}</span>
                  </button>
                  <a
                    className="side-ext"
                    href={sourceUrl(s.locator)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`فتح ${s.name}`}
                    title={shortSourceDisplay(s.locator)}
                  >
                    <ExternalIcon size={13} />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="minor">
              لا توجد مصادر نشطة على {platformName[platform]}.
            </p>
          )}
          <button className="link" onClick={openSources}>
            إدارة المصادر
          </button>
        </aside>
      </div>
    </>
  );
}
