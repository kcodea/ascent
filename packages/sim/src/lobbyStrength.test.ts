import { describe, expect, it } from 'vitest';
import {
  excludeOwnFights, lobbyStrengthOf, parseLobbyStrength, seatStrengthRate, strengthBonusOf, strengthFactorOf, strengthPlacementWeight, strengthText, strengthTierOf,
  STRENGTH_BONUS_FLOOR, STRENGTH_BONUS_MAX, STRENGTH_BONUS_SPAN, STRENGTH_BONUS_WORST_PLACEMENT, STRENGTH_PLACEMENT_WEIGHTS, STRENGTH_TIERS, type StrengthInput,
} from './lobbyStrength';
import { RANK_RULES, resolveRank } from './rank';

/**
 * LOBBY STRENGTH (owner 2026-09-22: "make an algorithm that can essentially assign a lobby strength
 * value/indicator … we can then make winning really difficult lobbies more rewarding"; "we want to use raw
 * data on win rate across all rounds served for the board. rank is not important right now as a factor").
 */
const seven = (f: (i: number) => Partial<StrengthInput>): StrengthInput[] =>
  Array.from({ length: 7 }, (_, i) => ({ key: `a|h${i}|1`, fights: 0, wins: 0, ...f(i) }));

describe('lobbyStrengthOf — the formula', () => {
  it('an unserved field (no data) reads exactly 50, Even', () => {
    expect(lobbyStrengthOf(seven(() => ({})))).toMatchObject({ value: 50, tier: 'Even' });
    expect(lobbyStrengthOf([])).toMatchObject({ value: 50, tier: 'Even' });
  });

  it('a table of bots reads 25, Easy', () => {
    expect(lobbyStrengthOf(seven((i) => ({ key: `bot:hybrid:h${i}` })))).toMatchObject({ value: 25, tier: 'Easy' });
  });

  it('a proven 70% field reads near 70: 140-60 each → 68 (Hard); 400 fights at 70% → 69', () => {
    expect(lobbyStrengthOf(seven(() => ({ fights: 200, wins: 140 })))).toMatchObject({ value: 68, tier: 'Hard' });
    expect(lobbyStrengthOf(seven(() => ({ fights: 400, wins: 280 })))).toMatchObject({ value: 69, tier: 'Hard' });
  });

  it('a strong field: seven runs at 36-4 → 77, Brutal; the worked mixed example → 49, Even', () => {
    expect(lobbyStrengthOf(seven(() => ({ fights: 40, wins: 36 })))).toMatchObject({ value: 77, tier: 'Brutal' });
    const mixed: StrengthInput[] = [
      { key: 'a|h|1', fights: 12, wins: 10 },   // 20/32  = 0.625
      { key: 'b|h|2', fights: 3, wins: 0 },     // 10/23  = 0.435
      { key: 'bot:hybrid:x', fights: 0, wins: 0 }, //       0.25
      { key: 'c|h|3', fights: 0, wins: 0 },     //           0.5
      { key: 'd|h|4', fights: 30, wins: 22 },   // 32/50  = 0.64
      { key: 'e|h|5', fights: 9, wins: 9 },     // 19/29  = 0.655
      { key: 'f|h|6', fights: 100, wins: 20 },  // 30/120 = 0.25
    ];
    expect(lobbyStrengthOf(mixed)).toMatchObject({ value: 48, tier: 'Even' });
    expect(lobbyStrengthOf(mixed).inputs).toEqual(mixed);
  });

  it('the smoothing prior: 2-0 reads 0.545, not 1.0; 0-2 reads 0.455, not 0', () => {
    expect(seatStrengthRate({ key: 'a|h|1', fights: 2, wins: 2 })).toBeCloseTo(12 / 22, 6);
    expect(seatStrengthRate({ key: 'a|h|1', fights: 2, wins: 0 })).toBeCloseTo(10 / 22, 6);
    expect(seatStrengthRate({ key: 'bot:bot:h', fights: 50, wins: 50 })).toBe(0.25);
  });

  it('is monotonic in every opponent\'s record (more wins never lowers it, more losses never raises it)', () => {
    let prev = lobbyStrengthOf(seven(() => ({ fights: 20, wins: 0 }))).value;
    for (let w = 1; w <= 20; w++) {
      const v = lobbyStrengthOf(seven(() => ({ fights: 20, wins: w }))).value;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    const base = lobbyStrengthOf(seven(() => ({ fights: 10, wins: 6 }))).value;
    expect(lobbyStrengthOf(seven((i) => ({ fights: i === 0 ? 11 : 10, wins: 6 }))).value).toBeLessThanOrEqual(base);
    expect(lobbyStrengthOf(seven((i) => ({ fights: i === 0 ? 11 : 10, wins: i === 0 ? 7 : 6 }))).value).toBeGreaterThanOrEqual(base);
  });

  it('the field GOING IN: this lobby\'s own fights are subtracted before the formula (owner 2026-09-22, 47 vs 50)', () => {
    const rows = [
      { runA: 'me|h|9', runB: 'a|h|1', outcome: 'a' as const },
      { runA: 'me|h|9', runB: 'b|h|2', outcome: 'a' as const },
      { runA: 'a|h|1', runB: 'b|h|2', outcome: 'b' as const },
    ];
    const view = [{ key: 'a|h|1', fights: 12, wins: 5 }, { key: 'b|h|2', fights: 3, wins: 1 }, { key: 'bot:hybrid:h', fights: 0, wins: 0 }];
    expect(excludeOwnFights(view, rows)).toEqual([{ key: 'a|h|1', fights: 10, wins: 5 }, { key: 'b|h|2', fights: 1, wins: 0 }, { key: 'bot:hybrid:h', fights: 0, wins: 0 }]);
    expect(excludeOwnFights(view, [])).toEqual(view);
    expect(excludeOwnFights([{ key: 'a|h|1', fights: 1, wins: 0 }], rows)).toEqual([{ key: 'a|h|1', fights: 0, wins: 0 }]); // clamped
  });

  it('the tiers live in one place: Easy < 35, Even 35-54, Hard 55-69, Brutal >= 70', () => {
    expect(STRENGTH_TIERS).toEqual({ even: 35, hard: 55, brutal: 70 });
    expect(strengthTierOf(34)).toBe('Easy');
    expect(strengthTierOf(35)).toBe('Even');
    expect(strengthTierOf(54)).toBe('Even');
    expect(strengthTierOf(55)).toBe('Hard');
    expect(strengthTierOf(69)).toBe('Hard');
    expect(strengthTierOf(70)).toBe('Brutal');
    expect(strengthText({ value: 74, tier: 'Brutal' })).toBe('74%'); // no tier word on any surface (owner 2026-09-22)
  });

  it('parses a stored stamp and rejects a malformed one', () => {
    expect(parseLobbyStrength({ value: 74, tier: 'Brutal', inputs: [{ key: 'a|h|1', fights: 3, wins: 2 }] })).toEqual({ value: 74, tier: 'Brutal', inputs: [{ key: 'a|h|1', fights: 3, wins: 2 }] });
    expect(parseLobbyStrength({ value: '61' })).toMatchObject({ value: 61, tier: 'Hard', inputs: [] });
    expect(parseLobbyStrength({ value: 140 })).toBeNull();
    expect(parseLobbyStrength(null)).toBeNull();
    expect(parseLobbyStrength('Brutal 74')).toBeNull();
  });
});

/** The owner's anchor table (2026-09-22): [placement, strength, bonus]. Pinned here, in rank.test.ts and in the
 *  parity test (each carries its own copy: a test file never imports another), so the three copies cannot
 *  drift from it. */
const OWNER_BONUS_ANCHORS: readonly [number, number, number][] = [
  [1, 100, 15], [1, 75, 8], [4, 100, 7], [2, 100, 12], [3, 100, 9], [1, 50, 0], [4, 50, 0],
];

describe('strengthBonusOf + resolveRank — the top-4 bonus (owner 2026-09-22: "the strength bonus applies to any TOP-4 finish, scaled by BOTH placement and lobby strength")', () => {
  it('the owner\'s anchors (floor 50, owner 2026-09-22 late): 1st at 100 = +15, 1st at 75 = +8, 4th at 100 = +7, 2nd at 100 = +12, 3rd at 100 = +9, 1st at 50 = 0, 4th at 50 = 0', () => {
    for (const [placement, strength, bonus] of OWNER_BONUS_ANCHORS) expect(strengthBonusOf(strength, placement), `${placement} at ${strength}`).toBe(bonus);
  });

  it('the weights and the 50 / 50 line live in ONE place: 1.0 / 0.8 / 0.62 / 0.47, factor 0 at 50 (even) and below, 1 at 100', () => {
    expect([...STRENGTH_PLACEMENT_WEIGHTS]).toEqual([1.0, 0.8, 0.62, 0.47]);
    expect([STRENGTH_BONUS_MAX, STRENGTH_BONUS_FLOOR, STRENGTH_BONUS_SPAN, STRENGTH_BONUS_WORST_PLACEMENT]).toEqual([15, 50, 50, 4]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(strengthPlacementWeight)).toEqual([1.0, 0.8, 0.62, 0.47, 0, 0, 0, 0]);
    expect(strengthPlacementWeight(0)).toBe(0);
    expect(strengthPlacementWeight(1.5)).toBe(0);
    expect(strengthFactorOf(0)).toBe(0);
    expect(strengthFactorOf(30)).toBe(0);
    expect(strengthFactorOf(50)).toBe(0);
    expect(strengthFactorOf(75)).toBe(0.5);
    expect(strengthFactorOf(100)).toBe(1);
    expect(strengthFactorOf(140)).toBe(1);
  });

  it('nothing at strength 50 (even) and below for every placement; 5th to 8th and a null strength earn nothing; never negative, at most 15, monotonic in strength AND in placement', () => {
    for (let p = 1; p <= 4; p++) {
      expect(strengthBonusOf(0, p)).toBe(0);
      expect(strengthBonusOf(30, p)).toBe(0);
      expect(strengthBonusOf(45, p), 'the owner\'s 45% lobby pays nothing').toBe(0);
      expect(strengthBonusOf(50, p)).toBe(0);
      expect(strengthBonusOf(51, p)).toBe(0);
    }
    for (let p = 5; p <= 8; p++) expect(strengthBonusOf(100, p)).toBe(0);
    expect(strengthBonusOf(null, 1)).toBe(0);
    expect(strengthBonusOf(undefined, 1)).toBe(0);
    for (let s = 0; s <= 100; s++) {
      for (let p = 1; p <= 4; p++) {
        expect(strengthBonusOf(s, p)).toBeGreaterThanOrEqual(0);
        expect(strengthBonusOf(s, p)).toBeLessThanOrEqual(15);
        if (s > 0) expect(strengthBonusOf(s, p)).toBeGreaterThanOrEqual(strengthBonusOf(s - 1, p));
        if (p > 1) expect(strengthBonusOf(s, p)).toBeLessThanOrEqual(strengthBonusOf(s, p - 1));
      }
    }
    // A spot row off the anchors: 74 reads 7 / 6 / 4 / 3.
    expect([1, 2, 3, 4].map((p) => strengthBonusOf(74, p))).toEqual([7, 6, 4, 3]);
  });

  it('resolveRank at Gold II 20: 1st at 74 = +40 +7; 4th at 74 = +6 +3; 1st at 50 = +40, no bonus; 5th and 8th never scale', () => {
    const gold2 = { divisionIndex: 7, points: 20 };
    expect(resolveRank(gold2, 1, RANK_RULES, { bonus: strengthBonusOf(74, 1), lobbyStrength: 74 })).toMatchObject({ baseDelta: 47, strengthBonus: 7, lobbyStrength: 74, appliedDelta: 47, cappedPoints: 0, after: { divisionIndex: 7, points: 67 } });
    expect(resolveRank(gold2, 2, RANK_RULES, { bonus: strengthBonusOf(74, 2), lobbyStrength: 74 })).toMatchObject({ baseDelta: 34, strengthBonus: 6, appliedDelta: 34, after: { divisionIndex: 7, points: 54 } });
    expect(resolveRank(gold2, 3, RANK_RULES, { bonus: strengthBonusOf(74, 3), lobbyStrength: 74 })).toMatchObject({ baseDelta: 20, strengthBonus: 4, appliedDelta: 20, after: { divisionIndex: 7, points: 40 } });
    expect(resolveRank(gold2, 4, RANK_RULES, { bonus: strengthBonusOf(74, 4), lobbyStrength: 74 })).toMatchObject({ baseDelta: 9, strengthBonus: 3, appliedDelta: 9, after: { divisionIndex: 7, points: 29 } });
    expect(resolveRank(gold2, 1, RANK_RULES, { bonus: strengthBonusOf(50, 1), lobbyStrength: 50 })).toMatchObject({ baseDelta: 40, strengthBonus: 0, lobbyStrength: 50, appliedDelta: 40, after: { divisionIndex: 7, points: 60 } });
    expect(resolveRank(gold2, 1, RANK_RULES, { bonus: strengthBonusOf(30, 1), lobbyStrength: 30 })).toMatchObject({ baseDelta: 40, strengthBonus: 0, lobbyStrength: 30, appliedDelta: 40 });
    // 5th to 8th: a bonus handed in is ignored, the plain award applies.
    expect(resolveRank(gold2, 5, RANK_RULES, { bonus: 15, lobbyStrength: 100 })).toMatchObject({ baseDelta: -6, strengthBonus: 0, appliedDelta: -6, after: { divisionIndex: 7, points: 14 } });
    expect(resolveRank(gold2, 8, RANK_RULES, { bonus: 15, lobbyStrength: 100 })).toMatchObject({ baseDelta: -40, strengthBonus: 0, appliedDelta: -20, after: { divisionIndex: 7, points: 0, demotionReady: true } });
    expect(resolveRank(gold2, 1)).toMatchObject({ baseDelta: 40, strengthBonus: 0, lobbyStrength: null });
  });

  it('the bonus rides through the gate rules unchanged: a 1st at 90/100 still lands on 100 (overflow discarded), a top-4 AT a division gate still lands on 10, a 4th at a medal gate holds', () => {
    const capped = resolveRank({ divisionIndex: 7, points: 90 }, 1, RANK_RULES, { bonus: 15 });
    expect(capped).toMatchObject({ baseDelta: 55, strengthBonus: 15, appliedDelta: 10, cappedPoints: 45, promotionUnlocked: true, after: { divisionIndex: 7, points: 100 } });
    const promoted = resolveRank({ divisionIndex: 7, points: 100 }, 1, RANK_RULES, { bonus: 15 });
    expect(promoted).toMatchObject({ baseDelta: 55, strengthBonus: 15, appliedDelta: 10, cappedPoints: 0, promoted: true, after: { divisionIndex: 8, points: 10 } });
    const fourthPromoted = resolveRank({ divisionIndex: 7, points: 100 }, 4, RANK_RULES, { bonus: 7 });
    expect(fourthPromoted).toMatchObject({ baseDelta: 13, strengthBonus: 7, appliedDelta: 10, cappedPoints: 0, promoted: true, promotionKind: 'division', after: { divisionIndex: 8, points: 10 } });
    const medal = resolveRank({ divisionIndex: 8, points: 100 }, 1, RANK_RULES, { bonus: 15 });
    expect(medal).toMatchObject({ promoted: true, promotionKind: 'medal', after: { divisionIndex: 9, points: 10 } });
    // A 4th at a MEDAL gate is short of the 1st it needs: the +6 +7 holds at 100, all of it discarded.
    expect(resolveRank({ divisionIndex: 8, points: 100 }, 4, RANK_RULES, { bonus: 7 })).toMatchObject({ baseDelta: 13, strengthBonus: 7, appliedDelta: 0, cappedPoints: 13, promoted: false, after: { divisionIndex: 8, points: 100 } });
    // Ascendant III is uncapped: the whole +55 (and a 4th's whole +13) applies.
    expect(resolveRank({ divisionIndex: 17, points: 130 }, 1, RANK_RULES, { bonus: 15 })).toMatchObject({ appliedDelta: 55, after: { divisionIndex: 17, points: 185 } });
    expect(resolveRank({ divisionIndex: 17, points: 130 }, 4, RANK_RULES, { bonus: 7 })).toMatchObject({ appliedDelta: 13, after: { divisionIndex: 17, points: 143 } });
    // A negative or fractional bonus is never applied as such.
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 1, RANK_RULES, { bonus: -9 })).toMatchObject({ baseDelta: 40, strengthBonus: 0 });
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 1, RANK_RULES, { bonus: 2.6 })).toMatchObject({ baseDelta: 43, strengthBonus: 3 });
  });
});
