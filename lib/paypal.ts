const base = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
async function token() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!r.ok) throw new Error(`PayPal auth ${r.status}`);
  return (await r.json()).access_token as string;
}
export async function createOrder(totalUSD: string) {
  const r = await fetch(`${base}/v2/checkout/orders`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: totalUSD }, description: "Synthetic demo pharmacy order" }] }) });
  return r.json();
}
export async function captureOrder(id: string) {
  const r = await fetch(`${base}/v2/checkout/orders/${id}/capture`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" } });
  return r.json();
}
