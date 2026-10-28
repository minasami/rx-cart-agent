import { describe, it, expect } from "vitest";
import { buildCart } from "../lib/cart";
import { lineStatusText, OUT_OF_STOCK_NOTE } from "../lib/client";
describe("out-of-stock lines", () => {
  const c = buildCart([{ name: "Fictamol 500 mg tablets", quantity: 2 }, { name: "Mockazole 20 mg tablets", quantity: 1 }]);
  it("are flagged out_of_stock and keep the requested item (no substitute)", () => {
    expect(c.lines[1].status).toBe("out_of_stock"); expect(c.lines[1].match?.name).toBe("Mockazole 20 mg tablets");
  });
  it("are excluded from the total", () => expect(c.totalUSD).toBe("7.00"));
  it("show a clear note", () => {
    expect(lineStatusText("out_of_stock")).toContain(OUT_OF_STOCK_NOTE);
    expect(OUT_OF_STOCK_NOTE).toBe("Out of stock — not added, no substitute offered");
    expect(lineStatusText("ok")).toBe("✓ In stock");
  });
});
import { payButtonProps } from "../lib/client";
describe("pay buttons before confirmation", () => {
  it("are disabled, aria-disabled and muted until confirmed", () => {
    expect(payButtonProps(false, false)).toMatchObject({ disabled: true, "aria-disabled": true, className: "pay-locked" });
  });
  it("are enabled once confirmed and idle", () => expect(payButtonProps(true, false)).toMatchObject({ disabled: false, "aria-disabled": false, className: undefined }));
  it("stay disabled while busy or blocked", () => {
    expect(payButtonProps(true, true).disabled).toBe(true); expect(payButtonProps(true, false, true).disabled).toBe(true);
  });
});
