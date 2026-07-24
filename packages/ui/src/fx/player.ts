import { Container } from 'pixi.js';
import { coerceParams } from './params';
import type { FxParamSpecs, ParamsOf } from './params';
import { layerStateAt, type FxDef } from './def';
import { getPrimitive } from './registry';
import type { FxContext, FxInstance } from './primitive';

export interface FxPlayerOptions {
  loop?: boolean;
  /** Continuous-loop only: hold at the def's duration (layers despawned, effect visibly cleared) for this
   *  many ms before restarting the cycle at 0. 0 (default) preserves the old immediate-wrap behaviour. Live
   *  tunable via `setLoopGap`. */
  loopGapMs?: number;
}

export interface FxPlayer {
  play(): void;
  pause(): void;
  stop(): void;
  fireOnce(): void;
  update(dtMs: number): void;
  scrub(ms: number): void;
  setSpeed(n: number): void;
  /** Turn continuous looping on/off live (the workbench's Loop toggle). Independent of `fireOnce`, which
   *  is always a single non-looping pass regardless of this. */
  setLoop(on: boolean): void;
  setLoopGap(ms: number): void;
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

/** Fire-once safety valve: if a primitive's `isComplete()` never reports true (a bug, or an effect that
 *  legitimately never terminates), force-stop the pass after this much simulated time rather than let a
 *  "Fire" hang the workbench forever. Exported so tests can drive exactly to the boundary. */
export const FIRE_TIMEOUT_MS = 10_000;

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
  let loopGapMs = Math.max(0, opts.loopGapMs ?? 0);
  // Mutable so the workbench's Loop toggle can flip it live (via setLoop) without rebuilding the player.
  let loopEnabled = opts.loop ?? false;

  // Set only while a fireOnce() pass is in flight. A fire is a fundamentally different lifecycle from
  // ordinary play: every layer spawns immediately (not gated on the def's per-layer `at`/`life` schedule)
  // and stays alive until it reports genuine completion, wholly decoupled from `def.duration`. Cleared the
  // moment the pass stops (naturally, via the safety cap, or because play()/stop() was called), so it never
  // leaks into ordinary playback once the one-shot preview is done.
  let firing = false;

  // Set while a looping player is holding at `def.duration` between cycles (see `loopGapMs`). The clock
  // stays pinned at `def.duration` for the duration of the gap; `gapElapsed` is a separate counter tracking
  // how far into the gap we are, so `timeMs()` reads as "held at the end" rather than ticking past it.
  let inGap = false;
  let gapElapsed = 0;

  const spawn = (index: number, oneShot = false): void => {
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
    const primCtx: FxContext = { container, renderer: ctx.renderer, oneShot };
    const inst = prim.spawn(primCtx, coerceParams(prim.params, merged));
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

  /** Bring live layers in line with the clock, then tick the survivors. Only used for ordinary (non-firing)
   *  playback — a fireOnce() pass bypasses this entirely (see `update`'s `firing` branch), since fire-once
   *  layers must NOT be despawned by the def's nominal schedule. */
  const reconcile = (dtMs: number): void => {
    const states = layerStateAt(def, clock);
    states.forEach((s, i) => {
      if (s.state === 'active') spawn(i);
      else kill(i);
    });
    if (dtMs > 0) for (const l of live.values()) l.inst.update(dtMs);
  };

  /** Whether every currently-live layer is done, for fire-once completion. A layer whose instance doesn't
   *  implement `isComplete` falls back to "the clock has passed the def's nominal duration" so a primitive
   *  that never implements the contract still terminates instead of hanging forever (short of the safety
   *  cap). */
  const allFiringLayersDone = (): boolean => {
    for (const l of live.values()) {
      const done = l.inst.isComplete ? l.inst.isComplete() : clock >= def.duration;
      if (!done) return false;
    }
    return true;
  };

  return {
    play(): void {
      // A fire in flight is a different lifecycle (immediate spawn of every layer, oneShot ctx) than
      // ordinary playback -- switching to play() must tear those layers down so reconcile() below respawns
      // them fresh under the normal schedule, without the oneShot flag.
      if (firing) {
        firing = false;
        killAllLive();
      }
      inGap = false;
      gapElapsed = 0;
      // Replaying after natural completion (non-looping) should restart from the top, like a video
      // player's play button — otherwise the clock is already >= duration and the very next update()
      // would immediately re-stop it with nothing ever spawning. Mid-playback pause() never moves the
      // clock, so this only triggers exactly for "finished, click play again".
      if (!loopEnabled && clock >= def.duration) {
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
      // Always restarts from t=0 for a single pass, regardless of the player's current state
      // (playing/paused/stopped) or how it was constructed -- the workbench's "Fire" trigger for a
      // discrete, one-off preview (e.g. one combat proc) distinct from the continuous play/stop loop.
      // Every layer spawns immediately (not gated on its `at`/`life` window) and stays alive until it
      // genuinely finishes -- see `update`'s `firing` branch and `allFiringLayersDone`.
      clock = 0;
      inGap = false;
      gapElapsed = 0;
      killAllLive();
      firing = true;
      playing = true;
      for (let i = 0; i < def.layers.length; i++) spawn(i, true);
    },
    stop(): void {
      // Distinct from destroy(): stop() is a playback control that resets the clock and leaves the
      // player usable — play() can be called again and starts a fresh run from zero. destroy() is
      // lifecycle teardown (e.g. the editor unmounting) and makes no promise the player can be reused.
      playing = false;
      clock = 0;
      firing = false;
      inGap = false;
      gapElapsed = 0;
      killAllLive();
    },
    update(dtMs: number): void {
      if (!playing) return;
      const dt = dtMs * speed;

      if (firing) {
        clock += dt;
        if (dt > 0) for (const l of live.values()) l.inst.update(dt);
        if (clock >= FIRE_TIMEOUT_MS) {
          console.warn(
            `[fx] fireOnce for def '${def.id}' exceeded the ${FIRE_TIMEOUT_MS}ms safety cap without ` +
              `isComplete() reporting true on every layer -- force-stopping.`,
          );
          killAllLive();
          playing = false;
          firing = false;
          return;
        }
        if (allFiringLayersDone()) {
          killAllLive();
          playing = false;
          firing = false;
        }
        return;
      }

      if (inGap) {
        gapElapsed += dt;
        if (gapElapsed < loopGapMs) return;
        // Gap elapsed -- start a fresh cycle. Any time beyond the gap's own length carries into the new
        // cycle's clock, the same "don't discard real elapsed time" treatment the no-gap wrap below gives
        // overshoot past `def.duration`.
        const overflow = gapElapsed - loopGapMs;
        inGap = false;
        gapElapsed = 0;
        clock = overflow > 0 ? Math.min(overflow, def.duration) : 0;
        reconcile(overflow > 0 ? overflow : 0);
        return;
      }

      clock += dt;
      const looping = loopEnabled;
      if (clock >= def.duration) {
        if (looping) {
          if (loopGapMs > 0) {
            // Hold at the duration with everything despawned instead of wrapping immediately -- the
            // effect visibly clears before the next cycle starts. `update`'s `inGap` branch above takes
            // over from here once playing resumes.
            clock = def.duration;
            killAllLive();
            inGap = true;
            gapElapsed = 0;
            return;
          }
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
        }
      }
      reconcile(dt);
    },
    scrub(ms: number): void {
      clock = Math.min(def.duration, Math.max(0, ms));
      reconcile(0);
    },
    setSpeed(n: number): void {
      speed = n;
    },
    setLoop(on: boolean): void {
      loopEnabled = on;
    },
    setLoopGap(ms: number): void {
      loopGapMs = Math.max(0, ms);
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
