/**
 * `snapSubpixelSizes` (gameplay perf pass 2026-10-09): a recorded card box that differs from the card's current box
 * by layout rounding only (measured: -0.031 px) must count as the SAME size, so `Flip.from` keeps its cheap
 * translate-only path instead of the deep `getGlobalMatrix` one (a forced layout per card per slot crossing). A real
 * resize must still read as a resize.
 */
import { describe, expect, it } from 'vitest';
import { snapSubpixelSizes, type StageFlipState } from './stageFlip';

const rect = (w: number, h: number): DOMRect => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;
const stateOf = (...boxes: DOMRect[]): StageFlipState =>
  ({ elementStates: boxes.map((bounds) => ({ element: {}, bounds, matrix: { e: 0, f: 0 } })) }) as unknown as StageFlipState;
const boundsOf = (s: StageFlipState, i: number): DOMRect => (s.elementStates as unknown as { bounds: DOMRect }[])[i]!.bounds;

describe('snapSubpixelSizes', () => {
  it('snaps a rounding-only difference to the current size (both axes)', () => {
    const s = stateOf(rect(144.449, 185.626));
    snapSubpixelSizes(s, [rect(144.48, 185.657)]);
    expect(boundsOf(s, 0).width).toBe(144.48);
    expect(boundsOf(s, 0).height).toBe(185.657);
  });

  it('leaves a real resize alone (a lifted drag source, a hover pop)', () => {
    const s = stateOf(rect(144.48, 185.66));
    snapSubpixelSizes(s, [rect(153.15, 196.8)]);
    expect(boundsOf(s, 0).width).toBe(144.48);
    expect(boundsOf(s, 0).height).toBe(185.66);
  });

  it('skips elements with no current rect (detached)', () => {
    const s = stateOf(rect(100, 100));
    snapSubpixelSizes(s, [null]);
    expect(boundsOf(s, 0).width).toBe(100);
  });
});
