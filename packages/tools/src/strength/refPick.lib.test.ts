import { describe, it, expect } from 'vitest';
import { pickReferenceIndices, referenceBuckets } from './refPick.lib';

const count = (xs: (string | null)[], picks: number[], who: string): number => picks.filter((i) => xs[i] === who).length;

describe('pickReferenceIndices', () => {
  it('picks 40 across the whole range with extra weight in the top 20%', () => {
    const owners = [...Array(200)].map((_, i) => `p${i}`);
    const picks = pickReferenceIndices(owners);
    expect(picks).toHaveLength(40);
    expect(new Set(picks).size).toBe(40);
    expect(picks[0]).toBe(0);
    expect(picks[39]).toBe(199);
    expect(picks.filter((i) => i >= 160).length).toBeGreaterThanOrEqual(17);
  });
  it('never takes more than 10 from one player', () => {
    const owners = [...Array(200)].map((_, i) => ['a', 'b', 'c', 'd'][i % 4]!);
    const picks = pickReferenceIndices(owners);
    expect(picks).toHaveLength(40);
    for (const who of ['a', 'b', 'c', 'd']) expect(count(owners, picks, who)).toBe(10);
  });
  it('does not cap boards with no owner, and returns everything when there are 40 or fewer', () => {
    expect(pickReferenceIndices([...Array(100)].map(() => null))).toHaveLength(40);
    expect(pickReferenceIndices([...Array(12)].map(() => 'a'))).toEqual([...Array(12)].map((_, i) => i));
  });
});

describe('referenceBuckets', () => {
  it('a round needs 40 real boards to stand alone; thin rounds merge into the last one', () => {
    const live = new Map([...[...Array(15)].map((_, i) => [i + 1, 200] as const), [16, 50] as const, [17, 12] as const, [18, 4] as const]);
    expect(referenceBuckets(live)).toEqual([...Array(16)].map((_, i) => i + 1));
    expect(referenceBuckets(new Map([[1, 200], [2, 39], [3, 200]]))).toEqual([1, 3]);
    expect(referenceBuckets(new Map([[1, 200], [2, 39], [3, 12]]))).toEqual([1]);
  });
});
