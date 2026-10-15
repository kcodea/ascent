// @vitest-environment jsdom
/**
 * VERSUS through the lobby screens (owner 2026-10-14) — the coordinator's gates (blueprint 10): a Versus run now
 * CARRIES a lobby (`versusLobby`, two seats, display only), and every path that keys on `run.lobby` must still refuse
 * it. Never a save slot / Continue, never a lobby snapshot or captured board, never served to the pool, never a
 * fight-ledger / Hall row, never run_history / rank, never a replay draft. Driven through the REAL store commit path:
 * a Versus End Turn parks the side, the server's fight lands, settles and resolves, round after round.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeRng } from '@game/core';
import {
  createVersusRun, lobbyIsUnrated, reduce, resolveVersusFight, versusAutoResolve, versusLobby, type RunState, type VersusLobbyRound,
} from '@game/sim';

const remote = vi.hoisted(() => ({
  recordFightResult: vi.fn(async () => undefined), recordLobbyFights: vi.fn(async () => undefined), uploadBoards: vi.fn(async () => undefined),
  uploadRunHistory: vi.fn(async () => undefined), uploadRunTelemetry: vi.fn(async () => undefined), uploadVictory: vi.fn(async () => undefined),
  uploadPracticeGame: vi.fn(async () => undefined),
}));
vi.mock('../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../remoteBoards')>()), ...remote }));
const library = vi.hoisted(() => ({ saveCapturedBoards: vi.fn(() => 0), saveRunBoards: vi.fn(() => 0) }));
vi.mock('../boardLibrary', async (orig) => ({ ...(await orig<typeof import('../boardLibrary')>()), ...library }));

afterEach(() => { localStorage.clear(); });

describe('a Versus run with its two-seat lobby never reaches a lobby persistence path', { timeout: 60_000 }, () => {
  it('plays rounds through the store: no save, no captured boards, no pool / ledger / history / rank / replay writes', async () => {
    const { useGame, isResumableRun } = await import('../store');
    const { installVersusHandlers } = await import('./versusHooks');
    const { runRecordsDraft } = await import('../replay/replayDraft');
    const { rankedAbandonOf, rankedRunIdForFinish } = await import('../rank/ratedRun');

    let foe = createVersusRun(2, 'warden', 'set2');
    const rounds: VersusLobbyRound[] = [];
    const lobbyOf = (run: RunState): RunState => ({
      ...run,
      lobby: versusLobby({
        matchSeed: 9, setId: 'set2', seat: 'p1', wave: run.wave, inCombat: run.phase === 'combat', combatSettled: !!run.combatSettled,
        me: { label: 'Orangez', heroId: run.heroId }, foe: { label: 'LazerLemon', heroId: 'indy' }, rounds,
      }),
    });
    const fights = new Map<number, ReturnType<typeof resolveVersusFight>>();
    installVersusHandlers({ fightFor: (w) => fights.get(w)?.p1 ?? null, afterCommit: () => undefined });
    useGame.getState().startVersusRun(lobbyOf(createVersusRun(1, 'warden', 'set2')));

    for (let round = 1; round <= 4; round++) {
      const me = useGame.getState().run;
      // Both sides lock (the fight is resolved server-side from the two parked sides).
      const mine = reduce(versusAutoResolve(structuredClone(me), makeRng(round)), { type: 'faceOmen', deferFight: true });
      foe = reduce(versusAutoResolve(foe, makeRng(round + 50)), { type: 'faceOmen', deferFight: true });
      const fight = resolveVersusFight({ matchSeed: 9, round, p1: mine.pendingCombatSide!, p2: foe.pendingCombatSide! });
      fights.set(round, fight);
      rounds.push({ round, heartLostBy: fight.heartLostBy, mine: fight.p1 });
      useGame.setState({ run: versusAutoResolve(lobbyOf(useGame.getState().run), makeRng(round)) });
      useGame.getState().dispatch({ type: 'faceOmen' }); // parks + lands in one commit
      expect(useGame.getState().run.phase).toBe('combat');
      useGame.getState().dispatch({ type: 'settleCombat' });
      useGame.setState({ run: lobbyOf(useGame.getState().run) });
      useGame.getState().dispatch({ type: 'resolveCombat' });
      const run = useGame.getState().run;
      expect(run.phase).toBe('recruit');
      expect(run.lobby).toBeTruthy();
      // The ladder gates, asked about the lobby-carrying run.
      expect(isResumableRun(run)).toBe(false);
      expect(runRecordsDraft(run)).toBe(false);
      expect(rankedRunIdForFinish(run, 1)).toBeNull();
      expect(rankedAbandonOf(run, true)).toBeNull();
      expect(lobbyIsUnrated(run.lobby!)).toBe(true);
      foe = reduce(reduce(reduce(foe, { type: 'landCombat', fight: { result: fight.p2, damageTaken: 0 } }), { type: 'settleCombat' }), { type: 'resolveCombat' });
    }
    installVersusHandlers(null);

    const st = useGame.getState();
    expect(st.capturedBoards).toEqual([]); // never a lobby snapshot / pool board
    expect(Object.keys(localStorage).filter((k) => k === 'ascent.save' || k === 'ascent.save.seatruns')).toEqual([]);
    for (const [name, fn] of Object.entries({ ...remote, ...library })) expect(fn, name).not.toHaveBeenCalled();
    // Resolve / Armor are untouched by every fight (hearts only).
    const fresh = createVersusRun(1, 'warden', 'set2');
    expect([st.run.resolve, st.run.armor]).toEqual([fresh.resolve, fresh.armor]);
  });
});
