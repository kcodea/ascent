import { describe, expect, it } from 'vitest';
import { COSMETIC_RARITIES } from '@game/progression';
import {
  TEASE_FIRST_FRAMES, TEASE_STEP_FRAMES, teaseAt, teaseFrames, teaseGlowAlpha, teaseGlowFade, teasePop, teaseRarityAt, teaseStages, teaseWobble,
  type TeaseAt,
} from './packTease';

describe('the rarity tease', () => {
  it('climbs one colour per rarity step: Common 1 ... Ancient 5, and each step costs one more beat', () => {
    expect(COSMETIC_RARITIES.map(teaseStages)).toEqual([1, 2, 3, 4, 5]);
    expect(teaseFrames('common', 1)).toBe(TEASE_FIRST_FRAMES);
    expect(teaseFrames('ancient', 1)).toBe(TEASE_FIRST_FRAMES + 4 * TEASE_STEP_FRAMES);
    for (let i = 1; i < COSMETIC_RARITIES.length; i++) {
      expect(teaseFrames(COSMETIC_RARITIES[i]!, 1) - teaseFrames(COSMETIC_RARITIES[i - 1]!, 1)).toBe(TEASE_STEP_FRAMES);
    }
  });

  it('the knob scales the length, 0 turns it off, and a bad value reads as 1', () => {
    expect(teaseFrames('epic', 2)).toBe(2 * teaseFrames('epic', 1));
    expect(teaseFrames('ancient', 0)).toBe(0);
    expect(teaseFrames('ancient', -3)).toBe(0);
    expect(teaseFrames('rare', Number.NaN)).toBe(teaseFrames('rare', 1));
  });

  it('walks the ladder in order and never past the card\'s own rarity', () => {
    const out: TeaseAt = { stage: 0, k: 0 };
    for (const r of COSMETIC_RARITIES) {
      const seen: number[] = [];
      const dur = teaseFrames(r, 1);
      for (let t = 0; t <= dur + 20; t += 0.5) {
        const s = teaseAt(r, t, 1, out).stage;
        if (seen[seen.length - 1] !== s) seen.push(s);
        expect(out.k).toBeGreaterThanOrEqual(0);
        expect(out.k).toBeLessThanOrEqual(1);
      }
      expect(seen, r).toEqual(Array.from({ length: teaseStages(r) }, (_, i) => i));
      expect(teaseRarityAt(seen[seen.length - 1]!)).toBe(r); // it ends on the card's own colour
    }
    expect(teaseAt('legendary', -5, 1, out)).toEqual({ stage: 0, k: 0 });
  });

  it('each step up glows brighter, pops harder and wobbles more; Common does not wobble', () => {
    for (let s = 1; s < 5; s++) {
      expect(teaseGlowAlpha(s, 1)).toBeGreaterThanOrEqual(teaseGlowAlpha(s - 1, 1));
      expect(teasePop(s, 0)).toBeGreaterThan(teasePop(s - 1, 0));
      expect(teaseWobble(s)).toBeGreaterThan(teaseWobble(s - 1));
    }
    expect(teaseWobble(0)).toBe(0);
    expect(teasePop(3, 1)).toBe(0); // the pop settles by the end of the step
    expect(teaseGlowAlpha(4, 1)).toBeLessThanOrEqual(1);
    expect(teaseGlowAlpha(2, 1)).toBeGreaterThan(teaseGlowAlpha(2, 0)); // it swells through the step
  });

  it('the glow fades out as the card turns: from where the tease left it to nothing at the edge', () => {
    expect(teaseGlowFade(0.8, 0)).toBe(0.8);
    expect(teaseGlowFade(0.8, 1)).toBe(0);
    expect(teaseGlowFade(0.8, 3)).toBe(0);
    expect(teaseGlowFade(0.8, -1)).toBe(0.8);
    let prev = teaseGlowFade(0.8, 0);
    for (let p = 0.1; p <= 1.0001; p += 0.1) {
      const a = teaseGlowFade(0.8, p);
      expect(a).toBeLessThan(prev);
      prev = a;
    }
  });
});
