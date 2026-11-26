/* eslint-disable @typescript-eslint/no-require-imports */
// PACK RELIEF MAPS (the pack's gloss band bends over them: packages/ui/src/progression/packOpening/packFx.ts GLOSS_FRAG).
// Usage: node scripts/pack-relief-maps.cjs <srcDir> <outDir> [previewPng]
//   <srcDir>  the 600 x 900 cut pack wrappers, normally apps/web/public/packs (<id>-pack.webp)
//   <outDir>  where <id>-pack-relief.webp lands, normally apps/web/public/packs
//
// A relief map says which way each point of the wrapper's surface leans, so a flat picture catches the light like an
// embossed one. It is a 300 x 450 image: R = the lean left/right, G = the lean up/down (128 = flat), B = the FINISH
// (255 = the glossy printed ground, 0 = a matte material standing on it, like felt).
//
// The finish comes from `ground`: a hue range ({ from, to } in degrees) reads it from the art's colour (that colour is
// the glossy ground, everything else the matte material on it); a number (0..1) is one finish for the whole wrapper
// (1 = printed foil all over, lower = a paper-like wrapper).
//
// The height is built from what the art shows, in three layers:
//   1. FORMS: the art's brightness, blurred wide. On these wrappers the things that stand proud (the emblem, the
//      lettering, the clouds, the island) are lighter than the ground behind them.
//   2. THE NAMED PARTS of the layout every wrapper shares (the pack template): the emblem, the ASCENT logo, the island
//      scene and the pack's name each get a soft swell of their own, so they rise as whole shapes, not only by brightness.
//   3. DETAIL: the art's brightness, blurred a little: stitches, letter edges, small ornaments.
// A hand-painted map (same layout) may replace any output.
const sharp = require('sharp');
const [, , SRC_DIR, OUT_DIR, PREVIEW] = process.argv;
// The wrappers that get a relief map, and how strongly each layer counts (forms, parts, detail) and the overall slope.
const PACKS = {
  plushie: { forms: 0.5, parts: 0.42, detail: 0.3, slope: 5.5, ground: { from: 250, to: 340 } }, // felt on a purple sky
  // the painted foil wrappers: a metal emblem and logo standing proud of a soft painted scene
  common: { forms: 0.4, parts: 0.5, detail: 0.34, slope: 5.5, ground: 1 },
  rare: { forms: 0.4, parts: 0.5, detail: 0.34, slope: 5.5, ground: 1 },
  epic: { forms: 0.4, parts: 0.5, detail: 0.34, slope: 5.5, ground: 1 },
  legendary: { forms: 0.4, parts: 0.5, detail: 0.34, slope: 5.5, ground: 1 },
  ancient: { forms: 0.36, parts: 0.5, detail: 0.34, slope: 5.5, ground: 1 },
  secret: { forms: 0.4, parts: 0.5, detail: 0.34, slope: 5.5, ground: 1 },
  launch: { forms: 0.4, parts: 0.5, detail: 0.34, slope: 5.5, ground: 1 },
  // the style wrappers
  scribble: { forms: 0.3, parts: 0.3, detail: 0.5, slope: 5, ground: 0.4 },    // crayon on paper: waxy strokes, little form
  eightbit: { forms: 0.3, parts: 0.3, detail: 0.6, slope: 5, ground: 1 },      // printed pixels: crisp steps
  voxel: { forms: 0.45, parts: 0.4, detail: 0.5, slope: 5.5, ground: 1 },      // glossy blocks
  lowpoly: { forms: 0.45, parts: 0.45, detail: 0.4, slope: 5.5, ground: 1 },   // glossy facets
  sketchbook: { forms: 0.2, parts: 0.25, detail: 0.5, slope: 4.5, ground: 0.3 }, // pencil on paper: nearly flat, the lines bite in
};
// The template's named parts, as soft ellipses in shares of the wrapper (cx, cy, rx, ry) and their swell.
const PARTS = [
  { name: 'emblem', cx: 0.5, cy: 0.265, rx: 0.2, ry: 0.13, up: 1 },
  { name: 'logo', cx: 0.5, cy: 0.445, rx: 0.4, ry: 0.06, up: 0.8 },
  { name: 'island', cx: 0.5, cy: 0.66, rx: 0.34, ry: 0.13, up: 0.7 },
  { name: 'name', cx: 0.5, cy: 0.875, rx: 0.36, ry: 0.045, up: 0.7 },
];
const W = 300, H = 450;

function blur(src, r) {
  // two box passes each way: close to a Gaussian, and cheap
  let a = Float32Array.from(src);
  const b = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += a[y * W + xx]; n++; } }
      b[y * W + x] = s / n;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += b[yy * W + x]; n++; } }
      a[y * W + x] = s / n;
    }
  }
  return a;
}

(async () => {
  const previews = [];
  for (const [id, k] of Object.entries(PACKS)) {
    const { data } = await sharp(`${SRC_DIR}/${id}-pack.webp`).resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const lum = new Float32Array(W * H), alpha = new Float32Array(W * H), ground = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
      alpha[i] = data[i * 4 + 3] / 255;
      // the ground: inside the wrapper's ground hue range (20 degrees of soft edge), and clearly bluer than green
      const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
      const mx = Math.max(r, g, b), c = mx - Math.min(r, g, b);
      let h = 0;
      if (c > 0) h = 60 * (mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4);
      if (typeof k.ground === 'number') { ground[i] = k.ground; continue; }
      const hueIn = h > k.ground.from && h < k.ground.to ? Math.min(1, Math.min(h - k.ground.from, k.ground.to - h) / 20) : 0;
      ground[i] = hueIn * Math.min(1, Math.max(0, (b - g) * 5)) * alpha[i];
    }
    const finish = typeof k.ground === 'number' ? ground : blur(ground, 1);
    const forms = blur(lum, 7), detail = blur(lum, 1), base = blur(lum, 18);
    const height = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let parts = 0;
      for (const p of PARTS) {
        const dx = (x / W - p.cx) / p.rx, dy = (y / H - p.cy) / p.ry, d = dx * dx + dy * dy;
        if (d < 1) { const t = 1 - d; parts = Math.max(parts, p.up * t * t * (3 - 2 * t)); }
      }
      // forms and detail are measured against the wide average, so a bright pack is not one big hill
      height[i] = alpha[i] * (k.forms * (forms[i] - base[i]) * 2 + k.parts * parts + k.detail * (detail[i] - forms[i]) * 2);
    }
    const hs = blur(height, 1);
    const out = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const l = hs[y * W + Math.max(0, x - 1)], r = hs[y * W + Math.min(W - 1, x + 1)];
      const u = hs[Math.max(0, y - 1) * W + x], d = hs[Math.min(H - 1, y + 1) * W + x];
      // the lean: downhill, so a slope facing left has a negative x
      const nx = Math.max(-1, Math.min(1, (l - r) * k.slope)), ny = Math.max(-1, Math.min(1, (u - d) * k.slope));
      out[i * 3] = Math.round(127.5 + 127.5 * nx * alpha[i]);
      out[i * 3 + 1] = Math.round(127.5 + 127.5 * ny * alpha[i]);
      out[i * 3 + 2] = Math.round(255 * Math.max(0, Math.min(1, finish[i])));
    }
    await sharp(out, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 92 }).toFile(`${OUT_DIR}/${id}-pack-relief.webp`);
    previews.push({ input: await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer(), left: previews.length * (W + 10), top: 0 });
    console.log(id, 'relief written');
  }
  if (PREVIEW) await sharp({ create: { width: previews.length * (W + 10), height: H, channels: 3, background: '#000' } }).composite(previews).png().toFile(PREVIEW);
})();
