import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETIC_RARITIES } from '@game/progression';
import { RARITY_PACK_ART, SECRET_PACK_LOOK_ID, SECRET_PACK_SRC, packArtFor, packShineFor } from './packArt';
import { PACK_LAB_LOOKS } from './packLabSamples';
import { PACK_ART_TEMPLATE, PACK_GEOM, derivePackHeights } from './packGeom';

const PUBLIC = join(__dirname, '../../../../../apps/web/public');

/** A lossy / lossless / extended webp's canvas size, read from its header. */
function webpSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  const bits = b.readUInt32LE(21); // VP8L
  return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
}

describe('packArtFor', () => {
  it('every rarity pack wears its own rarity wrapper; category and themed packs keep the placeholder', () => {
    for (const r of COSMETIC_RARITIES) {
      const look = PACK_LAB_LOOKS.find((l) => l.id === `rarity-${r}`);
      expect(look, r).toBeDefined();
      expect(packArtFor(look!)).toBe(RARITY_PACK_ART[r]);
    }
    const secret = PACK_LAB_LOOKS.find((l) => l.id === SECRET_PACK_LOOK_ID)!;
    expect(packArtFor(secret)).toBe(SECRET_PACK_SRC);
    for (const look of PACK_LAB_LOOKS.filter((l) => l.kind !== 'rarity' && l !== secret)) expect(packArtFor(look), look.id).toBeNull();
    // a category pack with a Common floor is not the Common pack
    expect(packArtFor({ kind: 'category', id: 'category-emote', name: 'Emote Pack', guaranteedFloor: 'common' })).toBeNull();
  });

  it('ships every wrapper where it points, at 2x the pack on the packGeom template', () => {
    for (const r of COSMETIC_RARITIES) {
      expect(RARITY_PACK_ART[r].endsWith(`packs/${r}-pack.webp`), r).toBe(true);
      const file = join(PUBLIC, 'packs', `${r}-pack.webp`);
      expect(existsSync(file), r).toBe(true);
      expect(webpSize(file), r).toEqual({ w: PACK_GEOM.W * 2, h: (PACK_GEOM.H + PACK_GEOM.BODY_H) * 2 });
    }
    expect(SECRET_PACK_SRC.endsWith('packs/secret-pack.webp')).toBe(true);
    const secret = join(PUBLIC, 'packs', 'secret-pack.webp');
    expect(existsSync(secret)).toBe(true);
    expect(webpSize(secret)).toEqual({ w: PACK_GEOM.W * 2, h: (PACK_GEOM.H + PACK_GEOM.BODY_H) * 2 });
  });

  it('has no shine mask yet (the hook returns null)', () => {
    for (const look of PACK_LAB_LOOKS) expect(packShineFor(look)).toBeNull();
  });
});

describe('packGeom', () => {
  it('derives the strip from the art: the strip / pack ratio is the tear line\'s share of the wrapper', () => {
    const { H, total } = derivePackHeights(300, PACK_ART_TEMPLATE);
    expect(H).toBe(50);
    expect(total).toBe(450);
    expect(PACK_GEOM.H).toBe(H);
    expect(PACK_GEOM.H + PACK_GEOM.BODY_H).toBe(total);
    const frac = PACK_ART_TEMPLATE.tearY / PACK_ART_TEMPLATE.h;
    expect(Math.abs(PACK_GEOM.H / total - frac)).toBeLessThan(0.5 / total + 1e-9); // within the rounding
    // the art keeps its aspect (no stretch)
    expect(Math.abs(total / PACK_GEOM.W - PACK_ART_TEMPLATE.h / PACK_ART_TEMPLATE.w)).toBeLessThan(0.01);
  });

  it('scales with the width', () => {
    expect(derivePackHeights(150, PACK_ART_TEMPLATE)).toEqual({ H: 25, total: 225 });
    expect(derivePackHeights(600, PACK_ART_TEMPLATE)).toEqual({ H: 100, total: 900 });
  });

  it('the stack still fits inside the sleeve', () => {
    expect(PACK_GEOM.CARD_W).toBeLessThan(PACK_GEOM.W);
    expect(PACK_GEOM.CARD_H).toBeLessThan(PACK_GEOM.BODY_H);
  });
});
