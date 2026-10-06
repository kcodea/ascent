import { describe, expect, it } from 'vitest';
import { DEVELOPER_AUTHORS, bronzeBandOf, developerFilter, formatNewcomerRate, isRatedLobbyRow, medalAtStartOf, newcomerRate, type NewcomerRow } from './newcomerRate';

const V1 = 'B0-30 S10-40 G20-65 P* D10-100 A20-100';
const V3 = 'B0-20/e100 S10-30/e80 G10-50/e60 P* D* A*';
let nextId = 1;
const row = (o: Partial<NewcomerRow>): NewcomerRow => ({
  id: nextId++, created_at: '2026-10-07T10:00:00Z', author: 'Newbie', player_key: 'k-newbie', unrated: false, placement: 3,
  source: 'ladder', hero_offer: ['warden', 'mode:lobby'], patch: '0.1.0+abc1234', rank: null, regime: null, pool: null, ...o,
});
const bronzeStamp = { v: 1, medal: 'Bronze', divisionIndex: 1, division: 'Bronze II', points: 30, rating: 130, seasonId: 3 };
const regimeV3 = { bandsVersion: V3, strengthFormula: 'earlyLate', band: '0-20', bandUsed: '0-20' };

describe('newcomer top-4 rate (R-TELEMETRY-RANK-01)', () => {
  it('the developer list is a named constant with both developers', () => {
    expect(DEVELOPER_AUTHORS).toEqual(['LazerLemon', 'Orangez']);
  });

  it('only rated lobby games with a placement count', () => {
    expect(isRatedLobbyRow(row({}))).toBe(true);
    expect(isRatedLobbyRow(row({ unrated: true })), 'an unauthenticated upload').toBe(false);
    expect(isRatedLobbyRow(row({ source: 'practice' }))).toBe(false);
    expect(isRatedLobbyRow(row({ source: null, hero_offer: ['warden', 'mode:lobby'] })), 'an unstamped lobby row').toBe(true);
    expect(isRatedLobbyRow(row({ source: null, hero_offer: ['warden'] }))).toBe(false);
    expect(isRatedLobbyRow(row({ pool: { allGenerated: true } })), 'an all-generated table is unrated').toBe(false);
    expect(isRatedLobbyRow(row({ placement: null }))).toBe(false);
    expect(isRatedLobbyRow(row({ placement: 9 }))).toBe(false);
  });

  it('excludes developers by handle (any #tag, any case) and by any account key they uploaded under', () => {
    const rows = [row({ author: 'LazerLemon', player_key: 'k-dev' }), row({ author: 'orangez#1234', player_key: 'k-dev2' }), row({ author: 'IronFox87', player_key: 'k-dev' }), row({})];
    const f = developerFilter(rows);
    expect(rows.map(f)).toEqual(['name', 'name', 'account', null]);
  });

  it('reads Bronze from the stamp exactly, from the band approximately, and never guesses an unknown', () => {
    expect(medalAtStartOf(row({ rank: bronzeStamp }))).toEqual({ medal: 'Bronze', basis: 'stamped' });
    expect(medalAtStartOf(row({ rank: { ...bronzeStamp, medal: 'Silver' }, regime: regimeV3 }))).toEqual({ medal: 'Silver', basis: 'stamped' });
    expect(medalAtStartOf(row({ regime: { bandsVersion: V1, band: '0-30' } }))).toEqual({ medal: 'Bronze', basis: 'approximate' });
    expect(medalAtStartOf(row({ regime: regimeV3 }))).toEqual({ medal: 'Bronze', basis: 'approximate' });
    expect(medalAtStartOf(row({ regime: { bandsVersion: V1, band: '10-40' } })), 'Silver band').toEqual({ medal: null, basis: 'approximate' });
    expect(medalAtStartOf(row({ pool: { strengthBand: '0-30' } })), 'no table: the owner fallback').toEqual({ medal: 'Bronze', basis: 'approximate' });
    expect(medalAtStartOf(row({})), 'no stamp, no band').toEqual({ medal: null, basis: 'unknown' });
    expect(medalAtStartOf(row({ rank: { medal: 'Tin' } })), 'a malformed stamp falls through').toEqual({ medal: null, basis: 'unknown' });
    expect(bronzeBandOf(V1)).toBe('0-30');
    expect(bronzeBandOf(V3)).toBe('0-20');
    expect(bronzeBandOf(null)).toBeNull();
  });

  it('computes the rate, the Wilson interval, the sample and distinct players per regime', () => {
    const rows = [
      row({ rank: bronzeStamp, regime: regimeV3, placement: 1, player_key: 'a' }),
      row({ rank: bronzeStamp, regime: regimeV3, placement: 4, player_key: 'a' }),
      row({ rank: bronzeStamp, regime: regimeV3, placement: 5, player_key: 'b' }),
      row({ rank: bronzeStamp, regime: regimeV3, placement: 8, player_key: 'c' }),
      row({ rank: { ...bronzeStamp, medal: 'Gold' }, regime: regimeV3, placement: 1 }),
      row({ regime: { bandsVersion: V1, strengthFormula: 'weighted', band: '0-30', bandUsed: '0-30' }, placement: 2, player_key: 'd' }),
      row({ author: 'LazerLemon', player_key: 'k-dev', rank: bronzeStamp, regime: regimeV3, placement: 1 }),
      row({ placement: 1 }),
    ];
    const rep = newcomerRate(rows);
    expect(rep.excludedDeveloper).toEqual({ byName: 1, byAccount: 0 });
    expect(rep.rankKnown).toEqual({ stamped: 5, approximate: 1, unknown: 1 });
    expect(rep.stampedByMedal).toEqual({ Bronze: 4, Gold: 1 });
    expect(rep.overall.stamped).toMatchObject({ games: 4, top4: 2, rate: 0.5, players: 3 });
    expect(rep.overall.stamped.ci!.lo).toBeCloseTo(0.15, 2);
    expect(rep.overall.stamped.ci!.hi).toBeCloseTo(0.85, 2);
    expect(rep.overall.approximate).toMatchObject({ games: 1, top4: 1 });
    expect(rep.regimes.map((r) => r.regime)).toEqual(['earlyLate strength, bands ' + V3, 'weighted strength, bands ' + V1]);
    expect(rep.regimes[0]!.basis).toBe('stamped');
    const text = formatNewcomerRate(rep).join('\n');
    expect(text).toContain('top-4  50.0%  (2/4 games, 3 players)');
    expect(text).toContain('approximate');
  });

  it('an empty table reads as no games, never NaN', () => {
    const rep = newcomerRate([]);
    expect(rep.overall.combined).toEqual({ games: 0, top4: 0, rate: null, ci: null, players: 0 });
    expect(formatNewcomerRate(rep).join('\n')).not.toContain('NaN');
  });
});
