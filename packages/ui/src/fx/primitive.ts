import type { Container, Renderer } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from './params';

/** What a primitive is handed when it spawns. The container is already parented to the overlay stage. */
export interface FxContext {
  container: Container;
  renderer: Renderer;
}

/** A live instance of a primitive. The player owns its lifetime. */
export interface FxInstance {
  /** Advance by `dtMs`. Called once per frame while the layer is active. */
  update(dtMs: number): void;
  /** Apply edited parameters without a respawn — this is what makes live tuning feel instant. */
  setParams(next: Record<string, unknown>): void;
  /** Optional: primitives that follow a path (ribbons, trails) receive their head position each frame. */
  setHead?(x: number, y: number): void;
  destroy(): void;
}

/** A unit of rendering. Its parameters are declared once in `params` (see `params.ts`). */
export interface FxPrimitive<S extends FxParamSpecs = FxParamSpecs> {
  id: string;
  params: S;
  spawn(ctx: FxContext, params: ParamsOf<S>): FxInstance;
}
