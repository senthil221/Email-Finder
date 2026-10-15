"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { STATUS_LABEL, n } from "./format";

/** Number that rolls to its new value. */
export function CountUp({ value, decimals = 0, ms = 900 }: { value: number; decimals?: number; ms?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 4);
      const v = a + (value - a) * e;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, ms]);
  return <>{decimals ? shown.toFixed(decimals) : n(Math.round(shown))}</>;
}

export function Chip({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`chip ${status}`}>{children ?? STATUS_LABEL[status] ?? status}</span>;
}

export function Ring({
  pct,
  size = 120,
  stroke = 9,
  done,
  warn,
  children,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  done?: boolean;
  warn?: boolean;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [p, setP] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setP(Math.max(0, Math.min(100, pct))));
    return () => cancelAnimationFrame(t);
  }, [pct]);
  return (
    <div className={`ring${done ? " is-done" : ""}${warn ? " warn" : ""}`} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c - (p / 100) * c}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

export function Bar({ pct, live, done, style }: { pct: number; live?: boolean; done?: boolean; style?: React.CSSProperties }) {
  return (
    <div className={`bar${live ? " is-live" : ""}${done ? " is-done" : ""}`} style={style}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

const STACK = ["found", "catch_all", "not_found", "unverified"] as const;

/** Result mix as one bar: found / catch-all / not found / unverified, remaining track = still pending. */
export function StackBar({
  counts,
  total,
  height = 10,
  legend = true,
}: {
  counts: Partial<Record<(typeof STACK)[number], number>>;
  total: number;
  height?: number;
  legend?: boolean;
}) {
  const [tip, setTip] = useState<{ x: number; label: string; v: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const done = STACK.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const rest = Math.max(0, total - done);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div ref={box} style={{ position: "relative" }} onPointerLeave={() => setTip(null)}>
        <div className="stack" style={{ height }} role="img" aria-label={STACK.map((k) => `${STATUS_LABEL[k]} ${counts[k] ?? 0}`).join(", ")}>
          {STACK.map((k) =>
            (counts[k] ?? 0) > 0 ? (
              <span
                key={k}
                className={`s-${k}`}
                style={{ flexGrow: counts[k] }}
                onPointerMove={(e) => {
                  const rect = box.current!.getBoundingClientRect();
                  setTip({ x: e.clientX - rect.left, label: STATUS_LABEL[k], v: counts[k]! });
                }}
              />
            ) : null,
          )}
          {rest > 0 && <span className="s-pending" style={{ flexGrow: rest }} />}
        </div>
        {tip && (
          <div className="tip" style={{ left: tip.x, top: 0 }}>
            <div className="t-row">
              <b>{n(tip.v)}</b>
              <span className="muted">{tip.label}</span>
              <span className="faint">{total ? Math.round((tip.v / total) * 100) : 0}%</span>
            </div>
          </div>
        )}
      </div>
      {legend && (
        <div className="legend">
          {STACK.map((k) => (
            <span key={k}>
              <i className={`s-${k}`} />
              {STATUS_LABEL[k]} <b>{n(counts[k] ?? 0)}</b>
            </span>
          ))}
          {rest > 0 && (
            <span>
              <i style={{ background: "var(--surface-4)" }} />
              Pending <b>{n(rest)}</b>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function CopyButton({ text, size = 14 }: { text: string; size?: number }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="copy-btn copy"
      title="Copy email"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? <Check size={size} style={{ color: "var(--ok-ink)" }} /> : <Copy size={size} strokeWidth={1.6} />}
    </button>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number; swatch?: string }[];
}) {
  return (
    <div className="seg" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} className={value === it.value ? "is-on" : ""} onClick={() => onChange(it.value)}>
          {it.swatch && <i className={`sw ${it.swatch}`} />}
          {it.label}
          {it.count !== undefined && <span className="n">{n(it.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <span className="num">
        Page {page + 1} of {n(pages)}
      </span>
      <div className="toolbar">
        <button className="btn btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-head rise">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

/** "3s ago", "4m ago" - re-renders every few seconds. */
export function Ago({ at }: { at: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, []);
  if (!at || now === null) return null;
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  const txt = s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
  return <span className="num">{txt}</span>;
}
