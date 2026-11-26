// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// jsdom has no canvas: Pixi probes one on import
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
import { DEPTH, OVERSCAN, lookInto, slideInto, type BackdropLayer } from './shopBackdrop';

const LAYERS: BackdropLayer[] = ['wall', 'counter', 'fore'];

describe('where the pointer looks', () => {
  it('the centre is 0, 0; the corners are -1 and 1; a point outside the canvas is held at the edge', () => {
    const o = { x: 9, y: 9 };
    lookInto(o, 960, 540, 1920, 1080);
    expect(o).toEqual({ x: 0, y: 0 });
    lookInto(o, 0, 1080, 1920, 1080);
    expect(o).toEqual({ x: -1, y: 1 });
    lookInto(o, 5000, -400, 1920, 1080);
    expect(o).toEqual({ x: 1, y: -1 });
  });

  it('a canvas with no size looks nowhere', () => {
    const o = { x: 9, y: 9 };
    lookInto(o, 10, 10, 0, 0);
    expect(o).toEqual({ x: 0, y: 0 });
  });
});

describe('how the layers slide', () => {
  it('nothing has moved while the pointer rests at the centre', () => {
    const o = { x: 9, y: 9 };
    for (const layer of LAYERS) { slideInto(o, layer, 0, 0, 1920, 1080); expect(Math.abs(o.x) + Math.abs(o.y)).toBe(0); }
  });

  it('the wall drifts with the pointer; the foreground drifts against it, the most; the counter stays still', () => {
    const wall = { x: 0, y: 0 }, counter = { x: 0, y: 0 }, fore = { x: 0, y: 0 };
    slideInto(wall, 'wall', 1, 1, 1920, 1080);
    slideInto(counter, 'counter', 1, 1, 1920, 1080);
    slideInto(fore, 'fore', 1, 1, 1920, 1080);
    expect(wall.x).toBeGreaterThan(0);
    expect(Math.abs(counter.x) + Math.abs(counter.y)).toBe(0);
    expect(fore.x).toBeLessThan(0);
    expect(Math.abs(fore.x)).toBeGreaterThan(Math.abs(wall.x));
  });

  it('the counter never moves, whichever way the pointer looks: the packs lie on it', () => {
    const o = { x: 0, y: 0 };
    slideInto(o, 'counter', 1, 1, 1920, 1080);
    expect(Math.abs(o.x) + Math.abs(o.y)).toBe(0);
    slideInto(o, 'counter', -1, -1, 1920, 1080);
    expect(Math.abs(o.x) + Math.abs(o.y)).toBe(0);
  });

  it('no layer can slide further than it was painted past the canvas (an edge never shows)', () => {
    for (const layer of LAYERS) {
      expect(Math.abs(DEPTH[layer].x)).toBeLessThanOrEqual(OVERSCAN[layer]);
      expect(Math.abs(DEPTH[layer].y)).toBeLessThanOrEqual(OVERSCAN[layer]);
    }
  });
});
