import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { CARD_FX, cardFxFor, damagedUidsIn } from './cardFx';
import { SCORE_DEFAULTS } from './score';

/**
 * Per-card FX binding. The `fxDef` channel keys on the moment KIND, which cannot express "this card's effect
 * looks like this" — Bloodbinder's bleed and every other spell cast share `scCast`.
 */
describe('cardFxFor', () => {
  it('finds a binding by card and kind', () => {
    expect(cardFxFor('bloodbinder', 'scCast')?.def).toBe('ember-lance');
  });

  it('is null for the same card at a different kind, and for an unbound card', () => {
    expect(cardFxFor('bloodbinder', 'damage')).toBeNull();
    expect(cardFxFor('somethingelse', 'scCast')).toBeNull();
  });

  // No unit on screen => no card => the kind's own default is used, never a crash.
  it('is null for a null card id', () => {
    expect(cardFxFor(null, 'scCast')).toBeNull();
  });

  // A per-card override that names a kind carrying no fxDef cue would never run: the runner only consults
  // this table from inside the fxDef branch.
  it('only binds kinds that actually carry an fxDef cue', () => {
    for (const [cardId, byKind] of Object.entries(CARD_FX)) {
      for (const kind of Object.keys(byKind)) {
        const cues = SCORE_DEFAULTS[kind as keyof typeof SCORE_DEFAULTS];
        expect(cues.some((c) => c.ch === 'fxDef'), `${cardId} → ${kind}`).toBe(true);
      }
    }
  });
});

describe('damagedUidsIn', () => {
  const dmg = (target: string, step?: number): CombatEvent => ({ type: 'dmg', target, amount: 1, step }) as CombatEvent;
  const cast = (step?: number): CombatEvent => ({ type: 'sc', source: 'a', text: 'bleeds', cast: true, step }) as CombatEvent;

  /**
   * THE bug this function's rewrite fixes. `dmg` is a RESULT type, so damage collapses into its OWN moment,
   * separate from the `scCast` moment the cast lands in — searching the cast's moment bounds found nothing
   * and the authored effect silently never played (owner: "why do i see the old projectiles?"). The sim tags
   * both with one resolution STEP, which is what actually ties a cast to what it hit.
   */
  it('reaches damage in the same STEP but OUTSIDE the moment bounds', () => {
    const events = [cast(7), dmg('u1', 7), dmg('u2', 7)];
    // The scCast moment is just the cast itself: end = 1. The damage is a separate moment entirely.
    expect(damagedUidsIn(events, 0, 1)).toEqual(['u1', 'u2']);
  });

  it('stops at the step boundary, so a later beat cannot leak in', () => {
    const events = [cast(7), dmg('u1', 7), dmg('later', 8)];
    expect(damagedUidsIn(events, 0, 1)).toEqual(['u1']);
  });

  it('collects in order', () => {
    const events = [cast(1), dmg('u1', 1), dmg('u2', 1)];
    expect(damagedUidsIn(events, 0, 1)).toEqual(['u1', 'u2']);
  });

  // One step can carry two hits on the same unit; firing the same travelling effect twice at one card
  // reads as a stutter rather than as two hits.
  it('de-duplicates repeated targets', () => {
    const events = [cast(1), dmg('u1', 1), dmg('u1', 1), dmg('u2', 1)];
    expect(damagedUidsIn(events, 0, 1)).toEqual(['u1', 'u2']);
  });

  // Legacy saved replays and synthetic fixtures carry no step tag, so there is no step to share.
  it('falls back to the moment bounds for UNTAGGED events', () => {
    const events = [cast(), dmg('u1'), dmg('u2')];
    expect(damagedUidsIn(events, 0, 3)).toEqual(['u1', 'u2']);
    expect(damagedUidsIn(events, 0, 2)).toEqual(['u1']);
  });

  it('is empty when nothing was damaged', () => {
    expect(damagedUidsIn([cast(1), cast(1)], 0, 2)).toEqual([]);
  });
});
