// The dashboard's data endpoint (GET /api/overview, GET /api/breakdown), shared by the Pages Functions in
// apps/dash/functions/api/. Order: configuration present -> Access JWT valid -> parameters -> cache -> Supabase RPC.
// Anything missing or wrong refuses; the service role key never leaves this file's fetch.
import { verifyAccessJwt, type AccessConfig } from './accessJwt';

export interface DashEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ALLOWED_EMAILS?: string;
}

export type Endpoint = 'overview' | 'breakdown';

export const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ACCESS_AUD', 'ACCESS_TEAM_DOMAIN', 'ALLOWED_EMAILS'] as const;
export const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

const cache = new Map<string, { at: number; body: string }>();
/** For tests. */
export function resetResponseCache(): void {
  cache.clear();
}

const list = (s: string | undefined): string[] =>
  (s ?? '').split(',').map((x) => x.trim()).filter((x) => x.length > 0);

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;
const PATCH = /^[0-9A-Za-z.+_-]{1,80}$/;

/** The RPC arguments for a request, from an allow-list of shapes only (anything else is dropped). */
export function rpcArgs(endpoint: Endpoint, url: URL): Record<string, string | number | null> {
  const q = url.searchParams;
  const tzRaw = q.get('tz') ?? '';
  const p_tz = TZ.test(tzRaw) ? tzRaw : 'UTC';
  // No `from` = all time, no `to` = today (the SQL's own defaults); any span (it buckets long ranges itself).
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  const range = { p_from: DATE.test(from) ? from : null, p_to: DATE.test(to) ? to : null };
  if (endpoint === 'overview') return { ...range, p_tz };
  const patch = q.get('patch') ?? '';
  return { ...range, p_patch: PATCH.test(patch) ? patch : null, p_tz };
}

/** What every route needs once the request has passed the guard: the verified email and the database call. */
export interface Authorized {
  email: string;
  /** POST /rest/v1/rpc/<fn> with the service key, server side. Throws only when the database is unreachable. */
  rpc: (fn: string, args: unknown) => Promise<Response>;
}

/**
 * THE GUARD every route runs first, in order: all secrets present (else 500, before anything else), then a valid
 * Access JWT for an allowed email (else 401 / 403). It fails closed: any gap answers a refusal, never "allowed".
 */
export async function authorize(
  request: Request,
  env: DashEnv,
  deps: { fetch?: typeof fetch; nowMs?: number } = {},
): Promise<{ ok: false; res: Response } | ({ ok: true } & Authorized)> {
  const fetcher = deps.fetch ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  const missing = REQUIRED_ENV.filter((k) => !env[k] || !String(env[k]).trim());
  if (missing.length > 0) return { ok: false, res: json(500, { error: 'not configured', missing }) };
  const base = String(env.SUPABASE_URL).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(base)) return { ok: false, res: json(500, { error: 'not configured', missing: ['SUPABASE_URL (https origin)'] }) };

  const access: AccessConfig = {
    teamDomain: String(env.ACCESS_TEAM_DOMAIN),
    audiences: list(env.ACCESS_AUD),
    allowedEmails: list(env.ALLOWED_EMAILS).map((e) => e.toLowerCase()),
  };
  const who = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), access, { fetch: fetcher, nowMs });
  if (!who.ok) return { ok: false, res: json(who.status, { error: who.reason }) };

  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY).trim();
  const headers: Record<string, string> = { apikey: secret, 'content-type': 'application/json', accept: 'application/json' };
  // A legacy service_role key is a JWT and goes in Authorization too; a new `sb_secret_` key is apikey-only.
  if (secret.startsWith('eyJ')) headers.authorization = `Bearer ${secret}`;
  return {
    ok: true,
    email: who.email,
    rpc: (fn, args) => fetcher(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) }),
  };
}

/** The 60 s answer cache (per isolate). Reads go through it; a moderation action drops every moderation entry. */
export function cacheGet(key: string, nowMs: number): string | null {
  const hit = cache.get(key);
  return hit && nowMs - hit.at < CACHE_TTL_MS ? hit.body : null;
}
export function cachePut(key: string, body: string, nowMs: number): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: nowMs, body });
}
export function cacheDrop(prefix: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

export async function handleApi(
  request: Request,
  env: DashEnv,
  endpoint: Endpoint,
  deps: { fetch?: typeof fetch; nowMs?: number } = {},
): Promise<Response> {
  const nowMs = deps.nowMs ?? Date.now();
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, { allow: 'GET' });
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return auth.res;

  const args = rpcArgs(endpoint, new URL(request.url));
  const key = `${endpoint}:${JSON.stringify(args)}`;
  const hit = cacheGet(key, nowMs);
  if (hit != null) return json(200, hit, { 'x-dash-cache': 'hit' });

  let res: Response;
  try {
    res = await auth.rpc(`analytics_${endpoint}`, args);
  } catch {
    return json(502, { error: 'database unreachable' });
  }
  if (!res.ok) return json(502, { error: 'database error', status: res.status });
  const body = await res.text();
  cachePut(key, body, nowMs);
  return json(200, body, { 'x-dash-cache': 'miss' });
}
