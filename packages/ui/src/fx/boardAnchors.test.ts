import { describe, expect, it } from 'vitest';
import {
  anchorsFromRects,
  invalidateBoardAnchors,
  readBoardAnchors,
  type BoardRects,
  type RectLike,
} from './boardAnchors';

const rect = (left: number, top: number, width = 100, height = 140): RectLike => ({ left, top, width, height });

const BOARD: BoardRects = {
  source: rect(200, 600),
  target: rect(800, 200),
  row: rect(100, 590, 900, 160),
  viewport: { w: 1280, h: 800 },
};

describe('anchorsFromRects', () => {
  it('centres source and target on their unit rects', () => {
    const a = anchorsFromRects(BOARD)!;
    expect(a.source).toEqual({ x: 250, y: 670 });
    expect(a.target).toEqual({ x: 850, y: 270 });
  });

  it('puts `camera` at the viewport centre', () => {
    expect(anchorsFromRects(BOARD)!.camera).toEqual({ x: 640, y: 400 });
  });

  it('takes `slot` x from the unit but y from the ROW midline (a lifted card keeps its slot)', () => {
    const a = anchorsFromRects(BOARD)!;
    expect(a.slot).toEqual({ x: 250, y: 670 });
    // Same unit lifted 40px on hover: the slot must NOT follow it up.
    const lifted = anchorsFromRects({ ...BOARD, source: rect(200, 560) })!;
    expect(lifted.source!.y).toBe(630);
    expect(lifted.slot).toEqual({ x: 250, y: 670 });
  });

  it('degrades `slot` to the unit centre with no row rect', () => {
    const a = anchorsFromRects({ ...BOARD, row: null })!;
    expect(a.slot).toEqual(a.source);
  });

  it('returns null when either end is missing', () => {
    expect(anchorsFromRects({ ...BOARD, source: null })).toBeNull();
    expect(anchorsFromRects({ ...BOARD, target: null })).toBeNull();
  });

  it('returns null for a zero-sized rect (an unlaid-out / hidden element)', () => {
    // Without this guard a 0×0 rect would centre the effect on the screen's top-left corner and read as a
    // broken FX rather than as "the board isn't up".
    expect(anchorsFromRects({ ...BOARD, source: { left: 0, top: 0, width: 0, height: 0 } })).toBeNull();
    expect(anchorsFromRects({ ...BOARD, target: { left: 5, top: 5, width: 10, height: 0 } })).toBeNull();
  });

  it('ignores a zero-sized ROW rather than failing (slot falls back)', () => {
    const a = anchorsFromRects({ ...BOARD, row: { left: 0, top: 0, width: 0, height: 0 } })!;
    expect(a.slot).toEqual(a.source);
  });
});

describe('readBoardAnchors', () => {
  it('returns null headless (no document)', () => {
    // The suite runs in the node environment, so this is the real "the board isn't up" path — the one the
    // `realBoard` scenario has to degrade through.
    invalidateBoardAnchors();
    expect(typeof document).toBe('undefined');
    expect(readBoardAnchors()).toBeNull();
  });

  it('stays null across repeated calls and an explicit invalidation', () => {
    expect(readBoardAnchors()).toBeNull();
    invalidateBoardAnchors();
    expect(readBoardAnchors()).toBeNull();
  });
});
