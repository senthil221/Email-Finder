import { describe, expect, it } from "vitest";
import { candidates, cleanDomain, cleanName } from "@/lib/patterns";

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
  it("lowercases and strips accents, spaces and symbols", () => {
    expect(cleanName("  José ")).toBe("jose");
    expect(cleanName("O'Brien-Smith")).toBe("obriensmith");
    expect(cleanName("Senthil Nathan")).toBe("senthilnathan");
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
