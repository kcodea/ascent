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
   * Optional: the composition's `source` anchor, in the same screen space as `setHead`, delivered each frame
   * alongside it (see `driveLayerHeads`).
   *
   * A layer only ever learns its OWN head — which is all a `travel` ribbon or a `target` burst needs — so a
   * primitive that wants to point AWAY from where the effect came from has no way to ask. This is that one
   * extra point, and it is deliberately optional on both sides: a scenario that stages no `source` never
   * calls it, so an implementer must treat "never called" as a real state (`burst`'s `awayFrom` falls back to
   * its travel-direction behaviour there) rather than assuming (0, 0).
   */
  setSource?(x: number, y: number): void;
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
