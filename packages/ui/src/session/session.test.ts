// @vitest-environment jsdom
/**
 * THE GAME SESSION, the client (R-SESSION-CF-01). Against a fake hub (`setSessionAccessForTests`):
 *  - the switch is read once; a game is a session game for its whole life (the choice survives a reload) and a game
 *    decided before the switch stays where it started;
 *  - the per-round cloud save goes to the session (the seat recordings only when they changed), and to Supabase exactly as
 *    before whenever the session cannot take it (no data loss); a Continue's claim is never routed; the end's clear is;
 *  - a session game publishes its live socket on the hub's `/session/<game>/ws`, every other game on its Versus Worker;
 *  - a watcher reaches a session-hosted game (`live_host: 'session'`) on the hub's session socket;
 *  - the run-end outbox hands each item to its sender together with the item (the session routing reads it).
 * The object's own behaviour is `workers/versus/test/it/session.it.ts` (real workerd).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyRun, type RunState } from '@game/sim';
import type { CloudSaveApi } from '../cloudSave';
import type { CfSocketOptions } from '../live/liveCf';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const remote = await import('./sessionRemote');
const { sessionCloudSaveApi, resetSessionCloudSaveForTests } = await import('./sessionCloudSave');
const { useGame } = await import('../store');
const identity = await import('../identity');
const pubMod = await import('../live/livePublisher');
const watchMod = await import('../live/liveWatch');
const cfMod = await import('../live/liveCf');
const { createOutbox, memoryOutboxStore } = await import('../net/runOutbox');

const HUB = 'http://127.0.0.1:8788';
type Call = { url: string; method: string; body: Record<string, unknown> | null };

/** A fake hub: the switch, and answers per session op. `down` = unreachable. */
function fakeHub(opts: { enabled?: boolean; down?: boolean; answer?: (op: string, body: Record<string, unknown> | null) => { status: number; body: unknown } } = {}) {
  const calls: Call[] = [];
  remote.setSessionAccessForTests({
    base: () => HUB,
    token: async () => 'dev.token',
    fetch: async (url, init) => {
      const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ url, method: init.method ?? 'GET', body });
      if (opts.down) throw new Error('network');
      if (url.endsWith('/session/config')) return { ok: true, status: 200, text: async () => JSON.stringify({ enabled: opts.enabled ?? true, protocol: 1 }) };
      const op = url.split('/').pop()!;
      const a = opts.answer?.(op, body) ?? { status: 200, body: { status: 'ok', revision: 3, seats: true } };
      return { ok: a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
    },
  });
  return calls;
}

function baseApi() {
  const calls: string[] = [];
  const api: CloudSaveApi = {
    fetchMeta: async () => null,
    fetchRow: async () => null,
    put: async (a) => { calls.push(`put:${a.payload ? 'save' : 'claim'}`); return { status: 'ok', revision: 9 }; },
    clear: async () => { calls.push('clear'); return 'ok'; },
  };
  return { api, calls };
}

const payload = { v: 1 as const, save: '{"round":3}', seatRuns: [[{ wave: 1 }, { wave: 2 }]] as never, seatHybrids: [] };

beforeEach(() => { localStorage.clear(); resetSessionCloudSaveForTests(); });
afterEach(() => { remote.setSessionAccessForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); identity.setIdentity(null); cfMod.setCfLiveSocketForTests(null); pubMod.setLivePublishUrlForTests(null); watchMod.setSessionWatchUrlForTests(null); });

describe('the switch and which games are session games', () => {
  it('read once; a game decided once and kept across a reload; a game decided before the switch stays put', async () => {
    const calls = fakeHub({ enabled: true });
    expect(remote.sessionGame('early')).toBe(false); // asked before the switch answered: the old path, for good
    expect(await remote.prefetchSessionConfig()).toBe(true);
    await remote.prefetchSessionConfig();
    expect(calls.filter((c) => c.url.endsWith('/config'))).toHaveLength(1);
    expect(remote.sessionGame('g1')).toBe(true);
    expect(remote.sessionGame('early')).toBe(false);
    // A reload: memory gone, the hub now OFF; both games keep their path.
    fakeHub({ enabled: false });
    await remote.prefetchSessionConfig();
    expect(remote.sessionGame('g1')).toBe(true);
    expect(remote.sessionGame('early')).toBe(false);
    expect(remote.sessionGame('g2')).toBe(false);
  });

  it('a hub that does not answer: the switch is off', async () => {
    fakeHub({ down: true });
    expect(await remote.prefetchSessionConfig()).toBe(false);
    expect(remote.sessionGame('g')).toBe(false);
  });
});

describe('the cloud save of a session game', () => {
  it('goes to the session; the seat recordings ride only when they changed; the clear goes too; a claim never', async () => {
    const calls = fakeHub();
    await remote.prefetchSessionConfig();
    remote.sessionGame('g1');
    remote.linkRunKey('run:g1', 'g1');
    const { api, calls: base } = baseApi();
    const s = sessionCloudSaveApi(api);
    expect(await s.put({ runKey: 'run:g1', expected: 0, deviceId: 'd', payload })).toEqual({ status: 'ok', revision: 3 });
    expect(await s.put({ runKey: 'run:g1', expected: 3, deviceId: 'd', payload })).toEqual({ status: 'ok', revision: 3 });
    const saves = calls.filter((c) => c.url.endsWith('/session/g1/save'));
    expect(saves).toHaveLength(2);
    expect(saves[0]!.body).toMatchObject({ protocol: 1, runKey: 'run:g1', expected: 0, save: '{"round":3}', seatRuns: payload.seatRuns });
    expect(saves[1]!.body).toMatchObject({ seatsSame: true });
    expect(saves[1]!.body).not.toHaveProperty('seatRuns');
    expect(await s.put({ runKey: 'run:g1', expected: 3, deviceId: 'd', payload: null })).toEqual({ status: 'ok', revision: 9 });
    expect(await s.clear({ runKey: 'run:g1', expected: 3 })).toBe('ok');
    expect(calls.some((c) => c.url.endsWith('/session/g1/clear'))).toBe(true);
    expect(base).toEqual(['put:claim']);
  });

  it('a session that cannot take it: the save goes to Supabase exactly as before (no data loss)', async () => {
    fakeHub({ answer: () => ({ status: 503, body: { error: 'server_error' } }) });
    await remote.prefetchSessionConfig();
    remote.sessionGame('g1');
    remote.linkRunKey('run:g1', 'g1');
    const { api, calls } = baseApi();
    const s = sessionCloudSaveApi(api);
    expect(await s.put({ runKey: 'run:g1', expected: 0, deviceId: 'd', payload })).toEqual({ status: 'ok', revision: 9 });
    expect(await s.clear({ runKey: 'run:g1', expected: 0 })).toBe('ok');
    expect(calls).toEqual(['put:save', 'clear']);
  });

  it('the run moved under another device: the conflict is reported as Supabase reports it', async () => {
    fakeHub({ answer: () => ({ status: 200, body: { status: 'conflict', current: { run_key: 'run:g1', revision: 7, device_id: 'other', updated_at: 'x' } } }) });
    await remote.prefetchSessionConfig();
    remote.sessionGame('g1');
    remote.linkRunKey('run:g1', 'g1');
    const s = sessionCloudSaveApi(baseApi().api);
    expect(await s.put({ runKey: 'run:g1', expected: 0, deviceId: 'd', payload })).toEqual({ status: 'conflict', current: { runKey: 'run:g1', revision: 7, deviceId: 'other', updatedAt: 'x' } });
  });

  it('a game that is not a session game: untouched', async () => {
    const calls = fakeHub({ enabled: false });
    await remote.prefetchSessionConfig();
    const { api, calls: base } = baseApi();
    await sessionCloudSaveApi(api).put({ runKey: 'run:x', expected: 0, deviceId: 'd', payload });
    expect(base).toEqual(['put:save']);
    expect(calls.filter((c) => c.url.includes('/save'))).toEqual([]);
  });
});

describe('the live socket of a session game', () => {
  const ranked = (): RunState => {
    const run = createLobbyRun(4321, 'warden');
    return { ...run, runId: 'g-sess', lobby: { ...run.lobby!, unrated: undefined, seats: run.lobby!.seats.map((s, i) => (i === 1 ? { ...s, kind: 'snapshot' } : s)) } } as RunState;
  };

  it('publishes on the hub\'s /session/<game>/ws; an old-path game on its Versus Worker', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    identity.setIdentity({ userId: 'u-player', isAnonymous: true } as never);
    fakeHub({ enabled: true });
    await remote.prefetchSessionConfig();
    const opened: CfSocketOptions[] = [];
    cfMod.setCfLiveSocketForTests((o) => { opened.push(o); return { connect: () => new Promise(() => undefined), request: async () => ({}) as never, broadcast: () => undefined, close: () => undefined }; });
    pubMod.setLivePublishUrlForTests(() => 'http://versus-worker');
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: ranked(), replaying: false, showTitle: false });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(opened[0]).toMatchObject({ baseUrl: HUB, gameId: 'g-sess', path: '/session/g-sess/ws' });
    off();
    // A game decided on the old path.
    localStorage.setItem('ascent.session.games', JSON.stringify({ 'g-old': 0 }));
    fakeHub({ enabled: true });
    await remote.prefetchSessionConfig();
    const off2 = pubMod.installLivePublisher();
    useGame.setState({ run: { ...ranked(), runId: 'g-old' } });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(opened.at(-1)).toMatchObject({ baseUrl: 'http://versus-worker', gameId: 'g-old' });
    expect(opened.at(-1)!.path).toBeUndefined();
    off2();
  });

  it('a watcher reaches a session-hosted game on the hub\'s session socket', async () => {
    identity.setIdentity({ userId: 'u-watch', isAnonymous: true } as never);
    const opened: CfSocketOptions[] = [];
    cfMod.setCfLiveSocketForTests((o) => { opened.push(o); return { connect: () => Promise.reject(new Error('x')), request: async () => ({}) as never, broadcast: () => undefined, close: () => undefined }; });
    watchMod.setSessionWatchUrlForTests(() => HUB);
    watchMod.setLiveWatchDiagnoseForTests(async () => 'unreachable');
    await watchMod.watchLiveGame('g-sess', { live_host: 'session' });
    expect(opened[0]).toMatchObject({ baseUrl: HUB, gameId: 'g-sess', path: '/session/g-sess/ws' });
    watchMod.setLiveWatchDiagnoseForTests(null);
  });
});

describe('the run-end outbox hands its sender the item (the session routing)', () => {
  it('send(table, rows, conflict, item) carries the item and its session', async () => {
    const seen: unknown[] = [];
    const ob = createOutbox({
      store: memoryOutboxStore(),
      send: async (_t, _r, _c, item) => { seen.push(item?.session ?? null); return { error: null }; },
      report: async () => undefined,
      currentUserId: () => 'u1',
      now: () => 0,
    });
    await ob.submit({ kind: 'boards', key: 'k1', table: 'boards', rows: [{ a: 1 }], session: 'g-sess' });
    await ob.submit({ kind: 'boards', key: 'k2', table: 'boards', rows: [{ a: 1 }] });
    expect(seen).toEqual(['g-sess', null]);
  });
});
