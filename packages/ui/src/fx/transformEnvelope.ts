/**
 * The WHOLE-EFFECT TRANSFORM envelope — scale, spin and drift applied to a primitive's container over the
 * effect's life. The transform sibling of `blurFilter.ts`/`filterStack.ts`: particles carry their own size and
 * motion, but nothing could scale, rotate or translate the effect AS A WHOLE until this. Spin a burst as it
 * fires, swell a shockwave, drift smoke upward, recoil a hit.
 *
 * The layer container sits at the stage origin and its children draw at ABSOLUTE screen coords (see
 * `player.ts`), so a bare `container.scale` would pivot around the screen's top-left. Instead we pivot around
 * the effect's HEAD (the resolved anchor the primitive already tracks): `pivot = position = head` makes an
 * identity transform a true no-op AND makes scale/rotation happen about the effect's own centre. The primitive
 * passes its head into `frame()` each tick.
 *
 * `TRANSFORM_PARAM_SPECS` (spread into each primitive's `SPECS`) all default to identity, so an untouched
 * effect is byte-for-byte unchanged. No GPU resource is held, so there is nothing to destroy — the player
 * tears the container down.
 */
import type { Container } from 'pixi.js';
import { sampleCurve, CURVE_PRESETS } from './curve';
import type { FxParamSpecs } from './params';

const DEG_TO_RAD = Math.PI / 180;

/** The shared transform knobs. Spread into a primitive's `SPECS`. All identity by default (scale curve flat 1,
 *  spin 0, drift 0), so they do nothing until authored. */
export const TRANSFORM_PARAM_SPECS = {
  fxScaleCurve: {
    kind: 'curve', label: 'Scale / time', group: 'Transform', default: [[0, 1], [1, 1]], vMax: 4, presets: CURVE_PRESETS,
    help: 'Scales the WHOLE effect over its life (0 = it fires, 1 = it finishes), about its own centre — 1 is untouched, a rising curve swells it into a bloom, a falling one collapses it, a bump-then-settle gives a pop. Flat 1 = no scaling.',
  },
  fxSpin: {
    kind: 'slider', label: 'Spin', group: 'Transform', min: -720, max: 720, step: 5, default: 0,
    help: 'Spins the WHOLE effect about its centre, in degrees per second — positive clockwise, negative anti-clockwise, 0 off. A slow spin churns a burst; a fast one whirls it. Independent of any per-particle spin.',
  },
  fxDriftX: {
    kind: 'slider', label: 'Drift X', group: 'Transform', min: -400, max: 400, step: 1, default: 0,
    help: 'Slides the WHOLE effect sideways over its life, in px (positive = right). 0 off. Paired with Drift / time for the ramp.',
  },
  fxDriftY: {
    kind: 'slider', label: 'Drift Y', group: 'Transform', min: -400, max: 400, step: 1, default: 0,
    help: 'Slides the WHOLE effect up/down over its life, in px (negative = up, so -120 makes smoke rise). 0 off. Paired with Drift / time for the ramp.',
  },
  fxDriftCurve: {
    kind: 'curve', label: 'Drift / time', group: 'Transform', default: [[0, 0], [1, 1]], vMax: 1, presets: CURVE_PRESETS,
    help: 'How the Drift X/Y offset ramps over the effect\'s life — the default 0→1 eases the effect from its origin to the full drift by the end; flat 1 snaps the whole offset on immediately. Does nothing while both Drifts are 0.',
  },
} satisfies FxParamSpecs;

type P = Record<string, unknown>;
const num = (p: P, k: string, d = 0): number => (typeof p[k] === 'number' ? p[k] as number : d);
const curveOf = (p: P, k: string, id: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> => (Array.isArray(p[k]) ? p[k] as [number, number][] : id);

const FLAT1: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 1]];
const IDENTITY: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 1]];

/** Applies the transform envelope to one primitive's container. Construct with `ctx.container`; call `frame()`
 *  once per frame from `update()` with the effect's timeline progress, the frame's seconds, and the head to
 *  pivot about. Holds no GPU resource — no `destroy()` needed. */
export class ContainerTransform {
  private spinRad = 0;
  constructor(private readonly container: Container) {}

  frame(params: P, progress: number, dtSec: number, headX: number, headY: number): void {
    this.spinRad += num(params, 'fxSpin') * DEG_TO_RAD * dtSec;
    const scale = sampleCurve(curveOf(params, 'fxScaleCurve', FLAT1), progress);
    const driftMul = sampleCurve(curveOf(params, 'fxDriftCurve', IDENTITY), progress);
    const c = this.container;
    // pivot = position = head → an identity transform maps every child back to itself (a true no-op), and
    // scale/rotation happen about the effect's centre rather than the stage origin.
    c.pivot.set(headX, headY);
    c.position.set(headX + num(params, 'fxDriftX') * driftMul, headY + num(params, 'fxDriftY') * driftMul);
    c.scale.set(scale);
    c.rotation = this.spinRad;
  }
}
