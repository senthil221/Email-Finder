// The 9 name combinations, in the order they are tried.
// To change the order, just reorder this array.
export type PatternId =
  | "first"
  | "first.last"
  | "firstlast"
  | "flast"
  | "firstl"
  | "first.l"
  | "first_last"
  | "fl"
  | "f.last";

type Builder = (first: string, last: string) => string | null;

export const PATTERNS: { id: PatternId; build: Builder }[] = [
  { id: "first", build: (f) => f },
  { id: "first.last", build: (f, l) => (l ? `${f}.${l}` : null) },
  { id: "firstlast", build: (f, l) => (l ? `${f}${l}` : null) },
  { id: "flast", build: (f, l) => (l ? `${f[0]}${l}` : null) },
  { id: "firstl", build: (f, l) => (l ? `${f}${l[0]}` : null) },
  { id: "first.l", build: (f, l) => (l ? `${f}.${l[0]}` : null) },
  { id: "first_last", build: (f, l) => (l ? `${f}_${l}` : null) },
  { id: "fl", build: (f, l) => (l ? `${f[0]}${l[0]}` : null) },
  { id: "f.last", build: (f, l) => (l ? `${f[0]}.${l}` : null) },
];

export const PATTERN_IDS = PATTERNS.map((p) => p.id);

export function isPatternId(v: unknown): v is PatternId {
  return typeof v === "string" && (PATTERN_IDS as string[]).includes(v);
}

/** Lowercase, strip accents and everything that is not a-z. */
export function cleanName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** "https://www.B2BDrive.net/about?x=1" -> "b2bdrive.net". Returns "" if it does not look like a domain. */
export function cleanDomain(raw: string | null | undefined): string {
  let d = (raw ?? "").trim().toLowerCase();
  if (d.includes("@")) d = d.slice(d.lastIndexOf("@") + 1);
  d = d.replace(/^[a-z]+:\/\//, "");
  d = d.split(/[/?#\s]/)[0];
  d = d.replace(/:\d+$/, "");
  d = d.replace(/^www\d*\./, "");
  d = d.replace(/\.+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : "";
}

export type Candidate = { pattern: PatternId; email: string };

/**
 * Candidate emails for a person, in try order. If `preferred` is given
 * (the company's known pattern) it goes first. Duplicates are dropped
 * (e.g. when the last name is missing).
 */
export function candidates(
  first: string,
  last: string,
  domain: string,
  preferred?: PatternId | null,
): Candidate[] {
  if (!first || !domain) return [];
  const order = preferred
    ? [PATTERNS.find((p) => p.id === preferred)!, ...PATTERNS.filter((p) => p.id !== preferred)]
    : PATTERNS;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of order) {
    const local = p.build(first, last);
    if (!local) continue;
    const email = `${local}@${domain}`;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ pattern: p.id, email });
  }
  return out;
}
