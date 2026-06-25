/*
 * Prune imported board exports by date / patch — the "clear stale boards" maintenance tool. Filters every
 * `docs/board-exports/*.json` (the player/friend boards baked into the committed pool), rewrites each file
 * in place, and reports. Run `npm run pool` afterwards to re-bake — house boards always regenerate fresh, so
 * only these imported sources accumulate stale boards. See docs/board-pool.md.
 *
 *   npm run pool:prune -- --before 2026-06-20            # drop boards captured before a date
 *   npm run pool:prune -- --after  2026-07-01            # drop boards captured after a date
 *   npm run pool:prune -- --patch 0.1.0+abc1234          # drop boards baked under a specific patch
 *   npm run pool:prune -- --no-patch                     # drop boards with NO patch stamp (pre-stamping captures)
 *   npm run pool:prune -- --before 2026-06-20 --dry-run  # preview without writing
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardSnapshot } from '@game/sim';

const EXPORTS_DIR = join(process.cwd(), 'docs', 'board-exports');

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);
const before = flag('before');
const after = flag('after');
const patch = flag('patch');
const noPatch = has('no-patch');
const dryRun = has('dry-run');

if (!before && !after && !patch && !noPatch) {
  console.error('Nothing to prune. Pass at least one of: --before <YYYY-MM-DD> / --after <date> / --patch <id> / --no-patch.');
  process.exit(1);
}

/** True if a board should be DROPPED under the current filters (any match drops it). */
function drop(b: BoardSnapshot): boolean {
  if (before && b.capturedAt && b.capturedAt < before) return true;
  if (after && b.capturedAt && b.capturedAt > after) return true;
  if (patch && b.patch === patch) return true;
  if (noPatch && !b.patch) return true;
  return false;
}

if (!existsSync(EXPORTS_DIR)) {
  console.log('No docs/board-exports/ directory — nothing to prune.');
  process.exit(0);
}

console.log(`Pruning board exports${dryRun ? ' (dry run)' : ''} — ${[
  before && `before ${before}`, after && `after ${after}`, patch && `patch ${patch}`, noPatch && 'no-patch',
].filter(Boolean).join(', ')}`);

let totalKept = 0;
let totalDropped = 0;
for (const file of readdirSync(EXPORTS_DIR).filter((f) => f.endsWith('.json'))) {
  const path = join(EXPORTS_DIR, file);
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const wrapped = !!parsed && typeof parsed === 'object' && Array.isArray((parsed as { boards?: unknown }).boards);
    const boards: BoardSnapshot[] = wrapped ? (parsed as { boards: BoardSnapshot[] }).boards : (parsed as BoardSnapshot[]);
    if (!Array.isArray(boards)) { console.warn(`  ! ${file}: not a board file, skipped`); continue; }
    const kept = boards.filter((b) => !drop(b));
    const removed = boards.length - kept.length;
    totalKept += kept.length;
    totalDropped += removed;
    if (removed === 0) { console.log(`  = ${file}: ${boards.length} boards, none match`); continue; }
    console.log(`  ${dryRun ? '(dry)' : '✓'} ${file}: dropped ${removed}, kept ${kept.length}`);
    if (!dryRun) {
      const out = wrapped ? { ...(parsed as object), boards: kept } : kept;
      writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
    }
  } catch (e) {
    console.warn(`  ! ${file}: ${(e as Error).message}`);
  }
}
console.log(
  `\n${dryRun ? 'Would drop' : 'Dropped'} ${totalDropped} boards, kept ${totalKept}.` +
  `${dryRun || totalDropped === 0 ? '' : ' Re-run `npm run pool` to re-bake the committed pool.'}`,
);
