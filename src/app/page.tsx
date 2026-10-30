"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Upload } from "lucide-react";
import type { JobSummary } from "@/lib/repo";
import type { Overview } from "@/lib/views";
import { usePoll } from "@/components/usePoll";
import { PageHead, Progress, Skeleton, Stat, Status } from "@/components/ui";
import { compact, fmtDate, jobState, n, PATTERN_LABEL, pct } from "@/components/format";

type Stats = Overview & { jobs: JobSummary[]; dailyLimit: number };

export default function OverviewPage() {
  const router = useRouter();
  const { data: d } = usePoll<Stats>("/api/stats", 10_000);
  const decided = d ? d.people - d.pending : 0;
  const fromMtn = d ? d.found - d.found_website - d.found_catch_all : 0;
  const caTried = d ? d.found_catch_all + d.ca_checked : 0;

  return (
    <div className="page">
      <PageHead title="Overview" sub="Where your lists stand, across every upload.">
        <Link href="/find" className="btn">
          <Search size={16} /> Find one email
        </Link>
        <Link href="/upload" className="btn btn-primary">
          <Upload size={16} /> Upload a list
        </Link>
      </PageHead>

      <section className="stats" aria-label="Results so far">
        <Stat label="Emails found" tone="found" value={d?.found} sub={d && `${pct(d.found, decided)} of the ${n(decided)} people checked`} />
        <Stat label="Catch-all" tone="catch_all" value={d?.catch_all} sub="The company accepts any address, so MailTester can't confirm" />
        <Stat
          label="Not found"
          tone="not_found"
          value={d?.not_found}
          sub={d && (d.unverified ? `and ${n(d.unverified)} that couldn't be verified` : "Every combination was rejected")}
        />
        <Stat label="Waiting" tone="pending" value={d?.pending} sub="In lists that are running" />
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Where found emails come from</h2>
          </div>
          <div className="card-body">
            {d ? (
              <div className="bars">
                <Bar label="Verified by MailTester" v={fromMtn} of={d.found} tone="found" />
                <Bar label="On the company website" v={d.found_website} of={d.found} tone="found" />
                <Bar label="no2bounce, at catch-alls" v={d.found_catch_all} of={d.found} tone="catch_all" />
              </div>
            ) : (
              <Skeleton rows={3} />
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Patterns behind the most finds</h2>
          </div>
          <div className="card-body">
            {d ? (
              d.patterns.length ? (
                <div className="bars">
                  {d.patterns.map((p) => (
                    <Bar key={p.pattern} label={PATTERN_LABEL[p.pattern] ?? p.pattern} v={p.n} of={d.found} />
                  ))}
                </div>
              ) : (
                <p className="muted">Nothing found yet.</p>
              )
            ) : (
              <Skeleton rows={5} />
            )}
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Last 24 hours</h2>
          </div>
          <div className="card-body figs">
            <Fig k="Emails found" v={d && n(d.found24h)} />
            <Fig k="MailTester checks" v={d && `${compact(d.checks24h)} / ${compact(d.dailyLimit)}`} />
            <Fig k="no2bounce credits used" v={d && n(d.n2b24h.auto + d.n2b24h.request)} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Catch-all checks with no2bounce</h2>
          </div>
          <div className="card-body figs">
            <Fig k="People checked" v={d && n(caTried)} />
            <Fig k="Confirmed" v={d && (caTried ? `${n(d.found_catch_all)} (${pct(d.found_catch_all, caTried)})` : "0")} />
            <Fig k="Credits left" v={d && (d.n2bCredits == null ? "—" : n(d.n2bCredits))} />
            <p className="muted" style={{ gridColumn: "1 / -1", fontSize: 13 }}>
              Runs on its own in the background (Google mail is skipped: it never confirms). To check people now, open a list and use its Catch-all tab.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Recent lists</h2>
          <div className="tools">
            <Link href="/jobs" className="btn btn-sm">
              All lists
            </Link>
          </div>
        </div>
        {d && d.jobs.length === 0 && (
          <div className="empty">
            No lists yet. <Link href="/upload" style={{ color: "var(--brand-ink)" }}>Upload one</Link> to get started.
          </div>
        )}
        {d && d.jobs.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>List</th>
                  <th>Status</th>
                  <th style={{ width: 160 }}>Progress</th>
                  <th className="r">People</th>
                  <th className="r">Found</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {d.jobs.map((j) => {
                  const st = jobState(j);
                  return (
                    <tr key={j.id} className="is-link" onClick={() => router.push(`/jobs/${j.id}`)}>
                      <td style={{ fontWeight: 500 }}>
                        <Link href={`/jobs/${j.id}`} onClick={(e) => e.stopPropagation()}>
                          {j.name}
                        </Link>
                      </td>
                      <td>
                        <Status status={st} />
                      </td>
                      <td>
                        <Progress pct={j.total ? ((j.total - j.pending) / j.total) * 100 : 0} done={st === "done"} />
                      </td>
                      <td className="r num">{n(j.total)}</td>
                      <td className="r num">
                        {n(j.found)} <span className="faint">{pct(j.found, j.total - j.pending - j.invalid_input)}</span>
                      </td>
                      <td className="muted">{fmtDate(j.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!d && <Skeleton />}
      </section>
    </div>
  );
}

function Bar({ label, v, of, tone }: { label: string; v: number; of: number; tone?: string }) {
  const w = of ? (v / of) * 100 : 0;
  return (
    <div className="b">
      <span>{label}</span>
      <span className="t" aria-hidden="true">
        <i className={tone} style={{ width: `${w}%` }} />
      </span>
      <span className="val">
        {n(v)} <span className="faint">{pct(v, of)}</span>
      </span>
    </div>
  );
}

function Fig({ k, v }: { k: string; v: string | null | undefined | false }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 13 }}>
        {k}
      </div>
      <div className="num" style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>
        {v || <span className="skel" style={{ display: "inline-block", width: 60, height: 22 }} />}
      </div>
    </div>
  );
}
