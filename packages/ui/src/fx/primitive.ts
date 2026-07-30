import type { Container, Renderer } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from './params';

/** What a primitive is handed when it spawns. The container is already parented to the overlay stage. */
export interface FxContext {
  container: Container;
  renderer: Renderer;
  /** True when this instance was spawned for a one-shot "Fire" (play once and finish), false/undefined for
   *  the continuous preview loop. A primitive uses it to do a single discrete play — one burst wave, one
   *  shockwave ring cycle, a bounded emitter window — instead of its continuous/re-firing behaviour. */
  oneShot?: boolean;
  /** Deterministic seed for this instance's randomness. When omitted, the primitive rolls a fresh one — so
   *  behaviour is unchanged for any caller that doesn't set it. Supplying one makes a tuning reproducible:
   *  the same seed replays the same roll, so a good-looking variant can be held still while you tune around
   *  it, screenshotted, or A/B'd against another tuning with the randomness controlled. See `fx/rng.ts`. */
  seed?: number;
}

/**
 * A live instance of a primitive. The player owns its lifetime.
 *
 * Generic over its own params type `P` rather than `Record<string, unknown>`. This isn't defeated by type
 * erasure at the player boundary: `ParamsOf<S>` for an erased `S extends FxParamSpecs` (i.e. `S =
 * FxParamSpecs`, the union of all four spec kinds) does not collapse to `unknown`. The `S[K] extends {
 * kind: 'enum'; ... }` check inside `ParamsOf` fails for every key, because `S[K]` here is the WHOLE erased
 * `FxParamSpec` union rather than a single spec (no member covers all four kinds' shapes, so the union
 * can't satisfy the `options` branch) — meaning every key falls through to the `S[K]['default']` branch.
 * THAT branch distributes (indexed access into a union distributes), resolving to `Record<string, string |
 * number | boolean>`, exactly what `coerceParams` already returns. So `setParams` stays real-typed even for
 * a primitive fetched from the registry by id.
 */
export interface FxInstance<P = Record<string, unknown>> {
  /** Advance by `dtMs`. Called once per frame while the layer is active. */
  update(dtMs: number): void;
  /** Apply edited parameters without a respawn — this is what makes live tuning feel instant. */
  setParams(next: P): void;
  /** Optional: primitives that follow a path (ribbons, trails) receive their head position each frame. */
  setHead?(x: number, y: number): void;
  /**
   * Optional: the fire's own SOURCE→TARGET vector in screen space — "which way this moment went" (an
   * attacker→defender blow, a caster→victim bolt). A primitive uses it to orient itself along the moment
   * rather than along its own motion; `burst`'s `aimMode: 'sourceToTarget'` is the caller this exists for.
   *
   * Delivered ONLY when the fire actually STAGED both anchors (see `driveLayerHeads`). That gate is the whole
   * point of the channel: `resolveAnchor` invents `(0, 0)` for an unstaged anchor, so a primitive that read
   * the anchors itself could not tell "no source" from "a source at the origin" — and would silently aim at
   * the top-left corner of the screen. An instance that is never called simply has no aim and falls back.
   *
   * A layer's own head is deliberately NOT one of the two points. The vector describes the MOMENT, not the
   * layer, so every layer of a composition aims the same way whichever anchor its author pinned it to.
   */
  setAim?(sx: number, sy: number, tx: number, ty: number): void;
  /** Optional: for one-shot effects, returns true once the instance has nothing left to render (all
   *  particles dead, all rings finished). The player uses it to know when a Fire has fully played out.
   *  Continuous effects (or any instance not spawned oneShot) may omit it or always return false. */
  isComplete?(): boolean;
  destroy(): void;
}

/** A unit of rendering. Its parameters are declared once in `params` (see `params.ts`). */
export interface FxPrimitive<S extends FxParamSpecs = FxParamSpecs> {
  id: string;
  params: S;
  spawn(ctx: FxContext, params: ParamsOf<S>): FxInstance<ParamsOf<S>>;
}
