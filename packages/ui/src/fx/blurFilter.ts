/**
 * The shared BLUR knobs — the always-on core blur every primitive offers, the filter-layer analogue of
 * `blendModes.ts`. A primitive's shaders and particle textures give per-particle softness (Glow, alpha
 * falloff); this is the one thing they can't do — a soft-focus blur over the WHOLE effect, rendered to a
 * texture and blurred, which reads as an out-of-focus AURA. `pixi.js` core ships `BlurFilter`, so no dep.
 *
 * `BLUR_PARAM_SPECS` (the `blur` strength slider + the `blurCurve` over-effect-time envelope) is spread into
 * each primitive's own `SPECS`. The filter itself is owned by `FilterStack` (`filterStack.ts`), which reads
 * these two params as its always-on core-blur entry alongside the toggle-gated pixi-filters — so a primitive
 * writes `container.filters` exactly once, from one place.
 */
import { CURVE_PRESETS } from './curve';
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
