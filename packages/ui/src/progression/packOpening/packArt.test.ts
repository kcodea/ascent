import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETIC_RARITIES, STYLE_PACK_IDS, STYLE_PACK_NAMES } from '@game/progression';
import { CATEGORY_PACKS, LAUNCH_PACK_LOOK_ID, LAUNCH_PACK_SRC, RARITY_PACK_ART, SCRIBBLE_PACK_LOOK_ID, SCRIBBLE_PACK_SRC, SECRET_PACK_LOOK_ID, SECRET_PACK_SRC, STYLE_PACKS, packArtFor, packShineFor } from './packArt';
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
  it('every rarity pack wears its own rarity wrapper; category and themed packs with art wear theirs, the rest keep the placeholder', () => {
    for (const r of COSMETIC_RARITIES) {
      const look = PACK_LAB_LOOKS.find((l) => l.id === `rarity-${r}`);
      expect(look, r).toBeDefined();
      expect(packArtFor(look!)).toBe(RARITY_PACK_ART[r]);
    }
    const secret = PACK_LAB_LOOKS.find((l) => l.id === SECRET_PACK_LOOK_ID)!;
    expect(packArtFor(secret)).toBe(SECRET_PACK_SRC);
    const launch = PACK_LAB_LOOKS.find((l) => l.id === LAUNCH_PACK_LOOK_ID)!;
    expect(packArtFor(launch)).toBe(LAUNCH_PACK_SRC);
    const scribble = PACK_LAB_LOOKS.find((l) => l.id === SCRIBBLE_PACK_LOOK_ID)!;
    expect(packArtFor(scribble)).toBe(SCRIBBLE_PACK_SRC);
    const styled = new Set([...STYLE_PACKS, ...CATEGORY_PACKS].map((p) => p.id));
    for (const p of CATEGORY_PACKS) expect(packArtFor(PACK_LAB_LOOKS.find((l) => l.id === p.id)!), p.id).toMatch(new RegExp(`packs/${p.file}-pack\\.webp$`));
    for (const p of STYLE_PACKS) expect(packArtFor(PACK_LAB_LOOKS.find((l) => l.id === p.id)!), p.id).toMatch(new RegExp(`packs/${p.file}-pack\\.webp$`));
    for (const look of PACK_LAB_LOOKS.filter((l) => l.kind !== 'rarity' && l !== secret && l !== launch && l !== scribble && !styled.has(l.id))) expect(packArtFor(look), look.id).toBeNull();
    // a category pack with a Common floor is still its category's pack, not the Common pack; an unknown category has none
    expect(packArtFor({ kind: 'category', id: 'category-emote', name: 'Emote Pack', guaranteedFloor: 'common' })).toMatch(/packs\/emote-pack\.webp$/);
    expect(packArtFor({ kind: 'category', id: 'category-nope', name: 'Nope Pack', guaranteedFloor: 'common' })).toBeNull();
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
    expect(LAUNCH_PACK_SRC.endsWith('packs/launch-pack.webp')).toBe(true);
    const launch = join(PUBLIC, 'packs', 'launch-pack.webp');
    expect(existsSync(launch)).toBe(true);
    expect(webpSize(launch)).toEqual({ w: PACK_GEOM.W * 2, h: (PACK_GEOM.H + PACK_GEOM.BODY_H) * 2 });
    const scribble = join(PUBLIC, 'packs', 'scribble-pack.webp');
    expect(existsSync(scribble)).toBe(true);
    expect(webpSize(scribble)).toEqual({ w: PACK_GEOM.W * 2, h: (PACK_GEOM.H + PACK_GEOM.BODY_H) * 2 });
    for (const p of [...STYLE_PACKS, ...CATEGORY_PACKS]) {
      const file = join(PUBLIC, 'packs', `${p.file}-pack.webp`);
      expect(existsSync(file), p.id).toBe(true);
      expect(webpSize(file), p.id).toEqual({ w: PACK_GEOM.W * 2, h: (PACK_GEOM.H + PACK_GEOM.BODY_H) * 2 });
    }
  });

  it('every wrapper look has its shine mask (half the wrapper, 300 x 450, on disk); the rest none', () => {
    const ids = [...COSMETIC_RARITIES, 'secret', 'launch', 'scribble', ...STYLE_PACKS.map((p) => p.file), ...CATEGORY_PACKS.map((p) => p.file)];
    let masked = 0;
    for (const look of PACK_LAB_LOOKS) {
      const art = packArtFor(look);
      const shine = packShineFor(look);
      if (!art) { expect(shine, look.id).toBeNull(); continue; }
      masked++;
      expect(shine, look.id).toMatch(/packs\/[a-z]+-pack-shine\.webp$/);
      expect(ids.some((id) => shine!.endsWith(`packs/${id}-pack-shine.webp`)), look.id).toBe(true);
    }
    expect(masked).toBe(ids.length);
    for (const id of ids) {
      const file = join(PUBLIC, 'packs', `${id}-pack-shine.webp`);
      expect(existsSync(file), id).toBe(true);
      expect(webpSize(file), id).toEqual({ w: PACK_GEOM.W, h: PACK_GEOM.H + PACK_GEOM.BODY_H });
    }
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

describe('style pack ids', () => {
  it('match the progression STYLE_PACK_IDS list', () => {
    expect([SCRIBBLE_PACK_LOOK_ID, ...STYLE_PACKS.map((p) => p.id)]).toEqual([...STYLE_PACK_IDS]);
  });
});

describe('the shared style pack names', () => {
  it('match the names the art table shows, id for id', () => {
    const shown = Object.fromEntries([{ id: SCRIBBLE_PACK_LOOK_ID, name: 'Scribble Pack' }, ...STYLE_PACKS].map((p) => [p.id, p.name]));
    expect(STYLE_PACK_NAMES).toEqual(shown);
  });
});
