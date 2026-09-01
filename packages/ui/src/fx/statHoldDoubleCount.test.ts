import { describe, expect, it, beforeEach } from 'vitest';
import { heldFor, holdStat, releaseAllStats } from './statHold';

/**
 * THE DOUBLE-WITHHELD RUBY (owner report 2026-08-31).
 *
 * *"the stats dance around a lot in combat, setting to randomly low values / the badges go red, then they
 * correct to proper values."*
 *
 * A hold is a DELTA SUBTRACTED from the live value — the badge prints `current - held`. So two holds for ONE
 * change withhold it twice, and the badge prints a number the unit never had: below its own floor, which is
 * what turns the plate red, until the rolls or the TTL catch up.
 *
 * That is reachable today because a Ruby landing in combat is held from TWO places, both at `effect` rank:
 *
 *   · `useCombatReplay.ts` places one hold per unit for the WHOLE beat's buff delta — Rubies included;
 *   · `choreo/score.ts` places one for each Ruby land, so the gem's own effect can deliver the number.
 *
 * `holdStat` accumulates equal-rank holds, by design — "two of those really are two changes". Here they are
 * the same change. The replay's own comment already names this hazard ("`holdStat` ACCUMULATES same-origin
 * deltas onto a live hold rather than replacing them, double-counting one beat's buff") and guards it by
 * releasing the holds IT placed at the top of each beat — which cannot see the ones the choreographer placed.
 *
 * This lane pins the STORE behaviour that makes it possible. It is deliberately not a test of either call
 * site: the accumulate rule is correct and must stay, so what needs pinning is that two placements for one
 * change produce a doubled withholding — the fact any fix has to remove.
 */
describe('statHold — two holds for one change withhold it twice', () => {
  beforeEach(() => { releaseAllStats(); });

  it('accumulates equal-rank holds, so a Ruby held twice reads as double', () => {
    // The replay's beat pass: this unit gained +2/+2 this beat.
    holdStat('m0', { attack: 2, health: 2 }, { origin: 'effect' });
    // The Ruby cue, for the SAME +2/+2 — `score.ts` passes no origin, and the default is `effect`.
    holdStat('m0', { attack: 2, health: 2 });
    expect(heldFor('m0'), 'the same change is withheld twice').toEqual({ attack: 4, health: 4 });
  });

  it('…which prints a number the unit never had, below its floor', () => {
    // A 5/5 that just became 7/7. Held twice, the badge computes `current - held` = 3/3 — two points BELOW
    // where it started, which is what reads as "randomly low" and paints the plate red.
    const current = { attack: 7, health: 7 };
    holdStat('m1', { attack: 2, health: 2 }, { origin: 'effect' });
    holdStat('m1', { attack: 2, health: 2 });
    const held = heldFor('m1')!;
    const shown = { attack: current.attack - held.attack, health: current.health - held.health };
    expect(shown, 'the badge prints below the pre-buff 5/5').toEqual({ attack: 3, health: 3 });
  });

  it('a SINGLE hold is correct — the pre-buff value, exactly', () => {
    // The contract the double breaks: one hold shows where the unit was before the change, never less.
    holdStat('m2', { attack: 2, health: 2 }, { origin: 'effect' });
    const held = heldFor('m2')!;
    expect({ attack: 7 - held.attack, health: 7 - held.health }).toEqual({ attack: 5, health: 5 });
  });

  it('a lower-ranked placer stands down instead of stacking (the guard that DOES work)', () => {
    // Card's intrinsic hold is rank 1 and correctly refuses to add to a live effect hold. The Ruby case is
    // only reachable because both of its placers are rank 3.
    holdStat('m3', { attack: 2, health: 2 }, { origin: 'effect' });
    holdStat('m3', { attack: 2, health: 2 }, { origin: 'intrinsic' });
    expect(heldFor('m3'), 'intrinsic stood down').toEqual({ attack: 2, health: 2 });
  });
});
