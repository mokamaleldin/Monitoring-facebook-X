"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { adminOverview, client, mode, workspaces } from "../lib/backend";
import { demoSpaces } from "../lib/fixtures";
import type { Space } from "../lib/model";
import { Brand, ConfigMissingGate, SignIn } from "./SignIn";
import Workspace from "./Workspace";

export { Brand };

function AdminRedirect() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.location.replace("/admin/");
    }
  }, []);

  return (
    <main className="gate" role="status">
      <div className="gate-card">
        <Brand />
        <h1>جارٍ فتح لوحة إدارة كشيدة…</h1>
        <p className="minor">
          إن لم يتم التحويل تلقائيًا، افتح{" "}
          <a href="/admin/">لوحة الإدارة</a>.
        </p>
      </div>
    </main>
  );
}

function Connected({ session }: { session: Session }) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    workspaces()
      .then(async (items) => {
        if (!alive) return;
        if (items.some((s) => s.role === "platform_admin")) {
          setIsAdminUser(true);
          setSpaces(items);
          return;
        }
        if (items.length === 0) {
          try {
            await adminOverview();
            if (alive) {
              setIsAdminUser(true);
              setSpaces([]);
              return;
            }
          } catch {
            /* not an admin; genuinely unassigned account */
          }
        }
        if (alive) setSpaces(items);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [retry, session.user.id]);

  if (error) {
    return (
      <main className="gate">
        <div className="gate-card">
          <Brand />
          <p role="alert">تعذّر تحميل مساحة العمل.</p>
          <div className="action-row">
            <button
              className="primary"
              onClick={() => {
                setError(false);
                setRetry((r) => r + 1);
              }}
            >
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

  if (spaces === null) {
    return (
      <main className="gate" role="status">
        جارٍ تحميل مساحة العمل…
      </main>
    );
  }

  if (isAdminUser) {
    return <AdminRedirect />;
  }

  if (!spaces.length) {
    return (
      <main className="gate">
        <div className="gate-card">
          <Brand />
          <h1>الحساب غير مرتبط بجهة</h1>
          <p className="minor">
            لم تُسند جهة لهذا الحساب بعد. يستطيع أدمن كشيدة تفعيل العضوية من لوحة
            الإدارة.
          </p>
          <button
            className="secondary"
            onClick={() => void client?.auth.signOut()}
          >
            تسجيل الخروج
          </button>
        </div>
      </main>
    );
  }

  return (
    <Workspace
      key={session.user.id}
      spaces={spaces}
      isDemo={false}
      userEmail={session.user.email ?? undefined}
    />
  );
}

export default function Newsroom() {
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
    return <Workspace spaces={demoSpaces} isDemo />;
  }

  if (mode !== "supabase" || !client) {
    return <ConfigMissingGate />;
  }

  if (session === undefined) {
    return (
      <main className="gate" role="status">
        جارٍ فتح مساحة العمل…
      </main>
    );
  }

  return session ? (
    <Connected key={session.user.id} session={session} />
  ) : (
    <SignIn />
  );
}
