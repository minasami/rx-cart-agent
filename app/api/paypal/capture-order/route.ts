import { z } from "zod";
import { captureOrder } from "@/lib/paypal";
import { buildCart } from "@/lib/cart";
import { cartHash, markCaptured, releaseCaptured, verifyApproval } from "@/lib/approval";
import { CartItemsSchema, OrderIdSchema } from "@/lib/schemas";
import { paypalMode } from "@/lib/mode";
import { jsonError, parseBody, route } from "@/lib/http";
const Body = z.object({ orderID: OrderIdSchema, approvalToken: z.string().min(1).max(2048), items: CartItemsSchema });
export const POST = route(async req => {
  const { orderID, approvalToken, items } = await parseBody(req, Body);
  const isMockId = orderID.startsWith("MOCK-");
  const mode = paypalMode();
  // Mock mode only ever captures mock orders; in sandbox a MOCK- id must never short-circuit to a fake "COMPLETED".
  if (mode === "mock" && !isMockId) return jsonError(400, "Only MOCK- orders can be captured in mock mode");
  if (mode === "sandbox" && isMockId) return jsonError(400, "Mock orders cannot be captured in sandbox mode");
  // Capture requires the server-issued approval for THIS order and THIS cart (recomputed server-side).
  const cart = buildCart(items);
  const v = verifyApproval(approvalToken, orderID, cartHash(cart));
  if (!v.ok) return jsonError(403, "Capture not approved for this order and cart", { reason: v.reason });
  if (!markCaptured(orderID)) return jsonError(409, "Order already captured");
  if (mode === "mock") return Response.json({ id: orderID, status: "COMPLETED", mock: true, totalUSD: cart.totalUSD });
  try { return Response.json(await captureOrder(orderID)); }
  catch (e) { releaseCaptured(orderID); throw e; }
});
