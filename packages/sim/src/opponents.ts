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
import type { ThreatId } from './threats';

/** Build a bootstrap snapshot from a board (power computed). Placeholder shape until the real library fills in. */
function boot(wave: number, threat: ThreatId, minions: BoardMinion[]): BoardSnapshot {
  return {
    v: 1,
    wave,
    heroId: 'warden',
    tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
    threat,
    result: 'win',
    power: minions.reduce((s, m) => s + m.attack + m.health, 0),
    minions,
    seed: 0,
  };
}

/**
 * The served-opponent pool. STATIC + versioned so opponent selection stays deterministic / replay-faithful.
 * These are BOOTSTRAP boards (real cards, roughly on-curve per wave) so the seam works end-to-end today;
 * real captured/authored boards replace + grow them in batches (step 3 — the board library).
 */
export const OPPONENT_POOL: BoardSnapshot[] = [
  boot(2, 'horde', [
    { cardId: 'alley', attack: 2, health: 2, keywords: [] },
    { cardId: 'stray', attack: 2, health: 3, keywords: [] },
    { cardId: 'kennel', attack: 1, health: 2, keywords: [] },
  ]),
  boot(3, 'horde', [
    { cardId: 'whelp', attack: 3, health: 3, keywords: [] },
    { cardId: 'kennel', attack: 3, health: 4, keywords: [] },
    { cardId: 'pack', attack: 3, health: 4, keywords: [] },
  ]),
  boot(4, 'iron', [
    { cardId: 'imp', attack: 4, health: 5, keywords: [] },
    { cardId: 'kennel', attack: 4, health: 5, keywords: [] },
    { cardId: 'broker', attack: 5, health: 6, keywords: [] },
    { cardId: 'whelp', attack: 2, health: 4, keywords: [] },
  ]),
  boot(5, 'glass', [
    { cardId: 'grim', attack: 7, health: 4, keywords: [] },
    { cardId: 'monk', attack: 6, health: 7, keywords: [] },
    { cardId: 'kennel', attack: 6, health: 7, keywords: [] },
    { cardId: 'pack', attack: 5, health: 6, keywords: [] },
  ]),
];

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
