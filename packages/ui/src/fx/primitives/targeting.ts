import { Graphics } from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { createLassoState, stepLasso, type AimLassoCfg, type AimLassoState, type Vec2 } from '../../aimLasso';

/**
 * The `targeting` primitive: a glowing "magic lasso" that strings from a SOURCE (the caster) to a moving
 * cursor END, bobbing and swaying as the cursor moves. It is the workshop-authorable LOOK behind the Hero Aim
 * targeting line (the game's persistent aim driver plays an instance of this — see `pixiFx.setAimLine`).
 *
 * The motion is `aimLasso.ts` (pure, unit-tested): a spring chain that lags and whips the ribbon as the cursor
 * moves, plus a speed-scaled perpendicular sway. This primitive owns only the PIXI side — a layered Graphics
 * stroke (a soft glow underlay beneath a bright, optionally tapered core) plus a custom Pixi pointer at the
 * cursor end — and the wiring into the workshop (params, live tuning, the filter lab / blur / transform stack).
 *
 * Endpoints:
 *   • `to`   = this layer's own head (`setHead`). Anchor the layer to `cursor` so it follows the live pointer,
 *              both in the workshop preview and when the game feeds the cursor.
 *   • `from` = the moment's SOURCE from `setAim` (delivered only when both ends were staged). With no aim (a
 *              cursor-only preview) it falls back to a point below the cursor so the lasso still draws.
 */

const SPECS = {
  // ── The ribbon ────────────────────────────────────────────────────────────────────────────────────────
  coreWidth: {
    kind: 'slider', label: 'Line width', group: 'Lasso', min: 1, max: 16, step: 0.5, default: 8,
    help: 'Thickness of the bright core line.',
  },
  coreAlpha: {
    kind: 'slider', label: 'Line opacity', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.95,
    help: 'Opacity of the core line.',
  },
  glowWidth: {
    kind: 'slider', label: 'Aura width', group: 'Lasso', min: 0, max: 40, step: 1, default: 12,
    help: 'Thickness of the soft aura around the line. 0 removes it.',
  },
  glowAlpha: {
    kind: 'slider', label: 'Aura opacity', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.7,
    help: 'Peak opacity of that aura (it breathes below this).',
  },
  taper: {
    kind: 'slider', label: 'Taper', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.5,
    help: 'How much the core narrows toward the cursor end. 0 = even thickness.',
  },
  breathe: {
    kind: 'slider', label: 'Aura breathe', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.5,
    help: 'How much the aura pulses while the line is held. 0 = steady.',
  },
  colorCore: { kind: 'color', label: 'Line colour', group: 'Lasso', default: 0xffd9a0, help: 'Colour of the core line.' },
  colorGlow: { kind: 'color', label: 'Aura colour', group: 'Lasso', default: 0xffa82e, help: 'Colour of the aura around it.' },

  // ── The motion (aimLasso.ts) ──────────────────────────────────────────────────────────────────────────
  segments: {
    kind: 'slider', label: 'Segments', group: 'Motion', min: 4, max: 40, step: 1, default: 22,
    help: 'How many pieces the lasso is built from — higher is smoother, slightly costlier.',
  },
  curve: {
    kind: 'slider', label: 'Arch', group: 'Motion', min: 0, max: 0.6, step: 0.02, default: 0.26,
    help: 'How far the lasso bows away from a straight line.',
  },
  curveVar: {
    kind: 'slider', label: 'Arch randomness', group: 'Motion', min: 0, max: 1, step: 0.05, default: 0.4,
    help: 'How much the arch varies each time you start aiming. 0 = the same bow every time.',
  },
  springStiffness: {
    kind: 'slider', label: 'Spring', group: 'Motion', min: 20, max: 400, step: 5, default: 150,
    help: 'How strongly the lasso pulls toward its resting shape. Higher tracks the cursor more tightly.',
  },
  springDamping: {
    kind: 'slider', label: 'Damping', group: 'Motion', min: 2, max: 60, step: 1, default: 16,
    help: 'How quickly the whip settles. Lower = more bounce and overshoot; higher = calmer.',
  },
  swayAmp: {
    kind: 'slider', label: 'Sway', group: 'Motion', min: 0, max: 40, step: 1, default: 7,
    help: 'Resting perpendicular sway, in px — the idle bob when the cursor is still.',
  },
  swayFreq: {
    kind: 'slider', label: 'Sway waves', group: 'Motion', min: 0, max: 4, step: 0.1, default: 1.6,
    help: 'How many sway waves ripple along the lasso.',
  },
  swaySpeed: {
    kind: 'slider', label: 'Sway speed', group: 'Motion', min: 0, max: 6, step: 0.1, default: 2,
    help: 'How fast the idle bob cycles.',
  },
  motionInfluence: {
    kind: 'slider', label: 'Motion sway', group: 'Motion', min: 0, max: 0.05, step: 0.001, default: 0.012,
    help: 'How much cursor SPEED grows the sway — the whip when you move fast. 0 = motion has no effect.',
  },

  // ── The cursor pointer ────────────────────────────────────────────────────────────────────────────────
  pointerSize: {
    kind: 'slider', label: 'Pointer size', group: 'Pointer', min: 0, max: 40, step: 1, default: 12,
    help: 'Radius of the pointer at the cursor end. 0 removes it.',
  },
  pointerGlow: {
    kind: 'slider', label: 'Pointer aura', group: 'Pointer', min: 0, max: 40, step: 1, default: 10,
    help: 'Soft aura around the pointer.',
  },
  pointerTicks: {
    kind: 'slider', label: 'Pointer ticks', group: 'Pointer', min: 0, max: 8, step: 1, default: 4,
    help: 'A rotating reticle of this many ticks around the pointer. 0 = a plain dot.',
  },
  pointerSpin: {
    kind: 'slider', label: 'Pointer spin', group: 'Pointer', min: -6, max: 6, step: 0.1, default: 1.5,
    help: 'How fast the reticle ticks spin (turns/sec). Negative spins the other way.',
  },
  onTargetGrow: {
    kind: 'slider', label: 'On-target grow', group: 'Pointer', min: 1, max: 2.5, step: 0.05, default: 1.6,
    help: 'How much the pointer grows when hovering a valid target.',
  },
  colorPointer: { kind: 'color', label: 'Pointer colour', group: 'Pointer', default: 0xffe6b0, help: 'Colour of the pointer core.' },
  onTargetPreview: {
    kind: 'toggle', label: 'Preview on-target', group: 'Pointer', default: false,
    help: 'Workshop only: force the on-target (grown) pointer so you can tune that state.',
  },

  blendMode: {
    kind: 'enum', label: 'Blend', group: 'Lasso', options: FX_BLEND_MODES, default: 'add',
    help: 'How the lasso composites. Add gives the luminous look.',
  },
  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
} satisfies FxParamSpecs;

type TargetingParams = ParamsOf<typeof SPECS>;

const TAU = Math.PI * 2;

/** The subset of the params the pure motion model reads, pulled out each frame (live-tunable). */
function lassoCfg(p: TargetingParams): AimLassoCfg {
  return {
    segments: p.segments,
    curve: p.curve,
    curveVar: p.curveVar,
    springStiffness: p.springStiffness,
    springDamping: p.springDamping,
    swayAmp: p.swayAmp,
    swayFreq: p.swayFreq,
    swaySpeed: p.swaySpeed,
    motionInfluence: p.motionInfluence,
  };
}

class TargetingInstance implements FxInstance<TargetingParams> {
  private readonly g: Graphics;
  private params: TargetingParams;
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;

  private state: AimLassoState | null = null;
  private elapsed = 0;      // seconds, for the idle sway + breathe clock
  private spin = 0;         // pointer reticle angle, radians

  // `to` = the layer's own head; `from` = the moment source (setAim). See the header.
  private headX = 0; private headY = 0; private headSet = false;
  private aimSet = false;
  private sx = 0; private sy = 0;
  private prevTo: Vec2 | null = null;
  private speed = 0;        // smoothed cursor speed, px/s
  private onTarget = false; // fed live by the game driver (see setOnTarget)

  constructor(ctx: FxContext, params: TargetingParams) {
    this.params = params;
    this.g = new Graphics();
    this.g.blendMode = params.blendMode;
    ctx.container.addChild(this.g);
    this.filters = new FilterStack(ctx.container, FILTERS);
    this.transform = new ContainerTransform(ctx.container);
  }

  setHead(x: number, y: number): void { this.headX = x; this.headY = y; this.headSet = true; }
  setAim(sx: number, sy: number, _tx: number, _ty: number): void { this.sx = sx; this.sy = sy; this.aimSet = true; }
  /** Live game state (not a param): the pointer grows while a valid target is under the cursor. */
  setOnTarget(on: boolean): void { this.onTarget = on; }

  private endpoints(): { from: Vec2; to: Vec2 } {
    const to: Vec2 = { x: this.headX, y: this.headY };
    // With a staged source, string from it; otherwise (cursor-only preview) rise from just below the cursor.
    const from: Vec2 = this.aimSet ? { x: this.sx, y: this.sy } : { x: to.x, y: to.y + 300 };
    return { from, to };
  }

  update(dtMs: number): void {
    if (!this.headSet) return; // nothing to anchor the cursor end to yet
    const dt = Math.max(0, dtMs / 1000);
    this.elapsed += dt;
    const p = this.params;
    this.spin += p.pointerSpin * dt * TAU; // pointer reticle rotation, dt-correct
    const cfg = lassoCfg(p);
    const { from, to } = this.endpoints();

    // Smoothed cursor speed drives the motion sway. EMA so a single jumpy frame doesn't spike it.
    if (this.prevTo && dt > 0) {
      const inst = Math.hypot(to.x - this.prevTo.x, to.y - this.prevTo.y) / dt;
      this.speed += (inst - this.speed) * Math.min(1, dt * 12);
    }
    this.prevTo = { x: to.x, y: to.y };

    if (!this.state) this.state = createLassoState(from, to, cfg);
    const pts = stepLasso(this.state, from, to, this.speed, dt, this.elapsed, cfg);

    this.render(pts, to);

    // Continuous effect: hold the filter/transform stacks at a gently looping progress so any curve-based
    // filter still breathes, without a start/end lifecycle. (0→1→0 over 2s.)
    const prog = 0.5 - 0.5 * Math.cos(this.elapsed * Math.PI);
    this.filters.frame(p, prog, dt);
    this.transform.frame(p, prog, dt, from.x, from.y);
  }

  private render(pts: Vec2[], to: Vec2): void {
    const p = this.params;
    const g = this.g;
    g.clear();
    if (pts.length < 2) return;
    const breatheK = 1 - p.breathe * (0.5 + 0.5 * Math.sin(this.elapsed * 2.4));

    // Aura underlay — one soft, uniform-width stroke beneath the core.
    if (p.glowWidth > 0 && p.glowAlpha > 0) {
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      g.stroke({ width: p.coreWidth + p.glowWidth, color: p.colorGlow, alpha: p.glowAlpha * breatheK, cap: 'round', join: 'round' });
    }

    // Bright core — stroked per segment so the width can TAPER toward the cursor end (uniform when taper=0).
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const w = p.coreWidth * (1 - p.taper * t);
      g.moveTo(pts[i]!.x, pts[i]!.y);
      g.lineTo(pts[i + 1]!.x, pts[i + 1]!.y);
      g.stroke({ width: Math.max(0.3, w), color: p.colorCore, alpha: p.coreAlpha, cap: 'round', join: 'round' });
    }

    // The custom Pixi pointer at the cursor end.
    if (p.pointerSize > 0) {
      const grow = (this.onTarget || p.onTargetPreview) ? p.onTargetGrow : 1;
      const r = p.pointerSize * grow;
      if (p.pointerGlow > 0) g.circle(to.x, to.y, r + p.pointerGlow * 0.5).fill({ color: p.colorGlow, alpha: p.glowAlpha * breatheK });
      g.circle(to.x, to.y, r).fill({ color: p.colorPointer, alpha: p.coreAlpha });
      // A rotating reticle of ticks around the pointer.
      if (p.pointerTicks > 0) {
        const ticks = Math.round(p.pointerTicks);
        const inner = r * 1.35, outer = r * 1.95;
        for (let k = 0; k < ticks; k++) {
          const a = this.spin + (k / ticks) * TAU;
          const ca = Math.cos(a), sa = Math.sin(a);
          g.moveTo(to.x + ca * inner, to.y + sa * inner);
          g.lineTo(to.x + ca * outer, to.y + sa * outer);
          g.stroke({ width: Math.max(1, p.coreWidth * 0.4), color: p.colorPointer, alpha: p.coreAlpha * breatheK, cap: 'round' });
        }
      }
    }
  }

  setParams(next: TargetingParams): void {
    this.params = next;
    this.g.blendMode = next.blendMode;
  }

  destroy(): void {
    this.filters.destroy();
    this.g.destroy();
  }
}

export const targetingPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'targeting',
  params: SPECS,
  spawn: (ctx, params) => new TargetingInstance(ctx, params),
};

registerPrimitive(targetingPrimitive as FxPrimitive);
