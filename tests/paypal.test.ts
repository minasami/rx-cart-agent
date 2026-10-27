import { describe, it, expect, vi, afterEach } from "vitest";
import { createOrder, captureOrder, PayPalError } from "../lib/paypal";
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());
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
