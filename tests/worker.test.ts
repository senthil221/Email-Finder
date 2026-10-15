// End-to-end: real SQL on an in-memory Postgres (PGlite), fake MailTester.
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { startWorker } from "@/worker/run";
import type { MtnCall, Verdict } from "@/lib/mailtester";

async function memDb(): Promise<Db> {
  const pg = new PGlite();
  return {
    async query<T>(text: string, params?: unknown[]) {
      if (!params || params.length === 0) {
        const results = await pg.exec(text);
        return (results.at(-1)?.rows ?? []) as T[];
      }
      return (await pg.query<T>(text, params)).rows;
    },
  };
}

function fakeMtn(world: { catchAll: string[]; noMx: string[]; boxes: string[]; flaky?: string[] }) {
  const calls: string[] = [];
  const flakyLeft = new Set(world.flaky ?? []);
  const mtn = async (email: string): Promise<MtnCall> => {
    calls.push(email);
    const domain = email.split("@")[1];
    let verdict: Verdict = "invalid";
    if (flakyLeft.has(email)) {
      flakyLeft.delete(email);
      verdict = "retry";
    } else if (world.noMx.includes(domain)) verdict = "no_mx";
    else if (world.catchAll.includes(domain)) verdict = "catch_all";
    else if (world.boxes.includes(email)) verdict = "valid";
    return { verdict, message: verdict, code: "", raw: { email } };
  };
  return { mtn, calls };
}

// Yields to the event loop (a no-op sleep would spin the loop forever).
const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 5)));

const row = (first: string, last: string, domain: string) => ({
  first,
  last,
  domain,
  input: { "First Name": first, "Last Name": last, Website: domain },
});

describe("worker on a real schema", () => {
  it("processes a bulk job end to end", async () => {
    const db = await memDb();
    await repo.migrate(db);
    await repo.migrate(db); // idempotent

    const jobId = await repo.createJob(db, { name: "test", columns: ["First Name", "Last Name", "Website"] });
    const added = await repo.addRows(db, jobId, 1, [
      row("Senthil", "Nathan", "https://www.b2bdrive.net/"),
      row("Ravi", "Kumar", "b2bdrive.net"),
      row("Ravi", "Kumar", "B2BDrive.net"), // duplicate
      row("Anu", "Priya", "bigcorp.com"),
      row("Raj", "Mehta", "bigcorp.com"),
      row("Old", "Co", "deadco.com"),
      row("", "NoFirst", "x.com"), // bad input
    ]);
    expect(added).toEqual({ inserted: 6, duplicates: 1, invalid: 1 });
    await repo.setJobStatus(db, jobId, "running");

    const { mtn, calls } = fakeMtn({
      catchAll: ["bigcorp.com"],
      noMx: ["deadco.com"],
      boxes: ["senthil.nathan@b2bdrive.net", "ravi.kumar@b2bdrive.net"],
      flaky: ["senthil@b2bdrive.net"],
    });
    const w = startWorker({ db, mtn, concurrency: 3, rateMax: 1000, minSpacingMs: 0, idleMs: 5, exitWhenIdle: true, sleep: tick, log: () => {} });
    await w.done;

    const rows = await repo.listRows(db, jobId);
    const byName = Object.fromEntries(rows.map((r) => [r.first || "(blank)", r]));
    expect(byName.senthil).toMatchObject({ status: "found", email: "senthil.nathan@b2bdrive.net", checks_used: 3 });
    expect(byName.ravi).toMatchObject({ status: "found", email: "ravi.kumar@b2bdrive.net", checks_used: 1 });
    expect(byName.anu.status).toBe("catch_all");
    expect(byName.raj.status).toBe("catch_all");
    expect(byName.old).toMatchObject({ status: "not_found", reason: "no_mx" });
    expect(byName["(blank)"]).toMatchObject({ status: "invalid_input" });

    // bigcorp: one check for two people. deadco: one check.
    expect(calls.filter((c) => c.endsWith("@bigcorp.com"))).toHaveLength(1);

    const job = await repo.getJob(db, jobId);
    expect(job).toMatchObject({ total: 6, pending: 0, found: 2, catch_all: 2, not_found: 1, invalid_input: 1 });

    const dom = await repo.getDomain(db, "b2bdrive.net");
    expect(dom).toMatchObject({ status: "valid", pattern: "first.last" });
    expect(await repo.checksLast24h(db)).toBe(calls.length);

    // A second upload with the same company starts on the saved pattern and uses the cache.
    const job2 = await repo.createJob(db, { name: "again" });
    await repo.addRows(db, job2, 1, [row("Ravi", "Kumar", "b2bdrive.net"), row("Anu", "Priya", "bigcorp.com")]);
    await repo.setJobStatus(db, job2, "running");
    const before = calls.length;
    await startWorker({ db, mtn, concurrency: 2, rateMax: 1000, minSpacingMs: 0, idleMs: 5, exitWhenIdle: true, sleep: tick, log: () => {} }).done;
    expect(calls.length).toBe(before); // cache + fresh catch-all verdict: zero new checks
    expect(await repo.getJob(db, job2)).toMatchObject({ found: 1, catch_all: 1, pending: 0 });
  });

  it("skips cancelled jobs and pauses at the daily limit", async () => {
    const db = await memDb();
    await repo.migrate(db);
    const cancelled = await repo.createJob(db, { name: "cancelled" });
    await repo.addRows(db, cancelled, 1, [row("A", "B", "one.com")]);
    await repo.setJobStatus(db, cancelled, "cancelled");

    const limited = await repo.createJob(db, { name: "limited" });
    await repo.addRows(db, limited, 1, [row("Andrew", "Deepak", "two.com")]);
    await repo.setJobStatus(db, limited, "running");

    const { mtn, calls } = fakeMtn({ catchAll: [], noMx: [], boxes: [] });
    const w = startWorker({ db, mtn, concurrency: 1, rateMax: 1000, minSpacingMs: 0, dailyLimit: 3, idleMs: 5, sleep: tick, log: () => {} });
    // Give it a moment, then stop.
    await new Promise((r) => setTimeout(r, 300));
    await w.stop();

    expect(calls.every((c) => c.endsWith("@two.com"))).toBe(true);
    expect(calls).toHaveLength(3);
    const job = await repo.getJob(db, limited);
    expect(job?.pending).toBe(1); // person stays pending until tomorrow
    expect((await repo.getWorkerStatus(db))?.state).toBe("stopped");
  });
});

describe("live views on a real schema", () => {
  it("ladder, overview, lookups and domains reflect what the worker did", async () => {
    const { lookupDetail, overview, listLookups, listDomains, recentVerifications } = await import("@/lib/views");
    const db = await memDb();
    await repo.migrate(db);
    const id = await repo.createJob(db, { name: "Senthil Nathan @ b2bdrive.net", kind: "single", priority: 10 });
    await repo.addRows(db, id, 1, [row("Senthil", "Nathan", "b2bdrive.net")]);
    await repo.setJobStatus(db, id, "running");
    const { mtn } = fakeMtn({ catchAll: [], noMx: [], boxes: ["senthil.nathan@b2bdrive.net"] });
    await startWorker({ db, mtn, concurrency: 1, rateMax: 1000, minSpacingMs: 0, idleMs: 5, exitWhenIdle: true, sleep: tick, log: () => {} }).done;

    const d = await lookupDetail(db, id);
    expect(d?.lookup).toMatchObject({ status: "found", email: "senthil.nathan@b2bdrive.net" });
    expect(d?.steps.slice(0, 3).map((s) => s.state)).toEqual(["invalid", "valid", "skipped"]);
    expect(d?.steps[1].email).toBe("senthil.nathan@b2bdrive.net");
    expect(d?.domain).toMatchObject({ status: "valid", pattern: "first.last" });

    const ov = await overview(db);
    expect(ov).toMatchObject({ checks24h: 2, found24h: 1, provenDomains: 1 });
    expect(ov.totals.found).toBe(1);
    expect(ov.patterns).toEqual([{ pattern: "first.last", n: 1 }]);
    expect((await listLookups(db)).total).toBe(1);
    expect((await listDomains(db, { status: "valid" })).rows[0]).toMatchObject({ domain: "b2bdrive.net", people: 1, found: 1 });
    expect(await recentVerifications(db, 5)).toHaveLength(2);
  });
});
