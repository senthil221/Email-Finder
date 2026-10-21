import { describe, expect, it } from "vitest";
import {
  processDomain,
  type CheckOutcome,
  type DomainState,
  type Person,
  type PersonResult,
} from "@/lib/engine";
import { createChecker, createProviderGate, FatalError, PauseError } from "@/lib/checker";
import { candidates } from "@/lib/patterns";
import type { MtnCall, Verdict } from "@/lib/mailtester";

// A fake mail world: which domains are catch-all, which mailboxes exist.
type World = { catchAll?: Set<string>; noMx?: Set<string>; boxes: Set<string>; stuck?: Set<string> };

function fakeCheck(w: World) {
  const calls: string[] = [];
  const check = async (email: string): Promise<CheckOutcome> => {
    calls.push(email);
    const domain = email.split("@")[1];
    if (w.noMx?.has(domain)) return { verdict: "no_mx", spent: 1 };
    if (w.catchAll?.has(domain)) return { verdict: "catch_all", spent: 1 };
    if (w.stuck?.has(email)) return { verdict: "unverified", spent: 2 };
    return { verdict: w.boxes.has(email) ? "valid" : "invalid", spent: 1 };
  };
  return { check, calls };
}

const fresh = (domain: string): DomainState => ({ domain, status: "unknown", pattern: null, checkedAt: null });
const p = (id: string, first: string, last: string, movedFrom?: string): Person => ({ id, first, last, movedFrom });

async function run(state: DomainState, people: Person[], w: World, now?: Date) {
  const { check, calls } = fakeCheck(w);
  const results: Record<string, PersonResult> = {};
  const domainUpdates: DomainState[] = [];
  const final = await processDomain({
    state,
    people,
    check,
    onResult: async (id, r) => {
      results[id] = r;
    },
    onDomain: async (s) => {
      domainUpdates.push(s);
    },
    now: now ? () => now : undefined,
  });
  return { final, results, calls, domainUpdates };
}

describe("processDomain", () => {
  it("scout finds first.last, the rest start on that pattern (1 check each)", async () => {
    const w = { boxes: new Set(["senthil.nathan@b2b.net", "ravi.kumar@b2b.net", "anu.priya@b2b.net"]) };
    const { final, results, calls } = await run(
      fresh("b2b.net"),
      [p("1", "senthil", "nathan"), p("2", "ravi", "kumar"), p("3", "anu", "priya")],
      w,
    );
    expect(results["1"]).toMatchObject({ status: "found", email: "senthil.nathan@b2b.net", checksUsed: 2 });
    expect(results["2"]).toMatchObject({ status: "found", email: "ravi.kumar@b2b.net", checksUsed: 1 });
    expect(results["3"]).toMatchObject({ status: "found", checksUsed: 1 });
    expect(final).toMatchObject({ status: "valid", pattern: "first.last" });
    expect(calls).toHaveLength(4);
  });

  it("falls back to the other combinations when the known pattern fails for someone", async () => {
    const w = { boxes: new Set(["senthil.nathan@b2b.net", "ravi@b2b.net"]) };
    const { results } = await run(fresh("b2b.net"), [p("1", "senthil", "nathan"), p("2", "ravi", "kumar")], w);
    expect(results["2"]).toMatchObject({ status: "found", email: "ravi@b2b.net", pattern: "first", checksUsed: 2 });
  });

  it("catch-all: one check, whole company parked", async () => {
    const w = { catchAll: new Set(["big.com"]), boxes: new Set<string>() };
    const people = [p("1", "a", "b"), p("2", "c", "d"), p("3", "e", "f")];
    const { final, results, calls } = await run(fresh("big.com"), people, w);
    expect(calls).toHaveLength(1);
    expect(Object.values(results).map((r) => r.status)).toEqual(["catch_all", "catch_all", "catch_all"]);
    expect(final.status).toBe("catch_all");
  });

  it("no MX: one check, everyone not_found with reason no_mx", async () => {
    const w = { noMx: new Set(["dead.com"]), boxes: new Set<string>() };
    const { results, calls } = await run(fresh("dead.com"), [p("1", "a", "b"), p("2", "c", "d")], w);
    expect(calls).toHaveLength(1);
    expect(results["2"]).toMatchObject({ status: "not_found", reason: "no_mx", checksUsed: 0 });
  });

  it("misses never skip the rest: everyone at a live company gets every combination", async () => {
    const w = { boxes: new Set(["zed@x.com"]) };
    const people = [p("1", "andrew", "deepak"), p("2", "ravi", "kumar"), p("3", "zed", "z")];
    const { final, results, calls } = await run(fresh("x.com"), people, w);
    expect(results["1"]).toMatchObject({ status: "not_found", reason: "all_rejected", checksUsed: 15 });
    expect(results["2"]).toMatchObject({ status: "not_found", reason: "all_rejected", checksUsed: 15 });
    expect(results["3"]).toMatchObject({ status: "found", email: "zed@x.com", checksUsed: 1 });
    expect(final.status).toBe("valid");
    expect(calls).toHaveLength(31);
  });

  it("a company parked by an older run is tried again", async () => {
    const state: DomainState = { domain: "x.com", status: "not_found", pattern: null, checkedAt: new Date() };
    const { results, calls } = await run(state, [p("1", "zed", "z")], { boxes: new Set(["zed@x.com"]) });
    expect(calls).toHaveLength(1);
    expect(results["1"]).toMatchObject({ status: "found", email: "zed@x.com" });
  });

  it("a scout that fails once does not park the company if the next one wins", async () => {
    const w = { boxes: new Set(["ravi.kumar@x.com", "anu.priya@x.com"]) };
    const people = [p("1", "andrew", "deepak"), p("2", "ravi", "kumar"), p("3", "anu", "priya")];
    const { results, final } = await run(fresh("x.com"), people, w);
    expect(results["3"]).toMatchObject({ status: "found", checksUsed: 1 });
    expect(final.status).toBe("valid");
  });

  it("unverifiable combinations give 'unverified', not 'not_found'", async () => {
    const w = { boxes: new Set<string>(), stuck: new Set(["andrew@x.com"]) };
    const { results } = await run(fresh("x.com"), [p("1", "andrew", "deepak")], w);
    expect(results["1"]).toMatchObject({ status: "unverified", reason: "some_unverifiable", checksUsed: 16 });
  });

  it("a server that times out on everything costs 3 attempts per person, then the company is skipped", async () => {
    // Every combination for these two people times out.
    const all = (first: string, last: string) => candidates(first, last, "down.com").map((c) => c.email);
    const stuck = new Set([...all("andrew", "deepak"), ...all("ravi", "kumar")]);
    const people = [p("1", "andrew", "deepak"), p("2", "ravi", "kumar"), p("3", "anu", "priya")];
    const { results, calls, final } = await run(fresh("down.com"), people, { boxes: new Set(), stuck });
    expect(results["1"]).toMatchObject({ status: "unverified", checksUsed: 6 });
    expect(results["2"]).toMatchObject({ status: "unverified", checksUsed: 6 });
    expect(results["3"]).toMatchObject({ status: "unverified", reason: "server_unreachable", checksUsed: 0 });
    expect(calls).toHaveLength(6);
    expect(final.status).toBe("unknown"); // not remembered: a later upload tries again
  });

  it("a recent catch-all verdict parks everyone with zero checks", async () => {
    const now = new Date("2026-10-15");
    const state: DomainState = { domain: "big.com", status: "catch_all", pattern: null, checkedAt: new Date("2026-10-01") };
    const { results, calls } = await run(state, [p("1", "a", "b")], { boxes: new Set() }, now);
    expect(calls).toHaveLength(0);
    expect(results["1"].status).toBe("catch_all");
  });

  it("a catch-all verdict older than 60 days is re-checked", async () => {
    const now = new Date("2026-10-15");
    const state: DomainState = { domain: "big.com", status: "catch_all", pattern: null, checkedAt: new Date("2026-06-01") };
    const { results, calls } = await run(state, [p("1", "a", "b")], { boxes: new Set(["a@big.com"]) }, now);
    expect(calls).toHaveLength(1);
    expect(results["1"].status).toBe("found");
  });

  it("a domain known from an earlier upload starts on its saved pattern", async () => {
    const state: DomainState = { domain: "x.com", status: "valid", pattern: "flast", checkedAt: new Date() };
    const { results, calls } = await run(state, [p("1", "andrew", "deepak")], { boxes: new Set(["adeepak@x.com"]) });
    expect(calls).toEqual(["adeepak@x.com"]);
    expect(results["1"].checksUsed).toBe(1);
  });
});

describe("processDomain: free DNS steps", () => {
  async function runDns(
    state: DomainState,
    people: Person[],
    w: World,
    o: { mx?: Record<string, boolean | null>; alt?: string | null; now?: Date } = {},
  ) {
    const { check, calls } = fakeCheck(w);
    const results: Record<string, PersonResult> = {};
    const moves: [string, string, number][] = [];
    const mxAsked: string[] = [];
    let altAsked = 0;
    const final = await processDomain({
      state,
      people,
      check,
      onResult: async (id, r) => {
        results[id] = r;
      },
      onDomain: async () => {},
      mx: async (d) => (mxAsked.push(d), o.mx && d in o.mx ? o.mx[d] : true),
      findAlternate: async () => (altAsked++, o.alt ?? null),
      onMove: async (id, d, used) => {
        moves.push([id, d, used]);
      },
      now: o.now ? () => o.now! : undefined,
    });
    return { final, results, calls, moves, mxAsked, altAsked: () => altAsked };
  }

  it("a domain with no MX record is no_mx with zero MailTester checks", async () => {
    const { final, results, calls } = await runDns(fresh("dead.in"), [p("1", "a", "b"), p("2", "c", "d")], { boxes: new Set() }, { mx: { "dead.in": false } });
    expect(calls).toHaveLength(0);
    expect(final.status).toBe("no_mx");
    expect(results["1"]).toMatchObject({ status: "not_found", reason: "no_mx", checksUsed: 0 });
  });

  it("MX found is remembered: the next batch does not ask DNS again", async () => {
    const now = new Date("2026-10-15");
    const first = await runDns(fresh("ok.in"), [p("1", "a", "b")], { boxes: new Set(["a@ok.in"]) }, { now });
    expect(first.mxAsked).toEqual(["ok.in"]);
    const unknownAgain = { ...first.final, status: "unknown" as const };
    const second = await runDns(unknownAgain, [p("2", "c", "d")], { boxes: new Set(["c@ok.in"]) }, { now });
    expect(second.mxAsked).toEqual([]);
  });

  it("a DNS error is not a verdict: MailTester decides as before", async () => {
    const { calls, final } = await runDns(fresh("flaky.in"), [p("1", "a", "b")], { boxes: new Set(["a@flaky.in"]) }, { mx: { "flaky.in": null } });
    expect(calls).toHaveLength(1);
    expect(final.status).toBe("valid");
    expect(final.mxCheckedAt).toBeUndefined(); // not remembered: asked again next time
  });

  it("no MX: people move to the twin domain instead of being parked", async () => {
    const { results, moves, calls } = await runDns(
      fresh("acme.in"),
      [p("1", "a", "b"), p("2", "c", "d", "other.in")],
      { boxes: new Set() },
      { mx: { "acme.in": false }, alt: "acme.com" },
    );
    expect(calls).toHaveLength(0);
    expect(moves).toEqual([["1", "acme.com", 0]]);
    // Already moved once: never moved again.
    expect(results["2"]).toMatchObject({ reason: "no_mx" });
  });

  it("an all-rejected scout on an unproven company is restarted on the alternate, checks kept", async () => {
    const { results, moves, final, altAsked } = await runDns(
      fresh("x.in"),
      [p("1", "andrew", "deepak"), p("2", "ravi", "kumar"), p("3", "anu", "priya")],
      { boxes: new Set() },
      { alt: "x.com" },
    );
    expect(moves).toEqual([
      ["1", "x.com", 15],
      ["2", "x.com", 15],
      ["3", "x.com", 15], // each person gets every combination here first
    ]);
    expect(results).toEqual({});
    expect(final).toMatchObject({ status: "unknown", alt: "x.com" });
    expect(altAsked()).toBe(1); // looked up once, then remembered
  });

  it("no alternate: same results as before", async () => {
    const { results, moves } = await runDns(fresh("x.in"), [p("1", "andrew", "deepak")], { boxes: new Set() });
    expect(moves).toEqual([]);
    expect(results["1"]).toMatchObject({ status: "not_found", reason: "all_rejected" });
  });

  it("on a proven company an all-rejected person stays (they probably left)", async () => {
    const state: DomainState = { domain: "x.in", status: "valid", pattern: "first", checkedAt: new Date() };
    const { results, moves } = await runDns(state, [p("1", "andrew", "deepak")], { boxes: new Set() }, { alt: "x.com" });
    expect(moves).toEqual([]);
    expect(results["1"].reason).toBe("probably_left");
  });
});

// ---------- checker ----------

function scripted(answers: Record<string, Verdict[]>) {
  const calls: string[] = [];
  const mtn = async (email: string): Promise<MtnCall> => {
    calls.push(email);
    const v = answers[email]?.shift() ?? "invalid";
    return { verdict: v, message: v, code: "", raw: {} };
  };
  return { mtn, calls };
}

const baseDeps = {
  rateLimit: async () => {},
  spendBudget: async () => {},
  cacheGet: async () => null,
  record: async () => {},
  sleep: async () => {},
};

describe("createChecker", () => {
  it("retries a timeout once, then gives the real answer", async () => {
    const { mtn, calls } = scripted({ "a@x.com": ["retry", "valid"] });
    const check = createChecker({ ...baseDeps, mtn });
    expect(await check("a@x.com")).toEqual({ verdict: "valid", spent: 2 });
    expect(calls).toHaveLength(2);
  });

  it("gives up as unverified after the second failure", async () => {
    const { mtn } = scripted({ "a@x.com": ["retry", "retry", "valid"] });
    const check = createChecker({ ...baseDeps, mtn });
    expect(await check("a@x.com")).toEqual({ verdict: "unverified", spent: 2 });
  });

  it("'Too Many Requests' is retried and not counted as a result", async () => {
    const { mtn } = scripted({ "a@x.com": ["rate_limited", "rate_limited", "invalid"] });
    const check = createChecker({ ...baseDeps, mtn });
    expect(await check("a@x.com")).toEqual({ verdict: "invalid", spent: 1 });
  });

  it("uses the cache without calling MailTester", async () => {
    const { mtn, calls } = scripted({});
    const check = createChecker({ ...baseDeps, mtn, cacheGet: async () => "catch_all" });
    expect(await check("a@x.com")).toEqual({ verdict: "catch_all", spent: 0 });
    expect(calls).toHaveLength(0);
  });

  it("throws FatalError on a bad key", async () => {
    const { mtn } = scripted({ "a@x.com": ["fatal"] });
    await expect(createChecker({ ...baseDeps, mtn })("a@x.com")).rejects.toBeInstanceOf(FatalError);
  });

  it("stops before calling when the daily budget is used up", async () => {
    const { mtn, calls } = scripted({});
    const check = createChecker({
      ...baseDeps,
      mtn,
      spendBudget: async () => {
        throw new PauseError("daily limit");
      },
    });
    await expect(check("a@x.com")).rejects.toBeInstanceOf(PauseError);
    expect(calls).toHaveLength(0);
  });
});

describe("createChecker: provider pauses", () => {
  it("a 429 pauses every caller, then the same address is retried", async () => {
    const answers: MtnCall[] = [
      { verdict: "rate_limited", message: "", code: "", raw: {}, pauseMs: 30_000 },
      { verdict: "valid", message: "Accepted", code: "ok", raw: {} },
    ];
    const pauses: number[] = [];
    const check = createChecker({ ...baseDeps, mtn: async () => answers.shift()!, pauseProvider: (ms) => pauses.push(ms) });
    expect(await check("a@x.com")).toEqual({ verdict: "valid", spent: 1 });
    expect(pauses).toEqual([30_000]);
  });

  it("network failures are retried up to 3 times, then unverified", async () => {
    const fail: MtnCall = { verdict: "retry", message: "network", code: "", raw: null, transportFailure: true };
    let n = 0;
    const check = createChecker({ ...baseDeps, mtn: async () => (n++, fail), circuitAfter: 100 });
    expect(await check("a@x.com")).toEqual({ verdict: "unverified", spent: 4 });
    expect(n).toBe(4);
  });

  it("5 network failures in a row open a 5-minute circuit", async () => {
    const fail: MtnCall = { verdict: "retry", message: "network", code: "", raw: null, transportFailure: true };
    const pauses: number[] = [];
    const check = createChecker({ ...baseDeps, mtn: async () => fail, pauseProvider: (ms) => pauses.push(ms) });
    await check("a@x.com");
    await check("b@x.com");
    expect(pauses).toEqual([300_000]);
  });
});

describe("createProviderGate", () => {
  it("spaces starts and caps them per window", async () => {
    const gate = createProviderGate({ max: 3, windowMs: 300, minSpacingMs: 40 });
    const t0 = Date.now();
    const times: number[] = [];
    for (let i = 0; i < 4; i++) {
      await gate.take();
      times.push(Date.now() - t0);
    }
    for (let i = 1; i < 3; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(35);
    expect(times[3]).toBeGreaterThanOrEqual(295); // 4th waits for the window
  });

  it("pause holds every caller", async () => {
    const gate = createProviderGate({ max: 100, windowMs: 1000 });
    gate.pause(150);
    const t0 = Date.now();
    await gate.take();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
  });
});

describe("alternate domain safety", () => {
  it("a person moved to another domain is only found by a full-name pattern", async () => {
    const { findPerson } = await import("@/lib/engine");
    const boxes = new Set(["amit@twin.com", "amit.shah@twin.com"]);
    const tried: string[] = [];
    const check = async (email: string) => {
      tried.push(email);
      return { verdict: boxes.has(email) ? ("valid" as const) : ("invalid" as const), spent: 1 };
    };
    const moved = await findPerson({ id: "1", first: "amit", last: "shah", movedFrom: "twin.in" }, "twin.com", null, check, { fullNameOnly: true });
    expect(moved).toMatchObject({ status: "found", email: "amit.shah@twin.com" });
    expect(tried).not.toContain("amit@twin.com");

    const noSurname = await findPerson({ id: "2", first: "amit", last: "" }, "twin.com", null, check, { fullNameOnly: true });
    expect(noSurname).toMatchObject({ status: "not_found", reason: "all_rejected", checksUsed: 0 });
  });
});

describe("processDomain: addresses from the company website", () => {
  it("a published address is found with zero checks and proves the company pattern", async () => {
    const state: DomainState = {
      ...fresh("makemyhomez.in"),
      siteEmails: ["info@makemyhomez.in", "tarun@makemyhomez.in", "varun@makemyhomez.in"],
    };
    // MailTester rejects everything here (a blind server): only the website can find them.
    const { results, calls, final } = await run(state, [p("1", "Tarun", "Jindal"), p("2", "Varun", "Jindal")], { boxes: new Set() });
    expect(results["1"]).toMatchObject({ status: "found", email: "tarun@makemyhomez.in", pattern: "first", reason: "website", checksUsed: 0 });
    expect(results["2"]).toMatchObject({ status: "found", email: "varun@makemyhomez.in", reason: "website", checksUsed: 0 });
    expect(calls).toHaveLength(0);
    expect(final).toMatchObject({ status: "valid", pattern: "first" });
  });

  it("people not on the site start on the pattern the site proved", async () => {
    const state: DomainState = { ...fresh("acme.in"), siteEmails: ["ravi.kumar@acme.in"] };
    const { results, calls } = await run(state, [p("1", "Ravi", "Kumar"), p("2", "Anu", "Priya")], { boxes: new Set(["anu.priya@acme.in"]) });
    expect(results["1"].reason).toBe("website");
    expect(results["2"]).toMatchObject({ status: "found", email: "anu.priya@acme.in", checksUsed: 1 });
    expect(calls).toEqual(["anu.priya@acme.in"]);
  });

  it("a catch-all company still gets the people its website lists", async () => {
    const state: DomainState = { domain: "big.com", status: "catch_all", pattern: null, checkedAt: new Date(), siteEmails: ["amit.shah@big.com"] };
    const { results } = await run(state, [p("1", "Amit", "Shah"), p("2", "Ravi", "Kumar")], { boxes: new Set() });
    expect(results["1"]).toMatchObject({ status: "found", reason: "website" });
    expect(results["2"]).toMatchObject({ status: "catch_all" });
  });

  it("a mail domain named on the website sends everyone there, where every pattern counts", async () => {
    const moved: [string, string, number, string | undefined][] = [];
    const final = await processDomain({
      state: { ...fresh("acme-group.com"), siteEmails: ["info@acme.in"], mailDomain: "acme.in" },
      people: [p("1", "Ravi", "Kumar"), p("2", "Anu", "Priya", "other.in")],
      check: fakeCheck({ boxes: new Set() }).check,
      onResult: async () => {},
      onDomain: async () => {},
      onMove: async (id, d, used, via) => {
        moved.push([id, d, used, via]);
      },
    });
    expect(moved).toEqual([["1", "acme.in", 0, "website"]]); // person 2 was already moved once
    expect(final.status).toBe("unknown");

    // On the mail domain, a website move does not restrict to full-name patterns (ravi@ counts).
    const there = await run(fresh("acme.in"), [{ id: "1", first: "Ravi", last: "Kumar", movedFrom: "acme-group.com", movedVia: "website" }], {
      boxes: new Set(["ravi@acme.in"]),
    });
    expect(there.results["1"]).toMatchObject({ status: "found", email: "ravi@acme.in" });
  });
});
