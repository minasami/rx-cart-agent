import { aiProvider } from "@/lib/ai";
import { paypalMode } from "@/lib/mode";
export async function GET() {
  return Response.json({ ai: aiProvider(), paypal: paypalMode(), demoPin: paypalMode() === "mock" && !!process.env.PHARMACIST_DEMO_PIN });
}
