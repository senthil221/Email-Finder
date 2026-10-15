// Turns one MailTester call into a final outcome: cache, speed limit,
// daily budget, retries. Used by the engine as its `check` function.
import type { CheckOutcome, Checker } from "./engine";
import type { MtnCall, MtnClient } from "./mailtester";

/** Thrown to pause work (daily limit reached, job cancelled). Undecided people stay pending. */
export class PauseError extends Error {}
/** Thrown when MailTester refuses us (bad key, no credits). The worker pauses for `pauseMs`. */
export class FatalError extends Error {
  constructor(message: string, readonly pauseMs = 3_600_000) {
    super(message);
  }
}

export type CachedVerdict = "valid" | "invalid" | "catch_all" | "no_mx";

export type CheckerDeps = {
  mtn: MtnClient;
  /** Waits for a slot under the speed limit (and any provider pause). */
  rateLimit: () => Promise<void>;
  /** Pause ALL MailTester calls for this long (429, outage, repeated network failures). */
  pauseProvider?: (ms: number) => void;
  /** Reserves one check from today's budget; throws PauseError when used up. */
  spendBudget: () => Promise<void>;
  cacheGet: (email: string) => Promise<CachedVerdict | null>;
  /** Every real call is logged (audit + cache). */
  record: (email: string, call: MtnCall, pattern?: string) => Promise<void>;
  /** Throws PauseError if the work should stop (e.g. job cancelled). */
  checkStop?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  maxRateLimitRetries?: number;
  /** Network/protocol failures in a row (across all checks) that open the circuit. */
  circuitAfter?: number;
  circuitPauseMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createChecker(d: CheckerDeps): Checker {
  const sleep = d.sleep ?? defaultSleep;
  const retryDelay = d.retryDelayMs ?? 20_000;
  const maxRl = d.maxRateLimitRetries ?? 30;
  const circuitAfter = d.circuitAfter ?? 5;
  const pause = d.pauseProvider ?? (() => {});
  let transportStreak = 0; // shared by every check this worker makes

  return async (email: string, pattern?: string): Promise<CheckOutcome> => {
    const cached = await d.cacheGet(email);
    if (cached) return { verdict: cached, spent: 0 };

    let spent = 0;
    let retried = false;
    let transportRetries = 0;
    let rlHits = 0;
    for (;;) {
      if (d.checkStop) await d.checkStop();
      await d.spendBudget();
      await d.rateLimit();
      const call = await d.mtn(email);
      await d.record(email, call, pattern);

      if (call.pauseMs) pause(call.pauseMs);
      if (call.verdict === "rate_limited") {
        // Our own speed limit talking, not a verdict: everyone waits, then retry the same address.
        rlHits++;
        if (rlHits > maxRl) return { verdict: "unverified", spent };
        continue;
      }
      spent++;

      if (call.transportFailure) {
        // Never a verdict about the address: retry (up to 3 times), and open the
        // circuit if MailTester keeps failing for everyone.
        transportStreak++;
        if (transportStreak >= circuitAfter) {
          pause(d.circuitPauseMs ?? 300_000);
          transportStreak = 0;
        }
        if (transportRetries >= 3) return { verdict: "unverified", spent };
        transportRetries++;
        await sleep(Math.min(60_000, 1_000 * 2 ** transportRetries));
        continue;
      }
      transportStreak = 0;

      switch (call.verdict) {
        case "fatal":
          throw new FatalError(`MailTester refused the request: ${call.message || call.code}`, call.pauseMs);
        case "valid":
        case "invalid":
        case "catch_all":
        case "no_mx":
          return { verdict: call.verdict, spent };
        case "retry":
          if (retried) return { verdict: "unverified", spent };
          retried = true;
          await sleep(retryDelay);
          continue;
      }
    }
  };
}

/**
 * Pacing for all MailTester calls in this process, matching what Prospect Sync
 * measured on the same plan: at most `max` starts per `windowMs` (22 per 10s)
 * AND at least `minSpacingMs` between starts (450ms), so calls never burst.
 * `pause(ms)` holds every caller (HTTP 429 cooldown, outage, circuit).
 */
export function createProviderGate(
  o: { max: number; windowMs: number; minSpacingMs?: number },
  now = () => Date.now(),
) {
  const stamps: number[] = [];
  const spacing = o.minSpacingMs ?? 0;
  let pausedUntil = 0;
  let chain: Promise<void> = Promise.resolve();

  const take = () => {
    const next = chain.then(async () => {
      for (;;) {
        const t = now();
        if (t < pausedUntil) {
          await defaultSleep(pausedUntil - t);
          continue;
        }
        while (stamps.length && t - stamps[0] >= o.windowMs) stamps.shift();
        if (stamps.length >= o.max) {
          await defaultSleep(o.windowMs - (t - stamps[0]) + 5);
          continue;
        }
        const last = stamps[stamps.length - 1];
        if (last !== undefined && t - last < spacing) {
          await defaultSleep(spacing - (t - last));
          continue;
        }
        stamps.push(t);
        return;
      }
    });
    chain = next.catch(() => {});
    return next;
  };
  const pause = (ms: number) => {
    pausedUntil = Math.max(pausedUntil, now() + ms);
  };
  return { take, pause, pausedUntil: () => pausedUntil };
}
