import { paypalMode } from "@/lib/mode";
import { jsonError } from "@/lib/http";
/** Mock mode only: lets the "Use demo PIN" button fill the (masked) PIN field. Never available in sandbox mode. */
export async function GET() {
  const pin = process.env.PHARMACIST_DEMO_PIN;
  if (paypalMode() !== "mock" || !pin) return jsonError(404, "Not available");
  return Response.json({ pin }, { headers: { "Cache-Control": "no-store" } });
}
