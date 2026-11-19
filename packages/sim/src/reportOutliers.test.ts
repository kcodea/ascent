import { describe, it, expect } from 'vitest';
import { createRun, type RunState, type Action } from './state';
import { reduce } from './reducer';
import { ANCIENT_IDS, ancientOfferFor, enableAncients, type AncientId } from './ancients';
import { ancientTelemetryOf, emptyTelemetryLog, offerTelemetryOf, recordTelemetryAction, type RunTelemetry } from './runTelemetry';
import { cardImpact } from './playerReport';
import { CARD_INDEX } from '@game/content';
import {
  ancientFactsOf, ancientOutliers, ancientReach, neverOffered, outlierSentence, pickGaps, questOutliers, rankOutliers, reportUniverse,
  NEVER_MIN_OFFERED, RARE_MIN_OFFERED, heroRerollCounts, outliersFromCards, rankRates, rateRows, soldCounts, standardisedAvgs, type OutlierItem,
} from './reportOutliers';
import type { CohortRow } from './reportCohorts';

/**
 * The Balance Report's at-a-glance read (owner ask 2026-11-19) and the Ancient offer capture behind it
 * (R-TELEMETRY-ANCIENT-01). Fixtures are small enough to check by hand.
 */
const row = (o: Partial<CohortRow>): CohortRow => ({
  heroId: 'warden', heroOffer: ['warden'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], tierByWave: [], ...o,
});
let pk = 0;
/** A placed run with its own player key, so the player gates can be met. */
const placed = (placement: number, o: Partial<CohortRow> = {}): CohortRow => row({ placement, playerKey: `p${pk++}`, ...o });

const item = (o: Partial<OutlierItem>): OutlierItem => ({
  kind: 'minion', id: 'x', name: 'X', offered: 0, taken: 0, takeRate: null, runRate: null, gain: null, ci: null,
  takers: 0, passers: 0, players: null, takerAvg: null, passerAvg: null, evidence: 'insufficient', basis: 'none', note: null,
  peerKey: 'minion:T1', peerLabel: 'Tier 1 minions', ...o,
  shown: o.shown ?? o.offered ?? 0, takenEvents: o.takenEvents ?? o.taken ?? 0,
});

describe('Ancient offer capture (R-TELEMETRY-ANCIENT-01)', () => {
  it('the live log records the three offered Ancients and the wave the offer opened', () => {
    let s: RunState = enableAncients({ ...createRun(77, 'indy'), phase: 'recruit' } as RunState);
    const log = emptyTelemetryLog();
    const act: Action = { type: 'ancientSetMeter', points: 16 } as Action;
    const next = reduce(s, act);
    recordTelemetryAction(log, s, act, next);
    s = next;
    expect(s.ancients?.offer).toHaveLength(3);
    expect(log.ancientOffer).toEqual(s.ancients!.offer);
    expect(log.ancientOfferWave).toBe(s.wave);
    const pick: Action = { type: 'pickAncient', id: s.ancients!.offer![1]! } as Action;
    const after = reduce(s, pick);
    recordTelemetryAction(log, s, pick, after);
    const t = ancientTelemetryOf(after, log);
    expect(t.ancientOffer, 'the offer survives the pick that clears it from state').toEqual(log.ancientOffer);
    expect(t.ancient?.id).toBe(log.ancientOffer![1]);
  });

  it('the seeded offer rebuilds exactly: a pre-capture row can be read', () => {
    const s0 = enableAncients({ ...createRun(4242, 'indy'), phase: 'recruit' } as RunState);
    const s = reduce(s0, { type: 'ancientSetMeter', points: 16 } as Action);
    expect(ancientOfferFor(s.seed, s.wave)).toEqual(s.ancients!.offer);
    // And a run whose log never saw it (an older save) still reports it from the state.
    const picked = reduce(s, { type: 'pickAncient', id: s.ancients!.offer![0]! } as Action);
    expect(ancientTelemetryOf(picked).ancientOffer).toEqual(s.ancients!.offer);
  });

  it('a run with Ancients off carries nothing, and an old row reads as no data', () => {
    expect(ancientTelemetryOf(createRun(1, 'indy'))).toEqual({});
    const f = ancientFactsOf(row({ placement: 3 }));
    expect(f.enabled).toBe(false);
    expect(ancientReach([row({ placement: 3 })]).enabledRuns).toBe(0);
    expect(ancientOutliers([row({ placement: 3 })]).ancients).toEqual([]);
  });

  it('reads the facts from the flat scalars, rebuilds a missing offer from the seed, and refuses a mismatched rebuild', () => {
    const live = ancientFactsOf(row({ ancients: true, ancientOffer: ['war', 'time', 'bonds'], ancientOfferWave: 6, ancient: { id: 'time', heroId: 'indy', wave: 6 } }));
    expect([live.offerSource, live.picked, live.offerWave, live.pairingHero]).toEqual(['live', 'time', 6, 'indy']);
    const offer = ancientOfferFor(99, 7);
    const rebuilt = ancientFactsOf(row({ ancients: true, seed: 99, ancient: { id: offer[2]!, heroId: 'warden', wave: 7 } }));
    expect([rebuilt.offerSource, rebuilt.offer]).toEqual(['rebuilt', offer]);
    const notIn = ANCIENT_IDS.find((a) => !offer.includes(a))!;
    expect(ancientFactsOf(row({ ancients: true, seed: 99, ancient: { id: notIn, heroId: 'warden', wave: 7 } })).offerSource).toBe('none');
  });
});

describe('Ancient and pairing stats', () => {
  // 12 runs offered death/fortune/war at wave 6 (mid band). Death picked in 6 (placements 1-3), fortune in 6 (5-7).
  const offer: AncientId[] = ['death', 'fortune', 'war'];
  const rows: CohortRow[] = [
    ...[1, 2, 3, 1, 2, 3].map((p) => placed(p, { ancients: true, ancientOffer: offer, ancientOfferWave: 6, ancient: { id: 'death', heroId: 'warden', wave: 6 } })),
    ...[5, 6, 7, 5, 6, 7].map((p) => placed(p, { ancients: true, ancientOffer: offer, ancientOfferWave: 6, ancient: { id: 'fortune', heroId: 'warden', wave: 6 } })),
    placed(8, { ancients: true }), // never reached the pick
  ];
  const { ancients, pairings } = ancientOutliers(rows);
  const death = ancients.find((a) => a.id === 'death')!;
  const war = ancients.find((a) => a.id === 'war')!;

  it('the pick against the offered-not-picked, in places better', () => {
    expect([death.offered, death.taken, death.takeRate]).toEqual([12, 6, 50]);
    expect(death.gain, 'mean 2 against mean 6: four places better').toBe(4);
    expect(death.basis).toBe('offeredStrat');
    expect(war.taken).toBe(0);
    expect(war.gain, 'never picked: nothing to compare').toBeNull();
  });

  it('pairings key on the pick\'s hero', () => {
    const wd = pairings.find((p) => p.id === 'warden|death')!;
    expect([wd.heroId, wd.ancientId, wd.offered, wd.taken, wd.gain]).toEqual(['warden', 'death', 12, 6, 4]);
    expect(pickGaps(pairings).never.map((p) => p.id), 'offered 12 times, never picked').toEqual(['warden|war']);
  });

  it('the reach funnel counts the run that never filled the meter', () => {
    const reach = ancientReach(rows);
    expect([reach.enabledRuns, reach.reached, reach.picked, reach.neverReached, reach.avgOfferWave]).toEqual([13, 12, 12, 1, 6]);
  });

  it('a pick with no offer record counts as taken and is noted, outside the comparison', () => {
    const { ancients: a } = ancientOutliers([placed(2, { ancients: true, ancient: { id: 'time', heroId: 'indy' } })]);
    expect([a[0]!.offered, a[0]!.taken, a[0]!.gain]).toEqual([1, 1, null]);
    expect(a[0]!.note).toMatch(/no offer record/);
  });
});

describe('evidence gating: tiny samples never top the list', () => {
  const big = item({ id: 'big', name: 'Big', gain: 0.4, evidence: 'supported', takers: 40, passers: 40, ci: { lo: 0.1, hi: 0.7 } });
  const tiny = item({ id: 'tiny', name: 'Tiny', gain: 3.5, evidence: 'insufficient', takers: 2, passers: 3 });
  const mid = item({ id: 'mid', name: 'Mid', gain: 1.2, evidence: 'candidate', takers: 12, passers: 12, ci: { lo: -0.3, hi: 2.7 } });
  const bad = item({ id: 'bad', name: 'Bad', gain: -0.9, evidence: 'supported', takers: 30, passers: 30, ci: { lo: -1.5, hi: -0.3 } });

  it('ranks only gated rows; the thin row is apart, never ranked', () => {
    const r = rankOutliers([tiny, mid, big, bad]);
    expect(r.over.map((x) => x.id), 'a clear interval first, then by size').toEqual(['big', 'mid']);
    expect(r.under.map((x) => x.id)).toEqual(['bad']);
    expect(r.thin.map((x) => x.id)).toEqual(['tiny']);
  });

  it('"Supported only" drops the candidate', () => {
    expect(rankOutliers([tiny, mid, big, bad], 'supported').over.map((x) => x.id)).toEqual(['big']);
  });

  it('nothing is centred: an all-positive category stays all positive', () => {
    const r = rankOutliers([big, { ...mid, evidence: 'supported' }], 'supported');
    expect(r.under).toEqual([]);
    expect(r.over).toHaveLength(2);
  });
});

describe('never / rarely picked and never offered', () => {
  it('splits by the offer gates', () => {
    const gaps = pickGaps([
      item({ id: 'never', name: 'Never', offered: NEVER_MIN_OFFERED, taken: 0, takeRate: 0 }),
      item({ id: 'thin', name: 'Thin', offered: NEVER_MIN_OFFERED - 1, taken: 0, takeRate: 0 }),
      item({ id: 'rare', name: 'Rare', offered: RARE_MIN_OFFERED * 5, taken: 2, takeRate: 4 }),
      item({ id: 'fine', name: 'Fine', offered: 50, taken: 20, takeRate: 40 }),
    ]);
    expect(gaps.never.map((x) => x.id)).toEqual(['never']);
    expect(gaps.rarely.map((x) => x.id)).toEqual(['rare']);
    expect(gaps.neverThin).toBe(1);
  });

  it('never offered lists the set content the rows never showed', () => {
    const uni = reportUniverse('set2');
    expect(uni.some((u) => u.kind === 'minion')).toBe(true);
    expect(uni.filter((u) => u.kind === 'ancient')).toHaveLength(6);
    const seen = uni.filter((u) => u.kind === 'minion').slice(1).map((u) => item({ kind: 'minion', id: u.id, offered: 1 }));
    const missing = neverOffered(uni.filter((u) => u.kind === 'minion'), seen);
    expect(missing.map((u) => u.id)).toEqual([uni.find((u) => u.kind === 'minion')!.id]);
    expect(reportUniverse('set1').some((u) => u.kind === 'ancient'), 'no Ancients on set 1').toBe(false);
  });
});

describe('quests and the plain-words read', () => {
  const rows: CohortRow[] = [
    ...[1, 2, 2, 3, 1].map((p) => placed(p, { offeredQuests: ['qa', 'qb'], pickedQuests: ['qa'] })),
    ...[6, 7, 5, 6, 8].map((p) => placed(p, { offeredQuests: ['qa', 'qb'], pickedQuests: ['qb'] })),
  ] as RunTelemetry[] as CohortRow[];
  const qa = questOutliers(rows).find((q) => q.id === 'qa')!;

  it('takers against the runs offered it that skipped', () => {
    expect([qa.offered, qa.taken, qa.takeRate, qa.takerAvg, qa.passerAvg]).toEqual([10, 5, 50, 1.8, 6.4]);
    expect(qa.gain).toBe(4.6);
    expect(qa.ci, 'five a side: the interval prints').not.toBeNull();
    expect(qa.ci!.lo).toBeGreaterThan(0);
  });

  it('says it in one paragraph, with no em dash', () => {
    const s = outlierSentence(qa);
    expect(s).toMatch(/^Offered in 10 runs, taken in 5 \(50% of those runs\)\. Runs that took it finished 4\.6 places better \(closer to 1st\) on average compared with the 5 placed runs that were offered it and skipped it/);
    expect(s).toMatch(/Average finish 1\.8 \(took\) vs 6\.4 \(passed\)/);
    expect(s).toMatch(/95% interval \+/);
    expect(s).not.toMatch(/—|--/);
    expect(outlierSentence(item({ offered: 9, taken: 0, takeRate: 0 }))).toMatch(/No run took it/);
  });
});

describe('per-event offers, sells and re-rolls (R-TELEMETRY-OFFERS-01)', () => {
  it('a sale is logged with its wave; each distinct rune offer counts its runes once', () => {
    const s0: RunState = { ...createRun(4242), embers: 20 };
    const log = emptyTelemetryLog();
    const buy: Action = { type: 'buy', uid: s0.shop[0]!.uid };
    const s1 = reduce(s0, buy); recordTelemetryAction(log, s0, buy, s1);
    const placed = s1.hand[0] ?? s1.board[0];
    let s2 = s1;
    if (s1.hand[0]) { const play = { type: 'play', uid: s1.hand[0].uid, index: 0 } as Action; s2 = reduce(s1, play); recordTelemetryAction(log, s1, play, s2); }
    const onBoard = s2.board[0]!;
    const sell: Action = { type: 'sell', uid: onBoard.uid };
    const s3 = reduce(s2, sell); recordTelemetryAction(log, s2, sell, s3);
    expect(placed).toBeTruthy();
    expect(log.sellEvents).toEqual([{ id: onBoard.cardId, wave: s2.wave }]);
    // Rune offers: the same open offer across actions counts once; a fresh one counts again.
    const f1 = { ...s3, runeforgeOffer: ['rune_a', 'rune_b'] } as RunState;
    const noop: Action = { type: 'sell', uid: 'missing' };
    recordTelemetryAction(log, f1, noop, f1); recordTelemetryAction(log, f1, noop, f1);
    const closed = { ...f1, runeforgeOffer: undefined } as RunState;
    recordTelemetryAction(log, closed, noop, closed);
    recordTelemetryAction(log, f1, noop, f1);
    expect(log.runeOfferTimes).toEqual({ rune_a: 2, rune_b: 2 });
    const t = offerTelemetryOf({ heroReroll: { slot: 1, from: 'drakko', to: 'fi' } }, log);
    expect(t.heroRerolled).toBe('drakko');
    expect(t.offerTimes?.rune).toEqual({ rune_a: 2, rune_b: 2 });
    expect(t.sellEvents).toHaveLength(1);
  });

  const CID = Object.keys(CARD_INDEX)[0]!;
  it('cards count every buy (per event) and keep the per-run count apart; sells come from the capture', () => {
    const c = cardImpact([
      row({ placement: 2, offeredCards: [CID, CID, CID], boughtCards: [CID, CID], sellEvents: [{ id: CID, wave: 3 }] }),
      row({ placement: 5, offeredCards: [CID], boughtCards: [] }),
    ]).filter((r) => r.id === CID);
    const rows = [row({ sellEvents: [{ id: CID, wave: 3 }] })];
    const [it] = outliersFromCards(c, soldCounts(rows));
    expect([it!.offered, it!.taken, it!.shown, it!.takenEvents, it!.takeRate, it!.runRate, it!.sold]).toEqual([2, 1, 4, 2, 50, 50, 1]);
    expect(soldCounts([row({})]), 'no row recorded sells: unknown, not zero').toBeNull();
  });

  it('a hero re-rolled away counts as shown and not chosen', () => {
    const rows = [row({ heroId: 'warden', heroOffer: ['warden', 'fi', 'indy'], heroRerolled: 'drakko' }), row({ heroId: 'drakko', heroOffer: ['drakko', 'fi', 'indy'] })];
    expect(heroRerollCounts(rows).get('drakko')).toBe(1);
  });
});

describe('rate outliers: taken far more or less than the peer group', () => {
  const peer = (id: string, shown: number, taken: number, peerKey = 'minion:T3'): OutlierItem => item({ id, name: id, shown, takenEvents: taken, offered: shown, taken, takeRate: Math.round((100 * taken) / shown), peerKey });
  const rows = rateRows([peer('a', 100, 4), peer('b', 100, 30), peer('c', 100, 32), peer('d', 100, 70), peer('thin', 5, 5), peer('other', 100, 90, 'minion:T4')]);
  const a = rows.find((r) => r.item.id === 'a')!;

  it('compares with the peers pooled WITHOUT the item, and gates thin rows', () => {
    expect(a.peerRate, '(30 + 32 + 70 + 5) / 305').toBe(45);
    expect(a.diff).toBe(-41);
    expect(a.clear).toBe(true);
    expect(rows.find((r) => r.item.id === 'other')!.peerRate, 'alone in its tier: no peers').toBeNull();
    const ranked = rankRates(rows);
    expect(ranked.less[0]!.item.id).toBe('a');
    expect(ranked.more[0]!.item.id).toBe('d');
    expect([...ranked.more, ...ranked.less].some((r) => r.item.id === 'thin')).toBe(false);
  });

  it('standardised averages reproduce the stratified association', () => {
    const avgs = standardisedAvgs({ buyersInSupport: 4, supported: [
      { key: 'a', buyers: 3, skippers: 2, buyerAvg: 2, skipperAvg: 4, delta: -2 },
      { key: 'b', buyers: 1, skippers: 2, buyerAvg: 6, skipperAvg: 6, delta: 0 },
    ] });
    expect(avgs).toEqual({ takerAvg: 3, passerAvg: 4.5 });
  });
});
