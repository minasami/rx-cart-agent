import { describe, it, expect } from "vitest";
import { pharmacistApproved } from "../lib/gate";
describe("pharmacist PIN gate", () => {
  it("passes the correct PIN", () => expect(pharmacistApproved("4821", "4821")).toBe(true));
  it("rejects a wrong PIN", () => expect(pharmacistApproved("0000", "4821")).toBe(false));
  it("rejects a missing PIN", () => expect(pharmacistApproved(undefined, "4821")).toBe(false));
  it("rejects when no PIN is configured", () => expect(pharmacistApproved("", "")).toBe(false));
  it("rejects a non-string PIN", () => expect(pharmacistApproved(4821 as unknown, "4821")).toBe(false));
});
