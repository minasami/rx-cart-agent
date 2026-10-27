import { describe, it, expect, vi } from "vitest";
import { parseConfig, configBadges, createBusyGuard, loadSample } from "@/lib/client";

describe("parseConfig", () => {
  it("accepts a valid body", () => expect(parseConfig({ ai: "mock", paypal: "sandbox", demoPin: true })).toEqual({ ai: "mock", paypal: "sandbox", demoPin: true }));
  it("rejects malformed bodies", () => {
    for (const b of [null, undefined, "x", {}, { ai: "mock" }, { ai: 1, paypal: "mock" }]) expect(parseConfig(b)).toBeUndefined();
  });
  it("only treats demoPin === true as true", () => expect(parseConfig({ ai: "mock", paypal: "mock", demoPin: "yes" })?.demoPin).toBe(false));
});

describe("configBadges", () => {
  it("is neutral while loading (never 'mock')", () => {
    const b = configBadges(undefined);
    expect(b.map(x => x.tone)).toEqual(["loading", "loading"]);
    expect(b.map(x => x.label).join(" ")).not.toMatch(/mock/);
  });
  it("shows unavailable on failure", () => expect(configBadges(undefined, true).map(x => x.label)).toEqual(["AI: unavailable", "PayPal: unavailable"]));
  it("reflects the loaded config", () => {
    expect(configBadges({ ai: "mock", paypal: "sandbox" })).toEqual([{ label: "AI: mock", tone: "mock" }, { label: "PayPal: sandbox", tone: "real" }]);
  });
});

describe("createBusyGuard", () => {
  it("rejects a second start until ended", () => {
    const g = createBusyGuard();
    expect(g.tryStart("Loading sample…")).toBe(true);
    expect(g.tryStart("again")).toBe(false);
    g.set("Reading prescription…"); expect(g.busy).toBe("Reading prescription…");
    g.end(); expect(g.busy).toBe(""); expect(g.tryStart("x")).toBe(true);
  });
  it("set() is a no-op when idle", () => { const g = createBusyGuard(); g.set("x"); expect(g.busy).toBe(""); });
});

describe("loadSample", () => {
  const ok = (body = "png") => vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  it("returns the data URL", async () => {
    const f = ok();
    await expect(loadSample("rx-2.png", f, async () => "data:image/png;base64,AA")).resolves.toBe("data:image/png;base64,AA");
    expect(f).toHaveBeenCalledWith("/samples/rx-2.png");
  });
  it("throws on HTTP errors instead of failing silently", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(loadSample("rx-1.png", f, async () => "data:image/png;base64,AA")).rejects.toThrow(/404/);
  });
  it("rejects unknown names and non-image payloads", async () => {
    await expect(loadSample("../x", ok(), async () => "data:image/png;base64,AA")).rejects.toThrow(/Unknown sample/);
    await expect(loadSample("rx-1.png", ok(), async () => "data:text/html;base64,AA")).rejects.toThrow(/not an image/);
  });
});
