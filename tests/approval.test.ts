import { _resetPinLimiter } from "../lib/ratelimit";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signApproval, verifyApproval, cartHash, reviewHash, APPROVAL_TTL_MS } from "../lib/approval";
import { buildCart } from "../lib/cart";
import { POST as createOrder } from "../app/api/paypal/create-order/route";
import { POST as capture } from "../app/api/paypal/capture-order/route";
import { POST as agent } from "../app/api/agent/route";

const items = [{ name: "Fictamol 500 mg tablets", quantity: 2 }];
const ch = cartHash(buildCart(items));
const req = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { _resetPinLimiter(); vi.unstubAllEnvs(); vi.stubEnv("PAYPAL_MODE", "mock"); vi.stubEnv("PHARMACIST_DEMO_PIN", "4821"); vi.stubEnv("AI_PROVIDER", "mock"); });

describe("approval token (HMAC, short-lived, bound to orderID + cart hash)", () => {
  it("verifies a fresh token for the same order and cart", () => expect(verifyApproval(signApproval("O1", ch), "O1", ch)).toEqual({ ok: true }));
  it("rejects a different order id", () => expect(verifyApproval(signApproval("O1", ch), "O2", ch)).toMatchObject({ reason: "order_mismatch" }));
  it("rejects a different cart", () => {
    const other = cartHash(buildCart([{ name: "Fictamol 500 mg tablets", quantity: 3 }]));
    expect(verifyApproval(signApproval("O1", ch), "O1", other)).toMatchObject({ reason: "cart_mismatch" });
  });
  it("rejects an expired token", () => {
    const t = signApproval("O1", ch, 0);
    expect(verifyApproval(t, "O1", ch, APPROVAL_TTL_MS + 1)).toMatchObject({ reason: "expired" });
  });
  it("rejects a tampered payload or signature", () => {
    const [p, s] = signApproval("O1", ch).split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, oid: "O2", ch, exp: Date.now() + 1e9 })).toString("base64url");
    expect(verifyApproval(`${forged}.${s}`, "O2", ch)).toMatchObject({ reason: "bad_signature" });
    expect(verifyApproval(`${p}.${s.slice(0, -2)}AA`, "O1", ch)).toMatchObject({ ok: false });
    expect(verifyApproval(`${p}.`, "O1", ch)).toMatchObject({ reason: "malformed" });
    expect(verifyApproval(undefined, "O1", ch)).toMatchObject({ reason: "malformed" });
  });
  it("cart hash ignores flagged lines but changes with qty", () => {
    expect(cartHash(buildCart([...items, { name: "Unknownex 5 mg", quantity: 1 }]))).toBe(ch);
    expect(cartHash(buildCart([{ name: "Fictamol 500 mg tablets", quantity: 1 }]))).not.toBe(ch);
  });
});

describe("capture requires the approval token from order creation", () => {
  const newOrder = async () => { const r = await createOrder(req({ items, pharmacistPin: "4821", cartHash: ch })); expect(r.status).toBe(200); return r.json(); };
  it("captures with the issued token (mock)", async () => {
    const o = await newOrder();
    const r = await capture(req({ orderID: o.id, approvalToken: o.approvalToken, items }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: o.id, status: "COMPLETED", totalUSD: "7.00" });
  });
  it("rejects capture without a token", async () => {
    const o = await newOrder();
    expect((await capture(req({ orderID: o.id, items }))).status).toBe(400);
  });
  it("rejects a self-made MOCK- order id (no approval)", async () => {
    const o = await newOrder();
    expect((await capture(req({ orderID: "MOCK-1", approvalToken: o.approvalToken, items }))).status).toBe(403);
  });
  it("rejects capture with a different cart than the one approved", async () => {
    const o = await newOrder();
    const r = await capture(req({ orderID: o.id, approvalToken: o.approvalToken, items: [{ name: "Fictamol 500 mg tablets", quantity: 1 }] }));
    expect(r.status).toBe(403);
    expect((await r.json()).reason).toBe("cart_mismatch");
  });
  it("rejects a second capture of the same order", async () => {
    const o = await newOrder();
    expect((await capture(req({ orderID: o.id, approvalToken: o.approvalToken, items }))).status).toBe(200);
    expect((await capture(req({ orderID: o.id, approvalToken: o.approvalToken, items }))).status).toBe(409);
  });
  it("agent issues a token only when the gate passed", async () => {
    const blocked = await (await agent(req({ items, pharmacistPin: "", cartHash: ch, reviewHash: reviewHash(buildCart(items)) }))).json();
    expect(blocked.approval).toBeUndefined();
    const ok = await (await agent(req({ items, pharmacistPin: "4821", cartHash: ch, reviewHash: reviewHash(buildCart(items)) }))).json();
    expect(ok.approval.orderID).toMatch(/^MOCK-/);
    expect((await capture(req({ orderID: ok.approval.orderID, approvalToken: ok.approval.approvalToken, items }))).status).toBe(200);
  });
});

describe("order is bound to the reviewed cart", () => {
  it("/api/cart returns the cart hash the pharmacist reviews", async () => {
    const { POST: cart } = await import("../app/api/cart/route");
    expect((await (await cart(req({ items }))).json()).cartHash).toBe(ch);
  });
  it("create-order rejects items that differ from the reviewed cart (409), no order created", async () => {
    const r = await createOrder(req({ items: [{ name: "Fictamol 500 mg tablets", quantity: 9 }], pharmacistPin: "4821", cartHash: ch }));
    expect(r.status).toBe(409);
    expect((await r.json()).approvalToken).toBeUndefined();
  });
  it("create-order requires a cart hash", async () => expect((await createOrder(req({ items, pharmacistPin: "4821" }))).status).toBe(400));
  it("agent rejects a cart that differs from the reviewed one", async () => {
    expect((await agent(req({ items: [{ name: "Fictamol 500 mg tablets", quantity: 9 }], pharmacistPin: "4821", cartHash: ch, reviewHash: reviewHash(buildCart(items)) }))).status).toBe(409);
  });
});
