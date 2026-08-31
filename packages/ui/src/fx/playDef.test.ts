import { describe, expect, it, vi } from 'vitest';
import { pixiFx } from '../pixiFx';
import type { StoredFxDef, StoredFxLayer } from './defStore';
import { registerSavedDef } from './fxDefs';
import { listPrimitives } from './registry';
import {
  canPlayDefs,
  createRetire,
  ensureDefsReady,
  fireProgress,
  loopOptionsFrom,
  playDef,
  playableDef,
  playableLayers,
  withCamera,
} from './playDef';

/**
 * The suite runs headless (node), so there is no renderer and `playDef` can never reach its Pixi path —
 * which is exactly why the parts that matter (idempotent teardown, the muted-layer skip, progress clamping)
 * are extracted as pure helpers. They are tested for real here; mocking WebGL to reach the same assertions
 * would only be testing the mock.
 */

const layer = (over: Partial<StoredFxLayer> = {}): StoredFxLayer => ({
  primitive: 'burst',
  anchor: 'target',
  at: 0,
  params: {},
  ...over,
});

const def = (layers: StoredFxLayer[], over: Partial<StoredFxDef> = {}): StoredFxDef => ({
  version: 1,
  id: 'test-def',
  duration: 800,
  layers,
  ...over,
});

describe('playableLayers / playableDef', () => {
  it('drops muted layers — an isolated layer must not render in the GAME', () => {
    // The regression this exists for: `muted` round-trips into the saved JSON so the author doesn't lose
    // their working state, and only the workbench honours it. Without this filter a def saved mid-isolation
    // plays back with the muted layer visible, i.e. differently in the game than in the tool that made it.
    const kept = layer({ primitive: 'ribbon' });
    const skipped = layer({ primitive: 'smoke', muted: true });
    expect(playableLayers(def([kept, skipped, kept]))).toEqual([kept, kept]);
  });

  it('keeps a layer whose `muted` is anything other than literally true', () => {
    // `coerceDef` already normalises this, but a def can also arrive from `registerSavedDef` unvalidated.
    const layers = [layer(), layer({ muted: false }), layer({ muted: undefined })];
    expect(playableLayers(def(layers))).toHaveLength(3);
  });

  it('keeps every layer when nothing is muted, preserving order', () => {
    const layers = [layer({ at: 0 }), layer({ at: 100 }), layer({ at: 200 })];
    expect(playableLayers(def(layers)).map((l) => l.at)).toEqual([0, 100, 200]);
  });

  it('does not mutate the def it filters', () => {
    const d = def([layer(), layer({ muted: true })]);
    playableLayers(d);
    expect(d.layers).toHaveLength(2);
  });

  it('playableDef carries id + duration and drops the authoring-only fields', () => {
    const d = playableDef(def([layer(), layer({ muted: true })], { duration: 1234, seed: 7 }));
    expect(d).toEqual({ id: 'test-def', duration: 1234, layers: [layer()] });
    expect('seed' in d).toBe(false);
    expect('version' in d).toBe(false);
  });

  it('can end up with no playable layers at all (every layer muted)', () => {
    expect(playableLayers(def([layer({ muted: true }), layer({ muted: true })]))).toEqual([]);
  });
});

describe('fireProgress', () => {
  it('is a plain 0..1 ratio through the def', () => {
    expect(fireProgress(0, 800)).toBe(0);
    expect(fireProgress(400, 800)).toBe(0.5);
    expect(fireProgress(800, 800)).toBe(1);
  });

  it('clamps past the duration — a fire deliberately runs on past it', () => {
    // An unbounded layer plays to TRUE completion, so `player.timeMs()` legitimately exceeds `def.duration`.
    expect(fireProgress(5000, 800)).toBe(1);
  });

  it('clamps below zero', () => {
    expect(fireProgress(-50, 800)).toBe(0);
  });

  it('never returns NaN/Infinity for a zero, negative or non-finite duration', () => {
    expect(fireProgress(0, 0)).toBe(1);
    expect(fireProgress(10, 0)).toBe(1);
    expect(fireProgress(10, -5)).toBe(1);
    expect(fireProgress(10, Number.NaN)).toBe(1);
    expect(fireProgress(Number.NaN, 800)).toBe(1);
    expect(fireProgress(Number.POSITIVE_INFINITY, 800)).toBe(1);
  });
});

describe('loopOptionsFrom', () => {
  it('a legacy def (no loop fields) plays out — the pre-existing behaviour, unchanged', () => {
    expect(loopOptionsFrom({}, true)).toEqual({ loop: true, loopMode: 'playOut', loopJoinMs: 0 });
  });

  it('carries a seamless def’s loopMode + a negative join straight through', () => {
    expect(loopOptionsFrom({ loopMode: 'seamless', loopJoinMs: -40 }, true)).toEqual({
      loop: true,
      loopMode: 'seamless',
      loopJoinMs: -40,
    });
  });

  it('carries a positive join through too', () => {
    expect(loopOptionsFrom({ loopJoinMs: 80 }, true)).toEqual({ loop: true, loopMode: 'playOut', loopJoinMs: 80 });
  });

  it('passes through the caller’s `loop` flag unchanged, including false for a one-shot play', () => {
    expect(loopOptionsFrom({ loopMode: 'seamless', loopJoinMs: -40 }, false)).toEqual({
      loop: false,
      loopMode: 'seamless',
      loopJoinMs: -40,
    });
  });
});

describe('createRetire', () => {
  const spies = () => ({
    removeUpdater: vi.fn(),
    destroyPlayer: vi.fn(),
    unmountLayer: vi.fn(),
    destroyContainer: vi.fn(),
    onDone: vi.fn(),
  });

  it('runs every teardown step once, in lifecycle order, then onDone', () => {
    const t = spies();
    createRetire(t).retire();
    expect(t.removeUpdater).toHaveBeenCalledTimes(1);
    expect(t.destroyPlayer).toHaveBeenCalledTimes(1);
    expect(t.unmountLayer).toHaveBeenCalledTimes(1);
    expect(t.destroyContainer).toHaveBeenCalledTimes(1);
    expect(t.onDone).toHaveBeenCalledTimes(1);
    const order = [
      t.removeUpdater.mock.invocationCallOrder[0],
      t.destroyPlayer.mock.invocationCallOrder[0],
      t.unmountLayer.mock.invocationCallOrder[0],
      t.destroyContainer.mock.invocationCallOrder[0],
      t.onDone.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('is idempotent — cancelling twice never double-frees', () => {
    // A double `container.destroy()` is a crash, not a warning, and the cancel fn plus natural completion
    // are two independent paths into this same teardown.
    const t = spies();
    const { retire } = createRetire(t);
    retire();
    retire();
    retire();
    expect(t.destroyContainer).toHaveBeenCalledTimes(1);
    expect(t.onDone).toHaveBeenCalledTimes(1);
  });

  it('cancelling AFTER natural completion is a no-op', () => {
    const t = spies();
    const r = createRetire(t);
    r.retire(); // stands in for the updater retiring the play when it finishes
    expect(r.retired()).toBe(true);
    r.retire(); // the caller's cancel fn, fired later
    expect(t.destroyPlayer).toHaveBeenCalledTimes(1);
  });

  it('reports `retired` false until it runs (the per-frame re-entry guard)', () => {
    const r = createRetire(spies());
    expect(r.retired()).toBe(false);
    r.retire();
    expect(r.retired()).toBe(true);
  });

  it('survives an onDone that re-enters retire()', () => {
    const t = spies();
    let r: { retire(): void } | null = null;
    const reentrant = { ...t, onDone: vi.fn(() => r?.retire()) };
    r = createRetire(reentrant);
    expect(() => r?.retire()).not.toThrow();
    expect(reentrant.onDone).toHaveBeenCalledTimes(1);
    expect(reentrant.destroyContainer).toHaveBeenCalledTimes(1);
  });

  it('tolerates an absent onDone', () => {
    const t = spies();
    expect(() => createRetire({ ...t, onDone: undefined }).retire()).not.toThrow();
    expect(t.destroyContainer).toHaveBeenCalledTimes(1);
  });
});

describe('playDef', () => {
  it('returns null (and does not throw) for an unknown id', () => {
    expect(playDef('no-such-def-at-all', {})).toBeNull();
    expect(() => playDef('no-such-def-at-all', {})).not.toThrow();
  });

  it('returns null for an empty id', () => {
    expect(playDef('', {})).toBeNull();
  });

  it('returns null for a REAL def when there is no renderer', () => {
    // The prod / pre-attach / headless path: the def resolves, but `createPlayer` and every primitive's
    // `spawn` need a live renderer, so this declines instead of building against `null`.
    registerSavedDef(def([layer()], { id: 'test-play-no-renderer' }));
    expect(pixiFx.renderer).toBeNull();
    expect(playDef('test-play-no-renderer', { source: { x: 0, y: 0 }, target: { x: 10, y: 10 } })).toBeNull();
  });

  /**
   * THE AUX-CANVAS WAIT (owner report 2026-08-31: "the first prismatic pick doesn't trigger the animation" —
   * and only the first). `under` / `above` canvases are created lazily, so the first effect wanting one used
   * to be spent bringing it up. It now waits for the init and plays, and hands back a disposer that cancels a
   * retry still in flight.
   */
  it('an AUX-slot def waits for its canvas instead of dropping the fire', async () => {
    registerSavedDef(def([layer()], { id: 'test-play-above', slot: 'above' }));
    const spy = vi.spyOn(pixiFx, 'ensureAboveSlot');
    const stop = playDef('test-play-above', { source: { x: 0, y: 0 }, target: { x: 1, y: 1 } });
    expect(stop, 'the caller gets a handle, not a dropped fire').toBeTypeOf('function');
    expect(spy, 'and the canvas was asked to come up').toHaveBeenCalled();
    // The retry lands on a still-null renderer here (headless, no GL) and must STOP — an ungated retry would
    // spin on the memoised promise forever. Draining the microtask queue is what would expose that.
    await Promise.resolve();
    await Promise.resolve();
    expect(spy.mock.calls.length, 'exactly one retry, never a loop').toBeLessThanOrEqual(2);
    expect(() => stop?.(), 'and disposing is safe whether or not the retry ran').not.toThrow();
    spy.mockRestore();
  });

  it('the OVER slot still declines — a combat moment is past by the time a retry could land', () => {
    registerSavedDef(def([layer()], { id: 'test-play-over-slot' }));
    expect(playDef('test-play-over-slot', { source: { x: 0, y: 0 }, target: { x: 1, y: 1 } })).toBeNull();
  });

  it('never throws for any of its refusal paths', () => {
    registerSavedDef(def([layer({ muted: true })], { id: 'test-play-all-muted' }));
    expect(() => playDef('test-play-all-muted', {})).not.toThrow();
    expect(() => playDef('test-play-no-renderer', {}, { speed: 0 })).not.toThrow();
    expect(() => playDef('test-play-no-renderer', {}, { onDone: () => undefined })).not.toThrow();
  });
});

describe('canPlayDefs / ensureDefsReady', () => {
  it('is false before the primitives are loaded', () => {
    expect(listPrimitives()).toHaveLength(0);
    expect(canPlayDefs()).toBe(false);
  });

  it('stays false with primitives loaded but no renderer (the two halves are independent)', async () => {
    await ensureDefsReady();
    expect(listPrimitives().length).toBeGreaterThan(0);
    expect(pixiFx.renderer).toBeNull();
    expect(canPlayDefs()).toBe(false);
  });

  it('ensureDefsReady is idempotent and always resolves', async () => {
    await expect(ensureDefsReady()).resolves.toBeUndefined();
    await expect(ensureDefsReady()).resolves.toBeUndefined();
  });
});

/**
 * THE CAMERA ANCHOR (owner report 2026-08-31: Blast Pump "is going off in the top left of the screen ... even
 * though the anchor in the effect is screen center").
 *
 * `resolveAnchor` answers `ORIGIN` — (0, 0) — for any anchor the caller did not stage, so a camera-anchored
 * def played from a call site that staged only source/target landed in the corner. `withCamera` fills the one
 * anchor that never depended on the caller, at the chokepoint every authored effect passes through.
 */
describe('withCamera', () => {
  it('fills in the viewport centre when the caller staged no camera', () => {
    // The suite is headless, so the window is staged here — which is also the honest shape of the assertion:
    // the centre is read from the live viewport, not from a constant.
    // @ts-expect-error — a two-field stand-in is everything this helper reads
    globalThis.window = { innerWidth: 1600, innerHeight: 900 };
    try {
      const filled = withCamera({ source: { x: 10, y: 20 }, target: { x: 30, y: 40 } });
      expect(filled.camera, 'the corner is never the right answer for a camera anchor').toEqual({ x: 800, y: 450 });
      expect(filled.source, 'and it touches nothing else').toEqual({ x: 10, y: 20 });
      expect(filled.target).toEqual({ x: 30, y: 40 });
    } finally {
      // @ts-expect-error — restoring the headless default the rest of the suite runs under
      delete globalThis.window;
    }
  });

  it('never overrides a camera the caller DID stage', () => {
    // Three live call sites hand-roll the same expression, and the workbench stages its own from the sampled
    // viewport. A default that overwrote those would be a second, competing definition.
    const staged = { source: { x: 1, y: 2 }, camera: { x: 500, y: 600 } };
    expect(withCamera(staged), 'the caller wins').toBe(staged);
  });

  it('leaves the anchors untouched with no DOM (the pure lanes must not need a window)', () => {
    const bare = { source: { x: 1, y: 2 } };
    expect(withCamera(bare), 'no window, no camera — and no crash').toBe(bare);
  });
});
