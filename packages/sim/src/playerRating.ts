/**
 * Player rating & Line — the career skill-pressure system.
 *
 * The **Line** is the number of scored wins a run must cover to count as a success: a golf-handicap-style
 * *expectation*, NOT a difficulty knob. (Matchmaking stays wave/power-first for now — rating is deliberately
 * kept out of opponent selection so skill isn't double-taxed.) A run's rating change is a pure function of how
 * the scored-win count compared to its Line (a modest "top 4"-style credit for merely covering par), PLUS a
 * summit bonus for reaching round 17 and an escalating end-game ramp for WINNING the closing rounds (15 → +8,
 * 16 → +12, 17 → +16, the final-win bonus) — so a *true* win (over your Line AND won the last rounds) is worth
 * much more than a covered Line, and the last, hardest rounds carry the most weight.
 *
 * This module is deterministic and side-effect-free — no storage, no `Math.random` — so it can run identically
 * on the client AND, later, inside a server (e.g. a Supabase Edge Function) that re-simulates a run from its
 * seed + action log and re-derives the delta before trusting the client. Persistence lives in the UI
 * (`profileStore`); this file is only the math + the profile shape. The `PlayerProfile` object is intentionally
 * flat so it maps 1:1 to a future `profiles` table row.
 */

export interface PlayerProfile {
  /** Skill rating. Starts at {@link STARTING_RATING}; floored at 0. Drives the Line via the promo/demo buffer. */
  rating: number;
  /** The Line tier currently assigned ({@link MIN_LINE}–{@link MAX_LINE}). Sticky: only moves when the rating
   *  crosses a promotion/demotion threshold (hysteresis), so a player near a band edge doesn't yo-yo. */
  currentLine: number;
  /** Career high-water marks (never decrease). */
  highestRating: number;
  highestLine: number;
  /** New-Line grace (softens the first misses after a promotion). Reserved for a follow-up — not applied yet. */
  lineGrace?: { line: number; missesRemaining: number };
}

/** Starting rating for a new player: 0 → **Line 7** (the bottom band), so everyone climbs up from the floor. */
export const STARTING_RATING = 0;
export const MIN_LINE = 7;
export const MAX_LINE = 12;
/** Bonus rating for reaching the summit — surviving all 17 rounds — on top of the line result. Awarded whether
 *  or not the final combat was won (you just have to get there). */
export const COURSE_COMPLETE_BONUS = 8;
/** Bonus rating for WINNING the final round (round 17) — the "win the game" payoff, stacked on top of the summit
 *  bonus. Combined with being over your Line, this is what makes a run a *true* win (vs merely covering par). */
export const FINAL_WIN_BONUS = 16;
/** End-game round win bonuses (waves 15 & 16) — the escalating "final push" reward that ramps INTO the
 *  {@link FINAL_WIN_BONUS} for round 17. The closing rounds are the hardest, so each is worth more than the
 *  last: round 15 → +{@link ROUND_15_WIN_BONUS}, round 16 → +{@link ROUND_16_WIN_BONUS}, round 17 →
 *  +{@link FINAL_WIN_BONUS}. Winning all three is the full ramp (8 + 12 + 16). */
export const ROUND_15_WIN_BONUS = 8;
export const ROUND_16_WIN_BONUS = 12;

/** Lower rating bound of each Line band — also the promotion threshold to *enter* that Line. */
const PROMOTION_THRESHOLD: Record<number, number> = { 8: 800, 9: 1200, 10: 1600, 11: 2000, 12: 2400 };
/** Rating below which you drop OUT of a Line (a 75-point buffer under the band's lower bound). */
const DEMOTION_THRESHOLD: Record<number, number> = { 8: 725, 9: 1125, 10: 1525, 11: 1925, 12: 2325 };

/** The raw Line for a rating, ignoring hysteresis — used only to seed a brand-new profile. */
export function lineForRating(rating: number): number {
  if (rating >= 2400) return 12;
  if (rating >= 2000) return 11;
  if (rating >= 1600) return 10;
  if (rating >= 1200) return 9;
  if (rating >= 800) return 8;
  return MIN_LINE;
}

/** A fresh profile: {@link STARTING_RATING} (0 → Line 7) — a new player starts at the bottom of the ladder. */
export function initialProfile(): PlayerProfile {
  const line = lineForRating(STARTING_RATING);
  return { rating: STARTING_RATING, currentLine: line, highestRating: STARTING_RATING, highestLine: line };
}

/** Resolve the Line after a rating change, applying the promotion/demotion buffer from the *current* Line so
 *  a player straddling a band edge stays put until they clear the full threshold in either direction. */
export function resolveLine(currentLine: number, rating: number): number {
  let line = Math.min(MAX_LINE, Math.max(MIN_LINE, currentLine));
  // Promote up through every threshold the new rating clears…
  while (line < MAX_LINE && rating >= (PROMOTION_THRESHOLD[line + 1] ?? Infinity)) line++;
  // …then demote down through every threshold the new rating falls under.
  while (line > MIN_LINE && rating < (DEMOTION_THRESHOLD[line] ?? -Infinity)) line--;
  return line;
}

/** The rating change from the scored-wins-vs-Line delta, BEFORE the summit + final-win bonuses. Covering the Line
 *  exactly is a small credit ("top 4" — you met par); the big payoff for a run comes from the win bonuses, not
 *  from the line component alone. The miss side is unchanged (falling short of par still stings). */
export function lineRatingDelta(deltaFromLine: number): number {
  if (deltaFromLine >= 4) return 20;
  if (deltaFromLine === 3) return 16;
  if (deltaFromLine === 2) return 12;
  if (deltaFromLine === 1) return 8;
  if (deltaFromLine === 0) return 4; // Line covered exactly — a modest "top 4" credit, not a win
  if (deltaFromLine === -1) return -8;
  if (deltaFromLine === -2) return -16;
  if (deltaFromLine === -3) return -24;
  return -32; // Line -4 or worse
}

/** The minimal finished-run inputs the rating math needs (a server could re-derive these from the replay). */
export interface RunOutcome {
  /** Scored wins over the course (excludes calibration rounds + draws). */
  scoredWins: number;
  /** The Line this run was assigned at start. */
  line: number;
  /** Reached the summit (survived all rounds) vs. fell. */
  completed: boolean;
  /** Won the FINAL round (round 17), the last combat of the course. Implies `completed` — you can't win the
   *  final without reaching it. Drives the final-win bonus (the "won the game" payoff). */
  wonFinal: boolean;
  /** Won round 15 — the first rung of the end-game win ramp (+{@link ROUND_15_WIN_BONUS}). Optional: omitted /
   *  falsy for runs that never reached round 15 (they simply earn no end-game bonus). */
  wonRound15?: boolean;
  /** Won round 16 — the second rung of the end-game win ramp (+{@link ROUND_16_WIN_BONUS}), ramping into the
   *  final-win bonus for round 17. */
  wonRound16?: boolean;
}

/** The full breakdown of a run's rating change, for persistence + the end-screen display. */
export interface RatingChange {
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  /** `scoredWins − line` (the handoff's `deltaFromLine`). */
  lineDelta: number;
  /** Rating from the line table (before the summit + final-win bonuses). */
  lineComponent: number;
  /** +{@link COURSE_COMPLETE_BONUS} if the summit was reached, else 0. */
  completionBonus: number;
  /** +{@link FINAL_WIN_BONUS} if the final round (round 17) was won, else 0. */
  finalWinBonus: number;
  /** The end-game win ramp for the two rounds before the final: +{@link ROUND_15_WIN_BONUS} (round 15) and/or
   *  +{@link ROUND_16_WIN_BONUS} (round 16), summed. 0 if neither was won. Ramps into {@link finalWinBonus}. */
  endgameBonus: number;
  lineBefore: number;
  lineAfter: number;
  promoted: boolean;
  demoted: boolean;
  /** The updated profile to persist. */
  profile: PlayerProfile;
}

/** Apply a finished run's outcome to a profile: compute the rating delta and the (possibly changed) Line.
 *  Pure — returns the new profile plus a breakdown; the caller persists it. Rating is floored at 0. */
export function resolveRunRating(profile: PlayerProfile, outcome: RunOutcome): RatingChange {
  const ratingBefore = profile.rating;
  const lineDelta = outcome.scoredWins - outcome.line;
  const lineComponent = lineRatingDelta(lineDelta);
  const completionBonus = outcome.completed ? COURSE_COMPLETE_BONUS : 0;
  const finalWinBonus = outcome.wonFinal ? FINAL_WIN_BONUS : 0;
  const endgameBonus =
    (outcome.wonRound15 ? ROUND_15_WIN_BONUS : 0) + (outcome.wonRound16 ? ROUND_16_WIN_BONUS : 0);
  const ratingDelta = lineComponent + completionBonus + finalWinBonus + endgameBonus;
  const ratingAfter = Math.max(0, ratingBefore + ratingDelta);
  const lineBefore = profile.currentLine;
  const lineAfter = resolveLine(lineBefore, ratingAfter);
  return {
    ratingBefore, ratingAfter, ratingDelta,
    lineDelta, lineComponent, completionBonus, finalWinBonus, endgameBonus,
    lineBefore, lineAfter,
    promoted: lineAfter > lineBefore,
    demoted: lineAfter < lineBefore,
    profile: {
      ...profile,
      rating: ratingAfter,
      currentLine: lineAfter,
      highestRating: Math.max(profile.highestRating, ratingAfter),
      highestLine: Math.max(profile.highestLine, lineAfter),
    },
  };
}
