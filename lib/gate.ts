import { createHash, timingSafeEqual } from "node:crypto";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();
/** Constant-time PIN check. Both sides are hashed to fixed-length digests first, so neither the
 *  comparison nor an early length check leaks the expected PIN's length. */
export function pharmacistApproved(pin: unknown, expected = process.env.PHARMACIST_DEMO_PIN): boolean {
  if (!expected || typeof pin !== "string" || pin.length === 0) return false;
  return timingSafeEqual(sha256(pin), sha256(expected));
}
