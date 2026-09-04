// Frame optimizer: downscale the card frames / plates / buttons under apps/web/public/frames to ≤768px on the
// long side, re-encoded as WebP at quality 90, alpha preserved. Idempotent (a file already within the cap is
// left byte-identical).
//
// WHY (owner report 2026-09-04, "performance degrades over time … very choppy" on a late dwarf/demon board):
// the frames shipped at their master size — a taunt frame is 1086×1448 (6.1 MB DECODED), a plate 800×1244
// (3.9 MB) — while a card is drawn at ~290 CSS px wide. A board + shop + hand shows ~20 of them, ~80 MB
// decoded, past the compositor's image-cache budget, so plates were evicted and re-decoded during play
// (asynchronously before #1359 = pop-in; synchronously after = frame cost). At ≤768px a taunt frame decodes to
// 1.7 MB and the whole set drops ~3.5×, so the cache holds a full screen and the decode work per eviction
// shrinks with it. 768 keeps a 2× display crisp at the largest card the game draws (the 1.3× overlays).
//
// Card ART is handled by scripts/optimize-art.mjs (≤512px); this covers the FRAME layer beside it.
import sharp from 'sharp';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/web/public/frames');
const MAX = 768;
const QUALITY = 90;

let before = 0;
let after = 0;
let decodedBefore = 0;
let decodedAfter = 0;
let n = 0;
for (const f of readdirSync(DIR).sort()) {
  if (!/\.webp$/i.test(f)) continue;
  const src = join(DIR, f);
  // Read into memory first: on Windows, writing over a file sharp still has open is EPERM.
  const input = readFileSync(src);
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  decodedBefore += w * h * 4;
  if (Math.max(w, h) <= MAX) { decodedAfter += w * h * 4; continue; }
  const out = await sharp(input)
    .resize(MAX, MAX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 6 })
    .toBuffer();
  writeFileSync(src, out);
  const b0 = input.length;
  const b1 = out.length;
  const m2 = await sharp(out).metadata();
  decodedAfter += (m2.width ?? 0) * (m2.height ?? 0) * 4;
  before += b0;
  after += b1;
  n++;
  console.log(`  ${f.padEnd(28)} ${w}×${h} → ${m2.width}×${m2.height}   ${String(Math.round(b0 / 1024)).padStart(4)}KB → ${String(Math.round(b1 / 1024)).padStart(4)}KB`);
}
console.log(`\n${n} frames downscaled: ${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB on disk; decoded ${Math.round(decodedBefore / 1048576)}MB → ${Math.round(decodedAfter / 1048576)}MB`);
