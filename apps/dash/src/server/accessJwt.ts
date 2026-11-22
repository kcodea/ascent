// Cloudflare Access JWT verification, server side. Cloudflare Access already sits in front of the whole Pages project,
// but the data endpoint must never depend on that alone: if the Access application is ever deleted, widened or left
// off a preview domain, a request without a valid, signed, in-date token for OUR application and an allowed email
// gets nothing. Every failure path returns a refusal; nothing here ever falls through to "allowed".
//
// The token arrives in the `Cf-Access-Jwt-Assertion` header (set by Access on every request it lets through). It is
// an RS256 JWT signed by the team's keys, published at https://<team>.cloudflareaccess.com/cdn-cgi/access/certs.

export interface AccessConfig {
  /** `<team>.cloudflareaccess.com` (with or without https://). */
  teamDomain: string;
  /** The Access application's AUD tag. Several, comma separated, when preview and production are separate apps. */
  audiences: string[];
  /** Lower-cased emails allowed to read the data (a second gate behind the Access policy). */
  allowedEmails: string[];
}

export type AccessResult = { ok: true; email: string } | { ok: false; status: 401 | 403; reason: string };

interface Jwk { kid?: string; kty: string; n?: string; e?: string; alg?: string }
interface JwtHeader { alg?: string; kid?: string; typ?: string }
interface JwtPayload { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; iat?: number; email?: string; sub?: string }

const SKEW_S = 30;
const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();

/** For tests: forget the cached certs. */
export function resetJwksCache(): void {
  jwksCache.clear();
}

/** `https://<team>.cloudflareaccess.com`, or null when the value is not a plain Access team host. */
export function issuerOf(teamDomain: string): string | null {
  const host = teamDomain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host)) return null;
  return `https://${host}`;
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson<T>(s: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as T;
  } catch {
    return null;
  }
}

async function loadKeys(issuer: string, fetcher: typeof fetch, now: number, force: boolean): Promise<Jwk[]> {
  const hit = jwksCache.get(issuer);
  if (!force && hit && now - hit.at < JWKS_TTL_MS) return hit.keys;
  const res = await fetcher(`${issuer}/cdn-cgi/access/certs`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys.filter((k) => k && k.kty === 'RSA' && k.n && k.e) : [];
  jwksCache.set(issuer, { at: now, keys });
  return keys;
}

const deny = (status: 401 | 403, reason: string): AccessResult => ({ ok: false, status, reason });

export async function verifyAccessJwt(
  token: string | null | undefined,
  cfg: AccessConfig,
  opts: { fetch?: typeof fetch; nowMs?: number } = {},
): Promise<AccessResult> {
  const fetcher = opts.fetch ?? fetch;
  const nowMs = opts.nowMs ?? Date.now();
  const now = Math.floor(nowMs / 1000);
  const issuer = issuerOf(cfg.teamDomain);
  if (!issuer || cfg.audiences.length === 0 || cfg.allowedEmails.length === 0) return deny(401, 'not configured');
  if (!token) return deny(401, 'no access token');

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return deny(401, 'malformed token');
  const header = b64urlJson<JwtHeader>(parts[0]!);
  const payload = b64urlJson<JwtPayload>(parts[1]!);
  if (!header || !payload) return deny(401, 'malformed token');
  if (header.alg !== 'RS256' || !header.kid) return deny(401, 'bad algorithm');

  let keys: Jwk[];
  try {
    keys = await loadKeys(issuer, fetcher, nowMs, false);
    if (!keys.some((k) => k.kid === header.kid)) keys = await loadKeys(issuer, fetcher, nowMs, true); // key rotation
  } catch {
    return deny(401, 'certs unavailable');
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return deny(401, 'unknown key');

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlBytes(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) return deny(401, 'bad signature');

  if (payload.iss !== issuer) return deny(401, 'wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : typeof payload.aud === 'string' ? [payload.aud] : [];
  if (!aud.some((a) => cfg.audiences.includes(a))) return deny(401, 'wrong audience');
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_S < now) return deny(401, 'expired');
  if (typeof payload.nbf === 'number' && payload.nbf - SKEW_S > now) return deny(401, 'not yet valid');
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !cfg.allowedEmails.includes(email)) return deny(403, 'email not allowed');
  return { ok: true, email };
}
