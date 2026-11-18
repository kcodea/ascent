// Copies the game's art into apps/site/public/art/ per src/artManifest.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const REPO = resolve(SITE, '../..');
const manifest = JSON.parse(readFileSync(resolve(SITE, 'src/artManifest.json'), 'utf8'));

let copied = 0;
for (const [key, src] of Object.entries(manifest)) {
  const from = resolve(REPO, src);
  if (!existsSync(from)) {
    console.error(`sync-art: missing source for "${key}": ${src}`);
    process.exit(1);
  }
  const to = resolve(SITE, 'public/art', key);
  if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
console.log(`sync-art: ${copied} copied, ${Object.keys(manifest).length - copied} up to date`);
