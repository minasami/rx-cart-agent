import { buildCart } from "@/lib/cart";
export async function POST(req: Request) {
  const { items } = await req.json();
  return Response.json({ ...buildCart(items), requiresPharmacistConfirm: true });
}
