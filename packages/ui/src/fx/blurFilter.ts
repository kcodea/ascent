/**
 * The post-process BLUR shared across every primitive — the filter-layer analogue of `blendModes.ts`.
 *
 * A primitive's shaders and particle textures give per-particle softness (Glow, alpha falloff); this is the
 * one thing they can't do — a soft-focus blur over the WHOLE effect, rendered to a texture and blurred, which
 * reads as an out-of-focus AURA. `pixi.js` core ships `BlurFilter`, so this needs no extra dependency.
 *
 * Two halves, both reused by every primitive so the knob and its behaviour can't drift between them:
 *  - `BLUR_PARAM_SPECS` — the `blur` strength slider + the `blurCurve` over-effect-time envelope, spread into
 *    each primitive's own `SPECS`.
 *  - `ContainerBlur` — owns the `BlurFilter`'s whole lifecycle on the primitive's container: created only when
 *    `blur > 0` (so a no-blur effect allocates nothing and pays no render-to-texture pass), retimed each frame
 *    by the envelope, and destroyed with the instance. It lives on the primitive's OWN overlay container, not
 *    on any pooled particle container, so it never leaks onto the next user of a pooled layer.
 */
import { BlurFilter, type Container } from 'pixi.js';
import { sampleCurve, CURVE_PRESETS, type CurvePoint } from './curve';
import type { FxParamSpecs } from './params';

/** The shared blur knobs. Spread into a primitive's `SPECS` (`{ ...BLUR_PARAM_SPECS, ... }`) so every effect
 *  type offers the identical pair. Both default to a NO-OP: `blur` 0 (no filter at all) and a flat-1 curve. */
export const BLUR_PARAM_SPECS = {
  blur: {
    kind: 'slider', label: 'Blur', group: 'Style', min: 0, max: 30, step: 0.5, default: 0,
    help: 'A soft-focus blur over the WHOLE effect — 0 is crisp, higher smears it into a hazy, out-of-focus AURA. Unlike Glow (a per-particle halo baked in the shader) this is a post-process: the effect is rendered to a texture and blurred, so it costs more than Glow — keep it modest and profile if many fire at once. 0 pays nothing (no filter at all). The Blur / time graph shapes this strength over the effect\'s life.',
  },
  blurCurve: {
    kind: 'curve', label: 'Blur / time', group: 'Style',
    // A 0->1 envelope over the WHOLE effect's life (NOT per-particle like the motion/shape curves): X is the
    // effect's elapsed time normalised by its own reference duration, Y multiplies the Blur strength. Flat 1 =
    // constant blur (the no-op default). vMax 1 so the graph is a clean fraction of the set strength.
    default: [[0, 1], [1, 1]], vMax: 1, presets: CURVE_PRESETS,
    help: 'How the Blur strength ramps over the EFFECT\'s life (0 = the moment it fires, 1 = it finishes), NOT per-particle. Flat 1 = the Blur holds constant. Rising = sharp then blooming into an aura; falling = born as a haze that resolves into crisp detail. Does nothing while Blur is 0.',
  },
} satisfies FxParamSpecs;

/**
 * Owns a `BlurFilter` on one primitive's container. Construct with the primitive's `ctx.container`; call
 * `frame()` once per frame from `update()` with the primitive's own 0..1 timeline progress; call `destroy()`
 * from the primitive's `destroy()`.
 */
export class ContainerBlur {
  private filter: BlurFilter | null = null;
  constructor(private readonly container: Container) {}

  /** Reconcile the filter to `base` and set its live strength to `base × curve(progress)`. Creates the filter
   *  the first frame `base > 0`, destroys it the first frame `base` returns to 0, and otherwise just retimes
   *  the one live instance — so live-tuning the slider or the graph never rebuilds a GPU resource. */
  frame(base: number, curve: ReadonlyArray<CurvePoint>, progress: number): void {
    if (base > 0) {
      if (!this.filter) {
        this.filter = new BlurFilter({ strength: 0, quality: 5 });
        this.container.filters = [this.filter];
      }
      this.filter.strength = Math.max(0, base * sampleCurve(curve, progress));
    } else if (this.filter) {
      this.destroy();
    }
  }

  /** Detach + free the filter (a GPU resource). Idempotent. */
  destroy(): void {
    if (this.filter) {
      this.container.filters = [];
      this.filter.destroy();
      this.filter = null;
    }
  }
}
