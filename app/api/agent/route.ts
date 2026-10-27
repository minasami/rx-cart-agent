import { z } from "zod";
import { runAgent, toolkitCreateOrder, mockCreateOrder } from "@/lib/agent";
import { pharmacistApproved } from "@/lib/gate";
import { aiProvider } from "@/lib/ai";
import { CartItemsSchema, PinSchema } from "@/lib/schemas";
import { HttpError, parseBody, route } from "@/lib/http";
const Body = z.object({ items: CartItemsSchema, pharmacistPin: PinSchema.optional() });
export const POST = route(async req => {
  const { items, pharmacistPin } = await parseBody(req, Body);
  const approved = pharmacistApproved(pharmacistPin); // server-side; the model never sees the PIN
  const paypalLive = process.env.PAYPAL_MODE === "sandbox" && !!process.env.PAYPAL_CLIENT_ID;
  let r: Awaited<ReturnType<typeof runAgent>>;
  try { r = await runAgent({ items, approved, createOrder: paypalLive ? await toolkitCreateOrder() : mockCreateOrder, useModel: aiProvider() === "gateway" }); }
  catch (e) { console.error(e); throw new HttpError(502, "Agent run failed (AI or PayPal provider error)"); }
  return Response.json({ ...r, approved, paypal: paypalLive ? "sandbox" : "mock" });
});
