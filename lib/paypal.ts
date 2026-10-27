const base = () => process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

/** Structured error for a non-2xx PayPal response (PayPal error bodies look like {name, message, debug_id, details}). */
export class PayPalError extends Error {
  constructor(public status: number, public paypalName: string | undefined, message: string, public debugId?: string, public details?: unknown) {
    super(message);
    this.name = "PayPalError";
  }
  toJSON() { return { status: this.status, name: this.paypalName, message: this.message, debug_id: this.debugId, details: this.details }; }
}

async function readJson(r: Response): Promise<any> {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text.slice(0, 200) }; }
}
async function ensureOk(r: Response, what: string) {
  const body = await readJson(r);
  if (!r.ok) throw new PayPalError(r.status, body?.name ?? body?.error, `PayPal ${what} failed (${r.status}): ${body?.message ?? body?.error_description ?? r.statusText}`, body?.debug_id, body?.details);
  return body;
}

// OAuth access token cached in memory until shortly before it expires (per client id).
let cached: { key: string; value: string; expiresAt: number } | null = null;
const EXPIRY_MARGIN_MS = 60_000;
export function _resetTokenCache() { cached = null; }
async function token() {
  const key = `${base()}|${process.env.PAYPAL_CLIENT_ID}`;
  if (cached && cached.key === key && Date.now() < cached.expiresAt) return cached.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${base()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const j = await ensureOk(r, "auth");
  const ttlMs = Math.max(0, (Number(j.expires_in) || 300) * 1000 - EXPIRY_MARGIN_MS);
  cached = { key, value: j.access_token as string, expiresAt: Date.now() + ttlMs };
  return cached.value;
}
export async function createOrder(totalUSD: string) {
  const r = await fetch(`${base()}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: totalUSD }, description: "Synthetic demo pharmacy order" }] }) });
  const j = await ensureOk(r, "create order");
  if (typeof j?.id !== "string") throw new PayPalError(502, "INVALID_RESPONSE", "PayPal create order returned no order id");
  return j;
}
export async function captureOrder(id: string) {
  const r = await fetch(`${base()}/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" } });
  return ensureOk(r, "capture");
}
