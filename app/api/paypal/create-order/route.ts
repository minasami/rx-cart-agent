import { createOrder } from "@/lib/paypal";
import { buildCart } from "@/lib/cart";
import { pharmacistApproved } from "@/lib/gate";
export async function POST(req: Request) {
  const { items, pharmacistPin } = await req.json();
  if (!pharmacistApproved(pharmacistPin)) return Response.json({ error: "Pharmacist confirmation required before payment" }, { status: 403 });
  const { totalUSD } = buildCart(items); // recompute server-side; never trust a client total
  if (Number(totalUSD) <= 0) return Response.json({ error: "Empty cart" }, { status: 400 });
  return Response.json(await createOrder(totalUSD));
}
