// Read-only queries behind the screens: overview, lookup ladder, lookups, companies.
import type { Db } from "./db";
import { candidates } from "./patterns";
import { getDomain } from "./repo";

export type Overview = {
  /** People in every list, bad input left out. */
  people: number;
  found: number;
  /** Of the found: published on the company's own website. */
  found_website: number;
  /** Of the found: confirmed by no2bounce at a catch-all company. */
  found_catch_all: number;
  catch_all: number;
  /** Catch-all people no2bounce looked at without confirming an address. */
  ca_checked: number;
  not_found: number;
  unverified: number;
  /** Waiting in running lists. */
  pending: number;
  /** MailTester checks in the last 24 hours. */
  checks24h: number;
  found24h: number;
  /** no2bounce credits spent in the last 24 hours: background pass and people picked on a list. */
  n2b24h: { auto: number; request: number };
  /** no2bounce credits left, as the worker last saw them. */
  n2bCredits: number | null;
  /** The company patterns behind the most finds. */
  patterns: { pattern: string; n: number }[];
};

/** The few numbers the overview shows. */
export async function overview(db: Db): Promise<Overview> {
  const [[t], [a], n2b, [w], patterns] = await Promise.all([
    db.query<Omit<Overview, "checks24h" | "found24h" | "n2b24h" | "n2bCredits" | "patterns">>(
      `select count(*) filter (where r.status <> 'invalid_input')::int as people,
              count(*) filter (where r.status = 'found')::int as found,
              count(*) filter (where r.status = 'found' and r.reason = 'website')::int as found_website,
              count(*) filter (where r.status = 'found' and r.reason = 'catch_all_verified')::int as found_catch_all,
              count(*) filter (where r.status = 'catch_all')::int as catch_all,
              count(*) filter (where r.status = 'catch_all' and r.ca_checked_at is not null)::int as ca_checked,
              count(*) filter (where r.status = 'not_found')::int as not_found,
              count(*) filter (where r.status = 'unverified')::int as unverified,
              count(*) filter (where r.status = 'pending' and j.status = 'running')::int as pending
       from job_rows r join jobs j on j.id = r.job_id`,
    ),
    db.query<{ checks24h: number; found24h: number }>(
      `select (select count(*)::int from verifications where created_at > now() - interval '24 hours') as "checks24h",
              (select count(*)::int from job_rows where status = 'found' and updated_at > now() - interval '24 hours') as "found24h"`,
    ),
    db.query<{ source: string; n: number }>(
      `select source, coalesce(sum(credits), 0)::int as n from n2b_checks
       where created_at > now() - interval '24 hours' group by 1`,
    ),
    db.query<{ n2b_credits: number | null }>(`select n2b_credits from worker_status where id = 1`),
    db.query<{ pattern: string; n: number }>(
      `select pattern, count(*)::int as n from job_rows where status = 'found' and pattern is not null
       group by 1 order by 2 desc limit 5`,
    ),
  ]);
  const spent = (s: string) => n2b.find((x) => x.source === s)?.n ?? 0;
  return {
    ...t,
    ...a,
    n2b24h: { auto: spent("auto"), request: spent("request") },
    n2bCredits: w?.n2b_credits ?? null,
    patterns,
  };
}

/** People decided per minute over the last 5 minutes for a job (for the ETA). */
export async function jobRate(db: Db, jobId: string): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    `select count(*)::int as n from job_rows where job_id = $1
       and status not in ('pending','invalid_input') and updated_at > now() - interval '5 minutes'`,
    [jobId],
  );
  return r.n / 5;
}

export type Lookup = {
  id: string;
  created_at: string;
  first: string;
  last: string;
  domain: string;
  status: string;
  email: string | null;
  pattern: string | null;
  reason: string | null;
  checks_used: number;
  moved_from: string | null;
};

const LOOKUP_SQL = `select j.id, j.created_at, r.first, r.last, r.domain, r.status, r.email, r.pattern, r.reason, r.checks_used, r.moved_from
  from jobs j join job_rows r on r.job_id = j.id`;

export async function listLookups(db: Db, limit = 50, offset = 0): Promise<{ rows: Lookup[]; total: number }> {
  const [rows, [c]] = await Promise.all([
    db.query<Lookup>(`${LOOKUP_SQL} where j.kind = 'single' order by j.created_at desc limit $1 offset $2`, [limit, offset]),
    db.query<{ n: number }>(`select count(*)::int as n from jobs where kind = 'single'`),
  ]);
  return { rows, total: c.n };
}

export type StepState = "queued" | "valid" | "invalid" | "catch_all" | "no_mx" | "retry" | "unverified" | "skipped";

export type LadderStep = {
  pattern: string;
  email: string;
  state: StepState;
  cached: boolean;
  attempts: number;
  message: string | null;
  at: string | null;
};

const FINAL = new Set(["valid", "invalid", "catch_all", "no_mx"]);

/** A single lookup with every combination and what happened to it, in the order tried. */
export async function lookupDetail(db: Db, jobId: string) {
  const [lookup] = await db.query<Lookup>(`${LOOKUP_SQL} where j.id = $1 limit 1`, [jobId]);
  if (!lookup) return null;
  // A person restarted on the company's other domain: show both ladders, first domain first.
  const list = [
    ...(lookup.moved_from ? candidates(lookup.first, lookup.last, lookup.moved_from) : []),
    ...candidates(lookup.first, lookup.last, lookup.domain),
  ];
  const rows = list.length
    ? await db.query<{ email: string; verdict: string; message: string | null; created_at: string }>(
        `select email, verdict, message, created_at from verifications
         where email = any($1::text[]) and created_at > $2::timestamptz - interval '60 days' order by id`,
        [list.map((c) => c.email), lookup.created_at],
      )
    : [];
  const since = new Date(lookup.created_at).getTime() - 1000;
  const pending = lookup.status === "pending";

  const steps = list.map((c, i) => {
    const mine = rows.filter((r) => r.email === c.email && r.verdict !== "rate_limited");
    const now = mine.filter((r) => new Date(r.created_at).getTime() >= since);
    const cache = mine.filter((r) => new Date(r.created_at).getTime() < since && FINAL.has(r.verdict)).at(-1);
    const base = { pattern: c.pattern, email: c.email, attempts: now.length, cached: false, message: null, at: null };
    const last = now.at(-1);
    if (last) {
      let state = last.verdict as StepState;
      if (last.verdict === "retry" && !pending) state = "unverified";
      if (last.verdict === "fatal") state = "retry";
      return { ...base, state, message: last.message, at: last.created_at, order: new Date(now[0].created_at).getTime() };
    }
    if (cache) {
      return { ...base, state: cache.verdict as StepState, cached: true, message: cache.message, at: cache.created_at, order: since + i };
    }
    return { ...base, state: (pending ? "queued" : "skipped") as StepState, order: Number.MAX_SAFE_INTEGER - 100 + i };
  });
  steps.sort((x, y) => x.order - y.order);
  return {
    lookup,
    steps: steps.map((s) => ({ ...s, order: undefined })) as LadderStep[],
    domain: await getDomain(db, lookup.domain),
  };
}

export type DomainView = {
  domain: string;
  status: string;
  pattern: string | null;
  checked_at: string | null;
  people: number;
  found: number;
  /** Website pass: ok | robots | blocked | down, null until the site was read. */
  scrape_outcome: string | null;
  scraped_at: string | null;
  site_emails: string[] | null;
  mail_domain: string | null;
  found_website: number;
  total: number; // rows matching the current filters, for paging
};

/** Totals for the website pass, across every company read so far. */
export type SiteTotals = {
  read: number;
  ok: number;
  with_emails: number;
  addresses: number;
  mail_domains: number;
  blocked: number;
  robots: number;
  down: number;
  found_website: number;
  moved_website: number;
};

/** Website filters on the Domains page. */
export const SITE_FILTERS = {
  emails: `jsonb_array_length(coalesce(d.site_emails, '[]'::jsonb)) > 0`,
  mail_domain: `d.mail_domain is not null`,
  unread: `d.scrape_outcome in ('blocked', 'robots', 'down')`,
} as const;
export type SiteFilter = keyof typeof SITE_FILTERS;

export async function listDomains(
  db: Db,
  o: { status?: string; site?: SiteFilter; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: DomainView[]; counts: Record<string, number>; siteCounts: Record<SiteFilter, number>; site: SiteTotals }> {
  const siteWhere = o.site ? SITE_FILTERS[o.site] : "true";
  const [rows, counts, [site]] = await Promise.all([
    db.query<DomainView>(
      `select d.domain, d.status, d.pattern, d.checked_at, d.scrape_outcome, d.scraped_at, d.site_emails, d.mail_domain,
              count(r.id)::int as people, count(r.id) filter (where r.status = 'found')::int as found,
              count(r.id) filter (where r.status = 'found' and r.reason = 'website')::int as found_website,
              count(*) over ()::int as total
       from domains d left join job_rows r on r.domain = d.domain
       where ($1::text is null or d.status = $1) and ($2::text is null or d.domain ilike '%' || $2 || '%') and ${siteWhere}
       group by d.domain order by max(d.updated_at) desc limit $3 offset $4`,
      [o.status ?? null, o.q || null, o.limit ?? 50, o.offset ?? 0],
    ),
    db.query<{ status: string; n: number }>(`select status, count(*)::int as n from domains group by 1`),
    db.query<SiteTotals & Record<SiteFilter, number>>(
      `select count(*) filter (where d.scraped_at is not null)::int as read,
              count(*) filter (where d.scrape_outcome = 'ok')::int as ok,
              count(*) filter (where ${SITE_FILTERS.emails})::int as with_emails,
              coalesce(sum(jsonb_array_length(coalesce(d.site_emails, '[]'::jsonb))), 0)::int as addresses,
              count(*) filter (where ${SITE_FILTERS.mail_domain})::int as mail_domains,
              count(*) filter (where d.scrape_outcome = 'blocked')::int as blocked,
              count(*) filter (where d.scrape_outcome = 'robots')::int as robots,
              count(*) filter (where d.scrape_outcome = 'down')::int as down,
              count(*) filter (where ${SITE_FILTERS.emails})::int as emails,
              count(*) filter (where ${SITE_FILTERS.mail_domain})::int as mail_domain,
              count(*) filter (where ${SITE_FILTERS.unread})::int as unread,
              (select count(*)::int from job_rows where status = 'found' and reason = 'website') as found_website,
              (select count(*)::int from job_rows where moved_via = 'website') as moved_website
       from domains d`,
    ),
  ]);
  const { emails, mail_domain, unread, ...totals } = site;
  return {
    rows,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    siteCounts: { emails, mail_domain, unread },
    site: totals,
  };
}
