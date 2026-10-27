import { describe, it, expect, vi } from "vitest";
import { geminiRetryFetch, retryDelayMs } from "../lib/googleFetch";
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
