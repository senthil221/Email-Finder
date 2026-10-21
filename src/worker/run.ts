// The worker loop: claim a company, process its pending people, release, repeat.
// Several companies run in parallel; MailTester calls share one speed limit
// and one daily budget.
import type { Db } from "@/lib/db";
import { processDomain } from "@/lib/engine";
import { createChecker, createProviderGate, FatalError, PauseError } from "@/lib/checker";
import { findAlternateDomain, type DnsDeps } from "@/lib/dns";
import { loadLadder, type LadderInfo } from "@/lib/ladder";
import type { MtnClient } from "@/lib/mailtester";
import * as repo from "@/lib/repo";

export type WorkerOptions = {
  db: Db;
  mtn: MtnClient;
  /** Free DNS checks (MX pre-check, alternate domain). Off when not given (tests). */
  dns?: DnsDeps;
  /** Rank and cap the base patterns from your own finds (refreshed every 30 minutes). Off in tests. */
  smartLadder?: boolean;
  concurrency?: number;
  // Pace measured by Prospect Sync on the Ultimate plan: 22 starts per 10s,
  // 450ms apart (25 per 10s got HTTP 429 within minutes).
  rateMax?: number;
  rateWindowMs?: number;
  minSpacingMs?: number;
  dailyLimit?: number; // MailTester calls per rolling 24 hours, retries included
  retryDelayMs?: number;
  batchSize?: number; // people per claim, so cancellations take effect quickly
  idleMs?: number;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Stop when the queue is empty (tests). */
  exitWhenIdle?: boolean;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


export function startWorker(o: WorkerOptions) {
  const db = o.db;
  const log = o.log ?? ((m: string) => console.log(`[worker ${new Date().toISOString()}] ${m}`));
  const sleep = o.sleep ?? realSleep;
  const dns = o.dns;
  let ladder: LadderInfo | undefined;
  let ladderAt = 0;
  const currentLadder = async () => {
    if (o.smartLadder && Date.now() - ladderAt > 30 * 60_000) {
      ladderAt = Date.now();
      try {
        ladder = await loadLadder(db);
        log(`ladder (${ladder.source}, ${ladder.finds} finds, cap ${ladder.cap || "none"}): ${ladder.order.join(" > ")}`);
      } catch (e) {
        log(`ladder refresh failed, keeping the previous one: ${(e as Error).message}`);
      }
    }
    return ladder;
  };
  const dailyLimit = o.dailyLimit ?? 190_000;
  const gate = createProviderGate({
    max: o.rateMax ?? 22,
    windowMs: o.rateWindowMs ?? 10_000,
    minSpacingMs: o.minSpacingMs ?? 450,
  });

  let stopping = false;
  let pauseUntil = 0;
  let pauseReason: "paused_daily_limit" | "error" | null = null;
  let pauseMessage: string | null = null;
  let busy = 0;

  // Budget over a rolling 24 hours (like MailTester's own quota): counted in
  // memory, re-synced from the verifications log every minute.
  let used = 0;
  let syncedAt = 0;
  const spendBudget = async () => {
    if (Date.now() - syncedAt > 60_000) {
      used = await repo.checksLast24h(db);
      syncedAt = Date.now();
    }
    if (used >= dailyLimit) throw new PauseError(`daily limit of ${dailyLimit} checks per 24 hours reached`);
    used++;
  };

  const checker = createChecker({
    mtn: o.mtn,
    rateLimit: gate.take,
    pauseProvider: (ms) => {
      gate.pause(ms);
      if (ms >= 60_000) log(`MailTester paused for ${Math.round(ms / 1000)}s`);
    },
    spendBudget,
    cacheGet: (email) => repo.cachedVerdict(db, email),
    record: (email, call, pattern) => repo.recordVerification(db, email, call, pattern),
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
        ladder: await currentLadder(),
        onResult: (id, r) => repo.saveResult(db, id, r),
        onDomain: (s) => repo.saveDomain(db, s),
        ...(dns && {
          mx: async (d: string) => {
            const a = await dns.mx(d);
            return a === "error" ? null : a === "mx";
          },
          findAlternate: (d: string) =>
            findAlternateDomain(d, dns, async (alt) => !(await repo.isDeadDomain(db, alt))),
          onMove: async (id: string, alt: string, used: number) => {
            await repo.movePerson(db, id, alt, used);
            log(`${state.domain}: moved a person to ${alt}`);
          },
        }),
      });
      log(`${state.domain}: ${people.length} people -> domain ${final.status}${final.pattern ? ` (${final.pattern})` : ""}`);
    } catch (e) {
      if (e instanceof PauseError) {
        if (!stopping && /daily limit/.test(e.message) && Date.now() >= pauseUntil) {
          // The rolling window frees up gradually; look again in 10 minutes.
          pauseUntil = Date.now() + 10 * 60_000;
          syncedAt = 0;
          pauseReason = "paused_daily_limit";
          pauseMessage = `${e.message}; checking again every 10 minutes`;
          log(pauseMessage);
        }
      } else if (e instanceof FatalError) {
        pauseUntil = Date.now() + e.pauseMs;
        gate.pause(e.pauseMs);
        pauseReason = "error";
        pauseMessage = `${e.message} (retrying in ${Math.round(e.pauseMs / 60_000)} minutes)`;
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
    const msg = Date.now() < pauseUntil ? pauseMessage : `${used} checks in the last 24 hours (limit ${dailyLimit})`;
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
