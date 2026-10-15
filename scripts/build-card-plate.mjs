#!/usr/bin/env node
/**
 * BUILD A LAYERED CARD PLATE's files (owner 2026-10-15: "going forward i think its better to do it this way, with the
 * layers, and we can create different bottom layers. if i dont specify, just default to the brown one").
 *
 *   npm run plates:build -- --id plate_blossom --frame "C:/Users/micha/Desktop/Reference Art/Card Backplates/Blossom.png"
 *   npm run plates:build -- --id plate_beach --interior water --interior-sx 1.083 --interior-sy 1.03 --interior-y 0.002
 *                                                                   (rebuild the Collection image only)
 *   npm run plates:build -- --interior-src "C:/.../Blue Interior.png" --interior blue   (add a shared interior)
 *   npm run plates:build -- --id plate_beach --interior water --fit   (measure interiorSx / interiorSy / interiorY)
 *
 * Writes into apps/web/public/frames/plates/:
 *   <id>-frame.webp    the frame layer, 800x1244 (the standard plate body)
 *   <id>-backbox.webp  its text darkening, a copy of Aquarium Rocks' shape (drop it with `darken: false`)
 *   <id>.webp          the Collection image: the interior seated in the frame at the in-game proportions
 *   interiors/<name>.webp  (with --interior-src) a shared interior, kept at its own size (the darkening's box)
 *
 * The geometry mirrors styles.css / cardPlateLook.ts: the plate is 1.5 card widths wide and 2.3325 tall, lifted
 * 37px at the tuned 138px card; the interior is 1.08 card widths wide (x `interiorSx`), centred, its top at card width
 * x (1.085 + boxY) at the tuned card, i.e. 5.4463% down the plate (styles.css anchors it to the FRAME). The interior
 * moves WITH the frame's `frameX` nudge, so the Collection image needs no nudge; --interior-sx / -sy / -y must match
 * the plate's interiorSx / interiorSy / interiorY. Then add the plate to cosmetics.ts and to SETTINGS in
 * cardPlateLook.ts with `layered: true`.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'apps/web/public/frames/plates');
const W = 800, H = 1244;
const BOX_Y = -1.22595, TUNED_CCW = 138.067, PLATE_TOP_PX = 37;
/** How far the interior should tuck under the frame's opening on each side, px at 800 (Blossom's own margin). */
const TUCK = 8;

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const interior = args.interior ?? 'brown';
const interiorFile = join(OUT, 'interiors', `${interior}.webp`);

if (args['interior-src']) {
  mkdirSync(join(OUT, 'interiors'), { recursive: true });
  await sharp(args['interior-src']).webp({ quality: 90, alphaQuality: 100 }).toFile(interiorFile);
  console.log(`wrote interiors/${interior}.webp`);
}

if (args.id) {
  const id = args.id;
  if (!/^plate_[a-z0-9_]+$/.test(id)) throw new Error(`--id must look like plate_<name>, got ${id}`);
  const frameFile = join(OUT, `${id}-frame.webp`);
  if (args.frame) {
    await sharp(args.frame).resize(W, H, { fit: 'fill' }).webp({ quality: 90, alphaQuality: 100 }).toFile(frameFile);
    console.log(`wrote ${id}-frame.webp`);
  }
  if (!existsSync(frameFile)) throw new Error(`no ${id}-frame.webp yet: pass --frame <png>`);
  const backbox = join(OUT, `${id}-backbox.webp`);
  if (!existsSync(backbox)) {
    copyFileSync(join(OUT, 'plate_aquarium_rocks-backbox.webp'), backbox);
    console.log(`wrote ${id}-backbox.webp (Aquarium Rocks' darkening)`);
  }
  if (!existsSync(interiorFile)) throw new Error(`no interiors/${interior}.webp: add it with --interior-src`);

  const iw0 = Math.round((W * 1.08) / 1.5);
  const it = Math.round(H * ((1.085 + BOX_Y + PLATE_TOP_PX / TUNED_CCW) / (1.5 * 1.555)));

  const meta = await sharp(interiorFile).metadata();
  const ih = Math.round((iw0 * meta.height) / meta.width);
  /** px at the 800px plate -> card widths (the plate is 1.5 card widths wide). */
  const toCcw = (px) => (px * 1.5) / W;

  if (args.fit) {
    const f = await sharp(frameFile).ensureAlpha().raw().toBuffer();
    const opaque = (x, y) => f[(y * W + x) * 4 + 3] > 200;
    // 1) WIDTH: the stretch that tucks the interior's silhouette TUCK px under the opening on both sides, over the
    //    middle 60% of the plate's height.
    const ib0 = await sharp(interiorFile).resize({ width: iw0 }).ensureAlpha().raw().toBuffer();
    let fitSx = 1;
    for (let fr = 0.2; fr <= 0.8; fr += 0.05) {
      const y = Math.round(it + ih * fr), iy = Math.round(ih * fr);
      let L = W / 2, R = W / 2;
      while (L > 0 && !opaque(L, y)) L--;
      while (R < W - 1 && !opaque(R, y)) R++;
      let l = 0, r = iw0 - 1;
      while (l < iw0 && ib0[(iy * iw0 + l) * 4 + 3] <= 200) l++;
      while (r > 0 && ib0[(iy * iw0 + r) * 4 + 3] <= 200) r--;
      const half = iw0 / 2, off = (W - iw0) / 2;
      fitSx = Math.max(fitSx, (half - (L - TUCK - off)) / (half - l), (R + TUCK - off - half) / (r - half));
    }
    fitSx = Math.ceil(fitSx * 1000) / 1000;
    // 2) HEIGHT + NUDGE: over the middle columns, how far the interior must reach below its bottom and above its top
    //    to tuck TUCK px under the opening; stretch by the total and shift by the difference.
    const iw = Math.round(iw0 * fitSx), ox = Math.round((W - iw) / 2);
    const ib = await sharp(interiorFile).resize({ width: iw, height: ih, fit: 'fill' }).ensureAlpha().raw().toBuffer();
    let down = 0, up = 0;
    for (let x = 200; x <= 600; x += 10) {
      let y = Math.round(H / 2); while (y < H - 1 && !opaque(x, y)) y++; const openB = y;
      y = Math.round(H / 2); while (y > 0 && !opaque(x, y)) y--; const openT = y;
      const ix = x - ox;
      let b = ih - 1; while (b > 0 && ib[(b * iw + ix) * 4 + 3] <= 200) b--;
      let t = 0; while (t < ih && ib[(t * iw + ix) * 4 + 3] <= 200) t++;
      down = Math.max(down, openB + TUCK - (it + b));
      up = Math.max(up, it + t - (openT - TUCK));
    }
    const fitSy = Math.ceil(((ih + down + up) / ih) * 1000) / 1000;
    const fitY = Math.round(toCcw((down - up) / 2) * 10000) / 10000;
    console.log(`${id} on ${interior}: interiorSx ${fitSx}, interiorSy ${fitSy}, interiorY ${fitY}  (bottom short ${down}px, top short ${up}px)`);
  }

  // The Collection image: the interior (stretched by sx / sy, nudged by y, about its own centre, as the CSS does),
  // the frame on top, unshifted (the interior moves with the frame's nudge).
  const sx = Number(args['interior-sx'] ?? 1), sy = Number(args['interior-sy'] ?? 1), ny = Number(args['interior-y'] ?? 0);
  const iw = Math.round(iw0 * sx), ihs = Math.round(ih * sy);
  const top = Math.round(it + (ih - ihs) / 2 + (ny * W) / 1.5);
  const interiorBuf = await sharp(interiorFile).resize({ width: iw, height: ihs, fit: 'fill' }).png().toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: interiorBuf, left: Math.round((W - iw) / 2), top }, { input: frameFile, left: 0, top: 0 }])
    .webp({ quality: 90, alphaQuality: 100 }).toFile(join(OUT, `${id}.webp`));
  console.log(`wrote ${id}.webp (Collection image; interior ${interior}, sx ${sx}, sy ${sy}, y ${ny})`);
}
