import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from './player';
import { clearPrimitives, registerPrimitive } from './registry';
import type { FxContext, FxInstance } from './primitive';
import type { FxDef } from './def';

const spawned: { id: string; inst: FxInstance }[] = [];

const stubPrimitive = (id: string) => ({
  id,
  params: { size: { kind: 'slider' as const, label: 'Size', min: 0, max: 10, step: 1, default: 5 } },
  spawn: () => {
    const inst: FxInstance = { update: vi.fn(), setParams: vi.fn(), destroy: vi.fn() };
    spawned.push({ id, inst });
    return inst;
  },
});

const CTX = { container: { addChild: vi.fn(), removeChild: vi.fn() }, renderer: {} } as unknown as FxContext;

const DEF: FxDef = {
  id: 'test',
  duration: 500,
  layers: [
    { primitive: 'a', anchor: 'target', at: 0, life: 300, params: {} },
    { primitive: 'b', anchor: 'target', at: 200, life: 100, params: {} },
  ],
};

// A layer spanning the ENTIRE duration never naturally passes through a 'done' state as the clock
// advances, so it's the case that exposes whether a loop wrap actually tears down and restarts a layer,
// or just lets the original instance silently carry across the boundary.
const FULLSPAN_DEF: FxDef = {
  id: 'fullspan',
  duration: 500,
  layers: [{ primitive: 'a', anchor: 'target', at: 0, life: 500, params: {} }],
};

describe('createPlayer', () => {
  beforeEach(() => {
    spawned.length = 0;
    clearPrimitives();
    registerPrimitive(stubPrimitive('a'));
    registerPrimitive(stubPrimitive('b'));
  });

  it('spawns a layer only when its start time is reached', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    expect(spawned.map((s) => s.id)).toEqual(['a']);
    p.update(200);
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('destroys a layer when its life elapses', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.update(299);
    expect(a.destroy).not.toHaveBeenCalled();
    p.update(2);
    expect(a.destroy).toHaveBeenCalledTimes(1);
  });

  it('scales elapsed time by speed', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.setSpeed(2);
    p.update(100);
    expect(p.timeMs()).toBe(200);
  });

  it('scrub rebuilds state at an arbitrary time', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.scrub(250);
    expect(p.timeMs()).toBe(250);
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('scrubbing backwards destroys layers that have not started yet', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.scrub(250);
    const b = spawned.find((s) => s.id === 'b')!.inst;
    p.scrub(50);
    expect(b.destroy).toHaveBeenCalled();
  });

  it('loops back to zero at the duration when looping is on', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.play();
    p.update(520);
    expect(p.timeMs()).toBe(20);
  });

  it('stops at the duration when looping is off', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(520);
    expect(p.timeMs()).toBe(500);
    expect(p.isPlaying()).toBe(false);
  });

  it('destroys every live layer on stop', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(200);
    p.stop();
    for (const s of spawned) expect(s.inst.destroy).toHaveBeenCalled();
  });

  it('does not advance while paused', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.pause();
    p.update(100);
    expect(p.timeMs()).toBe(0);
  });

  it('pushes edited params to a live layer without respawning it', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.setLayerParams(0, { size: 9 });
    expect(a.setParams).toHaveBeenCalledWith({ size: 9 });
    expect(spawned).toHaveLength(1);
  });

  // Regression: the `{ size: 9 }` case above is in-range, so it passes through identically whether or not
  // `setLayerParams` routes through `coerceParams` first -- it can't catch a future "simplification" that
  // drops the coerce call. These two only pass BECAUSE of the coercion.

  it('regression: setLayerParams clamps an out-of-range live edit before it reaches the primitive', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.setLayerParams(0, { size: 999 }); // spec is min:0, max:10
    expect(a.setParams).toHaveBeenCalledWith({ size: 10 });
  });

  it('regression: setLayerParams falls back to the spec default for a wrong-typed live edit', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.setLayerParams(0, { size: 'huge' });
    expect(a.setParams).toHaveBeenCalledWith({ size: 5 }); // spec default; the string is dropped, not coerced
  });

  it('forwards setHead to the live layer and ignores primitives that do not implement it', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    expect(() => p.setHead(0, 10, 20)).not.toThrow();
    expect(() => p.setHead(99, 10, 20)).not.toThrow();
  });

  // Regression tests for the three bugs found in self-review of the first cut of this player. Each was
  // confirmed to fail against the buggy version of player.ts before being folded in here — see the PR
  // description / devlog for the revert-check results.

  it('regression: a loop wrap destroys and respawns a full-duration layer instead of carrying the same instance across the boundary', () => {
    const p = createPlayer(FULLSPAN_DEF, CTX, { loop: true });
    p.play();
    expect(spawned).toHaveLength(1);
    const first = spawned[0].inst;

    // Step up close to the boundary first...
    p.update(490);
    expect(p.timeMs()).toBe(490);
    expect(first.destroy).not.toHaveBeenCalled();

    // ...then cross it in one step that does NOT land exactly on the boundary (490 + 40 = 530 -> wraps to
    // 30). layerStateAt alone can't see this crossing -- only a clock jump from 490 straight to 30 -- so
    // if the wrap doesn't force a teardown, `first` would simply still be live at t=30 with a stale
    // instance from the previous cycle.
    p.update(40);
    expect(p.timeMs()).toBe(30);

    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(spawned).toHaveLength(2);
  });

  it('regression: play() after natural completion (non-looping) restarts the clock at 0 and respawns layers', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(520); // runs past duration -> clamps to 500 and stops
    expect(p.timeMs()).toBe(500);
    expect(p.isPlaying()).toBe(false);
    const spawnCountAtFinish = spawned.length;

    p.play(); // press play again after finishing
    expect(p.timeMs()).toBe(0);
    expect(p.isPlaying()).toBe(true);
    expect(spawned.length).toBeGreaterThan(spawnCountAtFinish);
  });

  it('regression: play() after a mid-playback pause resumes without resetting the clock', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(150); // well short of duration (500) -- not finished
    expect(p.timeMs()).toBe(150);
    p.pause();
    expect(p.isPlaying()).toBe(false);

    p.play();
    // This is a RESUME, not a restart -- unlike the "finished" case above, the clock must be untouched.
    expect(p.timeMs()).toBe(150);
    expect(p.isPlaying()).toBe(true);
  });

  it('regression: setLayerParams never mutates the caller-owned def object', () => {
    const originalParamsRef = DEF.layers[0].params;
    const p = createPlayer(DEF, CTX);
    p.play();
    p.setLayerParams(0, { size: 9 });
    expect(DEF.layers[0].params).toBe(originalParamsRef);
    expect(DEF.layers[0].params).toEqual({});
  });
});
