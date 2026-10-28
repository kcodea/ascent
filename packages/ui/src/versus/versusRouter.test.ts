/**
 * THE VERSUS CUTOVER ROUTER (R-VERSUS-CF-CUTOVER-01, docs/versus-cf-cutover.md): new rooms go where the per-mode switch
 * says; a room keeps its host for life (a rollback only moves NEW rooms); lists, open counts and reconnect read both
 * backends; invites / Watch ids carry the host; a build without a Worker is Supabase-only and never reads the switch.
 */
import { describe, expect, it, vi } from 'vitest';
import { contentRevision } from '@game/content';
import type { VersusRoomOptions } from '@game/sim';
import { makeRoutedVersusRemote, mergeRoomLists, VERSUS_ROUTES } from './versusRouter';
import {
  DEFAULT_HOST_CONFIG, decodeRoomRef, embeddedCfUrl, encodeRoomRef, hostForNewRoom, makeHostConfigReader, makeRoomHostMemory,
  parseHostConfig, parseRouteOverride, type VersusHostConfig,
} from './versusHost';
import { versusCfLiveUrl } from './versusCfRemote';
import { duosLiveRoomOf, publishesOwnRow } from './duosLive';
import { makeVersusRemote, VersusError, type VersusIdentity, type VersusRemote, type VersusRoom, type VersusRoomSummary } from './versusRemote';

type Impl = Partial<Record<keyof VersusRemote, (...a: never[]) => unknown>>;

/** A backend that records every call and answers from `impl` (default: resolves null). */
function fake(impl: Impl = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const remote = new Proxy({}, {
    get: (_t, k) => (typeof k !== 'string' || k === 'then' ? undefined : (...args: unknown[]) => {
      calls.push({ name: k, args });
      const f = (impl as Record<string, (...a: unknown[]) => unknown>)[k];
      if (k === 'subscribeRoom') return f ? f(...args) : { send: () => undefined, close: async () => undefined };
      return f ? Promise.resolve().then(() => f(...args)) : Promise.resolve(null);
    }),
  }) as VersusRemote;
  return { remote, calls, names: () => calls.map((c) => c.name) };
}

function storage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const room = (id: string, match: string | null = null): VersusRoom => ({
  id, name: 'r', host_user_id: 'u1', status: 'open', set_id: 's', content_revision: 'c', protocol: 1, revision: 1,
  gate_deadline: null, p1_gate: false, p2_gate: false, current_match_id: match, members: [], serverNow: '2026-10-28T00:00:00Z',
});
const summary = (id: string, createdAt: string): VersusRoomSummary => ({
  id, name: id, status: 'open', setId: 's', contentRevision: 'c', protocol: 1, createdAt, currentMatchId: null,
  hostName: null, hostProfile: null, players: 1, spectators: 0,
});
const RANKED_DUOS_OPTIONS = { v: 1, mode: 'ranked_duos', modifiers: [] } as VersusRoomOptions;
const ME: VersusIdentity = { displayName: 'Claudebot1', profile: {}, setId: 's', contentRevision: 'c' };

function setup(opts: { cf?: boolean; config?: Partial<VersusHostConfig>; supa?: Impl; cfImpl?: Impl; store?: ReturnType<typeof storage> } = {}) {
  let config: VersusHostConfig = { ...DEFAULT_HOST_CONFIG, ...opts.config };
  const readConfig = vi.fn(async () => config);
  const supa = fake({ createRoom: () => room('s-new'), ...opts.supa });
  const cf = fake({ createRoom: () => room('c-new'), listRooms: () => [], ...opts.cfImpl });
  const store = opts.store ?? storage();
  const router = makeRoutedVersusRemote({
    supabase: supa.remote, cf: opts.cf === false ? null : cf.remote, readConfig, memory: makeRoomHostMemory(store),
  });
  return { router, supa, cf, readConfig, store, flip: (next: Partial<VersusHostConfig>) => { config = { ...config, ...next }; } };
}

describe('Versus cutover: where new rooms go', () => {
  it('a build with no Worker is Supabase-only and never reads the switch', async () => {
    const t = setup({ cf: false, config: { duel: 'cf' } });
    const r = await t.router.createRoom('a', ME);
    expect(r.id).toBe('s-new');
    await t.router.listRooms();
    await t.router.myRoomId('u1');
    await t.router.joinRoom('x', 'player', ME);
    await t.router.submit('m', 1, 1, {} as never, true, null);
    expect(t.readConfig).not.toHaveBeenCalled();
    expect(t.cf.calls).toHaveLength(0);
    expect(t.router.hostForMode('duel')).toBe('supabase');
  });

  it('the switch picks the host per mode (default everything on Supabase)', async () => {
    const t = setup();
    expect((await t.router.createRoom('a', ME)).id).toBe('s-new');
    t.flip({ duel: 'cf' });
    expect((await t.router.createRoom('b', ME)).id).toBe('c-new');           // a Versus room is created as a duel
    expect((await t.router.createRoom('c', ME, RANKED_DUOS_OPTIONS)).id).toBe('s-new'); // Ranked Duos still on Supabase
    expect(t.router.hostOf('c-new')).toBe('cf');
    expect(t.router.hostForMode('duel')).toBe('cf');
    expect(t.router.hostForMode('group')).toBe('supabase');
  });

  it('a Worker outage on create falls back to Supabase; a refusal does not', async () => {
    const down = setup({ config: { duel: 'cf' }, cfImpl: { createRoom: () => { throw new VersusError('network'); } } });
    expect((await down.router.createRoom('a', ME)).id).toBe('s-new');
    const no = setup({ config: { duel: 'cf' }, cfImpl: { createRoom: () => { throw new VersusError('already_in_room'); } } });
    await expect(no.router.createRoom('a', ME)).rejects.toMatchObject({ code: 'already_in_room' });
    expect(no.supa.names()).not.toContain('createRoom');
  });

  it('hostForNewRoom: override beats the switch, no Worker beats both', () => {
    expect(hostForNewRoom('duel', { ...DEFAULT_HOST_CONFIG, duel: 'cf' }, null, true)).toBe('cf');
    expect(hostForNewRoom('duel', { ...DEFAULT_HOST_CONFIG, duel: 'cf' }, { duel: 'supabase' }, true)).toBe('supabase');
    expect(hostForNewRoom('group', DEFAULT_HOST_CONFIG, { group: 'cf' }, true)).toBe('cf');
    expect(hostForNewRoom('duel', { ...DEFAULT_HOST_CONFIG, duel: 'cf' }, { duel: 'cf' }, false)).toBe('supabase');
  });
});

describe('Versus cutover: a room keeps its host', () => {
  it('rooms and matches already running stay put when the switch flips (rollback)', async () => {
    const t = setup({ config: { duel: 'cf' }, cfImpl: { createRoom: () => room('c-1'), room: () => room('c-1', 'cm-1'), heartbeat: () => ({ serverNow: 'x' }) } });
    await t.router.createRoom('a', ME);
    await t.router.room('c-1');                    // learns the room's match
    t.flip({ duel: 'supabase' });                  // ROLLBACK
    // New rooms: Supabase at once.
    expect((await t.router.createRoom('b', ME)).id).toBe('s-new');
    // The Cloudflare room and its match finish on Cloudflare.
    await t.router.heartbeat('c-1');
    await t.router.submit('cm-1', 3, 7, {} as never, true, null);
    await t.router.combatReady('cm-1', 3);
    t.router.subscribeRoom('c-1', 'cm-1', () => undefined);
    expect(t.cf.names()).toEqual(expect.arrayContaining(['heartbeat', 'submit', 'combatReady', 'subscribeRoom']));
    expect(t.supa.names()).not.toContain('submit');
  });

  it('a Supabase room stays on Supabase after the mode moves to Cloudflare', async () => {
    const t = setup({ supa: { createRoom: () => room('s-1', 'sm-1') } });
    await t.router.createRoom('a', ME);
    t.flip({ duel: 'cf' });
    await t.router.startGame('s-1');
    await t.router.pickHero('sm-1', 0);
    expect(t.supa.names()).toEqual(expect.arrayContaining(['startGame', 'pickHero']));
    expect(t.cf.names()).not.toContain('pickHero');
  });

  it('the host survives a reload (remembered), and reconnect finds a Cloudflare room', async () => {
    const store = storage();
    const a = setup({ store, config: { duel: 'cf' }, cfImpl: { createRoom: () => room('c-9') } });
    await a.router.createRoom('a', ME);
    // A fresh router (a reload) on the same storage, the switch rolled back meanwhile.
    const b = setup({ store, cfImpl: { myRoomId: () => 'c-9', room: () => room('c-9', 'cm-9') } });
    expect(b.router.hostOf('c-9')).toBe('cf');
    expect(await b.router.myRoomId('u1')).toBe('c-9');
    await b.router.room('c-9');
    await b.router.match('cm-9');
    expect(b.cf.names()).toEqual(expect.arrayContaining(['myRoomId', 'room', 'match']));
    expect(b.supa.names()).toEqual(['myRoomId']); // asked, answered nothing
  });

  it('reconnect with only a Supabase room goes to Supabase', async () => {
    const t = setup({ supa: { myRoomId: () => 's-5' }, cfImpl: { myRoomId: () => null } });
    expect(await t.router.myRoomId('u1')).toBe('s-5');
    await t.router.room('s-5');
    expect(t.supa.names()).toContain('room');
  });

  it('an unknown room id (a join from the list of another tab) is looked up in the Worker list', async () => {
    const t = setup({ cfImpl: { listRooms: () => [summary('c-7', '2026-10-28T01:00:00Z')] } });
    await t.router.joinRoom('c-7', 'player', ME);
    await t.router.joinRoom('s-7', 'player', ME);
    expect(t.cf.calls.find((c) => c.name === 'joinRoom')?.args[0]).toBe('c-7');
    expect(t.supa.calls.find((c) => c.name === 'joinRoom')?.args[0]).toBe('s-7');
  });

  it('an invite / Watch ref names the host, and the router learns it', async () => {
    expect(encodeRoomRef('abc', 'cf')).toBe('cf:abc');
    expect(encodeRoomRef('abc', 'supabase')).toBe('abc');
    expect(decodeRoomRef('cf:abc')).toEqual({ roomId: 'abc', host: 'cf' });
    expect(decodeRoomRef('abc')).toEqual({ roomId: 'abc', host: 'supabase' }); // every pre-cutover row
    const t = setup();
    t.router.noteRoomHost('c-3', 'cf');
    await t.router.joinRoom('c-3', 'spectator', ME);
    expect(t.cf.names()).toContain('joinRoom');
    expect(t.cf.names()).not.toContain('listRooms'); // known: no lookup
  });

  it('Live Games: a Cloudflare Ranked Duos row (duos:cf:<room>) watches the room ON THE WORKER (R-VERSUS-CF-LIVE-01)', async () => {
    const ref = duosLiveRoomOf('duos:cf:c-9')!;
    expect(ref).toBe('cf:c-9');
    expect(duosLiveRoomOf('duos:s-9')).toBe('s-9'); // a Supabase team row, unchanged
    expect(duosLiveRoomOf('run-7')).toBeNull(); // a solo ranked row
    // What goToVersusRoom does with it: note the host, then join in the stands.
    const t = setup();
    const { roomId, host } = decodeRoomRef(ref);
    t.router.noteRoomHost(roomId, host);
    await t.router.joinRoom(roomId, 'spectator', ME);
    expect(t.cf.calls.find((c) => c.name === 'joinRoom')?.args.slice(0, 2)).toEqual(['c-9', 'spectator']);
    expect(t.supa.names()).not.toContain('joinRoom');
    // A Cloudflare room's row is the Worker's: the client never heartbeats it to Supabase (it would only fail).
    expect(publishesOwnRow('c-9', (id) => t.router.hostOf(id))).toBe(false);
    expect(publishesOwnRow('s-9', (id) => t.router.hostOf(id))).toBe(true);
  });

  it('invite proof: asked of the host of the room (R-VERSUS-CF-INVITE-01)', async () => {
    const t = setup({ cfImpl: { inviteProof: () => '1.ab' } });
    t.router.noteRoomHost('c-4', 'cf');
    expect(await t.router.inviteProof('c-4', 'u2', 'versus_room')).toBe('1.ab');
    expect(t.cf.names()).toContain('inviteProof');
    await t.router.inviteProof('s-4', 'u2', 'versus_room');
    expect(t.supa.names()).toContain('inviteProof');
    // The Supabase adapter needs none (friends_invite checks a Supabase room in SQL).
    expect(await makeVersusRemote(() => null).inviteProof('s-4', 'u2', 'versus_room')).toBeNull();
  });

  it('records and dev bots always read Supabase', async () => {
    const t = setup({ config: { duel: 'cf', group: 'cf', duos: 'cf', ranked_duos: 'cf' } });
    await t.router.duosLeaderboard();
    await t.router.duosTeamsOf('u1');
    await t.router.setTeamName('u2', 'x');
    expect(t.cf.calls).toHaveLength(0);
  });
});

describe('Versus cutover: both lists', () => {
  it('merges, tags the host and keeps newest first', async () => {
    const t = setup({
      supa: { listRooms: () => [summary('s-2', '2026-10-28T03:00:00Z'), summary('s-1', '2026-10-28T01:00:00Z')] },
      cfImpl: { listRooms: () => [summary('c-1', '2026-10-28T02:00:00Z')] },
    });
    const list = await t.router.listRooms();
    expect(list.map((r) => [r.id, r.host])).toEqual([['s-2', 'supabase'], ['c-1', 'cf'], ['s-1', 'supabase']]);
    // The list taught the router: joining c-1 needs no second lookup.
    await t.router.joinRoom('c-1', 'player', ME);
    expect(t.cf.names().filter((n) => n === 'listRooms')).toHaveLength(1);
  });

  it('one backend down still lists the other; both down is an error', async () => {
    const cfDown = setup({ supa: { listRooms: () => [summary('s-1', 'a')] }, cfImpl: { listRooms: () => { throw new VersusError('network'); } } });
    expect((await cfDown.router.listRooms()).map((r) => r.id)).toEqual(['s-1']);
    const supaDown = setup({ supa: { listRooms: () => { throw new VersusError('no_backend'); } }, cfImpl: { listRooms: () => [summary('c-1', 'a')] } });
    expect((await supaDown.router.listRooms()).map((r) => r.id)).toEqual(['c-1']);
    const both = setup({ supa: { listRooms: () => { throw new VersusError('no_backend'); } }, cfImpl: { listRooms: () => { throw new VersusError('network'); } } });
    await expect(both.router.listRooms()).rejects.toMatchObject({ code: 'no_backend' });
  });

  it('open-room counts add up', async () => {
    const t = setup({ supa: { openRooms: () => ({ open: 2, seatOpen: 1, duosOpen: 1 }) }, cfImpl: { openRooms: () => ({ open: 3, seatOpen: 2 }) } });
    expect(await t.router.openRooms('c')).toEqual({ open: 5, seatOpen: 3, duosOpen: 1 });
  });

  it('mergeRoomLists keeps a duplicate id once (Supabase wins)', () => {
    expect(mergeRoomLists([summary('x', 'b')], [summary('x', 'c')]).map((r) => r.host)).toEqual(['supabase']);
  });
});

describe('Versus cutover: the switch itself', () => {
  it('parses the server answer defensively', () => {
    expect(parseHostConfig({ duel: 'cf', group: 'bogus', extra: 'cf' })).toEqual({ ...DEFAULT_HOST_CONFIG, duel: 'cf' });
    expect(parseHostConfig(null)).toEqual(DEFAULT_HOST_CONFIG);
    expect(parseHostConfig([1])).toEqual(DEFAULT_HOST_CONFIG);
  });

  it('is cached for its TTL, and a failed read means Supabase', async () => {
    let t = 0;
    let answer: unknown = { duel: 'cf' };
    const fetch = vi.fn(async () => { if (answer instanceof Error) throw answer; return answer; });
    const reader = makeHostConfigReader(fetch, () => t, 30_000);
    expect(reader.peek()).toEqual(DEFAULT_HOST_CONFIG);
    expect((await reader.get()).duel).toBe('cf');
    answer = { duel: 'supabase' };
    t = 29_000;
    expect((await reader.get()).duel).toBe('cf');   // cached
    t = 31_000;
    expect((await reader.get()).duel).toBe('supabase'); // the flip lands after the TTL
    answer = new Error('PGRST202');
    t = 70_000;
    expect(await reader.get()).toEqual(DEFAULT_HOST_CONFIG); // no migration / offline: Supabase
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('the dev override parses single modes and *', () => {
    expect(parseRouteOverride('duel:cf,group:supabase')).toEqual({ duel: 'cf', group: 'supabase' });
    expect(parseRouteOverride('*:cf')).toEqual({ duel: 'cf', group: 'cf', duos: 'cf', ranked_duos: 'cf' });
    expect(parseRouteOverride('nonsense')).toBeNull();
    expect(parseRouteOverride(null)).toBeNull();
  });

  it('a build trusts only the Worker URL of its own engine', () => {
    const own = versusCfLiveUrl(contentRevision());
    expect(embeddedCfUrl(own)).toBe(own);
    expect(embeddedCfUrl(`${own}/`)).toBe(own);
    expect(embeddedCfUrl(versusCfLiveUrl('deadbeef'))).toBeNull();
    expect(embeddedCfUrl('https://evil.example.com')).toBeNull();
    expect(embeddedCfUrl(undefined)).toBeNull();
  });

  it('every adapter method is routed (nothing skips the router)', () => {
    const methods = Object.keys(makeVersusRemote(() => null)).sort();
    expect(Object.keys(VERSUS_ROUTES).sort()).toEqual(methods);
  });
});
