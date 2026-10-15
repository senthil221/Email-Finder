"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { History, UploadCloud } from "lucide-react";
import type { JobSummary } from "@/lib/repo";
import type { Lookup } from "@/lib/views";
import { usePoll } from "@/components/usePoll";
import { Ago, Bar, Chip, CopyButton, PageHead, Pager, Seg, StackBar } from "@/components/ui";
import { fmtDate, jobState, n, PATTERN_LABEL } from "@/components/format";

export default function HistoryPage() {
  return (
    <Suspense>
      <HistoryView />
    </Suspense>
  );
}

function HistoryView() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") === "lookups" ? "lookups" : "bulk") as "bulk" | "lookups";
  const [page, setPage] = useState(0);
  const { data: jobs } = usePoll<{ jobs: JobSummary[] }>("/api/jobs", 3000);
  const { data: lookups } = usePoll<{ rows: Lookup[]; total: number }>(`/api/lookups?size=50&page=${page}`, 4000);

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <History size={13} /> History
          </>
        }
        title={
          <>
            Everything you&apos;ve <i>run.</i>
          </>
        }
        sub="Bulk uploads and single lookups, with live progress for anything still running."
      >
        <Link href="/upload" className="btn btn-primary">
          <UploadCloud size={15} /> New upload
        </Link>
      </PageHead>

      <div className="toolbar rise" style={{ ["--i" as string]: 1 }}>
        <Seg
          value={tab}
          onChange={(v) => {
            setPage(0);
            router.replace(v === "bulk" ? "/jobs" : "/jobs?tab=lookups", { scroll: false });
          }}
          items={[
            { value: "bulk", label: "Bulk uploads", count: jobs?.jobs.length },
            { value: "lookups", label: "Single lookups", count: lookups?.total },
          ]}
        />
      </div>

      {tab === "bulk" ? (
        <div className="tbl-wrap rise" style={{ ["--i" as string]: 2 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Upload</th>
                <th>Status</th>
                <th style={{ width: 200 }}>Progress</th>
                <th style={{ width: 220 }}>Results</th>
                <th className="r">People</th>
                <th className="r">Found</th>
                <th className="r">Checks</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs?.jobs.map((j) => {
                const st = jobState(j);
                const pct = j.total ? ((j.total - j.pending) / j.total) * 100 : 0;
                return (
                  <tr key={j.id} className="is-link" onClick={() => router.push(`/jobs/${j.id}`)}>
                    <td style={{ fontWeight: 550, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{j.name}</td>
                    <td>
                      <Chip status={st} />
                    </td>
                    <td>
                      <div className="row">
                        <Bar pct={pct} live={st === "running"} done={st === "done"} style={{ flex: 1 }} />
                        <span className="num muted" style={{ width: 36, textAlign: "right", fontSize: 12 }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <StackBar counts={j} total={j.total - j.invalid_input} height={7} legend={false} />
                    </td>
                    <td className="r num">{n(j.total)}</td>
                    <td className="r num" style={{ color: j.found ? "var(--ok-ink)" : undefined, fontWeight: 600 }}>
                      {n(j.found)}
                    </td>
                    <td className="r num muted">{n(j.checks_used)}</td>
                    <td className="muted">{fmtDate(j.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {jobs && jobs.jobs.length === 0 && (
            <div className="empty">
              <UploadCloud size={22} /> No bulk uploads yet.
            </div>
          )}
          {!jobs && <Skeleton />}
        </div>
      ) : (
        <>
          <div className="tbl-wrap rise" style={{ ["--i" as string]: 2 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Pattern</th>
                  <th className="r">Checks</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {lookups?.rows.map((l) => (
                  <tr key={l.id} className="is-link" onClick={() => router.push(`/find?id=${l.id}`)}>
                    <td className="name">
                      {l.first} {l.last}
                    </td>
                    <td className="mono muted">{l.domain}</td>
                    <td>
                      <Chip status={l.status} />
                    </td>
                    <td className="mono">
                      {l.email ? (
                        <span className="row" style={{ gap: 4 }}>
                          {l.email} <CopyButton text={l.email} />
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td>{l.pattern && <span className="tag">{PATTERN_LABEL[l.pattern]}</span>}</td>
                    <td className={`r num${l.checks_used ? "" : " zero"}`}>{l.checks_used}</td>
                    <td className="muted">
                      <Ago at={l.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lookups && lookups.rows.length === 0 && <div className="empty">No single lookups yet.</div>}
            {!lookups && <Skeleton />}
          </div>
          {lookups && <Pager page={page} pages={Math.ceil(lookups.total / 50)} onPage={setPage} />}
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skel" style={{ height: 28 }} />
      ))}
    </div>
  );
}
