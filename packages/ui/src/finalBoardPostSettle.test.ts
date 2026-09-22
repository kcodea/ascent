// @vitest-environment jsdom
/**
 * THE RECORDED FINAL BOARD IS THE POST-SETTLE BOARD (owner ask 2026-09-21).
 *
 * "This board is the board from before the last combat. Can we make it so that the final snapshot is actually
 * what a fresh board would look like after that final combat? So that it carries the in-combat buffs for
 * boards that carry them."
 *
 * The board a finished run records for the Career row, Recent Games and the Hall of Champions used to be the
 * last combat's START-OF-COMBAT board (`socBoard` merged onto the end-state snapshot): SoC buffs, shields and
 * summons applied, but every gain made DURING the fight (Engraved growth, Ruby carry-backs) missing, because
 * those land on the run board only when `settleCombat` runs. It is now `endStateBoard(next)`: the settled
 * `run.board`, exactly what the next shop would have opened with.
 *
 * These tests drive the REAL store (`dispatch({ type: 'resolveCombat' })` from a hand-built combat state) to
 * the run-end block and read the mocked upload seams, the way `bug-report/bugScenarioLoad.test.ts` does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG, createLobbyRun, createRun, type BoardCard, type BoardSnapshot, type RunState } from '@game/sim';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    fetchRunHistory: vi.fn(async () => null),
    recordFightResult: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

import { useGame } from './store';
import { uploadRunHistory, uploadVictory } from './remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One Alleycat on the run board. `keywords` decides whether it is an Engraved body (the carry-back path). */
const alley = (keywords: BoardCard['keywords'] = []): BoardCard => ({
  uid: 'e', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords, golden: false,
});

/**
 * A hand-built last combat. Its Start-of-Combat slice (everything before the first `attack`) carries the
 * combat-only things the OLD snapshot used to fold in: a +2/+2 buff on the Alleycat's combat clone, a shield
 * on it, and a summoned token. `playerPermaBuffs` is the ONE thing that carries back through `settleCombat`.
 */
function lastCombat(opts: { result: CombatResult['result']; permaBuffs?: CombatResult['playerPermaBuffs']; playerDamage?: number; enemyDamage?: number }): CombatResult {
  return {
    result: opts.result,
    playerDamage: opts.playerDamage ?? 0,
    ...(opts.enemyDamage !== undefined ? { enemyDamage: opts.enemyDamage } : {}),
    playerDeathrattles: 0,
    enemyDeaths: 0,
    events: [
      { type: 'buff', target: 'c1', attack: 2, health: 2, source: 'c1' },
      { type: 'shieldUp', target: 'c1' },
      { type: 'summon', side: 'player', index: 1, minion: { uid: 'tok', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 1, health: 1, keywords: [] } },
      { type: 'attack', attacker: 'c1', defender: 'x1' } as unknown as CombatResult['events'][number],
    ],
    initial: {
      player: [{ uid: 'c1', cardId: 'alley', name: 'Alleycat', tribe: 'beast', attack: 1, health: 1, keywords: [] }],
      enemy: [],
    },
    ...(opts.permaBuffs ? { playerPermaBuffs: opts.permaBuffs } : {}),
  };
}

function seed(run: RunState): void {
  useGame.setState({ run, showTitle: false, replaying: false, replayActions: [], capturedBoards: [], lastReplay: null });
}

/** The `board` the Career row was uploaded with (`uploadRunHistory` takes a loose record, so it is typed here). */
const historyBoard = (): BoardSnapshot | null => vi.mocked(uploadRunHistory).mock.calls[0]![0].board as BoardSnapshot | null;

describe('the recorded final board is the board AFTER the last combat settles', () => {
  beforeEach(() => {
    vi.mocked(uploadRunHistory).mockClear();
    vi.mocked(uploadVictory).mockClear();
    localStorage.clear();
  });
  afterEach(() => { vi.mocked(uploadRunHistory).mockClear(); vi.mocked(uploadVictory).mockClear(); });

  it('an ELIMINATED ascent run records the Engraved gain its last combat carried back', async () => {
    const run: RunState = {
      ...createRun(1), phase: 'combat', combatSettled: false, resolve: 1, armor: 0,
      board: [alley(['EG'])],
      lastCombat: lastCombat({ result: 'lose', playerDamage: 5, permaBuffs: [{ sourceUid: 'e', attack: 5, health: 5, engraved: true }] }),
    };
    seed(run);
    useGame.getState().dispatch({ type: 'resolveCombat' });
    const after = useGame.getState().run;
    expect(after.phase).toBe('gameover');
    expect(after.combatSettled, 'the run-end block relies on resolveCombat settling first').toBe(true);

    await sleep(30);
    expect(vi.mocked(uploadRunHistory)).toHaveBeenCalledTimes(1);
    const board = historyBoard();
    expect(board).not.toBeNull();
    expect(board!.minions).toHaveLength(1);
    const m = board!.minions[0]!;
    // base 1/1 + the carried-back +5/+5. The OLD snapshot printed the SoC clone: 3/3 with a shield.
    expect([m.attack, m.health]).toEqual([6, 6]);
    expect(m.buffs?.some((b) => b.source === 'Engraved' && b.attack === 5 && b.health === 5)).toBe(true);
    expect(m.keywords).not.toContain('DS');
    expect(m.name).toBe(CARD_INDEX['alley']!.name); // identity still baked for a reader on another build
    // "Rewatch last game" carries the SAME board object the Career row got.
    expect(useGame.getState().lastReplay?.result.finalBoard).toBe(board);
  });

  it('combat-only Start-of-Combat buffs, shields and summons do NOT appear on the recorded board', async () => {
    const run: RunState = {
      ...createRun(2), phase: 'combat', combatSettled: false, resolve: 1, armor: 0,
      board: [alley()], // a plain body: a SoC +2/+2 on it never carries
      lastCombat: lastCombat({ result: 'lose', playerDamage: 5 }),
    };
    seed(run);
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover');

    await sleep(30);
    const board = historyBoard();
    expect(board).not.toBeNull();
    expect(board!.minions, 'the SoC-summoned token is combat-only and is dropped').toHaveLength(1);
    const m = board!.minions[0]!;
    expect([m.attack, m.health]).toEqual([1, 1]);
    expect(m.keywords).not.toContain('DS');
    expect(board!.power).toBe(2);
  });

  it('a course VICTORY settles the last combat before recording too', async () => {
    const run: RunState = {
      ...createRun(3), phase: 'combat', combatSettled: false, wave: CONFIG.courseRounds,
      board: [alley(['EG'])],
      lastCombat: lastCombat({ result: 'win', permaBuffs: [{ sourceUid: 'e', attack: 4, health: 3, engraved: true }] }),
    };
    seed(run);
    useGame.getState().dispatch({ type: 'resolveCombat' });
    const after = useGame.getState().run;
    expect(after.phase).toBe('victory');
    expect(after.combatSettled).toBe(true);

    await sleep(30);
    const m = historyBoard()!.minions[0]!;
    expect([m.attack, m.health]).toEqual([5, 4]);
    expect(m.buffs?.some((b) => b.source === 'Engraved')).toBe(true);
  });

  it('a LOBBY win sends the same post-settle board to the Career row and the Hall of Champions', async () => {
    const base = createLobbyRun(7, 'brackus');
    const lobby = { ...base.lobby!, seats: base.lobby!.seats.map((s) => ({ ...s })) };
    // Only the player and s1 are left standing; s1 has 1 health, so the player's win finishes the lobby.
    for (const s of lobby.seats) if (s.id !== 's0' && s.id !== 's1') { s.alive = false; s.placement = 3; }
    const s1 = lobby.seats.find((s) => s.id === 's1')!;
    s1.resolve = 1; s1.armor = 0;
    const run: RunState = {
      ...base, lobby, phase: 'combat', combatSettled: false,
      board: [alley(['EG'])],
      lastCombat: lastCombat({ result: 'win', playerDamage: 0, enemyDamage: 5, permaBuffs: [{ sourceUid: 'e', attack: 7, health: 7, engraved: true }] }),
    };
    seed(run);
    useGame.getState().dispatch({ type: 'resolveCombat' });
    const after = useGame.getState().run;
    expect(after.phase).toBe('gameover');
    expect(after.lobby?.finished).toBe(true);
    expect(after.lobby?.seats[0]!.placement).toBe(1);
    expect(after.combatSettled).toBe(true);

    await sleep(30);
    expect(vi.mocked(uploadVictory)).toHaveBeenCalledTimes(1);
    const hallBoard = vi.mocked(uploadVictory).mock.calls[0]![0].board;
    const careerBoard = historyBoard();
    expect(hallBoard).toBe(careerBoard); // ONE const feeds every surface
    const m = careerBoard!.minions[0]!;
    expect([m.attack, m.health]).toEqual([8, 8]);
    expect(m.buffs?.some((b) => b.source === 'Engraved' && b.attack === 7)).toBe(true);
    expect(useGame.getState().lastReplay?.result.finalBoard).toBe(careerBoard);
  });
});
