import { describe, it, expect } from 'vitest';
import { STRENGTH_BANDS } from '@game/sim';
import { rateRunsV2, driftOf, peakCapRows, rawRoundsOfRun, type RawRound } from './measureV2.lib';

const rounds = (runKey: string, raws: number[], lastReal: number): RawRound[] =>
  raws.map((raw, i) => ({ runKey, round: i + 1, raw, carried: i + 1 > lastReal }));

describe('rateRunsV2', () => {
  const raws = [...rounds('weak', Array(15).fill(0.1), 15), ...rounds('mid', Array(15).fill(0.5), 15), ...rounds('strong', Array(15).fill(0.9), 15)];
  const owners = new Map<string, string | null>([['weak', 'a'], ['mid', 'b'], ['strong', 'c']]);
  const by = new Map(rateRunsV2(raws, owners).map((r) => [r.key, r]));

  it('ranks each round among the runs, ties half, whole numbers 1..100', () => {
    expect(by.get('weak')!.rounds[0]!.value).toBe(17);
    expect(by.get('mid')!.rounds[0]!.value).toBe(50);
    expect(by.get('strong')!.rounds[0]!.value).toBe(83);
  });
  it('gives every run a LATE rating and orders the runs', () => {
    expect(by.get('weak')!.late).toBeLessThan(by.get('mid')!.late!);
    expect(by.get('mid')!.early).toBeLessThan(by.get('strong')!.early!);
    expect(by.get('weak')!.owner).toBe('a');
  });
  it('a round where every board ties stays inside 1..100', () => {
    const tied = [...rounds('x', Array(15).fill(0.5), 15), ...rounds('y', Array(15).fill(0.5), 15)];
    for (const r of rateRunsV2(tied, new Map())) for (const x of r.rounds) expect(x.value).toBe(50);
  });
  it('carried rounds count for LATE but never for the peak or the Game strength', () => {
    const short = [...rounds('short', [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, ...Array(8).fill(0)], 7), ...rounds('long', Array(15).fill(0.5), 15)];
    const rated = rateRunsV2(short, new Map());
    const s = rated.find((r) => r.key === 'short')!;
    const l = rated.find((r) => r.key === 'long')!;
    expect(s.rounds.filter((x) => x.carried)).toHaveLength(8);
    expect(s.peak).toBe(75);                       // its real rounds beat 'long'
    expect(s.late).toBeLessThan(l.late!);          // its carried rounds lose to 'long'
    expect(s.strength).toBeGreaterThan(l.strength!); // Game strength reads real rounds only
  });
});

describe('rateRunsV2 reference buckets', () => {
  it('ranks a round past the last reference round inside that last round\'s population', () => {
    const raws: RawRound[] = [
      { runKey: 'a', round: 16, raw: 0.2, carried: false }, { runKey: 'b', round: 16, raw: 0.5, carried: false },
      { runKey: 'c', round: 16, raw: 0.5, carried: false }, { runKey: 'c', round: 17, raw: 0.9, carried: false },
    ];
    const c = rateRunsV2(raws, new Map(), (round) => Math.min(round, 16)).find((r) => r.key === 'c')!;
    expect(c.rounds.map((x) => [x.round, x.value])).toEqual([[16, 50], [17, 88]]); // 17 ranks among all four, not alone
  });
});

describe('rawRoundsOfRun', () => {
  it('an empty board is raw 0 and costs no fights, real or carried', () => {
    const calls: number[] = [];
    const out = rawRoundsOfRun({ key: 'r', boards: [{ wave: 7, minions: 3 }, { wave: 8, minions: 0 }] }, 10, (_w, at) => { calls.push(at); return 0.4; });
    expect(out.map((x) => [x.round, x.raw, x.carried])).toEqual([[7, 0.4, false], [8, 0, false], [9, 0, true], [10, 0, true]]);
    expect(calls).toEqual([7]);
  });
  it('scores the final board again at each later round', () => {
    const calls: [number, number][] = [];
    const out = rawRoundsOfRun({ key: 'r', boards: [{ wave: 7, minions: 3 }, { wave: 7, minions: 5 }, { wave: 8, minions: 2 }] }, 10, (w, at) => { calls.push([w, at]); return 0.5; });
    expect(out.map((x) => x.round)).toEqual([7, 8, 9, 10]);
    expect(calls).toEqual([[7, 7], [8, 8], [8, 9], [8, 10]]);
  });
});

describe('driftOf', () => {
  it('flags a round the pool has outgrown', () => {
    expect(driftOf([0.2, 0.5, 0.55, 0.6, 0.7]).rebaseline).toBe(false);
    expect(driftOf([0.5, 0.6, 0.65, 0.7, 0.8]).rebaseline).toBe(true);        // median above 0.60
    expect(driftOf([0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.95]).rebaseline).toBe(true); // p90 above 0.92
  });
});

describe('peakCapRows', () => {
  it('counts what each cap removes from a band and the seats left under the 4-per-player cap', () => {
    const run = (key: string, peak: number, owner: string) => ({ key, owner, rounds: [], early: 10, late: 10, strength: 10, peak });
    const runs = [run('a', 50, 'p1'), run('b', 85, 'p1'), run('c', 95, 'p2')];
    const rows = peakCapRows(runs, STRENGTH_BANDS.Bronze, [80, 90]);
    expect(rows).toEqual([{ cap: 80, runs: 1, removed: 2, seats: 1 }, { cap: 90, runs: 2, removed: 1, seats: 2 }]);
  });
});
