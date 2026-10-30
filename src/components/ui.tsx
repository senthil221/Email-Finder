"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { STATUS_LABEL, n } from "./format";

/** A coloured dot and a word. */
export function Status({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className="status">
      <span className={`dot ${status}`} aria-hidden="true" />
      {children ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function CopyButton({ text, label = "Copy email" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn copy"
      title={label}
      aria-label={`${label}: ${text}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? <Check size={15} className="ok-ink" /> : <Copy size={15} strokeWidth={1.6} />}
    </button>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          className={`tab${value === it.value ? " is-on" : ""}`}
          onClick={() => onChange(it.value)}
        >
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
        Page {n(page + 1)} of {n(pages)}
      </span>
      <div className="row">
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

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

/** One headline number. */
export function Stat({ label, value, sub, tone }: { label: ReactNode; value: number | string | undefined; sub?: ReactNode; tone?: string }) {
  return (
    <div className="stat">
      <div className="k">
        {tone && <span className={`dot ${tone}`} aria-hidden="true" />}
        {label}
      </div>
      <div className="v">{value === undefined ? <span className="skel" style={{ display: "inline-block", width: 80, height: 26 }} /> : typeof value === "number" ? n(value) : value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Progress({ pct, done }: { pct: number; done?: boolean }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className={`progress${done ? " done" : ""}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${v}%` }} />
    </div>
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

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height: 24 }} />
      ))}
    </div>
  );
}
