import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer, FIRE_TIMEOUT_MS, LAYER_SEED_STRIDE } from './player';
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

// A single-layer def used by the fire-once tests below, where DEF's two-layer stagger would only add noise.
const SINGLE_DEF: FxDef = {
  id: 'single',
  duration: 200,
  layers: [{ primitive: 'c', anchor: 'target', at: 0, life: 200, params: {} }],
};

// A single layer with NO explicit `life`: it nominally ends at the def's duration, which is precisely the
// case where a fire must play to TRUE completion -- persisting past `duration` until the instance's own
// `isComplete()` says it's finished. (A layer that DOES declare a `life` is bounded by that window even in
// a fire -- see BOUNDED_DEF.)
const OPEN_DEF: FxDef = {
  id: 'open',
  duration: 200,
  layers: [{ primitive: 'c', anchor: 'target', at: 0, params: {} }],
};

// A short layer inside a much longer def: its `life` window closes at 200ms while the fire itself runs to
// 500ms, so it isolates "killed by its own life window" from "killed because the pass ended".
const BOUNDED_DEF: FxDef = {
  id: 'bounded',
  duration: 500,
  layers: [{ primitive: 'a', anchor: 'target', at: 0, life: 200, params: {} }],
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
  // continuous play/stop loop. A fire runs the def's per-layer `at`/`life` SCHEDULE exactly as ordinary
  // playback does, and differs only at the END of the pass: it never wraps, and an unbounded layer outlives
  // `def.duration` until it reports genuine completion (see the "completion" describe block below). These
  // target a player built with `{ loop: true }` specifically, since that's the case where fireOnce's
  // behavior actually has to fight the player's own settings.

  it('fireOnce starts a single pass at t=0, even on a looping player', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.fireOnce();
    expect(p.timeMs()).toBe(0);
    expect(p.isPlaying()).toBe(true);
  });

  // REGRESSION (defect 1): fireOnce used to spawn EVERY layer immediately, deliberately bypassing the
  // schedule. Since Fire is the headline button (and every workbench build auto-fires), that made the At /
  // Life sliders a designer had just dragged do nothing visible unless Loop was turned on.

  it('regression: fireOnce honours the per-layer `at` -- a later layer is not live at t=0 and spawns when its start arrives', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.fireOnce();
    expect(spawned.map((s) => s.id)).toEqual(['a']); // 'b' nominally starts at 200ms
    p.update(200);
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('regression: fireOnce honours the per-layer `life` -- a bounded layer dies when its window ends, mid-pass', () => {
    const p = createPlayer(BOUNDED_DEF, CTX); // layer at:0 life:200 inside a 500ms def
    p.fireOnce();
    const inst = spawned[spawned.length - 1].inst;
    p.update(250);
    expect(inst.destroy).toHaveBeenCalledTimes(1);
    // ...and the pass itself is still running -- the layer died on its own schedule, not because the fire ended.
    expect(p.isPlaying()).toBe(true);
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

  // Fire-once completion: the load-bearing contract. A fire must keep an UNBOUNDED layer (no explicit
  // `life`) alive past the def's nominal duration and only tear it down once it's genuinely finished --
  // per-instance `isComplete()` when the primitive implements it, falling back to "clock passed the
  // duration" when it doesn't, and always bounded by the FIRE_TIMEOUT_MS safety cap.

  describe('fireOnce completion', () => {
    it('keeps an unbounded layer alive past the def duration and stops only once isComplete() reports true', () => {
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
      const p = createPlayer(OPEN_DEF, CTX); // duration 200, layer declares NO life
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
      const p = createPlayer(OPEN_DEF, CTX); // unbounded, so nothing but the cap can end this pass
      p.fireOnce();
      p.update(FIRE_TIMEOUT_MS + 100);
      expect(p.isPlaying()).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  // setLayerTiming: the live At/Life path (defect 2). `at`/`life` used to be part of the workbench's
  // structureKey, so every step of those sliders tore the player down and rebuilt it -- restarting the
  // effect mid-drag and re-rolling a ribbon's noise seed on each respawn. They now arrive here as
  // overrides the scheduler consults instead of the def's own timing, exactly as setLayerParams does for
  // params: applied to the running effect, no respawn, no mutation of the caller's def.

  describe('setLayerTiming', () => {
    it('spawns a layer that a live `at` edit just made due, without respawning anything else', () => {
      const p = createPlayer(DEF, CTX);
      p.play();
      expect(spawned.map((s) => s.id)).toEqual(['a']); // 'b' is at:200, not due yet
      const a = spawned[0].inst;

      p.setLayerTiming(1, 0, null); // 'b' now starts immediately

      expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
      // The untouched layer is NOT respawned: same instance object, never destroyed, still ticking.
      expect(spawned[0].inst).toBe(a);
      expect(a.destroy).not.toHaveBeenCalled();
      p.update(16);
      expect(a.update).toHaveBeenCalledWith(16);
    });

    it('kills a layer whose window a live `life` edit just closed, leaving the others alone', () => {
      const p = createPlayer(DEF, CTX);
      p.play();
      p.update(250); // both live: 'a' 0..300, 'b' 200..300
      const a = spawned.find((s) => s.id === 'a')!.inst;
      const b = spawned.find((s) => s.id === 'b')!.inst;

      p.setLayerTiming(0, 0, 100); // 'a' window is now 0..100 -- already past

      expect(a.destroy).toHaveBeenCalledTimes(1);
      expect(b.destroy).not.toHaveBeenCalled();
    });

    it('is consulted INSTEAD of the def timing on a subsequent fire', () => {
      const p = createPlayer(DEF, CTX);
      p.setLayerTiming(1, 0, null); // 'b' moves from at:200 to at:0
      p.fireOnce();
      expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('never mutates the caller-owned def object', () => {
      const at = DEF.layers[1].at;
      const life = DEF.layers[1].life;
      const p = createPlayer(DEF, CTX);
      p.play();
      p.setLayerTiming(1, 0, null);
      expect(DEF.layers[1].at).toBe(at);
      expect(DEF.layers[1].life).toBe(life);
    });

    it('ignores an out-of-range index', () => {
      const p = createPlayer(DEF, CTX);
      p.play();
      expect(() => p.setLayerTiming(99, 0, null)).not.toThrow();
      expect(spawned.map((s) => s.id)).toEqual(['a']);
    });
  });

  // setSeed: the player's half of deterministic FX randomness (see fx/rng.ts). The primitives already accept
  // `ctx.seed`; this is what actually supplies it. The contract has three halves: unseeded must be EXACTLY
  // the old behaviour (nothing set, primitives roll their own), a seeded composition must give each layer a
  // DISTINCT stream (or two layers emit in lockstep), and -- the whole point -- the same seed must survive a
  // RESPAWN, so a tuning can be held still while you change everything else.

  describe('setSeed', () => {
    /** Registers `id` as a primitive that records the `ctx.seed` it was spawned with. */
    const seedProbe = (id: string, seen: (number | undefined)[]) =>
      registerPrimitive({
        id,
        params: {},
        spawn: (ctx: FxContext) => {
          seen.push(ctx.seed);
          const inst: FxInstance = { update: vi.fn(), setParams: vi.fn(), destroy: vi.fn() };
          spawned.push({ id, inst });
          return inst;
        },
      });

    const probeDef = (seen: (number | undefined)[]): void => {
      clearPrimitives();
      seedProbe('a', seen);
      seedProbe('b', seen);
    };

    it('is unseeded by default — ctx.seed is undefined, so each instance rolls its own (today\'s behaviour)', () => {
      const seen: (number | undefined)[] = [];
      probeDef(seen);
      const p = createPlayer(DEF, CTX);
      p.play();
      p.update(200); // brings layer 'b' in too
      expect(seen).toEqual([undefined, undefined]);
    });

    it('setSeed(null) is unseeded', () => {
      const seen: (number | undefined)[] = [];
      probeDef(seen);
      const p = createPlayer(DEF, CTX);
      p.setSeed(null);
      p.play();
      expect(seen).toEqual([undefined]);
    });

    it('setSeed(n) gives every layer a DISTINCT seed DERIVED from the base and the layer index', () => {
      const seen: (number | undefined)[] = [];
      probeDef(seen);
      const p = createPlayer(DEF, CTX);
      p.setSeed(1234);
      p.play();
      p.update(200);
      expect(seen).toEqual([1234, 1234 + LAYER_SEED_STRIDE]);
      expect(seen[0]).not.toBe(seen[1]); // two layers must never share a stream
    });

    it('REPRODUCES the same per-layer seeds across a respawn (the whole point)', () => {
      const seen: (number | undefined)[] = [];
      probeDef(seen);
      const p = createPlayer(DEF, CTX);
      p.setSeed(99);
      p.fireOnce();
      p.update(200);
      const firstPass = seen.slice();
      expect(firstPass).toHaveLength(2);

      p.fireOnce(); // tears every layer down and spawns fresh ones
      p.update(200);
      expect(seen.slice(2)).toEqual(firstPass);
    });

    it('an unseeded player does NOT reproduce anything (the seeds it hands out stay undefined)', () => {
      const seen: (number | undefined)[] = [];
      probeDef(seen);
      const p = createPlayer(DEF, CTX);
      p.fireOnce();
      p.setSeed(7);
      p.setSeed(null); // back to unseeded
      p.fireOnce();
      expect(seen.every((s) => s === undefined)).toBe(true);
    });

    it('takes effect on the NEXT spawn — a live layer is not respawned when the seed changes', () => {
      const seen: (number | undefined)[] = [];
      probeDef(seen);
      const p = createPlayer(DEF, CTX);
      p.play();
      const live = spawned[0].inst;
      const countBefore = spawned.length;

      p.setSeed(4242);

      expect(spawned).toHaveLength(countBefore); // nothing respawned
      expect(live.destroy).not.toHaveBeenCalled();
      expect(seen).toEqual([undefined]); // the live instance kept the seed it spawned with

      p.fireOnce(); // ...and the new seed lands on the next spawn
      expect(seen[seen.length - 1]).toBe(4242);
    });

    it('ignores a non-finite seed rather than poisoning every spawn with NaN', () => {
      const seen: (number | undefined)[] = [];
      probeDef(seen);
      const p = createPlayer(DEF, CTX);
      p.setSeed(Number.NaN);
      p.play();
      expect(seen).toEqual([undefined]);
    });
  });

  // setLayerMuted: isolating one layer of a composition used to mean DELETING the others (losing their
  // tuning, with no undo). Mute is deliberately a LIVE player call rather than part of the workbench's
  // structureKey: muting one layer must not restart -- and therefore re-roll -- every other layer.

  describe('setLayerMuted', () => {
    it('does not spawn a muted layer', () => {
      const p = createPlayer(DEF, CTX);
      p.setLayerMuted(1, true);
      p.play();
      p.update(200); // 'b' would be due here
      expect(spawned.map((s) => s.id)).toEqual(['a']);
    });

    it('kills a live layer when it is muted, leaving the others untouched', () => {
      const p = createPlayer(DEF, CTX);
      p.play();
      p.update(250); // both live
      const a = spawned.find((s) => s.id === 'a')!.inst;
      const b = spawned.find((s) => s.id === 'b')!.inst;

      p.setLayerMuted(1, true);

      expect(b.destroy).toHaveBeenCalledTimes(1);
      expect(a.destroy).not.toHaveBeenCalled();
    });

    it('brings a layer back when unmuted, if the clock says it is due', () => {
      const p = createPlayer(DEF, CTX);
      p.setLayerMuted(0, true);
      p.play();
      expect(spawned.map((s) => s.id)).toEqual([]);

      p.setLayerMuted(0, false);
      expect(spawned.map((s) => s.id)).toEqual(['a']);
    });

    it('is an exact no-op by default (nothing muted) and when re-setting the same value', () => {
      const p = createPlayer(DEF, CTX);
      p.play();
      const a = spawned[0].inst;
      const countBefore = spawned.length;

      p.setLayerMuted(0, false); // already unmuted

      expect(spawned).toHaveLength(countBefore);
      expect(a.destroy).not.toHaveBeenCalled();
      p.update(200);
      expect(spawned.map((s) => s.id)).toEqual(['a', 'b']); // schedule entirely unaffected
    });

    it('survives a fire: a muted layer stays absent for the whole pass', () => {
      const p = createPlayer(DEF, CTX);
      p.setLayerMuted(0, true);
      p.fireOnce();
      p.update(250);
      expect(spawned.map((s) => s.id)).toEqual(['b']);
    });

    it('ignores an out-of-range index', () => {
      const p = createPlayer(DEF, CTX);
      p.play();
      expect(() => p.setLayerMuted(99, true)).not.toThrow();
      expect(spawned.map((s) => s.id)).toEqual(['a']);
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
