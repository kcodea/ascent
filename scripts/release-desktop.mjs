/**
 * Cut a Windows desktop release that is PROVABLY the exact contents of `origin/main`.
 *
 *   npm run release:desktop            # fetch → clean worktree at origin/main → npm ci → build → exe → smoke → zip
 *   npm run release:desktop -- --no-smoke   (skip the boot smoke test — only when you know why)
 *
 * Why this exists: `npm run package:itch:win` builds whatever is sitting in the working folder. That is not
 * main — it is main plus every uncommitted edit, every untracked file a glob happens to pick up (fx defs,
 * art), on whatever branch the shared checkout was last switched to, against whatever node_modules was last
 * installed. Every "the exe is missing X / the fonts are wrong / that effect looks off" report traced back to a
 * build like that, or to an exe cut before a fix merged. This script removes the human from the loop:
 *
 *   1. `git fetch origin` and resolve the commit `origin/main` points at — the SHA is the release.
 *   2. Check that commit out DETACHED in its own worktree (`.claude/worktrees/release`), then REFUSE to
 *      continue unless `git status` there is completely empty and HEAD is exactly that SHA.
 *   3. `npm ci` in the worktree (lockfile-exact dependencies — no reuse of the primary checkout's modules).
 *   4. `npm run build:web` + `scripts/package-desktop.mjs` there. Vite bakes the SHA into the bundle
 *      (`__BUILD_SHA__`) and the title screen shows it, so the exe names its own commit.
 *   5. Write `resources/dist/BUILD.json` (sha, date, versions) into the packaged exe.
 *   6. SMOKE TEST the packaged exe itself: run `ASCENT.exe` with `ASCENT_SMOKE=1`. The desktop shell then
 *      boots the game, waits for the boot loader (which preloads EVERY image, font, clip and effect the game
 *      will ever use), and reports: any asset the `app://` handler could not find, any boot stage that
 *      failed, any font that failed to load, and every renderer console error. One failure aborts the release.
 *   7. Zip with `scripts/package-itch-desktop.mjs` and copy the zip next to this repo as
 *      `ascent-itch-win64-<sha>.zip` (gitignored). That file is what you send.
 *
 * Nothing here touches the primary checkout's branch, files or node_modules.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WT = path.join(ROOT, '.claude', 'worktrees', 'release');
const args = new Set(process.argv.slice(2));
const SMOKE = !args.has('--no-smoke');

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n• ${msg}`);
const git = (gitArgs, cwd = ROOT) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const run = (cmd, cwd) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }); };

// ── 1. the commit ─────────────────────────────────────────────────────────────────────────────────────────
step('fetching origin');
git(['fetch', 'origin', '--prune']);
const sha = git(['rev-parse', 'origin/main']);
const short = sha.slice(0, 8);
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
  // Drop everything the commit does not contain (build output, stray files) — node_modules is kept only so
  // `npm ci` below can reuse the electron download cache path; npm ci deletes and reinstalls it regardless.
  git(['clean', '-fdx', '-e', 'node_modules'], WT);
}
const head = git(['rev-parse', 'HEAD'], WT);
if (head !== sha) die(`worktree HEAD is ${head}, expected ${sha}`);
const dirty = git(['status', '--porcelain', '--untracked-files=all'], WT);
if (dirty) die(`release worktree is not clean:\n${dirty}`);
console.log(`  ✓ HEAD ${short}, tree clean`);

// Guard against a stale origin/main that predates the tooling this script drives.
for (const f of ['scripts/package-desktop.mjs', 'scripts/package-itch-desktop.mjs', 'apps/desktop/main.cjs']) {
  if (!existsSync(path.join(WT, f))) die(`${f} missing at origin/main — cannot package this commit`);
}
const smokeSupported = readFileSync(path.join(WT, 'apps/desktop/main.cjs'), 'utf8').includes('ASCENT_SMOKE');

// ── 3–4. install + build + package, all inside the worktree ────────────────────────────────────────────────
step('npm ci (lockfile-exact dependencies)');
run('npm ci --no-audit --no-fund', WT);
step('building the web bundle');
run('npm run build:web', WT);
step('packaging the exe');
run('node scripts/package-desktop.mjs', WT);

const releaseDir = path.join(WT, 'apps', 'desktop', 'release', 'ASCENT-win32-x64');
const exe = path.join(releaseDir, 'ASCENT.exe');
if (!existsSync(exe)) die('ASCENT.exe was not produced');

// ── 5. stamp ───────────────────────────────────────────────────────────────────────────────────────────────
const version = JSON.parse(readFileSync(path.join(WT, 'package.json'), 'utf8')).version;
const electronVersion = JSON.parse(readFileSync(path.join(WT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const build = { sha, shortSha: short, ref: 'origin/main', date: new Date().toISOString(), version, node: process.version, electron: electronVersion };
writeFileSync(path.join(releaseDir, 'resources', 'dist', 'BUILD.json'), `${JSON.stringify(build, null, 2)}\n`);
console.log(`  ✓ BUILD.json written (${short})`);

// ── 6. smoke test the packaged exe ─────────────────────────────────────────────────────────────────────────
if (!SMOKE) {
  console.warn('\n! smoke test SKIPPED (--no-smoke)');
} else if (!smokeSupported) {
  console.warn('\n! smoke test unavailable: apps/desktop/main.cjs at this commit has no ASCENT_SMOKE mode');
} else {
  step('smoke-testing the packaged exe (boots the game, preloads every asset, reports failures)');
  const out = path.join(WT, 'apps', 'desktop', 'release', 'smoke.json');
  rmSync(out, { force: true });
  const code = await new Promise((resolve) => {
    const child = spawn(exe, [], { env: { ...process.env, ASCENT_SMOKE: '1', ASCENT_SMOKE_OUT: out }, stdio: 'inherit' });
    const timer = setTimeout(() => { console.error('  smoke test timed out after 5 minutes'); child.kill(); resolve(124); }, 5 * 60_000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c ?? 1); });
    child.on('error', (e) => { clearTimeout(timer); console.error(e); resolve(1); });
  });
  if (!existsSync(out)) die(`smoke test produced no report (exit ${code})`);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const stages = Object.entries(report.boot?.stages ?? {}).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'FAIL'} ${v.ms}ms`).join('  ');
  console.log(`  boot ${report.boot?.ms ?? '?'}ms  ${stages}`);
  console.log(`  assets requested: ${report.requests}, missing: ${report.missing.length}, fonts failed: ${report.fontErrors.length}, console errors: ${report.consoleErrors.length}`);
  for (const m of report.missing) console.error(`    MISSING  ${m}`);
  for (const f of report.fontErrors) console.error(`    FONT     ${f}`);
  for (const e of report.consoleErrors) console.error(`    CONSOLE  ${e}`);
  if (report.warmFailed?.length) console.error(`    FX could not fire: ${report.warmFailed.join(', ')}`);
  if (!report.ok || code !== 0) die(`smoke test FAILED (exit ${code}) — the release is not shippable`);
  console.log('  ✓ smoke test passed');
}

// ── 7. zip + deliver ───────────────────────────────────────────────────────────────────────────────────────
step('zipping');
run('node scripts/package-itch-desktop.mjs', WT);
const zipSrc = path.join(WT, 'ascent-itch-win64.zip');
if (!existsSync(zipSrc)) die('zip was not produced');
const zipDst = path.join(ROOT, `ascent-itch-win64-${short}.zip`);
copyFileSync(zipSrc, zipDst);
const mb = (statSync(zipDst).size / 1024 / 1024).toFixed(0);

console.log(`
✓ RELEASE ${short}  (${version}, built ${build.date})
  ${zipDst}  (${mb} MB)
  exe folder: ${releaseDir}

  Every byte of the game in that zip comes from commit ${sha} — nothing else was on disk when it was built.
  The title screen shows "v${version} · ${short}"; if your friend's shows anything else, they have an old copy.
`);
