import { describe, expect, it } from 'vitest';
import type { RectLike } from './boardAnchors';
import { anchorsForUnits, combatAnchorsFromRects, unitSelector, type CombatRects } from './combatAnchors';

const rect = (left: number, top: number, width = 100, height = 140): RectLike => ({ left, top, width, height });

const MOMENT: CombatRects = {
  source: rect(200, 600),
  target: rect(800, 200),
  row: rect(100, 590, 900, 160),
  viewport: { w: 1280, h: 800 },
};

describe('unitSelector', () => {
  it('matches Recruit\'s combat `findEl` exactly (both facing rows, scoped by uid)', () => {
    // Character-for-character: a def-driven effect must measure the SAME element the hand-written FX do,
    // or it lands somewhere subtly different. See `Recruit.tsx`'s findEl.
    expect(unitSelector('u17')).toBe('[data-zone="warband"] [data-uid="u17"], [data-zone="tavern"] [data-uid="u17"]');
  });
});

describe('combatAnchorsFromRects', () => {
  it('centres source and target on their unit rects', () => {
    const a = combatAnchorsFromRects(MOMENT)!;
    expect(a.source).toEqual({ x: 250, y: 670 });
    expect(a.target).toEqual({ x: 850, y: 270 });
  });

  it('puts `camera` at the viewport centre', () => {
    expect(combatAnchorsFromRects(MOMENT)!.camera).toEqual({ x: 640, y: 400 });
  });

  it('takes `slot` x from the unit but y from the ROW midline', () => {
    const a = combatAnchorsFromRects(MOMENT)!;
    expect(a.slot).toEqual({ x: 250, y: 670 });
    // A mid-lunge attacker has left its slot; the slot anchor must stay on the row.
    const lunging = combatAnchorsFromRects({ ...MOMENT, source: rect(200, 520) })!;
    expect(lunging.source!.y).toBe(590);
    expect(lunging.slot).toEqual({ x: 250, y: 670 });
  });

  it('degrades `slot` to the unit centre with no row rect', () => {
    const a = combatAnchorsFromRects({ ...MOMENT, row: null })!;
    expect(a.slot).toEqual(a.source);
    expect(combatAnchorsFromRects({ ...MOMENT, row: undefined })!.slot).toEqual(a.source);
  });

  it('omits `cursor` — a combat moment has no cursor', () => {
    expect(combatAnchorsFromRects(MOMENT)!.cursor).toBeUndefined();
  });

  it('folds a SOURCELESS moment onto the target (not onto the screen corner)', () => {
    // Plenty of combat events carry no source (a sourceless buff, an aura tick). Leaving `source` at the
    // origin would fling the whole travel arc at the top-left of the screen.
    const a = combatAnchorsFromRects({ ...MOMENT, source: null })!;
    expect(a.source).toEqual({ x: 850, y: 270 });
    expect(a.target).toEqual({ x: 850, y: 270 });
  });

  it('folds a TARGETLESS moment onto the source', () => {
    const a = combatAnchorsFromRects({ ...MOMENT, target: null })!;
    expect(a.source).toEqual({ x: 250, y: 670 });
    expect(a.target).toEqual({ x: 250, y: 670 });
  });

  it('returns null when BOTH ends are missing', () => {
    expect(combatAnchorsFromRects({ ...MOMENT, source: null, target: null })).toBeNull();
  });

  it('returns null for a zero-sized rect (an unlaid-out / hidden unit)', () => {
    expect(combatAnchorsFromRects({ ...MOMENT, source: { left: 0, top: 0, width: 0, height: 0 } })).toBeNull();
    expect(combatAnchorsFromRects({ ...MOMENT, target: { left: 5, top: 5, width: 10, height: 0 } })).toBeNull();
  });

  it('ignores a zero-sized ROW rather than failing (slot falls back)', () => {
    const a = combatAnchorsFromRects({ ...MOMENT, row: { left: 0, top: 0, width: 0, height: 0 } })!;
    expect(a.slot).toEqual(a.source);
  });
});

describe('anchorsForUnits', () => {
  it('returns null headless (no document)', () => {
    // The suite runs in the node environment, so this is the real "the board isn't up" path — the same one
    // a caller hits before the combat DOM has mounted.
    expect(typeof document).toBe('undefined');
    expect(anchorsForUnits('a', 'b')).toBeNull();
  });

  it('returns null when both uids are null (nothing to anchor to)', () => {
    expect(anchorsForUnits(null, null)).toBeNull();
  });

  it('never throws for any uid shape', () => {
    expect(() => anchorsForUnits('', '')).not.toThrow();
    expect(() => anchorsForUnits(null, 'missing-uid')).not.toThrow();
    expect(() => anchorsForUnits('missing-uid', null)).not.toThrow();
  });
});
