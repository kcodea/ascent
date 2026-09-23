import { describe, expect, it } from 'vitest';
import { lobbyStrengthOf, parseLobbyStrength, seatStrengthRate, strengthBonusOf, strengthText, strengthTierOf, STRENGTH_TIERS, type StrengthInput } from './lobbyStrength';
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

  it('the tiers live in one place: Easy < 35, Even 35-54, Hard 55-69, Brutal >= 70', () => {
    expect(STRENGTH_TIERS).toEqual({ even: 35, hard: 55, brutal: 70 });
    expect(strengthTierOf(34)).toBe('Easy');
    expect(strengthTierOf(35)).toBe('Even');
    expect(strengthTierOf(54)).toBe('Even');
    expect(strengthTierOf(55)).toBe('Hard');
    expect(strengthTierOf(69)).toBe('Hard');
    expect(strengthTierOf(70)).toBe('Brutal');
    expect(strengthText({ value: 74, tier: 'Brutal' })).toBe('Brutal 74');
  });

  it('parses a stored stamp and rejects a malformed one', () => {
    expect(parseLobbyStrength({ value: 74, tier: 'Brutal', inputs: [{ key: 'a|h|1', fights: 3, wins: 2 }] })).toEqual({ value: 74, tier: 'Brutal', inputs: [{ key: 'a|h|1', fights: 3, wins: 2 }] });
    expect(parseLobbyStrength({ value: '61' })).toMatchObject({ value: 61, tier: 'Hard', inputs: [] });
    expect(parseLobbyStrength({ value: 140 })).toBeNull();
    expect(parseLobbyStrength(null)).toBeNull();
    expect(parseLobbyStrength('Brutal 74')).toBeNull();
  });
});

describe('strengthBonusOf + resolveRank — the 1st-place bonus (owner 2026-09-22: "only winning hard lobbies should scale, and only upwards of 15 rating")', () => {
  it('0 below Hard\'s floor, +15 at 100, linear between, rounded; never on 2nd to 8th; never negative', () => {
    expect(strengthBonusOf(0, 1)).toBe(0);
    expect(strengthBonusOf(54, 1)).toBe(0);
    expect(strengthBonusOf(55, 1)).toBe(0);
    expect(strengthBonusOf(58, 1)).toBe(1);
    expect(strengthBonusOf(70, 1)).toBe(5);
    expect(strengthBonusOf(74, 1)).toBe(6);
    expect(strengthBonusOf(85, 1)).toBe(10);
    expect(strengthBonusOf(100, 1)).toBe(15);
    for (let p = 2; p <= 8; p++) expect(strengthBonusOf(100, p)).toBe(0);
    expect(strengthBonusOf(null, 1)).toBe(0);
    expect(strengthBonusOf(undefined, 1)).toBe(0);
    for (let s = 0; s <= 100; s++) {
      expect(strengthBonusOf(s, 1)).toBeGreaterThanOrEqual(0);
      expect(strengthBonusOf(s, 1)).toBeLessThanOrEqual(15);
      if (s > 0) expect(strengthBonusOf(s, 1)).toBeGreaterThanOrEqual(strengthBonusOf(s - 1, 1));
    }
  });

  it('1st at Brutal 74: +40 +6 = +46 mid-division; 1st at Even 50: +40; 2nd at Brutal: +28', () => {
    const gold2 = { divisionIndex: 7, points: 20 };
    expect(resolveRank(gold2, 1, RANK_RULES, { bonus: strengthBonusOf(74, 1), lobbyStrength: 74 })).toMatchObject({ baseDelta: 46, strengthBonus: 6, lobbyStrength: 74, appliedDelta: 46, cappedPoints: 0, after: { divisionIndex: 7, points: 66 } });
    expect(resolveRank(gold2, 1, RANK_RULES, { bonus: strengthBonusOf(50, 1), lobbyStrength: 50 })).toMatchObject({ baseDelta: 40, strengthBonus: 0, lobbyStrength: 50, appliedDelta: 40 });
    expect(resolveRank(gold2, 2, RANK_RULES, { bonus: 6, lobbyStrength: 74 })).toMatchObject({ baseDelta: 28, strengthBonus: 0, appliedDelta: 28 });
    expect(resolveRank(gold2, 8, RANK_RULES, { bonus: 15, lobbyStrength: 100 })).toMatchObject({ baseDelta: -40, strengthBonus: 0, appliedDelta: -20, after: { divisionIndex: 7, points: 0, demotionReady: true } });
    expect(resolveRank(gold2, 1)).toMatchObject({ baseDelta: 40, strengthBonus: 0, lobbyStrength: null });
  });

  it('the bonus rides through the gate rules unchanged: a 1st at 90/100 in a Brutal lobby still lands on 100 (overflow discarded), a 1st AT the gate still lands on 10', () => {
    const capped = resolveRank({ divisionIndex: 7, points: 90 }, 1, RANK_RULES, { bonus: 15 });
    expect(capped).toMatchObject({ baseDelta: 55, strengthBonus: 15, appliedDelta: 10, cappedPoints: 45, promotionUnlocked: true, after: { divisionIndex: 7, points: 100 } });
    const promoted = resolveRank({ divisionIndex: 7, points: 100 }, 1, RANK_RULES, { bonus: 15 });
    expect(promoted).toMatchObject({ baseDelta: 55, strengthBonus: 15, appliedDelta: 10, cappedPoints: 0, promoted: true, after: { divisionIndex: 8, points: 10 } });
    const medal = resolveRank({ divisionIndex: 8, points: 100 }, 1, RANK_RULES, { bonus: 15 });
    expect(medal).toMatchObject({ promoted: true, promotionKind: 'medal', after: { divisionIndex: 9, points: 10 } });
    // Ascendant III is uncapped: the whole +55 applies.
    expect(resolveRank({ divisionIndex: 17, points: 130 }, 1, RANK_RULES, { bonus: 15 })).toMatchObject({ appliedDelta: 55, after: { divisionIndex: 17, points: 185 } });
    // A negative or fractional bonus is never applied as such.
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 1, RANK_RULES, { bonus: -9 })).toMatchObject({ baseDelta: 40, strengthBonus: 0 });
    expect(resolveRank({ divisionIndex: 7, points: 20 }, 1, RANK_RULES, { bonus: 2.6 })).toMatchObject({ baseDelta: 43, strengthBonus: 3 });
  });
});
