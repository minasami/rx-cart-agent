import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { aiProvider, aiModel, resolveModel, extractPrescription, googleFallbacks, DEFAULT_GOOGLE_FALLBACKS, DEFAULT_GOOGLE_MODEL, DEFAULT_AI_MODEL, MOCK_FIXTURES } from "../lib/ai";
import { runAgent } from "../lib/agent";
import { providerErrorInfo, publicReason } from "../lib/providerError";
import { POST as extract } from "../app/api/extract/route";
import { POST as agent } from "../app/api/agent/route";
import { GET as config } from "../app/api/config/route";
import { _resetPinLimiter } from "../lib/ratelimit";
import { cartHash } from "../lib/approval";
import { buildCart } from "../lib/cart";

const FAKE_KEY = "test-google-key-not-real";
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const IMG = "data:image/png;base64,iVBORw0KGgo=";
const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
/** A Gemini API generateContent response (what the real HTTP endpoint returns). */
const gemini = (parts: unknown[], finishReason = "STOP") => new Response(JSON.stringify({
  candidates: [{ content: { role: "model", parts }, finishReason }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
}), { status: 200, headers: { "content-type": "application/json" } });
beforeEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); _resetPinLimiter(); vi.stubEnv("AI_PROVIDER", "google"); vi.stubEnv("AI_MODEL", ""); vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", FAKE_KEY); });

describe("google provider selection", () => {
  it("AI_PROVIDER=google selects Gemini with its own default model, overridable via AI_MODEL", () => {
    expect(aiProvider()).toBe("google");
    expect(aiModel()).toBe(DEFAULT_GOOGLE_MODEL);
    vi.stubEnv("AI_MODEL", " gemini-3-flash-preview "); expect(aiModel()).toBe("gemini-3-flash-preview");
    const m = resolveModel();
    expect(typeof m).toBe("object");
    expect(m).toMatchObject({ modelId: "gemini-3-flash-preview" });
    expect((m as any).provider).toMatch(/^google/);
  });
  it("mock and gateway paths are unchanged", () => {
    vi.stubEnv("AI_PROVIDER", "gateway"); expect(aiProvider()).toBe("gateway"); expect(resolveModel()).toBe(DEFAULT_AI_MODEL);
    vi.stubEnv("AI_PROVIDER", ""); expect(aiProvider()).toBe("mock");
    vi.stubEnv("AI_PROVIDER", "GOOGLE"); expect(aiProvider()).toBe("google");
  });
  it("/api/config reports ai: google", async () => expect((await (await config()).json()).ai).toBe("google"));
});

describe("extraction via google (mocked)", () => {
  it("reports provider google and gives thinking models more output headroom", async () => {
    const m = new MockLanguageModelV4({ modelId: "gemini-mock", doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify({ items: MOCK_FIXTURES["rx-2.png"] }) }], finishReason: { unified: "stop", raw: "STOP" }, usage, warnings: [] }) as any });
    const r = await extractPrescription(IMG, "rx-2.png", m);
    expect(r).toMatchObject({ provider: "google", model: "gemini-mock", items: MOCK_FIXTURES["rx-2.png"] });
    expect(m.doGenerateCalls[0].maxOutputTokens).toBe(4000);
  });
  it("/api/extract calls the Gemini API with the image, key in a header (never the URL), and returns sanitized items", async () => {
    const f = vi.fn().mockResolvedValue(gemini([{ text: JSON.stringify({ items: [{ name: "Fictamol 500 mg tablets — qty 2", quantity: 2 }, { name: "SYNTHETIC — DEMO ONLY", quantity: 1 }, { name: "Demoxin 100 mg syrup", quantity: 1 }] }) }]));
    vi.stubGlobal("fetch", f);
    const r = await extract(post({ imageDataUrl: IMG, sampleId: "rx-1.png" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ provider: "google", model: DEFAULT_GOOGLE_MODEL, items: MOCK_FIXTURES["rx-1.png"] });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain(`/models/${DEFAULT_GOOGLE_MODEL}:generateContent`);
    expect(String(url)).not.toContain(FAKE_KEY);
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe(FAKE_KEY);
    const body = JSON.parse(init.body);
    expect(JSON.stringify(body.contents)).toContain("inlineData");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });
  it("free-tier 429 becomes a readable 502 without leaking the key or image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }), { status: 429, headers: { "content-type": "application/json" } })));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await extract(post({ imageDataUrl: IMG }));
    const logged = JSON.stringify(spy.mock.calls); spy.mockRestore();
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.error).toMatch(/^Extraction failed: Gemini API rate limit or quota reached/);
    expect(logged + JSON.stringify(j)).not.toContain(FAKE_KEY);
    expect(logged).not.toContain("iVBORw0KGgo");
  }, 20_000);
});

describe("agent via google (mocked)", () => {
  it("runAgent reports provider google", async () => {
    let i = 0;
    const m = new MockLanguageModelV4({ modelId: "gemini-mock", doGenerate: async () => (i++ === 0
      ? { content: [{ type: "tool-call", toolCallId: "a", toolName: "build_cart", input: "{}" }], finishReason: { unified: "tool-calls", raw: "STOP" }, usage, warnings: [] }
      : { content: [{ type: "text", text: "Cart built." }], finishReason: { unified: "stop", raw: "STOP" }, usage, warnings: [] }) as any });
    const r = await runAgent({ items: [{ name: "Fictamol 500 mg tablets", quantity: 1 }], approved: false, createOrder: vi.fn(), useModel: true, model: m, provider: "google" });
    expect(r).toMatchObject({ provider: "google", model: "gemini-mock", text: "Cart built." });
  });
  it("/api/agent drives Gemini tool calls end to end (mock PayPal), one order, approval token issued", async () => {
    vi.stubEnv("PAYPAL_MODE", "mock"); vi.stubEnv("PHARMACIST_DEMO_PIN", "4821");
    const replies = [
      gemini([{ functionCall: { name: "build_cart", args: {} }, thoughtSignature: "c2ln" }]),
      gemini([{ functionCall: { name: "create_paypal_order", args: {} }, thoughtSignature: "c2ln" }]),
      gemini([{ text: "Order created." }]),
    ];
    const f = vi.fn().mockImplementation(async () => replies.shift() ?? gemini([{ text: "" }]));
    vi.stubGlobal("fetch", f);
    const items = [{ name: "Fictamol 500 mg tablets", quantity: 2 }];
    const r = await agent(post({ items, pharmacistPin: "4821", cartHash: cartHash(buildCart(items)) }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ provider: "google", model: DEFAULT_GOOGLE_MODEL, approved: true, paypal: "mock", text: "Order created." });
    expect(j.trace.map((t: any) => t.tool)).toEqual(["build_cart", "create_paypal_order"]);
    expect(j.approval.orderID).toMatch(/^MOCK-/);
    const tools = JSON.parse(f.mock.calls[0][1].body).tools;
    expect(JSON.stringify(tools)).toContain("create_paypal_order");
    expect(JSON.stringify(f.mock.calls.map(c => c[1].body))).not.toContain("4821");
  });
});

describe("Gemini error mapping", () => {
  const err = (statusCode: number, status: string, message = "x") => Object.assign(new Error(message), { name: "AI_APICallError", statusCode, responseBody: JSON.stringify({ error: { code: statusCode, message, status } }) });
  it("maps Gemini status codes to readable reasons", () => {
    expect(publicReason(providerErrorInfo(err(429, "RESOURCE_EXHAUSTED")), "google")).toMatch(/Gemini API rate limit/);
    expect(publicReason(providerErrorInfo(err(503, "UNAVAILABLE")), "google")).toMatch(/Gemini API model is overloaded/);
    expect(publicReason(providerErrorInfo(err(404, "NOT_FOUND")), "google")).toBe("the configured AI_MODEL is not available on Gemini API");
    expect(publicReason(providerErrorInfo(err(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.")), "google")).toBe("Gemini API rejected the API key");
  });
});
describe("retry-wrapped errors", () => {
  it("classifies AI_RetryError by its last error", () => {
    const last = Object.assign(new Error("Quota exceeded"), { name: "AI_APICallError", statusCode: 429, responseBody: JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }) });
    const i = providerErrorInfo(Object.assign(new Error("Failed after 3 attempts"), { name: "AI_RetryError", lastError: last, errors: [last] }));
    expect(i).toMatchObject({ status: 429, type: "RESOURCE_EXHAUSTED" });
  });
});

describe("google model fallback (end to end, mocked HTTP)", () => {
  it("AI_FALLBACK_MODELS parsing", () => {
    expect(googleFallbacks()).toEqual(DEFAULT_GOOGLE_FALLBACKS);
    vi.stubEnv("AI_FALLBACK_MODELS", " gemini-x , bad/id ,gemini-y"); expect(googleFallbacks()).toEqual(["gemini-x", "gemini-y"]);
    vi.stubEnv("AI_FALLBACK_MODELS", "none"); expect(googleFallbacks()).toEqual([]);
  });
  it("/api/extract reports the fallback model that actually answered when the default is out of daily quota", async () => {
    vi.stubEnv("AI_FALLBACK_MODELS", "gemini-fb-test");
    const f = vi.fn().mockImplementation(async (u: string) => String(u).includes(`/models/${DEFAULT_GOOGLE_MODEL}:`)
      ? new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "q", details: [{ retryDelay: "70000s" }] } }), { status: 429 })
      : gemini([{ text: JSON.stringify({ items: MOCK_FIXTURES["rx-3.png"] }) }]));
    vi.stubGlobal("fetch", f);
    const j = await (await extract(post({ imageDataUrl: IMG, sampleId: "rx-3.png" }))).json();
    expect(j).toMatchObject({ provider: "google", model: "gemini-fb-test", items: MOCK_FIXTURES["rx-3.png"] });
  });
});
describe("agent keeps a created order when the model fails afterwards", () => {
  it("returns the deterministic summary (not a 502) so the approval is still issued", async () => {
    let i = 0;
    const m = new MockLanguageModelV4({ modelId: "gemini-mock", doGenerate: async () => {
      const k = i++;
      if (k === 0) return { content: [{ type: "tool-call", toolCallId: "a", toolName: "build_cart", input: "{}" }, { type: "tool-call", toolCallId: "b", toolName: "create_paypal_order", input: "{}" }], finishReason: { unified: "tool-calls", raw: "STOP" }, usage, warnings: [] } as any;
      throw Object.assign(new Error("quota"), { name: "AI_APICallError", statusCode: 429 });
    } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAgent({ items: [{ name: "Fictamol 500 mg tablets", quantity: 2 }], approved: true, createOrder: vi.fn().mockResolvedValue({ id: "ORD9", status: "PAYER_ACTION_REQUIRED" }), useModel: true, model: m, provider: "google" });
    spy.mockRestore();
    expect(r.text).toBe("PayPal order ORD9 created for $7.00.");
    expect((r as any).warning).toMatch(/model failed after the order was created/);
  });
  it("still throws when the model fails before any order exists", async () => {
    const m = new MockLanguageModelV4({ modelId: "gemini-mock", doGenerate: async () => { throw Object.assign(new Error("quota"), { statusCode: 429 }); } });
    await expect(runAgent({ items: [{ name: "Fictamol 500 mg tablets", quantity: 1 }], approved: true, createOrder: vi.fn(), useModel: true, model: m, provider: "google" })).rejects.toThrow("quota");
  });
});
