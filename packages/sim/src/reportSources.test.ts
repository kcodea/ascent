import { describe, it, expect } from 'vitest';
import { CONFIG } from './config';
import { reduce } from './reducer';
import type { Action, RunState } from './state';
import { createLobbyRun } from './lobby/runLobby';
import { STRENGTH_BANDS_VERSION } from './lobby/strengthBands';
import { RUN_STRENGTH_FORMULA } from './lobby/boardStrength';
import { beginDerive, finishDerive, observeAction, type CombatEventSummary, type DerivedRun, type UpgradeEvent, type BoardSnapshotLite } from './runDerive';
import {
  currentRegime, emptyTelemetryLog, lobbyRunTelemetry, recordTelemetryAction, aggregatePlayerReport, type RunTelemetry, type TelemetryLog,
} from './runTelemetry';
import { applyReportFilters, buildBalanceExport, heroImpact, scopeReport, tierImpact, type RunTelemetryRow } from './playerReport';
import { ALL_EPOCHS, dataQuality } from './reportCohorts';
import { BANDS_V1, BANDS_V2, bestSources, combatsStacked, resolveRegime, tierFromDerived, withBestSources } from './reportSources';

/**
 * THE EXPORT FIX (2026-10-03, owner "yes fix these issues"; R-REPORT-04). A report field comes from LIVE
 * capture, never from re-simulating a lobby run as an Ascent run. Two halves:
 *  1. capture: a lobby run's row is built from the live log + the live run (`lobbyRunTelemetry`);
 *  2. readers: an OLD row (uploaded with replay values) reads the best source per field (`withBestSources`).
 */

// ── 1. Live capture on a real lobby run ────────────────────────────────────────────────────────────────────

interface Played { final: RunState; log: TelemetryLog; derived: DerivedRun; runesBought: string[]; replayCalls: number }

/** Play a lobby run to its end with a greedy policy that buys, levels the shop and takes runes, feeding every
 *  dispatched action to the live log and the live derivation exactly as the store's commit does. */
function playLobby(seed: number, opts: { dropCaptureAtWave?: number } = {}): Played {
  let s = createLobbyRun(seed, 'drakko');
  const log = emptyTelemetryLog();
  const st = beginDerive(s);
  const runesBought: string[] = [];
  const dispatch = (a: Action): boolean => {
    const n = reduce(s, a);
    // Simulate a run resumed from a save written before live tier/choice capture existed.
    if (opts.dropCaptureAtWave != null && s.wave === opts.dropCaptureAtWave && log.tierByWave && (log.liveFromWave ?? 1) <= 1) {
      delete log.tierByWave; delete log.liveFromWave; delete log.offeredRunes; delete log.pickedRunes;
      delete log.offeredQuests; delete log.pickedQuests; delete log.questTurns; delete log.questStart;
    }
    recordTelemetryAction(log, s, a, n);
    observeAction(st, s, a, n);
    if (a.type === 'buyRune' && n !== s && s.runeforgeOffer) runesBought.push(s.runeforgeOffer[a.index]!);
    const moved = n !== s;
    s = n;
    return moved;
  };
  for (let steps = 0; steps < 3000 && s.phase !== 'gameover' && s.phase !== 'victory'; steps++) {
    if (s.runeforgeOffer) { if (!dispatch({ type: 'buyRune', index: 0 })) dispatch({ type: 'skipRuneforge' }); continue; }
    if (s.discover) { dispatch({ type: 'discover', index: 0 }); continue; }
    if (s.questOffer) { dispatch({ type: 'buyQuest', index: 0 }); continue; }
    if (s.chooseOne) { dispatch({ type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { dispatch({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { dispatch({ type: 'resolveCombat' }); continue; }
    if (s.wave % 2 === 0 && dispatch({ type: 'upgrade' })) continue;
    if (s.embers >= CONFIG.minionCost && s.shop.length > 0 && s.board.length + s.hand.length < CONFIG.boardMax && dispatch({ type: 'buy', uid: s.shop[0]!.uid })) continue;
    if (s.hand.length > 0 && s.board.length < CONFIG.boardMax && dispatch({ type: 'play', uid: s.hand[0]!.uid })) continue;
    dispatch({ type: 'faceOmen' });
  }
  const derived = finishDerive(st, s, { heroId: s.heroId, mode: 'lobby', seed });
  return { final: s, log, derived, runesBought, replayCalls: 0 };
}

const REPLAY_SENTINEL: RunTelemetry = {
  heroId: 'replay', heroOffer: [], won: false, wins: 999, offeredQuests: ['q_replay'], pickedQuests: [], questTurns: {},
  offeredRunes: ['rune_replay'], pickedRunes: ['rune_replay'], offeredCards: [], boughtCards: [], tierByWave: [0, 1, 1, 1],
};

describe('live capture: a lobby run\'s row comes from what the run did, never from a replay', () => {
  const runs = [3, 11, 24].map((seed) => ({ seed, ...playLobby(seed) }));

  it('the runs actually end at gameover (the fixture is a real lobby, not a stub)', () => {
    for (const r of runs) expect(r.final.phase, `seed ${r.seed}`).toBe('gameover');
  });

  it('live wins = the run\'s own won rounds = the live derived combat rows (every round counted)', () => {
    for (const r of runs) {
      let calls = 0;
      const t = lobbyRunTelemetry(r.log, r.final, ['drakko'], () => { calls++; return REPLAY_SENTINEL; });
      expect(calls, 'a complete live log never calls the replay').toBe(0);
      const historyWins = r.final.history.filter((x) => x === 'win').length;
      expect(t.wins, `seed ${r.seed}`).toBe(historyWins);
      expect(t.wins, `seed ${r.seed}: the combat count`).toBe(r.derived.combats.filter((c) => c.result === 'win').length);
      expect(t.capture).toEqual({ v: 1, tierByWave: true, choices: true });
    }
  });

  it('tierByWave covers EXACTLY waves 1..finalWave, never short, never a phantom wave past the end', () => {
    for (const r of runs) {
      const t = lobbyRunTelemetry(r.log, r.final, [], () => REPLAY_SENTINEL);
      expect(t.tierByWave.length - 1, `seed ${r.seed}`).toBe(r.final.wave);
      for (let w = 1; w <= r.final.wave; w++) expect(t.tierByWave[w], `seed ${r.seed} wave ${w}`).toBeTypeOf('number');
      expect(t.tierByWave[r.final.wave]).toBe(r.final.tier);
      // It agrees with the curve rebuilt from the live derived payload (boards + taken upgrades), wave for wave.
      expect(t.tierByWave.slice(1), `seed ${r.seed}: live log vs live derived`).toEqual(tierFromDerived(r.derived).slice(1));
    }
  });

  it('runes and quests are captured live: the picks are exactly what the player bought', () => {
    const withRunes = runs.filter((r) => r.runesBought.length > 0);
    expect(withRunes.length, 'the greedy policy reaches a Runeforge and buys').toBeGreaterThan(0);
    for (const r of withRunes) {
      const t = lobbyRunTelemetry(r.log, r.final, [], () => REPLAY_SENTINEL);
      expect(t.pickedRunes.sort()).toEqual([...new Set(r.runesBought)].sort());
      for (const id of t.pickedRunes) expect(t.offeredRunes).toContain(id);
      expect(t.offeredRunes).not.toContain('rune_replay');
    }
  });

  it('a log resumed from a pre-capture save is PARTIAL: the replay fills tier + choices only, and capture says so', () => {
    const r = playLobby(11, { dropCaptureAtWave: 4 });
    expect(r.log.liveFromWave, 'the log knows capture started mid-run').toBeGreaterThan(1);
    let calls = 0;
    const t = lobbyRunTelemetry(r.log, r.final, [], () => { calls++; return REPLAY_SENTINEL; });
    expect(calls).toBe(1);
    expect(t.capture).toEqual({ v: 1, tierByWave: false, choices: false });
    expect(t.tierByWave, 'tier curve falls back to the replay').toEqual(REPLAY_SENTINEL.tierByWave);
    expect(t.wins, 'wins are ALWAYS live').toBe(r.final.history.filter((x) => x === 'win').length);
  });

  it('an old save without the new log fields still records (optional fields, created on first use)', () => {
    const s = createLobbyRun(5, 'drakko');
    const old = { offeredCards: [], boughtCards: [], discoverOfferedCards: [], discoverBoughtCards: [], buyEvents: [], seenShopUids: [] } as TelemetryLog;
    const next = reduce(s, { type: 'roll' });
    recordTelemetryAction(old, s, { type: 'roll' }, next);
    expect(old.tierByWave?.[s.wave]).toBe(s.tier);
    expect(old.liveFromWave).toBe(s.wave);
  });
});

// ── 2. The readers: old rows read the best source ──────────────────────────────────────────────────────────

const combats = (results: ('win' | 'loss' | 'draw')[], firstWave = 1): CombatEventSummary[] => results.map((result, i) => ({
  wave: firstWave + i, result, damage: 0, attacks: 0, friendlyDeaths: 0, enemyDeaths: 0, summons: 0, spellCasts: 0, beats: 0,
  boardSize: 0, boardAttack: 0, boardHealth: 0, shopTier: 1, triggers: {},
}));
const ups = (spec: string): UpgradeEvent[] => spec.split(' ').filter(Boolean).map((p) => {
  const [wave, toTier] = p.split('>').map(Number) as [number, number];
  return { wave, fromTier: toTier - 1, toTier, cost: 5, taken: true, goldBefore: 9, goldAfter: 4, resolve: 30, boardSize: 0, boardAttack: 0, boardHealth: 0, cardsBoughtThisTurn: 0 };
});
const boards = (spec: string): BoardSnapshotLite[] => spec.split(' ').filter(Boolean).map((p) => {
  const [wave, tier] = p.split(':').map(Number) as [number, number];
  return { wave, tier, cards: [], totalAttack: 0, totalHealth: 0, goldSpentThisTurn: 0 };
});
const derived = (d: Partial<DerivedRun>): DerivedRun => ({
  contentRevision: 'bba0a133', heroId: 'drakko', mode: 'lobby', seed: 1, finalWave: 1, wins: 0, won: false, diverged: false,
  offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [], playerActions: 0, ...d,
});
let nextId = 1;
const row = (o: Partial<RunTelemetryRow>): RunTelemetryRow => ({
  id: nextId++, createdAt: '2026-10-02T22:06:00Z', patch: '0.1.0+a3f8f2d0c', author: 'Kev', playerKey: 'k1', contentRevision: 'bba0a133', derived: null,
  mode: 'lobby', setId: 'set2', source: 'ladder', heroId: 'drakko', heroOffer: ['drakko', 'warden', 'fi'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [], offeredCards: [], boughtCards: [],
  discoverOfferedCards: [], discoverBoughtCards: [], tierByWave: [0, 1], ...o,
});

// Modelled on real rows of content revision bba0a133 (the 2026-10-03 audit's 36-row epoch).
/** Row 183 (2026-10-02, 1st place): the replay said 3 wins and stopped at wave 10; the run won 10 rounds over 14. */
const real183 = (): RunTelemetryRow => row({
  createdAt: '2026-10-02T22:06:00Z', patch: '0.1.0+a3f8f2d0c', placement: 1, won: true, wins: 3,
  tierByWave: [0, 1, 2, 2, 3, 4, 4, 4, 4, 4, 5],
  derived: derived({
    finalWave: 14, wins: 10,
    combats: combats(['win', 'win', 'loss', 'win', 'win', 'win', 'loss', 'win', 'win', 'loss', 'win', 'win', 'loss', 'win']),
    upgrades: ups('2>2 4>3 5>4 10>5'),
    boards: boards('1:1 2:2 3:2 4:3 5:4 6:4 7:4 8:4 9:4 10:5 11:5 12:5 13:5'),
  }),
});
/** Row 160 (2026-09-30, 8th): the replay said 5 wins and ran ONE WAVE PAST the run's end (a phantom wave 10). */
const real160 = (): RunTelemetryRow => row({
  createdAt: '2026-09-30T02:06:00Z', patch: '0.1.0+34daf5b68', placement: 8, wins: 5,
  tierByWave: [0, 1, 2, 2, 3, 4, 4, 4, 4, 5, 5],
  derived: derived({
    finalWave: 9, wins: 3,
    combats: combats(['win', 'loss', 'win', 'loss', 'loss', 'win', 'loss', 'loss', 'loss']),
    upgrades: ups('2>2 4>3 5>4 9>5'),
    boards: boards('1:1 2:2 3:2 4:3 5:4 6:4 7:4 8:4'),
  }),
});
/** A row uploaded after this fix: live values + the capture and regime stamps. */
const liveRow = (): RunTelemetryRow => row({
  createdAt: '2026-10-04T12:00:00Z', patch: '0.1.0+feedc0de1', placement: 2, wins: 9, tierByWave: [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6],
  pickedRunes: ['rune_warpath'], offeredRunes: ['rune_warpath', 'rune_x'],
  capture: { v: 1, tierByWave: true, choices: true },
  // Stamped by a build on the weighted regime, so it shares a regime with row 183 (inferred) in the scope test.
  regime: { bandsVersion: BANDS_V1, strengthFormula: 'weighted', band: '0-30', bandUsed: '0-30' },
  derived: derived({ finalWave: 12, wins: 9 }),
});

describe('readers prefer live data, then the live derived payload, then the replay', () => {
  it('a live row is read as uploaded, every field "live"', () => {
    const b = bestSources(liveRow());
    expect(b.sources).toMatchObject({ wins: 'live', tierByWave: 'live', choices: 'live', flags: [] });
    expect(b.wins).toBe(9);
    expect(b.tierByWave.length - 1).toBe(12);
  });

  it('row 183: wins 3 -> 10 from derived.wins; the short replay curve is replaced by the live one, 1..14', () => {
    const b = bestSources(real183());
    expect(b.sources.wins).toBe('derivedWins');
    expect(b.wins).toBe(10);
    expect(b.sources.storedWins).toBe(3);
    expect(b.sources.tierByWave).toBe('derived');
    expect(b.tierByWave).toEqual([undefined, 1, 2, 2, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5].map((x, i) => (i === 0 ? b.tierByWave[0] : x)));
    expect(b.tierByWave.length - 1).toBe(14);
    expect(b.sources.flags).toEqual(['choicesReplay', 'choicesDiverged']);
  });

  it('row 160: the phantom 10th wave is gone (the run ended on wave 9)', () => {
    const b = bestSources(real160());
    expect(b.tierByWave.length - 1).toBe(9);
    expect(b.wins).toBe(3);
  });

  it('a row with NO derived payload but the live final wave scalar: replay series clamped and flagged', () => {
    const long = bestSources(row({ wins: 4, tierByWave: [0, 1, 2, 2, 3, 3, 3], finalWave: 4 }));
    expect(long.sources).toMatchObject({ wins: 'replay', tierByWave: 'replay' });
    expect(long.tierByWave).toEqual([0, 1, 2, 2, 3]);
    expect(long.sources.flags).toContain('tierClamped');
    const short = bestSources(row({ tierByWave: [0, 1, 2], finalWave: 6 }));
    expect(short.sources.flags).toContain('tierShort');
    expect(short.tierByWave).toEqual([0, 1, 2]);
  });

  it('before #1589 (2026-09-21) derived.wins skipped rounds 1-2: the live combat rows are counted instead', () => {
    const r = row({
      createdAt: '2026-09-15T10:00:00Z', wins: 1,
      derived: derived({ finalWave: 5, wins: 1, combats: combats(['win', 'win', 'loss', 'win', 'loss']) }),
    });
    const b = bestSources(r);
    expect(b.sources.wins).toBe('derivedCombats');
    expect(b.wins).toBe(3);
  });

  it('before #1641 the combat rows could be STACKED: not counted, and derived.wins is flagged as skipping rounds 1-2', () => {
    const stacked = derived({ finalWave: 4, wins: 1, combats: [...combats(['win', 'win', 'win', 'win', 'win', 'win']), ...combats(['loss'], 7)] });
    expect(combatsStacked(stacked)).toBe(true);
    const b = bestSources(row({ createdAt: '2026-09-15T10:00:00Z', wins: 6, derived: stacked }));
    expect(b.sources.wins).toBe('derivedWins');
    expect(b.wins).toBe(1);
    expect(b.sources.flags).toEqual(expect.arrayContaining(['combatsStacked', 'winsExcludeCalibration']));
  });

  it('a DIVERGED payload is never a source', () => {
    const b = bestSources(row({ wins: 4, derived: derived({ diverged: true, finalWave: 9, wins: 2 }) }));
    expect(b.sources.wins).toBe('replay');
    expect(b.wins).toBe(4);
  });

  it('applyReportFilters hands every table the corrected rows: hero avgWins, tierImpact and the shop curve', () => {
    const f = applyReportFilters([real183(), real160(), liveRow()], 'set2');
    expect(f.rows.map((r) => r.wins)).toEqual([10, 3, 9]);
    const drakko = heroImpact(f.rows).find((h) => h.id === 'drakko')!;
    expect(drakko.avgWins).toBeCloseTo((10 + 3 + 9) / 3, 1);
    expect(aggregatePlayerReport(f.rows).heroes.find((h) => h.id === 'drakko')!.avgWins).toBeCloseTo((10 + 3 + 9) / 3, 1);
    const curve = aggregatePlayerReport(f.rows).shopCurve;
    expect(curve.maxWave, 'no phantom wave past the longest live run').toBe(14);
    expect(curve.won[14], 'row 183 (1st) reaches its live final wave').toBe(5);
    const t5 = tierImpact(f.rows).find((t) => t.tier === 5)!;
    expect(t5.runsReached).toBe(3);
    // Idempotent: running the picker twice changes nothing.
    expect(withBestSources(f.rows[0]!)).toBe(f.rows[0]);
    const q = dataQuality(f.rows);
    expect(q.sources.wins).toEqual({ live: 1, derivedWins: 2, derivedCombats: 0, replay: 0 });
    expect(q.replayDisagree, 'the STORED series of 183 and 160 disagreed').toBe(2);
  });
});

// ── 3. The regime stamp and the scope filter ───────────────────────────────────────────────────────────────

describe('the regime: stamped going forward, inferred (and labelled) for old rows', () => {
  it('currentRegime reads the band table and formula from the code, the band from the run', () => {
    const g = currentRegime({ strengthBand: '0-30', strengthBandUsed: '10-40' });
    expect(g).toEqual({ bandsVersion: STRENGTH_BANDS_VERSION, strengthFormula: RUN_STRENGTH_FORMULA, band: '0-30', bandUsed: '10-40' });
    expect(STRENGTH_BANDS_VERSION).toMatch(/^B\d+-\d+ S\d+-\d+ G\d+-\d+ P(\*|\d+-\d+) D(\*|\d+-\d+) A(\*|\d+-\d+)$/);
    expect(currentRegime(null)).toMatchObject({ band: null, bandUsed: null });
    // TRIPWIRE: the newest inference era must match the code. When the band table or the strength formula changes,
    // add an era (cut-over time + version) to reportSources.ts in the same PR, then move this line to it.
    expect([STRENGTH_BANDS_VERSION, RUN_STRENGTH_FORMULA], 'reportSources.ts needs a new era for this regime').toEqual([BANDS_V2, 'final']);
  });

  it('a stamped row is "stamped"; old rows infer from the build first, then the date', () => {
    expect(resolveRegime(liveRow())).toMatchObject({ basis: 'stamped', band: '0-30', strengthFormula: 'weighted', bandsVersion: BANDS_V1 });
    // Build 842413357 had NO bands but uploaded after the bands merged: the date alone would mislabel it.
    const lagging = resolveRegime(row({ patch: '0.1.0+842413357', createdAt: '2026-10-01T02:05:00Z' }));
    expect(lagging).toMatchObject({ basis: 'inferredFromBuild', bandsVersion: null, strengthFormula: null, key: 'no bands' });
    expect(resolveRegime(row({ patch: '0.1.0+38fb7c921', createdAt: '2026-10-01T04:00:00Z' }))).toMatchObject({ basis: 'inferredFromBuild', bandsVersion: BANDS_V1, strengthFormula: 'average' });
    expect(resolveRegime(row({ patch: '0.1.0+6248d1c47' }))).toMatchObject({ strengthFormula: 'weighted' });
    expect(resolveRegime(row({ patch: '0.1.0+unknown99', createdAt: '2026-10-02T00:00:00Z' }))).toMatchObject({ basis: 'inferredFromDate', strengthFormula: 'weighted' });
    expect(resolveRegime(row({ patch: '0.1.0+unknown99', createdAt: '2026-09-29T00:00:00Z' }))).toMatchObject({ basis: 'inferredFromDate', key: 'no bands' });
    expect(resolveRegime(row({ patch: '0.1.0+unknown99', createdAt: '2026-10-03T16:00:00Z' }))).toMatchObject({ basis: 'inferredFromDate', strengthFormula: 'final', bandsVersion: BANDS_V2 });
    expect(resolveRegime(row({ patch: null, createdAt: null }))).toMatchObject({ basis: 'unknown' });
    // The band itself comes from the row's lobbyPool when the run recorded one.
    const pool = { strengthBand: '0-30', strengthBandUsed: '0-30' } as RunTelemetryRow['lobbyPool'];
    expect(resolveRegime(row({ patch: '0.1.0+38fb7c921', lobbyPool: pool }))).toMatchObject({ band: '0-30', bandUsed: '0-30' });
  });

  it('the scope filters by regime and by build; the export carries regime, build and sources per run', () => {
    const f = applyReportFilters([real183(), real160(), liveRow()], 'set2');
    const weighted = resolveRegime(real183()).key;
    const byRegime = scopeReport(f, { epoch: ALL_EPOCHS, from: null, to: null, regime: weighted });
    expect(byRegime.rows.map((r) => r.patch).sort()).toEqual(['0.1.0+a3f8f2d0c', '0.1.0+feedc0de1']);
    expect(scopeReport(f, { epoch: ALL_EPOCHS, from: null, to: null, regime: 'no bands' }).rows).toHaveLength(1);
    expect(scopeReport(f, { epoch: ALL_EPOCHS, from: null, to: null, build: '34daf5b68' }).rows.map((r) => r.wins)).toEqual([3]);
    const x = buildBalanceExport(byRegime.rows, {
      activeSet: { id: 'set2', name: 'Set 2' }, appVersion: 't', generatedAt: 'now', contentRevision: 'bba0a133',
      counts: byRegime.counts, filters: byRegime.applied, scope: { epoch: ALL_EPOCHS, from: null, to: null, regime: weighted }, epochs: [],
      fetch: { flatCap: 1, flatPageSize: 1, flatFetched: 1, flatTruncated: false, derivedCap: 1, derivedRequested: 1, derivedFetched: 1, derivedDropped: 0 },
    });
    expect(x.meta.scope.regime).toBe(weighted);
    expect(x.meta.regimes).toEqual([{ key: weighted, runs: 2, stamped: 1, inferred: 1 }]);
    expect(x.meta.builds.map((b) => b.build).sort()).toEqual(['a3f8f2d0c', 'feedc0de1']);
    const r183 = x.runs.find((r) => r.build === 'a3f8f2d0c')!;
    expect(r183).toMatchObject({ wins: 10, sources: { wins: 'derivedWins', storedWins: 3, tierByWave: 'derived' }, regime: { basis: 'inferredFromBuild' } });
    expect(x.readme.aggregates).toBeDefined();
    const agg = x.readme.aggregates as Record<string, string>;
    expect(agg.tierImpact, 'the stale hardcoded figure is gone').not.toContain('91 of 110');
    expect(agg.tierImpact).toContain('1 runs read a live tier series, 1 one rebuilt from the live derived payload and 0 the stored replay series');
    expect((x.readme.runs as Record<string, string>).wins).toContain('every round counted');
  });
});
