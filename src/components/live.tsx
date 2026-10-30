"use client";
import { useEffect, useRef, useState } from "react";
import { Asterisk, Ban, Check, Gauge, RotateCw, X } from "lucide-react";
import type { FeedItem } from "@/lib/views";
import type { LadderStep } from "@/lib/views";
import { usePoll } from "./usePoll";
import { Ago, Chip, CopyButton } from "./ui";
import { PATTERN_LABEL, STATUS_LABEL } from "./format";

const ICON: Record<string, typeof Check> = {
  valid: Check,
  invalid: X,
  no_mx: Ban,
  catch_all: Asterisk,
  retry: RotateCw,
  fatal: Ban,
  rate_limited: Gauge,
};

/** Every MailTester check as it happens; new rows slide in. */
export function LiveFeed({ limit = 30, maxHeight }: { limit?: number; maxHeight?: number }) {
  const { data } = usePoll<{ items: FeedItem[] }>(`/api/feed?limit=${limit}`, 2000);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const ids = data.items.map((i) => i.id);
    if (seen.current === null) {
      seen.current = new Set(ids); // first load: nothing is "new"
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    added.forEach((id) => seen.current!.add(id));
    if (added.length) setFresh(new Set(added));
  }, [data]);

  if (!data) {
    return (
      <div className="feed">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skel" style={{ height: 30, margin: "4px 8px" }} />
        ))}
      </div>
    );
  }
  if (data.items.length === 0) {
    return <div className="empty">No checks yet. Start a lookup and watch them stream in here.</div>;
  }
  return (
    <div className="feed" style={maxHeight ? { maxHeight } : undefined} aria-live="polite">
      {data.items.map((it) => {
        const Icon = ICON[it.verdict] ?? RotateCw;
        return (
          <div key={it.id} className={`feed-item${fresh.has(it.id) ? " is-new" : ""}`}>
            <span className={`fi-icon ${it.verdict}`}>
              <Icon size={13} strokeWidth={2.2} />
            </span>
            <span className="fi-email" title={it.email}>
              {it.email}
            </span>
            <span className="fi-meta">
              <span>{it.message || STATUS_LABEL[it.verdict]}</span>
              <Ago at={it.created_at} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The 9 combinations for one person: what was tried, in order, and the answer. */
export function Ladder({ steps, pending }: { steps: LadderStep[]; pending: boolean }) {
  const scanIndex = pending ? steps.findIndex((s) => s.state === "queued" || s.state === "retry") : -1;
  return (
    <div className="ladder">
      {steps.map((s, i) => {
        const state = i === scanIndex ? "scan" : s.state;
        const [local, domain] = s.email.split("@");
        return (
          <div key={s.email} className={`rung is-${state}`} style={{ ["--i" as string]: i }}>
            <span className="rung-n">
              {s.state === "valid" ? <Check size={14} strokeWidth={3} /> : s.state === "invalid" ? <X size={13} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="rung-pattern">{PATTERN_LABEL[s.pattern] ?? s.pattern}</span>
            <span className="rung-email">
              {local}
              <span className="at">@{domain}</span>
            </span>
            <span className="rung-res">
              {state === "scan" ? (
                <>
                  <span className="spinner" /> <span style={{ color: "var(--accent)" }}>Checking…</span>
                </>
              ) : s.state === "queued" ? (
                "Queued"
              ) : s.state === "skipped" ? (
                "Not needed"
              ) : (
                <>
                  {s.cached && <span className="tag">cached</span>}
                  {s.attempts > 1 && <span className="faint num">{s.attempts} tries</span>}
                  <Chip status={s.state}>{s.message || undefined}</Chip>
                  {s.state === "valid" && <CopyButton text={s.email} />}
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
