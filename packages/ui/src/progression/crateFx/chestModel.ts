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
 *
 * THE TIER CHESTS (2026-10-19, tiered chest openings: each paid tier, Rare / Epic / Legendary / Ancient, opens with its
 * own chest). Built the same way by `scripts/build-chest-art.mjs` from the owner's masters
 * `C:\Users\micha\Desktop\Reference Art\Chests\<Tier> Chest Bottom.png` / `<Tier> Chest Top.png` (alpha box + 4 px,
 * body to 840 wide, the lid by the body's factor, webp q92). The script prints the alpha-measured numbers (body box,
 * baseY, the rim); the spike line, the keyhole box and the lid's attach point were measured from the art and checked on
 * overlays. The spike line is where the spike's tip and the keyhole's centre agree. The keyhole box frames the dark
 * opening with ~3 px of metal round it, as Standard's does, so the mask's soft edge isn't clipped. The lid's attach X
 * is its centre line as the owner's own assembled `<Tier> Chest.png` places it over the spike; its attach Y is the
 * lid's opaque bottom edge, so the lid sits ON the rim (lidOverlap 3) like Standard's. One exception: Legendary's notch
 * is wider than its spike, so at the rim it shows a sliver of background either side; its attach Y (484) is the
 * owner's assembly instead, 9 px lower, where the lid's trim covers that sliver. Epic's and Ancient's lids have NO
 * notch (a pendant point hangs at the centre instead), so their spike would tuck behind the lid until it opens; the
 * owner's assembly has the spike's apex IN FRONT, so the scene draws that piece of the body over the lid (`spikeFront`).
 */
import type { Texture } from 'pixi.js';

/** One chest's art and its anchors, in the cropped masters' px (see the header). */
export interface ChestArt {
  bodyUrl: string;
  lidUrl: string;
  /** Width of the cropped body master (the space the body numbers are in). */
  bodySrcW: number;
  /** The body's opaque left / right edges and its bottom (it stands on the pedestal here). */
  bodyX0: number;
  bodyX1: number;
  baseY: number;
  /** The top edge of the gold rim: where the lid sits and the seam light runs. */
  rimY: number;
  rimX0: number;
  rimX1: number;
  /** The lock spike's centre line (it pokes up through the lid's notch). The whole chest centres on it. */
  spikeX: number;
  /** The keyhole's box (its light mask is cut from the art inside it). */
  keyhole: { x0: number; y0: number; x1: number; y1: number };
  /**
   * Width of the cropped lid master, and the lid's attach point: the lid's centre line over the spike, at the point that
   * sits on the rim. Standard's is the bottom centre of its notch; a tier's is its centre line at the lid's opaque bottom
   * edge (Epic's and Ancient's lids have no notch at all), except Legendary's, which sits lower so its trim covers the
   * notch's sides (see the header).
   */
  lidSrcW: number;
  lidAttachX: number;
  lidAttachY: number;
  /** The lid's bottom edge overlaps the rim by this much (src px), so no gap shows between them at rest. */
  lidOverlap: number;
  /**
   * The SPIKE FRONT (2026-10-19): a chest whose lid has no notch (Epic, Ancient) would hide the lock plate's apex
   * behind the lid until it opens, but the owner's assembled picture shows the apex IN FRONT of the lid's pendant.
   * This box (src px, from the body's top down to where the lid's bottom edge sits) is cut from the body and drawn
   * over the lid while the lid is on. Measured by alpha: the only opaque body pixels above the rim, plus 4 px.
   * Undefined = the lid's notch already shows the spike (Standard, Rare, Legendary).
   */
  spikeFront?: { x0: number; y0: number; x1: number; y1: number };
}

/** The owner's chest, measured from the cropped masters (see the header). The Standard chest. */
export const CHEST_ART: Readonly<ChestArt> = {
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
  /** Width of the cropped lid master, and the lid's attach point: here the bottom centre of its notch. */
  lidSrcW: 1158, lidAttachX: 578.5, lidAttachY: 336,
  /** The lid's bottom edge overlaps the rim by this much (src px), so no gap shows between them at rest. */
  lidOverlap: 3,
};

/** The four paid tiers' chests (see the header for how each number was measured). */
export const CHEST_TIER_ART: Readonly<Record<'rare' | 'epic' | 'legendary' | 'ancient', ChestArt>> = {
  rare: {
    bodyUrl: 'collection/chest_rare_body.webp', lidUrl: 'collection/chest_rare_lid.webp',
    bodySrcW: 1677, bodyX0: 6, bodyX1: 1670, baseY: 812,
    rimY: 57, rimX0: 22, rimX1: 1655,
    spikeX: 838.5,
    keyhole: { x0: 801, y0: 261, x1: 876, y1: 400 },
    lidSrcW: 1643, lidAttachX: 821.5, lidAttachY: 468, lidOverlap: 3,
  },
  epic: {
    bodyUrl: 'collection/chest_epic_body.webp', lidUrl: 'collection/chest_epic_lid.webp',
    bodySrcW: 1676, bodyX0: 6, bodyX1: 1669, baseY: 796,
    rimY: 71, rimX0: 23, rimX1: 1654,
    spikeX: 838,
    keyhole: { x0: 799, y0: 260, x1: 875, y1: 398 },
    lidSrcW: 1628, lidAttachX: 814, lidAttachY: 476, lidOverlap: 3,
    spikeFront: { x0: 778, y0: 0, x1: 898, y1: 74 },
  },
  legendary: {
    bodyUrl: 'collection/chest_legendary_body.webp', lidUrl: 'collection/chest_legendary_lid.webp',
    bodySrcW: 1676, bodyX0: 6, bodyX1: 1669, baseY: 779,
    rimY: 74, rimX0: 18, rimX1: 1658,
    spikeX: 838,
    keyhole: { x0: 799, y0: 252, x1: 876, y1: 386 },
    lidSrcW: 1586, lidAttachX: 793, lidAttachY: 484, lidOverlap: 3,
  },
  ancient: {
    bodyUrl: 'collection/chest_ancient_body.webp', lidUrl: 'collection/chest_ancient_lid.webp',
    bodySrcW: 1678, bodyX0: 5, bodyX1: 1672, baseY: 793,
    rimY: 73, rimX0: 20, rimX1: 1659,
    spikeX: 839,
    keyhole: { x0: 799, y0: 261, x1: 878, y1: 405 },
    lidSrcW: 1636, lidAttachX: 819, lidAttachY: 484, lidOverlap: 3,
    spikeFront: { x0: 779, y0: 0, x1: 899, y1: 76 },
  },
};

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
  /** The spike front's box in body texture px (see `ChestArt.spikeFront`), or null when the chest needs none. */
  spikeFront: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** The owner's art as a model (pure: reads only the textures' sizes). `art` = which chest; Standard by default. */
export function artChestModel(body: Texture, lid: Texture, keyhole: Texture | null, art: ChestArt = CHEST_ART): ChestModel {
  const A = art;
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
    spikeFront: A.spikeFront
      ? { x0: A.spikeFront.x0 * k, y0: A.spikeFront.y0 * k, x1: A.spikeFront.x1 * k, y1: A.spikeFront.y1 * k }
      : null,
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
    spikeFront: null,
  };
}

export interface ChestImages<I> { body: I; lid: I }

/**
 * Load the owner's two chest layers (`art` = which chest; Standard by default). Resolves null when EITHER fails (a 404,
 * a decode error, no DOM), so the caller falls back whole (to the painted chest, or a tier to Standard) rather than
 * mixing a real body with a painted lid.
 */
export async function loadChestImages<I>(base: string, load: (url: string) => Promise<I>, art: ChestArt = CHEST_ART): Promise<ChestImages<I> | null> {
  try {
    const [body, lid] = await Promise.all([load(`${base}${art.bodyUrl}`), load(`${base}${art.lidUrl}`)]);
    return body && lid ? { body, lid } : null;
  } catch {
    return null;
  }
}
