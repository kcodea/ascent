// Card-art optimizer: downscale to ≤512px (cards display at ~290px, so that's retina-crisp) and convert
// PNG → WebP at quality 85, preserving alpha. The high-res masters live under `C:\Game Assets\Ascent Art\`;
// this shrinks the in-repo build copies under packages/ui/src/art/<sub> and deletes the source PNG.
//
// Workflow: drop <id>.png into art/{minions,heroes,effects,spells,...}, then `npm run optimize-art`.
// Idempotent — only .png files are processed, so a re-run on an all-WebP dir is a no-op.
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['minions', 'heroes', 'effects', 'equipment', 'powers', 'quests', 'runes', 'spells', 'modes', 'ranks', 'skins', 'frames', 'emotes'].map((s) => join(ROOT, 'packages/ui/src/art', s));
const MAX = 512;
// Hero portrait FRAMES (ring overlays) paint LARGER than a card portrait: the in-game portrait and the Now Facing
// splash draw the ring at ~350 design px, so they keep 768px to stay crisp on a 1440p/4K stage.
const MAX_BY_DIR = { frames: 768 };
const QUALITY = 85;

let before = 0;
let after = 0;
let n = 0;
for (const dir of DIRS) {
  if (!existsSync(dir)) continue; // a sub-dir (e.g. effects/) may not exist in every checkout — skip it
  for (const f of readdirSync(dir)) {
    if (!/\.(png|jpe?g)$/i.test(f)) continue; // source masters may be PNG or JPEG
    const src = join(dir, f);
    const webp = src.replace(/\.(png|jpe?g)$/i, '.webp');
    const b0 = statSync(src).size;
    await sharp(src)
      .resize(MAX_BY_DIR[basename(dir)] ?? MAX, MAX_BY_DIR[basename(dir)] ?? MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 6 })
      .toFile(webp);
    const b1 = statSync(webp).size;
    unlinkSync(src); // the WebP replaces the source; the high-res master is retained out-of-repo
    before += b0;
    after += b1;
    n++;
    console.log(`  ${f.replace(/\.(png|jpe?g)$/i, '').padEnd(20)} ${String(Math.round(b0 / 1024)).padStart(5)}KB → ${String(Math.round(b1 / 1024)).padStart(4)}KB`);
  }
}
console.log(
  n
    ? `\n${n} files: ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(2)}MB  (${(100 * (1 - after / before)).toFixed(1)}% smaller)`
    : 'No .png files to convert (already WebP).',
);

// ─── DERIVED CARD FRAMES (R-PERF-FRAME-SIZE-01, 2026-11-18) ──────────────────────────────────────────────────────
// The card frames in apps/web/public/frames (every tribe's oval and Taunt shield, their Gilded versions, the two shared
// ones) are 1059x1427 / 1086x1448: about 6 MB decoded EACH, and a card draws one at 150 to 285 px wide on a 1080p
// screen (567 px on a 4K one, the Inspect card, the largest use there is). This writes a 640 px wide copy of each into
// frames/w640/, which is what a desktop loads (`cardFrameArt` in packages/ui/src/phoneArt.ts; phones keep their own
// 512 px build copies, and a screen taller than 2,370 device px keeps the full-size files).
// The full-size files are NEVER written to, re-toned or removed: a copy is a plain Lanczos resize of the same pixels.
// Idempotent: a copy newer than its source is left alone.
const FRAME_DERIVED_WIDTH = 640;
const FRAME_SRC = join(ROOT, 'apps/web/public/frames');
const FRAME_OUT = join(FRAME_SRC, `w${FRAME_DERIVED_WIDTH}`);
const FRAME_RE = /^(?:oval-[a-z]+(?:-gilded)?\.webp|taunt-[a-z]+(?:-gilded)?\.webp|taunt-shield\.png|standard-oval-v2\.png)$/;
let derived = 0;
if (existsSync(FRAME_SRC)) {
  mkdirSync(FRAME_OUT, { recursive: true });
  for (const f of readdirSync(FRAME_SRC)) {
    if (!FRAME_RE.test(f)) continue;
    const src = join(FRAME_SRC, f);
    const out = join(FRAME_OUT, f.replace(/\.(png|webp)$/i, '.webp'));
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && !process.argv.includes('--force-frames')) continue;
    await sharp(src)
      .resize({ width: FRAME_DERIVED_WIDTH, kernel: 'lanczos3', withoutEnlargement: true })
      .webp({ quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true })
      .toFile(out);
    derived++;
    console.log(`  frames/w${FRAME_DERIVED_WIDTH}/${basename(out).padEnd(28)} ${String(Math.round(statSync(src).size / 1024)).padStart(5)}KB → ${String(Math.round(statSync(out).size / 1024)).padStart(4)}KB`);
  }
}
console.log(derived ? `
${derived} derived card frames written (${FRAME_DERIVED_WIDTH} px wide).` : `Derived card frames are up to date (${FRAME_DERIVED_WIDTH} px wide).`);
