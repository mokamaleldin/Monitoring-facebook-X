"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { client, mode, workspaces } from "../lib/backend";
import { demoSpaces } from "../lib/fixtures";
import type { Space } from "../lib/model";
import Workspace from "./Workspace";

export function Brand() {
  return <span className="brand" role="img" aria-label="كشيدة" />;
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const fields = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const result = await client.auth.signInWithPassword({
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password")),
      });
      if (result.error) setError("تعذّر تسجيل الدخول. راجع البريد وكلمة السر.");
    } catch {
      setError("تعذّر الاتصال. جرّب مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="gate">
      <div className="gate-card">
        <Brand />
        <h1>دخول غرفة الأخبار</h1>
        <form onSubmit={submit}>
          <label>
            البريد الإلكتروني
            <input
              dir="ltr"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </label>
          <label>
            كلمة السر
            <input
              dir="ltr"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "جارٍ الدخول…" : "دخول"}
          </button>
        </form>
      </div>
    </main>
  );
}
function Connected({ session }: { session: Session }) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    workspaces()
      .then((items) => {
        if (alive) setSpaces(items);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [retry, session.user.id]);
  if (error)
    return (
      <main className="gate">
        <div>
          تعذّر تحميل الجهة.{" "}
          <button
            onClick={() => {
              setError(false);
              setRetry((r) => r + 1);
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </main>
    );
  if (!spaces)
    return (
      <main className="gate" role="status">
        جارٍ تحميل مساحة العمل…
      </main>
    );
  if (!spaces.length)
    return (
      <main className="gate">
        <div>
          الحساب غير مرتبط بجهة. يستطيع أدمن كشيدة تفعيل العضوية.{" "}
          <button onClick={() => void client?.auth.signOut()}>خروج</button>
        </div>
      </main>
    );
  return <Workspace key={session.user.id} spaces={spaces} isDemo={false} />;
}
export default function Newsroom() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, s) =>
      setSession(s),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  if (mode === "demo") return <Workspace spaces={demoSpaces} isDemo />;
  if (mode !== "supabase" || !client)
    return (
      <main className="gate" role="alert">
        إعداد اتصال المنصة غير مكتمل. راجع أدمن كشيدة.
      </main>
    );
  if (session === undefined)
    return (
      <main className="gate" role="status">
        جارٍ فتح مساحة العمل…
      </main>
    );
  return session ? (
    <Connected key={session.user.id} session={session} />
  ) : (
    <SignIn />
  );
}
