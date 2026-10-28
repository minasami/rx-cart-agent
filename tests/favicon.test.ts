import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
describe("favicon", () => {
  it("app/icon.svg is a valid SVG", () => {
    const s = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
    expect(s).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/); expect(s.trim()).toMatch(/<\/svg>$/);
  });
});
