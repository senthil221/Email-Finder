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

create table if not exists verifications (
  id bigserial primary key,
  email text not null,
  verdict text not null,                      -- valid | invalid | catch_all | no_mx | retry | rate_limited | fatal
  code text,
  message text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists verifications_email on verifications (email, created_at desc);
create index if not exists verifications_created on verifications (created_at);

create table if not exists worker_status (
  id int primary key default 1,
  state text not null,                        -- running | idle | paused_daily_limit | error
  message text,
  heartbeat_at timestamptz not null default now()
);
`;
