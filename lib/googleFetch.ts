/**
 * Retry + fallback policy for the Gemini API (used as @ai-sdk/google's `fetch`; the SDK's own retries are disabled for google).
 * - Every HTTP attempt has a hard timeout (AbortSignal), and one logical call (all retries + fallbacks) has a total budget,
 *   so a slow/overloaded free tier can never hang a request: when the budget runs out we return a synthetic 504.
 * - 503 UNAVAILABLE ("high demand", common on the free tier) or an attempt timeout: short capped backoff, then next model.
 * - 429 RESOURCE_EXHAUSTED: the free tier is ~5 requests/min and ~20 requests/day PER MODEL, so quick retries only burn
 *   quota. Wait for the server's RetryInfo.retryDelay once only if it is short AND fits the remaining budget; otherwise
 *   (e.g. the daily quota) remember the model as exhausted until the delay passes and try the next fallback model.
 * Logs one line per attempt (model, status, ms). Never logs URLs, headers (API key) or bodies (prescription image).
 */
export type GeminiAttemptLog = { model: string; status: number | "timeout" | "network" | "skipped"; ms: number; note?: string };
export type GeminiRetryOptions = {
  retries503?: number; backoffMs?: number[]; max429WaitMs?: number; fallbackModels?: string[];
  /** Hard timeout per HTTP attempt (default 20s). */ attemptTimeoutMs?: number;
  /** Total budget for one call incl. retries, waits and fallbacks (default 35s). */ totalBudgetMs?: number;
  sleep?: (ms: number) => Promise<void>; now?: () => number; log?: (a: GeminiAttemptLog) => void;
};
export const GEMINI_ATTEMPT_TIMEOUT_MS = 20_000;
export const GEMINI_TOTAL_BUDGET_MS = 35_000;
const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const formatAttempt = (a: GeminiAttemptLog) => `[gemini] model=${a.model} status=${a.status} ms=${Math.round(a.ms)}${a.note ? ` ${a.note}` : ""}`;
const defaultLog = (a: GeminiAttemptLog) => console.info(formatAttempt(a));
/** Parses google.rpc.RetryInfo.retryDelay ("15s", "1.5s") from a Gemini error body, in ms. */
export async function retryDelayMs(res: Response): Promise<number | undefined> {
  try {
    const details = (await res.clone().json())?.error?.details;
    const d = Array.isArray(details) ? details.find((x: any) => typeof x?.retryDelay === "string")?.retryDelay : undefined;
    const m = typeof d === "string" ? d.match(/^(\d+(?:\.\d+)?)s$/) : null;
    return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
  } catch { return undefined; }
}
/** Quota id of a 429 (e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier"), for the attempt log. */
async function quotaId(res: Response): Promise<string | undefined> {
  try {
    const details = (await res.clone().json())?.error?.details;
    for (const d of Array.isArray(details) ? details : []) for (const v of Array.isArray(d?.violations) ? d.violations : [])
      if (typeof v?.quotaId === "string" && /^[\w.-]{1,120}$/.test(v.quotaId)) return v.quotaId;
  } catch { /* not JSON */ }
  return undefined;
}
/** Response header naming the Gemini model that actually answered (differs from the configured one after a fallback). */
export const ANSWERED_MODEL_HEADER = "x-rx-answered-model";
const tagged = (res: Response, id: string) => {
  const headers = new Headers(res.headers); headers.set(ANSWERED_MODEL_HEADER, id);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
/** Gemini-shaped error the SDK turns into an APICallError (statusCode 504, type DEADLINE_EXCEEDED). */
export const deadlineResponse = (message: string) =>
  new Response(JSON.stringify({ error: { code: 504, status: "DEADLINE_EXCEEDED", message } }), { status: 504, headers: { "content-type": "application/json" } });
const MODEL_IN_URL = /\/models\/([^/:?]+):(generateContent|streamGenerateContent)/;
const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");

export function geminiRetryFetch(base: typeof fetch = (...a) => fetch(...a), o: GeminiRetryOptions = {}): typeof fetch {
  const {
    retries503 = 1, backoffMs = [1500, 3000], max429WaitMs = 10_000, fallbackModels = [], sleep = defaultSleep, now = Date.now,
    attemptTimeoutMs = GEMINI_ATTEMPT_TIMEOUT_MS, totalBudgetMs = GEMINI_TOTAL_BUDGET_MS, log = defaultLog,
  } = o;
  const exhaustedUntil = new Map<string, number>(); // model -> epoch ms (per process)
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const deadline = now() + totalBudgetMs;
    const left = () => deadline - now();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : undefined;
    const m = url?.match(MODEL_IN_URL);
    let timedOut = false;
    /** One HTTP attempt with a hard timeout (and the caller's signal). Returns undefined on timeout. */
    const once = async (u: RequestInfo | URL, model: string): Promise<Response | undefined> => {
      const ms = Math.max(1, Math.min(attemptTimeoutMs, left()));
      const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
      const t0 = now();
      try {
        const res = await base(u, { ...init, signal });
        const note = res.status === 429 ? await quotaId(res).then(async q => [q, await retryDelayMs(res).then(d => d !== undefined ? `retryIn=${Math.round(d / 1000)}s` : undefined)].filter(Boolean).join(" ")) : undefined;
        log({ model, status: res.status, ms: now() - t0, ...(note ? { note } : {}) });
        return res;
      } catch (e) {
        if (init?.signal?.aborted) throw e; // caller cancelled: propagate
        const timeout = isAbort(e);
        log({ model, status: timeout ? "timeout" : "network", ms: now() - t0 });
        if (timeout) { timedOut = true; return undefined; }
        throw e;
      }
    };
    /** Retries for one model. res undefined = timed out or budget gone. */
    const attempt = async (u: RequestInfo | URL, model: string): Promise<{ res?: Response; exhaustedFor?: number }> => {
      let n503 = 0, waited429 = false;
      for (;;) {
        if (left() <= 0) return {};
        const res = await once(u, model);
        if (!res) return {};
        if (res.status === 503 && n503 < retries503) {
          const w = backoffMs[Math.min(n503++, backoffMs.length - 1)];
          if (w + 1000 >= left()) return { res }; // not enough budget for a backoff + attempt
          await sleep(w); continue;
        }
        if (res.status === 429) {
          const d = await retryDelayMs(res);
          if (d !== undefined && d <= max429WaitMs && !waited429 && d + 2000 < left()) { waited429 = true; await sleep(d + 500); continue; }
          return { res, exhaustedFor: d ?? 60_000 };
        }
        return { res };
      }
    };
    if (!url || !m) return (await attempt(input, "unknown")).res ?? deadlineResponse(`Gemini API did not answer within ${Math.round(totalBudgetMs / 1000)}s`);
    const all = [m[1], ...fallbackModels.filter(f => f !== m[1])];
    const live = all.filter(id => (exhaustedUntil.get(id) ?? 0) <= now());
    for (const id of all) if (!live.includes(id)) log({ model: id, status: "skipped", ms: 0, note: `quota exhausted for ${Math.round(((exhaustedUntil.get(id) ?? 0) - now()) / 1000)}s more` });
    let last: Response | undefined;
    for (const id of live.length ? live : [m[1]]) {
      if (left() <= 0) break;
      const { res, exhaustedFor } = await attempt(url.replace(MODEL_IN_URL, `/models/${id}:$2`), id);
      if (exhaustedFor !== undefined) exhaustedUntil.set(id, now() + exhaustedFor);
      if (!res) continue; // timed out: try the next model with what is left of the budget
      if (res.status !== 429 && res.status !== 503) return res.ok ? tagged(res, id) : res;
      last = res;
    }
    if (last && !timedOut) return last;
    return deadlineResponse(`Gemini API did not answer within ${Math.round(totalBudgetMs / 1000)}s` + (last ? ` (last status ${last.status})` : ""));
  }) as typeof fetch;
}
