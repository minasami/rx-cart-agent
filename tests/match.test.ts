import { describe, it, expect } from "vitest";
import { match, normalize } from "../lib/catalog";
import { buildCart } from "../lib/cart";
describe("exact matching, no substitution", () => {
  it("matches the exact name, ignoring case and spacing", () => { expect(match("  fictamol 500 MG tablets ")?.sku).toBe("SYN-001"); });
  it("does not match a different strength", () => { expect(match("Fictamol 1000 mg tablets")).toBeNull(); });
  it("does not prefix-match a brand alone", () => { expect(match("Fictamol")).toBeNull(); });
  it("does not match a misspelling", () => { expect(match("Fictamoll 500 mg tablets")).toBeNull(); });
  it("normalizes unit spacing and case only", () => {
    expect(match("Fictamol 500mg tablets")?.sku).toBe("SYN-001");
    expect(match("FICTAMOL 500MG TABLETS")?.sku).toBe("SYN-001");
    expect(match("Samplivir 1 % cream")?.sku).toBe("SYN-005");
    expect(normalize("Demoxin 5mg/ml syrup")).toBe(normalize("Demoxin 5 mg / ml syrup"));
    expect(normalize("Demoxin 5 MG/ML syrup")).toBe("demoxin 5 mg/ml syrup");
    expect(normalize("Fictamol 0.5mg")).toBe("fictamol 0.5 mg");
  });
  it("unit normalization does not merge different strengths or names", () => {
    expect(match("Fictamol 5000mg tablets")).toBeNull();
    expect(match("Fictamol 50 0mg tablets")).toBeNull();
    expect(normalize("Fictamol 500 mg")).not.toBe(normalize("Fictamol 500 g"));
    expect(normalize("Mgtab 5 mg")).toBe("mgtab 5 mg"); // letters inside names untouched
  });
  it("flags unknown and out-of-stock items without swapping", () => {
    const c = buildCart([{ name: "Unknownex 5 mg", quantity: 1 }, { name: "Mockazole 20 mg tablets", quantity: 1 }, { name: "Fictamol 500 mg tablets", quantity: 2 }]);
    expect(c.lines.map(l => l.status)).toEqual(["not_found", "out_of_stock", "ok"]);
    expect(c.lines[0].match).toBeNull();
    expect(c.totalUSD).toBe("7.00");
  });
});
