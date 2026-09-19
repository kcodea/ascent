// @vitest-environment jsdom
/**
 * The round rail's viewer placement (2026-09-19): the on-screen clamp and the localStorage round trip.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RAIL_PLACEMENT, RAIL_MIN_VISIBLE, RAIL_PLACEMENT_KEY, clampRailOffset, loadRailPlacement, saveRailPlacement,
} from './railPlacement';

const rect = { left: 11, top: 100, width: 300, height: 400 };
const vp = { width: 1920, height: 1080 };

describe('clampRailOffset', () => {
  it('leaves an on-screen offset alone', () => {
    expect(clampRailOffset({ dx: 200, dy: 50 }, { dx: 0, dy: 0 }, rect, vp)).toEqual({ dx: 200, dy: 50 });
  });

  it('keeps RAIL_MIN_VISIBLE px on screen on every side', () => {
    // Dragged far left: the right edge must stay `minVisible` px inside the viewport.
    const left = clampRailOffset({ dx: -5000, dy: 0 }, { dx: 0, dy: 0 }, rect, vp);
    expect(rect.left + left.dx + rect.width).toBe(RAIL_MIN_VISIBLE);
    // Far right: the left edge at most `minVisible` px from the right edge.
    const right = clampRailOffset({ dx: 5000, dy: 0 }, { dx: 0, dy: 0 }, rect, vp);
    expect(rect.left + right.dx).toBe(vp.width - RAIL_MIN_VISIBLE);
    // Far up / down likewise.
    const up = clampRailOffset({ dx: 0, dy: -5000 }, { dx: 0, dy: 0 }, rect, vp);
    expect(rect.top + up.dy + rect.height).toBe(RAIL_MIN_VISIBLE);
    const down = clampRailOffset({ dx: 0, dy: 5000 }, { dx: 0, dy: 0 }, rect, vp);
    expect(rect.top + down.dy).toBe(vp.height - RAIL_MIN_VISIBLE);
  });

  it('maps through the CURRENT offset — the rect was measured under it', () => {
    // The rail already sits at dx 100 (its rect reflects that); asking for dx 150 moves it 50 px right.
    const r = clampRailOffset({ dx: 150, dy: 0 }, { dx: 100, dy: 0 }, { ...rect, left: 111 }, vp);
    expect(r).toEqual({ dx: 150, dy: 0 });
    // A resize that shrank the viewport pulls a parked rail back in by exactly the overhang.
    const shrunk = clampRailOffset({ dx: 100, dy: 0 }, { dx: 100, dy: 0 }, { ...rect, left: 1900 }, { width: 1000, height: 1080 });
    expect(1900 + (shrunk.dx - 100)).toBe(1000 - RAIL_MIN_VISIBLE);
  });
});

describe('load / save', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults when nothing is stored or the stored value is junk', () => {
    expect(loadRailPlacement()).toEqual(DEFAULT_RAIL_PLACEMENT);
    localStorage.setItem(RAIL_PLACEMENT_KEY, 'not json');
    expect(loadRailPlacement()).toEqual(DEFAULT_RAIL_PLACEMENT);
    localStorage.setItem(RAIL_PLACEMENT_KEY, JSON.stringify({ dx: 'x', dy: Infinity, collapsed: 'yes' }));
    expect(loadRailPlacement()).toEqual({ dx: 0, dy: 0, collapsed: false });
  });

  it('round-trips a placement', () => {
    saveRailPlacement({ dx: 42, dy: -7, collapsed: true });
    expect(loadRailPlacement()).toEqual({ dx: 42, dy: -7, collapsed: true });
  });
});
