import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate } from '../index';
import type { CardDef, CombatResult } from '../types';

/**
 * Karwind's 20% double-trigger (owner rework 2026-08-07). The magnitude is asserted by the Karwind tests in
 * `simulate.test.ts`; what this file pins is the ROLL itself — that it announces via `proccrit`, that a crit
 * really does pay twice, that it lands near its stated rate, and that a replay reproduces it exactly (the
 * whole point of drawing off the combat RNG rather than `Math.random`).
 */

/** A board where a Start-of-Combat sovereign re-triggers a Dragon Shout, so Karwind procs without attacking. */
const shouter: CardDef = { id: 'kctest_shout', name: 'SH', tribe: 'dragon', tier: 3, attack: 2, health: 40, keywords: [],
  effects: [{ on: 'onPlay', do: 'battlecrySummon', params: { tokenId: 'whelpling', count: 1 } }], text: '' };
const sovereign: CardDef = { id: 'kctest_sov', name: 'SOV', tribe: 'dragon', tier: 6, attack: 8, health: 40, keywords: ['SC'],
  effects: [{ on: 'startOfCombat', do: 'scTriggerTribeShouts', params: { tribe: 'dragon' } }], text: '' };

function fight(seed: number): CombatResult {
  return simulate(
    [
      { cardId: 'kctest_sov', attack: 8, health: 40, sourceUid: 'SOV' },
      { cardId: 'kctest_shout', attack: 2, health: 40, sourceUid: 'SH' },
      { cardId: 'karwind', attack: 4, health: 60, sourceUid: 'KW' },
    ],
    [{ cardId: 'sandbag', attack: 0, health: 4000 }],
    makeRng(seed),
    { ...CARD_INDEX, kctest_shout: shouter, kctest_sov: sovereign },
    combatSide({ tier: 6, tribes: ['dragon'] }),
    combatSide({ tier: 1 }),
  );
}

const critsIn = (r: CombatResult): number => r.events.filter((e) => e.type === 'proccrit').length;
const grantsIn = (r: CombatResult): number =>
  r.events.filter((e) => e.type === 'buff' && e.attack === 3 && e.health === 3).length;

describe('Karwind — the 20% double trigger', () => {
  it('announces every crit as a proccrit event naming Karwind, at 2x', () => {
    // Sweep enough seeds to be sure at least one crit lands (P(no crit in 200 fights) is vanishing).
    const withCrit = Array.from({ length: 200 }, (_, i) => fight(i)).find((r) => critsIn(r) > 0);
    expect(withCrit, 'no crit in 200 fights — the roll is not firing').toBeDefined();
    const ev = withCrit!.events.find((e) => e.type === 'proccrit') as { source: string; mult: number };
    // Combat uids are positional (`m0`, `m1`, …), not the recruit-side sourceUid — resolve Karwind's.
    const karwindUid = withCrit!.initial.player.find((m) => m.cardId === 'karwind')!.uid;
    expect(ev.source).toBe(karwindUid); // the proccing minion, not its targets
    expect(ev.mult).toBe(2);
  });

  it('a crit really pays twice — the grant count tracks the crit count', () => {
    // How MANY Dragons collect per repetition is not fixed (the shouter summons a Whelpling, itself a Dragon,
    // and whether it has landed varies), so assert the RATIO: total grants must divide evenly by the number of
    // repetitions, 1 + crits. A crit that failed to repeat, or repeated the wrong number of times, breaks this.
    for (let seed = 0; seed < 60; seed++) {
      const r = fight(seed);
      const reps = 1 + critsIn(r);
      const grants = grantsIn(r);
      expect(grants % reps, `seed ${seed}: ${grants} grants over ${reps} reps`).toBe(0);
      expect(grants / reps, `seed ${seed}: recipients per repetition`).toBeGreaterThanOrEqual(2);
    }
  });

  it('a crit strictly increases the number of grants over an identical non-crit fight', () => {
    // The ratio test above would pass a crit that quietly did nothing (reps would just be wrong for everyone).
    // This pins the direction: for a fixed recipient count, a critting seed pays more than a non-critting one.
    const byRecipients = new Map<number, { crit: number[]; plain: number[] }>();
    for (let seed = 0; seed < 300; seed++) {
      const r = fight(seed);
      const reps = 1 + critsIn(r);
      const per = grantsIn(r) / reps;
      const bucket = byRecipients.get(per) ?? { crit: [], plain: [] };
      (critsIn(r) > 0 ? bucket.crit : bucket.plain).push(grantsIn(r));
      byRecipients.set(per, bucket);
    }
    const comparable = [...byRecipients.values()].find((b) => b.crit.length > 0 && b.plain.length > 0);
    expect(comparable, 'no seed bucket had both a crit and a non-crit fight').toBeDefined();
    expect(Math.min(...comparable!.crit)).toBeGreaterThan(Math.max(...comparable!.plain));
  });

  it('lands near 20% over a wide seed sweep', () => {
    const N = 600;
    const crits = Array.from({ length: N }, (_, i) => fight(i)).filter((r) => critsIn(r) > 0).length;
    // One roll per fight, so this is a straight binomial: sigma ~= sqrt(0.2*0.8/600) ~= 1.6pp. A +/-6pp band
    // is ~4 sigma — wide enough never to flake, tight enough to catch a rate that is wrong (or always-on).
    expect(crits / N).toBeGreaterThan(0.14);
    expect(crits / N).toBeLessThan(0.26);
  });

  it('is REPLAY-STABLE — the same seed crits on exactly the same triggers', () => {
    for (const seed of [3, 17, 42, 101]) {
      const a = fight(seed);
      const b = fight(seed);
      expect(critsIn(b)).toBe(critsIn(a));
      expect(grantsIn(b)).toBe(grantsIn(a));
    }
  });
});
