import { tool, generateText, isStepCount } from "ai";
import { z } from "zod";
import { buildCart } from "./cart";
import { cancelUrl, returnUrl } from "./urls";

export type ToolkitCreateOrder = (args: Record<string, unknown>) => Promise<any>;
export type TraceEntry = { tool: string; input: unknown; output: unknown };

/** Payload in @paypal/agent-toolkit create_order schema, built ONLY from the server-side cart. */
export function toToolkitOrder(items: { name: string; quantity: number }[]) {
  const { lines } = buildCart(items);
  return {
    currencyCode: "USD",
    items: lines.filter(l => l.status === "ok").map(l => ({
      name: l.match!.name, quantity: l.quantity, description: `${l.match!.pack} (synthetic demo item)`,
      itemCost: l.match!.priceUSD, taxPercent: 0, itemTotal: +(l.match!.priceUSD * l.quantity).toFixed(2),
    })),
    notes: "Synthetic demo order. Pharmacist-confirmed.",
    // The toolkit (1.11.0) maps ONLY these two to payment_source.paypal.experience_context (it defaults them to
    // https://example.com/...). It has no brand_name / user_action / shipping_preference inputs; it omits
    // purchase_units[].shipping when no shippingAddress is given.
    returnUrl: returnUrl(), cancelUrl: cancelUrl(),
  };
}

/**
 * Agent tools. The model controls NO prices, amounts or approval: the cart comes from the server request,
 * and `approved` is computed server-side from the pharmacist PIN (the model never sees the PIN).
 */
export function createAgentTools(opts: { items: { name: string; quantity: number }[]; approved: boolean; createOrder: ToolkitCreateOrder; trace?: TraceEntry[] }) {
  const log = (t: string, input: unknown, output: unknown) => { opts.trace?.push({ tool: t, input, output }); return output; };
  return {
    build_cart: tool({
      description: "Build the cart from the extracted prescription items using exact catalog matches only. Never substitutes.",
      inputSchema: z.object({}),
      execute: async () => log("build_cart", {}, buildCart(opts.items)),
    }),
    create_paypal_order: tool({
      description: "Create a PayPal (sandbox) order for the in-stock cart lines. Only works after a pharmacist has confirmed the cart on the server.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!opts.approved) return log("create_paypal_order", {}, { error: "BLOCKED: pharmacist confirmation required before payment." });
        const payload = toToolkitOrder(opts.items);
        if (payload.items.length === 0) return log("create_paypal_order", {}, { error: "Cart has no in-stock items." });
        return log("create_paypal_order", payload, await opts.createOrder(payload));
      },
    }),
  };
}

/**
 * Real PayPal Agent Toolkit create_order (sandbox), limited to the orders.create action.
 * The toolkit fetches an OAuth token once per instance and never refreshes it, so the instance is reused
 * (one token instead of one per agent request) and rebuilt after TOOLKIT_TTL_MS, on a credential change, or
 * after an error result (e.g. an expired token).
 */
export const TOOLKIT_TTL_MS = 30 * 60_000;
type ToolkitExec = (args: Record<string, unknown>) => Promise<unknown>;
let toolkitCache: { key: string; exec: ToolkitExec; createdAt: number } | null = null;
export function _resetToolkitCache() { toolkitCache = null; }
async function newToolkitExec(): Promise<ToolkitExec> {
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  const tk = new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!, clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions: { orders: { create: true } }, context: { sandbox: true } },
  });
  const t = tk.getTools().create_order as any;
  return args => t.execute(args, {});
}
export async function toolkitCreateOrder(factory: () => Promise<ToolkitExec> = newToolkitExec, now = Date.now): Promise<ToolkitCreateOrder> {
  const key = `${process.env.PAYPAL_CLIENT_ID}`;
  if (!toolkitCache || toolkitCache.key !== key || now() - toolkitCache.createdAt > TOOLKIT_TTL_MS) toolkitCache = { key, exec: await factory(), createdAt: now() };
  const entry = toolkitCache;
  return async (args) => {
    const out = normalizeToolkitOutput(await entry.exec(args));
    if (out.error && toolkitCache === entry) toolkitCache = null;
    return out;
  };
}
/** The toolkit's execute() returns a JSON *string* (the PayPal order, or {error:{message,type}}); parse it to an object. */
export function normalizeToolkitOutput(out: unknown): Record<string, unknown> {
  let v: any = out;
  if (typeof out === "string") { try { v = JSON.parse(out); } catch { return { error: "PayPal toolkit returned a non-JSON response" }; } }
  if (!v || typeof v !== "object") return { error: "PayPal toolkit returned an empty response" };
  if (v.error && typeof v.error === "object") return { error: String(v.error.message ?? "PayPal error"), type: v.error.type };
  if (typeof v.name === "string" && typeof v.message === "string" && !v.id) return { error: `${v.name}: ${v.message}`, debug_id: v.debug_id };
  return v;
}
export const mockCreateOrder: ToolkitCreateOrder = async (p: any) => ({
  id: "MOCK-" + Math.random().toString(36).slice(2, 10).toUpperCase(), status: "CREATED", mock: true,
  total: (p.items as any[]).reduce((s, i) => s + i.itemTotal, 0).toFixed(2),
});

const SYSTEM = "You are a pharmacy ordering assistant for a SYNTHETIC demo. Steps: call build_cart, summarise flagged items (not found / out of stock) without suggesting alternatives, then call create_paypal_order. If it is blocked, tell the user a pharmacist must confirm first. Never give clinical, dosing or substitution advice.";

export async function runAgent(opts: { items: { name: string; quantity: number }[]; approved: boolean; createOrder: ToolkitCreateOrder; useModel: boolean }) {
  const trace: TraceEntry[] = [];
  const tools = createAgentTools({ ...opts, trace });
  if (!opts.useModel) { // deterministic mock agent: same tool sequence a model would follow
    const cart: any = await tools.build_cart.execute!({}, { toolCallId: "m1", messages: [] } as any);
    const order: any = await tools.create_paypal_order.execute!({}, { toolCallId: "m2", messages: [] } as any);
    const flagged = cart.lines.filter((l: any) => l.status !== "ok").map((l: any) => `${l.requested} (${l.status.replaceAll("_", " ")})`);
    const text = (flagged.length ? `Flagged, not substituted: ${flagged.join(", ")}. ` : "") + (order.error ? order.error : `PayPal order ${order.id} created for $${cart.totalUSD}.`);
    return { text, trace, provider: "mock" as const };
  }
  const r = await generateText({ model: process.env.AI_MODEL ?? "openai/gpt-4o-mini", system: SYSTEM, prompt: "Prepare and pay for this prescription order.", tools, stopWhen: isStepCount(4) });
  return { text: r.text, trace, provider: "gateway" as const };
}
