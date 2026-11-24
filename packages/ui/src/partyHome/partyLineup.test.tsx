// @vitest-environment jsdom
/**
 * THE PLAY LINEUP (showcase card, 2026-11-23): the pure helpers PartyHome uses to lay its cards out. The card size follows
 * the seat count (one seat full, two half, three or four compact), and mirroring is by POSITION: the card right of the VS
 * mark in Versus 1v1 and the right-hand column in Versus Duos face the VS mark; every other mode never mirrors.
 */
import { describe, expect, it } from 'vitest';

// The PartyHome module graph reaches the pixi chain's canvas probe; guard it as rankSurfaces.test.tsx does.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

import { cardSizeFor, menuRightAt, mirroredAt } from './PartyHome';

describe('cardSizeFor', () => {
  it('one seat is full, two are half, three or four are compact', () => {
    expect(cardSizeFor(1)).toBe('full');
    expect(cardSizeFor(2)).toBe('half');
    expect(cardSizeFor(3)).toBe('compact');
    expect(cardSizeFor(4)).toBe('compact');
  });
});

describe('mirroredAt', () => {
  it('mirrors the far side of a Versus 1v1 only', () => {
    expect(mirroredAt('versus', 1)).toBe(true);
    expect(mirroredAt('versus', 0)).toBe(false);
  });
  it('mirrors the right-hand column of Versus Duos only', () => {
    expect(mirroredAt('vduos', 2)).toBe(true);
    expect(mirroredAt('vduos', 3)).toBe(true);
    expect(mirroredAt('vduos', 1)).toBe(false);
  });
  it('never mirrors a mode with no VS mark', () => {
    expect(mirroredAt('group', 3)).toBe(false);
    expect(mirroredAt('duos', 1)).toBe(false);
  });
});

// A card's menu opens toward the stage, never the screen edge: the left column's cards open to their right.
describe('menuRightAt (the left column, by position)', () => {
  it('one-row lineups: only the first card', () => {
    expect([0, 1].map((i) => menuRightAt('versus', i))).toEqual([true, false]);
    expect([0, 1].map((i) => menuRightAt('duos', i))).toEqual([true, false]);
    expect(menuRightAt('ranked', 0)).toBe(true);
  });
  it('Group 2 x 2: cards 0 and 2; Versus Duos: the left team column (0, 1)', () => {
    expect([0, 1, 2, 3].map((i) => menuRightAt('group', i))).toEqual([true, false, true, false]);
    expect([0, 1, 2, 3].map((i) => menuRightAt('vduos', i))).toEqual([true, true, false, false]);
  });
});
