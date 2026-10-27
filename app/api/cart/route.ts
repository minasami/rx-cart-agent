import { z } from "zod";
import { buildCart } from "@/lib/cart";
import { cartHash } from "@/lib/approval";
import { CartItemsSchema } from "@/lib/schemas";
import { parseBody, route } from "@/lib/http";
const Body = z.object({ items: CartItemsSchema });
export const POST = route(async req => {
  const { items } = await parseBody(req, Body);
  const cart = buildCart(items);
  // cartHash identifies exactly what the pharmacist reviews; order creation must present the same one.
  return Response.json({ ...cart, cartHash: cartHash(cart), requiresPharmacistConfirm: true });
});
