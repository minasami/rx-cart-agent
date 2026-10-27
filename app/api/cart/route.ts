import { z } from "zod";
import { buildCart } from "@/lib/cart";
import { CartItemsSchema } from "@/lib/schemas";
import { parseBody, route } from "@/lib/http";
const Body = z.object({ items: CartItemsSchema });
export const POST = route(async req => {
  const { items } = await parseBody(req, Body);
  return Response.json({ ...buildCart(items), requiresPharmacistConfirm: true });
});
