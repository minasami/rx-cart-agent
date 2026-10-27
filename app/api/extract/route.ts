import { z } from "zod";
import { aiProvider, demoExtraction, extractPrescription } from "@/lib/ai";
import { SAMPLES } from "@/lib/client";
import { HttpError, parseBody, route } from "@/lib/http";
import { failureKind, logProviderError, publicReason } from "@/lib/providerError";
const Body = z.object({
  imageDataUrl: z.string().regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, "Expected an image data URL").max(8_000_000).optional(),
  sampleId: z.string().max(64).optional(),
  /** Explicit, labeled demo fallback: returns the bundled mock fixture for a sample, no AI call. */
  demo: z.literal(true).optional(),
}).refine(b => b.demo || b.imageDataUrl, { message: "imageDataUrl is required", path: ["imageDataUrl"] });
export const POST = route(async req => {
  const { imageDataUrl, sampleId, demo } = await parseBody(req, Body);
  if (demo) {
    if (!(SAMPLES as readonly string[]).includes(sampleId ?? "")) throw new HttpError(400, "Demo extraction is only available for the bundled samples");
    return Response.json({ ...demoExtraction(sampleId), demo: true });
  }
  const t0 = Date.now();
  try { return Response.json(await extractPrescription(imageDataUrl!, sampleId)); }
  catch (e) {
    const i = logProviderError("extract", e), provider = aiProvider(), reason = failureKind(i);
    console.error(`[extract] failed reason=${reason} ms=${Date.now() - t0}`);
    // 503 + Retry-After: the AI is unavailable right now (quota, overload, timeout, ...); the UI offers the demo fallback.
    throw new HttpError(503, `Extraction failed: ${publicReason(i, provider)}`, { reason, demoAvailable: true }, { "Retry-After": "30" });
  }
});
