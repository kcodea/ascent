/**
 * THE CHEST GEOMETRY (tiered chest openings, 2026-10-19): today's Standard chest keeps its exact numbers once the model
 * takes a `ChestArt`, and every paid tier's measured anchors are sane: the spike line inside the body, the keyhole
 * below the rim and on the spike line, the lid's attach point inside the lid, and the art files on disk.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Texture } from 'pixi.js';
import { CHEST_ART, CHEST_TIER_ART, artChestModel } from './chestModel';

/** A fake texture: the model only reads width and height. */
const tex = (width: number, height: number) => ({ width, height }) as unknown as Texture;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../../../../apps/web/public');
const TIERS = ['rare', 'epic', 'legendary', 'ancient'] as const;

describe('the chest model', () => {
  it('standard model is unchanged', () => {
    // snapshotted from the model before it took a ChestArt (840x457 body, 819x238 lid)
    const m = artChestModel(tex(840, 457), tex(819, 238), null);
    expect(m.cx).toBeCloseTo(420.35383, 4);
    expect(m.rimY).toBeCloseTo(29.01432, 4);
    expect(m.keyholeX).toBeCloseTo(420.35383, 4);
    expect(m.lidAtY).toBeCloseTo(31.13732, 4);
    expect(m.lidAttachX).toBeCloseTo(409.14637, 4);
    expect(m.width).toBeCloseTo(830.80034, 4);
    // the default IS the Standard art
    expect(artChestModel(tex(840, 457), tex(819, 238), null, CHEST_ART)).toEqual(m);
  });

  it("every tier's geometry is sane", () => {
    for (const t of TIERS) {
      const A = CHEST_TIER_ART[t];
      expect(A.bodyX0, t).toBeGreaterThanOrEqual(0);
      expect(A.bodyX0, t).toBeLessThan(A.spikeX);
      expect(A.spikeX, t).toBeLessThan(A.bodyX1);
      expect(A.bodyX1, t).toBeLessThanOrEqual(A.bodySrcW);
      expect(A.rimY, t).toBeLessThan(A.keyhole.y0);
      expect(A.keyhole.y0, t).toBeLessThan(A.keyhole.y1);
      expect(A.keyhole.y1, t).toBeLessThan(A.baseY);
      expect(A.keyhole.x0 - 40, t).toBeLessThanOrEqual(A.spikeX);
      expect(A.keyhole.x1 + 40, t).toBeGreaterThanOrEqual(A.spikeX);
      expect(A.lidAttachX, t).toBeGreaterThan(0);
      expect(A.lidAttachX, t).toBeLessThan(A.lidSrcW);
      expect(A.lidOverlap, t).toBe(3);
      // the model reads the tier's own art: centred on ITS spike, its own scale
      const m = artChestModel(tex(840, 400), tex(820, 245), null, A);
      expect(m.cx, t).toBeCloseTo(A.spikeX * (840 / A.bodySrcW));
      expect(m.lidAtX, t).toBeCloseTo(m.cx);
    }
  });

  it('the tier art files exist', () => {
    for (const t of TIERS) {
      const A = CHEST_TIER_ART[t];
      expect(A.bodyUrl, t).toBe(`collection/chest_${t}_body.webp`);
      expect(A.lidUrl, t).toBe(`collection/chest_${t}_lid.webp`);
      expect(existsSync(join(PUBLIC, A.bodyUrl)), A.bodyUrl).toBe(true);
      expect(existsSync(join(PUBLIC, A.lidUrl)), A.lidUrl).toBe(true);
    }
  });
});
