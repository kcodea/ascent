import { describe, expect, it } from 'vitest';
import {
  COURSE_COMPLETE_BONUS,
  initialProfile,
  lineForRating,
  lineRatingDelta,
  resolveLine,
  resolveRunRating,
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
  it('matches the handoff rating table exactly', () => {
    expect(lineRatingDelta(4)).toBe(36);
    expect(lineRatingDelta(5)).toBe(36); // +4 or more
    expect(lineRatingDelta(3)).toBe(30);
    expect(lineRatingDelta(2)).toBe(22);
    expect(lineRatingDelta(1)).toBe(14);
    expect(lineRatingDelta(0)).toBe(6); // covered exactly
    expect(lineRatingDelta(-1)).toBe(-8);
    expect(lineRatingDelta(-2)).toBe(-16);
    expect(lineRatingDelta(-3)).toBe(-24);
    expect(lineRatingDelta(-4)).toBe(-32);
    expect(lineRatingDelta(-9)).toBe(-32); // -4 or worse
  });

  it('course-complete bonus is +4', () => {
    expect(COURSE_COMPLETE_BONUS).toBe(4);
  });
});

describe('player rating — resolveRunRating (handoff worked examples)', () => {
  const base: PlayerProfile = { rating: 1420, currentLine: 9, highestRating: 1420, highestLine: 9 };

  it('Line 9, course complete at 11-4: +22 +4 = +26', () => {
    const r = resolveRunRating(base, { scoredWins: 11, line: 9, completed: true });
    expect(r.lineDelta).toBe(2);
    expect(r.lineComponent).toBe(22);
    expect(r.completionBonus).toBe(4);
    expect(r.ratingDelta).toBe(26);
    expect(r.ratingAfter).toBe(1446);
  });

  it('Line 9, falls after reaching 11 wins: +22 +0 = +22', () => {
    const r = resolveRunRating(base, { scoredWins: 11, line: 9, completed: false });
    expect(r.ratingDelta).toBe(22);
  });

  it('Line 9, falls after exactly 9 wins: +6 +0 = +6', () => {
    const r = resolveRunRating(base, { scoredWins: 9, line: 9, completed: false });
    expect(r.lineDelta).toBe(0);
    expect(r.ratingDelta).toBe(6);
  });

  it('Line 9, course complete at 8-7: -8 +4 = -4', () => {
    const r = resolveRunRating(base, { scoredWins: 8, line: 9, completed: true });
    expect(r.lineDelta).toBe(-1);
    expect(r.lineComponent).toBe(-8);
    expect(r.completionBonus).toBe(4);
    expect(r.ratingDelta).toBe(-4);
  });

  it('Line 9, falls at 6 wins: -24 +0 = -24', () => {
    const r = resolveRunRating(base, { scoredWins: 6, line: 9, completed: false });
    expect(r.lineDelta).toBe(-3);
    expect(r.ratingDelta).toBe(-24);
  });

  it('floors rating at 0', () => {
    const low: PlayerProfile = { rating: 10, currentLine: 7, highestRating: 800, highestLine: 8 };
    const r = resolveRunRating(low, { scoredWins: 0, line: 7, completed: false }); // -32
    expect(r.ratingAfter).toBe(0);
    expect(r.profile.rating).toBe(0);
    expect(r.profile.highestRating).toBe(800); // high-water mark never drops
  });
});

describe('player rating — promotion/demotion hysteresis', () => {
  it('promotes when rating clears the next band threshold', () => {
    // At Line 8 (rating 1150), a strong run pushes past 1200 → promote to Line 9.
    const p: PlayerProfile = { rating: 1194, currentLine: 8, highestRating: 1194, highestLine: 8 };
    const r = resolveRunRating(p, { scoredWins: 10, line: 8, completed: true }); // +22 +4 = +26 → 1220
    expect(r.ratingAfter).toBe(1220);
    expect(r.lineAfter).toBe(9);
    expect(r.promoted).toBe(true);
  });

  it('holds the Line inside the 75-point buffer (no yo-yo)', () => {
    // Just promoted to Line 9 at 1210; a small miss to 1180 stays Line 9 (demotion needs < 1125).
    const p: PlayerProfile = { rating: 1210, currentLine: 9, highestRating: 1210, highestLine: 9 };
    const r = resolveRunRating(p, { scoredWins: 6, line: 9, completed: true }); // -24 +4 = -20 → 1190
    expect(r.ratingAfter).toBe(1190);
    expect(r.lineAfter).toBe(9); // still inside the buffer (>= 1125)
    expect(r.demoted).toBe(false);
  });

  it('demotes only when rating falls under the buffer', () => {
    // At Line 9 rating 1140; a bad run drops under 1125 → demote to Line 8.
    const p: PlayerProfile = { rating: 1140, currentLine: 9, highestRating: 1300, highestLine: 9 };
    const r = resolveRunRating(p, { scoredWins: 6, line: 9, completed: false }); // -24 → 1116
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
