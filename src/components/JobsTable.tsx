"use client";
import Link from "next/link";
import { FileUp } from "lucide-react";
import type { JobSummary } from "@/lib/repo";
import { fmtDate, jobState, n, STATUS_LABEL } from "./format";
import { usePoll } from "./usePoll";

const Num = ({ v }: { v: number }) => <td className={`r num${v === 0 ? " zero" : ""}`}>{n(v)}</td>;

export function JobsTable({ limit }: { limit?: number }) {
  const { data, error } = usePoll<{ jobs: JobSummary[] }>("/api/jobs", 4000);
  const jobs = data ? (limit ? data.jobs.slice(0, limit) : data.jobs) : null;

  if (error && !data) return <div className="notice err">Could not load jobs: {error}</div>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Upload</th>
            <th>Status</th>
            <th>Progress</th>
            <th className="r">People</th>
            <th className="r">Found</th>
            <th className="r">Catch-all</th>
            <th className="r">Not found</th>
            <th className="r">Checks used</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.map((j) => {
            const state = jobState(j);
            const done = j.total - j.pending;
            const pct = j.total ? Math.round((done / j.total) * 100) : 0;
            return (
              <tr key={j.id}>
                <td>
                  <Link className="rowlink" href={`/jobs/${j.id}`} style={{ fontWeight: 500 }}>
                    {j.name}
                  </Link>
                </td>
                <td>
                  <span className={`status ${state}`}>{STATUS_LABEL[state] ?? state}</span>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="progress" style={{ width: 90 }}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <span className="muted num" style={{ fontSize: 12 }}>
                      {pct}%
                    </span>
                  </div>
                </td>
                <Num v={j.total} />
                <Num v={j.found} />
                <Num v={j.catch_all} />
                <Num v={j.not_found} />
                <Num v={j.checks_used} />
                <td className="muted">{fmtDate(j.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {jobs && jobs.length === 0 && (
        <div className="empty">
          No uploads yet.{" "}
          <Link href="/jobs/new" style={{ color: "var(--brand-ink)", display: "inline-flex", gap: 4, alignItems: "center" }}>
            <FileUp size={14} strokeWidth={1.5} /> Upload a CSV
          </Link>
        </div>
      )}
      {!jobs && <div className="empty">Loading…</div>}
    </div>
  );
}
