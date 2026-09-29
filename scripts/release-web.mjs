/**
 * Cut a BROWSER release that is PROVABLY the exact contents of `origin/main`, ready to drop on Netlify.
 *
 *   npm run release:web
 *
 * This is the "play in browser" sibling of `scripts/release-desktop.mjs`. Same reason for existing:
 * `npm run package:itch` zips whatever is sitting in the working folder — main plus every uncommitted edit
 * and every untracked file a glob picks up (fx defs, art), on whatever branch the shared checkout was last
 * switched to. The badge on the title screen shows a `*` when that happens, but nobody reads a badge before
 * uploading. This script removes the human from the loop:
 *
 *   1. `git fetch origin` and resolve the commit `origin/main` points at — that SHA is the release.
 *   2. Check it out DETACHED in its own worktree (`.claude/worktrees/release-web`), then REFUSE to continue
 *      unless `git status` there is completely empty and HEAD is exactly that SHA.
 *   3. `npm ci` in the worktree (lockfile-exact dependencies — never the primary checkout's node_modules).
 *   4. `npm run build:web` there. Vite bakes the SHA into the bundle (`__BUILD_SHA__`), so the title screen
 *      names its own commit.
 *   5. Verify the build: the SHA really is in the bundle, and every local file `index.html` points at exists.
 *   6. Zip `apps/web/dist` with index.html at the ROOT of the archive, then read the archive back and prove
 *      it — a zip with the game one folder down, or with backslash entry names, is a broken deploy.
 *   7. Copy it next to this repo as `ascent-web-<sha>.zip` (gitignored). The filename is the same SHA the
 *      title screen shows, so "which build is live?" is never a guess.
 *
 * Zipping uses Windows' bsdtar (`C:\Windows\System32\tar.exe`) by absolute path, for the reasons documented
 * in `scripts/package-itch-desktop.mjs`: `tar` on PATH here is Git's GNU tar (cannot write zip), and
 * PowerShell's `Compress-Archive` writes BACKSLASH entry names that Linux tooling reads as literal filenames.
 *
 * Nothing here touches the primary checkout's branch, files or node_modules.
 */
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WT = path.join(ROOT, '.claude', 'worktrees', 'release-web');

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n• ${msg}`);
const git = (gitArgs, cwd = ROOT) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const run = (cmd, cwd) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }); };

// ── 1. the commit ─────────────────────────────────────────────────────────────────────────────────────────
step('fetching origin');
git(['fetch', 'origin', '--prune']);
const sha = git(['rev-parse', 'origin/main']);
console.log(`  origin/main = ${sha}`);
console.log(`  ${git(['log', '-1', '--format=%ci  %s', sha])}`);

// ── 2. a clean detached worktree at exactly that commit ────────────────────────────────────────────────────
step(`preparing clean worktree at ${path.relative(ROOT, WT)}`);
git(['worktree', 'prune']);
const isWorktree = existsSync(path.join(WT, '.git'));
if (existsSync(WT) && !isWorktree) {
  console.log('  stale non-worktree folder found — removing it');
  rmSync(WT, { recursive: true, force: true });
}
if (!existsSync(WT)) {
  git(['worktree', 'add', '--detach', WT, sha]);
} else {
  git(['checkout', '--detach', '--force', sha], WT);
  // Drop everything the commit does not contain (previous dist, stray files). node_modules is kept only so
  // npm's cache paths stay warm; `npm ci` below deletes and reinstalls it regardless.
  git(['clean', '-fdx', '-e', 'node_modules'], WT);
}
const head = git(['rev-parse', 'HEAD'], WT);
if (head !== sha) die(`worktree HEAD is ${head}, expected ${sha}`);
const dirty = git(['status', '--porcelain', '--untracked-files=all'], WT);
if (dirty) die(`release worktree is not clean:\n${dirty}`);
// The SHA the bundle will carry and the badge will print — `git rev-parse --short` exactly as vite.config.ts
// computes it, so the zip filename always equals what the title screen shows (its length is git's to choose).
const short = git(['rev-parse', '--short', 'HEAD'], WT);
console.log(`  ✓ HEAD ${short}, tree clean`);

// ── 3–4. install + build, inside the worktree ──────────────────────────────────────────────────────────────
step('npm ci (lockfile-exact dependencies)');
run('npm ci --no-audit --no-fund', WT);
step('building the web bundle');
run('npm run build:web', WT);

const dist = path.join(WT, 'apps', 'web', 'dist');
const indexHtml = path.join(dist, 'index.html');
if (!existsSync(indexHtml)) die('apps/web/dist/index.html was not produced');

// ── 5. verify the build is this commit, and is internally complete ────────────────────────────────────────
step('verifying the build');
const assetsDir = path.join(dist, 'assets');
const jsChunks = existsSync(assetsDir) ? readdirSync(assetsDir).filter((f) => f.endsWith('.js')) : [];
if (!jsChunks.length) die('no JS chunks in apps/web/dist/assets');
const shaBaked = jsChunks.some((f) => readFileSync(path.join(assetsDir, f), 'utf8').includes(short));
if (!shaBaked) die(`the build does not carry ${short} — dist is stale or the SHA was not baked in`);
console.log(`  ✓ bundle carries ${short}`);

// Every local file index.html points at must exist. This is the class of bug that shipped a blank damage
// splash: a path that resolves in dev and 404s from the deployed bundle.
const html = readFileSync(indexHtml, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(?:https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
const missing = refs.filter((u) => !existsSync(path.join(dist, u.replace(/^\.?\//, '').split(/[?#]/)[0])));
if (missing.length) die(`index.html references files that are not in dist:\n    ${missing.join('\n    ')}`);
console.log(`  ✓ all ${refs.length} local files index.html references are present`);

// ── 6. zip, with index.html at the ROOT of the archive ────────────────────────────────────────────────────
step('zipping');
const bsdtar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
if (!existsSync(bsdtar)) die(`bsdtar not found at ${bsdtar} — needed to write a zip with correct entry names.`);
const zipSrc = path.join(WT, 'ascent-web.zip');
rmSync(zipSrc, { force: true });
// -C dist plus the top-level names (not `.`) so entries are `index.html`, `assets/…` — never `./index.html`
// and never one folder down, which on Netlify serves a directory listing instead of the game.
execFileSync(bsdtar, ['-a', '-c', '-f', zipSrc, '-C', dist, ...readdirSync(dist)], { stdio: 'inherit' });
if (!existsSync(zipSrc)) die('zip was not produced');

// Read it back and prove its shape, rather than trusting that the flags did what they should.
const entries = execFileSync(bsdtar, ['-tf', zipSrc], { encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter(Boolean);
if (!entries.includes('index.html')) die('index.html is not at the root of the zip');
const backslashed = entries.filter((e) => e.includes('\\'));
if (backslashed.length) die(`${backslashed.length} zip entries have backslash names (Linux reads those as literal filenames)`);
const fileCount = entries.filter((e) => !e.endsWith('/')).length;
console.log(`  ✓ index.html at root, ${fileCount} files, forward-slash entries`);

// ── 7. deliver ─────────────────────────────────────────────────────────────────────────────────────────────
const zipDst = path.join(ROOT, `ascent-web-${short}.zip`);
copyFileSync(zipSrc, zipDst);
const mb = (statSync(zipDst).size / 1024 / 1024).toFixed(0);
const version = JSON.parse(readFileSync(path.join(WT, 'package.json'), 'utf8')).version;

console.log(`
✓ WEB RELEASE ${short}  (v${version}, ${fileCount} files, ${mb} MB)
  ${zipDst}

  Every byte in that zip comes from commit ${sha} — nothing else was on disk when it was built.

  To deploy: app.netlify.com → the ASCENT site → the Deploys tab → drag this zip onto the drop area.
  Do it from the SITE's Deploys tab; dropping it on the main Sites list creates a NEW site with a new URL.

  Then check the title screen badge reads "v${version} · ${short}". Anything else means an older build is live.
`);
