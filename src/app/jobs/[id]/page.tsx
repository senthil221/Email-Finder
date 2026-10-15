"use client";
import { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Download, Pause, Play } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { usePoll } from "@/components/usePoll";
import { jobState, n, PATTERN_LABEL, REASON_LABEL, STATUS_LABEL } from "@/components/format";
import type { JobRow, JobSummary } from "@/lib/repo";

const TABS = [
  ["", "All", "total"],
  ["found", "Found", "found"],
  ["catch_all", "Catch-all", "catch_all"],
  ["not_found", "Not found", "not_found"],
  ["unverified", "Unverified", "unverified"],
  ["pending", "Pending", "pending"],
  ["invalid_input", "Invalid input", "invalid_input"],
] as const;

const PAGE = 100;

export default function JobPage() {
  return (
    <Suspense>
      <JobView />
    </Suspense>
  );
}

function JobView() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const dupes = Number(search.get("dupes")) || 0;
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(0);
  const [acting, setActing] = useState(false);

  const url = `/api/jobs/${id}?page=${page}&size=${PAGE}${tab ? `&status=${tab}` : ""}`;
  const { data, error, reload } = usePoll<{ job: JobSummary; rows: JobRow[] }>(url, 3000);
  const job = data?.job;

  if (error && !data) {
    return (
      <>
        <Topbar title="Job" crumb="Jobs" />
        <div className="content">
          <div className="notice err">{error}</div>
        </div>
      </>
    );
  }
  if (!job) {
    return (
      <>
        <Topbar title="Loading…" crumb="Jobs" />
        <div className="content" />
      </>
    );
  }

  const state = jobState(job);
  const decided = job.total - job.pending;
  const pct = job.total ? Math.round((decided / job.total) * 100) : 0;
  const tabCount = TABS.find(([k]) => k === tab)![2];
  const pages = Math.max(1, Math.ceil(job[tabCount] / PAGE));

  async function act(path: "cancel" | "start") {
    setActing(true);
    await fetch(`/api/jobs/${id}/${path}`, { method: "POST" });
    reload();
    setActing(false);
  }

  return (
    <>
      <Topbar title={job.name} crumb="Jobs">
        {state === "pending" && (
          <button className="btn btn-sm btn-danger" onClick={() => act("cancel")} disabled={acting}>
            <Pause size={14} strokeWidth={1.75} /> Stop
          </button>
        )}
        {state === "cancelled" && job.pending > 0 && (
          <button className="btn btn-sm" onClick={() => act("start")} disabled={acting}>
            <Play size={14} strokeWidth={1.75} /> Resume
          </button>
        )}
        <a className="btn btn-sm" href={`/api/jobs/${id}/export`}>
          <Download size={14} strokeWidth={1.75} /> Export all
        </a>
        {tab && (
          <a className="btn btn-sm btn-primary" href={`/api/jobs/${id}/export?status=${tab}`}>
            <Download size={14} strokeWidth={1.75} /> Export {STATUS_LABEL[tab]?.toLowerCase()}
          </a>
        )}
      </Topbar>
      <div className="content">
        <div className="stats">
          <Stat k="People" v={n(job.total)} />
          <Stat k="Found" v={n(job.found)} tone="var(--success-ink)" />
          <Stat k="Catch-all" v={n(job.catch_all)} tone="var(--warning-ink)" />
          <Stat k="Not found" v={n(job.not_found)} />
          <Stat k="Checks used" v={n(job.checks_used)} />
          <Stat
            k="Checks per found email"
            v={job.found ? (job.checks_used / job.found).toFixed(1) : "–"}
          />
        </div>

        {dupes > 0 && <div className="notice">{n(dupes)} duplicate rows (same name and domain) were skipped.</div>}

        <div>
          <div className="view-tabs">
            {TABS.map(([key, label, count]) => (
              <button
                key={key}
                className={tab === key ? "is-on" : ""}
                onClick={() => {
                  setTab(key);
                  setPage(0);
                }}
              >
                {label} <span>{n(job[count])}</span>
              </button>
            ))}
            <div className="view-tabs-summary">
              <span className={`status ${state}`}>{STATUS_LABEL[state] ?? state}</span>
              <div className="progress" style={{ width: 120 }}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <span>
                <b>{pct}%</b> done
              </span>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Domain</th>
                <th>Status</th>
                <th>Email</th>
                <th>Pattern</th>
                <th className="r">Checks</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="faint num">{r.row_no}</td>
                  <td>
                    {r.first || r.last ? (
                      <span style={{ textTransform: "capitalize" }}>
                        {r.first} {r.last}
                      </span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="muted">{r.domain || <span className="faint">—</span>}</td>
                  <td>
                    <span className={`status ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  </td>
                  <td className="mono">{r.email ?? <span className="faint">—</span>}</td>
                  <td>{r.pattern ? <span className="tag">{PATTERN_LABEL[r.pattern] ?? r.pattern}</span> : null}</td>
                  <td className={`r num${r.checks_used === 0 ? " zero" : ""}`}>{r.checks_used}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {r.reason ? (REASON_LABEL[r.reason] ?? r.reason) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <div className="empty">Nothing here yet.</div>}
        </div>

        {pages > 1 && (
          <div className="pager">
            <span className="num">
              Page {page + 1} of {n(pages)}
            </span>
            <div className="toolbar">
              <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v" style={tone ? { color: tone } : undefined}>
        {v}
      </div>
    </div>
  );
}
