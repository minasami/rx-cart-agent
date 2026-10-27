/**
 * Client-side hand-off for the PayPal redirect flow (approve link -> PayPal -> /return?token=ORDER_ID).
 * The server-signed approvalToken stays in the browser, in per-tab sessionStorage (same origin only,
 * gone when the tab closes), and is only read back for the order id PayPal returns in ?token=.
 * The token itself is HMAC-bound to that order id and cart hash, expires after 15 minutes and is
 * single-use on the server, so this adds no new capability. No PIN is ever stored.
 */
export type Pending = { orderID: string; approvalToken: string; items: { name: string; quantity: number }[]; totalUSD?: string; savedAt: number };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const PENDING_KEY = "rx.pendingPayPalOrder";
export const PENDING_TTL_MS = 15 * 60_000; // = APPROVAL_TTL_MS (lib/approval.ts is server-only)
const ORDER_ID = /^[A-Za-z0-9-]{1,64}$/;

export function savePending(s: Store, p: Omit<Pending, "savedAt">, now = Date.now()) {
  if (!ORDER_ID.test(p.orderID) || !p.approvalToken) throw new Error("Cannot save an order without an id and approval token");
  s.setItem(PENDING_KEY, JSON.stringify({ ...p, savedAt: now }));
}
/** The pending order, only if it is for `orderID`, well-formed and not older than the token TTL. */
export function loadPending(s: Store, orderID: string | undefined, now = Date.now()): Pending | undefined {
  if (!orderID || !ORDER_ID.test(orderID)) return undefined;
  let p: any;
  try { p = JSON.parse(s.getItem(PENDING_KEY) ?? "null"); } catch { return undefined; }
  if (!p || p.orderID !== orderID || typeof p.approvalToken !== "string" || !Array.isArray(p.items) || typeof p.savedAt !== "number") return undefined;
  if (now - p.savedAt > PENDING_TTL_MS) { s.removeItem(PENDING_KEY); return undefined; }
  return p as Pending;
}
export const clearPending = (s: Store) => s.removeItem(PENDING_KEY);

/** PayPal appends ?token=<order id>&PayerID=... to return_url (and ?token= to cancel_url). */
export function parseReturn(search: string): { orderID?: string; payerID?: string; cancelled: boolean } {
  const q = new URLSearchParams(search);
  const t = q.get("token") ?? undefined, payer = q.get("PayerID") ?? undefined;
  return { orderID: t && ORDER_ID.test(t) ? t : undefined, payerID: payer && /^[A-Za-z0-9]{1,32}$/.test(payer) ? payer : undefined, cancelled: q.get("cancelled") === "1" };
}
/** Exact JSON body for POST /api/paypal/capture-order. */
export const captureBody = (p: Pick<Pending, "orderID" | "approvalToken" | "items">) => ({ orderID: p.orderID, approvalToken: p.approvalToken, items: p.items });
