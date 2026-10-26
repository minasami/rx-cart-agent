import { generateObject } from "ai";
import { z } from "zod";
export type Extracted = { items: { name: string; quantity: number }[]; provider: "mock" | "gateway" };
// AI_PROVIDER=gateway uses Vercel AI Gateway (needs AI_GATEWAY_API_KEY or Vercel OIDC). Anything else = mock.
export const aiProvider = (): "mock" | "gateway" => (process.env.AI_PROVIDER === "gateway" ? "gateway" : "mock");

// Deterministic fixtures for the bundled SYNTHETIC samples (what a model should read off them).
export const MOCK_FIXTURES: Record<string, { name: string; quantity: number }[]> = {
  "rx-1.png": [{ name: "Fictamol 500 mg tablets", quantity: 2 }, { name: "Demoxin 100 mg syrup", quantity: 1 }],
  "rx-2.png": [{ name: "Placebrin 250 mg capsules", quantity: 1 }, { name: "Samplivir 1% cream", quantity: 1 }, { name: "Mockazole 20 mg tablets", quantity: 1 }],
  "rx-3.png": [{ name: "Fictamol 500 mg tablets", quantity: 1 }, { name: "Unknownex 5 mg tablets", quantity: 1 }],
};

export async function extractPrescription(imageDataUrl: string, sampleId?: string): Promise<Extracted> {
  if (aiProvider() === "mock") return { items: MOCK_FIXTURES[sampleId ?? ""] ?? MOCK_FIXTURES["rx-1.png"], provider: "mock" };
  const { object } = await generateObject({
    model: process.env.AI_MODEL ?? "openai/gpt-4o-mini",
    schema: z.object({ items: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })) }),
    system: "You transcribe synthetic demo prescriptions. Output only medicine names and pack quantities exactly as written. Never add, infer, correct, substitute or give clinical/dosing advice.",
    messages: [{ role: "user", content: [{ type: "text", text: "Transcribe the medicines and quantities." }, { type: "image", image: imageDataUrl }] }],
  });
  return { ...object, provider: "gateway" };
}
