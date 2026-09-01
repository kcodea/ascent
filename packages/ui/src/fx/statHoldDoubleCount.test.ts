import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimOrHold, heldFor, holdStat, releaseAllStats, replaceHold } from './statHold';

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
 * change produce a doubled withholding — the fact the fix has to remove.
 *
 * ── The fix, and why it is on BOTH sides ──────────────────────────────────────────────────────────────────
 *
 * Neither placer can assume it runs first, so each was taught not to double:
 *
 *   · the Ruby cue CLAIMS a live hold (`claimStat`) instead of adding to it — the owner changes, the delta
 *     does not;
 *   · the replay RELEASES a foreign hold before placing, because its own delta is the authoritative one (the
 *     whole beat, with same-beat damage netted into Health).
 *
 * Whichever order they run in, exactly one hold survives and it carries the beat's true total. The last two
 * cases below are that contract.
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

  it('THE FIX, replay first: the Ruby cue CLAIMS instead of adding', () => {
    // The replay already holds this beat's whole delta; the Ruby cue arrives second and must take it over
    // rather than withhold the same Ruby again.
    holdStat('m4', { attack: 2, health: 2 }, { origin: 'effect' });
    claimOrHold('m4', { attack: 2, health: 2 });
    expect(heldFor('m4'), 'still one Ruby withheld, not two').toEqual({ attack: 2, health: 2 });
  });

  it('THE FIX, cue first: the replay REPLACES with the authoritative beat total', () => {
    // The other order. The replay's delta is the whole beat — here the same Ruby with 1 damage netted into
    // Health, which the per-Ruby cue could not have known.
    claimOrHold('m5', { attack: 2, health: 2 });                       // the cue, nothing live yet
    replaceHold('m5', { attack: 2, health: 1 }, { origin: 'effect' }); // the replay
    expect(heldFor('m5'), 'the beat total, once').toEqual({ attack: 2, health: 1 });
  });

  it('claimOrHold still PLACES when nothing is live — a Ruby with no replay hold behind it', () => {
    claimOrHold('m6', { attack: 3, health: 3 });
    expect(heldFor('m6')).toEqual({ attack: 3, health: 3 });
  });

  it('a lower-ranked placer stands down instead of stacking (the guard that DOES work)', () => {
    // Card's intrinsic hold is rank 1 and correctly refuses to add to a live effect hold. The Ruby case is
    // only reachable because both of its placers are rank 3.
    holdStat('m3', { attack: 2, health: 2 }, { origin: 'effect' });
    holdStat('m3', { attack: 2, health: 2 }, { origin: 'intrinsic' });
    expect(heldFor('m3'), 'intrinsic stood down').toEqual({ attack: 2, health: 2 });
  });
});

/**
 * …AND THE TWO CALL SITES ACTUALLY USE THEM.
 *
 * The store-level cases above prove the rules work; this proves they are reached. The bug was never in a
 * function — every part was correct — it was two sites placing holds for one change, so what has to be
 * pinned is which helper each site calls. A future edit that reaches for plain `holdStat` at either of them
 * puts the doubling straight back.
 */
describe('the combat placers use the non-doubling rules', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

  it('the Ruby cue claims rather than places blindly', () => {
    const score = read('../choreo/score.ts');
    // Anchored on the LOOP, not on the call, so a regression fails with "must claim, not stack" rather than
    // with "the loop is missing" — a different and much more confusing message.
    const line = score.split(String.fromCharCode(10)).find((l) => l.includes('of rubyLands)'));
    expect(line, 'the Ruby-lands loop still exists').toBeTruthy();
    expect(line!.includes('claimOrHold'), `the Ruby loop must claim, not stack: ${line}`).toBe(true);
  });

  it('the replay replaces rather than accumulating onto a foreign hold', () => {
    const replay = read('../useCombatReplay.ts');
    // The beat's buff-delta placement, identified by the netted Health it is the only site to compute.
    const i = replay.indexOf('const netHealth = d.health');
    expect(i, 'the beat place-pass still exists').toBeGreaterThan(-1);
    const stmt = replay.slice(i, replay.indexOf('});', i));
    expect(stmt.includes('replaceHold'), 'the beat total must replace any live hold').toBe(true);
    expect(/\bholdStat\(d\.uid/.test(stmt), 'and must not place with the accumulating primitive').toBe(false);
  });
});
