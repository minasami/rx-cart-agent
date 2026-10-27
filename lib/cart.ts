import { match, type Item } from "./catalog";
import { CartItemsSchema } from "./schemas";
export type Line = { requested: string; quantity: number; match: Item | null; status: "ok" | "not_found" | "out_of_stock" };
/** Throws a ZodError for non-positive, non-integer or otherwise invalid quantities (validated server-side). */
export function buildCart(input: unknown) {
  const items = CartItemsSchema.parse(input);
  const lines: Line[] = items.map(i => { const m = match(i.name); return { requested: i.name, quantity: i.quantity, match: m, status: !m ? "not_found" : m.stock < i.quantity ? "out_of_stock" : "ok" }; });
  const total = lines.filter(l => l.status === "ok").reduce((s, l) => s + l.match!.priceUSD * l.quantity, 0);
  return { lines, totalUSD: total.toFixed(2) };
}
