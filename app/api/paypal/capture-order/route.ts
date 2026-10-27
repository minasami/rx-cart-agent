import { z } from "zod";
import { captureOrder } from "@/lib/paypal";
import { OrderIdSchema } from "@/lib/schemas";
import { paypalMode } from "@/lib/mode";
import { jsonError, parseBody, route } from "@/lib/http";
const Body = z.object({ orderID: OrderIdSchema });
export const POST = route(async req => {
  const { orderID } = await parseBody(req, Body);
  const isMockId = orderID.startsWith("MOCK-");
  if (paypalMode() === "mock") {
    // Mock mode only ever captures mock orders.
    if (!isMockId) return jsonError(400, "Only MOCK- orders can be captured in mock mode");
    return Response.json({ id: orderID, status: "COMPLETED", mock: true });
  }
  // Sandbox mode: a MOCK- id must never short-circuit to a fake "COMPLETED".
  if (isMockId) return jsonError(400, "Mock orders cannot be captured in sandbox mode");
  return Response.json(await captureOrder(orderID));
});
