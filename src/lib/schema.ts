// Email Finder schema. Idempotent: safe to run on every worker start.
export const SCHEMA_SQL = `
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'bulk',          -- bulk | single
  status text not null default 'uploading',   -- uploading | running | cancelled
  priority int not null default 0,            -- single lookups jump the queue
  columns jsonb not null default '[]',        -- original CSV headers, in order
  created_at timestamptz not null default now()
);

create table if not exists job_rows (
  id bigserial primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  row_no int not null,
  first text not null default '',
  last text not null default '',
  domain text not null default '',
  dedupe_key text,                            -- first|last|domain; null for bad input
  input jsonb not null default '{}',          -- the original CSV row
  status text not null default 'pending',     -- pending | found | catch_all | not_found | unverified | invalid_input
  email text,
  pattern text,
  reason text,
  checks_used int not null default 0,
  updated_at timestamptz not null default now(),
  unique (job_id, dedupe_key)
);
create index if not exists job_rows_job_status on job_rows (job_id, status);
create index if not exists job_rows_pending on job_rows (domain, id) where status = 'pending';
create index if not exists job_rows_pending_id on job_rows (id) where status = 'pending';
create index if not exists job_rows_job_updated on job_rows (job_id, updated_at desc);
create index if not exists job_rows_updated on job_rows (updated_at);

create table if not exists domains (
  domain text primary key,
  status text not null default 'unknown',     -- unknown | valid | catch_all | not_found | no_mx
  pattern text,                               -- company style once proven, e.g. first.last
  checked_at timestamptz,
  locked_until timestamptz,                   -- a worker is processing this company
  updated_at timestamptz not null default now()
);

-- Free DNS checks, so MailTester is never asked about a domain that cannot get mail,
-- and the company's other domain (website redirect or .in/.com/.co.in twin).
alter table domains add column if not exists mx_checked_at timestamptz;
alter table domains add column if not exists alt_domain text;
alter table domains add column if not exists alt_checked_at timestamptz;
-- Set when a person was restarted on the alternate domain (only ever once).
alter table job_rows add column if not exists moved_from text;
-- LinkedIn profile slug: the person's stable ID across uploads (never fetched).
alter table job_rows add column if not exists linkedin text;
create index if not exists job_rows_linkedin on job_rows (linkedin, domain) where linkedin is not null;

create table if not exists verifications (
  id bigserial primary key,
  email text not null,
  verdict text not null,                      -- valid | invalid | catch_all | no_mx | retry | rate_limited | fatal
  code text,
  message text,
  raw jsonb,
  created_at timestamptz not null default now()
);
-- Which of the 9 combinations each check was, for the Insights page.
alter table verifications add column if not exists pattern text;
alter table verifications add column if not exists domain text;
create index if not exists verifications_email on verifications (email, created_at desc);
create index if not exists verifications_pattern on verifications (created_at, pattern) where pattern is not null;

-- Backfill: checks logged before the pattern column existed get it from the
-- person they were for. Only touches rows that still have no pattern.
update verifications v set pattern = m.pattern, domain = m.domain
from (
  select distinct on (v2.id) v2.id, p.pattern, r.domain
  from verifications v2
  join job_rows r on r.domain = split_part(v2.email, '@', 2)
  cross join lateral (values
    ('first', r.first),
    ('first.last', case when r.last <> '' then r.first || '.' || r.last end),
    ('firstlast', case when r.last <> '' then r.first || r.last end),
    ('flast', case when r.last <> '' then left(r.first, 1) || r.last end),
    ('firstl', case when r.last <> '' then r.first || left(r.last, 1) end),
    ('first.l', case when r.last <> '' then r.first || '.' || left(r.last, 1) end),
    ('first_last', case when r.last <> '' then r.first || '_' || r.last end),
    ('fl', case when r.last <> '' then left(r.first, 1) || left(r.last, 1) end),
    ('f.last', case when r.last <> '' then left(r.first, 1) || '.' || r.last end)
  ) as p(pattern, local)
  where v2.pattern is null and p.local = split_part(v2.email, '@', 1)
) m
where v.id = m.id;
create index if not exists verifications_created on verifications (created_at);

create table if not exists worker_status (
  id int primary key default 1,
  state text not null,                        -- running | idle | paused_daily_limit | error
  message text,
  heartbeat_at timestamptz not null default now()
);
`;
