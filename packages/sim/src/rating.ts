/**
 * Simulate-derived board strength rating (M3 — the power framework).
 *
 * A board's rating is the fraction of a fixed CALIBRATION GAUNTLET it beats (a draw counts as half) → a
 * 0..1 score. Unlike Σ(attack + health), this is keyword- and synergy-aware: the gauntlet fights are real
 * `simulate()` resolutions, so Divine Shield, Windfury, Venomous, Reborn, deathrattles, and golden ×2 all
 * actually move the number. Deterministic (fixed gauntlet + seed), so a board always rates the same — which
 * lets `npm run pool` bake ratings into the committed pool, and lets ratings drive even, true-strength
 * matchmaking + power-band bucketing (the basis for synthesizing boards within a band).
 *
 * The gauntlet spans weak → strong so ratings spread across the full 0..1 range; a board's rating is then
 * its strength percentile against that ladder.
 */
import { simulate, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';

/** `n` copies of a vanilla body (Alleycat — no innate effect) at the given stats/keywords, so the gauntlet
 *  rungs are pure stat+keyword controls. */
const rung = (n: number, attack: number, health: number, keywords?: BoardMinion['keywords']): BoardMinion[] =>
  Array.from({ length: n }, () => (keywords ? { cardId: 'alley', attack, health, keywords } : { cardId: 'alley', attack, health }));

// Eight rungs from a 2-body 1/2 board up to a full 7-wide 9/16 Divine-Shield + Windfury board.
const GAUNTLET: BoardMinion[][] = [
  rung(2, 1, 2),
  rung(3, 2, 3),
  rung(4, 3, 4),
  rung(5, 4, 6),
  rung(5, 5, 8, ['DS']),
  rung(6, 6, 10, ['W']),
  rung(7, 7, 12, ['DS', 'W']),
  rung(7, 9, 16, ['DS', 'W']),
];

const RATING_SEED = 0x9e3779b1; // fixed → ratings are reproducible (the gauntlet RNG only nudges tie-breaks)

/**
 * Rate a board 0..1 by the fraction of the calibration gauntlet it beats (draw = 0.5). 0 = beats nothing,
 * 1 = beats everything. `tier` is the board's tavern tier (loss-damage scaling is irrelevant here; passed
 * through for completeness). An empty board rates 0.
 */
export function rateBoard(board: BoardMinion[], tier = 1): number {
  if (board.length === 0) return 0;
  let score = 0;
  for (const ref of GAUNTLET) {
    const { result } = simulate(board, ref, makeRng(RATING_SEED), CARD_INDEX, 0, 0, tier);
    score += result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  }
  return score / GAUNTLET.length;
}

/** Number of power bands the 0..1 rating is bucketed into for matchmaking + synthesis targeting. */
export const BAND_COUNT = 8;

/** The band index (0..BAND_COUNT-1) for a rating — a coarse strength bucket. */
export function ratingBand(rating: number): number {
  return Math.min(BAND_COUNT - 1, Math.max(0, Math.floor(rating * BAND_COUNT)));
}
