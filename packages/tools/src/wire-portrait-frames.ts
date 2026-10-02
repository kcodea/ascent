/**
 * `npm run art:frames` — wire the PORTRAIT FRAME cosmetics' art (owner 2026-10-01: "we're adding portrait skins:
 * C:\Game Assets\Ascent Art\Skins\Portraits. we want this to replace the default portrait png when a skin is applied").
 *
 * Attributed by the CATALOG, never by guessing: every `portrait_frame` item in packages/progression/src/cosmetics.ts
 * names its master (`assets.master`, relative to the Portraits folder) and its in-repo key (`assets.art`). For each:
 *   1. the master is written as `packages/ui/src/art/frames/skins/<key>.webp`, fit inside 768 x 768 (the size the
 *      tuner's frames in art/frames ship at), alpha kept;
 *   2. the ring's transparent HOLE is MEASURED off the master's alpha, the same quantities the tuner frames carry
 *      (`FrameArt` in packages/ui/src/portraitFrame/portraitFrameConfig.ts): the image aspect (h / w), the hole's
 *      diameter as a fraction of the image width and its centre as fractions of width / height;
 *   3. every measurement is written to `packages/ui/src/portraitFrame/frameSkins.data.json`, which the config reads.
 *
 * THE MEASUREMENT. From a centre guess, 720 rays walk outward until they meet an opaque pixel (alpha >= 128): that
 * distance is the hole's radius along the ray. The centre is then moved to the centroid of those boundary points and
 * the walk repeated (4 passes), so an off-centre ring is found. The hole's DIAMETER is twice the 75th-percentile ray:
 * a clean ring's rays all agree, and on an organic ring (flames, water, gems reaching inward) the portrait disc is
 * seated a little past most of the inner edge, so the ring's lip covers its rim the way the tuner frames' `LIP` does,
 * without stretching to the deepest gap.
 *
 * Without `--apply` it only prints what it would write.
 *
 * `--src <dir>` reads masters from another folder (owner 2026-10-01: "i dont have those folders. i just have each name").
 * A master is looked up at `<dir>/<Rarity>/<file>` first, then loose in `<dir>` ignoring spaces and case (so
 * `Epic/BlueEnergyFrame.png` finds `<dir>/Blue Energy Frame.png`), so a flat folder of PNGs works.
 * A frame whose master is not found KEEPS its existing webp and measured geometry (the data file is merged, never
 * rebuilt from scratch), so a batch can be wired from a machine that holds only the new masters.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// Relative, like progression-shared.ts: the catalog is dependency-free and @game/tools does not list the package.
import { COSMETICS } from '../../progression/src/cosmetics';

const APPLY = process.argv.includes('--apply');
const srcFlag = process.argv.indexOf('--src');
const SRC = srcFlag > 0 && process.argv[srcFlag + 1] ? process.argv[srcFlag + 1]! : 'C:/Game Assets/Ascent Art/Skins/Portraits';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const DEST = join(root, 'packages/ui/src/art/frames/skins');
const DATA = join(root, 'packages/ui/src/portraitFrame/frameSkins.data.json');
/** The tuner frames ship at 768 px; a ring never paints larger than a big portrait. */
const MAX_PX = 768;
const RAYS = 720;
const ALPHA_OPAQUE = 128;

export interface MeasuredFrame { aspect: number; holeD: number; holeCx: number; holeCy: number }

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Measure one ring's hole off its RGBA pixels (see the header). */
export function measureHole(px: Uint8Array | Buffer, w: number, h: number): MeasuredFrame {
  const opaque = (x: number, y: number): boolean => {
    const xi = Math.round(x); const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return true;
    return px[(yi * w + xi) * 4 + 3]! >= ALPHA_OPAQUE;
  };
  let cx = w / 2; let cy = h / 2;
  let radii: number[] = [];
  for (let pass = 0; pass < 4; pass++) {
    radii = [];
    let sx = 0; let sy = 0;
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const dx = Math.cos(a); const dy = Math.sin(a);
      let r = 0;
      while (r < Math.max(w, h) && !opaque(cx + dx * r, cy + dy * r)) r += 0.5;
      radii.push(r);
      sx += cx + dx * r; sy += cy + dy * r;
    }
    cx = sx / RAYS; cy = sy / RAYS;
  }
  const sorted = [...radii].sort((a, b) => a - b);
  const r75 = sorted[Math.floor(sorted.length * 0.75)]!;
  return { aspect: r4(h / w), holeD: r4((2 * r75) / w), holeCx: r4(cx / w), holeCy: r4(cy / h) };
}

/** A loose file in SRC whose name matches ignoring spaces and case. */
function loose(file: string): string | undefined {
  const norm = (n: string): string => n.replace(/\s+/g, '').toLowerCase();
  const hit = existsSync(SRC) ? readdirSync(SRC).find((n) => norm(n) === norm(file)) : undefined;
  return hit ? join(SRC, hit) : undefined;
}

async function main(): Promise<void> {
  const frames = COSMETICS.filter((c) => c.category === 'portrait_frame');
  const out: Record<string, MeasuredFrame> = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) as Record<string, MeasuredFrame> : {};
  let missing = 0; let wired = 0;
  for (const c of frames) {
    const master = c.assets.master; const key = c.assets.art;
    if (!master || !key) { console.log(`${c.id}: no assets.master / assets.art; not wired`); missing++; continue; }
    const src = existsSync(join(SRC, master)) ? join(SRC, master) : loose(basename(master));
    if (!src) {
      if (out[key]) { console.log(`${c.id}: master not in ${SRC}; keeping its existing art + geometry`); continue; }
      console.log(`${c.id}: master not found in ${SRC}; not wired`); missing++; continue;
    }
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const m = measureHole(data, info.width, info.height);
    out[key] = m; wired++;
    console.log(`${c.id.padEnd(20)} ${master.padEnd(28)} ${info.width}x${info.height}  holeD ${m.holeD}  centre ${m.holeCx}, ${m.holeCy}`);
    if (APPLY) {
      mkdirSync(DEST, { recursive: true });
      await sharp(src).resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toFile(join(DEST, `${key}.webp`));
    }
  }
  if (APPLY) {
    const sortedOut = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]!]));
    writeFileSync(DATA, `${JSON.stringify(sortedOut, null, 2)}\n`, 'utf8');
    console.log(`wired ${wired} frames into ${DEST}; ${DATA} now holds ${Object.keys(out).length}`);
  } else {
    console.log('dry run: pass --apply to write the webps and the geometry');
  }
  if (missing) process.exitCode = 1;
}

void main();
