"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Asterisk, Check, Clock, Coins, ListChecks, Server, ShieldCheck, Square, Wallet } from "lucide-react";
import type { CatchAllView } from "@/lib/views";
import { usePoll } from "@/components/usePoll";
import { Ago, Bar, CountUp, PageHead } from "@/components/ui";
import { toast } from "@/components/Shell";
import { compact, n } from "@/components/format";

const HOST: Record<string, string> = {
  microsoft: "Microsoft 365",
  google: "Google mail",
  zoho: "Zoho mail",
  other: "Other mail hosts",
  none: "No mail server",
  unknown: "Not looked up yet",
};

const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

export default function CatchAllsPage() {
  const { data: s, reload } = usePoll<CatchAllView>("/api/catch-alls", 4000);
  const [busy, setBusy] = useState(false);

  async function post(body: object) {
    setBusy(true);
    try {
      const res = await fetch("/api/catch-alls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      reload();
      return json;
    } catch (e) {
      toast(`That didn't work: ${(e as Error).message}`, "bad");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function switchAuto(on: boolean) {
    const limit = s?.config?.dailyLimit ?? 3000;
    if (on && !window.confirm(`Turn on the background pass?\n\nIt checks catch-all people from every list, newest list first, and can use up to ${n(limit)} no2bounce credits a day.`)) return;
    const r = await post({ auto: on });
    if (r) toast(on ? "Background pass on" : "Background pass off. Checks already at no2bounce finish in a minute or two.", on ? "ok" : "warn");
  }

  async function stop(list: { id: string; name: string } | null) {
    const r = await post({ stop: list ? list.id : "all" });
    if (r) toast(`${n(r.stopped)} ${r.stopped === 1 ? "person" : "people"} taken off the queue${list ? ` for ${list.name}` : ""}`, "warn");
  }

  const t = s?.totals;
  const cfg = s?.config;
  const autoSpent = s?.spent24h.auto ?? 0;
  const reqSpent = s?.spent24h.request ?? 0;
  const atLimit = !!cfg && autoSpent >= cfg.dailyLimit;
  // The worker only sends or waits on checks while the pass is on or people are queued;
  // checks sent just before it was switched off stay unanswered and don't count.
  const working = !!s && ((s.auto && !atLimit && cfg?.pass !== false) || s.totals.queued > 0);
  const skipped = (cfg?.skip ?? []).map((k) => HOST[k] ?? k).join(", ");

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <span className={`live-dot ${working ? "" : "idle"}`} /> no2bounce · {working ? "checking now" : "nothing running"}
          </>
        }
        title={
          <>
            Catch-alls, <i>confirmed.</i>
          </>
        }
        sub={`At companies that accept any address, MailTester can't tell which one is real. no2bounce checks each person's top ${cfg?.combos ?? 4} combinations and stops at the first one that works. Nothing runs unless you pick people on a list or switch the background pass on.`}
      />

      <section className="grid g-kpi">
        <Kpi i={1} icon={ShieldCheck} tone="var(--ok)" label="Confirmed" value={t?.confirmed} foot={t && (t.checked ? `${rate(t.confirmed, t.checked)} of people checked` : "nobody checked yet")} />
        <Kpi i={2} icon={ListChecks} label="Checked" value={t?.checked} foot={t && `${n(t.checked - t.confirmed)} with no match`} />
        <Kpi i={3} icon={Clock} tone="var(--info)" label="Queued from lists" value={t?.queued} foot={s && (working ? `${n(s.inFlight)} at no2bounce right now` : "nothing running")} />
        <Kpi i={4} icon={Asterisk} tone="var(--warn)" label="Not checked yet" value={t?.open} foot={t && `of ${n(t.people)} catch-all people`} />
        <Kpi i={5} icon={Coins} label="Credits · 24h" value={s ? autoSpent + reqSpent : undefined} foot={s && `background ${n(autoSpent)} · your picks ${n(reqSpent)}`} />
        <Kpi
          i={6}
          icon={Wallet}
          label="Credits left"
          value={s ? (s.credits ?? 0) : undefined}
          foot={s && (s.credits === null ? "not read from no2bounce yet" : "on the no2bounce account")}
        />
      </section>

      <section className="grid g-main">
        <div className="panel rise" style={{ ["--i" as string]: 7 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              <Server size={15} /> Background pass
            </h2>
            <span className="panel-sub">checks catch-all people from every list on its own</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="ca-switch">
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={!!s?.auto}
                aria-label="Background pass"
                disabled={!s || busy || cfg?.pass === false}
                onClick={() => switchAuto(!s?.auto)}
              />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <b>{cfg?.pass === false ? "Kept off on the server" : s?.auto ? (atLimit ? "On, daily limit reached" : "On") : "Off"}</b>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {cfg?.pass === false
                    ? "NO2BOUNCE_PASS=off in the server settings keeps it off. People you pick on a list are still checked."
                    : s?.auto
                      ? atLimit
                        ? `It used its ${n(cfg!.dailyLimit)} credits for the last 24 hours and carries on as they free up.`
                        : `Working through catch-all people from every list, newest list first.${skipped ? ` ${skipped} is skipped (almost never confirms).` : ""}`
                      : "Only the people you pick on a list are checked. Switch it on to work through every list."}
                </span>
                {cfg && s?.auto && (
                  <div className="row" style={{ marginTop: 6, gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <Bar pct={Math.min(100, (autoSpent / cfg.dailyLimit) * 100)} live={!atLimit} />
                    </div>
                    <span className="faint num" style={{ fontSize: 11.5 }}>
                      {n(autoSpent)} / {n(cfg.dailyLimit)} credits · 24h
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                By mail host
              </div>
              <table className="tbl tbl-plain">
                <thead>
                  <tr>
                    <th>Mail host</th>
                    <th className="r">People</th>
                    <th className="r">Checked</th>
                    <th className="r">Confirmed</th>
                    <th className="r">Hit rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(s?.providers ?? []).map((p) => (
                    <tr key={p.provider}>
                      <td>{HOST[p.provider] ?? p.provider}</td>
                      <td className="r num">{n(p.people)}</td>
                      <td className={`r num${p.checked ? "" : " zero"}`}>{n(p.checked)}</td>
                      <td className={`r num${p.confirmed ? "" : " zero"}`} style={p.confirmed ? { color: "var(--ok-ink)" } : undefined}>
                        {n(p.confirmed)}
                      </td>
                      <td className="r num muted">{rate(p.confirmed, p.checked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s && s.providers.length === 0 && <div className="empty">No catch-all people yet.</div>}
            </div>
          </div>
        </div>

        <div className="panel rise" style={{ ["--i" as string]: 8 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              {working ? <span className="live-dot" /> : <ShieldCheck size={15} />} Latest results
            </h2>
            <span className="panel-sub">people no2bounce finished</span>
          </div>
          <div className="feed" style={{ maxHeight: 360 }}>
            {s && s.recent.length === 0 && <div className="empty">Results show up here as people are checked.</div>}
            {(s?.recent ?? []).map((r) => (
              <Link key={r.id} href={`/jobs/${r.job_id}?tab=catch_all`} className="feed-item">
                <span className={`fi-icon ${r.email ? "valid" : "catch_all"}`}>{r.email ? <Check size={13} strokeWidth={2.4} /> : <Asterisk size={13} />}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", textTransform: "capitalize", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.first} {r.last}
                  </span>
                  <span className="fi-email" style={{ display: "block", fontSize: 11.5, color: r.email ? "var(--ok-ink)" : "var(--faint)" }}>
                    {r.email ?? `no match at ${r.domain}`}
                  </span>
                </span>
                <span className="fi-meta">
                  <Ago at={r.at} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="panel rise" style={{ ["--i" as string]: 9 }}>
        <div className="panel-head">
          <h2 className="panel-title">
            <ListChecks size={15} /> Your lists
          </h2>
          <span className="panel-sub">
            {t?.queued ? `${n(t.queued)} people queued` : "nothing queued"}
            {cfg ? ` · ${n(reqSpent)} of ${n(cfg.requestLimit)} credits used on your picks in 24h` : ""}
          </span>
          <div className="panel-tools">
            {!!t?.queued && (
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => stop(null)}>
                <Square size={12} /> Stop all queued ({n(t.queued)})
              </button>
            )}
          </div>
        </div>
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="tbl tbl-plain">
            <thead>
              <tr>
                <th>List</th>
                <th className="r">Catch-all people</th>
                <th className="r">Not checked</th>
                <th className="r">Queued</th>
                <th className="r">Checked</th>
                <th className="r">Confirmed</th>
                <th className="r">Hit rate</th>
                <th className="r" style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {(s?.lists ?? []).map((l) => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 500, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <Link href={`/jobs/${l.id}?tab=catch_all`}>{l.name}</Link>
                  </td>
                  <td className="r num">{n(l.people)}</td>
                  <td className={`r num${l.open ? "" : " zero"}`}>{n(l.open)}</td>
                  <td className={`r num${l.queued ? "" : " zero"}`} style={l.queued ? { color: "var(--info-ink)" } : undefined}>
                    {n(l.queued)}
                  </td>
                  <td className={`r num${l.checked ? "" : " zero"}`}>{n(l.checked)}</td>
                  <td className={`r num${l.confirmed ? "" : " zero"}`} style={l.confirmed ? { color: "var(--ok-ink)" } : undefined}>
                    {n(l.confirmed)}
                  </td>
                  <td className="r num muted">{rate(l.confirmed, l.checked)}</td>
                  <td className="r">
                    {l.queued > 0 ? (
                      <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => stop(l)}>
                        <Square size={12} /> Stop
                      </button>
                    ) : (
                      <Link href={`/jobs/${l.id}?tab=catch_all`} className="btn btn-ghost btn-sm">
                        Pick people <ArrowUpRight size={13} />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s && s.lists.length === 0 && <div className="empty">No lists with catch-all people yet.</div>}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  i,
  icon: Icon,
  label,
  value,
  foot,
  tone,
}: {
  i: number;
  icon: typeof Check;
  label: string;
  value?: number;
  foot?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="kpi rise" style={{ ["--i" as string]: i, ["--kpi-tone" as string]: tone ?? "transparent" }}>
      <div className="kpi-label">
        <Icon size={14} strokeWidth={1.7} /> {label}
      </div>
      <div className="kpi-value">
        {value === undefined ? (
          <span className="skel" style={{ display: "inline-block", width: 70, height: 26 }} />
        ) : value >= 100_000 ? (
          compact(value)
        ) : (
          <CountUp value={value} />
        )}
      </div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}
