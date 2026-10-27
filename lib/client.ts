// Small client-side helpers kept free of React so they can be unit-tested.
export type AppConfig = { ai: string; paypal: string; demoPin?: boolean };
export const SAMPLES = ["rx-1.png", "rx-2.png", "rx-3.png"] as const;

/** Validates the /api/config body. Returns undefined for anything malformed. */
export const parseConfig = (j: unknown): AppConfig | undefined => {
  const o = j as Partial<AppConfig> | null;
  if (!o || typeof o !== "object" || typeof o.ai !== "string" || typeof o.paypal !== "string") return undefined;
  return { ai: o.ai, paypal: o.paypal, demoPin: o.demoPin === true };
};

export type Badge = { label: string; tone: "loading" | "error" | "mock" | "real" };
/** Header badges. Neutral "loading…" until the config arrives, so we never flash "mock" for a sandbox server. */
export const configBadges = (cfg: AppConfig | undefined, failed = false): Badge[] => {
  if (!cfg) {
    const v = failed ? "unavailable" : "loading…"; const tone = failed ? "error" : "loading";
    return [{ label: `AI: ${v}`, tone }, { label: `PayPal: ${v}`, tone }];
  }
  return [
    { label: `AI: ${cfg.ai}`, tone: cfg.ai === "mock" ? "mock" : "real" },
    { label: `PayPal: ${cfg.paypal}`, tone: cfg.paypal === "mock" ? "mock" : "real" },
  ];
};

/** Synchronous single-flight guard. React state is stale inside async handlers, so a click can't rely on `busy`. */
export const createBusyGuard = () => {
  let label = "";
  return {
    get busy() { return label; },
    tryStart(l: string) { if (label) return false; label = l || "Working…"; return true; },
    set(l: string) { if (label) label = l; },
    end() { label = ""; },
  };
};

/** Fetches a bundled sample and converts it to a data URL. Throws a readable error instead of failing silently. */
export async function loadSample(name: string, fetchFn: typeof fetch, toDataUrl: (b: Blob) => Promise<string>): Promise<string> {
  if (!(SAMPLES as readonly string[]).includes(name)) throw new Error(`Unknown sample ${name}`);
  const r = await fetchFn(`/samples/${name}`);
  if (!r.ok) throw new Error(`Could not load sample ${name} (${r.status})`);
  const d = await toDataUrl(await r.blob());
  if (!d.startsWith("data:image/")) throw new Error(`Sample ${name} is not an image`);
  return d;
}
