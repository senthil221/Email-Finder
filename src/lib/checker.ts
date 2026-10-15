// Turns one MailTester call into a final outcome: cache, speed limit,
// daily budget, retries. Used by the engine as its `check` function.
import type { CheckOutcome, Checker } from "./engine";
import type { MtnCall, MtnClient } from "./mailtester";

/** Thrown to pause work (daily limit reached, job cancelled). Undecided people stay pending. */
export class PauseError extends Error {}
/** Thrown when MailTester refuses us (bad key, no credits). The worker stops. */
export class FatalError extends Error {}

export type CachedVerdict = "valid" | "invalid" | "catch_all" | "no_mx";

export type CheckerDeps = {
  mtn: MtnClient;
  /** Waits for a slot under the per-10-seconds speed limit. */
  rateLimit: () => Promise<void>;
  /** Reserves one check from today's budget; throws PauseError when used up. */
  spendBudget: () => Promise<void>;
  cacheGet: (email: string) => Promise<CachedVerdict | null>;
  /** Every real call is logged (audit + cache). */
  record: (email: string, call: MtnCall) => Promise<void>;
  /** Throws PauseError if the work should stop (e.g. job cancelled). */
  checkStop?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  maxRateLimitRetries?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createChecker(d: CheckerDeps): Checker {
  const sleep = d.sleep ?? defaultSleep;
  const retryDelay = d.retryDelayMs ?? 20_000;
  const maxRl = d.maxRateLimitRetries ?? 30;

  return async (email: string): Promise<CheckOutcome> => {
    const cached = await d.cacheGet(email);
    if (cached) return { verdict: cached, spent: 0 };

    let spent = 0;
    let retried = false;
    let rlHits = 0;
    for (;;) {
      if (d.checkStop) await d.checkStop();
      await d.spendBudget();
      await d.rateLimit();
      const call = await d.mtn(email);
      await d.record(email, call);

      if (call.verdict === "rate_limited") {
        // Our own speed limit talking, not a verdict: back off and retry the same address.
        rlHits++;
        if (rlHits > maxRl) return { verdict: "unverified", spent };
        await sleep(Math.min(60_000, 2_000 * rlHits));
        continue;
      }
      spent++;
      switch (call.verdict) {
        case "fatal":
          throw new FatalError(`MailTester refused the request: ${call.message || call.code}`);
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

/** Sliding-window limiter: at most `max` calls per `windowMs`. Shared by all workers in a process. */
export function createRateLimiter(max: number, windowMs: number, now = () => Date.now()) {
  const stamps: number[] = [];
  let chain: Promise<void> = Promise.resolve();
  return () => {
    const next = chain.then(async () => {
      for (;;) {
        const t = now();
        while (stamps.length && t - stamps[0] >= windowMs) stamps.shift();
        if (stamps.length < max) {
          stamps.push(t);
          return;
        }
        await defaultSleep(windowMs - (t - stamps[0]) + 5);
      }
    });
    chain = next.catch(() => {});
    return next;
  };
}
