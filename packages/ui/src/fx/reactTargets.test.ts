import { describe, expect, it } from 'vitest';
import { FX_PARTS, FX_REACHES, orderByReach } from './reactTargets';

// The row as it reads on screen, left to right. `c` is the subject in most cases below.
const ROW = ['a', 'b', 'c', 'd', 'e'];
const OTHERS = ['x', 'y'];

describe('orderByReach', () => {
  it('self is just the subject, even with a full row around it', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'self')).toEqual(['c']);
  });

  it('includes the subject FIRST for every reach — it is an ordinary recipient', () => {
    for (const reach of FX_REACHES) {
      expect(orderByReach(ROW, OTHERS, 'c', reach)[0]).toBe('c');
    }
  });

  it('neighbours is the subject and the two units either side of it', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'neighbours')).toEqual(['c', 'b', 'd']);
  });

  it('neighbours at the end of a row has only one side', () => {
    expect(orderByReach(ROW, OTHERS, 'a', 'neighbours')).toEqual(['a', 'b']);
  });

  it('allies ripples outward by distance, left side first on a tie', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'allies')).toEqual(['c', 'b', 'd', 'a', 'e']);
  });

  it('board is the allies ripple, then the opposing row', () => {
    expect(orderByReach(ROW, OTHERS, 'c', 'board')).toEqual(['c', 'b', 'd', 'a', 'e', 'x', 'y']);
  });

  it('never repeats a unit — a subject in both lists still appears once', () => {
    const out = orderByReach(ROW, ['c', 'x'], 'c', 'board');
    expect(out.filter((u) => u === 'c')).toHaveLength(1);
  });

  it('degrades to the subject alone when it is not in the row', () => {
    // An off-board caster, or a unit that died before the effect fired. Spreading across a board the
    // subject is not part of would turn a missing unit into a board-wide effect.
    for (const reach of FX_REACHES) {
      expect(orderByReach(ROW, OTHERS, 'ghost', reach)).toEqual(['ghost']);
    }
  });

  it('handles a one-unit row', () => {
    expect(orderByReach(['solo'], [], 'solo', 'allies')).toEqual(['solo']);
  });

  it('is deterministic — the same inputs give the same order', () => {
    const once = orderByReach(ROW, OTHERS, 'c', 'board');
    expect(orderByReach(ROW, OTHERS, 'c', 'board')).toEqual(once);
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
