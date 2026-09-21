import { describe, expect, it } from 'vitest';
import {
  RANK_MEDALS, RANK_RULES, RANK_SEASON,
  compareRank, divisionTierOf, hasDemotionGate, initialRankedProfile, isDemotionReady, isPromotionReady, isRankPosition, isRankedProfile, medalOf,
  parseRankResult, parseRankedProfile, promotionKindAt, rankDivisionCount, rankLabel, rankScalar, rankTopDivision,
  rankedRunIdOf, requiredFinishFor, resolveRank, settleRank,
  type RankPosition, type RankResult,
} from './rank';

/**
 * MEDAL RANK — the rules, pinned (owner decisions 2026-09-20).
 *
 * The fixture table is the blueprint's §3 acceptance table ADJUSTED to the owner's rulings: a won promotion
 * lands at 0/100 in the next division (not the game's award), a MEDAL gate needs 1st (a 2nd–4th holds at 100),
 * a DIVISION gate needs top-4; and the owner's same-day addition: demotion across a MEDAL boundary is gated
 * — a LOSS that lands on 0 at the medal's lowest division clamps there and ARMS the STORED `demotionReady`
 * flag; the next game is a demotion game (bottom-4 drops to the previous medal's I at 100 + award, top-4
 * escapes and disarms). Merely standing at 0 (a fresh medal promotion) is NOT armed. Then every boundary, and
 * the structural properties §11 asks for: better placement never lands lower, no same-game promotion, no
 * multi-division jump, highest never decreases.
 *
 * These same fixtures drive the server mirror in packages/ui/src/lobbyRatingParity.test.ts.
 */

/** Division index by label — the fixtures read like the blueprint. */
const D = (label: string): number => {
  const [medal, tier] = label.split(' ');
  const m = RANK_MEDALS.indexOf(medal as (typeof RANK_MEDALS)[number]);
  const t = { III: 0, II: 1, I: 2 }[tier as 'III' | 'II' | 'I'];
  if (m < 0 || t === undefined) throw new Error(`bad label ${label}`);
  return m * 3 + t;
};
const at = (label: string, points: number, demotionReady = false): RankPosition => ({ divisionIndex: D(label), points, demotionReady });
/** An ARMED demotion gate: 0 points on a medal's lowest division after a loss landed there. */
const armed = (label: string): RankPosition => at(label, 0, true);

/** [before, placement, after, appliedDelta, flags] */
type Row = [RankPosition, number, RankPosition, number, Partial<Pick<RankResult, 'promoted' | 'demoted' | 'promotionUnlocked' | 'wasPromotionGame' | 'promotionKind' | 'cappedPoints' | 'requiredFinish' | 'wasDemotionGame' | 'demotionUnlocked'>>, string];
export const RANK_FIXTURES: Row[] = [
  [at('Gold II', 60), 3, at('Gold II', 76), 16, { promotionUnlocked: false }, 'plain gain'],
  [at('Gold II', 88), 1, at('Gold II', 100), 12, { promotionUnlocked: true, cappedPoints: 28 }, 'reaching 100 unlocks, does not promote; overflow discarded'],
  [at('Gold II', 94), 4, at('Gold II', 100), 6, { promotionUnlocked: true, cappedPoints: 0 }, 'exactly 100 unlocks'],
  [at('Gold II', 100), 3, at('Gold I', 0), 0, { wasPromotionGame: true, promotionKind: 'division', requiredFinish: 4, promoted: true, cappedPoints: 0 }, 'division gate: 3rd wins → next division at 0'],
  [at('Gold II', 100), 4, at('Gold I', 0), 0, { wasPromotionGame: true, promotionKind: 'division', promoted: true }, 'division gate: 4th still wins'],
  [at('Gold II', 100), 5, at('Gold II', 94), -6, { wasPromotionGame: true, promotionKind: 'division', promoted: false }, 'division gate: 5th fails, normal −6'],
  [at('Gold II', 100), 8, at('Gold II', 60), -40, { wasPromotionGame: true, promotionKind: 'division', promoted: false, demoted: false }, 'division gate: 8th fails, −40'],
  [at('Gold I', 100), 1, at('Platinum III', 0), 0, { wasPromotionGame: true, promotionKind: 'medal', requiredFinish: 1, promoted: true }, 'medal gate: 1st wins → next medal at 0'],
  [at('Gold I', 100), 2, at('Gold I', 100), 0, { wasPromotionGame: true, promotionKind: 'medal', promoted: false, promotionUnlocked: false, cappedPoints: 28 }, 'medal gate: 2nd HOLDS at 100 — no promote, no gain'],
  [at('Gold I', 100), 4, at('Gold I', 100), 0, { wasPromotionGame: true, promotionKind: 'medal', promoted: false, cappedPoints: 6 }, 'medal gate: 4th holds at 100'],
  [at('Gold I', 100), 5, at('Gold I', 94), -6, { wasPromotionGame: true, promotionKind: 'medal', promoted: false }, 'medal gate: 5th drops normally'],
  [at('Gold I', 100), 8, at('Gold I', 60), -40, { wasPromotionGame: true, promotionKind: 'medal', promoted: false }, 'medal gate: 8th drops −40'],
  [at('Gold II', 10), 8, at('Gold III', 70), -40, { demoted: true, demotionUnlocked: false }, 'demotion within a medal carries the remainder'],
  [at('Gold II', 6), 5, at('Gold II', 0), -6, { demoted: false, demotionUnlocked: false }, 'exactly 0 stays (Gold II has no demotion gate)'],
  [at('Gold II', 0), 5, at('Gold III', 94), -6, { demoted: true }, 'from 0 a loss demotes within the medal'],
  // ── the MEDAL-boundary demotion gate (owner addition 2026-09-20) ──
  [at('Gold III', 10), 8, armed('Gold III'), -10, { demoted: false, demotionUnlocked: true, wasDemotionGame: false, cappedPoints: 30 }, 'medal floor: a loss CLAMPS at 0 → ARMED'],
  [at('Gold III', 6), 5, armed('Gold III'), -6, { demoted: false, demotionUnlocked: true, cappedPoints: 0 }, 'a loss landing exactly on 0 at a medal floor arms too'],
  [armed('Gold III'), 8, at('Silver I', 60), -40, { wasDemotionGame: true, requiredFinish: 4, demoted: true, demotionUnlocked: false, cappedPoints: 0 }, 'demotion game: 8th drops to Silver I at 100 + award'],
  [armed('Gold III'), 5, at('Silver I', 94), -6, { wasDemotionGame: true, demoted: true }, 'demotion game: 5th drops to Silver I 94'],
  [armed('Gold III'), 4, at('Gold III', 6), 6, { wasDemotionGame: true, demoted: false, demotionUnlocked: false }, 'demotion game: 4th escapes with its award from 0 and DISARMS'],
  [armed('Gold III'), 3, at('Gold III', 16), 16, { wasDemotionGame: true, demoted: false }, 'demotion game: 3rd → Gold III 16'],
  [armed('Gold III'), 1, at('Gold III', 40), 40, { wasDemotionGame: true, demoted: false, promotionUnlocked: false }, 'demotion game: 1st → Gold III 40'],
  [at('Silver I', 100), 1, at('Gold III', 0), 0, { promoted: true, promotionKind: 'medal', demotionUnlocked: false }, 'a won MEDAL promotion lands at 0 in the new medal — NOT armed'],
  [at('Gold III', 0), 8, armed('Gold III'), 0, { wasDemotionGame: false, demoted: false, demotionUnlocked: true, cappedPoints: 40 }, 'the first loss at 0 (fresh promotion) clamps and ARMS — no demotion yet'],
  [at('Gold III', 0), 4, at('Gold III', 6), 6, { wasDemotionGame: false, demoted: false, demotionUnlocked: false }, 'at 0 but NOT armed, a top-4 is an ordinary gain'],
  [at('Gold II', 100), 4, at('Gold I', 0), 0, { promoted: true, demotionUnlocked: false }, 'a won DIVISION promotion lands at 0 with no demotion gate'],
  [at('Ascendant III', 5), 8, armed('Ascendant III'), -5, { demoted: false, demotionUnlocked: true }, 'Ascendant III is a medal floor too'],
  [armed('Ascendant III'), 6, at('Diamond I', 84), -16, { wasDemotionGame: true, demoted: true }, 'Ascendant III demotion game: 6th → Diamond I 84'],
  [armed('Silver III'), 7, at('Bronze I', 72), -28, { wasDemotionGame: true, demoted: true }, 'Silver III demotion game: 7th → Bronze I 72'],
  [at('Bronze III', 0), 8, at('Bronze III', 0), 0, { wasDemotionGame: false, demoted: false, demotionUnlocked: false, cappedPoints: 40 }, 'Bronze III at 0: floor, NO gate'],
  [at('Bronze III', 10), 8, at('Bronze III', 0), -10, { demoted: false, cappedPoints: 30 }, 'Bronze floor absorbs the rest'],
  [at('Bronze III', 0), 8, at('Bronze III', 0), 0, { demoted: false, cappedPoints: 40 }, 'Bronze floor at 0 applies nothing'],
  [at('Ascendant II', 100), 1, at('Ascendant I', 0), 0, { wasPromotionGame: true, promotionKind: 'division', promoted: true }, 'into the top division at 0'],
  [at('Ascendant II', 100), 4, at('Ascendant I', 0), 0, { wasPromotionGame: true, promotionKind: 'division', promoted: true }, 'Ascendant II → I is a DIVISION gate (same medal) — 4th wins'],
  [at('Ascendant III', 100), 4, at('Ascendant II', 0), 0, { wasPromotionGame: true, promotionKind: 'division', promoted: true }, 'Ascendant III → II on top-4'],
  [at('Diamond I', 100), 2, at('Diamond I', 100), 0, { wasPromotionGame: true, promotionKind: 'medal', promoted: false }, 'Diamond I → Ascendant III is the last MEDAL gate — 2nd holds'],
  [at('Diamond I', 100), 1, at('Ascendant III', 0), 0, { wasPromotionGame: true, promotionKind: 'medal', promoted: true }, 'Diamond I → Ascendant III on 1st'],
  [at('Ascendant I', 90), 1, at('Ascendant I', 130), 40, { promotionUnlocked: false, wasPromotionGame: false }, 'Ascendant I is uncapped, no gate'],
  [at('Ascendant I', 100), 1, at('Ascendant I', 140), 40, { wasPromotionGame: false }, 'Ascendant I at 100 is NOT a gate'],
  [at('Ascendant I', 10), 8, at('Ascendant II', 70), -40, { demoted: true }, 'Ascendant I demotes below 0'],
  [at('Ascendant I', 0), 5, at('Ascendant II', 94), -6, { demoted: true }, 'Ascendant I at 0 demotes on any loss'],
  [at('Silver I', 100), 1, at('Gold III', 0), 0, { promotionKind: 'medal', promoted: true }, 'Silver I → Gold III on 1st'],
  [at('Bronze III', 100), 4, at('Bronze II', 0), 0, { promotionKind: 'division', promoted: true }, 'Bronze III → Bronze II on 4th'],
  [at('Bronze I', 100), 4, at('Bronze I', 100), 0, { promotionKind: 'medal', promoted: false }, 'Bronze I gate needs 1st; 4th holds'],
];

describe('rank — the configuration', () => {
  it('18 divisions, 100 points each, the blueprint award table, top-4 / 1st gates', () => {
    expect(rankDivisionCount()).toBe(18);
    expect(rankTopDivision()).toBe(17);
    expect(RANK_RULES.divisionPoints).toBe(100);
    expect([...RANK_RULES.placementAwards]).toEqual([40, 28, 16, 6, -6, -16, -28, -40]);
    expect(RANK_RULES.placementAwards.reduce((a, b) => a + b, 0), 'the base table sums to zero').toBe(0);
    expect(RANK_RULES.divisionPromotionFinish).toBe(4);
    expect(RANK_RULES.medalPromotionFinish).toBe(1);
    expect(RANK_SEASON).toBe(3);
  });

  it('labels: III → II → I within a medal, then the next medal', () => {
    expect(rankLabel(0)).toBe('Bronze III');
    expect(rankLabel(1)).toBe('Bronze II');
    expect(rankLabel(2)).toBe('Bronze I');
    expect(rankLabel(3)).toBe('Silver III');
    expect(rankLabel({ divisionIndex: 7, points: 40 })).toBe('Gold II');
    expect(rankLabel(17)).toBe('Ascendant I');
    expect(medalOf(9)).toBe('Platinum');
    expect(divisionTierOf(9)).toBe(3);
    expect(divisionTierOf(11)).toBe(1);
    expect(RANK_MEDALS).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant']);
  });

  it('gate kinds: the top of each medal is a medal gate, the rest are division gates, the top division has none', () => {
    expect(promotionKindAt(0)).toBe('division');
    expect(promotionKindAt(1)).toBe('division');
    expect(promotionKindAt(2)).toBe('medal');
    expect(promotionKindAt(14), 'Diamond I → Ascendant III').toBe('medal');
    expect(promotionKindAt(15), 'Ascendant III → II').toBe('division');
    expect(promotionKindAt(16), 'Ascendant II → I').toBe('division');
    expect(promotionKindAt(17)).toBeNull();
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].filter((d) => promotionKindAt(d) === 'medal')).toEqual([2, 5, 8, 11, 14]);
    expect(requiredFinishFor('division')).toBe(4);
    expect(requiredFinishFor('medal')).toBe(1);
    expect(requiredFinishFor(null)).toBeNull();
  });

  it('compareRank orders division first, then points; the scalar ties at a boundary', () => {
    expect(compareRank(at('Gold I', 0), at('Gold II', 100))).toBeGreaterThan(0);
    expect(rankScalar(at('Gold I', 0))).toBe(rankScalar(at('Gold II', 100)));
    expect(compareRank(at('Gold II', 50), at('Gold II', 50))).toBe(0);
    expect(compareRank(at('Gold II', 49), at('Gold II', 50))).toBeLessThan(0);
  });

  it('promotion-ready is derived: 100 below the top, never in Ascendant I', () => {
    expect(isPromotionReady(at('Gold II', 100))).toBe(true);
    expect(isPromotionReady(at('Gold II', 99))).toBe(false);
    expect(isPromotionReady(at('Ascendant I', 100))).toBe(false);
  });

  it('demotion-ready is a STORED flag, valid only at 0 on a medal\'s lowest division above Bronze', () => {
    expect(isDemotionReady(armed('Gold III'))).toBe(true);
    expect(isDemotionReady(at('Gold III', 0)), 'standing at 0 is not armed').toBe(false);
    expect(isDemotionReady({ divisionIndex: 6, points: 0 }), 'absent = false').toBe(false);
    expect(isRankPosition(armed('Gold III'))).toBe(true);
    expect(isRankPosition({ divisionIndex: 6, points: 1, demotionReady: true }), 'armed off 0 is corrupt').toBe(false);
    expect(isRankPosition({ divisionIndex: 7, points: 0, demotionReady: true }), 'armed off a floor is corrupt').toBe(false);
    expect(isRankPosition({ divisionIndex: 0, points: 0, demotionReady: true }), 'Bronze III has no gate').toBe(false);
    expect([...Array(18).keys()].filter((d) => hasDemotionGate(d))).toEqual([3, 6, 9, 12, 15]);
    expect(RANK_RULES.demotionEscapeFinish).toBe(4);
  });

  it('the owner\'s sequence: medal promotion → first loss ARMS (no demotion) → second loss DEMOTES', () => {
    const won = resolveRank(at('Silver I', 100), 1);
    expect(won.after).toEqual(at('Gold III', 0));
    expect(won.demotionUnlocked).toBe(false);
    const first = resolveRank(won.after, 8);
    expect(first.wasDemotionGame).toBe(false);
    expect(first.demoted).toBe(false);
    expect(first.after).toEqual(armed('Gold III'));
    expect(first.demotionUnlocked).toBe(true);
    expect(first.appliedDelta).toBe(0);
    const second = resolveRank(first.after, 8);
    expect(second.wasDemotionGame).toBe(true);
    expect(second.demoted).toBe(true);
    expect(second.after).toEqual(at('Silver I', 60));
    // …and a top-4 escape from the armed state DISARMS; a later loss must arm again before demoting
    const escaped = resolveRank(first.after, 2);
    expect(escaped.after).toEqual(at('Gold III', 28));
    expect(escaped.demotionUnlocked).toBe(false);
    const back = resolveRank(escaped.after, 8);
    expect(back.after).toEqual(armed('Gold III'));
    expect(back.demoted).toBe(false);
  });
});

describe('rank — the fixture table (blueprint §3 under the owner rules)', () => {
  for (const [before, placement, after, applied, flags, name] of RANK_FIXTURES) {
    it(`${rankLabel(before)} ${before.points} · ${placement}th → ${rankLabel(after)} ${after.points} (${name})`, () => {
      const r = resolveRank(before, placement);
      expect(r.after).toEqual(after);
      expect(r.appliedDelta).toBe(applied);
      expect(r.baseDelta).toBe(RANK_RULES.placementAwards[placement - 1]);
      expect(r.appliedDelta).toBe(rankScalar(r.after) - rankScalar(r.before));
      for (const [k, v] of Object.entries(flags)) expect((r as unknown as Record<string, unknown>)[k], k).toBe(v);
      expect(r.before, 'the input position is reported, not mutated').toEqual(before);
    });
  }
});

describe('rank — the explicit medal-gate rule', () => {
  it('at a medal gate a 2nd–4th finish neither promotes nor gains: stays at 100, still promotion-ready', () => {
    for (const placement of [2, 3, 4]) {
      const r = resolveRank(at('Gold I', 100), placement);
      expect(r.promoted).toBe(false);
      expect(r.after).toEqual(at('Gold I', 100));
      expect(r.appliedDelta).toBe(0);
      expect(r.cappedPoints).toBe(RANK_RULES.placementAwards[placement - 1]);
      expect(isPromotionReady(r.after)).toBe(true);
      expect(r.wasPromotionGame).toBe(true);
      expect(r.promotionKind).toBe('medal');
      expect(r.requiredFinish).toBe(1);
    }
    for (const placement of [5, 6, 7, 8]) {
      const r = resolveRank(at('Gold I', 100), placement);
      expect(r.promoted).toBe(false);
      expect(r.after.points).toBe(100 + RANK_RULES.placementAwards[placement - 1]!);
      expect(r.after.divisionIndex).toBe(D('Gold I'));
      expect(isPromotionReady(r.after)).toBe(false);
    }
  });

  it('a won promotion starts the next division at 0/100 — never the award', () => {
    expect(resolveRank(at('Gold II', 100), 1).after).toEqual(at('Gold I', 0));
    expect(resolveRank(at('Gold I', 100), 1).after).toEqual(at('Platinum III', 0));
  });
});

describe('rank — boundaries', () => {
  it('rejects non-integer / out-of-range placements and malformed positions', () => {
    expect(() => resolveRank(at('Gold II', 0), 0)).toThrow(RangeError);
    expect(() => resolveRank(at('Gold II', 0), 9)).toThrow(RangeError);
    expect(() => resolveRank(at('Gold II', 0), 2.5)).toThrow(RangeError);
    expect(() => resolveRank(at('Gold II', 0), Number.NaN)).toThrow(RangeError);
    expect(() => resolveRank({ divisionIndex: 18, points: 0 }, 1)).toThrow(RangeError);
    expect(() => resolveRank({ divisionIndex: 3, points: 101 }, 1)).toThrow(RangeError);
    expect(() => resolveRank({ divisionIndex: -1, points: 0 }, 1)).toThrow(RangeError);
    expect(() => resolveRank({ divisionIndex: 17, points: 101 }, 1)).not.toThrow(); // the top is uncapped
  });

  it('every division: reaching 100 unlocks without promoting; every gate promotes exactly one division', () => {
    for (let d = 0; d < 17; d++) {
      const reach = resolveRank({ divisionIndex: d, points: 99 }, 1);
      expect(reach.after).toEqual({ divisionIndex: d, points: 100, demotionReady: false });
      expect(reach.promotionUnlocked).toBe(true);
      expect(reach.promoted).toBe(false);
      expect(reach.cappedPoints).toBe(39);
      const won = resolveRank({ divisionIndex: d, points: 100 }, 1);
      expect(won.after).toEqual({ divisionIndex: d + 1, points: 0, demotionReady: false });
      expect(won.promoted).toBe(true);
      expect(won.promotionUnlocked).toBe(false);
    }
  });

  it('below 0: divisions inside a medal demote to 100 + result; medal floors clamp at 0 (gate); Bronze III floors', () => {
    for (let d = 1; d <= 17; d++) {
      const r = resolveRank({ divisionIndex: d, points: 5 }, 8);
      if (hasDemotionGate(d)) {
        expect(r.after, `division ${d} is a medal floor`).toEqual({ divisionIndex: d, points: 0, demotionReady: true });
        expect(r.demoted).toBe(false);
        expect(r.demotionUnlocked).toBe(true);
        expect(r.appliedDelta).toBe(-5);
        expect(r.cappedPoints).toBe(35);
        // …and the demotion game that follows: bottom-4 drops to the previous medal's I at 100 + award
        for (let placement = 5; placement <= 8; placement++) {
          const g = resolveRank(r.after, placement);
          expect(g.wasDemotionGame).toBe(true);
          expect(g.demoted).toBe(true);
          expect(g.after).toEqual({ divisionIndex: d - 1, points: 100 + RANK_RULES.placementAwards[placement - 1]!, demotionReady: false });
          expect(g.appliedDelta).toBe(RANK_RULES.placementAwards[placement - 1]);
          expect(g.cappedPoints).toBe(0);
        }
        for (let placement = 1; placement <= 4; placement++) {
          const g = resolveRank(r.after, placement);
          expect(g.wasDemotionGame).toBe(true);
          expect(g.demoted).toBe(false);
          expect(g.after).toEqual({ divisionIndex: d, points: RANK_RULES.placementAwards[placement - 1]!, demotionReady: false });
        }
      } else {
        expect(r.after).toEqual({ divisionIndex: d - 1, points: 65, demotionReady: false });
        expect(r.demoted).toBe(true);
        expect(r.demotionUnlocked).toBe(false);
      }
    }
    const floor = resolveRank({ divisionIndex: 0, points: 5 }, 8);
    expect(floor.after).toEqual({ divisionIndex: 0, points: 0, demotionReady: false });
    expect(floor.demoted).toBe(false);
    expect(floor.appliedDelta).toBe(-5);
    expect(floor.cappedPoints).toBe(35);
  });

  it('cappedPoints is never negative and never exceeds the base award', () => {
    for (let d = 0; d <= 17; d++) for (const p of [0, 1, 50, 99, 100, 130]) {
      if (d < 17 && p > 100) continue;
      for (let pl = 1; pl <= 8; pl++) {
        const r = resolveRank({ divisionIndex: d, points: p }, pl);
        expect(r.cappedPoints).toBeGreaterThanOrEqual(0);
        expect(r.cappedPoints).toBeLessThanOrEqual(Math.abs(r.baseDelta));
      }
    }
  });
});

describe('rank — properties (blueprint §11)', () => {
  const starts: RankPosition[] = [];
  for (let d = 0; d <= 17; d++) for (const p of [0, 1, 6, 40, 60, 94, 99, 100, 150]) {
    if (d < 17 && p > 100) continue;
    starts.push({ divisionIndex: d, points: p, demotionReady: false });
    if (p === 0 && hasDemotionGate(d)) starts.push({ divisionIndex: d, points: p, demotionReady: true });
  }

  it('a better placement never lands LOWER (by compareRank) from the same start', () => {
    for (const start of starts) {
      let prev: RankPosition | null = null;
      for (let placement = 1; placement <= 8; placement++) {
        const r = resolveRank(start, placement);
        if (prev) expect(compareRank(prev, r.after), `${rankLabel(start)} ${start.points}: ${placement - 1}th vs ${placement}th`).toBeGreaterThanOrEqual(0);
        prev = r.after;
      }
    }
  });

  it('no same-game promotion, no multi-division jumps, never more than one division of demotion', () => {
    for (const start of starts) for (let placement = 1; placement <= 8; placement++) {
      const r = resolveRank(start, placement);
      expect(Math.abs(r.after.divisionIndex - start.divisionIndex)).toBeLessThanOrEqual(1);
      if (r.promotionUnlocked) expect(r.promoted).toBe(false);
      if (r.promoted) expect(start.points).toBe(100);
      expect(r.promoted && r.demoted).toBe(false);
      expect(r.wasPromotionGame && r.wasDemotionGame).toBe(false);
      if (r.wasDemotionGame) expect(isDemotionReady(start)).toBe(true);
      if (r.demoted && hasDemotionGate(start.divisionIndex)) expect(r.wasDemotionGame, 'a medal boundary is only crossed downward through a demotion game').toBe(true);
      expect(r.demotionUnlocked).toBe(isDemotionReady(r.after));
      if (r.demotionUnlocked) expect(r.baseDelta, 'only a LOSS arms the gate').toBeLessThan(0);
      if (r.promoted) expect(r.after.demotionReady, 'a promotion landing is never armed').toBe(false);
      if (r.wasDemotionGame) expect(r.after.demotionReady, 'a demotion game always disarms').toBe(false);
      expect(isRankPosition(r.after), 'the flag is only ever armed where it may be').toBe(true);
      expect(isRankPosition(r.after)).toBe(true);
    }
  });

  it('settleRank: revision +1, highest never decreases, season pinned, deterministic', () => {
    let profile = initialRankedProfile();
    const placements = [1, 1, 1, 2, 8, 8, 8, 8, 8, 1, 4, 5, 1, 1, 1, 2, 2, 1, 1, 3, 8, 8];
    let prevHighest = profile.highest;
    placements.forEach((placement, i) => {
      const a = settleRank(profile, placement, `run-${i}`);
      const b = settleRank(profile, placement, `run-${i}`);
      expect(a).toEqual(b);
      expect(a.result.revisionBefore).toBe(profile.revision);
      expect(a.result.revisionAfter).toBe(profile.revision + 1);
      expect(a.profile.revision).toBe(profile.revision + 1);
      expect(a.result.seasonId).toBe(RANK_SEASON);
      expect(a.result.runId).toBe(`run-${i}`);
      expect(compareRank(a.profile.highest, prevHighest)).toBeGreaterThanOrEqual(0);
      expect(compareRank(a.profile.highest, a.profile.position)).toBeGreaterThanOrEqual(0);
      expect(a.result.highestAfter).toEqual(a.profile.highest);
      expect(a.profile.highest.demotionReady, 'highest never carries the gate flag').toBe(false);
      prevHighest = a.profile.highest;
      profile = a.profile;
    });
    expect(isRankedProfile(profile)).toBe(true);
  });

  it('settleRank carries the STORED flag on the profile position — and only there', () => {
    // Climb Bronze III → Silver III by winning every game (three 100s + three won gates), then lose twice.
    let profile = initialRankedProfile();
    let i = 0;
    while (profile.position.divisionIndex < D('Silver III')) profile = settleRank(profile, 1, `climb-${i++}`).profile;
    expect(profile.position).toEqual(at('Silver III', 0));
    expect(profile.position.demotionReady, 'a promotion landing is never armed').toBe(false);
    const first = settleRank(profile, 8, 'loss-1');
    expect(first.result.wasDemotionGame).toBe(false);
    expect(first.result.demotionUnlocked).toBe(true);
    expect(first.profile.position).toEqual(armed('Silver III'));
    expect(first.profile.highest.demotionReady).toBe(false);
    expect(first.result.highestAfter.demotionReady).toBe(false);
    expect(first.result.after.demotionReady).toBe(true);
    expect(isRankedProfile(first.profile)).toBe(true);
    const second = settleRank(first.profile, 8, 'loss-2');
    expect(second.result.wasDemotionGame).toBe(true);
    expect(second.result.demoted).toBe(true);
    expect(second.profile.position).toEqual(at('Bronze I', 60));
    expect(second.profile.highest, 'the career best stays at the medal reached').toEqual(at('Silver III', 0));
    // the armed profile survives a JSON round-trip with the flag intact, and highest stays flag-free
    const rt = parseRankedProfile(JSON.parse(JSON.stringify(first.profile)));
    expect(rt).toEqual(first.profile);
    expect(rt!.position.demotionReady).toBe(true);
    expect(rt!.highest.demotionReady).toBe(false);
  });

  it('the derived scalar: appliedDelta is after − before, and a full climb from Bronze III is 17 won gates', () => {
    let pos = initialRankPosition();
    let gates = 0;
    for (let i = 0; i < 200 && pos.divisionIndex < 17; i++) {
      const r = resolveRank(pos, 1);
      if (r.promoted) gates++;
      expect(r.appliedDelta).toBe(rankScalar(r.after) - rankScalar(pos));
      pos = r.after;
    }
    expect(gates).toBe(17);
    expect(pos.divisionIndex).toBe(17);
  });
});

describe('rank — parsers + identity', () => {
  it('parseRankResult round-trips a settled result and rejects junk', () => {
    const { result } = settleRank(initialRankedProfile(), 2, 'abc');
    expect(parseRankResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(parseRankResult({ ...result, after: { divisionIndex: 99, points: 0 } })).toBeNull();
    expect(parseRankResult({ rating: 548, delta: 71 }), 'the OLD numeric function response is not a result').toBeNull();
    expect(parseRankResult(null)).toBeNull();
    // the stored flag survives the wire in both directions, and a server row without it reads as false
    const arming = settleRank({ ...initialRankedProfile(), position: at('Gold III', 6), highest: at('Gold III', 6) }, 5, 'arm').result;
    expect(arming.after).toEqual(armed('Gold III'));
    expect(parseRankResult(JSON.parse(JSON.stringify(arming)))).toEqual(arming);
    const bare = parseRankResult({ ...arming, before: { divisionIndex: 6, points: 6 }, after: { divisionIndex: 6, points: 0 } });
    expect(bare!.before.demotionReady).toBe(false);
    expect(bare!.after.demotionReady).toBe(false);
    expect(parseRankResult({ ...arming, after: { divisionIndex: 6, points: 1, demotionReady: true } }), 'an armed flag off 0 is corrupt').toBeNull();
  });

  it('parseRankedProfile round-trips and rejects a malformed profile', () => {
    const p = initialRankedProfile();
    expect(parseRankedProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parseRankedProfile({ ...p, position: { divisionIndex: 3, points: 101 } })).toBeNull();
    expect(parseRankedProfile({ ...p, revision: -1 })).toBeNull();
    expect(parseRankedProfile({ ...p, position: { divisionIndex: 7, points: 0, demotionReady: true } }), 'armed off a medal floor').toBeNull();
    expect(parseRankedProfile({ ...p, position: { divisionIndex: 6, points: 0, demotionReady: 'yes' } }), 'a non-boolean flag').toBeNull();
    const armedProfile = parseRankedProfile({ ...p, position: { divisionIndex: 6, points: 0, demotionReady: true }, highest: { divisionIndex: 6, points: 0, demotionReady: true } });
    expect(armedProfile!.position).toEqual(armed('Gold III'));
    expect(armedProfile!.highest, 'highest is normalised flag-free even when the wire carries one').toEqual(at('Gold III', 0));
  });

  it('rankedRunIdOf: the persisted UUID, else the pre-medal String(seed)', () => {
    expect(rankedRunIdOf({ seed: 4242 })).toBe('4242');
    expect(rankedRunIdOf({ seed: 4242, runId: 'uuid-1' })).toBe('uuid-1');
  });
});

function initialRankPosition(): RankPosition { return { divisionIndex: 0, points: 0 }; }
