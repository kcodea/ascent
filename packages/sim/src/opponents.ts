/**
 * Opponent board source (M3 step 4 — "serve realistic boards"). The enemy board for a wave can be drawn
 * from a pool of real `BoardSnapshot`s (captured player boards / authored boards) instead of the
 * procedural `omen`-minion threat board. `pickOpponent` is deterministic (seeded) and only returns a board
 * when the pool has a strength-matched candidate for the wave; otherwise it returns null and the caller
 * falls back to the procedural threat (`buildEnemyBoard`). So a thin pool degrades gracefully.
 *
 * The pool is a STATIC, versioned dataset — that's deliberate: opponent selection must stay deterministic
 * and replay-faithful (a run re-runs byte-identically), which a live/mutable pool would break. The board
 * library (step 3) grows this dataset (hand it boards in batches; they slot into `OPPONENT_POOL`); the
 * bootstrap entries below are placeholders to be replaced. Async-PvP's live pool (step 5) is a separate,
 * non-deterministic track.
 */
import type { BoardMinion, Rng } from '@game/core';
import type { BoardSnapshot } from './snapshot';

/**
 * The served-opponent pool. STATIC + versioned so opponent selection stays deterministic / replay-faithful.
 *
 * INTENTIONALLY EMPTY right now — we serve the procedural omen threat for every wave (`pickOpponent`
 * returns null on an empty pool, so `faceOmen` falls straight through to `buildEnemyBoard`). Real boards
 * return soon: populate this from the board library (captured / authored `BoardSnapshot`s) and
 * `pickOpponent` starts serving them with no other changes. The bootstrap examples that used to seed it
 * live in git history (commit b799861).
 */
export const OPPONENT_POOL: BoardSnapshot[] = [];

/**
 * Pick a strength-matched opponent for a wave, or null to fall back to the procedural threat. Matches by
 * wave (±1), then by closest power within a tolerance (so a thin pool degrades to procedural rather than
 * serving a wildly off-curve board), and randomizes among the closest few for variety. Consumes `rng` ONLY
 * when it returns a board, so an empty / no-match pool leaves the caller's procedural rng untouched
 * (the fallback board stays byte-identical to before this seam existed).
 */
export function pickOpponent(
  wave: number,
  power: number,
  rng: Rng,
  pool: BoardSnapshot[] = OPPONENT_POOL,
): BoardSnapshot | null {
  const candidates = pool.filter((s) => Math.abs(s.wave - wave) <= 1);
  if (candidates.length === 0) return null;
  const tolerance = Math.max(10, power * 0.5);
  const close = candidates
    .filter((s) => Math.abs(s.power - power) <= tolerance)
    .sort((a, b) => Math.abs(a.power - power) - Math.abs(b.power - power));
  if (close.length === 0) return null;
  return close[rng.int(Math.min(3, close.length))] ?? null;
}

/** A fresh, mutation-safe clone of a snapshot's board for handing to `simulate` (protects the static pool). */
export function opponentBoard(snap: BoardSnapshot): BoardMinion[] {
  return snap.minions.map((m) => ({
    cardId: m.cardId,
    attack: m.attack,
    health: m.health,
    keywords: [...(m.keywords ?? [])],
    ...(m.golden ? { golden: true } : {}),
    ...(m.summonBonus ? { summonBonus: m.summonBonus } : {}),
  }));
}
