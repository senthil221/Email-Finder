"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Asterisk, Check, Download, Layers, Pause, Play, Search, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import type { JobRow, JobSummary } from "@/lib/repo";
import { usePoll } from "@/components/usePoll";
import { Chip, CopyButton, CountUp, PageHead, Pager, Ring, Seg, StackBar } from "@/components/ui";
import { toast } from "@/components/Shell";
import { fmtDate, fmtEta, jobState, n, PATTERN_LABEL, PROVIDER_LABEL, REASON_LABEL } from "@/components/format";

type Resp = { job: JobSummary; rows: JobRow[]; rate: number; etaMinutes: number | null; recent: JobRow[] };

const TABS = [
  ["", "All", "total"],
  ["found", "Found", "found"],
  ["catch_all", "Catch-all", "catch_all"],
  ["not_found", "Not found", "not_found"],
  ["unverified", "Unverified", "unverified"],
  ["pending", "Pending", "pending"],
  ["invalid_input", "Invalid", "invalid_input"],
] as const;
const PAGE = 100;
/** no2bounce combinations tried per person at most (NO2BOUNCE_COMBOS). */
const MAX_CREDITS = 4;

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [acting, setActing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const url = `/api/jobs/${id}?page=${page}&size=${PAGE}${tab ? `&status=${tab}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const { data, error, reload } = usePoll<Resp>(url, 2000);
  const job = data?.job;

  // Toast when the job finishes while you watch.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!job) return;
    const st = jobState(job);
    if (st === "running") wasRunning.current = true;
    else if (st === "done" && wasRunning.current) {
      wasRunning.current = false;
      toast(`${job.name} finished: ${n(job.found)} emails found`);
    }
  }, [job]);

  if (error && !data) {
    return (
      <div className="page">
        <div className="notice err">{error}</div>
      </div>
    );
  }
  if (!job || !data) {
    return (
      <div className="page">
        <div className="skel" style={{ height: 60, width: 340 }} />
        <div className="skel" style={{ height: 200 }} />
        <div className="skel" style={{ height: 300 }} />
      </div>
    );
  }

  const st = jobState(job);
  const decided = job.total - job.pending;
  const pct = job.total ? (decided / job.total) * 100 : 0;
  const tabCount = TABS.find(([k]) => k === tab)![2];
  const showPick = tab === "catch_all";
  const caOpen = Math.max(0, job.catch_all - job.ca_checked - job.ca_queued);
  const pickable = data.rows.filter((r) => r.status === "catch_all" && !r.ca);
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(r.id));
  // People queued or checked since they were picked drop out of the selection.
  const gone = new Set(data.rows.filter((r) => r.status !== "catch_all" || r.ca).map((r) => r.id));
  const chosen = [...picked].filter((x) => !gone.has(x));

  async function act(path: "cancel" | "start") {
    setActing(true);
    await fetch(`/api/jobs/${id}/${path}`, { method: "POST" });
    toast(path === "cancel" ? "Job stopped. Resume any time." : "Job resumed", path === "cancel" ? "warn" : "ok");
    reload();
    setActing(false);
  }

  async function verify(ids: string[] | null) {
    const count = ids ? ids.length : caOpen;
    if (!count) return;
    const ok = window.confirm(
      `Check ${n(count)} catch-all ${count === 1 ? "person" : "people"} with no2bounce?\n\nThis uses up to ${n(count * MAX_CREDITS)} credits (at most ${MAX_CREDITS} per person; it stops at the first address that works).`,
    );
    if (!ok) return;
    setActing(true);
    try {
      const res = await fetch(`/api/jobs/${id}/catch-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : { all: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      toast(`${n(body.queued)} queued for no2bounce. Results show up here as they come in.`);
      setPicked(new Set());
      reload();
    } catch (e) {
      toast(`Could not queue them: ${(e as Error).message}`, "bad");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <Layers size={13} /> Bulk job · {fmtDate(job.created_at)}
          </>
        }
        title={job.name}
      >
        {st === "running" && (
          <button className="btn btn-danger" onClick={() => act("cancel")} disabled={acting}>
            <Pause size={14} /> Stop
          </button>
        )}
        {st === "cancelled" && job.pending > 0 && (
          <button className="btn" onClick={() => act("start")} disabled={acting}>
            <Play size={14} /> Resume
          </button>
        )}
        <a className="btn" href={`/api/jobs/${id}/export`}>
          <Download size={14} /> Export all
        </a>
        <a
          className="btn"
          href={`/api/jobs/${id}/export?status=no_email`}
          title="Everyone without an email (catch-all, not found, unverified), with your original columns incl. LinkedIn URL"
        >
          <Download size={14} /> No-email list ({n(job.catch_all + job.not_found + job.unverified)})
        </a>
        <a className="btn btn-primary" href={`/api/jobs/${id}/export?status=found`}>
          <Download size={14} /> Export {n(job.found)} found
        </a>
      </PageHead>

      <section className="grid g-main">
        <div className="panel glow rise" style={{ ["--i" as string]: 1 }}>
          <div className="panel-body" style={{ display: "flex", gap: 26, alignItems: "center", flexWrap: "wrap" }}>
            <Ring pct={pct} size={150} stroke={11} done={st === "done"}>
              <b>
                <CountUp value={Math.round(pct)} />%
              </b>
              <span>{st === "done" ? "complete" : st === "running" ? "scanning" : "progress"}</span>
            </Ring>
            <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 18 }}>
              <div className="row" style={{ gap: 10 }}>
                <Chip status={st === "running" ? "live" : st}>{st === "running" ? "Live" : undefined}</Chip>
                <span className="muted num">
                  {n(decided)} of {n(job.total)} people decided
                </span>
              </div>
              <div className="stat-inline">
                <div>
                  <span className="k">Found</span>
                  <span className="v" style={{ color: "var(--ok-ink)" }}>
                    <CountUp value={job.found} />
                  </span>
                </div>
                <div title="Published on the company's own website: found without a MailTester check">
                  <span className="k">From websites</span>
                  <span className="v" style={{ color: "var(--ok-ink)" }}>
                    <CountUp value={job.found_website ?? 0} />
                  </span>
                </div>
                <div title="At catch-all companies, where MailTester cannot tell: confirmed by no2bounce. Riskier than a MailTester find">
                  <span className="k">From catch-alls</span>
                  <span className="v" style={{ color: "var(--ok-ink)" }}>
                    <CountUp value={job.found_catch_all ?? 0} />
                  </span>
                </div>
                <div>
                  <span className="k">Catch-all</span>
                  <span className="v" style={{ color: "var(--warn-ink)" }}>
                    <CountUp value={job.catch_all} />
                  </span>
                </div>
                <div>
                  <span className="k">Speed</span>
                  <span className="v">
                    {data.rate ? data.rate.toFixed(1) : "–"}
                    <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}> /min</span>
                  </span>
                </div>
                <div>
                  <span className="k">Time left</span>
                  <span className="v">{st === "done" ? "Done" : fmtEta(data.etaMinutes)}</span>
                </div>
                <div>
                  <span className="k">Checks used</span>
                  <span className="v">
                    <CountUp value={job.checks_used} />
                  </span>
                </div>
                <div>
                  <span className="k">Per find</span>
                  <span className="v">{job.found ? (job.checks_used / job.found).toFixed(1) : "–"}</span>
                </div>
              </div>
              <StackBar counts={job} total={job.total - job.invalid_input} />
            </div>
          </div>
        </div>

        <div className="panel rise" style={{ ["--i" as string]: 2 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              {st === "running" ? <span className="live-dot" /> : <Zap size={15} />} Latest results
            </h2>
          </div>
          <div className="feed" style={{ maxHeight: 250 }}>
            {data.recent.length === 0 && <div className="empty">Results stream in here as people are decided.</div>}
            {data.recent.map((r) => (
              <div key={r.id + r.status} className="feed-item is-new">
                <span className={`fi-icon ${r.status === "found" ? "valid" : r.status === "catch_all" ? "catch_all" : r.status === "unverified" ? "retry" : "invalid"}`}>
                  {r.status === "found" ? <Check size={13} strokeWidth={2.4} /> : r.status === "catch_all" ? <Asterisk size={13} /> : <X size={13} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", textTransform: "capitalize", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.first} {r.last}
                  </span>
                  <span className="fi-email" style={{ display: "block", fontSize: 11.5, color: r.email ? "var(--ok-ink)" : "var(--faint)" }}>
                    {r.email ?? r.domain}
                  </span>
                </span>
                <span className="fi-meta num">
                  {r.checks_used} {r.checks_used === 1 ? "check" : "checks"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="toolbar rise" style={{ ["--i" as string]: 3 }}>
        <Seg
          value={tab}
          onChange={(v) => {
            setTab(v);
            setPage(0);
            setPicked(new Set());
          }}
          items={TABS.map(([value, label, key]) => ({ value, label, count: job[key] }))}
        />
        <span className="spacer" />
        <div className="search" style={{ width: 260 }}>
          <Search size={14} />
          <input className="input" placeholder="Search name, domain or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {showPick && (
        <div className="ca-bar rise" style={{ ["--i" as string]: 4 }}>
          <ShieldCheck size={20} />
          <div className="ca-text">
            <b>Verify catch-alls with no2bounce</b>
            <span className="ca-sub">
              Up to {MAX_CREDITS} credits a person. Confirms about 1 in 3 on Microsoft 365 and 1 in 9 on other mail hosts; Google mail almost never.
            </span>
            <span className="ca-counts">
              <span>
                <b>{n(caOpen)}</b> not checked
              </span>
              <span>
                <b>{n(job.ca_queued)}</b> queued
              </span>
              <span>
                <b>{n(job.ca_checked)}</b> checked, no match
              </span>
              <span>
                <b style={{ color: "var(--ok-ink)" }}>{n(job.found_catch_all ?? 0)}</b> confirmed (now in Found)
              </span>
            </span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={acting || chosen.length === 0} onClick={() => verify(chosen)}>
              Verify selected ({n(chosen.length)})
            </button>
            <button className="btn btn-primary" disabled={acting || caOpen === 0} onClick={() => verify(null)}>
              <ShieldCheck size={14} /> Verify all not checked ({n(caOpen)})
            </button>
          </div>
        </div>
      )}

      <div className="tbl-wrap rise" style={{ ["--i" as string]: 5 }}>
        <table className="tbl">
          <thead>
            <tr>
              {showPick && (
                <th className="check">
                  <input
                    type="checkbox"
                    aria-label="Select every unchecked person on this page"
                    checked={allPicked}
                    disabled={pickable.length === 0}
                    onChange={() => {
                      const next = new Set(picked);
                      for (const r of pickable) {
                        if (allPicked) next.delete(r.id);
                        else next.add(r.id);
                      }
                      setPicked(next);
                    }}
                  />
                </th>
              )}
              <th>#</th>
              <th>Person</th>
              <th>Domain</th>
              <th>Status</th>
              <th>Email</th>
              <th>Pattern</th>
              <th className="r">Checks</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const canPick = r.status === "catch_all" && !r.ca;
              const on = canPick && picked.has(r.id);
              return (
                // Keyed by status too: a row re-mounts, and flashes, the moment it is decided.
                <tr key={r.id + r.status} className={`${r.status === "pending" ? "" : "flash"}${on ? " is-selected" : ""}`}>
                  {showPick && (
                    <td className="check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.first} ${r.last}`}
                        checked={on}
                        disabled={!canPick}
                        onChange={() => {
                          const next = new Set(picked);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          setPicked(next);
                        }}
                      />
                    </td>
                  )}
                  <td className="faint num">{r.row_no}</td>
                  <td className="name">{r.first || r.last ? `${r.first} ${r.last}` : <span className="faint">—</span>}</td>
                  <td className="mono muted">{r.domain || <span className="faint">—</span>}</td>
                  <td>
                    <Chip status={r.status} />
                  </td>
                  <td className="mono">
                    {r.email ? (
                      <span className="row" style={{ gap: 4 }}>
                        {r.email}
                        <span className="row-act">
                          <CopyButton text={r.email} />
                        </span>
                      </span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td>{r.pattern && <span className="tag">{PATTERN_LABEL[r.pattern]}</span>}</td>
                  <td className={`r num${r.checks_used ? "" : " zero"}`}>{r.checks_used}</td>
                  <td className="muted note" style={{ fontSize: 12 }}>
                    {note(r)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.rows.length === 0 && (
          <div className="empty">
            <Sparkles size={20} /> {query ? "No matches." : "Nothing here yet."}
          </div>
        )}
      </div>
      {!query && <Pager page={page} pages={Math.ceil(job[tabCount] / PAGE)} onPage={setPage} />}
    </div>
  );
}

function note(r: JobRow): string {
  if (r.status === "catch_all") {
    const state = r.ca === "queued" ? "Queued for no2bounce" : r.ca === "checked" ? "no2bounce couldn't confirm" : "Not checked by no2bounce yet";
    return r.mx_provider ? `${state} · ${PROVIDER_LABEL[r.mx_provider] ?? r.mx_provider}` : state;
  }
  return r.reason ? (REASON_LABEL[r.reason] ?? r.reason) : "";
}
