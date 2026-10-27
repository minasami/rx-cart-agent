// PayPal JS SDK helpers (no React), shared by /api/config and the page so they can be unit-tested.
/** PayPal REST client IDs are URL-safe tokens (about 80 chars). Anything else is never put in a script URL. */
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const isClientId = (v: unknown): v is string => typeof v === "string" && CLIENT_ID_RE.test(v);

/** The SDK host for the environment. Live PayPal is never used by this demo, so only sandbox is supported. */
export const SDK_HOST = { sandbox: "https://www.sandbox.paypal.com" } as const;
export type PayPalEnv = keyof typeof SDK_HOST;

/** JS SDK script URL: Buttons only, USD, intent=capture, PayPal wallet only (no card / Pay Later / Venmo). */
export function paypalSdkUrl(clientId: string, env: PayPalEnv = "sandbox"): string {
  if (!isClientId(clientId)) throw new Error("Invalid PayPal client ID");
  const host = SDK_HOST[env]; if (!host) throw new Error("Unsupported PayPal environment");
  const q = new URLSearchParams({ "client-id": clientId, currency: "USD", intent: "capture", components: "buttons", "disable-funding": "card,paylater,venmo" });
  return `${host}/sdk/js?${q}`;
}

type Doc = Pick<Document, "createElement" | "head">;
type Win = { paypal?: unknown };
const loads = new Map<string, Promise<unknown>>();
export function _resetSdkLoads() { loads.clear(); }

/** Injects the SDK <script> once per URL and resolves with `window.paypal`. A failed load is forgotten so it can be retried. */
export function loadPayPalSdk(url: string, doc: Doc = document, win: Win = window as unknown as Win): Promise<unknown> {
  const hit = loads.get(url); if (hit) return hit;
  const p = new Promise<unknown>((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = url; s.async = true; s.setAttribute("data-rx-paypal-sdk", "");
    s.onload = () => win.paypal ? resolve(win.paypal) : reject(new Error("PayPal SDK loaded but window.paypal is missing"));
    s.onerror = () => reject(new Error("Could not load the PayPal SDK"));
    doc.head.appendChild(s);
  });
  p.catch(() => loads.delete(url));
  loads.set(url, p);
  return p;
}
