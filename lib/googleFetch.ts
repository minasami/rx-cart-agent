/**
 * Retry + fallback policy for the Gemini API (used as @ai-sdk/google's `fetch`; the SDK's own retries are disabled for google).
 * - 503 UNAVAILABLE ("high demand", common on the free tier): retry with a short backoff.
 * - 429 RESOURCE_EXHAUSTED: the free tier is ~5 requests/min and ~20 requests/day PER MODEL, so quick SDK retries only
 *   burn quota. Wait for the server's RetryInfo.retryDelay once if it is short; otherwise (e.g. the daily quota) remember
 *   the model as exhausted until the delay passes and try the next fallback model (quotas are per model).
 * Never logs: requests carry the API key header and the prescription image.
 */
export type GeminiRetryOptions = {
  retries503?: number; backoffMs?: number[]; max429WaitMs?: number; fallbackModels?: string[];
  sleep?: (ms: number) => Promise<void>; now?: () => number;
};
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
/** Response header naming the Gemini model that actually answered (differs from the configured one after a fallback). */
export const ANSWERED_MODEL_HEADER = "x-rx-answered-model";
const tagged = (res: Response, id: string) => {
  const headers = new Headers(res.headers); headers.set(ANSWERED_MODEL_HEADER, id);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
const MODEL_IN_URL = /\/models\/([^/:?]+):(generateContent|streamGenerateContent)/;
export function geminiRetryFetch(base: typeof fetch = (...a) => fetch(...a), o: GeminiRetryOptions = {}): typeof fetch {
  const { retries503 = 2, backoffMs = [1500, 4000], max429WaitMs = 30_000, fallbackModels = [], sleep = defaultSleep, now = Date.now } = o;
  const exhaustedUntil = new Map<string, number>(); // model -> epoch ms (per process)
  async function attempt(input: RequestInfo | URL, init?: RequestInit): Promise<{ res: Response; exhaustedFor?: number }> {
    let n503 = 0, waited429 = false;
    for (;;) {
      const res = await base(input, init);
      if (res.status === 503 && n503 < retries503) { await sleep(backoffMs[Math.min(n503++, backoffMs.length - 1)]); continue; }
      if (res.status === 429) {
        const d = await retryDelayMs(res);
        if (d !== undefined && d <= max429WaitMs && !waited429) { waited429 = true; await sleep(d + 500); continue; }
        return { res, exhaustedFor: d ?? 60_000 };
      }
      return { res };
    }
  }
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : undefined;
    const m = url?.match(MODEL_IN_URL);
    if (!url || !m) return (await attempt(input, init)).res;
    const all = [m[1], ...fallbackModels.filter(f => f !== m[1])];
    const live = all.filter(id => (exhaustedUntil.get(id) ?? 0) <= now());
    let last: Response | undefined;
    for (const id of live.length ? live : [m[1]]) {
      const { res, exhaustedFor } = await attempt(url.replace(MODEL_IN_URL, `/models/${id}:$2`), init);
      if (exhaustedFor !== undefined) exhaustedUntil.set(id, now() + exhaustedFor);
      if (res.status !== 429 && res.status !== 503) return res.ok ? tagged(res, id) : res;
      last = res;
    }
    return last!;
  }) as typeof fetch;
}
