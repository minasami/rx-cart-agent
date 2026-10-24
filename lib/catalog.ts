import catalog from "@/data/catalog.json";
export type Item = (typeof catalog)[number];
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9%.]+/g, " ").trim();
// EXACT match on the full normalized product name only.
// No fuzzy, prefix or ingredient matching, and never a substitute.
export function match(name: string, items: Item[] = catalog): Item | null {
  const n = normalize(name);
  return items.find(c => normalize(c.name) === n) ?? null;
}
export { catalog };
