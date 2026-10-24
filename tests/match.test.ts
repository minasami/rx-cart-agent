import { describe, it, expect } from "vitest";
import { match } from "../lib/catalog";
import { buildCart } from "../lib/cart";
describe("exact matching, no substitution", () => {
  it("matches the exact name, ignoring case and spacing", () => { expect(match("  fictamol 500 MG tablets ")?.sku).toBe("SYN-001"); });
  it("does not match a different strength", () => { expect(match("Fictamol 1000 mg tablets")).toBeNull(); });
  it("does not prefix-match a brand alone", () => { expect(match("Fictamol")).toBeNull(); });
  it("does not match a misspelling", () => { expect(match("Fictamoll 500 mg tablets")).toBeNull(); });
  it("flags unknown and out-of-stock items without swapping", () => {
    const c = buildCart([{ name: "Unknownex 5 mg", quantity: 1 }, { name: "Mockazole 20 mg tablets", quantity: 1 }, { name: "Fictamol 500 mg tablets", quantity: 2 }]);
    expect(c.lines.map(l => l.status)).toEqual(["not_found", "out_of_stock", "ok"]);
    expect(c.lines[0].match).toBeNull();
    expect(c.totalUSD).toBe("7.00");
  });
});
