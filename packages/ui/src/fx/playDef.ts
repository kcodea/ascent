/// <reference types="vite/client" />
import { Container, type Renderer } from 'pixi.js';
import { perfMonitor } from '../perfMonitor';
import { pixiFx } from '../pixiFx';
import { driveLayerHeads, type FxAnchors } from './anchors';
import type { FxDef } from './def';
import type { StoredFxDef, StoredFxLayer } from './defStore';
import { anchorsForUnits } from './combatAnchors';
import { getDef, listDefs } from './fxDefs';
import { fxPoolSize } from './fxRuntime';
import { createPlayer } from './player';
import { hasPrimitives } from './registry';
import { scaleDef, type FxScaleAxes } from './scaleDef';
import { holdStat, revealStat } from './statHold';

/**
 * Play a COMMITTED def once, in the real game, and clean itself up. The runtime half of the workbench →
 * game bridge.
 *
 * ── the gap this closes ──────────────────────────────────────────────────────────────────────────────
 * Every shipped `pixiFx` effect is fire-and-forget: the controller's own ticker owns it end to end. An
 * `FxPlayer` is the exact opposite — it hands the CALLER a `update(dtMs)` the caller must pump every frame,
 * which until now only the workbench did (see `fx/ui/Workbench.tsx`'s build effect, whose per-frame updater
 * this module is the headless, self-retiring distillation of). `playDef` is the missing "fire this def at
 * these anchors and forget it": it owns the container, the player, the per-frame updater and the teardown,
 * so a call site in combat looks like every other one-shot FX call.
 *
 * ── when are anchors sampled? ONCE, at fire time ─────────────────────────────────────────────────────
 * `anchors` is a SNAPSHOT the caller takes at the moment of firing, and it is held, unchanged, for the
 * effect's whole life. Deliberate, and the consequence is worth stating plainly: **a unit that moves after
 * the effect starts does NOT drag the effect with it.** A lunging attacker fires its impact where the
 * impact happened, not wherever the card has slid to 200ms later.
 *
 * Why a snapshot and not a live re-read:
 *   • Re-resolving anchors per frame means `getBoundingClientRect()` per frame, which is a documented
 *     anti-pattern in this repo (CLAUDE.md, "don't read layout per frame") — it forces a synchronous layout
 *     flush on every tick of every live effect, and combat fires several at once.
 *   • A combat moment is an EVENT at a point in time. Its geometry is the geometry it had when it fired;
 *     following the card afterwards is a different (and mostly wrong-looking) effect.
 *   • `travel` still animates: `resolveAnchor` interpolates the source→target arc from the snapshot using
 *     the fire's own progress, so a ribbon still whips between the two units — it just uses the positions
 *     they had when the moment fired.
 * A caller that genuinely needs an effect to track a moving unit wants a different primitive (a persistent,
 * attached one), not a per-frame anchor re-read here.
 *
 * ── production ───────────────────────────────────────────────────────────────────────────────────────
 * This PLAYS in production. It did not always: the def registry was DEV-gated at its `import.meta.glob` and
 * the primitives loaded only behind a DEV-gated dynamic import, so `canPlayDefs()` was permanently false for
 * players. The owner un-gated both (2026-07-29) — authored defs are now part of the shipped game, at a
 * measured +151,602 B raw / +34,206 B gzipped of total JS — of which only +17,829 B raw / +4,868 B gzipped is
 * in the main chunk; the primitives and their GLSL are the rest, in their own lazily-fetched chunk.
 *
 * Playback needs THREE things true, and all three now hold in prod: the registry is populated (`fxDefs.ts`),
 * the primitives are registered, and something has actually CALLED `ensureDefsReady()` — `Game.tsx` does it on
 * mount, un-gated. That third one is easy to lose: without the call the primitives never register,
 * `canPlayDefs()` stays false, and every binding is silently inert even though the bytes shipped.
 *
 * What is still DEV-only is AUTHORING: saving a def (`defStore.ts`), the imported-art glob
 * (`shapeLibrary.ts`), the `window.__fx` handle at the bottom of this file, and the workbench UI under
 * `DevMenu`. Playback ships; the tool does not.
 *
 * Nothing in here throws. A miss (unknown id, no renderer, no playable layers) is `null`, which the caller
 * treats as "no FX for this moment" and moves on.
 */

export interface PlayDefOptions extends FxScaleAxes {
  /** Playback rate multiplier (e.g. the combat-speed dial). Non-finite or ≤ 0 falls back to 1 — a paused
   *  fire-and-forget effect would never retire, so "0" is treated as caller error rather than honoured. */
  speed?: number;
  /* `scale` / `intensity` / `time` come from `FxScaleAxes` — the per-call geometric, quantity and temporal
   * multipliers. All default to 1, and 1 is an EXACT no-op (the def object is not even copied). Only params
   * that declare an `axis` in their spec respond, and each is clamped to its own slider range, so scaling is
   * NOT linear at the extremes. See `scaleDef.ts` and `FxParamMeta.axis`.
   *
   * `time` and `speed` are NOT the same dial and must not be confused: `speed` rescales this player's clock
   * (everything, motion included, runs slower and covers the same ground), while `time` stretches the def's
   * temporal frame with the velocities held, so particles travel further. `time` also moves `def.duration`,
   * which is what `fireProgress` and every `travel` layer's arc are measured against — so a stretched def's
   * arc still completes exactly at its (stretched) end. Note the interaction with the two safety caps: a
   * large `time` on a long def can push a play past `player.ts`'s `FIRE_TIMEOUT_MS` (10s of SIMULATED time)
   * or this module's `PLAY_TIMEOUT_MS` (15s of wall clock), which force-retire it. Nothing in the library is
   * within an order of magnitude of that. */
  /** Called EXACTLY once when the effect retires — whether it played out naturally or was cancelled — and
   *  after teardown has finished, so the callback sees a fully cleaned-up world. */
  onDone?: () => void;
  /**
   * The units this moment is about. Optional, and only `react` layers read it (see `FxContext.uids`): a
   * Pixi layer already has everything it needs in `anchors`, which is why this is a separate channel rather
   * than something derived from them — a screen point cannot be turned back into the card that was there.
   *
   * A caller that already computed `anchorsForUnits(a, b)` should pass the same two uids here; omitting
   * them leaves a react layer falling back to the first player unit, which is right for a preview and wrong
   * for a real moment.
   */
  uids?: { source?: string | null; target?: string | null };
  /**
   * Which recipient this copy is, when a moment plays the def on several units. Drives `FxLayer.stagger` —
   * see that field. Omitted = 0, so a single-target fire is unaffected.
   */
  index?: number;
  /**
   * Play the def as a continuous LOOP (the workbench's Loop) instead of a single pass, and exempt the play
   * from the `PLAY_TIMEOUT_MS` wall-clock cap. A looping play never finishes on its own, so the CALLER OWNS
   * teardown: `playDef` returns its `retire` fn and the caller MUST call it (a leaked looping player runs for
   * the whole session). Used for a persistent card treatment (Cia's enchant), not for a combat moment — a
   * moment must stay one-shot so it can't outlive its beat. The per-cycle player clock still resets each loop,
   * so the player's own `FIRE_TIMEOUT_MS` (per fireOnce pass) is not a factor.
   */
  loop?: boolean;
  /**
   * Make the effect FOLLOW a moving target: called every frame to re-read the anchor point, so the head
   * rides a card as the shop reorders it (Cia's enchant treatment — owner 2026-08-20). The returned point
   * replaces `source`/`target`/`cursor` for that frame; returning `null` HIDES the effect for the frame
   * (the card is mid-drag or briefly out of the DOM) WITHOUT ending the play — retirement stays caller-owned
   * via the returned `retire`, exactly as `loop` requires. The emitter's velocity inheritance turns the
   * moving head into a natural drift, which is why the head follows rather than the whole particle cloud
   * being rigidly translated (which reads as pasted-on).
   *
   * This is the ONE sanctioned per-frame `getBoundingClientRect` in the FX path: it is bounded to the
   * handful of Enchanted shop offers, and it is precisely what the retired `ciaEnchantedFx` foil did. Do not
   * reach for it for a combat moment — those snapshot their anchors for a reason (see the module header).
   * `follow` implies a caller-owned lifetime, so pair it with `loop` (or your own `retire` call).
   */
  follow?: () => { x: number; y: number } | null;
}

/**
 * Hard WALL-CLOCK ceiling on one play.
 *
 * `player.ts` already caps a fire at `FIRE_TIMEOUT_MS` of SIMULATED time, which covers "a primitive's
 * `isComplete()` never reports true". It does not cover the clock itself failing to advance: simulated time
 * moves at `dtMs * speed`, so a caller passing a tiny (or zero) speed would hold an updater, a container and
 * a live GPU-backed primitive for the rest of the session. This cap is measured in real elapsed ms and is
 * therefore immune to that. At speed ≥ 1 the player's own cap always fires first, so this only ever bites
 * the pathological cases; a combat effect still running 15 real seconds after it fired is a bug either way.
 */
export const PLAY_TIMEOUT_MS = 15_000;

// ─── pure helpers (unit-tested without a renderer) ─────────────────────────────────────────────────────

/**
 * PURE: the layers of a stored def that will actually render — i.e. every layer the author did not MUTE.
 *
 * Mute is AUTHORING state, but it round-trips into the saved JSON (`StoredFxLayer.muted`, see `defStore.ts`)
 * because silently un-muting a layer the author had isolated loses their working state. The workbench is the
 * only thing that honours the flag today (it re-applies it via `FxPlayer.setLayerMuted` on every rebuild), so
 * without this filter a def saved mid-isolation would come back with the muted layer RENDERING in the game —
 * the def would look different in play than it did in the tool that authored it.
 *
 * Filtering here (rather than calling `setLayerMuted` per index like the workbench does) also removes an
 * index-alignment hazard: `driveLayerHeads` addresses layers by index, and `playDef` hands it the very same
 * filtered array it built the player from, so the two can't drift.
 */
export function playableLayers(def: StoredFxDef): StoredFxLayer[] {
  return def.layers.filter((l) => l.muted !== true);
}

/** PURE: the runtime `FxDef` a stored def plays as — its authoring-only fields dropped, muted layers gone. */
export function playableDef(def: StoredFxDef): FxDef {
  return { id: def.id, duration: def.duration, layers: playableLayers(def) };
}

/**
 * PURE: a fire's 0..1 progress, for `resolveAnchor`'s `travel` interpolation.
 *
 * Clamped at both ends because neither is hypothetical: a fire deliberately runs PAST `def.duration` (an
 * unbounded layer plays to true completion — see `player.ts`'s `firing` branch), and a zero-duration def
 * would otherwise divide by zero. Anything non-finite collapses to 1 (the arc's end) rather than poisoning
 * every layer's head with NaN.
 */
export function fireProgress(timeMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 1;
  const t = timeMs / durationMs;
  if (!Number.isFinite(t)) return 1;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * PURE: the `createPlayer` loop options a stored def resolves to for one play.
 *
 * Extracted rather than inlined so it is unit-testable with no renderer: `playDef` returns `null` before it
 * ever reaches `createPlayer` in the headless test env (see the "no renderer → null" tests below), so a spy
 * on `createPlayer` never fires there. This reads `stored.loopMode`/`loopJoinMs` on the exact same
 * omitted-means-default terms as `stored.seed`/`stored.slot` elsewhere in this file: a def saved before these
 * fields existed (or one that never touched them) falls back to `'playOut'` / `0` — today's play-out-then-
 * repeat behaviour, unchanged. `loop` is the CALLER's decision (`opts.loop`); this only decides HOW a looping
 * play crosses its boundary.
 */
export function loopOptionsFrom(
  stored: Pick<StoredFxDef, 'loopMode' | 'loopJoinMs'>,
  loop: boolean,
): { loop: boolean; loopMode: 'playOut' | 'seamless'; loopJoinMs: number } {
  return {
    loop,
    loopMode: stored.loopMode ?? 'playOut',
    loopJoinMs: stored.loopJoinMs ?? 0,
  };
}

/** The four teardown steps of one play, in order. Named rather than an anonymous list so `createRetire`
 *  reads as the lifecycle it is, and so a test can assert each ran exactly once. */
export interface FxPlayTeardown {
  removeUpdater(): void;
  destroyPlayer(): void;
  unmountLayer(): void;
  destroyContainer(): void;
  /** The caller's completion callback, invoked last (after teardown). */
  onDone?: () => void;
}

export interface FxRetire {
  /** Tear down, at most once. Safe to call from anywhere, any number of times. */
  retire(): void;
  /** Whether teardown has already run. `pixiFx.addUpdater` documents that each frame iterates a SNAPSHOT of
   *  the updater list, so a just-removed updater can still be invoked once more within the same frame — it
   *  checks this and bails instead of ticking a destroyed player. */
  retired(): boolean;
}

/**
 * Build the ONE idempotent teardown for a play.
 *
 * Extracted (rather than inlined into `playDef`) precisely because idempotence is the contract most likely
 * to break and least likely to be noticed: the cancel fn and natural completion are two independent paths
 * into the same teardown, and a double-free of a Pixi container is a crash, not a warning. As a pure
 * function over four callbacks it is provable in a unit test with no renderer, no WebGL and no mocking.
 */
export function createRetire(t: FxPlayTeardown): FxRetire {
  let done = false;
  return {
    retire(): void {
      if (done) return;
      done = true;
      t.removeUpdater();
      t.destroyPlayer();
      t.unmountLayer();
      t.destroyContainer();
      t.onDone?.();
    },
    retired: () => done,
  };
}

// ─── readiness ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether a def can play AT ALL right now: the primitives are registered and the overlay has a live
 * renderer.
 *
 * Both halves are true in a normal production session once `ensureDefsReady()` has resolved (see the module
 * header); both are false headless, and false for the window before that promise settles. So this is the one
 * call a caller needs to decide "defs, or the hand-written FX path". It is deliberately NOT a promise — a
 * per-moment call site must not await anything.
 */
export function canPlayDefs(): boolean {
  // `hasPrimitives()` (a Map `.size` read), NOT `listPrimitives().length` — the latter spreads and sorts the
  // whole registry on every call, and this sits on the cue runner's per-moment path for all 25 moment kinds.
  return hasPrimitives() && pixiFx.renderer !== null;
}

/** Memoised so N callers awaiting readiness share ONE dynamic import. A failed import is not retried: the
 *  path is static, so a second attempt resolves the same way. */
let readying: Promise<void> | null = null;

/**
 * Await def-playing readiness — i.e. register the built-in primitives. Un-gated: this is what makes authored
 * defs play for PLAYERS, so it must run in production too. `Game.tsx` calls it on mount.
 *
 * Still a DYNAMIC import, for a reason that survived the un-gate: the primitives self-register via a top-level
 * function CALL, a side effect Rollup cannot prove away, so a static import would pull the whole set (GLSL
 * shader source included) into the ENTRY chunk. Keeping it dynamic puts them in their own chunk, fetched
 * alongside the game rather than ahead of first paint.
 *
 * Resolves (never rejects) in every case: already-ready, just-loaded, and load-failed — where it warns and
 * leaves `canPlayDefs()` false, so every call site falls back to the hand-written FX path.
 */
export function ensureDefsReady(): Promise<void> {
  // The pre-warm is scheduled off the SAME memoised import, but deliberately NOT inside the `!hasPrimitives()`
  // branch below. In DEV the workbench can register the primitives before `Game.tsx` ever calls this, and then
  // that branch is skipped entirely — which is precisely how the first version of this shipped a pre-warm that
  // never ran. Hanging it off the (idempotent, module-cached) import instead means it happens exactly once per
  // session on every path.
  readying ??= import('./primitives').then(
    (mod) => {
      schedulePrewarm(mod.prewarmFxMaterials);
    },
    (e: unknown) => {
      console.warn('[fx] could not load the def primitives — defs will not play:', e);
    },
  );
  return hasPrimitives() ? Promise.resolve() : readying;
}

/** How long to keep waiting for the overlay's renderer before giving up on pre-warming, and how often to
 *  look. A few seconds is far longer than `pixiFx.attach()` has ever taken; the cap is only there so a
 *  session where the overlay never initialises (no WebGL) doesn't hold a timer forever. */
const PREWARM_POLL_MS = 120;
const PREWARM_GIVE_UP_MS = 8_000;

/**
 * Run the FX shader pre-warm as soon as the overlay has a renderer — polling for it rather than assuming.
 *
 * The ordering here is the whole point and it is NOT guaranteed: `Game.tsx` calls `ensureDefsReady()` on
 * mount, and `pixiFx.attach()` → `init()` is an independent async chain that creates the `Application`. The
 * primitives' dynamic import usually resolves FIRST, so `pixiFx.renderer` is still null at that moment and a
 * straight-line `prewarmFxMaterials(pixiFx.renderer)` silently does nothing — leaving the ~68 ms-per-source
 * GLSL link to land on the first combat collision, which is exactly the frame we are trying to protect.
 *
 * Deliberately NOT awaited by `ensureDefsReady`: nothing should wait on a pre-warm, and a caller that fires a
 * def before the warm lands just pays the old first-fire cost once.
 */
function schedulePrewarm(prewarm: (renderer: Renderer | null) => void): void {
  if (typeof window === 'undefined') return;
  let waited = 0;
  const tick = (): void => {
    const renderer = pixiFx.renderer;
    if (renderer) {
      prewarm(renderer);
      // Bring the under-card canvas up ONLY if something committed actually wants it. A page whose defs are
      // all `over` never creates a second GL context — the lazy half of "lazy on first use" — while a page
      // that will need one has it long before the first combat, so no fire is ever dropped waiting on init.
      if (listDefs().some((d) => d.slot === 'under')) void pixiFx.ensureUnderSlot();
      if (listDefs().some((d) => d.slot === 'above')) void pixiFx.ensureAboveSlot();
      return;
    }
    waited += PREWARM_POLL_MS;
    if (waited >= PREWARM_GIVE_UP_MS) return;
    window.setTimeout(tick, PREWARM_POLL_MS);
  };
  tick();
}

// ─── the bridge ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Fire a committed def ONCE at `anchors`. Returns a cancel fn, or `null` if it couldn't play.
 *
 * `null` (never a throw) means: no def with that id, no live renderer, or nothing left to render once muted
 * layers are removed. The caller treats it as "no FX for this moment".
 *
 * The returned fn cancels early; it is the SAME idempotent teardown natural completion runs, so calling it
 * after the effect has already finished is a safe no-op. Callers never tick anything — this registers its
 * own `pixiFx` updater and removes it the moment the play is over.
 *
 * `anchors` is a snapshot held for the effect's life — see the module header for why.
 */
/**
 * Shift every layer that declares a `stagger` by `stagger × index`.
 *
 * Returns the def BY IDENTITY when there is nothing to do — index 0, or no layer staggering — so the common
 * single-target fire allocates nothing, matching `scaleDef`'s exact-no-op contract.
 *
 * The shift lands on `at` rather than on the player's clock because `at` is what every other part of the
 * system already means by "when this layer starts": the timeline, the inspector's At slider, and
 * `layerStateOf` all read it. A parallel offset would be a second source of truth for one number.
 */
function staggerLayers<T extends { layers: readonly { at: number; stagger?: number }[] }>(def: T, index: number): T {
  if (index === 0 || !def.layers.some((l) => (l.stagger ?? 0) !== 0)) return def;
  return {
    ...def,
    layers: def.layers.map((l) => ((l.stagger ?? 0) === 0 ? l : { ...l, at: l.at + (l.stagger ?? 0) * index })),
  };
}

export function playDef(id: string, anchors: FxAnchors, opts: PlayDefOptions = {}): (() => void) | null {
  // PER-EFFECT ATTRIBUTION (owner ask 2026-08-29: "i want the perf hud to be so good that it points at cards
  // or mechanics or effects that are causing slowdowns").
  //
  // This is the ONE chokepoint every authored effect passes through, so timing it here attributes the SPAWN
  // cost of a fire to the def by name — `fx:titan-hammer` rather than a generic `fx:tendril` tally. That
  // turns "some effect is expensive" into "this effect is expensive", which is the difference between a lead
  // and a fix.
  //
  // What it measures is the SPAWN, not the effect's whole life: the particles keep costing frames after this
  // returns, and that ongoing cost shows up in the FX counters instead. A shader compile, a texture upload
  // and a big allocation all land here, which is exactly where the 160 ms collision freeze of §3b lived.
  //
  // Free when the monitor is off — `measure` is a bare passthrough with no clock reads (see perfMonitor).
  return perfMonitor.measure(`fx:${id}`, () => playDefInner(id, anchors, opts));
}

/**
 * THE `camera` ANCHOR HAS ONE MEANING: the viewport centre.
 *
 * Every anchor a def can name resolves to `ORIGIN` — literally (0, 0), the top-left corner — when the caller
 * did not stage it (`resolveAnchor`). For `source`/`target`/`slot` that is the honest answer: only the caller
 * knows where the cards are. `camera` is different — it is the ONE anchor that does not depend on the caller
 * at all, so a caller omitting it was never expressing "I have no camera", only "I forgot".
 *
 * That is exactly the bug the owner hit on 2026-08-31: Blast Pump's authored def is three camera-anchored
 * bursts, the Equipment-use call staged `{ source, target, cursor }`, and the whole effect fired in the
 * top-left corner of the screen. Three other live call sites had already hand-rolled this same expression,
 * which is the tell that it belonged here rather than at each of them.
 *
 * Filled in HERE, at the single chokepoint every authored effect passes through, so a def authored against
 * the workbench's camera (`viewport centre`) plays in the same place in the real game. Guarded for a
 * DOM-less environment so the pure tests are unaffected.
 */
export function withCamera(anchors: FxAnchors): FxAnchors {
  if (anchors.camera || typeof window === 'undefined') return anchors;
  return { ...anchors, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } };
}

/** `retried` is internal: the one-shot guard on the aux-canvas wait below. Callers never pass it. */
function playDefInner(
  id: string, rawAnchors: FxAnchors, opts: PlayDefOptions = {}, retried = false,
): (() => void) | null {
  const anchors = withCamera(rawAnchors);
  const stored = getDef(id);
  if (!stored) {
    // DEV-only because it is an AUTHORING mistake — a binding naming a def that isn't committed. The registry
    // ships now, so this can fire in prod, but a player can't fix a dangling binding and the console noise
    // would repeat for every moment that hit it. `bindings.test.ts` is what catches this before it ships.
    if (import.meta.env.DEV) console.warn(`[fx] playDef: no committed def '${id}' — nothing fired.`);
    return null;
  }
  // `createPlayer` and every primitive's `spawn` require a real renderer; the overlay's `attach()`/`init()`
  // is async, so "not yet" is a normal state, not an error. Unlike the workbench (which polls until one
  // exists) a combat moment is gone by the time a poll would resolve, so this simply declines.
  // The def picks its CANVAS: 'over' (the default, the z110 overlay above every card) or 'under' (a second
  // canvas parked inside `.app` beneath the cards). Both the renderer the layers are built against and the
  // stage they mount on must come from the SAME app, or the effect builds its GPU resources in one GL
  // context and is drawn by another.
  const slot = stored.slot ?? 'over';
  const renderer = pixiFx.rendererFor(slot);
  if (!renderer) {
    // AN AUX CANVAS ISN'T UP YET → WAIT FOR IT AND PLAY, rather than dropping the fire.
    //
    // Owner report 2026-08-31: "the first prismatic pick doesn't trigger the animation" — and only the
    // first. `under` and `above` are created LAZILY, so the first effect that wants one arrives before it
    // exists. Kicking the init and returning null (what this did) means fire #1 is spent creating the canvas
    // and fire #2 is the first the player actually sees. `ensureDefsReady`'s pre-warm usually hides that by
    // bringing the canvas up early, but it polls for the main renderer with a give-up — a session that sits
    // on the title screen past it never pre-warms, and the drop is back.
    //
    // Waiting is right for an aux slot specifically: the wait is a one-off canvas init at the start of a
    // session, not a frame of gameplay, and these are shop/modal flourishes rather than a combat collision.
    // The `over` slot still declines — its renderer is the main overlay, so a missing one means the overlay
    // itself is gone, and a moment mid-fight is genuinely past by the time a retry could land.
    //
    // Exactly ONE retry (`retried`): if the init FAILED, `ensure…Slot` resolves with the renderer still
    // null (the error is caught and logged there), and an ungated retry would spin on the memoised promise
    // forever. The returned disposer cancels a retry still in flight, so a caller that tears down first —
    // the (Both) marker's loop leaving the list — never gets a late effect it can no longer stop.
    const ensure = slot === 'under' ? pixiFx.ensureUnderSlot()
      : slot === 'above' ? pixiFx.ensureAboveSlot()
        : null;
    if (!ensure || retried) return null;
    let cancelled = false;
    let stop: (() => void) | null = null;
    void ensure.then(() => {
      if (cancelled) return;
      stop = playDefInner(id, anchors, opts, true);
    });
    return () => {
      cancelled = true;
      stop?.();
      stop = null;
    };
  }

  // Per-call sizing, applied AFTER `getDef` — `scaleDef` reads the primitive registry, and nothing may do
  // that before `playDef`'s own `canPlayDefs()`-gated path (see `fxDefs.ts`'s ORDER MATTERS note). With both
  // axes at their default 1 this returns `playableDef`'s object by identity: an exact no-op.
  const def = staggerLayers(scaleDef(playableDef(stored), opts), opts.index ?? 0);
  const layers = def.layers;
  // Every layer muted = an effect that renders nothing. Declining is cheaper and more honest than mounting
  // a container and running an updater for a guaranteed-empty play.
  if (layers.length === 0) return null;

  const container = new Container();
  const unmountLayer = pixiFx.mountLayer(container, slot);
  const player = createPlayer(
    def,
    { container, renderer, uids: opts.uids },
    loopOptionsFrom(stored, opts.loop ?? false),
  );
  // A def that saved a LOCKED seed means "this exact roll" — honour it, or the composition the author
  // committed is not the one that plays. No seed (unlocked) hands over `null`: fresh roll per fire, which
  // is what an unlocked composition has always meant.
  player.setSeed(stored.seed ?? null);
  player.setSpeed(opts.speed !== undefined && Number.isFinite(opts.speed) && opts.speed > 0 ? opts.speed : 1);
  if (opts.loop) player.fireLoop(); else player.fireOnce();
  // Position every layer BEFORE anything can render. `fireOnce` spawns the t=0 layers but a primitive's head
  // starts at (0,0), so this is what guarantees a layer never exists un-positioned — independent of the
  // ticker's updater-vs-render ordering, which lives in another module.
  driveLayerHeads(player, layers, anchors, 0, null, { timeMs: 0, durationMs: def.duration });

  let wallMs = 0;
  let removeUpdater: (() => void) | null = null;
  const { retire, retired } = createRetire({
    // Teardown order mirrors the workbench's build-effect cleanup exactly: stop being ticked, kill the
    // layers (the player destroys each layer's own child container), unmount from the overlay stage, then
    // destroy our container.
    removeUpdater: () => {
      removeUpdater?.();
      removeUpdater = null;
    },
    destroyPlayer: () => player.destroy(),
    unmountLayer,
    destroyContainer: () => container.destroy({ children: true }),
    onDone: opts.onDone,
  });

  removeUpdater = pixiFx.addUpdater((dtMs) => {
    if (retired()) return; // same-frame snapshot re-entry — see `FxRetire.retired`
    wallMs += dtMs;
    player.update(dtMs);
    const overdue = !opts.loop && wallMs >= PLAY_TIMEOUT_MS; // a loop is caller-owned (see PlayDefOptions.loop)
    if (!player.isPlaying() || overdue) {
      if (overdue && import.meta.env.DEV) {
        console.warn(
          `[fx] playDef('${def.id}') passed the ${PLAY_TIMEOUT_MS}ms wall-clock cap without finishing — ` +
            'force-retiring so it cannot leak an updater for the rest of the session.',
        );
      }
      retire();
      return;
    }
    // ONE anchor resolve per layer per frame off the SNAPSHOT — no layout reads. Only `travel` actually
    // varies with progress; the rest are constant lookups.
    // The clock is what makes `travel` run along each layer's OWN window rather than the whole def's, so a
    // trail can land at its target before a burst timed to that arrival fires (see `layerTravelProgress`).
    const nowMs = player.timeMs();
    // A `follow` play re-reads its anchor from a live source each frame so the effect tracks a moving card
    // (see PlayDefOptions.follow). `null` hides the effect for this frame without ending the caller-owned
    // play; a point overrides all three of the snapshot anchors so a single-anchor emitter follows it.
    let live = anchors;
    if (opts.follow) {
      const p = opts.follow();
      if (!p) {
        container.visible = false;
        return;
      }
      container.visible = true;
      live = { source: p, target: p, cursor: p };
    }
    driveLayerHeads(player, layers, live, fireProgress(nowMs, def.duration), null, {
      timeMs: nowMs,
      durationMs: def.duration,
    });
  });

  // DEV-only fire log: a Pixi effect paints to a canvas with no DOM class, so the browser harness can't rAF-
  // sample it. This gives the committed harness a way to observe that a def fired, and when. Positive
  // `import.meta.env.DEV` branch so Rollup drops it from production builds.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as { __fxFires?: { id: string; t: number }[] };
    (w.__fxFires ??= []).push({ id, t: performance.now() });
  }

  return retire;
}

// ── DEV-only console handle ───────────────────────────────────────────────────────────────────────────
// Test-fire any committed def on the REAL board without waiting for the combat moment that scores it:
//
//   await window.__fx.ready();
//   window.__fx.play('ward-gained', window.__fx.anchors('<uid>', null));
//
// This is the fastest way to see a def in the actual game without waiting for its moment to occur (and some
// moments — `shieldUp` among them — collapse into result runs, so they don't fire on every combat). It
// mirrors the `__pixiFx` handle the shipped overlay already exposes for the same reason.
//
// STAYS DEV-only, even though playback itself now ships: this is an authoring/debug affordance, and putting
// arbitrary def-firing on `window` for players is a console surface with no upside. Written as a positive
// `import.meta.env.DEV` branch so Rollup drops the whole block from a production build.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__fx = {
    play: playDef,
    ready: ensureDefsReady,
    canPlay: canPlayDefs,
    poolSize: fxPoolSize,
    anchors: anchorsForUnits,
    list: (): string[] => listDefs().map((d) => d.id),
    /**
     * Drive the badge counter DIRECTLY on a live card, with no def, binding, layer or combat involved.
     *
     * This exists because "is the roll working?" and "is my effect wired up?" are two questions, and until
     * now the only way to ask the first was to answer the second first — a def, a bound moment, a react
     * layer, two toggles and the right game phase, any one of which fails silently. Three sessions were
     * spent chasing wiring while the mechanism itself was never in doubt.
     *
     * Paste in the console with any minion's uid (grab one from a card's `data-uid`):
     *   window.__fx.roll('<uid>', 6, 600, 6)
     * The badge should hold 6 below its true value, then reel up to it over 600ms.
     *
     * Args: uid, how much to withhold, how long to roll, reel amplitude (0 = honest odometer).
     */
    roll: (uid: string, delta = 4, ms = 600, reel = 6): void => {
      // Defaults to `effect` origin: this handle drives its own rAF below, so the store's ticker must not
      // also advance it.
      holdStat(uid, { attack: delta, health: delta });
      const t0 = performance.now();
      const step = (): void => {
        const p = (performance.now() - t0) / Math.max(1, ms);
        revealStat(uid, Math.min(1, p), reel);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
  };
}
