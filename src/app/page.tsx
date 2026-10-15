"use client";
import Link from "next/link";
import { Activity, ArrowUpRight, Asterisk, AtSign, Gauge, Layers, Radio, Sparkles, Target, UploadCloud } from "lucide-react";
import type { JobSummary } from "@/lib/repo";
import type { Overview } from "@/lib/views";
import { usePoll } from "@/components/usePoll";
import { CountUp, Bar, Chip, PageHead, Ring, StackBar } from "@/components/ui";
import { Spark, ThroughputChart } from "@/components/charts";
import { LiveFeed } from "@/components/live";
import { jobState, n, PATTERN_LABEL } from "@/components/format";

type Stats = Overview & { jobs: JobSummary[]; online: boolean; dailyLimit: number; now: number; worker: { state: string } | null };

export default function Dashboard() {
  const { data } = usePoll<Stats>("/api/stats", 3000);
  const s = data;
  const hit = s && s.decided24h ? (s.found24h / s.decided24h) * 100 : 0;
  const perFind = s && s.found24h ? s.checks24h / s.found24h : 0;
  const quota = s ? (s.checks24h / s.dailyLimit) * 100 : 0;
  const series = s?.series ?? [];
  const sparkChecks = series.slice(-20).map((p) => p.checks);
  const sparkFound = series.slice(-20).map((p) => p.valid);
  const active = (s?.jobs ?? []).filter((j) => jobState(j) === "running");
  const patMax = Math.max(1, ...(s?.patterns ?? []).map((p) => p.n));
  const allDone = s ? s.totals.found + s.totals.catch_all + s.totals.not_found + s.totals.unverified : 0;

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <span className={`live-dot ${s?.online ? "" : "off"}`} /> {s?.online ? "Signal room · live" : "Signal room · worker offline"}
          </>
        }
        title={
          <>
            Every inbox, <i>found.</i>
          </>
        }
        sub="Nine name combinations per person, verified one by one with MailTester Ninja. One scout per company proves the pattern; everyone after costs a single check."
      >
        <Link href="/upload" className="btn">
          <UploadCloud size={15} /> Bulk upload
        </Link>
        <Link href="/find" className="btn btn-primary">
          <Sparkles size={15} /> Find an email
        </Link>
      </PageHead>

      <section className="grid g-kpi">
        <Kpi i={1} icon={AtSign} label="Emails found · 24h" tone="var(--ok)" value={s?.found24h} spark={sparkFound} sparkColor="var(--ok)" foot={s && `${n(s.totals.found)} all time`} />
        <Kpi i={2} icon={Target} label="Hit rate · 24h" value={hit} decimals={1} unit="%" foot={s && `${n(s.decided24h)} people decided`} />
        <Kpi i={3} icon={Activity} label="Checks · 24h" tone="var(--accent)" value={s?.checks24h} spark={sparkChecks} foot={s && `${quota.toFixed(1)}% of ${n(s.dailyLimit)}`} />
        <Kpi i={4} icon={Gauge} label="Checks per find" value={perFind} decimals={1} foot="lower is better" />
        <Kpi i={5} icon={Asterisk} label="Catch-all domains" tone="var(--warn)" value={s?.catchAllDomains} foot={s && `${n(s.provenDomains)} domains with a proven pattern`} />
      </section>

      <section className="grid g-main">
        <div className="panel rise" style={{ ["--i" as string]: 6 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Radio size={15} /> Throughput
            </h2>
            <span className="panel-sub">last 60 minutes · updates every 3s</span>
          </div>
          <div className="panel-body">
            {s ? <ThroughputChart series={series} now={s.now} /> : <div className="skel" style={{ height: 230 }} />}
          </div>
        </div>
        <div className="panel rise" style={{ ["--i" as string]: 7 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <span className="live-dot" /> Live checks
            </h2>
            <span className="panel-sub">every MailTester call</span>
          </div>
          <LiveFeed limit={24} maxHeight={300} />
        </div>
      </section>

      <section className="grid g-main">
        <div className="panel rise" style={{ ["--i" as string]: 8 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Layers size={15} /> Jobs in flight
            </h2>
            <div className="panel-tools">
              <Link href="/jobs" className="btn btn-ghost btn-sm">
                All history <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(active.length ? active : (s?.jobs ?? []).slice(0, 4)).map((j) => {
              const pct = j.total ? ((j.total - j.pending) / j.total) * 100 : 0;
              const st = jobState(j);
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} className="job-card">
                  <span className="jc-name">{j.name}</span>
                  <Chip status={st} />
                  <Bar pct={pct} live={st === "running"} done={st === "done"} />
                  <div className="jc-meta">
                    <span>
                      <b>{Math.round(pct)}%</b> done
                    </span>
                    <span>
                      <b>{n(j.found)}</b> found
                    </span>
                    <span>
                      <b>{n(j.catch_all)}</b> catch-all
                    </span>
                    <span>
                      <b>{n(j.total)}</b> people
                    </span>
                  </div>
                </Link>
              );
            })}
            {s && s.jobs.length === 0 && (
              <div className="empty">
                <UploadCloud size={22} />
                No uploads yet.
                <Link href="/upload" className="btn btn-primary btn-sm">
                  Upload your first CSV
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="panel rise" style={{ ["--i" as string]: 9 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Target size={15} /> Results, all time
            </h2>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="row" style={{ gap: 18 }}>
              <Ring pct={allDone ? (s!.totals.found / allDone) * 100 : 0} size={104} stroke={9} done>
                <b>{allDone ? Math.round((s!.totals.found / allDone) * 100) : 0}%</b>
                <span>found</span>
              </Ring>
              <div style={{ flex: 1, minWidth: 0 }}>
                <StackBar counts={s?.totals ?? {}} total={allDone + (s?.totals.pending ?? 0)} />
              </div>
            </div>
            <div className="divider" />
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Patterns learned (domains proven per pattern)
              </div>
              <div className="hbars">
                {(s?.patterns ?? []).length === 0 && <span className="faint">Patterns appear here as companies get proven.</span>}
                {(s?.patterns ?? []).map((p) => (
                  <div key={p.pattern} className="hbar">
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {PATTERN_LABEL[p.pattern] ?? p.pattern}
                    </span>
                    <span className="track">
                      <i style={{ width: `${(p.n / patMax) * 100}%` }} />
                    </span>
                    <span className="v">{n(p.n)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({
  i,
  icon: Icon,
  label,
  value,
  decimals = 0,
  unit,
  foot,
  tone,
  spark,
  sparkColor,
}: {
  i: number;
  icon: typeof Activity;
  label: string;
  value?: number;
  decimals?: number;
  unit?: string;
  foot?: React.ReactNode;
  tone?: string;
  spark?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="kpi rise" style={{ ["--i" as string]: i, ["--kpi-tone" as string]: tone ?? "transparent" }}>
      <div className="kpi-label">
        <Icon size={14} strokeWidth={1.7} /> {label}
      </div>
      <div className="kpi-value">
        {value === undefined ? <span className="skel" style={{ display: "inline-block", width: 70, height: 26 }} /> : <CountUp value={value} decimals={decimals} />}
        {unit && value !== undefined && <small>{unit}</small>}
      </div>
      <div className="kpi-foot">{foot}</div>
      {spark && spark.some((v) => v > 0) && <Spark values={spark} color={sparkColor} />}
    </div>
  );
}
