import { captureOrder } from "@/lib/paypal";
export async function POST(req: Request) {
  const { orderID } = await req.json();
  if (process.env.PAYPAL_MODE !== "sandbox" || String(orderID).startsWith("MOCK-"))
    return Response.json({ id: orderID, status: "COMPLETED", mock: true });
  return Response.json(await captureOrder(orderID));
}
