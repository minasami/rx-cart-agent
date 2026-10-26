import { extractPrescription } from "@/lib/ai";
export async function POST(req: Request) {
  const { imageDataUrl, sampleId } = await req.json();
  try { return Response.json(await extractPrescription(imageDataUrl, sampleId)); }
  catch (e: any) { return Response.json({ error: e.message ?? "Extraction failed" }, { status: 500 }); }
}
