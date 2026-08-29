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
 * every edge within ~1 px, then TRANSLATED -6/+4 px to zero the frame GEMS (the button anchors) against
 * the original board — the two renders differ ~2%, and the gems are what the UI visibly sits on (owner
 * report 2026-08-28: combat-only button drift); the ~2% anisotropy is invisible on the ornaments. The masters carry less
 * purple surround than the canvas needs; the shortfall is filled by stretched-and-blurred edge strips, which the board's 1.25× overscan keeps almost entirely off-screen.
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
const LEFT_PAD = 3;
const TOP_PAD = 278;
const QUALITY = 82;

const srcFlag = process.argv.indexOf('--src');
const SRC_DIR = srcFlag >= 0 ? process.argv[srcFlag + 1] : 'C:/Users/micha/Desktop/Reference Art';
const OUT_DIR = path.resolve('apps/web/public');

// BOTH boards come from the owner's Aug-25 twin masters (owner call 2026-08-29, reversing the brief
// 2026-08-28 keep-the-old-shop-file experiment): the two files are pixel-identical except the tray corner,
// so processing them through the same transform gives phase-consistent boards — buttons seat identically in
// shop and combat, and both carry the same (mostly overscan-hidden) pad bands.
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
  const w = Math.round(8192 * SCALE_X); // 3840 at the current scale
  const h = Math.round(3542 * SCALE_Y); // 1635
  const dest = path.join(OUT_DIR, out);
  // The vertical shortfall is TRANSPARENT (owner ask 2026-08-29): `.boardbg` fills the bands above/below
  // the painting with the owner-tunable vertical blend gradient (`--board-vedge-*`, Board Edge tuner) — the
  // vertical twin of the ultrawide side blend — instead of baked pixels. The painting occupies rows
  // TOP_PAD..TOP_PAD+h; styles.css mirrors those as art-height fractions (0.1297 / 0.8927 in `.boardbg`) for
  // the gradient's stops — UPDATE BOTH when this transform changes.
  const fitW = Math.min(w, CANVAS_W - LEFT_PAD);
  const scaled = await sharp(src).resize(w, h, { fit: 'fill' }).extract({ left: 0, top: 0, width: fitW, height: h }).png().toBuffer();
  await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, left: LEFT_PAD, top: TOP_PAD }])
    .webp({ quality: QUALITY })
    .toFile(dest);
  const outMeta = await sharp(dest).metadata();
  console.log(`${out}: ${outMeta.width}x${outMeta.height}`);
  if (outMeta.width !== CANVAS_W || outMeta.height !== CANVAS_H) throw new Error(`${out}: wrong output size`);
}

for (const j of JOBS) await exportBoard(j.master, j.out);
