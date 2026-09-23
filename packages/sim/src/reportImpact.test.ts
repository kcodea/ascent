import { describe, it, expect } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { goldEconomy, heroImpact, ledgerSegment, placementImpact, placesPool, runLedger, runeGroups, runeImpact, tierImpact, waveReached } from './playerReport';
import type { RunTelemetry } from './runTelemetry';
import type { DerivedRun } from './runDerive';

/**
 * BALANCE REPORT ROUND 2 (owner ask 2026-09-22: "apply the same updates to heroes, runes, shop tiers ... clean
 * up and improve the overall economy table ... the average gold a player has/spends per round"). ONE
 * placement-delta implementation (`placementImpact`) feeds every table; these fixtures are small enough to
 * check by hand and the numbers below are the hand results.
 */
const row = (o: Partial<RunTelemetry>): RunTelemetry => ({
  heroId: 'warden', heroOffer: ['warden'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], tierByWave: [], ...o,
});

describe('placementImpact: the one delta implementation', () => {
  it('reads a group against the pool that contains it', () => {
    const s = placementImpact([1, 2, 3], placesPool([1, 2, 3, 6, 8]));
    expect(s.placedN).toBe(3);
    expect(s.avgPlace).toBe(2);
    expect(s.baselineN).toBe(2);
    expect(s.baselineAvgPlace).toBe(7);
    expect(s.delta).toBe(-5);
    expect(s.impact, '-5 x 3 / 23').toBe(-0.65);
    expect(s.deltaCi, 'pooled variance 4/3, se 1.054').toEqual({ lo: -7.07, hi: -2.93 });
    expect(s.firstRate).toBe(33);
    expect(s.top4Rate).toBe(100);
    expect(s.lastRate).toBe(0);
  });

  it('has no delta without a baseline and no interval under two runs a side', () => {
    expect(placementImpact([1, 2], placesPool([1, 2])).delta).toBeNull();
    expect(placementImpact([], placesPool([1, 2])).avgPlace).toBeNull();
    expect(placementImpact([2], placesPool([1, 2, 6])).deltaCi).toBeNull();
    expect(placementImpact([2], placesPool([1, 2, 6])).delta).toBe(-1.5);
  });
});

describe('heroImpact: each hero against the rest of the field', () => {
  const rows: RunTelemetry[] = [
    row({ heroId: 'warden', heroOffer: ['warden', 'drakko', 'fi'], placement: 1, wins: 2 }),
    row({ heroId: 'warden', heroOffer: ['warden', 'drakko', 'fi'], placement: 2, wins: 4 }),
    row({ heroId: 'warden', heroOffer: ['warden', 'drakko', 'fi'], placement: 3, wins: 6 }),
    row({ heroId: 'drakko', heroOffer: ['drakko', 'warden'], placement: 6 }),
    row({ heroId: 'drakko', heroOffer: ['drakko', 'warden'], placement: 8 }),
    row({ heroId: 'fi', heroOffer: [] }), // a pick outside the recorded trio, and no placement
  ];
  const heroes = heroImpact(rows);
  const warden = heroes.find((h) => h.id === 'warden')!;
  const drakko = heroes.find((h) => h.id === 'drakko')!;
  const fi = heroes.find((h) => h.id === 'fi')!;

  it('carries the offer / pick figures and the sample gate', () => {
    expect([warden.offered, warden.runs, warden.offerRate, warden.pickRate]).toEqual([5, 3, 83, 60]);
    expect([drakko.offered, drakko.runs, drakko.pickRate]).toEqual([5, 2, 40]);
    expect([fi.offered, fi.runs, fi.pickRate], 'a pick outside the trio still counts as offered').toEqual([4, 1, 25]);
    expect(warden.avgWins).toBe(4);
    expect(warden.gate).toBe('below');
    expect(warden.name).toBe('Warden');
  });

  it('the delta is the hero against every other placed run, with the shared interval and shrinkage', () => {
    expect(warden.delta).toBe(-5);
    expect(warden.deltaCi).toEqual({ lo: -7.07, hi: -2.93 });
    expect(warden.impact).toBe(-0.65);
    expect(drakko.delta).toBe(5);
    expect(drakko.impact, '5 x 2 / 22').toBe(0.45);
    expect(fi.placedN).toBe(0);
    expect(fi.delta).toBeNull();
    expect(heroes.map((h) => h.id), 'impact ascending, rows without one last').toEqual(['warden', 'drakko', 'fi']);
  });
});

describe('runeImpact: takers against the runs offered the rune that skipped it', () => {
  const B = Object.values(RUNE_INDEX).find((r) => !r.epic)!.id;
  const E = Object.values(RUNE_INDEX).find((r) => r.epic)!.id;
  const rows: RunTelemetry[] = [
    row({ offeredRunes: [B, E], pickedRunes: [B], placement: 1 }),
    row({ offeredRunes: [B], pickedRunes: [B], placement: 3 }),
    row({ offeredRunes: [B, E], pickedRunes: [E], placement: 2 }), // skipped B
    row({ offeredRunes: [B], pickedRunes: [], placement: 6 }), // skipped B
    row({ placement: 8 }), // eliminated before any forge: never offered either
    row({ offeredRunes: [B], pickedRunes: [B] }), // a legacy row with no placement
  ];
  const runes = runeImpact(rows);
  const b = runes.find((r) => r.id === B)!;
  const e = runes.find((r) => r.id === E)!;

  it('counts offers and picks once per run and reads the forge, cost and tribes off the definition', () => {
    expect([b.offered, b.picked, b.pickRate]).toEqual([5, 3, 60]);
    expect(b.forge).toBe('basic');
    expect(e.forge).toBe('epic');
    expect(b.cost).toBe(RUNE_INDEX[B]!.cost);
    expect(b.name).toBe(RUNE_INDEX[B]!.name);
    expect(b.gate).toBe('below');
  });

  it('the Delta is against the offered-and-skipped runs; the field delta is carried beside it', () => {
    expect(b.placedN).toBe(2);
    expect(b.avgPlace).toBe(2);
    expect(b.baselineN, 'the two placed runs offered it that skipped it').toBe(2);
    expect(b.baselineAvgPlace).toBe(4);
    expect(b.delta).toBe(-2);
    expect(b.deltaCi, 'pooled variance 5, se sqrt(5)').toEqual({ lo: -6.38, hi: 2.38 });
    expect(b.impact, '-2 x 2 / 22').toBe(-0.18);
    expect(b.fieldBaselineN, 'every other placed run, including the never-offered 8th').toBe(3);
    expect(b.fieldDelta, '2 minus (2 + 6 + 8) / 3').toBe(-3.33);
    expect(e.delta, 'its one taker placed 2nd; the one skipper placed 1st').toBe(1);
    expect(e.deltaCi).toBeNull();
  });

  it('rolls up per forge, Basic first', () => {
    const groups = runeGroups(runes);
    expect(groups.map((g) => [g.key, g.label, g.cards, g.runsBought, g.placedN])).toEqual([
      ['basic', 'Basic forge', 1, 3, 2],
      ['epic', 'Epic forge', 1, 1, 1],
    ]);
    expect(groups[0]!.delta).toBe(-2);
  });
});

describe('tierImpact: leveling by the usual wave vs later or never', () => {
  const rows: RunTelemetry[] = [
    row({ tierByWave: [0, 1, 1, 2, 2, 3, 3, 4], placement: 1 }), // T2 at 3, T3 at 5, T4 at 7
    row({ tierByWave: [0, 1, 2, 2, 3, 3, 4], placement: 2 }), // T2 at 2, T3 at 4, T4 at 6
    row({ tierByWave: [0, 1, 1, 1, 2, 2, 3], placement: 5 }), // T2 at 4, T3 at 6, never T4
    row({ tierByWave: [0, 1, 1], placement: 8 }), // stayed on T1
    row({ tierByWave: [0, 1, 2, 3, 4, 5, 6, 7] }), // a legacy row with no placement: reaches every tier
  ];
  const tiers = tierImpact(rows);
  const t2 = tiers.find((t) => t.tier === 2)!;
  const t4 = tiers.find((t) => t.tier === 4)!;
  const t5 = tiers.find((t) => t.tier === 5)!;

  it('scans the tier-by-wave array for the first wave at or above the tier', () => {
    expect(waveReached([0, 1, 1, 2, 2, 3], 2)).toBe(3);
    expect(waveReached([0, 1, 1, 2, 2, 3], 3)).toBe(5);
    expect(waveReached([0, 1, 1, 2, 2, 3], 4)).toBeNull();
    expect(waveReached(undefined, 2)).toBeNull();
  });

  it('one row per tier 2 to 7, each with its reach, its cut wave and the early group', () => {
    expect(tiers.map((t) => t.tier)).toEqual([2, 3, 4, 5, 6, 7]);
    expect([t2.runsReached, t2.reachRate, t2.avgWaveReached, t2.cutWave]).toEqual([4, 80, 2.8, 3]);
    expect(t2.earlyRuns, 'reached T2 by wave 3: rows 1, 2 and the legacy row').toBe(3);
    expect(t2.placedN).toBe(2);
    expect(t2.avgPlace).toBe(1.5);
    expect(t2.baselineAvgPlace, 'the 5th and the 8th: reached it later or never').toBe(6.5);
    expect(t2.delta).toBe(-5);
    expect([t2.reachedPlacedN, t2.reachedAvgPlace, t2.reachedDelta], 'reached at all vs never').toEqual([3, 2.7, -5.33]);
    expect([t4.runsReached, t4.reachRate, t4.avgWaveReached, t4.cutWave, t4.earlyRuns]).toEqual([3, 60, 5.7, 6, 2]);
    expect(t4.avgPlace, 'the one placed early run finished 2nd').toBe(2);
    expect(t4.delta, '2 minus (1 + 5 + 8) / 3').toBe(-2.67);
    expect([t5.runsReached, t5.earlyRuns, t5.placedN, t5.delta, t5.reachedPlacedN]).toEqual([1, 1, 0, null, 0]);
    expect(t5.gate).toBe('below');
  });
});

describe('goldEconomy: what a player has, spends and leaves per round', () => {
  const derived = (o: Partial<DerivedRun>): DerivedRun => ({
    contentRevision: 'r', heroId: 'warden', mode: 'lobby', seed: 1, finalWave: 3, wins: 0, won: false, diverged: false,
    offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [], playerActions: 0, ...o,
  });
  // Run A, the winner: buys on wave 1, refills to 4; rerolls, sells, buys on wave 2, refills to 5; tiers up on
  // wave 3 (the last wave, so no refill closes it).
  const A = derived({ gold: [
    { wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 },
    { wave: 1, amount: 4, category: 'income', goldAfter: 4, maxGoldAfter: 4 },
    { wave: 2, amount: -1, category: 'refresh', goldAfter: 3, maxGoldAfter: 4 },
    { wave: 2, amount: 1, category: 'sell', goldAfter: 4, maxGoldAfter: 4 },
    { wave: 2, amount: -3, category: 'minion', goldAfter: 1, maxGoldAfter: 4 },
    { wave: 2, amount: 4, category: 'income', goldAfter: 5, maxGoldAfter: 5 },
    { wave: 3, amount: -5, category: 'upgrade', goldAfter: 0, maxGoldAfter: 5 },
  ] });
  // Run B, a 6th: spends nothing on wave 1 (the refill is 3 to 4, a +1), nothing at all on wave 2 (no event,
  // so the opening Gold carries), a spell on wave 3.
  const B = derived({ gold: [
    { wave: 1, amount: 1, category: 'income', goldAfter: 4, maxGoldAfter: 4 },
    { wave: 3, amount: -2, category: 'spell', goldAfter: 2, maxGoldAfter: 4 },
  ] });
  const E = derived({ finalWave: 1 }); // no placement, no event: one round on the opening 3 Gold
  const rows = [
    { derived: A, placement: 1 },
    { derived: B, placement: 6 },
    { derived: derived({ diverged: true, gold: [{ wave: 1, amount: -99, category: 'minion', goldAfter: 0, maxGoldAfter: 3 }] }), placement: 2 },
    { derived: null, placement: 3 },
    { derived: E },
  ];

  it('folds one ledger into rounds: opening Gold from the first movement, the refill closing the round', () => {
    const a = runLedger(A);
    expect(a.map((w) => [w.wave, w.goldStart, w.income, w.sold, w.unspent])).toEqual([[1, 3, 0, 0, 0], [2, 4, 0, 1, 1], [3, 5, 0, 0, 0]]);
    expect(a[1]!.split).toMatchObject({ refresh: 1, minion: 3, upgrade: 0 });
    expect(a[2]!.split.upgrade).toBe(5);
    const b = runLedger(B);
    expect(b.map((w) => [w.wave, w.goldStart, w.unspent]), 'wave 2 has no event and carries the refill').toEqual([[1, 3, 3], [2, 4, 4], [3, 4, 2]]);
    expect(runLedger(E).map((w) => [w.wave, w.goldStart, w.unspent])).toEqual([[1, 3, 3]]);
    // For every round, what was available equals what was spent plus what was left.
    for (const w of [...a, ...b]) {
      const spent = Object.values(w.split).reduce((s, v) => s + v, 0);
      expect(w.goldStart + w.income + w.sold).toBe(spent + w.unspent);
    }
  });

  it('keeps only the uploaded run when a ledger carries earlier runs of the session in front of it', () => {
    // The live capture can prepend a session's earlier runs: the wave drops back to 1 where the next run began.
    const stacked = derived({ finalWave: 3, gold: [
      { wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 },
      { wave: 1, amount: 4, category: 'income', goldAfter: 4, maxGoldAfter: 4 },
      { wave: 2, amount: -30, category: 'other', goldAfter: 3, maxGoldAfter: 4 }, // the jump into the next run
      ...B.gold,
    ] });
    expect(ledgerSegment(stacked.gold)).toEqual(B.gold);
    expect(runLedger(stacked)).toEqual(runLedger(B));
    expect(ledgerSegment(A.gold), 'a plain ledger is returned as it is').toBe(A.gold);
  });

  it('skips a ledger that did not open on the starting Gold (dev cheat Gold) and counts it', () => {
    const cheat = derived({ gold: [{ wave: 1, amount: -3, category: 'minion', goldAfter: 996, maxGoldAfter: 3 }] });
    const eco = goldEconomy([{ derived: cheat, placement: 1 }, { derived: A, placement: 2 }]);
    expect(eco.runs.all).toBe(1);
    expect(eco.skipped).toBe(1);
    expect(eco.waves.all[0]!.goldStart).toBe(3);
  });

  it('averages per bucket over the runs that played the round; diverged and missing ledgers are skipped', () => {
    const eco = goldEconomy(rows);
    expect(eco.runs).toEqual({ all: 3, first: 1, top4: 1, bottom4: 1 });
    expect(eco.skipped, 'the diverged ledger; a missing ledger is not a ledger').toBe(1);
    const all = eco.waves.all;
    expect(all.map((w) => [w.wave, w.runs])).toEqual([[1, 3], [2, 2], [3, 2]]);
    expect(all[0]).toMatchObject({ goldStart: 3, spent: 1, unspent: 2, spentPct: 33 });
    expect(all[0]!.split.minion).toBe(1);
    expect(all[1]).toMatchObject({ goldStart: 4, income: 0, sold: 0.5, spent: 2, unspent: 2.5, spentPct: 44 });
    expect(all[1]!.split).toMatchObject({ refresh: 0.5, minion: 1.5 });
    expect(all[2]).toMatchObject({ goldStart: 4.5, spent: 3.5, unspent: 1, spentPct: 78 });
    expect(all[2]!.split).toMatchObject({ upgrade: 2.5, spell: 1 });
    expect(eco.waves.first[1]).toMatchObject({ runs: 1, goldStart: 4, sold: 1, spent: 4, unspent: 1, spentPct: 80 });
    expect(eco.waves.bottom4[1]).toMatchObject({ runs: 1, goldStart: 4, spent: 0, unspent: 4, spentPct: 0 });
    expect(eco.waves.top4).toEqual(eco.waves.first);
  });
});
