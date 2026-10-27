/**
 * Summarizes an AI / PayPal provider error for logs and clients WITHOUT dumping the raw error object
 * (which carries request bodies, e.g. the prescription image, and request headers).
 */
export type ProviderErrorInfo = { name: string; status?: number; type?: string; message: string };
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + "…" : s);
export function providerErrorInfo(e: unknown): ProviderErrorInfo {
  const o = (e && typeof e === "object" ? e : {}) as Record<string, any>;
  let type: string | undefined;
  // The gateway wraps the upstream APICallError: the specific type lives in cause.responseBody.
  for (const body of [o.responseBody, o.cause?.responseBody]) {
    if (type || typeof body !== "string") continue;
    try { const t = JSON.parse(body)?.error?.type; if (typeof t === "string") type = t; } catch { /* not JSON */ }
  }
  type ??= typeof o.type === "string" ? o.type : undefined;
  const status = typeof o.statusCode === "number" ? o.statusCode : typeof o.status === "number" ? o.status : undefined;
  return { name: clip(String(o.name ?? "Error"), 80), status, type: type && clip(type, 80), message: clip(String(o.message ?? e)) };
}
/** Short, secret-free reason safe to show in the UI. */
export function publicReason(i: ProviderErrorInfo): string {
  if (i.type === "customer_verification_required") return "AI Gateway has no billing set up for this Vercel team (add a card in Vercel → AI Gateway)";
  if (i.status === 401 || i.type === "authentication_error") return "AI Gateway rejected the API key";
  if (i.status === 429 || i.type === "rate_limit_exceeded") return "AI Gateway rate limit or quota reached";
  if (i.name.includes("NoObjectGenerated") || i.name.includes("NoOutputGenerated")) return "the model returned no usable structured output";
  if (i.status === 404 || i.type === "model_not_found") return "the configured AI_MODEL is not available on AI Gateway";
  return "provider error";
}
export function logProviderError(where: string, e: unknown): ProviderErrorInfo {
  const i = providerErrorInfo(e);
  console.error(`[${where}] ${i.name}${i.status ? ` ${i.status}` : ""}${i.type ? ` ${i.type}` : ""}: ${i.message}`);
  return i;
}
