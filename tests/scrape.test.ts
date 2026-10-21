import { describe, expect, it } from "vitest";
import {
  brand,
  extractEmails,
  mailDomainFrom,
  matchSiteEmail,
  pickLinks,
  robotsAllows,
  scrapeSite,
  type Fetcher,
} from "@/lib/scrape";

function cf(email: string, key = 0x42): string {
  return key.toString(16).padStart(2, "0") + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
}

describe("extractEmails", () => {
  it("finds plain, mailto, entity, [at]/[dot] and Cloudflare-protected addresses", () => {
    const html = `
      <a href="mailto:Varun@MakeMyHomez.in">Mail</a>
      <p>tarun&#64;makemyhomez.in</p>
      <p>kapil [at] makemyhomez [dot] in</p>
      <a href="/cdn-cgi/l/email-protection#${cf("neha@acme.in")}">[email protected]</a>
      <span class="__cf_email__" data-cfemail="${cf("ravi@acme.in", 0x1f)}">[email protected]</span>`;
    expect(extractEmails(html).sort()).toEqual(
      ["kapil@makemyhomez.in", "neha@acme.in", "ravi@acme.in", "tarun@makemyhomez.in", "varun@makemyhomez.in"].sort(),
    );
  });

  it("drops image names, placeholders and library noise", () => {
    const html = `logo@2x.png you@example.com name@domain.com abc@sentry.io real@acme.com x@sentry-next.wixpress.com`;
    expect(extractEmails(html)).toEqual(["real@acme.com"]);
  });
});

describe("pickLinks", () => {
  it("keeps the site's own team / contact / about pages, best first", () => {
    const html = `
      <a href="/about-us">About</a> <a href="https://www.acme.in/our-team/">Leadership</a>
      <a href="/contact">Get in touch</a> <a href="/blog/post-1">Blog</a>
      <a href="https://facebook.com/acme">Contact on FB</a> <a href="/brochure.pdf">About PDF</a>`;
    const links = pickLinks(html, "https://acme.in/");
    expect(links).toEqual(["https://www.acme.in/our-team", "https://acme.in/contact", "https://acme.in/about-us"]);
  });
});

describe("robotsAllows", () => {
  const robots = `User-agent: *\nDisallow: /private\nAllow: /private/team\n\nUser-agent: BadBot\nDisallow: /`;
  it("follows the * rules, longest match wins", () => {
    expect(robotsAllows(robots, "/contact")).toBe(true);
    expect(robotsAllows(robots, "/private/x")).toBe(false);
    expect(robotsAllows(robots, "/private/team")).toBe(true);
  });
  it("a group naming our bot wins over *", () => {
    expect(robotsAllows(`User-agent: *\nAllow: /\n\nUser-agent: EmailFinderBot\nDisallow: /`, "/")).toBe(false);
    expect(robotsAllows("", "/")).toBe(true);
  });
});

describe("mailDomainFrom", () => {
  it("no other domain when the site uses its own", () => {
    expect(mailDomainFrom(["info@acme.in", "ravi@acme.in"], "acme.in", "acme.in")).toBeNull();
  });
  it("a same-name domain on the site is the mail domain", () => {
    expect(brand("acme-group.co.in")).toBe("acme-group");
    expect(mailDomainFrom(["info@acmegroup.com", "x@gmail.com"], "acme.in", "acme.in")).toBe("acmegroup.com");
    expect(mailDomainFrom(["sales@acme-infra.com"], "acmeinfra.in", null)).toBe("acme-infra.com");
  });
  it("where the website moved to counts when its addresses are there", () => {
    expect(mailDomainFrom(["hello@newbrand.io"], "oldbrand.in", "newbrand.io")).toBe("newbrand.io");
  });
  it("never a web agency or free mail", () => {
    expect(mailDomainFrom(["hello@pixelstudio.com", "owner@gmail.com"], "acme.in", "acme.in")).toBeNull();
    expect(mailDomainFrom(["info@indiagroup.com"], "techindia.in", null)).toBeNull(); // only generic words shared
  });
});

describe("matchSiteEmail", () => {
  const emails = ["info@makemyhomez.in", "tarun@makemyhomez.in", "kapil@makemyhomez.in", "hr@makemyhomez.in"];
  it("matches a person to their published address and pattern", () => {
    expect(matchSiteEmail("Tarun", "Jindal", emails, ["makemyhomez.in"])).toEqual({ email: "tarun@makemyhomez.in", pattern: "first" });
    expect(matchSiteEmail("Ajay", "Gupta", emails, ["makemyhomez.in"])).toBeNull();
  });
  it("role inboxes never match (hr@ is not Hari Ram) and other domains do not count", () => {
    expect(matchSiteEmail("Hari", "Ram", emails, ["makemyhomez.in"])).toBeNull();
    expect(matchSiteEmail("Tarun", "Jindal", emails, ["other.in"])).toBeNull();
  });
});

// A fake web: url -> [status, body, headers?]
function fakeWeb(pages: Record<string, [number, string, Record<string, string>?]>) {
  const asked: string[] = [];
  const get: Fetcher = async (url) => {
    asked.push(url);
    const p = pages[url];
    if (!p) throw new Error("ECONNREFUSED");
    const res = new Response(p[1], { status: p[0], headers: { "content-type": "text/html", ...(p[2] ?? {}) } });
    Object.defineProperty(res, "url", { value: url });
    return res;
  };
  return { get, asked };
}
const noWait = async () => {};

describe("scrapeSite", () => {
  it("reads home, then the linked team/contact pages, and collects addresses", async () => {
    const { get, asked } = fakeWeb({
      "https://acme.in/": [200, `<a href="/team">Our team</a><a href="/contact">Contact</a> info@acme.in`],
      "https://acme.in/robots.txt": [200, "User-agent: *\nDisallow: /contact"],
      "https://acme.in/team": [200, `ravi.kumar@acme.in`],
    });
    const r = await scrapeSite("acme.in", { fetch: get, sleep: noWait });
    expect(r).toMatchObject({ outcome: "ok", host: "acme.in", pages: 2 });
    expect(r.emails.sort()).toEqual(["info@acme.in", "ravi.kumar@acme.in"]);
    expect(asked).not.toContain("https://acme.in/contact"); // robots.txt said no
  });

  it("stops at a block or a bot challenge, and reports a dead site", async () => {
    const blocked = fakeWeb({ "https://a.in/": [403, "Forbidden"] });
    expect((await scrapeSite("a.in", { fetch: blocked.get, sleep: noWait })).outcome).toBe("blocked");
    const challenge = fakeWeb({ "https://b.in/": [503, "<title>Just a moment...</title>", { "cf-mitigated": "challenge" }] });
    expect((await scrapeSite("b.in", { fetch: challenge.get, sleep: noWait })).outcome).toBe("blocked");
    expect((await scrapeSite("c.in", { fetch: fakeWeb({}).get, sleep: noWait })).outcome).toBe("down");
  });

  it("a site that asks bots to stay out is left alone", async () => {
    const { get } = fakeWeb({
      "https://d.in/": [200, "x@d.in"],
      "https://d.in/robots.txt": [200, "User-agent: *\nDisallow: /"],
    });
    expect(await scrapeSite("d.in", { fetch: get, sleep: noWait })).toMatchObject({ outcome: "robots", emails: [] });
  });
});
