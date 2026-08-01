/**
 * `npm run fx:publish -- "message"` — take the FX defs you just authored in the workbench and put them on a
 * branch, pushed, with a PR open. One command from "I like this" to "waiting on CI".
 *
 * ── why this exists ──────────────────────────────────────────────────────────────────────────────────
 * Saving in the workbench writes a real, git-tracked JSON file — but only into whatever tree the dev server
 * happens to be running from. Getting it to `main` is then ordinary git, and doing that by hand has three
 * sharp edges that each cost real work during the session this script came out of:
 *
 *   1. A FIXED branch name fails the second time you run it ("already exists"). Branch names here carry a
 *      timestamp so a second publish never collides with the first.
 *   2. Branching off wherever you happen to be. `main` moves fast in this repo — several times an hour on a
 *      busy day — so a branch cut from a stale local `main` is BEHIND before CI even starts, and GitHub
 *      refuses the merge until you take `main` in again. We always `fetch` and branch off `origin/main`.
 *   3. Staging `defs/*.json` alone SILENTLY DROPS imported art. A def referencing `art:my-coin` whose PNG
 *      never got committed resolves to a procedural fallback for everyone else — the def looks fine in the
 *      author's own session and wrong in the shipped game. `defs/art/` is staged with the defs, always.
 *
 * Deliberately does NOT merge. `main` is PR-protected and the repo's own rule is that the owner merges, so
 * this stops at "PR is open" — which is also the last point where a human can still change their mind.
 *
 * Deliberately does NOT run the gate. CI runs typecheck + lint + test + build on the PR anyway, and running
 * them locally first just doubles the window for `main` to move underneath you.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything the workbench can write. ONE path, and that is the point: imported art lives at
 * `defs/art/*.png`, i.e. UNDER this directory, so staging the directory picks it up automatically.
 * Narrowing this to `defs/*.json` would silently drop the art — see the header. If the workbench ever
 * writes somewhere else, it has to be added here or it will not be published.
 */
const FX_PATHS = ['packages/ui/src/fx/defs'] as const;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** `2026-08-01T0134` — sortable, and unique enough that two publishes a minute apart don't collide. */
function stamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}`;
}

function main(): void {
  const root = process.cwd();
  if (!existsSync(join(root, 'package.json'))) {
    console.error('Run this from the repo root.');
    process.exit(1);
  }

  const message = process.argv.slice(2).join(' ').trim() || 'content(fx): effect tuning from the workbench';

  // What is actually uncommitted under the FX paths. `--porcelain` so this is parseable rather than pretty.
  const dirty = git(['status', '--porcelain', '--', ...FX_PATHS], root);
  if (dirty === '') {
    console.log('Nothing to publish — no changes under packages/ui/src/fx/defs.');
    console.log('If you saved in the workbench, check the dev server is serving THIS tree.');
    return;
  }

  console.log('Publishing:\n' + dirty + '\n');

  // Branch off the REAL latest main, not whatever this tree happens to be sitting on. Uncommitted changes
  // survive the switch, which is what makes "save first, branch after" safe.
  git(['fetch', 'origin', 'main'], root);
  const branch = `fx/publish-${stamp(new Date())}`;
  git(['switch', '-c', branch, 'origin/main'], root);

  git(['add', '--', ...FX_PATHS], root);
  git(['commit', '-m', message], root);
  git(['push', '-u', 'origin', 'HEAD'], root);

  console.log(`\nPushed ${branch}.`);
  console.log('Open the PR from the link above, or:  gh pr create --fill');
  console.log('CI takes ~5-9 minutes. Merging is a human click — this script never merges.');
}

main();
