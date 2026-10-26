import { createOrder } from "@/lib/paypal";
import { buildCart } from "@/lib/cart";
import { pharmacistApproved } from "@/lib/gate";
export async function POST(req: Request) {
  const { items, pharmacistPin } = await req.json();
  if (!pharmacistApproved(pharmacistPin)) return Response.json({ error: "Pharmacist confirmation required before payment" }, { status: 403 });
  const { totalUSD } = buildCart(items); // recomputed server-side
  if (Number(totalUSD) <= 0) return Response.json({ error: "Empty cart" }, { status: 400 });
  if (process.env.PAYPAL_MODE !== "sandbox") return Response.json({ id: "MOCK-" + Date.now(), status: "CREATED", mock: true, totalUSD });
  return Response.json(await createOrder(totalUSD));
}
