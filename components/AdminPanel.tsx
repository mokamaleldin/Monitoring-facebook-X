"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import * as backend from "../lib/backend";
import { ApiError, client, mode } from "../lib/backend";
import {
  cairoTime,
  platformName,
  sourceUrl,
  type AdminOrg,
  type AdminOverview,
} from "../lib/model";
import { Brand, ConfigMissingGate, SignIn } from "./SignIn";
import { ExternalIcon, shortSourceDisplay, SourceKindIcon } from "./Icons";

type AdminTab = "orgs" | "manage" | "runs";

const runStatusLabel: Record<string, string> = {
  completed: "مكتملة",
  stopped: "توقفت عند الحد",
  failed: "تعذّرت",
  running: "جارٍ السحب",
};

const itemStatusLabel: Record<string, string> = {
  ok: "نجح",
  error: "خطأ",
  uncertain: "نتيجة غير مؤكدة",
  attempted: "قيد المحاولة",
  skipped: "تم تخطيه",
};

function OrgSettingsEditor({
  org,
  busy,
  onSave,
}: {
  org: AdminOrg;
  busy: boolean;
  onSave: (patch: {
    maxSources: number;
    allowAdd: boolean;
    feedDays: number;
  }) => Promise<void>;
}) {
  const [maxSources, setMaxSources] = useState(String(org.maxSources));
  const [feedDays, setFeedDays] = useState(String(org.feedDays));
  const [allowAdd, setAllowAdd] = useState(org.allowAdd);

  useEffect(() => {
    setMaxSources(String(org.maxSources));
    setFeedDays(String(org.feedDays));
    setAllowAdd(org.allowAdd);
  }, [org.id, org.maxSources, org.feedDays, org.allowAdd]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await onSave({
      maxSources: Number(maxSources),
      feedDays: Number(feedDays),
      allowAdd,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      <div className="form-grid-3">
        <div className="field">
          <label htmlFor="edit-max-sources">حد المصادر الأقصى</label>
          <input
            id="edit-max-sources"
            type="number"
            min={0}
            max={5000}
            required
            value={maxSources}
            onChange={(e) => setMaxSources(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="edit-feed-days">نافذة العرض (أيام)</label>
          <input
            id="edit-feed-days"
            type="number"
            min={1}
            max={90}
            required
            value={feedDays}
            onChange={(e) => setFeedDays(e.target.value)}
          />
        </div>
        <div className="field checkbox-field">
          <label htmlFor="edit-allow-add">
            <input
              id="edit-allow-add"
              type="checkbox"
              checked={allowAdd}
              onChange={(e) => setAllowAdd(e.target.checked)}
            />
            السماح للمحرر بإضافة مصادر بنفسه
          </label>
        </div>
      </div>
      <button className="primary" type="submit" disabled={busy}>
        حفظ إعدادات «{org.name}»
      </button>
    </form>
  );
}

function AdminWorkspace({ session }: { session: Session }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<AdminTab>("orgs");
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Create Org form state
  const [orgFormKey, setOrgFormKey] = useState(0);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgMax, setNewOrgMax] = useState("10");
  const [newOrgDays, setNewOrgDays] = useState("7");
  const [newOrgAllowAdd, setNewOrgAllowAdd] = useState(true);

  // Create Editor form state
  const [editorFormKey, setEditorFormKey] = useState(0);
  const [editorEmail, setEditorEmail] = useState("");
  const [editorPassword, setEditorPassword] = useState("");
  const [editorOrgId, setEditorOrgId] = useState("");
  const [showEditorPw, setShowEditorPw] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<{
    email: string;
    orgId: string;
  } | null>(null);

  // Selected org batch sources + approval + rename
  const [sourceLines, setSourceLines] = useState("");
  const [sourceReceipts, setSourceReceipts] = useState<
    { url: string; status: string }[]
  >([]);
  const [approveNames, setApproveNames] = useState<Record<string, string>>({});
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceName, setEditingSourceName] = useState("");

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      const data = await backend.adminOverview();
      setOverview(data);
      setForbidden(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        setOverview(null);
      } else if (err instanceof ApiError && err.status === 401) {
        void client?.auth.signOut();
      } else {
        setLoadError(
          err instanceof Error ? err.message : "تعذّر تحميل لوحة الإدارة.",
        );
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, session.user.id]);

  if (forbidden) {
    return (
      <main className="gate" role="alert">
        <div className="gate-card">
          <Brand />
          <h1>الوصول غير مصرح به</h1>
          <p className="minor">
            لوحة الإدارة مخصصة لأدمن كشيدة فقط. حسابك مسجل كمحرر جهة.
          </p>
          <div className="action-row">
            <a className="primary" href="/">
              العودة إلى تيار الأخبار
            </a>
            <button
              className="secondary"
              onClick={() => void client?.auth.signOut()}
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="gate" role="alert">
        <div className="gate-card">
          <Brand />
          <h1>تعذّر تحميل لوحة الإدارة</h1>
          <p className="minor">{loadError}</p>
          <div className="action-row">
            <button className="primary" onClick={() => void refresh()}>
              إعادة المحاولة
            </button>
            <button
              className="secondary"
              onClick={() => void client?.auth.signOut()}
            >
              خروج
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="gate" role="status">
        جارٍ التحقق من صلاحية الإدارة وتحميل البيانات…
      </main>
    );
  }

  const selectedOrg =
    overview.organizations.find((o) => o.id === selectedOrgId) ?? null;

  function clearFeedback() {
    setNotice("");
    setErrorMsg("");
  }

  async function handleCreateOrg(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const created = await backend.adminCreateOrg({
        name: newOrgName.trim(),
        maxSources: Number(newOrgMax),
        allowAdd: newOrgAllowAdd,
        feedDays: Number(newOrgDays),
      });
      setNewOrgName("");
      setOrgFormKey((k) => k + 1);
      setNotice(`تم إنشاء جهة «${created.name}» بنجاح.`);
      setSelectedOrgId(created.id);
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر إنشاء الجهة.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateEditor(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    setPendingRecovery(null);
    setBusy(true);
    try {
      const res = await backend.adminCreateEditor({
        email: editorEmail.trim(),
        password: editorPassword,
        orgId: editorOrgId,
      });
      setEditorEmail("");
      setEditorPassword("");
      setEditorFormKey((k) => k + 1);
      setNotice(
        res.status === "recovered"
          ? `تم استكمال ربط عضوية الحساب ${res.email} بالجهة بأمان.`
          : `تم إنشاء حساب المحرر ${res.email} وربطه بالجهة بنجاح.`,
      );
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "membership_pending") {
        setPendingRecovery({ email: editorEmail.trim(), orgId: editorOrgId });
      }
      setErrorMsg(
        err instanceof Error ? err.message : "تعذّر إنشاء حساب المحرر.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRecoverOrphan(email: string, orgId: string) {
    if (!orgId) {
      setErrorMsg("اختر الجهة المستهدفة لاستكمال ربط العضوية.");
      return;
    }
    clearFeedback();
    setBusy(true);
    try {
      await backend.adminCreateEditor({ email, password: "", orgId });
      setPendingRecovery(null);
      setNotice(`تم استكمال ربط عضوية ${email} بنجاح.`);
      await refresh();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "تعذّر استكمال ربط العضوية.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateSelectedOrg(patch: {
    maxSources: number;
    allowAdd: boolean;
    feedDays: number;
  }) {
    if (!selectedOrg) return;
    clearFeedback();
    setBusy(true);
    try {
      await backend.adminUpdateOrg(selectedOrg.id, patch);
      setNotice(`تم تحديث إعدادات جهة «${selectedOrg.name}».`);
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر حفظ الإعدادات.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddOrgSources(e: FormEvent) {
    e.preventDefault();
    if (!selectedOrg) return;
    clearFeedback();
    const lines = sourceLines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length || lines.length > 100) {
      setErrorMsg("أدخل من رابط واحد إلى ١٠٠ رابط في الدفعة.");
      return;
    }
    setBusy(true);
    try {
      const { rows } = await backend.adminAddSources(selectedOrg.id, lines);
      setSourceReceipts(rows);
      setSourceLines("");
      setNotice(`تمت معالجة ${rows.length} رابط لجهة «${selectedOrg.name}».`);
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر إضافة المصادر.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleOrgSource(
    sourceId: string,
    locator: string,
    active: boolean,
  ) {
    if (!selectedOrg) return;
    clearFeedback();
    setBusy(true);
    try {
      const res = await backend.adminToggleSource(
        selectedOrg.id,
        sourceId,
        locator,
        active,
      );
      setNotice(`${selectedOrg.name}: ${res.message}`);
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر تحديث المصدر.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelOrgRequest(locator: string) {
    if (!selectedOrg) return;
    clearFeedback();
    setBusy(true);
    try {
      const res = await backend.adminCancelRequest(selectedOrg.id, locator);
      setNotice(`${selectedOrg.name}: ${res.message}`);
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر إلغاء الطلب.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveOrgRequest(locator: string) {
    if (!selectedOrg) return;
    const label = (approveNames[locator] || "").trim();
    if (!label) {
      setErrorMsg("اكتب اسم المصدر العام قبل اعتماده.");
      return;
    }
    clearFeedback();
    setBusy(true);
    try {
      await backend.adminApproveRequest(selectedOrg.id, locator, label);
      setNotice(`تم اعتماد المصدر «${label}» وإضافته لجهة «${selectedOrg.name}».`);
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر اعتماد المصدر.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameSource(sourceId: string) {
    const clean = editingSourceName.trim();
    if (!clean) {
      setErrorMsg("اكتب اسم المصدر الجديد قبل الحفظ.");
      return;
    }
    clearFeedback();
    setBusy(true);
    try {
      const updated = await backend.adminRenameSource(sourceId, clean);
      setEditingSourceId(null);
      setEditingSourceName("");
      setNotice(`تم تحديث اسم المصدر إلى «${updated.name}» وسيظهر فورًا في تيار الأخبار.`);
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر تحديث اسم المصدر.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReferenceToggle(snapshotMode: boolean) {
    clearFeedback();
    setBusy(true);
    try {
      if (snapshotMode) {
        await backend.adminSetReference(
          "2026-11-06T23:59:59+00:00",
          "لقطة 2026-11-06",
        );
        setNotice("تم ضبط مرجع العرض على يوم لقطة ٦ نوفمبر ٢٠٢٦.");
      } else {
        await backend.adminSetReference(null, null);
        setNotice("تمت إعادة التيار إلى توقيت اليوم الطبيعي.");
      }
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "تعذّر تغيير المرجع.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunCollection() {
    clearFeedback();
    setBusy(true);
    try {
      const freshKey = `pull-${Date.now()}`;
      const res = await backend.adminCollectFacebook({
        runKey: freshKey,
        maxRequests: 5,
        maxCredits: 5,
      });
      setNotice(
        `تم السحب بنجاح: ${res.run.requestsMade} مصادر، +${res.run.insertedCount} منشور جديد، ${res.run.updatedCount} محدث.`,
      );
      await refresh();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "تعذّر تشغيل السحب.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <a className="skip" href="#admin-main">
        انتقل إلى لوحة الإدارة
      </a>
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand" role="img" aria-label="كشيدة" />
        </div>
        <nav aria-label="أقسام الإدارة">
          <button
            aria-current={tab === "orgs" ? "page" : undefined}
            onClick={() => setTab("orgs")}
          >
            <span aria-hidden>◈</span> الجهات والمحررون
          </button>
          <button
            aria-current={tab === "manage" ? "page" : undefined}
            onClick={() => setTab("manage")}
          >
            <span aria-hidden>▦</span> إدارة جهة ومصادرها
          </button>
          <button
            aria-current={tab === "runs" ? "page" : undefined}
            onClick={() => setTab("runs")}
          >
            <span aria-hidden>↻</span> سحب الأخبار
          </button>
        </nav>
        <div className="rail-footer">إدارة منصة كشيدة</div>
      </aside>

      <main id="admin-main" className="main">
        <header className="top">
          <div className="workspace-label">
            <span className="workspace-icon" aria-hidden>
              ★
            </span>
            <strong>لوحة إدارة كشيدة</strong>
            <span className="mode">
              <i aria-hidden />
              أدمن المنصة
            </span>
          </div>
          <div className="top-actions">
            <span className="minor user-email" dir="ltr">
              {session.user.email}
            </span>
            <button
              className="link"
              onClick={() => void client?.auth.signOut()}
            >
              خروج
            </button>
          </div>
        </header>

        <section className="page">
          <div className="page-heading">
            <h1>
              {tab === "orgs"
                ? "الجهات والمحررون"
                : tab === "manage"
                  ? "إدارة جهة ومصادرها"
                  : "سحب الأخبار"}
            </h1>
            <span className="timezone">بتوقيت القاهرة</span>
          </div>

          {notice && (
            <p className="admin-banner success" role="status">
              {notice}
            </p>
          )}
          {errorMsg && (
            <p className="admin-banner error" role="alert">
              {errorMsg}
            </p>
          )}

          {tab === "orgs" && (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="minor">الجهات المسجلة</span>
                  <strong>
                    {overview.organizations.length.toLocaleString("ar-EG")}
                  </strong>
                </div>
                <div className="stat-card">
                  <span className="minor">مصادر Facebook نشطة فريدة</span>
                  <strong>
                    {overview.uniqueActiveFacebookSources.toLocaleString("ar-EG")}
                  </strong>
                </div>
                <div className="stat-card">
                  <span className="minor">إجمالي السجل الموحد للمصادر</span>
                  <strong>{overview.uniqueSources.toLocaleString("ar-EG")}</strong>
                </div>
                <div className="stat-card">
                  <span className="minor">إجمالي المنشورات المخزنة</span>
                  <strong>{overview.totalPosts.toLocaleString("ar-EG")}</strong>
                </div>
              </div>

              <section className="source-panel">
                <h2 id="orgs-table-caption">الجهات وحسابات المحررين</h2>
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="orgs-table-caption"
                  className="table-wrapper"
                >
                  <table className="data-table orgs-table">
                    <thead>
                      <tr>
                        <th scope="col">الجهة</th>
                        <th scope="col">المحررون</th>
                        <th scope="col">المصادر النشطة / الحد</th>
                        <th scope="col">إضافة المحرر</th>
                        <th scope="col">نافذة العرض</th>
                        <th scope="col">إدارة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.organizations.map((org) => (
                        <tr key={org.id}>
                          <th scope="row">{org.name}</th>
                          <td>
                            {org.editors.length ? (
                              <ul className="inline-list">
                                {org.editors.map((ed) => (
                                  <li key={ed.userId} dir="ltr">
                                    {ed.email || ed.userId}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="minor">بلا محررين بعد</span>
                            )}
                          </td>
                          <td>
                            {org.activeSourceCount.toLocaleString("ar-EG")} /{" "}
                            {org.maxSources.toLocaleString("ar-EG")}
                            {org.pendingCount > 0 && (
                              <span className="minor">
                                {" "}
                                (+{org.pendingCount.toLocaleString("ar-EG")}{" "}
                                معلق)
                              </span>
                            )}
                          </td>
                          <td>{org.allowAdd ? "مفعّلة" : "مقيّدة للأدمن"}</td>
                          <td>
                            {org.feedDays.toLocaleString("ar-EG")} أيام
                          </td>
                          <td>
                            <button
                              className="secondary"
                              onClick={() => {
                                setSelectedOrgId(org.id);
                                setSourceReceipts([]);
                                setTab("manage");
                              }}
                            >
                              اختيار للتعديل
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="admin-two-col">
                <section className="source-panel">
                  <h2>إنشاء جهة جديدة</h2>
                  <form key={orgFormKey} onSubmit={handleCreateOrg} className="admin-form">
                    <div className="field">
                      <label htmlFor="new-org-name">اسم الجهة</label>
                      <input
                        id="new-org-name"
                        type="text"
                        required
                        maxLength={120}
                        placeholder="مثال: الشروق"
                        value={newOrgName}
                        onChange={(e) => setNewOrgName(e.target.value)}
                      />
                    </div>
                    <div className="form-grid-2">
                      <div className="field">
                        <label htmlFor="new-org-max">حد المصادر</label>
                        <input
                          id="new-org-max"
                          type="number"
                          min={0}
                          max={5000}
                          required
                          value={newOrgMax}
                          onChange={(e) => setNewOrgMax(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="new-org-days">نافذة العرض (أيام)</label>
                        <input
                          id="new-org-days"
                          type="number"
                          min={1}
                          max={90}
                          required
                          value={newOrgDays}
                          onChange={(e) => setNewOrgDays(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="field checkbox-field">
                      <label htmlFor="new-org-allow">
                        <input
                          id="new-org-allow"
                          type="checkbox"
                          checked={newOrgAllowAdd}
                          onChange={(e) => setNewOrgAllowAdd(e.target.checked)}
                        />
                        السماح للمحرر بإضافة مصادر بنفسه افتراضيًا
                      </label>
                    </div>
                    <button className="primary" type="submit" disabled={busy}>
                      {busy ? "جارٍ الإنشاء…" : "إنشاء الجهة"}
                    </button>
                  </form>
                </section>

                <section className="source-panel">
                  <h2>إنشاء حساب محرر لجهة</h2>
                  <form key={editorFormKey} onSubmit={handleCreateEditor} className="admin-form">
                    <div className="field">
                      <label htmlFor="editor-org">الجهة المستهدفة</label>
                      <select
                        id="editor-org"
                        required
                        value={editorOrgId}
                        onChange={(e) => setEditorOrgId(e.target.value)}
                      >
                        <option value="">— اختر الجهة صراحةً —</option>
                        {overview.organizations.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="editor-email">البريد الإلكتروني للمحرر</label>
                      <input
                        id="editor-email"
                        dir="ltr"
                        type="email"
                        autoComplete="email"
                        spellCheck={false}
                        required
                        placeholder="editor@example.com"
                        value={editorEmail}
                        onChange={(e) => setEditorEmail(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <div className="label-row">
                        <label htmlFor="editor-password">كلمة السر</label>
                        <button
                          type="button"
                          className="link small-toggle"
                          aria-pressed={showEditorPw}
                          onClick={() => setShowEditorPw((v) => !v)}
                        >
                          {showEditorPw ? "إخفاء" : "إظهار"}
                        </button>
                      </div>
                      <input
                        id="editor-password"
                        dir="ltr"
                        type={showEditorPw ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={editorPassword}
                        onChange={(e) => setEditorPassword(e.target.value)}
                      />
                    </div>
                    <button className="primary" type="submit" disabled={busy}>
                      {busy ? "جارٍ الإنشاء…" : "إنشاء حساب المحرر"}
                    </button>
                  </form>

                  {pendingRecovery && (
                    <div className="recovery-box" role="alert">
                      <p>
                        تم إنشاء حساب الدخول <strong>{pendingRecovery.email}</strong>{" "}
                        لكنه بانتظار ربط العضوية.
                      </p>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void handleRecoverOrphan(
                            pendingRecovery.email,
                            pendingRecovery.orgId,
                          )
                        }
                      >
                        استكمال ربط العضوية بأمان
                      </button>
                    </div>
                  )}
                </section>
              </div>

              {overview.orphanUsers && overview.orphanUsers.length > 0 && (
                <section className="source-panel">
                  <h2>حسابات Auth غير مرتبطة بعضوية (استكمال آمن)</h2>
                  {overview.orphanUsers.map((u) => (
                    <div className="source-row" key={u.userId}>
                      <div className="grow">
                        <strong dir="ltr">{u.email || u.userId}</strong>
                        <div className="minor">
                          حساب موجود في Auth دون صف في newsroom.members
                        </div>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy || !editorOrgId}
                        onClick={() =>
                          u.email && void handleRecoverOrphan(u.email, editorOrgId)
                        }
                      >
                        ربط بالجهة المختارة أعلاه
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}

          {tab === "manage" && (
            <>
              <section className="source-panel target-org-panel">
                <label htmlFor="admin-selected-org">
                  <strong>اختر اسم الجهة المقصودة صراحة قبل أي تعديل</strong>
                </label>
                <div className="target-select-row">
                  <select
                    id="admin-selected-org"
                    value={selectedOrgId}
                    onChange={(e) => {
                      setSelectedOrgId(e.target.value);
                      setSourceReceipts([]);
                      clearFeedback();
                    }}
                  >
                    <option value="">— لم تُختر جهة بعد —</option>
                    {overview.organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.activeSourceCount}/{o.maxSources} مصادر)
                      </option>
                    ))}
                  </select>
                  {selectedOrg && (
                    <span className="selected-pill">
                      الجهة المختارة: <strong>{selectedOrg.name}</strong>
                    </span>
                  )}
                </div>
              </section>

              {!selectedOrg ? (
                <div className="empty">
                  <h3>اختر جهة للمتابعة</h3>
                  <p>
                    لتفادي التعديل على جهة بالخطأ، يجب اختيار اسم الجهة صراحة من
                    القائمة أعلاه قبل تعديل حدودها أو مصادرها.
                  </p>
                </div>
              ) : (
                <>
                  <section className="source-panel">
                    <h2>إعدادات جهة «{selectedOrg.name}»</h2>
                    <OrgSettingsEditor
                      org={selectedOrg}
                      busy={busy}
                      onSave={handleUpdateSelectedOrg}
                    />
                  </section>

                  <div className="sources-grid">
                    <div>
                      <section className="source-panel">
                        <h2>
                          مصادر جهة «{selectedOrg.name}» (
                          {selectedOrg.activeSourceCount.toLocaleString("ar-EG")}{" "}
                          نشط من {selectedOrg.maxSources.toLocaleString("ar-EG")})
                        </h2>
                        {!selectedOrg.sources.length && (
                          <p className="minor">لا توجد مصادر لهذه الجهة بعد.</p>
                        )}
                        {selectedOrg.sources.map((s) => (
                          <div key={s.id} className="source-row">
                            <span
                              className={`source-avatar small kind-${s.platform === "x" ? "x" : s.kind}`}
                            >
                              <SourceKindIcon
                                platform={s.platform}
                                kind={s.kind}
                                size={17}
                              />
                            </span>
                            <div className="grow">
                              {editingSourceId === s.id ? (
                                <div className="approve-inline">
                                  <input
                                    type="text"
                                    aria-label="اسم المصدر الجديد"
                                    maxLength={120}
                                    value={editingSourceName}
                                    onChange={(e) =>
                                      setEditingSourceName(e.target.value)
                                    }
                                  />
                                  <button
                                    className="primary"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleRenameSource(s.id)}
                                  >
                                    حفظ
                                  </button>
                                  <button
                                    className="secondary"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      setEditingSourceId(null);
                                      setEditingSourceName("");
                                    }}
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="source-title-row">
                                    <a
                                      className="source-title-link"
                                      href={sourceUrl(s.locator)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {s.name}
                                    </a>
                                    <span className={`source-type-pill kind-${s.kind}`}>
                                      {s.kind === "group"
                                        ? "جروب عام"
                                        : s.kind === "account"
                                          ? "حساب"
                                          : "صفحة"}
                                    </span>
                                  </div>
                                  <div className="observed-row">
                                    <span className="minor">
                                      {platformName[s.platform]} ·{" "}
                                      {s.active ? "نشط" : "متوقف"}
                                    </span>
                                    <span className="dot-sep" aria-hidden>
                                      •
                                    </span>
                                    <a
                                      className="source-handle-link"
                                      dir="ltr"
                                      href={sourceUrl(s.locator)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {shortSourceDisplay(s.locator)}{" "}
                                      <ExternalIcon size={11} />
                                    </a>
                                  </div>
                                </>
                              )}
                            </div>
                            {editingSourceId !== s.id && (
                              <div className="row-actions">
                                <button
                                  className="secondary"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    setEditingSourceId(s.id);
                                    setEditingSourceName(s.name);
                                  }}
                                >
                                  تعديل الاسم
                                </button>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleToggleOrgSource(
                                      s.id,
                                      s.locator,
                                      s.active,
                                    )
                                  }
                                >
                                  {s.active ? "إيقاف" : "استئناف"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </section>

                      {selectedOrg.pending.length > 0 && (
                        <section className="source-panel">
                          <h2>
                            طلبات قيد التحقق لجهة «{selectedOrg.name}»
                          </h2>
                          {selectedOrg.pending.map((loc) => (
                            <div className="source-row pending-admin-row" key={loc}>
                              <div className="grow">
                                <bdi className="url">{sourceUrl(loc)}</bdi>
                                <div className="approve-inline">
                                  <input
                                    type="text"
                                    aria-label={`اسم المصدر لـ ${loc}`}
                                    placeholder="اسم المصدر العام بعد التحقق"
                                    value={approveNames[loc] || ""}
                                    onChange={(e) =>
                                      setApproveNames((prev) => ({
                                        ...prev,
                                        [loc]: e.target.value,
                                      }))
                                    }
                                  />
                                  <button
                                    className="primary"
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void handleApproveOrgRequest(loc)
                                    }
                                  >
                                    اعتماد
                                  </button>
                                  <button
                                    className="secondary"
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void handleCancelOrgRequest(loc)
                                    }
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </section>
                      )}
                    </div>

                    <section className="source-panel input-panel">
                      <h2>إضافة مصادر لجهة «{selectedOrg.name}»</h2>
                      <form onSubmit={handleAddOrgSources}>
                        <label htmlFor="admin-source-links">
                          أدخل رابطًا واحدًا أو عدة روابط (رابط في كل سطر)
                        </label>
                        <textarea
                          id="admin-source-links"
                          dir="ltr"
                          rows={5}
                          required
                          placeholder={
                            "https://www.facebook.com/Youm7\nhttps://x.com/Youm7"
                          }
                          value={sourceLines}
                          onChange={(e) => setSourceLines(e.target.value)}
                        />
                        <p className="minor">
                          المصدر المؤكد يُضاف فورًا. المصدر غير المعروف يدخل
                          قائمة التحقق.
                        </p>
                        <button
                          className="primary"
                          type="submit"
                          disabled={busy}
                        >
                          {busy
                            ? "جارٍ الحفظ…"
                            : `إضافة المصادر إلى «${selectedOrg.name}»`}
                        </button>
                      </form>
                      {sourceReceipts.length > 0 && (
                        <ul className="receipts" aria-live="polite">
                          {sourceReceipts.map((r, i) => (
                            <li key={i}>
                              <bdi>{r.url}</bdi>
                              <strong>{r.status}</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "runs" && (
            <>
              <section className="source-panel simple-pull-card">
                <div className="simple-pull-head">
                  <div>
                    <h2>سحب أخبار فيسبوك الآن</h2>
                    <p className="minor panel-desc">
                      المصادر النشطة للسحب:{" "}
                      <strong>
                        {overview.uniqueActiveFacebookSources.toLocaleString(
                          "ar-EG",
                        )}{" "}
                        مصادر
                      </strong>{" "}
                      · الحالة:{" "}
                      <strong>
                        {overview.collectorConfigured
                          ? "مفتاح السحب جاهز"
                          : "يحتاج إضافة SOCIALAPIS_API_KEY في .env.local"}
                      </strong>
                    </p>
                  </div>
                  <button
                    className="primary pull-now-btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRunCollection()}
                  >
                    {busy ? "جارٍ السحب…" : "اسحب الآن (مرة واحدة)"}
                  </button>
                </div>

                <div className="ref-inline-row">
                  <span className="minor">
                    توقيت عرض الأخبار:{" "}
                    <strong>
                      {overview.referenceAt
                        ? "عينة ٦ نوفمبر"
                        : "أخبار اليوم المباشرة"}
                    </strong>
                  </span>
                  <div className="row-actions">
                    <button
                      type="button"
                      className={overview.referenceAt ? "primary" : "secondary"}
                      disabled={busy}
                      onClick={() => void handleReferenceToggle(true)}
                    >
                      عرض عينة ٦ نوفمبر
                    </button>
                    <button
                      type="button"
                      className={!overview.referenceAt ? "primary" : "secondary"}
                      disabled={busy}
                      onClick={() => void handleReferenceToggle(false)}
                    >
                      أخبار اليوم
                    </button>
                  </div>
                </div>
              </section>

              <section className="source-panel">
                <h2 id="runs-table-caption">نتيجة آخر سحبة</h2>
                {!overview.runs.length ? (
                  <div className="empty-inline">
                    لم يتم السحب بعد. اضغط «اسحب الآن» لتجربة السحب مرة واحدة
                    وستظهر نتيجة كل مصدر هنا فورًا.
                  </div>
                ) : (
                  <div className="topics-list">
                    {overview.runs.slice(0, 5).map((run) => (
                      <div key={run.id} className="topic-card">
                        <div className="topic-top">
                          <div className="topic-main">
                            <strong>
                              {cairoTime(run.startedAt)} —{" "}
                              {runStatusLabel[run.status] || run.status}
                            </strong>
                            <div className="minor">
                              سُحب {run.requestsMade.toLocaleString("ar-EG")}{" "}
                              مصادر · +{run.insertedCount.toLocaleString("ar-EG")}{" "}
                              جديد · {run.updatedCount.toLocaleString("ar-EG")}{" "}
                              محدث
                              {run.creditsRemaining !== null
                                ? ` · المتبقي: ${run.creditsRemaining.toLocaleString("ar-EG")} Credits`
                                : ""}
                              {run.stopReason ? ` · ${run.stopReason}` : ""}
                            </div>
                          </div>
                        </div>
                        {run.items.length > 0 && (
                          <ul className="receipts">
                            {run.items.map((it) => (
                              <li key={it.sourceId}>
                                <strong>
                                  {it.sourceName} —{" "}
                                  {itemStatusLabel[it.status] || it.status}
                                </strong>
                                <span className="minor">
                                  نتائج: {it.returnedCount} · جديد:{" "}
                                  {it.insertedCount}
                                  {it.emptyResponse ? " · لا جديد" : ""}
                                  {it.errorMessage ? ` · ${it.errorMessage}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default function AdminPanel() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    void client.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session ?? null);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (alive) setSession(nextSession ?? null);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (mode === "demo") {
    return (
      <main className="gate">
        <div className="gate-card">
          <Brand />
          <h1>لوحة الإدارة تتطلب وضع Supabase</h1>
          <p className="minor">
            لوحة أدمن كشيدة تعمل بالتحقق الحقيقي على الخادم مع{" "}
            <code>NEXT_PUBLIC_DATA_MODE=supabase</code>.
          </p>
          <a className="primary" href="/">
            العودة إلى المعاينة التجريبية
          </a>
        </div>
      </main>
    );
  }

  if (mode !== "supabase" || !client) {
    return <ConfigMissingGate />;
  }

  if (session === undefined) {
    return (
      <main className="gate" role="status">
        جارٍ فتح لوحة الإدارة…
      </main>
    );
  }

  return session ? (
    <AdminWorkspace key={session.user.id} session={session} />
  ) : (
    <SignIn
      heading="دخول لوحة إدارة كشيدة"
      subtitle="الدخول مخصص لحساب أدمن كشيدة المعتمد."
    />
  );
}
