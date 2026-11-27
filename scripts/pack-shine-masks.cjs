/* eslint-disable @typescript-eslint/no-require-imports */
// PACK SHINE MASKS (the pack opening's holo, packages/ui/src/progression/packOpening/packHolo*.ts).
// Usage: node scripts/pack-shine-masks.cjs <srcDir> <outDir> [previewPng]
//   <srcDir>  the 600 x 900 cut pack wrappers, normally apps/web/public/packs (<id>-pack.webp)
//   <outDir>  where <id>-pack-shine.webp lands, normally apps/web/public/packs
// A first pass generated from the art; a hand-painted 300 x 450 greyscale mask may replace any output (light = holo
// shows, dark = matte, aligned 1:1 with the wrapper at half resolution).
// Greyscale shine masks from the cut pack wrappers: light = holo shows, dark = matte.
// Metallic / embossed parts (bright, low-saturation silver; bright gold highlights; the logo and emblem) catch the
// holo; flat painted sky and dark areas stay mostly matte. Output: 300 x 450 greyscale webp per pack.
const sharp = require('sharp');
const [, , SRC_DIR, OUT_DIR, PREVIEW] = process.argv;
const IDS = ['common', 'rare', 'epic', 'legendary', 'ancient', 'secret', 'launch', 'scribble', 'plushie', 'eightbit', 'voxel', 'lowpoly', 'sketchbook', 'encore'];
const W = 300, H = 450;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

(async () => {
  const previews = [];
  for (const id of IDS) {
    const { data } = await sharp(`${SRC_DIR}/${id}-pack.webp`).resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255, a = data[i * 4 + 3] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      const metal = smooth(0.45, 0.85, L) * (1 - 0.6 * smooth(0.25, 0.7, sat)); // bright + greyish = metal
      const spark = smooth(0.8, 0.98, mx); // hot highlights of any hue (gold, gems)
      const base = 0.18; // a little holo everywhere so the foil reads as one sheet
      out[i] = Math.round(255 * a * Math.min(1, base + 0.75 * metal + 0.5 * spark));
    }
    const img = sharp(out, { raw: { width: W, height: H, channels: 1 } });
    await img.clone().webp({ quality: 80, effort: 6 }).toFile(`${OUT_DIR}/${id}-pack-shine.webp`);
    previews.push(await img.clone().png().toBuffer());
  }
  if (PREVIEW) {
    await sharp({ create: { width: W * IDS.length, height: H, channels: 3, background: '#000' } })
      .composite(previews.map((p, i) => ({ input: p, left: i * W, top: 0 }))).png().toFile(PREVIEW);
  }
})();
