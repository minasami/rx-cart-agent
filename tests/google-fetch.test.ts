import { describe, it, expect, vi } from "vitest";
import { geminiRetryFetch as grf, retryDelayMs, ANSWERED_MODEL_HEADER, formatAttempt, type GeminiRetryOptions } from "../lib/googleFetch";
const quiet = { log: () => {} };
// Legacy-policy wrapper for the original retry tests (2 x 503 retries, 30s 429 wait); new defaults are tested below.
const geminiRetryFetch = (b: any, o: GeminiRetryOptions = {}) => grf(b, { retries503: 2, backoffMs: [1500, 4000], max429WaitMs: 30_000, ...quiet, ...o });
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

// Fake clock: sleep advances time instantly; base can "take" ms by advancing it too.
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } }; };
/** base() that never answers until its signal aborts (like a hung Gemini call). */
const hanging = (onCall?: (u: string) => void) => vi.fn().mockImplementation((u: string, init?: RequestInit) => {
  onCall?.(u);
  return new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("timed out"), { name: "TimeoutError" }))));
});
describe("geminiRetryFetch deadlines (no hung requests)", () => {
  it("aborts a hung attempt via its AbortSignal, falls back, and answers within the total budget", async () => {
    const calls: string[] = [];
    const base = vi.fn().mockImplementation((u: string, init?: RequestInit) => (calls.push(u), u.includes("/models/slow:"))
      ? hanging()(u, init) : Promise.resolve(ok()));
    const t0 = Date.now();
    const r = await grf(base as any, { fallbackModels: ["fast"], attemptTimeoutMs: 50, totalBudgetMs: 1000, ...quiet })(U("slow"), { body: "{}" });
    expect(r.status).toBe(200); expect(r.headers.get(ANSWERED_MODEL_HEADER)).toBe("fast");
    expect(calls).toEqual([U("slow"), U("fast")]); expect(Date.now() - t0).toBeLessThan(900);
  });
  it("returns a 504 DEADLINE_EXCEEDED once the total budget is spent, never hanging", async () => {
    const base = hanging();
    const r = await grf(base as any, { fallbackModels: ["b", "c"], attemptTimeoutMs: 40, totalBudgetMs: 100, ...quiet })(U("a"), { body: "{}" });
    expect(r.status).toBe(504); expect((await r.json()).error.status).toBe("DEADLINE_EXCEEDED");
    expect(base.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it("caps waits: a 429 retryDelay longer than max429WaitMs or the remaining budget is not waited out", async () => {
    const c = clock(), sleep = vi.fn(c.sleep);
    const base = vi.fn().mockImplementation(async (u: string) => (u.includes("/models/a:") ? err(429, [retryInfo("25s")]) : ok()));
    const r = await grf(base as any, { fallbackModels: ["b"], sleep, now: c.now, ...quiet })(U("a"));
    expect(r.status).toBe(200); expect(sleep).not.toHaveBeenCalled(); // default cap 10s < 25s: straight to the fallback
    const base2 = vi.fn().mockImplementation(async () => { c.advance(30_000); return err(429, [retryInfo("5s")]); });
    const r2 = await grf(base2 as any, { sleep, now: c.now, totalBudgetMs: 35_000, ...quiet })(U("a"));
    expect(r2.status).toBe(429); expect(base2).toHaveBeenCalledTimes(1); // 5s wait would not fit in the 5s left
  });
  it("default policy: one quick 503 retry per model, then the next model", async () => {
    const c = clock(), sleep = vi.fn(c.sleep);
    const base = vi.fn().mockImplementation(async () => err(503));
    const r = await grf(base as any, { fallbackModels: ["b"], sleep, now: c.now, ...quiet })(U("a"));
    expect(r.status).toBe(503); expect(base).toHaveBeenCalledTimes(4); expect(sleep.mock.calls.map(x => x[0])).toEqual([1500, 1500]);
  });
  it("logs one line per attempt with model, status and ms only (no URL, key or body)", async () => {
    const lines: string[] = [];
    const base = vi.fn().mockImplementation(async (u: string) => (u.includes("/models/a:") ? daily() : ok()));
    await grf(base as any, { fallbackModels: ["b"], log: a => lines.push(formatAttempt(a)) })(U("a") + "?key=SECRETKEY", { headers: { "x-goog-api-key": "SECRETKEY" }, body: "data:image/png;base64,SECRETIMG" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[gemini\] model=a status=429 ms=\d+ GenerateRequestsPerDayPerProjectPerModel-FreeTier retryIn=70000s$/);
    expect(lines[1]).toMatch(/^\[gemini\] model=b status=200 ms=\d+$/);
    expect(lines.join("\n")).not.toMatch(/SECRET|googleapis|base64/);
  });
  it("propagates a caller abort instead of falling back", async () => {
    const ac = new AbortController(); const base = hanging(() => setTimeout(() => ac.abort(), 5));
    await expect(grf(base as any, { fallbackModels: ["b"], ...quiet })(U("a"), { signal: ac.signal })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });
});
