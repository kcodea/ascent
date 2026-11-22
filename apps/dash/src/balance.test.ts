import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, EVIDENCE_GATES, WELCH_MIN_N, evidenceOf, itemOf, renderBalance, rowsFor, verdictOf, welch, type CardMeta, type Item } from './balance';
import { fixtureBalance } from './fixture2';
import type { Ctx } from './sections';
import type { BalanceData, BalanceRow } from './types';

/**
 * The dev balance view keeps the in-game Balance Report's honesty (owner ruling 2026-09-22): equal-access comparisons,
 * the report's evidence gates (10 a side + 3 players = Candidate, 20 + 5 = Supported), Welch only from 5 a side, and the
 * v2 wording ("1.1 better" / "0.6 worse" / "no clear difference" / "insufficient comparable data").
 */
const item = (o: Partial<Item>): Item => ({
  id: 'x', seen: 0, taken: 0, takenPlayers: 0, takenAvg: null, takenVar: null, takenTop4: null, passed: 0, passedPlayers: 0, passedAvg: null, passedVar: null,
  finalN: 0, finalAvg: null, finalGolden: 0, series: [], ...o,
});

describe('the report gates and words', () => {
  it('keeps the report thresholds', () => {
    expect(WELCH_MIN_N).toBe(5);
    expect(EVIDENCE_GATES).toEqual({ candidate: { n: 10, players: 3 }, supported: { n: 20, players: 5 } });
  });
  it('evidence needs the runs AND the players on both sides', () => {
    expect(evidenceOf({ taken: 30, passed: 30, takenPlayers: 6, passedPlayers: 6 })).toBe('supported');
    expect(evidenceOf({ taken: 30, passed: 30, takenPlayers: 2, passedPlayers: 9 })).toBe('insufficient');
    expect(evidenceOf({ taken: 12, passed: 40, takenPlayers: 4, passedPlayers: 9 })).toBe('candidate');
  });
  it('Welch: none under 5 a side; positive = takers finished higher', () => {
    expect(welch(item({ taken: 4, passed: 50, takenAvg: 3, passedAvg: 5 }))).toBeNull();
    const w = welch(item({ taken: 40, passed: 40, takenAvg: 3, passedAvg: 5, takenVar: 4, passedVar: 4 }))!;
    expect(w.diff).toBe(2);
    expect(w.lo).toBeGreaterThan(0);
  });
  it('words: better / worse only with evidence and an interval clear of zero', () => {
    const strong = { taken: 40, passed: 40, takenPlayers: 8, passedPlayers: 8, takenVar: 4, passedVar: 4 };
    expect(verdictOf(item({ ...strong, takenAvg: 3.9, passedAvg: 5 })).text).toBe('1.1 better');
    expect(verdictOf(item({ ...strong, takenAvg: 5.6, passedAvg: 5 })).text).toBe('no clear difference'); // the interval (±0.88) crosses zero
    expect(verdictOf(item({ ...strong, takenVar: 1, passedVar: 1, takenAvg: 5.6, passedAvg: 5 })).text).toBe('0.6 worse');
    expect(verdictOf(item({ ...strong, takenAvg: 4.9, passedAvg: 5 })).text).toBe('no clear difference');
    expect(verdictOf(item({ ...strong, takenPlayers: 1, takenAvg: 2, passedAvg: 6 })).text).toBe('no clear difference'); // one player is not evidence
    expect(verdictOf(item({ taken: 9, passed: 0, takenAvg: 2 })).text).toBe('insufficient comparable data');
  });
});

const cards: Record<string, CardMeta> = {
  m1: { name: 'Alpha', tier: 1, tribe: 'kobold', spell: false, art: null },
  m2: { name: 'Beta', tier: 3, tribe: 'dragon', tribe2: 'kobold', spell: false, art: null },
  s1: { name: 'Zap', tier: 2, tribe: 'neutral', spell: true, art: null },
};
const r = (id: string, taken: number, passed: number, avg = 4): BalanceRow => [id, taken + passed, taken, 3, avg, 4, 0.5, passed, 3, 4.5, 4, 2, 4, 0, null];
const data = (): BalanceData => ({
  tz: 'UTC', from: '2026-11-01', to: '2026-11-22', trendBucket: 'week', mode: 'ranked', set: null, games: 10, runs: 10,
  field: { n: 10, avg: 4.5, var: 5, top4: 0.5 }, trends: {}, items: { card: [r('m1', 30, 20, 3), r('m2', 8, 4), r('s1', 12, 12), r('gone', 40, 1)], rune: [r('rune_a', 15, 30)] },
});

describe('rowsFor', () => {
  it('splits minions from spells, filters tribe / tier / sample / set, and sorts', () => {
    const f = { ...DEFAULT_FILTER, min: 1 };
    expect(rowsFor(data(), f, cards, null).map((i) => i.id)).toEqual(['gone', 'm1', 'm2']); // an unknown id shows only with no set chosen
    expect(rowsFor(data(), { ...f, view: 'spells' }, cards, null).map((i) => i.id)).toEqual(['s1']);
    expect(rowsFor(data(), { ...f, tribe: 'kobold' }, cards, ['m1', 'm2']).map((i) => i.id)).toEqual(['m1', 'm2']); // tribe2 counts
    expect(rowsFor(data(), { ...f, tier: 3 }, cards, ['m1', 'm2']).map((i) => i.id)).toEqual(['m2']);
    expect(rowsFor(data(), { ...f, min: 20 }, cards, ['m1', 'm2']).map((i) => i.id)).toEqual(['m1']);
    expect(rowsFor(data(), { ...f, sort: 'name', dir: 1 }, cards, ['m1', 'm2']).map((i) => i.id)).toEqual(['m1', 'm2']);
    expect(rowsFor(data(), { ...f, view: 'runes' }, cards, null).map((i) => i.id)).toEqual(['rune_a']);
  });
  it('decodes the compact row', () => {
    expect(itemOf(['m1', 10, 6, 3, 3.5, 4, 0.5, 4, 2, 5, 4, 2, 3, 1, [['2026-11-17', 6, 3.5]]])).toMatchObject({ id: 'm1', taken: 6, passed: 4, finalGolden: 1, series: [{ t: '2026-11-17', games: 6, avgPlacement: 3.5 }] });
  });
});

describe('renderBalance', () => {
  const ctx: Ctx = { game: null, names: { runes: {}, ancients: {}, achievements: {}, cosmetics: {}, titles: {}, cards, setCards: { set2: ['m1', 'm2', 's1'] }, sets: { set2: { name: 'Set 2', enabled: true } } },
    heroCell: (id) => id, tribeCell: (id) => id, img: (s) => `<img src="${s}">`, chartWidth: 900 };
  it('says plainly it is association, not causation, with honest labels and no inline styles', () => {
    for (const view of ['heroes', 'tribes', 'ancients', 'minions', 'spells', 'runes'] as const) {
      const html = renderBalance(fixtureBalance({ from: '2026-11-01', to: '2026-11-22' }, new Date('2026-11-22T12:00:00Z'), { heroes: ['warden'], tribes: ['kobold'], runes: ['rune_a'], ancients: ['death'], achievements: [], cosmetics: [], titles: [], cards: ['m1', 'm2', 's1'] }),
        ctx, { ...DEFAULT_FILTER, view, min: 1 }, { set: 'set2', liveSet: 'set2' });
      expect(html, view).toContain('Association, not causation.');
      expect(html, view).not.toMatch(/\sstyle=/);
      expect(html, view).not.toMatch(/win rate|impact/i);
    }
  });
  it('labels the card comparison as a raw association at equal access and marks thin evidence', () => {
    const html = renderBalance(data(), ctx, { ...DEFAULT_FILTER, min: 1 }, { set: '', liveSet: 'set2' });
    expect(html).toContain('Raw association at equal access');
    expect(html).toContain('Insufficient evidence');
    expect(html).toContain('On final board');
  });
});
