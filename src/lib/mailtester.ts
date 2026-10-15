// MailTester Ninja client + mapping of its answers to what the finder does next.
// API: GET https://happy.mailtester.ninja/ninja?email=...&key=...
// -> { email, user, domain, mx, code: "ok"|"ko"|"mb", message, connections }

export type MtnResponse = {
  email?: string;
  domain?: string;
  mx?: string;
  code?: string;
  message?: string;
  [k: string]: unknown;
};

export type Verdict =
  | "valid" // Accepted -> found, stop
  | "invalid" // Rejected -> try next combination
  | "catch_all" // whole company goes to the catch-all list
  | "no_mx" // domain cannot receive mail
  | "rate_limited" // our own speed limit: wait and retry the same address, not a result
  | "retry" // Timeout / Limited / Mx Error / SPAM Block: retry once, then unverified
  | "fatal"; // bad key, no credits, etc. -> stop the worker

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Route on the MESSAGE, never on ok/ko/mb alone. */
export function classify(res: MtnResponse, httpStatus = 200): Verdict {
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 401 || httpStatus === 403) return "fatal";
  const msg = norm(res.message);
  switch (msg) {
    case "accepted":
      return "valid";
    case "rejected":
      return "invalid";
    case "catchall":
      return "catch_all";
    case "nomx":
      return "no_mx";
    case "toomanyrequests":
      return "rate_limited";
    case "timeout":
    case "limited":
    case "mxerror":
    case "spamblock":
      return "retry";
  }
  if (msg.includes("toomany") || msg.includes("ratelimit")) return "rate_limited";
  if (/key|token|credit|subscription|unauthori|expired|quota|suspend|disabled/.test(msg)) return "fatal";
  if (httpStatus >= 500) return "retry";
  // Unknown message: never guess "invalid" from ko, that could hide a real email.
  return "retry";
}

export type MtnCall = {
  verdict: Verdict;
  message: string;
  code: string;
  raw: unknown;
  /** Pause ALL MailTester calls this long (429 Retry-After, outage, account problem). */
  pauseMs?: number;
  /** The request never reached a verdict (network error, timeout, 5xx, garbled reply). */
  transportFailure?: boolean;
};

export type MtnClient = (email: string) => Promise<MtnCall>;

/** Retry-After header (seconds or HTTP date) -> ms; 10s when missing. Same rule as Prospect Sync. */
export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 10_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, Math.min(seconds * 1000, 86_400_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1_000, Math.min(date - now, 86_400_000)) : 10_000;
}

export function createMtnClient(opts: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): MtnClient {
  const base = opts.baseUrl ?? "https://happy.mailtester.ninja/ninja";
  const f = opts.fetchImpl ?? fetch;
  // Keys are sometimes pasted with quotes or braces around them.
  const key = opts.apiKey.trim().replace(/^["'{]+|["'}]+$/g, "").trim();
  return async (email) => {
    const expected = email.trim().toLowerCase();
    const url = `${base}?email=${encodeURIComponent(expected)}&key=${encodeURIComponent(key)}`;
    let res: Response;
    try {
      res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000) });
    } catch (e) {
      // Network error / our own timeout: the server never got checked.
      return { verdict: "retry", message: `network: ${(e as Error).message}`, code: "", raw: null, transportFailure: true };
    }
    const text = await res.text().catch(() => "");
    let body: MtnResponse = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 200) };
    }
    const common = { message: String(body.message ?? ""), code: String(body.code ?? ""), raw: body };

    if (res.status === 429) return { ...common, verdict: "rate_limited", pauseMs: retryAfterMs(res.headers.get("retry-after")) };
    if (res.status === 401 || res.status === 403) return { ...common, verdict: "fatal", pauseMs: 3_600_000 };
    if (res.status >= 500) return { ...common, verdict: "retry", pauseMs: 60_000, transportFailure: true };

    const verdict = classify(body, res.status);
    if (verdict === "fatal") return { ...common, verdict, pauseMs: 3_600_000 };
    if (verdict === "rate_limited") return { ...common, verdict, pauseMs: 10_000 };
    // A reply about a different address is never a result for this one.
    if (verdict !== "retry" && String(body.email ?? "").trim().toLowerCase() !== expected) {
      return { ...common, verdict: "retry", message: "email mismatch in reply", transportFailure: true };
    }
    if (verdict === "retry" && !common.message) return { ...common, verdict, transportFailure: true };
    return { ...common, verdict };
  };
}
