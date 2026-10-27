import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createOrder, captureOrder, PayPalError, _resetTokenCache } from "../lib/paypal";
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => _resetTokenCache());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("PayPal REST client error handling", () => {
  it("throws a structured PayPalError with status on a non-2xx create", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(res(200, { access_token: "T", expires_in: 3600 }))
      .mockResolvedValueOnce(res(422, { name: "UNPROCESSABLE_ENTITY", message: "bad amount", debug_id: "d1" })));
    const e = await createOrder("1.00").catch(e => e);
    expect(e).toBeInstanceOf(PayPalError);
    expect(e).toMatchObject({ status: 422, paypalName: "UNPROCESSABLE_ENTITY", debugId: "d1" });
  });
  it("throws on a non-2xx capture", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (u: string) =>
      u.includes("oauth2") ? res(200, { access_token: "T", expires_in: 3600 }) : res(422, { name: "ORDER_NOT_APPROVED", message: "payer has not approved" })));
    await expect(captureOrder("ABC123")).rejects.toMatchObject({ status: 422, paypalName: "ORDER_NOT_APPROVED" });
  });
  it("throws when auth fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(401, { error: "invalid_client", error_description: "Client Authentication failed" })));
    await expect(createOrder("1.00")).rejects.toMatchObject({ status: 401 });
  });
});
describe("PayPal OAuth token cache", () => {
  it("reuses the token within its TTL and refreshes after expiry", async () => {
    vi.useFakeTimers({ now: 0 });
    const f = vi.fn().mockImplementation(async (u: string) =>
      u.includes("oauth2") ? res(200, { access_token: "T" + f.mock.calls.length, expires_in: 600 }) : res(201, { id: "O1", status: "CREATED" }));
    vi.stubGlobal("fetch", f);
    await createOrder("1.00"); await createOrder("1.00");
    expect(f.mock.calls.filter(c => String(c[0]).includes("oauth2"))).toHaveLength(1);
    vi.setSystemTime(600_000); // past expires_in minus the 60s margin
    await createOrder("1.00");
    expect(f.mock.calls.filter(c => String(c[0]).includes("oauth2"))).toHaveLength(2);
  });
  it("does not cache a failed auth", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(500, {})).mockResolvedValueOnce(res(200, { access_token: "T", expires_in: 600 })).mockResolvedValueOnce(res(201, { id: "O1" }));
    vi.stubGlobal("fetch", f);
    await expect(createOrder("1.00")).rejects.toBeInstanceOf(PayPalError);
    await expect(createOrder("1.00")).resolves.toMatchObject({ id: "O1" });
  });
});
