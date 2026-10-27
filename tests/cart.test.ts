import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { buildCart } from "../lib/cart";
const name = "Fictamol 500 mg tablets";
describe("cart quantity validation (server-side, zod)", () => {
  for (const quantity of [0, -1, -100, 1.5, 0.1, NaN, Infinity, 1000]) {
    it(`rejects quantity ${quantity}`, () => expect(() => buildCart([{ name, quantity }])).toThrow(ZodError));
  }
  it("rejects a string quantity", () => expect(() => buildCart([{ name, quantity: "2" }])).toThrow(ZodError));
  it("rejects a missing quantity", () => expect(() => buildCart([{ name }])).toThrow(ZodError));
  it("rejects an empty name", () => expect(() => buildCart([{ name: "  ", quantity: 1 }])).toThrow(ZodError));
  it("rejects a non-array body", () => expect(() => buildCart({ name, quantity: 1 })).toThrow(ZodError));
  it("a negative line can no longer lower the total", () => {
    expect(() => buildCart([{ name, quantity: 4 }, { name: "Placebrin 250 mg capsules", quantity: -1 }])).toThrow(ZodError);
  });
  it("accepts positive integers", () => expect(buildCart([{ name, quantity: 3 }]).totalUSD).toBe("10.50"));
});
