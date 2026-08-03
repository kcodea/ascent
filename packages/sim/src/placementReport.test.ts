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

describe('a lobby WIN is placement 1 — not the replay phase', () => {
  // Owner report 2026-08-02: the shop curve showed every run as a LOSS. `reconstructRunTelemetry` derives
  // `won` from phase 'victory', which a lobby never reaches, so every lobby row uploaded with won:false —
  // the same root cause as the Hall of Champions bug. The store now overrides `won` at upload, and the
  // aggregate treats PLACEMENT as authoritative so rows already in Supabase self-heal.
  it('reads placement 1 as a win even when the stored flag says otherwise', () => {
    const r = aggregatePlayerReport([
      row({ tierByWave: [0, 1, 2], placement: 1, won: false }), // a real lobby win, mis-flagged at upload
      row({ tierByWave: [0, 1, 1], placement: 5, won: false }),
    ]);
    expect(r.shopCurve.wonRuns, 'the placement-1 run must count as won').toBe(1);
    expect(r.shopCurve.lostRuns).toBe(1);
    expect(r.shopCurve.won[2], "the winner's curve must be built from that run").toBe(2);
  });

  it('a course-era row with NO placement still trusts its stored flag', () => {
    const r = aggregatePlayerReport([row({ tierByWave: [0, 1, 3], won: true })]);
    expect(r.shopCurve.wonRuns).toBe(1);
  });

  it('win RATES use the same rule, so the tables and the curve agree', () => {
    // Heroes / quests / runes credit wins; CARD rows deliberately do not (their table has no Win column —
    // per-card win impact lives in the CSV export, which reads the same `runWon` helper).
    const r = aggregatePlayerReport([
      row({ heroId: 'drakko', heroOffer: ['drakko'], pickedRunes: ['rune_warpath'], placement: 1, won: false }),
    ]);
    expect(r.heroes.find((h) => h.id === 'drakko')!.winRate, 'hero win rate').toBe(100);
    expect(r.runes.find((x) => x.id === 'rune_warpath')!.winRate, 'rune win rate').toBe(100);
  });
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
