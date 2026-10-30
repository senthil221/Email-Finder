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
-- Free website pass: the addresses a company publishes and the domain it uses for mail.
alter table domains add column if not exists scraped_at timestamptz;
alter table domains add column if not exists scrape_outcome text;      -- ok | robots | blocked | down
alter table domains add column if not exists site_emails jsonb;
alter table domains add column if not exists mail_domain text;
-- "website" when the company's own site sent the person to another mail domain.
alter table job_rows add column if not exists moved_via text;
create index if not exists job_rows_domain on job_rows (domain);

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

-- Catch-all pass: no2bounce checks catch-all people a second way. Calls cost money, so
-- every one is kept (cache, 24-hour credit budget, and resuming checks still in progress).
alter table domains add column if not exists mx_provider text;         -- google | microsoft | zoho | other
alter table domains add column if not exists ca_pattern text;          -- the pattern no2bounce confirmed at this catch-all company
alter table domains add column if not exists ca_accepts_all boolean;   -- no2bounce passed a made-up address here: never trust it at this company
alter table job_rows add column if not exists ca_checked_at timestamptz;
create index if not exists job_rows_catch_all_todo on job_rows (domain) where status = 'catch_all' and ca_checked_at is null;
create table if not exists n2b_checks (
  id bigserial primary key,
  email text not null,
  pattern text,                               -- which combination, or "canary" for the made-up address
  tracking_id text,
  result text not null default 'pending',     -- pending | deliverable | undeliverable | catch_all | risky | unknown
  status text,                                -- no2bounce's own words, e.g. Deliverable/AcceptAll
  score int,
  credits int not null default 1,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists n2b_checks_email on n2b_checks (email, id desc);
create index if not exists n2b_checks_created on n2b_checks (created_at);
-- Catch-all checks asked for from a list: checked straight away, whatever the mail
-- provider, within their own daily credit budget ("request", apart from the background "auto").
alter table job_rows add column if not exists ca_requested_at timestamptz;
create index if not exists job_rows_catch_all_requested on job_rows (ca_requested_at)
  where status = 'catch_all' and ca_requested_at is not null and ca_checked_at is null;
alter table n2b_checks add column if not exists source text not null default 'auto';
create index if not exists job_rows_ca_checked on job_rows (ca_checked_at desc) where ca_checked_at is not null;

-- Switches set from the app, and what the worker runs with. ca_auto: the background
-- catch-all pass (off unless switched on). ca_config: the worker's no2bounce limits.
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists worker_status (
  id int primary key default 1,
  state text not null,                        -- running | idle | paused_daily_limit | error
  message text,
  heartbeat_at timestamptz not null default now()
);
alter table worker_status add column if not exists n2b_credits int;
alter table worker_status add column if not exists n2b_checked_at timestamptz;
`;
