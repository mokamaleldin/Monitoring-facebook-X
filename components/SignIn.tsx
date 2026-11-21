"use client";

import { useState, type FormEvent } from "react";
import { client } from "../lib/backend";

export function Brand() {
  return <span className="brand" role="img" aria-label="كشيدة" />;
}

export function ConfigMissingGate() {
  return (
    <main className="gate" role="alert">
      <div className="gate-card">
        <Brand />
        <h1>إعداد الدخول غير مكتمل</h1>
        <p className="minor">
          التطبيق مضبوط على وضع <code>supabase</code>، لكن متغيرات الاتصال
          العامة غير متوفرة وقت البناء:{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> و
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>.
        </p>
        <p className="minor">
          راجع أدمن كشيدة أو ملف <code>.env.example</code> لإكمال الإعداد.
        </p>
      </div>
    </main>
  );
}

export function SignIn({
  heading = "دخول غرفة الأخبار",
  subtitle = "سجّل الدخول بحسابك المعتمد من إدارة كشيدة.",
}: {
  heading?: string;
  subtitle?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    setError("");
    setBusy(true);
    try {
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) {
        const status =
          typeof result.error.status === "number" ? result.error.status : null;
        const msg = String(result.error.message || "").toLowerCase();
        const isNetworkError =
          status === 0 ||
          result.error.name === "AuthRetryableFetchError" ||
          msg.includes("failed to fetch") ||
          msg.includes("fetch failed") ||
          msg.includes("network");
        setError(
          isNetworkError
            ? "تعذّر الاتصال بخادم الدخول. لو شغال محليًا، شغّل الأمر npm run local:supabase أو npm run dev:local."
            : "تعذّر تسجيل الدخول. راجع البريد الإلكتروني وكلمة السر.",
        );
      }
    } catch {
      setError(
        "تعذّر الاتصال بخادم الدخول. لو شغال محليًا، شغّل الأمر npm run local:supabase أو npm run dev:local.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <Brand />
        <h1>{heading}</h1>
        <p className="minor gate-subtitle">{subtitle}</p>
        <form onSubmit={submit} className="auth-form">
          <div className="field">
            <label htmlFor="signin-email">البريد الإلكتروني</label>
            <input
              id="signin-email"
              dir="ltr"
              name="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              enterKeyHint="next"
              required
            />
            <span className="error-msg" aria-live="polite">
              أدخل بريدًا إلكترونيًا بصيغة صحيحة مثل name@example.com.
            </span>
          </div>
          <div className="field">
            <div className="label-row">
              <label htmlFor="signin-password">كلمة السر</label>
              <button
                type="button"
                className="link small-toggle"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "إخفاء" : "إظهار"}
              </button>
            </div>
            <input
              id="signin-password"
              dir="ltr"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              enterKeyHint="done"
              required
            />
            <span className="error-msg" aria-live="polite">
              أدخل كلمة السر للمتابعة.
            </span>
          </div>
          {error && (
            <p className="form-alert" role="alert">
              {error}
            </p>
          )}
          <button className="primary full-btn" type="submit" disabled={busy}>
            {busy ? "جارٍ الدخول…" : "دخول"}
          </button>
        </form>
        <p className="minor gate-foot">
          التسجيل العام مغلق. إنشاء الحسابات وإسناد الجهات يتم عبر أدمن كشيدة فقط.
        </p>
      </div>
    </main>
  );
}
