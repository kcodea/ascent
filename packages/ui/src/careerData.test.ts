/**
 * CAREER PAGE DATA (owner rebuild 2026-09-19) — the pure half. Pins:
 *  1. how a `run_history` row (detailed entry OR light JSON-path scalars) becomes a `CareerRun` — incl. the
 *     run's RUNES off the board snapshot — and how the telemetry probe joins by seed (replay availability, run
 *     length, placement fallback);
 *  2. the per-run derivations the outcome block prints — placement, run length, Gold — from a FIXTURE REPLAY
 *     (`replaySummary`) and from the light probe (`telemetryFactsOf`), agreeing with each other;
 *  3. the left-column aggregates;
 *  4. the four trend series over a window — the three rates smoothed, MMR raw (the rating after each rated run,
 *     a real 0 plotted, a missing stamp skipped) — and the All time window with no lower bound (owner ask
 *     2026-09-22);
 *  5. the Heroes tab's per-hero fold (owner ask 2026-09-20);
 *  6. the MATCH WIN definition (owner ruling 2026-09-20): a match is won by PLACEMENT — top 4 = W, 5th–8th =
 *     L — and that is the unit the banner result, the hero fold and the Win Rate trend all use (never fights).
 */
import { describe, it, expect } from 'vitest';
import type { ReplayV2 } from '@game/sim';
import {
  TREND_WINDOWS, actionsOf, apmOf, careerAggregates, careerRunOf, heroCareers, isMatchWin, joinTelemetry, matchResultOf, mmrAxisOf, outcomeOf,
  polylineOf, replaySummary, runLengthText, telemetryFactsOf, trendSeries, trendWindowLabel, type CareerRun, type TrendSeries,
} from './careerData';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-19T12:00:00Z');
const iso = (daysAgo: number): string => new Date(NOW - daysAgo * DAY).toISOString();

/** A detailed `run_history` row (the full entry jsonb) as the server returns it. */
const detailedRow = (over: Record<string, unknown> = {}, entryOver: Record<string, unknown> = {}) => ({
  id: 7, created_at: iso(1), hero_id: 'brackus', wave: 12, wins: 6, placement: 2, mode: 'lobby',
  entry: {
    v: 1, date: iso(1).slice(0, 10), at: iso(1), seed: 4242, heroId: 'brackus', wins: 6, losses: 4, draws: 1,
    wave: 12, placement: 2, mode: 'lobby', goldSpent: 88, apt: 25.5, ratingDelta: 37, ratingAfter: 137, dominantTribe: 'beast',
    board: { minions: [{ cardId: 'alleycat', attack: 3, health: 3 }], wave: 12, heroId: 'brackus', runes: ['rune_broodpit', 'rune_epic_forge'] },
    ...entryOver,
  },
  ...over,
});

/** A light `run_history` row — the JSON-path aliases come back as TEXT. */
const lightRow = (over: Record<string, unknown> = {}) => ({
  id: 8, created_at: iso(3), hero_id: 'sable', wave: 9, wins: 3, placement: 6, mode: 'lobby',
  losses: '5', draws: '0', apt: '20', seed: '9001', gold_spent: '61', rating_delta: '-18', rating_after: '0', at: iso(3), dominant_tribe: 'mech',
  ...over,
});

describe('careerRunOf — one run_history row → one CareerRun', () => {
  it('reads a DETAILED row off its entry (board, record, Gold, APT, delta, seed, tribe, end time)', () => {
    const r = careerRunOf(detailedRow());
    expect(r).toMatchObject({
      id: 7, heroId: 'brackus', wave: 12, wins: 6, losses: 4, draws: 1, placement: 2, goldSpent: 88, apt: 25.5,
      ratingDelta: 37, ratingAfter: 137, seed: 4242, dominantTribe: 'beast', mode: 'lobby', detailed: true, replayRowId: null, durationMs: null, lobbyStrength: null,
    });
    expect(r.board?.minions).toHaveLength(1);
    expect(r.at).toBe(iso(1));
    expect(r.atMs).toBe(NOW - DAY);
  });

  it("the run's RUNES ride on the board snapshot (`board.runes` = the run's ownedRunes, in pick order); none → []", () => {
    expect(careerRunOf(detailedRow()).runes).toEqual(['rune_broodpit', 'rune_epic_forge']);
    // Rune of Duplication legitimately repeats an id — both slots are kept.
    expect(careerRunOf(detailedRow({}, { board: { minions: [], wave: 1, heroId: 'brackus', runes: ['rune_x', 'rune_x'] } })).runes).toEqual(['rune_x', 'rune_x']);
    expect(careerRunOf(detailedRow({}, { board: { minions: [], wave: 1, heroId: 'brackus' } })).runes).toEqual([]);
    expect(careerRunOf(detailedRow({}, { board: null })).runes).toEqual([]);
    expect(careerRunOf(lightRow()).runes).toEqual([]);
    // Garbage in the array never leaks through.
    expect(careerRunOf(detailedRow({}, { board: { minions: [], wave: 1, heroId: 'brackus', runes: ['ok', 3, null, ''] } })).runes).toEqual(['ok']);
  });

  it('reads a LIGHT row off the text aliases, parsing the numbers; board stays null and detailed false', () => {
    const r = careerRunOf(lightRow());
    expect(r).toMatchObject({
      id: 8, heroId: 'sable', wave: 9, wins: 3, losses: 5, draws: 0, placement: 6, goldSpent: 61, apt: 20,
      ratingDelta: -18, ratingAfter: 0, seed: 9001, dominantTribe: 'mech', board: null, detailed: false,
    });
    expect(r.atMs).toBe(NOW - 3 * DAY);
  });

  it('the MMR after settle: the server stamp on either row shape; "0" is a REAL 0 (the Bronze I floor), a row the stamp never reached is null — never 0', () => {
    expect(careerRunOf(detailedRow()).ratingAfter).toBe(137);
    expect(careerRunOf(lightRow()).ratingAfter).toBe(0);
    expect(careerRunOf(lightRow({ rating_after: '110' })).ratingAfter).toBe(110);
    expect(careerRunOf(lightRow({ rating_after: null })).ratingAfter).toBeNull();   // PostgREST projects a missing key as NULL
    expect(careerRunOf(lightRow({ rating_after: undefined })).ratingAfter).toBeNull();
    expect(careerRunOf(detailedRow({}, { ratingAfter: undefined })).ratingAfter).toBeNull(); // an unstamped entry
    expect(careerRunOf(detailedRow({ rating_after: '99' }, { ratingAfter: 0 })).ratingAfter).toBe(0); // the entry wins over the alias, 0 included
  });

  it('a pre-lobby row with no placement / Gold / APT / seed reads null for each (the page prints "—")', () => {
    const r = careerRunOf({ id: 1, created_at: iso(40), hero_id: 'brackus', wave: 10, wins: 4, placement: null, mode: null, losses: '3' });
    expect(r.placement).toBeNull();
    expect(r.goldSpent).toBeNull();
    expect(r.apt).toBeNull();
    expect(r.seed).toBeNull();
    expect(r.dominantTribe).toBeNull();
    expect(r.ratingAfter).toBeNull(); // never rated → no MMR point, not a 0
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

  it('a MATCH is won by placement: top 4 = WIN, 5th–8th = LOSS, no placement = neither (owner 2026-09-20)', () => {
    expect([1, 2, 3, 4].map(isMatchWin)).toEqual([true, true, true, true]);
    expect([5, 6, 7, 8].map(isMatchWin)).toEqual([false, false, false, false]);
    expect(isMatchWin(null)).toBeNull();
    expect(matchResultOf(1)).toEqual({ label: 'WIN', cls: 'win' });
    expect(matchResultOf(4)).toEqual({ label: 'WIN', cls: 'win' });
    expect(matchResultOf(5)).toEqual({ label: 'LOSS', cls: 'loss' });
    expect(matchResultOf(8)).toEqual({ label: 'LOSS', cls: 'loss' });
    expect(matchResultOf(null)).toEqual({ label: '—', cls: 'none' });
  });

  it('actions ≈ APT × rounds, APM = actions per minute of the recording; either missing → null', () => {
    expect(actionsOf({ apt: 26.1, wave: 15 })).toBe(392);
    expect(apmOf({ apt: 26.1, wave: 15, durationMs: 883_179 })).toBe(26.6);
    expect(apmOf({ apt: null, wave: 15, durationMs: 883_179 })).toBeNull();
    expect(apmOf({ apt: 26.1, wave: 15, durationMs: null })).toBeNull();
    expect(apmOf({ apt: 26.1, wave: 15, durationMs: 0 })).toBeNull();
  });
});

/** Fixture runs, newest first, spanning the 7 / 30 / 90-day windows and, beyond them, All time. */
const run = (over: Partial<CareerRun>): CareerRun => ({
  id: 1, heroId: 'brackus', at: iso(0), atMs: NOW, wave: 12, wins: 6, losses: 4, draws: 0, placement: 3, goldSpent: 80,
  apt: 25, ratingDelta: 10, ratingAfter: null, seed: 1, dominantTribe: 'beast', mode: 'lobby', board: null, detailed: false, runes: [], replayRowId: null,
  durationMs: 12 * 60_000, lobbyStrength: null, ...over,
});
const RUNS: CareerRun[] = [
  run({ id: 1, atMs: NOW - 1 * DAY, heroId: 'brackus', placement: 1, wins: 8, losses: 2, dominantTribe: 'beast', durationMs: 10 * 60_000, apt: 20, wave: 10, ratingAfter: 110 }), // 200 actions / 10 min = 20 APM
  run({ id: 2, atMs: NOW - 3 * DAY, heroId: 'sable', placement: 4, wins: 5, losses: 5, dominantTribe: 'mech', durationMs: null, ratingAfter: null }), // the settle stamp missed this row → no MMR point
  run({ id: 3, atMs: NOW - 10 * DAY, heroId: 'brackus', placement: 7, wins: 2, losses: 6, dominantTribe: 'beast', durationMs: 8 * 60_000, apt: 30, wave: 8, ratingAfter: 86 }), // 240 / 8 = 30 APM
  run({ id: 4, atMs: NOW - 45 * DAY, heroId: 'sable', placement: 2, wins: 6, losses: 3, dominantTribe: 'mech', durationMs: 20 * 60_000, apt: 20, wave: 20, ratingAfter: 46 }), // 400 / 20 = 20
  run({ id: 5, atMs: NOW - 120 * DAY, heroId: 'brackus', placement: null, wins: 0, losses: 0, dominantTribe: null, apt: null, ratingAfter: 0 }), // a REAL 0 — the Bronze I floor — plots (All time only)
  run({ id: 6, atMs: NaN, heroId: 'brackus', placement: 6, ratingAfter: 500 }), // no end time → in no window (All time included), still counts for the tiles
];

describe('careerAggregates — the left column', () => {
  it('most-played hero, 1st-place wins, top-4 %, losses, average placement, favorite tribe', () => {
    const a = careerAggregates(RUNS);
    expect(a.runs).toBe(6);
    expect(a.mostPlayedHero).toBe('brackus');    // 4 of 6
    expect(a.firsts).toBe(1);
    // placements 1, 4, 7, 2, 6 (run 5 has none): top-4 = 3/5 = 60%; losses = the 7th + the 6th = 2 (the
    // unplaced run counts in neither); avg = 20/5 = 4.0
    expect(a.top4Pct).toBe(60);
    expect(a.losses).toBe(2);
    expect(a.avgPlacement).toBe(4);
    expect(a.favoriteTribe).toBe('beast');       // 3 beast vs 2 mech
  });

  it('empties read null / 0 rather than NaN', () => {
    expect(careerAggregates([])).toEqual({ runs: 0, mostPlayedHero: null, firsts: 0, top4Pct: null, losses: 0, avgPlacement: null, favoriteTribe: null });
  });

  it('a hero tie goes to the one played most recently', () => {
    const a = careerAggregates([run({ heroId: 'sable', atMs: NOW }), run({ heroId: 'brackus', atMs: NOW - DAY })]);
    expect(a.mostPlayedHero).toBe('sable');
  });
});

describe('heroCareers — the Heroes tab, folded over EVERY run', () => {
  it('one entry per hero played: games, 1st-place wins, the MATCH record (top-4 W / bottom-4 L) + win rate, avg / best placement, last played', () => {
    const h = heroCareers(RUNS);
    expect(h.map((x) => x.heroId)).toEqual(['brackus', 'sable']); // 4 games vs 2
    const b = h[0]!;
    // brackus: runs 1, 3, 5, 6 → placements 1, 7, —, 6 → matches 1 W – 2 L = 33% (the unplaced run counts in
    // neither), 1 first, avg 14/3 = 4.7, best 1. The fight records (8–2, 2–6, …) play no part.
    expect(b).toMatchObject({ runs: 4, firsts: 1, wins: 1, losses: 2, winRate: 33, avgPlacement: 4.7, bestPlacement: 1 });
    expect(b.lastAtMs).toBe(NOW - 1 * DAY); // the undated run 6 never wins "last played"
    const s = h[1]!;
    // sable: runs 2, 4 → placements 4, 2 → both top 4 = 2 W – 0 L = 100%, 0 firsts, avg 3, best 2
    expect(s).toMatchObject({ runs: 2, firsts: 0, wins: 2, losses: 0, winRate: 100, avgPlacement: 3, bestPlacement: 2 });
    expect(s.lastAtMs).toBe(NOW - 3 * DAY);
  });

  it('a 4th is a win and a 5th a loss regardless of the fight record', () => {
    const h = heroCareers([
      run({ heroId: 'x', placement: 4, wins: 0, losses: 9 }),
      run({ heroId: 'x', placement: 5, wins: 9, losses: 0 }),
    ]);
    expect(h[0]).toMatchObject({ runs: 2, wins: 1, losses: 1, winRate: 50 });
  });

  it('sorts by games played, then match win rate (unknown last), then id; never-played heroes are absent; empties are null', () => {
    const h = heroCareers([
      run({ heroId: 'a', wins: 1, losses: 1, placement: null, atMs: NaN }),
      run({ heroId: 'b', wins: 3, losses: 1, placement: 2 }),
      run({ heroId: 'c', wins: 0, losses: 0, placement: 5 }),
      run({ heroId: '', wins: 9, losses: 0, placement: 1 }), // a malformed row with no hero is skipped
    ]);
    expect(h.map((x) => x.heroId)).toEqual(['b', 'c', 'a']); // 100% · 0% · unknown
    expect(h[0]).toMatchObject({ wins: 1, losses: 0, winRate: 100, avgPlacement: 2, bestPlacement: 2 });
    expect(h[1]).toMatchObject({ wins: 0, losses: 1, winRate: 0, avgPlacement: 5, bestPlacement: 5 });
    expect(h[2]).toMatchObject({ wins: 0, losses: 0, winRate: null, avgPlacement: null, bestPlacement: null });
    expect(Number.isNaN(h[2]!.lastAtMs)).toBe(true);
    expect(heroCareers([])).toEqual([]);
  });
});

describe('trendSeries — the four lines over a window', () => {
  it('7 days: only runs 1 + 2, oldest first, each line a RUNNING mean that ends on the headline; APM skips the run without a recording clock', () => {
    const t = trendSeries(RUNS, 7, NOW);
    // Placements 4 then 1 → running 4 → 2.5; the headline is the window's exact mean.
    expect(t.placement.points.map((p) => p.y)).toEqual([4, 2.5]);
    expect(t.placement.avg).toBe(2.5);
    // Both placed top 4 → the running match win rate is 100 after each; the headline is the window's overall share.
    expect(t.winRate.points.map((p) => p.y)).toEqual([100, 100]);
    expect(t.winRate.avg).toBe(100);
    expect(t.apm.points.map((p) => p.y)).toEqual([20]);           // run 2 has no clock → skipped
    expect(t.apm.avg).toBe(20);
  });

  it('30 days adds run 3; 90 days adds run 4; the 120-day-old and the undated runs are never in a window', () => {
    const t30 = trendSeries(RUNS, 30, NOW);
    // Placements 7, 4, 1 → running 7 → 5.5 → 4 (avg 4); APM 30, 20 → 30 → 25 (avg 25).
    expect(t30.placement.points.map((p) => p.y)).toEqual([7, 5.5, 4]);
    expect(t30.placement.avg).toBe(4);
    expect(t30.apm.points.map((p) => p.y)).toEqual([30, 25]);
    expect(t30.apm.avg).toBe(25);
    // 7th (L) → 4th (W) → 1st (W): running 0 → 50 → 67; overall 2 of 3 = 67%.
    expect(t30.winRate.points.map((p) => p.y)).toEqual([0, 50, 67]);
    expect(t30.winRate.avg).toBe(67);
    const t90 = trendSeries(RUNS, 90, NOW);
    // Placements 2, 7, 4, 1 → running 2 → 4.5 → 4.3 → 3.5; APM 20, 30, 20 → 20 → 25 → 23.3.
    expect(t90.placement.points.map((p) => p.y)).toEqual([2, 4.5, 4.3, 3.5]);
    expect(t90.placement.avg).toBe(3.5);
    expect(t90.apm.points.map((p) => p.y)).toEqual([20, 25, 23.3]);
    expect(t90.apm.avg).toBe(23.3);
    // 2nd (W) → 7th (L) → 4th (W) → 1st (W): running 100 → 50 → 67 → 75; overall 3 of 4 = 75%.
    expect(t90.winRate.points.map((p) => p.y)).toEqual([100, 50, 67, 75]);
    expect(t90.winRate.avg).toBe(75);
  });

  it('Win Rate is the MATCH win rate — the share of placed runs finishing top 4 — never the fight record; an unplaced run contributes no point', () => {
    const t = trendSeries([
      run({ atMs: NOW, placement: null, wins: 9, losses: 0 }),          // no placement → no point, whatever the fights
      run({ atMs: NOW - DAY, placement: 5, wins: 8, losses: 1 }),       // a 5th is a LOSS even at 8–1 in fights
      run({ atMs: NOW - 2 * DAY, placement: 4, wins: 1, losses: 7 }),   // a 4th is a WIN even at 1–7
    ], 7, NOW);
    expect(t.winRate.points.map((p) => p.y)).toEqual([100, 50]);
    expect(t.winRate.avg).toBe(50);
    const none = trendSeries([run({ atMs: NOW, placement: null })], 7, NOW);
    expect(none.winRate).toEqual({ points: [], avg: null });
  });

  it('every series is smoothed: a point is the running mean so far, never the per-run value — a 1↔8 saw-tooth reads as a settling line', () => {
    const t = trendSeries([1, 8, 1, 8].map((placement, i) => run({ id: i, placement, atMs: NOW - (3 - i) * DAY })), 7, NOW);
    expect(t.placement.points.map((p) => p.y)).toEqual([1, 4.5, 3.3, 4.5]);
    expect(t.placement.avg).toBe(4.5);
    expect(t.placement.points.at(-1)!.y).toBe(t.placement.avg); // the line ends on the headline
    expect(t.winRate.points.map((p) => p.y)).toEqual([100, 50, 67, 50]);
    expect(t.winRate.avg).toBe(50);
  });

  it('MMR is plotted RAW — the rating after each rated run, oldest first, never a running mean; the headline is the LATEST rating; a run the stamp missed contributes no point', () => {
    // 7d: run 2 (3 days ago) carries no rating → only run 1's 110.
    const t7 = trendSeries(RUNS, 7, NOW);
    expect(t7.mmr.points.map((p) => p.y)).toEqual([110]);
    expect(t7.mmr.avg).toBe(110);
    // 30d: 86 → 110, each the actual rating (a running mean would have drawn 86 → 98, a number never held).
    const t30 = trendSeries(RUNS, 30, NOW);
    expect(t30.mmr.points.map((p) => p.y)).toEqual([86, 110]);
    expect(t30.mmr.points.map((p) => p.atMs)).toEqual([NOW - 10 * DAY, NOW - 1 * DAY]);
    expect(t30.mmr.avg).toBe(110);
    // 90d: 46 → 86 → 110; the headline is where the line ENDS, not the window's mean (which would be 81).
    const t90 = trendSeries(RUNS, 90, NOW);
    expect(t90.mmr.points.map((p) => p.y)).toEqual([46, 86, 110]);
    expect(t90.mmr.avg).toBe(110);
    expect(t90.mmr.avg).toBe(t90.mmr.points.at(-1)!.y);
  });

  it('a season reset inside the window is drawn as the drop it is; the Bronze I floor (0 → 0 → 0) plots as real points; no rated run at all → an empty series, never a line of zeros', () => {
    const reset = trendSeries([
      run({ id: 1, atMs: NOW - 1 * DAY, ratingAfter: 16 }),
      run({ id: 2, atMs: NOW - 2 * DAY, ratingAfter: 0 }),
      run({ id: 3, atMs: NOW - 3 * DAY, ratingAfter: 0 }),
      run({ id: 4, atMs: NOW - 4 * DAY, ratingAfter: 0 }),    // the new season's restart at Bronze I 0
      run({ id: 5, atMs: NOW - 5 * DAY, ratingAfter: 1234 }), // last season's Diamond
    ], 7, NOW);
    expect(reset.mmr.points.map((p) => p.y)).toEqual([1234, 0, 0, 0, 16]);
    expect(reset.mmr.avg).toBe(16);
    const none = trendSeries([run({ atMs: NOW, ratingAfter: null }), run({ atMs: NOW - DAY, ratingAfter: null })], 7, NOW);
    expect(none.mmr).toEqual({ points: [], avg: null });
    // A non-integer legacy value prints as a whole number.
    expect(trendSeries([run({ atMs: NOW, ratingAfter: 1187.6 })], 7, NOW).mmr.avg).toBe(1188);
  });

  it('All time has NO lower bound: every dated run counts (the 120-day-old run joins), the undated run still never does; the day windows keep their numbers', () => {
    const all = trendSeries(RUNS, 'all', NOW);
    expect(all.mmr.points.map((p) => p.y)).toEqual([0, 46, 86, 110]); // run 5's real 0 leads; run 6 (undated, 500) is absent
    expect(all.mmr.avg).toBe(110);
    // Run 5 has no placement, APT or clock, so the three rate series read exactly as they do at 90d.
    expect(all.placement.points.map((p) => p.y)).toEqual([2, 4.5, 4.3, 3.5]);
    expect(all.placement.avg).toBe(3.5);
    expect(all.winRate.avg).toBe(75);
    expect(all.apm.avg).toBe(23.3);
    // With placed runs from years back the bound really is absent: 100, 400 and 3000 days ago are all in.
    const old = [
      run({ id: 1, atMs: NOW - 1 * DAY, placement: 1 }),
      run({ id: 2, atMs: NOW - 100 * DAY, placement: 3 }),
      run({ id: 3, atMs: NOW - 400 * DAY, placement: 5 }),
      run({ id: 4, atMs: NOW - 3000 * DAY, placement: 7 }),
      run({ id: 5, atMs: NaN, placement: 8 }),
    ];
    expect(trendSeries(old, 'all', NOW).placement.points.map((p) => p.y)).toEqual([7, 6, 5, 4]); // 7 → 12/2 → 15/3 → 16/4
    expect(trendSeries(old, 'all', NOW).placement.avg).toBe(4);
    expect(trendSeries(old, 90, NOW).placement.points.map((p) => p.y)).toEqual([1]);
    // A run dated in the future (a skewed clock) stays out of All time too, as it does of every window.
    expect(trendSeries([run({ atMs: NOW + DAY, placement: 1 })], 'all', NOW).placement.points).toEqual([]);
  });

  it('an empty window yields empty series with null averages', () => {
    const t = trendSeries(RUNS, 7, NOW + 400 * DAY);
    expect(t.placement).toEqual({ points: [], avg: null });
    expect(t.apm).toEqual({ points: [], avg: null });
    expect(t.mmr).toEqual({ points: [], avg: null });
  });
});

describe('the trend window tabs + the MMR axis', () => {
  it('the windows are 7 / 30 / 90 days and All time, labelled "7d" … "All time"', () => {
    expect(TREND_WINDOWS).toEqual([7, 30, 90, 'all']);
    expect(TREND_WINDOWS.map(trendWindowLabel)).toEqual(['7d', '30d', '90d', 'All time']);
  });

  it('the MMR axis snaps to whole 100-point divisions: at least one tall, a rating on a promotion gate never on an edge, 0 the floor, a reset widens down to 0', () => {
    const s = (ys: number[]): TrendSeries => ({ points: ys.map((y, i) => ({ atMs: i, y })), avg: ys.at(-1) ?? null });
    expect(mmrAxisOf(s([]))).toEqual({ yMin: 0, yMax: 100 });
    expect(mmrAxisOf(s([0, 0, 0]))).toEqual({ yMin: 0, yMax: 100 });        // the Bronze I floor rows
    expect(mmrAxisOf(s([40, 46]))).toEqual({ yMin: 0, yMax: 100 });         // a wobble inside one division is not inflated
    expect(mmrAxisOf(s([86, 100, 110]))).toEqual({ yMin: 0, yMax: 200 });   // the gate at 100 sits on the middle grid line
    expect(mmrAxisOf(s([100]))).toEqual({ yMin: 0, yMax: 200 });
    expect(mmrAxisOf(s([1201, 1234]))).toEqual({ yMin: 1200, yMax: 1300 }); // Diamond reads within its own division
    expect(mmrAxisOf(s([1200, 1234]))).toEqual({ yMin: 1100, yMax: 1300 });
    expect(mmrAxisOf(s([1234, 0, 16]))).toEqual({ yMin: 0, yMax: 1300 });   // a season reset inside the window
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
