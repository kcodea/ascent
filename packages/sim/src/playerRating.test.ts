import { describe, expect, it } from 'vitest';
import {
  COURSE_COMPLETE_BONUS,
  FINAL_WIN_BONUS,
  initialProfile,
  lineForRating,
  lineRatingDelta,
  resolveLine,
  resolveRunRating,
  ROUND_15_WIN_BONUS,
  ROUND_16_WIN_BONUS,
  STARTING_RATING,
  type PlayerProfile,
} from './playerRating';

describe('player rating — Line bands', () => {
  it('maps rating to the raw Line band', () => {
    expect(lineForRating(0)).toBe(7);
    expect(lineForRating(799)).toBe(7);
    expect(lineForRating(800)).toBe(8);
    expect(lineForRating(1199)).toBe(8);
    expect(lineForRating(1200)).toBe(9);
    expect(lineForRating(1599)).toBe(9);
    expect(lineForRating(1600)).toBe(10);
    expect(lineForRating(2000)).toBe(11);
    expect(lineForRating(2400)).toBe(12);
    expect(lineForRating(9999)).toBe(12);
  });

  it('starts a new player at rating 0 / Line 7 (bottom of the ladder)', () => {
    const p = initialProfile();
    expect(p.rating).toBe(STARTING_RATING);
    expect(p.rating).toBe(0);
    expect(p.currentLine).toBe(7);
    expect(p.highestRating).toBe(0);
    expect(p.highestLine).toBe(7);
  });
});

describe('player rating — the delta table', () => {
  it('scores scored-wins-vs-Line (covering par is a modest "top 4" credit, not a win)', () => {
    expect(lineRatingDelta(4)).toBe(20);
    expect(lineRatingDelta(5)).toBe(20); // +4 or more
    expect(lineRatingDelta(3)).toBe(16);
    expect(lineRatingDelta(2)).toBe(12);
    expect(lineRatingDelta(1)).toBe(8);
    expect(lineRatingDelta(0)).toBe(4); // covered exactly — "top 4"
    expect(lineRatingDelta(-1)).toBe(-8);
    expect(lineRatingDelta(-2)).toBe(-16);
    expect(lineRatingDelta(-3)).toBe(-24);
    expect(lineRatingDelta(-4)).toBe(-32);
    expect(lineRatingDelta(-9)).toBe(-32); // -4 or worse
  });

  it('bonus ladder: summit +8, end-game ramp +8/+12, final-win +16', () => {
    expect(COURSE_COMPLETE_BONUS).toBe(8);
    expect(ROUND_15_WIN_BONUS).toBe(8);
    expect(ROUND_16_WIN_BONUS).toBe(12);
    expect(FINAL_WIN_BONUS).toBe(16);
  });
});

describe('player rating — resolveRunRating (win-weighted model)', () => {
  const base: PlayerProfile = { rating: 1420, currentLine: 9, highestRating: 1420, highestLine: 9 };

  it('TRULY winning — over the Line AND won round 17: line + summit + final-win stack high', () => {
    // Line 9, 11 scored wins (delta +2), reached the summit, won the final.
    const r = resolveRunRating(base, { scoredWins: 11, line: 9, completed: true, wonFinal: true });
    expect(r.lineDelta).toBe(2);
    expect(r.lineComponent).toBe(12);
    expect(r.completionBonus).toBe(8);
    expect(r.finalWinBonus).toBe(16);
    expect(r.ratingDelta).toBe(36); // +12 +8 +16
    expect(r.ratingAfter).toBe(1456);
  });

  it('end-game ramp: winning rounds 15 & 16 adds +8 +12 on top of line/summit/final', () => {
    // A perfect closing run: over the Line (+12), summit (+8), won the final (+16) AND the two rounds before it.
    const r = resolveRunRating(base, {
      scoredWins: 11, line: 9, completed: true, wonFinal: true, wonRound15: true, wonRound16: true,
    });
    expect(r.endgameBonus).toBe(20); // +8 (round 15) +12 (round 16)
    expect(r.finalWinBonus).toBe(16);
    expect(r.ratingDelta).toBe(56); // +12 +8 +20 +16
    expect(r.ratingAfter).toBe(1476);
  });

  it('end-game ramp is per-round: winning only round 16 adds just +12 (no round-15 bonus)', () => {
    const r = resolveRunRating(base, {
      scoredWins: 9, line: 9, completed: true, wonFinal: false, wonRound15: false, wonRound16: true,
    });
    expect(r.endgameBonus).toBe(12);
    expect(r.finalWinBonus).toBe(0);
    expect(r.ratingDelta).toBe(24); // +4 (line) +8 (summit) +12 (round 16)
  });

  it('end-game ramp defaults to 0 when the round-15/16 flags are omitted (backward-compatible)', () => {
    const r = resolveRunRating(base, { scoredWins: 11, line: 9, completed: true, wonFinal: true });
    expect(r.endgameBonus).toBe(0);
    expect(r.ratingDelta).toBe(36); // identical to the pre-ramp model
  });

  it('over the Line but LOST the final: line + summit only, no final-win bonus', () => {
    const r = resolveRunRating(base, { scoredWins: 11, line: 9, completed: true, wonFinal: false });
    expect(r.finalWinBonus).toBe(0);
    expect(r.ratingDelta).toBe(20); // +12 +8
  });

  it('covering the Line + summit (no final win) is a modest "top 4" gain', () => {
    const r = resolveRunRating(base, { scoredWins: 9, line: 9, completed: true, wonFinal: false });
    expect(r.lineDelta).toBe(0);
    expect(r.lineComponent).toBe(4);
    expect(r.ratingDelta).toBe(12); // +4 +8
  });

  it('covering the Line but falling short of the summit: line credit only', () => {
    const r = resolveRunRating(base, { scoredWins: 9, line: 9, completed: false, wonFinal: false });
    expect(r.ratingDelta).toBe(4); // +4
  });

  it('missed the Line by one but summited: the summit bonus offsets the miss', () => {
    const r = resolveRunRating(base, { scoredWins: 8, line: 9, completed: true, wonFinal: false });
    expect(r.lineComponent).toBe(-8);
    expect(r.completionBonus).toBe(8);
    expect(r.ratingDelta).toBe(0);
  });

  it('fell well under the Line: a clean loss of rating', () => {
    const r = resolveRunRating(base, { scoredWins: 6, line: 9, completed: false, wonFinal: false });
    expect(r.lineDelta).toBe(-3);
    expect(r.ratingDelta).toBe(-24);
  });

  it('floors rating at 0', () => {
    const low: PlayerProfile = { rating: 10, currentLine: 7, highestRating: 800, highestLine: 8 };
    const r = resolveRunRating(low, { scoredWins: 0, line: 7, completed: false, wonFinal: false }); // -32
    expect(r.ratingAfter).toBe(0);
    expect(r.profile.rating).toBe(0);
    expect(r.profile.highestRating).toBe(800); // high-water mark never drops
  });
});

describe('player rating — promotion/demotion hysteresis', () => {
  it('promotes when rating clears the next band threshold', () => {
    // At Line 8 (rating 1150), a strong run pushes past 1200 → promote to Line 9.
    const p: PlayerProfile = { rating: 1194, currentLine: 8, highestRating: 1194, highestLine: 8 };
    const r = resolveRunRating(p, { scoredWins: 10, line: 8, completed: true, wonFinal: false }); // +12 +8 = +20 → 1214
    expect(r.ratingAfter).toBe(1214);
    expect(r.lineAfter).toBe(9);
    expect(r.promoted).toBe(true);
  });

  it('holds the Line inside the 75-point buffer (no yo-yo)', () => {
    // At Line 9 rating 1210; a small miss stays Line 9 (demotion needs < 1125).
    const p: PlayerProfile = { rating: 1210, currentLine: 9, highestRating: 1210, highestLine: 9 };
    const r = resolveRunRating(p, { scoredWins: 6, line: 9, completed: true, wonFinal: false }); // -24 +8 = -16 → 1194
    expect(r.ratingAfter).toBe(1194);
    expect(r.lineAfter).toBe(9); // still inside the buffer (>= 1125)
    expect(r.demoted).toBe(false);
  });

  it('demotes only when rating falls under the buffer', () => {
    // At Line 9 rating 1140; a bad run drops under 1125 → demote to Line 8.
    const p: PlayerProfile = { rating: 1140, currentLine: 9, highestRating: 1300, highestLine: 9 };
    const r = resolveRunRating(p, { scoredWins: 6, line: 9, completed: false, wonFinal: false }); // -24 → 1116
    expect(r.ratingAfter).toBe(1116);
    expect(r.lineAfter).toBe(8);
    expect(r.demoted).toBe(true);
  });

  it('resolveLine can move multiple tiers if the rating jumps far', () => {
    expect(resolveLine(9, 2450)).toBe(12); // rating leapt several bands up
    expect(resolveLine(11, 700)).toBe(7); // …or crashed several bands down
  });

  it('clamps the Line to 7–12', () => {
    expect(resolveLine(7, 0)).toBe(7);
    expect(resolveLine(12, 99999)).toBe(12);
  });
});
