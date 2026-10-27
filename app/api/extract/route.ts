import { z } from "zod";
import { extractPrescription } from "@/lib/ai";
import { HttpError, parseBody, route } from "@/lib/http";
const Body = z.object({
  imageDataUrl: z.string().regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, "Expected an image data URL").max(8_000_000),
  sampleId: z.string().max(64).optional(),
});
export const POST = route(async req => {
  const { imageDataUrl, sampleId } = await parseBody(req, Body);
  try { return Response.json(await extractPrescription(imageDataUrl, sampleId)); }
  catch (e) { console.error(e); throw new HttpError(502, "Extraction failed (AI provider error)"); }
});
