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

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
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

export async function handleApi(
  request: Request,
  env: DashEnv,
  endpoint: Endpoint,
  deps: { fetch?: typeof fetch; nowMs?: number } = {},
): Promise<Response> {
  const fetcher = deps.fetch ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, { allow: 'GET' });

  const missing = REQUIRED_ENV.filter((k) => !env[k] || !String(env[k]).trim());
  if (missing.length > 0) return json(500, { error: 'not configured', missing });
  const base = String(env.SUPABASE_URL).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(base)) return json(500, { error: 'not configured', missing: ['SUPABASE_URL (https origin)'] });

  const access: AccessConfig = {
    teamDomain: String(env.ACCESS_TEAM_DOMAIN),
    audiences: list(env.ACCESS_AUD),
    allowedEmails: list(env.ALLOWED_EMAILS).map((e) => e.toLowerCase()),
  };
  const who = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), access, { fetch: fetcher, nowMs });
  if (!who.ok) return json(who.status, { error: who.reason });

  const args = rpcArgs(endpoint, new URL(request.url));
  const key = `${endpoint}:${JSON.stringify(args)}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_TTL_MS) return json(200, hit.body, { 'x-dash-cache': 'hit' });

  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY).trim();
  const headers: Record<string, string> = { apikey: secret, 'content-type': 'application/json', accept: 'application/json' };
  // A legacy service_role key is a JWT and goes in Authorization too; a new `sb_secret_` key is apikey-only.
  if (secret.startsWith('eyJ')) headers.authorization = `Bearer ${secret}`;
  let res: Response;
  try {
    res = await fetcher(`${base}/rest/v1/rpc/analytics_${endpoint}`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch {
    return json(502, { error: 'database unreachable' });
  }
  if (!res.ok) return json(502, { error: 'database error', status: res.status });
  const body = await res.text();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: nowMs, body });
  return json(200, body, { 'x-dash-cache': 'miss' });
}
