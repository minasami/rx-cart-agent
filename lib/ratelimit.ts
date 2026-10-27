import { pharmacistApproved } from "./gate";
import { HttpError } from "./http";

/**
 * In-memory failed-PIN limiter for PIN-checking endpoints (best effort: per server process; resets on restart).
 * Per client: MAX_FAILURES wrong PINs within WINDOW_MS locks that client for LOCKOUT_MS.
 * Global: GLOBAL_MAX_FAILURES wrong PINs within WINDOW_MS (from any client) locks PIN checks for everyone,
 * so rotating IPs / spoofed X-Forwarded-For can't brute-force a 4-digit PIN.
 */
export const MAX_FAILURES = 5, GLOBAL_MAX_FAILURES = 50, WINDOW_MS = 10 * 60_000, LOCKOUT_MS = 10 * 60_000;
type Entry = { fails: number[]; lockedUntil: number };
const g = globalThis as unknown as { __rxPin?: { clients: Map<string, Entry>; global: Entry } };
const state = () => (g.__rxPin ??= { clients: new Map(), global: { fails: [], lockedUntil: 0 } });
export function _resetPinLimiter() { g.__rxPin = undefined; }

export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip") || "local";
}

function lockedFor(e: Entry, now: number) { return e.lockedUntil > now ? e.lockedUntil - now : 0; }
function fail(e: Entry, max: number, now: number) {
  e.fails = e.fails.filter(t => now - t < WINDOW_MS);
  e.fails.push(now);
  if (e.fails.length >= max) { e.lockedUntil = now + LOCKOUT_MS; e.fails = []; }
}

/** Checks the pharmacist PIN with lockout. Throws HttpError(429) while locked. Empty PINs are not counted. */
export function checkPinLimited(req: Request, pin: unknown, now = Date.now()): boolean {
  const s = state(), key = clientKey(req);
  let e = s.clients.get(key);
  const wait = Math.max(lockedFor(s.global, now), e ? lockedFor(e, now) : 0);
  if (wait > 0) throw new HttpError(429, "Too many wrong PIN attempts. Try again later.", { retryAfterSec: Math.ceil(wait / 1000) }, { "Retry-After": String(Math.ceil(wait / 1000)) });
  if (typeof pin !== "string" || pin.length === 0) return false;
  if (pharmacistApproved(pin)) { s.clients.delete(key); return true; }
  if (!e) { if (s.clients.size > 10_000) s.clients.clear(); e = { fails: [], lockedUntil: 0 }; s.clients.set(key, e); }
  fail(e, MAX_FAILURES, now);
  fail(s.global, GLOBAL_MAX_FAILURES, now);
  return false;
}
