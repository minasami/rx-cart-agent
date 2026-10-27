import { z } from "zod";
export const MAX_QTY = 999;
export const CartItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(MAX_QTY),
});
export const CartItemsSchema = z.array(CartItemSchema).min(1).max(50);
export type CartItem = z.infer<typeof CartItemSchema>;
export const PinSchema = z.string().max(64);
export const CartHashSchema = z.string().regex(/^[a-f0-9]{64}$/, "Invalid cart hash");
// PayPal order IDs are alphanumeric; mock IDs are MOCK-XXXX. Also keeps the ID safe to put in a URL path.
export const OrderIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid order ID");
