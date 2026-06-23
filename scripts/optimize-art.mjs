// Card-art optimizer: downscale to ≤512px (cards display at ~290px, so that's retina-crisp) and convert
// PNG → WebP at quality 85, preserving alpha. The high-res masters live under `C:\Game Assets\Ascent Art\`;
// this shrinks the in-repo build copies under packages/ui/src/art/<sub> and deletes the source PNG.
//
// Workflow: drop <id>.png into art/{minions,heroes,effects}, then `npm run optimize-art`.
// Idempotent — only .png files are processed, so a re-run on an all-WebP dir is a no-op.
import sharp from 'sharp';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['minions', 'heroes', 'effects', 'powers'].map((s) => join(ROOT, 'packages/ui/src/art', s));
const MAX = 512;
const QUALITY = 85;

let before = 0;
let after = 0;
let n = 0;
for (const dir of DIRS) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.png')) continue;
    const png = join(dir, f);
    const webp = png.replace(/\.png$/, '.webp');
    const b0 = statSync(png).size;
    await sharp(png)
      .resize(MAX, MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 6 })
      .toFile(webp);
    const b1 = statSync(webp).size;
    unlinkSync(png); // the WebP replaces the PNG; the high-res master is retained out-of-repo
    before += b0;
    after += b1;
    n++;
    console.log(`  ${f.replace('.png', '').padEnd(20)} ${String(Math.round(b0 / 1024)).padStart(5)}KB → ${String(Math.round(b1 / 1024)).padStart(4)}KB`);
  }
}
console.log(
  n
    ? `\n${n} files: ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(2)}MB  (${(100 * (1 - after / before)).toFixed(1)}% smaller)`
    : 'No .png files to convert (already WebP).',
);
