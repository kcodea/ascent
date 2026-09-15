/**
 * `balance:gap` — the pilot ↔ players measuring stick, on the hermetic pinned fixture: three greedy pinned lobbies
 * against the nine-run fixture corpus, measured against the SAME fixture as the corpus file.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CorpusFile } from './corpus';
import { computeGap, corpusBoards, percentile, renderGap, verdictOf, type GapReport } from './gap';
import { NOOP_RECORDER, PINNED_FIXTURE_SHUFFLED, pilotFor, registerOpponents, runPinnedLobby, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord } from './deps';

const identity: ExperimentIdentity = { schemaVersion: 1, engineRevision: 'test', dirtyDigest: '', contentDigest: '', poolDigest: '', effectDigest: '', manifestDigest: '' };
const manifest: ExperimentManifest = {
  schemaVersion: 1, name: 'pinned gap', mode: 'pinnedLobby', setId: 'set2',
  policy: { id: 'greedy', budget: { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 } },
  seeds: { start: 1, count: 3 }, corpus: { name: 'fixture', digest: 'fixture' }, fightRules: 'shipped',
};
const corpus: CorpusFile = { schemaVersion: 1, name: 'fixture', setId: 'set2', fetchedAt: 'test', digest: 'fixture', patches: {}, boards: PINNED_FIXTURE_SHUFFLED, runs: 9, authors: 9 };

describe('the pass line', () => {
  it('reads the owner’s scale: < 4.0 pass, < 3.0 strong, < 2.0 phenomenal', () => {
    expect(verdictOf(undefined)).toBe('unmeasured');
    expect(verdictOf(1.9)).toBe('phenomenal');
    expect(verdictOf(2.0)).toBe('strong');
    expect(verdictOf(3.99)).toBe('pass');
    expect(verdictOf(4.0)).toBe('fail');
    expect(verdictOf(6.8)).toBe('fail');
  });
  it('percentile is nearest-rank', () => {
    expect(percentile([], 0.8)).toBeUndefined();
    expect(percentile([1, 2, 3, 4, 5], 0.8)).toBe(4);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.8)).toBe(8);
    expect(percentile([7], 0.5)).toBe(7);
  });
});

describe('the corpus side', () => {
  it('groups boards into runs by author | hero | seed, one board per run-wave', () => {
    const c = corpusBoards(corpus);
    expect(c.runs).toBe(9);
    expect(c.authors).toBe(9);
    expect(c.boards).toHaveLength(9 * 14);
    expect(c.maxWave).toBe(14);
    // A duplicate upload of one wave collapses.
    const dup = corpusBoards({ boards: [...corpus.boards, corpus.boards[0]!] });
    expect(dup.boards).toHaveLength(9 * 14);
  });
});

describe('the gap report on pinned fixture lobbies', () => {
  let records: LobbyRecord[]; let g: GapReport;
  beforeAll(() => {
    registerOpponents(PINNED_FIXTURE_SHUFFLED);
    records = [1, 2, 3].map((seed) => runPinnedLobby(manifest, seed, pilotFor('greedy'), NOOP_RECORDER, identity));
    g = computeGap('fixture-job', records, corpus, { bootstrapReps: 200 });
  });

  it('tabulates PILOT rounds only, one board per pilot round, and the corpus per wave', () => {
    expect(g.policyIds).toEqual(['greedy']);
    expect(g.pilot.lobbies).toBe(3);
    expect(g.pilot.placed).toBe(3);
    expect(g.pilot.failed).toBe(0);
    const pilotRounds = records.flatMap((r) => r.rounds).filter((r) => r.seatId === 's0').length;
    expect(g.pilot.boards).toBe(pilotRounds);
    expect(g.waves).toHaveLength(16);
    expect(g.waves.reduce((n, w) => n + w.pilot.n, 0)).toBe(pilotRounds);
    // Every fixture run fields a board at waves 1..14; none at 15..16.
    for (const w of g.waves) expect(w.corpus.n).toBe(w.wave <= 14 ? 9 : 0);
    expect(g.waves[14]!.corpus.statMedian).toBeUndefined();
  });

  it('measures the fixture boards by the same function as the pilot’s (stat total, minions, goldens, tier, tribe)', () => {
    // Fixture wave w: min(7, w) Spellswords of (3+2w+4i)/(4+2w+3i) — the median run is i = 4.
    const w5 = g.waves[4]!.corpus;
    expect(w5.minions).toBe(5);
    expect(w5.goldens).toBe(0);
    expect(w5.tier).toBe(Math.min(6, 1 + Math.floor(5 / 3)));
    expect(w5.statMedian).toBe(5 * ((3 + 10 + 16) + (4 + 10 + 12)));
    // Spellsword is neutral: no tribe share.
    expect(w5.largestTribeShare).toBe(0);
    // Growth is the ratio of successive medians; undefined at wave 1.
    expect(g.waves[0]!.corpus.growth).toBeUndefined();
    expect(g.waves[4]!.corpus.growth).toBeCloseTo(g.waves[4]!.corpus.statMedian! / g.waves[3]!.corpus.statMedian!, 9);
    // The pilot's side: a real served board with real stats.
    const w1 = g.waves[0]!.pilot;
    expect(w1.n).toBe(3);
    expect(w1.statMedian).toBeGreaterThan(0);
  });

  it('placement: histogram, lobby-level CI, firsts / top-3, and the verdict against the bar', () => {
    const p = g.placement;
    expect(p.n).toBe(3);
    expect(p.histogram.reduce((a, b) => a + b, 0)).toBe(3);
    expect(p.mean.est).toBeCloseTo(records.reduce((a, r) => a + r.seats.find((s) => s.seatId === 's0')!.placement!, 0) / 3, 9);
    expect(p.mean.lobbies).toBe(3);
    expect(p.firsts).toBe(p.histogram[0]);
    expect(p.top3).toBe(p.histogram[0]! + p.histogram[1]! + p.histogram[2]!);
    expect(p.verdict).toBe(verdictOf(p.mean.est));
    expect(p.line).toEqual({ pass: 4, strong: 3, phenomenal: 2 });
  });

  it('card frequency at wave ≥ 10 is a share of boards, side by side', () => {
    const late = computeGap('fixture-job', records, corpus, { bootstrapReps: 50, cardWaveMin: 3 });
    expect(late.cards.corpusBoards).toBe(9 * 12);
    const sword = late.cards.corpusTop.find((r) => r.cardId === 'n2_spellsword');
    expect(sword).toBeDefined();
    expect(sword!.corpusShare).toBe(1);
    expect(sword!.corpusBoards).toBe(9 * 12);
    expect(late.cards.corpusTop).toHaveLength(1);
    expect(late.cards.pilotTop.length).toBeLessThanOrEqual(25);
  });

  it('renders markdown with every section, and json round-trips', () => {
    const md = renderGap(g, { format: 'md' });
    for (const h of ['## Placement', '## Board shape by wave', '## Growth multiplier', '## Card frequency', 'Pass line']) expect(md).toContain(h);
    expect(md).toContain('| 1 | 3 / 9 |');
    const json = JSON.parse(renderGap(g, { format: 'json' })) as GapReport;
    expect(json.placement.verdict).toBe(g.placement.verdict);
    expect(json.waves).toHaveLength(16);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(computeGap('fixture-job', records, corpus, { bootstrapReps: 200 }))).toBe(JSON.stringify(g));
  });
});
