// Catch-all pass: no2bounce client, per-company logic, and a full round on real SQL (PGlite).
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { CaPause, canaryFor, catchAllRound, createCaChecker, lookUpMailProviders, verifyCatchAllCompany, type CaCheck } from "@/lib/catchall";
import { mailProvider } from "@/lib/dns";
import { createN2bClient, N2bRefused, normalizeN2b, type N2bClient } from "@/lib/no2bounce";

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

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 1)));

/** A fake no2bounce: `boxes` are deliverable, everything else UnDeliverable/AcceptAll. */
function fakeN2b(world: { boxes: string[]; slow?: string[] }) {
  const submitted: string[] = [];
  const polls = new Map<string, number>();
  const client: N2bClient = {
    credits: async () => 1000,
    submit: async (email) => (submitted.push(email), `t-${email}`),
    poll: async (id) => {
      const email = id.slice(2);
      polls.set(id, (polls.get(id) ?? 0) + 1);
      if (world.slow?.includes(email) && polls.get(id)! < 3) return null;
      const ok = world.boxes.includes(email);
      const status = ok ? "Deliverable/AcceptAll" : "UnDeliverable/AcceptAll";
      return { result: normalizeN2b(status), status, score: ok ? 99 : 0, credits: 1, raw: { email } };
    },
  };
  return { client, submitted, polls };
}

describe("no2bounce answers and mail providers", () => {
  it("reads no2bounce's words", () => {
    expect(normalizeN2b("Deliverable/AcceptAll")).toBe("deliverable");
    expect(normalizeN2b("UnDeliverable/AcceptAll")).toBe("undeliverable");
    expect(normalizeN2b("UnDeliverable")).toBe("undeliverable");
    expect(normalizeN2b("Catch-All")).toBe("catch_all");
    expect(normalizeN2b("")).toBe("unknown");
  });

  it("tells the mail provider from the MX host", () => {
    expect(mailProvider("aspmx.l.google.com")).toBe("google");
    expect(mailProvider("alt1.aspmx.l.google.com.")).toBe("google");
    expect(mailProvider("acme-com.mail.protection.outlook.com")).toBe("microsoft");
    expect(mailProvider("mx.zoho.in")).toBe("zoho");
    expect(mailProvider("mx1.hostinger.in")).toBe("other");
    expect(mailProvider("google.com.evil.net")).toBe("other");
  });

  it("submits, polls, and treats a key that does not work as refused", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("validate_token")) return Response.json({ message: "Internal server error error is not defined" }, { status: 500 });
      if (init?.method === "POST") return Response.json({ message: "Success", statusCode: 200, data: { trackingId: 17 } });
      return Response.json({ overallStatus: "Completed", result: { scoreStatus: "Deliverable/AcceptAll", score: 99 }, creditDebited: 1, refund: 0 });
    }) as typeof fetch;
    const c = createN2bClient({ apiKey: " k ", fetchImpl, sleep: tick });
    expect(await c.submit("a.b@acme.com")).toBe("17");
    expect(await c.poll("17")).toMatchObject({ result: "deliverable", score: 99, credits: 1 });
    await expect(c.credits()).rejects.toBeInstanceOf(N2bRefused);
    expect(seen.filter((s) => s.includes("validate_token"))).toHaveLength(2); // retried once, then given up
  });
});

describe("one catch-all company", () => {
  const person = (id: string, first: string, last: string) => ({ id, first, last, domain: "acme.com", linkedin: null });

  it("stops at the first deliverable, double-checks the company once, then leads with its pattern", async () => {
    const asked: string[] = [];
    const boxes = ["ravi@acme.com", "anu@acme.com"];
    const check: CaCheck = async (email) => (asked.push(email), boxes.includes(email) ? "deliverable" : "undeliverable");
    const results: Record<string, string | null> = {};
    const patches: unknown[] = [];
    const r = await verifyCatchAllCompany({
      company: { domain: "acme.com", pattern: null, acceptsAll: false },
      people: [person("1", "Ravi", "Kumar"), person("2", "Anu", "Priya"), person("3", "Raj", "Mehta")],
      check,
      onResult: async (id, hit) => void (results[id] = hit?.email ?? null),
      onCompany: async (p) => void patches.push(p),
    });
    expect(results).toEqual({ "1": "ravi@acme.com", "2": "anu@acme.com", "3": null });
    expect(r).toEqual({ checked: 3, found: 2 });
    expect(patches).toEqual([{ pattern: "first" }]);
    expect(asked).toEqual([
      "ravi.kumar@acme.com", "ravi@acme.com", canaryFor("acme.com"), // first hit, then the made-up address
      "anu@acme.com", // the company's pattern goes first
      "raj@acme.com", "raj.mehta@acme.com", "rajmehta@acme.com", "raj.m@acme.com", // top 4, nothing deliverable
    ]);
  });

  it("trusts nothing at a company where a made-up address passes too", async () => {
    const check: CaCheck = async () => "deliverable";
    const results: Record<string, string | null> = {};
    const patches: unknown[] = [];
    await verifyCatchAllCompany({
      company: { domain: "acme.com", pattern: null, acceptsAll: false },
      people: [person("1", "Ravi", "Kumar"), person("2", "Anu", "Priya")],
      check,
      onResult: async (id, hit) => void (results[id] = hit?.email ?? null),
      onCompany: async (p) => void patches.push(p),
    });
    expect(results).toEqual({ "1": null, "2": null });
    expect(patches).toEqual([{ acceptsAll: true }]);
  });
});

describe("catch-all pass on a real schema", () => {
  async function setup() {
    const db = await memDb();
    await repo.migrate(db);
    const job = await repo.createJob(db, { name: "list" });
    await repo.addRows(db, job, 1, [
      { first: "Satpal", last: "Singh", domain: "boilers.com", input: {} }, // Microsoft 365
      { first: "Pradeep", last: "Rao", domain: "boilers.com", input: {} },
      { first: "Hema", last: "Natesan", domain: "moppet.com", input: {} }, // Google: skipped
      { first: "Old", last: "Timer", domain: "gone.com", input: {} }, // no mail server any more
      { first: "Live", last: "Person", domain: "live.com", input: {} }, // not catch-all
    ]);
    await repo.setJobStatus(db, job, "running");
    await db.query(`update job_rows set status = 'catch_all', reason = 'catch_all' where domain <> 'live.com'`);
    await db.query(`update domains set status = 'catch_all' where domain <> 'live.com'`);
    const hosts: Record<string, string | null> = {
      "boilers.com": "boilers-com.mail.protection.outlook.com",
      "moppet.com": "aspmx.l.google.com",
      "gone.com": null,
    };
    return { db, job, mxHost: async (d: string) => hosts[d] ?? null };
  }

  it("finds people at Microsoft and other companies, leaves Google and dead ones alone, never pays twice", async () => {
    const { db, job, mxHost } = await setup();
    const { client, submitted } = fakeN2b({ boxes: ["satpal.singh@boilers.com", "pradeep.rao@boilers.com"] });
    const check = createCaChecker({ db, client, dailyLimit: 100, sleep: tick });
    const r = await catchAllRound({ db, check, mxHost, skip: ["google"] });
    expect(r).toMatchObject({ people: 4, checked: 2, found: 2 });

    const by = Object.fromEntries((await repo.listRows(db, job)).map((x) => [x.first, x]));
    expect(by.satpal).toMatchObject({ status: "found", email: "satpal.singh@boilers.com", pattern: "first.last", reason: "catch_all_verified" });
    expect(by.pradeep).toMatchObject({ status: "found", email: "pradeep.rao@boilers.com", reason: "catch_all_verified" });
    expect(by.hema).toMatchObject({ status: "catch_all", reason: "catch_all" });
    expect(by.old).toMatchObject({ status: "catch_all" });
    expect(submitted).toEqual(["satpal.singh@boilers.com", canaryFor("boilers.com"), "pradeep.rao@boilers.com"]);

    const [d] = await repo.catchAllCompanies(db, ["boilers.com"]);
    expect(d).toMatchObject({ mx_provider: "microsoft", ca_pattern: "first.last" });
    expect((await repo.catchAllCompanies(db, ["moppet.com", "gone.com"])).map((x) => x.mx_provider).sort()).toEqual(["google", "none"]);
    expect(await repo.getJob(db, job)).toMatchObject({ found: 2, found_catch_all: 2, catch_all: 2 });
    expect(await repo.n2bCredits24h(db)).toBe(3);

    // Nothing left to do; and a person asked about again is answered from the log.
    expect(await catchAllRound({ db, check, mxHost, skip: ["google"] })).toMatchObject({ people: 0 });
    await db.query(`update job_rows set status = 'catch_all', ca_checked_at = null where first = 'satpal'`);
    await catchAllRound({ db, check, mxHost, skip: ["google"] });
    expect(submitted).toHaveLength(3);
  });

  it("checks people asked for from a list first, Google included, on their own budget", async () => {
    const { db, job, mxHost } = await setup();
    const ids = Object.fromEntries((await repo.listRows(db, job)).map((x) => [x.first, x.id]));
    expect(await repo.requestCatchAll(db, job, [ids.hema, ids.old, ids.live])).toBe(2); // live.com is not catch-all
    expect(await repo.getJob(db, job)).toMatchObject({ ca_queued: 2, ca_checked: 0 });

    // The background pass leaves them to the request loop.
    const { client, submitted } = fakeN2b({ boxes: ["hema.natesan@moppet.com"] });
    const auto = createCaChecker({ db, client, dailyLimit: 100, sleep: tick });
    await catchAllRound({ db, check: auto, mxHost, skip: ["google"] });
    expect(submitted.some((e) => e.endsWith("@moppet.com"))).toBe(false);

    const asked = createCaChecker({ db, client, dailyLimit: 100, source: "request", sleep: tick });
    expect(await catchAllRound({ db, check: asked, mxHost, skip: ["google"], source: "request" })).toMatchObject({ people: 2, found: 1 });
    const by = Object.fromEntries((await repo.listRows(db, job)).map((x) => [x.first, x]));
    expect(by.hema).toMatchObject({ status: "found", email: "hema.natesan@moppet.com", reason: "catch_all_verified", mx_provider: "google" });
    expect(by.old).toMatchObject({ status: "catch_all", ca: "checked", mx_provider: "none" }); // no mail server: nothing to pay for
    // satpal and pradeep: the background pass found nothing for them; old: nothing to check.
    expect(await repo.getJob(db, job)).toMatchObject({ ca_queued: 0, ca_checked: 3, found_catch_all: 1 });
    expect(await repo.n2bCredits24h(db, "request")).toBe(2); // hema's first try, then the made-up address
    expect(await repo.n2bCredits24h(db, "auto")).toBe(8); // 4 combinations each for satpal and pradeep

    // Asking again about people already checked queues nobody.
    expect(await repo.requestCatchAll(db, job, null)).toBe(0);
  });

  it("polls a check still in progress instead of paying again, and stops at the daily budget", async () => {
    const { db, mxHost } = await setup();
    const slow = fakeN2b({ boxes: ["satpal.singh@boilers.com"], slow: ["satpal.singh@boilers.com"] });
    const impatient = createCaChecker({ db, client: slow.client, dailyLimit: 100, sleep: tick, maxPolls: 1 });
    expect(await catchAllRound({ db, check: impatient, mxHost, skip: ["google"] })).toMatchObject({ checked: 0 });
    expect(await catchAllRound({ db, check: impatient, mxHost, skip: ["google"] })).toMatchObject({ checked: 0 });
    const patient = createCaChecker({ db, client: slow.client, dailyLimit: 100, sleep: tick });
    expect(await catchAllRound({ db, check: patient, mxHost, skip: ["google"] })).toMatchObject({ found: 1 });
    expect(slow.submitted.filter((e) => e === "satpal.singh@boilers.com")).toHaveLength(1);

    const fresh = await setup();
    const tight = createCaChecker({ db: fresh.db, client: fakeN2b({ boxes: [] }).client, dailyLimit: 2, sleep: tick });
    await expect(catchAllRound({ db: fresh.db, check: tight, mxHost: fresh.mxHost, skip: ["google"] })).rejects.toBeInstanceOf(CaPause);
    expect(await repo.n2bCredits24h(fresh.db)).toBe(2);
  });

  it("stops when switched off or taken off the queue, and shows progress per list and mail host", async () => {
    const { db, job, mxHost } = await setup();
    const ids = Object.fromEntries((await repo.listRows(db, job)).map((x) => [x.first, x.id]));
    const { client, submitted } = fakeN2b({ boxes: ["satpal.singh@boilers.com"] });

    // Switched off before the first person: nobody is checked, nobody is marked.
    const auto = createCaChecker({ db, client, dailyLimit: 100, sleep: tick });
    expect(await catchAllRound({ db, check: auto, mxHost, skip: ["google"], keep: async () => false })).toMatchObject({ checked: 0 });
    expect(submitted).toEqual([]);

    // The switch is a setting the worker reads; off until switched on.
    expect(await repo.getSetting(db, repo.CA_AUTO)).toBeNull();
    await repo.setSetting(db, repo.CA_AUTO, true);
    expect(await repo.getSetting(db, repo.CA_AUTO)).toBe(true);

    // Queued people taken off the queue are left alone, even mid-round.
    expect(await repo.requestCatchAll(db, job, [ids.satpal, ids.pradeep, ids.hema])).toBe(3);
    expect(await repo.stopCatchAll(db, job)).toBe(3);
    expect(await repo.stillRequested(db, ids.satpal)).toBe(false);
    expect(await repo.getJob(db, job)).toMatchObject({ ca_queued: 0 });
    await repo.requestCatchAll(db, job, [ids.satpal, ids.pradeep]);
    const asked = createCaChecker({ db, client, dailyLimit: 100, source: "request", sleep: tick });
    let first = true;
    const r = await catchAllRound({
      db,
      check: asked,
      mxHost,
      skip: ["google"],
      source: "request",
      // Satpal is checked; then the rest are stopped from the app.
      keep: async (id) => {
        if (!first) await repo.stopCatchAll(db, null);
        first = false;
        return repo.stillRequested(db, id);
      },
    });
    expect(r).toMatchObject({ checked: 1, found: 1 });
    const by = Object.fromEntries((await repo.listRows(db, job)).map((x) => [x.first, x]));
    expect(by.satpal).toMatchObject({ status: "found", ca: null });
    expect(by.pradeep).toMatchObject({ status: "catch_all", ca: null });

    const { catchAllView } = await import("@/lib/views");
    const v = await catchAllView(db);
    expect(v.auto).toBe(true);
    expect(v.totals).toEqual({ people: 4, open: 3, queued: 0, checked: 1, confirmed: 1 });
    expect(v.lists).toMatchObject([{ id: job, people: 4, checked: 1, confirmed: 1 }]);
    expect(v.providers.find((p) => p.provider === "microsoft")).toMatchObject({ people: 2, checked: 1, confirmed: 1 });
    expect(v.recent).toMatchObject([{ first: "satpal", email: "satpal.singh@boilers.com" }]);
    expect(v.spent24h).toEqual({ auto: 0, request: 2 });
  });

  describe("checking the next N people", () => {
    const people = (domain: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({ first: `${"abcdefghij"[i]}ina`, last: domain.split(".")[0], domain, input: {} }));

    /** A list of catch-all people at companies on different mail hosts. */
    async function seeded() {
      const db = await memDb();
      await repo.migrate(db);
      const job = await repo.createJob(db, { name: "Big list" });
      await repo.addRows(db, job, 1, [
        ...people("zgoogle.com", 3),
        ...people("small365.com", 1),
        ...people("big365.com", 3),
        ...people("hosted.com", 2),
        ...people("known.com", 1),
        ...people("fakes.com", 2),
        ...people("gone.com", 1),
        ...people("nolookup.com", 1),
      ]);
      await repo.setJobStatus(db, job, "running");
      await db.query(`update job_rows set status = 'catch_all', reason = 'catch_all'`);
      await db.query(`update domains set status = 'catch_all', mx_provider = case
        when domain in ('small365.com', 'big365.com', 'fakes.com') then 'microsoft' when domain = 'zgoogle.com' then 'google'
        when domain = 'hosted.com' then 'other' when domain = 'gone.com' then 'none' when domain = 'known.com' then 'zoho' end`);
      await repo.saveCatchAllCompany(db, "known.com", { pattern: "first.last" });
      await repo.saveCatchAllCompany(db, "fakes.com", { acceptsAll: true });
      return { db, job };
    }
    const queued = async (db: Db) =>
      (await db.query<{ domain: string }>(`select domain from job_rows where ca_requested_at is not null`)).map((r) => r.domain);

    it("queues exactly that many, best odds and biggest companies first", async () => {
      const { db, job } = await seeded();
      // A confirmed pattern first, then Microsoft 365 with the bigger company ahead.
      expect(await repo.requestCatchAllCount(db, job, 3)).toBe(3);
      expect((await queued(db)).sort()).toEqual(["big365.com", "big365.com", "known.com"]);
      // Asking again takes the next ones and never repeats anyone.
      expect(await repo.requestCatchAllCount(db, job, 2)).toBe(2);
      expect((await queued(db)).sort()).toEqual(["big365.com", "big365.com", "big365.com", "known.com", "small365.com"]);
    });

    it("leaves out Google unless asked, dead domains, and companies that pass anything", async () => {
      const { db, job } = await seeded();
      const { catchAllOpen } = await import("@/lib/views");
      expect((await catchAllOpen(db, job)).providers).toEqual({ google: 3, microsoft: 4, other: 2, zoho: 1, none: 1, unknown: 1 });

      expect(await repo.requestCatchAllCount(db, job, 100)).toBe(8); // 3 + 1 at Microsoft, 2 other, 1 Zoho, 1 not looked up
      expect((await queued(db)).filter((d) => d === "zgoogle.com")).toEqual([]);
      expect(await repo.requestCatchAllCount(db, job, 100, { google: true })).toBe(3);
      expect(await repo.requestCatchAllCount(db, job, 100, { google: true })).toBe(0);
      expect((await catchAllOpen(db, job)).providers).toEqual({ none: 1 });
    });

    it("works the queue in the same order, a few per company at a time", async () => {
      const { db, job } = await seeded();
      await repo.requestCatchAllCount(db, job, 100, { google: true });
      const all = await repo.requestedCatchAllPeople(db);
      expect([...new Set(all.map((p) => p.domain))]).toEqual(["known.com", "big365.com", "small365.com", "hosted.com", "nolookup.com", "zgoogle.com"]);
      const capped = await repo.requestedCatchAllPeople(db, 200, 1);
      expect(capped.filter((p) => p.domain === "big365.com")).toHaveLength(1);
      expect(capped).toHaveLength(6);
    });

    it("looks up mail providers for free, keeping quiet about companies DNS cannot answer for", async () => {
      const { db, job } = await seeded();
      await db.query(`update domains set mx_provider = null where domain in ('hosted.com', 'zgoogle.com')`);
      const asked: string[] = [];
      const mxHost = async (d: string) => {
        asked.push(d);
        return d === "zgoogle.com" ? "aspmx.l.google.com" : d === "hosted.com" ? "mx1.hostinger.in" : null;
      };
      const tried = new Set<string>();
      expect(await lookUpMailProviders({ db, mxHost, tried })).toBe(3);
      expect(asked.sort()).toEqual(["hosted.com", "nolookup.com", "zgoogle.com"]);
      expect(await lookUpMailProviders({ db, mxHost, tried })).toBe(0); // no answer for nolookup.com: not asked again this run
      const by = Object.fromEntries((await repo.catchAllCompanies(db, ["hosted.com", "nolookup.com", "zgoogle.com"])).map((c) => [c.domain, c.mx_provider]));
      expect(by).toEqual({ "hosted.com": "other", "nolookup.com": null, "zgoogle.com": "google" });
      expect(await repo.getJob(db, job)).toMatchObject({ catch_all: 14 });
    });
  });
});
