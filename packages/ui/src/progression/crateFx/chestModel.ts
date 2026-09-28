/**
 * THE CHEST MODEL (2026-09-28, owner art: "added new chest pngs here ... can you wire this up to work"). The crate
 * opening draws its chest from TWO layers, the body and the lid, and needs to know where the parts of the picture
 * are: where the lid sits, where the seam line runs, where the keyhole is. This file is that geometry, for the
 * owner's art (`CHEST_ART`, measured from the masters' alpha) and for the painted fallback (`crateTextures.ts`).
 *
 * Every number is in BODY TEXTURE px (the lid's attach point in LID texture px), so the scene scales one factor.
 * Pure: textures are only read for their width and height, so it runs headless.
 *
 * THE ART (`apps/web/public/collection/crate_body.webp` + `crate_lid.webp`) was built from the owner's masters
 * `C:\Game Assets\Ascent Art\Collection Stuff\chest_bottom.png` (1254x1254) and `chest_top.png` (1174x359):
 * each cropped to its opaque box plus a few px, then both scaled by the SAME factor (840 / 1187) and saved as
 * webp q92 with full alpha. The numbers below are measured in the CROPPED masters' px (the `src` space); the model
 * converts them to texture px by `texture.width / srcW`, so re-exporting at another size needs no change here.
 */
import type { Texture } from 'pixi.js';

/** The owner's chest, measured from the cropped masters (see the header). */
export const CHEST_ART = {
  bodyUrl: 'collection/crate_body.webp',
  lidUrl: 'collection/crate_lid.webp',
  /** Width of the cropped body master (the space the body numbers are in). */
  bodySrcW: 1187,
  /** The body's opaque left / right edges and its bottom (it stands on the pedestal here). */
  bodyX0: 6, bodyX1: 1180, baseY: 642,
  /** The top edge of the gold rim: where the lid sits and the seam light runs. */
  rimY: 41, rimX0: 10, rimX1: 1176,
  /** The lock spike's centre line (it pokes up through the lid's notch). The whole chest centres on it. */
  spikeX: 594,
  /** The keyhole's box (its light mask is cut from the art inside it). */
  keyhole: { x0: 565, y0: 184, x1: 623, y1: 288 },
  /** Width of the cropped lid master, and the lid's attach point: the bottom centre of its notch. */
  lidSrcW: 1158, lidAttachX: 578.5, lidAttachY: 336,
  /** The lid's bottom edge overlaps the rim by this much (src px), so no gap shows between them at rest. */
  lidOverlap: 3,
} as const;

export interface ChestModel {
  kind: 'art' | 'painted';
  body: Texture;
  lid: Texture;
  /** The keyhole's light mask (white where the keyhole is), placed at `keyholeX0/Y0`. Null = a round glow only. */
  keyhole: Texture | null;
  /** The body's opaque width (texture px): the chest's "size" is this many texture px. */
  width: number;
  /** The chest's centre line and the ground line (texture px). */
  cx: number;
  baseY: number;
  /** The seam: the rim's top edge and its extent. */
  rimY: number;
  rimX0: number;
  rimX1: number;
  /** The keyhole's centre and radius, and the mask's top-left. */
  keyholeX: number;
  keyholeY: number;
  keyholeR: number;
  keyholeX0: number;
  keyholeY0: number;
  /** The lid: its attach point in LID texture px, and LID texture px -> BODY texture px. */
  lidAttachX: number;
  lidAttachY: number;
  lidRel: number;
  /** Where the attach point sits in body texture px (on the rim, over the spike, overlapping a touch). */
  lidAtX: number;
  lidAtY: number;
}

/** The owner's art as a model (pure: reads only the textures' sizes). */
export function artChestModel(body: Texture, lid: Texture, keyhole: Texture | null): ChestModel {
  const A = CHEST_ART;
  const k = body.width / A.bodySrcW;
  const kl = lid.width / A.lidSrcW;
  return {
    kind: 'art', body, lid, keyhole,
    width: (A.bodyX1 - A.bodyX0) * k,
    cx: A.spikeX * k,
    baseY: A.baseY * k,
    rimY: A.rimY * k,
    rimX0: A.rimX0 * k,
    rimX1: A.rimX1 * k,
    keyholeX: ((A.keyhole.x0 + A.keyhole.x1) / 2) * k,
    keyholeY: ((A.keyhole.y0 + A.keyhole.y1) / 2) * k,
    keyholeR: ((A.keyhole.x1 - A.keyhole.x0) / 2) * k,
    keyholeX0: A.keyhole.x0 * k,
    keyholeY0: A.keyhole.y0 * k,
    lidAttachX: A.lidAttachX * kl,
    lidAttachY: A.lidAttachY * kl,
    lidRel: k / kl,
    lidAtX: A.spikeX * k,
    lidAtY: (A.rimY + A.lidOverlap) * k,
  };
}

/** The painted chest's proportions (units of its width), mirrored from `crateTextures.ts` `CHEST`. */
export interface PaintedChestDims { bodyH: number; lidH: number; lidOver: number }

/** The painted fallback as a model. `W` = the painted width, `pad` = the padding painted around each part. */
export function paintedChestModel(body: Texture, lid: Texture, W: number, pad: number, d: PaintedChestDims): ChestModel {
  const H = W * d.bodyH;
  const LW = W * (1 + d.lidOver * 2);
  const LH = W * d.lidH;
  const plateH = H * 0.58;
  return {
    kind: 'painted', body, lid, keyhole: null,
    width: W,
    cx: pad + W / 2,
    baseY: pad + H,
    rimY: pad,
    rimX0: pad,
    rimX1: pad + W,
    keyholeX: pad + W / 2,
    keyholeY: pad + plateH * 0.42,
    keyholeR: W * 0.034,
    keyholeX0: pad + W / 2,
    keyholeY0: pad + plateH * 0.42,
    lidAttachX: pad + LW / 2,
    lidAttachY: pad + LH,
    lidRel: 1,
    lidAtX: pad + W / 2,
    lidAtY: pad + W * 0.004,
  };
}

export interface ChestImages<I> { body: I; lid: I }

/**
 * Load the owner's two chest layers. Resolves null when EITHER fails (a 404, a decode error, no DOM), so the caller
 * falls back to the painted chest whole rather than mixing a real body with a painted lid.
 */
export async function loadChestImages<I>(base: string, load: (url: string) => Promise<I>): Promise<ChestImages<I> | null> {
  try {
    const [body, lid] = await Promise.all([load(`${base}${CHEST_ART.bodyUrl}`), load(`${base}${CHEST_ART.lidUrl}`)]);
    return body && lid ? { body, lid } : null;
  } catch {
    return null;
  }
}
