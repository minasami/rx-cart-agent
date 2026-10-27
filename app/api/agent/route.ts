import { z } from "zod";
import { runAgent, toolkitCreateOrder, mockCreateOrder } from "@/lib/agent";
import { pharmacistApproved } from "@/lib/gate";
import { buildCart } from "@/lib/cart";
import { cartHash, signApproval } from "@/lib/approval";
import { aiProvider } from "@/lib/ai";
import { CartItemsSchema, OrderIdSchema, PinSchema } from "@/lib/schemas";
import { paypalMode } from "@/lib/mode";
import { HttpError, parseBody, route } from "@/lib/http";
const Body = z.object({ items: CartItemsSchema, pharmacistPin: PinSchema.optional() });
export const POST = route(async req => {
  const { items, pharmacistPin } = await parseBody(req, Body);
  const approved = pharmacistApproved(pharmacistPin); // server-side; the model never sees the PIN
  const paypalLive = paypalMode() === "sandbox";
  let r: Awaited<ReturnType<typeof runAgent>>;
  try { r = await runAgent({ items, approved, createOrder: paypalLive ? await toolkitCreateOrder() : mockCreateOrder, useModel: aiProvider() === "gateway" }); }
  catch (e) { console.error(e); throw new HttpError(502, "Agent run failed (AI or PayPal provider error)"); }
  // If the (gated) tool created an order, issue the capture approval bound to that order and the server-side cart.
  const created = [...r.trace].reverse().find(t => t.tool === "create_paypal_order")?.output as { id?: unknown } | undefined;
  const orderID = OrderIdSchema.safeParse(created?.id);
  const ch = cartHash(buildCart(items));
  const approval = approved && orderID.success ? { orderID: orderID.data, cartHash: ch, approvalToken: signApproval(orderID.data, ch) } : undefined;
  return Response.json({ ...r, approved, paypal: paypalLive ? "sandbox" : "mock", approval });
});
