import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COSMETIC_RARITIES, type CrateRarity, type PackLook } from '@game/progression';
import {
  CARD_GLOW_TIERS, FACE_GLOW_OPACITY, PACK_GLOW_TIERS, faceGlowOpacity, glowAlphaAt, packGlowRarity, type GlowTier,
} from './packGlow';
import { ANCIENT_GLOW_STOPS, PACK_RARITY_COLORS, rarityTint } from './packTextures';

const look = (kind: PackLook['kind'], id: string, floor: CrateRarity): PackLook => ({ kind, id, name: 'Pack', guaranteedFloor: floor });

describe('packGlow: which rarity a pack glows', () => {
  it('a rarity pack glows its own rarity (from its id, with or without the rarity- prefix)', () => {
    expect(packGlowRarity(look('rarity', 'epic', 'epic'))).toBe('epic');
    expect(packGlowRarity(look('rarity', 'rarity-legendary', 'legendary'))).toBe('legendary');
    expect(packGlowRarity(look('rarity', 'rarity-ancient', 'rare'))).toBe('ancient');
  });

  it('a rarity pack with an id that is no rarity falls back to its floor', () => {
    expect(packGlowRarity(look('rarity', 'starter', 'rare'))).toBe('rare');
  });

  it('themed and category packs glow their guaranteed floor, whatever their id says', () => {
    expect(packGlowRarity(look('themed', 'legendary', 'rare'))).toBe('rare');
    expect(packGlowRarity(look('category', 'titles', 'epic'))).toBe('epic');
  });
});

describe('packGlow: the tier tables', () => {
  const tables: [string, Readonly<Record<CrateRarity, GlowTier>>][] = [['card', CARD_GLOW_TIERS], ['pack', PACK_GLOW_TIERS]];

  for (const [name, t] of tables) {
    it(`${name}: every rarity has an entry and strength never drops as rarity climbs`, () => {
      for (const r of COSMETIC_RARITIES) expect(t[r], r).toBeTruthy();
      for (let i = 1; i < COSMETIC_RARITIES.length; i++) {
        const lo = t[COSMETIC_RARITIES[i - 1]!], hi = t[COSMETIC_RARITIES[i]!];
        expect(hi.alpha).toBeGreaterThanOrEqual(lo.alpha);
        expect(hi.size).toBeGreaterThanOrEqual(lo.size);
        expect(hi.amp).toBeGreaterThanOrEqual(lo.amp);
      }
      expect(t.common.alpha).toBeGreaterThan(0); // Common glows too, faintly
    });

    it(`${name}: only Epic and up pulse (Common / Rare static, so they never keep the ticker awake)`, () => {
      expect(t.common.pulse).toBe('none');
      expect(t.rare.pulse).toBe('none');
      expect(t.common.amp).toBe(0);
      expect(t.rare.amp).toBe(0);
      expect(t.epic.pulse).toBe('gentle');
      expect(t.legendary.pulse).toBe('strong');
      expect(t.ancient.pulse).toBe('strong');
      for (const r of ['epic', 'legendary', 'ancient'] as const) {
        expect(t[r].amp).toBeGreaterThan(0);
        expect(t[r].rate).toBeGreaterThan(0);
      }
    });
  }

  it('the face opacity table covers every rarity and never drops', () => {
    for (let i = 1; i < COSMETIC_RARITIES.length; i++) {
      expect(FACE_GLOW_OPACITY[COSMETIC_RARITIES[i]!]).toBeGreaterThanOrEqual(FACE_GLOW_OPACITY[COSMETIC_RARITIES[i - 1]!]);
    }
  });

  it('a static tier is the same at any time; the master knob scales it; nothing goes negative', () => {
    expect(glowAlphaAt(CARD_GLOW_TIERS.rare, 0, 1)).toBe(CARD_GLOW_TIERS.rare.alpha);
    expect(glowAlphaAt(CARD_GLOW_TIERS.rare, 123, 1)).toBe(CARD_GLOW_TIERS.rare.alpha);
    expect(glowAlphaAt(CARD_GLOW_TIERS.rare, 5, 2)).toBeCloseTo(CARD_GLOW_TIERS.rare.alpha * 2);
    expect(glowAlphaAt(CARD_GLOW_TIERS.legendary, 5, 0)).toBe(0);
    for (let f = 0; f < 200; f++) expect(glowAlphaAt(CARD_GLOW_TIERS.legendary, f, 1)).toBeGreaterThanOrEqual(0);
  });

  it('the face opacity is the tier times the knob, capped at 1', () => {
    expect(faceGlowOpacity('epic', 1)).toBe(FACE_GLOW_OPACITY.epic);
    expect(faceGlowOpacity('epic', 0)).toBe(0);
    expect(faceGlowOpacity('ancient', 2)).toBe(1);
  });
});

describe('packTextures: the rarity colours match the game palette', () => {
  it('PACK_RARITY_COLORS are the styles.css --rc values', () => {
    expect(PACK_RARITY_COLORS).toEqual({
      common: '#cfd8e3', rare: '#6fb0ff', epic: '#c98bff', legendary: '#ffbe5c', ancient: '#8af5ff',
    });
    expect(rarityTint('rare')).toBe(0x6fb0ff);
    expect(ANCIENT_GLOW_STOPS).toEqual(['#8af5ff', '#c9b8ff', '#ff7ae0']);
  });

  it('and they still agree with styles.css itself (a palette change there fails here)', () => {
    const css = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8');
    for (const r of COSMETIC_RARITIES) {
      const m = new RegExp(`\\.r-${r} \\{ --rc: (#[0-9a-f]{6})`, 'i').exec(css);
      expect(m?.[1]?.toLowerCase(), r).toBe(PACK_RARITY_COLORS[r]);
    }
    expect(css).toContain('--rc2: #ff7ae0');
  });
});
