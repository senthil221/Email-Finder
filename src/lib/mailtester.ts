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
  if (/key|token|credit|subscription|unauthori|expired|quota/.test(msg)) return "fatal";
  if (httpStatus >= 500) return "retry";
  // Unknown message: never guess "invalid" from ko, that could hide a real email.
  return "retry";
}

export type MtnCall = { verdict: Verdict; message: string; code: string; raw: unknown };

export type MtnClient = (email: string) => Promise<MtnCall>;

export function createMtnClient(opts: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): MtnClient {
  const base = opts.baseUrl ?? "https://happy.mailtester.ninja/ninja";
  const f = opts.fetchImpl ?? fetch;
  return async (email) => {
    const url = `${base}?email=${encodeURIComponent(email)}&key=${encodeURIComponent(opts.apiKey)}`;
    let status = 0;
    let body: MtnResponse = {};
    try {
      const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000) });
      status = res.status;
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text.slice(0, 200) };
      }
    } catch (e) {
      // Network error / our own timeout: the server never got checked.
      return { verdict: "retry", message: `network: ${(e as Error).message}`, code: "", raw: null };
    }
    return {
      verdict: classify(body, status),
      message: String(body.message ?? ""),
      code: String(body.code ?? ""),
      raw: body,
    };
  };
}
