import { aiProvider } from "@/lib/ai";
export async function GET() {
  return Response.json({ ai: aiProvider(), paypal: process.env.PAYPAL_MODE === "sandbox" && !!process.env.PAYPAL_CLIENT_ID ? "sandbox" : "mock" });
}
