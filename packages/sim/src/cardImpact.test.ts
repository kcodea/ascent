import { describe, it, expect } from 'vitest';
import { cardImpact, impactGroups, sampleGateOf } from './playerReport';
import { SAMPLE_GATES } from './runDerive';
import type { RunTelemetry } from './runTelemetry';

/**
 * THE PLACEMENT-DELTA MATH (owner ask 2026-09-22: "easy to glean insights into overpowered and underpowered
 * units"). Everything is PER RUN: a run that bought a card three times is ONE buyer run, and the delta is the
 * average placement of the runs that bought a card minus the average placement of every other placed run in
 * the same report. Negative = its buyers finish better than the field. The fixture is small enough to check
 * by hand; the numbers below are the hand results.
 *
 * Fixture cards (ids from the global index): alley (Beast T1 minion), drummer (Neutral T5), joker (Neutral T6),
 * growth (T2 spell), spiritpup (Beast/Dragon T5).
 */
const row = (o: Partial<RunTelemetry>): RunTelemetry => ({
  heroId: 'warden', heroOffer: ['warden'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], tierByWave: [], ...o,
});

const FIXTURE: RunTelemetry[] = [
  row({ placement: 1, offeredCards: ['alley'], boughtCards: ['alley'], buyEvents: [{ id: 'alley', wave: 1, src: 'shop' }] }),
  // Bought alley twice in the shop AND picked it from a Discover: still ONE buyer run.
  row({ placement: 3, offeredCards: ['alley', 'alley', 'alley'], boughtCards: ['alley', 'alley'], discoverOfferedCards: ['alley', 'drummer', 'joker'], discoverBoughtCards: ['alley'], buyEvents: [{ id: 'alley', wave: 2, src: 'shop' }, { id: 'alley', wave: 4, src: 'shop' }, { id: 'alley', wave: 6, src: 'discover' }] }),
  row({ placement: 8, offeredCards: ['alley'] }), // saw it, skipped it, finished last
  row({ placement: 6, offeredCards: ['drummer'], boughtCards: ['drummer'] }),
  row({ placement: 2, offeredCards: ['growth'], boughtCards: ['growth'] }),
  row({ offeredCards: ['alley'], boughtCards: ['alley'] }), // a legacy row with no placement: a buyer, not a placed one
];

describe('cardImpact — per-run samples and conversion', () => {
  const alley = cardImpact(FIXTURE).find((r) => r.id === 'alley')!;

  it('counts a run once however many copies it bought, and keeps the raw sighting / buy counts beside it', () => {
    expect(alley.runsSeen).toBe(4);
    expect(alley.runsBought, 'runs 1, 2 and the legacy row').toBe(3);
    expect(alley.shopSeen, '1 + 3 + 1 + 1 sightings').toBe(6);
    expect(alley.shopBought, '1 + 2 + 1 buys').toBe(4);
    expect(alley.shopBuyRate).toBe(67);
    expect(alley.discSeen).toBe(1);
    expect(alley.discBought).toBe(1);
    expect(alley.discRate).toBe(100);
    expect(alley.avgBuyWave, '(1 + 2 + 4 + 6) / 4').toBe(3.3);
    expect([alley.name, alley.tier, alley.tribe, alley.spell]).toEqual(['Pennycat', 1, 'beast', false]);
  });

  it('placement is credited over placed buyer runs only; the legacy row is a buyer but not a placed one', () => {
    expect(alley.placedN).toBe(2);
    expect(alley.avgPlace, '(1 + 3) / 2').toBe(2);
    expect(alley.firstRate).toBe(50);
    expect(alley.top4Rate).toBe(100);
    expect(alley.lastRate).toBe(0);
    expect(alley.top4Ci, 'Wilson on 2 of 2, whole percents').toEqual({ lo: 34, hi: 100 });
  });
});

describe('cardImpact — the placement delta against the report-wide baseline', () => {
  const rows = cardImpact(FIXTURE);
  const alley = rows.find((r) => r.id === 'alley')!;
  const drummer = rows.find((r) => r.id === 'drummer')!;
  const joker = rows.find((r) => r.id === 'joker')!;

  it('delta = avg place of the runs that bought it minus avg place of every OTHER placed run', () => {
    expect(alley.baselineN, 'the placed runs that did not buy alley: 8th, 6th, 2nd').toBe(3);
    expect(alley.baselineAvgPlace).toBe(5.3);
    expect(alley.delta, '2 minus 5.333').toBe(-3.33);
  });

  it('carries a pooled-variance 95% interval once both groups have two runs', () => {
    // Buyers {1, 3}: variance 2. Others {8, 6, 2}: variance 9.333. Pooled = (1*2 + 2*9.333) / 3 = 6.889;
    // se = sqrt(6.889 * (1/2 + 1/3)) = 2.396; the interval is -3.333 plus or minus 1.96 * 2.396.
    expect(alley.deltaCi!.lo).toBeCloseTo(-8.03, 1);
    expect(alley.deltaCi!.hi).toBeCloseTo(1.36, 1);
  });

  it('the within-tier delta compares a card with its own tier, minions and spells apart', () => {
    expect(alley.tierDelta, 'the only T1 minion IS its tier').toBe(0);
    expect(drummer.tierDelta, 'the only T5 minion').toBe(0);
    expect(joker.tierDelta, 'no delta, no tier delta').toBeNull();
    const two = cardImpact([
      row({ placement: 1, offeredCards: ['drummer'], boughtCards: ['drummer'] }),
      row({ placement: 1, offeredCards: ['drummer'], boughtCards: ['drummer'] }),
      row({ placement: 7, offeredCards: ['spiritpup'], boughtCards: ['spiritpup'] }),
      row({ placement: 4, offeredCards: [] }),
    ]);
    // Both are T5 minions. Drummer: avg 1 vs field (7 + 4) / 2 = 5.5, delta -4.5 on 2 placed runs.
    // Spirit Pup: avg 7 vs field (1 + 1 + 4) / 3 = 2, delta +5 on 1 placed run. Tier delta, weighted by
    // placed runs: (-4.5 * 2 + 5 * 1) / 3 = -1.333.
    const d = two.find((r) => r.id === 'drummer')!;
    const p = two.find((r) => r.id === 'spiritpup')!;
    expect(d.tierDelta).toBeCloseTo(-4.5 + 1.333, 2);
    expect(p.tierDelta).toBeCloseTo(5 + 1.333, 2);
  });

  it('impact is the delta shrunk toward zero by the placed sample: delta times n / (n + 20)', () => {
    expect(alley.impact, '-3.333 * 2 / 22').toBe(-0.3);
    expect(drummer.impact, '2.5 * 1 / 21').toBe(0.12);
  });

  it('a single-run buyer gets a delta but no interval', () => {
    expect(drummer.runsBought).toBe(1);
    expect(drummer.avgPlace).toBe(6);
    expect(drummer.baselineAvgPlace, '(1 + 3 + 8 + 2) / 4').toBe(3.5);
    expect(drummer.delta).toBe(2.5);
    expect(drummer.deltaCi).toBeNull();
  });

  it('a two-run card whose buyers both won cannot out-rank a card with a real sample', () => {
    const rows = cardImpact([
      ...FIXTURE,
      row({ placement: 1, offeredCards: ['spiritpup'], boughtCards: ['spiritpup'] }),
      row({ placement: 1, offeredCards: ['spiritpup'], boughtCards: ['spiritpup'] }),
      ...Array.from({ length: 30 }, () => row({ placement: 2, offeredCards: ['joker'], boughtCards: ['joker'] })),
    ]);
    // Spirit Pup: two buyers, both 1st, against a field averaging 2.29 → delta -1.29, but only 2 placed runs.
    // Joker: thirty buyers all 2nd against a field averaging 3.14 → delta -1.14 on a real sample.
    const pup = rows.find((r) => r.id === 'spiritpup')!;
    const joker = rows.find((r) => r.id === 'joker')!;
    expect(pup.delta!, 'the two wins give it the bigger raw delta').toBeLessThan(joker.delta!);
    expect(pup.impact!, 'but the shrinkage puts the 30-run card first').toBeGreaterThan(joker.impact!);
    expect(pup.deltaCi, 'and its interval is honest: it crosses zero').not.toBeNull();
    expect(pup.deltaCi!.hi).toBeGreaterThan(0);
    expect(rows[0]!.id).toBe('joker');
  });

  it('a card only ever seen has no placement numbers at all, not zeros', () => {
    expect(joker.runsSeen).toBe(1);
    expect(joker.runsBought).toBe(0);
    expect(joker.placedN).toBe(0);
    expect(joker.avgPlace).toBeNull();
    expect(joker.delta).toBeNull();
    expect(joker.top4Rate).toBeNull();
    expect(joker.impact).toBeNull();
  });

  it('spells are rows too, flagged as spells', () => {
    expect(rows.find((r) => r.id === 'growth')!.spell).toBe(true);
  });

  it('every row under the preliminary gate is flagged so a 1-run number is visibly a 1-run number', () => {
    for (const r of rows) expect(r.gate).toBe('below');
    expect(sampleGateOf(SAMPLE_GATES.preliminary)).toBe('preliminary');
    expect(sampleGateOf(SAMPLE_GATES.actionable)).toBe('actionable');
    expect(sampleGateOf(SAMPLE_GATES.confident)).toBe('confident');
    expect(sampleGateOf(SAMPLE_GATES.preliminary - 1)).toBe('below');
  });

  it('the default order is impact ascending, rows without one last, ties by name', () => {
    expect(rows[0]!.id, 'the strongest supported buyer advantage first').toBe('alley');
    const withImpact = rows.filter((r) => r.impact !== null).length;
    for (let i = 1; i < withImpact; i++) expect(rows[i]!.impact!).toBeGreaterThanOrEqual(rows[i - 1]!.impact!);
    for (let i = withImpact; i < rows.length; i++) expect(rows[i]!.impact).toBeNull();
    const tail = rows.slice(withImpact).map((r) => r.name);
    expect(tail).toEqual([...tail].sort((a, b) => a.localeCompare(b)));
  });
});

describe('impactGroups — per tier and per tribe', () => {
  it('rolls the cards up per tier, weighting avgPlace and delta by each card\'s placed buyer runs', () => {
    const minions = cardImpact(FIXTURE).filter((r) => !r.spell);
    const tiers = impactGroups(minions, 'tier');
    expect(tiers.map((g) => g.label)).toEqual(['T1', 'T5', 'T6']);
    const t1 = tiers[0]!;
    expect([t1.cards, t1.runsBought, t1.placedN, t1.avgPlace, t1.delta]).toEqual([1, 3, 2, 2, -3.33]);
    const t6 = tiers[2]!;
    expect([t6.cards, t6.runsBought, t6.delta], 'a tier with no buyers has no delta').toEqual([1, 0, null]);
  });

  it('a dual-tribe card counts for both of its tribes', () => {
    const rows = cardImpact([
      row({ placement: 2, offeredCards: ['spiritpup'], boughtCards: ['spiritpup'] }),
      row({ placement: 5, offeredCards: ['alley'], boughtCards: ['alley'] }),
    ]);
    const tribes = impactGroups(rows, 'tribe');
    expect(tribes.map((g) => g.label)).toEqual(['Beast', 'Dragon']);
    expect(tribes[0]!.cards, 'Pennycat and Spirit Pup are both Beasts').toBe(2);
    expect(tribes[1]!.cards, 'only Spirit Pup is a Dragon').toBe(1);
    expect(tribes[1]!.delta, '2 minus 5').toBe(-3);
  });
});
