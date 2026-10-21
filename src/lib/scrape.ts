// Free website pass: read a company's own public pages (home, then team / about /
// contact) for the email addresses it publishes, and which domain it uses for mail.
// Polite by design: robots.txt is respected, one page at a time per site with a
// pause in between, at most a handful of pages, and any block means we stop.
import { cleanDomain, candidates, type PatternId } from "./patterns";

export const SCRAPE_UA = "Mozilla/5.0 (compatible; EmailFinderBot/1.0)";

export type ScrapeResult = {
  /** "ok" (pages read), "robots" (site asks bots to stay out), "blocked" (403/429/challenge), "down" (no response). */
  outcome: "ok" | "robots" | "blocked" | "down";
  /** Where the website ended up after redirects, as a bare domain. */
  host: string | null;
  /** Every address found on the pages, lowercased and deduplicated (capped). */
  emails: string[];
  pages: number;
};

export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

const MAX_EMAILS = 50;
const MAX_BYTES = 1_500_000;

// Addresses on these are personal mailboxes, not a company mail domain.
export const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "rediffmail.com", "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me",
  "zoho.com", "zohomail.com", "zohomail.in", "gmx.com", "mail.com",
]);

// Placeholders, libraries and site builders that leave addresses in page source.
const NOISE = [
  "example.com", "example.org", "domain.com", "email.com", "yourdomain.com", "yoursite.com", "company.com",
  "test.com", "mysite.com", "website.com", "sentry.io", "wixpress.com", "w3.org", "schema.org", "godaddy.com",
  "cloudflare.com", "gravatar.com", "wordpress.org", "wordpress.com", "wix.com", "squarespace.com",
  "sentry-next.wixpress.com", "address.com", "mail.ru", "latofonts.com", "typemade.mx", "indiamart.com",
  "justdial.com",
];
const FILE_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|json|woff2?|ttf|eot|mp4|pdf)$/;

/** Inboxes that belong to a role, never to the person whose initials happen to match (hr@ is not Hari Ram). */
export const ROLE_LOCALS = new Set([
  "info", "sales", "hr", "admin", "contact", "support", "enquiry", "enquiries", "inquiry", "office", "mail",
  "careers", "career", "jobs", "accounts", "account", "billing", "marketing", "team", "hello", "help", "service",
  "services", "noreply", "no-reply", "webmaster", "media", "press", "pr", "legal", "privacy", "ceo", "md",
  "director", "booking", "bookings", "orders", "order", "care", "customercare", "hi", "it", "ops", "finance",
]);

const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Every plausible address in a page, including Cloudflare-protected and "name [at] domain [dot] com" ones. */
export function extractEmails(html: string): string[] {
  let text = html
    .replace(/data-cfemail="([0-9a-f]+)"/gi, (_, hex: string) => ` ${decodeCfEmail(hex)} `)
    .replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, (_, hex: string) => ` ${decodeCfEmail(hex)} `)
    .replace(/&#0*64;|&#x0*40;|&commat;|%40|\\u0040/gi, "@")
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, ".")
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, "@")
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, ".");
  text = text.toLowerCase();
  const found = new Set<string>();
  for (const m of text.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/g)) {
    const email = m[0].replace(/\.+$/, "");
    const [local, domain] = email.split("@");
    if (!local || !domain || local.includes("..") || /^u00[0-9a-f]/.test(local)) continue;
    if (FILE_TLD.test(email) || NOISE.some((n) => under(domain, n))) continue;
    found.add(email);
    if (found.size >= MAX_EMAILS) break;
  }
  return [...found];
}

const PAGE_WORDS: [RegExp, number][] = [
  [/contact|reach-?us|get-?in-?touch/, 3],
  [/team|leadership|management|people|directors|founders|staff|board|partners/, 3],
  [/about|who-?we-?are|company|our-?story/, 2],
];

/** The site's own team / about / contact pages linked from a page, best first. */
export function pickLinks(html: string, pageUrl: string, max = 4): string[] {
  const base = new URL(pageUrl);
  const site = base.hostname.replace(/^www\./, "");
  const scored = new Map<string, number>();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== site) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?)$/i.test(url.pathname) || url.pathname === "/") continue;
    const words = `${url.pathname} ${m[2].replace(/<[^>]+>/g, " ")}`.toLowerCase();
    let score = 0;
    for (const [re, s] of PAGE_WORDS) if (re.test(words)) score = Math.max(score, s);
    if (!score) continue;
    const key = url.origin + url.pathname.replace(/\/+$/, "");
    scored.set(key, Math.max(scored.get(key) ?? 0, score));
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([u]) => u);
}

/** Minimal robots.txt reading: the rules for our bot (or "*"), longest matching rule wins. */
export function robotsAllows(robots: string, path: string, bot = "emailfinderbot"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && bot.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: { allow: boolean; path: string } | null = null;
  for (const r of rules) {
    const prefix = r.path.replace(/\*.*$/, "").replace(/\$$/, "");
    if (path.startsWith(prefix) && (!best || prefix.length > best.path.length)) best = { allow: r.allow, path: prefix };
  }
  return best ? best.allow : true;
}

const TWO_PART_TLD = /\.(co|com|net|org|ac|gov|edu|res|firm|gen|ind)\.[a-z]{2}$/;
const GENERIC = new Set([
  "group", "india", "global", "tech", "techno", "solutions", "services", "infra", "the", "and", "info", "online",
  "web", "digital", "world", "international", "corp", "company", "systems", "consulting", "labs", "official",
  "limited", "private", "pvt", "ltd", "home", "homes", "realty", "media", "enterprises", "industries", "mail",
]);

/** The name part of a domain: "acme-infra.co.in" -> "acme-infra". */
export function brand(domain: string): string {
  const d = domain.replace(/^www\./, "");
  const cut = TWO_PART_TLD.test(d) ? 2 : 1;
  const labels = d.split(".");
  return labels.slice(Math.max(0, labels.length - cut - 1), labels.length - cut).join(".");
}

function sameBrand(a: string, b: string): boolean {
  const x = brand(a);
  const y = brand(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && long.replace(/-/g, "").includes(short.replace(/-/g, ""))) return true;
  const words = (s: string) => s.split("-").filter((w) => w.length >= 4 && !GENERIC.has(w));
  const yw = new Set(words(y));
  return words(x).some((w) => yw.has(w));
}

/**
 * Which domain the company uses for email, judged from the addresses on its own site.
 * Null when that is the website domain itself, or nothing on the site says otherwise.
 * Another domain only counts when it carries the same name ("acme-group.com" site,
 * "acme.in" mail), so a web agency's footer address is never mistaken for it.
 */
export function mailDomainFrom(emails: string[], website: string, host: string | null): string | null {
  const counts = new Map<string, number>();
  for (const e of emails) {
    const d = e.split("@")[1];
    if (d && !FREEMAIL.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.has(website)) return null;
  if (host && host !== website && counts.has(host)) return host;
  const ranked = [...counts.entries()]
    .filter(([d]) => sameBrand(d, website) || (host ? sameBrand(d, host) : false))
    .sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}

/**
 * The published address that belongs to this person: one of their name combinations at
 * the company's website or mail domain. Role inboxes never count (hr@ is not Hari Ram).
 */
export function matchSiteEmail(
  first: string,
  last: string,
  emails: string[],
  domains: string[],
): { email: string; pattern: PatternId } | null {
  if (!emails.length) return null;
  const byLocal = new Map<string, PatternId>();
  for (const c of candidates(first, last, "x.x")) {
    const local = c.email.split("@")[0];
    if (!byLocal.has(local)) byLocal.set(local, c.pattern);
  }
  for (const email of emails) {
    const [local, domain] = email.split("@");
    if (!domains.includes(domain) || ROLE_LOCALS.has(local)) continue;
    const pattern = byLocal.get(local);
    if (pattern) return { email, pattern };
  }
  return null;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

const isChallenge = (res: Response, body: string) =>
  res.headers.get("cf-mitigated") === "challenge" || /just a moment\.\.\.|cf-browser-verification|captcha/i.test(body.slice(0, 5000));

/** Read a company's public pages for the addresses it publishes. Never throws. */
export async function scrapeSite(
  domain: string,
  opts: { fetch?: Fetcher; sleep?: (ms: number) => Promise<void>; pageDelayMs?: number; timeoutMs?: number; maxPages?: number } = {},
): Promise<ScrapeResult> {
  const get = opts.fetch ?? (fetch as Fetcher);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const headers = { "user-agent": SCRAPE_UA, accept: "text/html,application/xhtml+xml" };
  const load = async (url: string) => {
    const res = await get(url, { signal: AbortSignal.timeout(timeoutMs), headers });
    const type = res.headers.get("content-type") ?? "";
    const body = /html|text\/plain/i.test(type) || !type ? await readCapped(res) : (await res.body?.cancel().catch(() => {}), "");
    return { res, body };
  };

  // Home page first (https, then http): it tells us where the site really lives.
  let home: { res: Response; body: string } | null = null;
  for (const scheme of ["https", "http"]) {
    try {
      home = await load(`${scheme}://${domain}/`);
      break;
    } catch {
      // next scheme
    }
  }
  if (!home) return { outcome: "down", host: null, emails: [], pages: 0 };
  const host = cleanDomain(home.res.url) || null;
  if (home.res.status === 403 || home.res.status === 429 || isChallenge(home.res, home.body)) {
    return { outcome: "blocked", host, emails: [], pages: 0 };
  }
  if (!home.res.ok) return { outcome: "down", host, emails: [], pages: 0 };

  // robots.txt decides which of the other pages we may read.
  const origin = new URL(home.res.url).origin;
  let robots = "";
  try {
    const r = await get(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5_000), headers });
    if (r.ok) robots = (await readCapped(r)).slice(0, 200_000);
    else await r.body?.cancel().catch(() => {});
  } catch {
    // no robots.txt: everything allowed
  }
  if (!robotsAllows(robots, new URL(home.res.url).pathname || "/")) {
    return { outcome: "robots", host, emails: [], pages: 0 };
  }

  const emails = new Set(extractEmails(home.body));
  let pages = 1;
  const links = pickLinks(home.body, home.res.url, (opts.maxPages ?? 5) - 1).filter((u) =>
    robotsAllows(robots, new URL(u).pathname),
  );
  for (const url of links) {
    await sleep(opts.pageDelayMs ?? 1_500);
    try {
      const page = await load(url);
      if (page.res.status === 403 || page.res.status === 429 || isChallenge(page.res, page.body)) break; // back off
      if (!page.res.ok) continue;
      pages++;
      for (const e of extractEmails(page.body)) emails.add(e);
    } catch {
      // skip this page
    }
    if (emails.size >= MAX_EMAILS) break;
  }
  return { outcome: "ok", host, emails: [...emails].slice(0, MAX_EMAILS), pages };
}
