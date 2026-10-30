// Catch-all pass: MailTester answers "catch-all" for every address at these companies,
// so no2bounce gets asked about each person's top combinations instead.
// From the Oct 2026 test (60 people): it never passed a made-up address, found about a
// quarter of people on Microsoft 365 and other servers, none on Google, and every hit
// was in the first 4 combinations. Its "UnDeliverable/AcceptAll" means "could not
// confirm", so a miss leaves the person catch-all, never not found.
import { createHash } from "node:crypto";
import type { Db } from "./db";
import { mailProvider } from "./dns";
import { fillName } from "./linkedin";
import { N2bRefused, type N2bClient, type N2bResult } from "./no2bounce";
import { buildLocal, isPatternId, type PatternId } from "./patterns";
import * as repo from "./repo";

/** Try order at catch-all companies: the 4 combinations that found people in the test. */
export const CATCH_ALL_PATTERNS: PatternId[] = ["first.last", "first", "firstlast", "first.l"];

/** Thrown to stop for now (24-hour credit budget used up). Undecided people are picked up later. */
export class CaPause extends Error {}
/** no2bounce is still checking: the person is picked up again later and the answer polled (free). */
export class CaPending extends Error {}

export type CaCheck = (email: string, pattern: string) => Promise<N2bResult>;

/** Made-up but stable per company, so asking again reuses the earlier answer. */
export const canaryFor = (domain: string) =>
  `zq${createHash("sha256").update(`canary:${domain}`).digest("hex").slice(0, 10)}@${domain}`;

export type CaCompany = { domain: string; pattern: PatternId | null; acceptsAll: boolean };

/**
 * One company's catch-all people, one at a time: the company's confirmed pattern first,
 * then the top combinations, stopping at the first deliverable. The company's first hit
 * is double-checked with a made-up address: if that passes too, nothing here is trusted.
 */
export async function verifyCatchAllCompany(args: {
  company: CaCompany;
  people: repo.CatchAllPerson[];
  check: CaCheck;
  combos?: number;
  onResult: (personId: string, hit: { email: string; pattern: PatternId } | null) => Promise<void>;
  onCompany: (patch: { pattern?: PatternId; acceptsAll?: boolean }) => Promise<void>;
}): Promise<{ checked: number; found: number }> {
  const company = { ...args.company };
  const tries = [company.pattern, ...CATCH_ALL_PATTERNS.slice(0, args.combos ?? CATCH_ALL_PATTERNS.length)];
  let checked = 0;
  let found = 0;
  for (const person of args.people) {
    if (company.acceptsAll) {
      await args.onResult(person.id, null);
      continue;
    }
    const name = person.linkedin ? fillName(person.first, person.last, person.linkedin) : person;
    const seen = new Set<string>();
    let hit: { email: string; pattern: PatternId } | null = null;
    for (const p of tries) {
      if (!p) continue;
      const local = buildLocal(p, name.first, name.last);
      if (!local || seen.has(local)) continue;
      seen.add(local);
      const email = `${local}@${company.domain}`;
      if ((await args.check(email, p)) === "deliverable") {
        hit = { email, pattern: p };
        break;
      }
    }
    if (hit && !company.pattern) {
      if ((await args.check(canaryFor(company.domain), "canary")) === "deliverable") {
        company.acceptsAll = true;
        await args.onCompany({ acceptsAll: true });
        hit = null;
      } else {
        company.pattern = hit.pattern;
        tries[0] = hit.pattern;
        await args.onCompany({ pattern: hit.pattern });
      }
    }
    await args.onResult(person.id, hit);
    checked++;
    if (hit) found++;
  }
  return { checked, found };
}

/**
 * One no2bounce check with everything around it: answers are reused for 90 days, a
 * check still in progress is polled instead of paid for again, and the 24-hour credit
 * budget is kept (throws CaPause when used up).
 */
export function createCaChecker(d: {
  db: Db;
  client: N2bClient;
  dailyLimit: number;
  sleep?: (ms: number) => Promise<void>;
  /** Polls while waiting for one answer (3s apart, then 15s), before giving up for now. */
  maxPolls?: number;
}): CaCheck {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPolls = d.maxPolls ?? 55; // about 10 minutes
  let used = 0;
  let syncedAt = 0;
  return async (email, pattern) => {
    const last = await repo.latestN2bCheck(d.db, email);
    let id: string;
    let trackingId: string;
    if (last && last.result !== "pending") return last.result as N2bResult;
    if (last?.tracking_id) {
      id = last.id;
      trackingId = last.tracking_id;
    } else {
      if (Date.now() - syncedAt > 60_000) {
        used = await repo.n2bCredits24h(d.db);
        syncedAt = Date.now();
      }
      if (used >= d.dailyLimit) throw new CaPause(`no2bounce daily limit of ${d.dailyLimit} credits reached`);
      trackingId = await d.client.submit(email);
      used++;
      id = await repo.startN2bCheck(d.db, email, pattern, trackingId);
    }
    for (let i = 0; i < maxPolls; i++) {
      await sleep(i < 20 ? 3_000 : 15_000);
      const answer = await d.client.poll(trackingId).catch((e) => {
        if (e instanceof N2bRefused) throw e;
        return null; // a failed poll is retried on the next round
      });
      if (answer) {
        await repo.finishN2bCheck(d.db, id, answer);
        return answer.result;
      }
    }
    throw new CaPending(`no2bounce still checking ${email}`);
  };
}

/**
 * One round of the pass: the next batch of unchecked catch-all people, their companies'
 * mail providers looked up (free DNS), skipped providers dropped, then companies in
 * parallel. Errors from one company (pause, refusal) stop the round; the people not
 * decided yet are picked up again next round.
 */
export async function catchAllRound(d: {
  db: Db;
  check: CaCheck;
  mxHost: (domain: string) => Promise<string | null>;
  skip: string[];
  combos?: number;
  concurrency?: number;
  batchSize?: number;
}): Promise<{ people: number; checked: number; found: number }> {
  const skip = [...d.skip, "none"]; // "none": no mail server any more, nothing to ask about
  const batch = await repo.catchAllPeople(d.db, skip, d.batchSize ?? 200);
  if (!batch.length) return { people: 0, checked: 0, found: 0 };
  const byDomain = new Map<string, repo.CatchAllPerson[]>();
  for (const p of batch) byDomain.set(p.domain, [...(byDomain.get(p.domain) ?? []), p]);

  const companies = await repo.catchAllCompanies(d.db, [...byDomain.keys()]);
  const queue: CaCompany[] = [];
  for (const c of companies) {
    let provider = c.mx_provider;
    if (!provider) {
      const host = await d.mxHost(c.domain);
      provider = host ? mailProvider(host) : "none";
      await repo.saveMxProvider(d.db, c.domain, provider);
    }
    if (skip.includes(provider)) continue; // next round's query leaves them out
    queue.push({ domain: c.domain, pattern: isPatternId(c.ca_pattern) ? c.ca_pattern : null, acceptsAll: !!c.ca_accepts_all });
  }

  const total = { people: batch.length, checked: 0, found: 0 };
  let failure: unknown = null;
  await Promise.all(
    Array.from({ length: d.concurrency ?? 5 }, async () => {
      for (let c = queue.shift(); c && !failure; c = queue.shift()) {
        const company = c;
        try {
          const r = await verifyCatchAllCompany({
            company,
            people: byDomain.get(company.domain) ?? [],
            check: d.check,
            combos: d.combos,
            onResult: (id, hit) => repo.saveCatchAllResult(d.db, id, hit),
            onCompany: (patch) => repo.saveCatchAllCompany(d.db, company.domain, patch),
          });
          total.checked += r.checked;
          total.found += r.found;
        } catch (e) {
          if (e instanceof CaPending) continue; // that company comes round again
          failure = e;
        }
      }
    }),
  );
  if (failure) throw failure;
  return total;
}
