import { beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import {
  STRENGTH_REF_VERSION, createStrengthProbe, loadStrengthReference, parseBoardStrength, pctFromCounts, percentileOf,
  referenceWaveOf, runAverageOf, runPercentileOf, runStrengthFromScores, scoreBoard, type StrengthReference, type StrengthScore,
} from './boardStrength';

/**
 * BOARD STRENGTH (R-LOBBY-09, owner 2026-09-30): "72 would basically mean like... a 72/100 aka 72nd percentile".
 * The raw score is a deterministic win rate against the committed reference set; the percentile is its place among
 * the pool's boards at the same wave. The SQL copy of the percentile is pinned in boardStrength.db.test.ts.
 */

let ref: StrengthReference;
beforeAll(async () => { ref = await loadStrengthReference(); });

/** A real reference board of wave `w` (index i), re-labelled as a board being scored. */
const boardOf = (w: number, i: number): BoardSnapshot => ({ ...ref.waves[String(w)]![i]!, wave: w, setId: ref.setId } as BoardSnapshot);
/** The same board with every minion stronger. */
const buffed = (b: BoardSnapshot, n: number): BoardSnapshot => ({ ...b, minions: b.minions.map((m) => ({ ...m, attack: m.attack + n, health: m.health + n })) });

describe('the committed reference set', () => {
  it('is version set2-v1: 30 boards per wave (fewer only where the pool had fewer), waves 1 to 15', () => {
    expect(ref.version).toBe(STRENGTH_REF_VERSION);
    expect(ref.setId).toBe('set2');
    expect(ref.fightsPerRef).toBe(2);
    const waves = Object.keys(ref.waves).map(Number).sort((a, b) => a - b);
    expect(waves[0]).toBe(1);
    for (const w of waves) {
      expect(ref.waves[String(w)]!.length, `wave ${w}`).toBeGreaterThanOrEqual(20);
      expect(ref.waves[String(w)]!.length, `wave ${w}`).toBeLessThanOrEqual(30);
      for (const b of ref.waves[String(w)]!) expect(b.minions.length).toBeGreaterThan(0);
    }
  });

  it('a board past the last reference wave is scored against the last one', () => {
    const last = Math.max(...Object.keys(ref.waves).map(Number));
    expect(referenceWaveOf(ref, last + 5)).toBe(last);
    expect(referenceWaveOf(ref, 1)).toBe(1);
    expect(referenceWaveOf({ waves: { '3': [] } }, 5)).toBeNull();
  });
});

describe('scoring', () => {
  it('is deterministic: the same board scores the same, however the work is sliced', () => {
    const b = boardOf(8, 12);
    const once = scoreBoard(b, ref)!;
    expect(once.fights).toBe(ref.waves['8']!.length * 2);
    expect(scoreBoard(b, ref)).toEqual(once);
    const sliced = createStrengthProbe(b, ref);
    let steps = 0;
    while (!sliced.step(3)) steps++;
    expect(steps).toBeGreaterThan(10);
    expect(sliced.result()).toEqual(once);
    expect(once.ref).toBe(STRENGTH_REF_VERSION);
    expect(once.raw).toBeGreaterThanOrEqual(0);
    expect(once.raw).toBeLessThanOrEqual(1);
  });

  it('a strictly stronger board scores at least as high (monotonic sanity, on many boards and waves)', () => {
    // The fights are seeded, not scripted: a buffed minion survives a hit it used to die to, the random targets after
    // that differ, and a single fight can flip either way. So one board's +N/+N copy may lose a fight or two of noise
    // (one fight is 1/60), and across boards buffs only ever help, more the bigger they are. (Measured while writing
    // this: the wave-13 Indy board with DOUBLED stats loses to its own original 163-129 over 300 seeds, so "more
    // stats" is not always "stronger" in this game; flat +N/+N is the honest notion of a strictly stronger board.)
    const noise = 2 / 60;
    let sumBase = 0; let sumUp = 0; let sumWay = 0;
    for (const w of [2, 5, 9, 13]) {
      for (const i of [0, 7, 15, 29]) {
        const b = boardOf(w, Math.min(i, ref.waves[String(w)]!.length - 1));
        const base = scoreBoard(b, ref)!.raw;
        const up = scoreBoard(buffed(b, 3), ref)!.raw;
        const way = scoreBoard(buffed(b, 40), ref)!.raw;
        expect(up, `wave ${w} board ${i}: +3/+3`).toBeGreaterThanOrEqual(base - noise);
        expect(way, `wave ${w} board ${i}: +40/+40`).toBeGreaterThanOrEqual(Math.max(base, up) - noise);
        sumBase += base; sumUp += up; sumWay += way;
      }
    }
    expect(sumUp).toBeGreaterThan(sumBase);
    expect(sumWay).toBeGreaterThan(sumUp);
  });

  it('the reference spans weak to strong: its weakest board scores well below its strongest', () => {
    const refs = ref.waves['6']!;
    expect(scoreBoard(boardOf(6, 0), ref)!.raw).toBeLessThan(scoreBoard(boardOf(6, refs.length - 1), ref)!.raw);
  });

  it('cannot score a board of another set, an empty board, or a wave with no reference', () => {
    expect(scoreBoard({ ...boardOf(4, 3), setId: 'set1' }, ref)).toBeNull();
    expect(scoreBoard({ ...boardOf(4, 3), minions: [] }, ref)).toBeNull();
    expect(scoreBoard(boardOf(4, 3), { ...ref, waves: {} })).toBeNull();
  });
});

describe('the percentile', () => {
  it('is the share of the wave it beats, ties half, 1..100 (worked examples)', () => {
    // 10 boards at the wave: 0.1 .. 1.0. A new 0.55 beats five of them: (5 + 0.5) / 11 = 50.
    const hist = Array.from({ length: 10 }, (_, i) => ({ raw: (i + 1) / 10, count: 1 }));
    expect(percentileOf(0.55, hist)).toBe(50);
    expect(percentileOf(0.05, hist)).toBe(5); // (0 + 0.5) / 11 -> 4.5 -> 5 (half up)
    expect(percentileOf(2, hist)).toBe(95); // (10 + 0.5) / 11 = 95.45
    expect(percentileOf(0.5, [{ raw: 0.5, count: 3 }])).toBe(50); // all tied
    expect(percentileOf(0.3, [])).toBe(50); // alone
    expect(percentileOf(0.3, [], false)).toBeNull(); // nothing to compare against
    // Exactly the 72nd percentile: beats 72 of 100 (the owner's example), counting itself as a tie of one.
    expect(pctFromCounts(72, 0, 100)).toBe(72);
    expect(pctFromCounts(0, 1, 1000)).toBe(1); // clamped up to 1
    expect(pctFromCounts(999, 1, 1000)).toBe(100);
  });

  it('rounds exactly (integer arithmetic): x.5 goes up, never lost to floating point', () => {
    for (let n = 1; n <= 300; n++) {
      for (const [below, equal] of [[0, 1], [Math.floor(n / 2), 1], [n - 1, 1], [Math.floor(n / 3), 2]] as const) {
        if (below + equal > n) continue;
        const exact = (200 * below + 100 * equal) / (2 * n);
        const want = Math.min(100, Math.max(1, Math.floor(exact + 0.5 + 1e-9)));
        expect(pctFromCounts(below, equal, n), `${below}/${equal}/${n}`).toBe(want);
      }
    }
  });

  it("a run's average is the mean of its rounds, rounded", () => {
    expect(runAverageOf([50, 60, 71])).toBe(60);
    expect(runAverageOf([10, 11])).toBe(11); // 10.5 -> 11
    expect(runAverageOf([null, undefined])).toBeNull();
  });

  it("a run's strength is its average RANKED among the runs (owner-approved 2026-09-30): averages near 50 spread to 1-100", () => {
    // 100 runs whose averages all sit between 35 and 64 (the squeeze toward 50): ranked, they span the whole scale,
    // and each band holds its nominal share.
    const runs = Array.from({ length: 30 }, (_, i) => ({ avg: 35 + i, count: i % 3 === 0 ? 4 : 3 }));
    const n = runs.reduce((a, r) => a + r.count, 0);
    expect(n).toBe(100);
    const pct = runs.map((r) => ({ ...r, pct: runPercentileOf(r.avg, runs.map((x) => (x.avg === r.avg ? { ...x, count: x.count - 1 } : x)))! }));
    expect(Math.min(...pct.map((p) => p.pct))).toBeLessThanOrEqual(3);
    expect(Math.max(...pct.map((p) => p.pct))).toBeGreaterThanOrEqual(97);
    const share = (lo: number, hi: number): number => pct.filter((p) => p.pct >= lo && p.pct <= hi).reduce((a, p) => a + p.count, 0) / n;
    expect(share(0, 30)).toBeGreaterThan(0.25); expect(share(0, 30)).toBeLessThan(0.35);
    expect(share(10, 40)).toBeGreaterThan(0.25); expect(share(10, 40)).toBeLessThan(0.36);
    expect(share(20, 65)).toBeGreaterThan(0.40); expect(share(20, 65)).toBeLessThan(0.51);
    // Worked example: beats 72 of 99 others, alone at its average -> (72 + 0.5) / 100 = 72.5 -> 73.
    expect(runPercentileOf(60, [{ avg: 40, count: 72 }, { avg: 80, count: 27 }])).toBe(73);
    expect(runPercentileOf(60, [], false)).toBeNull();
  });

  it("the player's own rounds are placed against the pool's boards, and the run against the pool's runs", () => {
    const score = (wave: number, raw: number): StrengthScore => ({ raw, wave, ref: STRENGTH_REF_VERSION, fights: 60 });
    const hist = { '1': [{ raw: 0.2, count: 3 }, { raw: 0.8, count: 1 }], '2': [{ raw: 0.5, count: 4 }] };
    const runs = [{ avg: 40, count: 5 }, { avg: 80, count: 2 }, { avg: 90, count: 2 }];
    const out = runStrengthFromScores([[2, score(2, 0.9)], [1, score(1, 0.5)], [3, score(3, 0.5)]], hist, runs)!;
    expect(out.rounds).toEqual([{ round: 1, value: 70 }, { round: 2, value: 90 }]); // round 3: no pool boards yet
    expect(out.average).toBe(80);
    expect(out.value).toBe(65); // (5 below + (2 + itself) / 2) / 10 = 6.5 / 10
    // No run histogram yet: the rounds stand, the run has no strength (nothing is shown for it).
    expect(runStrengthFromScores([[1, score(1, 0.5)]], hist, null)!.value).toBeNull();
    expect(runStrengthFromScores([[1, score(1, 0.5)]], null, runs)).toBeNull();
    expect(runStrengthFromScores([[1, { ...score(1, 0.5), ref: 'old' }]], hist, runs)!.value).toBeNull();
  });

  it('reads a stored strength back, or null', () => {
    expect(parseBoardStrength(72)).toBe(72);
    expect(parseBoardStrength('72')).toBe(72);
    for (const bad of [0, 101, null, undefined, '', 'x', NaN, {}]) expect(parseBoardStrength(bad)).toBeNull();
  });
});
