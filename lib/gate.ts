import { timingSafeEqual } from "node:crypto";
export function pharmacistApproved(pin: unknown, expected = process.env.PHARMACIST_DEMO_PIN): boolean {
  if (!expected || typeof pin !== "string" || pin.length === 0) return false;
  const a = Buffer.from(pin), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
