/**
 * Opponent board source (M3 step 4 — "serve realistic boards"). The enemy board for a wave can be drawn
 * from a pool of real `BoardSnapshot`s (captured player boards / authored boards) instead of the
 * procedural `omen`-minion threat board. `pickOpponent` is deterministic (seeded) and only returns a board
 * when the pool has a strength-matched candidate for the wave; otherwise it returns null and the caller
 * falls back to the procedural threat (`buildEnemyBoard`). So a thin pool degrades gracefully.
 *
 * Determinism scope (be honest about it): the pool is static FOR A SESSION — registered once at startup
 * from (a) the committed synthetic floor, (b) the local board library, and (c) the live Supabase fetch —
 * and never mutated mid-run, so every replay/odds-sim within the session is byte-identical. ACROSS
 * sessions the fetched remote boards can differ, so re-deriving an old run from its (seed, actions)
 * replay may serve different opponents than were actually fought. If exact cross-session reconstruction
 * ever matters (run archives, server-side replay validation), stamp the served opponent into the run
 * record at faceOmen — see the roadmap's async-PvP hardening note.
 */
import type { BoardMinion, Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardSnapshot } from './snapshot';

/**
 * The served-opponent pool. Starts empty and is filled ONCE at startup via `registerOpponents` (committed
 * synthetic floor + local board library + the Supabase fetch), then stays fixed for the session — see the
 * determinism-scope note above.
 */
export const OPPONENT_POOL: BoardSnapshot[] = [];

/**
 * Pick an opponent by WAVE — you face a board at the same development stage (same amount of shopping). This
 * matters: matching by win count instead served over-developed boards to early players (a wave-5 board with
 * 0 wins — a struggling run — landed on a turn-1 player as Tier-2 units). Within that wave, opponents are
 * served by SOURCE PRIORITY and otherwise FULLY RANDOM (no power weighting):
 *   1) the live Supabase shared pool (`remote`), then
 *   2) any local player / friend board (`origin` self/friend), then
 *   3) the committed synthetic floor —
 * picking uniformly at random within the highest non-empty tier. So you always face real player boards when
 * any exist (freshest from Supabase first), falling to synthetic only when there are none for the wave.
 * Widens to the closest wave if none match exactly; null only on an empty pool (→ procedural fallback, rng
 * untouched). Consumes `rng` only when it returns a board. `power` is retained for signature stability but no
 * longer weights the pick (selection is fully random within the chosen tier).
 */
export function pickOpponent(
  wave: number,
  power: number,
  rng: Rng,
  pool: BoardSnapshot[] = OPPONENT_POOL,
): BoardSnapshot | null {
  void power; // no longer weights the pick — kept so the call signature (and the recruit preview) stays stable
  if (pool.length === 0) return null;
  // 1) Same WAVE (same development stage); widen to the closest available wave if none match exactly.
  let candidates = pool.filter((s) => s.wave === wave);
  if (candidates.length === 0) {
    const minDist = Math.min(...pool.map((s) => Math.abs(s.wave - wave)));
    candidates = pool.filter((s) => Math.abs(s.wave - wave) === minDist);
  }
  // 2) Source priority: live Supabase pool → local player/friend boards → committed synthetic floor.
  const remote = candidates.filter((s) => s.remote);
  const real = candidates.filter((s) => s.origin === 'self' || s.origin === 'friend');
  const tier = remote.length ? remote : real.length ? real : candidates;
  // 3) Fully random within the chosen tier (uniform — no similar-power bias).
  return tier[rng.int(tier.length)] ?? null;
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
