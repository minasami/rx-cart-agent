import { z } from "zod";
import { checkPinLimited } from "@/lib/ratelimit";
import { PinSchema } from "@/lib/schemas";
import { jsonError, parseBody, route } from "@/lib/http";
const Body = z.object({ pin: PinSchema });
/** UX pre-check for the Confirm button. Order creation still re-checks the PIN server-side. Rate-limited. */
export const POST = route(async req => {
  const { pin } = await parseBody(req, Body);
  if (!checkPinLimited(req, pin)) return jsonError(403, "Wrong pharmacist PIN");
  return Response.json({ ok: true });
});
