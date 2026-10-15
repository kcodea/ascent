/**
 * VERSUS PERSPECTIVE = THE SWAPPED NATIVE FIGHT (live playtest 2026-10-14: "combat is still just 'off' on the 'player
 * 2' board"). Combat is 1:1 symmetric (R-SYMMETRY-01), so the p2 seat's view of the one fight F = simulate(A, B,
 * { firstSide: X }) must be EXACTLY the fight p2 would have seen from simulate's player chair:
 * simulate(B, A, { firstSide: flip(X) }). Same outcome, damages, breakdowns, starting boards, every event (uids,
 * slots, sides, step tags) and carry-backs. Then the replay, the lunges, the beat schedule and every FX anchor are
 * the ordinary lobby path, with no Versus special case. Over random board pairs and run contexts from every set.
 * (Not compared: `enemyScalers`, which the
 * mirror cannot rebuild for the other seat without its run state.)
 */
import { describe, expect, it } from 'vitest';
import { fuzzCombatBoard, fuzzCombatSide, makeRng, simulate, type CombatResult, type FuzzPool } from '@game/core';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { mirrorForEnemySeat } from './mirror';

const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const neutral = (s: string): string => s; // the narration is reworded for the seat too: compared verbatim
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const strip = (r: CombatResult): Record<string, unknown> => {
  const o = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
  for (const k of ['events', 'enemyCarry', 'enemyScalers', 'oddsInput', 'sidesMirrored']) delete o[k];
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
};

describe('the p2 perspective is the swapped native fight', () => {
  for (const set of ['set1', 'set2', 'set3'] as SetId[]) {
    it(`${set}: 150 random pairs, both chairs`, () => {
      let events = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const r = makeRng(seed * 104729 + set.charCodeAt(3));
        const A = fuzzCombatBoard(r, fp(set), 'A'), B = fuzzCombatBoard(r, fp(set), 'B');
        const sA = fuzzCombatSide(r, fp(set), 'A', A), sB = fuzzCombatSide(r, fp(set), 'B', B);
        const X = seed % 2 ? 'player' as const : 'enemy' as const;
        const F = simulate(clone(A), clone(B), makeRng(seed), CARD_INDEX, clone(sA), clone(sB), { firstSide: X });
        const native = simulate(clone(B), clone(A), makeRng(seed), CARD_INDEX, clone(sB), clone(sA), { firstSide: X === 'player' ? 'enemy' : 'player' });
        const p2 = mirrorForEnemySeat(F);
        const ctx = `${set} seed ${seed}`;
        expect(neutral(JSON.stringify(p2.events)), `${ctx}: events`).toBe(neutral(JSON.stringify(native.events)));
        expect(strip(p2), `${ctx}: result, damages, boards, carry-backs`).toEqual(strip(native));
        events += F.events.length;
      }
      expect(events).toBeGreaterThan(500);
    });
  }
});
