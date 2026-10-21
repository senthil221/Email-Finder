// The name combinations, in the order they are tried: the 9 base ones first,
// then extras: multi-word given names (common in Indian names), then
// surname-first and other rarer styles, so nobody at a live company is missed.
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

export type ExtraPatternId =
  | "first1.first2"
  | "first1"
  | "first1.last"
  | "last.first"
  | "first-last"
  | "lastfirst"
  | "last.f"
  | "lastf"
  | "last";

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

/** Tried after the base 9. The first three only for two-word given names ("Senthil Nathan"). */
export const EXTRA_PATTERNS: { id: ExtraPatternId; build: Builder }[] = [
  { id: "first1.first2", build: ({ words: w }) => (w.length > 1 ? `${w[0]}.${w[1]}` : null) },
  { id: "first1", build: ({ words: w }) => (w.length > 1 ? w[0] : null) },
  { id: "first1.last", build: ({ words: w, last: l }) => (w.length > 1 && l ? `${w[0]}.${l}` : null) },
  // Surname-first and dashed styles need a real surname, not an initial.
  { id: "last.first", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${l}.${f}` : null) },
  { id: "first-last", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${f}-${l}` : null) },
  { id: "lastfirst", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${l}${f}` : null) },
  { id: "last.f", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${l}.${f[0]}` : null) },
  { id: "lastf", build: ({ first: f, last: l, initialOnly }) => (l && !initialOnly ? `${l}${f[0]}` : null) },
  { id: "last", build: ({ last: l, initialOnly }) => (l && !initialOnly ? l : null) },
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
 * How the base 9 are tried: `order` (from your own finds) and `cap`, the most
 * base patterns tried per person (0 = all). Preferred patterns are always tried.
 */
export type Ladder = { order?: BasePatternId[]; cap?: number };

/** Base patterns ranked by how many people each found; ones with no data keep their default place after. */
export function rankPatterns(finds: { pattern: string; n: number }[]): BasePatternId[] {
  const count = new Map(finds.map((f) => [f.pattern, f.n]));
  const base = PATTERNS.map((p) => p.id);
  return [...base].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || base.indexOf(a) - base.indexOf(b));
}

/**
 * Candidate emails for a person, in try order: `preferred` patterns first (the
 * company's proven pattern, then hints about this person), then the base
 * patterns in ladder order up to the cap, then the multi-word-name extras.
 * Duplicates are dropped (e.g. when the last name is missing).
 */
export function candidates(
  first: string,
  last: string,
  domain: string,
  preferred?: PatternId | (PatternId | null | undefined)[] | null,
  ladder: Ladder = {},
): Candidate[] {
  const name = parseName(first, last);
  if (!name.first || !domain) return [];
  const prefIds = (Array.isArray(preferred) ? preferred : [preferred]).filter((p): p is PatternId => !!p);
  const prefs = prefIds.map((id) => ALL_PATTERNS.find((p) => p.id === id)).filter((p) => !!p);
  const ranked = ladder.order?.length
    ? [...ladder.order, ...PATTERNS.map((p) => p.id).filter((id) => !ladder.order!.includes(id))]
        .map((id) => PATTERNS.find((p) => p.id === id)!)
    : PATTERNS;
  const base = ladder.cap ? ranked.slice(0, ladder.cap) : ranked;
  const order = [...prefs, ...base, ...EXTRA_PATTERNS].filter((p, i, all) => all.indexOf(p) === i);
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
