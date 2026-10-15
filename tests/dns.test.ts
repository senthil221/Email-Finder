import { describe, expect, it } from "vitest";
import { findAlternateDomain, twinDomains, type DnsDeps, type MxAnswer } from "@/lib/dns";

function fakeDns(mx: Record<string, MxAnswer>, redirects: Record<string, string> = {}) {
  const asked: string[] = [];
  const dns: DnsDeps = {
    mx: async (d) => (asked.push(d), mx[d] ?? "none"),
    redirect: async (d) => redirects[d] ?? null,
  };
  return { dns, asked };
}

describe("twinDomains", () => {
  it.each([
    ["acme.in", ["acme.com", "acme.co.in"]],
    ["acme.com", ["acme.in", "acme.co.in"]],
    ["acme.co.in", ["acme.com", "acme.in"]],
    ["acme.net", []],
  ])("%s", (d, twins) => expect(twinDomains(d)).toEqual(twins));
});

describe("findAlternateDomain", () => {
  it("prefers where the website redirects, if it has MX", async () => {
    const { dns } = fakeDns({ "acmegroup.com": "mx", "acme.com": "mx" }, { "acme.in": "acmegroup.com" });
    expect(await findAlternateDomain("acme.in", dns)).toBe("acmegroup.com");
  });

  it("falls back to the first twin with an MX record", async () => {
    const { dns } = fakeDns({ "acme.co.in": "mx" }, { "acme.in": "acme.in" });
    expect(await findAlternateDomain("acme.in", dns)).toBe("acme.co.in");
  });

  it("ignores redirects to a subdomain, a parking page or a social profile", async () => {
    for (const target of ["shop.acme.in", "www.hugedomains.com", "linkedin.com"]) {
      const { dns } = fakeDns({ [target]: "mx", "hugedomains.com": "mx" }, { "acme.in": target });
      expect(await findAlternateDomain("acme.in", dns)).toBeNull();
    }
  });

  it("skips twins without MX, twins DNS could not answer for, and ones known dead", async () => {
    const { dns } = fakeDns({ "acme.com": "error", "acme.co.in": "mx" });
    expect(await findAlternateDomain("acme.in", dns)).toBe("acme.co.in");
    expect(await findAlternateDomain("acme.in", dns, async (d) => d !== "acme.co.in")).toBeNull();
  });
});
