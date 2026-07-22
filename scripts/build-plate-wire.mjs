/**
 * Bakes the hand-card backplate's ARCANE WIREFRAME mask.
 *
 * The plate dissolve (played-card FX) shows a blue gradient through a mask of the plate's own structural
 * lines — stone joints, gold rails, the gem, the greek-key tabs. That mask is edge-detected from the art,
 * and the extraction is expensive: a box blur, a Sobel pass and a percentile sort over ~300k pixels. It is
 * also completely DETERMINISTIC — fixed art, fixed settings — so there is no reason to pay for it at
 * runtime. This bakes it once to an asset; the game just uses it as a mask image.
 *
 * Authored + dialed in `apps/web/public/fx/plate-dissolve-preview.html`; the constants below are that rig's
 * shipped values. Re-run after changing the plate art OR those dials:
 *
 *   npm run wire:plate
 *
 * NB the `outline` pass is not cosmetic — a Sobel over luminance alone never sees the transition into fully
 * transparent pixels, so without it the plate's silhouette is missing from the wireframe.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../apps/web/public/frames/cardplate.webp');
const OUT = resolve(HERE, '../apps/web/public/frames/cardplate-wire.webp');

/** Rig values (plate-dissolve-preview.html → the "Wireframe" section). */
const W = 440;              // extraction resolution; the mask is scaled to the card at render time
const SMOOTH = 4;           // box-blur radius on luminance BEFORE Sobel — kills stone grain, keeps architecture
const GAIN = 0.5;           // contrast on the normalised magnitude
const CUT = 0.22;           // cutoff, in normalised space
const WEIGHT = 1;           // dilation passes — thickens lines so they survive being scaled down
const OUTLINE = 1;          // trace the silhouette at full strength

const boxBlur = (src, w, h, r) => {
  const R = Math.round(r);
  if (R <= 0) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; s += src[y * w + xx]; n++; }
    tmp[y * w + x] = s / n;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; s += tmp[yy * w + x]; n++; }
    out[y * w + x] = s / n;
  }
  return out;
};

const meta = await sharp(SRC).metadata();
const h = Math.round(W * (meta.height / meta.width));
const { data } = await sharp(SRC).resize(W, h).raw().ensureAlpha().toBuffer({ resolveWithObject: true });

const alpha = new Float32Array(W * h), lum0 = new Float32Array(W * h);
for (let p = 0; p < W * h; p++) {
  const i = p * 4;
  alpha[p] = data[i + 3] / 255;
  lum0[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255 * alpha[p];
}
const lum = boxBlur(lum0, W, h, SMOOTH);
const at = (a, x, y) => (x < 0 || y < 0 || x >= W || y >= h) ? 0 : a[y * W + x];

// Sobel → raw magnitude
const mag = new Float32Array(W * h);
for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
  const gx = -at(lum,x-1,y-1) - 2*at(lum,x-1,y) - at(lum,x-1,y+1)
           +  at(lum,x+1,y-1) + 2*at(lum,x+1,y) + at(lum,x+1,y+1);
  const gy = -at(lum,x-1,y-1) - 2*at(lum,x,y-1) - at(lum,x+1,y-1)
           +  at(lum,x-1,y+1) + 2*at(lum,x,y+1) + at(lum,x+1,y+1);
  mag[y * W + x] = Math.hypot(gx, gy);
}

// Normalise against the 99th percentile, then threshold + gamma. Without this the survivors sit at 30-50%
// alpha and the mask renders as an invisible ghost (measured: 1.9% solid, mean alpha 6%).
const p99 = Float32Array.from(mag).sort()[Math.floor(W * h * 0.99)] || 1;
let edge = new Float32Array(W * h);
for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  let e = Math.min(1, (mag[i] / p99) * GAIN);
  e = e < CUT ? 0 : Math.pow((e - CUT) / (1 - CUT), 0.45);
  if (OUTLINE > 0 && alpha[i] > 0.4 &&
      (at(alpha,x-1,y) < 0.4 || at(alpha,x+1,y) < 0.4 || at(alpha,x,y-1) < 0.4 || at(alpha,x,y+1) < 0.4)) {
    e = Math.max(e, OUTLINE);
  }
  edge[i] = Math.min(1, e);
}
for (let pass = 0; pass < WEIGHT; pass++) {
  const nx = new Float32Array(W * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
    nx[y * W + x] = Math.max(edge[y*W+x], at(edge,x-1,y), at(edge,x+1,y), at(edge,x,y-1), at(edge,x,y+1));
  }
  edge = nx;
}

// White pixels, alpha = line strength. Used as a CSS mask, so only the alpha channel matters.
const out = Buffer.alloc(W * h * 4);
let solid = 0, sum = 0;
for (let p = 0; p < W * h; p++) {
  const a = Math.round(edge[p] * 255);
  out[p*4] = out[p*4+1] = out[p*4+2] = 255;
  out[p*4+3] = a;
  sum += a; if (a > 200) solid++;
}
await sharp(out, { raw: { width: W, height: h, channels: 4 } }).webp({ quality: 92, alphaQuality: 100 }).toFile(OUT);

const { size } = await sharp(OUT).metadata().then(async m => ({ ...m, size: (await import('node:fs')).statSync(OUT).size }));
console.log(`wrote ${OUT}`);
console.log(`  ${W}x${h}  ${(size / 1024).toFixed(1)} KB`);
console.log(`  solid line pixels: ${(solid / (W * h) * 100).toFixed(1)}%   mean alpha: ${(sum / (W * h)).toFixed(1)}/255`);
if (solid / (W * h) < 0.02) console.warn('  WARNING: mask looks like a ghost — lines will not read on screen');
