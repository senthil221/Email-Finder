"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Upload } from "lucide-react";
import type { JobSummary } from "@/lib/repo";
import type { Lookup } from "@/lib/views";
import { usePoll } from "@/components/usePoll";
import { Ago, CopyButton, PageHead, Pager, Progress, Skeleton, Status, Tabs } from "@/components/ui";
import { fmtDate, jobState, n, pct } from "@/components/format";

export default function ListsPage() {
  return (
    <Suspense>
      <Lists />
    </Suspense>
  );
}

function Lists() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") === "lookups" ? "lookups" : "bulk") as "bulk" | "lookups";
  const [page, setPage] = useState(0);
  const { data: jobs } = usePoll<{ jobs: JobSummary[] }>("/api/jobs", 5000);
  const { data: lookups } = usePoll<{ rows: Lookup[]; total: number }>(tab === "lookups" ? `/api/lookups?size=50&page=${page}` : null, 8000);

  return (
    <div className="page">
      <PageHead title="Lists" sub="Every list you uploaded, and the single emails you looked up.">
        <Link href="/upload" className="btn btn-primary">
          <Upload size={16} /> Upload a list
        </Link>
      </PageHead>

      <Tabs
        label="Show"
        value={tab}
        onChange={(v) => {
          setPage(0);
          router.replace(v === "bulk" ? "/jobs" : "/jobs?tab=lookups", { scroll: false });
        }}
        items={[
          { value: "bulk", label: "Uploaded lists", count: jobs?.jobs.length },
          { value: "lookups", label: "Single lookups", count: lookups?.total },
        ]}
      />

      {tab === "bulk" ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>List</th>
                <th>Status</th>
                <th style={{ width: 160 }}>Progress</th>
                <th className="r">People</th>
                <th className="r">Found</th>
                <th className="r">Catch-all</th>
                <th className="r">Not found</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {jobs?.jobs.map((j) => {
                const st = jobState(j);
                const decided = j.total - j.pending - j.invalid_input;
                return (
                  <tr key={j.id} className="is-link" onClick={() => router.push(`/jobs/${j.id}`)}>
                    <td style={{ fontWeight: 500, maxWidth: 320 }}>
                      <Link href={`/jobs/${j.id}`} onClick={(e) => e.stopPropagation()}>
                        {j.name}
                      </Link>
                    </td>
                    <td>
                      <Status status={st} />
                    </td>
                    <td>
                      <div className="row">
                        <div style={{ flex: 1 }}>
                          <Progress pct={j.total ? ((j.total - j.pending) / j.total) * 100 : 0} done={st === "done"} />
                        </div>
                        <span className="num muted" style={{ width: 38, textAlign: "right", fontSize: 13 }}>
                          {pct(j.total - j.pending, j.total)}
                        </span>
                      </div>
                    </td>
                    <td className="r num">{n(j.total)}</td>
                    <td className="r num">
                      <span className={j.found ? "ok-ink" : "zero"}>{n(j.found)}</span> <span className="faint">{pct(j.found, decided)}</span>
                    </td>
                    <td className={`r num${j.catch_all ? "" : " zero"}`}>{n(j.catch_all)}</td>
                    <td className={`r num${j.not_found ? "" : " zero"}`}>{n(j.not_found)}</td>
                    <td className="muted">{fmtDate(j.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {jobs && jobs.jobs.length === 0 && <div className="empty">No lists yet.</div>}
          {!jobs && <Skeleton />}
        </div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Result</th>
                  <th>Email</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {lookups?.rows.map((l) => (
                  <tr key={l.id} className="is-link" onClick={() => router.push(`/find?id=${l.id}`)}>
                    <td className="name">
                      {l.first} {l.last}
                    </td>
                    <td className="muted">{l.domain}</td>
                    <td>
                      <Status status={l.status} />
                    </td>
                    <td className="email">
                      {l.email ? (
                        <span className="row" style={{ gap: 2 }}>
                          {l.email} <CopyButton text={l.email} />
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
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
