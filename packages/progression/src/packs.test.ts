import { describe, expect, it } from 'vitest';
import { packDuplicateAether, parsePackOpenResult } from './packs';

const card = (over: Record<string, unknown> = {}) => ({ rewardId: 'x', rarity: 'common', guaranteed: false, duplicate: null, ...over });
const valid = () => ({
  packId: 'p1',
  pack: { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' },
  cards: [card(), card(), card(), card(), card({ rarity: 'rare', guaranteed: true })],
});

describe('parsePackOpenResult', () => {
  it('parses a valid 5-card result', () => {
    expect(parsePackOpenResult(valid())).toEqual(valid());
  });
  it('returns a fresh object, not the input', () => {
    const v = valid();
    const r = parsePackOpenResult(v);
    expect(r).not.toBe(v);
    expect(Object.isFrozen(r)).toBe(true);
  });
  it('rejects 0 cards and more than 5 cards', () => {
    expect(parsePackOpenResult({ ...valid(), cards: [] })).toBeNull();
    const six = [...valid().cards, card({ guaranteed: false })];
    expect(parsePackOpenResult({ ...valid(), cards: six })).toBeNull();
  });
  it('rejects zero or two guaranteed cards', () => {
    const none = valid().cards.map((c) => ({ ...c, guaranteed: false }));
    expect(parsePackOpenResult({ ...valid(), cards: none })).toBeNull();
    const two = valid().cards.map((c, i) => ({ ...c, guaranteed: i >= 3 }));
    expect(parsePackOpenResult({ ...valid(), cards: two })).toBeNull();
  });
  it('rejects a guaranteed card that is not last', () => {
    const cs = valid().cards.map((c, i) => ({ ...c, guaranteed: i === 2 }));
    expect(parsePackOpenResult({ ...valid(), cards: cs })).toBeNull();
  });
  it('rejects an unknown rarity, bad duplicate aether, non-string rewardId, unknown pack kind', () => {
    const withLast = (over: Record<string, unknown>) => ({ ...valid(), cards: [...valid().cards.slice(0, 4), card({ guaranteed: true, ...over })] });
    expect(parsePackOpenResult(withLast({ rarity: 'mythic' }))).toBeNull();
    expect(parsePackOpenResult(withLast({ duplicate: { aether: -1 } }))).toBeNull();
    expect(parsePackOpenResult(withLast({ duplicate: { aether: 1.5 } }))).toBeNull();
    expect(parsePackOpenResult(withLast({ rewardId: 5 }))).toBeNull();
    expect(parsePackOpenResult({ ...valid(), pack: { ...valid().pack, kind: 'weird' } })).toBeNull();
  });
  it('accepts an unknown rewardId string', () => {
    const cs = [...valid().cards.slice(0, 4), card({ guaranteed: true, rewardId: 'from_the_future' })];
    expect(parsePackOpenResult({ ...valid(), cards: cs })).not.toBeNull();
  });
  it('accepts 1..4 cards when the single guaranteed card is last', () => {
    for (let n = 1; n <= 4; n++) {
      const cs = [...Array.from({ length: n - 1 }, () => card()), card({ guaranteed: true })];
      expect(parsePackOpenResult({ ...valid(), cards: cs })).not.toBeNull();
    }
  });
  it('keeps an optional aether balance and rejects a bad one', () => {
    expect(parsePackOpenResult({ ...valid(), aether: 40 })?.aether).toBe(40);
    expect(parsePackOpenResult({ ...valid(), aether: -2 })).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(parsePackOpenResult(null)).toBeNull();
    expect(parsePackOpenResult('x')).toBeNull();
  });
});

describe('packDuplicateAether', () => {
  it('sums the duplicates', () => {
    const cards = [null, { aether: 10 }, null, { aether: 25 }, null].map((d, i) => card({ duplicate: d, guaranteed: i === 4 }));
    const r = parsePackOpenResult({ ...valid(), cards });
    expect(r).not.toBeNull();
    expect(packDuplicateAether(r!)).toBe(35);
  });
});
