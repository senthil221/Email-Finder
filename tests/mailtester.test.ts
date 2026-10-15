import { describe, expect, it } from "vitest";
import { classify, createMtnClient } from "@/lib/mailtester";

describe("classify", () => {
  it.each([
    [{ code: "ok", message: "Accepted" }, "valid"],
    [{ code: "ko", message: "Rejected" }, "invalid"],
    [{ code: "mb", message: "Catch-All" }, "catch_all"],
    [{ code: "ko", message: "No Mx" }, "no_mx"],
    [{ code: "mb", message: "Timeout" }, "retry"],
    [{ code: "mb", message: "Limited" }, "retry"],
    [{ code: "ko", message: "Mx Error" }, "retry"],
    [{ code: "ko", message: "SPAM Block" }, "retry"],
    [{ code: "mb", message: "Too Many Requests" }, "rate_limited"],
    [{ code: "ko", message: "Invalid Key" }, "fatal"],
    [{ code: "ko", message: "Something new" }, "retry"],
  ] as const)("%j -> %s", (res, verdict) => {
    expect(classify(res)).toBe(verdict);
  });

  it("uses the HTTP status for rate limits and auth errors", () => {
    expect(classify({}, 429)).toBe("rate_limited");
    expect(classify({}, 401)).toBe("fatal");
    expect(classify({}, 502)).toBe("retry");
  });
});

describe("createMtnClient", () => {
  it("calls the API with email and key and classifies the answer", async () => {
    let calledUrl = "";
    const fakeFetch = (async (url: string) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({ email: "a+x@b.com", code: "ok", message: "Accepted", mx: "mx.b.com" }),
      );
    }) as unknown as typeof fetch;
    const mtn = createMtnClient({ apiKey: "k&1", fetchImpl: fakeFetch });
    const r = await mtn("a+x@b.com");
    expect(calledUrl).toBe("https://happy.mailtester.ninja/ninja?email=a%2Bx%40b.com&key=k%261");
    expect(r.verdict).toBe("valid");
  });

  it("treats a network failure as retry, not invalid", async () => {
    const failing = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await createMtnClient({ apiKey: "k", fetchImpl: failing })("a@b.com");
    expect(r.verdict).toBe("retry");
  });
});

describe("createMtnClient: Prospect Sync's provider rules", () => {
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

  it("HTTP 429 pauses all calls for Retry-After (10s when missing)", async () => {
    const a = await createMtnClient({ apiKey: "k", fetchImpl: reply(429, {}, { "retry-after": "30" }) })("a@b.com");
    expect(a).toMatchObject({ verdict: "rate_limited", pauseMs: 30_000 });
    const b = await createMtnClient({ apiKey: "k", fetchImpl: reply(429, {}) })("a@b.com");
    expect(b.pauseMs).toBe(10_000);
  });

  it("a 5xx is an outage: retry, 60s pause, never a verdict", async () => {
    const r = await createMtnClient({ apiKey: "k", fetchImpl: reply(503, {}) })("a@b.com");
    expect(r).toMatchObject({ verdict: "retry", pauseMs: 60_000, transportFailure: true });
  });

  it("account problems pause for an hour", async () => {
    const r = await createMtnClient({ apiKey: "k", fetchImpl: reply(200, { code: "ko", message: "Account suspended" }) })("a@b.com");
    expect(r).toMatchObject({ verdict: "fatal", pauseMs: 3_600_000 });
  });

  it("a reply about a different address is not a result", async () => {
    const r = await createMtnClient({
      apiKey: "k",
      fetchImpl: reply(200, { email: "other@b.com", code: "ko", message: "Rejected" }),
    })("a@b.com");
    expect(r).toMatchObject({ verdict: "retry", transportFailure: true });
  });

  it("strips quotes and braces pasted around the key", async () => {
    let calledUrl = "";
    const f = (async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify({ email: "a@b.com", code: "ok", message: "Accepted" }));
    }) as unknown as typeof fetch;
    await createMtnClient({ apiKey: ' "{abc}" ', fetchImpl: f })("a@b.com");
    expect(calledUrl.endsWith("&key=abc")).toBe(true);
  });
});
