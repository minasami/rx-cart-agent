/**
 * Summarizes an AI / PayPal provider error for logs and clients WITHOUT dumping the raw error object
 * (which carries request bodies, e.g. the prescription image, and request headers).
 */
export type ProviderErrorInfo = { name: string; status?: number; type?: string; message: string };
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + "…" : s);
export function providerErrorInfo(e: unknown): ProviderErrorInfo {
  let o = (e && typeof e === "object" ? e : {}) as Record<string, any>;
  // After retries (e.g. Gemini free-tier 429/503) the SDK throws AI_RetryError; classify by the last attempt's error.
  if (o.lastError && typeof o.lastError === "object" && /RetryError/.test(String(o.name))) o = o.lastError;
  let type: string | undefined;
  // The gateway wraps the upstream APICallError: the specific type lives in cause.responseBody.
  for (const body of [o.responseBody, o.cause?.responseBody]) {
    if (type || typeof body !== "string") continue;
    // Gateway/OpenAI-style bodies carry error.type; the Gemini API carries error.status (e.g. RESOURCE_EXHAUSTED).
    try { const er = JSON.parse(body)?.error; const t = er?.type ?? er?.status; if (typeof t === "string") type = t; } catch { /* not JSON */ }
  }
  type ??= typeof o.type === "string" ? o.type : undefined;
  const status = typeof o.statusCode === "number" ? o.statusCode : typeof o.status === "number" ? o.status : undefined;
  return { name: clip(String(o.name ?? "Error"), 80), status, type: type && clip(type, 80), message: clip(String(o.message ?? e)) };
}
/** Short, secret-free reason safe to show in the UI. */
export function publicReason(i: ProviderErrorInfo, provider: "gateway" | "google" | "mock" = "gateway"): string {
  const svc = provider === "google" ? "Gemini API" : "AI Gateway";
  if (i.type === "customer_verification_required") return "AI Gateway has no billing set up for this Vercel team (add a card in Vercel → AI Gateway)";
  if (i.status === 401 || i.status === 403 || i.type === "authentication_error" || i.type === "PERMISSION_DENIED" || /API key (not valid|expired)|API_KEY_INVALID/i.test(i.message)) return `${svc} rejected the API key`;
  if (i.status === 429 || i.type === "rate_limit_exceeded" || i.type === "RESOURCE_EXHAUSTED") return `${svc} rate limit or quota reached (free tier); try again shortly`;
  if (i.status === 503 || i.type === "UNAVAILABLE") return `${svc} model is overloaded right now; try again shortly`;
  if (isTimeout(i)) return `${svc} did not answer in time (free tier is slow or overloaded); try again shortly or use the demo extraction`;
  if (i.name.includes("NoObjectGenerated") || i.name.includes("NoOutputGenerated")) return "the model returned no usable structured output";
  if (i.status === 404 || i.type === "model_not_found" || i.type === "NOT_FOUND") return `the configured AI_MODEL is not available on ${svc}`;
  return "provider error";
}
const isTimeout = (i: ProviderErrorInfo) =>
  i.status === 504 || i.type === "DEADLINE_EXCEEDED" || i.name === "TimeoutError" || i.name === "AbortError" || /timed? ?out|aborted due to timeout/i.test(i.message);
/** Machine-readable class of an AI failure, for clients (e.g. to offer the demo fallback). */
export type AiFailure = "quota" | "overloaded" | "timeout" | "auth" | "bad_output" | "model" | "billing" | "other";
export function failureKind(i: ProviderErrorInfo): AiFailure {
  if (i.type === "customer_verification_required") return "billing";
  if (i.status === 401 || i.status === 403 || i.type === "authentication_error" || i.type === "PERMISSION_DENIED" || /API key (not valid|expired)|API_KEY_INVALID/i.test(i.message)) return "auth";
  if (i.status === 429 || i.type === "rate_limit_exceeded" || i.type === "RESOURCE_EXHAUSTED") return "quota";
  if (i.status === 503 || i.type === "UNAVAILABLE") return "overloaded";
  if (isTimeout(i)) return "timeout";
  if (i.name.includes("NoObjectGenerated") || i.name.includes("NoOutputGenerated")) return "bad_output";
  if (i.status === 404 || i.type === "model_not_found" || i.type === "NOT_FOUND") return "model";
  return "other";
}
export function logProviderError(where: string, e: unknown): ProviderErrorInfo {
  const i = providerErrorInfo(e);
  console.error(`[${where}] ${i.name}${i.status ? ` ${i.status}` : ""}${i.type ? ` ${i.type}` : ""}: ${i.message}`);
  return i;
}
