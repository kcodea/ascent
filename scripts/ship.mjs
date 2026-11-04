/**
 * SHIP ASCENT: publish the desktop app so friends' installed copies update themselves.
 *
 *   npm run ship                 # patch bump (v0.2.0 -> v0.2.1; the very first ship is v0.2.0)
 *   npm run ship -- --minor     # or --major (anything else is rejected)
 *   npm run ship -- --resume     # continue after exit code 3 (the SQL pause), using the saved plan
 *   npm run ship -- --dry-run    # print the plan (sha, version, steps) and exit; no side effects, no credentials needed
 *
 * Only Mike or Kevin saying "Ship Ascent" runs this (CLAUDE.md, "Releasing: Ship Ascent"). The flow:
 *
 *   1. Preflight: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, `gh auth status`.
 *   2. Resolve `origin/main` and REFUSE unless its `verify` check-run concluded success.
 *   3. Version = nextVersion(newest non-draft release tag, bump).
 *   4. Clean detached worktree at that SHA, `npm ci`, then deployServers (hub + Versus Worker, as release:web does).
 *      A newly set writer secret prints its SQL line; ship saves .claude/ship-state.json and exits 3 (PAUSED).
 *   5. Dispatch desktop-release.yml with publish=true (a DRAFT release), watch the run.
 *   6. Green: fill the release notes from the patch notes since the previous release and publish the draft.
 *      Red: leave the draft unpublished and print the run URL.
 *   7. Check releases/latest/download/latest.yml now reports the new version.
 *   8. Print version, SHA, Worker URL + content revision, release URL, the permanent installer link.
 *
 * Exit codes: 0 shipped (or dry run), 1 failed, 3 paused for the Supabase SQL step.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deployServers } from './lib/deployServers.mjs';
import { USAGE, expectedRunName, latestPublished, nextVersion, parseArgs, pickNewRun, previousReleaseDate, releaseNotesMarkdown, resumeState, verifyDraft } from '../apps/desktop/ship/shipLib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WT = path.join(ROOT, '.claude', 'worktrees', 'ship');
const STATE = path.join(ROOT, '.claude', 'ship-state.json');
const REPO = 'kcodea/ascent';
const WORKFLOW = 'desktop-release.yml';
const INSTALLER_LINK = `https://github.com/${REPO}/releases/latest/download/ASCENT-Setup.exe`;
const FEED = `https://github.com/${REPO}/releases/latest/download/latest.yml`;

const args = parseArgs(process.argv.slice(2));
if (args.error) { console.error(`
✗ ${args.error}
  ${USAGE}
`); process.exit(2); }
const DRY = args.dry;
const RESUME = args.resume;
const BUMP = args.bump;

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n• ${msg}`);
const git = (gitArgs, cwd = ROOT) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const gh = (ghArgs) => execFileSync('gh', ghArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const run = (cmd, cwd) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit' }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


// ── 1. preflight ───────────────────────────────────────────────────────────────────────────────────────────
step('preflight');
const needsCloudflare = !RESUME;
if (needsCloudflare && !DRY && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) {
  die('ship deploys the Versus Worker: it needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment');
}
try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); } catch { die('gh is not signed in (run `gh auth login`)'); }
console.log(`  ✓ gh signed in${DRY ? ' (dry run: Cloudflare credentials not required)' : ''}`);

let plan;
if (RESUME) {
  if (!existsSync(STATE)) die(`no saved ship state at ${path.relative(ROOT, STATE)}: nothing to resume`);
  plan = resumeState(JSON.parse(readFileSync(STATE, 'utf8')), new Date());
  console.log(`  resuming v${plan.version} at ${plan.sha.slice(0, 9)} (origin/main is NOT re-read)`);
} else {
  // ── 2. the commit, and its green verify ──────────────────────────────────────────────────────────────────
  step('fetching origin');
  git(['fetch', 'origin', '--prune']);
  const sha = git(['rev-parse', 'origin/main']);
  console.log(`  origin/main = ${sha}`);
  console.log(`  ${git(['log', '-1', '--format=%ci  %s', sha])}`);
  const checks = JSON.parse(gh(['api', `repos/${REPO}/commits/${sha}/check-runs?per_page=100`])).check_runs ?? [];
  const verify = checks.find((c) => c.name === 'verify');
  const verifyOk = verify?.conclusion === 'success';
  if (!verifyOk) {
    const why = verify ? `its conclusion is "${verify.conclusion ?? verify.status}"` : 'there is no check-run named verify on it yet';
    if (DRY) console.log(`  ! verify is NOT green on ${sha.slice(0, 9)}: ${why} (a real ship would refuse)`);
    else die(`refusing to ship ${sha.slice(0, 9)}: ${why}. Wait for CI on origin/main to go green.`);
  } else console.log(`  ✓ verify is green on ${sha.slice(0, 9)}`);

  // ── 3. version ───────────────────────────────────────────────────────────────────────────────────────────
  const releases = JSON.parse(gh(['release', 'list', '--repo', REPO, '--limit', '100', '--json', 'tagName,isDraft,publishedAt']));
  const latest = latestPublished(releases);
  const version = nextVersion(latest?.tagName ?? null, BUMP);
  console.log(`  latest release ${latest?.tagName ?? '(none)'} -> shipping v${version} (${BUMP})`);
  if (releases.some((r) => r.tagName === `v${version}` && !r.isDraft)) die(`v${version} is already published`);
  plan = { sha, version, workerUrl: '', hubUrl: '', contentRevision: '' };
}

if (DRY) {
  console.log(`
DRY RUN: nothing was deployed, dispatched, published or written.
  sha       ${plan.sha}
  version   v${plan.version}
  tag       v${plan.version} (created when the draft is published)
  steps     1. clean detached worktree at ${path.relative(ROOT, WT)}, npm ci
            2. deploy the friends hub + the Versus Worker (pauses with exit 3 if a new writer secret needs its SQL line)
            3. dispatch ${WORKFLOW} (publish=true) and watch it: build, installer, smoke test, DRAFT release
            4. on green: release notes from the patch notes since the previous release, publish the draft
               on red: leave the draft and print the run URL
            5. check ${FEED} reports ${plan.version}
  installer ${INSTALLER_LINK}`);
  process.exit(0);
}

// ── 4. worktree + servers ──────────────────────────────────────────────────────────────────────────────────
step(`preparing clean worktree at ${path.relative(ROOT, WT)}`);
git(['worktree', 'prune']);
if (existsSync(WT) && !existsSync(path.join(WT, '.git'))) rmSync(WT, { recursive: true, force: true });
if (!existsSync(WT)) git(['worktree', 'add', '--detach', WT, plan.sha]);
else {
  git(['checkout', '--detach', '--force', plan.sha], WT);
  git(['clean', '-fdx', '-e', 'node_modules'], WT);
}
if (git(['rev-parse', 'HEAD'], WT) !== plan.sha) die(`worktree HEAD is not ${plan.sha}`);
const dirty = git(['status', '--porcelain', '--untracked-files=all'], WT);
if (dirty) die(`ship worktree is not clean:\n${dirty}`);
console.log(`  ✓ HEAD ${plan.sha.slice(0, 9)}, tree clean`);

if (!RESUME) {
  step('npm ci (lockfile-exact dependencies)');
  run('npm ci --no-audit --no-fund', WT);
  const d = await deployServers({ wt: WT, persist: true });
  plan = { ...plan, workerUrl: d.workerUrl, hubUrl: d.hubUrl, contentRevision: d.workerRev };
  if (d.newSecrets.length) {
    mkdirSync(path.dirname(STATE), { recursive: true });
    writeFileSync(STATE, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`\nPAUSED: a new writer secret was set. Run ${d.newSecrets.length === 1 ? 'this SQL line' : 'these SQL lines'} in Supabase:\n`);
    for (const l of d.newSecrets) console.log(`  ${l}`);
    console.log('\nPAUSED — run this SQL in Supabase, then `npm run ship -- --resume`');
    process.exit(3);
  }
}

// ── 5. dispatch + watch ────────────────────────────────────────────────────────────────────────────────────
// Saved BEFORE dispatching, so "--resume" is always a valid way back. A resume re-dispatches the build, and the
// workflow's cancel-in-progress cancels the earlier run if it is still going.
mkdirSync(path.dirname(STATE), { recursive: true });
writeFileSync(STATE, `${JSON.stringify(plan, null, 2)}
`);
const wantName = expectedRunName(plan.version, plan.sha);
const listRuns = () => JSON.parse(gh(['run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--limit', '30', '--json', 'databaseId,displayTitle']));
// A resume re-dispatches the same version + sha, so the earlier run has the same name: remember it and never pick it.
const oldRunIds = listRuns().filter((r) => r.displayTitle === wantName).map((r) => r.databaseId);
step(`dispatching ${WORKFLOW} (publish=true, draft release)`);
gh([
  'workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', 'main',
  '-f', `sha=${plan.sha}`, '-f', `version=${plan.version}`, '-f', `versusUrl=${plan.workerUrl}`,
  '-f', `hubUrl=${plan.hubUrl}`, '-f', `contentRevision=${plan.contentRevision}`, '-f', 'publish=true',
]);
let runId = null;
for (let i = 0; i < 45 && !runId; i++) {
  await sleep(4000);
  runId = pickNewRun(listRuns(), wantName, oldRunIds);
}
if (!runId) die(`no workflow run named "${wantName}" appeared within 3 minutes (check the Actions tab). The plan is saved: fix and run \`npm run ship -- --resume\` (it re-dispatches; cancel-in-progress cancels the earlier run).`);
const runUrl = `https://github.com/${REPO}/actions/runs/${runId}`;
console.log(`  run ${runUrl}`);
try {
  execFileSync('gh', ['run', 'watch', String(runId), '--repo', REPO, '--exit-status'], { cwd: ROOT, stdio: 'inherit' });
} catch {
  die(`the desktop build FAILED. The draft release (if any) was left unpublished; nothing reached friends.\n  ${runUrl}\n  Fix forward, then run \`npm run ship -- --resume\` (re-dispatches; a stale draft v${plan.version} is replaced).`);
}

// ── 6. release notes, verify the draft, then publish it ────────────────────────────────────────────────────
const unpublished = (why) => die(`draft v${plan.version} left UNPUBLISHED: ${why}; fix and run \`npm run ship -- --resume\``);
step('writing release notes and publishing the draft');
let sinceDate = null;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ascent-ship-'));
let refusal = null; // set instead of exiting inside the try, so the temp dir is always cleaned up
try {
  const releases = JSON.parse(gh(['release', 'list', '--repo', REPO, '--limit', '100', '--json', 'tagName,isDraft,publishedAt']));
  sinceDate = previousReleaseDate(releases);
  // PATCH_NOTES + notesSince are TypeScript in packages/ui: bundle a tiny entry with esbuild (a pinned devDep of @game/desktop).
  const esbuild = createRequire(path.join(ROOT, 'apps', 'desktop', 'package.json'))('esbuild');
  const ui = path.join(WT, 'packages', 'ui', 'src').replaceAll('\\', '/');
  const entry = path.join(tmp, 'entry.ts');
  writeFileSync(entry, `export { PATCH_NOTES } from '${ui}/patchNotes';\nexport { notesSince } from '${ui}/updateNotes';\n`);
  const out = path.join(tmp, 'notes.mjs');
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  const mod = await import(pathToFileURL(out).href);
  const notesFile = path.join(tmp, 'notes.md');
  writeFileSync(notesFile, releaseNotesMarkdown(mod.notesSince(mod.PATCH_NOTES, sinceDate)));
  // Never publish a draft that is not exactly the one this ship built.
  const draft = JSON.parse(gh(['release', 'view', `v${plan.version}`, '--repo', REPO, '--json', 'isDraft,targetCommitish,assets']));
  const v = verifyDraft(draft, { sha: plan.sha });
  if (!v.ok) refusal = v.reason;
  else gh(['release', 'edit', `v${plan.version}`, '--repo', REPO, '--notes-file', notesFile, '--draft=false']);
} catch (e) {
  refusal = String(e?.message ?? e);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (refusal) unpublished(refusal);
console.log(`  ✓ v${plan.version} published (notes since ${sinceDate ?? 'the latest entry'})`);

// ── 7. the feed must now name the new version ──────────────────────────────────────────────────────────────
step('checking the update feed');
let feedVersion = null;
for (let i = 0; i < 12 && feedVersion !== plan.version; i++) {
  try {
    const res = await fetch(FEED, { redirect: 'follow' });
    if (res.ok) feedVersion = /^version:\s*['"]?([^\s'"]+)/m.exec(await res.text())?.[1] ?? null;
  } catch { /* not routable yet */ }
  if (feedVersion !== plan.version) await sleep(5000);
}
if (feedVersion !== plan.version) die(`published, but the feed check failed: ${FEED} reports ${feedVersion ?? 'nothing'}, not ${plan.version}. The release IS published; check it by hand (the state file is kept).`);
console.log(`  ✓ latest.yml reports ${feedVersion}`);

rmSync(STATE, { force: true });
console.log(`
✓ SHIPPED ASCENT v${plan.version}
  commit        ${plan.sha}
  Versus Worker ${plan.workerUrl} (content ${plan.contentRevision})
  friends hub   ${plan.hubUrl}
  release       https://github.com/${REPO}/releases/tag/v${plan.version}
  installer     ${INSTALLER_LINK}  (permanent link; installed copies update themselves)
`);
