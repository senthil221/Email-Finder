// LinkedIn profile URLs, used without ever fetching LinkedIn: the URL itself says
// how a person spells their name, and acts as a stable ID for the person.
import { cleanName, PATTERNS, type BasePatternId, type Name } from "./patterns";

/** "https://www.linkedin.com/in/Senthil-Nathan-S-I-4a1b2c/?x" -> "senthil-nathan-s-i-4a1b2c". "" if not a profile URL. */
export function normalizeLinkedin(raw: string | null | undefined): string {
  const m = /linkedin\.com\/(?:mwlite\/)?in\/([^/?#\s]+)/i.exec(raw ?? "");
  if (!m) return "";
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // keep as is
  }
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 100);
}

/** Name words in a slug, without LinkedIn's random suffix: "senthil-nathan-s-i-4a1b2c" -> [senthil, nathan, s, i]. */
export function slugWords(slug: string): string[] {
  return slug
    .split("-")
    .filter((w) => w && !/\d/.test(w))
    .map((w) => cleanName(w).replace(/ /g, ""))
    .filter(Boolean);
}

/**
 * Fill a missing or initial-only first/last name from the profile URL.
 * "S." + "Kumar" with /in/sanjay-kumar-12ab -> "sanjay" + "Kumar".
 */
export function fillName(first: string, last: string, slug: string): { first: string; last: string } {
  const words = slugWords(slug).filter((w) => w.length > 1);
  if (words.length < 2) return { first, last };
  const f = cleanName(first).replace(/ /g, "");
  const l = cleanName(last).replace(/ /g, "");
  return {
    first: f.length > 1 ? first : words[0],
    last: l.length > 1 ? last : words[words.length - 1],
  };
}

/**
 * A custom handle often mirrors the person's email style: /in/rdeepak -> flast,
 * /in/andrewdeepak -> firstlast. Default "first-last-1234" URLs say nothing.
 */
export function handleHint(slug: string, name: Name): BasePatternId | null {
  if (!slug || slug.includes("-") || /\d/.test(slug) || !name.first) return null;
  for (const id of ["firstlast", "flast", "firstl", "fl", "first"] as const) {
    const local = PATTERNS.find((p) => p.id === id)!.build(name);
    if (local && local === slug) return id;
  }
  return null;
}
