import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkPinLimited, _resetPinLimiter, MAX_FAILURES, GLOBAL_MAX_FAILURES, LOCKOUT_MS, WINDOW_MS } from "../lib/ratelimit";
import { HttpError } from "../lib/http";
import { POST as createOrder } from "../app/api/paypal/create-order/route";
import { cartHash } from "../lib/approval";
import { buildCart } from "../lib/cart";
const reqFrom = (ip: string, body: unknown = {}) => new Request("http://localhost/api", { method: "POST", headers: { "x-forwarded-for": ip, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { _resetPinLimiter(); vi.unstubAllEnvs(); vi.stubEnv("PHARMACIST_DEMO_PIN", "4821"); vi.stubEnv("PAYPAL_MODE", "mock"); });
const locked = (fn: () => unknown) => { try { fn(); return false; } catch (e) { return e instanceof HttpError && e.status === 429; } };

describe("PIN lockout", () => {
  it(`locks a client after ${MAX_FAILURES} wrong PINs, even for the right PIN`, () => {
    const r = reqFrom("1.1.1.1");
    for (let i = 0; i < MAX_FAILURES; i++) expect(checkPinLimited(r, "0000", 1000 + i)).toBe(false);
    expect(locked(() => checkPinLimited(r, "4821", 2000))).toBe(true);
  });
  it("other clients are unaffected by one client's lockout", () => {
    for (let i = 0; i < MAX_FAILURES; i++) checkPinLimited(reqFrom("1.1.1.1"), "0000", 1000);
    expect(checkPinLimited(reqFrom("2.2.2.2"), "4821", 1000)).toBe(true);
  });
  it("unlocks after the lockout period", () => {
    const r = reqFrom("1.1.1.1");
    for (let i = 0; i < MAX_FAILURES; i++) checkPinLimited(r, "0000", 1000);
    expect(checkPinLimited(r, "4821", 1000 + LOCKOUT_MS + 1)).toBe(true);
  });
  it("failures outside the window do not accumulate", () => {
    const r = reqFrom("1.1.1.1");
    for (let i = 0; i < MAX_FAILURES - 1; i++) checkPinLimited(r, "0000", 1000);
    expect(checkPinLimited(r, "0000", 1000 + WINDOW_MS + 1)).toBe(false);
    expect(checkPinLimited(r, "4821", 1000 + WINDOW_MS + 2)).toBe(true);
  });
  it("a correct PIN resets that client's failure count", () => {
    const r = reqFrom("1.1.1.1");
    for (let i = 0; i < MAX_FAILURES - 1; i++) checkPinLimited(r, "0000", 1000);
    checkPinLimited(r, "4821", 1001);
    for (let i = 0; i < MAX_FAILURES - 1; i++) checkPinLimited(r, "0000", 1002);
    expect(checkPinLimited(r, "4821", 1003)).toBe(true);
  });
  it("empty PINs are not counted as failures", () => {
    const r = reqFrom("1.1.1.1");
    for (let i = 0; i < 20; i++) expect(checkPinLimited(r, "", 1000)).toBe(false);
    expect(checkPinLimited(r, "4821", 1000)).toBe(true);
  });
  it("global cap stops brute force from rotating IPs", () => {
    for (let i = 0; i < GLOBAL_MAX_FAILURES; i++) checkPinLimited(reqFrom(`10.0.${i >> 8}.${i & 255}`), String(1000 + i), 1000);
    expect(locked(() => checkPinLimited(reqFrom("9.9.9.9"), "4821", 1001))).toBe(true);
  });
  it("create-order returns 429 with Retry-After once locked", async () => {
    const items = [{ name: "Fictamol 500 mg tablets", quantity: 1 }];
    const body = { items, pharmacistPin: "0000", cartHash: cartHash(buildCart(items)) };
    for (let i = 0; i < MAX_FAILURES; i++) expect((await createOrder(reqFrom("3.3.3.3", body))).status).toBe(403);
    const r = await createOrder(reqFrom("3.3.3.3", { ...body, pharmacistPin: "4821" }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
describe("/api/pharmacist/verify", () => {
  it("200 for the right PIN, 403 for a wrong one, 429 after lockout", async () => {
    const { POST: verify } = await import("../app/api/pharmacist/verify/route");
    expect((await verify(reqFrom("4.4.4.4", { pin: "4821" }))).status).toBe(200);
    for (let i = 0; i < MAX_FAILURES; i++) expect((await verify(reqFrom("4.4.4.4", { pin: "1111" }))).status).toBe(403);
    expect((await verify(reqFrom("4.4.4.4", { pin: "4821" }))).status).toBe(429);
  });
});
