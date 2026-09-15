/**
 * BALANCE BOT — the Node half of the experiment identity (B0).
 *
 * `@game/sim`'s `computeExperimentIdentity` is pure and browser-safe; it takes an `EnvironmentIdentity` for the
 * inputs only a Node process can supply. This module gathers them:
 *
 *  - `engineRevision`  — `git rev-parse HEAD` (falls back to 'no-git' when git / the repo is unavailable).
 *  - `dirtyDigest`     — digest of `git diff HEAD` (tracked, uncommitted changes); '' when clean or unknown.
 *                        Untracked files are NOT part of it — a new content file that is not yet `git add`ed
 *                        still changes `contentDigest`, which is the digest that actually catches it.
 *  - `effectSources`   — the text of `packages/sim/src/recruit.ts` + `reducer.ts`, resolved from this file's
 *                        location (`import.meta.url`) so it works from any cwd and any worktree.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeExperimentIdentity, digest, type EnvironmentIdentity, type ExperimentIdentity, type ExperimentManifest } from '@game/sim';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root: packages/tools/src/balance → ../../../.. */
export const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SIM_SRC = join(REPO_ROOT, 'packages', 'sim', 'src');

/** The files whose text is folded into `effectDigest`, in order. */
export const EFFECT_SOURCE_FILES: readonly string[] = [join(SIM_SRC, 'recruit.ts'), join(SIM_SRC, 'reducer.ts')];

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

export function engineRevision(): string {
  return git(['rev-parse', 'HEAD']) ?? 'no-git';
}

export function dirtyDigest(): string {
  const diff = git(['diff', 'HEAD']);
  return diff ? digest(diff) : '';
}

export function effectSources(): string[] {
  return EFFECT_SOURCE_FILES.map((p) => readFileSync(p, 'utf8'));
}

export function nodeEnvironment(): EnvironmentIdentity {
  return { engineRevision: engineRevision(), dirtyDigest: dirtyDigest(), effectSources: effectSources() };
}

/** The full identity of a job run from THIS checkout. */
export function computeNodeIdentity(manifest: ExperimentManifest): ExperimentIdentity {
  return computeExperimentIdentity(manifest, nodeEnvironment());
}
