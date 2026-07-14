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
//   npm run task -- <branch> [--install]   create an isolated worktree off latest origin/main.
//                                          `feat/x`, `fix/y`, `chore/z`, `docs/…` — a BARE name
//                                          (`my-thing`) defaults to `feat/my-thing`.
//                                          --install also runs `npm install` in the new tree.
//   npm run task:list                      list every worktree.
//   npm run task:done -- <branch>          remove that worktree + delete its local branch (after the PR merges).
//
// Worktrees live under `.claude/worktrees/<slug>` (gitignored, and NOT a Desktop
// sibling — Windows leaves hollow husks when siblings are torn down).
// -----------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const cap = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
const git = (args, opts = {}) => execFileSync('git', args, { stdio: 'inherit', ...opts });
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);

const ROOT = (() => { try { return cap(['rev-parse', '--show-toplevel']); } catch { die('not inside a git repo'); } })();
const WT_DIR = join(ROOT, '.claude', 'worktrees');

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
  console.log(`
Next:
  cd ${path}${flags.has('--install') ? '' : '\n  npm install                 # this tree needs its own node_modules'}
  # …make changes, commit early…
  git push -u origin ${branch}
  gh pr create --fill         # (draft is fine — push early, origin is the only durable copy)

When the PR is merged:  npm run task:done -- ${branch}
Work ONLY in this tree — never the shared primary checkout or another session's worktree (docs/concurrency.md).
`);
  process.exit(0);
}

if (sub === 'done') {
  const { branch, path } = norm(positional[0]);
  if (existsSync(path)) { git(['worktree', 'remove', path, '--force']); ok(`removed worktree ${path}`); }
  else { git(['worktree', 'prune']); console.log(`(no worktree dir at ${path})`); }
  if (branchExists(branch)) { git(['branch', '-D', branch]); ok(`deleted local branch ${branch}`); }
  else console.log(`(no local branch ${branch})`);
  console.log(`Done. (The remote branch, if any, is deleted by the squash-merge or \`git push origin --delete ${branch}\`.)`);
  process.exit(0);
}

die(`unknown command "${sub ?? ''}".
  npm run task -- <branch> [--install]   create an isolated worktree off latest origin/main
  npm run task:list                      list worktrees
  npm run task:done -- <branch>          remove a worktree + its local branch`);
