import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { buildCart } from "./cart";

/**
 * Server-signed, short-lived approval tokens. Issued only by create-order / agent after the pharmacist PIN
 * passed and a PayPal order was created; capture must present one bound to the same orderID AND cart hash.
 *
 * Secret: APPROVAL_TOKEN_SECRET (>= 32 chars) if set, otherwise a random per-process secret (fine for local
 * mock/sandbox demos; set the env var when running more than one server instance).
 */
export const APPROVAL_TTL_MS = 15 * 60_000;
const g = globalThis as unknown as { __rxApprovalSecret?: Buffer; __rxCaptured?: Map<string, number> };
function secret(): Buffer {
  const env = process.env.APPROVAL_TOKEN_SECRET;
  if (env && env.length >= 32) return Buffer.from(env, "utf8");
  return (g.__rxApprovalSecret ??= randomBytes(32));
}

type Cart = ReturnType<typeof buildCart>;
/** Stable hash of what will actually be charged: in-stock lines (sku, qty, unit price) and the total. */
export function cartHash(cart: Cart): string {
  const ok = cart.lines.filter(l => l.status === "ok").map(l => [l.match!.sku, l.quantity, l.match!.priceUSD]);
  return createHash("sha256").update(JSON.stringify({ v: 1, ok, total: cart.totalUSD })).digest("hex");
}

/** Hash of the full reviewed cart, including excluded lines (not found / out of stock), so the agent's status is bound to what the pharmacist saw. */
export function reviewHash(cart: Cart): string {
  const all = cart.lines.map(l => [l.requested, l.quantity, l.status, l.match?.sku ?? null]);
  return createHash("sha256").update(JSON.stringify({ v: 1, all, ok: cartHash(cart) })).digest("hex");
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest();

export function signApproval(orderID: string, ch: string, now = Date.now()): string {
  const payload = b64u(JSON.stringify({ v: 1, oid: orderID, ch, exp: now + APPROVAL_TTL_MS }));
  return `${payload}.${b64u(mac(payload))}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "order_mismatch" | "cart_mismatch" };
export function verifyApproval(token: unknown, orderID: string, ch: string, now = Date.now()): VerifyResult {
  if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const given = Buffer.from(sig, "base64url"), want = mac(payload);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: "bad_signature" };
  let p: { v?: number; oid?: unknown; ch?: unknown; exp?: unknown };
  try { p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (p.v !== 1 || typeof p.exp !== "number") return { ok: false, reason: "malformed" };
  if (now > p.exp) return { ok: false, reason: "expired" };
  if (p.oid !== orderID) return { ok: false, reason: "order_mismatch" };
  if (typeof p.ch !== "string" || p.ch.length !== ch.length || !timingSafeEqual(Buffer.from(p.ch), Buffer.from(ch))) return { ok: false, reason: "cart_mismatch" };
  return { ok: true };
}

/** One capture per order id (in memory, pruned after the token TTL). */
export function markCaptured(orderID: string, now = Date.now()): boolean {
  const m = (g.__rxCaptured ??= new Map());
  for (const [k, t] of m) if (now - t > APPROVAL_TTL_MS) m.delete(k);
  if (m.has(orderID)) return false;
  m.set(orderID, now);
  return true;
}
/** Release the capture slot when the upstream capture failed (e.g. payer has not approved yet), so it can be retried. */
export function releaseCaptured(orderID: string) { g.__rxCaptured?.delete(orderID); }
