// @vitest-environment jsdom
/**
 * CROSS-DEVICE SAVES, through the real store (owner ask 2026-09-30: "if a player is playing on one device and they
 * save/quit, can we allow that to be picked up from another device they are signed in on?"; R-PERSIST-CLOUD-01..03).
 *
 * A DEVICE is one booted store module plus its own localStorage (swapped in and out, as two browser profiles
 * would hold them). The server is an in-memory `saved_runs` with the migration's accept / refuse rules
 * (`cloudSaveFake.ts`); the reducer, the lobby, the local save and the sync service are all real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from './identity';

const h = vi.hoisted(() => ({
  server: null as null | import('./cloudSaveFake').FakeServer,
  identity: null as Identity | null,
}));

vi.mock('./cloudSaveRemote', () => ({
  supabaseCloudSaveApi: (_client: unknown, userId: () => string | null) => h.server!.apiFor(userId),
}));
vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    recordFightResult: vi.fn(async () => {}),
    recordLobbyFights: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
    // The session a booting device restores: whatever the test says this device is signed in as.
    supabaseAuthProvider: { ...mod.supabaseAuthProvider, restore: async () => h.identity, onChange: () => () => {} },
  };
});

vi.setConfig({ testTimeout: 60_000 });
const SAVE_KEY = 'ascent.save';
const SIGNED_IN: Identity = { userId: 'u-kevin-test', displayName: '', anonymous: false, email: 'test@example.test' };
const GUEST: Identity = { userId: 'u-guest-test', displayName: '', anonymous: true, email: null };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Store = typeof import('./store');
interface Device { name: string; store: Store; sim: typeof import('@game/sim'); storage: Record<string, string> }
let active: Device | null = null;

function snapshotStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; out[k] = localStorage.getItem(k)!; }
  return out;
}
function use(d: Device): Device {
  if (active && active !== d) active.storage = snapshotStorage();
  localStorage.clear();
  for (const [k, v] of Object.entries(d.storage)) localStorage.setItem(k, v);
  active = d;
  return d;
}
/** A fresh device (empty storage), booted as `who`. */
async function boot(name: string, who: Identity | null): Promise<Device> {
  if (active) active.storage = snapshotStorage();
  localStorage.clear();
  h.identity = who;
  vi.resetModules();
  const store = await import('./store');
  const sim = await import('@game/sim');
  const d: Device = { name, store, sim, storage: {} };
  active = d;
  await sleep(10); // the identity handshake + the boot reconcile
  await settle(d);
  return d;
}
async function settle(d: Device): Promise<void> {
  for (let i = 0; i < 4; i++) { await d.store.cloudSaveForTests().idle(); await sleep(5); }
}
function startLobby(d: Device): void {
  const g = d.store.useGame;
  g.setState({ pendingMode: 'lobby' });
  g.getState().pickHero('warden');
  expect(g.getState().run.mode).toBe('lobby');
}

/** Register a few recorded player runs into this device's opponent pool (the shape `pool_runs_sample` serves). */
async function seedPlayerRuns(d: Device): Promise<void> {
  const { activeSet } = await import('@game/content');
  const setId = activeSet().id;
  const heroes = d.sim.playableHeroes().map((x) => x.id).filter((id) => id !== 'warden');
  const snap = (author: string, heroId: string, seed: number, wave: number) => ({
    v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass',
    power: wave * 10, seed, origin: 'self', author, setId, ownerId: `u-${author}`,
    minions: [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }],
  }) as unknown as import('@game/sim').BoardSnapshot;
  const runs = heroes.slice(0, 6).map((hero, i) => Array.from({ length: 8 }, (_, w) => snap(`Rival${i}`, hero, 500 + i, w + 1)));
  expect(d.sim.registerOpponentRuns(runs).runs).toBe(6);
}

beforeEach(async () => {
  const { fakeCloudServer } = await import('./cloudSaveFake');
  h.server = fakeCloudServer();
  active = null;
  localStorage.clear();
});

describe('cross-device saves (store)', () => {
  it('a guest never uploads', async () => {
    const a = await boot('A', GUEST);
    startLobby(a);
    a.store.useGame.getState().flushSave();
    await settle(a);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull(); // the local save is unchanged
    expect(h.server!.calls.filter((c) => c.startsWith('put'))).toEqual([]);
    expect(h.server!.rows.size).toBe(0);
  });

  it('save on A → Continue on B resumes the SAME run byte-for-byte (pinned opponents + lobby); B claims it; A\'s stale save is refused and A loads the newer copy', async () => {
    // ── Device A: a signed-in player starts a game; the new run's save uploads verbatim.
    const a = await boot('A', SIGNED_IN);
    await seedPlayerRuns(a); // this device's pool holds real player runs, so the table seats some of them
    startLobby(a);
    await settle(a);
    const row1 = h.server!.rows.get(SIGNED_IN.userId)!;
    expect(row1).toBeDefined();
    expect(row1.payload.save).toBe(localStorage.getItem(SAVE_KEY));
    // Save & Quit: the flush pushes the latest save.
    a.store.useGame.getState().flushSave();
    await settle(a);
    const aSave = localStorage.getItem(SAVE_KEY)!;
    expect(h.server!.rows.get(SIGNED_IN.userId)!.payload.save).toBe(aSave);
    const aRun = a.store.useGame.getState().run;
    const snapshotSeats = aRun.lobby!.seats.filter((st) => st.kind === 'snapshot' && st.runKey);
    expect(snapshotSeats.length).toBeGreaterThan(0);
    expect(h.server!.rows.get(SIGNED_IN.userId)!.payload.seatRuns?.length).toBe(snapshotSeats.length);

    // ── Device B: another browser profile. Its opponent pool is a DIFFERENT sample (emptied here), so the
    //    snapshot seats can only resolve through the recordings that travel with the cloud save.
    const b = await boot('B', GUEST); // boots before the account session lands…
    b.sim.OPPONENT_POOL.length = 0;
    expect(b.store.useGame.getState().savedRun).toBeNull();
    const { setIdentity } = await import('./identity');
    setIdentity(SIGNED_IN); // …then the signed-in session arrives
    await b.store.syncCloudAtTitle();
    const bState = b.store.useGame.getState();
    expect(bState.savedRun).not.toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBe(aSave); // the local slot now holds A's bytes
    expect(b.sim.serialize(bState.savedRun!)).toBe(b.sim.serialize(aRun)); // the whole run, incl. lobby + servedBoards
    expect(bState.savedRun!.servedBoards).toEqual(aRun.servedBoards);
    expect(bState.savedRun!.lobby).toEqual(aRun.lobby);
    for (const seat of snapshotSeats) expect(b.sim.playerRunByKey(seat.runKey!, undefined, aRun.lobby!.setId)).not.toBeNull();

    // Continue on B claims the run for B.
    bState.continueRun();
    await settle(b);
    const claimed = h.server!.rows.get(SIGNED_IN.userId)!;
    expect(claimed.revision).toBe(row1.revision + 2); // A's flush, then B's claim
    expect(claimed.payload.save).toBe(aSave);
    b.store.useGame.getState().flushSave(); // B plays on and saves
    await settle(b);
    const bSave = h.server!.rows.get(SIGNED_IN.userId)!.payload.save;

    // ── Back on A, which still had the game open: its save is REFUSED, never overwriting B's progress.
    use(a);
    const g = a.store.useGame;
    g.getState().continueRun(); // A resumes its (stale) local copy before noticing
    await settle(a);
    expect(g.getState().cloudMoved).toEqual({ ended: false });
    g.getState().flushSave();
    await settle(a);
    expect(h.server!.rows.get(SIGNED_IN.userId)!.payload.save).toBe(bSave);
    // A takes the offer and loads the newer copy.
    g.getState().resolveCloudMoved('load');
    await settle(a);
    expect(g.getState().cloudMoved).toBeNull();
    expect(g.getState().showTitle).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBe(bSave);
  });

  it('a run that ends clears the cloud and local saves; a stale copy on the other device is dropped, not resurrected', async () => {
    const a = await boot('A', SIGNED_IN);
    startLobby(a);
    a.store.useGame.getState().flushSave();
    await settle(a);
    const aStorage = snapshotStorage();

    const b = await boot('B', SIGNED_IN);
    expect(b.store.useGame.getState().savedRun).not.toBeNull(); // adopted at boot
    b.store.useGame.getState().continueRun();
    await settle(b);
    // Lose the first fight outright → the lobby ends the run.
    const g = b.store.useGame;
    const run = g.getState().run;
    const seats = run.lobby!.seats.map((st, i) => (i === 0 ? { ...st, resolve: 1, armor: 0 } : st));
    g.setState({ run: { ...run, resolve: 1, armor: 0, board: [], lobby: { ...run.lobby!, seats } } });
    g.getState().dispatch({ type: 'faceOmen' });
    g.getState().dispatch({ type: 'resolveCombat' });
    expect(g.getState().run.phase).toBe('gameover');
    await settle(b);
    expect(h.server!.rows.size).toBe(0);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();

    // Device A reboots with its old local copy of that run: Continue does not come back.
    a.storage = aStorage;
    localStorage.clear();
    for (const [k, v] of Object.entries(aStorage)) localStorage.setItem(k, v);
    active = null;
    const a2 = await boot('A', SIGNED_IN);
    void a2;
    expect(a2.store.useGame.getState().savedRun).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(h.server!.rows.size).toBe(0);
  });

  it('offline: the save stays local and syncs when the network returns', async () => {
    h.server!.online = false;
    const a = await boot('A', SIGNED_IN);
    startLobby(a);
    a.store.useGame.getState().flushSave();
    await settle(a);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    expect(h.server!.rows.size).toBe(0);
    h.server!.online = true;
    window.dispatchEvent(new Event('online'));
    await settle(a);
    expect(h.server!.rows.get(SIGNED_IN.userId)!.payload.save).toBe(localStorage.getItem(SAVE_KEY));
  });

  it('the SQL not deployed yet: local saving is untouched and Continue works as before', async () => {
    h.server!.deployed = false;
    const a = await boot('A', SIGNED_IN);
    startLobby(a);
    a.store.useGame.getState().flushSave();
    await settle(a);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    expect(a.store.useGame.getState().savedRun).not.toBeNull();
    expect(h.server!.rows.size).toBe(0);
  });
});
