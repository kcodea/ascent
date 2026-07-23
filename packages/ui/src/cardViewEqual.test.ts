import { describe, it, expect } from 'vitest';
import { cardViewEqual, stabilizeViewMap, stabilizeRefMap, stabilizeView } from './cardViewEqual';
import type { CardView } from './Card';

/**
 * These pin the value-stability layer that restores `Card`'s memo bailout after the reducer's `structuredClone`
 * hands every card a fresh object each dispatch. The load-bearing guarantee: an UNCHANGED card yields the SAME
 * reference across "dispatches", so the memo skips it — while ANY displayed change produces a new reference.
 */
const base = (): CardView => ({ name: 'Speedy', cardId: 'speedy', tribe: 'mech', attack: 4, health: 4, keywords: ['W', 'M'], text: '' });

describe('cardViewEqual', () => {
  it('is true for two structurally-identical views (different object references)', () => {
    expect(cardViewEqual(base(), base())).toBe(true);
  });

  it('detects a change in every representative field kind', () => {
    const same = base();
    expect(cardViewEqual(same, { ...same, attack: 5 })).toBe(false);          // scalar number
    expect(cardViewEqual(same, { ...same, name: 'Other' })).toBe(false);      // scalar string
    expect(cardViewEqual(same, { ...same, golden: true })).toBe(false);       // scalar bool
    expect(cardViewEqual(same, { ...same, keywords: ['W'] })).toBe(false);    // keyword array shorter
    expect(cardViewEqual(same, { ...same, keywords: ['W', 'T'] })).toBe(false); // keyword array differs
    expect(cardViewEqual(same, { ...same, text: 'x' })).toBe(false);          // text
  });

  it('compares buffs and stepProgress by value, not reference', () => {
    const withBuff = (): CardView => ({ ...base(), buffs: [{ source: 'Fortify', attack: 2, health: 2, count: 1 }] });
    expect(cardViewEqual(withBuff(), withBuff())).toBe(true);
    expect(cardViewEqual(withBuff(), { ...base(), buffs: [{ source: 'Fortify', attack: 2, health: 2, count: 2 }] })).toBe(false);
    expect(cardViewEqual(base(), withBuff())).toBe(false); // one has buffs, the other doesn't

    const withStep = (c: number): CardView => ({ ...base(), stepProgress: { current: c, total: 3 } });
    expect(cardViewEqual(withStep(1), withStep(1))).toBe(true);
    expect(cardViewEqual(withStep(1), withStep(2))).toBe(false);
  });
});

describe('stabilizeViewMap', () => {
  it('reuses the cached object reference for an unchanged card (so the memo bails)', () => {
    const cached = new Map<string, CardView>([['u1', base()]]);
    const fresh = new Map<string, CardView>([['u1', base()]]); // structurally identical, new object
    const out = stabilizeViewMap(fresh, cached);
    expect(out.get('u1')).toBe(cached.get('u1')); // SAME reference reused → Card memo bails
  });

  it('adopts the fresh object when the card changed', () => {
    const cached = new Map<string, CardView>([['u1', base()]]);
    const changed = { ...base(), attack: 9 };
    const fresh = new Map<string, CardView>([['u1', changed]]);
    const out = stabilizeViewMap(fresh, cached);
    expect(out.get('u1')).toBe(changed); // new reference → Card re-renders (correctly)
  });

  it('only holds current uids (no leak) — a removed card drops out of the returned cache', () => {
    const cached = new Map<string, CardView>([['u1', base()], ['gone', base()]]);
    const fresh = new Map<string, CardView>([['u1', base()]]);
    const out = stabilizeViewMap(fresh, cached);
    expect(out.has('gone')).toBe(false);
    expect(out.size).toBe(1);
  });
});

describe('stabilizeRefMap', () => {
  it('reuses the cached ARRAY reference when every referenced view is unchanged', () => {
    const arr = (): CardView[] => [base(), { ...base(), name: 'Stray' }];
    const cached = new Map<string, CardView[]>([['u1', arr()]]);
    const fresh = new Map<string, CardView[]>([['u1', arr()]]);
    const out = stabilizeRefMap(fresh, cached);
    expect(out.get('u1')).toBe(cached.get('u1')); // stable array ref → refCards prop bails
  });

  it('adopts the fresh array when a referenced view changed', () => {
    const cached = new Map<string, CardView[]>([['u1', [base()]]]);
    const freshArr = [{ ...base(), attack: 7 }];
    const out = stabilizeRefMap(new Map([['u1', freshArr]]), cached);
    expect(out.get('u1')).toBe(freshArr);
  });
});

describe('stabilizeView (single)', () => {
  it('reuses prev when equal, adopts fresh when changed', () => {
    const prev = base();
    expect(stabilizeView(base(), prev)).toBe(prev);
    const changed = { ...base(), cost: 5 };
    expect(stabilizeView(changed, prev)).toBe(changed);
    expect(stabilizeView(null, prev)).toBeNull();
  });
});
