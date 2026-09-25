// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { resetFxBudget } from './fxBudget';
import { registerSavedDef } from './fxDefs';
import { playDef } from './playDef';
import type { FxInstance } from './primitive';
import { clearPrimitives, registerPrimitive } from './registry';
import type { StoredFxDef } from './defStore';

/**
 * THE SILENT PREVIEW (owner report 2026-09-25: "when clicking the play button i do not hear the imported audio …
 * the screen goes dark like this but no sound plays"). On the title screen there is no main overlay app (it only
 * mounts in a run), and its ticker is what advanced every `playDef` — so the FX Library's ▶ preview sat frozen at
 * t=0 on the above canvas: a `sound` layer (which starts inside `update`) never played. `pixiFx` now runs a
 * detached rAF clock whenever work arrives with no main app.
 *
 * HEADLESS SEAM (as in auxCanvasClearsOnRetire.test.ts): the controller's private fields are seeded through a
 * cast, and requestAnimationFrame is a hand-cranked queue.
 */
type Seam = {
  app: unknown;
  ready: boolean;
  extraUpdaters: unknown[];
  aboveApp: unknown;
  aboveLayer: Container | null;
  aboveShowing: boolean;
  manuallyPaused: boolean;
  detachedRaf: number;
};
const seam = (): Seam => pixiFx as unknown as Seam;

let rafQueue: FrameRequestCallback[] = [];
const crank = (n = 1): void => {
  for (let k = 0; k < n; k++) { const q = rafQueue; rafQueue = []; for (const cb of q) cb(performance.now()); }
};

let updates = 0;
let complete = false;
const aboveFrames: number[] = [];

beforeEach(() => {
  updates = 0; complete = false; aboveFrames.length = 0; rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
  resetFxBudget();
  clearPrimitives();
  registerPrimitive({
    id: 'counting',
    params: { n: { kind: 'slider', label: 'N', min: 0, max: 10, step: 1, default: 1 } },
    spawn: () => ({ update: () => { updates++; }, setParams: vi.fn(), isComplete: () => complete, destroy: () => {} }) as FxInstance,
  });
  registerSavedDef({
    version: 1, id: 'title-preview-probe', duration: 1000, slot: 'above',
    layers: [{ primitive: 'counting', anchor: 'target', at: 0, params: { n: 1 } }],
  } as StoredFxDef);
  // The title screen: NO main app. The above canvas exists (the preview asked for it).
  seam().app = null;
  seam().ready = false;
  const above = new Container();
  seam().aboveLayer = above;
  seam().aboveApp = { renderer: { render: () => { aboveFrames.push(above.children.length); } }, stage: new Container() };
});

afterEach(() => {
  seam().extraUpdaters.length = 0;
  seam().aboveApp = null;
  seam().aboveLayer = null;
  seam().aboveShowing = false;
  seam().manuallyPaused = false;
  seam().detachedRaf = 0;
  clearPrimitives();
  resetFxBudget();
  vi.unstubAllGlobals();
});

describe('the detached clock — a def plays with no main overlay (title screen)', () => {
  it('advances a playDef on the above canvas and renders it, then idles once it retires', () => {
    const p = { x: 10, y: 10 };
    const stop = playDef('title-preview-probe', { source: p, target: p, cursor: p });
    expect(stop).not.toBeNull();
    const before = updates;
    crank(3);
    expect(updates).toBeGreaterThan(before);          // the layer is being ticked — a sound layer would start here
    expect(aboveFrames.length).toBeGreaterThan(0);    // and the above canvas is being presented
    stop!();
    crank(3);                                         // one clearing frame, then nothing
    expect(rafQueue.length).toBe(0);
  });

  it('does not run under a Skip freeze, and yields to the main ticker once it exists', () => {
    seam().manuallyPaused = true;
    const p = { x: 10, y: 10 };
    const stop = playDef('title-preview-probe', { source: p, target: p, cursor: p });
    crank(2);
    const frozen = updates;
    crank(2);
    expect(updates).toBe(frozen);
    stop?.();

    seam().manuallyPaused = false;
    const stop2 = playDef('title-preview-probe', { source: p, target: p, cursor: p });
    crank(1);
    seam().app = { ticker: { start(): void {}, stop(): void {} }, renderer: {}, canvas: { style: {} } };
    const atHandover = updates;
    crank(3);
    expect(updates).toBe(atHandover);                 // the detached loop stepped aside
    expect(rafQueue.length).toBe(0);
    stop2?.();
  });
});
