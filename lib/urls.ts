/**
 * Where PayPal sends the buyer after approving (or cancelling) an order.
 * APP_BASE_URL (http/https origin, no path) if set, otherwise http://127.0.0.1:<PORT|3000>.
 * The buyer must come back on the SAME origin they started on, since the pending order and its
 * approval token live in that origin's per-tab sessionStorage.
 */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.APP_BASE_URL?.trim();
  if (raw) {
    let u: URL;
    try { u = new URL(raw); } catch { throw new Error("APP_BASE_URL must be an absolute http(s) URL"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("APP_BASE_URL must be an absolute http(s) URL");
    return u.origin;
  }
  const port = Number(env.PORT);
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000}`;
}
export const returnUrl = (env?: Record<string, string | undefined>) => `${appBaseUrl(env)}/return`;
export const cancelUrl = (env?: Record<string, string | undefined>) => `${appBaseUrl(env)}/return?cancelled=1`;
export const BRAND_NAME = "Rx Cart Agent Demo";

/** Orders v2 payment_source.paypal.experience_context: redirect back to the app, "Pay Now", no shipping step. */
export function experienceContext(env?: Record<string, string | undefined>) {
  return {
    brand_name: BRAND_NAME,
    user_action: "PAY_NOW",
    shipping_preference: "NO_SHIPPING",
    return_url: returnUrl(env),
    cancel_url: cancelUrl(env),
  } as const;
}
