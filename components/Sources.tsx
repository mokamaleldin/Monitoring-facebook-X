import { useState, type FormEvent } from "react";
import { platformName, sourceUrl, type Snapshot } from "../lib/model";
type Entry = { url: string; status: string };
type Props = {
  data: Snapshot;
  canAdd: boolean;
  isDemo: boolean;
  busy: boolean;
  add: (lines: string[]) => Promise<Entry[]>;
  change: (id: string, loc: string, active: boolean) => Promise<string>;
  cancel: (loc: string) => Promise<string>;
};
export function Sources({
  data,
  canAdd,
  isDemo,
  busy,
  add,
  change,
  cancel,
}: Props) {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Entry[]>([]);
  const [notice, setNotice] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setNotice("");
    const lines = input
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length || lines.length > 100) {
      setNotice("أدخل من رابط واحد إلى ١٠٠ رابط في الدفعة.");
      return;
    }
    const results = await add(lines);
    setRows(results);
    setInput("");
  }
  async function toggle(fn: () => Promise<string>) {
    try {
      setNotice(await fn());
    } catch {
      setNotice("تعذّر حفظ التغيير. أعد المحاولة.");
    }
  }
  return (
    <div className="sources-grid">
      <div>
        <section className="source-panel">
          <h2>مصادر الجهة</h2>
          {!data.sources.length && (
            <p className="minor">قائمة المصادر فارغة.</p>
          )}
          {data.sources.map((s) => (
            <div key={s.id} className="source-row">
              <span className="source-avatar small">{s.name.charAt(0)}</span>
              <div className="grow">
                <strong>{s.name}</strong>
                <div className="minor">
                  {platformName[s.platform]} ·{" "}
                  {s.kind === "group"
                    ? "جروب عام"
                    : s.kind === "account"
                      ? "حساب"
                      : "صفحة"}{" "}
                  · {s.active ? "نشط" : "متوقف"}
                </div>
              </div>
              <button
                className="secondary"
                disabled={busy || (!s.active && !canAdd)}
                onClick={() =>
                  void toggle(() => change(s.id, s.locator, s.active))
                }
              >
                {s.active ? "إيقاف" : "استئناف"}
              </button>
            </div>
          ))}
        </section>
        {data.pending.length > 0 && (
          <section className="source-panel">
            <h2>في انتظار التحقق</h2>
            {data.pending.map((loc) => (
              <div className="source-row" key={loc}>
                <bdi className="url grow">{sourceUrl(loc)}</bdi>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void toggle(() => cancel(loc))}
                >
                  إلغاء الطلب
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
      <section className="source-panel input-panel">
        <h2>أضف مصادر</h2>
        {canAdd ? (
          <form onSubmit={submit}>
            <label htmlFor="source-links">
              رابط صفحة أو جروب عام أو حساب X
            </label>
            <textarea
              dir="ltr"
              id="source-links"
              placeholder={"facebook.com/Youm7\nx.com/Youm7"}
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
              maxLength={50000}
            />
            <p className="minor">
              كل رابط في سطر. يظهر المصدر الجديد بعد التحقق منه.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? "جارٍ الحفظ…" : "إضافة المصادر"}
            </button>
            {isDemo && (
              <button
                className="link example"
                type="button"
                disabled={busy}
                onClick={() => setInput("https://x.com/Youm7")}
              >
                تجربة حساب X محفوظ
              </button>
            )}
          </form>
        ) : (
          <p>إدارة الإضافات متاحة لأدمن كشيدة.</p>
        )}
        {rows.length > 0 && (
          <ul
            className="receipts"
            aria-label="نتيجة الإضافة"
            aria-live="polite"
          >
            {rows.map((s, i) => (
              <li key={i}>
                <bdi>{s.url}</bdi>
                <strong>{s.status}</strong>
              </li>
            ))}
          </ul>
        )}
        <p role="status" className="notice">
          {notice}
        </p>
      </section>
    </div>
  );
}
