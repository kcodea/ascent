/**
 * IMITATION (balance bot B7) — the recorded corpus as RUN TRAJECTORIES.
 *
 * A corpus is a bag of boards; a player's decisions only make sense as a sequence. `trajectoriesOf` groups the
 * boards back into runs (`playerRunsFrom`: author | hero | seed, one board per wave, ≥ 4 waves) and derives, for
 * every board, how much longer its run went on — the ONE label everything in this directory learns from.
 *
 * Labels (a recording carries no placement, so survival stands in for it — the same choice `balance/value` made):
 *   - `survivedAfter`  = lastWave − wave (waves the run played after this board fought);
 *   - `reachedEnd`     = lastWave ≥ END_WAVE (the run reached the end-game; a corpus run at 14+ has three or
 *                        fewer seats left and is "a top finish" as near as a recording can say);
 *   - `survivor(H)`    = reachedEnd OR lastWave ≥ max(wave + H, SURVIVOR_FLOOR) — "went on to survive to wave W+H
 *                        or better AND at least to the median finish (wave 12)". The floor is what makes the label
 *                        mean something at waves 1–6, where every run trivially lasts three more waves (the corpus
 *                        only holds runs of ≥ 4 waves and none ends before wave 7); without it the early bands have a
 *                        100% base rate and nothing to learn. H = 3 by default: three more fights is the horizon a
 *                        one-turn evaluator cannot see and a player's build order is about.
 *
 * Deterministic and pure; nothing here reads the future of a board except through the run it belongs to.
 */
import type { SetId } from '@game/content';
import { CARD_INDEX } from '@game/content';
import type { Tribe } from '@game/core';
import { playerRunsFrom } from '../../lobby/snapshotSeats';
import type { BoardSnapshot } from '../../snapshot';

/** A run whose last recorded wave reaches this far is treated as having reached the end-game. */
export const END_WAVE = 14;
/** The default survival horizon (waves). */
export const DEFAULT_HORIZON = 3;
/** A survivor's run must reach at least this wave (the corpus' median finish) whatever the board's wave. */
export const SURVIVOR_FLOOR = 12;

export interface TrajectoryBoard {
  wave: number;
  snap: BoardSnapshot;
  survivedAfter: number;
  reachedEnd: boolean;
  /** The fight result recorded ON this board (the fight it went into), if known. */
  result: BoardSnapshot['result'];
}

export interface RunTrajectory {
  key: string;
  author: string;
  heroId: string;
  tribes: readonly Tribe[];
  firstWave: number;
  lastWave: number;
  reachedEnd: boolean;
  boards: TrajectoryBoard[];
}

export function trajectoriesOf(boards: readonly BoardSnapshot[], setId?: SetId, endWave = END_WAVE): RunTrajectory[] {
  return playerRunsFrom(boards, undefined, setId).map((run) => {
    const lastWave = run.snaps[run.snaps.length - 1]!.wave;
    const reachedEnd = lastWave >= endWave;
    return {
      key: run.key,
      author: run.author,
      heroId: run.heroId,
      tribes: run.snaps[0]!.tribes,
      firstWave: run.snaps[0]!.wave,
      lastWave,
      reachedEnd,
      boards: run.snaps.map((snap) => ({ wave: snap.wave, snap, survivedAfter: lastWave - snap.wave, reachedEnd, result: snap.result })),
    };
  });
}

/** The binary imitation target for one board. */
export const isSurvivor = (b: TrajectoryBoard, horizon = DEFAULT_HORIZON, floor = SURVIVOR_FLOOR): boolean =>
  b.reachedEnd || b.wave + b.survivedAfter >= Math.max(b.wave + horizon, floor);

/** Σ(attack + health) over the board's minions. */
export const boardStats = (snap: BoardSnapshot): number => snap.minions.reduce((n, m) => n + m.attack + m.health, 0);

export const goldenCount = (snap: BoardSnapshot): number => snap.minions.filter((m) => m.golden).length;

/** The non-neutral tribe with the most bodies on the board and its share of the board (0 for an empty board). */
export function dominantTribe(snap: BoardSnapshot): { tribe: Tribe | null; share: number } {
  const counts = new Map<Tribe, number>();
  for (const m of snap.minions) {
    const def = CARD_INDEX[m.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) {
      if (!t || t === 'neutral') continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  let best: Tribe | null = null;
  let bestN = 0;
  for (const [t, n] of counts) if (n > bestN || (n === bestN && best !== null && t < best)) { best = t; bestN = n; }
  return { tribe: best, share: snap.minions.length ? bestN / snap.minions.length : 0 };
}

/** Mean minion tier of the board (0 for an empty board / unknown cards). */
export function meanMinionTier(snap: BoardSnapshot): number {
  let sum = 0;
  let n = 0;
  for (const m of snap.minions) {
    const def = CARD_INDEX[m.cardId];
    if (!def) continue;
    sum += def.tier;
    n++;
  }
  return n ? sum / n : 0;
}

/** Sorted quantile of a numeric sample (linear interpolation); NaN for an empty sample. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
