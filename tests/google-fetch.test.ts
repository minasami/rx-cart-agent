import { describe, it, expect, vi } from "vitest";
import { geminiRetryFetch, retryDelayMs, ANSWERED_MODEL_HEADER } from "../lib/googleFetch";
const err = (status: number, details: unknown[] = []) => new Response(JSON.stringify({ error: { code: status, status: status === 429 ? "RESOURCE_EXHAUSTED" : "UNAVAILABLE", message: "x", details } }), { status });
const ok = () => new Response("{}", { status: 200 });
const retryInfo = (d: string) => ({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: d });
describe("geminiRetryFetch", () => {
  it("retries 503 with backoff, then succeeds", async () => {
    const base = vi.fn().mockResolvedValueOnce(err(503)).mockResolvedValueOnce(err(503)).mockResolvedValueOnce(ok());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await geminiRetryFetch(base as any, { sleep })("u", { body: "{}" });
    expect(r.status).toBe(200); expect(base).toHaveBeenCalledTimes(3); expect(sleep.mock.calls.map(c => c[0])).toEqual([1500, 4000]);
  });
  it("gives up on 503 after the retry budget", async () => {
    const base = vi.fn().mockImplementation(async () => err(503));
    const r = await geminiRetryFetch(base as any, { sleep: async () => {} })("u");
    expect(r.status).toBe(503); expect(base).toHaveBeenCalledTimes(3);
  });
  it("waits for RetryInfo once on 429 instead of hammering the quota", async () => {
    const base = vi.fn().mockResolvedValueOnce(err(429, [retryInfo("15s")])).mockResolvedValueOnce(ok());
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect((await geminiRetryFetch(base as any, { sleep })("u")).status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(15_500); expect(base).toHaveBeenCalledTimes(2);
  });
  it("fails fast on 429 without RetryInfo, with a long delay (e.g. daily quota), or after one wait", async () => {
    for (const first of [err(429), err(429, [retryInfo("3600s")])]) {
      const base = vi.fn().mockResolvedValue(first);
      expect((await geminiRetryFetch(base as any, { sleep: async () => {} })("u")).status).toBe(429); expect(base).toHaveBeenCalledTimes(1);
    }
    const base = vi.fn().mockImplementation(async () => err(429, [retryInfo("2s")]));
    expect((await geminiRetryFetch(base as any, { sleep: async () => {} })("u")).status).toBe(429); expect(base).toHaveBeenCalledTimes(2);
  });
  it("parses retryDelay and leaves the response body readable", async () => {
    const r = err(429, [retryInfo("1.2s")]);
    expect(await retryDelayMs(r)).toBe(1200); expect((await r.json()).error.code).toBe(429);
    expect(await retryDelayMs(new Response("not json", { status: 429 }))).toBeUndefined();
  });
});

const U = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const daily = () => err(429, [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, retryInfo("70000s")]);
describe("geminiRetryFetch model fallback (free-tier quotas are per model)", () => {
  it("falls back to the next model on a daily-quota 429, tags the answering model, and skips the exhausted one afterwards", async () => {
    const base = vi.fn().mockImplementation(async (u: string) => (u.includes("/models/primary:") ? daily() : ok()));
    let t = 1_000;
    const f = geminiRetryFetch(base as any, { fallbackModels: ["fb1", "fb2"], sleep: async () => {}, now: () => t });
    const r = await f(U("primary"), { method: "POST", body: "{}" });
    expect(r.status).toBe(200); expect(r.headers.get(ANSWERED_MODEL_HEADER)).toBe("fb1");
    expect(base.mock.calls.map(c => c[0])).toEqual([U("primary"), U("fb1")]);
    await f(U("primary"), { body: "{}" });
    expect(base.mock.calls.at(-1)![0]).toBe(U("fb1")); expect(base).toHaveBeenCalledTimes(3); // primary skipped while exhausted
    t += 70_000_000; await f(U("primary"), { body: "{}" });
    expect(base.mock.calls.at(-2)![0]).toBe(U("primary")); // retried after its quota window
  });
  it("falls back after 503 retries are used up; returns the last error when every model fails", async () => {
    const base = vi.fn().mockImplementation(async () => err(503));
    const r = await geminiRetryFetch(base as any, { fallbackModels: ["fb1"], sleep: async () => {} })(U("primary"));
    expect(r.status).toBe(503); expect(base).toHaveBeenCalledTimes(6);
  });
  it("tags the primary model on success and passes non-model URLs through", async () => {
    const base = vi.fn().mockImplementation(async () => ok());
    const f = geminiRetryFetch(base as any, { fallbackModels: ["fb1"] });
    expect((await f(U("primary"))).headers.get(ANSWERED_MODEL_HEADER)).toBe("primary");
    expect((await f("https://example.test/other")).headers.get(ANSWERED_MODEL_HEADER)).toBeNull();
  });
  it("does not fall back on a client error (e.g. bad request)", async () => {
    const base = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    expect((await geminiRetryFetch(base as any, { fallbackModels: ["fb1"] })(U("primary"))).status).toBe(400); expect(base).toHaveBeenCalledTimes(1);
  });
});
