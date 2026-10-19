#!/usr/bin/env node
/**
 * BUILD THE TIER CHESTS' ART (owner 2026-10-19: each paid chest tier, Rare / Epic / Legendary / Ancient, opens with
 * its own chest). The owner paints each chest as two layers, the body and the lid; this turns them into the webps the
 * crate opening loads, cut and scaled the SAME way as today's Standard chest (see the header of
 * packages/ui/src/progression/crateFx/chestModel.ts).
 *
 *   node scripts/build-chest-art.mjs --src "C:\Users\micha\Desktop\Reference Art\Chests"
 *   node scripts/build-chest-art.mjs --src "..." --tier epic      (one tier only)
 *   node scripts/build-chest-art.mjs --src "..." --quality-body-legendary 88   (one file at a lower quality)
 *
 * Reads `<Tier> Chest Bottom.png` (the body) and `<Tier> Chest Top.png` (the lid) from --src, and writes into
 * apps/web/public/collection/:
 *   chest_<tier>_body.webp   the body: cropped to its alpha box plus PAD px, scaled to BODY_W wide
 *   chest_<tier>_lid.webp    the lid: cropped the same way, scaled by the BODY's factor (one scale for both layers,
 *                            so the lid's notch lands on the body's spike without a second factor)
 *
 * It prints, per tier, the numbers chestModel.ts's CHEST_TIER_ART needs that the ALPHA can give, all in the CROPPED
 * masters' px (the `src` space the model converts from): bodySrcW, bodyX0 / bodyX1 / baseY (the opaque body), lidSrcW,
 * and the rim's top edge rimY / rimX0 / rimX1. The anchors the alpha can't give (the spike's centre line, the keyhole
 * box, the lid's attach point) are measured from the art itself and written into chestModel.ts by hand.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'apps/web/public/collection');
/** The shipped body width (today's crate_body.webp is 840 wide), and the transparent margin kept round each crop. */
const BODY_W = 840, PAD = 4;
/** Alpha above this counts as the chest itself (the crop keeps every non-zero pixel; the measures want the edge). */
const OPAQUE = 128;
/** A row is the rim's top edge once this share of the body's opaque width is solid (the spike pokes up above it). */
const RIM_COVER = 0.9;
const TIERS = ['rare', 'epic', 'legendary', 'ancient'];

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
if (!args.src) throw new Error('pass --src <folder with "<Tier> Chest Top.png" and "<Tier> Chest Bottom.png">');
const tiers = args.tier ? [args.tier] : TIERS;
for (const t of tiers) if (!TIERS.includes(t)) throw new Error(`--tier must be one of ${TIERS.join(', ')}, got ${t}`);
const title = (t) => t[0].toUpperCase() + t.slice(1);

/** A master cropped to its alpha box (any non-zero alpha) plus PAD transparent px on every side, as raw RGBA. */
async function cropped(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 0) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error(`${file} is fully transparent`);
  // extract, then EXTEND (not a wider extract): a master painted right to its canvas edge still gets its PAD
  const buf = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw().toBuffer({ resolveWithObject: true });
  return { d: buf.data, w: buf.info.width, h: buf.info.height };
}

/** The opaque box, and the rim: the first row (from the top) that is solid across RIM_COVER of the body's width. */
function measureBody({ d, w, h }) {
  const solid = (x, y) => d[(y * w + x) * 4 + 3] > OPAQUE;
  let bodyX0 = w, bodyX1 = -1, baseY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y)) {
    if (x < bodyX0) bodyX0 = x; if (x > bodyX1) bodyX1 = x; if (y > baseY) baseY = y;
  }
  for (let y = 0; y < h; y++) {
    let n = 0, rimX0 = -1, rimX1 = -1;
    for (let x = 0; x < w; x++) if (solid(x, y)) { n++; if (rimX0 < 0) rimX0 = x; rimX1 = x; }
    if (n >= RIM_COVER * (bodyX1 - bodyX0)) return { bodyX0, bodyX1, baseY, rimY: y, rimX0, rimX1 };
  }
  throw new Error('no rim row found');
}

/** Write one layer as webp (alpha kept), resized to `width`. Returns the written size in bytes. */
async function write(img, width, name, quality) {
  const info = await sharp(img.d, { raw: { width: img.w, height: img.h, channels: 4 } })
    .resize({ width: Math.round(width), kernel: 'lanczos3' })
    .webp({ quality, alphaQuality: 100 })
    .toFile(join(OUT, name));
  return info;
}

mkdirSync(OUT, { recursive: true });
for (const tier of tiers) {
  const body = await cropped(join(args.src, `${title(tier)} Chest Bottom.png`));
  const lid = await cropped(join(args.src, `${title(tier)} Chest Top.png`));
  const f = BODY_W / body.w; // ONE factor for both layers
  const q = (part) => Number(args[`quality-${part}-${tier}`] ?? 92);
  const b = await write(body, BODY_W, `chest_${tier}_body.webp`, q('body'));
  const l = await write(lid, lid.w * f, `chest_${tier}_lid.webp`, q('lid'));
  const m = measureBody(body);
  console.log(`${tier}: body ${b.width}x${b.height} (${(b.size / 1024).toFixed(1)} KB q${q('body')}), lid ${l.width}x${l.height} (${(l.size / 1024).toFixed(1)} KB q${q('lid')}), factor ${f.toFixed(5)}`);
  console.log(`  bodySrcW: ${body.w}, bodyX0: ${m.bodyX0}, bodyX1: ${m.bodyX1}, baseY: ${m.baseY}, rimY: ${m.rimY}, rimX0: ${m.rimX0}, rimX1: ${m.rimX1}, lidSrcW: ${lid.w}  (body src h ${body.h}, lid src h ${lid.h})`);
}
