import { describe, expect, it } from 'vitest';
import { COSMETIC_RARITIES, type CrateRarity, type PackLook } from '@game/progression';
import { SECRET_PACK_LOOK_ID } from './packArt';
import {
  CARD_HOLO_STRENGTH, PACK_HOLO_STRENGTH, cardHoloStrength, holoHueFor, holoShiftInto, packHoloHue, packHoloStrength,
} from './packHolo';
import { PACK_LAB_LOOKS } from './packLabSamples';

const rarityLook = (r: CrateRarity): PackLook => ({ kind: 'rarity', id: `rarity-${r}`, name: 'Pack', guaranteedFloor: r });

describe('packHolo: strength by tier', () => {
  it('packs: common 0, rare 0, epic 0.35, legendary 0.55, ancient 0.85, secret 0.85', () => {
    const want: Record<CrateRarity, number> = { common: 0, rare: 0, epic: 0.35, legendary: 0.55, ancient: 0.85 };
    expect(PACK_HOLO_STRENGTH).toEqual(want);
    for (const r of COSMETIC_RARITIES) expect(packHoloStrength(rarityLook(r), 1), r).toBe(want[r]);
    const secret = PACK_LAB_LOOKS.find((l) => l.id === SECRET_PACK_LOOK_ID)!;
    expect(packHoloStrength(secret, 1)).toBe(0.85);
  });

  it('card faces: common 0, rare 0, epic 0.3, legendary 0.5, ancient 0.8', () => {
    const want: Record<CrateRarity, number> = { common: 0, rare: 0, epic: 0.3, legendary: 0.5, ancient: 0.8 };
    expect(CARD_HOLO_STRENGTH).toEqual(want);
    for (const r of COSMETIC_RARITIES) expect(cardHoloStrength(r, 1), r).toBe(want[r]);
  });

  it('the holo knob scales every tier (0 = off, 2 = double); junk is 1', () => {
    expect(packHoloStrength(rarityLook('legendary'), 2)).toBeCloseTo(1.1);
    expect(cardHoloStrength('ancient', 0.5)).toBeCloseTo(0.4);
    for (const r of COSMETIC_RARITIES) {
      expect(packHoloStrength(rarityLook(r), 0)).toBe(0);
      expect(cardHoloStrength(r, 0)).toBe(0);
    }
    expect(cardHoloStrength('epic', Number.NaN)).toBe(0.3);
    expect(cardHoloStrength('epic', -3)).toBe(0);
  });
});

describe('packHolo: colour', () => {
  it('Ancient and the Secret pack are a full rainbow; Epic / Legendary a pearl on their rarity hue', () => {
    expect(holoHueFor('ancient').rainbow).toBe(1);
    expect(holoHueFor('epic').rainbow).toBe(0);
    expect(holoHueFor('legendary').rainbow).toBe(0);
    expect(holoHueFor('epic').rgb.map((c) => Math.round(c * 255))).toEqual([0xc9, 0x8b, 0xff]);
    const secret = PACK_LAB_LOOKS.find((l) => l.id === SECRET_PACK_LOOK_ID)!;
    expect(packHoloHue(secret).rainbow).toBe(1);
  });
});

describe('packHolo: the gradient offset', () => {
  it('a settled flat pack has no offset; the cursor, tilt, peel and slide each move it', () => {
    const o = { x: 0, y: 0 };
    expect(holoShiftInto(o, 0, 0, 0, 0, 0, 0)).toEqual({ x: 0, y: 0 });
    const base = { ...holoShiftInto(o, 0.2, -0.1, 3, 4, 0, 0) };
    expect(holoShiftInto(o, 0.2, -0.1, 3, 4, 0, 0)).toEqual(base); // pure: same in, same out
    expect(holoShiftInto(o, 0.5, -0.1, 3, 4, 0, 0).x).not.toBe(base.x);
    expect(holoShiftInto(o, 0.2, 0.4, 3, 4, 0, 0).y).not.toBe(base.y);
    expect(holoShiftInto(o, 0.2, -0.1, 3, 4, 0.5, 0).x).not.toBe(base.x);
    expect(holoShiftInto(o, 0.2, -0.1, 3, 4, 0, 80).y).not.toBe(base.y);
  });
});
