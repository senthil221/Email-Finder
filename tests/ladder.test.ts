import { describe, expect, it } from "vitest";
import { candidates, rankPatterns, parseName } from "@/lib/patterns";
import { fillName, handleHint, normalizeLinkedin, slugWords } from "@/lib/linkedin";
import { findPerson } from "@/lib/engine";

const locals = (list: { email: string }[]) => list.map((c) => c.email.split("@")[0]);

describe("smart ladder", () => {
  it("ranks base patterns by finds, unknown ones keep their default place", () => {
    expect(rankPatterns([{ pattern: "first.l", n: 9 }, { pattern: "first", n: 50 }, { pattern: "first.last", n: 40 }])).toEqual([
      "first", "first.last", "first.l", "firstlast", "flast", "firstl", "first_last", "fl", "f.last",
    ]);
  });

  it("tries base patterns in ladder order up to the cap, then the multi-word extras", () => {
    const order = rankPatterns([{ pattern: "first.last", n: 5 }, { pattern: "first", n: 4 }, { pattern: "first.l", n: 3 }]);
    expect(locals(candidates("andrew", "deepak", "x.com", null, { order, cap: 3 }))).toEqual(["andrew.deepak", "andrew", "andrew.d", "deepak.andrew", "andrew-deepak", "deepakandrew", "deepak.a", "deepaka", "deepak"]);
    expect(locals(candidates("senthil nathan", "kumar", "x.in", null, { order, cap: 2 }))).toEqual([
      "senthilnathan.kumar", "senthilnathan", "senthil.nathan", "senthil", "senthil.kumar",
      "kumar.senthilnathan", "senthilnathan-kumar", "kumarsenthilnathan", "kumar.s", "kumars", "kumar",
    ]);
  });

  it("preferred patterns always go first, even past the cap", () => {
    expect(locals(candidates("andrew", "deepak", "x.com", ["f.last", null, "flast"], { cap: 2 }))).toEqual([
      "a.deepak", "adeepak", "andrew", "andrew.deepak", "deepak.andrew", "andrew-deepak", "deepakandrew", "deepak.a", "deepaka", "deepak",
    ]);
  });

  it("cap 0 means all nine, plus the extras", () => {
    expect(candidates("andrew", "deepak", "x.com", null, { cap: 0 })).toHaveLength(15);
  });
});

describe("LinkedIn URLs", () => {
  it.each([
    ["https://www.linkedin.com/in/Senthil-Nathan-S-I-4a1b2c/?originalSubdomain=in", "senthil-nathan-s-i-4a1b2c"],
    ["linkedin.com/in/rdeepak", "rdeepak"],
    ["https://in.linkedin.com/in/andrew-deepak-123456789", "andrew-deepak-123456789"],
    ["https://www.linkedin.com/company/acme", ""],
    ["", ""],
  ])("%s -> %s", (url, slug) => expect(normalizeLinkedin(url)).toBe(slug));

  it("reads name words and drops LinkedIn's random suffix", () => {
    expect(slugWords("senthil-nathan-s-i-4a1b2c")).toEqual(["senthil", "nathan", "s", "i"]);
    expect(slugWords("andrew-deepak-123456789")).toEqual(["andrew", "deepak"]);
  });

  it("fills initial-only or missing names, never overrides real ones", () => {
    expect(fillName("S.", "Kumar", "sanjay-kumar-12ab")).toEqual({ first: "sanjay", last: "Kumar" });
    expect(fillName("Sanjay", "", "sanjay-kumar-12ab")).toEqual({ first: "Sanjay", last: "kumar" });
    expect(fillName("Sanjay", "K", "sanjay-kumar-12ab")).toEqual({ first: "Sanjay", last: "kumar" });
    expect(fillName("Andrew", "Deepak", "drew-d-99")).toEqual({ first: "Andrew", last: "Deepak" });
  });

  it("a custom handle hints at the email style; default URLs do not", () => {
    const n = parseName("andrew", "deepak");
    expect(handleHint("rdeepak", n)).toBe(null); // not built from andrew deepak
    expect(handleHint("adeepak", n)).toBe("flast");
    expect(handleHint("andrewdeepak", n)).toBe("firstlast");
    expect(handleHint("andrew-deepak-1234", n)).toBe(null);
  });

  it("the engine tries the person's known pattern, then the handle hint, before the ladder", async () => {
    const tried: string[] = [];
    const check = async (email: string) => {
      tried.push(email);
      return { verdict: email === "adeepak@x.com" ? ("valid" as const) : ("invalid" as const), spent: 1 };
    };
    // flast is outside the cap of 2, but the /in/adeepak handle puts it first.
    const r = await findPerson({ id: "1", first: "Andrew", last: "Deepak", linkedin: "adeepak" }, "x.com", null, check, { ladder: { cap: 2 } });
    expect(r).toMatchObject({ status: "found", email: "adeepak@x.com", checksUsed: 1 });
    expect(tried).toEqual(["adeepak@x.com"]);

    tried.length = 0;
    await findPerson({ id: "2", first: "Andrew", last: "Deepak", knownPattern: "f.last" }, "x.com", "first", check);
    expect(tried.slice(0, 2)).toEqual(["andrew@x.com", "a.deepak@x.com"]); // company pattern, then this person's
  });
});
