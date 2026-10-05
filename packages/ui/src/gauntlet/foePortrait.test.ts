/**
 * GAUNTLET FOE PORTRAIT helper — a stage's `portraitCardId` resolves to that card's art; a stage without one (or an
 * unknown stage) falls back to the tribe emblem, so `art` is absent and `tribe` carries the fallback glyph.
 */
import { describe, expect, it, vi } from 'vitest';
import { gauntletStage } from '@game/content';
import { artFor } from '../art';
import { foePortrait } from './foePortrait';

/** Stage 1 wears a portrait card and stage 2 has none, regardless of what the shipped stage files carry (the test owns its fixture). */
vi.mock('@game/content', async (importOriginal) => {
  const m = await importOriginal<typeof import('@game/content')>();
  return {
    ...m,
    gauntletStage: (n: number) => {
      const s = m.gauntletStage(n);
      if (n === 1) return { ...s!, portraitCardId: 'dm_grobbus' };
      if (n === 2) return { ...s!, portraitCardId: undefined }; // stage 2 has no portrait card -> tribe-emblem fallback
      return s;
    },
  };
});

describe('foePortrait', () => {
  it("a stage with a portrait card wears that card's art, plus the tribe as the fallback", () => {
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
