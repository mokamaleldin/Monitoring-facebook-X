"use client";

import { useCallback, useEffect, useState } from "react";
import { cairoTime, type TrendsReport } from "../lib/model";
import { ExternalIcon } from "./Icons";

type TrendsFilter = "all" | "facebook" | "x" | "google";

const tierLabel: Record<"high" | "medium" | "watch", string> = {
  high: "أهمية مرتفعة",
  medium: "موضوع بارز",
  watch: "قيد المتابعة",
};

export function Trends({
  loadTrends,
  onSearchInFeed,
}: {
  loadTrends: (refresh: boolean) => Promise<TrendsReport>;
  onSearchInFeed: (query: string) => void;
}) {
  const [report, setReport] = useState<TrendsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<TrendsFilter>("all");

  const fetchReport = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const data = await loadTrends(refresh);
        setReport(data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "تعذّر تحميل الهاشتاجات والترندات حاليًا.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadTrends],
  );

  useEffect(() => {
    void fetchReport(false);
  }, [fetchReport]);

  if (loading && !report) {
    return (
      <div className="empty" role="status">
        جارٍ تحليل منشورات مصادرك وجلب ترندات مصر من X وGoogle…
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="empty" role="alert">
        <h3>تعذّر تحميل الترندات</h3>
        <p>{error}</p>
        <button className="secondary" onClick={() => void fetchReport(true)}>
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!report) return null;

  const { facebook, x, google } = report;

  return (
    <div className="trends-root">
      <div className="filter-card trends-toolbar">
        <div className="media-tabs" role="group" aria-label="عرض القسم">
          {(
            [
              ["all", "الكل"],
              ["facebook", `فيسبوك (${facebook.topics.length.toLocaleString("ar-EG")})`],
              ["x", `ترندات X مصر (${x.items.length.toLocaleString("ar-EG")})`],
              ["google", `بحث Google مصر (${google.items.length.toLocaleString("ar-EG")})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={section === id}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="trends-refresh-row">
          <span className="minor">
            مصر 🇪🇬 · آخر تحديث: {cairoTime(report.generatedAt)}
          </span>
          <button
            className="secondary"
            disabled={refreshing}
            onClick={() => void fetchReport(true)}
          >
            {refreshing ? "جارٍ التحديث…" : "تحديث ترندات مصر الآن"}
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-banner error" role="alert">
          {error}
        </p>
      )}

      {(section === "all" || section === "facebook") && (
        <section className="source-panel trends-panel">
          <div className="trends-panel-head">
            <div>
              <h2>هاشتاجات وموضوعات فيسبوك (تحليل مصادر جهتك)</h2>
              <p className="minor">
                حُلّلت{" "}
                <strong>
                  {facebook.analyzedPosts.toLocaleString("ar-EG")}
                </strong>{" "}
                منشورات خبرية من{" "}
                <strong>{facebook.sourceCount.toLocaleString("ar-EG")}</strong>{" "}
                مصادر نشطة
                {facebook.noiseFilteredCount > 0
                  ? ` (مع استبعاد ${facebook.noiseFilteredCount.toLocaleString("ar-EG")} منشورات ترويجية أو ترحيب تلقائي أو بدون نص)`
                  : ""}
                . لا تُؤلَّف أي موضوعات غير موجودة في المنشورات.
              </p>
            </div>
          </div>

          {facebook.hashtags.length > 0 && (
            <div className="explicit-tags-box">
              <h3 className="sub-heading">هاشتاجات صريحة داخل المنشورات</h3>
              <div className="tag-chips">
                {facebook.hashtags.map((h) => (
                  <button
                    key={h.tag}
                    type="button"
                    className="tag-chip"
                    onClick={() => onSearchInFeed(h.tag.replace(/^#/, ""))}
                  >
                    <strong>{h.tag}</strong>
                    <span className="minor">
                      {h.postCount.toLocaleString("ar-EG")} منشور
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {facebook.topics.length === 0 ? (
            <div className="empty-inline">
              لا توجد موضوعات خبرية كافية داخل منشورات جهتك الحالية لاستخراج
              ترندات منها.
            </div>
          ) : (
            <div className="topics-list">
              {facebook.topics.map((topic) => (
                <article key={`${topic.rank}-${topic.title}`} className="topic-card">
                  <div className="topic-top">
                    <span className="rank-badge">
                      {topic.rank.toLocaleString("ar-EG")}
                    </span>
                    <div className="topic-main">
                      <div className="topic-title-row">
                        <h3>{topic.title}</h3>
                        <button
                          type="button"
                          className="suggested-tag"
                          title="ابحث عن هذا الموضوع في تيار الأخبار"
                          onClick={() => onSearchInFeed(topic.searchQuery)}
                        >
                          {topic.suggestedHashtag}
                        </button>
                      </div>
                      <div className="topic-badges">
                        {topic.egyptRelated && (
                          <span className="topic-pill egypt">🇪🇬 شأن مصري</span>
                        )}
                        <span className={`topic-pill tier-${topic.tier}`}>
                          {tierLabel[topic.tier]}
                        </span>
                        <span className="topic-pill neutral">
                          {topic.sourceCount.toLocaleString("ar-EG")}{" "}
                          {topic.sourceCount > 1 ? "مصادر" : "مصدر"} ·{" "}
                          {topic.postCount.toLocaleString("ar-EG")}{" "}
                          {topic.postCount > 1 ? "منشورات" : "منشور"}
                        </span>
                        {topic.matchedTrends.map((mt) => (
                          <a
                            key={`${mt.platform}-${mt.name}`}
                            className="topic-pill matched"
                            href={mt.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            متقاطع مع {mt.platform}: {mt.name}
                          </a>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary topic-jump-btn"
                      onClick={() => onSearchInFeed(topic.searchQuery)}
                    >
                      عرض في التيار
                    </button>
                  </div>

                  <ul className="topic-evidence">
                    {topic.evidence.slice(0, 3).map((ev) => (
                      <li key={ev.postId}>
                        <strong>{ev.sourceName}:</strong>{" "}
                        {ev.url ? (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {ev.headline} <ExternalIcon size={11} />
                          </a>
                        ) : (
                          <span>{ev.headline}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div
        className={
          section === "all" ? "admin-two-col trends-external-grid" : ""
        }
      >
        {(section === "all" || section === "x") && (
          <section className="source-panel trends-panel">
            <div className="trends-panel-head">
              <div>
                <h2>هاشتاجات وترندات X في مصر 🇪🇬</h2>
                <p className="minor">
                  المصدر: {x.provider}{" "}
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-ext"
                  >
                    فتح المصدر <ExternalIcon size={11} />
                  </a>
                </p>
              </div>
            </div>
            {x.error ? (
              <div className="empty-inline" role="alert">
                {x.error}
              </div>
            ) : !x.items.length ? (
              <div className="empty-inline">
                لا توجد ترندات X متاحة لمصر حاليًا.
              </div>
            ) : (
              <ol className="ext-trend-list">
                {x.items.map((item) => (
                  <li key={`${item.rank}-${item.name}`}>
                    <span className="rank-num">
                      {item.rank.toLocaleString("ar-EG")}
                    </span>
                    <div className="grow">
                      <a
                        className="ext-trend-link"
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <strong>{item.name}</strong>
                        <ExternalIcon size={12} />
                      </a>
                      <div className="minor">
                        {item.kind === "hashtag" ? "هاشتاج" : "موضوع شائع"}
                        {item.tweetCount
                          ? ` · ${item.tweetCount.toLocaleString("ar-EG")} تغريدة`
                          : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {(section === "all" || section === "google") && (
          <section className="source-panel trends-panel">
            <div className="trends-panel-head">
              <div>
                <h2>عمليات البحث الرائجة على Google في مصر 🇪🇬</h2>
                <p className="minor">
                  المصدر: {google.provider}{" "}
                  <a
                    href={google.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-ext"
                  >
                    فتح Google Trends <ExternalIcon size={11} />
                  </a>
                </p>
              </div>
            </div>
            {google.error ? (
              <div className="empty-inline" role="alert">
                {google.error}
              </div>
            ) : !google.items.length ? (
              <div className="empty-inline">
                لا توجد عمليات بحث رائجة متاحة من Google لمصر حاليًا.
              </div>
            ) : (
              <ol className="ext-trend-list">
                {google.items.map((item) => (
                  <li key={`${item.rank}-${item.name}`}>
                    <span className="rank-num">
                      {item.rank.toLocaleString("ar-EG")}
                    </span>
                    <div className="grow">
                      <div className="ext-trend-top">
                        <a
                          className="ext-trend-link"
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <strong>{item.name}</strong>
                          <ExternalIcon size={12} />
                        </a>
                        {item.trafficLabel && (
                          <span className="traffic-pill" dir="ltr">
                            {item.trafficLabel}
                          </span>
                        )}
                      </div>
                      {item.newsHeadline && (
                        <div className="minor ext-news-line">
                          {item.newsUrl ? (
                            <a
                              href={item.newsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {item.newsHeadline}
                              {item.newsSource ? ` — ${item.newsSource}` : ""}
                            </a>
                          ) : (
                            <>
                              {item.newsHeadline}
                              {item.newsSource ? ` — ${item.newsSource}` : ""}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
