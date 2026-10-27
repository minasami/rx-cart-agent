/** Effective PayPal mode. "sandbox" only when explicitly selected AND credentials are present; otherwise "mock".
 *  Live PayPal is never used. All routes share this so create/capture/config can't disagree. */
export const paypalMode = (): "mock" | "sandbox" =>
  process.env.PAYPAL_MODE === "sandbox" && !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET ? "sandbox" : "mock";
