/**
 * Retry policy for the Gemini API (used as @ai-sdk/google's `fetch`; the SDK's own retries are disabled for google).
 * - 503 UNAVAILABLE ("high demand", common on the free tier): retry with a short backoff.
 * - 429 RESOURCE_EXHAUSTED: the free tier is ~5 requests/min per model, so quick SDK retries only burn quota.
 *   Wait for the server's RetryInfo.retryDelay once, if it is short enough; otherwise fail fast.
 * Never logs: requests carry the API key header and the prescription image.
 */
export type GeminiRetryOptions = { retries503?: number; backoffMs?: number[]; max429WaitMs?: number; sleep?: (ms: number) => Promise<void> };
const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** Parses google.rpc.RetryInfo.retryDelay ("15s", "1.5s") from a Gemini error body, in ms. */
export async function retryDelayMs(res: Response): Promise<number | undefined> {
  try {
    const details = (await res.clone().json())?.error?.details;
    const d = Array.isArray(details) ? details.find((x: any) => typeof x?.retryDelay === "string")?.retryDelay : undefined;
    const m = typeof d === "string" ? d.match(/^(\d+(?:\.\d+)?)s$/) : null;
    return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
  } catch { return undefined; }
}
export function geminiRetryFetch(base: typeof fetch = (...a) => fetch(...a), o: GeminiRetryOptions = {}): typeof fetch {
  const { retries503 = 2, backoffMs = [1500, 4000], max429WaitMs = 30_000, sleep = defaultSleep } = o;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let n503 = 0, waited429 = false;
    for (;;) {
      const res = await base(input, init);
      if (res.status === 503 && n503 < retries503) { await sleep(backoffMs[Math.min(n503++, backoffMs.length - 1)]); continue; }
      if (res.status === 429 && !waited429) {
        const d = await retryDelayMs(res);
        if (d !== undefined && d <= max429WaitMs) { waited429 = true; await sleep(d + 500); continue; }
      }
      return res;
    }
  }) as typeof fetch;
}
