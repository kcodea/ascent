// Copies the game's art into apps/site/public/art/ per src/artManifest.json. An entry is either a source path (copied
// as is) or { src, width, format } (resized to that width and re-encoded with sharp, for art shown far smaller than
// its source).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const REPO = resolve(SITE, '../..');
const manifest = JSON.parse(readFileSync(resolve(SITE, 'src/artManifest.json'), 'utf8'));

let written = 0;
for (const [key, entry] of Object.entries(manifest)) {
  const src = typeof entry === 'string' ? entry : entry.src;
  const from = resolve(REPO, src);
  if (!existsSync(from)) {
    console.error(`sync-art: missing source for "${key}": ${src}`);
    process.exit(1);
  }
  const to = resolve(SITE, 'public/art', key);
  if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  mkdirSync(dirname(to), { recursive: true });
  if (typeof entry === 'string') copyFileSync(from, to);
  else await sharp(from).resize({ width: entry.width }).toFormat(entry.format).toFile(to);
  written++;
}
console.log(`sync-art: ${written} written, ${Object.keys(manifest).length - written} up to date`);
