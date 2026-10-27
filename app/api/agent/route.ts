import { z } from "zod";
import { runAgent, toolkitCreateOrder, mockCreateOrder } from "@/lib/agent";
import { checkPinLimited } from "@/lib/ratelimit";
import { buildCart } from "@/lib/cart";
import { cartHash, signApproval } from "@/lib/approval";
import { aiProvider } from "@/lib/ai";
import { CartHashSchema, CartItemsSchema, OrderIdSchema, PinSchema } from "@/lib/schemas";
import { paypalMode } from "@/lib/mode";
import { HttpError, jsonError, parseBody, route } from "@/lib/http";
const Body = z.object({ items: CartItemsSchema, pharmacistPin: PinSchema.optional(), cartHash: CartHashSchema });
export const POST = route(async req => {
  const { items, pharmacistPin, cartHash: reviewed } = await parseBody(req, Body);
  const ch = cartHash(buildCart(items));
  if (ch !== reviewed) return jsonError(409, "Cart changed since the pharmacist reviewed it. Rebuild and confirm again.");
  const approved = checkPinLimited(req, pharmacistPin); // server-side; the model never sees the PIN
  const paypalLive = paypalMode() === "sandbox";
  let r: Awaited<ReturnType<typeof runAgent>>;
  try { r = await runAgent({ items, approved, createOrder: paypalLive ? await toolkitCreateOrder() : mockCreateOrder, useModel: aiProvider() === "gateway" }); }
  catch (e) { console.error(e); throw new HttpError(502, "Agent run failed (AI or PayPal provider error)"); }
  // If the (gated) tool created an order, issue the capture approval bound to that order and the server-side cart.
  const created = [...r.trace].reverse().find(t => t.tool === "create_paypal_order")?.output as { id?: unknown } | undefined;
  const orderID = OrderIdSchema.safeParse(created?.id);
  const approval = approved && orderID.success ? { orderID: orderID.data, cartHash: ch, approvalToken: signApproval(orderID.data, ch) } : undefined;
  return Response.json({ ...r, approved, paypal: paypalLive ? "sandbox" : "mock", approval });
});
