/**
 * Board art export — maps the 8192×3542 Aug-25 board masters onto the SHIPPED board's framing.
 *
 * The game's UI (buttons, zones, charge glyph) is tuned against the frame position of the original
 * `augustfullboard.webp` (3840×2143, exported 2026-08-17 from the older 5504×3072 master), so the
 * masters must land their painted frame on exactly those canvas pixels. The transform is PER-AXIS:
 * the two renders' frame proportions differ ~2% vertically (the first, uniform-scale registration
 * split that error across all four edges — the owner saw the whole frame sit ~17 px high and ~7 px
 * left, 2026-08-27). The per-axis scale + offset below were solved directly from the frame's outer
 * gold edges in both images (old L978 R2929 T447 B1428 ↔ master L2064 R6234 T362 B2501), landing
 * every edge within ~1 px; the ~2% anisotropy is invisible on the ornaments. The masters carry less
 * purple surround than the canvas needs; the shortfall is filled by edge replication
 * (`extendWith: 'copy'`), which the board's 1.25× overscan keeps almost entirely off-screen.
 *
 * Run: `npm run board:export` (masters live in the owner's `Desktop/Reference Art`; pass
 * `--src <dir>` if they move). Re-run only when a master is re-exported; commit the webps it writes.
 */
import path from 'node:path';
import sharp from 'sharp';

const CANVAS_W = 3840;
const CANVAS_H = 2143;
// Per-axis transform (2026-08-27, second pass): exportX = masterX·SCALE_X + LEFT_PAD,
// exportY = masterY·SCALE_Y + TOP_PAD. Solved from the frame-edge correspondences in the header.
const SCALE_X = 0.468763;
const SCALE_Y = 0.461533;
const LEFT_PAD = 9;
const TOP_PAD = 274;
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
  const w = Math.round(8192 * SCALE_X); // 3832 — narrower than the canvas; LEFT_PAD + right overflow cover it
  const h = Math.round(3542 * SCALE_Y); // 1625
  const dest = path.join(OUT_DIR, out);
  // Two stages so the operation order is explicit (sharp reorders ops inside a single chain):
  // 1) non-uniform scale, then pad to the placement offsets; 2) trim the overflow to the canvas.
  const placed = await sharp(src)
    .resize(w, h, { fit: 'fill' })
    .extend({ left: LEFT_PAD, top: TOP_PAD, bottom: CANVAS_H - TOP_PAD - h, extendWith: 'copy' })
    .png()
    .toBuffer();
  await sharp(placed)
    .extract({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H })
    .webp({ quality: QUALITY })
    .toFile(dest);
  const outMeta = await sharp(dest).metadata();
  console.log(`${out}: ${outMeta.width}x${outMeta.height}`);
  if (outMeta.width !== CANVAS_W || outMeta.height !== CANVAS_H) throw new Error(`${out}: wrong output size`);
}

for (const j of JOBS) await exportBoard(j.master, j.out);
