import { aiProvider } from "@/lib/ai";
import { paypalMode } from "@/lib/mode";
import { isClientId } from "@/lib/paypalSdk";
export const dynamic = "force-dynamic";
/** Runtime UI config. In sandbox mode it also serves the PayPal client ID (public by design, it ends up in the
 *  SDK script URL anyway) so the in-page Buttons need no build-time NEXT_PUBLIC_ variable. Never the secret. */
export async function GET() {
  const paypal = paypalMode();
  const cid = process.env.PAYPAL_CLIENT_ID;
  const sdk = paypal === "sandbox" && isClientId(cid) ? { paypalClientId: cid, paypalEnv: "sandbox" as const } : {};
  return Response.json({ ai: aiProvider(), paypal, demoPin: paypal === "mock" && !!process.env.PHARMACIST_DEMO_PIN, ...sdk },
    { headers: { "Cache-Control": "no-store" } });
}
