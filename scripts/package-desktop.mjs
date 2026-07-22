/**
 * Package the production web build into a runnable Windows .exe — WITHOUT electron-builder.
 *
 * Why not electron-builder: it shells out to `app-builder.exe` (from `app-builder-bin`), which Windows
 * Defender quarantines as a false positive on this machine — the binary is deleted from node_modules within
 * minutes of every install, so the build dies with a spurious `spawn … ENOENT` pointing at a path that did
 * exist. Rather than ask anyone to add AV exclusions, this does the packaging by hand.
 *
 * There is not much to it. Electron ships a prebuilt `electron.exe` that runs whatever app it finds in
 * `resources/app`, so "packaging" is a copy and a rename:
 *
 *   release/ASCENT-win32-x64/
 *     ASCENT.exe            ← node_modules/electron/dist/electron.exe, renamed
 *     …Electron runtime…    ← the rest of node_modules/electron/dist verbatim
 *     resources/app/        ← main.cjs + a minimal package.json (the shell)
 *     resources/dist/       ← apps/web/dist (the game), where main.cjs looks when app.isPackaged
 *
 * What this does NOT do (deliberately — it's a test harness, not a release pipeline): no installer, no code
 * signing, no icon, no auto-update. For an actual release those matter; for "does it run as an exe" they do
 * not, and every one of them is a reason electron-builder would have to come back.
 */
import { cp, mkdir, rm, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const webDist = path.join(root, 'apps', 'web', 'dist');
const out = path.join(root, 'apps', 'desktop', 'release', 'ASCENT-win32-x64');

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

if (!existsSync(electronDist)) die(`Electron runtime missing at ${electronDist} — run \`npm install\`.`);
if (!existsSync(path.join(webDist, 'index.html'))) die(`Web build missing at ${webDist} — run \`npm run build:web\`.`);

console.log('• clearing', path.relative(root, out));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

console.log('• copying the Electron runtime');
await cp(electronDist, out, { recursive: true });

// `resources/app` takes precedence over Electron's built-in default_app.asar (the "no app loaded" screen).
// Remove the asar anyway so a mistake here fails loudly instead of silently booting Electron's welcome page.
await rm(path.join(out, 'resources', 'default_app.asar'), { force: true });

console.log('• copying the shell');
const appDir = path.join(out, 'resources', 'app');
await mkdir(appDir, { recursive: true });
await cp(path.join(root, 'apps', 'desktop', 'main.cjs'), path.join(appDir, 'main.cjs'));
const version = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8')).version;
await writeFile(
  path.join(appDir, 'package.json'),
  `${JSON.stringify({ name: 'ascent', productName: 'ASCENT', version, main: 'main.cjs' }, null, 2)}\n`,
);

console.log('• copying the game build');
await cp(webDist, path.join(out, 'resources', 'dist'), { recursive: true });

console.log('• renaming electron.exe → ASCENT.exe');
await rename(path.join(out, 'electron.exe'), path.join(out, 'ASCENT.exe'));

const exe = path.join(out, 'ASCENT.exe');
if (!existsSync(exe)) die('ASCENT.exe was not produced.');
const { size } = await stat(exe);
console.log(`\n✓ ${path.relative(root, exe)}  (${(size / 1024 / 1024).toFixed(1)} MB exe, runtime alongside it)`);
console.log('  run it directly, or: npm run desktop  (unpackaged, faster iteration)');
