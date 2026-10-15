// Free checks that never touch MailTester: MX records and website redirects.
import { Resolver } from "node:dns/promises";
import { cleanDomain } from "./patterns";

/** "mx": can receive mail. "none": no MX record (or a null MX). "error": could not tell (timeout, SERVFAIL). */
export type MxAnswer = "mx" | "none" | "error";

export type DnsDeps = {
  mx: (domain: string) => Promise<MxAnswer>;
  /** Where the company website ends up after redirects, as a bare domain; null if it does not load. */
  redirect: (domain: string) => Promise<string | null>;
};

const resolver = new Resolver({ timeout: 5_000, tries: 2 });

export async function lookupMx(domain: string): Promise<MxAnswer> {
  try {
    const records = await resolver.resolveMx(domain);
    // RFC 7505 null MX: a single record pointing at "." means "no mail here".
    const real = records.filter((r) => r.exchange && r.exchange !== ".");
    return real.length ? "mx" : "none";
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENODATA" || code === "ENOTFOUND" ? "none" : "error";
  }
}

export async function followRedirect(domain: string, timeoutMs = 8_000): Promise<string | null> {
  for (const scheme of ["https", "http"]) {
    try {
      const res = await fetch(`${scheme}://${domain}/`, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "Mozilla/5.0 (compatible; EmailFinder/1.0)" },
      });
      await res.body?.cancel().catch(() => {});
      const host = cleanDomain(res.url);
      if (host) return host;
    } catch {
      // try the next scheme
    }
  }
  return null;
}

export const realDns: DnsDeps = { mx: lookupMx, redirect: followRedirect };

// Redirects to these are a parked-domain sale page or a social profile, not the company's mail domain.
const NOT_A_COMPANY = [
  "sedo.com", "sedoparking.com", "dan.com", "afternic.com", "hugedomains.com", "godaddy.com", "bodis.com",
  "parkingcrew.net", "above.com", "namecheap.com", "uniregistry.com", "buydomains.com", "domainmarket.com",
  "squadhelp.com", "atom.com", "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "youtube.com", "google.com", "wix.com", "wixsite.com", "blogspot.com", "wordpress.com", "medium.com",
  "shopify.com", "myshopify.com", "indiamart.com", "justdial.com",
];
const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/** The .in / .com / .co.in siblings of a domain, in try order. */
export function twinDomains(domain: string): string[] {
  const m = /^(.+?)\.(co\.in|in|com)$/.exec(domain);
  if (!m) return [];
  const [, stem, tld] = m;
  const others = { com: ["in", "co.in"], in: ["com", "co.in"], "co.in": ["com", "in"] }[tld]!;
  return others.map((t) => `${stem}.${t}`);
}

/**
 * Another domain the company probably uses for mail, found for free: where its
 * website redirects, else a .in/.com/.co.in twin. Only domains with an MX record
 * (and that `usable` accepts) qualify.
 */
export async function findAlternateDomain(
  domain: string,
  dns: DnsDeps,
  usable: (domain: string) => Promise<boolean> = async () => true,
): Promise<string | null> {
  const ok = async (d: string) => d !== domain && (await usable(d)) && (await dns.mx(d)) === "mx";
  const target = await dns.redirect(domain).catch(() => null);
  if (
    target &&
    !under(target, domain) && // acme.com -> shop.acme.com is the same company and mail domain
    !NOT_A_COMPANY.some((b) => under(target, b)) &&
    (await ok(target))
  ) {
    return target;
  }
  for (const twin of twinDomains(domain)) if (await ok(twin)) return twin;
  return null;
}
