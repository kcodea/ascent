#!/usr/bin/env node
// -----------------------------------------------------------------------------
// `npm run dev:active` — serve port 5173 from the WORKING BRANCH, whichever worktree that is.
//
// Owner ask 2026-09-14: "5173 is our working branch host". The desktop app's preview manager launches the
// `web` config from a FIXED cwd (the directory the session opened in), and every task lives in its own
// worktree (`npm run task -- <branch>`), so the port kept serving whatever tree the session happened to
// start in — a stale branch, or main. This launcher resolves the tree to serve at start-up instead:
//
//   1. `.claude/active-worktree` in the PRIMARY checkout — a one-line path, written by
//      `npm run task -- <branch>` (and `npm run task:serve -- <branch>`), cleared by `task:done`.
//   2. Otherwise the primary checkout itself (main).
//
// It then runs vite in that tree, on 5173, strictPort. Switching branch = rewrite the pointer + restart
// this process (`task` / `task:serve` do both: they kill the 5173 listener so a managed server respawns
// here, or start one if nothing was listening).
// -----------------------------------------------------------------------------
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PORT = process.env.ASCENT_DEV_PORT ?? '5173';
const cap = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();

/** The PRIMARY checkout: the parent of the shared `.git` dir (a worktree's `--git-common-dir` points there). */
const primaryRoot = resolve(dirname(cap(['rev-parse', '--git-common-dir'])));
const pointer = join(primaryRoot, '.claude', 'active-worktree');

let root = primaryRoot;
let why = 'no active worktree pointer → primary checkout';
if (existsSync(pointer)) {
  const p = readFileSync(pointer, 'utf8').trim();
  if (p && existsSync(join(p, 'package.json'))) { root = p; why = `.claude/active-worktree → ${p}`; }
  else why = `pointer "${p}" is stale (no tree there) → primary checkout`;
}
const branch = (() => { try { return cap(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }); } catch { return '?'; } })();
const sha = (() => { try { return cap(['rev-parse', '--short', 'HEAD'], { cwd: root }); } catch { return '?'; } })();
if (!existsSync(join(root, 'node_modules'))) console.warn(`⚠ ${root} has no node_modules — run \`npm install\` there (docs/concurrency.md) or the tree resolves deps through the primary checkout.`);
console.log(`\n▶ 5173 → ${branch} @ ${sha}\n  ${root}\n  (${why})\n`);

const child = spawn('npm', ['run', 'dev', '-w', 'apps/web', '--', '--port', PORT, '--strictPort'], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(sig); });
child.on('exit', (code) => process.exit(code ?? 0));
