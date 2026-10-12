/**
 * GUIDES: the `guide-write` Edge Function's logic, as a pure function (spec section 3).
 *
 * The caller's id comes from the verified token, never the body. This file owns the TEXT rules (shape, limits, the
 * word filter, reserved by lines); the SQL functions it calls as the service role own the ROW rules (ownership,
 * official = team only, the 20-guide cap, the rate limit, edit conflicts) and are the only writers of the tables.
 *
 * Step 1 ops: `save`, `delete`, `importBuiltIns`. Later steps add `setPublished`, `bookmark`, `report`, `setHidden`.
 *
 * Not exported from index.ts (the client never runs it). Dependency-free. `npm run guides:shared` generates this
 * file VERBATIM into supabase/functions/_shared/guidesServer.ts; `sharedArtifact.test.ts` fails CI on drift.
 */
import { GUIDE_LIMITS, UUID_RE, parseGuideRecord } from './types';
import { draftToSqlDoc, validateGuideDraft } from './validate';
import { guideTextProblem } from './wordFilter';

export type RpcCall = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;

export interface HandlerResponse { status: number; body: Record<string, unknown> }

/** `raise exception '<code>'` inside the SQL functions, mapped to an HTTP status. */
export const GUIDE_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  unauthenticated: 401,
  not_allowed: 403,
  not_found: 404,
  conflict: 409,
  too_many_guides: 422,
  rate_limited: 429,
});

type Log = (msg: string, detail?: unknown) => void;

/** True when a request body is over the ceiling, measured in UTF-8 BYTES (not UTF-16 units: a body of 3-byte characters is three times its `length`). */
export function guideBodyTooLarge(raw: string): boolean {
  return new TextEncoder().encode(raw).length > GUIDE_LIMITS.bodyBytes;
}

/** Run one SQL function; a known refusal becomes its status, anything else a 500 the client may retry. */
async function call(rpc: RpcCall, fn: string, args: Record<string, unknown>, log: Log): Promise<{ ok: true; data: unknown } | { ok: false; res: HandlerResponse }> {
  let res: Awaited<ReturnType<RpcCall>>;
  try {
    res = await rpc(fn, args);
  } catch (e) {
    log(`${fn} threw`, e);
    return { ok: false, res: { status: 500, body: { error: 'guide_failed' } } };
  }
  if (res.error) {
    const message = String(res.error.message ?? '');
    const code = Object.keys(GUIDE_ERROR_STATUS).find((k) => message.includes(k));
    if (code) return { ok: false, res: { status: GUIDE_ERROR_STATUS[code]!, body: { error: code } } };
    log(`${fn} failed`, res.error);
    return { ok: false, res: { status: 500, body: { error: 'guide_failed' } } };
  }
  return { ok: true, data: res.data };
}

/**
 * Handle one write for a verified caller. `userId` null = the token did not verify (401); `anonymous` = a guest
 * session (403). Never throws.
 */
export async function handleGuideWrite(userId: string | null, anonymous: boolean, body: unknown, rpc: RpcCall, log: Log = () => {}): Promise<HandlerResponse> {
  if (!userId) return { status: 401, body: { error: 'unauthenticated' } };
  if (anonymous) return { status: 403, body: { error: 'sign_in_required' } };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'bad_body' } };
  try {
    return await dispatch(userId, body as Record<string, unknown>, rpc, log);
  } catch (e) {
    log('guide-write threw', e);
    return { status: 500, body: { error: 'guide_failed' } };
  }
}

/** The ops, for a caller already known to be a signed-in account and a body already known to be an object. */
async function dispatch(userId: string, o: Record<string, unknown>, rpc: RpcCall, log: Log): Promise<HandlerResponse> {
  if (o.op === 'save') {
    const v = validateGuideDraft(o.guide);
    if (!v.ok) return { status: 422, body: { error: v.error, field: v.field } };
    const problem = guideTextProblem(v.draft);
    if (problem) return { status: 422, body: { error: problem.error, field: problem.field } };
    const out = await call(rpc, 'guide_save', { p_user: userId, p_doc: draftToSqlDoc(v.draft) }, log);
    if (!out.ok) return out.res;
    const guide = parseGuideRecord(out.data);
    if (!guide) {
      log('guide_save malformed', out.data);
      return { status: 500, body: { error: 'guide_malformed' } };
    }
    return { status: 200, body: { guide } };
  }

  if (o.op === 'delete') {
    if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return { status: 400, body: { error: 'bad_id' } };
    const out = await call(rpc, 'guide_delete', { p_user: userId, p_id: o.id }, log);
    if (!out.ok) return out.res;
    return { status: 200, body: { deleted: o.id } };
  }

  if (o.op === 'importBuiltIns') {
    if (!Array.isArray(o.guides) || o.guides.length < 1 || o.guides.length > GUIDE_LIMITS.importBatch) return { status: 400, body: { error: 'bad_guides' } };
    const docs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < o.guides.length; i++) {
      const raw = o.guides[i];
      const v = validateGuideDraft(raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>), official: true, id: undefined } : raw, { requireSlug: true });
      if (!v.ok) return { status: 422, body: { error: v.error, field: v.field, index: i } };
      const problem = guideTextProblem(v.draft);
      if (problem) return { status: 422, body: { error: problem.error, field: problem.field, index: i } };
      docs.push(draftToSqlDoc(v.draft));
    }
    const out = await call(rpc, 'guide_import_builtins', { p_user: userId, p_docs: docs }, log);
    if (!out.ok) return out.res;
    const d = (out.data ?? {}) as Record<string, unknown>;
    return { status: 200, body: { inserted: Number(d.inserted ?? 0), skipped: Number(d.skipped ?? 0) } };
  }

  return { status: 400, body: { error: 'bad_op' } };
}
