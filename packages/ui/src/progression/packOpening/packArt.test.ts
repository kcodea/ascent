import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMON_PACK_SRC, packArtFor, packShineFor } from './packArt';
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
  it('the Common rarity pack wears the wrapper art; every other look keeps the placeholder', () => {
    const common = PACK_LAB_LOOKS.find((l) => l.id === 'rarity-common')!;
    expect(packArtFor(common)).toBe(COMMON_PACK_SRC);
    expect(packArtFor({ kind: 'rarity', id: 'common', name: 'Common Pack', guaranteedFloor: 'common' })).toBe(COMMON_PACK_SRC);
    for (const look of PACK_LAB_LOOKS.filter((l) => l !== common)) expect(packArtFor(look), look.id).toBeNull();
    // a category or themed pack with a Common floor is not the Common pack
    expect(packArtFor({ kind: 'category', id: 'category-emote', name: 'Emote Pack', guaranteedFloor: 'common' })).toBeNull();
  });

  it('ships the art where it points, at 2x the pack on the packGeom template', () => {
    expect(COMMON_PACK_SRC).toMatch(/packs\/common-pack\.webp$/);
    const file = join(PUBLIC, 'packs', 'common-pack.webp');
    expect(existsSync(file)).toBe(true);
    expect(webpSize(file)).toEqual({ w: PACK_GEOM.W * 2, h: (PACK_GEOM.H + PACK_GEOM.BODY_H) * 2 });
  });

  it('has no shine mask yet (the hook returns null)', () => {
    for (const look of PACK_LAB_LOOKS) expect(packShineFor(look)).toBeNull();
  });
});

describe('packGeom', () => {
  it('derives the strip from the art: the strip / pack ratio is the tear line\'s share of the wrapper', () => {
    const { H, total } = derivePackHeights(300, PACK_ART_TEMPLATE);
    expect(H).toBe(61);
    expect(total).toBe(547);
    expect(PACK_GEOM.H).toBe(H);
    expect(PACK_GEOM.H + PACK_GEOM.BODY_H).toBe(total);
    const frac = PACK_ART_TEMPLATE.tearY / PACK_ART_TEMPLATE.h;
    expect(Math.abs(PACK_GEOM.H / total - frac)).toBeLessThan(0.5 / total + 1e-9); // within the rounding
    // the art keeps its aspect (no stretch)
    expect(Math.abs(total / PACK_GEOM.W - PACK_ART_TEMPLATE.h / PACK_ART_TEMPLATE.w)).toBeLessThan(0.01);
  });

  it('scales with the width', () => {
    expect(derivePackHeights(834, PACK_ART_TEMPLATE)).toEqual({ H: 170, total: 1520 });
    expect(derivePackHeights(600, PACK_ART_TEMPLATE)).toEqual({ H: 122, total: 1094 });
  });

  it('the stack still fits inside the sleeve', () => {
    expect(PACK_GEOM.CARD_W).toBeLessThan(PACK_GEOM.W);
    expect(PACK_GEOM.CARD_H).toBeLessThan(PACK_GEOM.BODY_H);
  });
});
