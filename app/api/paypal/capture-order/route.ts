import { captureOrder } from "@/lib/paypal";
export async function POST(req: Request) { const { orderID } = await req.json(); return Response.json(await captureOrder(orderID)); }
