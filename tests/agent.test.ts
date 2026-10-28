import { describe, it, expect, vi } from "vitest";
import { createAgentTools, runAgent, toToolkitOrder, normalizeToolkitOutput, toolkitCreateOrder, _resetToolkitCache, TOOLKIT_TTL_MS } from "../lib/agent";
const items = [{ name: "Fictamol 500 mg tablets", quantity: 2 }, { name: "Unknownex 5 mg tablets", quantity: 1 }];
const ctx = { toolCallId: "t", messages: [] } as any;
describe("agent PIN gate around PayPal create_order", () => {
  it("tool refuses and never calls PayPal when not approved", async () => {
    const createOrder = vi.fn();
    const tools = createAgentTools({ items, approved: false, createOrder });
    const r: any = await tools.create_paypal_order.execute!({}, ctx);
    expect(r.error).toMatch(/pharmacist confirmation required/i);
    expect(createOrder).not.toHaveBeenCalled();
  });
  it("full agent run without approval creates no order", async () => {
    const createOrder = vi.fn();
    const r = await runAgent({ items, approved: false, createOrder, useModel: false });
    expect(createOrder).not.toHaveBeenCalled();
    expect(r.text).toMatch(/BLOCKED/);
  });
  it("tool input schema exposes no amount/approval fields to the model", () => {
    const tools = createAgentTools({ items, approved: false, createOrder: vi.fn() });
    expect(Object.keys((tools.create_paypal_order.inputSchema as any).shape)).toEqual([]);
  });
  it("with approval, calls toolkit create_order once with server-built, in-stock items only", async () => {
    const createOrder = vi.fn().mockResolvedValue({ id: "X1", status: "CREATED" });
    const r = await runAgent({ items, approved: true, createOrder, useModel: false });
    expect(createOrder).toHaveBeenCalledTimes(1);
    const p = createOrder.mock.calls[0][0];
    expect(p).toEqual(toToolkitOrder(items));
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ name: "Fictamol 500 mg tablets", quantity: 2, itemCost: 3.5, itemTotal: 7 });
    expect(r.text).toMatch(/not found/);
  });
  it("mock agent summary labels out-of-stock lines readably (no stray underscore)", async () => {
    const r = await runAgent({ items: [{ name: "Mockazole 20 mg tablets", quantity: 1 }], approved: false, createOrder: vi.fn(), useModel: false });
    expect(r.text).toContain("Mockazole 20 mg tablets was out of stock and was left out");
    expect(r.text).not.toContain("_");
  });
});
describe("toolkit create_order output", () => {
  it("parses the JSON string the toolkit returns into the order object", () => {
    const order = { id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }] };
    expect(normalizeToolkitOutput(JSON.stringify(order))).toEqual(order);
  });
  it("maps toolkit / PayPal error shapes to {error}", () => {
    expect(normalizeToolkitOutput(JSON.stringify({ error: { message: "boom", type: "paypal_error" } }))).toMatchObject({ error: "boom" });
    expect(normalizeToolkitOutput({ name: "INVALID_REQUEST", message: "bad" })).toMatchObject({ error: "INVALID_REQUEST: bad" });
    expect(normalizeToolkitOutput("not json")).toHaveProperty("error");
  });
});
describe("toolkit instance (OAuth token) reuse", () => {
  it("reuses one toolkit across requests, rebuilds after TTL and after an error result", async () => {
    _resetToolkitCache();
    let t = 0; const now = () => t;
    const exec = vi.fn().mockResolvedValue(JSON.stringify({ id: "O1", status: "PAYER_ACTION_REQUIRED" }));
    const factory = vi.fn(async () => exec);
    await (await toolkitCreateOrder(factory, now))({}); await (await toolkitCreateOrder(factory, now))({});
    expect(factory).toHaveBeenCalledTimes(1);
    t = TOOLKIT_TTL_MS + 1;
    await (await toolkitCreateOrder(factory, now))({});
    expect(factory).toHaveBeenCalledTimes(2);
    exec.mockResolvedValueOnce(JSON.stringify({ error: { message: "token expired", type: "paypal_error" } }));
    expect(await (await toolkitCreateOrder(factory, now))({})).toMatchObject({ error: "token expired" });
    await (await toolkitCreateOrder(factory, now))({});
    expect(factory).toHaveBeenCalledTimes(3);
  });
});
