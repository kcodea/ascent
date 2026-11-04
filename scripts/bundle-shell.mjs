/**
 * Bundle the desktop shell into apps/desktop/build/ — the single input both packagers consume.
 *
 *   node scripts/bundle-shell.mjs
 *     → apps/desktop/build/main.cjs      (esbuild bundle of apps/desktop/main.cjs; `electron` stays external)
 *     → apps/desktop/build/preload.cjs   (copied verbatim — it runs sandboxed and cannot be bundled with deps)
 *     → apps/desktop/build/icon.png      (the runtime window icon)
 *     → apps/desktop/build/package.json  (name / productName / version / main, so electron-builder reads the app dir)
 *
 * Why bundle: the packaged app has no node_modules next to main.cjs, so any npm dependency the shell imports
 * (e.g. electron-updater) has to be inlined. `scripts/package-desktop.mjs` (local zip) and electron-builder
 * (CI installer, apps/desktop/electron-builder.json → directories.app = build) both read this folder.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');
const out = path.join(desktop, 'build');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(desktop, 'main.cjs')],
  outfile: path.join(out, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'info',
});

for (const f of ['preload.cjs', 'icon.png']) copyFileSync(path.join(desktop, f), path.join(out, f));

const version = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify({ name: 'ascent', productName: 'ASCENT', version, description: 'ASCENT', main: 'main.cjs', author: 'kcodea' }, null, 2)}\n`,
);
console.log(`✓ shell bundled → ${path.relative(root, out)} (v${version})`);
