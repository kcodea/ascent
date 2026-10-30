// @vitest-environment jsdom
/**
 * R-VERSUS-CF-ONLY-01 (owner 2026-10-29: "why are we using supabase for versus instead of cloudflare? stop doing that"):
 * every Versus room and match is on the Versus Worker. No per-mode switch is read, a Worker that cannot be reached is a
 * plain failure (the screen's error and Try again), never a room on Supabase, and the client carries no Supabase room
 * code at all. Supabase keeps only the RECORDS the Worker writes (results, history, ratings, Live Games rows).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contentRevision } from '@game/content';

const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock('../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../remoteBoards')>()), supabaseClient: () => ({ rpc, from: () => { throw new Error('no table reads'); }, auth: { getSession: async () => ({ data: { session: null } }) } }) }));

const { versusRemote, versusRoomRef, lobbyLivePublishUrl, lobbyLiveWatchUrl, VersusError } = await import('./versusRemote');
const { decodeRoomRef, embeddedCfUrl } = await import('./versusHost');
const { versusCfLiveUrl, versusCfDevUrl } = await import('./versusCfRemote');

const me = { displayName: 'Kev', profile: {}, setId: 'set1', contentRevision: contentRevision() };

afterEach(() => { vi.unstubAllGlobals(); rpc.mockClear(); });

describe('R-VERSUS-CF-ONLY-01: Versus is Cloudflare only', () => {
  it('a room is created on the Worker; a Worker that cannot be reached fails, and Supabase is never asked', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    for (const mode of ['duel', 'group', 'duos', 'ranked_duos'] as const) {
      const err = await versusRemote.createRoom('Room', me, { v: 1, mode, modifiers: [] } as never).then(() => null, (e: unknown) => e);
      expect(err, mode).toBeInstanceOf(VersusError);
    }
    expect(fetchMock).toHaveBeenCalled();
    for (const [url] of fetchMock.mock.calls as unknown as [string][]) expect(String(url).startsWith(versusCfDevUrl())).toBe(true);
    // Not the switch (versus_host_config), not a Supabase room (versus_create_room): nothing at all.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('room references always name the Worker; a bare id is a retired Supabase room', () => {
    expect(versusRoomRef({ id: 'r1' })).toBe('cf:r1');
    expect(decodeRoomRef('cf:r1')).toEqual({ roomId: 'r1', host: 'cf' });
    expect(decodeRoomRef('r1')).toEqual({ roomId: 'r1', host: 'supabase' });
  });

  it('live lobby / Practice games publish to the Worker (no switch read)', () => {
    expect(lobbyLivePublishUrl()).toBe(versusCfDevUrl());
    expect(rpc).not.toHaveBeenCalled();
  });

  it('R-LIVE-WATCH-REACH-01: a listed game is watched on the deployed Worker of ITS engine, even from a dev build on the same engine', () => {
    // This test build is a dev build (its own Worker would be local `wrangler dev`): a listed row was written by a
    // deployed Worker, so the watch must go there, never to 127.0.0.1:8787 (owner 2026-10-30: "i keep getting this error").
    expect(lobbyLiveWatchUrl(`cf:${contentRevision()}`)).toBe(versusCfLiveUrl(contentRevision()));
    expect(lobbyLiveWatchUrl('cf:7a0e7dc6')).toBe('https://ascent-versus-v1-7a0e7dc6.team-ascent.workers.dev');
    expect(lobbyLiveWatchUrl(`cf:${contentRevision()}`)).not.toBe(versusCfDevUrl());
  });

  it('a pack trusts only the Worker URL of its own engine (anything else: the Worker named after its engine)', () => {
    const own = versusCfLiveUrl(contentRevision());
    expect(embeddedCfUrl(own)).toBe(own);
    expect(embeddedCfUrl(`${own}/`)).toBe(own);
    expect(embeddedCfUrl(versusCfLiveUrl('deadbeef'))).toBeNull();
    expect(embeddedCfUrl('https://evil.example.com')).toBeNull();
    expect(embeddedCfUrl(undefined)).toBeNull();
  });

  it('no client code calls a Supabase room / match function, the retired switch or the retired resolver', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !p.includes(`${join('versus', 'chaos')}`)) files.push(p);
      }
    };
    walk(root);
    const banned = /'versus-resolve'|'versus_host_config'|'versus_(create_room|join_room|take_seat|leave_room|start_game|press_gate|heartbeat|submit|reconcile|group_submit|group_reconcile)'|'lobby_live_duos_heartbeat'/;
    const hits = files.filter((p) => banned.test(readFileSync(p, 'utf8'))).map((p) => p.slice(root.length + 1));
    expect(hits).toEqual([]);
  });

  it('the release script no longer asks for a versus-resolve redeploy', () => {
    const script = readFileSync(join(__dirname, '../../../../scripts/release-web.mjs'), 'utf8');
    expect(script).not.toMatch(/versus-resolve/);
  });
});
