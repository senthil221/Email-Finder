// Per-company logic: scout first, reuse the proven pattern, park catch-alls.
import { candidates, type PatternId } from "./patterns";

export type DomainStatus = "unknown" | "valid" | "catch_all" | "not_found" | "no_mx";

export type DomainState = {
  domain: string;
  status: DomainStatus;
  pattern: PatternId | null;
  checkedAt: Date | null;
};

export type Person = { id: string; first: string; last: string };

export type PersonStatus = "found" | "catch_all" | "not_found" | "unverified";

export type Reason =
  | "all_rejected" // every combination was rejected
  | "catch_all" // company server accepts everything
  | "no_mx" // domain cannot receive mail
  | "domain_parked" // 2 scouts failed: probably the wrong mail domain
  | "some_unverifiable" // some combinations could not be checked (timeouts, blocks)
  | "server_unreachable" // 2 people in a row hit a server that kept timing out
  | "bad_input";

export type PersonResult = {
  status: PersonStatus;
  email: string | null;
  pattern: PatternId | null;
  reason: Reason | null;
  checksUsed: number;
};

/** What one address check came back as, after retries. `spent` = a real MailTester call was used. */
export type CheckOutcome = {
  verdict: "valid" | "invalid" | "catch_all" | "no_mx" | "unverified";
  spent: number;
};

export type Checker = (email: string) => Promise<CheckOutcome>;

export const STALE_DAYS = 60;
export const MAX_FAILED_SCOUTS = 2;
/** Stop a person after this many unverifiable answers in a row with no rejection yet. */
export const MAX_STUCK_IN_A_ROW = 3;

function isFresh(state: DomainState, now: Date): boolean {
  if (!state.checkedAt) return false;
  return now.getTime() - state.checkedAt.getTime() < STALE_DAYS * 86_400_000;
}

const parked = (reason: Reason, status: PersonStatus = "not_found"): PersonResult => ({
  status,
  email: null,
  pattern: null,
  reason,
  checksUsed: 0,
});

/** Try one person's combinations one at a time; stop at the first valid. */
export async function findPerson(
  person: Person,
  domain: string,
  preferred: PatternId | null,
  check: Checker,
): Promise<PersonResult> {
  const list = candidates(person.first, person.last, domain, preferred);
  if (list.length === 0) return parked("bad_input");
  let used = 0;
  let stuck = 0;
  let rejected = 0;
  for (const c of list) {
    const r = await check(c.email);
    used += r.spent;
    switch (r.verdict) {
      case "valid":
        return { status: "found", email: c.email, pattern: c.pattern, reason: null, checksUsed: used };
      case "catch_all":
        return { status: "catch_all", email: null, pattern: null, reason: "catch_all", checksUsed: used };
      case "no_mx":
        return { status: "not_found", email: null, pattern: null, reason: "no_mx", checksUsed: used };
      case "unverified":
        stuck++;
        break;
      case "invalid":
        rejected++;
        break;
    }
    // The server is not answering at all: stop spending on this person.
    if (rejected === 0 && stuck >= MAX_STUCK_IN_A_ROW) break;
  }
  return stuck > 0
    ? { status: "unverified", email: null, pattern: null, reason: "some_unverifiable", checksUsed: used }
    : { status: "not_found", email: null, pattern: null, reason: "all_rejected", checksUsed: used };
}

/**
 * Process every pending person at one company, one check at a time.
 * `onResult` is called as soon as each person is decided, `onDomain` whenever
 * the company's state changes. If `check` throws (daily limit, fatal key error,
 * job cancelled) the error propagates and undecided people stay pending.
 */
export async function processDomain(args: {
  state: DomainState;
  people: Person[];
  check: Checker;
  onResult: (personId: string, result: PersonResult) => Promise<void>;
  onDomain: (state: DomainState) => Promise<void>;
  now?: () => Date;
}): Promise<DomainState> {
  const now = args.now ?? (() => new Date());
  let state = { ...args.state };
  const setState = async (patch: Partial<DomainState>) => {
    state = { ...state, ...patch, checkedAt: now() };
    await args.onDomain(state);
  };

  // A catch-all / no-MX / parked verdict older than STALE_DAYS gets re-checked.
  // A fresh one parks everyone below without spending checks.
  if (state.status !== "valid" && state.status !== "unknown" && !isFresh(state, now())) {
    state = { ...state, status: "unknown" };
  }

  let failedScouts = 0;
  let stuckScouts = 0;
  for (const person of args.people) {
    if (failedScouts + stuckScouts >= MAX_FAILED_SCOUTS && state.status === "unknown") {
      // Not proven wrong, just unreachable right now: skip without remembering it,
      // so a later upload tries this company again.
      await args.onResult(person.id, parked("server_unreachable", "unverified"));
      continue;
    }
    if (state.status === "catch_all") {
      await args.onResult(person.id, parked("catch_all", "catch_all"));
      continue;
    }
    if (state.status === "no_mx") {
      await args.onResult(person.id, parked("no_mx"));
      continue;
    }
    if (state.status === "not_found") {
      await args.onResult(person.id, parked("domain_parked"));
      continue;
    }

    const known = state.status === "valid" ? state.pattern : null;
    const r = await findPerson(person, state.domain, known, args.check);
    await args.onResult(person.id, r);

    if (r.status === "found") {
      // First win proves the domain and sets the company style for everyone after.
      if (state.status !== "valid") await setState({ status: "valid", pattern: r.pattern });
    } else if (r.status === "catch_all") {
      await setState({ status: "catch_all", pattern: null });
    } else if (r.reason === "no_mx") {
      await setState({ status: "no_mx", pattern: null });
    } else if (state.status === "unknown" && r.reason !== "bad_input") {
      // A scout that did not find anything.
      if (r.status === "unverified") stuckScouts++;
      else failedScouts++;
      if (failedScouts >= MAX_FAILED_SCOUTS) await setState({ status: "not_found", pattern: null });
    }
  }
  return state;
}
