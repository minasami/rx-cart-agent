import { _resetPinLimiter } from "../lib/ratelimit";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST as cart } from "../app/api/cart/route";
import { POST as createOrder } from "../app/api/paypal/create-order/route";
import { POST as capture } from "../app/api/paypal/capture-order/route";
import { POST as agent } from "../app/api/agent/route";
import { signApproval, cartHash } from "../lib/approval";
import { buildCart } from "../lib/cart";
const req = (body: unknown, raw = false) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });
const items = [{ name: "Fictamol 500 mg tablets", quantity: 2 }];
beforeEach(() => { _resetPinLimiter(); vi.unstubAllEnvs(); vi.stubEnv("PAYPAL_MODE", "mock"); vi.stubEnv("PHARMACIST_DEMO_PIN", "4821"); vi.stubEnv("AI_PROVIDER", "mock"); });
describe("route input validation", () => {
  for (const [name, h] of [["cart", cart], ["create-order", createOrder], ["capture-order", capture], ["agent", agent]] as const) {
    it(`${name}: 400 on malformed JSON`, async () => { const r = await h(req("{nope", true)); expect(r.status).toBe(400); expect((await r.json()).error).toBeTruthy(); });
    it(`${name}: 400 on wrong body shape`, async () => { const r = await h(req({ items: "x", orderID: 5 })); expect(r.status).toBe(400); });
  }
  it("cart: 400 on a negative quantity", async () => expect((await cart(req({ items: [{ name: "Fictamol 500 mg tablets", quantity: -3 }] }))).status).toBe(400));
  it("cart: 200 with valid items", async () => { const r = await cart(req({ items })); expect(r.status).toBe(200); expect((await r.json()).totalUSD).toBe("7.00"); });
  it("create-order: 403 without the PIN", async () => expect((await createOrder(req({ items, pharmacistPin: "0000", cartHash: cartHash(buildCart(items)) }))).status).toBe(403));
  it("capture-order: 400 on an order id with path characters", async () => expect((await capture(req({ orderID: "../../v1/x", approvalToken: "x.y", items }))).status).toBe(400));
  it("create-order: 502 JSON when PayPal returns an error", async () => {
    vi.stubEnv("PAYPAL_MODE", "sandbox"); vi.stubEnv("PAYPAL_CLIENT_ID", "cid"); vi.stubEnv("PAYPAL_CLIENT_SECRET", "sec");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })));
    const r = await createOrder(req({ items, pharmacistPin: "4821", cartHash: cartHash(buildCart(items)) }));
    vi.unstubAllGlobals();
    expect(r.status).toBe(502);
    expect((await r.json()).paypal.status).toBe(401);
  });
});
describe("capture-order MOCK- prefix", () => {
  const sandbox = () => { vi.stubEnv("PAYPAL_MODE", "sandbox"); vi.stubEnv("PAYPAL_CLIENT_ID", "cid"); vi.stubEnv("PAYPAL_CLIENT_SECRET", "sec"); };
  it("sandbox mode rejects a MOCK- order id instead of faking COMPLETED (no PayPal call)", async () => {
    sandbox(); const f = vi.fn(); vi.stubGlobal("fetch", f);
    const r = await capture(req({ orderID: "MOCK-123", approvalToken: signApproval("MOCK-123", cartHash(buildCart(items))), items }));
    vi.unstubAllGlobals();
    expect(r.status).toBe(400);
    expect((await r.json()).status).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });
  it("mock mode rejects a non-mock order id", async () => expect((await capture(req({ orderID: "5O190127TN364715T", approvalToken: signApproval("5O190127TN364715T", cartHash(buildCart(items))), items }))).status).toBe(400));
  it("PAYPAL_MODE=sandbox without credentials falls back to mock everywhere", async () => {
    vi.stubEnv("PAYPAL_MODE", "sandbox"); vi.stubEnv("PAYPAL_CLIENT_ID", ""); vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
    const { paypalMode } = await import("../lib/mode");
    expect(paypalMode()).toBe("mock");
  });
});
