import { beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import {
  STRENGTH_REF_VERSION, createStrengthProbe, loadStrengthReference, parseBoardStrength, pctFromCounts, percentileOf,
  referenceWaveOf, runAverageOf, runFinalStrengthOf, finalFromSum, runPercentileOf, runStrengthFromScores, runWeightedAverageOf, scoreBoard, strengthRoundGroup,
  RUN_STRENGTH_FORMULA,
  STRENGTH_ROUND_GROUPS, weightedAvgFromGroups, type StrengthReference, type StrengthScore,
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

  it("a run's average weighs its rounds by group: 1-5 share 20%, 6-9 share 35%, 10+ share 45% (owner 2026-09-30)", () => {
    expect(STRENGTH_ROUND_GROUPS.map((g) => g.weight)).toEqual([20, 35, 45]);
    expect([1, 5, 6, 9, 10, 18].map(strengthRoundGroup)).toEqual([0, 0, 1, 1, 2, 2]);
    const run = (vals: [number, number][]): number | null => runWeightedAverageOf(vals.map(([round, value]) => ({ round, value })));
    // A full run, flat inside each group: 0.2 * 20 + 0.35 * 50 + 0.45 * 80 = 57.5 -> 58 (the plain mean of 5x20,
    // 4x50, 2x80 would be 41.8).
    const full: [number, number][] = [[1, 20], [2, 20], [3, 20], [4, 20], [5, 20], [6, 50], [7, 50], [8, 50], [9, 50], [10, 80], [11, 80]];
    expect(run(full)).toBe(58);
    expect(runAverageOf(full.map((r) => r[1]))).toBe(42);
    // Inside a group the share splits evenly: round 10 = 60, round 11 = 100 -> the group is 80, same answer.
    expect(run([...full.slice(0, 9), [10, 60], [11, 100]])).toBe(58);
    // Renormalised over the groups a run has: ended in round 8 -> 20/55 * 20 + 35/55 * 50 = 39.09 -> 39.
    expect(run(full.slice(0, 8))).toBe(39);
    // Only early rounds: just their mean. Only late rounds: just theirs.
    expect(run([[1, 10], [2, 11]])).toBe(11);
    expect(run([[12, 70]])).toBe(70);
    // A slow start with a late spike rises above its plain mean; a fast start that fades falls below it.
    const slow: [number, number][] = [[1, 10], [2, 10], [3, 10], [4, 10], [5, 10], [6, 40], [7, 40], [8, 40], [9, 40], [10, 90]];
    expect(run(slow)).toBeGreaterThan(runAverageOf(slow.map((r) => r[1]))!);
    expect(run(slow.map(([r, v]) => [r, 100 - v]))).toBeLessThan(runAverageOf(slow.map((r) => 100 - r[1]))!);
    // A duplicate board for a round counts twice inside its group (the plain average's convention): 1-5 = (20 + 40 + 40) / 3.
    expect(run([[1, 20], [2, 40], [2, 40]])).toBe(33);
    // Unscored rounds are skipped; nothing scored -> null.
    expect(runWeightedAverageOf([{ round: 1, value: null }, { round: 7, value: undefined }])).toBeNull();
    expect(run([])).toBeNull();
  });

  it('the weighted average rounds exactly (integer arithmetic): x.5 goes up', () => {
    // 20 * 50 + 35 * 51 over 55 = 50.636 -> 51; (20 * 1 + 35 * 2 + 45 * 1) / 100 = 1.35 -> 1; 0.5 boundaries:
    expect(weightedAvgFromGroups([50, 51, 0], [1, 1, 0])).toBe(51);
    expect(weightedAvgFromGroups([1, 2, 1], [1, 1, 1])).toBe(1);
    expect(weightedAvgFromGroups([3, 0, 0], [2, 0, 0])).toBe(2); // 1.5 -> 2
    expect(weightedAvgFromGroups([0, 0, 0], [0, 0, 0])).toBeNull();
    for (let a = 1; a <= 100; a += 7) for (let b = 1; b <= 100; b += 11) for (let c = 1; c <= 100; c += 13) {
      const exact = (20 * a + 35 * b + 45 * c) / 100;
      expect(weightedAvgFromGroups([a, b, c], [1, 1, 1]), `${a}/${b}/${c}`).toBe(Math.floor(exact + 0.5 + 1e-9));
    }
  });

  it("a run's strength is its average RANKED among the runs (owner-approved 2026-09-30, restored 2026-10-06): averages near 50 spread to 1-100", () => {
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

  it("the player's own rounds are placed against the pool's boards, and the run against the pool's runs (weighted, restored 2026-10-06)", () => {
    // The owner reverted the final-board formula (#1928) on 2026-10-06: "matchmaking algorithm -> backtrack to the
    // weighted version". The regime stamp names the formula the build computes.
    expect(RUN_STRENGTH_FORMULA).toBe('weighted');
    const score = (wave: number, raw: number): StrengthScore => ({ raw, wave, ref: STRENGTH_REF_VERSION, fights: 60 });
    const hist = { '1': [{ raw: 0.2, count: 3 }, { raw: 0.8, count: 1 }], '2': [{ raw: 0.5, count: 4 }] };
    const runs = [{ avg: 40, count: 5 }, { avg: 80, count: 2 }, { avg: 90, count: 2 }];
    const out = runStrengthFromScores([[2, score(2, 0.9)], [1, score(1, 0.5)], [3, score(3, 0.5)]], hist, runs)!;
    expect(out.rounds).toEqual([{ round: 1, value: 70 }, { round: 2, value: 90 }]); // round 3: no pool boards yet
    expect(out.average).toBe(80);
    // The frozen game number is round-weighted too: round 1 = 70 and round 10 = 90 -> (20 * 70 + 45 * 90) / 65 = 83.8.
    const late = runStrengthFromScores([[1, score(1, 0.5)], [10, score(10, 0.9)]], { ...hist, '10': [{ raw: 0.5, count: 4 }] }, runs)!;
    expect(late.rounds).toEqual([{ round: 1, value: 70 }, { round: 10, value: 90 }]);
    expect(late.average).toBe(84);
    expect(out.value).toBe(65); // (5 below + (2 + itself) / 2) / 10 = 6.5 / 10
    // NOT the final board: a run's strength is not its last round's percentile (the 2026-10-03 to 2026-10-06 rule).
    expect(out.value).not.toBe(runFinalStrengthOf(out.rounds));
    // No run histogram yet: the rounds stand, the run has no strength (nothing is shown for it).
    expect(runStrengthFromScores([[1, score(1, 0.5)]], hist, null)!.value).toBeNull();
    expect(runStrengthFromScores([[1, score(1, 0.5)]], null, runs)).toBeNull();
    expect(runStrengthFromScores([[1, { ...score(1, 0.5), ref: 'old' }]], hist, runs)!.value).toBeNull();
  });

  it('runFinalStrengthOf (a diagnostic since 2026-10-06): the latest scored round, duplicates averaged half up, unscored rounds skipped', () => {
    expect(runFinalStrengthOf([{ round: 1, value: 90 }, { round: 5, value: 12 }, { round: 3, value: 99 }])).toBe(12);
    expect(runFinalStrengthOf([{ round: 7, value: 40 }, { round: 7, value: 41 }, { round: 2, value: 99 }])).toBe(41); // 40.5 -> 41
    // The final round never got a score (run-end wait timed out): the latest scored round stands in.
    expect(runFinalStrengthOf([{ round: 4, value: 60 }, { round: 5, value: null }])).toBe(60);
    expect(runFinalStrengthOf([{ round: 4, value: undefined }])).toBeNull();
    expect(runFinalStrengthOf([])).toBeNull();
    expect(finalFromSum(3, 2)).toBe(2); // 1.5 -> 2
    expect(finalFromSum(0, 0)).toBeNull();
    for (let n = 1; n <= 6; n++) for (let sum = n; sum <= 100 * n; sum += 7) expect(finalFromSum(sum, n), `${sum}/${n}`).toBe(Math.floor(sum / n + 0.5 + 1e-9));
  });

  it('reads a stored strength back, or null', () => {
    expect(parseBoardStrength(72)).toBe(72);
    expect(parseBoardStrength('72')).toBe(72);
    for (const bad of [0, 101, null, undefined, '', 'x', NaN, {}]) expect(parseBoardStrength(bad)).toBeNull();
  });
});
