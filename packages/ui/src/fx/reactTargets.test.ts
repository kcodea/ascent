import { describe, expect, it } from 'vitest';
import { FX_ORDERS, FX_PARTS, FX_REACHES, orderByReach } from './reactTargets';

// The row as it reads on screen, left to right. `c` is the subject in most cases below.
const ROW = ['a', 'b', 'c', 'd', 'e'];
const OTHERS = ['x', 'y'];

describe('orderByReach — who', () => {
  it('self is just the subject, even with a full row around it', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'self')).toEqual([['c']]);
  });

  it('includes the subject in the FIRST group for every reach — it is an ordinary recipient', () => {
    for (const reach of FX_REACHES) {
      expect(orderByReach(ROW, OTHERS, 'c', reach)[0]).toContain('c');
    }
  });

  it('neighbours is the subject and BOTH units either side of it', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'neighbours')).toEqual([['c'], ['b', 'd']]);
  });

  it('neighbours at the end of a row has only one side', () => {
    expect(orderByReach(ROW, OTHERS, 'a', 'neighbours')).toEqual([['a'], ['b']]);
  });

  it('allies reaches the whole row', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'allies').flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('board adds the opposing row', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'board').flat()).toContain('x');
  });

  it('never repeats a unit — a subject in both lists still appears once', () => {
    const out = orderByReach(ROW, ['c', 'x'], 'c', 'board').flat();
    expect(out.filter((u) => u === 'c')).toHaveLength(1);
  });

  it('degrades to the subject alone when it is not in the row', () => {
    // An off-board caster, or a unit that died before the effect fired. Spreading across a board the
    // subject is not part of would turn a missing unit into a board-wide effect.
    for (const reach of FX_REACHES) {
      expect(orderByReach(ROW, OTHERS, 'ghost', reach)).toEqual([['ghost']]);
    }
  });
});

describe('orderByReach — order', () => {
  it('ripple lands EQUAL DISTANCE TOGETHER, in one group per step outward', () => {
    // The bug this guards (found in live authoring, 2026-08-03): a flat list staggered the two sides, so
    // with falloff the right-hand neighbour arrived later AND weaker and the ripple read as one-sided.
    expect(orderByReach(ROW, OTHERS, 'c', 'allies', 'ripple')).toEqual([['c'], ['b', 'd'], ['a', 'e']]);
  });

  it('ripple is SYMMETRIC — both sides of a step are in the same group', () => {
    for (const group of orderByReach(ROW, OTHERS, 'c', 'allies', 'ripple')) {
      const distances = group.map((uid) => Math.abs(ROW.indexOf(uid) - ROW.indexOf('c')));
      expect(new Set(distances).size).toBe(1);
    }
  });

  it('ripple off-centre still pairs by distance and keeps the lone far side alone', () => {
    expect(orderByReach(ROW, OTHERS, 'b', 'allies', 'ripple')).toEqual([['b'], ['a', 'c'], ['d'], ['e']]);
  });

  it('cascade sweeps left to right across the row, one unit per step', () => {
    // Ignores where the subject stands — that is what makes it a sweep rather than a ripple.
    expect(orderByReach(ROW, OTHERS, 'c', 'allies', 'cascade')).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
  });

  it('cascade puts the opposing row after the whole near row', () => {
    const groups = orderByReach(ROW, OTHERS, 'c', 'board', 'cascade').flat();
    expect(groups.slice(0, 5)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(groups.slice(5)).toEqual(['x', 'y']);
  });

  it('volley is a single group — everyone at once, no offset', () => {
    const groups = orderByReach(ROW, OTHERS, 'c', 'allies', 'volley');
    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('defaults to ripple when no order is given', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'allies')).toEqual(orderByReach(ROW, OTHERS, 'c', 'allies', 'ripple'));
  });

  it('order never changes WHO — only the grouping', () => {
    const who = (o: (typeof FX_ORDERS)[number]): string[] =>
      orderByReach(ROW, OTHERS, 'c', 'board', o).flat().sort();
    const ripple = who('ripple');
    for (const o of FX_ORDERS) expect(who(o)).toEqual(ripple);
  });

  it('is deterministic — the same inputs give the same grouping', () => {
    const once = orderByReach(ROW, OTHERS, 'c', 'board', 'ripple');
    expect(orderByReach(ROW, OTHERS, 'c', 'board', 'ripple')).toEqual(once);
  });
});

describe('the part list', () => {
  it('covers card plus both badges at all three grains', () => {
    // Guards the badge split staying addressable: wrapper / plate / value, attack and health, plus the
    // plural forms that hit both. A part silently dropped here is a target the author can no longer pick.
    expect(FX_PARTS).toEqual([
      'card',
      'badges', 'badge.attack', 'badge.health',
      'plates', 'plate.attack', 'plate.health',
      'values', 'value.attack', 'value.health',
    ]);
  });
});
