// no2bounce client: a second opinion at catch-all companies, where MailTester
// answers "catch-all" for every address.
// API: POST /v2/n2b_validate_email {email} -> { data: { trackingId } }, then
// GET /v2/n2b_validate_email?trackingId=... until overallStatus is "Completed":
// { result: { scoreStatus: "Deliverable/AcceptAll", score }, creditDebited, refund }.
// A wrong key comes back as HTTP 500 ("error is not defined"), so the credit
// balance (GET /v2/n2b_validate_token) is the only reliable key check.

export type N2bResult = "deliverable" | "undeliverable" | "catch_all" | "risky" | "unknown";

/** "Deliverable/AcceptAll" -> deliverable. On catch-all servers "UnDeliverable/AcceptAll" means "could not confirm", not "does not exist". */
export function normalizeN2b(status: string): N2bResult {
  const s = status.toLowerCase();
  if (s.includes("undeliverable") || s.includes("invalid")) return "undeliverable";
  if (s.includes("deliverable") || s === "valid") return "deliverable";
  if (s.includes("catch")) return "catch_all";
  if (s.includes("risky")) return "risky";
  return "unknown";
}

export type N2bAnswer = { result: N2bResult; status: string; score: number | null; credits: number; raw: unknown };

/** The key or the credits do not work: stop calling for a while. */
export class N2bRefused extends Error {}

export type N2bClient = {
  /** Credits left; throws N2bRefused when the key does not work. */
  credits: () => Promise<number>;
  /** Starts a check (this is what costs a credit) and returns its tracking id. */
  submit: (email: string) => Promise<string>;
  /** The answer, or null while no2bounce is still checking. Free. */
  poll: (trackingId: string) => Promise<N2bAnswer | null>;
};

export function createN2bClient(opts: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): N2bClient {
  const base = opts.baseUrl ?? "https://connect.no2bounce.com/v2";
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers = { apitoken: opts.apiKey.trim(), "content-type": "application/json", accept: "application/json" };

  // Network errors, 429 and 5xx are retried a few times; refusals never are.
  const call = async (path: string, init?: RequestInit, tries = 4) => {
    let last = "";
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt) await sleep(2_000 * 2 ** attempt);
      let res: Response;
      try {
        res = await f(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
      } catch (e) {
        last = `network: ${(e as Error).message}`;
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const msg = String(body.message ?? "");
      if (res.ok) return body;
      if (res.status === 401 || res.status === 403 || /token|credit|balance|insufficient/i.test(msg)) {
        throw new N2bRefused(`no2bounce refused (${res.status}): ${msg}`);
      }
      last = `HTTP ${res.status}: ${msg}`;
    }
    throw new Error(`no2bounce ${path.split("?")[0]} failed: ${last}`);
  };

  return {
    async credits() {
      const body = await call("/n2b_validate_token", undefined, 2).catch((e) => {
        throw e instanceof N2bRefused ? e : new N2bRefused(`no2bounce key check failed: ${(e as Error).message}`);
      });
      const n = Number(body.credit);
      if (body.credit === undefined || !Number.isFinite(n)) throw new N2bRefused(`no2bounce key check failed: ${String(body.message ?? "no balance")}`);
      return n;
    },
    async submit(email) {
      const body = await call("/n2b_validate_email", { method: "POST", body: JSON.stringify({ email }) });
      const id = String((body.data as { trackingId?: unknown } | undefined)?.trackingId ?? "");
      if (!id) throw new Error(`no2bounce returned no trackingId: ${String(body.message ?? "")}`);
      return id;
    },
    async poll(trackingId) {
      const body = await call(`/n2b_validate_email?trackingId=${encodeURIComponent(trackingId)}`);
      if (String(body.overallStatus ?? "").toLowerCase() !== "completed") return null;
      const r = (body.result ?? {}) as { scoreStatus?: unknown; score?: unknown };
      const status = String(r.scoreStatus ?? "");
      const score = Number(r.score);
      return {
        result: normalizeN2b(status),
        status,
        score: Number.isFinite(score) ? score : null,
        credits: (Number(body.creditDebited) || 0) - (Number(body.refund) || 0),
        raw: body,
      };
    },
  };
}
