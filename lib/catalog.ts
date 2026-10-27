import catalog from "@/data/catalog.json";
export type Item = (typeof catalog)[number];
// Units whose spacing / case is normalized ("100mg" == "100 mg" == "100 MG", "5mg/ml" == "5 mg / ml").
const UNIT = "mcg|mg|g|kg|ml|l|iu|units?|%";
export const normalize = (s: string) =>
  s.toLowerCase()
    .replace(/[^a-z0-9%./]+/g, " ")           // keep letters, digits, %, decimal point and "/"
    .replace(/\s*\/\s*/g, "/")                 // "mg / ml" -> "mg/ml"
    .replace(new RegExp(`(\\d)\\s*(${UNIT})(?=$|[\\s/])`, "g"), "$1 $2") // "100mg" -> "100 mg", "1%" -> "1 %"
    .replace(/\s+/g, " ")
    .trim();
// EXACT match on the full normalized product name only.
// No fuzzy, prefix or ingredient matching, and never a substitute.
export function match(name: string, items: Item[] = catalog): Item | null {
  const n = normalize(name);
  return items.find(c => normalize(c.name) === n) ?? null;
}
export { catalog };
