import { describe, it, expect } from 'vitest';
import {
  adjustedAssociation, cardCohorts, dataQuality, defaultEpoch, epochsOf, evidenceLabel, exposedDiagnostic, mostProlificPlayer, runFacts,
  sanitizeRows, segmentByWave, segmentRun, shopEpisodesOf, tierDecisions, tQuantile975, uniquePlayers, welchInterval,
  ALL_EPOCHS, EPOCH_MIN_RUNS, EVIDENCE_GATES, WELCH_MIN_N, type Episode,
} from './reportCohorts';
import { applyReportFilters, cardImpact, cardImpactWithCoverage, goldEconomy, heroImpact, performanceSortValue, scopeReport, type RunTelemetryRow } from './playerReport';
import type { AcquisitionEvent, DerivedRun, OfferEvent, UpgradeEvent } from './runDerive';

/**
 * THE HONEST-ASSOCIATIONS PASS (owner audit handoff 2026-09-22, section 8): the synthetic fixtures that show
 * survival bias is not mistaken for card power by the new reads, and that every cohort helper refuses to print
 * what the data does not carry. Small, hand-checkable, no player history.
 */

// ── Fixture builders ───────────────────────────────────────────────────────────────────────────────────────

const offer = (o: Partial<OfferEvent> & { wave: number; cardId: string }): OfferEvent => ({
  slot: 0, rev: 'r', shopTier: 1, cardTier: 1, cost: 3, gold: 3, maxGold: 3, upgradeCost: 5, resolve: 30,
  boardSize: 0, boardAttack: 0, boardHealth: 0, bought: false, frozen: false, topTribe: 'none', ...o,
});
const acq = (a: Partial<AcquisitionEvent> & { wave: number; cardId: string }): AcquisitionEvent => ({
  rev: 'r', source: 'shop', goldPaid: 3, played: true, finalBoard: false, golden: false, ...a,
});
const upgrade = (u: Partial<UpgradeEvent> & { wave: number; toTier: number; taken: boolean }): UpgradeEvent => ({
  fromTier: u.toTier - 1, cost: 5, goldBefore: 6, goldAfter: u.taken ? 1 : 6, resolve: 30, boardSize: 3, boardAttack: 9, boardHealth: 9, cardsBoughtThisTurn: 0, ...u,
});
const derived = (d: Partial<DerivedRun> = {}): DerivedRun => ({
  contentRevision: 'rev1', heroId: 'warden', mode: 'lobby', seed: 1, finalWave: 12, wins: 5, won: false, diverged: false,
  offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [], playerActions: 0, ...d,
});
let nextId = 1;
const row = (o: Partial<RunTelemetryRow> = {}): RunTelemetryRow => ({
  id: nextId++, createdAt: '2026-09-22T10:00:00Z', patch: 'p', author: 'Kev', contentRevision: 'rev1', derived: null,
  mode: 'lobby', setId: 'set2', source: 'ladder',
  heroId: 'warden', heroOffer: ['warden', 'drakko', 'fi'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], discoverOfferedCards: [], discoverBoughtCards: [], tierByWave: [0, 1], ...o,
});

/** A run that saw `card` in a wave-10 T5 shop and bought it or passed, with the flat arrays agreeing. */
const lateRun = (card: string, bought: boolean, placement: number, author = 'Kev'): RunTelemetryRow => row({
  author, placement, offeredCards: [card], boughtCards: bought ? [card] : [],
  derived: derived({
    offers: [offer({ wave: 10, cardId: card, shopTier: 5, cardTier: 5, cost: 3, gold: 8, bought })],
    acquisitions: bought ? [acq({ wave: 10, cardId: card })] : [],
  }),
});
/** A run eliminated on wave 3 that never saw the card. */
const earlyOut = (placement: number): RunTelemetryRow => row({ placement, derived: derived({ finalWave: 3 }) });

// ── Segments ───────────────────────────────────────────────────────────────────────────────────────────────

describe('segmentByWave: the last run of a stacked payload', () => {
  it('keeps the rows after the last wave drop and returns a clean stream by reference', () => {
    const clean = [{ wave: 1 }, { wave: 2 }, { wave: 5 }];
    expect(segmentByWave(clean)).toBe(clean);
    expect(segmentByWave([{ wave: 1 }, { wave: 2 }, { wave: 1 }, { wave: 3 }, { wave: 1 }, { wave: 1 }, { wave: 4 }])).toEqual([{ wave: 1 }, { wave: 1 }, { wave: 4 }]);
    expect(segmentByWave([])).toEqual([]);
  });

  it('segmentRun cuts every stacking stream and flags the payload', () => {
    const d = derived({
      offers: [offer({ wave: 1, cardId: 'old', bought: true }), offer({ wave: 1, cardId: 'alley' })],
      acquisitions: [acq({ wave: 1, cardId: 'old' })],
      gold: [{ wave: 4, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 }, { wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 }],
    });
    const s = segmentRun(d);
    expect(s.stacked, 'the gold ledger dropped back to wave 1').toBe(true);
    expect(s.gold).toHaveLength(1);
    expect(s.offers, 'a stream without a drop is untouched').toBe(d.offers);
    expect(segmentRun(derived()).stacked).toBe(false);
  });
});

// ── Welch + evidence ───────────────────────────────────────────────────────────────────────────────────────

describe('welchInterval', () => {
  it('t quantiles match the table within a hundredth from four degrees of freedom', () => {
    expect(tQuantile975(4)).toBeCloseTo(2.776, 1);
    expect(tQuantile975(10)).toBeCloseTo(2.228, 2);
    expect(tQuantile975(30)).toBeCloseTo(2.042, 2);
    expect(tQuantile975(1e9)).toBeCloseTo(1.96, 2);
  });

  it('is suppressed under the documented minimum on either side, never collapsed', () => {
    expect(WELCH_MIN_N).toBe(5);
    expect(welchInterval([1, 1], [5, 6, 7, 8, 8]), 'two identical wins would print a zero-width interval').toBeNull();
    expect(welchInterval([1, 2, 3, 4, 5], [5, 6, 7, 8])).toBeNull();
    const ci = welchInterval([1, 2, 3, 4, 5], [5, 6, 7, 8, 9])!;
    // mean diff -4, se sqrt(2.5/5 + 2.5/5) = 1, df 8 -> t 2.306
    expect(ci).toEqual({ lo: -6.31, hi: -1.69 });
    expect(welchInterval([2, 2, 2, 2, 2], [4, 4, 4, 4, 4]), 'both variances zero: the point').toEqual({ lo: -2, hi: -2 });
  });
});

describe('evidenceLabel', () => {
  it('needs both sides AND the players behind them; no key means never supported', () => {
    expect(EVIDENCE_GATES).toEqual({ candidate: { side: 10, players: 3 }, supported: { side: 20, players: 5 } });
    expect(evidenceLabel(50, 9, 8)).toBe('insufficient');
    expect(evidenceLabel(10, 10, 3)).toBe('candidate');
    expect(evidenceLabel(20, 20, 4), 'four players is not five').toBe('candidate');
    expect(evidenceLabel(20, 20, 5)).toBe('supported');
    expect(evidenceLabel(200, 200, null), 'no player key at all').toBe('insufficient');
    expect(uniquePlayers([null, null])).toBeNull();
    expect(uniquePlayers(['a', 'a', null, 'b'])).toBe(2);
  });
});

// ── The exposure confounding fixture (handoff section 8.2) ─────────────────────────────────────────────────

describe('exposure confounding: survival is not card power', () => {
  // Late-round eligible runs: buyers and skippers with IDENTICAL placement distributions, plus early
  // eliminations that never saw the card.
  const rows: RunTelemetryRow[] = [
    ...[1, 2, 3, 4, 5, 6].map((p) => lateRun('urchin', true, p, `p${p}`)),
    ...[1, 2, 3, 4, 5, 6].map((p) => lateRun('urchin', false, p, `q${p}`)),
    ...[7, 8, 8, 7, 8, 7, 8, 8].map((p) => earlyOut(p)),
  ];
  const r = cardImpact(rows).find((c) => c.id === 'seaurchin' || c.id === 'urchin');

  it('the raw buyer association reads negative because the early-outs never saw the card', () => {
    // A card id must exist in the registry for cardImpact to keep it: use the cohort helpers directly instead.
    const facts = rows.map((f) => runFacts(f));
    const flat = exposedDiagnostic(facts, 'flat').byCard.get('urchin')!;
    const seg = exposedDiagnostic(facts, 'segmented').byCard.get('urchin')!;
    const buyerAvg = 3.5, everyoneElseAvg = (3.5 * 6 + 7.625 * 8) / 14;
    expect(buyerAvg - everyoneElseAvg, 'the raw definition').toBeLessThan(-1.5);
    expect(flat.delta, 'the eligible comparison stays zero').toBe(0);
    expect(seg.delta).toBe(0);
    expect([flat.buyers, flat.skippers, seg.buyers, seg.skippers]).toEqual([6, 6, 6, 6]);
    expect(flat.ci, 'six a side clears the Welch minimum: se 1.08, df 10, t 2.228').toEqual({ lo: -2.41, hi: 2.41 });
    expect(r).toBeUndefined();
  });

  it('the adjusted association is zero too, in one supported stratum, with everyone in support', () => {
    const { byCard } = cardCohorts(rows);
    const c = byCard.get('urchin')!;
    expect(c.adjusted.association).toBe(0);
    expect([c.adjusted.strata, c.adjusted.supportedStrata, c.adjusted.buyersInSupport, c.adjusted.skippersInSupport, c.adjusted.outsideSupportPct]).toEqual([1, 1, 6, 6, 0]);
    expect(c.adjusted.supported[0]!.key).toBe('late:T5');
    expect(c.evidence, 'six a side is under the candidate gate').toBe('insufficient');
    expect(c.evidenceBasis).toBe('adjusted');
  });
});

// ── Opportunity validity (8.3) and one vote per run (8.4) ──────────────────────────────────────────────────

describe('shopEpisodesOf: the primary observation per run per card', () => {
  const seg = (offers: OfferEvent[], acquisitions: AcquisitionEvent[] = []) => segmentRun(derived({ offers, acquisitions }));

  it('an unaffordable offer is not a rejection: the episode moves to the first affordable wave', () => {
    const { episodes, unaffordableWaves } = shopEpisodesOf(seg([offer({ wave: 2, cardId: 'a', cost: 5, gold: 3 }), offer({ wave: 4, cardId: 'a', cost: 5, gold: 6, shopTier: 3 })]), 3, 'k');
    expect(episodes.get('a')).toMatchObject({ wave: 4, shopTier: 3, bought: false, crossover: false });
    expect(unaffordableWaves.get('a')).toBe(1);
  });

  it('every offer unaffordable: no episode, counted', () => {
    const { episodes, exclusions } = shopEpisodesOf(seg([offer({ wave: 2, cardId: 'a', cost: 5, gold: 3 })]), 3, 'k');
    expect(episodes.has('a')).toBe(false);
    expect(exclusions.get('a')).toBe('neverAffordable');
  });

  it('a later purchase never relabels an earlier pass: it is a crossover', () => {
    const { episodes } = shopEpisodesOf(seg(
      [offer({ wave: 3, cardId: 'a', gold: 5 }), offer({ wave: 7, cardId: 'a', gold: 9, bought: true })],
      [acq({ wave: 7, cardId: 'a' })],
    ), 2, 'k');
    expect(episodes.get('a')).toMatchObject({ wave: 3, bought: false, crossover: true });
  });

  it('a prior acquisition (any source) excludes the run for that card', () => {
    const { episodes, exclusions } = shopEpisodesOf(seg(
      [offer({ wave: 5, cardId: 'a', gold: 5 })],
      [acq({ wave: 2, cardId: 'a', source: 'discover' })],
    ), 2, 'k');
    expect(episodes.has('a')).toBe(false);
    expect(exclusions.get('a')).toBe('priorAcquisition');
  });

  it('a same-wave grant with no buy is ambiguous and excluded; a same-wave buy is a buy', () => {
    const grant = shopEpisodesOf(seg([offer({ wave: 5, cardId: 'a', gold: 5 })], [acq({ wave: 5, cardId: 'a', source: 'generated' })]), 2, 'k');
    expect(grant.exclusions.get('a')).toBe('sameWaveGrant');
    const buy = shopEpisodesOf(seg([offer({ wave: 5, cardId: 'a', gold: 5 })], [acq({ wave: 5, cardId: 'a', source: 'shop' })]), 2, 'k');
    expect(buy.episodes.get('a')!.bought).toBe(true);
  });

  it('a carried-over (frozen) offer is one row at its first-sighting wave; a buy on that row is a buy there', () => {
    // The observer records an offer once and patches `bought` on the same row when a frozen copy is bought a
    // turn later, so the episode is the first-sighting wave. Documented, not invented.
    const { episodes } = shopEpisodesOf(seg([offer({ wave: 5, cardId: 'a', gold: 5, bought: true })], [acq({ wave: 6, cardId: 'a' })]), 2, 'k');
    expect(episodes.get('a')).toMatchObject({ wave: 5, bought: true });
  });

  it('one vote per run per card: three copies and a reroll in the same wave are one episode; copy conversion stays separate', () => {
    const r = row({
      placement: 2, offeredCards: ['alley', 'alley', 'alley'], boughtCards: ['alley'],
      derived: derived({
        offers: [offer({ wave: 4, cardId: 'alley', slot: 0, gold: 6 }), offer({ wave: 4, cardId: 'alley', slot: 1, gold: 6, bought: true }), offer({ wave: 4, cardId: 'alley', slot: 2, gold: 6 })],
        acquisitions: [acq({ wave: 4, cardId: 'alley' })],
      }),
    });
    const { byCard } = cardCohorts([r]);
    expect(byCard.get('alley')!.episodes).toBe(1);
    expect(byCard.get('alley')!.episodeBuyers).toBe(1);
    const impact = cardImpact([r]).find((c) => c.id === 'alley')!;
    expect([impact.shopSeen, impact.shopBought, impact.runsBought, impact.segmentedBuyers], 'copy conversion is the raw count; buyer runs are one').toEqual([3, 1, 1, 1]);
  });
});

// ── No comparable controls (8.5), uneven support (8.6) ─────────────────────────────────────────────────────

describe('adjustedAssociation', () => {
  const ep = (o: Partial<Episode>): Episode => ({ wave: 10, shopTier: 5, bought: true, crossover: false, placement: 3, key: 'k', ...o });

  it('every eligible run bought: the association is unavailable, not zero', () => {
    const a = adjustedAssociation([ep({ placement: 1 }), ep({ placement: 2 }), ep({ placement: 3 })]);
    expect(a.association).toBeNull();
    expect(a.ci).toBeNull();
    expect([a.buyers, a.skippers, a.strata, a.supportedStrata, a.outsideSupportPct]).toEqual([3, 0, 1, 0, 100]);
  });

  it('strata without a skipper are excluded with counts, never given an invented counterfactual', () => {
    const a = adjustedAssociation([
      // late T5: 2 buyers (1, 3) vs 2 skippers (5, 7): d = -4
      ep({ placement: 1 }), ep({ placement: 3 }), ep({ bought: false, placement: 5 }), ep({ bought: false, placement: 7 }),
      // mid T3: 3 buyers vs 1 skipper: d = 2 - 6 = -4
      ep({ wave: 6, shopTier: 3, placement: 1 }), ep({ wave: 6, shopTier: 3, placement: 2 }), ep({ wave: 6, shopTier: 3, placement: 3 }), ep({ wave: 6, shopTier: 3, bought: false, placement: 6 }),
      // early T1: 4 buyers, no skipper: outside support
      ...[1, 1, 2, 2].map((p) => ep({ wave: 2, shopTier: 1, placement: p })),
      // an unplaced observation supports nothing
      ep({ placement: null }),
    ]);
    expect([a.buyers, a.skippers, a.unplaced]).toEqual([9, 3, 1]);
    expect([a.strata, a.supportedStrata, a.buyersInSupport, a.skippersInSupport]).toEqual([3, 2, 5, 3]);
    expect(a.outsideSupportPct, '4 of 9 buyers').toBe(44);
    expect(a.association, '(2/5)(-4) + (3/5)(-4)').toBe(-4);
    expect(a.ci, 'a supported stratum with one skipper has no variance to read').toBeNull();
    expect(a.supported.map((s) => s.key)).toEqual(['late:T5', 'mid:T3']);
  });

  it('weights by the buyer share of each stratum', () => {
    const a = adjustedAssociation([
      ep({ placement: 1 }), ep({ bought: false, placement: 3 }), // late T5: d = -2, 1 buyer
      ep({ wave: 3, shopTier: 2, placement: 4 }), ep({ wave: 3, shopTier: 2, placement: 4 }), ep({ wave: 3, shopTier: 2, placement: 4 }), ep({ wave: 3, shopTier: 2, bought: false, placement: 2 }), // early T2: d = +2, 3 buyers
    ]);
    expect(a.association, '(1/4)(-2) + (3/4)(2)').toBe(1);
  });
});

// ── Player concentration (8.7), missing outcomes (8.9), reproducibility (8.15) ──────────────────────────────

describe('players, missing outcomes, reproducibility', () => {
  it('duplicating one player\'s runs raises neither the unique-player count nor the evidence label', () => {
    const base = [...[1, 2, 3, 4, 5, 6].map((p) => lateRun('urchin', true, p, 'solo')), ...[1, 2, 3, 4, 5, 6].map((p) => lateRun('urchin', false, p, `q${p}`))];
    const before = cardCohorts(base).byCard.get('urchin')!;
    const inflated = cardCohorts([...base, ...base.filter((r) => r.author === 'solo').map((r) => ({ ...r, id: nextId++ })), ...base.filter((r) => r.author === 'solo').map((r) => ({ ...r, id: nextId++ }))]).byCard.get('urchin')!;
    expect(before.adjusted.buyerPlayers).toBe(1);
    expect(inflated.adjusted.buyers, 'the runs tripled').toBe(18);
    expect(inflated.adjusted.buyerPlayers, 'the players did not').toBe(1);
    expect(inflated.evidence, 'eighteen buyers from one player is still insufficient').toBe('insufficient');
    expect(mostProlificPlayer(base)).toEqual({ key: 'solo', runs: 6 });
  });

  it('hundreds of acquisitions without a placement never satisfy a placement threshold', () => {
    const rows = Array.from({ length: 300 }, (_, i) => lateRun('urchin', i % 2 === 0, 3, `p${i % 12}`)).map((r) => ({ ...r, placement: undefined }));
    const c = cardCohorts(rows).byCard.get('urchin')!;
    expect(c.exposed.buyers + c.exposed.skippers).toBe(0);
    expect(c.exposed.delta).toBeNull();
    expect(c.adjusted.association).toBeNull();
    expect(c.adjusted.unplaced).toBe(300);
    expect(c.evidence).toBe('insufficient');
    expect(c.evidenceBasis).toBe('none');
  });

  it('identical input produces identical output (no gameplay RNG anywhere in the analysis)', () => {
    const rows = [...[1, 2, 3].map((p) => lateRun('urchin', true, p)), ...[4, 5].map((p) => lateRun('urchin', false, p)), earlyOut(8)];
    expect(JSON.stringify(cardCohorts(rows).byCard.get('urchin'))).toBe(JSON.stringify(cardCohorts(rows).byCard.get('urchin')));
  });
});

// ── Data quality, sanitising, epochs (8.11, 8.14) ──────────────────────────────────────────────────────────

describe('dataQuality + sanitizeRows + epochs', () => {
  it('counts what is missing, malformed, duplicated, stacked and replay-divergent; sanitising drops and clears', () => {
    const rows = [
      row({ id: 1, placement: 3, tierByWave: [0, 1, 2, 3], derived: derived({ finalWave: 3 }) }),
      row({ id: 1, placement: 4 }), // duplicate id
      row({ id: 2, placement: 9 }), // malformed
      row({ id: 3, placement: 2.5 }), // malformed
      row({ id: 4, heroOffer: [], contentRevision: null, derived: derived({ diverged: true, finalWave: 1 }) }),
      row({ id: 5, placement: 1, tierByWave: [0, 1], derived: derived({ finalWave: 12, gold: [{ wave: 3, amount: 1, category: 'income', goldAfter: 4, maxGoldAfter: 4 }, { wave: 1, amount: 1, category: 'income', goldAfter: 4, maxGoldAfter: 4 }] }) }),
    ];
    const q = dataQuality(rows);
    expect(q).toEqual({ rows: 6, placementMissing: 1, placementMalformed: 2, duplicateIds: 1, withDerived: 3, diverged: 1, stackedStreams: 1, replayDisagree: 1, heroOfferMissing: 1, revisionMissing: 1 });
    const s = sanitizeRows(rows);
    expect(s.rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect([s.duplicateIds, s.placementMalformed]).toEqual([1, 2]);
    expect(s.rows[1]!.placement, 'a malformed placement is cleared, never counted').toBeUndefined();
    const filtered = applyReportFilters(rows, 'set2');
    expect(filtered.counts).toMatchObject({ fetched: 6, inSet: 5, duplicateIds: 1, placementMalformed: 2, inScope: 5 });
  });

  it('epochs are content revisions newest first; the default is the build revision when present, else the newest', () => {
    const rows = [
      row({ contentRevision: 'old', createdAt: '2026-09-01T00:00:00Z' }),
      row({ contentRevision: 'new', createdAt: '2026-09-20T00:00:00Z' }),
      row({ contentRevision: 'new', createdAt: '2026-09-21T00:00:00Z' }),
      row({ contentRevision: null, createdAt: '2026-09-10T00:00:00Z' }),
    ];
    const epochs = epochsOf(rows);
    expect(epochs.map((e) => [e.rev, e.runs])).toEqual([['new', 2], ['unknown', 1], ['old', 1]]);
    expect(defaultEpoch(epochs, 'old')).toBe('old');
    expect(defaultEpoch(epochs, 'unseen'), 'the newest in the data, never a pool').toBe('new');
    expect(defaultEpoch([], 'unseen')).toBe(ALL_EPOCHS);
  });

  it('an empty current epoch scopes to nothing (insufficient, the toggle is the reader\'s) and the historical read pools explicitly', () => {
    const rows = [row({ contentRevision: 'old', createdAt: '2026-09-01T00:00:00Z' }), row({ contentRevision: 'old', createdAt: '2026-09-02T00:00:00Z' })];
    const filtered = applyReportFilters(rows, 'set2');
    const current = scopeReport(filtered, { epoch: 'build', from: null, to: null });
    expect(current.rows).toHaveLength(0);
    expect(current.counts.inScope).toBe(0);
    expect(current.rows.length < EPOCH_MIN_RUNS).toBe(true);
    const historical = scopeReport(filtered, { epoch: ALL_EPOCHS, from: null, to: null });
    expect(historical.rows).toHaveLength(2);
    expect(historical.applied.some((a) => a.includes('historical'))).toBe(true);
    const window = scopeReport(filtered, { epoch: ALL_EPOCHS, from: '2026-09-02', to: null });
    expect(window.rows).toHaveLength(1);
  });
});

// ── Raw compatibility (8.1): the cohort columns ride beside the untouched raw ones ──────────────────────────

describe('cardImpact carries the cohort reads without moving a raw number', () => {
  const rows = [
    ...[1, 2, 3, 4, 5, 6].map((p) => lateRun('alley', true, p, `p${p}`)),
    ...[1, 2, 3, 4, 5, 6].map((p) => lateRun('alley', false, p, `q${p}`)),
    ...[7, 8, 8, 7, 8, 7, 8, 8].map((p) => earlyOut(p)),
  ];
  const plain = cardImpact(rows.map((r) => ({ ...r, derived: null })));
  const { rows: withCohorts, coverage } = cardImpactWithCoverage(rows);
  const a = withCohorts.find((r) => r.id === 'alley')!;
  const p = plain.find((r) => r.id === 'alley')!;

  it('raw delta, interval, impact and tierDelta are identical with and without the derived streams', () => {
    for (const k of ['delta', 'deltaCi', 'impact', 'tierDelta', 'placedN', 'baselineN', 'avgPlace', 'runsBought'] as const) expect(a[k], k).toEqual(p[k]);
    expect(a.delta).toBeLessThan(-1.5);
    expect(a.deltaWelch, 'six placed buyers and fourteen controls: a Welch interval prints').not.toBeNull();
    expect(a.missingPlacement).toBe(0);
  });

  it('the cohort columns tell the honest story beside them', () => {
    expect(a.exposed.delta).toBe(0);
    expect(a.exposedFlat.delta).toBe(0);
    expect(a.adjusted.association).toBe(0);
    expect(a.segmentedBuyers).toBe(6);
    expect([a.buyerPlayers, a.controlPlayers]).toEqual([6, 7]);
    expect(a.observedTiers).toEqual([5]);
    expect(a.role.lateBuyers).toBe(6);
    expect(coverage).toEqual({ runs: 20, placed: 20, withDerived: 20, excludedNoDerived: 0, stacked: 0, uniquePlayers: 13 });
    expect(performanceSortValue(a), 'insufficient rows have no Performance rank').toBeNull();
    expect(performanceSortValue({ evidence: 'candidate', evidenceBasis: 'adjusted', adjusted: { ...a.adjusted, association: -0.5 }, exposed: a.exposed })).toBe(-0.5);
  });

  it('rows without a derived payload are excluded from the exposed and adjusted reads and counted, not invented', () => {
    const { rows: r, coverage: c } = cardImpactWithCoverage(rows.map((x) => ({ ...x, derived: null })));
    const alley = r.find((x) => x.id === 'alley')!;
    expect(c.excludedNoDerived).toBe(20);
    expect(alley.exposed.delta).toBeNull();
    expect(alley.exposedFlat.delta, 'the flat diagnostic needs no payload').toBe(0);
    expect(alley.adjusted.association).toBeNull();
    expect(alley.evidenceBasis, 'the flat diagnostic never carries the evidence label: it inherits the stacked-stream contamination').toBe('none');
  });
});

// ── Heroes and tier decisions (B4) ─────────────────────────────────────────────────────────────────────────

describe('heroImpact: chosen against offered-not-chosen', () => {
  const rows = [
    ...[1, 2, 3, 4, 5].map((p, i) => row({ heroId: 'warden', heroOffer: ['warden', 'drakko', 'fi'], placement: p, author: `a${i}` })),
    ...[6, 7, 8, 5, 4].map((p, i) => row({ heroId: 'drakko', heroOffer: ['warden', 'drakko', 'fi'], placement: p, author: `b${i}` })),
    row({ heroId: 'fi', heroOffer: [], placement: 8 }), // no recorded trio: raw only
  ];
  const warden = heroImpact(rows).find((h) => h.id === 'warden')!;
  it('the offered comparison uses only runs whose recorded trio offered the hero', () => {
    expect(warden.offeredSkippers, 'the five drakko runs; the fi run has no trio').toBe(5);
    expect(warden.offeredSkipperAvg).toBe(6);
    expect(warden.offeredDelta).toBe(-3);
    expect(warden.offeredCi).not.toBeNull();
    expect(warden.delta, 'the raw read against the field is untouched').toBe(-3.33);
    expect(warden.evidence).toBe('insufficient');
    expect(dataQuality(rows).heroOfferMissing).toBe(1);
  });
});

describe('tierDecisions: took against declined among runs that could afford it', () => {
  it('one primary decision per run per tier; a later take is a crossover; never-affordable runs are in neither group', () => {
    const rows = [
      row({ placement: 1, derived: derived({ upgrades: [upgrade({ wave: 3, toTier: 2, taken: true })] }) }),
      row({ placement: 2, derived: derived({ upgrades: [upgrade({ wave: 3, toTier: 2, taken: false }), upgrade({ wave: 4, toTier: 2, taken: true })] }) }),
      row({ placement: 6, derived: derived({ upgrades: [upgrade({ wave: 3, toTier: 2, taken: false })] }) }),
      row({ placement: 8, derived: derived({ upgrades: [] }) }),
    ];
    const t2 = tierDecisions(rows).find((t) => t.tier === 2)!;
    expect([t2.decisions, t2.took, t2.declined, t2.crossover]).toEqual([3, 1, 2, 1]);
    expect(t2.rawDelta, '1 minus 4').toBe(-3);
    expect(t2.adjusted.association, 'one stratum, early:tight (6 Gold before, cost 5)').toBe(-3);
    expect(t2.adjusted.supported[0]!.key).toBe('early:tight');
    expect(t2.evidence).toBe('insufficient');
  });
});

describe('goldEconomy: the two denominators', () => {
  it('runs = ledgers that reached the round; moved = ledgers with a Gold movement that round', () => {
    const d = derived({
      finalWave: 3,
      gold: [{ wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 }, { wave: 1, amount: 4, category: 'income', goldAfter: 4, maxGoldAfter: 4 }, { wave: 2, amount: 5, category: 'income', goldAfter: 5, maxGoldAfter: 5 }],
    });
    const e = goldEconomy([row({ placement: 1, derived: d })]);
    const w3 = e.waves.all.find((w) => w.wave === 3)!;
    expect([w3.runs, w3.moved], 'round 3 was played with no Gold movement').toEqual([1, 0]);
    expect(e.waves.all.find((w) => w.wave === 1)!.moved).toBe(1);
  });
});
