import { describe, it, expect } from "vitest";
import { savePending, loadPending, clearPending, parseReturn, captureBody, PENDING_KEY, PENDING_TTL_MS } from "../lib/pending";
import { APPROVAL_TTL_MS } from "../lib/approval";
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const items = [{ name: "Fictamol 500 mg tablets", quantity: 2 }];
describe("/return query parsing", () => {
  it("reads PayPal's ?token= (order id) and PayerID", () =>
    expect(parseReturn("?token=5O190127TN364715T&PayerID=QYR5Z8XDVJNXQ")).toEqual({ orderID: "5O190127TN364715T", payerID: "QYR5Z8XDVJNXQ", cancelled: false }));
  it("flags the cancel URL", () => expect(parseReturn("?cancelled=1&token=ABC123")).toMatchObject({ orderID: "ABC123", cancelled: true }));
  it("ignores a token that is not an order id", () => {
    expect(parseReturn("?token=../../v1/x").orderID).toBeUndefined();
    expect(parseReturn("?token=%3Cscript%3E").orderID).toBeUndefined();
    expect(parseReturn("").orderID).toBeUndefined();
  });
});
describe("pending order hand-off (sessionStorage)", () => {
  it("returns the approval only for the order PayPal returned", () => {
    const s = mem(); savePending(s, { orderID: "ABC123", approvalToken: "p.s", items, totalUSD: "7.00" }, 1000);
    expect(loadPending(s, "ABC123", 2000)).toMatchObject({ orderID: "ABC123", approvalToken: "p.s", items });
    expect(loadPending(s, "OTHER1", 2000)).toBeUndefined();
    expect(loadPending(s, undefined, 2000)).toBeUndefined();
    expect(captureBody(loadPending(s, "ABC123", 2000)!)).toEqual({ orderID: "ABC123", approvalToken: "p.s", items });
  });
  it("expires with the approval token TTL and is cleared", () => {
    expect(PENDING_TTL_MS).toBe(APPROVAL_TTL_MS);
    const s = mem(); savePending(s, { orderID: "ABC123", approvalToken: "p.s", items }, 0);
    expect(loadPending(s, "ABC123", PENDING_TTL_MS + 1)).toBeUndefined();
    expect(s.m.has(PENDING_KEY)).toBe(false);
  });
  it("never stores a PIN and rejects bad input / corrupt storage", () => {
    const s = mem();
    expect(() => savePending(s, { orderID: "../x", approvalToken: "p.s", items })).toThrow();
    expect(() => savePending(s, { orderID: "ABC123", approvalToken: "", items })).toThrow();
    savePending(s, { orderID: "ABC123", approvalToken: "p.s", items, ...({ pharmacistPin: undefined } as any) });
    expect(s.getItem(PENDING_KEY)).not.toMatch(/pin/i);
    s.setItem(PENDING_KEY, "{oops"); expect(loadPending(s, "ABC123")).toBeUndefined();
    clearPending(s); expect(s.getItem(PENDING_KEY)).toBeNull();
  });
});
