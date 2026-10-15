"use client";
import { useState } from "react";
import { BarChart3, CalendarDays, Gauge, Globe, Lightbulb, ListOrdered, MessageSquare, PieChart, Target, Trophy, Users } from "lucide-react";
import type { Insights, Range } from "@/lib/views";
import { PATTERNS } from "@/lib/patterns";
import { usePoll } from "@/components/usePoll";
import { CountUp, PageHead, Seg } from "@/components/ui";
import { ColumnChart, Heatmap } from "@/components/charts";
import { n, PATTERN_LABEL, REASON_LABEL, STATUS_LABEL } from "@/components/format";

const CURRENT = PATTERNS.map((p) => p.id as string);
const example = (id: string) => (PATTERNS.find((p) => p.id === id)?.build("andrew", "deepak") ?? id) + "@";
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const MIN_FINDS = 20; // below this, a suggested order is noise

const OUTCOME_COLOR: Record<string, string> = {
  found: "var(--ok)",
  catch_all: "var(--warn)",
  not_found: "var(--bad)",
  unverified: "var(--unv)",
  invalid_input: "var(--faint)",
};
const VERDICT_COLOR: Record<string, string> = {
  valid: "var(--ok)",
  invalid: "var(--bad)",
  no_mx: "var(--bad)",
  catch_all: "var(--warn)",
  retry: "var(--unv)",
  fatal: "var(--unv)",
  rate_limited: "var(--info)",
};

export default function InsightsPage() {
  const [range, setRange] = useState<Range>("7d");
  const { data } = usePoll<Insights>(`/api/insights?range=${range}`, 10000);
  const d = data?.range === range ? data : null;
  const k = d?.kpi;

  // Leaderboard: patterns ranked by how many people they found.
  const board = [...(d?.patterns ?? [])].sort((a, b) => b.finds - a.finds || b.accepted - a.accepted);
  for (const id of CURRENT) if (d && !board.find((p) => p.pattern === id)) board.push({ pattern: id, tried: 0, accepted: 0, rejected: 0, catch_all: 0, unverifiable: 0, finds: 0, avg_checks: null });
  const totalFinds = board.reduce((s, p) => s + p.finds, 0);
  const maxShare = Math.max(1, ...board.map((p) => p.finds));
  const suggested = board.map((p) => p.pattern);

  const tlds = topKeys(d?.byTld ?? [], "tld", 8);
  const sizes = ["1", "2–5", "6–20", "21+"].filter((b) => (d?.bySize ?? []).some((x) => x.bucket === b));
  const cols = CURRENT;

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <BarChart3 size={13} /> Insights
          </>
        }
        title={
          <>
            Which combinations <i>win.</i>
          </>
        }
        sub="Pattern performance, where emails are found, and what MailTester answers. Use it to tune the try order and spot catch-all heavy lists."
      >
        <Seg
          value={range}
          onChange={setRange}
          items={[
            { value: "24h", label: "24h" },
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "all", label: "All time" },
          ]}
        />
      </PageHead>

      <section className="grid g-kpi">
        <Tile i={1} icon={Target} label="Find rate" v={k ? pct(k.found, k.people) : undefined} dec={1} unit="%" foot={k && `${n(k.found)} of ${n(k.people)} people`} tone="var(--ok)" />
        <Tile i={2} icon={Gauge} label="Checks per find" v={k && k.found ? k.checks / k.found : k ? 0 : undefined} dec={1} foot={k && `${n(k.checks)} checks`} />
        <Tile i={3} icon={Trophy} label="Accept rate" v={k ? pct(k.accepted, k.accepted + k.rejected) : undefined} dec={1} unit="%" foot="accepted ÷ (accepted + rejected)" tone="var(--signal)" />
        <Tile i={4} icon={PieChart} label="Catch-all share" v={k ? pct(k.catch_all, k.people) : undefined} dec={1} unit="%" foot={k && `${n(k.catch_all)} people`} tone="var(--warn)" />
        <Tile i={5} icon={ListOrdered} label="Top pattern" text={board[0]?.finds ? PATTERN_LABEL[board[0].pattern] : "–"} foot={board[0]?.finds ? `${Math.round(pct(board[0].finds, totalFinds))}% of all finds` : "no finds yet"} />
      </section>

      <section className="panel rise" style={{ ["--i" as string]: 6 }}>
        <div className="panel-head">
          <h2 className="panel-title">
            <Trophy size={15} /> Pattern leaderboard
          </h2>
          <span className="panel-sub">ranked by people found · accept rate = how often MailTester says yes when this combination is tried</span>
        </div>
        <div className="panel-body" style={{ paddingTop: 10 }}>
          <div className="tbl-wrap" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
            <table className="tbl lb">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pattern</th>
                  <th style={{ width: 180 }}>Share of finds</th>
                  <th style={{ width: 180 }}>Accept rate</th>
                  <th className="r">Tried</th>
                  <th className="r">Accepted</th>
                  <th className="r">Rejected</th>
                  <th className="r">Catch-all</th>
                  <th className="r">Avg checks</th>
                  <th className="r">Try order</th>
                </tr>
              </thead>
              <tbody>
                {board.map((p, i) => {
                  const acc = pct(p.accepted, p.accepted + p.rejected);
                  const pos = CURRENT.indexOf(p.pattern) + 1;
                  return (
                    <tr key={p.pattern}>
                      <td>
                        <span className="rank">{i + 1}</span>
                      </td>
                      <td>
                        <span className="tag" title={`e.g. ${example(p.pattern)}`}>{PATTERN_LABEL[p.pattern] ?? p.pattern}</span>
                      </td>
                      <td>
                        <div className="meter">
                          <span className="track">
                            <i style={{ width: `${(p.finds / maxShare) * 100}%`, background: "var(--ok)" }} />
                          </span>
                          <b>{Math.round(pct(p.finds, totalFinds))}%</b>
                        </div>
                      </td>
                      <td>
                        <div className="meter">
                          <span className="track">
                            <i style={{ width: `${acc}%`, background: "var(--info)" }} />
                          </span>
                          <b>{p.accepted + p.rejected ? `${acc.toFixed(acc < 10 ? 1 : 0)}%` : "–"}</b>
                        </div>
                      </td>
                      <td className={`r num${p.tried ? "" : " zero"}`}>{n(p.tried)}</td>
                      <td className="r num" style={{ color: p.accepted ? "var(--ok-ink)" : undefined }}>
                        {n(p.accepted)}
                      </td>
                      <td className={`r num${p.rejected ? "" : " zero"}`}>{n(p.rejected)}</td>
                      <td className={`r num${p.catch_all ? "" : " zero"}`}>{n(p.catch_all)}</td>
                      <td className="r num">{p.avg_checks ?? "–"}</td>
                      <td className="r num muted">#{pos}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid g-main">
        <div className="panel rise" style={{ ["--i" as string]: 7 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Lightbulb size={15} /> Suggested try order
            </h2>
            <span className="panel-sub">from your own finds in this period</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Current order
              </div>
              <div className="order">
                {CURRENT.map((id, i) => (
                  <span key={id} style={{ display: "contents" }}>
                    {i > 0 && <span className="arrow">›</span>}
                    <span className="tag">{PATTERN_LABEL[id]}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                What your data says
              </div>
              {totalFinds >= MIN_FINDS ? (
                <div className="order">
                  {suggested.map((id, i) => {
                    const move = CURRENT.indexOf(id) - i;
                    return (
                      <span key={id} style={{ display: "contents" }}>
                        {i > 0 && <span className="arrow">›</span>}
                        <span className={`tag${move > 0 ? " up" : move < 0 ? " down" : ""}`} title={move ? `${move > 0 ? "up" : "down"} ${Math.abs(move)}` : "same place"}>
                          {PATTERN_LABEL[id]}
                          {move !== 0 && <span style={{ marginLeft: 4 }}>{move > 0 ? `↑${move}` : `↓${-move}`}</span>}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="notice">
                  Needs at least {MIN_FINDS} found emails to be meaningful ({n(totalFinds)} so far in this period). Run your 5k list and check back.
                </div>
              )}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              Every company&apos;s proven pattern is already tried first for its later people, so this order mostly matters for the first person (the scout) at each company.
            </div>
          </div>
        </div>

        <div className="panel rise" style={{ ["--i" as string]: 8 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Gauge size={15} /> Checks needed per found email
            </h2>
          </div>
          <div className="panel-body">
            <ColumnChart
              data={Array.from({ length: 10 }, (_, i) => ({
                label: i === 0 ? "0" : String(i),
                value: d?.checksToFind.find((c) => c.checks === i)?.n ?? 0,
              }))}
              tip={(x) => `${n(x.value)} people found with ${x.label} ${x.label === "1" ? "check" : "checks"}${x.label === "0" ? " (cache)" : ""}`}
            />
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              0 = already known from an earlier check (free). 1 = the company pattern was already proven.
            </div>
          </div>
        </div>
      </section>

      <section className="grid g-2">
        <div className="panel rise" style={{ ["--i" as string]: 9 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Globe size={15} /> Pattern by domain ending
            </h2>
            <span className="panel-sub">share of finds in each row</span>
          </div>
          <div className="panel-body">
            {tlds.length ? (
              <Heatmap rows={tlds} cols={cols} value={(r, c) => d?.byTld.find((x) => x.tld === r && x.pattern === c)?.n ?? 0} colLabel={(c) => PATTERN_LABEL[c].replace("@", "")} />
            ) : (
              <Empty />
            )}
          </div>
        </div>
        <div className="panel rise" style={{ ["--i" as string]: 10 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Users size={15} /> Pattern by people per company
            </h2>
            <span className="panel-sub">bigger companies lean to full-name styles</span>
          </div>
          <div className="panel-body">
            {sizes.length ? (
              <Heatmap rows={sizes} cols={cols} value={(r, c) => d?.bySize.find((x) => x.bucket === r && x.pattern === c)?.n ?? 0} colLabel={(c) => PATTERN_LABEL[c].replace("@", "")} />
            ) : (
              <Empty />
            )}
          </div>
        </div>
      </section>

      <section className="grid g-3">
        <div className="panel rise" style={{ ["--i" as string]: 11 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Target size={15} /> Outcomes
            </h2>
          </div>
          <div className="panel-body hbars">
            {(d?.outcomes ?? []).map((o) => (
              <Hb
                key={o.status + o.reason}
                label={o.status === "found" ? "Found" : REASON_LABEL[o.reason ?? ""] ?? STATUS_LABEL[o.status]}
                v={o.n}
                max={Math.max(...(d?.outcomes ?? []).map((x) => x.n))}
                color={OUTCOME_COLOR[o.status]}
              />
            ))}
            {d && d.outcomes.length === 0 && <Empty />}
          </div>
        </div>
        <div className="panel rise" style={{ ["--i" as string]: 12 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <MessageSquare size={15} /> MailTester answers
            </h2>
          </div>
          <div className="panel-body hbars">
            {(d?.answers ?? []).map((a) => (
              <Hb
                key={a.verdict + a.message}
                label={a.message ?? STATUS_LABEL[a.verdict] ?? a.verdict}
                v={a.n}
                max={Math.max(...(d?.answers ?? []).map((x) => x.n))}
                color={VERDICT_COLOR[a.verdict] ?? "var(--faint)"}
              />
            ))}
            {d && d.answers.length === 0 && <Empty />}
          </div>
        </div>
        <div className="panel rise" style={{ ["--i" as string]: 13 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Globe size={15} /> Domains known
            </h2>
          </div>
          <div className="panel-body hbars">
            {(d?.domains ?? []).map((x) => (
              <Hb
                key={x.status}
                label={{ valid: "Proven pattern", catch_all: "Catch-all", not_found: "Parked", no_mx: "No mail server", unknown: "Not checked" }[x.status] ?? x.status}
                v={x.n}
                max={Math.max(...(d?.domains ?? []).map((y) => y.n))}
                color={{ valid: "var(--ok)", catch_all: "var(--warn)", not_found: "var(--bad)", no_mx: "var(--bad)" }[x.status] ?? "var(--faint)"}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="grid g-2">
        <div className="panel rise" style={{ ["--i" as string]: 14 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <CalendarDays size={15} /> Checks per day
            </h2>
            <span className="panel-sub">last 14 days</span>
          </div>
          <div className="panel-body">
            <ColumnChart
              color="var(--signal)"
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))}
              data={(d?.daily ?? []).map((x) => ({ label: dayLabel(x.day), value: x.checks }))}
              tip={(x) => `${n(x.value)} checks · ${x.label}`}
            />
          </div>
        </div>
        <div className="panel rise" style={{ ["--i" as string]: 15 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <CalendarDays size={15} /> Emails found per day
            </h2>
            <span className="panel-sub">last 14 days</span>
          </div>
          <div className="panel-body">
            <ColumnChart
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))}
              data={(d?.daily ?? []).map((x) => ({ label: dayLabel(x.day), value: x.found }))}
              tip={(x, i) => {
                const day = d!.daily[i];
                return `${n(x.value)} found of ${n(day.people)} people (${Math.round(pct(day.found, day.people))}%) · ${x.label}`;
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function topKeys<T extends Record<string, unknown>>(rows: (T & { n: number })[], key: keyof T, limit: number): string[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(String(r[key]), (totals.get(String(r[key])) ?? 0) + r.n);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => `${k}`);
}

const dayLabel = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function Hb({ label, v, max, color }: { label: string; v: number; max: number; color: string }) {
  return (
    <div className="hbar" style={{ gridTemplateColumns: "minmax(0, 1.4fr) 1fr 48px" }} title={`${label}: ${n(v)}`}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span className="track">
        <i style={{ width: `${(v / Math.max(1, max)) * 100}%`, background: color }} />
      </span>
      <span className="v">{n(v)}</span>
    </div>
  );
}

function Tile({
  i,
  icon: Icon,
  label,
  v,
  dec = 0,
  unit,
  foot,
  tone,
  text,
}: {
  i: number;
  icon: typeof Target;
  label: string;
  v?: number;
  dec?: number;
  unit?: string;
  foot?: React.ReactNode;
  tone?: string;
  text?: string;
}) {
  return (
    <div className="kpi rise" style={{ ["--i" as string]: i, ["--kpi-tone" as string]: tone ?? "transparent" }}>
      <div className="kpi-label">
        <Icon size={14} strokeWidth={1.7} /> {label}
      </div>
      <div className="kpi-value">
        {text !== undefined ? (
          <span className="mono" style={{ fontSize: 22 }}>
            {text}
          </span>
        ) : v === undefined ? (
          <span className="skel" style={{ display: "inline-block", width: 70, height: 26 }} />
        ) : (
          <CountUp value={v} decimals={dec} />
        )}
        {unit && v !== undefined && <small>{unit}</small>}
      </div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

function Empty() {
  return <div className="faint" style={{ padding: "18px 0", textAlign: "center" }}>No data in this period yet.</div>;
}
