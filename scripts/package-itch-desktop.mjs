/**
 * Zip the Windows desktop build for itch.io — the DOWNLOADABLE upload, as opposed to
 * `scripts/package-itch.ps1` which zips the browser build for "play in browser".
 *
 * The exe is NOT portable on its own: it needs the Electron runtime DLLs beside it and `resources/dist`
 * (the game) below it. So the whole `ASCENT-win32-x64` folder goes in, under a single top-level directory —
 * which also means a player extracting to Downloads gets one tidy folder rather than 80 loose files.
 *
 * Zipping uses **Windows' bsdtar** (`C:\Windows\System32\tar.exe`), invoked by absolute path on purpose:
 *   - `tar` on PATH here is Git's GNU tar, which cannot write zip at all (`-a` is unsupported).
 *   - PowerShell's `Compress-Archive` writes BACKSLASH entry names, which non-Windows tooling reads as
 *     literal filenames — the same trap documented in `package-itch.ps1`.
 * bsdtar writes proper forward-slash entries (verified), streams (the exe alone is 178 MB, so building the
 * archive in memory is not an option), and ships with Windows, so this adds no dependency.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'apps', 'desktop', 'release');
const buildName = 'ASCENT-win32-x64';
const buildDir = path.join(releaseDir, buildName);
const zipPath = path.join(root, 'ascent-itch-win64.zip'); // matches the gitignored `ascent-itch*.zip`

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

if (!existsSync(path.join(buildDir, 'ASCENT.exe'))) {
  die(`No build at ${path.relative(root, buildDir)} — run \`npm run package:desktop\` first.`);
}

const bsdtar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
if (!existsSync(bsdtar)) die(`bsdtar not found at ${bsdtar} — needed to write a zip with correct entry names.`);

await rm(zipPath, { force: true });
console.log(`• zipping ${buildName} (this takes a minute — ~300 MB in)`);
// -C releaseDir so entries are `ASCENT-win32-x64/…` and not the full absolute path.
execFileSync(bsdtar, ['-a', '-c', '-f', zipPath, '-C', releaseDir, buildName], { stdio: 'inherit' });

if (!existsSync(zipPath)) die('zip was not produced.');
const mb = statSync(zipPath).size / 1024 / 1024;
console.log(`\n✓ ${path.relative(root, zipPath)}  (${mb.toFixed(0)} MB)`);
console.log('  Upload to itch as a DOWNLOADABLE build, and tick "This file will be played in the browser" OFF.');
console.log('  Mark the platform as Windows so the itch app offers it correctly.');
