import { generateObject } from "ai";
import { z } from "zod";
// Extract medicine names/quantities from a MOCK prescription image. No dosing or clinical advice.
export async function POST(req: Request) {
  const { imageDataUrl } = await req.json();
  const { object } = await generateObject({
    model: process.env.AI_MODEL ?? "openai/gpt-4o-mini",
    schema: z.object({ items: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })) }),
    messages: [{ role: "user", content: [
      { type: "text", text: "Transcribe only the medicine names and pack quantities written on this synthetic prescription. Do not add, infer, substitute or advise." },
      { type: "image", image: imageDataUrl } ] }],
  });
  return Response.json(object);
}
