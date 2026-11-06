/**
 * VERSUS GROUP, FIVE TO EIGHT SEATS (owner 2026-11-06, R-VERSUS-EIGHT-01): the circle-method schedule.
 */
import { describe, expect, it } from 'vitest';
import { VERSUS_GROUP_SEATS, versusGroupPairings, type VersusGroupEliminations, type VersusGroupSeat } from './group';
import { VERSUS_MODE_SEATS } from './options';

const seats = (n: number): VersusGroupSeat[] => VERSUS_GROUP_SEATS.slice(0, n);
const pair = (a: string, b: string): string => [a, b].sort().join('-');

describe('Versus Group, 5 to 8 seats (R-VERSUS-EIGHT-01)', () => {
  it('a group room seats three to eight', () => {
    expect(VERSUS_MODE_SEATS.group).toEqual({ min: 3, max: 8 });
  });

  for (const n of [6, 8]) {
    it(`${n} alive: everyone fights every round and meets everyone once per ${n - 1}-round cycle, then it repeats`, () => {
      const all = seats(n);
      const met = new Set<string>();
      for (let r = 1; r < n; r++) {
        const ps = versusGroupPairings(all, {}, r);
        expect(ps).toHaveLength(n / 2);
        expect(ps.every((p) => !p.copy)).toBe(true);
        expect(new Set(ps.flatMap((p) => [p.a, p.b])).size).toBe(n);
        for (const p of ps) { expect(met.has(pair(p.a, p.b))).toBe(false); met.add(pair(p.a, p.b)); }
      }
      expect(met.size).toBe((n * (n - 1)) / 2);
      expect(versusGroupPairings(all, {}, n)).toEqual(versusGroupPairings(all, {}, 1));
    });
  }

  for (const n of [5, 7]) {
    it(`${n} alive: one Copy a round; over ${n} rounds every pair fights once, everyone faces the Copy once and is copied once`, () => {
      const all = seats(n);
      const met = new Set<string>();
      const faced: string[] = [];
      const copied: string[] = [];
      for (let r = 1; r <= n; r++) {
        const ps = versusGroupPairings(all, {}, r);
        const copies = ps.filter((p) => p.copy);
        expect(copies).toHaveLength(1);
        const c = copies[0]!;
        expect(c.a).not.toBe(c.b); // nobody faces a copy of themselves
        faced.push(c.a);
        copied.push(c.b);
        const real = ps.filter((p) => !p.copy);
        expect(real).toHaveLength((n - 1) / 2);
        // Each living seat is in exactly one fight (the copied seat fights for real elsewhere).
        expect(new Set([...real.flatMap((p) => [p.a, p.b]), c.a]).size).toBe(n);
        for (const p of real) { expect(met.has(pair(p.a, p.b))).toBe(false); met.add(pair(p.a, p.b)); }
      }
      expect(met.size).toBe((n * (n - 1)) / 2);
      expect([...faced].sort()).toEqual(all);
      expect([...copied].sort()).toEqual(all);
      expect(versusGroupPairings(all, {}, n + 1)).toEqual(versusGroupPairings(all, {}, 1));
    });
  }

  it('a knockout restarts the schedule on the new living set, with no immediate rematch', () => {
    const all = seats(8);
    const elim: VersusGroupEliminations = { p3: 2 };
    const before = versusGroupPairings(all, elim, 2);
    expect(before.flatMap((p) => [p.a, p.b])).toContain('p3'); // out IN round 2: it still fights round 2
    const after = versusGroupPairings(all, elim, 3);
    expect(after.filter((p) => !p.copy).flatMap((p) => [p.a, p.b])).not.toContain('p3');
    expect(after.filter((p) => p.copy)).toHaveLength(1); // seven left
    const played = new Set(before.map((p) => pair(p.a, p.b)));
    for (const p of after.filter((x) => !x.copy)) expect(played.has(pair(p.a, p.b))).toBe(false);
  });

  it('three and four players keep the schedule they always had', () => {
    expect(versusGroupPairings(seats(4), {}, 1)).toEqual([{ a: 'p1', b: 'p2', copy: false }, { a: 'p3', b: 'p4', copy: false }]);
    expect(versusGroupPairings(seats(3), {}, 2)).toEqual([{ a: 'p1', b: 'p3', copy: false }, { a: 'p2', b: 'p3', copy: true }]);
  });
});
