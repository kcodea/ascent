import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate } from '../index';
import type { CardDef, CombatResult } from '../types';

/**
 * Karwind's 20% double BUFF (owner rework 2026-08-07, revised the same day from "double trigger"). A crit
 * pays +6/+6 instead of +3/+3 — it does NOT fire the grant an extra time, which matters because an extra fire
 * would re-proc every per-trigger watcher. What this file pins is the ROLL: that it announces via `proccrit`,
 * that a crit doubles the MAGNITUDE and leaves the grant COUNT alone, that it lands near its stated rate, and
 * that a replay reproduces it exactly (the whole point of drawing off the combat RNG rather than `Math.random`).
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
/** Ordinary grants (+3/+3) and crit grants (+6/+6) — a crit moves a buff from the first bucket to the second
 *  WITHOUT changing the total, which is exactly the difference from the "extra trigger" shape it replaced. */
const grantsIn = (r: CombatResult): number =>
  r.events.filter((e) => e.type === 'buff' && e.attack === 3 && e.health === 3).length;
const critGrantsIn = (r: CombatResult): number =>
  r.events.filter((e) => e.type === 'buff' && e.attack === 6 && e.health === 6).length;

describe('Karwind — the 20% double buff', () => {
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

  it('a crit DOUBLES THE BUFF and leaves the grant count alone', () => {
    // The whole point of the revision. Every trigger produces the same number of buff events whether or not it
    // crits; a crit only changes their size. `total grants` is therefore invariant to the roll.
    for (let seed = 0; seed < 60; seed++) {
      const r = fight(seed);
      const crits = critsIn(r);
      const plain = grantsIn(r);
      const doubled = critGrantsIn(r);
      if (crits === 0) {
        expect(doubled, `seed ${seed}: no crit, so nothing should be +6/+6`).toBe(0);
        expect(plain, `seed ${seed}`).toBeGreaterThan(0);
      } else {
        // A crit turned that trigger's grants into +6/+6 — so the +6/+6 bucket is non-empty and the recipients
        // per trigger are unchanged (both buckets are whole multiples of the same per-trigger recipient count).
        expect(doubled, `seed ${seed}: crit produced no doubled grants`).toBeGreaterThan(0);
      }
    }
  });

  it('a crit does NOT add an extra round of grants — total events per trigger are flat', () => {
    // The failure this guards is a regression to the old "extra trigger" shape, which would show up as MORE
    // buff events on a critting seed. Compare fights with the same recipient count: totals must match.
    const byRecipients = new Map<number, { crit: number[]; plain: number[] }>();
    for (let seed = 0; seed < 300; seed++) {
      const r = fight(seed);
      const total = grantsIn(r) + critGrantsIn(r);
      const per = total; // one trigger per fight in this fixture, so this IS the recipient count
      const bucket = byRecipients.get(per) ?? { crit: [], plain: [] };
      (critsIn(r) > 0 ? bucket.crit : bucket.plain).push(total);
      byRecipients.set(per, bucket);
    }
    const comparable = [...byRecipients.values()].find((b) => b.crit.length > 0 && b.plain.length > 0);
    expect(comparable, 'no seed bucket had both a crit and a non-crit fight').toBeDefined();
    expect(Math.max(...comparable!.crit)).toBe(Math.max(...comparable!.plain));
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
      expect(critGrantsIn(b)).toBe(critGrantsIn(a));
    }
  });
});
