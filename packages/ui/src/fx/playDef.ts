/// <reference types="vite/client" />
import { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { driveLayerHeads, type FxAnchors } from './anchors';
import type { FxDef } from './def';
import type { StoredFxDef, StoredFxLayer } from './defStore';
import { anchorsForUnits } from './combatAnchors';
import { getDef, listDefs } from './fxDefs';
import { createPlayer } from './player';
import { listPrimitives } from './registry';

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
 * Inert in a production build, by design and unchanged by this module: the def registry (`fxDefs.ts`) is
 * DEV-gated at its `import.meta.glob`, and the primitives self-register only via the DEV-gated dynamic
 * import `ensureDefsReady()` performs. So in prod `getDef()` misses, `canPlayDefs()` is false, and
 * `playDef()` returns `null` without allocating anything. **Nothing here un-gates that.** Shipping defs to
 * players is a separate, explicit decision — it means shipping the primitives and their GLSL source into
 * the prod bundle, which is exactly what those two gates exist to prevent today.
 *
 * Nothing in here throws. A miss (unknown id, no renderer, no playable layers) is `null`, which the caller
 * treats as "no FX for this moment" and moves on.
 */

export interface PlayDefOptions {
  /** Playback rate multiplier (e.g. the combat-speed dial). Non-finite or ≤ 0 falls back to 1 — a paused
   *  fire-and-forget effect would never retire, so "0" is treated as caller error rather than honoured. */
  speed?: number;
  /** Called EXACTLY once when the effect retires — whether it played out naturally or was cancelled — and
   *  after teardown has finished, so the callback sees a fully cleaned-up world. */
  onDone?: () => void;
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
 * Both halves are false in a production build (see the module header) and false headless, so this is the
 * one call a caller needs to decide "defs, or the hand-written FX path". It is deliberately NOT a promise —
 * a per-moment call site must not await anything.
 */
export function canPlayDefs(): boolean {
  return listPrimitives().length > 0 && pixiFx.renderer !== null;
}

/** Memoised so N callers awaiting readiness share ONE dynamic import. A failed import is not retried: the
 *  path is static, so a second attempt resolves the same way. */
let readying: Promise<void> | null = null;

/**
 * Await def-playing readiness — i.e. register the built-in primitives, in DEV.
 *
 * The import is DEV-gated exactly as `Workbench.tsx`'s is, and for exactly the same reason: the primitives
 * self-register via a top-level function CALL, a side effect Rollup cannot prove away, so a static import
 * would drag the whole set (GLSL shader source included) into the production bundle even though nothing
 * there can ever play a def. Written as a positive `import.meta.env.DEV && …` branch so prod's constant
 * folding turns the whole block into `if (false)` and dead-code-eliminates the `import()` with it.
 *
 * Resolves (never rejects) in every case: already-ready, just-loaded, load-failed, and production — where it
 * resolves immediately and `canPlayDefs()` stays false. **This does not un-gate anything for players.**
 */
export function ensureDefsReady(): Promise<void> {
  if (import.meta.env.DEV && listPrimitives().length === 0) {
    readying ??= import('./primitives').then(
      () => undefined,
      (e: unknown) => {
        console.warn('[fx] could not load the def primitives — defs will not play:', e);
      },
    );
    return readying;
  }
  return Promise.resolve();
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
export function playDef(id: string, anchors: FxAnchors, opts: PlayDefOptions = {}): (() => void) | null {
  const stored = getDef(id);
  if (!stored) {
    // DEV-only: in prod the registry is empty by design, so this would fire for every call and say nothing.
    if (import.meta.env.DEV) console.warn(`[fx] playDef: no committed def '${id}' — nothing fired.`);
    return null;
  }
  // `createPlayer` and every primitive's `spawn` require a real renderer; the overlay's `attach()`/`init()`
  // is async, so "not yet" is a normal state, not an error. Unlike the workbench (which polls until one
  // exists) a combat moment is gone by the time a poll would resolve, so this simply declines.
  const renderer = pixiFx.renderer;
  if (!renderer) return null;

  const def = playableDef(stored);
  const layers = def.layers;
  // Every layer muted = an effect that renders nothing. Declining is cheaper and more honest than mounting
  // a container and running an updater for a guaranteed-empty play.
  if (layers.length === 0) return null;

  const container = new Container();
  const unmountLayer = pixiFx.mountLayer(container);
  const player = createPlayer(def, { container, renderer }, { loop: false });
  // A def that saved a LOCKED seed means "this exact roll" — honour it, or the composition the author
  // committed is not the one that plays. No seed (unlocked) hands over `null`: fresh roll per fire, which
  // is what an unlocked composition has always meant.
  player.setSeed(stored.seed ?? null);
  player.setSpeed(opts.speed !== undefined && Number.isFinite(opts.speed) && opts.speed > 0 ? opts.speed : 1);
  player.fireOnce();
  // Position every layer BEFORE anything can render. `fireOnce` spawns the t=0 layers but a primitive's head
  // starts at (0,0), so this is what guarantees a layer never exists un-positioned — independent of the
  // ticker's updater-vs-render ordering, which lives in another module.
  driveLayerHeads(player, layers, anchors, 0);

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
    const overdue = wallMs >= PLAY_TIMEOUT_MS;
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
    driveLayerHeads(player, layers, anchors, fireProgress(player.timeMs(), def.duration));
  });

  return retire;
}

// ── DEV-only console handle ───────────────────────────────────────────────────────────────────────────
// Test-fire any committed def on the REAL board without waiting for the combat moment that scores it:
//
//   await window.__fx.ready();
//   window.__fx.play('ward-gained', window.__fx.anchors('<uid>', null));
//
// This is the only way to see a def in the actual game before its moment happens to occur (and some
// moments — `shieldUp` among them — collapse into result runs, so they don't fire on every combat). It
// mirrors the `__pixiFx` handle the shipped overlay already exposes for the same reason. Written as a
// positive `import.meta.env.DEV` branch so Rollup drops the whole block from a production build.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__fx = {
    play: playDef,
    ready: ensureDefsReady,
    canPlay: canPlayDefs,
    anchors: anchorsForUnits,
    list: (): string[] => listDefs().map((d) => d.id),
  };
}
