import { Container } from 'pixi.js';
import { coerceParams } from './params';
import type { FxParamSpecs, ParamsOf } from './params';
import { layerStateOf, type FxDef, type FxLayerState } from './def';
import { MIN_CURVE_POINTS, sampleCurve } from './curve';
import { getPrimitive } from './registry';
import type { FxContext, FxInstance } from './primitive';

export interface FxPlayerOptions {
  loop?: boolean;
  /** Continuous-loop only: hold at the def's duration (layers despawned, effect visibly cleared) for this
   *  many ms before restarting the cycle at 0. 0 (default) preserves the old immediate-wrap behaviour. Live
   *  tunable via `setLoopGap`. */
  loopGapMs?: number;
  /** How a loop boundary is crossed. `'playOut'` (the default, and byte-for-byte the historical behaviour)
   *  culls every live instance at the boundary and respawns the next cycle from scratch — a hard cut. In
   *  `'seamless'` mode the outgoing cycle's instances are told to `stopEmitting()` and carried into a
   *  `finishing` set that drains over its own tail WHILE the fresh cycle spawns and emits, so the old
   *  generation fades out as the new one rises and there is no empty frame (the loop "blink"). Live tunable
   *  via `setLoopMode`. */
  loopMode?: 'playOut' | 'seamless';
}

export interface FxPlayer {
  play(): void;
  pause(): void;
  /** Un-pause without resetting: continues the pass in flight rather than restarting it (which is what
   *  `play()` would do to a fire). Starts a fresh pass if there is nothing to continue. */
  resume(): void;
  stop(): void;
  fireOnce(): void;
  /** Like `fireOnce`, but the pass REPEATS once everything has finished (the workbench's Loop). Kept
   *  distinct so `fireOnce` can stay a single pass no matter what the loop flag says. */
  fireLoop(): void;
  update(dtMs: number): void;
  scrub(ms: number): void;
  setSpeed(n: number): void;
  /** Turn continuous looping on/off live (the workbench's Loop toggle). Independent of `fireOnce`, which
   *  is always a single non-looping pass regardless of this. */
  setLoop(on: boolean): void;
  setLoopGap(ms: number): void;
  /** Switch the loop-boundary behaviour live (see `FxPlayerOptions.loopMode`). Takes effect at the NEXT
   *  boundary — an in-flight cycle is never torn down to apply it. */
  setLoopMode(mode: 'playOut' | 'seamless'): void;
  /** Set the base seed every subsequently-spawned layer derives its randomness from (see
   *  `LAYER_SEED_STRIDE`), or `null` for UNSEEDED — the historical behaviour, where each spawned instance
   *  rolls a fresh seed of its own and therefore looks slightly different every time.
   *
   *  Takes effect on the NEXT spawn, deliberately: changing the seed must not tear down and restart a live
   *  effect mid-tune, the same discipline `setLayerParams`/`setLayerTiming` follow. The payoff is stability
   *  ACROSS respawns — with a seed set, a primitive swap, a def load or another Fire reproduces the same
   *  roll instead of re-rolling the look under you. */
  setSeed(seed: number | null): void;
  /** Mute/unmute one layer LIVE: a muted layer is killed if live and is not spawned while muted; unmuting
   *  respawns it if the clock says it's due. Isolating one layer of a composition therefore no longer means
   *  deleting (and losing the tuning of) the others. Like `setLayerTiming`, this is a live edit rather than
   *  a structural rebuild — the surviving layers keep ticking untouched. */
  setLayerMuted(index: number, muted: boolean): void;
  setLayerParams(index: number, next: Record<string, unknown>): void;
  /** Live-edit a layer's SCHEDULE (the workbench's At / Life sliders). Stored as an override the scheduler
   *  consults instead of `def.layers[index].at/life` — the def itself is never touched — and applied to the
   *  running effect immediately: a layer that just became due spawns, one whose window just closed dies, and
   *  every other layer's instance keeps ticking untouched. `life = null` means "runs to the def's duration".
   *  This is the timing counterpart of `setLayerParams`: no respawn, no rebuild. */
  setLayerTiming(index: number, at: number, life: number | null): void;
  setHead(index: number, x: number, y: number): void;
  /** Hand one layer the fire's source→target vector — see `FxInstance.setAim` for what it means and why the
   *  caller (`driveLayerHeads`) only calls it when both anchors were really staged. A layer whose primitive
   *  doesn't implement `setAim` silently ignores it, exactly as `setHead` does. */
  setAim(index: number, sx: number, sy: number, tx: number, ty: number): void;
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
 * How far apart two layers' derived seeds sit when the player is seeded (see `FxPlayer.setSeed`).
 *
 * A composition is ONE number to the author, but its layers must not all draw the identical random stream —
 * a burst and a smoke plume seeded the same way emit in lockstep, which looks like a bug and defeats the
 * point of layering. So layer `i` gets `base + i * LAYER_SEED_STRIDE`: one number still reproduces the whole
 * composition, while each layer's stream is distinct.
 *
 * The stride is a large prime (7919) rather than a small offset because mulberry32 seeds that differ by 1
 * are not guaranteed to diverge interestingly in their first few draws — and the first few draws are exactly
 * what a short burst uses. Exported so tests can assert the derivation is a real function of the base and
 * the index rather than an accident.
 */
export const LAYER_SEED_STRIDE = 7919;

/**
 * Scrubbing budget — how much SIMULATED time one `scrub` call may spend fast-forwarding, and the slice it
 * spends it in.
 *
 * A scrub has to show the effect as it would LOOK at the target time, and every primitive here is a
 * forward-only particle sim: the only way to know what t=800ms looks like is to have ticked there. But a def
 * can be tens of seconds long and a slider drag fires a scrub every frame, so the work per call is capped at
 * `SCRUB_SIM_BUDGET_MS` of simulated time taken in `SCRUB_STEP_MS` slices (≈ one frame each, so primitives
 * see the same dt scale they see during ordinary playback rather than one enormous step).
 *
 * When the span exceeds the budget it is the OLDEST part that is skipped: the clock jumps straight to
 * `target - SCRUB_SIM_BUDGET_MS` and only the last two seconds are actually simulated. That keeps the cost
 * of a scrub constant regardless of def length while keeping the most recent — and therefore most visible —
 * part of the effect accurate. The trade is that a layer which started before the skipped point begins its
 * own life at the jump rather than at its true `at`; for a >2s-old particle that is invisible.
 *
 * Exported so tests (and a future perf probe) can drive exactly to the boundary.
 */
export const SCRUB_SIM_BUDGET_MS = 2000;
/** One fast-forward slice, ≈ a 60Hz frame. See `SCRUB_SIM_BUDGET_MS`. */
export const SCRUB_STEP_MS = 16;
/** Hard ceiling on instance ticks per `scrub` call — the budget expressed in slices. */
export const SCRUB_MAX_STEPS = Math.ceil(SCRUB_SIM_BUDGET_MS / SCRUB_STEP_MS);

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
  // Live TIMING edits, keyed by layer index — the same "never write into the caller's def" treatment
  // `overrides` gives params (see `setLayerTiming`). `life: undefined` = runs to the def's duration.
  const timing = new Map<number, { at: number; life: number | undefined }>();
  // Layers the author has muted (see `setLayerMuted`). Held here for the same reason as `overrides`/`timing`:
  // it is live editor state, not something the player may write back into the caller's def.
  const muted = new Set<number>();
  // The base seed every spawn derives from, or null = unseeded (each instance rolls its own — the historical
  // behaviour). See `setSeed` / `seedFor`.
  let baseSeed: number | null = null;
  let clock = 0;
  let speed = 1;
  let playing = false;
  let loopGapMs = Math.max(0, opts.loopGapMs ?? 0);
  // Mutable so the workbench's Loop toggle can flip it live (via setLoop) without rebuilding the player.
  let loopEnabled = opts.loop ?? false;
  // How a loop boundary is crossed (see FxPlayerOptions.loopMode). Mutable so setLoopMode can flip it live.
  let loopMode: 'playOut' | 'seamless' = opts.loopMode ?? 'playOut';
  // SEAMLESS mode only: instances carried over from a previous cycle, told to stop emitting and left to drain
  // (ticked every update, reaped on isComplete) so their particles fade while the next cycle emits. Empty and
  // untouched in the 'playOut' path, which keeps the historical behaviour byte-for-byte.
  const finishing: Live[] = [];

  // Set only while a fireOnce() pass is in flight. A fire runs the SAME per-layer `at`/`life` schedule as
  // ordinary playback (so the At/Life sliders a designer just dragged are visible in the headline "Fire"
  // without having to turn Loop on) but differs at the END of the pass: it never wraps, and a layer with no
  // explicit `life` is NOT torn down at `def.duration` — it persists until its own `isComplete()` reports
  // true, so a fire plays to genuine completion rather than to the def's nominal length. Cleared the moment
  // the pass stops (naturally, via the safety cap, or because play()/stop() was called), so it never leaks
  // into ordinary playback once the one-shot preview is done.
  let firing = false;
  // Whether the pass in flight is the LOOP's engine (repeat when it finishes) or a discrete one-shot.
  // Without this the two are indistinguishable, and a `fireOnce` on a looping player repeats forever — which
  // is precisely what "Fire once" must never do, whatever the Loop toggle says.
  let firingRepeats = false;

  // Set while a looping player is holding at `def.duration` between cycles (see `loopGapMs`). The clock
  // stays pinned at `def.duration` for the duration of the gap; `gapElapsed` is a separate counter tracking
  // how far into the gap we are, so `timeMs()` reads as "held at the end" rather than ticking past it.
  let inGap = false;
  let gapElapsed = 0;

  /** The seed layer `index` spawns with: `undefined` while unseeded (the primitive rolls its own, exactly as
   *  before seeding existed), else a value derived from the base seed and the layer index. Purely a function
   *  of `(baseSeed, index)` — no counter, nothing that advances per spawn — which is precisely what makes a
   *  respawn (primitive swap, def load, another Fire) reproduce the same roll instead of a new one. */
  const seedFor = (index: number): number | undefined =>
    baseSeed === null ? undefined : (baseSeed + index * LAYER_SEED_STRIDE) | 0;

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
    const primCtx: FxContext = { container, renderer: ctx.renderer, oneShot, seed: seedFor(index), uids: ctx.uids };
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

  // SEAMLESS boundary: instead of destroying a live instance, tell it to stop emitting and let it drain in
  // `finishing` (ticked below, reaped on isComplete) so its particles fade out while the next cycle emits.
  const carryOver = (index: number): void => {
    const l = live.get(index);
    if (!l) return;
    l.inst.stopEmitting?.();
    finishing.push(l);
    live.delete(index);
  };
  const carryAllLive = (): void => {
    for (const i of [...live.keys()]) carryOver(i);
  };
  // Tick every finishing instance and reap the ones that have drained. Called once per update().
  const reapFinishing = (dt: number): void => {
    for (let i = finishing.length - 1; i >= 0; i--) {
      const l = finishing[i];
      l.inst.update(dt);
      if (l.inst.isComplete ? l.inst.isComplete() : true) {
        l.inst.destroy();
        l.container.destroy({ children: true });
        finishing.splice(i, 1);
      }
    }
  };
  const drainFinishing = (): void => {
    for (const l of finishing) {
      l.inst.destroy();
      l.container.destroy({ children: true });
    }
    finishing.length = 0;
  };

  // A layer's EFFECTIVE timing: the live override if one has been set (see `setLayerTiming`), else the def's
  // own. Two `Map.get`s per layer per frame and nothing else — deliberately no "effective layers" array,
  // which would allocate on every tick of every effect.
  const lifeOf = (index: number): number | undefined => {
    const t = timing.get(index);
    return t !== undefined ? t.life : def.layers[index].life;
  };
  /**
   * The def-level ease (see `FxDef.ease`), or null for the overwhelmingly common linear case.
   *
   * Resolved ONCE here rather than read per frame, and deliberately null — not an identity curve — when
   * absent: the whole point is that a def without an ease keeps the original single-clock arithmetic, so
   * there is no float round-trip through a sampler on the path every shipped effect takes.
   */
  const easePts = def.ease !== undefined && def.ease.length >= MIN_CURVE_POINTS ? def.ease : null;

  /**
   * The clock the LAYERS see: raw time bent through the def's ease curve.
   *
   * Beyond `duration` it continues linearly from the curve's endpoint rather than saturating, so an
   * unbounded layer in a `fireOnce` pass keeps running at normal speed after the nominal window instead of
   * freezing on the curve's last value.
   */
  const easedClock = (): number => {
    if (easePts === null || def.duration <= 0) return clock;
    if (clock >= def.duration) return sampleCurve(easePts, 1) * def.duration + (clock - def.duration);
    return sampleCurve(easePts, clock / def.duration) * def.duration;
  };

  /** Eased time at the previous tick, so `reconcile` can hand primitives the WARPED delta. Re-synced on
   *  every reconcile (including the `reconcile(0)` after a clock reset), which is what makes a wrap or a
   *  stop self-healing rather than something each reset has to remember to fix up. */
  let lastEased = 0;

  const stateOf = (index: number): FxLayerState => {
    const t = timing.get(index);
    const layer = def.layers[index];
    return layerStateOf(
      t !== undefined ? t.at : layer.at, t !== undefined ? t.life : layer.life, def.duration, easedClock(),
    );
  };

  /** Bring ONE layer in line with the clock. `oneShot` marks a fireOnce() pass, which differs in exactly one
   *  place: a layer with no explicit `life` nominally ends at `def.duration`, but a fire must play to TRUE
   *  completion, so it is left alive past that point and torn down only once `isComplete()` says so (see
   *  `allFiringLayersDone`). A layer that DOES declare a `life` is bounded by that window in both modes. */
  const syncLayer = (index: number, oneShot: boolean): void => {
    // Mute is checked BEFORE the schedule: a muted layer is never spawned and is torn down if it is live,
    // whatever its `at`/`life` window says. Its timing/params state is untouched, so unmuting restores it.
    if (muted.has(index)) {
      kill(index);
      return;
    }
    const state = stateOf(index);
    if (state === 'active') {
      spawn(index, oneShot);
      return;
    }
    if (oneShot && state === 'done' && lifeOf(index) === undefined) return;
    kill(index);
  };

  /** Bring every live layer in line with the clock, then tick the survivors. Drives BOTH ordinary playback
   *  and a fireOnce() pass (`oneShot`) — the schedule is the same one in either case, which is the whole
   *  point: the At/Life sliders must be visible in a Fire, not only in a loop. */
  const reconcile = (dtMs: number, oneShot = false): void => {
    for (let i = 0; i < def.layers.length; i++) syncLayer(i, oneShot);
    // With no ease this is `dtMs`, untouched — the arithmetic every shipped def has always run.
    //
    // With one, primitives are ticked with the EASED delta, so the whole composition slows and rushes
    // together. Clamped at 0 because a descending stretch of the curve would otherwise hand an integrator a
    // negative dt (ages running backwards, drag dividing instead of multiplying); it reads as a HOLD
    // instead. Re-syncing `lastEased` unconditionally is what makes a wrap or stop self-healing: those reset
    // `clock` to 0 and call `reconcile(0)`, and the resulting large negative delta is absorbed here.
    let step = dtMs;
    if (easePts !== null) {
      const now = easedClock();
      step = now > lastEased ? now - lastEased : 0;
      lastEased = now;
    }
    if (step > 0) for (const l of live.values()) l.inst.update(step);
  };

  /**
   * Advance the clock to `target` (which must be >= `clock`), bringing layers in and out on the way and
   * ticking the live ones with the REAL elapsed ms, in `SCRUB_STEP_MS` slices. This is what makes a scrub
   * show the effect mid-flight instead of frozen: `reconcile(0)` alone can't do it, because its per-instance
   * tick is guarded by `dtMs > 0` and `spawn` early-returns for a layer that is already live.
   *
   * Bounded by `SCRUB_MAX_STEPS` (see `SCRUB_SIM_BUDGET_MS`), so a drag to the far end of a 30s def costs
   * the same as a drag to 2s and can never lock the UI. Deliberately does NOT apply `speed`: a scrub is
   * expressed in the def's own timeline, not in wall-clock time.
   */
  const fastForwardTo = (target: number): void => {
    if (target - clock > SCRUB_SIM_BUDGET_MS) clock = target - SCRUB_SIM_BUDGET_MS;
    // Bring the layer set in line with the (possibly jumped) clock BEFORE ticking, so a layer that is
    // already due takes part in the fast-forward instead of spawning at the very end of it.
    reconcile(0);
    for (let step = 0; step < SCRUB_MAX_STEPS && clock < target; step++) {
      const dt = Math.min(SCRUB_STEP_MS, target - clock);
      clock = Math.min(target, clock + dt);
      reconcile(dt);
    }
    if (clock !== target) {
      // Only reachable via float drift on the final slice. Snap and re-sync the layer set so `timeMs()`
      // reads back exactly what the caller asked for.
      clock = target;
      reconcile(0);
    }
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
    resume(): void {
      // Un-pause the pass in flight, WITHOUT the lifecycle reset `play()` performs — `play()` tears a fire
      // down, which would make pause/resume silently restart the effect from zero instead of continuing it.
      if (firing) {
        playing = true;
        return;
      }
      // Nothing in flight (never started, or the last pass finished): start a fresh one. Deliberately NOT
      // `playing = true` on a stale clock, which would drop into ordinary wrap-at-duration playback — an
      // effect that had finished would quietly start looping again from wherever the clock happened to sit.
      if (loopEnabled) this.fireLoop();
      else this.fireOnce();
    },
    fireOnce(): void {
      // Always restarts from t=0 for a single pass, regardless of the player's current state
      // (playing/paused/stopped) or how it was constructed -- the workbench's "Fire" trigger for a
      // discrete, one-off preview (e.g. one combat proc) distinct from the continuous play/stop loop.
      // The pass honours each layer's `at`/`life` window exactly as ordinary playback does (only what's
      // due at t=0 spawns now; the rest arrive as the clock reaches them) and then runs on until every
      // layer genuinely finishes -- see `update`'s `firing` branch, `syncLayer` and `allFiringLayersDone`.
      clock = 0;
      inGap = false;
      gapElapsed = 0;
      killAllLive();
      firing = true;
      firingRepeats = false;
      playing = true;
      reconcile(0, true);
    },
    fireLoop(): void {
      // Identical to `fireOnce` except that the pass repeats itself once everything has finished. This is
      // what the workbench's Loop drives: "play the whole thing out, then again", as opposed to `play()`'s
      // wrap-the-clock-at-duration (which is what an in-game `playDef` wants, where the duration IS the
      // contract) and as opposed to `fireOnce`, which must stay a single pass.
      clock = 0;
      inGap = false;
      gapElapsed = 0;
      killAllLive();
      firing = true;
      firingRepeats = true;
      playing = true;
      reconcile(0, true);
    },
    stop(): void {
      // Distinct from destroy(): stop() is a playback control that resets the clock and leaves the
      // player usable — play() can be called again and starts a fresh run from zero. destroy() is
      // lifecycle teardown (e.g. the editor unmounting) and makes no promise the player can be reused.
      playing = false;
      clock = 0;
      firing = false;
      firingRepeats = false;
      inGap = false;
      gapElapsed = 0;
      killAllLive();
      drainFinishing();
    },
    update(dtMs: number): void {
      if (!playing) return;
      const dt = dtMs * speed;

      // Advance (and reap) any carried-over instances FIRST, every frame, regardless of which branch below
      // handles the live cycle. A no-op unless a seamless boundary has put something in `finishing`.
      reapFinishing(dt);

      if (firing) {
        // Between-cycle hold, for a LOOPING fire (see the completion branch below). Lives inside the firing
        // branch because the non-firing `inGap` handler further down is unreachable while a fire is in
        // flight, and a fire-loop needs the same visible clear between passes that ordinary looping has.
        if (inGap) {
          gapElapsed += dt;
          if (gapElapsed < loopGapMs) return;
          inGap = false;
          gapElapsed = 0;
          clock = 0;
          reconcile(0, true);
          return;
        }
        clock += dt;
        // Same schedule as ordinary playback: layers arrive at their `at` and bounded ones die when their
        // `life` window closes. Only the END of the pass differs (below) -- no wrap, and an unbounded layer
        // outlives `def.duration` until it reports completion.
        reconcile(dt, true);
        if (clock >= FIRE_TIMEOUT_MS) {
          console.warn(
            `[fx] fireOnce for def '${def.id}' exceeded the ${FIRE_TIMEOUT_MS}ms safety cap without ` +
              `isComplete() reporting true on every layer -- force-stopping.`,
          );
          killAllLive();
          playing = false;
          firing = false;
          firingRepeats = false;
          return;
        }
        // SEAMLESS loop restart: gate on the nominal duration ALONE, NOT on allFiringLayersDone(). Waiting
        // for a long tail to drain before restarting IS the blink this mode exists to remove — so at the
        // boundary the still-live instances are carried into `finishing` (stop-emitted, draining above) while
        // a fresh cycle spawns and emits. Only reachable for a repeating loop; a one-shot fire never wraps.
        if (loopMode === 'seamless' && firingRepeats && loopEnabled && clock >= def.duration) {
          carryAllLive();
          if (loopGapMs > 0) {
            // A gap re-introduces an empty frame by definition; kept only so the two toggles compose without
            // surprise. The carried-over instances still drain during the hold.
            inGap = true;
            gapElapsed = 0;
            return;
          }
          clock = 0;
          // NOT oneShot: a seamless cycle's emitters must emit continuously across the whole loop period —
          // the outgoing instance handed to `finishing` is what `stopEmitting()` bounds, not this fresh one.
          reconcile(0);
          return;
        }
        // A fire is over only once the def's nominal window has elapsed AND nothing live has anything left
        // to render. The `clock >= def.duration` half is load-bearing: without it a pass whose first layer
        // is short (say `life: 100` on a 500ms def) would report "all live layers done" the instant that
        // layer's window closed and stop before a later layer ever reached its `at`.
        if (clock >= def.duration && allFiringLayersDone()) {
          killAllLive();
          // Looping repeats the PASS, not the duration: the next cycle begins when everything has genuinely
          // finished, so nothing is ever cut off mid-play by the composition's nominal length. (Ordinary
          // non-firing playback below still wraps at `def.duration` — that path is what `playDef` uses for
          // a bounded in-game effect, where the clock IS the contract.)
          if (firingRepeats && loopEnabled) {
            if (loopGapMs > 0) {
              inGap = true;
              gapElapsed = 0;
              return;
            }
            clock = 0;
            reconcile(0, true);
            return;
          }
          playing = false;
          firing = false;
          firingRepeats = false;
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
          // a natural kill (the schedule only sees the post-wrap clock, not the crossing). Without this,
          // a full-duration layer's original instance silently survives across the loop boundary and
          // never restarts its own internal animation/state for the new cycle.
          while (clock >= def.duration) clock -= def.duration;
          // playOut (default): cull the old cycle outright — a hard cut. seamless: carry it over to drain
          // while `reconcile(dt)` below respawns the fresh cycle (continuous, since this path is never
          // oneShot), so the outgoing generation fades instead of blinking out.
          if (loopMode === 'seamless') carryAllLive();
          else killAllLive();
        } else {
          clock = def.duration;
          playing = false;
        }
      }
      reconcile(dt);
    },
    scrub(ms: number): void {
      const target = Math.min(def.duration, Math.max(0, ms));
      if (target < clock) {
        // BACKWARD. Every primitive here is a forward-only particle sim with no reverse integration, so
        // there is no honest way to "un-tick" to an earlier frame -- the only thing that shows t=target is
        // re-simulating it. Tear every layer down, rewind to zero and fast-forward.
        //
        // Seeded (see `setSeed`), that reproduces the previous pass exactly. UNSEEDED, each respawned
        // instance rolls a fresh stream, so the re-simulated frame will differ in its particulars from the
        // pass you scrubbed away from -- it is the same effect at the same age, not the same particles.
        // Accepted deliberately: an honest live picture beats a frozen one, and locking the seed makes it
        // exact for anyone who cares.
        killAllLive();
        clock = 0;
      }
      // FORWARD (including the tail of the rewind above): advance the live instances by the real elapsed
      // ms rather than freezing them. Cost per call is bounded by SCRUB_MAX_STEPS instance ticks, which IS
      // the throttle -- there is deliberately no wall-clock debounce in here (it would make the player
      // depend on timers and untestable without faking them), and a range-input drag emits at most one
      // change per frame, so a drag costs at most that bound per frame.
      fastForwardTo(target);
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
    setLoopMode(mode: 'playOut' | 'seamless'): void {
      loopMode = mode;
    },
    setSeed(seed: number | null): void {
      // Deliberately does NOT touch anything live: the new seed is picked up by the next spawn (a Fire, a
      // loop wrap, a layer becoming due, a rebuild). Forcing a respawn here would restart the effect out
      // from under a designer who is mid-gesture on some other control.
      baseSeed = seed === null || !Number.isFinite(seed) ? null : seed | 0;
    },
    setLayerMuted(index: number, on: boolean): void {
      if (index < 0 || index >= def.layers.length) return;
      if (on === muted.has(index)) return;
      if (on) muted.add(index);
      else muted.delete(index);
      // Apply to the RUNNING effect immediately and to THIS layer only — the live path, chosen over folding
      // `muted` into the workbench's `structureKey` precisely so isolating a layer doesn't restart (and
      // re-roll) every other layer, which is the whole reason you're isolating it. Skipped when nothing is
      // engaged (a stopped player), where spawning off the back of a toggle would be wrong.
      if (playing || live.size > 0) syncLayer(index, firing);
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
    setLayerTiming(index: number, at: number, life: number | null): void {
      if (index < 0 || index >= def.layers.length) return;
      // Kept here rather than written into `def.layers[index]` for exactly the reason `setLayerParams` keeps
      // `overrides`: the caller (the workbench's React state) owns that def object and the player must never
      // fight it for ownership.
      timing.set(index, { at, life: life ?? undefined });
      // Apply to the RUNNING effect right away -- and to this layer ONLY, so a timing drag never disturbs
      // any other layer's live instance. Skipped when nothing is engaged (a stopped player with no live
      // layers), where spawning off the back of a slider would be wrong.
      if (playing || live.size > 0) syncLayer(index, firing);
    },
    setHead(index: number, x: number, y: number): void {
      live.get(index)?.inst.setHead?.(x, y);
    },
    setAim(index: number, sx: number, sy: number, tx: number, ty: number): void {
      live.get(index)?.inst.setAim?.(sx, sy, tx, ty);
    },
    timeMs: () => clock,
    isPlaying: () => playing,
    destroy(): void {
      // Clearing the transport flags is NOT decoration — without it a post-destroy `update()` respawns.
      // `killAllLive()` empties `live`, but `update()` → `reconcile()` reads `playing`, sees a layer that is
      // due and no longer live, and SPAWNS it: with pooling, that acquires a pooled pair into a container
      // the caller has already orphaned, and nothing will ever release it. Repeat and the pool starves.
      // `playDef`'s `retired()` check and the workbench's teardown ordering both happen to prevent that
      // today; with lots of effects starting and stopping at arbitrary moments, "happens to" is not enough.
      // Deliberately not a call to `stop()`: this is teardown, not a rewind — the clock is left where it
      // died rather than reset, because destroy() promises no reuse.
      playing = false;
      firing = false;
      firingRepeats = false;
      inGap = false;
      killAllLive();
      drainFinishing();
    },
  };
}
