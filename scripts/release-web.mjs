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
 *
 * VERSUS IS CLOUDFLARE ONLY (R-VERSUS-CF-ONLY-01, owner 2026-10-29; docs/versus-cf-cutover.md): every pack deploys the
 * Versus Worker for this exact commit FIRST (`npm run versus:cf:deploy -- --persist`, from the release worktree; the
 * Worker is named after its content revision, so rooms on an older Worker finish there), checks its /health answers
 * this build's engine, and bakes its URL into the bundle (`VITE_VERSUS_CF_URL`). There is no Supabase Versus server to
 * redeploy any more (the Supabase Edge Function is retired). `--versus-cf-no-persist` deploys with the result writer
 * off (test packs only: matches would leave no records). `--versus-cf` is still accepted (it was the opt-in flag) and
 * changes nothing. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment; neither is ever printed.
 *
 * THE FRIENDS HUB (direct messages + live presence, one stable Worker `ascent-hub` for every build): every pack also
 * runs `npm run hub:deploy`, which deploys the hub ONLY when its code changed (never per content revision), checks its
 * /health, gives a newly persisting hub its writer secret, and bakes the stable hub URL (`VITE_FRIENDS_HUB_URL`).
 * A pack cut WITHOUT the flag still uses the live hub on the Netlify origin (R-DM-HUB-URL-01, packages/ui/src/friends/dm/hubUrl.ts).
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
const run = (cmd, cwd, env = process.env) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit', env }); };
const VERSUS_CF_PERSIST = !process.argv.includes('--versus-cf-no-persist');
const WORKER_URL = /https:\/\/ascent-versus-v(\d+)-([0-9a-z]+)\.team-ascent\.workers\.dev/;
// Every pack ships its Versus Worker (R-VERSUS-CF-ONLY-01): a pack without one would have no Versus at all.
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  die('release:web deploys the Versus Worker: it needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment');
}

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
// ── 3b. the Versus Worker for this commit, BEFORE the site: a new site must never meet a missing Worker ───────────────
let workerUrl = null;
let workerRev = null;
{
  step(`deploying the Versus Worker for ${sha.slice(0, 9)}${VERSUS_CF_PERSIST ? '' : ' (result writer OFF)'}`);
  // deploy.ts echoes only its own summary and wrangler's URL / version lines, never a key.
  const cmd = `npm run versus:cf:deploy -- ${VERSUS_CF_PERSIST ? '--persist' : ''}`.trim();
  console.log(`  $ ${cmd}`);
  let out;
  try {
    out = execSync(cmd, { cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.log(String(e.stdout ?? ''));
    die('the Versus Worker deploy failed (nothing was built; the live site is untouched)');
  }
  for (const line of out.split(/\r?\n/)) if (line.trim() && !line.startsWith('>')) console.log(`  ${line.trim()}`);
  const m = WORKER_URL.exec(out);
  if (!m) die('the Worker deploy printed no ascent-versus-*.team-ascent.workers.dev URL');
  workerUrl = m[0];
  // The Worker must answer with THIS build's engine, or every hello would be refused with version_mismatch.
  let health = null;
  for (let i = 0; i < 10 && !health; i++) {
    try {
      const res = await fetch(`${workerUrl}/health`);
      if (res.ok) health = await res.json();
    } catch { /* not routable yet */ }
    if (!health) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!health) die(`${workerUrl}/health did not answer`);
  if (`v${health.cfProtocol}-${health.contentRevision}` !== `v${m[1]}-${m[2]}`) die(`the Worker at ${workerUrl} carries v${health.cfProtocol}-${health.contentRevision}, not its own name`);
  workerRev = health.contentRevision;
  console.log(`  ✓ Worker live: ${workerUrl} (content ${workerRev}, protocol ${health.protocol})`);
  // Each content revision is its own Worker, so a NEW one has no result-writer secret yet. Give it one (the secret is
  // generated and piped straight to wrangler; only its sha256 is printed, as the SQL line to run once).
  if (VERSUS_CF_PERSIST) {
    const name = `ascent-versus-v${m[1]}-${m[2]}`;
    const workerDir = path.join(WT, 'workers', 'versus');
    let secrets = '';
    try { secrets = execSync(`npx wrangler secret list --name ${name}`, { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* treated as missing */ }
    if (secrets.includes('VERSUS_WRITER_SECRET')) console.log('  ✓ result writer secret already set on this Worker');
    else {
      console.log('  this Worker has no result writer secret yet: setting one (run the SQL line it prints BEFORE uploading the zip)');
      run(`node scripts/writer-secret.mjs ${name}`, workerDir);
    }
  }
}

// ── 3c. THE FRIENDS HUB: one stable Worker for every build, deployed only when its own code changed ─────────────────
let hubUrl = null;
let hubNote = '';
{
  step('the friends hub (deployed only when its code changed)');
  const cmd = `npm run hub:deploy -- ${VERSUS_CF_PERSIST ? '--persist' : ''}`.trim();
  console.log(`  $ ${cmd}`);
  let out;
  try {
    out = execSync(cmd, { cwd: WT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.log(String(e.stdout ?? ''));
    die('the friends hub deploy failed (nothing was built; the live site is untouched)');
  }
  for (const line of out.split(/\r?\n/)) if (line.trim() && !line.startsWith('>')) console.log(`  ${line.trim()}`);
  const m = /hub: (deployed|unchanged) (https:\/\/ascent-hub\.team-ascent\.workers\.dev) ([0-9a-f]+)/.exec(out);
  if (!m) die('the hub deploy printed no "hub: deployed|unchanged <url> <hash>" line');
  let health = null;
  for (let i = 0; i < 10 && !health; i++) {
    try {
      const res = await fetch(`${m[2]}/health`);
      if (res.ok) health = await res.json();
    } catch { /* not routable yet */ }
    if (!health) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!health || health.code !== m[3]) die(`${m[2]}/health does not answer code ${m[3]}`);
  hubUrl = m[2];
  hubNote = `${m[1]} (code ${m[3]}, hub protocol ${health.hub}, oldest client ${health.min})`;
  console.log(`  ✓ friends hub live: ${hubUrl} ${hubNote}`);
  if (VERSUS_CF_PERSIST) {
    const workerDir = path.join(WT, 'workers', 'versus');
    let secrets = '';
    try { secrets = execSync('npx wrangler secret list --name ascent-hub', { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* treated as missing */ }
    if (secrets.includes('HUB_WRITER_SECRET')) console.log('  ✓ hub writer secret already set');
    else {
      console.log('  the hub has no writer secret yet: setting one (run the SQL line it prints, or messages are refused)');
      run('node scripts/writer-secret.mjs ascent-hub', workerDir);
    }
  }
}

step('building the web bundle');
// The Worker URL baked in is the one deployed above; a stray value in the shell never leaks into the pack.
const buildEnv = { ...process.env };
delete buildEnv.VITE_VERSUS_CF_URL;
delete buildEnv.VITE_FRIENDS_HUB_URL;
if (workerUrl) buildEnv.VITE_VERSUS_CF_URL = workerUrl;
if (hubUrl) buildEnv.VITE_FRIENDS_HUB_URL = hubUrl;
run('npm run build:web', WT, buildEnv);

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
if (workerUrl) {
  if (!jsChunks.some((f) => readFileSync(path.join(assetsDir, f), 'utf8').includes(workerUrl))) die(`the bundle does not carry ${workerUrl}`);
  console.log(`  ✓ bundle carries its Versus Worker (${workerUrl})`);
}
if (hubUrl) {
  if (!jsChunks.some((f) => readFileSync(path.join(assetsDir, f), 'utf8').includes(hubUrl))) die(`the bundle does not carry ${hubUrl}`);
  console.log(`  ✓ bundle carries the friends hub (${hubUrl})`);
}

// Every local file index.html points at must exist. This is the class of bug that shipped a blank damage
// splash: a path that resolves in dev and 404s from the deployed bundle.
const html = readFileSync(indexHtml, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(?:https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
const missing = refs.filter((u) => !existsSync(path.join(dist, u.replace(/^\.?\//, '').split(/[?#]/)[0])));
if (missing.length) die(`index.html references files that are not in dist:\n    ${missing.join('\n    ')}`);
console.log(`  ✓ all ${refs.length} local files index.html references are present`);
// The Netlify caching rules (apps/web/public/_headers, art pop-in fix 2026-09-29). Without them every returning
// player re-validates ~1,300 images before the browser may use its own copy — the art pops in on every visit.
const headersFile = path.join(dist, '_headers');
if (!existsSync(headersFile) || !/\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/.test(readFileSync(headersFile, 'utf8'))) {
  die('dist/_headers is missing or lost its immutable /assets/* rule (it ships from apps/web/public/_headers)');
}
console.log('  ✓ _headers present (hashed assets immutable, index.html no-cache)');

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

  VERSUS WORKER: ${workerUrl} (content ${workerRev}) is live and baked into this zip. Every Versus mode plays on it;
  there is nothing else to deploy for Versus.
  FRIENDS HUB: ${hubUrl} ${hubNote}.
`);
