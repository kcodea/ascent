import { Graphics } from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { turbulenceX, turbulenceY } from '../motion';
import { SHAPE_NAMES } from '../shapeTextures';
import { createLassoState, stepLasso, type AimLassoCfg, type AimLassoState, type Vec2 } from '../../aimLasso';

/**
 * The `targeting` primitive: a glowing "magic lasso" from a SOURCE (the caster) to a moving cursor END, that
 * bobs, sways and whips with cursor motion — and sheds SPARKLES along its length and off the pointer. It is a
 * deliberately GENERAL editor for targeting looks (many lassos, not one baked effect): the ribbon, the pointer,
 * and the sparks are all knob-driven, and the sparks' MOTION is exposed as params (base speed, gravity, drag,
 * motion-fling, spread, twinkle, life, size decay, two colours) so drift-twinkle, falling embers and
 * cling-then-fling are all reachable from the same primitive. It is the workshop-authorable LOOK behind the
 * Hero Aim targeting line (the game's persistent aim driver plays an instance — see `pixiFx.setAimLine`).
 *
 * Motion of the RIBBON is `aimLasso.ts` (pure, unit-tested). This module owns the PIXI side: a layered Graphics
 * stroke (soft aura + tapered core), a custom pointer, a lightweight additive spark system, and the wiring into
 * the workshop (params, live tuning, filter lab / blur / transform).
 *
 * Endpoints: `to` = this layer's head (`setHead`; anchor the layer to `cursor`); `from` = the moment SOURCE
 * (`setAim`, delivered when both ends are staged), falling back to a point below the cursor for a cursor-only
 * preview so the lasso still draws.
 */

const SPECS = {
  // ── The ribbon ────────────────────────────────────────────────────────────────────────────────────────
  coreWidth: { kind: 'slider', label: 'Line width', group: 'Lasso', min: 1, max: 16, step: 0.5, default: 8, help: 'Thickness of the bright core line.' },
  coreAlpha: { kind: 'slider', label: 'Line opacity', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.95, help: 'Opacity of the core line.' },
  glowWidth: { kind: 'slider', label: 'Aura width', group: 'Lasso', min: 0, max: 40, step: 1, default: 12, help: 'Thickness of the soft aura around the line. 0 removes it.' },
  glowAlpha: { kind: 'slider', label: 'Aura opacity', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.7, help: 'Peak opacity of that aura (it breathes below this).' },
  taper: { kind: 'slider', label: 'Taper', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.5, help: 'How much the core narrows toward the cursor end. 0 = even thickness.' },
  breathe: { kind: 'slider', label: 'Aura breathe', group: 'Lasso', min: 0, max: 1, step: 0.05, default: 0.5, help: 'How much the aura pulses while held. 0 = steady.' },
  colorCore: { kind: 'color', label: 'Line colour', group: 'Lasso', default: 0xffd9a0, help: 'Colour of the core line.' },
  colorGlow: { kind: 'color', label: 'Aura colour', group: 'Lasso', default: 0xffa82e, help: 'Colour of the aura around it.' },
  blendMode: { kind: 'enum', label: 'Blend', group: 'Lasso', options: FX_BLEND_MODES, default: 'add', help: 'How the whole lasso composites. Add gives the luminous look.' },

  // ── The motion (aimLasso.ts) ──────────────────────────────────────────────────────────────────────────
  segments: { kind: 'slider', label: 'Segments', group: 'Motion', min: 4, max: 40, step: 1, default: 22, help: 'How many pieces the lasso is built from — higher is smoother.' },
  curve: { kind: 'slider', label: 'Arch', group: 'Motion', min: 0, max: 0.6, step: 0.02, default: 0.26, help: 'How far the lasso bows away from straight.' },
  curveVar: { kind: 'slider', label: 'Arch randomness', group: 'Motion', min: 0, max: 1, step: 0.05, default: 0.4, help: 'How much the arch varies each aim. 0 = same bow every time.' },
  springStiffness: { kind: 'slider', label: 'Spring', group: 'Motion', min: 20, max: 400, step: 5, default: 150, help: 'How strongly the lasso pulls toward its resting shape. Higher tracks tighter.' },
  springDamping: { kind: 'slider', label: 'Damping', group: 'Motion', min: 2, max: 60, step: 1, default: 16, help: 'How quickly the whip settles. Lower = more bounce.' },
  swayAmp: { kind: 'slider', label: 'Sway', group: 'Motion', min: 0, max: 40, step: 1, default: 7, help: 'Resting perpendicular sway (idle bob), in px.' },
  swayFreq: { kind: 'slider', label: 'Sway waves', group: 'Motion', min: 0, max: 4, step: 0.1, default: 1.6, help: 'How many sway waves ripple along the lasso.' },
  swaySpeed: { kind: 'slider', label: 'Sway speed', group: 'Motion', min: 0, max: 6, step: 0.1, default: 2, help: 'How fast the idle bob cycles.' },
  motionInfluence: { kind: 'slider', label: 'Motion sway', group: 'Motion', min: 0, max: 0.05, step: 0.001, default: 0.012, help: 'How much cursor SPEED grows the sway (the whip). 0 = no effect.' },
  cursorLead: { kind: 'slider', label: 'Cursor lead', group: 'Motion', min: 0, max: 120, step: 5, default: 0, help: 'Push the cursor end FORWARD along your motion by this many ms to cancel render latency (the tip lagging behind the real cursor on fast moves). 0 = off. Too high overshoots on direction changes. The real fix in-game is hiding the OS cursor so the drawn pointer IS the cursor.' },

  // ── The cursor pointer ────────────────────────────────────────────────────────────────────────────────
  pointerSize: { kind: 'slider', label: 'Pointer size', group: 'Pointer', min: 0, max: 40, step: 1, default: 12, help: 'Radius of the pointer at the cursor. 0 removes it.' },
  pointerGlow: { kind: 'slider', label: 'Pointer aura', group: 'Pointer', min: 0, max: 40, step: 1, default: 10, help: 'Soft aura around the pointer.' },
  pointerTicks: { kind: 'slider', label: 'Pointer ticks', group: 'Pointer', min: 0, max: 8, step: 1, default: 4, help: 'A rotating reticle of this many ticks. 0 = a plain dot.' },
  pointerSpin: { kind: 'slider', label: 'Pointer spin', group: 'Pointer', min: -6, max: 6, step: 0.1, default: 1.5, help: 'Reticle spin, turns/sec. Negative reverses.' },
  onTargetGrow: { kind: 'slider', label: 'On-target grow', group: 'Pointer', min: 1, max: 2.5, step: 0.05, default: 1.6, help: 'How much the pointer grows over a valid target.' },
  colorPointer: { kind: 'color', label: 'Pointer colour', group: 'Pointer', default: 0xffe6b0, help: 'Colour of the pointer core.' },
  onTargetPreview: { kind: 'toggle', label: 'Preview on-target', group: 'Pointer', default: false, help: 'Workshop only: force the grown on-target pointer so you can tune it.' },

  // ── Sparkles (a knob-driven particle system: along the ribbon + off the pointer) ───────────────────────
  sparkleOn: { kind: 'toggle', label: 'Sparkles', group: 'Sparkles', default: true, help: 'Master switch for the sparkle particles.' },
  sparkleAlong: { kind: 'slider', label: 'Along rate', group: 'Sparkles', min: 0, max: 120, step: 1, default: 28, help: 'Sparks born per second ALONG the ribbon. 0 = none along the line.' },
  sparklePointer: { kind: 'slider', label: 'Pointer rate', group: 'Sparkles', min: 0, max: 200, step: 1, default: 40, help: 'Sparks born per second AT the pointer. 0 = none at the cursor.' },
  sparkleAlpha: { kind: 'slider', label: 'Spark opacity', group: 'Sparkles', min: 0, max: 1, step: 0.05, default: 0.95, help: 'Opacity of the sparks — INDEPENDENT of the line opacity (sparks show even with the line at 0).' },
  sparkleSize: { kind: 'slider', label: 'Spark size', group: 'Sparkles', min: 0.5, max: 12, step: 0.5, default: 3, help: 'Starting radius of a spark, in px.' },
  sparkleSizeDecay: { kind: 'slider', label: 'Shrink', group: 'Sparkles', min: 0, max: 1, step: 0.05, default: 0.7, help: 'How much a spark shrinks over its life. 0 = keeps its size.' },
  sparkleLife: { kind: 'slider', label: 'Spark life', group: 'Sparkles', min: 100, max: 2000, step: 50, default: 650, help: 'How long a spark lives, in ms.' },
  sparkleSpeed: { kind: 'slider', label: 'Base speed', group: 'Sparkles', min: 0, max: 400, step: 5, default: 55, help: 'Outward launch speed of a spark, px/s (0 = sparks sit where born).' },
  sparkleGravity: { kind: 'slider', label: 'Gravity', group: 'Sparkles', min: -800, max: 800, step: 10, default: -40, help: 'Vertical pull, px/s². Negative rises (drift up), positive falls (embers).' },
  sparkleDrag: { kind: 'slider', label: 'Drag', group: 'Sparkles', min: 0, max: 1, step: 0.02, default: 0.25, help: 'How fast a spark loses speed. 0 = coasts, 1 = stops almost at once.' },
  sparkleFling: { kind: 'slider', label: 'Motion fling', group: 'Sparkles', min: 0, max: 2, step: 0.05, default: 0.5, help: 'How much cursor SPEED flings sparks along the motion — 0 sparks ignore your movement, high = they cling then fling on a whip.' },
  sparkleSpread: { kind: 'slider', label: 'Spread', group: 'Sparkles', min: 0, max: 1, step: 0.05, default: 0.7, help: 'Directional randomness of the launch. 0 = tight, 1 = every direction.' },
  sparkleTwinkle: { kind: 'slider', label: 'Twinkle', group: 'Sparkles', min: 0, max: 20, step: 0.5, default: 7, help: 'Alpha flicker, in Hz. 0 = steady sparks.' },
  sparkleColor: { kind: 'color', label: 'Spark colour A', group: 'Sparkles', default: 0xffe6b0, help: 'One end of the spark colour range.' },
  sparkleColor2: { kind: 'color', label: 'Spark colour B', group: 'Sparkles', default: 0xffa82e, help: 'The other end — each spark picks a random blend of A and B.' },
  sparkleShape: { kind: 'enum', label: 'Spark shape', group: 'Sparkles', options: SHAPE_NAMES, default: 'circle', help: 'The shape each spark is drawn as. Non-round shapes point along their direction of travel.' },
  sparkleSizeVar: { kind: 'slider', label: 'Size variance', group: 'Sparkles', min: 0, max: 1, step: 0.05, default: 0.4, help: 'Random spread on each spark\'s size. 0 = all identical, 1 = anywhere from tiny to double.' },
  sparkleTurbulence: { kind: 'slider', label: 'Turbulence', group: 'Sparkles', min: 0, max: 2000, step: 10, default: 0, help: 'A swirling noise field that curls the sparks as they fly — like embers off a fire. 0 = straight paths.' },
  sparkleTurbScale: { kind: 'slider', label: 'Turbulence scale', group: 'Sparkles', min: 0.005, max: 0.1, step: 0.001, default: 0.02, enabledWhen: { param: 'sparkleTurbulence', above: 0 }, help: 'Size of the swirl eddies — smaller = tight curls, larger = broad sweeps. Does nothing while Turbulence is 0.' },

  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
} satisfies FxParamSpecs;

type TargetingParams = ParamsOf<typeof SPECS>;

const TAU = Math.PI * 2;
const MAX_SPARKS = 600; // hard cap so a runaway rate can't unbound the array

interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; t: number; phase: number }

function lassoCfg(p: TargetingParams): AimLassoCfg {
  return {
    segments: p.segments, curve: p.curve, curveVar: p.curveVar,
    springStiffness: p.springStiffness, springDamping: p.springDamping,
    swayAmp: p.swayAmp, swayFreq: p.swayFreq, swaySpeed: p.swaySpeed, motionInfluence: p.motionInfluence,
  };
}

/**
 * Build a smooth variable-width ribbon polygon along `pts` for a single `fill()` — no per-segment stroke, so
 * no round-cap beads at the joints. `half(t)` is the half-width at along-fraction t∈[0,1]. Each vertex is
 * offset by `half` along its normal (central-difference tangent), left edge forward then right edge back.
 */
function ribbonPolygon(pts: Vec2[], half: (t: number) => number): number[] {
  const n = pts.length;
  if (n < 2) return [];
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(n - 1, i + 1)]!;
    const tx = next.x - prev.x, ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len, ny = tx / len; // unit normal
    const h = half(i / (n - 1));
    const px = pts[i]!.x, py = pts[i]!.y;
    left.push(px + nx * h, py + ny * h);
    right.push(px - nx * h, py - ny * h);
  }
  // left edge forward, then right edge backward → a closed strip.
  const poly = left.slice();
  for (let i = n - 1; i >= 0; i--) poly.push(right[i * 2]!, right[i * 2 + 1]!);
  return poly;
}

/**
 * Vertices for a spark's SHAPE, centred at (x,y), scaled to radius `r`, rotated by `rot` (its travel angle).
 * Returns a flat [x0,y0,x1,y1,…] for `g.poly()`. `circle` is drawn directly by the caller (returns []).
 * Built-ins only (SHAPE_NAMES) — no texture, so it stays a cheap Graphics fill.
 */
function sparkPoly(shape: string, x: number, y: number, r: number, rot: number): number[] {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const out: number[] = [];
  const push = (ux: number, uy: number): void => { out.push(x + ux * c - uy * sn, y + ux * sn + uy * c); };
  switch (shape) {
    case 'triangle': push(r, 0); push(-r * 0.6, r * 0.85); push(-r * 0.6, -r * 0.85); break;
    case 'square': push(-r, -r); push(r, -r); push(r, r); push(-r, r); break;
    case 'diamond': push(r, 0); push(0, r); push(-r, 0); push(0, -r); break;
    case 'shard': push(r * 1.7, 0); push(0, r * 0.45); push(-r * 0.8, 0); push(0, -r * 0.45); break;
    case 'star':
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; const rr = i % 2 === 0 ? r : r * 0.45; push(Math.cos(a) * rr, Math.sin(a) * rr); }
      break;
    default: return [];
  }
  return out;
}

/** Blend two 0xRRGGBB colours by t∈[0,1]. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

class TargetingInstance implements FxInstance<TargetingParams> {
  private readonly g: Graphics;
  private params: TargetingParams;
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;

  private state: AimLassoState | null = null;
  private elapsed = 0;
  private spin = 0;

  private headX = 0; private headY = 0; private headSet = false;
  private aimSet = false;
  private sx = 0; private sy = 0;
  private prevTo: Vec2 | null = null;
  private speed = 0;             // smoothed cursor speed, px/s
  private velX = 0; private velY = 0; // smoothed cursor velocity (for spark fling direction)
  private onTarget = false;

  private sparks: Spark[] = [];
  private alongAcc = 0;         // fractional spark-emission accumulators
  private pointerAcc = 0;
  private stopping = false;      // set by `stopEmitting()` — the aim was released; drain the sparks, hide the line

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
  setOnTarget(on: boolean): void { this.onTarget = on; }

  private endpoints(): { from: Vec2; to: Vec2 } {
    const to: Vec2 = { x: this.headX, y: this.headY };
    const from: Vec2 = this.aimSet ? { x: this.sx, y: this.sy } : { x: to.x, y: to.y + 300 };
    return { from, to };
  }

  update(dtMs: number): void {
    if (!this.headSet) return;
    const dt = Math.max(0, dtMs / 1000);
    this.elapsed += dt;
    const p = this.params;

    if (this.stopping) {
      // The aim was released: emit nothing new and drop the ribbon + pointer, but let the sparks already in
      // flight live out their full life (owner ask 2026-09-17) instead of vanishing the instant the line does.
      if (this.sparks.length) this.stepSparks(dt);
      this.g.clear();
      this.drawSparks();
      this.filters.frame(p, 1, dt);
      return;
    }

    this.spin += p.pointerSpin * dt * TAU;
    const cfg = lassoCfg(p);
    const { from, to: rawTo } = this.endpoints();

    // Smoothed cursor velocity (for speed-scaled sway, spark fling, AND the latency lead) — from the RAW
    // cursor, before the lead is applied, so the prediction can't feed back on itself.
    if (this.prevTo && dt > 0) {
      const ivx = (rawTo.x - this.prevTo.x) / dt, ivy = (rawTo.y - this.prevTo.y) / dt;
      const k = Math.min(1, dt * 12);
      this.velX += (ivx - this.velX) * k;
      this.velY += (ivy - this.velY) * k;
      this.speed = Math.hypot(this.velX, this.velY);
    }
    this.prevTo = { x: rawTo.x, y: rawTo.y };

    // Latency lead: push the cursor end forward along motion to cancel the canvas's render lag behind the OS
    // cursor. 0 = off (the tip sits on the freshest sample). The real fix in-game is hiding the OS cursor.
    const lead = Math.max(0, p.cursorLead) / 1000;
    const to: Vec2 = lead > 0 ? { x: rawTo.x + this.velX * lead, y: rawTo.y + this.velY * lead } : rawTo;

    if (!this.state) this.state = createLassoState(from, to, cfg);
    const pts = stepLasso(this.state, from, to, this.speed, dt, this.elapsed, cfg);

    if (p.sparkleOn) this.emitAndStepSparks(pts, to, dt);
    else if (this.sparks.length) this.stepSparks(dt); // let existing ones finish after a toggle-off

    this.render(pts, to);

    const prog = 0.5 - 0.5 * Math.cos(this.elapsed * Math.PI);
    this.filters.frame(p, prog, dt);
    this.transform.frame(p, prog, dt, from.x, from.y);
  }

  /** Spawn sparks (along the ribbon + at the pointer) for this frame, then advance all sparks. */
  private emitAndStepSparks(pts: Vec2[], to: Vec2, dt: number): void {
    const p = this.params;
    const flingX = this.velX * p.sparkleFling, flingY = this.velY * p.sparkleFling;

    // Along the ribbon: born at random points, launched roughly perpendicular (outward) to the local segment.
    this.alongAcc += p.sparkleAlong * dt;
    let nAlong = Math.floor(this.alongAcc);
    this.alongAcc -= nAlong;
    while (nAlong-- > 0 && this.sparks.length < MAX_SPARKS && pts.length >= 2) {
      const seg = Math.min(pts.length - 2, Math.floor(Math.random() * (pts.length - 1)));
      const f = Math.random();
      const a = pts[seg]!, b = pts[seg + 1]!;
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const nx = (-dy / len) * side, ny = (dx / len) * side; // perpendicular, random side
      this.spawnSpark(x, y, nx, ny, flingX, flingY);
    }

    // At the pointer: born at the cursor, launched in a random radial direction.
    this.pointerAcc += p.sparklePointer * dt;
    let nPt = Math.floor(this.pointerAcc);
    this.pointerAcc -= nPt;
    while (nPt-- > 0 && this.sparks.length < MAX_SPARKS) {
      const ang = Math.random() * TAU;
      this.spawnSpark(to.x, to.y, Math.cos(ang), Math.sin(ang), flingX, flingY);
    }

    this.stepSparks(dt);
  }

  private spawnSpark(x: number, y: number, dirX: number, dirY: number, flingX: number, flingY: number): void {
    const p = this.params;
    // Blend the launch direction toward random by `spread` (0 = along dir, 1 = any direction).
    const ang = Math.random() * TAU;
    const rx = dirX * (1 - p.sparkleSpread) + Math.cos(ang) * p.sparkleSpread;
    const ry = dirY * (1 - p.sparkleSpread) + Math.sin(ang) * p.sparkleSpread;
    const rl = Math.hypot(rx, ry) || 1;
    const sp = p.sparkleSpeed * (0.6 + Math.random() * 0.8);
    this.sparks.push({
      x, y,
      vx: (rx / rl) * sp + flingX,
      vy: (ry / rl) * sp + flingY,
      age: 0,
      life: (p.sparkleLife / 1000) * (0.7 + Math.random() * 0.6),
      size: Math.max(0.1, p.sparkleSize * (1 + (Math.random() * 2 - 1) * p.sparkleSizeVar)),
      t: Math.random(),
      phase: Math.random() * TAU,
    });
  }

  private stepSparks(dt: number): void {
    const p = this.params;
    const dragK = Math.max(0, 1 - p.sparkleDrag * dt * 3);
    const out: Spark[] = [];
    const turb = p.sparkleTurbulence;
    for (const s of this.sparks) {
      s.age += dt;
      if (s.age >= s.life) continue;
      s.vy += p.sparkleGravity * dt;
      // Turbulence: a swirling noise field curls the spark's path — embers off a fire (shared `motion.ts`).
      if (turb > 0) {
        s.vx += turbulenceX(s.x, s.y, this.elapsed, p.sparkleTurbScale) * turb * dt;
        s.vy += turbulenceY(s.x, s.y, this.elapsed, p.sparkleTurbScale) * turb * dt;
      }
      s.vx *= dragK; s.vy *= dragK;
      s.x += s.vx * dt; s.y += s.vy * dt;
      out.push(s);
    }
    this.sparks = out;
  }

  private render(pts: Vec2[], to: Vec2): void {
    const p = this.params;
    const g = this.g;
    g.clear();
    if (pts.length < 2) return;
    const breatheK = 1 - p.breathe * (0.5 + 0.5 * Math.sin(this.elapsed * 2.4));

    // Aura underlay.
    if (p.glowWidth > 0 && p.glowAlpha > 0) {
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      g.stroke({ width: p.coreWidth + p.glowWidth, color: p.colorGlow, alpha: p.glowAlpha * breatheK, cap: 'round', join: 'round' });
    }
    // Bright core as ONE smooth tapered ribbon fill (a per-segment stroke with round caps beads the line —
    // each cap bulges at every joint). Build left/right edges offset along each vertex's normal by a
    // half-width that shrinks toward the cursor, then fill the single polygon.
    const poly = ribbonPolygon(pts, (t) => Math.max(0.15, (p.coreWidth * (1 - p.taper * t)) / 2));
    if (poly.length >= 6) g.poly(poly).fill({ color: p.colorCore, alpha: p.coreAlpha });

    // Sparks: a soft round glow behind the chosen SHAPE (oriented along its travel), twinkling + fading.
    this.drawSparks();

    // The pointer at the cursor end.
    if (p.pointerSize > 0) {
      const r = p.pointerSize * ((this.onTarget || p.onTargetPreview) ? p.onTargetGrow : 1);
      if (p.pointerGlow > 0) g.circle(to.x, to.y, r + p.pointerGlow * 0.5).fill({ color: p.colorGlow, alpha: p.glowAlpha * breatheK });
      g.circle(to.x, to.y, r).fill({ color: p.colorPointer, alpha: p.coreAlpha });
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

  /** Draw the live sparks into `this.g` (assumes it was just cleared). Shared by the normal per-frame render
   *  and the release-drain path, so a released aim's sparks look identical as they fade. */
  private drawSparks(): void {
    const p = this.params;
    const g = this.g;
    const shape = p.sparkleShape;
    for (const s of this.sparks) {
      const lt = s.age / s.life;
      let alpha = p.sparkleAlpha * (1 - lt);
      if (p.sparkleTwinkle > 0) alpha *= 0.5 + 0.5 * Math.sin(this.elapsed * p.sparkleTwinkle * TAU + s.phase);
      if (alpha <= 0.01) continue;
      const size = Math.max(0.3, s.size * (1 - p.sparkleSizeDecay * lt));
      const col = lerpColor(p.sparkleColor, p.sparkleColor2, s.t);
      g.circle(s.x, s.y, size * 1.8).fill({ color: col, alpha: alpha * 0.3 });
      if (shape === 'circle') {
        g.circle(s.x, s.y, size).fill({ color: col, alpha });
      } else {
        const verts = sparkPoly(shape, s.x, s.y, size, Math.atan2(s.vy, s.vx));
        if (verts.length >= 6) g.poly(verts).fill({ color: col, alpha });
      }
    }
  }

  setParams(next: TargetingParams): void {
    this.params = next;
    this.g.blendMode = next.blendMode;
  }

  /** The aim ended: stop spawning sparks and hide the ribbon/pointer, but keep the live sparks stepping and
   *  drawing (see `update`) so they finish their own life instead of being culled with the line. */
  stopEmitting(): void {
    this.stopping = true;
  }

  /** Only meaningful after `stopEmitting()`: true once every spark has died, so the drain can be torn down. */
  isComplete(): boolean {
    return this.stopping && this.sparks.length === 0;
  }

  destroy(): void {
    this.filters.destroy();
    this.g.destroy();
    this.sparks = [];
  }
}

export const targetingPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'targeting',
  params: SPECS,
  spawn: (ctx, params) => new TargetingInstance(ctx, params),
};

registerPrimitive(targetingPrimitive as FxPrimitive);
