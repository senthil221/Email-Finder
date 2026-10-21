// Per-company logic: scout first, reuse the proven pattern, park catch-alls.
import { candidates, type PatternId } from "./patterns";

export type DomainStatus = "unknown" | "valid" | "catch_all" | "not_found" | "no_mx";

export type DomainState = {
  domain: string;
  status: DomainStatus;
  pattern: PatternId | null;
  checkedAt: Date | null;
  /** When DNS last showed an MX record (free check, so MailTester is not asked about dead domains). */
  mxCheckedAt?: Date | null;
  /** Where people go when this domain fails: website redirect or .in/.com/.co.in twin. */
  alt?: string | null;
  altCheckedAt?: Date | null;
};

/** `movedFrom` is set once a person was restarted on an alternate domain (it only happens once). */
export type Person = { id: string; first: string; last: string; movedFrom?: string | null };

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

/** `pattern` is which of the 9 combinations this address is (logged for the Insights page). */
export type Checker = (email: string, pattern?: string) => Promise<CheckOutcome>;

export const STALE_DAYS = 60;
/** DNS answers (MX present, alternate domain) are re-checked after this many days. */
export const DNS_FRESH_DAYS = 7;
export const MAX_FAILED_SCOUTS = 2;
/** Stop a person after this many unverifiable answers in a row with no rejection yet. */
export const MAX_STUCK_IN_A_ROW = 3;

function freshAt(at: Date | null | undefined, days: number, now: Date): boolean {
  return !!at && now.getTime() - at.getTime() < days * 86_400_000;
}

const isFresh = (state: DomainState, now: Date) => freshAt(state.checkedAt, STALE_DAYS, now);

const parked = (reason: Reason, status: PersonStatus = "not_found"): PersonResult => ({
  status,
  email: null,
  pattern: null,
  reason,
  checksUsed: 0,
});

/** Try one person's combinations one at a time; stop at the first valid. */
/**
 * Patterns that use both the first and the last name. On an alternate domain
 * (a .in/.com twin can be a different company) only these count: "amit@" at
 * someone else's company is likely another Amit, "amit.shah@" almost never is.
 */
export const FULL_NAME_PATTERNS = new Set<PatternId>(["first.last", "firstlast", "first_last", "flast", "f.last", "first1.last"]);

export async function findPerson(
  person: Person,
  domain: string,
  preferred: PatternId | null,
  check: Checker,
  opts: { fullNameOnly?: boolean } = {},
): Promise<PersonResult> {
  const all = candidates(person.first, person.last, domain, preferred);
  const list = opts.fullNameOnly ? all.filter((c) => FULL_NAME_PATTERNS.has(c.pattern)) : all;
  if (list.length === 0) return parked(all.length ? "all_rejected" : "bad_input"); // no surname to try on the other domain
  let used = 0;
  let stuck = 0;
  let rejected = 0;
  for (const c of list) {
    const r = await check(c.email, c.pattern);
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
  /** Free DNS lookup: true = has MX, false = none, null = could not tell. */
  mx?: (domain: string) => Promise<boolean | null>;
  /** Free lookup of another mail domain for this company (redirect or twin), null if none. */
  findAlternate?: (domain: string) => Promise<string | null>;
  /** Restart a person on another domain: they go back to pending there. */
  onMove?: (personId: string, domain: string, checksUsed: number) => Promise<void>;
  now?: () => Date;
}): Promise<DomainState> {
  const now = args.now ?? (() => new Date());
  let state = { ...args.state };
  const patchState = async (patch: Partial<DomainState>) => {
    state = { ...state, ...patch };
    await args.onDomain(state);
  };
  const setState = (patch: Partial<DomainState>) => patchState({ ...patch, checkedAt: now() });

  // A catch-all / no-MX / parked verdict older than STALE_DAYS gets re-checked.
  // A fresh one parks everyone below without spending checks.
  if (state.status !== "valid" && state.status !== "unknown" && !isFresh(state, now())) {
    state = { ...state, status: "unknown" };
  }

  // Before spending anything on an unproven company: does it have an MX record at all?
  if (state.status === "unknown" && args.mx && !freshAt(state.mxCheckedAt, DNS_FRESH_DAYS, now())) {
    const hasMx = await args.mx(state.domain);
    if (hasMx === false) await setState({ status: "no_mx", pattern: null });
    else if (hasMx === true) await patchState({ mxCheckedAt: now() });
  }

  const alternate = async (): Promise<string | null> => {
    if (!args.findAlternate) return null;
    if (!freshAt(state.altCheckedAt, DNS_FRESH_DAYS, now())) {
      let alt: string | null;
      try {
        alt = await args.findAlternate(state.domain);
      } catch {
        return null; // not remembered: try again next time
      }
      await patchState({ alt: alt && alt !== state.domain ? alt : null, altCheckedAt: now() });
    }
    return state.alt ?? null;
  };
  /** Restart a person on the company's other domain, once. False if there is none. */
  const moveAway = async (person: Person, checksUsed: number): Promise<boolean> => {
    if (person.movedFrom || !args.onMove) return false;
    const alt = await alternate();
    if (!alt) return false;
    await args.onMove(person.id, alt, checksUsed);
    return true;
  };

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
      if (!(await moveAway(person, 0))) await args.onResult(person.id, parked("no_mx"));
      continue;
    }
    if (state.status === "not_found") {
      if (!(await moveAway(person, 0))) await args.onResult(person.id, parked("domain_parked"));
      continue;
    }

    const known = state.status === "valid" ? state.pattern : null;
    const r = await findPerson(person, state.domain, known, args.check, { fullNameOnly: !!person.movedFrom });
    // Rejected everywhere on a company not proven yet: maybe the wrong domain.
    const wrongDomain =
      r.status === "not_found" && (r.reason === "no_mx" || (r.reason === "all_rejected" && state.status !== "valid"));
    if (!(wrongDomain && (await moveAway(person, r.checksUsed)))) await args.onResult(person.id, r);

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
