/**
 * Board art export — maps the 8192×3542 Aug-25 board masters onto the SHIPPED board's framing.
 *
 * The game's UI (buttons, zones, charge glyph) is tuned against the frame position of the original
 * `augustfullboard.webp` (3840×2143, exported 2026-08-17 from the older 5504×3072 master). The Aug-25
 * masters are the same design rendered at a tighter crop, so a fixed transform — found by image
 * registration (mean-abs-diff grid search of uniform scale + offset against the shipped webp, verified
 * by a 50/50 pixel blend showing a single crisp frame) — places their painted frame on exactly the
 * same canvas pixels. The masters carry less purple surround vertically; the shortfall is filled by
 * edge-row replication (`extendWith: 'copy'`), which the board's 1.25× overscan keeps almost entirely
 * off-screen.
 *
 * Run: `npm run board:export` (masters live in the owner's `Desktop/Reference Art`; pass
 * `--src <dir>` if they move). Re-run only when a master is re-exported; commit the webps it writes.
 */
import path from 'node:path';
import sharp from 'sharp';

const CANVAS_W = 3840;
const CANVAS_H = 2143;
// Registered transform (2026-08-27): uniform scale, no horizontal shift, +260 px vertical placement.
const SCALE = 0.469;
const LEFT_CROP = 0;
const TOP_PAD = 260;
const QUALITY = 82;

const srcFlag = process.argv.indexOf('--src');
const SRC_DIR = srcFlag >= 0 ? process.argv[srcFlag + 1] : 'C:/Users/micha/Desktop/Reference Art';
const OUT_DIR = path.resolve('apps/web/public');

const JOBS: ReadonlyArray<{ master: string; out: string }> = [
  { master: 'augustboard psd.png', out: 'augustfullboard.webp' },
  { master: 'augustboardcombat.png', out: 'augustboardcombat.webp' },
];

async function exportBoard(master: string, out: string): Promise<void> {
  const src = path.join(SRC_DIR, master);
  const meta = await sharp(src).metadata();
  if (meta.width !== 8192 || meta.height !== 3542) {
    throw new Error(`${master}: expected 8192x3542, got ${meta.width}x${meta.height} — re-derive the transform before exporting.`);
  }
  const w = Math.round(8192 * SCALE); // 3842
  const h = Math.round(3542 * SCALE); // 1661
  const dest = path.join(OUT_DIR, out);
  await sharp(src)
    .resize(w, h)
    .extract({ left: LEFT_CROP, top: 0, width: CANVAS_W, height: h })
    .extend({ top: TOP_PAD, bottom: CANVAS_H - TOP_PAD - h, extendWith: 'copy' })
    .webp({ quality: QUALITY })
    .toFile(dest);
  const outMeta = await sharp(dest).metadata();
  console.log(`${out}: ${outMeta.width}x${outMeta.height}`);
  if (outMeta.width !== CANVAS_W || outMeta.height !== CANVAS_H) throw new Error(`${out}: wrong output size`);
}

for (const j of JOBS) await exportBoard(j.master, j.out);
