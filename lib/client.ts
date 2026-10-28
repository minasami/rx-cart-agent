// Small client-side helpers kept free of React so they can be unit-tested.
import { isClientId } from "./paypalSdk";
export type AppConfig = { ai: string; paypal: string; demoPin?: boolean; paypalClientId?: string; paypalEnv?: "sandbox" };
export const SAMPLES = ["rx-1.png", "rx-2.png", "rx-3.png"] as const;

/** Validates the /api/config body. Returns undefined for anything malformed. */
export const parseConfig = (j: unknown): AppConfig | undefined => {
  const o = j as Partial<AppConfig> | null;
  if (!o || typeof o !== "object" || typeof o.ai !== "string" || typeof o.paypal !== "string") return undefined;
  const c: AppConfig = { ai: o.ai, paypal: o.paypal, demoPin: o.demoPin === true };
  // The SDK client ID is only used in sandbox mode and only if it is a well-formed ID.
  if (o.paypal === "sandbox" && o.paypalEnv === "sandbox" && isClientId(o.paypalClientId)) { c.paypalClientId = o.paypalClientId; c.paypalEnv = "sandbox"; }
  return c;
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

/** Elapsed / "still working" hint for a slow step (e.g. free-tier Gemini extraction). Empty for the first 2s. */
export const busyHint = (elapsedMs: number, slowAfterMs = 8_000): string => {
  if (!(elapsedMs >= 2_000)) return "";
  const s = Math.floor(elapsedMs / 1000);
  return elapsedMs >= slowAfterMs ? `${s}s, still working (the free-tier AI can take up to ~40s)` : `${s}s`;
};
/** A failed extraction can fall back to the labeled demo fixture only for the bundled samples. */
export const demoFallbackFor = (sampleId: string | undefined): string | undefined =>
  sampleId && (SAMPLES as readonly string[]).includes(sampleId) ? sampleId : undefined;
/** Cart status label shown to the user. Out-of-stock and not-found lines are never charged or substituted. */
export const OUT_OF_STOCK_NOTE = "Out of stock — not added, no substitute offered";
export const lineStatusText = (status: string): string =>
  status === "ok" ? "✓ In stock" : status === "not_found" ? "✕ Not in catalog: no substitute" : `⚠ ${OUT_OF_STOCK_NOTE}`;
/** Pay buttons (PayPal + AI agent) are disabled, aria-disabled and muted until the cart is confirmed. */
export const payButtonProps = (confirmed: boolean, busy: boolean, extraBlock = false) => {
  const off = !confirmed || busy || extraBlock;
  return { disabled: off, "aria-disabled": off, className: !confirmed ? "pay-locked" : undefined, title: !confirmed ? "Confirm the cart first" : undefined };
};
