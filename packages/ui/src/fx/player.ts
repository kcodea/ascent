import { Container } from 'pixi.js';
import { coerceParams } from './params';
import type { FxParamSpecs, ParamsOf } from './params';
import { layerStateAt, type FxDef } from './def';
import { getPrimitive } from './registry';
import type { FxContext, FxInstance } from './primitive';

export interface FxPlayerOptions {
  loop?: boolean;
}

export interface FxPlayer {
  play(): void;
  pause(): void;
  stop(): void;
  fireOnce(): void;
  update(dtMs: number): void;
  scrub(ms: number): void;
  setSpeed(n: number): void;
  setLayerParams(index: number, next: Record<string, unknown>): void;
  setHead(index: number, x: number, y: number): void;
  timeMs(): number;
  isPlaying(): boolean;
  destroy(): void;
}

// At the registry boundary a primitive's specific `S` is erased to the default `FxParamSpecs`, so every
// live instance's params type is `ParamsOf<FxParamSpecs>` (= `Record<string, string | number | boolean>`,
// see primitive.ts) rather than `unknown` — real typing survives erasure.
interface Live {
  inst: FxInstance<ParamsOf<FxParamSpecs>>;
  container: Container;
}

/**
 * Drives an `FxDef`. Owns layer lifetimes, the clock, and scrubbing. Deliberately has no idea how any
 * primitive renders — that indirection is why one player can be optimised on behalf of every effect.
 *
 * `def` is treated as read-only: the player never mutates it (see `setLayerParams`), so the same object a
 * caller (e.g. the editor's React state) holds can be handed in without the player fighting it for
 * ownership.
 */
export function createPlayer(def: FxDef, ctx: FxContext, opts: FxPlayerOptions = {}): FxPlayer {
  const live = new Map<number, Live>();
  // Live param edits, keyed by layer index. Kept here instead of writing into `def.layers[i].params` so the
  // player never mutates a def object the caller may hold in its own state (e.g. React) — see self-review.
  const overrides = new Map<number, Record<string, unknown>>();
  let clock = 0;
  let speed = 1;
  let playing = false;
  // Set only while a fireOnce() pass is in flight -- forces update()'s wrap logic to treat THIS pass as
  // non-looping even when the player was constructed with `{ loop: true }`. Cleared the moment the pass
  // naturally stops (reaches duration) or the next play()/fireOnce() call, so it never leaks into ordinary
  // playback once the one-shot preview is done.
  let oneShot = false;

  const spawn = (index: number): void => {
    if (live.has(index)) return;
    const layer = def.layers[index];
    const prim = getPrimitive(layer.primitive);
    if (!prim) {
      console.warn(`[fx] def '${def.id}' references unknown primitive '${layer.primitive}'`);
      return;
    }
    const container = new Container();
    ctx.container.addChild(container);
    const merged = { ...layer.params, ...overrides.get(index) };
    const inst = prim.spawn({ container, renderer: ctx.renderer }, coerceParams(prim.params, merged));
    live.set(index, { inst, container });
  };

  const kill = (index: number): void => {
    const l = live.get(index);
    if (!l) return;
    l.inst.destroy();
    l.container.destroy({ children: true });
    live.delete(index);
  };

  const killAllLive = (): void => {
    for (const i of [...live.keys()]) kill(i);
  };

  /** Bring live layers in line with the clock, then tick the survivors. */
  const reconcile = (dtMs: number): void => {
    const states = layerStateAt(def, clock);
    states.forEach((s, i) => {
      if (s.state === 'active') spawn(i);
      else kill(i);
    });
    if (dtMs > 0) for (const l of live.values()) l.inst.update(dtMs);
  };

  return {
    play(): void {
      // Replaying after natural completion (non-looping) should restart from the top, like a video
      // player's play button — otherwise the clock is already >= duration and the very next update()
      // would immediately re-stop it with nothing ever spawning. Mid-playback pause() never moves the
      // clock, so this only triggers exactly for "finished, click play again".
      oneShot = false;
      if (!opts.loop && clock >= def.duration) {
        clock = 0;
        killAllLive();
      }
      playing = true;
      reconcile(0);
    },
    pause(): void {
      playing = false;
    },
    fireOnce(): void {
      // Always restarts from t=0 for a single non-looping pass, regardless of the player's current state
      // (playing/paused/stopped) or how it was constructed -- the workbench's "Fire" trigger for a
      // discrete, one-off preview (e.g. one combat proc) distinct from the continuous play/stop loop.
      oneShot = true;
      clock = 0;
      killAllLive();
      playing = true;
      reconcile(0);
    },
    stop(): void {
      // Distinct from destroy(): stop() is a playback control that resets the clock and leaves the
      // player usable — play() can be called again and starts a fresh run from zero. destroy() is
      // lifecycle teardown (e.g. the editor unmounting) and makes no promise the player can be reused.
      playing = false;
      clock = 0;
      oneShot = false;
      killAllLive();
    },
    update(dtMs: number): void {
      if (!playing) return;
      clock += dtMs * speed;
      // A fireOnce() pass forces non-looping behavior for this pass even if the player was built with
      // `{ loop: true }` -- see the `oneShot` declaration above.
      const looping = !oneShot && opts.loop;
      if (clock >= def.duration) {
        if (looping) {
          // Wrapping starts a NEW cycle: every layer must die and respawn fresh, even one whose life
          // spans the entire duration and would otherwise never pass through a 'done' state to trigger
          // a natural kill (layerStateAt only sees the post-wrap clock, not the crossing). Without this,
          // a full-duration layer's original instance silently survives across the loop boundary and
          // never restarts its own internal animation/state for the new cycle.
          while (clock >= def.duration) clock -= def.duration;
          killAllLive();
        } else {
          clock = def.duration;
          playing = false;
          oneShot = false;
        }
      }
      reconcile(dtMs * speed);
    },
    scrub(ms: number): void {
      clock = Math.min(def.duration, Math.max(0, ms));
      reconcile(0);
    },
    setSpeed(n: number): void {
      speed = n;
    },
    setLayerParams(index: number, next: Record<string, unknown>): void {
      const merged = { ...overrides.get(index), ...next };
      overrides.set(index, merged);
      const l = live.get(index);
      if (!l) return;
      const layer = def.layers[index];
      const prim = getPrimitive(layer.primitive);
      if (!prim) return;
      // Route the edit through the same coerce step spawn() uses, so `setParams` receives a real
      // `ParamsOf<S>` (defaults filled, out-of-range values clamped/dropped) instead of an untyped patch.
      l.inst.setParams(coerceParams(prim.params, { ...layer.params, ...merged }));
    },
    setHead(index: number, x: number, y: number): void {
      live.get(index)?.inst.setHead?.(x, y);
    },
    timeMs: () => clock,
    isPlaying: () => playing,
    destroy(): void {
      killAllLive();
    },
  };
}
