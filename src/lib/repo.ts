// All SQL lives here. Every function takes the Db so it works with pg and PGlite.
import type { Db } from "./db";
import { fillName, normalizeLinkedin } from "./linkedin";
import type { DomainState, Person, PersonResult } from "./engine";
import type { CachedVerdict } from "./checker";
import type { MtnCall } from "./mailtester";
import { cleanDomain, cleanName, isPatternId } from "./patterns";
import { SCHEMA_SQL } from "./schema";

export async function migrate(db: Db) {
  await db.query(SCHEMA_SQL);
}

// ---------- jobs ----------

export type RowInput = { first: string; last: string; domain: string; linkedin?: string; input: Record<string, string> };

export async function createJob(
  db: Db,
  a: { name: string; kind?: "bulk" | "single"; columns?: string[]; priority?: number },
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into jobs (name, kind, columns, priority) values ($1, $2, $3, $4) returning id`,
    [a.name, a.kind ?? "bulk", JSON.stringify(a.columns ?? []), a.priority ?? 0],
  );
  return row.id;
}

/** Cleans and inserts rows. Duplicates (same first+last+domain in this job) are dropped. */
export async function addRows(
  db: Db,
  jobId: string,
  startRowNo: number,
  rows: RowInput[],
): Promise<{ inserted: number; duplicates: number; invalid: number }> {
  let inserted = 0;
  let invalid = 0;
  const domains = new Set<string>();
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const params: unknown[] = [];
    const values: string[] = [];
    chunk.forEach((r, k) => {
      const linkedin = normalizeLinkedin(r.linkedin);
      // A missing or initial-only name is filled from the profile URL.
      const named = linkedin ? fillName(r.first, r.last, linkedin) : r;
      const first = cleanName(named.first);
      const last = cleanName(named.last);
      const domain = cleanDomain(r.domain);
      const ok = !!first && !!domain;
      if (!ok) invalid++;
      else domains.add(domain);
      const b = params.length;
      params.push(
        jobId,
        startRowNo + i + k,
        first,
        last,
        domain,
        ok ? `${first}|${last}|${domain}` : null,
        JSON.stringify(r.input ?? {}),
        ok ? "pending" : "invalid_input",
        ok ? null : "bad_input",
        linkedin || null,
      );
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb,$${b + 8},$${b + 9},$${b + 10})`);
    });
    const res = await db.query(
      `insert into job_rows (job_id, row_no, first, last, domain, dedupe_key, input, status, reason, linkedin)
       values ${values.join(",")}
       on conflict (job_id, dedupe_key) do nothing returning id`,
      params,
    );
    inserted += res.length;
  }
  if (domains.size) {
    const list = [...domains];
    await db.query(
      `insert into domains (domain) select unnest($1::text[]) on conflict (domain) do nothing`,
      [list],
    );
  }
  return { inserted, duplicates: rows.length - inserted, invalid };
}

export async function setJobStatus(db: Db, jobId: string, status: "running" | "cancelled") {
  await db.query(`update jobs set status = $2 where id = $1`, [jobId, status]);
}

export type JobCounts = {
  total: number;
  pending: number;
  found: number;
  catch_all: number;
  not_found: number;
  unverified: number;
  invalid_input: number;
  checks_used: number;
};

const COUNTS_SQL = `
  count(r.id)::int as total,
  count(r.id) filter (where r.status = 'pending')::int as pending,
  count(r.id) filter (where r.status = 'found')::int as found,
  count(r.id) filter (where r.status = 'catch_all')::int as catch_all,
  count(r.id) filter (where r.status = 'not_found')::int as not_found,
  count(r.id) filter (where r.status = 'unverified')::int as unverified,
  count(r.id) filter (where r.status = 'invalid_input')::int as invalid_input,
  coalesce(sum(r.checks_used), 0)::int as checks_used`;

export type JobSummary = {
  id: string;
  name: string;
  kind: string;
  status: string;
  columns: string[];
  created_at: string;
} & JobCounts;

export async function listJobs(db: Db, limit = 100): Promise<JobSummary[]> {
  return db.query<JobSummary>(
    `select j.id, j.name, j.kind, j.status, j.columns, j.created_at, ${COUNTS_SQL}
     from jobs j left join job_rows r on r.job_id = j.id
     where j.kind = 'bulk'
     group by j.id order by j.created_at desc limit $1`,
    [limit],
  );
}

export async function getJob(db: Db, jobId: string): Promise<JobSummary | null> {
  const rows = await db.query<JobSummary>(
    `select j.id, j.name, j.kind, j.status, j.columns, j.created_at, ${COUNTS_SQL}
     from jobs j left join job_rows r on r.job_id = j.id
     where j.id = $1 group by j.id`,
    [jobId],
  );
  return rows[0] ?? null;
}

export type JobRow = {
  id: string;
  row_no: number;
  first: string;
  last: string;
  domain: string;
  input: Record<string, string>;
  status: string;
  email: string | null;
  pattern: string | null;
  reason: string | null;
  checks_used: number;
};

export async function listRows(
  db: Db,
  jobId: string,
  opts: { status?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<JobRow[]> {
  return db.query<JobRow>(
    `select id::text, row_no, first, last, domain, input, status, email, pattern, reason, checks_used
     from job_rows where job_id = $1
       and ($2::text is null or status = $2 or ($2 = 'no_email' and status in ('catch_all','not_found','unverified')))
       and ($5::text is null or first || ' ' || last ilike '%' || $5 || '%' or domain ilike '%' || $5 || '%'
            or email ilike '%' || $5 || '%')
     order by row_no limit $3 offset $4`,
    [jobId, opts.status ?? null, opts.limit ?? 100, opts.offset ?? 0, opts.q ?? null],
  );
}

// ---------- worker ----------

type DomainRow = {
  domain: string;
  status: string;
  pattern: string | null;
  checked_at: string | Date | null;
  mx_checked_at: string | Date | null;
  alt_domain: string | null;
  alt_checked_at: string | Date | null;
};

const DOMAIN_COLS = ["domain", "status", "pattern", "checked_at", "mx_checked_at", "alt_domain", "alt_checked_at"];
const date = (v: string | Date | null) => (v ? new Date(v) : null);

function toState(r: DomainRow): DomainState {
  return {
    domain: r.domain,
    status: r.status as DomainState["status"],
    pattern: isPatternId(r.pattern) ? r.pattern : null,
    checkedAt: date(r.checked_at),
    mxCheckedAt: date(r.mx_checked_at),
    alt: r.alt_domain,
    altCheckedAt: date(r.alt_checked_at),
  };
}

/** Lock the next company that has pending people in a running job. Single lookups go first. */
export async function claimDomain(db: Db, lockSeconds = 600): Promise<DomainState | null> {
  const rows = await db.query<DomainRow>(
    `with c as (
       select d.domain from job_rows r
       join jobs j on j.id = r.job_id
       join domains d on d.domain = r.domain
       where r.status = 'pending' and j.status = 'running'
         and (d.locked_until is null or d.locked_until < now())
       order by j.priority desc, r.id
       limit 1
       for update of d skip locked
     )
     update domains set locked_until = now() + make_interval(secs => $1)
     from c where domains.domain = c.domain
     returning ${DOMAIN_COLS.map((c) => `domains.${c}`).join(", ")}`,
    [lockSeconds],
  );
  return rows[0] ? toState(rows[0]) : null;
}

export async function extendLock(db: Db, domain: string, lockSeconds = 600) {
  await db.query(`update domains set locked_until = now() + make_interval(secs => $2) where domain = $1`, [
    domain,
    lockSeconds,
  ]);
}

export async function releaseDomain(db: Db, domain: string) {
  await db.query(`update domains set locked_until = null where domain = $1`, [domain]);
}

export async function pendingPeople(db: Db, domain: string, limit = 50): Promise<Person[]> {
  return db.query<Person>(
    `select r.id::text as id, r.first, r.last, r.moved_from as "movedFrom", r.linkedin,
       -- The same profile was found at this domain before: try that pattern first (usually a free cache hit).
       (select p.pattern from job_rows p where r.linkedin is not null and p.linkedin = r.linkedin
          and p.domain = r.domain and p.status = 'found' order by p.updated_at desc limit 1) as "knownPattern"
     from job_rows r join jobs j on j.id = r.job_id
     where r.domain = $1 and r.status = 'pending' and j.status = 'running'
     order by j.priority desc, r.id limit $2`,
    [domain, limit],
  );
}

export async function saveResult(db: Db, rowId: string, r: PersonResult) {
  await db.query(
    `update job_rows set status = $2, email = $3, pattern = $4, reason = $5,
       checks_used = checks_used + $6, updated_at = now()
     where id = $1`,
    [rowId, r.status, r.email, r.pattern, r.reason, r.checksUsed],
  );
}

export async function saveDomain(db: Db, s: DomainState) {
  await db.query(
    `update domains set status = $2, pattern = $3, checked_at = $4, mx_checked_at = $5, alt_domain = $6,
       alt_checked_at = $7, updated_at = now() where domain = $1`,
    [s.domain, s.status, s.pattern, s.checkedAt, s.mxCheckedAt ?? null, s.alt ?? null, s.altCheckedAt ?? null],
  );
}

/** Restart a person on another domain (only ever once): pending there, checks so far kept. */
export async function movePerson(db: Db, rowId: string, domain: string, checksUsed: number) {
  await db.query(`insert into domains (domain) values ($1) on conflict (domain) do nothing`, [domain]);
  await db.query(
    `update job_rows set moved_from = domain, domain = $2, checks_used = checks_used + $3, updated_at = now()
     where id = $1 and moved_from is null`,
    [rowId, domain, checksUsed],
  );
}

/** Known dead within `days` (no MX, or every scout rejected): not worth moving people to. */
export async function isDeadDomain(db: Db, domain: string, days = 60): Promise<boolean> {
  const rows = await db.query(
    `select 1 from domains where domain = $1 and status in ('no_mx', 'not_found')
       and checked_at > now() - make_interval(days => $2)`,
    [domain, days],
  );
  return rows.length > 0;
}

export async function getDomain(db: Db, domain: string): Promise<DomainState | null> {
  const rows = await db.query<DomainRow>(
    `select ${DOMAIN_COLS.join(", ")} from domains where domain = $1`,
    [domain],
  );
  return rows[0] ? toState(rows[0]) : null;
}

// ---------- verifications ----------

export async function cachedVerdict(db: Db, email: string, days = 60): Promise<CachedVerdict | null> {
  const rows = await db.query<{ verdict: CachedVerdict }>(
    `select verdict from verifications
     where email = $1 and verdict in ('valid','invalid','catch_all','no_mx')
       and created_at > now() - make_interval(days => $2)
     order by created_at desc limit 1`,
    [email, days],
  );
  return rows[0]?.verdict ?? null;
}

export async function recordVerification(db: Db, email: string, call: MtnCall, pattern?: string) {
  await db.query(
    `insert into verifications (email, verdict, code, message, raw, pattern, domain)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [email, call.verdict, call.code, call.message, JSON.stringify(call.raw ?? null), pattern ?? null, email.split("@")[1] ?? null],
  );
}

/** MailTester calls (retries included) in the last 24 hours: the budget is a rolling window. */
export async function checksLast24h(db: Db): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    `select count(*)::int as n from verifications where created_at > now() - interval '24 hours'`,
  );
  return r.n;
}

// ---------- worker status ----------

export type WorkerStatus = { state: string; message: string | null; heartbeat_at: string };

export async function setWorkerStatus(db: Db, state: string, message: string | null = null) {
  await db.query(
    `insert into worker_status (id, state, message, heartbeat_at) values (1, $1, $2, now())
     on conflict (id) do update set state = excluded.state, message = excluded.message, heartbeat_at = now()`,
    [state, message],
  );
}

export async function getWorkerStatus(db: Db): Promise<WorkerStatus | null> {
  const rows = await db.query<WorkerStatus>(`select state, message, heartbeat_at from worker_status where id = 1`);
  return rows[0] ?? null;
}

/** People found per base pattern over the last `days` (ranks the ladder). */
export async function patternFinds(db: Db, days = 90): Promise<{ pattern: string; n: number }[]> {
  return db.query<{ pattern: string; n: number }>(
    `select pattern, count(*)::int as n from job_rows
     where status = 'found' and pattern is not null and updated_at > now() - make_interval(days => $1)
     group by 1`,
    [days],
  );
}
