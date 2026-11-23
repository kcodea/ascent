// Builds the top section's layered art (public/hero) from the painted masters: four transparent team cut-outs and the
// sky behind them, plus the logo. Run by hand when a master changes:
//   node scripts/build-hero-art.mjs "<folder with the masters>" ["<logo file>"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/hero');
const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node scripts/build-hero-art.mjs "<folder with the masters>"');

/** Output name -> master file. Each cut-out is trimmed to its painted area so CSS can anchor it by its own edges. */
const LAYERS = {
  'left-front': 'drakkoparagon.png',
  'left-back': 'brianlastlight.png',
  'right-front': 'vosssylus.png',
  'right-back': 'oonarecaller.png',
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, file] of Object.entries(LAYERS)) {
  const out = path.join(OUT, `${name}.webp`);
  const info = await sharp(path.join(SRC, file)).trim().webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(out);
  console.log(name, `${info.width}x${info.height}`, `${Math.round(info.size / 1024)} KB`);
}
// Softened here, once, so the page never pays for a filter: the characters and the words read first. The darkening
// is the navy wash in the stylesheet (.top__tint).
const sky = await sharp(path.join(SRC, 'background 3.png')).blur(2.5).webp({ quality: 80, effort: 6 }).toFile(path.join(OUT, 'sky.webp'));
console.log('sky', `${sky.width}x${sky.height}`, `${Math.round(sky.size / 1024)} KB`);

// The logo (painted with its own shadow): trimmed, and at twice its largest drawn size.
const LOGO = process.argv[3];
if (LOGO) {
  const logo = await sharp(LOGO).trim().resize({ width: 480 }).webp({ quality: 90, alphaQuality: 95, effort: 6 }).toFile(path.join(OUT, 'logo.webp'));
  console.log('logo', `${logo.width}x${logo.height}`, `${Math.round(logo.size / 1024)} KB`);
}
