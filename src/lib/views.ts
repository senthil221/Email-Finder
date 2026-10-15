// Read-only queries behind the live screens: dashboard, feeds, lookup ladder, domains.
import type { Db } from "./db";
import { candidates } from "./patterns";
import { getDomain, type JobRow } from "./repo";

export type FeedItem = { id: string; email: string; verdict: string; message: string | null; created_at: string };

/** Most recent MailTester calls, newest first. */
export async function recentVerifications(db: Db, limit = 30): Promise<FeedItem[]> {
  return db.query<FeedItem>(
    `select id::text, email, verdict, message, created_at from verifications order by id desc limit $1`,
    [limit],
  );
}

export type Totals = { found: number; catch_all: number; not_found: number; unverified: number; pending: number };

export type Overview = {
  checks24h: number;
  found24h: number;
  decided24h: number;
  catchAllDomains: number;
  provenDomains: number;
  totals: Totals;
  series: { t: string; checks: number; valid: number }[];
  patterns: { pattern: string; n: number }[];
};

export async function overview(db: Db): Promise<Overview> {
  const [[a], [t], [d], series, patterns] = await Promise.all([
    db.query<{ checks24h: number; found24h: number; decided24h: number }>(
      `select
         (select count(*)::int from verifications where created_at > now() - interval '24 hours') as "checks24h",
         (select count(*)::int from job_rows where status = 'found' and updated_at > now() - interval '24 hours') as "found24h",
         (select count(*)::int from job_rows where status in ('found','catch_all','not_found','unverified')
            and updated_at > now() - interval '24 hours') as "decided24h"`,
    ),
    db.query<Totals>(
      `select count(*) filter (where r.status = 'found')::int as found,
              count(*) filter (where r.status = 'catch_all')::int as catch_all,
              count(*) filter (where r.status = 'not_found')::int as not_found,
              count(*) filter (where r.status = 'unverified')::int as unverified,
              count(*) filter (where r.status = 'pending' and j.status = 'running')::int as pending
       from job_rows r join jobs j on j.id = r.job_id`,
    ),
    db.query<{ catch_all: number; valid: number }>(
      `select count(*) filter (where status = 'catch_all')::int as catch_all,
              count(*) filter (where status = 'valid')::int as valid from domains`,
    ),
    db.query<{ t: string; checks: number; valid: number }>(
      `select date_trunc('minute', created_at) as t, count(*)::int as checks,
              count(*) filter (where verdict = 'valid')::int as valid
       from verifications where created_at > now() - interval '60 minutes'
       group by 1 order by 1`,
    ),
    db.query<{ pattern: string; n: number }>(
      `select pattern, count(*)::int as n from domains where status = 'valid' and pattern is not null
       group by 1 order by 2 desc limit 9`,
    ),
  ]);
  return { ...a, catchAllDomains: d.catch_all, provenDomains: d.valid, totals: t, series, patterns };
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

export async function recentlyDecided(db: Db, jobId: string, limit = 12): Promise<JobRow[]> {
  return db.query<JobRow>(
    `select id::text, row_no, first, last, domain, input, status, email, pattern, reason, checks_used
     from job_rows where job_id = $1 and status not in ('pending','invalid_input')
     order by updated_at desc, id desc limit $2`,
    [jobId, limit],
  );
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
};

export async function listDomains(
  db: Db,
  o: { status?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: DomainView[]; counts: Record<string, number> }> {
  const [rows, counts] = await Promise.all([
    db.query<DomainView>(
      `select d.domain, d.status, d.pattern, d.checked_at,
              count(r.id)::int as people, count(r.id) filter (where r.status = 'found')::int as found
       from domains d left join job_rows r on r.domain = d.domain
       where ($1::text is null or d.status = $1) and ($2::text is null or d.domain ilike '%' || $2 || '%')
       group by d.domain order by max(d.updated_at) desc limit $3 offset $4`,
      [o.status ?? null, o.q || null, o.limit ?? 50, o.offset ?? 0],
    ),
    db.query<{ status: string; n: number }>(`select status, count(*)::int as n from domains group by 1`),
  ]);
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

// ---------- Insights: which combinations win, and where ----------

export const RANGES = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", all: "100 years" } as const;
export type Range = keyof typeof RANGES;

export type PatternStat = {
  pattern: string;
  tried: number; // checks MailTester answered for this combination
  accepted: number;
  rejected: number;
  catch_all: number;
  unverifiable: number;
  finds: number; // people whose final email used this pattern
  avg_checks: number | null; // checks spent on a person found with this pattern
};

export type Insights = {
  range: Range;
  kpi: { people: number; found: number; catch_all: number; checks: number; accepted: number; rejected: number };
  patterns: PatternStat[];
  checksToFind: { checks: number; n: number }[];
  outcomes: { status: string; reason: string | null; n: number }[];
  answers: { verdict: string; message: string | null; n: number }[];
  daily: { day: string; checks: number; found: number; people: number }[];
  byTld: { tld: string; pattern: string; n: number }[];
  bySize: { bucket: string; pattern: string; n: number }[];
  domains: { status: string; n: number }[];
};

export async function insights(db: Db, range: Range): Promise<Insights> {
  const since = `now() - interval '${RANGES[range]}'`; // fixed whitelist, never user text
  const SIZE = `case when s.n = 1 then '1' when s.n <= 5 then '2–5' when s.n <= 20 then '6–20' else '21+' end`;
  const [[kpi], patterns, finds, checksToFind, outcomes, answers, daily, byTld, bySize, domains] = await Promise.all([
    db.query<Insights["kpi"]>(
      `select
         (select count(*)::int from job_rows where status not in ('pending','invalid_input') and updated_at > ${since}) as people,
         (select count(*)::int from job_rows where status = 'found' and updated_at > ${since}) as found,
         (select count(*)::int from job_rows where status = 'catch_all' and updated_at > ${since}) as catch_all,
         (select count(*)::int from verifications where verdict <> 'rate_limited' and created_at > ${since}) as checks,
         (select count(*)::int from verifications where verdict = 'valid' and created_at > ${since}) as accepted,
         (select count(*)::int from verifications where verdict = 'invalid' and created_at > ${since}) as rejected`,
    ),
    db.query<Omit<PatternStat, "finds" | "avg_checks">>(
      `select pattern,
              count(*) filter (where verdict <> 'rate_limited')::int as tried,
              count(*) filter (where verdict = 'valid')::int as accepted,
              count(*) filter (where verdict = 'invalid')::int as rejected,
              count(*) filter (where verdict = 'catch_all')::int as catch_all,
              count(*) filter (where verdict = 'retry')::int as unverifiable
       from verifications where pattern is not null and created_at > ${since} group by pattern`,
    ),
    db.query<{ pattern: string; finds: number; avg_checks: number }>(
      `select pattern, count(*)::int as finds, round(avg(checks_used), 2)::float as avg_checks
       from job_rows where status = 'found' and pattern is not null and updated_at > ${since} group by pattern`,
    ),
    db.query<{ checks: number; n: number }>(
      `select least(checks_used, 12) as checks, count(*)::int as n from job_rows
       where status = 'found' and updated_at > ${since} group by 1 order by 1`,
    ),
    db.query<{ status: string; reason: string | null; n: number }>(
      `select status, reason, count(*)::int as n from job_rows
       where status not in ('pending') and updated_at > ${since} group by 1, 2 order by 3 desc`,
    ),
    db.query<{ verdict: string; message: string | null; n: number }>(
      `select verdict, nullif(message, '') as message, count(*)::int as n from verifications
       where created_at > ${since} group by 1, 2 order by 3 desc limit 14`,
    ),
    db.query<{ day: string; checks: number; found: number; people: number }>(
      `with d as (select generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') as day)
       select d.day,
              (select count(*)::int from verifications v where v.created_at >= d.day and v.created_at < d.day + interval '1 day' and v.verdict <> 'rate_limited') as checks,
              (select count(*)::int from job_rows r where r.status = 'found' and r.updated_at >= d.day and r.updated_at < d.day + interval '1 day') as found,
              (select count(*)::int from job_rows r where r.status not in ('pending','invalid_input') and r.updated_at >= d.day and r.updated_at < d.day + interval '1 day') as people
       from d order by d.day`,
    ),
    db.query<{ tld: string; pattern: string; n: number }>(
      `select coalesce(substring(domain from '\\.((?:co|com|org|net|ac|gov|edu)\\.[a-z]{2})$'), substring(domain from '\\.([a-z0-9-]+)$')) as tld,
              pattern, count(*)::int as n
       from job_rows where status = 'found' and pattern is not null and updated_at > ${since}
       group by 1, 2`,
    ),
    db.query<{ bucket: string; pattern: string; n: number }>(
      `with s as (select domain, count(*) as n from job_rows where status <> 'invalid_input' group by domain)
       select ${SIZE} as bucket, r.pattern, count(*)::int as n
       from job_rows r join s on s.domain = r.domain
       where r.status = 'found' and r.pattern is not null and r.updated_at > ${since}
       group by 1, 2`,
    ),
    db.query<{ status: string; n: number }>(`select status, count(*)::int as n from domains group by 1 order by 2 desc`),
  ]);

  const findMap = new Map(finds.map((f) => [f.pattern, f]));
  const names = new Set([...patterns.map((p) => p.pattern), ...finds.map((f) => f.pattern)]);
  const merged: PatternStat[] = [...names].map((name) => {
    const p = patterns.find((x) => x.pattern === name);
    const f = findMap.get(name);
    return {
      pattern: name,
      tried: p?.tried ?? 0,
      accepted: p?.accepted ?? 0,
      rejected: p?.rejected ?? 0,
      catch_all: p?.catch_all ?? 0,
      unverifiable: p?.unverifiable ?? 0,
      finds: f?.finds ?? 0,
      avg_checks: f?.avg_checks ?? null,
    };
  });
  return { range, kpi, patterns: merged, checksToFind, outcomes, answers, daily, byTld, bySize, domains };
}
