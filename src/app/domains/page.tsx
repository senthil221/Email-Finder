"use client";
import { Fragment, useEffect, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { DomainView, SiteFilter, SiteTotals } from "@/lib/views";
import { ROLE_LOCALS } from "@/lib/scrape";
import { usePoll } from "@/components/usePoll";
import { Ago, PageHead, Pager, Skeleton, Status, Tabs } from "@/components/ui";
import { n, PATTERN_LABEL, pct } from "@/components/format";

const TABS = [
  ["", "All"],
  ["valid", "Pattern known"],
  ["catch_all", "Catch-all"],
  ["not_found", "No match yet"],
  ["no_mx", "No mail server"],
  ["unknown", "Not checked"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Company status: [dot colour, words]. */
const STATE: Record<string, [string, string]> = {
  valid: ["found", "Pattern known"],
  catch_all: ["catch_all", "Catch-all"],
  not_found: ["not_found", "No match yet"],
  no_mx: ["not_found", "No mail server"],
  unknown: ["idle", "Not checked"],
};

const SITE: Record<string, string> = {
  ok: "Read",
  blocked: "Blocked us",
  robots: "Asks bots to stay away",
  down: "Site down",
};

type Data = { rows: DomainView[]; counts: Record<string, number>; siteCounts: Record<SiteFilter, number>; site: SiteTotals };

export default function CompaniesPage() {
  const [tab, setTab] = useState<Tab>("");
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
    15_000,
  );
  const counts = data?.counts ?? {};
  const all = Object.values(counts).reduce((s, v) => s + v, 0);
  const total = data?.rows[0]?.total ?? 0;
  const t = data?.site;

  return (
    <div className="page">
      <PageHead
        title="Companies"
        sub={
          t
            ? `Each company's email pattern, learned once and reused by every later list. ${n(t.read)} websites read so far; ${n(t.found_website)} people found right on them.`
            : "Each company's email pattern, learned once and reused by every later list."
        }
      />

      <div className="toolbar">
        <label className="sr-only" htmlFor="site-filter">
          Website
        </label>
        <select
          id="site-filter"
          className="select"
          style={{ width: 200, height: 34 }}
          value={site}
          onChange={(e) => {
            setSite(e.target.value as SiteFilter | "");
            setPage(0);
          }}
        >
          <option value="">Any website</option>
          <option value="emails">Website shows emails ({n(data?.siteCounts.emails ?? 0)})</option>
          <option value="mail_domain">Uses another mail domain ({n(data?.siteCounts.mail_domain ?? 0)})</option>
          <option value="unread">Website couldn&apos;t be read ({n(data?.siteCounts.unread ?? 0)})</option>
        </select>
        <div className="search" style={{ width: 220 }}>
          <Search size={15} />
          <label className="sr-only" htmlFor="company-search">
            Search companies
          </label>
          <input id="company-search" className="input" placeholder="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Tabs
        label="Filter by status"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(0);
        }}
        items={TABS.map(([value, label]) => ({ value, label, count: value ? (counts[value] ?? 0) : all }))}
      />

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Company</th>
              <th>Status</th>
              <th>Pattern</th>
              <th className="r">People</th>
              <th className="r">Found</th>
              <th>Website</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((d) => {
              const emails = d.site_emails ?? [];
              const isOpen = open === d.domain;
              const canOpen = emails.length > 0 || !!d.mail_domain;
              const [dot, word] = STATE[d.status] ?? ["idle", d.status];
              return (
                <Fragment key={d.domain}>
                  <tr className={canOpen ? "is-link" : undefined} onClick={() => canOpen && setOpen(isOpen ? null : d.domain)}>
                    <td style={{ fontWeight: 500 }}>
                      <span className="row" style={{ gap: 4 }}>
                        {canOpen ? (
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ width: 22, height: 22 }}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} what ${d.domain} publishes`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen(isOpen ? null : d.domain);
                            }}
                          >
                            <ChevronRight size={15} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 120ms" }} />
                          </button>
                        ) : (
                          <span style={{ width: 22 }} />
                        )}
                        {d.domain}
                      </span>
                    </td>
                    <td>
                      <Status status={dot}>{word}</Status>
                    </td>
                    <td>{d.pattern ? <span className="tag">{PATTERN_LABEL[d.pattern]}</span> : <span className="faint">—</span>}</td>
                    <td className="r num">{n(d.people)}</td>
                    <td className="r num">
                      <span className={d.found ? "ok-ink" : "zero"}>{n(d.found)}</span> <span className="faint">{pct(d.found, d.people)}</span>
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {d.scrape_outcome ? (
                        <>
                          {SITE[d.scrape_outcome] ?? d.scrape_outcome}
                          {emails.length > 0 && ` · ${emails.length} ${emails.length === 1 ? "email" : "emails"}`}
                          {d.mail_domain && ` · mail at ${d.mail_domain}`}
                        </>
                      ) : (
                        <span className="faint">Not read yet</span>
                      )}
                    </td>
                    <td className="muted">{d.checked_at ? <Ago at={d.checked_at} /> : "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ background: "var(--surface-2)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 4px 26px" }}>
                          <span className="muted" style={{ fontSize: 13 }}>
                            Published on {d.domain}
                            {d.mail_domain ? ` · mail goes to ${d.mail_domain}` : ""} · shared inboxes are greyed out
                          </span>
                          <span className="row wrap" style={{ gap: 6 }}>
                            {emails.map((e) => (
                              <span key={e} className="tag" style={{ opacity: ROLE_LOCALS.has(e.split("@")[0]) ? 0.55 : 1 }}>
                                {e}
                              </span>
                            ))}
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
        {data && data.rows.length === 0 && <div className="empty">No companies here.</div>}
        {!data && <Skeleton />}
      </div>
      <Pager page={page} pages={Math.ceil(total / 50)} onPage={setPage} />
    </div>
  );
}
