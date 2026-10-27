import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as config } from "../app/api/config/route";
import { parseConfig } from "@/lib/client";
import { isClientId, paypalSdkUrl, loadPayPalSdk, _resetSdkLoads } from "@/lib/paypalSdk";

const CID = "AbCdEf0123456789_-AbCdEf0123456789";
beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv("AI_PROVIDER", "mock"); _resetSdkLoads(); });

describe("/api/config PayPal client ID", () => {
  it("serves the client ID (never the secret) in sandbox mode", async () => {
    vi.stubEnv("PAYPAL_MODE", "sandbox"); vi.stubEnv("PAYPAL_CLIENT_ID", CID); vi.stubEnv("PAYPAL_CLIENT_SECRET", "s3cr3t-value");
    const r = await config(); const text = await r.text(); const j = JSON.parse(text);
    expect(j).toMatchObject({ paypal: "sandbox", paypalClientId: CID, paypalEnv: "sandbox" });
    expect(text).not.toContain("s3cr3t-value");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("omits it in mock mode", async () => {
    vi.stubEnv("PAYPAL_MODE", "mock"); vi.stubEnv("PAYPAL_CLIENT_ID", CID); vi.stubEnv("PAYPAL_CLIENT_SECRET", "x");
    const j = await (await config()).json();
    expect(j.paypal).toBe("mock"); expect(j.paypalClientId).toBeUndefined();
  });
  it("omits a malformed client ID", async () => {
    vi.stubEnv("PAYPAL_MODE", "sandbox"); vi.stubEnv("PAYPAL_CLIENT_ID", "bad id&x=<script>"); vi.stubEnv("PAYPAL_CLIENT_SECRET", "x");
    const j = await (await config()).json();
    expect(j.paypal).toBe("sandbox"); expect(j.paypalClientId).toBeUndefined();
  });
});

describe("parseConfig client ID", () => {
  it("keeps a valid sandbox client ID", () => expect(parseConfig({ ai: "google", paypal: "sandbox", paypalClientId: CID, paypalEnv: "sandbox" }))
    .toEqual({ ai: "google", paypal: "sandbox", demoPin: false, paypalClientId: CID, paypalEnv: "sandbox" }));
  it("drops it outside sandbox, with another env, or when malformed", () => {
    expect(parseConfig({ ai: "mock", paypal: "mock", paypalClientId: CID, paypalEnv: "sandbox" })?.paypalClientId).toBeUndefined();
    expect(parseConfig({ ai: "mock", paypal: "sandbox", paypalClientId: CID, paypalEnv: "live" })?.paypalClientId).toBeUndefined();
    expect(parseConfig({ ai: "mock", paypal: "sandbox", paypalClientId: "a b", paypalEnv: "sandbox" })?.paypalClientId).toBeUndefined();
  });
});

describe("paypalSdkUrl", () => {
  it("builds a sandbox Buttons URL", () => {
    const u = new URL(paypalSdkUrl(CID));
    expect(u.origin).toBe("https://www.sandbox.paypal.com"); expect(u.pathname).toBe("/sdk/js");
    expect(Object.fromEntries(u.searchParams)).toEqual({ "client-id": CID, currency: "USD", intent: "capture", components: "buttons", "disable-funding": "card,paylater,venmo" });
  });
  it("rejects malformed IDs and unknown environments", () => {
    for (const bad of ["", "short", "x".repeat(200), "abc&currency=EUR&client-id=zzzzzzzzzzzzzzz"]) { expect(isClientId(bad)).toBe(false); expect(() => paypalSdkUrl(bad)).toThrow(); }
    expect(() => paypalSdkUrl(CID, "live" as any)).toThrow();
  });
});

describe("loadPayPalSdk", () => {
  const fakeDoc = () => { const scripts: any[] = []; return { scripts, doc: { createElement: () => { const s: any = { setAttribute() {} }; return s; }, head: { appendChild: (s: any) => { scripts.push(s); return s; } } } as any }; };
  it("injects one script per URL and resolves with window.paypal", async () => {
    const { scripts, doc } = fakeDoc(); const win: any = {};
    const a = loadPayPalSdk("https://www.sandbox.paypal.com/sdk/js?client-id=x", doc, win), b = loadPayPalSdk("https://www.sandbox.paypal.com/sdk/js?client-id=x", doc, win);
    expect(a).toBe(b); expect(scripts).toHaveLength(1); expect(scripts[0].async).toBe(true);
    win.paypal = { Buttons: () => ({}) }; scripts[0].onload();
    await expect(a).resolves.toBe(win.paypal);
  });
  it("rejects on a load error and allows a retry", async () => {
    const { scripts, doc } = fakeDoc();
    const a = loadPayPalSdk("u", doc, {}); scripts[0].onerror();
    await expect(a).rejects.toThrow(/Could not load/);
    loadPayPalSdk("u", doc, {}); expect(scripts).toHaveLength(2);
  });
  it("rejects if the script loads without window.paypal", async () => {
    const { scripts, doc } = fakeDoc(); const a = loadPayPalSdk("v", doc, {}); scripts[0].onload();
    await expect(a).rejects.toThrow(/window.paypal/);
  });
});
