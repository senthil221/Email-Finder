import { describe, expect, it } from "vitest";
import { candidates, cleanDomain, cleanName, parseName } from "@/lib/patterns";

describe("candidates", () => {
  it("builds the 9 combinations in Fable's order", () => {
    expect(candidates("andrew", "deepak", "x.com").map((c) => c.email)).toEqual([
      "andrew@x.com",
      "andrew.deepak@x.com",
      "andrewdeepak@x.com",
      "adeepak@x.com",
      "andrewd@x.com",
      "andrew.d@x.com",
      "andrew_deepak@x.com",
      "ad@x.com",
      "a.deepak@x.com",
    ]);
  });

  it("puts the company's known pattern first", () => {
    const list = candidates("andrew", "deepak", "x.com", "flast");
    expect(list[0]).toEqual({ pattern: "flast", email: "adeepak@x.com" });
    expect(list).toHaveLength(9);
  });

  it("only tries first@ when the last name is missing", () => {
    expect(candidates("andrew", "", "x.com").map((c) => c.email)).toEqual(["andrew@x.com"]);
  });

  it("returns nothing without a first name or domain", () => {
    expect(candidates("", "deepak", "x.com")).toEqual([]);
    expect(candidates("andrew", "deepak", "")).toEqual([]);
  });
});

describe("cleanName", () => {
  it("lowercases and strips accents and symbols, keeping word breaks", () => {
    expect(cleanName("  José ")).toBe("jose");
    expect(cleanName("O'Brien-Smith")).toBe("obrien smith");
    expect(cleanName("Senthil  Nathan")).toBe("senthil nathan");
    expect(cleanName("Dr. S.I.")).toBe("dr s i");
    expect(cleanName(undefined)).toBe("");
  });
});

describe("cleanDomain", () => {
  it.each([
    ["b2bdrive.net", "b2bdrive.net"],
    ["https://www.B2BDrive.net/about?x=1", "b2bdrive.net"],
    ["http://shop.example.co.in:8080/", "shop.example.co.in"],
    ["www2.example.com", "example.com"],
    ["john@example.com", "example.com"],
    ["example.com.", "example.com"],
    ["not a domain", ""],
    ["", ""],
  ])("%s -> %s", (input, out) => {
    expect(cleanDomain(input)).toBe(out);
  });
});

const locals = (first: string, last: string) => candidates(first, last, "x.in").map((c) => c.email.split("@")[0]);

describe("Indian names", () => {
  it("two-word first name: base combinations first, then senthil.nathan and senthil", () => {
    expect(locals("Senthil Nathan", "")).toEqual(["senthilnathan", "senthil.nathan", "senthil"]);
  });

  it("two-word first name with a surname adds first1.last after the 9", () => {
    const list = candidates("Senthil Nathan", "Kumar", "x.in");
    expect(list.slice(0, 9).map((c) => c.pattern)).toEqual([
      "first", "first.last", "firstlast", "flast", "firstl", "first.l", "first_last", "fl", "f.last",
    ]);
    expect(list[1].email).toBe("senthilnathan.kumar@x.in");
    expect(list.slice(9)).toEqual([
      { pattern: "first1.first2", email: "senthil.nathan@x.in" },
      { pattern: "first1", email: "senthil@x.in" },
      { pattern: "first1.last", email: "senthil.kumar@x.in" },
    ]);
  });

  it("trailing initials become an initial surname, not part of the first name", () => {
    expect(parseName("Senthil Nathan S I", "")).toEqual({
      first: "senthilnathan", last: "s", words: ["senthil", "nathan"], initialOnly: true,
    });
    expect(parseName("Senthil Nathan", "S. I.")).toMatchObject({ first: "senthilnathan", last: "s" });
    expect(locals("Senthil Nathan S I", "")).toEqual([
      "senthilnathan", "senthilnathan.s", "senthilnathans", "senthilnathan_s",
      "senthil.nathan", "senthil", "senthil.s",
    ]);
  });

  it("single-letter last name skips the initials-only addresses (rk@, r.k@)", () => {
    expect(locals("Ramesh", "K")).toEqual(["ramesh", "ramesh.k", "rameshk", "ramesh_k"]);
  });

  it("honorifics are dropped", () => {
    expect(locals("Dr. Ramesh", "Kumar")).toEqual(locals("Ramesh", "Kumar"));
    expect(parseName("Er", "Ravi Kumar")).toMatchObject({ first: "ravi", last: "kumar" });
    expect(parseName("Mrs Anu", "Priya")).toMatchObject({ first: "anu", last: "priya" });
    expect(parseName("Dr", "")).toMatchObject({ first: "dr" }); // nothing else to go on
  });

  it("a known extra pattern goes first for the next person", () => {
    expect(candidates("Ravi Kumar", "", "x.in", "first1.first2")[0].email).toBe("ravi.kumar@x.in");
  });

  it("one-word names are unchanged", () => {
    expect(locals("andrew", "deepak")).toHaveLength(9);
  });
});
