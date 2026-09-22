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
 * lands at `promotionLanding` = 10/100 in the next division (owner 2026-09-21; it was 0 the day before — never
 * the game's award), a MEDAL gate needs 1st (a 2nd–4th holds at 100),
 * a DIVISION gate needs top-4; and the demotion gate — first (2026-09-20) only across a MEDAL boundary, then
 * WIDENED to every division (owner 2026-09-21: "Hitting 0 MMR should halt the loss and put you in a demotion
 * game. You need to then bottom-4 that game to demote."): a LOSS that lands on 0 in ANY division above Bronze
 * III clamps there and ARMS the STORED `demotionReady` flag — there are no instant demotions; the next game
 * is a demotion game (bottom-4 drops ONE division to 100 + award — across a medal boundary, to the previous
 * medal's III — top-4 escapes and disarms). A fresh promotion (landing at 10) is NOT armed. Then every
 * boundary, and the structural properties §11 asks for: better placement never lands lower, no same-game
 * promotion, no multi-division jump, highest never decreases.
 *
 * These same fixtures drive the server mirror in packages/ui/src/lobbyRatingParity.test.ts.
 */

/** Division index by label — the fixtures read like the blueprint. */
const D = (label: string): number => {
  const [medal, tier] = label.split(' ');
  const m = RANK_MEDALS.indexOf(medal as (typeof RANK_MEDALS)[number]);
  const t = { I: 0, II: 1, III: 2 }[tier as 'III' | 'II' | 'I'];   // ascending numerals (owner 2026-09-22)
  if (m < 0 || t === undefined) throw new Error(`bad label ${label}`);
  return m * 3 + t;
};
const at = (label: string, points: number, demotionReady = false): RankPosition => ({ divisionIndex: D(label), points, demotionReady });
/** An ARMED demotion gate: 0 points in a division above Bronze I after a loss landed there. */
const armed = (label: string): RankPosition => at(label, 0, true);

/** [before, placement, after, appliedDelta, flags] */
type Row = [RankPosition, number, RankPosition, number, Partial<Pick<RankResult, 'promoted' | 'demoted' | 'promotionUnlocked' | 'wasPromotionGame' | 'promotionKind' | 'cappedPoints' | 'requiredFinish' | 'wasDemotionGame' | 'demotionUnlocked'>>, string];
export const RANK_FIXTURES: Row[] = [
  [at('Gold II', 60), 3, at('Gold II', 76), 16, { promotionUnlocked: false }, 'plain gain'],
  [at('Gold II', 88), 1, at('Gold II', 100), 12, { promotionUnlocked: true, cappedPoints: 28 }, 'reaching 100 unlocks, does not promote; overflow discarded'],
  [at('Gold II', 94), 4, at('Gold II', 100), 6, { promotionUnlocked: true, cappedPoints: 0 }, 'exactly 100 unlocks'],
  [at('Gold II', 100), 3, at('Gold III', 10), 10, { wasPromotionGame: true, promotionKind: 'division', requiredFinish: 4, promoted: true, cappedPoints: 0 }, 'division gate: 3rd wins → next division at the 10-point landing'],
  [at('Gold II', 100), 4, at('Gold III', 10), 10, { wasPromotionGame: true, promotionKind: 'division', promoted: true, cappedPoints: 0 }, 'division gate: 4th still wins'],
  [at('Gold II', 100), 5, at('Gold II', 94), -6, { wasPromotionGame: true, promotionKind: 'division', promoted: false }, 'division gate: 5th fails, normal −6'],
  [at('Gold II', 100), 8, at('Gold II', 60), -40, { wasPromotionGame: true, promotionKind: 'division', promoted: false, demoted: false }, 'division gate: 8th fails, −40'],
  [at('Gold III', 100), 1, at('Platinum I', 10), 10, { wasPromotionGame: true, promotionKind: 'medal', requiredFinish: 1, promoted: true, cappedPoints: 0 }, 'medal gate: 1st wins → next medal at the 10-point landing'],
  [at('Gold III', 100), 2, at('Gold III', 100), 0, { wasPromotionGame: true, promotionKind: 'medal', promoted: false, promotionUnlocked: false, cappedPoints: 28 }, 'medal gate: 2nd HOLDS at 100 — no promote, no gain'],
  [at('Gold III', 100), 4, at('Gold III', 100), 0, { wasPromotionGame: true, promotionKind: 'medal', promoted: false, cappedPoints: 6 }, 'medal gate: 4th holds at 100'],
  [at('Gold III', 100), 5, at('Gold III', 94), -6, { wasPromotionGame: true, promotionKind: 'medal', promoted: false }, 'medal gate: 5th drops normally'],
  [at('Gold III', 100), 8, at('Gold III', 60), -40, { wasPromotionGame: true, promotionKind: 'medal', promoted: false }, 'medal gate: 8th drops −40'],
  // ── NO instant demotions (owner 2026-09-21): a loss that hits 0 in ANY division clamps there and ARMS ──
  [at('Gold II', 10), 8, armed('Gold II'), -10, { demoted: false, demotionUnlocked: true, wasDemotionGame: false, cappedPoints: 30 }, 'inside a medal a loss below 0 CLAMPS at 0 and ARMS — it no longer demotes to 100 + result'],
  [at('Gold II', 6), 5, armed('Gold II'), -6, { demoted: false, demotionUnlocked: true, cappedPoints: 0 }, 'a loss landing exactly on 0 arms too (Gold II has a gate now)'],
  [at('Gold II', 0), 5, armed('Gold II'), 0, { demoted: false, demotionUnlocked: true, cappedPoints: 6 }, 'a loss at an UNARMED 0 inside a medal clamps and ARMS — no demotion yet'],
  [at('Gold II', 0), 3, at('Gold II', 16), 16, { demoted: false, demotionUnlocked: false, wasDemotionGame: false }, 'at 0 but NOT armed inside a medal, a top-4 is an ordinary gain'],
  [armed('Gold II'), 8, at('Gold I', 60), -40, { wasDemotionGame: true, requiredFinish: 4, demoted: true, demotionUnlocked: false, cappedPoints: 0 }, 'Gold II demotion game: 8th drops ONE division to Gold I at 100 + award'],
  [armed('Gold II'), 5, at('Gold I', 94), -6, { wasDemotionGame: true, demoted: true }, 'Gold II demotion game: 5th → Gold I 94'],
  [armed('Gold II'), 6, at('Gold I', 84), -16, { wasDemotionGame: true, demoted: true }, 'Gold II demotion game: 6th → Gold I 84'],
  [armed('Gold II'), 7, at('Gold I', 72), -28, { wasDemotionGame: true, demoted: true }, 'Gold II demotion game: 7th → Gold I 72'],
  [armed('Gold II'), 4, at('Gold II', 6), 6, { wasDemotionGame: true, demoted: false, demotionUnlocked: false }, 'Gold II demotion game: 4th escapes with its award from 0 and DISARMS'],
  [armed('Gold II'), 1, at('Gold II', 40), 40, { wasDemotionGame: true, demoted: false, promotionUnlocked: false }, 'Gold II demotion game: 1st → Gold II 40'],
  [armed('Bronze II'), 8, at('Bronze I', 60), -40, { wasDemotionGame: true, demoted: true }, 'Bronze II demotion game: 8th → Bronze I 60 (the lowest division has no gate below it)'],
  // ── the MEDAL-boundary demotion gate (owner addition 2026-09-20) — unchanged in shape, the previous division is the previous medal's III ──
  [at('Gold I', 10), 8, armed('Gold I'), -10, { demoted: false, demotionUnlocked: true, wasDemotionGame: false, cappedPoints: 30 }, 'medal floor: a loss CLAMPS at 0 → ARMED'],
  [at('Gold I', 6), 5, armed('Gold I'), -6, { demoted: false, demotionUnlocked: true, cappedPoints: 0 }, 'a loss landing exactly on 0 at a medal floor arms too'],
  [armed('Gold I'), 8, at('Silver III', 60), -40, { wasDemotionGame: true, requiredFinish: 4, demoted: true, demotionUnlocked: false, cappedPoints: 0 }, 'demotion game: 8th drops to Silver III at 100 + award'],
  [armed('Gold I'), 5, at('Silver III', 94), -6, { wasDemotionGame: true, demoted: true }, 'demotion game: 5th drops to Silver III 94'],
  [armed('Gold I'), 4, at('Gold I', 6), 6, { wasDemotionGame: true, demoted: false, demotionUnlocked: false }, 'demotion game: 4th escapes with its award from 0 and DISARMS'],
  [armed('Gold I'), 3, at('Gold I', 16), 16, { wasDemotionGame: true, demoted: false }, 'demotion game: 3rd → Gold I 16'],
  [armed('Gold I'), 1, at('Gold I', 40), 40, { wasDemotionGame: true, demoted: false, promotionUnlocked: false }, 'demotion game: 1st → Gold I 40'],
  [at('Silver III', 100), 1, at('Gold I', 10), 10, { promoted: true, promotionKind: 'medal', demotionUnlocked: false }, 'a won MEDAL promotion lands at 10 in the new medal — NOT armed'],
  [at('Gold I', 10), 8, armed('Gold I'), -10, { wasDemotionGame: false, demoted: false, demotionUnlocked: true, cappedPoints: 30 }, 'the first loss from the landing clamps at 0 and ARMS — no demotion yet'],
  [at('Gold I', 10), 5, at('Gold I', 4), -6, { wasDemotionGame: false, demoted: false, demotionUnlocked: false }, 'a 5th from the landing (−6) stays in the medal at 4, not armed'],
  [at('Gold I', 0), 8, armed('Gold I'), 0, { wasDemotionGame: false, demoted: false, demotionUnlocked: true, cappedPoints: 40 }, 'a loss at an UNARMED 0 on a medal floor clamps and ARMS — no demotion yet'],
  [at('Gold I', 0), 4, at('Gold I', 6), 6, { wasDemotionGame: false, demoted: false, demotionUnlocked: false }, 'at 0 but NOT armed, a top-4 is an ordinary gain'],
  [at('Gold II', 100), 4, at('Gold III', 10), 10, { promoted: true, demotionUnlocked: false }, 'a won DIVISION promotion lands at 10 with no demotion gate'],
  [at('Gold III', 10), 5, at('Gold III', 4), -6, { demoted: false }, 'a 5th from a division landing stays in the division'],
  [at('Gold III', 10), 6, armed('Gold III'), -10, { demoted: false, demotionUnlocked: true, cappedPoints: 6 }, 'a 6th from a division landing crosses 0: it clamps at 0 and ARMS — no demotion yet'],
  [armed('Gold III'), 6, at('Gold II', 84), -16, { wasDemotionGame: true, demoted: true }, '…and the demotion game that follows drops to Gold II 84'],
  [at('Ascendant I', 5), 8, armed('Ascendant I'), -5, { demoted: false, demotionUnlocked: true }, 'Ascendant I is a medal floor too'],
  [armed('Ascendant I'), 6, at('Diamond III', 84), -16, { wasDemotionGame: true, demoted: true }, 'Ascendant I demotion game: 6th → Diamond III 84'],
  [armed('Silver I'), 7, at('Bronze III', 72), -28, { wasDemotionGame: true, demoted: true }, 'Silver I demotion game: 7th → Bronze III 72'],
  [at('Bronze I', 0), 8, at('Bronze I', 0), 0, { wasDemotionGame: false, demoted: false, demotionUnlocked: false, cappedPoints: 40 }, 'Bronze I at 0: floor, NO gate'],
  [at('Bronze I', 10), 8, at('Bronze I', 0), -10, { demoted: false, cappedPoints: 30 }, 'Bronze floor absorbs the rest'],
  [at('Bronze I', 0), 8, at('Bronze I', 0), 0, { demoted: false, cappedPoints: 40 }, 'Bronze floor at 0 applies nothing'],
  [at('Ascendant II', 100), 1, at('Ascendant III', 10), 10, { wasPromotionGame: true, promotionKind: 'division', promoted: true }, 'into the top division at the 10-point landing'],
  [at('Ascendant II', 100), 4, at('Ascendant III', 10), 10, { wasPromotionGame: true, promotionKind: 'division', promoted: true }, 'Ascendant II → I is a DIVISION gate (same medal) — 4th wins'],
  [at('Ascendant I', 100), 4, at('Ascendant II', 10), 10, { wasPromotionGame: true, promotionKind: 'division', promoted: true }, 'Ascendant I → II on top-4'],
  [at('Diamond III', 100), 2, at('Diamond III', 100), 0, { wasPromotionGame: true, promotionKind: 'medal', promoted: false }, 'Diamond III → Ascendant I is the last MEDAL gate — 2nd holds'],
  [at('Diamond III', 100), 1, at('Ascendant I', 10), 10, { wasPromotionGame: true, promotionKind: 'medal', promoted: true }, 'Diamond III → Ascendant I on 1st'],
  [at('Ascendant III', 90), 1, at('Ascendant III', 130), 40, { promotionUnlocked: false, wasPromotionGame: false }, 'Ascendant III is uncapped, no gate'],
  [at('Ascendant III', 100), 1, at('Ascendant III', 140), 40, { wasPromotionGame: false }, 'Ascendant III at 100 is NOT a gate'],
  [at('Ascendant III', 10), 8, armed('Ascendant III'), -10, { demoted: false, demotionUnlocked: true, cappedPoints: 30 }, 'Ascendant III below 0 clamps at 0 and ARMS like every other division'],
  [at('Ascendant III', 0), 5, armed('Ascendant III'), 0, { demoted: false, demotionUnlocked: true, cappedPoints: 6 }, 'Ascendant III at an unarmed 0: a loss arms, no demotion yet'],
  [at('Ascendant III', 40), 8, armed('Ascendant III'), -40, { demoted: false, demotionUnlocked: true, cappedPoints: 0 }, 'Ascendant III: a loss landing exactly on 0 arms'],
  [armed('Ascendant III'), 5, at('Ascendant II', 94), -6, { wasDemotionGame: true, demoted: true }, 'Ascendant III demotion game: 5th → Ascendant II 94'],
  [armed('Ascendant III'), 1, at('Ascendant III', 40), 40, { wasDemotionGame: true, demoted: false, promotionUnlocked: false }, 'Ascendant III demotion game: 1st escapes to 40, uncapped as ever'],
  [at('Silver III', 100), 1, at('Gold I', 10), 10, { promotionKind: 'medal', promoted: true }, 'Silver III → Gold I on 1st'],
  [at('Bronze I', 100), 4, at('Bronze II', 10), 10, { promotionKind: 'division', promoted: true }, 'Bronze I → Bronze II on 4th'],
  [at('Bronze III', 100), 4, at('Bronze III', 100), 0, { promotionKind: 'medal', promoted: false }, 'Bronze III gate needs 1st; 4th holds'],
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
    expect(RANK_RULES.promotionLanding, 'a won promotion lands at 10 (owner 2026-09-21)').toBe(10);
    expect(RANK_RULES.rulesVersion, 'the landing change shipped without a version bump (the client never resolves locally)').toBe(1);
    expect(RANK_SEASON).toBe(3);
  });

  it('labels: I → II → III within a medal, then the next medal', () => {
    expect(rankLabel(0)).toBe('Bronze I');
    expect(rankLabel(1)).toBe('Bronze II');
    expect(rankLabel(2)).toBe('Bronze III');
    expect(rankLabel(3)).toBe('Silver I');
    expect(rankLabel({ divisionIndex: 7, points: 40 })).toBe('Gold II');
    expect(rankLabel(17)).toBe('Ascendant III');
    expect(medalOf(9)).toBe('Platinum');
    expect(divisionTierOf(9)).toBe(1);    // ascending numerals (owner 2026-09-22): index 9 is Platinum I
    expect(divisionTierOf(11)).toBe(3);   // …and index 11 is Platinum III, the top of the medal
    expect(RANK_MEDALS).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant']);
  });

  it('gate kinds: the top of each medal is a medal gate, the rest are division gates, the top division has none', () => {
    expect(promotionKindAt(0)).toBe('division');
    expect(promotionKindAt(1)).toBe('division');
    expect(promotionKindAt(2)).toBe('medal');
    expect(promotionKindAt(14), 'Diamond III → Ascendant I').toBe('medal');
    expect(promotionKindAt(15), 'Ascendant I → II').toBe('division');
    expect(promotionKindAt(16), 'Ascendant II → I').toBe('division');
    expect(promotionKindAt(17)).toBeNull();
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].filter((d) => promotionKindAt(d) === 'medal')).toEqual([2, 5, 8, 11, 14]);
    expect(requiredFinishFor('division')).toBe(4);
    expect(requiredFinishFor('medal')).toBe(1);
    expect(requiredFinishFor(null)).toBeNull();
  });

  it('compareRank orders division first, then points; the scalar ties at a boundary', () => {
    expect(compareRank(at('Gold III', 0), at('Gold II', 100))).toBeGreaterThan(0);
    expect(rankScalar(at('Gold III', 0))).toBe(rankScalar(at('Gold II', 100)));
    expect(compareRank(at('Gold II', 50), at('Gold II', 50))).toBe(0);
    expect(compareRank(at('Gold II', 49), at('Gold II', 50))).toBeLessThan(0);
  });

  it('promotion-ready is derived: 100 below the top, never in Ascendant III', () => {
    expect(isPromotionReady(at('Gold II', 100))).toBe(true);
    expect(isPromotionReady(at('Gold II', 99))).toBe(false);
    expect(isPromotionReady(at('Ascendant III', 100))).toBe(false);
  });

  it('demotion-ready is a STORED flag, valid only at 0 in a division above Bronze I (every division since 2026-09-21)', () => {
    expect(isDemotionReady(armed('Gold I'))).toBe(true);
    expect(isDemotionReady(armed('Gold II'))).toBe(true);
    expect(isDemotionReady(at('Gold I', 0)), 'standing at 0 is not armed').toBe(false);
    expect(isDemotionReady({ divisionIndex: 6, points: 0 }), 'absent = false').toBe(false);
    expect(isRankPosition(armed('Gold I'))).toBe(true);
    expect(isRankPosition(armed('Gold II')), 'armed inside a medal is valid now').toBe(true);
    expect(isRankPosition(armed('Ascendant III')), 'the top division arms too').toBe(true);
    expect(isRankPosition({ divisionIndex: 6, points: 1, demotionReady: true }), 'armed off 0 is corrupt').toBe(false);
    expect(isRankPosition({ divisionIndex: 7, points: 1, demotionReady: true }), 'armed at points > 0 is corrupt in every division').toBe(false);
    expect(isRankPosition({ divisionIndex: 0, points: 0, demotionReady: true }), 'Bronze I has no gate').toBe(false);
    expect([...Array(18).keys()].filter((d) => hasDemotionGate(d)), 'every division above Bronze I').toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(hasDemotionGate(18), 'out of range is not a division').toBe(false);
    expect(RANK_RULES.demotionEscapeFinish).toBe(4);
  });

  it('the owner\'s sequence: medal promotion lands at 10 → first loss ARMS (no demotion) → second loss DEMOTES', () => {
    const won = resolveRank(at('Silver III', 100), 1);
    expect(won.after).toEqual(at('Gold I', 10));
    expect(won.appliedDelta, 'the landing cushion is the scalar movement').toBe(10);
    expect(won.cappedPoints, 'the award converted into the promotion itself').toBe(0);
    expect(won.demotionUnlocked).toBe(false);
    const first = resolveRank(won.after, 8);
    expect(first.wasDemotionGame).toBe(false);
    expect(first.demoted).toBe(false);
    expect(first.after).toEqual(armed('Gold I'));
    expect(first.demotionUnlocked).toBe(true);
    expect(first.appliedDelta).toBe(-10);
    expect(first.cappedPoints).toBe(30);
    const second = resolveRank(first.after, 8);
    expect(second.wasDemotionGame).toBe(true);
    expect(second.demoted).toBe(true);
    expect(second.after).toEqual(at('Silver III', 60));
    // …and a top-4 escape from the armed state DISARMS; a later loss must arm again before demoting
    const escaped = resolveRank(first.after, 2);
    expect(escaped.after).toEqual(at('Gold I', 28));
    expect(escaped.demotionUnlocked).toBe(false);
    const back = resolveRank(escaped.after, 8);
    expect(back.after).toEqual(armed('Gold I'));
    expect(back.demoted).toBe(false);
  });

  it('the owner\'s 2026-09-21 sequence INSIDE a medal: hitting 0 halts the loss → a bottom-4 in the demotion game demotes; a top-4 escapes', () => {
    const halt = resolveRank(at('Gold II', 10), 8);
    expect(halt.after, 'the loss stops at 0 — Gold II 10 no longer drops straight to Gold I 70').toEqual(armed('Gold II'));
    expect(halt.demoted).toBe(false);
    expect(halt.demotionUnlocked).toBe(true);
    expect(halt.appliedDelta).toBe(-10);
    expect(halt.cappedPoints).toBe(30);
    for (const [placement, points] of [[5, 94], [6, 84], [7, 72], [8, 60]] as const) {
      const lost = resolveRank(halt.after, placement);
      expect(lost.wasDemotionGame).toBe(true);
      expect(lost.demoted).toBe(true);
      expect(lost.after, `${placement}th → Gold I ${points}`).toEqual(at('Gold I', points));
      expect(lost.appliedDelta).toBe(RANK_RULES.placementAwards[placement - 1]);
      expect(lost.cappedPoints).toBe(0);
    }
    for (const placement of [1, 2, 3, 4]) {
      const kept = resolveRank(halt.after, placement);
      expect(kept.wasDemotionGame).toBe(true);
      expect(kept.demoted).toBe(false);
      expect(kept.after).toEqual(at('Gold II', RANK_RULES.placementAwards[placement - 1]!));
      expect(kept.demotionUnlocked).toBe(false);
    }
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
      const r = resolveRank(at('Gold III', 100), placement);
      expect(r.promoted).toBe(false);
      expect(r.after).toEqual(at('Gold III', 100));
      expect(r.appliedDelta).toBe(0);
      expect(r.cappedPoints).toBe(RANK_RULES.placementAwards[placement - 1]);
      expect(isPromotionReady(r.after)).toBe(true);
      expect(r.wasPromotionGame).toBe(true);
      expect(r.promotionKind).toBe('medal');
      expect(r.requiredFinish).toBe(1);
    }
    for (const placement of [5, 6, 7, 8]) {
      const r = resolveRank(at('Gold III', 100), placement);
      expect(r.promoted).toBe(false);
      expect(r.after.points).toBe(100 + RANK_RULES.placementAwards[placement - 1]!);
      expect(r.after.divisionIndex).toBe(D('Gold III'));
      expect(isPromotionReady(r.after)).toBe(false);
    }
  });

  it('a won promotion starts the next division at 10/100 (the landing) — never the award', () => {
    expect(resolveRank(at('Gold II', 100), 1).after).toEqual(at('Gold III', 10));
    expect(resolveRank(at('Gold III', 100), 1).after).toEqual(at('Platinum I', 10));
    // The landing is the applied delta on BOTH gate kinds (100/100 → 10/100 of the next division is +10 on
    // the scalar); the award is reported as converted, never as capped.
    for (const [start, placement] of [[at('Gold II', 100), 1], [at('Gold II', 100), 4], [at('Gold III', 100), 1]] as const) {
      const r = resolveRank(start, placement);
      expect(r.promoted).toBe(true);
      expect(r.after.points).toBe(RANK_RULES.promotionLanding);
      expect(r.appliedDelta).toBe(RANK_RULES.promotionLanding);
      expect(r.cappedPoints).toBe(0);
    }
  });

  it('the landing cushion: a 5th right after promoting stays put; a bigger loss crosses 0 and ARMS the demotion game in every division (never an instant drop)', () => {
    expect(resolveRank(at('Gold III', 10), 5).after).toEqual(at('Gold III', 4));
    expect(resolveRank(at('Gold III', 10), 6).after).toEqual(armed('Gold III'));
    expect(resolveRank(at('Gold III', 10), 6).demoted).toBe(false);
    expect(resolveRank(at('Gold III', 10), 6).demotionUnlocked).toBe(true);
    expect(resolveRank(at('Gold I', 10), 5).after).toEqual(at('Gold I', 4));
    expect(resolveRank(at('Gold I', 10), 6).after).toEqual(armed('Gold I'));
    expect(resolveRank(at('Gold I', 10), 6).demoted).toBe(false);
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
      expect(won.after).toEqual({ divisionIndex: d + 1, points: RANK_RULES.promotionLanding, demotionReady: false });
      expect(won.promoted).toBe(true);
      expect(won.promotionUnlocked).toBe(false);
      expect(won.appliedDelta).toBe(RANK_RULES.promotionLanding);
      expect(won.cappedPoints).toBe(0);
    }
  });

  it('below 0: EVERY division above Bronze I clamps at 0 and arms (no instant demotion anywhere); the demotion game drops one division; Bronze I floors', () => {
    for (let d = 1; d <= 17; d++) {
      expect(hasDemotionGate(d), `division ${d} has a demotion gate`).toBe(true);
      const r = resolveRank({ divisionIndex: d, points: 5 }, 8);
      expect(r.after, `division ${d} clamps at 0, armed`).toEqual({ divisionIndex: d, points: 0, demotionReady: true });
      expect(r.demoted).toBe(false);
      expect(r.demotionUnlocked).toBe(true);
      expect(r.appliedDelta).toBe(-5);
      expect(r.cappedPoints).toBe(35);
      // …and the demotion game that follows: bottom-4 drops ONE division at 100 + award (across a medal
      // boundary that is the previous medal's III; inside a medal, the division below)
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
      // a loss that lands EXACTLY on 0 arms as well
      const exact = resolveRank({ divisionIndex: d, points: 6 }, 5);
      expect(exact.after).toEqual({ divisionIndex: d, points: 0, demotionReady: true });
      expect(exact.cappedPoints).toBe(0);
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
    if (p === 0 && hasDemotionGate(d)) starts.push({ divisionIndex: d, points: p, demotionReady: true }); // every division above Bronze I
  }

  it('the property walk covers an ARMED start in every division above Bronze I', () => {
    expect(starts.filter((s) => s.demotionReady).map((s) => s.divisionIndex)).toEqual([...Array(17).keys()].map((i) => i + 1));
  });

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
      if (r.demoted) expect(r.wasDemotionGame, 'a division is only ever left downward through a demotion game (owner 2026-09-21: no instant demotions)').toBe(true);
      if (r.baseDelta < 0 && !r.wasDemotionGame) expect(r.after.divisionIndex, 'a loss outside a demotion game never changes the division').toBe(start.divisionIndex);
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
    // Climb Bronze I → Silver I by winning every game (three 100s + three won gates), then lose twice.
    let profile = initialRankedProfile();
    let i = 0;
    while (profile.position.divisionIndex < D('Silver I')) profile = settleRank(profile, 1, `climb-${i++}`).profile;
    expect(profile.position).toEqual(at('Silver I', 10));
    expect(profile.highest, 'the landing IS the career best so far').toEqual(at('Silver I', 10));
    expect(profile.position.demotionReady, 'a promotion landing is never armed').toBe(false);
    const first = settleRank(profile, 8, 'loss-1');
    expect(first.result.wasDemotionGame).toBe(false);
    expect(first.result.demotionUnlocked).toBe(true);
    expect(first.profile.position).toEqual(armed('Silver I'));
    expect(first.profile.highest.demotionReady).toBe(false);
    expect(first.result.highestAfter.demotionReady).toBe(false);
    expect(first.result.after.demotionReady).toBe(true);
    expect(isRankedProfile(first.profile)).toBe(true);
    const second = settleRank(first.profile, 8, 'loss-2');
    expect(second.result.wasDemotionGame).toBe(true);
    expect(second.result.demoted).toBe(true);
    expect(second.profile.position).toEqual(at('Bronze III', 60));
    expect(second.profile.highest, 'the career best stays at the medal reached (its landing)').toEqual(at('Silver I', 10));
    // the armed profile survives a JSON round-trip with the flag intact, and highest stays flag-free
    const rt = parseRankedProfile(JSON.parse(JSON.stringify(first.profile)));
    expect(rt).toEqual(first.profile);
    expect(rt!.position.demotionReady).toBe(true);
    expect(rt!.highest.demotionReady).toBe(false);
  });

  it('the derived scalar: appliedDelta is after − before, and a full climb from Bronze I is 17 won gates', () => {
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
    const arming = settleRank({ ...initialRankedProfile(), position: at('Gold I', 6), highest: at('Gold I', 6) }, 5, 'arm').result;
    expect(arming.after).toEqual(armed('Gold I'));
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
    expect(parseRankedProfile({ ...p, position: { divisionIndex: 7, points: 0, demotionReady: true } })!.position, 'armed at Gold II 0 is a valid profile now (owner 2026-09-21)').toEqual(armed('Gold II'));
    expect(parseRankedProfile({ ...p, position: { divisionIndex: 7, points: 1, demotionReady: true } }), 'armed at points > 0 is corrupt').toBeNull();
    expect(parseRankedProfile({ ...p, position: { divisionIndex: 0, points: 0, demotionReady: true } }), 'Bronze I never arms').toBeNull();
    expect(parseRankedProfile({ ...p, position: { divisionIndex: 6, points: 0, demotionReady: 'yes' } }), 'a non-boolean flag').toBeNull();
    const armedProfile = parseRankedProfile({ ...p, position: { divisionIndex: 6, points: 0, demotionReady: true }, highest: { divisionIndex: 6, points: 0, demotionReady: true } });
    expect(armedProfile!.position).toEqual(armed('Gold I'));
    expect(armedProfile!.highest, 'highest is normalised flag-free even when the wire carries one').toEqual(at('Gold I', 0));
  });

  it('rankedRunIdOf: the persisted UUID, else the pre-medal String(seed)', () => {
    expect(rankedRunIdOf({ seed: 4242 })).toBe('4242');
    expect(rankedRunIdOf({ seed: 4242, runId: 'uuid-1' })).toBe('uuid-1');
  });
});

function initialRankPosition(): RankPosition { return { divisionIndex: 0, points: 0 }; }
