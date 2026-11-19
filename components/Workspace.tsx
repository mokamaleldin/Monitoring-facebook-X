"use client";

import { useEffect, useState } from "react";
import {
  readDemo,
  snapshotDemo,
  followDemo,
  type DemoState,
} from "../lib/demo";
import * as backend from "../lib/backend";
import {
  parseSource,
  resultText,
  type Snapshot,
  type Space,
} from "../lib/model";
import { Feed } from "./Feed";
import { Sources } from "./Sources";

const storageKey = "kashida:newsroom:demo:v1";
type View = "feed" | "sources";
export default function Workspace({
  spaces,
  isDemo,
}: {
  spaces: Space[];
  isDemo: boolean;
}) {
  const [org, setOrg] = useState(spaces[0].id);
  const [view, setView] = useState<View>("feed");
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
            onClick={() => setView("feed")}
          >
            <span aria-hidden>▤</span> تيار الأخبار
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
            <label htmlFor="org">مساحة العمل</label>
            {spaces.length > 1 ? (
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
              <strong>{spaces[0].name}</strong>
            )}
          </div>
          {isDemo ? (
            <span className="mode">
              <i aria-hidden />
              بيانات تجريبية
            </span>
          ) : (
            <button
              className="link"
              onClick={() => void backend.client?.auth.signOut()}
            >
              خروج
            </button>
          )}
        </header>
        <WorkspaceContent
          key={org}
          org={org}
          isDemo={isDemo}
          isAdmin={spaces.find((s) => s.id === org)?.role === "platform_admin"}
          view={view}
          openSources={() => setView("sources")}
        />
      </main>
    </div>
  );
}
function WorkspaceContent({
  org,
  isDemo,
  isAdmin,
  view,
  openSources,
}: {
  org: string;
  isDemo: boolean;
  isAdmin: boolean;
  view: View;
  openSources: () => void;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      try {
        if (isDemo) {
          let raw: string | null = null;
          try {
            raw = window.localStorage.getItem(storageKey);
          } catch {
            /* The sample can still be read. */
          }
          const result = snapshotDemo(readDemo(raw), org);
          if (alive) {
            setData(result);
            setFailed(false);
          }
        } else {
          void backend
            .snapshot(org)
            .then((result) => {
              if (alive) {
                setData(result);
                setFailed(false);
              }
            })
            .catch(() => {
              if (alive) {
                setData(null);
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
  function editFixture<T>(fn: (state: DemoState) => T): T {
    const state = readDemo(window.localStorage.getItem(storageKey));
    const result = fn(state);
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    setData(snapshotDemo(state, org));
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
        if (isDemo)
          editFixture((s) => {
            s[org].follows[id] = false;
          });
        else await backend.pause(org, id);
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
      if (isDemo)
        editFixture((s) => {
          s[org].pending = s[org].pending.filter((x) => x !== locator);
        });
      else {
        const { error } = await backend.client!.rpc("newsroom_cancel_request", {
          p_org: org,
          p_locator: locator,
        });
        if (error) throw error;
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
        <h1>{view === "feed" ? "تيار الأخبار" : "المصادر"}</h1>
        <span className="timezone">بتوقيت القاهرة</span>
      </div>
      {failed ? (
        <div className="empty" role="alert">
          تعذّر تحميل المحتوى.{" "}
          <button onClick={() => setReload((n) => n + 1)}>
            إعادة المحاولة
          </button>
        </div>
      ) : !data ? (
        <div className="empty" role="status">
          جارٍ تحميل المحتوى…
        </div>
      ) : view === "feed" ? (
        <Feed data={data} openSources={openSources} />
      ) : (
        <Sources
          data={data}
          isDemo={isDemo}
          canAdd={data.canAdd || isAdmin}
          busy={busy}
          add={add}
          change={change}
          cancel={cancelPending}
        />
      )}
    </section>
  );
}
