"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Pause, Play, Search, ShieldCheck } from "lucide-react";
import type { JobRow, JobSummary } from "@/lib/repo";
import { usePoll } from "@/components/usePoll";
import { CopyButton, PageHead, Pager, Progress, Stat, Status, Tabs } from "@/components/ui";
import { toast } from "@/components/Shell";
import { fmtDate, fmtEta, foundHow, jobState, n, pct, PATTERN_LABEL, PROVIDER_LABEL, REASON_LABEL, STATUS_LABEL } from "@/components/format";

type Resp = { job: JobSummary; rows: JobRow[]; rate: number; etaMinutes: number | null };

const TABS = [
  ["", "All", "total"],
  ["found", "Found", "found"],
  ["catch_all", "Catch-all", "catch_all"],
  ["not_found", "Not found", "not_found"],
  ["unverified", "Couldn't verify", "unverified"],
  ["pending", "Waiting", "pending"],
  ["invalid_input", "Missing info", "invalid_input"],
] as const;
type Tab = (typeof TABS)[number][0];
const PAGE = 100;
/** no2bounce combinations tried per person at most (NO2BOUNCE_COMBOS). */
const MAX_CREDITS = 4;

export default function ListPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("");
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fast, setFast] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const url = `/api/jobs/${id}?page=${page}&size=${PAGE}${tab ? `&status=${tab}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const { data, error, reload } = usePoll<Resp>(url, fast ? 3000 : 15_000);
  const job = data?.job;

  // Refresh quickly only while something is moving.
  const moving = !job || jobState(job) === "running" || job.ca_queued > 0;
  if (moving !== fast) setFast(moving);

  // Say so when the list finishes while you watch.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!job) return;
    const st = jobState(job);
    if (st === "running") wasRunning.current = true;
    else if (st === "done" && wasRunning.current) {
      wasRunning.current = false;
      toast(`${job.name} is done: ${n(job.found)} emails found`);
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
        <div className="skel" style={{ height: 34, width: 320 }} />
        <div className="skel" style={{ height: 96 }} />
        <div className="skel" style={{ height: 320 }} />
      </div>
    );
  }

  const st = jobState(job);
  const decided = job.total - job.pending - job.invalid_input;
  const tabCount = job[TABS.find(([k]) => k === tab)![2]];
  const caOpen = job.catch_all - job.ca_checked - job.ca_queued;
  const pickable = data.rows.filter((r) => r.status === "catch_all" && !r.ca);
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(r.id));
  // People queued or checked since they were picked drop out of the selection.
  const gone = new Set(data.rows.filter((r) => r.status !== "catch_all" || r.ca).map((r) => r.id));
  const chosen = [...picked].filter((x) => !gone.has(x));
  const showPick = tab === "catch_all";

  function changeTab(v: Tab) {
    setTab(v);
    setPage(0);
    setPicked(new Set());
  }

  async function act(path: "cancel" | "start") {
    setBusy(true);
    await fetch(`/api/jobs/${id}/${path}`, { method: "POST" });
    toast(path === "cancel" ? "List stopped. You can resume it any time." : "List resumed", path === "cancel" ? "warn" : "ok");
    reload();
    setBusy(false);
  }

  async function verify(ids: string[] | null) {
    const count = ids ? ids.length : caOpen;
    if (!count) return;
    const ok = window.confirm(
      `Check ${n(count)} catch-all ${count === 1 ? "person" : "people"} with no2bounce?\n\nThis uses up to ${n(count * MAX_CREDITS)} credits (at most ${MAX_CREDITS} per person; it stops at the first address that works).`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${id}/catch-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : { all: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      toast(`${n(body.queued)} queued for no2bounce. Results appear here as they come in.`);
      setPicked(new Set());
      reload();
    } catch (e) {
      toast(`Could not queue them: ${(e as Error).message}`, "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div>
        <Link href="/jobs" className="back">
          <ArrowLeft size={14} /> All lists
        </Link>
        <PageHead
          title={job.name}
          sub={
            <>
              Uploaded {fmtDate(job.created_at)} · {n(job.total)} people · <Status status={st} />
            </>
          }
        >
          {st === "running" && (
            <button className="btn btn-danger" onClick={() => act("cancel")} disabled={busy}>
              <Pause size={15} /> Stop
            </button>
          )}
          {st === "cancelled" && job.pending > 0 && (
            <button className="btn" onClick={() => act("start")} disabled={busy}>
              <Play size={15} /> Resume
            </button>
          )}
          <a className="btn" href={`/api/jobs/${id}/export`} title="Every row with your original columns and the results">
            <Download size={15} /> Everything
          </a>
          <a className="btn" href={`/api/jobs/${id}/export?status=no_email`} title="Everyone without an email: catch-all, not found, couldn't verify">
            <Download size={15} /> No email ({n(job.catch_all + job.not_found + job.unverified)})
          </a>
          <a className="btn btn-primary" href={`/api/jobs/${id}/export?status=found`}>
            <Download size={15} /> Found emails ({n(job.found)})
          </a>
        </PageHead>
      </div>

      {st === "running" && (
        <div className="card card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row wrap" style={{ justifyContent: "space-between" }}>
            <span>
              <b className="num">{n(job.total - job.pending)}</b> of <span className="num">{n(job.total)}</span> checked
            </span>
            <span className="muted">
              {data.rate ? `${data.rate.toFixed(1)} people a minute · about ${fmtEta(data.etaMinutes)} left` : "Starting…"}
            </span>
          </div>
          <Progress pct={job.total ? ((job.total - job.pending) / job.total) * 100 : 0} />
        </div>
      )}

      <section className="stats" aria-label="Results">
        <Stat
          label="Found"
          tone="found"
          value={job.found}
          sub={`${pct(job.found, decided)} of people checked${job.found_catch_all ? ` · ${n(job.found_catch_all)} via no2bounce` : ""}`}
        />
        <Stat label="Catch-all" tone="catch_all" value={job.catch_all} sub="Company accepts any address" />
        <Stat label="Not found" tone="not_found" value={job.not_found} sub={job.unverified ? `and ${n(job.unverified)} couldn't verify` : "Every combination rejected"} />
        <Stat label="Waiting" tone="pending" value={job.pending} sub={st === "cancelled" && job.pending ? "List is stopped" : "Still to check"} />
      </section>

      <div className="toolbar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            label="Filter by result"
            value={tab}
            onChange={changeTab}
            items={TABS.filter(([k, , key]) => !k || job[key] > 0 || k === tab).map(([value, label, key]) => ({ value, label, count: job[key] }))}
          />
        </div>
        <div className="search" style={{ width: 260 }}>
          <Search size={15} />
          <label className="sr-only" htmlFor="row-search">
            Search this list
          </label>
          <input id="row-search" className="input" placeholder="Search name, company or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {showPick && (
        <div className="ca-bar">
          <ShieldCheck size={20} className="warn-ink" style={{ flex: "none" }} />
          <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 4 }}>
            <b>Verify catch-alls with no2bounce</b>
            <span className="muted" style={{ fontSize: 13 }}>
              Up to {MAX_CREDITS} credits a person. Confirms about 1 in 6 on Microsoft 365, fewer elsewhere; Google mail almost never.
            </span>
            <span className="counts">
              <span>
                <span className="num">{n(caOpen)}</span> not checked
              </span>
              <span>
                <span className="num">{n(job.ca_queued)}</span> queued
              </span>
              <span>
                <span className="num">{n(job.ca_checked)}</span> checked, no match
              </span>
              <span>
                <span className="num ok-ink">{n(job.found_catch_all)}</span> confirmed (now in Found)
              </span>
            </span>
          </div>
          <div className="row wrap">
            <button className="btn" disabled={busy || chosen.length === 0} onClick={() => verify(chosen)}>
              Verify selected ({n(chosen.length)})
            </button>
            <button className="btn btn-primary" disabled={busy || caOpen === 0} onClick={() => verify(null)}>
              Verify all not checked ({n(caOpen)})
            </button>
          </div>
        </div>
      )}

      <div className="tbl-wrap">
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
              <th className="r" style={{ width: 56 }}>
                #
              </th>
              <th>Name</th>
              <th>Company</th>
              <th>Result</th>
              <th>Email</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const canPick = r.status === "catch_all" && !r.ca;
              return (
                <tr key={r.id} className={canPick && picked.has(r.id) ? "is-selected" : undefined}>
                  {showPick && (
                    <td className="check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.first} ${r.last}`}
                        checked={canPick && picked.has(r.id)}
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
                  <td className="r num faint">{r.row_no}</td>
                  <td className="name">{r.first || r.last ? `${r.first} ${r.last}` : <span className="faint">—</span>}</td>
                  <td className="muted">{r.domain || <span className="faint">—</span>}</td>
                  <td>
                    <Status status={r.status} />
                  </td>
                  <td className="email">
                    {r.email ? (
                      <span className="row" style={{ gap: 2 }}>
                        {r.email}
                        <CopyButton text={r.email} />
                      </span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="note">{details(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.rows.length === 0 && <div className="empty">{query ? "Nobody matches that search." : "Nobody here."}</div>}
      </div>
      {!query && <Pager page={page} pages={Math.ceil(tabCount / PAGE)} onPage={setPage} />}
    </div>
  );
}

function details(r: JobRow): string {
  if (r.status === "found") {
    const how = foundHow(r.reason);
    return r.pattern ? `${how} · ${PATTERN_LABEL[r.pattern] ?? r.pattern}` : how;
  }
  if (r.status === "catch_all") {
    const where = r.mx_provider ? PROVIDER_LABEL[r.mx_provider] : null;
    const state = r.ca === "queued" ? "Queued for no2bounce" : r.ca === "checked" ? "no2bounce couldn't confirm" : "Not checked by no2bounce yet";
    return where ? `${state} · ${where}` : state;
  }
  if (r.status === "pending") return STATUS_LABEL.pending;
  return r.reason ? (REASON_LABEL[r.reason] ?? r.reason) : "";
}
