// Catch-all pass: no2bounce client, per-company logic, and a full round on real SQL (PGlite).
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { CaPause, canaryFor, catchAllRound, createCaChecker, verifyCatchAllCompany, type CaCheck } from "@/lib/catchall";
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
});
