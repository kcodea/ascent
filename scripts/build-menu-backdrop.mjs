// MENU BACKDROPS (UI refinement WS-1, 2026-10-16): turn one painted backdrop into the two files the menu
// backdrop layer (`packages/ui/src/MenuBackdrop.tsx`) ships, so nothing is blurred or darkened at RUNTIME
// (a live `filter` / `backdrop-filter` over the whole stage costs every frame; see docs/performance.md).
//
//   node scripts/build-menu-backdrop.mjs <source image> <name>
//
// writes apps/web/public/backdrops/ (public, like homescreen.webp: the art tree has a 512 px cap and a file budget)
//   <name>.webp      the crisp plate, 1920x1080 (16:9 cover crop). Lanczos upscale + a light unsharp pass, so
//                    a source a little under 1920 wide does not read soft on the 1080p stage.
//   <name>-dim.webp  the pre-blurred, pre-darkened plate for data screens (Career, Leaderboard, ...), 960x540:
//                    it is a blur, so half resolution loses nothing and saves most of the bytes.
//   <name>-soft.webp a SLIGHTLY blurred plate for a scene that carries tiles (the Mode screen; owner 2026-10-16: "add
//                    a slight blur to the background play image"): a ~3px blur at 1920x1080, not darkened.
// Re-run it with the same <name> to replace a backdrop; the layer picks the files up by name.
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , src, name] = process.argv;
if (!src || !name) { console.error('usage: node scripts/build-menu-backdrop.mjs <source> <name>'); process.exit(1); }
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/web/public/backdrops');
mkdirSync(OUT, { recursive: true });

const crisp = join(OUT, `${name}.webp`);
await sharp(src)
  .resize(1920, 1080, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
  .sharpen({ sigma: 0.7, m1: 0.6, m2: 1.2 })
  .webp({ quality: 84, effort: 6 })
  .toFile(crisp);

// Dim: blur at full size (so the blur radius is in stage px), darken + desaturate a touch, then lay the menu
// navy over it so panels sit on a calm, on-palette ground. Downscale last.
const NAVY = { r: 8, g: 18, b: 40 };
const blurred = await sharp(src)
  .resize(1920, 1080, { fit: 'cover', position: 'centre' })
  .blur(18)
  .modulate({ brightness: 0.62, saturation: 0.82 })
  .toBuffer();
const tinted = await sharp(blurred)
  .composite([{ input: { create: { width: 1920, height: 1080, channels: 4, background: { ...NAVY, alpha: 0.42 } } }, blend: 'over' }])
  .toBuffer();
const dim = join(OUT, `${name}-dim.webp`);
await sharp(tinted)
  .resize(960, 540, { kernel: 'lanczos3' })
  .webp({ quality: 90, effort: 6 }) // high quality: a blurred plate bands easily when the stage scales it 2x
  .toFile(dim);

// Soft: the crisp plate with a light blur (radius in stage px), full colour and full size (a 3px blur still shows
// detail, so it keeps the 1080p resolution).
const soft = join(OUT, `${name}-soft.webp`);
await sharp(src)
  .resize(1920, 1080, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
  .blur(3)
  .webp({ quality: 84, effort: 6 })
  .toFile(soft);

for (const f of [crisp, dim, soft]) console.log(`${f}  ${Math.round(statSync(f).size / 1024)} KB`);
