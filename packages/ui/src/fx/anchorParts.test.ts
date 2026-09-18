import { describe, expect, it } from 'vitest';
import {
  FX_ANCHOR_PARTS,
  isAnchorPart,
  isSelectorPart,
  partPointFromRects,
  partsFromElements,
  partsUsedByLayers,
  readUnitPartPoints,
  type UnitElementLike,
} from './anchorParts';

const card = { left: 100, top: 200, width: 80, height: 120 }; // centre (140, 260)

describe('partPointFromRects', () => {
  it('card is the centre; edges sit on the card rect', () => {
    expect(partPointFromRects(card, 'card', null)).toEqual({ x: 140, y: 260 });
    expect(partPointFromRects(card, 'top', null)).toEqual({ x: 140, y: 200 });
    expect(partPointFromRects(card, 'bottom', null)).toEqual({ x: 140, y: 320 });
    expect(partPointFromRects(card, 'left', null)).toEqual({ x: 100, y: 260 });
    expect(partPointFromRects(card, 'right', null)).toEqual({ x: 180, y: 260 });
  });
  it('a selector part is its own rect centre, falling back to the card centre when the card lacks it', () => {
    expect(partPointFromRects(card, 'badge.attack', { left: 100, top: 300, width: 20, height: 20 })).toEqual({ x: 110, y: 310 });
    expect(partPointFromRects(card, 'tier', { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 140, y: 260 });
  });
  it('medallion resolves to its gem rect, falling back to the card centre when the card lacks it', () => {
    // With a real .cgem rect it is that rect's centre (the trigger gem the shout/rally pulses).
    expect(partPointFromRects(card, 'medallion', { left: 130, top: 300, width: 20, height: 20 })).toEqual({ x: 140, y: 310 });
    // No gem element: the card centre, exactly like every other missing part.
    expect(partPointFromRects(card, 'medallion', null)).toEqual({ x: 140, y: 260 });
  });
});

describe('partsUsedByLayers / isAnchorPart / isSelectorPart', () => {
  it('collects distinct non-default parts only', () => {
    expect(partsUsedByLayers([{ anchorPart: 'card' }, { anchorPart: 'medallion' }, {}, { anchorPart: 'medallion' }, { anchorPart: 'top' }])).toEqual(['medallion', 'top']);
    expect(partsUsedByLayers([{}, { anchorPart: null }])).toEqual([]);
    // both ends collected: a travel layer's source (anchorPart) AND target (anchorPartTo)
    expect(partsUsedByLayers([{ anchorPart: 'medallion', anchorPartTo: 'badge.attack' }, { anchorPartTo: 'top' }])).toEqual(['medallion', 'badge.attack', 'top']);
    expect(partsUsedByLayers([{ anchorPart: 'top', anchorPartTo: 'card' }])).toEqual(['top']); // `card` to-part is not a resolved part
  });
  it('knows the list and which parts need a DOM query', () => {
    for (const p of FX_ANCHOR_PARTS) expect(isAnchorPart(p)).toBe(true);
    expect(isAnchorPart('medallion')).toBe(true);
    expect(isAnchorPart('tribe')).toBe(false); // the owner's word is `medallion`; `tribe` is not a part id
    expect(isAnchorPart('gem')).toBe(false);
    expect(isSelectorPart('medallion')).toBe(true);
    expect(isSelectorPart('top')).toBe(false);
    expect(isSelectorPart('card')).toBe(false);
  });
});

/** A stub unit: the card rect plus a map of selector → child rect. */
function unit(rect: typeof card, children: Record<string, typeof card | null>): UnitElementLike & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    getBoundingClientRect: () => rect,
    querySelector: (sel: string) => {
      queries.push(sel);
      const r = children[sel];
      return r ? { getBoundingClientRect: () => r, querySelector: () => null } : null;
    },
  };
}

describe('readUnitPartPoints', () => {
  it('queries ONLY the selector parts asked for, once each, and derives edges for free', () => {
    const u = unit(card, {
      '.badge.atk': { left: 100, top: 300, width: 20, height: 20 },
      '.cgem': { left: 130, top: 205, width: 20, height: 20 },
    });
    const pts = readUnitPartPoints(u, ['badge.attack', 'top', 'medallion']);
    expect(pts['badge.attack']).toEqual({ x: 110, y: 310 });
    expect(pts.medallion).toEqual({ x: 140, y: 215 }); // the trigger gem — the owner's "medallion"
    expect(pts.top).toEqual({ x: 140, y: 200 });
    expect(u.queries).toEqual(['.badge.atk', '.cgem']);
  });
  it('tier skips the tier-7 glow halo so it lands on the plaque', () => {
    const u = unit(card, { '.tierbadge:not(.tierglow)': { left: 130, top: 190, width: 20, height: 20 } });
    expect(readUnitPartPoints(u, ['tier']).tier).toEqual({ x: 140, y: 200 });
    expect(u.queries).toEqual(['.tierbadge:not(.tierglow)']);
  });
  it('a missing element falls back to the centre rather than dropping the part', () => {
    const u = unit(card, {});
    expect(readUnitPartPoints(u, ['badge.health']).hasOwnProperty('badge.health')).toBe(true);
    expect(readUnitPartPoints(u, ['badge.health'])['badge.health']).toEqual({ x: 140, y: 260 });
  });
});

describe('partsFromElements', () => {
  it('is undefined with nothing to read, else per-end points', () => {
    expect(partsFromElements(null, null, ['top'])).toBeUndefined();
    expect(partsFromElements(unit(card, {}), null, [])).toBeUndefined();
    const out = partsFromElements(unit(card, {}), unit({ ...card, left: 500 }, {}), ['top']);
    expect(out?.source?.top).toEqual({ x: 140, y: 200 });
    expect(out?.target?.top).toEqual({ x: 540, y: 200 });
  });
});
