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
import { CARD_INDEX } from '@game/content';
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
 * Pick an opponent by WAVE — you face a board at the same development stage (same amount of shopping). This
 * matters: matching by win count instead served over-developed boards to early players (a wave-5 board with
 * 0 wins — a struggling run — landed on a turn-1 player as Tier-2 units). Then: prefer REAL player/friend
 * boards over house/synthetic, and bias toward a similar-power board for a fair fight, randomizing among the
 * closest few for variety. Widens to the closest wave if none match exactly; null only on an empty pool
 * (→ procedural fallback, rng untouched). Consumes `rng` only when it returns a board.
 */
export function pickOpponent(
  wave: number,
  power: number,
  rng: Rng,
  pool: BoardSnapshot[] = OPPONENT_POOL,
): BoardSnapshot | null {
  if (pool.length === 0) return null;
  // 1) Same WAVE (same development stage); widen to the closest available wave if none match exactly.
  let candidates = pool.filter((s) => s.wave === wave);
  if (candidates.length === 0) {
    const minDist = Math.min(...pool.map((s) => Math.abs(s.wave - wave)));
    candidates = pool.filter((s) => Math.abs(s.wave - wave) === minDist);
  }
  // 2) Prefer real player/friend boards over house/synthetic at this wave.
  const real = candidates.filter((s) => s.origin === 'self' || s.origin === 'friend');
  const pref = real.length ? real : candidates;
  // 3) Bias toward similar power (fair fight), randomize among the closest few.
  const close = [...pref].sort((a, b) => Math.abs(a.power - power) - Math.abs(b.power - power));
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

/** A snapshot is servable only if EVERY minion's cardId still exists in the current build. A board captured
 *  by an older version can reference a card a later patch removed/renamed (e.g. Corrupted Lifebinder); serving
 *  it would throw `Unknown card` in `instantiate` and hard-lock combat (the End-Turn freeze). Drop such boards
 *  at the door so the pool only ever holds boards this build can actually fight. */
export function isServableBoard(snap: BoardSnapshot): boolean {
  return snap.minions.every((m) => CARD_INDEX[m.cardId] !== undefined);
}

/**
 * Append boards to the served pool. The app calls this ONCE at startup (with the deterministic bootstrap
 * pool), and step 3's library will grow it in batches. Keep it static for a session — inject before any run
 * faces combat and don't mutate mid-run, or replays stop being byte-identical.
 *
 * Stale boards (referencing a card this build no longer has) are filtered out here — they'd otherwise crash
 * combat when served. Both sources (bootstrap pool + persisted player boards) route through this, so neither
 * can poison the pool with an unfightable board.
 */
export function registerOpponents(snaps: BoardSnapshot[]): void {
  OPPONENT_POOL.push(...snaps.filter(isServableBoard));
}
