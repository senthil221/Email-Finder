"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Check, Home, List, Mail, Search, Upload, X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { usePoll } from "./usePoll";
import { compact } from "./format";

const NAV = [
  { href: "/", label: "Overview", icon: Home, match: (p: string) => p === "/" },
  { href: "/find", label: "Find one email", icon: Search, match: (p: string) => p.startsWith("/find") },
  { href: "/upload", label: "Upload a list", icon: Upload, match: (p: string) => p.startsWith("/upload") },
  { href: "/jobs", label: "Lists", icon: List, match: (p: string) => p.startsWith("/jobs") },
  { href: "/domains", label: "Companies", icon: Building2, match: (p: string) => p.startsWith("/domains") },
];

const WORKER_WORD: Record<string, string> = {
  running: "Finder is working",
  idle: "Finder is idle",
  paused_daily_limit: "Paused: daily limit reached",
  error: "Finder has a problem",
  offline: "Finder is offline",
  stopped: "Finder is stopped",
};

type Status = {
  worker: { state: string; message: string | null; n2b_credits: number | null } | null;
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
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 4500);
    };
    window.addEventListener("ef-toast", on);
    return () => window.removeEventListener("ef-toast", on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.tone === "bad" ? <X size={16} className="bad-ink" /> : <Check size={16} className={t.tone === "ok" ? "ok-ink" : "warn-ink"} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data } = usePoll<Status>("/api/status", 10_000);
  const state = data ? (data.online ? (data.worker?.state ?? "idle") : "offline") : null;
  const dot = state === "running" ? "done" : state === "paused_daily_limit" ? "pending" : state === "error" || state === "offline" ? "error" : "idle";

  return (
    <div className="app">
      <aside className="side">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Mail size={15} strokeWidth={2} />
          </span>
          Email Finder
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon, match }) => (
            <Link key={href} href={href} className={match(pathname) ? "is-on" : ""} aria-current={match(pathname) ? "page" : undefined}>
              <Icon size={17} strokeWidth={1.6} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          {data && (
            <>
              <span className="status" title={data.worker?.message ?? ""}>
                <span className={`dot ${dot}`} />
                {WORKER_WORD[state ?? ""] ?? `Finder: ${state}`}
              </span>
              {state === "error" && data.worker?.message && <span className="bad-ink">{data.worker.message}</span>}
              <span className="meter-line" title="MailTester checks in the last 24 hours, of the daily limit">
                <span>MailTester today</span>
                <span className="num">
                  {compact(data.checksLast24h)} / {compact(data.dailyLimit)}
                </span>
              </span>
              {data.worker?.n2b_credits != null && (
                <span className="meter-line" title="no2bounce credits left on the account">
                  <span>no2bounce credits</span>
                  <span className="num">{compact(data.worker.n2b_credits)}</span>
                </span>
              )}
            </>
          )}
          <div className="row" style={{ marginLeft: -6 }}>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
      <Toasts />
    </div>
  );
}
