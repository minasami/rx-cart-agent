import { z } from "zod";
import { createOrder } from "@/lib/paypal";
import { buildCart } from "@/lib/cart";
import { pharmacistApproved } from "@/lib/gate";
import { CartItemsSchema, PinSchema } from "@/lib/schemas";
import { paypalMode } from "@/lib/mode";
import { jsonError, parseBody, route } from "@/lib/http";
const Body = z.object({ items: CartItemsSchema, pharmacistPin: PinSchema.optional() });
export const POST = route(async req => {
  const { items, pharmacistPin } = await parseBody(req, Body);
  if (!pharmacistApproved(pharmacistPin)) return jsonError(403, "Pharmacist confirmation required before payment");
  const { totalUSD } = buildCart(items); // recomputed server-side
  if (Number(totalUSD) <= 0) return jsonError(400, "Empty cart");
  if (paypalMode() === "mock") return Response.json({ id: "MOCK-" + Date.now(), status: "CREATED", mock: true, totalUSD });
  return Response.json(await createOrder(totalUSD));
});
