#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Isolated-worktree task helper — see docs/concurrency.md.
//
// This repo is worked by several sessions at once (Kevin, Mike, multiple Claude
// agents). The one rule that prevents most pain: each active session works in
// ITS OWN worktree off latest origin/main and touches nothing else's. This
// script makes that a one-liner so nobody does feature work in the shared
// primary checkout (which is where branch-switches clobber other sessions).
//
// Usage:
//   npm run task -- <branch> [--install]   create an isolated worktree off latest origin/main AND point 5173 at it
//                                          (`--no-serve` to leave the port alone).
//                                          `feat/x`, `fix/y`, `chore/z`, `docs/…` — a BARE name
//                                          (`my-thing`) defaults to `feat/my-thing`.
//                                          --install also runs `npm install` in the new tree.
//   npm run task:list                      list every worktree.
//   npm run task:serve -- <branch>         point port 5173 at that worktree (the WORKING BRANCH host).
//   npm run task:done -- <branch>          remove that worktree + delete its local branch (after the PR merges).
//
// PORT 5173 FOLLOWS THE WORKING BRANCH (owner ask 2026-09-14). `new` and `serve` write the tree's path to
// `.claude/active-worktree` in the PRIMARY checkout and bounce whatever is listening on 5173; `npm run
// dev:active` (the desktop app's `web` launch config — scripts/dev-active.mjs) reads that pointer at start-up
// and serves from there, so the port never silently serves a stale tree or main. `done` clears the pointer
// when it names the tree being removed (5173 then falls back to the primary checkout on its next start).
//
// Worktrees live under `.claude/worktrees/<slug>` (gitignored, and NOT a Desktop
// sibling — Windows leaves hollow husks when siblings are torn down).
// -----------------------------------------------------------------------------
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cap = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
const git = (args, opts = {}) => execFileSync('git', args, { stdio: 'inherit', ...opts });
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);

(() => { try { cap(['rev-parse', '--show-toplevel']); } catch { die('not inside a git repo'); } })();
/** The PRIMARY checkout (parent of the shared `.git`) — worktrees + the 5173 pointer live under IT, whichever
 *  tree this script happens to run from, so a task created from inside a worktree still lands in one place. */
const PRIMARY = resolve(dirname(cap(['rev-parse', '--git-common-dir'])));
const WT_DIR = join(PRIMARY, '.claude', 'worktrees');
const POINTER = join(PRIMARY, '.claude', 'active-worktree');
const DEV_PORT = process.env.ASCENT_DEV_PORT ?? '5173';

/** Whatever process owns the dev port (its pid), or null. Windows via netstat, elsewhere via lsof. */
function portOwner() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }); // no `-p tcp`: that is IPv4-only on Windows and vite listens on [::1]
      const line = out.split(/\r?\n/).find((l) => l.includes(`:${DEV_PORT} `) && /LISTENING/.test(l));
      return line ? line.trim().split(/\s+/).pop() : null;
    }
    return execFileSync('lsof', ['-ti', `tcp:${DEV_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch { return null; }
}

/** Point 5173 at `path`: write the pointer, then bounce the port so the server restarts THERE. A server the
 *  desktop app manages respawns on its own (it re-runs `npm run dev:active`, which reads the pointer); when
 *  nothing is listening afterwards we start one detached so the owner is never left with a dead port. */
function serveFrom(path, branch) {
  mkdirSync(dirname(POINTER), { recursive: true });
  writeFileSync(POINTER, `${path}\n`);
  ok(`5173 → ${branch}  (${POINTER})`);
  const pid = portOwner();
  if (pid) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
      else process.kill(Number(pid), 'SIGTERM');
      console.log(`→ stopped the old 5173 server (pid ${pid}); a managed server respawns on the new tree`);
    } catch { console.log(`(could not stop pid ${pid} on 5173 — restart it by hand: npm run dev:active)`); }
  }
  setTimeout(() => {
    if (portOwner()) return; // the app's preview manager brought it back on the new tree
    const child = spawn(process.execPath, [fileURLToPath(new URL('./dev-active.mjs', import.meta.url))], { cwd: path, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    console.log(`→ started a detached 5173 server on ${branch} (nothing was managing the port)`);
  }, 2500); // NOT unref'd: this timer is what keeps the script alive long enough to check
}

/** `feat/x` → { branch:'feat/x', slug:'feat-x' }; a bare `x` → `feat/x`. */
function norm(name) {
  if (!name) die('need a branch name, e.g. `npm run task -- fix/foo`');
  if (/[^a-zA-Z0-9/_-]/.test(name)) die(`invalid branch name "${name}" (use letters, digits, / _ -)`);
  const branch = name.includes('/') ? name : `feat/${name}`;
  return { branch, slug: branch.replace(/\//g, '-'), path: join(WT_DIR, branch.replace(/\//g, '-')) };
}
const branchExists = (b) => { try { cap(['show-ref', '--verify', '--quiet', `refs/heads/${b}`]); return true; } catch { return false; } };

const [sub, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const positional = rest.filter((a) => !a.startsWith('--'));

if (sub === 'list') {
  git(['worktree', 'list']);
  process.exit(0);
}

if (sub === 'new') {
  const { branch, path } = norm(positional[0]);
  if (existsSync(path)) die(`worktree already exists at ${path}\n  → cd there, or \`npm run task:done -- ${branch}\` first.`);
  if (branchExists(branch)) die(`branch "${branch}" already exists locally\n  → pick a fresh name, or \`npm run task:done -- ${branch}\` to clear it.`);
  console.log(`→ fetching origin …`);
  git(['fetch', 'origin', '--quiet']);
  git(['worktree', 'prune']); // clear any stale registrations another session left behind
  console.log(`→ creating worktree for ${branch} off origin/main …`);
  git(['worktree', 'add', path, '-b', branch, 'origin/main']);
  ok(`worktree ready: ${path}`);
  if (flags.has('--install')) {
    console.log(`→ npm install (own node_modules for this tree) …`);
    execFileSync('npm', ['install'], { stdio: 'inherit', cwd: path, shell: process.platform === 'win32' });
    ok('deps installed');
  }
  if (!flags.has('--no-serve')) serveFrom(path, branch); // the new task IS the working branch — 5173 follows it (after install, so vite has deps)
  console.log(`
Next:
  cd ${path}${flags.has('--install') ? '' : '\n  npm install                 # this tree needs its own node_modules'}
  # …make changes, commit early…
  git push -u origin ${branch}
  gh pr create --fill         # (draft is fine — push early, origin is the only durable copy)

When the PR is merged:  npm run task:done -- ${branch}
Work ONLY in this tree — never the shared primary checkout or another session's worktree (docs/concurrency.md).
`);
  // (no process.exit here: the serve timer above must get to run; the script ends when it fires)
}

if (sub === 'serve') {
  const { branch, path } = norm(positional[0]);
  if (!existsSync(path)) die(`no worktree at ${path}
  → \`npm run task -- ${branch}\` first, or \`npm run task:list\`.`);
  serveFrom(path, branch);
}

if (sub === 'done') {
  const { branch, path } = norm(positional[0]);
  if (existsSync(POINTER) && resolve(readFileSync(POINTER, 'utf8').trim()) === resolve(path)) {
    rmSync(POINTER); ok('cleared the 5173 pointer (next start serves the primary checkout)');
  }
  if (existsSync(path)) { git(['worktree', 'remove', path, '--force']); ok(`removed worktree ${path}`); }
  else { git(['worktree', 'prune']); console.log(`(no worktree dir at ${path})`); }
  if (branchExists(branch)) { git(['branch', '-D', branch]); ok(`deleted local branch ${branch}`); }
  else console.log(`(no local branch ${branch})`);
  console.log(`Done. (The remote branch, if any, is deleted by the squash-merge or \`git push origin --delete ${branch}\`.)`);
  process.exit(0);
}

if (sub === 'new' || sub === 'serve') { /* handled above; the serve timer finishes the run */ } else
die(`unknown command "${sub ?? ''}".
  npm run task -- <branch> [--install]   create an isolated worktree off latest origin/main
  npm run task:list                      list worktrees
  npm run task:serve -- <branch>         point 5173 at that worktree
  npm run task:done -- <branch>          remove a worktree + its local branch`);
