import { describe, it, expect } from 'vitest';
import { aggregatePlayerReport, type RunTelemetry } from './index';

/**
 * PLACEMENT ANALYTICS (owner ask 2026-08-02: "boards that buy X place 8th most often", "avg shop curve by
 * placement"). `placement` is captured per lobby run since this patch; every row written before it lacks the
 * field, so the aggregate must treat a missing placement as NO DATA — never as a finish — or the averages
 * silently drift toward whatever the absent value is coerced to.
 */
const row = (o: Partial<RunTelemetry>): RunTelemetry => ({
  heroId: 'warden', heroOffer: ['warden'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], tierByWave: [], ...o,
});

describe('placement analytics', () => {
  it('averages placement per card, and counts 1sts and 8ths', () => {
    const r = aggregatePlayerReport([
      row({ boughtCards: ['drummer'], placement: 1 }),
      row({ boughtCards: ['drummer'], placement: 3 }),
      row({ boughtCards: ['drummer'], placement: 8 }),
      row({ boughtCards: ['joker'], placement: 8 }),
    ]);
    const drummer = r.minions.find((m) => m.id === 'drummer')!;
    expect(drummer.avgPlace).toBe(4); // (1+3+8)/3
    expect(drummer.firstRate).toBe(33);
    expect(drummer.lastRate).toBe(33);
    expect(drummer.placedGames).toBe(3);
    const joker = r.minions.find((m) => m.id === 'joker')!;
    expect(joker.avgPlace).toBe(8);
    expect(joker.lastRate).toBe(100);
  });

  it('rows WITHOUT a placement contribute nothing to the placement stats (pre-capture data)', () => {
    const r = aggregatePlayerReport([
      row({ boughtCards: ['drummer'], placement: 2 }),
      row({ boughtCards: ['drummer'] }), // legacy row — no placement
      row({ boughtCards: ['drummer'] }),
    ]);
    const drummer = r.minions.find((m) => m.id === 'drummer')!;
    expect(drummer.avgPlace, 'the legacy rows must not drag the average').toBe(2);
    expect(drummer.placedGames, 'sample size counts ONLY placed rows').toBe(1);
    expect(drummer.picked, 'while the ordinary buy count still sees all three').toBe(3);
  });

  it('a card with no placed data reads null, not zero', () => {
    const r = aggregatePlayerReport([row({ boughtCards: ['drummer'] })]);
    const drummer = r.minions.find((m) => m.id === 'drummer')!;
    expect(drummer.avgPlace).toBeNull();
    expect(drummer.placedGames).toBe(0);
  });

  it('heroes get placement too, credited to the PICK', () => {
    const r = aggregatePlayerReport([
      row({ heroId: 'drakko', heroOffer: ['drakko', 'warden'], placement: 1 }),
      row({ heroId: 'drakko', heroOffer: ['drakko'], placement: 5 }),
    ]);
    const drakko = r.heroes.find((h) => h.id === 'drakko')!;
    expect(drakko.avgPlace).toBe(3);
    expect(drakko.placedGames).toBe(2);
    // The hero merely OFFERED alongside gets no placement credit.
    expect(r.heroes.find((h) => h.id === 'warden')!.placedGames).toBe(0);
  });

  it('the shop curve builds one mean series per placement', () => {
    const r = aggregatePlayerReport([
      row({ tierByWave: [0, 1, 2, 3], placement: 1 }),
      row({ tierByWave: [0, 1, 3, 5], placement: 1 }),
      row({ tierByWave: [0, 1, 1, 2], placement: 8 }),
      row({ tierByWave: [0, 1, 2, 2] }), // legacy: contributes to won/lost only
    ]);
    const c = r.shopCurve;
    expect(c.placedRuns[1]).toBe(2);
    expect(c.placedRuns[8]).toBe(1);
    expect(c.byPlacement[1]![3], '1st-place mean tier at wave 3').toBe(4); // (3+5)/2
    expect(c.byPlacement[8]![3]).toBe(2);
    expect(c.byPlacement[4], 'no runs finished 4th → no series').toBeNull();
  });
});
