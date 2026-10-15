export const STATUS_LABEL: Record<string, string> = {
  found: "Found",
  catch_all: "Catch-all",
  not_found: "Not found",
  unverified: "Unverified",
  pending: "Pending",
  invalid_input: "Invalid input",
  running: "Running",
  uploading: "Uploading",
  cancelled: "Cancelled",
  done: "Done",
};

export const REASON_LABEL: Record<string, string> = {
  all_rejected: "Every combination was rejected",
  catch_all: "Company server accepts every address",
  no_mx: "Domain cannot receive email",
  domain_parked: "Skipped: 2 people at this company had no match",
  some_unverifiable: "Some combinations could not be checked",
  server_unreachable: "Skipped: company mail server kept timing out",
  bad_input: "Missing first name or domain",
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
};

export function jobState(job: { status: string; pending: number }): string {
  if (job.status === "running" && job.pending === 0) return "done";
  return job.status === "running" ? "pending" : job.status;
}

export function fmtDate(s: string): string {
  return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const n = (v: number) => v.toLocaleString();
