"use client";

import { useCallback, useEffect, useState } from "react";
import {
  feedDemo,
  followDemo,
  orgMetaDemo,
  readDemo,
  snapshotDemo,
  type DemoState,
} from "../lib/demo";
import * as backend from "../lib/backend";
import {
  parseSource,
  resultText,
  type FeedCursor,
  type FeedPage,
  type Media,
  type OrgMeta,
  type Platform,
  type Space,
  type TrendsReport,
} from "../lib/model";
import { analyzeFacebookTrends } from "../lib/trends-engine";
import { Feed } from "./Feed";
import { Sources } from "./Sources";
import { Trends } from "./Trends";

const storageKey = "kashida:newsroom:demo:v1";
type View = "feed" | "trends" | "sources";

export default function Workspace({
  spaces,
  isDemo,
  userEmail,
}: {
  spaces: Space[];
  isDemo: boolean;
  userEmail?: string;
}) {
  const [org, setOrg] = useState(spaces[0].id);
  const [view, setView] = useState<View>("feed");
  const [feedSearchQuery, setFeedSearchQuery] = useState("");
  const currentSpace = spaces.find((s) => s.id === org) ?? spaces[0];

  return (
    <div className="shell">
      <a className="skip" href="#main">
        انتقل إلى المحتوى
      </a>
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand" role="img" aria-label="كشيدة" />
        </div>
        <nav aria-label="التصفح">
          <button
            aria-current={view === "feed" ? "page" : undefined}
            onClick={() => {
              setFeedSearchQuery("");
              setView("feed");
            }}
          >
            <span aria-hidden>▤</span> تيار الأخبار
          </button>
          <button
            aria-current={view === "trends" ? "page" : undefined}
            onClick={() => setView("trends")}
          >
            <span aria-hidden>#</span> الهاشتاجات والترندات
          </button>
          <button
            aria-current={view === "sources" ? "page" : undefined}
            onClick={() => setView("sources")}
          >
            <span aria-hidden>▦</span> المصادر
          </button>
        </nav>
        <div className="rail-footer">كشيدة للرصد الإعلامي</div>
      </aside>
      <main id="main" className="main">
        <header className="top">
          <div className="workspace-label">
            <span className="workspace-icon" aria-hidden>
              ◈
            </span>
            <label htmlFor="org">الجهة</label>
            {isDemo && spaces.length > 1 ? (
              <select
                id="org"
                value={org}
                onChange={(e) => {
                  setOrg(e.target.value);
                  setView("feed");
                }}
              >
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong id="org">{currentSpace.name}</strong>
            )}
          </div>
          <div className="top-actions">
            {isDemo ? (
              <span className="mode">
                <i aria-hidden />
                بيانات تجريبية
              </span>
            ) : (
              <>
                {userEmail && <span className="minor user-email" dir="ltr">{userEmail}</span>}
                <button
                  className="link"
                  onClick={() => void backend.client?.auth.signOut()}
                >
                  خروج
                </button>
              </>
            )}
          </div>
        </header>
        <WorkspaceContent
          key={org}
          org={org}
          isDemo={isDemo}
          isAdmin={currentSpace.role === "platform_admin"}
          view={view}
          feedSearchQuery={feedSearchQuery}
          openSources={() => setView("sources")}
          onSearchInFeed={(query) => {
            setFeedSearchQuery(query);
            setView("feed");
          }}
        />
      </main>
    </div>
  );
}

function readDemoSafe(): DemoState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    /* ignore storage restrictions */
  }
  return readDemo(raw);
}

function WorkspaceContent({
  org,
  isDemo,
  isAdmin,
  view,
  feedSearchQuery,
  openSources,
  onSearchInFeed,
}: {
  org: string;
  isDemo: boolean;
  isAdmin: boolean;
  view: View;
  feedSearchQuery: string;
  openSources: () => void;
  onSearchInFeed: (query: string) => void;
}) {
  const [meta, setMeta] = useState<OrgMeta | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      try {
        if (isDemo) {
          const next = orgMetaDemo(readDemoSafe(), org);
          if (alive) {
            setMeta(next);
            setFailed(false);
          }
        } else {
          void backend
            .orgMeta(org)
            .then((next) => {
              if (alive) {
                setMeta(next);
                setFailed(false);
              }
            })
            .catch(() => {
              if (alive) {
                setMeta(null);
                setFailed(true);
              }
            });
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    refresh();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) refresh();
    };
    if (isDemo) window.addEventListener("storage", storageChanged);
    return () => {
      alive = false;
      window.removeEventListener("storage", storageChanged);
    };
  }, [org, isDemo, reload]);

  const loadFeedPage = useCallback(
    async (params: {
      platform: Platform;
      media: Media | "all";
      sourceId: string;
      query: string;
      cursor?: FeedCursor | null;
      limit?: number;
    }): Promise<FeedPage> => {
      if (isDemo) {
        return feedDemo(readDemoSafe(), { org, ...params });
      }
      return backend.feed({ org, ...params });
    },
    [org, isDemo],
  );

  const loadTrends = useCallback(
    async (refresh: boolean): Promise<TrendsReport> => {
      if (isDemo) {
        const snap = snapshotDemo(readDemoSafe(), org);
        return {
          country: "EG",
          generatedAt: new Date().toISOString(),
          cached: false,
          facebook: analyzeFacebookTrends(snap.posts, [], { country: "EG" }),
          x: {
            platform: "X",
            provider: "وضع العرض التجريبي",
            coverage: "demo",
            country: "EG",
            url: "https://getdaytrends.com/egypt/",
            fetchedAt: null,
            items: [],
            error: "جلب ترندات X الحية لمصر يتطلب وضع Supabase.",
          },
          google: {
            platform: "Google",
            provider: "وضع العرض التجريبي",
            coverage: "demo",
            country: "EG",
            url: "https://trends.google.com/trending?geo=EG",
            fetchedAt: null,
            items: [],
            error: "جلب ترندات Google الحية لمصر يتطلب وضع Supabase.",
          },
        };
      }
      return backend.trends(org, { refresh });
    },
    [org, isDemo],
  );

  function editFixture<T>(fn: (state: DemoState) => T): T {
    const state = readDemoSafe();
    const result = fn(state);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    setMeta(orgMetaDemo(state, org));
    setReload((n) => n + 1);
    return result;
  }

  async function add(lines: string[]) {
    setBusy(true);
    const rows: { url: string; status: string }[] = [];
    try {
      for (const url of lines) {
        const loc = parseSource(url);
        if (!loc) {
          rows.push({ url, status: "رابط غير مدعوم" });
          continue;
        }
        try {
          const result = isDemo
            ? editFixture((s) => followDemo(s, org, loc))
            : await backend.follow(org, loc);
          rows.push({ url, status: resultText[result] });
        } catch {
          rows.push({ url, status: "تعذّر حفظ الرابط. أعد المحاولة." });
        }
      }
      return rows;
    } finally {
      if (!isDemo) setReload((n) => n + 1);
      setBusy(false);
    }
  }

  async function change(id: string, locator: string, active: boolean) {
    setBusy(true);
    try {
      if (active) {
        if (isDemo) {
          editFixture((s) => {
            s[org].follows[id] = false;
          });
        } else {
          await backend.pause(org, id);
        }
        return "أُوقفت المتابعة لهذه الجهة";
      }
      const result = isDemo
        ? editFixture((s) => followDemo(s, org, locator))
        : await backend.follow(org, locator);
      return resultText[result];
    } finally {
      if (!isDemo) setReload((n) => n + 1);
      setBusy(false);
    }
  }

  async function cancelPending(locator: string) {
    setBusy(true);
    try {
      if (isDemo) {
        editFixture((s) => {
          s[org].pending = s[org].pending.filter((x) => x !== locator);
        });
      } else {
        await backend.cancelRequest(org, locator);
      }
      return "تم إلغاء الطلب";
    } finally {
      if (!isDemo) setReload((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>
            {view === "feed"
              ? "تيار الأخبار"
              : view === "trends"
                ? "الهاشتاجات والترندات · مصر"
                : "المصادر"}
          </h1>
          {meta?.referenceAt && view !== "sources" && (
            <p className="ref-badge">
              عرض مرجعي: {meta.referenceLabel || meta.referenceAt.slice(0, 10)}{" "}
              (التواريخ الأصلية للمنشورات محفوظة كما سُجلت)
            </p>
          )}
        </div>
        <span className="timezone">بتوقيت القاهرة</span>
      </div>
      {failed ? (
        <div className="empty" role="alert">
          تعذّر تحميل المحتوى.{" "}
          <button
            className="secondary"
            onClick={() => setReload((n) => n + 1)}
          >
            إعادة المحاولة
          </button>
        </div>
      ) : !meta ? (
        <div className="empty" role="status">
          جارٍ تحميل المحتوى…
        </div>
      ) : view === "feed" ? (
        <Feed
          sources={meta.sources}
          feedVersion={reload}
          loadFeedPage={loadFeedPage}
          openSources={openSources}
          initialQuery={feedSearchQuery}
        />
      ) : view === "trends" ? (
        <Trends loadTrends={loadTrends} onSearchInFeed={onSearchInFeed} />
      ) : (
        <Sources
          data={{
            sources: meta.sources,
            pending: meta.pending,
            posts: [],
            canAdd: meta.canAdd,
          }}
          isDemo={isDemo}
          canAdd={meta.canAdd || isAdmin}
          busy={busy}
          add={add}
          change={change}
          cancel={cancelPending}
        />
      )}
    </section>
  );
}
