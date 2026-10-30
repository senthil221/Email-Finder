// Catch-all test with no2bounce: can it tell real mailboxes apart at companies
// MailTester calls catch-all? Works on a sample of catch-all people: sample.csv in
// the output folder, or (first run on the server) pulled from the database and saved there.
//
// 1. Controls first: addresses catch-all companies publish on their own site, so
//    they should come back deliverable. If no2bounce resolves none of them (all
//    catch-all / unknown), its single check cannot help and the test stops there.
// 2. Per company: a made-up address first (if that comes back deliverable, it
//    cannot tell real from fake on this server and the rest is skipped), then the
//    top combinations in order, stopping at the first deliverable, or after 3
//    unresolved answers in a row. --full checks them all, to see whether more
//    than one comes back deliverable.
//
// Dry run by default: shows the plan and the most credits it could use.
//   On the server: docker compose exec worker node no2bounce-test.js [--go]
//   Locally:       npx tsx --env-file=.env.local scripts/no2bounce-test.ts [--go]
// Options: --people 60  --combos 10  --controls 15  --full  --force  --order first.last,first,...
// Output folder: .local/no2bounce locally, /tmp/no2bounce in the container (NO2BOUNCE_DIR overrides).
// Every submission and answer is saved to calls.jsonl there; a rerun reuses them (and
// polls submissions still in progress), never paying twice for one address.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Papa from "papaparse";
import { pgDb } from "../src/lib/db";
import { buildLocal, isPatternId, type PatternId } from "../src/lib/patterns";

const DIR = process.env.NO2BOUNCE_DIR || (existsSync(".local") ? ".local/no2bounce" : join(tmpdir(), "no2bounce"));
const API = "https://connect.no2bounce.com/v2";

// The 10 combinations that found the most people in production (Oct 2026).
const TOP: PatternId[] = ["first.last", "first", "firstlast", "first.l", "fl", "flast", "firstl", "last", "last.first", "f.last"];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const go = flag("go");
const full = flag("full");
const force = flag("force");
const maxPeople = Number(opt("people", "60"));
const maxCombos = Number(opt("combos", "10"));
const maxControls = Number(opt("controls", "15"));
const order = opt("order", TOP.join(",")).split(",").filter(isPatternId).slice(0, maxCombos);

type Row = { kind: string; id: string; first: string; last: string; domain: string; provider: string; mx: string; known_email: string };
/** `result` is ours (deliverable | undeliverable | catch_all | risky | unknown | error); `status` is no2bounce's own scoreStatus. */
type Answer = { result: string; status: string; score: number | null; credits: number; trackingId?: string; raw?: unknown };
type Call = { kind: string; provider: string; domain: string; first: string; last: string; step: string; pattern: string; email: string; answer: Answer };

// 20 catch-all people per mail provider (one per company, with a real surname), plus
// 15 controls: people found on the website of a catch-all company.
const SAMPLE_SQL = `
  with prov as (
    select distinct on (domain) domain, lower(raw->>'mx') mx
    from verifications where verdict = 'catch_all' and domain is not null
    order by domain, id desc
  ), people as (
    select distinct on (r.domain) r.id::text, r.first, r.last, r.domain,
      case when p.mx like '%google%' then 'google' when p.mx like '%outlook%' then 'm365' else 'other' end provider,
      coalesce(p.mx, '') mx
    from job_rows r join prov p on p.domain = r.domain
    where r.status = 'catch_all' and length(r.last) > 1
    order by r.domain, random()
  )
  select 'catch_all' kind, id, first, last, domain, provider, mx, '' known_email
  from (select *, row_number() over (partition by provider order by random()) rn from people) x
  where rn <= 20
  union all
  select 'control', r.id::text, r.first, r.last, r.domain, '', '', r.email
  from (select r.* from job_rows r join domains d on d.domain = r.domain
        where r.status = 'found' and r.reason = 'website' and d.status = 'catch_all'
        order by random() limit 15) r`;

async function loadSample(): Promise<Row[]> {
  mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/sample.csv`;
  if (!existsSync(file)) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error(`No ${file} and no DATABASE_URL to pull a sample from.`);
    const db = pgDb(url, 1);
    const rows = await db.query<Row>(SAMPLE_SQL).finally(() => db.end());
    writeFileSync(file, Papa.unparse(rows));
    console.log(`Pulled a new sample from the database into ${file}`);
  }
  return Papa.parse<Row>(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true }).data;
}

const combosFor = (r: Row) =>
  order
    .map((p) => ({ pattern: p, local: buildLocal(p, r.first, r.last) }))
    .filter((c): c is { pattern: PatternId; local: string } => !!c.local)
    .filter((c, i, all) => all.findIndex((x) => x.local === c.local) === i)
    .map((c) => ({ pattern: c.pattern, email: `${c.local}@${r.domain}` }));
/** Made-up but stable per company, so a rerun asks about the same address (and reuses its answer). */
const canaryFor = (domain: string) => `zq${createHash("sha256").update(`canary:${domain}`).digest("hex").slice(0, 10)}@${domain}`;

const token = (process.env.NO2BOUNCE_API_KEY ?? "").trim();
const headers = { apitoken: token, "content-type": "application/json", accept: "application/json" };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Stop extends Error {}

/** no2bounce's scoreStatus -> one of our words. */
function normalize(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("undeliverable") || s.includes("invalid")) return "undeliverable";
  if (s.includes("deliverable") || s === "valid") return "deliverable";
  if (s.includes("catch")) return "catch_all";
  if (s.includes("risky")) return "risky";
  return "unknown";
}
const RESOLVED = new Set(["deliverable", "undeliverable"]);

// Earlier runs: finished answers are reused, submissions still in progress are polled (free).
const LOG = `${DIR}/calls.jsonl`;
const past = new Map<string, Answer>();
const submitted = new Map<string, string>();
function loadLog() {
  if (!existsSync(LOG)) return;
  for (const line of readFileSync(LOG, "utf8").split("\n").filter(Boolean)) {
    const c = JSON.parse(line) as { email: string; trackingId?: string; answer?: Answer };
    if (c.trackingId) submitted.set(c.email, c.trackingId);
    if (c.answer && c.answer.result !== "error" && c.answer.result !== "pending") past.set(c.email, c.answer);
  }
}

async function api(path: string, init?: RequestInit, tries = 5): Promise<{ status: number; body: Record<string, unknown> }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { ...init, headers, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const msg = String(body.message ?? "");
    if (res && (res.status === 401 || res.status === 403 || (/token|credit|balance|insufficient/i.test(msg) && !res.ok))) {
      throw new Stop(`no2bounce refused (${res.status}): ${msg}`);
    }
    if (res && res.ok) return { status: res.status, body };
    if (attempt >= tries - 1) return { status: res?.status ?? 0, body };
    await sleep(3_000 * 2 ** attempt); // network, 429, 5xx
  }
}

async function verify(email: string): Promise<Answer> {
  const cached = past.get(email);
  if (cached) return cached;
  let trackingId = submitted.get(email);
  if (!trackingId) {
    const { body } = await api("/n2b_validate_email", { method: "POST", body: JSON.stringify({ email }) });
    trackingId = String((body.data as { trackingId?: unknown } | undefined)?.trackingId ?? "");
    if (!trackingId) return { result: "error", status: String(body.message ?? "no trackingId"), score: null, credits: 0, raw: body };
    submitted.set(email, trackingId);
    appendFileSync(LOG, JSON.stringify({ email, trackingId }) + "\n"); // so a rerun polls instead of paying again
  }
  // Catch-all checks can take a while: every 3s for a minute, then every 15s, up to 10 minutes.
  for (let i = 0; i < 55; i++) {
    await sleep(i < 20 ? 3_000 : 15_000);
    const { body } = await api(`/n2b_validate_email?trackingId=${encodeURIComponent(trackingId)}`);
    if (String(body.overallStatus ?? "").toLowerCase() !== "completed") continue;
    const result = (body.result ?? {}) as { scoreStatus?: unknown; score?: unknown };
    const status = String(result.scoreStatus ?? "");
    const score = Number(result.score);
    return {
      result: normalize(status),
      status,
      score: Number.isFinite(score) ? score : null,
      credits: (Number(body.creditDebited) || 0) - (Number(body.refund) || 0),
      trackingId,
      raw: body,
    };
  }
  return { result: "pending", status: "still verifying", score: null, credits: 0, trackingId };
}

const calls: Call[] = [];
async function check(r: Row, step: string, pattern: string, email: string): Promise<Answer> {
  const answer = await verify(email);
  const call = { kind: r.kind, provider: r.provider, domain: r.domain, first: r.first, last: r.last, step, pattern, email, answer };
  calls.push(call);
  if (!past.has(email)) appendFileSync(LOG, JSON.stringify(call) + "\n");
  if (answer.result !== "error" && answer.result !== "pending") past.set(email, answer);
  console.log(`${step.padEnd(7)} ${answer.result.padEnd(13)} ${String(answer.score ?? "").padStart(3)}  ${email}  (${answer.status})`);
  return answer;
}

async function person(r: Row) {
  if (r.kind === "control") {
    await check(r, "control", "", r.known_email);
    return;
  }
  const canary = await check(r, "canary", "", canaryFor(r.domain));
  if (canary.result === "deliverable" && !full) return; // cannot tell real from made-up here
  let unresolved = 0;
  for (const c of combosFor(r)) {
    const a = await check(r, "combo", c.pattern, c.email);
    if (a.result === "deliverable" && !full) return;
    unresolved = RESOLVED.has(a.result) ? 0 : unresolved + 1;
    if (unresolved >= 3 && !full) return; // no answer on this server
  }
}

async function pool(list: Row[]) {
  const queue = [...list];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let r = queue.shift(); r; r = queue.shift()) await person(r);
    }),
  );
}

async function main() {
  const rows = await loadSample();

  // Take catch-all people evenly across providers, so each provider gets a fair share.
  const byProvider = new Map<string, Row[]>();
  for (const r of rows.filter((r) => r.kind === "catch_all")) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);
  const people: Row[] = [];
  for (let i = 0; people.length < maxPeople && [...byProvider.values()].some((l) => l.length > i); i++) {
    for (const list of byProvider.values()) if (list[i] && people.length < maxPeople) people.push(list[i]);
  }
  const controls = rows.filter((r) => r.kind === "control" && r.known_email).slice(0, maxControls);

  const maxCredits = people.reduce((s, r) => s + 1 + combosFor(r).length, 0) + controls.length;
  console.log(`Sample: ${people.length} catch-all people (${[...byProvider.keys()].map((p) => `${p} ${people.filter((r) => r.provider === p).length}`).join(", ")}), ${controls.length} controls`);
  console.log(`Combinations, in order: ${order.join(" > ")}${full ? " (all of them, --full)" : " (stop at the first deliverable)"}`);
  console.log(`Most credits this can use: ${maxCredits} (usually far fewer: it stops early)`);
  if (!go) {
    const ex = people[0];
    if (ex) console.log(`Example: ${ex.first} ${ex.last} @ ${ex.domain}: ${combosFor(ex).map((c) => c.email).join(", ")}`);
    console.log("Dry run only. Add --go to spend credits.");
    return;
  }

  if (!token) throw new Stop("Set NO2BOUNCE_API_KEY first (server: /docker/email-finder/.env; locally: .env.local).");
  // A wrong key comes back as HTTP 500 ("error is not defined"), so only a credit balance proves the key works.
  const { status, body: acct } = await api("/n2b_validate_token", undefined, 2);
  const credits = Number(acct.credit);
  if (acct.credit === undefined || !Number.isFinite(credits)) {
    throw new Stop(`Could not confirm the key (HTTP ${status}: ${String(acct.message ?? "no answer")}). Check NO2BOUNCE_API_KEY.`);
  }
  console.log(`no2bounce credits available: ${credits}`);
  if (credits < maxCredits) throw new Stop(`Not enough credits for the worst case (${maxCredits}). Use fewer --people or --combos.`);

  loadLog();
  try {
    console.log("\n-- controls (should be deliverable) --");
    await pool(controls);
    const resolved = calls.filter((c) => c.step === "control" && RESOLVED.has(c.answer.result)).length;
    if (controls.length >= 5 && resolved === 0 && !force) {
      console.error("\nno2bounce resolved none of the controls: its single check does not verify catch-alls. Stopping (--force to go on).");
    } else {
      console.log("\n-- catch-all people --");
      await pool(people);
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    console.error(e.message);
  }
  report(people);
}

function report(people: Row[]) {
  const count = (values: string[]) => {
    const m: Record<string, number> = {};
    for (const v of values) m[v] = (m[v] ?? 0) + 1;
    return m;
  };
  const providers = [...new Set(people.map((p) => p.provider))];
  const outcome = (r: Row) => {
    const own = calls.filter((c) => c.domain === r.domain && c.first === r.first && c.last === r.last);
    if (!own.length) return "not_run";
    const hits = own.filter((c) => c.step === "combo" && c.answer.result === "deliverable");
    if (own.find((c) => c.step === "canary")?.answer.result === "deliverable") return "no_signal"; // made-up address passed too
    if (hits.length > 1) return "ambiguous"; // --full only: several combinations passed
    if (hits.length === 1) return "deliverable";
    if (own.some((c) => c.step === "combo" && !RESOLVED.has(c.answer.result))) return "unresolved";
    return "all_undeliverable";
  };
  const summary = {
    credits_used: calls.reduce((s, c) => s + c.answer.credits, 0),
    controls: count(calls.filter((c) => c.step === "control").map((c) => c.answer.result)),
    canary_by_provider: Object.fromEntries(
      providers.map((p) => [p, count(calls.filter((c) => c.step === "canary" && c.provider === p).map((c) => c.answer.result))]),
    ),
    people_by_provider: Object.fromEntries(
      providers.map((p) => {
        const mine = people.filter((r) => r.provider === p);
        return [p, { people: mine.length, ...count(mine.map(outcome)) }];
      }),
    ),
    winning_patterns: count(calls.filter((c) => c.step === "combo" && c.answer.result === "deliverable").map((c) => c.pattern)),
    no2bounce_statuses: count(calls.map((c) => c.answer.status || "?")),
  };
  writeFileSync(`${DIR}/summary.json`, JSON.stringify(summary, null, 2));
  const out = calls.map((c) => ({
    kind: c.kind,
    provider: c.provider,
    domain: c.domain,
    first: c.first,
    last: c.last,
    step: c.step,
    pattern: c.pattern,
    email: c.email,
    result: c.answer.result,
    no2bounce_status: c.answer.status,
    score: c.answer.score ?? "",
    credits: c.answer.credits,
  }));
  writeFileSync(`${DIR}/results.csv`, Papa.unparse(out));
  console.log("\n" + JSON.stringify(summary, null, 2));
  console.log(`\nSaved ${DIR}/results.csv and ${DIR}/summary.json`);
}

main().catch((e) => {
  console.error(e instanceof Stop ? e.message : e);
  process.exit(1);
});
