import { describe, expect, it } from 'vitest';
import { DEFAULT_PACK_FEEL, PACK_BASE_SIZE } from './packFxConfig';
import { scaleFeelPx, topBackVisible } from './packScene';

describe('packScene: scaleFeelPx', () => {
  it('a pack twice the base width doubles the three px knobs and leaves the rest', () => {
    const out = scaleFeelPx(DEFAULT_PACK_FEEL, PACK_BASE_SIZE.w * 2);
    expect(out.maxTearSpeed).toBe(DEFAULT_PACK_FEEL.maxTearSpeed * 2);
    expect(out.sleeveGrip).toBe(DEFAULT_PACK_FEEL.sleeveGrip * 2);
    expect(out.sleeveLetGo).toBe(DEFAULT_PACK_FEEL.sleeveLetGo * 2);
    for (const k of Object.keys(DEFAULT_PACK_FEEL) as (keyof typeof DEFAULT_PACK_FEEL)[]) {
      if (k === 'maxTearSpeed' || k === 'sleeveGrip' || k === 'sleeveLetGo') continue;
      expect(out[k], k).toBe(DEFAULT_PACK_FEEL[k]);
    }
  });

  it('at the base width it is the same values, and it never mutates its input', () => {
    const before = { ...DEFAULT_PACK_FEEL };
    const out = scaleFeelPx(DEFAULT_PACK_FEEL, PACK_BASE_SIZE.w);
    expect(out).toEqual(DEFAULT_PACK_FEEL);
    expect(DEFAULT_PACK_FEEL).toEqual(before);
    scaleFeelPx(DEFAULT_PACK_FEEL, 150);
    expect(DEFAULT_PACK_FEEL).toEqual(before);
  });

  it('a half-width pack halves them', () => {
    const out = scaleFeelPx(DEFAULT_PACK_FEEL, PACK_BASE_SIZE.w / 2);
    expect(out.sleeveLetGo).toBeCloseTo(DEFAULT_PACK_FEEL.sleeveLetGo / 2);
    expect(out.perspective).toBe(DEFAULT_PACK_FEEL.perspective);
  });
});

describe('packScene: topBackVisible', () => {
  it('only the current top card shows its back', () => {
    expect(topBackVisible(0, 0)).toBe(true);
    expect(topBackVisible(1, 0)).toBe(false);
    expect(topBackVisible(4, 0)).toBe(false);
    expect(topBackVisible(0, 1)).toBe(false); // already flipped away
    expect(topBackVisible(1, 1)).toBe(true);
    expect(topBackVisible(2, 1)).toBe(false);
    expect(topBackVisible(4, 4)).toBe(true);
  });

  it('nothing is visible once every card is flipped', () => {
    for (let i = 0; i < 5; i++) expect(topBackVisible(i, 5)).toBe(false);
  });
});
