// The worker loop: claim a company, process its pending people, release, repeat.
// Several companies run in parallel; MailTester calls share one speed limit
// and one daily budget.
import type { Db } from "@/lib/db";
import { processDomain } from "@/lib/engine";
import { createChecker, createRateLimiter, FatalError, PauseError } from "@/lib/checker";
import type { MtnClient } from "@/lib/mailtester";
import * as repo from "@/lib/repo";

export type WorkerOptions = {
  db: Db;
  mtn: MtnClient;
  concurrency?: number;
  rateMax?: number; // calls per window (Ultimate plan: 23 per 10s)
  rateWindowMs?: number;
  dailyLimit?: number;
  retryDelayMs?: number;
  batchSize?: number; // people per claim, so cancellations take effect quickly
  idleMs?: number;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Stop when the queue is empty (tests). */
  exitWhenIdle?: boolean;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function msUntilUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1);
  return next - now.getTime();
}

export function startWorker(o: WorkerOptions) {
  const db = o.db;
  const log = o.log ?? ((m: string) => console.log(`[worker ${new Date().toISOString()}] ${m}`));
  const sleep = o.sleep ?? realSleep;
  const dailyLimit = o.dailyLimit ?? 200_000;
  const rateLimit = createRateLimiter(o.rateMax ?? 23, o.rateWindowMs ?? 10_000);

  let stopping = false;
  let pauseUntil = 0;
  let pauseReason: "paused_daily_limit" | "error" | null = null;
  let pauseMessage: string | null = null;
  let busy = 0;

  // Daily budget, counted in memory and re-synced from the DB each new UTC day.
  let day = "";
  let used = 0;
  const spendBudget = async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = await repo.checksToday(db);
    }
    if (used >= dailyLimit) throw new PauseError(`daily limit of ${dailyLimit} reached`);
    used++;
  };

  const checker = createChecker({
    mtn: o.mtn,
    rateLimit,
    spendBudget,
    cacheGet: (email) => repo.cachedVerdict(db, email),
    record: (email, call) => repo.recordVerification(db, email, call),
    checkStop: async () => {
      if (stopping) throw new PauseError("shutting down");
      if (Date.now() < pauseUntil) throw new PauseError("paused");
    },
    sleep,
    retryDelayMs: o.retryDelayMs,
  });

  async function processOne(): Promise<boolean> {
    const state = await repo.claimDomain(db);
    if (!state) return false;
    busy++;
    const keepLock = setInterval(() => repo.extendLock(db, state.domain).catch(() => {}), 120_000);
    try {
      const people = await repo.pendingPeople(db, state.domain, o.batchSize ?? 50);
      const final = await processDomain({
        state,
        people,
        check: checker,
        onResult: (id, r) => repo.saveResult(db, id, r),
        onDomain: (s) => repo.saveDomain(db, s),
      });
      log(`${state.domain}: ${people.length} people -> domain ${final.status}${final.pattern ? ` (${final.pattern})` : ""}`);
    } catch (e) {
      if (e instanceof PauseError) {
        if (!stopping && /daily limit/.test(e.message) && Date.now() >= pauseUntil) {
          pauseUntil = Date.now() + msUntilUtcMidnight();
          pauseReason = "paused_daily_limit";
          pauseMessage = `${e.message}; resumes after midnight UTC`;
          log(pauseMessage);
        }
      } else if (e instanceof FatalError) {
        pauseUntil = Date.now() + 10 * 60_000;
        pauseReason = "error";
        pauseMessage = `${e.message} (retrying in 10 minutes)`;
        log(pauseMessage);
      } else {
        log(`error on ${state.domain}: ${(e as Error).stack ?? e}`);
      }
    } finally {
      clearInterval(keepLock);
      busy--;
      await repo.releaseDomain(db, state.domain).catch(() => {});
    }
    return true;
  }

  async function slot() {
    while (!stopping) {
      if (Date.now() < pauseUntil) {
        await sleep(Math.min(30_000, pauseUntil - Date.now()));
        continue;
      }
      let worked = false;
      try {
        worked = await processOne();
      } catch (e) {
        log(`claim failed: ${(e as Error).message}`);
      }
      if (!worked) {
        if (o.exitWhenIdle && busy === 0) return;
        await sleep(o.idleMs ?? 2_000);
      }
    }
  }

  const heartbeat = setInterval(() => {
    const state =
      Date.now() < pauseUntil && pauseReason ? pauseReason : busy > 0 ? "running" : "idle";
    const msg = Date.now() < pauseUntil ? pauseMessage : `${used} checks used today (limit ${dailyLimit})`;
    repo.setWorkerStatus(db, state, msg).catch(() => {});
  }, 5_000);

  const slots = Array.from({ length: o.concurrency ?? 12 }, () => slot());
  const done = Promise.all(slots).finally(() => clearInterval(heartbeat));

  return {
    done,
    stop: async () => {
      stopping = true;
      await done;
      await repo.setWorkerStatus(db, "stopped", null).catch(() => {});
    },
  };
}
