import { describe, expect, it } from 'vitest';
import { fuzzCombatBoard, fuzzCombatSide, makeRng, simulate, type CombatEvent, type FuzzPool } from '@game/core';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { replayBeats } from './replayOrder';
import { buildBeats } from '../combatBeats';

/**
 * R-COMBAT-GOLD-EVENT-01: `bonusGold` is a SILENT RIDER. It ticks the Gold pill's forecast and nothing else, so a fight's
 * beats are exactly what they would be without it: the same count, the same primaries, the same moment kinds. Swept
 * over random fights with random combat mods (the ones that bank Gold included).
 */
const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const shape = (ms: { primary: CombatEvent; kind?: string }[]): string[] => ms.map((m) => `${m.primary.type}:${m.kind ?? ''}`);

describe('Gold banked for next turn never forms or splits a beat', () => {
  for (const set of ['set1', 'set2', 'set3'] as SetId[]) {
    it(`${set}: the beats with and without the bonusGold events match`, () => {
      let withGold = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const r = makeRng(seed * 31 + set.length);
        const A = fuzzCombatBoard(r, fp(set), 'A');
        const B = fuzzCombatBoard(r, fp(set), 'B');
        const res = simulate(clone(A), clone(B), makeRng(seed), CARD_INDEX, fuzzCombatSide(r, fp(set), 'A', A), fuzzCombatSide(r, fp(set), 'B', B));
        if (!res.events.some((e) => e.type === 'bonusGold')) continue;
        withGold++;
        const without = res.events.filter((e) => e.type !== 'bonusGold');
        expect(shape(replayBeats(res.events)), `${set} seed ${seed}`).toEqual(shape(replayBeats(without)));
        expect(buildBeats(res.events).length, `${set} seed ${seed} (oracle)`).toBe(buildBeats(without).length);
      }
      expect(withGold, 'the sweep reaches fights that bank Gold').toBeGreaterThan(0);
    });
  }
});
