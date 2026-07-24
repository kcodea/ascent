import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer, FIRE_TIMEOUT_MS } from './player';
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

// A single-layer def used by the fire-once completion tests below, where DEF's two-layer stagger would
// only add noise.
const SINGLE_DEF: FxDef = {
  id: 'single',
  duration: 200,
  layers: [{ primitive: 'c', anchor: 'target', at: 0, life: 200, params: {} }],
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

  // fireOnce(): the workbench's "Fire" trigger for a discrete, single preview pass -- distinct from the
  // continuous play/stop loop. As of the fire-once rework, a fire is decoupled from the def's nominal
  // duration/schedule entirely: every layer spawns immediately and stays alive until it reports genuine
  // completion (see the "completion" describe block below for that contract). These target a player built
  // with `{ loop: true }` specifically, since that's the case where fireOnce's behavior actually has to
  // fight the player's own settings.

  it('fireOnce starts a single pass at t=0 and spawns every layer immediately, even on a looping player', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.fireOnce();
    expect(p.timeMs()).toBe(0);
    expect(p.isPlaying()).toBe(true);
    // Fire-once is no longer gated on each layer's `at` -- both layers (one nominally starting at 200ms)
    // spawn together so the whole effect plays out as one discrete event.
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('fireOnce (fallback, no isComplete) stops once the clock passes the def duration -- it does not wrap even on a looping player', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.fireOnce();
    p.update(520); // past duration (500); a looping player would normally wrap to 20
    // Fire-once does NOT clamp the clock to the def's duration -- it tracks genuine elapsed time until
    // completion, which for a primitive with no isComplete() is "the clock passed the duration".
    expect(p.timeMs()).toBe(520);
    expect(p.isPlaying()).toBe(false);
  });

  it('fireOnce is repeatable: calling it again restarts the pass from t=0', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.fireOnce();
    p.update(520); // let the first pass finish (fallback completion once clock passes duration)
    expect(p.isPlaying()).toBe(false);
    const spawnCountAtFinish = spawned.length;

    p.fireOnce();
    expect(p.timeMs()).toBe(0);
    expect(p.isPlaying()).toBe(true);
    expect(spawned.length).toBeGreaterThan(spawnCountAtFinish);
  });

  it('a normal play() after fireOnce clears the override -- looping resumes on the next update', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.fireOnce();
    p.play(); // switches back to the player's own (looping) behavior before the one-shot pass finishes
    p.update(520);
    expect(p.timeMs()).toBe(20); // wrapped, exactly like the plain "loops back to zero" case
    expect(p.isPlaying()).toBe(true);
  });

  it('a normal play() after fireOnce naturally finishes also resumes looping', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.fireOnce();
    p.update(520); // the one-shot pass runs to completion (fallback) and stops; clock is NOT clamped to 500
    expect(p.isPlaying()).toBe(false);
    expect(p.timeMs()).toBe(520);

    p.play();
    expect(p.isPlaying()).toBe(true);
    p.update(10);
    // The fire's overshoot (520 vs. the def's 500ms duration) is genuine elapsed time, not discarded --
    // it carries into the wrap arithmetic exactly like real elapsed time would: 520 + 10 = 530, wraps once
    // past 500 -> 30.
    expect(p.timeMs()).toBe(30);
  });

  it('threads ctx.oneShot=true into layers spawned by fireOnce, and false/absent for a normal play()', () => {
    clearPrimitives();
    const ctxSeen: (boolean | undefined)[] = [];
    registerPrimitive({
      id: 'c',
      params: {},
      spawn: (spawnCtx: FxContext) => {
        ctxSeen.push(spawnCtx.oneShot);
        const inst: FxInstance = { update: vi.fn(), setParams: vi.fn(), destroy: vi.fn() };
        return inst;
      },
    });
    const p = createPlayer(SINGLE_DEF, CTX);

    p.play();
    expect(ctxSeen).toHaveLength(1);
    expect(ctxSeen[0]).toBeFalsy();

    p.fireOnce();
    expect(ctxSeen).toHaveLength(2);
    expect(ctxSeen[1]).toBe(true);
  });

  // Fire-once completion: the load-bearing contract. A fire must keep a layer alive past the def's nominal
  // duration and only tear it down once it's genuinely finished, per-instance `isComplete()` when the
  // primitive implements it, falling back to "clock passed the duration" when it doesn't, and always
  // bounded by the FIRE_TIMEOUT_MS safety cap.

  describe('fireOnce completion', () => {
    it('keeps a layer alive past the def duration and stops only once isComplete() reports true', () => {
      clearPrimitives();
      let ticks = 0;
      registerPrimitive({
        id: 'c',
        params: {},
        spawn: () => {
          const inst: FxInstance = {
            update: vi.fn(() => {
              ticks += 1;
            }),
            setParams: vi.fn(),
            destroy: vi.fn(),
            isComplete: () => ticks >= 3,
          };
          spawned.push({ id: 'c', inst });
          return inst;
        },
      });
      const p = createPlayer(SINGLE_DEF, CTX); // duration 200
      p.fireOnce();
      const inst = spawned[spawned.length - 1].inst;

      p.update(250); // tick 1 -- past the def's 200ms duration, but isComplete() is still false
      expect(p.isPlaying()).toBe(true);
      expect(inst.destroy).not.toHaveBeenCalled();

      p.update(10); // tick 2 -- still not complete
      expect(p.isPlaying()).toBe(true);
      expect(inst.destroy).not.toHaveBeenCalled();

      p.update(10); // tick 3 -- isComplete() now true
      expect(p.isPlaying()).toBe(false);
      expect(inst.destroy).toHaveBeenCalledTimes(1);
    });

    it('falls back to the def duration when the primitive has no isComplete()', () => {
      clearPrimitives();
      registerPrimitive({
        id: 'c',
        params: {},
        spawn: () => {
          const inst: FxInstance = { update: vi.fn(), setParams: vi.fn(), destroy: vi.fn() };
          spawned.push({ id: 'c', inst });
          return inst;
        },
      });
      const p = createPlayer(SINGLE_DEF, CTX); // duration 200
      p.fireOnce();
      p.update(199);
      expect(p.isPlaying()).toBe(true);
      p.update(1); // clock now 200 -- clock >= duration triggers the fallback
      expect(p.isPlaying()).toBe(false);
    });

    it('force-stops at the safety cap and warns if isComplete() never reports true', () => {
      clearPrimitives();
      registerPrimitive({
        id: 'c',
        params: {},
        spawn: () => {
          const inst: FxInstance = {
            update: vi.fn(),
            setParams: vi.fn(),
            destroy: vi.fn(),
            isComplete: () => false, // never completes
          };
          spawned.push({ id: 'c', inst });
          return inst;
        },
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = createPlayer(SINGLE_DEF, CTX);
      p.fireOnce();
      p.update(FIRE_TIMEOUT_MS + 100);
      expect(p.isPlaying()).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  // loopGapMs: continuous-loop tuning aid, unrelated to fireOnce -- a pause between cycles so the effect
  // visibly clears before restarting.

  describe('loopGapMs', () => {
    it('holds the clock at duration with layers despawned, then respawns after the gap elapses', () => {
      const p = createPlayer(DEF, CTX, { loop: true, loopGapMs: 50 });
      p.play();
      const a0 = spawned.find((s) => s.id === 'a')!.inst;

      p.update(500); // reaches duration exactly -- should enter the gap, not wrap
      expect(p.timeMs()).toBe(500);
      expect(a0.destroy).toHaveBeenCalledTimes(1);
      const spawnCountAtGapStart = spawned.length;

      p.update(30); // still inside the 50ms gap
      expect(p.timeMs()).toBe(500);
      expect(spawned.length).toBe(spawnCountAtGapStart); // nothing respawned yet

      p.update(20); // gap elapses (30 + 20 = 50) -- wraps to a fresh cycle at clock 0
      expect(p.timeMs()).toBe(0);
      expect(spawned.length).toBeGreaterThan(spawnCountAtGapStart); // layer 'a' respawned for the new cycle
    });

    it('keeps the old immediate-wrap behaviour when loopGapMs is 0 (the default)', () => {
      const p = createPlayer(DEF, CTX, { loop: true });
      p.play();
      p.update(500);
      // No gap configured -- wraps straight to 0, no held frame at duration.
      expect(p.timeMs()).toBe(0);
    });

    it('setLoopGap changes the gap live', () => {
      const p = createPlayer(DEF, CTX, { loop: true });
      p.setLoopGap(50);
      p.play();
      p.update(500);
      expect(p.timeMs()).toBe(500); // now enters a gap instead of wrapping immediately
      p.update(50);
      expect(p.timeMs()).toBe(0);
    });
  });
});
