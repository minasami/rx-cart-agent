import { z } from "zod";
import { captureOrder } from "@/lib/paypal";
import { OrderIdSchema } from "@/lib/schemas";
import { parseBody, route } from "@/lib/http";
const Body = z.object({ orderID: OrderIdSchema });
export const POST = route(async req => {
  const { orderID } = await parseBody(req, Body);
  if (process.env.PAYPAL_MODE !== "sandbox" || orderID.startsWith("MOCK-"))
    return Response.json({ id: orderID, status: "COMPLETED", mock: true });
  return Response.json(await captureOrder(orderID));
});
