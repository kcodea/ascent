import { afterEach, describe, expect, it } from 'vitest';
import type { CombatResult } from '@game/core';
import { activeSet } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { HERO_INDEX, playableHeroes } from '../heroes';
import {
  createRunLobby, driverFor, lobbyOpponentBoard, resetLobbyDrivers, seatScoutIntel, settleRunLobbyRound,
  type RunLobby,
} from './runLobby';

/**
 * SERVING INTEGRITY (owner 2026-10-17, R-LOBBY-08: "we need to make sure snapshots are served on the right turns, this
 * is a core mechanic of our game... we need the game serving integrity to be literally perfect").
 *
 * Seven recorded runs of different SHAPES fill a whole table, and a real lobby is driven round by round through the
 * settle the game uses. At EVERY round, for every standing recorded seat, the board the lobby fights with (the
 * `prepare ?? finalBoard` call the settle, the scout card and the player's foe all make) must be exactly that run's
 * board for that round:
 *
 *  - the recorded wave-N board, the same snapshot (minions, tier, runes, quests, scalers), never another round's;
 *  - an EMPTY recorded round (new recordings, since 2026-10-17) serves that empty board;
 *  - a round BEFORE an old recording begins (its empty round 1 was never uploaded) serves an empty tier-1 board;
 *  - a single missing wave in an old recording serves the previous wave's board (never the next);
 *  - past the run's final round: its FINAL board, verbatim (the stale-final-board ruling, "keep it as is").
 *
 * Health and Armor are the LOBBY's, not the recording's: every recorded seat starts on 30 Resolve + its hero's Armor, and
 * changes by exactly the damage this lobby's encounters charge it (Armor first), also past its final round.
 */

const SET = activeSet().id;
const HEROES = playableHeroes().map((h) => h.id).filter((h) => h !== 'warden');
const LAST_ROUND = 14;

interface Shape { name: string; waves: number[]; empty?: number[] }
/** A board whose every field names its run and wave, so a board served on the wrong round cannot pass. */
const boardOf = (run: number, shape: Shape, wave: number): BoardSnapshot => {
  const empty = shape.empty?.includes(wave) ?? false;
  return {
    v: 1, wave, heroId: HEROES[run]!, resolve: 30 - wave, tier: Math.min(6, 1 + Math.floor((wave - 1) / 2)), triples: wave % 3,
    tribes: [], threat: 'glass', power: empty ? 0 : wave * 10 + run, seed: 9000 + run, origin: 'self', author: shape.name,
    ownerId: `${shape.name}-id`, setId: SET, runes: wave >= 6 ? [`marker-${run}-${wave}`] : [],
    minions: empty ? [] : Array.from({ length: Math.min(7, 1 + Math.floor(wave / 2)) }, (_, i) => ({
      cardId: 'pack', attack: wave * 10 + run, health: 100 + wave * 10 + i, keywords: [], golden: false,
    })),
  } as unknown as BoardSnapshot;
};

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const SHAPES: Shape[] = [
  { name: 'Whole', waves: range(1, 12) },
  { name: 'EmptyFirst', waves: range(1, 12), empty: [1] }, // a Disco Dan recorded since the fix
  { name: 'OldFromTwo', waves: range(2, 12) }, // a Disco Dan recorded before it: wave 1 never uploaded
  { name: 'EmptyMiddle', waves: range(1, 12), empty: [5] }, // sold everything one turn
  { name: 'OldGap', waves: [1, 2, 3, 4, 6, 7, 8, 9, 10] }, // an old recording missing its empty wave 5
  { name: 'EarlyOut', waves: range(1, 4) }, // knocked out in its own round 4
  { name: 'MidOut', waves: range(1, 7) }, // knocked out in its own round 7
];

/** What the run really fielded in this lobby round, by the rules above. */
function expectedFor(run: number, round: number): { wave: number | null; empty: boolean } {
  const shape = SHAPES[run]!;
  const last = Math.max(...shape.waves);
  if (round > last) return { wave: last, empty: shape.empty?.includes(last) ?? false }; // the final board
  const at = [...shape.waves].filter((w) => w <= round).sort((a, b) => b - a)[0];
  if (at === undefined) return { wave: null, empty: true }; // before the recording: empty tier 1
  return { wave: at, empty: shape.empty?.includes(at) ?? false };
}

const draw = { result: 'draw', playerDamage: 0, enemyDamage: 0, events: [], initial: undefined } as unknown as CombatResult;

let lobby: RunLobby | null = null;
afterEach(() => { OPPONENT_POOL.length = 0; if (lobby) resetLobbyDrivers(lobby.seats); lobby = null; });

describe('every recorded seat serves its own round, every round', () => {
  it('board, tier, runes and scalers are the recorded round N; Health and Armor are the lobby\'s own', () => {
    const runs = SHAPES.map((shape, i) => shape.waves.map((w) => boardOf(i, shape, w)));
    const reg = registerOpponentRuns(runs);
    expect(reg).toEqual({ runs: SHAPES.length, boards: runs.flat().length, dropped: 0 });

    lobby = createRunLobby(20261017, 'warden', {}, SET);
    const recorded = lobby.seats.filter((s) => s.kind === 'snapshot');
    expect(recorded.map((s) => s.label).sort()).toEqual(SHAPES.map((s) => s.name).sort()); // the whole table is recorded
    // Health 30; Armor is the seat's OWN hero's (R-LOBBY-SEAT-ARMOR-01, owner 2026-10-17: "use the hero's own armor instead of 15").
    for (const s of recorded) { expect(s.resolve).toBe(30); expect(s.armor).toBe(HERO_INDEX[s.heroId]!.armor); }
    const runOf = (label: string): number => SHAPES.findIndex((s) => s.name === label);

    let checked = 0;
    let pastFinal = 0;
    for (let round = 1; round <= LAST_ROUND && !lobby.finished; round++) {
      expect(lobby.round).toBe(round);
      for (const seat of lobby.seats) {
        if (seat.kind !== 'snapshot' || !seat.alive) continue;
        const run = runOf(seat.label);
        const want = expectedFor(run, round);
        const d = driverFor(seat, SET)!;
        const served = d.prepare(round) ?? d.finalBoard?.() ?? null;
        const where = `${seat.label} round ${round}`;
        expect(served, where).not.toBeNull();
        if (want.wave === null) {
          expect(served!.minions, where).toEqual([]);
          expect(served!.tier, where).toBe(1);
          expect(served!.snapshot, where).toBeUndefined();
        } else {
          const rec = boardOf(run, SHAPES[run]!, want.wave);
          expect(served!.snapshot, where).toEqual(rec); // the whole recorded round: tier, runes, triples, scalers
          expect(served!.tier, where).toBe(rec.tier);
          expect(served!.minions, where).toEqual(rec.minions);
          expect(served!.minions.length === 0, where).toBe(want.empty);
          if (round > Math.max(...SHAPES[run]!.waves)) pastFinal++;
        }
        // The scout card reads the same board.
        expect(seatScoutIntel(lobby, seat)?.tier, where).toBe(served!.tier);
        checked++;
      }
      // The player's foe is served the same board.
      const foe = lobbyOpponentBoard(lobby);
      if (foe && foe.seat.alive && foe.seat.kind === 'snapshot') {
        const want = expectedFor(runOf(foe.seat.label), round);
        if (want.wave === null) expect(foe.minions).toEqual([]);
        else expect(foe.snapshot?.wave).toBe(want.wave);
      }

      // Settle the round; every seat's Health + Armor moves by exactly what this round's encounters charged it.
      const before = new Map(lobby.seats.map((s) => [s.id, { resolve: s.resolve, armor: s.armor }]));
      const seen = lobby.encounters.length;
      lobby = settleRunLobbyRound(lobby, draw);
      const charged = new Map<string, number>();
      for (const e of lobby.encounters.slice(seen)) {
        charged.set(e.a, (charged.get(e.a) ?? 0) + e.damageToA);
        charged.set(e.b, (charged.get(e.b) ?? 0) + e.damageToB);
      }
      for (const s of lobby.seats) {
        const b = before.get(s.id)!;
        const dmg = charged.get(s.id) ?? 0;
        const armor = Math.max(0, b.armor - dmg);
        const resolve = b.resolve - Math.max(0, dmg - b.armor);
        expect({ armor: s.armor, resolve: s.resolve }, `${s.label} round ${round} health`).toEqual({ armor, resolve });
      }
    }
    expect(checked).toBeGreaterThan(40); // the loop really walked the rounds
    expect(pastFinal).toBeGreaterThan(0); // and some seat outlived its own run
  });
});
