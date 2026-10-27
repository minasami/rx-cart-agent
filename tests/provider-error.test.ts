import { describe, it, expect, vi, beforeEach } from "vitest";
import { providerErrorInfo, publicReason, logProviderError } from "../lib/providerError";
import { POST as extract } from "../app/api/extract/route";
const gatewayErr = () => Object.assign(new Error("AI Gateway requires a valid credit card on file"), {
  name: "GatewayInternalServerError", statusCode: 403,
  responseBody: JSON.stringify({ error: { message: "x", type: "customer_verification_required" } }),
  requestBodyValues: { prompt: [{ content: "data:image/png;base64,SECRETIMAGE" }], headers: { authorization: "Bearer sk-SECRET" } },
});
beforeEach(() => vi.unstubAllEnvs());
describe("provider error summaries", () => {
  it("extracts status/type and maps billing errors to a readable reason", () => {
    const i = providerErrorInfo(gatewayErr());
    expect(i).toMatchObject({ name: "GatewayInternalServerError", status: 403, type: "customer_verification_required" });
    expect(publicReason(i)).toMatch(/no billing/);
    expect(publicReason(providerErrorInfo({ name: "X", statusCode: 401 }))).toMatch(/API key/);
    expect(publicReason(providerErrorInfo("boom"))).toBe("provider error");
    // gateway shape: generic top-level type, specific one in the wrapped APICallError
    const wrapped = { name: "GatewayInternalServerError", statusCode: 403, type: "internal_server_error", cause: { responseBody: JSON.stringify({ error: { type: "customer_verification_required" } }) } };
    expect(providerErrorInfo(wrapped).type).toBe("customer_verification_required");
  });
  it("logs one line without request bodies, images or headers", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logProviderError("t", gatewayErr());
    const out = spy.mock.calls.map(c => c.join(" ")).join("\n"); spy.mockRestore();
    expect(out).not.toMatch(/SECRET|base64|Bearer/);
    expect(out).toContain("customer_verification_required");
  });
  it("extract route returns 502 with the readable reason when the gateway fails", async () => {
    vi.stubEnv("AI_PROVIDER", "gateway");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key-not-real");
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "card required", type: "customer_verification_required" } }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await extract(new Request("http://l/api/extract", { method: "POST", body: JSON.stringify({ imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" }) }));
    spy.mockRestore(); vi.unstubAllGlobals();
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/^Extraction failed: AI Gateway has no billing/);
  });
});
