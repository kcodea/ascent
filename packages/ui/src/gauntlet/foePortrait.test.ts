/**
 * GAUNTLET FOE PORTRAIT helper — a stage's `portraitCardId` resolves to that card's art; a stage without one (or an
 * unknown stage) falls back to the tribe emblem, so `art` is absent and `tribe` carries the fallback glyph.
 */
import { describe, expect, it } from 'vitest';
import { gauntletStage } from '@game/content';
import { artFor } from '../art';
import { foePortrait } from './foePortrait';

describe('foePortrait', () => {
  it('Demons wear Grobbus: the portrait card art, plus the tribe as the fallback', () => {
    expect(gauntletStage(1)?.portraitCardId).toBe('dm_grobbus');
    const face = foePortrait(1);
    expect(face.art).toBeTruthy();
    expect(face.art).toBe(artFor('dm_grobbus'));
    expect(face.tribe).toBe('demon');
  });

  it('a stage with no portrait card has no art and keeps its tribe emblem', () => {
    const stage = gauntletStage(2)!;
    expect(stage.portraitCardId).toBeUndefined();
    expect(foePortrait(2)).toEqual({ art: undefined, tribe: stage.tribe });
  });

  it('an unknown or absent stage is all-empty (the anvil emblem)', () => {
    expect(foePortrait(99)).toEqual({ art: undefined, tribe: undefined });
    expect(foePortrait(undefined)).toEqual({ art: undefined, tribe: undefined });
    expect(foePortrait(null)).toEqual({ art: undefined, tribe: undefined });
  });
});
