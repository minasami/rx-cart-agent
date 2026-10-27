import { z, ZodError } from "zod";
import { PayPalError } from "./paypal";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}, public headers: Record<string, string> = {}) { super(message); }
}
export const jsonError = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  Response.json({ error, ...extra }, { status, headers });

/** Parse the JSON body and validate it with zod; throws HttpError(400) on bad JSON or schema mismatch. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new HttpError(400, "Request body must be valid JSON"); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "Invalid request", { issues: r.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
}

/** Wrap a route handler: maps validation errors to 400, PayPal upstream errors to 502, anything else to 500. */
export function route(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try { return await handler(req); }
    catch (e) {
      if (e instanceof HttpError) return jsonError(e.status, e.message, e.extra, e.headers);
      if (e instanceof ZodError) return jsonError(400, "Invalid request", { issues: e.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
      if (e instanceof PayPalError) return jsonError(502, e.message, { paypal: { status: e.status, name: e.paypalName, issue: e.issue, debug_id: e.debugId } });
      console.error(e);
      return jsonError(500, "Internal error");
    }
  };
}
