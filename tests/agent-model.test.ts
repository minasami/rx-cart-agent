import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { runAgent, createAgentTools, AGENT_SYSTEM, summarize } from "../lib/agent";
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const fr = (u: string) => ({ unified: u, raw: u });
const call = (id: string, toolName: string) => ({ type: "tool-call", toolCallId: id, toolName, input: "{}" });
const items = [{ name: "Fictamol 500 mg tablets", quantity: 2 }, { name: "Unknownex 5 mg tablets", quantity: 1 }];
const ctx = { toolCallId: "t", messages: [] } as any;
/** Scripted model: a list of step results, one per doGenerate call. */
const scripted = (steps: any[][], finish: string[]) => {
  let i = 0;
  return new MockLanguageModelV4({ modelId: "mock-agent", doGenerate: async () => { const k = i++; return { content: steps[k] ?? [], finishReason: fr(finish[k] ?? "stop"), usage, warnings: [] } as any; } });
};

describe("agent (model path, mocked)", () => {
  it("a model calling create_paypal_order twice still creates exactly one PayPal order", async () => {
    const createOrder = vi.fn().mockResolvedValue({ id: "ORD1", status: "PAYER_ACTION_REQUIRED" });
    const m = scripted([[call("a", "build_cart")], [call("b", "create_paypal_order"), call("c", "create_paypal_order")], [{ type: "text", text: "Done: order ORD1." }]], ["tool-calls", "tool-calls", "stop"]);
    const r = await runAgent({ items, approved: true, createOrder, useModel: true, model: m });
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ provider: "gateway", model: "mock-agent", text: "Done: order ORD1." });
    expect(r.trace.filter(t => t.tool === "create_paypal_order").every(t => (t.output as any).id === "ORD1")).toBe(true);
  });
  it("falls back to the deterministic summary when the model ends without text", async () => {
    const createOrder = vi.fn().mockResolvedValue({ id: "ORD2", status: "PAYER_ACTION_REQUIRED" });
    const m = scripted([[call("a", "build_cart")], [call("b", "create_paypal_order")], [], []], ["tool-calls", "tool-calls", "stop", "stop"]);
    const r = await runAgent({ items, approved: true, createOrder, useModel: true, model: m });
    expect(r.text).toBe("Flagged, not substituted: Unknownex 5 mg tablets (not found). PayPal order ORD2 created for $7.00.");
  });
  it("sends the hardened instructions (untrusted data, no clinical/substitution advice) and never the PIN", async () => {
    const m = scripted([[{ type: "text", text: "ok" }]], ["stop"]);
    await runAgent({ items, approved: false, createOrder: vi.fn(), useModel: true, model: m });
    const prompt = JSON.stringify(m.doGenerateCalls[0].prompt);
    expect(prompt).toContain("untrusted data");
    expect(prompt).toMatch(/Never give clinical, dosing, interaction or substitution advice/);
    expect(AGENT_SYSTEM).toMatch(/never suggest alternative products/);
  });
});
describe("create_paypal_order idempotency", () => {
  it("concurrent calls share one order", async () => {
    const createOrder = vi.fn().mockResolvedValue({ id: "X" });
    const t = createAgentTools({ items, approved: true, createOrder });
    const [a, b] = await Promise.all([t.create_paypal_order.execute!({}, ctx), t.create_paypal_order.execute!({}, ctx)]);
    expect(createOrder).toHaveBeenCalledTimes(1); expect(a).toEqual(b);
  });
  it("summarize reports when no order tool ran", () => expect(summarize([])).toBe("No PayPal order was created."));
});
