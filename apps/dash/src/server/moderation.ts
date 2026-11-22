// The Moderation tab's endpoints (apps/dash/functions/api/moderation/*), on the same guard as the analytics ones:
//   GET  /api/moderation/queue   ?reports=open|reviewed|all&names=open|done|all[&fresh=1]  -> moderation_queue
//   GET  /api/moderation/search  ?q=<name, Name#1234 or an id>                           -> moderation_search
//   POST /api/moderation/action  { action: 'review' | 'clear' | 'reset', ... }             -> moderation_review_report /
//                                                                                            moderation_clear_flag /
//                                                                                            moderation_reset_name
// Order: method -> (POST: same-origin + JSON + the action header) -> secrets + Access JWT + allow-list -> parameters ->
// cache (reads) -> the service-role RPC. The actor is ALWAYS the verified Access email, never anything in the body.
// An action drops every cached moderation read, and the page re-reads with fresh=1 after one, so it never sees a stale
// queue (another isolate's cache can still be up to 60 s old for a plain read; fresh=1 skips it).
import { authorize, cacheDrop, cacheGet, cachePut, json, type DashEnv } from './handler';

export type ModerationRoute = 'queue' | 'search' | 'action';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 500;
const BODY_MAX = 4096;
/** The SQL's own refusals, passed to the page as 409 { error } (anything else is a 502 without its body). */
const SQL_ERRORS = new Set(['not_found', 'not_open', 'bad_kind', 'bad_target', 'bad_actor', 'no_free_tag', 'name_blocked']);
/** The header the page sends with every action. A form or a plain cross-site fetch cannot send it without a CORS
 *  preflight, which this route never answers. */
export const ACTION_HEADER = 'x-dash-action';

export function queueArgs(url: URL): { p_reports: string; p_names: string; p_limit: number } {
  const r = url.searchParams.get('reports') ?? '';
  const n = url.searchParams.get('names') ?? '';
  return {
    p_reports: ['open', 'reviewed', 'all'].includes(r) ? r : 'open',
    p_names: ['open', 'done', 'all'].includes(n) ? n : 'open',
    p_limit: 100,
  };
}

export function searchArgs(url: URL): { p_q: string } | null {
  const q = (url.searchParams.get('q') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return q.length >= 1 && q.length <= 64 ? { p_q: q } : null;
}

const note = (v: unknown): string | null | undefined => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t.length <= NOTE_MAX ? t || null : undefined;
};

/** The RPC for an action body, from an allow-list of shapes only. The actor is added by the caller. */
export function actionCall(body: unknown): { fn: string; args: Record<string, string | null> } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad body' };
  const b = body as Record<string, unknown>;
  const n = note(b.note);
  if (n === undefined) return { error: 'bad note' };
  switch (b.action) {
    case 'review':
      if (typeof b.reportId !== 'string' || !UUID.test(b.reportId)) return { error: 'bad reportId' };
      return { fn: 'moderation_review_report', args: { p_report: b.reportId, p_note: n } };
    case 'clear':
      if (typeof b.flagId !== 'string' || !UUID.test(b.flagId)) return { error: 'bad flagId' };
      return { fn: 'moderation_clear_flag', args: { p_flag: b.flagId, p_note: n } };
    case 'reset':
      if (b.kind !== 'account' && b.kind !== 'team') return { error: 'bad kind' };
      if (typeof b.targetId !== 'string' || !UUID.test(b.targetId)) return { error: 'bad targetId' };
      return { fn: 'moderation_reset_name', args: { p_kind: b.kind, p_target: b.targetId, p_note: n } };
    default:
      return { error: 'bad action' };
  }
}

/** A POST must come from this page: same origin (Origin and, when sent, Sec-Fetch-Site), JSON, and the action header. */
export function sameOriginPost(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return 'cross-origin';
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return 'cross-origin';
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return 'json only';
  if (request.headers.get(ACTION_HEADER) !== '1') return 'missing action header';
  return null;
}

async function sqlError(res: Response): Promise<string | null> {
  try {
    const b = (await res.json()) as { message?: unknown };
    return typeof b.message === 'string' && SQL_ERRORS.has(b.message) ? b.message : null;
  } catch {
    return null;
  }
}

export async function handleModeration(
  request: Request,
  env: DashEnv,
  route: ModerationRoute,
  deps: { fetch?: typeof fetch; nowMs?: number } = {},
): Promise<Response> {
  const nowMs = deps.nowMs ?? Date.now();
  const method = route === 'action' ? 'POST' : 'GET';
  if (request.method !== method) return json(405, { error: 'method not allowed' }, { allow: method });
  if (route === 'action') {
    const bad = sameOriginPost(request);
    if (bad) return json(403, { error: bad });
  }
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return auth.res;

  if (route === 'action') {
    const raw = await request.text();
    if (raw.length > BODY_MAX) return json(413, { error: 'too large' });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad json' }); }
    const call = actionCall(body);
    if ('error' in call) return json(400, { error: call.error });
    let res: Response;
    try {
      res = await auth.rpc(call.fn, { p_actor: auth.email, ...call.args });
    } catch {
      return json(502, { error: 'database unreachable' });
    }
    cacheDrop('mod:'); // even a refused action may mean the queue moved under the page
    if (!res.ok) {
      const code = await sqlError(res);
      return code ? json(409, { error: code }) : json(502, { error: 'database error', status: res.status });
    }
    return json(200, await res.text());
  }

  const url = new URL(request.url);
  let fn: string;
  let args: Record<string, unknown>;
  if (route === 'queue') {
    fn = 'moderation_queue';
    args = queueArgs(url);
  } else {
    const a = searchArgs(url);
    if (!a) return json(200, { q: '', accounts: [], teams: [] });
    fn = 'moderation_search';
    args = a;
  }
  const key = `mod:${route}:${JSON.stringify(args)}`;
  const fresh = url.searchParams.get('fresh') === '1';
  const hit = fresh ? null : cacheGet(key, nowMs);
  if (hit != null) return json(200, hit, { 'x-dash-cache': 'hit' });
  let res: Response;
  try {
    res = await auth.rpc(fn, args);
  } catch {
    return json(502, { error: 'database unreachable' });
  }
  if (!res.ok) return json(502, { error: 'database error', status: res.status });
  const body = await res.text();
  cachePut(key, body, nowMs);
  return json(200, body, { 'x-dash-cache': 'miss' });
}
