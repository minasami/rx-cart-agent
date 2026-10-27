import { describe, it, expect, vi, afterEach } from "vitest";
import { appBaseUrl, returnUrl, cancelUrl, experienceContext } from "../lib/urls";
import { createOrder, orderBody, _resetTokenCache } from "../lib/paypal";
import { toToolkitOrder } from "../lib/agent";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("APP_BASE_URL / return URLs", () => {
  it("defaults to http://127.0.0.1:<PORT>, or 3000", () => {
    expect(appBaseUrl({})).toBe("http://127.0.0.1:3000");
    expect(appBaseUrl({ PORT: "3990" })).toBe("http://127.0.0.1:3990");
    expect(appBaseUrl({ PORT: "nope" })).toBe("http://127.0.0.1:3000");
  });
  it("uses APP_BASE_URL's origin (drops path/trailing slash)", () => {
    expect(appBaseUrl({ APP_BASE_URL: "https://rx.example.org/", PORT: "1" })).toBe("https://rx.example.org");
    expect(returnUrl({ APP_BASE_URL: "http://localhost:4000/x" })).toBe("http://localhost:4000/return");
    expect(cancelUrl({ APP_BASE_URL: "http://localhost:4000" })).toBe("http://localhost:4000/return?cancelled=1");
  });
  it("rejects a non-http(s) or relative APP_BASE_URL", () => {
    expect(() => appBaseUrl({ APP_BASE_URL: "javascript:alert(1)" })).toThrow(/APP_BASE_URL/);
    expect(() => appBaseUrl({ APP_BASE_URL: "/relative" })).toThrow(/APP_BASE_URL/);
  });
  it("experience_context has the redirect, PAY_NOW, NO_SHIPPING and brand", () => {
    expect(experienceContext({ PORT: "3990" })).toEqual({
      brand_name: "Rx Cart Agent Demo", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING",
      return_url: "http://127.0.0.1:3990/return", cancel_url: "http://127.0.0.1:3990/return?cancelled=1",
    });
  });
});
describe("REST create-order body", () => {
  it("sends payment_source.paypal.experience_context to PayPal", async () => {
    _resetTokenCache(); vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3990");
    const f = vi.fn().mockImplementation(async (u: string) => new Response(JSON.stringify(String(u).includes("oauth2") ? { access_token: "T", expires_in: 600 } : { id: "O1", status: "PAYER_ACTION_REQUIRED" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await createOrder("7.00");
    const sent = JSON.parse(f.mock.calls.find(c => String(c[0]).endsWith("/v2/checkout/orders"))![1].body);
    expect(sent).toEqual(orderBody("7.00"));
    expect(sent.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "7.00" });
    expect(sent.payment_source.paypal.experience_context).toMatchObject({ return_url: "http://127.0.0.1:3990/return", cancel_url: "http://127.0.0.1:3990/return?cancelled=1", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", brand_name: "Rx Cart Agent Demo" });
  });
});
describe("Agent Toolkit create_order payload", () => {
  const items = [{ name: "Fictamol 500 mg tablets", quantity: 2 }];
  it("carries returnUrl/cancelUrl (the only experience_context fields toolkit 1.11.0 accepts)", async () => {
    vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3990");
    const p = toToolkitOrder(items);
    expect(p).toMatchObject({ returnUrl: "http://127.0.0.1:3990/return", cancelUrl: "http://127.0.0.1:3990/return?cancelled=1" });
    // The real toolkit schema keeps them (it would otherwise default to https://example.com/...).
    const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
    const tk = new PayPalAgentToolkit({ clientId: "x", clientSecret: "y", configuration: { actions: { orders: { create: true } }, context: { sandbox: true } } });
    const parsed = (tk.getTools().create_order as any).parameters.parse(p);
    expect(parsed.returnUrl).toBe("http://127.0.0.1:3990/return");
    expect(parsed.cancelUrl).toBe("http://127.0.0.1:3990/return?cancelled=1");
  });
});
