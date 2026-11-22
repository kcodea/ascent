import { beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache, verifyAccessJwt, type AccessConfig } from './accessJwt';
import { handleApi, resetResponseCache, rpcArgs, type DashEnv } from './handler';

/**
 * The dashboard's data endpoint fails closed (owner 2026-11-22): it answers ONLY a request carrying a Cloudflare
 * Access JWT that is signed by the team's key, for our application's AUD, in date, and for an allowed email. Real
 * RS256 keys are generated here and the team's certs endpoint is a fake fetch, so the signature path is exercised.
 */
const TEAM = 'ascent-team.cloudflareaccess.com';
const ISS = `https://${TEAM}`;
const AUD = 'aud-tag-123';
const NOW = 1_800_000_000_000;

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? bytes : bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function keypair(kid: string) {
  const kp = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  return { kid, privateKey: kp.privateKey, jwk: { kid, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e } };
}

async function sign(key: CryptoKey, kid: string, claims: Record<string, unknown>, alg = 'RS256'): Promise<string> {
  const head = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

let good: Awaited<ReturnType<typeof keypair>>;
let other: Awaited<ReturnType<typeof keypair>>;
const claims = (over: Record<string, unknown> = {}) => ({
  aud: [AUD], iss: ISS, email: 'Kevin@Example.com', exp: NOW / 1000 + 600, iat: NOW / 1000 - 10, nbf: NOW / 1000 - 10, ...over,
});

const certsFetch = (keys: unknown[]) => {
  const calls: string[] = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u === `${ISS}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys }), { status: 200 });
    if (u.startsWith('https://db.example.supabase.co/rest/v1/rpc/')) {
      return new Response(JSON.stringify({ ok: true, rpc: u.split('/').pop(), body: JSON.parse(String(init?.body ?? '{}')), headers: init?.headers }), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
};

const CFG: AccessConfig = { teamDomain: TEAM, audiences: [AUD], allowedEmails: ['kevin@example.com', 'mike@example.com'] };
const ENV: DashEnv = {
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only',
  ACCESS_AUD: AUD,
  ACCESS_TEAM_DOMAIN: TEAM,
  ALLOWED_EMAILS: 'kevin@example.com, mike@example.com',
};
const req = (path: string, token?: string, method = 'GET') =>
  new Request(`https://dash.example/${path}`, { method, headers: token ? { 'cf-access-jwt-assertion': token } : {} });

beforeEach(async () => {
  resetJwksCache();
  resetResponseCache();
  good ??= await keypair('k1');
  other ??= await keypair('k2');
});

describe('verifyAccessJwt', () => {
  it('accepts a valid token and lower-cases the email', async () => {
    const { f } = certsFetch([good.jwk]);
    const r = await verifyAccessJwt(await sign(good.privateKey, 'k1', claims()), CFG, { fetch: f, nowMs: NOW });
    expect(r).toEqual({ ok: true, email: 'kevin@example.com' });
  });

  it.each([
    ['no token', async () => null],
    ['garbage', async () => 'a.b'],
    ['wrong audience', async () => sign(good.privateKey, 'k1', claims({ aud: ['someone-else'] }))],
    ['wrong issuer', async () => sign(good.privateKey, 'k1', claims({ iss: 'https://evil.cloudflareaccess.com' }))],
    ['expired', async () => sign(good.privateKey, 'k1', claims({ exp: NOW / 1000 - 120 }))],
    ['not yet valid', async () => sign(good.privateKey, 'k1', claims({ nbf: NOW / 1000 + 600 }))],
    ['signed by an unknown key', async () => sign(other.privateKey, 'k2', claims())],
    ['signed by another key under our kid', async () => sign(other.privateKey, 'k1', claims())],
    ['alg none', async () => {
      const t = await sign(good.privateKey, 'k1', claims());
      const [, body] = t.split('.');
      return `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${body}.`;
    }],
  ])('refuses: %s', async (_name, make) => {
    const { f } = certsFetch([good.jwk]);
    const r = await verifyAccessJwt(await make(), CFG, { fetch: f, nowMs: NOW });
    expect(r.ok).toBe(false);
  });

  it('refuses an email that is not allowed (403)', async () => {
    const { f } = certsFetch([good.jwk]);
    const r = await verifyAccessJwt(await sign(good.privateKey, 'k1', claims({ email: 'stranger@example.com' })), CFG, { fetch: f, nowMs: NOW });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses everything when the config is incomplete', async () => {
    const { f } = certsFetch([good.jwk]);
    const t = await sign(good.privateKey, 'k1', claims());
    for (const cfg of [{ ...CFG, teamDomain: 'example.com' }, { ...CFG, audiences: [] }, { ...CFG, allowedEmails: [] }]) {
      expect((await verifyAccessJwt(t, cfg, { fetch: f, nowMs: NOW })).ok).toBe(false);
    }
  });

  it('refuses when the certs cannot be fetched', async () => {
    const f = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    expect((await verifyAccessJwt(await sign(good.privateKey, 'k1', claims()), CFG, { fetch: f, nowMs: NOW })).ok).toBe(false);
  });

  it('refetches the certs once for a rotated key id', async () => {
    let keys: unknown[] = [other.jwk];
    const f = (async () => new Response(JSON.stringify({ keys }), { status: 200 })) as unknown as typeof fetch;
    await verifyAccessJwt(await sign(other.privateKey, 'k2', claims()), CFG, { fetch: f, nowMs: NOW }); // caches [k2]
    keys = [good.jwk];
    expect((await verifyAccessJwt(await sign(good.privateKey, 'k1', claims()), CFG, { fetch: f, nowMs: NOW })).ok).toBe(true);
  });
});

describe('handleApi', () => {
  it('500s with the missing names when any secret is absent, before touching anything', async () => {
    const { f, calls } = certsFetch([good.jwk]);
    const res = await handleApi(req('api/overview', await sign(good.privateKey, 'k1', claims())), { ...ENV, ALLOWED_EMAILS: '' }, 'overview', { fetch: f, nowMs: NOW });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ missing: ['ALLOWED_EMAILS'] });
    expect(calls).toEqual([]);
  });

  it('401s without a token and never calls the database', async () => {
    const { f, calls } = certsFetch([good.jwk]);
    const res = await handleApi(req('api/overview'), ENV, 'overview', { fetch: f, nowMs: NOW });
    expect(res.status).toBe(401);
    expect(calls.some((c) => c.includes('/rest/v1/'))).toBe(false);
  });

  it('405s a non-GET', async () => {
    const { f } = certsFetch([good.jwk]);
    expect((await handleApi(req('api/overview', undefined, 'POST'), ENV, 'overview', { fetch: f, nowMs: NOW })).status).toBe(405);
  });

  it('calls the RPC with the service key server side, then serves the cache for 60 s', async () => {
    const { f, calls } = certsFetch([good.jwk]);
    const t = await sign(good.privateKey, 'k1', claims());
    const r1 = await handleApi(req('api/breakdown?from=2026-11-01&to=2026-11-22&patch=0.1.0%2Babc123&tz=Europe/London', t), ENV, 'breakdown', { fetch: f, nowMs: NOW });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('x-dash-cache')).toBe('miss');
    expect(r1.headers.get('cache-control')).toBe('private, no-store');
    const body = (await r1.json()) as { rpc: string; body: unknown; headers: Record<string, string> };
    expect(body.rpc).toBe('analytics_breakdown');
    expect(body.body).toEqual({ p_from: '2026-11-01', p_to: '2026-11-22', p_patch: '0.1.0+abc123', p_tz: 'Europe/London' });
    expect(body.headers.apikey).toBe('sb_secret_test_only');
    expect(body.headers.authorization).toBeUndefined(); // a new-style secret key is apikey-only
    const r2 = await handleApi(req('api/breakdown?from=2026-11-01&to=2026-11-22&patch=0.1.0%2Babc123&tz=Europe/London', t), ENV, 'breakdown', { fetch: f, nowMs: NOW + 30_000 });
    expect(r2.headers.get('x-dash-cache')).toBe('hit');
    const r3 = await handleApi(req('api/breakdown?from=2026-11-01&to=2026-11-22&patch=0.1.0%2Babc123&tz=Europe/London', t), ENV, 'breakdown', { fetch: f, nowMs: NOW + 61_000 });
    expect(r3.headers.get('x-dash-cache')).toBe('miss');
    expect(calls.filter((c) => c.includes('/rest/v1/')).length).toBe(2);
  });

  it('does not serve a cached answer to a request that fails the Access check', async () => {
    const { f } = certsFetch([good.jwk]);
    await handleApi(req('api/overview', await sign(good.privateKey, 'k1', claims())), ENV, 'overview', { fetch: f, nowMs: NOW });
    const res = await handleApi(req('api/overview'), ENV, 'overview', { fetch: f, nowMs: NOW + 1000 });
    expect(res.status).toBe(401);
  });

  it('turns a database error into a 502 without its body', async () => {
    const { f: certs } = certsFetch([good.jwk]);
    const f = (async (u: RequestInfo | URL, i?: RequestInit) =>
      String(u).includes('/rest/v1/') ? new Response('secret detail', { status: 500 }) : certs(u, i)) as typeof fetch;
    const res = await handleApi(req('api/overview', await sign(good.privateKey, 'k1', claims())), ENV, 'overview', { fetch: f, nowMs: NOW });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret detail');
  });
});

describe('rpcArgs', () => {
  it('keeps only well-formed parameters', () => {
    const u = new URL('https://x/api/breakdown?from=2026-1-1&to=2026-11-22&patch=%3Cscript%3E&tz=%27%3B drop');
    expect(rpcArgs('breakdown', u)).toEqual({ p_from: null, p_to: '2026-11-22', p_patch: null, p_tz: 'UTC' });
  });
  it('clamps the overview window to 30..92 days', () => {
    expect(rpcArgs('overview', new URL('https://x/?days=5'))).toMatchObject({ p_days: 30 });
    expect(rpcArgs('overview', new URL('https://x/?days=400'))).toMatchObject({ p_days: 92 });
    expect(rpcArgs('overview', new URL('https://x/?days=abc'))).toMatchObject({ p_days: 30 });
  });
});
