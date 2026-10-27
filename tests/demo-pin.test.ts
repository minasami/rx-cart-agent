import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "../app/api/pharmacist/demo-pin/route";
beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv("PHARMACIST_DEMO_PIN", "4821"); });
describe("demo PIN fill (mock mode only)", () => {
  it("is available in mock mode", async () => { vi.stubEnv("PAYPAL_MODE", "mock"); expect((await GET()).status).toBe(200); });
  it("is never available in sandbox mode", async () => {
    vi.stubEnv("PAYPAL_MODE", "sandbox"); vi.stubEnv("PAYPAL_CLIENT_ID", "cid"); vi.stubEnv("PAYPAL_CLIENT_SECRET", "sec");
    const r = await GET(); expect(r.status).toBe(404); expect(JSON.stringify(await r.json())).not.toContain("4821");
  });
  it("404 when no PIN is configured", async () => { vi.stubEnv("PAYPAL_MODE", "mock"); vi.stubEnv("PHARMACIST_DEMO_PIN", ""); expect((await GET()).status).toBe(404); });
});
