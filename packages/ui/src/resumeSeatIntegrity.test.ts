// @vitest-environment jsdom
/**
 * SAME-DEVICE RESUME SERVES THE SAME SEATS (R-LOBBY-SERVE-01, owner 2026-10-17: "we need the game serving integrity to
 * be literally perfect"), through the real store.
 *
 * A lobby seat stores only how to FIND its boards, and a new session's opponent pool is a different random sample. So a
 * Save & Quit, then a Continue in a fresh session whose sample missed a seated run, used to seat a generated stand-in
 * under the real player's name (the save carried the seats' boards only when adopted from another device). Every lobby
 * save now stores them beside the save, and boot restores them before any seat is built.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    recordLobbyFights: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
    opponentPoolLoader: () => null,
    supabaseAuthProvider: { ...mod.supabaseAuthProvider, restore: async () => null, onChange: () => () => {} },
  };
});

vi.setConfig({ testTimeout: 60_000 });
const SEAT_RUNS_KEY = 'ascent.save.seatruns';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Sim = typeof import('@game/sim');
type BoardSnapshot = import('@game/sim').BoardSnapshot;

/** Boot a fresh store + sim (a new session) over whatever localStorage holds now. */
async function boot(): Promise<{ store: typeof import('./store'); sim: Sim }> {
  vi.resetModules();
  const store = await import('./store');
  const sim = await import('@game/sim');
  await sleep(10);
  return { store, sim };
}

beforeEach(() => { localStorage.clear(); });

describe('R-LOBBY-SERVE-01: Continue in a new session serves every seat exactly as before', () => {
  it('recorded seats resolve from the save even when the new pool lacks their runs; generated seats keep their saved recordings', async () => {
    const a = await boot();
    const { activeSet } = await import('@game/content');
    const setId = activeSet().id;
    const heroes = a.sim.playableHeroes().map((x) => x.id).filter((id) => id !== 'warden');
    const snap = (author: string, heroId: string, seed: number, wave: number): BoardSnapshot => ({
      v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass',
      power: wave * 10, seed, origin: 'self', author, setId, ownerId: `u-${author}`,
      minions: [{ cardId: 'pack', attack: wave + seed % 7, health: wave, keywords: [], golden: false }],
    }) as unknown as BoardSnapshot;
    a.sim.registerOpponentRuns(heroes.slice(0, 5).map((hero, i) => Array.from({ length: 8 }, (_, w) => snap(`Rival${i}`, hero, 900 + i, w + 1))));

    const g = a.store.useGame;
    g.setState({ pendingMode: 'lobby' });
    g.getState().pickHero('warden');
    const lobby = g.getState().run.lobby!;
    expect(lobby.seats.some((s) => s.kind === 'snapshot')).toBe(true);
    expect(lobby.seats.some((s) => s.kind === 'hybrid')).toBe(true);
    for (let i = 1; i < lobby.seats.length; i++) a.sim.warmLobbySeat(lobby, i); // the opening shop phase builds every seat
    const before = new Map(lobby.seats.filter((s) => s.kind !== 'player').map((s) => [s.id, [1, 2, 3].map((r) => a.sim.driverFor(s, lobby.setId)!.prepare(r)!.minions)]));
    g.getState().flushSave(); // Save & Quit

    const stored = JSON.parse(localStorage.getItem(SEAT_RUNS_KEY)!) as { runs: BoardSnapshot[][]; hybrids: { seed: number; heroId: string; snaps: BoardSnapshot[] }[] };
    expect(stored.runs.length, 'every recorded seat\'s run is saved').toBe(lobby.seats.filter((s) => s.kind === 'snapshot').length);
    expect(stored.hybrids.length, 'every generated seat\'s recording is saved').toBe(lobby.seats.filter((s) => s.kind === 'hybrid').length);
    // Stand in for "a deploy changed the autoplay": tamper the STORED recording, which the resume must then serve.
    const h0 = stored.hybrids[0]!;
    h0.snaps = h0.snaps.map((b) => ({ ...b, minions: b.minions.map((m) => ({ ...m, attack: m.attack + 100 })) }));
    localStorage.setItem(SEAT_RUNS_KEY, JSON.stringify(stored));

    // ── A NEW SESSION: a fresh pool sample that holds none of the seated runs (nothing re-registers them).
    const b = await boot();
    const saved = b.store.useGame.getState().savedRun!;
    expect(saved).not.toBeNull();
    expect(b.sim.lobbyStandIns(saved.lobby!), 'no recorded seat falls back to a stand-in').toEqual([]);
    b.store.useGame.getState().continueRun();
    for (const seat of saved.lobby!.seats.filter((s) => s.kind !== 'player')) {
      const served = [1, 2, 3].map((r) => b.sim.driverFor(seat, saved.lobby!.setId)!.prepare(r)!.minions);
      const tampered = seat.kind === 'hybrid' && seat.seed === h0.seed && seat.heroId === h0.heroId;
      if (tampered) expect(served[0]![0]!.attack, 'the SAVED generated recording is served').toBe(before.get(seat.id)![0]![0]!.attack + 100);
      else expect(served, `seat ${seat.id} (${seat.kind})`).toEqual(before.get(seat.id));
    }
  });
});
