// End-to-end: real SQL on an in-memory Postgres (PGlite), fake MailTester.
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { startWorker } from "@/worker/run";
import type { MtnCall, Verdict } from "@/lib/mailtester";
import type { DnsDeps } from "@/lib/dns";

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

describe("free DNS steps on a real schema", () => {
  it("no-MX domains cost nothing, wrong domains move once to the twin, Indian names get extras", async () => {
    const db = await memDb();
    await repo.migrate(db);
    const jobId = await repo.createJob(db, { name: "dns" });
    await repo.addRows(db, jobId, 1, [
      row("Old", "Co", "nomail.in"), // no MX anywhere
      row("Ravi", "Kumar", "parked.in"), // MX, but the company uses parked.com
      row("Dr. Senthil Nathan", "S I", "b2b.in"),
    ]);
    await repo.setJobStatus(db, jobId, "running");

    const mxAsked: string[] = [];
    const withMx = new Set(["parked.in", "parked.com", "b2b.in"]);
    const dns: DnsDeps = {
      mx: async (d) => (mxAsked.push(d), withMx.has(d) ? "mx" : "none"),
      redirect: async () => null,
    };
    const { mtn, calls } = fakeMtn({
      catchAll: [],
      noMx: [],
      boxes: ["ravi.kumar@parked.com", "senthil.nathan@b2b.in"],
    });
    await startWorker({ db, mtn, dns, concurrency: 2, rateMax: 1000, minSpacingMs: 0, idleMs: 5, exitWhenIdle: true, sleep: tick, log: () => {} }).done;

    const rows = await repo.listRows(db, jobId);
    const by = Object.fromEntries(rows.map((r) => [r.first, r]));
    expect(by.old).toMatchObject({ status: "not_found", reason: "no_mx", checks_used: 0 });
    expect(calls.some((c) => c.includes("nomail"))).toBe(false);
    expect(by.ravi).toMatchObject({ status: "found", email: "ravi.kumar@parked.com", domain: "parked.com", checks_used: 10 }); // ravi@ is skipped on the twin domain
    expect(by["dr senthil nathan"]).toMatchObject({ status: "found", email: "senthil.nathan@b2b.in", pattern: "first1.first2" });

    const [moved] = await db.query<{ moved_from: string }>(`select moved_from from job_rows where first = 'ravi'`);
    expect(moved.moved_from).toBe("parked.in");
    expect(await repo.getDomain(db, "nomail.in")).toMatchObject({ status: "no_mx", mxCheckedAt: null, alt: null });
    const parked = await repo.getDomain(db, "parked.in");
    expect(parked).toMatchObject({ status: "unknown", alt: "parked.com" });
    expect(parked?.mxCheckedAt).toBeInstanceOf(Date);
    expect(await repo.getDomain(db, "parked.com")).toMatchObject({ status: "valid", pattern: "first.last" });

    // Every check still logs its pattern for the Insights page.
    const logged = await db.query<{ email: string; pattern: string | null }>(`select email, pattern from verifications`);
    expect(logged.every((v) => v.pattern)).toBe(true);
    expect(logged.find((v) => v.email === "senthil.nathan@b2b.in")?.pattern).toBe("first1.first2");
    expect(mxAsked.filter((d) => d === "parked.in")).toHaveLength(1);
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

    // Insights: every check is logged with its pattern.
    const { insights } = await import("@/lib/views");
    const ins = await insights(db, "7d");
    const fl = ins.patterns.find((p) => p.pattern === "first.last");
    const first = ins.patterns.find((p) => p.pattern === "first");
    expect(fl).toMatchObject({ tried: 1, accepted: 1, finds: 1, avg_checks: 2 });
    expect(first).toMatchObject({ tried: 1, rejected: 1, finds: 0 });
    expect(ins.kpi).toMatchObject({ people: 1, found: 1, checks: 2, accepted: 1, rejected: 1 });
    expect(ins.byTld).toEqual([{ tld: "net", pattern: "first.last", n: 1 }]);
    expect(ins.checksToFind).toEqual([{ checks: 2, n: 1 }]);
    expect(ins.daily).toHaveLength(14);
  });
});

describe("schema upgrade", () => {
  it("backfills the pattern on checks logged before the column existed", async () => {
    const { SCHEMA_SQL } = await import("@/lib/schema");
    const pg = new PGlite();
    await pg.exec(SCHEMA_SQL.split("-- Which of the 9 combinations")[0]); // the old schema
    const { rows } = await pg.query<{ id: string }>(`insert into jobs (name) values ('t') returning id`);
    await pg.query(`insert into job_rows (job_id, row_no, first, last, domain) values ($1, 1, 'rajiv', 'garg', 'twe-obt.com')`, [rows[0].id]);
    await pg.exec(`insert into verifications (email, verdict) values
      ('rajiv@twe-obt.com', 'invalid'), ('rajiv.garg@twe-obt.com', 'valid'), ('nobody@x.com', 'invalid')`);
    await pg.exec(SCHEMA_SQL);
    await pg.exec(SCHEMA_SQL); // safe to run on every start
    const out = await pg.query(`select email, pattern, domain from verifications order by id`);
    expect(out.rows).toEqual([
      { email: "rajiv@twe-obt.com", pattern: "first", domain: "twe-obt.com" },
      { email: "rajiv.garg@twe-obt.com", pattern: "first.last", domain: "twe-obt.com" },
      { email: "nobody@x.com", pattern: null, domain: null },
    ]);
  });
});

describe("LinkedIn and the live ladder on a real schema", () => {
  it("stores the profile, reuses a past find for the same profile, ranks the ladder, exports no-email", async () => {
    const { loadLadder } = await import("@/lib/ladder");
    const db = await memDb();
    await repo.migrate(db);
    const { mtn, calls } = fakeMtn({ catchAll: ["ca.com"], noMx: [], boxes: ["sanjay.kumar@acme.com"] });
    const run = () =>
      startWorker({ db, mtn, concurrency: 1, rateMax: 1000, minSpacingMs: 0, idleMs: 5, exitWhenIdle: true, sleep: tick, log: () => {}, smartLadder: true }).done;

    const j1 = await repo.createJob(db, { name: "one" });
    await repo.addRows(db, j1, 1, [
      { first: "S.", last: "Kumar", domain: "acme.com", linkedin: "https://www.linkedin.com/in/Sanjay-Kumar-12ab/", input: {} },
      { first: "Priya", last: "Raman", domain: "ca.com", linkedin: "linkedin.com/in/priya-raman", input: {} },
    ]);
    await repo.setJobStatus(db, j1, "running");
    await run();
    const [sanjay] = await repo.listRows(db, j1, { status: "found" });
    expect(sanjay).toMatchObject({ first: "sanjay", email: "sanjay.kumar@acme.com" }); // name filled from the URL
    expect((await repo.listRows(db, j1, { status: "no_email" })).map((r) => r.first)).toEqual(["priya"]);

    // Same profile in a later upload: tried on its known pattern first, a free cache hit.
    const before = calls.length;
    const j2 = await repo.createJob(db, { name: "two" });
    await repo.addRows(db, j2, 1, [{ first: "Sanjay", last: "K", domain: "acme.com", linkedin: "linkedin.com/in/sanjay-kumar-12ab", input: {} }]);
    await repo.setJobStatus(db, j2, "running");
    await run();
    expect((await repo.listRows(db, j2))[0]).toMatchObject({ status: "found", email: "sanjay.kumar@acme.com", checks_used: 0 });
    expect(calls.length).toBe(before);

    const ladder = await loadLadder(db);
    expect(ladder).toMatchObject({ source: "default", finds: 2, cap: 0 }); // not enough finds yet to re-rank
  });
});
