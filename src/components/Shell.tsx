"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, BarChart3, Check, Globe, History, LayoutDashboard, ScanSearch, Search, UploadCloud, X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { usePoll } from "./usePoll";
import { Ring } from "./ui";
import { compact, n, STATUS_LABEL } from "./format";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, match: (p: string) => p === "/" },
  { href: "/find", label: "Live finder", icon: ScanSearch, match: (p: string) => p.startsWith("/find"), kbd: "K" },
  { href: "/upload", label: "Bulk upload", icon: UploadCloud, match: (p: string) => p.startsWith("/upload") },
  { href: "/jobs", label: "History", icon: History, match: (p: string) => p.startsWith("/jobs") },
  { href: "/insights", label: "Insights", icon: BarChart3, match: (p: string) => p.startsWith("/insights") },
  { href: "/domains", label: "Domains", icon: Globe, match: (p: string) => p.startsWith("/domains") },
];

type Status = {
  worker: { state: string; message: string | null } | null;
  online: boolean;
  checksLast24h: number;
  dailyLimit: number;
};

// ---------- toasts ----------
type Toast = { id: number; text: string; tone: "ok" | "warn" | "bad" };
export function toast(text: string, tone: Toast["tone"] = "ok") {
  window.dispatchEvent(new CustomEvent("ef-toast", { detail: { text, tone } }));
}
function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = { id: Date.now() + Math.random(), ...(e as CustomEvent).detail } as Toast;
      setItems((x) => [...x.slice(-3), t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 4200);
    };
    window.addEventListener("ef-toast", on);
    return () => window.removeEventListener("ef-toast", on);
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="t-ico">{t.tone === "ok" ? <Check size={15} strokeWidth={3} /> : t.tone === "warn" ? <AlertTriangle size={14} /> : <X size={15} />}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- command palette: "senthil nathan b2bdrive.net" + Enter ----------
export function parseQuick(q: string): { first: string; last: string; domain: string } {
  const parts = q.trim().split(/[\s,]+/).filter(Boolean);
  const di = parts.findLastIndex((p) => p.includes("."));
  const domain =
    di >= 0
      ? parts.splice(di, 1)[0].toLowerCase().replace(/^.*@/, "").replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^www\d*\./, "")
      : "";
  return { first: parts[0] ?? "", last: parts.slice(1).join(" "), domain };
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const p = parseQuick(q);
  const ready = !!p.first && !!p.domain;

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
  }, [open]);

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      onClose();
      setQ("");
      router.push(`/find?id=${body.id}`);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Quick find">
        <div className="cmdk-input">
          <ScanSearch size={18} />
          <input
            ref={input}
            value={q}
            placeholder="Andrew Deepak acme.com"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
              if (e.key === "Escape") onClose();
            }}
          />
          {busy ? <span className="spinner" /> : <span className="kbd">↵</span>}
        </div>
        <div className="cmdk-hint">
          {q ? (
            <div className="cmdk-parse">
              <span>
                <em>first</em> {p.first || "–"}
              </span>
              <span>
                <em>last</em> {p.last || "–"}
              </span>
              <span>
                <em>domain</em> {p.domain || "–"}
              </span>
              {ready && <span style={{ background: "var(--accent-soft)", color: "var(--ink)" }}>Press Enter to find</span>}
            </div>
          ) : (
            <span>Type a name and a company domain, then press Enter. The lookup starts at once.</span>
          )}
        </div>
        <div className="cmdk-list">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={onClose}>
              <Icon size={15} strokeWidth={1.6} /> {label}
              <ArrowRight size={13} style={{ marginLeft: "auto" }} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Dashboard"],
  [/^\/find/, "Live finder"],
  [/^\/upload/, "Bulk upload"],
  [/^\/jobs\/./, "Job"],
  [/^\/jobs/, "History"],
  [/^\/domains/, "Domains"],
  [/^\/insights/, "Insights"],
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [palette, setPalette] = useState(false);
  const { data } = usePoll<Status>("/api/status", 5000);
  const close = useCallback(() => setPalette(false), []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const state = data ? (data.online ? (data.worker?.state ?? "idle") : "offline") : null;
  const pct = data ? (data.checksLast24h / data.dailyLimit) * 100 : 0;
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "";
  const dot = state === "running" ? "" : state === "idle" ? "idle" : state === "paused_daily_limit" ? "warn" : "off";

  return (
    <div className="app">
      <aside className="rail">
        <Link href="/" className="brand">
          <span className="radar" />
          <span className="brand-name">
            Email <i>Finder</i>
          </span>
        </Link>
        <nav className="nav">
          <div className="nav-label">Workspace</div>
          {NAV.map(({ href, label, icon: Icon, match, kbd }) => (
            <Link key={href} href={href} className={match(pathname) ? "is-on" : ""}>
              <Icon size={16} strokeWidth={1.6} />
              {label}
              {kbd && <span className="kbd">Ctrl {kbd}</span>}
            </Link>
          ))}
        </nav>
        <div className="rail-foot">
          {data && (
            <div className="quota" title={data.worker?.message ?? ""}>
              <Ring pct={pct} size={44} stroke={5} warn={pct > 85}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0, textTransform: "none", color: "var(--ink)" }}>{Math.round(pct)}%</span>
              </Ring>
              <div>
                <div className="q-label">MailTester · 24h</div>
                <div className="q-val">
                  {compact(data.checksLast24h)} <span className="faint" style={{ fontWeight: 400 }}>/ {compact(data.dailyLimit)}</span>
                </div>
              </div>
              <div className="q-sub">
                <span className={`live-dot ${dot}`} />
                Worker {STATUS_LABEL[state ?? ""]?.toLowerCase() ?? state}
              </div>
              {state === "error" && data.worker?.message && (
                <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: "var(--bad-ink)" }}>{data.worker.message}</div>
              )}
            </div>
          )}
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="crumbs">
            <span>Email Finder</span>
            <span className="faint">/</span>
            <b>{title}</b>
          </div>
          <div className="top-tools">
            <button className="cmdk-trigger" onClick={() => setPalette(true)}>
              <Search size={14} />
              <span className="label">Find an email…</span>
              <span className="kbd">Ctrl K</span>
            </button>
            {data && (
              <span className={`chip ${state === "running" ? "live" : (state ?? "")}`} title={`${n(data.checksLast24h)} checks in 24h`}>
                {state === "running" ? "Live" : STATUS_LABEL[state ?? ""]}
              </span>
            )}
            <ThemeToggle />
          </div>
        </header>
        <div key={pathname} style={{ animation: "fade 220ms var(--ease)" }}>
          {children}
        </div>
      </div>
      <CommandPalette open={palette} onClose={close} />
      <Toasts />
    </div>
  );
}
