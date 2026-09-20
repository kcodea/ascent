/**
 * CAREER PAGE DATA (owner rebuild 2026-09-19) — the pure half. Pins:
 *  1. how a `run_history` row (detailed entry OR light JSON-path scalars) becomes a `CareerRun`, and how the
 *     telemetry probe joins by seed (replay availability, run length, placement fallback);
 *  2. the per-run derivations the outcome block prints — placement, run length, Gold — from a FIXTURE REPLAY
 *     (`replaySummary`) and from the light probe (`telemetryFactsOf`), agreeing with each other;
 *  3. the left-column aggregates;
 *  4. the three trend series over a window.
 */
import { describe, it, expect } from 'vitest';
import type { ReplayV2 } from '@game/sim';
import {
  actionsOf, apmOf, careerAggregates, careerRunOf, joinTelemetry, outcomeOf, polylineOf, replaySummary,
  runLengthText, telemetryFactsOf, trendSeries, type CareerRun,
} from './careerData';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-19T12:00:00Z');
const iso = (daysAgo: number): string => new Date(NOW - daysAgo * DAY).toISOString();

/** A detailed `run_history` row (the full entry jsonb) as the server returns it. */
const detailedRow = (over: Record<string, unknown> = {}, entryOver: Record<string, unknown> = {}) => ({
  id: 7, created_at: iso(1), hero_id: 'brackus', wave: 12, wins: 6, placement: 2, mode: 'lobby',
  entry: {
    v: 1, date: iso(1).slice(0, 10), at: iso(1), seed: 4242, heroId: 'brackus', wins: 6, losses: 4, draws: 1,
    wave: 12, placement: 2, mode: 'lobby', goldSpent: 88, apt: 25.5, ratingDelta: 37, dominantTribe: 'beast',
    board: { minions: [{ cardId: 'alleycat', attack: 3, health: 3 }], wave: 12, heroId: 'brackus' },
    ...entryOver,
  },
  ...over,
});

/** A light `run_history` row — the JSON-path aliases come back as TEXT. */
const lightRow = (over: Record<string, unknown> = {}) => ({
  id: 8, created_at: iso(3), hero_id: 'sable', wave: 9, wins: 3, placement: 6, mode: 'lobby',
  losses: '5', draws: '0', apt: '20', seed: '9001', gold_spent: '61', rating_delta: '-18', at: iso(3), dominant_tribe: 'mech',
  ...over,
});

describe('careerRunOf — one run_history row → one CareerRun', () => {
  it('reads a DETAILED row off its entry (board, record, Gold, APT, delta, seed, tribe, end time)', () => {
    const r = careerRunOf(detailedRow());
    expect(r).toMatchObject({
      id: 7, heroId: 'brackus', wave: 12, wins: 6, losses: 4, draws: 1, placement: 2, goldSpent: 88, apt: 25.5,
      ratingDelta: 37, seed: 4242, dominantTribe: 'beast', mode: 'lobby', detailed: true, replayRowId: null, durationMs: null,
    });
    expect(r.board?.minions).toHaveLength(1);
    expect(r.at).toBe(iso(1));
    expect(r.atMs).toBe(NOW - DAY);
  });

  it('reads a LIGHT row off the text aliases, parsing the numbers; board stays null and detailed false', () => {
    const r = careerRunOf(lightRow());
    expect(r).toMatchObject({
      id: 8, heroId: 'sable', wave: 9, wins: 3, losses: 5, draws: 0, placement: 6, goldSpent: 61, apt: 20,
      ratingDelta: -18, seed: 9001, dominantTribe: 'mech', board: null, detailed: false,
    });
    expect(r.atMs).toBe(NOW - 3 * DAY);
  });

  it('a pre-lobby row with no placement / Gold / APT / seed reads null for each (the page prints "—")', () => {
    const r = careerRunOf({ id: 1, created_at: iso(40), hero_id: 'brackus', wave: 10, wins: 4, placement: null, mode: null, losses: '3' });
    expect(r.placement).toBeNull();
    expect(r.goldSpent).toBeNull();
    expect(r.apt).toBeNull();
    expect(r.seed).toBeNull();
    expect(r.dominantTribe).toBeNull();
    expect(r.at).toBe(iso(40)); // falls back to the row's created_at
  });

  it('never throws on garbage', () => {
    expect(() => careerRunOf({})).not.toThrow();
    expect(careerRunOf({ entry: 'nope', placement: 'x', wave: {} }).wave).toBe(0);
    expect(Number.isNaN(careerRunOf({}).atMs)).toBe(true);
  });
});

describe('the telemetry probe → replay availability + run length, joined by seed', () => {
  it('a v2 row with a numeric id is watchable; the clock span is last − first frame tMs', () => {
    const f = telemetryFactsOf({ id: 97, seed: '4242', v2_version: '2', first_t: '0', last_t: '883179.2', placement: 1 });
    expect(f).toEqual({ rowId: 97, seed: 4242, hasReplay: true, durationMs: 883179.2, placement: 1 });
  });

  it('no v2 stamp → not watchable; a missing clock → no length (Watch still works)', () => {
    expect(telemetryFactsOf({ id: 5, seed: '1', v2_version: null, first_t: '0', last_t: '10' }).hasReplay).toBe(false);
    expect(telemetryFactsOf({ id: 5, seed: '1', v2_version: 2 })).toMatchObject({ hasReplay: true, durationMs: null });
    expect(telemetryFactsOf({ id: 'nan', seed: '1', v2_version: '2' }).hasReplay).toBe(false);
  });

  it('joins by seed: the matching run gets the row id + length, a run with no telemetry keeps null, and a run without a placement adopts the telemetry one', () => {
    const runs = [
      careerRunOf(detailedRow()),                                 // seed 4242
      careerRunOf(lightRow()),                                     // seed 9001 — no telemetry
      careerRunOf(lightRow({ id: 9, seed: '5', placement: null })), // seed 5 — placement only on telemetry
    ];
    const joined = joinTelemetry(runs, [
      { id: 97, seed: '4242', v2_version: '2', first_t: '0', last_t: '600000', placement: 2 },
      { id: 96, seed: '4242', v2_version: '2', first_t: '0', last_t: '1', placement: 2 }, // an older duplicate — the newer (first) wins
      { id: 90, seed: '5', v2_version: null, placement: 4 },
    ]);
    expect(joined[0]).toMatchObject({ replayRowId: 97, durationMs: 600000, placement: 2 });
    expect(joined[1]).toMatchObject({ replayRowId: null, durationMs: null });
    expect(joined[2]).toMatchObject({ replayRowId: null, placement: 4 });
  });
});

/** A fixture v2 replay: 3 rounds, 2 fights, a handful of shop actions, Gold spent ticking up in the views. */
const fixtureReplay = (): ReplayV2 => ({
  version: 2, seed: 4242, heroId: 'brackus', mode: 'lobby', author: 'kev', patch: 'test', createdAtMs: NOW,
  frames: [
    { kind: 'shop', wave: 1, tMs: 0, cause: 'turnStart', view: { goldSpent: 0 } as never },
    { kind: 'shopDelta', wave: 1, tMs: 4_000, cause: 'buy', changed: { goldSpent: 3 } as never, removed: [] },
    { kind: 'shopDelta', wave: 1, tMs: 9_000, cause: 'play', changed: {}, removed: [] },
    { kind: 'combat', wave: 1, tMs: 30_000 } as never,
    { kind: 'shop', wave: 2, tMs: 40_000, cause: 'turnStart', view: { goldSpent: 3 } as never },
    { kind: 'shopDelta', wave: 2, tMs: 50_000, cause: 'roll', changed: { goldSpent: 4 } as never, removed: [] },
    { kind: 'shopDelta', wave: 2, tMs: 55_000, cause: 'buy', changed: { goldSpent: 7 } as never, removed: [] },
    { kind: 'combat', wave: 2, tMs: 90_000 } as never,
    { kind: 'shop', wave: 3, tMs: 120_000, cause: 'turnStart', view: { goldSpent: 7 } as never },
  ],
  result: { placement: 3, record: { wins: 1, losses: 1, draws: 0 }, ratingDelta: 12, finalBoard: null },
});

describe('replaySummary — placement / length / Gold / actions off a fixture replay', () => {
  it('reads the recorded placement + record, the clock span, the turnStart-less action count and the last Gold-spent', () => {
    const s = replaySummary(fixtureReplay());
    expect(s.placement).toBe(3);
    expect(s.record).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect(s.durationMs).toBe(120_000);
    expect(s.actions).toBe(4);        // buy, play, roll, buy — the three turnStarts are not decisions
    expect(s.goldSpent).toBe(7);
    expect(s.apm).toBe(2);            // 4 actions over 2 minutes
  });

  it('agrees with the light probe on the run length (frames[0].tMs → frames[-1].tMs)', () => {
    const rep = fixtureReplay();
    const probe = telemetryFactsOf({ id: 1, seed: String(rep.seed), v2_version: '2', first_t: String(rep.frames[0]!.tMs), last_t: String(rep.frames.at(-1)!.tMs) });
    expect(probe.durationMs).toBe(replaySummary(rep).durationMs);
  });

  it('a 0-placement result (an unfinished lobby) reads null, and an empty frame list has no length', () => {
    const rep = fixtureReplay();
    rep.result.placement = 0;
    rep.frames = [];
    expect(replaySummary(rep)).toMatchObject({ placement: null, durationMs: null, actions: 0, goldSpent: null, apm: null });
  });
});

describe('per-run text + derivations', () => {
  it('run length prints whole minutes, "<1 min" under a minute and "—" when unknown', () => {
    expect(runLengthText(883_179)).toBe('15 min');
    expect(runLengthText(36 * 60_000 + 20_000)).toBe('36 min');
    expect(runLengthText(20_000)).toBe('<1 min');
    expect(runLengthText(null)).toBe('—');
  });

  it('the outcome headline: 1st = VICTORY (green), otherwise the ordinal — top-4 neutral, 5th+ red, none = "—"', () => {
    expect(outcomeOf(1)).toEqual({ label: 'VICTORY', cls: 'won' });
    expect(outcomeOf(2)).toEqual({ label: '2ND', cls: 'top4' });
    expect(outcomeOf(4)).toEqual({ label: '4TH', cls: 'top4' });
    expect(outcomeOf(5)).toEqual({ label: '5TH', cls: 'lost' });
    expect(outcomeOf(8)).toEqual({ label: '8TH', cls: 'lost' });
    expect(outcomeOf(null)).toEqual({ label: '—', cls: 'none' });
  });

  it('actions ≈ APT × rounds, APM = actions per minute of the recording; either missing → null', () => {
    expect(actionsOf({ apt: 26.1, wave: 15 })).toBe(392);
    expect(apmOf({ apt: 26.1, wave: 15, durationMs: 883_179 })).toBe(26.6);
    expect(apmOf({ apt: null, wave: 15, durationMs: 883_179 })).toBeNull();
    expect(apmOf({ apt: 26.1, wave: 15, durationMs: null })).toBeNull();
    expect(apmOf({ apt: 26.1, wave: 15, durationMs: 0 })).toBeNull();
  });
});

/** Fixture runs, newest first, spanning the 7 / 30 / 90-day windows. */
const run = (over: Partial<CareerRun>): CareerRun => ({
  id: 1, heroId: 'brackus', at: iso(0), atMs: NOW, wave: 12, wins: 6, losses: 4, draws: 0, placement: 3, goldSpent: 80,
  apt: 25, ratingDelta: 10, seed: 1, dominantTribe: 'beast', mode: 'lobby', board: null, detailed: false, replayRowId: null,
  durationMs: 12 * 60_000, ...over,
});
const RUNS: CareerRun[] = [
  run({ id: 1, atMs: NOW - 1 * DAY, heroId: 'brackus', placement: 1, wins: 8, losses: 2, dominantTribe: 'beast', durationMs: 10 * 60_000, apt: 20, wave: 10 }), // 200 actions / 10 min = 20 APM
  run({ id: 2, atMs: NOW - 3 * DAY, heroId: 'sable', placement: 4, wins: 5, losses: 5, dominantTribe: 'mech', durationMs: null }),
  run({ id: 3, atMs: NOW - 10 * DAY, heroId: 'brackus', placement: 7, wins: 2, losses: 6, dominantTribe: 'beast', durationMs: 8 * 60_000, apt: 30, wave: 8 }), // 240 / 8 = 30 APM
  run({ id: 4, atMs: NOW - 45 * DAY, heroId: 'sable', placement: 2, wins: 6, losses: 3, dominantTribe: 'mech', durationMs: 20 * 60_000, apt: 20, wave: 20 }), // 400 / 20 = 20
  run({ id: 5, atMs: NOW - 120 * DAY, heroId: 'brackus', placement: null, wins: 0, losses: 0, dominantTribe: null, apt: null }),
  run({ id: 6, atMs: NaN, heroId: 'brackus', placement: 6 }), // no end time → in no window, still counts for the tiles
];

describe('careerAggregates — the left column', () => {
  it('most-played hero, 1st-place wins, top-4 %, average placement, favorite tribe', () => {
    const a = careerAggregates(RUNS);
    expect(a.runs).toBe(6);
    expect(a.mostPlayedHero).toBe('brackus');    // 4 of 6
    expect(a.firsts).toBe(1);
    // placements 1, 4, 7, 2, 6 (run 5 has none): top-4 = 3/5 = 60%; avg = 20/5 = 4.0
    expect(a.top4Pct).toBe(60);
    expect(a.avgPlacement).toBe(4);
    expect(a.favoriteTribe).toBe('beast');       // 3 beast vs 2 mech
  });

  it('empties read null / 0 rather than NaN', () => {
    expect(careerAggregates([])).toEqual({ runs: 0, mostPlayedHero: null, firsts: 0, top4Pct: null, avgPlacement: null, favoriteTribe: null });
  });

  it('a hero tie goes to the one played most recently', () => {
    const a = careerAggregates([run({ heroId: 'sable', atMs: NOW }), run({ heroId: 'brackus', atMs: NOW - DAY })]);
    expect(a.mostPlayedHero).toBe('sable');
  });
});

describe('trendSeries — the three lines over a window', () => {
  it('7 days: only runs 1 + 2, oldest first; APM skips the run without a recording clock', () => {
    const t = trendSeries(RUNS, 7, NOW);
    expect(t.placement.points.map((p) => p.y)).toEqual([4, 1]);
    expect(t.placement.avg).toBe(2.5);
    expect(t.winRate.points.map((p) => p.y)).toEqual([50, 80]);  // 5/10, 8/10
    expect(t.winRate.avg).toBe(65);
    expect(t.apm.points.map((p) => p.y)).toEqual([20]);           // run 2 has no clock → skipped
    expect(t.apm.avg).toBe(20);
  });

  it('30 days adds run 3; 90 days adds run 4; the 120-day-old and the undated runs are never in a window', () => {
    const t30 = trendSeries(RUNS, 30, NOW);
    expect(t30.placement.points.map((p) => p.y)).toEqual([7, 4, 1]);
    expect(t30.apm.points.map((p) => p.y)).toEqual([30, 20]);
    const t90 = trendSeries(RUNS, 90, NOW);
    expect(t90.placement.points.map((p) => p.y)).toEqual([2, 7, 4, 1]);
    expect(t90.placement.avg).toBe(3.5);
    expect(t90.apm.points.map((p) => p.y)).toEqual([20, 30, 20]);
    expect(t90.apm.avg).toBe(23.3);
    expect(t90.winRate.points).toHaveLength(4);
  });

  it('win rate is the FIGHT record (wins ÷ wins+losses); a run with no fights contributes no point', () => {
    const t = trendSeries([run({ atMs: NOW, wins: 0, losses: 0 }), run({ atMs: NOW - DAY, wins: 3, losses: 1 })], 7, NOW);
    expect(t.winRate.points.map((p) => p.y)).toEqual([75]);
  });

  it('an empty window yields empty series with null averages', () => {
    const t = trendSeries(RUNS, 7, NOW + 400 * DAY);
    expect(t.placement).toEqual({ points: [], avg: null });
    expect(t.apm).toEqual({ points: [], avg: null });
  });
});

describe('polylineOf — the SVG points string', () => {
  it('spreads points evenly across the box and maps y into the padded height (inverted for placement)', () => {
    const box = { w: 100, h: 50, pad: 5, yMin: 0, yMax: 100 };
    expect(polylineOf([{ atMs: 0, y: 0 }, { atMs: 1, y: 100 }], box)).toBe('5.0,45.0 95.0,5.0');
    expect(polylineOf([{ atMs: 0, y: 1 }, { atMs: 1, y: 8 }], { ...box, yMin: 1, yMax: 8, invert: true })).toBe('5.0,5.0 95.0,45.0');
    expect(polylineOf([{ atMs: 0, y: 50 }], box)).toBe('50.0,25.0'); // a lone point sits mid-box
    expect(polylineOf([], box)).toBe('');
  });

  it('clamps a value outside the axis to the box edge', () => {
    expect(polylineOf([{ atMs: 0, y: 500 }, { atMs: 1, y: -5 }], { w: 100, h: 50, pad: 5, yMin: 0, yMax: 100 })).toBe('5.0,5.0 95.0,45.0');
  });
});
