import { beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache } from './accessJwt';
import { resetResponseCache, type DashEnv } from './handler';
import { ACTION_HEADER, actionCall, handleModeration, queueArgs, sameOriginPost, searchArgs } from './moderation';

/**
 * THE MODERATION ROUTES fail closed like the analytics ones: every route needs a signed, in-date Access JWT for our AUD
 * and an allowed email; an action must also be a same-origin JSON POST carrying the action header; the actor sent to
 * the SQL is the verified email, never the body's; an action drops the cached reads. Real RS256 keys, fake fetch.
 */
const TEAM = 'ascent-team.cloudflareaccess.com';
const ISS = `https://${TEAM}`;
const AUD = 'aud-tag-123';
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://dash.example';
const ID = '11111111-2222-4333-8444-555555555555';

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? bytes : bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let key: { privateKey: CryptoKey; jwk: Record<string, unknown> };
async function token(over: Record<string, unknown> = {}): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ aud: [AUD], iss: ISS, email: 'Kevin@Example.com', exp: NOW / 1000 + 600, nbf: NOW / 1000 - 10, ...over }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

const ENV: DashEnv = {
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_only',
  ACCESS_AUD: AUD,
  ACCESS_TEAM_DOMAIN: TEAM,
  ALLOWED_EMAILS: 'kevin@example.com',
};

/** The certs endpoint plus a fake PostgREST that echoes the call (or answers `dbAnswer`). */
function fakeFetch(dbAnswer?: () => Response) {
  const rpcs: Array<{ fn: string; body: Record<string, unknown> }> = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === `${ISS}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
    if (u.startsWith('https://db.example.supabase.co/rest/v1/rpc/')) {
      const fn = u.split('/').pop()!;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      rpcs.push({ fn, body });
      return dbAnswer ? dbAnswer() : new Response(JSON.stringify({ fn, body, n: rpcs.length }), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { f, rpcs };
}

const get = (path: string, tok?: string) => new Request(`${ORIGIN}/api/moderation/${path}`, { headers: tok ? { 'cf-access-jwt-assertion': tok } : {} });
function post(body: unknown, tok?: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/moderation/action`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', [ACTION_HEADER]: '1',
      ...(tok ? { 'cf-access-jwt-assertion': tok } : {}), ...headers,
    },
  });
}

beforeEach(async () => {
  resetJwksCache();
  resetResponseCache();
  if (!key) {
    const kp = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
    key = { privateKey: kp.privateKey, jwk: { kid: 'k1', kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e } };
  }
});

describe('every moderation route refuses without the Access guard', () => {
  const routes = [['queue', () => get('queue')], ['search', () => get('search?q=kev')], ['action', () => post({ action: 'clear', flagId: ID })]] as const;
  it.each(routes)('%s: 401 without a token, and the database is never called', async (route, make) => {
    const { f, rpcs } = fakeFetch();
    const res = await handleModeration(make(), ENV, route, { fetch: f, nowMs: NOW });
    expect(res.status).toBe(401);
    expect(rpcs).toEqual([]);
  });
  it.each(routes)('%s: 403 for an email off the allow-list', async (route) => {
    const { f, rpcs } = fakeFetch();
    const tok = await token({ email: 'stranger@example.com' });
    const req = route === 'action' ? post({ action: 'clear', flagId: ID }, tok) : get(route === 'queue' ? 'queue' : 'search?q=kev', tok);
    expect((await handleModeration(req, ENV, route, { fetch: f, nowMs: NOW })).status).toBe(403);
    expect(rpcs).toEqual([]);
  });
  it.each(routes)('%s: 500 when a secret is missing', async (route, make) => {
    const { f, rpcs } = fakeFetch();
    expect((await handleModeration(make(), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: ' ' }, route, { fetch: f, nowMs: NOW })).status).toBe(500);
    expect(rpcs).toEqual([]);
  });
  it('an expired token is refused', async () => {
    const { f } = fakeFetch();
    expect((await handleModeration(get('queue', await token({ exp: NOW / 1000 - 300 })), ENV, 'queue', { fetch: f, nowMs: NOW })).status).toBe(401);
  });
});

describe('the POST guard', () => {
  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['no origin', { origin: '' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['no action header', { [ACTION_HEADER]: '' }],
  ])('refuses %s (403) before the database, even with a valid token', async (_n, headers) => {
    const { f, rpcs } = fakeFetch();
    const res = await handleModeration(post({ action: 'clear', flagId: ID }, await token(), headers), ENV, 'action', { fetch: f, nowMs: NOW });
    expect(res.status).toBe(403);
    expect(rpcs).toEqual([]);
  });
  it('405s a GET on the action route and a POST on a read route', async () => {
    const { f } = fakeFetch();
    expect((await handleModeration(get('action', await token()), ENV, 'action', { fetch: f, nowMs: NOW })).status).toBe(405);
    expect((await handleModeration(post({}, await token()), ENV, 'queue', { fetch: f, nowMs: NOW })).status).toBe(405);
  });
  it('400s a bad body, an unknown action, a bad id and an over-long note', async () => {
    const { f, rpcs } = fakeFetch();
    const tok = await token();
    for (const b of ['{not json', { action: 'delete', flagId: ID }, { action: 'clear', flagId: 'x' }, { action: 'reset', kind: 'room', targetId: ID },
      { action: 'review', reportId: ID, note: 'x'.repeat(501) }]) {
      expect((await handleModeration(post(b, tok), ENV, 'action', { fetch: f, nowMs: NOW })).status, JSON.stringify(b)).toBe(400);
    }
    expect(rpcs).toEqual([]);
  });
});

describe('actions', () => {
  it('call the SQL with the VERIFIED email as the actor, whatever the body says', async () => {
    const { f, rpcs } = fakeFetch();
    const res = await handleModeration(post({ action: 'reset', kind: 'account', targetId: ID, note: ' Rude ', p_actor: 'mallory@example.com' }, await token()), ENV, 'action', { fetch: f, nowMs: NOW });
    expect(res.status).toBe(200);
    expect(rpcs).toEqual([{ fn: 'moderation_reset_name', body: { p_actor: 'kevin@example.com', p_kind: 'account', p_target: ID, p_note: 'Rude' } }]);
  });
  it('drop the cached queue, so the next read goes to the database', async () => {
    const { f, rpcs } = fakeFetch();
    const tok = await token();
    await handleModeration(get('queue', tok), ENV, 'queue', { fetch: f, nowMs: NOW });
    expect((await handleModeration(get('queue', tok), ENV, 'queue', { fetch: f, nowMs: NOW + 1000 })).headers.get('x-dash-cache')).toBe('hit');
    await handleModeration(post({ action: 'clear', flagId: ID }, tok), ENV, 'action', { fetch: f, nowMs: NOW + 2000 });
    expect((await handleModeration(get('queue', tok), ENV, 'queue', { fetch: f, nowMs: NOW + 3000 })).headers.get('x-dash-cache')).toBe('miss');
    expect(rpcs.map((r) => r.fn)).toEqual(['moderation_queue', 'moderation_clear_flag', 'moderation_queue']);
  });
  it('pass the SQL\'s own refusal as 409 and hide anything else', async () => {
    const tok = await token();
    const refused = fakeFetch(() => new Response(JSON.stringify({ code: 'P0001', message: 'not_open' }), { status: 400 }));
    const r1 = await handleModeration(post({ action: 'clear', flagId: ID }, tok), ENV, 'action', { fetch: refused.f, nowMs: NOW });
    expect(r1.status).toBe(409);
    expect(await r1.json()).toEqual({ error: 'not_open' });
    const broken = fakeFetch(() => new Response(JSON.stringify({ message: 'secret detail' }), { status: 500 }));
    const r2 = await handleModeration(post({ action: 'clear', flagId: ID }, tok), ENV, 'action', { fetch: broken.f, nowMs: NOW });
    expect(r2.status).toBe(502);
    expect(await r2.text()).not.toContain('secret detail');
  });
});

describe('reads', () => {
  it('the queue caches for 60 s and fresh=1 skips the cache', async () => {
    const { f, rpcs } = fakeFetch();
    const tok = await token();
    const r1 = await handleModeration(get('queue?reports=reviewed&names=done', tok), ENV, 'queue', { fetch: f, nowMs: NOW });
    expect(r1.headers.get('cache-control')).toBe('private, no-store');
    expect(rpcs[0]).toEqual({ fn: 'moderation_queue', body: { p_reports: 'reviewed', p_names: 'done', p_limit: 100 } });
    const r2 = await handleModeration(get('queue?reports=reviewed&names=done&fresh=1', tok), ENV, 'queue', { fetch: f, nowMs: NOW + 1000 });
    expect(r2.headers.get('x-dash-cache')).toBe('miss');
    expect(rpcs).toHaveLength(2);
  });
  it('an empty search answers nothing without a database call', async () => {
    const { f, rpcs } = fakeFetch();
    const res = await handleModeration(get('search?q=%20%20', await token()), ENV, 'search', { fetch: f, nowMs: NOW });
    expect(await res.json()).toEqual({ q: '', accounts: [], teams: [] });
    expect(rpcs).toEqual([]);
  });
});

describe('argument shapes', () => {
  it('keep only allowed values', () => {
    expect(queueArgs(new URL('https://x/?reports=drop&names=all'))).toEqual({ p_reports: 'open', p_names: 'all', p_limit: 100 });
    expect(searchArgs(new URL(`https://x/?q=${'a'.repeat(65)}`))).toBeNull();
    expect(searchArgs(new URL('https://x/?q=Kevin%231111'))).toEqual({ p_q: 'Kevin#1111' });
    expect(actionCall({ action: 'review', reportId: ID, note: '' })).toEqual({ fn: 'moderation_review_report', args: { p_report: ID, p_note: null } });
    expect(actionCall([1])).toEqual({ error: 'bad body' });
  });
  it('same origin only', () => {
    expect(sameOriginPost(post({}))).toBeNull();
    expect(sameOriginPost(post({}, undefined, { origin: 'https://dash.example.evil.com' }))).toBe('cross-origin');
  });
});
