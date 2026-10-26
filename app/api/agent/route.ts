import { runAgent, toolkitCreateOrder, mockCreateOrder } from "@/lib/agent";
import { pharmacistApproved } from "@/lib/gate";
import { aiProvider } from "@/lib/ai";
export async function POST(req: Request) {
  const { items, pharmacistPin } = await req.json();
  const approved = pharmacistApproved(pharmacistPin); // server-side; the model never sees the PIN
  const paypalLive = process.env.PAYPAL_MODE === "sandbox" && !!process.env.PAYPAL_CLIENT_ID;
  try {
    const r = await runAgent({ items, approved, createOrder: paypalLive ? await toolkitCreateOrder() : mockCreateOrder, useModel: aiProvider() === "gateway" });
    return Response.json({ ...r, approved, paypal: paypalLive ? "sandbox" : "mock" });
  } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
}
