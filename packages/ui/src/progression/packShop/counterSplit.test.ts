import { describe, expect, it } from 'vitest';
import type { OwnedPack, PackLook } from '@game/progression';
import { COUNTER_TYPES_MAX, STACK_MAX, counterHasRoom, counterSplit } from './shopModel';

// Owner 2026-11-26: the counter holds 5 pack types, 8 packs of each; the rest wait; a buy with no room is refused.
const look = (i: number): PackLook => ({ kind: 'themed', id: `t${i}`, name: `Type ${i}`, guaranteedFloor: 'rare' });
let seq = 0;
const packs = (type: number, n: number): OwnedPack[] => Array.from({ length: n }, () => ({ packId: `p${seq++}`, look: look(type) }));

describe('the counter: 5 pack types, 8 of each', () => {
  it('everything fits while there are at most 5 types and 8 of each', () => {
    const hand = Array.from({ length: COUNTER_TYPES_MAX }, (_, i) => packs(i, STACK_MAX)).flat();
    const s = counterSplit(hand);
    expect(s.counter).toHaveLength(COUNTER_TYPES_MAX * STACK_MAX);
    expect(s.waiting).toEqual([]);
  });

  it('the ninth pack of a type and every pack of an eighth type wait, counted by type', () => {
    const hand = [...Array.from({ length: COUNTER_TYPES_MAX }, (_, i) => packs(i, i === 0 ? STACK_MAX + 2 : 1)).flat(), ...packs(99, 3)];
    const s = counterSplit(hand);
    expect(s.counter).toHaveLength(STACK_MAX + COUNTER_TYPES_MAX - 1);
    expect(s.waiting.map((w) => [w.look.id, w.count])).toEqual([['t0', 2], ['t99', 3]]);
  });

  it('a buy has room on a stack under 8 or on a free place, and none on a full stack, or a full counter; packs waiting do not block a stack with room', () => {
    expect(counterHasRoom([], look(0))).toBe(true);
    expect(counterHasRoom(packs(0, STACK_MAX - 1), look(0))).toBe(true);
    expect(counterHasRoom(packs(0, STACK_MAX), look(0))).toBe(false);
    const full = Array.from({ length: COUNTER_TYPES_MAX }, (_, i) => packs(i, 1)).flat();
    expect(counterHasRoom(full, look(3))).toBe(true);
    expect(counterHasRoom(full, look(50))).toBe(false);
    expect(counterHasRoom([...full, ...packs(50, 1)], look(3))).toBe(true);
    expect(counterHasRoom([...full, ...packs(50, 1)], look(50))).toBe(false);
  });
});
