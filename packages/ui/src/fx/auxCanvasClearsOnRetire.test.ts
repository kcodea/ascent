// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The entrance's sounds are irrelevant here; keep them off the (absent) audio stack.
vi.mock('../sfx', async (orig) => {
  const real = await orig<typeof import('../sfx')>();
  return { ...real, playTailedClip: () => null };
});

import { pixiFx } from '../pixiFx';
import { livePlayCount, resetFxBudget } from './fxBudget';
import { registerSavedDef } from './fxDefs';
import { playDef } from './playDef';
import type { FxInstance } from './primitive';
import { clearPrimitives, registerPrimitive } from './registry';
import type { StoredFxDef } from './defStore';
import { runEntrance } from '../discoverEntrance/entrance';
import { DCE_DEFAULTS } from '../discoverEntrance/discoverEntranceConfig';

/**
 * THE LINGERING STARS (owner report 2026-09-25: "bug - sometimes getting these stars lingering", then "i think
 * it's from discover"). Cream star glints (`discover-glint`) and brown dust puffs (`discover-arrive`) sat frozen
 * over the shop board after a Discover, and never faded.
 *
 * Root cause: the above-modal (and under-card) canvas only renders while something is mounted on it. When the
 * last play retired and unmounted, the canvas simply stopped being drawn, so it kept presenting the frame
 * before: every particle still in the air at that instant, at full alpha. Picking a Discover card mid-entrance
 * (the entrance's `cancel` retires the in-flight dust + glints) was the everyday trigger; any retire could do it.
 * The fix: the frame after a slot goes empty presents ONE empty stage (clearing the canvas), then idles.
 *
 * HEADLESS SEAM: a real canvas needs WebGL, so the test seeds the controller's private `app` / `aboveApp` /
 * `aboveLayer` / `underApp` / `underLayer` through a cast (a rename fails this loudly, which is the point), and
 * calls the real `renderAbove` / `renderUnder` / `update` ticker listeners by hand, as the main ticker would.
 */

type Seam = {
  app: unknown;
  layer: Container | null;
  ready: boolean;
  extraUpdaters: unknown[];
  aboveApp: unknown;
  aboveLayer: Container | null;
  underApp: unknown;
  underLayer: Container | null;
  aboveShowing: boolean;
  underShowing: boolean;
  update: (ticker: { deltaMS: number }) => void;
  renderAbove: () => void;
  renderUnder: () => void;
};
const seam = (): Seam => pixiFx as unknown as Seam;

/** Each render: how many containers were mounted on that slot when it presented. */
const aboveFrames: number[] = [];
const underFrames: number[] = [];
let starts = 0;

function seed(): void {
  aboveFrames.length = 0;
  underFrames.length = 0;
  starts = 0;
  const ticker = { remove(): void {}, stop(): void {}, start(): void { starts++; }, add(): void {} };
  seam().app = { renderer: {}, canvas: { style: {} }, ticker };
  seam().layer = new Container();
  seam().ready = true;
  const above = new Container();
  const under = new Container();
  seam().aboveLayer = above;
  seam().underLayer = under;
  seam().aboveApp = { renderer: { render: () => { aboveFrames.push(above.children.length); } }, stage: new Container() };
  seam().underApp = { renderer: { render: () => { underFrames.push(under.children.length); } }, stage: new Container() };
}

/** One pass of the main ticker, in listener order: the updaters (`update`), then the aux-canvas renders. */
function frame(dt = 16): void {
  seam().update({ deltaMS: dt });
  seam().renderUnder();
  seam().renderAbove();
}

let complete = false;
function registerStub(): void {
  registerPrimitive({
    id: 'stub',
    params: { count: { kind: 'slider', label: 'Count', min: 0, max: 1000, step: 1, default: 9 } },
    spawn: () => {
      const inst: FxInstance = {
        update: () => {},
        setParams: vi.fn(),
        isComplete: () => complete,
        destroy: () => {},
      };
      return inst;
    },
  });
  const def = (id: string, slot: 'above' | 'under'): StoredFxDef => ({
    version: 1, id, duration: 800, slot,
    layers: [{ primitive: 'stub', anchor: 'target', at: 0, params: { count: 9 } }],
  });
  // The two Discover defs, re-registered over the stub so the REAL entrance path fires them headlessly.
  registerSavedDef(def('discover-glint', 'above'));
  registerSavedDef(def('discover-arrive', 'above'));
  registerSavedDef(def('linger-under', 'under'));
}

describe('an aux FX canvas clears itself once its last play retires', () => {
  beforeEach(() => {
    complete = false;
    resetFxBudget();
    clearPrimitives();
    registerStub();
    seed();
  });
  afterEach(() => {
    seam().extraUpdaters.length = 0;
    seam().app = null;
    seam().layer = null;
    seam().ready = false;
    seam().aboveApp = null;
    seam().aboveLayer = null;
    seam().underApp = null;
    seam().underLayer = null;
    seam().aboveShowing = false;
    seam().underShowing = false;
    clearPrimitives();
    resetFxBudget();
    vi.useRealTimers();
  });

  it('a play CANCELLED mid-flight (a Discover pick) presents one empty frame, then idles', () => {
    const p = { x: 100, y: 100 };
    const stop = playDef('discover-glint', { source: p, target: p, cursor: p });
    expect(stop).not.toBeNull();
    frame();
    frame();
    expect(aboveFrames).toEqual([1, 1]); // the stars are on screen

    stop!(); // the pick
    expect(seam().aboveLayer!.children.length).toBe(0);
    expect(starts).toBeGreaterThan(0); // the disposer woke the ticker so the clearing frame happens

    frame();
    // THE BUG: this frame used to be skipped, leaving the canvas frozen on `[1]`'s stars forever.
    expect(aboveFrames).toEqual([1, 1, 0]);
    expect(pixiFx.staleSlots()).toEqual([]);
    expect(livePlayCount()).toBe(0);
    expect(seam().extraUpdaters.length).toBe(0);

    // ...and then the canvas idles: no more presents while nothing is mounted.
    frame();
    frame();
    expect(aboveFrames).toEqual([1, 1, 0]);
  });

  it('a play that finishes NATURALLY also clears (it retires inside the tick, before the render)', () => {
    const p = { x: 0, y: 0 };
    playDef('discover-arrive', { source: p, target: p, cursor: p });
    frame();
    complete = true;
    frame(900); // past the def's 800 ms: the updater sees the player done, retires + unmounts, then this same tick renders the empty stage
    expect(aboveFrames).toEqual([1, 0]);
    expect(pixiFx.staleSlots()).toEqual([]);
    frame();
    expect(aboveFrames).toEqual([1, 0]);
  });

  it('the under-card canvas clears the same way', () => {
    const p = { x: 0, y: 0 };
    const stop = playDef('linger-under', { source: p, target: p, cursor: p });
    frame();
    expect(pixiFx.staleSlots()).toEqual([]);
    stop!();
    expect(pixiFx.staleSlots()).toEqual(['under']); // the watchdog sees the frozen frame before the next tick
    frame();
    expect(underFrames).toEqual([1, 0]);
    expect(pixiFx.staleSlots()).toEqual([]);
  });

  it('one of several plays retiring keeps drawing the rest; the last one out clears', () => {
    const p = { x: 0, y: 0 };
    const a = playDef('discover-glint', { source: p, target: p, cursor: p });
    const b = playDef('discover-arrive', { source: p, target: p, cursor: p });
    frame();
    a!();
    frame();
    b!();
    frame();
    frame();
    expect(aboveFrames).toEqual([2, 1, 0]);
    expect(pixiFx.staleSlots()).toEqual([]);
  });

  it('THE OWNER PATH: a Discover pick mid-entrance (EntranceHandle.cancel) leaves no star or dust on screen', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('div');
      s.className = 'disc-slot';
      s.getBoundingClientRect = () => ({ left: 100 + i * 260, top: 200, width: 230, height: 320, right: 330 + i * 260, bottom: 520, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      root.appendChild(s);
    }
    document.body.appendChild(root);
    const h = runEntrance(root, { config: { ...DCE_DEFAULTS, dustCount: 1, glints: 1 }, openCue: false });
    // Run to just after the FIRST card lands: its dust + glints are in the air, the others still flying.
    vi.advanceTimersByTime(h.timeline.cards[0]!.arriveAt + 1);
    frame();
    expect(aboveFrames.at(-1)).toBe(2); // dust + glint mounted and presented
    expect(livePlayCount()).toBe(2);

    h.cancel(); // what the overlay's unmount runs on a pick
    frame();
    expect(aboveFrames.at(-1)).toBe(0);
    expect(pixiFx.staleSlots()).toEqual([]);
    expect(livePlayCount()).toBe(0);

    // Nothing the cancelled entrance had scheduled can re-mount a particle afterwards.
    vi.advanceTimersByTime(h.timeline.endAt + 1000);
    frame();
    expect(seam().aboveLayer!.children.length).toBe(0);
    expect(livePlayCount()).toBe(0);
    root.remove();
  });
});
