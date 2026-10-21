"use client";
import { Fragment, useEffect, useState } from "react";
import { ArrowRight, AtSign, ChevronDown, Globe, MailCheck, Search, ShieldOff, Shuffle } from "lucide-react";
import type { DomainView, SiteFilter, SiteTotals } from "@/lib/views";
import { ROLE_LOCALS } from "@/lib/scrape";
import { usePoll } from "@/components/usePoll";
import { Ago, Chip, CountUp, PageHead, Pager, Seg } from "@/components/ui";
import { n, PATTERN_LABEL } from "@/components/format";

const TABS = [
  ["", "All"],
  ["valid", "Proven pattern"],
  ["catch_all", "Catch-all"],
  ["not_found", "Parked"],
  ["no_mx", "No mail server"],
  ["unknown", "Not checked"],
] as const;

const SITE_TABS: [SiteFilter | "", string][] = [
  ["", "Any website"],
  ["emails", "Shows emails"],
  ["mail_domain", "Other mail domain"],
  ["unread", "Couldn't read"],
];

const OUTCOME: Record<string, [chip: string, label: string]> = {
  ok: ["found", "Read"],
  blocked: ["not_found", "Blocked"],
  robots: ["catch_all", "No bots"],
  down: ["skipped", "Down"],
};

type Data = {
  rows: DomainView[];
  counts: Record<string, number>;
  siteCounts: Record<SiteFilter, number>;
  site: SiteTotals;
};

export default function DomainsPage() {
  const [tab, setTab] = useState("");
  const [site, setSite] = useState<SiteFilter | "">("");
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data } = usePoll<Data>(
    `/api/domains?page=${page}${tab ? `&status=${tab}` : ""}${site ? `&site=${site}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    5000,
  );
  const counts = data?.counts ?? {};
  const all = Object.values(counts).reduce((s, v) => s + v, 0);
  const total = data?.rows[0]?.total ?? 0;
  const t = data?.site;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <Globe size={13} /> Domains
          </>
        }
        title={
          <>
            What every company <i>looks like.</i>
          </>
        }
        sub="Each company's proven email pattern, catch-all servers and parked domains, plus what its own website publishes. Later uploads reuse all of this."
      />

      <section className="grid g-kpi">
        <Kpi i={1} icon={Globe} label="Websites read" v={t?.read} foot={t ? `${pct(t.ok, t.read)} opened fine` : null} />
        <Kpi
          i={2}
          icon={AtSign}
          label="Sites showing emails"
          v={t?.with_emails}
          tone="var(--ok)"
          foot={t ? `${n(t.addresses)} addresses · ${pct(t.with_emails, t.read)} of sites` : null}
        />
        <Kpi
          i={3}
          icon={MailCheck}
          label="Found on websites"
          v={t?.found_website}
          tone="var(--ok)"
          foot="people, no MailTester check"
        />
        <Kpi
          i={4}
          icon={Shuffle}
          label="Other mail domain"
          v={t?.mail_domains}
          tone="var(--accent)"
          foot={t ? `${n(t.moved_website)} people sent there` : null}
        />
        <Kpi
          i={5}
          icon={ShieldOff}
          label="Couldn't read"
          v={t ? t.blocked + t.robots + t.down : undefined}
          foot={t ? `${n(t.blocked)} blocked · ${n(t.robots)} no bots · ${n(t.down)} down` : null}
        />
      </section>

      <div className="toolbar rise" style={{ ["--i" as string]: 1, flexWrap: "wrap" }}>
        <Seg
          value={tab}
          onChange={(v) => {
            setTab(v);
            setPage(0);
          }}
          items={TABS.map(([value, label]) => ({ value, label, count: value ? (counts[value] ?? 0) : all }))}
        />
        <Seg
          value={site}
          onChange={(v) => {
            setSite(v);
            setPage(0);
          }}
          items={SITE_TABS.map(([value, label]) => ({ value, label, count: value ? (data?.siteCounts[value] ?? 0) : undefined }))}
        />
        <span className="spacer" />
        <div className="search" style={{ width: 240 }}>
          <Search size={14} />
          <input className="input" placeholder="Search domains" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="tbl-wrap rise" style={{ ["--i" as string]: 2 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Status</th>
              <th>Company pattern</th>
              <th>Website</th>
              <th className="r">People</th>
              <th className="r">Found</th>
              <th style={{ width: 140 }}>Hit rate</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((d) => {
              const rate = d.people ? (d.found / d.people) * 100 : 0;
              const emails = d.site_emails ?? [];
              const isOpen = open === d.domain;
              const canOpen = emails.length > 0 || !!d.mail_domain;
              const [chip, label] = d.scrape_outcome ? (OUTCOME[d.scrape_outcome] ?? ["skipped", d.scrape_outcome]) : ["", ""];
              return (
                <Fragment key={d.domain}>
                  <tr className={canOpen ? "is-link" : undefined} onClick={() => canOpen && setOpen(isOpen ? null : d.domain)}>
                    <td className="mono" style={{ fontWeight: 500 }}>
                      <span className="row" style={{ gap: 6 }}>
                        {canOpen && (
                          <ChevronDown size={13} style={{ color: "var(--faint)", transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform .15s" }} />
                        )}
                        {d.domain}
                      </span>
                    </td>
                    <td>
                      <Chip status={d.status === "valid" ? "found" : d.status === "not_found" ? "not_found" : d.status === "unknown" ? "skipped" : d.status}>
                        {TABS.find(([k]) => k === d.status)?.[1]}
                      </Chip>
                    </td>
                    <td>{d.pattern ? <span className="tag">{PATTERN_LABEL[d.pattern]}</span> : <span className="faint">—</span>}</td>
                    <td>
                      {d.scrape_outcome ? (
                        <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <Chip status={chip}>{label}</Chip>
                          {emails.length > 0 && <span className="tag">{emails.length} emails</span>}
                          {d.mail_domain && (
                            <span className="tag" title="The website's addresses use this domain for mail">
                              <ArrowRight size={11} /> {d.mail_domain}
                            </span>
                          )}
                          {d.found_website > 0 && (
                            <span className="tag" style={{ color: "var(--ok-ink)" }} title="People found from this website">
                              {d.found_website} found
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="faint">Not read yet</span>
                      )}
                    </td>
                    <td className="r num">{n(d.people)}</td>
                    <td className={`r num${d.found ? "" : " zero"}`} style={{ color: d.found ? "var(--ok-ink)" : undefined }}>
                      {n(d.found)}
                    </td>
                    <td>
                      <div className="row">
                        <div className="hbar" style={{ gridTemplateColumns: "1fr", flex: 1 }}>
                          <span className="track">
                            <i style={{ width: `${rate}%` }} />
                          </span>
                        </div>
                        <span className="num muted" style={{ width: 36, textAlign: "right", fontSize: 12 }}>
                          {Math.round(rate)}%
                        </span>
                      </div>
                    </td>
                    <td className="muted">{d.checked_at ? <Ago at={d.checked_at} /> : "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8} style={{ background: "var(--surface-2)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                          <span className="faint" style={{ fontSize: 12 }}>
                            Published on {d.domain}
                            {d.scraped_at ? (
                              <>
                                {" "}
                                · read <Ago at={d.scraped_at} />
                              </>
                            ) : null}
                            {d.mail_domain ? ` · mail goes to ${d.mail_domain}` : ""} · shared inboxes are greyed out
                          </span>
                          <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                            {emails.map((e) => {
                              const role = ROLE_LOCALS.has(e.split("@")[0]);
                              return (
                                <span key={e} className="tag" style={{ opacity: role ? 0.55 : 1 }}>
                                  {e}
                                </span>
                              );
                            })}
                            {!emails.length && <span className="faint">No addresses on the site.</span>}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {data && data.rows.length === 0 && <div className="empty">No domains here yet.</div>}
      </div>
      <Pager page={page} pages={Math.ceil(total / 50)} onPage={setPage} />
    </div>
  );
}

function Kpi({
  i,
  icon: Icon,
  label,
  v,
  foot,
  tone,
}: {
  i: number;
  icon: typeof Globe;
  label: string;
  v?: number;
  foot?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="kpi rise" style={{ ["--i" as string]: i, ["--kpi-tone" as string]: tone ?? "transparent" }}>
      <div className="kpi-label">
        <Icon size={14} strokeWidth={1.7} /> {label}
      </div>
      <div className="kpi-value">
        {v === undefined ? <span className="skel" style={{ display: "inline-block", width: 70, height: 26 }} /> : <CountUp value={v} />}
      </div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}
