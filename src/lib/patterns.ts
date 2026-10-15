// The name combinations, in the order they are tried: the 9 base ones first,
// then a few extras for multi-word given names (common in Indian names).
// To change the order, just reorder these arrays.
export type BasePatternId =
  | "first"
  | "first.last"
  | "firstlast"
  | "flast"
  | "firstl"
  | "first.l"
  | "first_last"
  | "fl"
  | "f.last";

export type ExtraPatternId = "first1.first2" | "first1" | "first1.last";

export type PatternId = BasePatternId | ExtraPatternId;

/**
 * A parsed name. `first` is every given-name word joined ("senthilnathan"),
 * `last` is the surname joined, or the first initial when only initials were
 * given ("Senthil Nathan S I" -> "s"). `words` are the given-name words.
 */
export type Name = { first: string; last: string; words: string[]; initialOnly: boolean };

type Builder = (n: Name) => string | null;

export const PATTERNS: { id: BasePatternId; build: Builder }[] = [
  { id: "first", build: (n) => n.first },
  { id: "first.last", build: ({ first: f, last: l }) => (l ? `${f}.${l}` : null) },
  { id: "firstlast", build: ({ first: f, last: l }) => (l ? `${f}${l}` : null) },
  // Initial-only surnames make 2-3 letter addresses (rk@, r.k@) that rarely exist.
  { id: "flast", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${f[0]}${l}` : null) },
  { id: "firstl", build: ({ first: f, last: l }) => (l ? `${f}${l[0]}` : null) },
  { id: "first.l", build: ({ first: f, last: l }) => (l ? `${f}.${l[0]}` : null) },
  { id: "first_last", build: ({ first: f, last: l }) => (l ? `${f}_${l}` : null) },
  { id: "fl", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${f[0]}${l[0]}` : null) },
  { id: "f.last", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${f[0]}.${l}` : null) },
];

/** Tried after the base 9, only for two-word given names ("Senthil Nathan"). */
export const EXTRA_PATTERNS: { id: ExtraPatternId; build: Builder }[] = [
  { id: "first1.first2", build: ({ words: w }) => (w.length > 1 ? `${w[0]}.${w[1]}` : null) },
  { id: "first1", build: ({ words: w }) => (w.length > 1 ? w[0] : null) },
  { id: "first1.last", build: ({ words: w, last: l }) => (w.length > 1 && l ? `${w[0]}.${l}` : null) },
];

export const ALL_PATTERNS = [...PATTERNS, ...EXTRA_PATTERNS];
export const PATTERN_IDS: PatternId[] = ALL_PATTERNS.map((p) => p.id);

export function isPatternId(v: unknown): v is PatternId {
  return typeof v === "string" && (PATTERN_IDS as string[]).includes(v);
}

/**
 * Lowercase, strip accents, keep words: "Dr. Senthil-Nathan" -> "dr senthil nathan".
 * Apostrophes join ("O'Brien" -> "obrien"); every other symbol separates words.
 */
export function cleanName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

const HONORIFICS = new Set(["dr", "er", "mr", "mrs", "ms", "miss", "prof", "shri", "smt"]);

/** Split a first + last name into the parts the patterns need. */
export function parseName(rawFirst: string, rawLast: string): Name {
  let given = cleanName(rawFirst).split(" ").filter(Boolean);
  const sur = cleanName(rawLast).split(" ").filter(Boolean);
  // "Dr Senthil", and "Dr" alone in the first-name column with the name in the last one.
  while (given.length && HONORIFICS.has(given[0]) && given.length + sur.length > 1) given.shift();
  if (!given.length && sur.length > 1) given = [sur.shift()!];

  const isInitial = (w: string) => w.length === 1;
  const givenWords = given.filter((w) => !isInitial(w));
  const words = givenWords.length ? givenWords : given;
  const initials = [...given.filter(isInitial), ...sur.filter(isInitial)];
  const surWords = sur.filter((w) => !isInitial(w));

  const last = surWords.length ? surWords.join("") : (initials.length && givenWords.length ? initials[0] : "");
  return { first: words.join(""), last, words, initialOnly: last.length === 1 };
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

/** The local part one pattern makes for a name, or null if it does not apply. */
export function buildLocal(id: PatternId, first: string, last: string): string | null {
  const n = parseName(first, last);
  if (!n.first) return null;
  return ALL_PATTERNS.find((p) => p.id === id)?.build(n) ?? null;
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
  const name = parseName(first, last);
  if (!name.first || !domain) return [];
  const pref = preferred ? ALL_PATTERNS.find((p) => p.id === preferred) : undefined;
  const order = pref ? [pref, ...ALL_PATTERNS.filter((p) => p !== pref)] : ALL_PATTERNS;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of order) {
    const local = p.build(name);
    if (!local) continue;
    const email = `${local}@${domain}`;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ pattern: p.id, email });
  }
  return out;
}
