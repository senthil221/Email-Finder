export const STATUS_LABEL: Record<string, string> = {
  found: "Found",
  valid: "Valid",
  catch_all: "Catch-all",
  not_found: "Not found",
  invalid: "Rejected",
  no_mx: "No mail server",
  unverified: "Unverified",
  retry: "Retrying",
  rate_limited: "Rate limited",
  fatal: "Account error",
  pending: "Pending",
  queued: "Queued",
  skipped: "Skipped",
  invalid_input: "Invalid input",
  running: "Running",
  uploading: "Uploading",
  cancelled: "Stopped",
  done: "Done",
  unknown: "Not checked",
  idle: "Idle",
  paused_daily_limit: "Daily limit",
  error: "Error",
  offline: "Offline",
  stopped: "Stopped",
};

export const REASON_LABEL: Record<string, string> = {
  all_rejected: "Every combination was rejected",
  probably_left: "Probably left: company pattern works, this person rejected",
  catch_all: "Server accepts every address",
  no_mx: "Domain cannot receive email",
  domain_parked: "Skipped (older run): 2 people here had no match",
  some_unverifiable: "Some combinations could not be checked",
  server_unreachable: "Skipped: mail server kept timing out",
  bad_input: "Missing first name or domain",
  website: "Found on the company website",
};

export const PATTERN_LABEL: Record<string, string> = {
  first: "first@",
  "first.last": "first.last@",
  firstlast: "firstlast@",
  flast: "flast@",
  firstl: "firstl@",
  "first.l": "first.l@",
  first_last: "first_last@",
  fl: "fl@",
  "f.last": "f.last@",
  "first1.first2": "first1.first2@",
  first1: "first1@",
  "first1.last": "first1.last@",
  "last.first": "last.first@",
  "first-last": "first-last@",
  lastfirst: "lastfirst@",
  "last.f": "last.f@",
  lastf: "lastf@",
  last: "last@",
};

export function jobState(job: { status: string; pending: number }): string {
  if (job.status === "running" && job.pending === 0) return "done";
  return job.status === "running" ? "running" : job.status;
}

export function fmtDate(s: string): string {
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtEta(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "–";
  if (min < 1) return "< 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${Math.round(min - h * 60)}m`;
}

export function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

export const n = (v: number) => v.toLocaleString();
