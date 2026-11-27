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
//
// DEPTH (owner 2026-11-26: "lets run the depth model on all 13 wrappers"): when scripts/pack-depth/<id>.png exists (a
// grey depth picture of the wrapper from the Depth Anything V2 model, white = nearest), it REPLACES layers 1 and 2: the
// shapes the model saw (emblem, logo, island, clouds) rise as themselves instead of by how bright their paint is. The
// depth is measured against its own wide average, so the scene's far sky is not one deep pit. Layer 3 still adds the
// fine detail. A new wrapper needs its depth picture made once (the model is not in the repo; see docs/devlog).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const [, , SRC_DIR, OUT_DIR, PREVIEW] = process.argv;
const DEPTH_DIR = path.join(__dirname, 'pack-depth');
/** How strongly the depth model's shapes count, and how wide "its own average" is (pixels of the 300 x 450 map). */
const DEPTH_UP = 2.2, DEPTH_WIDE = 20;
/** Facets: how alike two neighbours' colours must be to share a face (sum of the three channels, 0..765), how much of the smooth lean a face keeps, and how much its painted brightness leans it. */
const FACET_TOL = 46, FACET_SHAPE = 1.6, FACET_LIT = 1.6;
/** Tiles: a block's size (points of the double-size map), the height of one terrace, how hard a step leans, and each block's own faint bevel. */
const TILE = 4, TILE_STEP = 0.09, TILE_SLOPE = 7, TILE_BEVEL = 0.012;
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
  eightbit: { forms: 0.3, parts: 0.3, detail: 0.6, slope: 5, ground: 1, style: 'tiles' },   // printed pixels: flat terraces of blocks
  voxel: { forms: 0.45, parts: 0.4, detail: 0.5, slope: 5.5, ground: 1, style: 'facets' }, // glossy blocks: one lean per face
  lowpoly: { forms: 0.45, parts: 0.45, detail: 0.4, slope: 5.5, ground: 1, style: 'facets' }, // glossy facets: one lean per face
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
    const depthFile = path.join(DEPTH_DIR, `${id}.png`);
    let shape = null;
    if (fs.existsSync(depthFile)) {
      const dep = Float32Array.from(await sharp(depthFile).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer(), (v) => v / 255);
      const near = blur(dep, 1), wide = blur(dep, DEPTH_WIDE);
      shape = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) shape[i] = (near[i] - wide[i]) * DEPTH_UP;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (shape) { height[i] = alpha[i] * (shape[i] + k.detail * (detail[i] - forms[i]) * 2); continue; }
      let parts = 0;
      for (const p of PARTS) {
        const dx = (x / W - p.cx) / p.rx, dy = (y / H - p.cy) / p.ry, d = dx * dx + dy * dy;
        if (d < 1) { const t = 1 - d; parts = Math.max(parts, p.up * t * t * (3 - 2 * t)); }
      }
      // forms and detail are measured against the wide average, so a bright pack is not one big hill
      height[i] = alpha[i] * (k.forms * (forms[i] - base[i]) * 2 + k.parts * parts + k.detail * (detail[i] - forms[i]) * 2);
    }
    const hs = blur(height, 1);
    // the lean at each point: downhill, so a slope facing left has a negative x
    const nx = new Float32Array(W * H), ny = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const l = hs[y * W + Math.max(0, x - 1)], r = hs[y * W + Math.min(W - 1, x + 1)];
      const u = hs[Math.max(0, y - 1) * W + x], d = hs[Math.min(H - 1, y + 1) * W + x];
      nx[i] = Math.max(-1, Math.min(1, (l - r) * k.slope)); ny[i] = Math.max(-1, Math.min(1, (u - d) * k.slope));
    }
    let ow = W, oh = H, crisp = false;
    let lean = (x, y) => [nx[y * W + x], ny[y * W + x]];
    if (k.style === 'facets') {
      // FACETS (owner 2026-11-27, the Voxel pack: "give those unique maps a try"): the art is cut into its flat faces
      // (neighbours of nearly one colour), and each face gets ONE lean: the average of the smooth lean over it, plus how
      // much brighter the face is painted than its surroundings (a lit face leans toward the light). A whole face
      // catches the light at once, and the edges between faces stay sharp.
      crisp = true;
      const region = new Int32Array(W * H).fill(-1), sums = [];
      const stack = [];
      for (let s = 0; s < W * H; s++) {
        if (region[s] >= 0) continue;
        const id2 = sums.length, sr = data[s * 4], sg = data[s * 4 + 1], sb = data[s * 4 + 2];
        const acc = { n: 0, nx: 0, ny: 0, lum: 0, base: 0 };
        region[s] = id2; stack.push(s);
        while (stack.length) {
          const i = stack.pop(), x = i % W, y = (i - x) / W;
          acc.n++; acc.nx += nx[i]; acc.ny += ny[i]; acc.lum += lum[i]; acc.base += base[i];
          for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
            if (j < 0 || region[j] >= 0) continue;
            if (Math.abs(data[j * 4] - sr) + Math.abs(data[j * 4 + 1] - sg) + Math.abs(data[j * 4 + 2] - sb) > FACET_TOL) continue;
            region[j] = id2; stack.push(j);
          }
        }
        sums.push(acc);
      }
      const face = sums.map((a) => {
        const lit = (a.lum - a.base) / a.n * FACET_LIT; // brighter than its surroundings = facing the light (up and left)
        return [Math.max(-1, Math.min(1, a.nx / a.n * FACET_SHAPE - 0.45 * lit)), Math.max(-1, Math.min(1, a.ny / a.n * FACET_SHAPE - 0.9 * lit))];
      });
      lean = (x, y) => face[region[y * W + x]];
    } else if (k.style === 'tiles') {
      // TILES (the 8 Bit pack): the height is read once per BLOCK (TILE x TILE points of a map twice the usual size) and
      // snapped to a few flat levels, so the surface is stacked flat terraces with stair-stepped edges; only a block's
      // rim leans, by the step to its neighbour, plus a faint bevel so each block reads as its own raised tile. The art
      // is painted to look pixelated and sits on no regular grid, so the blocks are this map's own.
      crisp = true;
      ow = W * 2; oh = H * 2;
      const gw = Math.ceil(ow / TILE), gh = Math.ceil(oh / TILE), q = new Float32Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        const mx = Math.min(W - 1, Math.floor((gx + 0.5) * TILE / 2)), my = Math.min(H - 1, Math.floor((gy + 0.5) * TILE / 2));
        q[gy * gw + gx] = Math.round(height[my * W + mx] / TILE_STEP) * TILE_STEP;
      }
      const at = (gx, gy) => q[Math.max(0, Math.min(gh - 1, gy)) * gw + Math.max(0, Math.min(gw - 1, gx))];
      lean = (x, y) => {
        const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE), px = x % TILE, py = y % TILE;
        let lx = 0, ly = 0;
        if (px === 0) lx = (at(gx - 1, gy) - at(gx, gy)) * TILE_SLOPE - TILE_BEVEL;
        else if (px === TILE - 1) lx = (at(gx, gy) - at(gx + 1, gy)) * TILE_SLOPE + TILE_BEVEL;
        if (py === 0) ly = (at(gx, gy - 1) - at(gx, gy)) * TILE_SLOPE - TILE_BEVEL;
        else if (py === TILE - 1) ly = (at(gx, gy) - at(gx, gy + 1)) * TILE_SLOPE + TILE_BEVEL;
        return [Math.max(-1, Math.min(1, lx)), Math.max(-1, Math.min(1, ly))];
      };
    }
    const out = Buffer.alloc(ow * oh * 3), sc = ow / W;
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const i = y * ow + x, m = Math.floor(y / sc) * W + Math.floor(x / sc);
      const [lx, ly] = lean(x, y);
      out[i * 3] = Math.round(127.5 + 127.5 * lx * alpha[m]);
      out[i * 3 + 1] = Math.round(127.5 + 127.5 * ly * alpha[m]);
      out[i * 3 + 2] = Math.round(255 * Math.max(0, Math.min(1, finish[m])));
    }
    const img = sharp(out, { raw: { width: ow, height: oh, channels: 3 } });
    await img.clone().webp(crisp ? { lossless: true } : { quality: 92 }).toFile(`${OUT_DIR}/${id}-pack-relief.webp`);
    previews.push({ input: await img.clone().resize(W, H, { kernel: 'nearest' }).png().toBuffer(), left: previews.length * (W + 10), top: 0 });
    console.log(id, 'relief written', k.style ?? 'smooth');
  }
  if (PREVIEW) await sharp({ create: { width: previews.length * (W + 10), height: H, channels: 3, background: '#000' } }).composite(previews).png().toFile(PREVIEW);
})();
