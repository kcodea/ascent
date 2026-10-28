/**
 * VERSUS ON CLOUDFLARE — who is calling. Supabase stays the identity provider: a player proves who they are with the
 * same access token the game already holds (`supabase.auth.getSession()`), and the Worker verifies it locally with
 * WebCrypto (no round trip to Supabase per connection, unlike the Edge Function's `auth.getUser()`):
 *
 *   - ES256 / RS256 (Supabase's asymmetric signing keys): the project's JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`),
 *     cached for 10 minutes per isolate, re-fetched once on an unknown `kid` (key rotation).
 *   - HS256 (the legacy shared secret): only when the `SUPABASE_JWT_SECRET` secret is set.
 *
 * Checks: signature, `exp` (30 s skew), `aud` = authenticated, a `sub`. Anonymous sign-ins are accepted (Versus is open
 * to them today); `anonymous` is returned so records can keep excluding them.
 *
 * DEV: with `DEV_AUTH = "1"` (local `wrangler dev` and the tests only) a token `dev.<userId>.<name>` is accepted as-is.
 */

export interface AuthEnv {
  SUPABASE_URL?: string;
  SUPABASE_JWT_SECRET?: string;
  DEV_AUTH?: string;
}

export interface Caller {
  userId: string;
  anonymous: boolean;
  dev: boolean;
}

type Jwk = { kid?: string; [k: string]: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKEW_S = 30;
const JWKS_TTL_MS = 10 * 60_000;

let jwksCache: { url: string; at: number; keys: Jwk[] } | null = null;

const b64urlBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlJson = (s: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as Record<string, unknown>;

async function jwks(url: string, force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && jwksCache.url === url && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { url, at: Date.now(), keys: body.keys ?? [] };
  return jwksCache.keys;
}

async function verifySignature(alg: string, kid: string | undefined, signed: Uint8Array, sig: Uint8Array, env: AuthEnv): Promise<boolean> {
  if (alg === 'HS256') {
    if (!env.SUPABASE_JWT_SECRET) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPABASE_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, sig, signed);
  }
  if (alg !== 'ES256' && alg !== 'RS256') return false;
  if (!env.SUPABASE_URL) return false;
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  let keys = await jwks(url, false);
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    keys = await jwks(url, true);
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) return false;
  if (alg === 'ES256') {
    const key = await crypto.subtle.importKey('jwk', jwk as never, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, signed);
  }
  const key = await crypto.subtle.importKey('jwk', jwk as never, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
}

/** The caller behind a bearer token, or null when it does not verify. */
export async function verifyCaller(token: string | null | undefined, env: AuthEnv, nowMs = Date.now()): Promise<Caller | null> {
  if (!token) return null;
  if (env.DEV_AUTH === '1' && token.startsWith('dev.')) {
    const userId = token.slice(4).split('.')[0] ?? '';
    return UUID.test(userId) ? { userId, anonymous: false, dev: true } : null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    const ok = await verifySignature(String(header.alg), header.kid as string | undefined, new TextEncoder().encode(`${parts[0]}.${parts[1]}`), b64urlBytes(parts[2]), env);
    if (!ok) return null;
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp) || exp + SKEW_S < nowMs / 1000) return null;
    const aud = payload.aud;
    if (!(aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated')))) return null;
    const sub = String(payload.sub ?? '');
    if (!UUID.test(sub)) return null;
    return { userId: sub, anonymous: payload.is_anonymous === true, dev: false };
  } catch {
    return null;
  }
}

/** The bearer token from `Authorization: Bearer …` or the WebSocket subprotocol list (`bearer.<jwt>`). */
export function bearerOf(req: Request, subprotocolPrefix: string): string | null {
  const auth = req.headers.get('Authorization');
  const m = auth ? /^Bearer\s+(\S+)$/.exec(auth) : null;
  if (m) return m[1];
  const protos = (req.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((s) => s.trim());
  const b = protos.find((p) => p.startsWith(subprotocolPrefix));
  return b ? b.slice(subprotocolPrefix.length) : null;
}
