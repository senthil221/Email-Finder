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
        JSON.stringify({ email: "a@b.com", code: "ok", message: "Accepted", mx: "mx.b.com" }),
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
