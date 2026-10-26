import { describe, it, expect, vi } from "vitest";
import { createAgentTools, runAgent, toToolkitOrder } from "../lib/agent";
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
});
