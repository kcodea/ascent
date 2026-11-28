import { describe, expect, it } from 'vitest';
import type { OwnedPack } from './packShop';
import { counterHasRoom, counterSplit } from './packShop';
import type { PackLook } from './packs';
import { DEFAULT_PACK_ECONOMY } from './packEconomy';

// Owner 2026-11-26: the counter holds 5 pack types, 8 packs of each; the rest wait; a buy with no room is refused.
const COUNTER_TYPES_MAX = DEFAULT_PACK_ECONOMY.counterTypes;
const STACK_MAX = DEFAULT_PACK_ECONOMY.stackMax;
const look = (i: number): PackLook => ({ kind: 'themed', id: `t${i}`, name: `Type ${i}`, guaranteedFloor: 'rare' });
const rarityLook = (id: 'common' | 'rare'): PackLook => ({ kind: 'rarity', id, name: `${id} Pack`, guaranteedFloor: id });
let seq = 0;
const ofLook = (l: PackLook, n: number): OwnedPack[] => Array.from({ length: n }, () => ({ packId: `p${seq++}`, look: l }));
const packs = (type: number, n: number): OwnedPack[] => ofLook(look(type), n);

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

  it('a hand of 5 types with the Rare stack at 8: no room for a Rare, none for a sixth type, room for a Common held at 6', () => {
    const hand = [...ofLook(rarityLook('rare'), STACK_MAX), ...ofLook(rarityLook('common'), 6), ...packs(1, 1), ...packs(2, 1), ...packs(3, 1)];
    expect(counterHasRoom(hand, rarityLook('rare'))).toBe(false);
    expect(counterHasRoom(hand, look(77))).toBe(false);
    expect(counterHasRoom(hand, rarityLook('common'))).toBe(true);
  });

  it('a hand given oldest first places the first 5 types on the counter, the rest wait', () => {
    const hand = Array.from({ length: COUNTER_TYPES_MAX + 2 }, (_, i) => packs(i, 1)).flat();
    const s = counterSplit(hand);
    expect(s.counter.map((p) => p.look.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    expect(s.waiting.map((w) => w.look.id)).toEqual(['t5', 't6']);
  });

  it('honours custom limits passed in', () => {
    const eco = { ...DEFAULT_PACK_ECONOMY, counterTypes: 2, stackMax: 1 };
    const hand = [...packs(0, 2), ...packs(1, 1), ...packs(2, 1)];
    const s = counterSplit(hand, eco);
    expect(s.counter).toHaveLength(2);
    expect(s.waiting.map((w) => [w.look.id, w.count])).toEqual([['t0', 1], ['t2', 1]]);
    expect(counterHasRoom(hand, look(0), eco)).toBe(false);
  });
});
