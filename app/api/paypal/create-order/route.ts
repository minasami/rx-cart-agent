import { z } from "zod";
import { randomBytes } from "node:crypto";
import { createOrder } from "@/lib/paypal";
import { buildCart } from "@/lib/cart";
import { pharmacistApproved } from "@/lib/gate";
import { cartHash, signApproval } from "@/lib/approval";
import { CartHashSchema, CartItemsSchema, PinSchema } from "@/lib/schemas";
import { paypalMode } from "@/lib/mode";
import { jsonError, parseBody, route } from "@/lib/http";
const Body = z.object({ items: CartItemsSchema, pharmacistPin: PinSchema.optional(), cartHash: CartHashSchema });
export const POST = route(async req => {
  const { items, pharmacistPin, cartHash: reviewed } = await parseBody(req, Body);
  if (!pharmacistApproved(pharmacistPin)) return jsonError(403, "Pharmacist confirmation required before payment");
  const cart = buildCart(items); // recomputed server-side
  if (Number(cart.totalUSD) <= 0) return jsonError(400, "Empty cart");
  const ch = cartHash(cart);
  if (ch !== reviewed) return jsonError(409, "Cart changed since the pharmacist reviewed it. Rebuild and confirm again.");
  const order = paypalMode() === "mock"
    ? { id: "MOCK-" + randomBytes(6).toString("hex").toUpperCase(), status: "CREATED", mock: true, totalUSD: cart.totalUSD }
    : await createOrder(cart.totalUSD);
  return Response.json({ ...order, cartHash: ch, approvalToken: signApproval(order.id, ch) });
});
