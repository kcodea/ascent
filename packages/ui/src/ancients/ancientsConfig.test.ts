import { describe, expect, it } from 'vitest';
import { ANCIENT_ART_IDS, ANCIENTS_DEFAULTS, ART_FIELDS } from './ancientsConfig';

/** The owner's ✦ Ancients tuner values, baked as the shipped defaults (owner 2026-09-26: "bake these values for now"),
 *  so prod (which ignores the tuner's localStorage) matches what the owner signed off. */
describe('the Ancients tuner defaults', () => {
  it('carry the owner-baked screen colours, cue gains and reveal style', () => {
    expect(ANCIENTS_DEFAULTS).toMatchObject({
      curtainInner: '#247067', curtainOuter: '#0a0618', seamColor: '#fff1bd', titleGlow: '#9effd5', backdropTint: '#060d0f',
      cardRevealGain: 0.19, pickSealGain: 0.62,
      revealStyle: 1, // 1 = two beats (the middle slams, then the sides together); 0 = sequential
      hpDustLife: 0.45, dustAmount: 1, dustSize: 1, dustLife: 1, dustOpacity: 0.85,
      bondsColor: '#9b5de5', // the sixth Ancient, purple (owner 2026-09-26)
    });
    expect(ANCIENT_ART_IDS).toHaveLength(6);
  });
  it('fit every Ancient’s hero-power art at the neutral offset (0) and scale (1)', () => {
    for (const id of ANCIENT_ART_IDS) {
      for (const f of ART_FIELDS) expect(ANCIENTS_DEFAULTS[`${id}${f}`], `${id}${f}`).toBe(f === 'S' ? 1 : 0);
    }
  });
});
