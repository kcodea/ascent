import { describe, expect, it } from 'vitest';
import { simulate, makeRng, type BoardMinion, type MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { deferClashBuffs } from './clashOrder';
import { deferAvengeAfterSummons } from './avengeOrder';
import { computeFrame } from '../useCombatReplay';

/**
 * Integration guard for `deferAvengeAfterSummons`: on REAL fights that trigger Avenge, the reorder must
 *   (a) actually fire (the sim stamped `avenge` events and a summon followed one), and
 *   (b) leave the FINAL folded board byte-identical — the reorder is presentation-only.
 * Uses a Cleave attacker to kill several avenging units at once (the multi-death inversion this fix targets).
 */
const namesOf = (r: ReturnType<typeof simulate>): Map<string, string> => {
  const names = new Map<string, string>();
  for (const m of [...r.initial.player, ...r.initial.enemy] as MinionSnapshot[]) names.set(m.uid, m.name);
  for (const ev of r.events) if (ev.type === 'summon') names.set(ev.minion.uid, ev.minion.name);
  return names;
};

const SCENARIOS: { name: string; player: BoardMinion[]; enemy: BoardMinion[]; seed: number }[] = [
  {
    name: 'Brood Matron Avenge(3) buff + imps vs Cleave',
    player: [
      { cardId: 'brood', attack: 0, health: 300 },
      { cardId: 'impscrap', attack: 1, health: 1 },
      { cardId: 'impscrap', attack: 1, health: 1 },
      { cardId: 'impscrap', attack: 1, health: 1 },
      { cardId: 'impscrap', attack: 1, health: 1 },
    ],
    enemy: [{ cardId: 'babycub', attack: 20, health: 400 }],
    seed: 0x1234,
  },
  {
    name: 'Soulsman Avenge(4) maxGold + Footman Captains vs Cleave',
    player: [
      { cardId: 'soulsman', attack: 0, health: 300 },
      { cardId: 'deathlesshand', attack: 1, health: 1 },
      { cardId: 'deathlesshand', attack: 0, health: 1 },
      { cardId: 'deathlesshand', attack: 0, health: 1 },
      { cardId: 'deathlesshand', attack: 0, health: 1 },
    ],
    enemy: [{ cardId: 'babycub', attack: 20, health: 400 }],
    seed: 0x77,
  },
  {
    // The GUARANTEED inversion: one Imp dies first (Avenge count 1), then a Violet Whelp is the 2nd death.
    // Its Whelp token is an attack-on-summon, so the summon defers to the post-cascade flush — i.e. AFTER
    // Arcane Weaver's Avenge(2) `toHand` fires in the same exchange. The reorder must slide `toHand` past it.
    name: 'Arcane Weaver Avenge(2) toHand + deferred Whelp token',
    player: [
      { cardId: 'impscrap', attack: 1, health: 1 },
      { cardId: 'twilightwhelp', attack: 0, health: 1 },
      { cardId: 'weaver', attack: 0, health: 400 },
    ],
    enemy: [{ cardId: 'babycub', attack: 20, health: 400 }],
    seed: 0x9a,
  },
];

describe('deferAvengeAfterSummons — real-fight fold invariance', () => {
  it('stamps avenge events in the sim (presentation metadata)', () => {
    const r = simulate(SCENARIOS[0]!.player, SCENARIOS[0]!.enemy, makeRng(SCENARIOS[0]!.seed), CARD_INDEX);
    expect(r.events.some((e) => e.avenge)).toBe(true);
  });

  let reorderFired = 0;
  for (const s of SCENARIOS) {
    it(`preserves the final board (fold invariance) — ${s.name}`, () => {
      const r = simulate(s.player, s.enemy, makeRng(s.seed), CARD_INDEX);
      const names = namesOf(r);
      const clash = deferClashBuffs(r.events);
      const reordered = deferAvengeAfterSummons(clash);
      if (reordered !== clash) reorderFired++;
      const before = computeFrame(r.initial, clash, clash.length, clash.length, names);
      const after = computeFrame(r.initial, reordered, reordered.length, reordered.length, names);
      expect(after).toEqual(before); // presentation-only reorder — the final board is untouched
    });
  }

  it('actually reorders at least one real fight (the fix is exercised end-to-end)', () => {
    expect(reorderFired).toBeGreaterThan(0);
  });
});
