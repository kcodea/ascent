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
  const dmg = (target: string): CombatEvent => ({ type: 'dmg', target, amount: 1 }) as CombatEvent;
  const other = (): CombatEvent => ({ type: 'sc', source: 'a', text: 'x' }) as CombatEvent;

  it('collects the units damaged inside the window, in order', () => {
    const events = [other(), dmg('u1'), dmg('u2'), other()];
    expect(damagedUidsIn(events, 0, events.length)).toEqual(['u1', 'u2']);
  });

  // One moment can carry two hits on the same unit; firing the same travelling effect twice at one card
  // reads as a stutter rather than as two hits.
  it('de-duplicates repeated targets', () => {
    const events = [dmg('u1'), dmg('u1'), dmg('u2')];
    expect(damagedUidsIn(events, 0, events.length)).toEqual(['u1', 'u2']);
  });

  it('respects the window bounds', () => {
    const events = [dmg('before'), dmg('inside'), dmg('after')];
    expect(damagedUidsIn(events, 1, 2)).toEqual(['inside']);
  });

  it('is empty when nothing was damaged', () => {
    expect(damagedUidsIn([other(), other()], 0, 2)).toEqual([]);
  });
});
