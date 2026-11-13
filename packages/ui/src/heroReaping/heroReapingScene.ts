/**
 * THE REAPING'S SCENE: everything The Reaping draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroReaping.ts` mounts `root` on the above-portrait overlay, calls `draw(t)` from
 * the one clock's paint (so the blades are a pure function of the time), fires the beats (`cross`, `ignite`, `held`,
 * `toll`, `strike`, `stream`, `flood`) and feeds `update(dt)`.
 *
 * What it draws is LIGHT ONLY: blades, afterimages, rings, sparks and motes. No drawn props. The colour draining out of
 * the portrait and the screen is NOT here: that is DOM (`heroReapingDrain.ts`), underneath this canvas, which is why the
 * teal blades and the warm motes keep their colour over a monochrome screen.
 *
 *  I-II    the BLADE: a long thin crescent of teal light travelling point first along its shallow arc through the
 *          portrait, a soft dark shade under it. As it crosses, a hairline of bone light marks the cut.
 *  III-IV  the GREAT CRESCENT: a wide crescent of light on an unseen arm, turning about a pivot and sweeping EDGE
 *          FIRST. It ignites and is drawn back (a glint runs up its edge as the light builds), is held, then swings:
 *          five AFTERIMAGES replay its pass behind it, fanned out wider and wider. On the cut (`strike`): a flash, two
 *          shock rings, a hairline along the cut and sparks thrown along it. IV also leaves a LINE of light across the
 *          whole screen, and when colour floods back a bright FRONT runs with the edge of the returning colour.
 *  The MOTES are the portrait's colour leaving it: warm flecks that lift off, hang a moment, then stream along a bowed
 *  path into the striker. III and IV tear them out along the cut first, fatter and many more of them: a plume.
 *
 * Perf: every sprite is made once (the blades, the crescent and its afterimages, the line, the front) or pooled under a
 * hard cap (the motes and the fire-and-forget rings, glints and sparks); a frame writes transforms, alpha and tints
 * only; nothing allocates per frame.
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroBlastTextures } from '../heroBlast/heroBlastScene';
import { clamp01, easeInOutSine, whiten, type Pt } from '../heroAttack/easing';
import { FxPool, type FxLayer } from '../heroAttack/fxPool';
import { bladeAt, lineAt, swingAt, swingLight, type BladeState, type ReapingGeo, type ReapingPlan } from './heroReapingConfig';
import { veilSpan } from './heroReapingDrain';
import {
  BLADE_TEX_W, CRESCENT_CHORD_V, CRESCENT_HEEL_U, CRESCENT_POINT_U, CRESCENT_TEX_W, LINE_TEX_H, LINE_TEX_W, MOTE_TEX,
} from './heroReapingTextures';

export interface HeroReapingTextures extends HeroBlastTextures {
  blade: Texture;
  crescent: Texture;
  line: Texture;
  mote: Texture;
}

export interface ReapingColors { teal: number; bone: number; shade: number; motes: readonly number[]; side: number }

export interface ReapingLook {
  /** The blade's length, in struck-portrait radii (I-II). */
  bladeSize: number;
  /** A mote's flight to the striker (ms) and its size multiplier. */
  moteMs: number;
  moteSize: number;
  /** I-II: the strip's width in radii (the motes lift off inside it). */
  stripWidth: number;
}

/** Hard cap on pooled sprites alive at once (IV's stream and strike peak well under it). */
export const MAX_REAPING_SPRITES = 260;
/** The most motes in flight at once. */
export const MAX_MOTES = 72;
/** III-IV: how many afterimages replay the crescent's pass behind it. */
export const GHOSTS = 5;

/** Afterimage `i` (1..GHOSTS) replays the crescent this many ms late: later and later, so they fan out. */
export function ghostLag(i: number): number { return i * (14 + 10 * i); }

interface Mote {
  s: Sprite | null; g: Sprite | null; age: number; delay: number; dur: number;
  x0: number; y0: number; cx: number; cy: number; x1: number; y1: number;
  size: number; phase: number;
}

/** What the runner hands `draw` each frame: the two portraits' offsets (overlay px). */
export interface ReapingFrame { heroX: number; heroY: number; foeX: number; foeY: number }

const blade: BladeState = { visible: false, x: 0, y: 0, rot: 0, alpha: 0, k: 0 };
const light = { a: 0, build: 0 };
const scar = { len: 0, a: 0 };

export class HeroReapingScene extends FxPool {
  private readonly blades: Sprite[] = [];
  private readonly shades: Sprite[] = [];
  private swBlade: Sprite | null = null;
  private swShade: Sprite | null = null;
  private swHalo: Sprite | null = null;
  private swGlint: Sprite | null = null;
  private readonly ghosts: Sprite[] = [];
  private lineS: Sprite | null = null;
  private lineGlow: Sprite | null = null;
  private lineShade: Sprite | null = null;
  private frontS: Sprite | null = null;
  private frontGlow: Sprite | null = null;
  private readonly motes: Mote[] = [];
  private flying = 0;
  private arrivedN = 0;
  private ownOn = true;

  constructor(
    private readonly tex: HeroReapingTextures,
    private readonly colors: ReapingColors,
    private readonly look: ReapingLook,
    private readonly plan: ReapingPlan,
    private readonly geo: ReapingGeo,
    /** The struck portrait's centre and radius, and the striker's. */
    private readonly foe: { x: number; y: number; r: number } = { x: 0, y: 0, r: 80 },
    private readonly hero: { x: number; y: number; r: number } = { x: 0, y: 0, r: 80 },
    scale = 1,
    seed = 1,
  ) {
    super('heroReaping', [tex.glow, tex.ring, tex.streak, tex.blade, tex.crescent, tex.line, tex.mote], scale, seed, MAX_REAPING_SPRITES);
    const own = (layer: FxLayer, t: Texture, ax: number, ay: number, tint = 0xffffff): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false;
      if (layer === 'glow' || layer === 'core') s.blendMode = 'add';
      this.layers[layer].addChild(s);
      return s;
    };
    if (plan.reduced) return;
    if (plan.kind === 'fall' || plan.kind === 'reaping') {
      this.swShade = own('under', tex.crescent, CRESCENT_HEEL_U, CRESCENT_CHORD_V, 0x000000);
      this.swHalo = own('glow', tex.glow, 0.5, 0.5, colors.teal);
      for (let i = 0; i < GHOSTS; i++) this.ghosts.push(own('glow', tex.crescent, CRESCENT_HEEL_U, CRESCENT_CHORD_V, colors.teal));
      this.swBlade = own('core', tex.crescent, CRESCENT_HEEL_U, CRESCENT_CHORD_V);
      this.swGlint = own('core', tex.glow, 0.5, 0.5, whiten(colors.teal, 0.7));
      if (plan.kind === 'reaping') {
        this.lineShade = own('under', tex.line, 0.5, 0.5, 0x000000);
        this.lineGlow = own('glow', tex.line, 0.5, 0.5, colors.teal);
        this.lineS = own('core', tex.line, 0.5, 0.5, whiten(colors.teal, 0.6));
        this.frontGlow = own('glow', tex.line, 0.5, 0.5, colors.motes[2] ?? 0xffe08a);
        this.frontS = own('core', tex.line, 0.5, 0.5, whiten(colors.bone, 0.4));
      }
    } else {
      for (let i = 0; i < plan.cuts.length; i++) {
        this.shades.push(own('under', tex.blade, 0.5, 0.42, 0x000000));
        this.blades.push(own('core', tex.blade, 0.5, 0.42));
      }
    }
    if (this.swBlade) {
      // III-IV throw most of their sprites on ONE frame (the cut: the rings, the sparks, the first of the plume). Make
      // the pool's sprites now, while the damage formation is still playing, so the cut itself creates none.
      const made: Sprite[] = [];
      const fill = (layer: FxLayer, t: Texture, n: number): void => { for (let i = 0; i < n; i++) { const sp = this.take(layer, t, 0xffffff); if (sp) { sp.alpha = 0; made.push(sp); } } };
      const n = Math.min(MAX_MOTES, plan.motes);
      fill('glow', tex.glow, n + 10); fill('body', tex.mote, n); fill('core', tex.streak, 36);
      for (const sp of made) this.give(sp);
    }
    for (let i = 0; i < MAX_MOTES; i++) this.motes.push({ s: null, g: null, age: 0, delay: 0, dur: 1, x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0, size: 1, phase: 0 });
  }

  /** Motes in flight (or waiting to lift off). Exposed for tests. */
  get liveMotes(): number { return this.flying; }
  /** Motes that have reached the striker so far. */
  get arrived(): number { return this.arrivedN; }
  /** Blades drawing this frame (I-II). */
  get visibleBlades(): number { let n = 0; for (const b of this.blades) n += b.visible ? 1 : 0; return n; }
  /** Where blade `i` is drawn, or null when hidden. */
  bladePos(i: number): Pt | null { const b = this.blades[i]; return b && b.visible ? { x: b.position.x, y: b.position.y } : null; }
  /** III-IV: whether the great crescent draws this frame, its heel and its turn (null when hidden). */
  get crescentVisible(): boolean { return !!this.swBlade?.visible; }
  get crescentPose(): { x: number; y: number; rot: number } | null { const b = this.swBlade; return b && b.visible ? { x: b.position.x, y: b.position.y, rot: b.rotation } : null; }
  /** III-IV: afterimages drawing this frame. */
  get visibleGhosts(): number { let n = 0; for (const g of this.ghosts) n += g.visible ? 1 : 0; return n; }
  /** IV: the line the cut leaves, and the bright front of the returning colour. */
  get lineVisible(): boolean { return !!this.lineS?.visible; }
  get frontVisible(): boolean { return !!this.frontS?.visible; }
  get frontPos(): Pt | null { const f = this.frontS; return f && f.visible ? { x: f.position.x, y: f.position.y } : null; }

  // ── the frame (called from the clock's paint, so it is a pure function of the time) ─────────────────────────────

  draw(t: number, f: ReapingFrame): void {
    if (this.destroyed || !this.ownOn) return;
    this.setFoeOffset(f.foeX, f.foeY);
    const p = this.plan, g = this.geo, S = this.scale;
    if (p.kind === 'cut' || p.kind === 'cross') {
      const len = this.look.bladeSize * this.foe.r;
      const k = len / BLADE_TEX_W;
      for (let i = 0; i < this.blades.length; i++) {
        const b = this.blades[i]!, sh = this.shades[i]!;
        bladeAt(p, g, i, t, blade);
        b.visible = blade.visible; sh.visible = blade.visible;
        if (!blade.visible) continue;
        const flip = g.cuts[i]!.bow;
        b.position.set(blade.x, blade.y); b.rotation = blade.rot; b.scale.set(k, k * 1.5 * flip); b.alpha = blade.alpha;
        sh.position.set(blade.x + 3 * S, blade.y + 5 * S); sh.rotation = blade.rot; sh.scale.set(k * 1.04, k * 1.8 * flip); sh.alpha = 0.42 * blade.alpha;
      }
    } else if (g.swing) {
      this.drawSwing(t);
      if (p.kind === 'reaping') { this.drawLine(t); this.drawFront(t); }
    }
  }

  /** III-IV: the great crescent, its shade, its halo, the glint on its edge and the afterimages behind it. */
  private drawSwing(t: number): void {
    const p = this.plan, s = this.geo.swing!, q = p.cuts[0]!, S = this.scale;
    const b = this.swBlade!, sh = this.swShade!, halo = this.swHalo!, gl = this.swGlint!;
    const r0 = s.arm - s.inner * s.blade;
    const kx = s.blade / ((CRESCENT_POINT_U - CRESCENT_HEEL_U) * CRESCENT_TEX_W);
    // III's crescent is a touch fatter for its length (it is the shorter one and must still read as HUGE).
    const wide = p.kind === 'fall' ? 1.2 : 1;
    const L = swingLight(p, t, light);
    const on = L.a > 0.004;
    b.visible = on; sh.visible = on; halo.visible = on; gl.visible = on;
    if (on) {
      let ang = swingAt(p, s, t);
      // Held: it strains against the hold (a few px of tremble at its middle).
      if (p.heldAt !== null && t >= p.heldAt && t < q.startAt) ang += s.sgn * ((4 * S) / s.arm) * Math.sin(t * 0.11);
      const cx = Math.cos(ang), sy = Math.sin(ang);
      const hx = s.pivot.x + cx * r0, hy = s.pivot.y + sy * r0;
      const ky = kx * s.sgn * wide * (0.78 + 0.22 * L.build);
      b.position.set(hx, hy); b.rotation = ang; b.scale.set(kx, ky); b.alpha = L.a;
      sh.position.set(hx + 3 * S, hy + 6 * S); sh.rotation = ang; sh.scale.set(kx * 1.03, ky * 1.25); sh.alpha = 0.5 * L.a;
      const gw = this.tex.glow.width;
      const mx = hx + cx * s.blade * 0.5, my = hy + sy * s.blade * 0.5;
      halo.position.set(mx, my); halo.rotation = ang; halo.scale.set((s.blade * 1.35) / gw, (s.blade * (0.26 + 0.2 * L.build)) / gw); halo.alpha = L.a * (0.18 + 0.4 * L.build);
      // The light building: a glint runs from the heel to the point through the wind-up, and sits on the point after.
      const run = t < q.startAt ? L.build : 1;
      gl.position.set(hx + cx * s.blade * run, hy + sy * s.blade * run);
      gl.rotation = ang;
      const gk = (s.blade * (0.16 + 0.2 * run)) / gw;
      gl.scale.set(gk * 1.5, gk * 0.8); gl.alpha = L.a * (0.45 + 0.5 * run);
    }
    // The afterimages: each replays the pass a little later than the one before, so they fan out behind the edge.
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i]!;
      const tg = t - ghostLag(i + 1);
      const a = tg > q.startAt ? swingLight(p, tg, light).a : 0;
      g.visible = a > 0.004;
      if (!g.visible) continue;
      const ang = swingAt(p, s, tg);
      g.position.set(s.pivot.x + Math.cos(ang) * r0, s.pivot.y + Math.sin(ang) * r0);
      g.rotation = ang; g.scale.set(kx, kx * s.sgn * wide * (1 + 0.08 * (i + 1)));
      g.alpha = a * 0.46 * (1 - i / (this.ghosts.length + 1.5));
    }
  }

  /** IV: the line the cut leaves across the whole screen: it opens out from the portrait and thins away. */
  private drawLine(t: number): void {
    const l = this.geo.line!;
    const ls = this.lineS!, lg = this.lineGlow!, lsh = this.lineShade!;
    const v = lineAt(this.plan, t, scar);
    const on = v.a > 0.004;
    ls.visible = on; lg.visible = on; lsh.visible = on;
    if (!on) return;
    const S = this.scale;
    const len = Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y) * v.len;
    const mx = l.from.x + (l.to.x - l.from.x) * l.hitK, my = l.from.y + (l.to.y - l.from.y) * l.hitK;
    const thick = v.a * v.a;
    ls.position.set(mx, my); ls.rotation = l.angle; ls.scale.set(len / LINE_TEX_W, (58 * S * thick + 5 * S * v.a) / LINE_TEX_H); ls.alpha = v.a;
    lg.position.set(mx, my); lg.rotation = l.angle; lg.scale.set(len / LINE_TEX_W, (210 * S * (0.35 + 0.65 * thick)) / LINE_TEX_H); lg.alpha = 0.6 * v.a;
    lsh.position.set(mx, my + 6 * S); lsh.rotation = l.angle; lsh.scale.set(len / LINE_TEX_W, (90 * S) / LINE_TEX_H); lsh.alpha = 0.4 * v.a;
  }

  /** IV: the bright front that runs with the edge of the returning colour (the veil's feathered edge, `heroReapingDrain.ts`). */
  private drawFront(t: number): void {
    const p = this.plan, fs = this.frontS!, fg = this.frontGlow!;
    const on = p.floodAt !== null && p.floodEnd !== null && t >= p.floodAt && t < p.floodEnd;
    fs.visible = on; fg.visible = on;
    if (!on) return;
    const S = this.scale, b = this.geo.bounds, u = this.geo.u;
    const f = easeInOutSine((t - p.floodAt!) / Math.max(1, p.floodEnd! - p.floodAt!));
    const at = veilSpan(b.w, b.h, 240 * S).frontAt(f);
    const x = b.w / 2 + u.x * at, y = b.h / 2 + u.y * at;
    const rot = Math.atan2(u.y, u.x) + Math.PI / 2;
    const len = Math.hypot(b.w, b.h) * 1.15;
    // Brightest through the middle of the crossing; it comes and goes with the wave.
    const env = Math.pow(Math.sin(Math.PI * clamp01(f)), 0.6);
    fs.position.set(x, y); fs.rotation = rot; fs.scale.set(len / LINE_TEX_W, (300 * S) / LINE_TEX_H); fs.alpha = 0.3 * env;
    fg.position.set(x, y); fg.rotation = rot; fg.scale.set(len / LINE_TEX_W, (760 * S) / LINE_TEX_H); fg.alpha = 0.6 * env;
  }

  // ── the beats ──────────────────────────────────────────────────────────────────────────────────────────────

  /** I-II: a blade crosses the middle of the portrait: a hairline of bone light along the cut, and a breath of teal. */
  cross(i: number, weight = 1): void {
    const n = this.geo.cuts[i];
    if (this.destroyed || !n) return;
    const { x, y, r } = this.foe;
    const S = this.scale;
    const len = 2.5 * r;
    this.spawn('core', this.tex.line, whiten(this.colors.bone, 0.3), x, y, {
      dur: 300, from: len / LINE_TEX_W / S, to: (len * 1.12) / LINE_TEX_W / S, a0: 0.95, mode: 'out', ease: 'cubic', sy: (7 * S * LINE_TEX_W) / (LINE_TEX_H * len), rot: n.angle, follow: true,
    });
    this.spawn('glow', this.tex.glow, this.colors.teal, x, y, {
      dur: 420, from: (r * 1.2) / this.tex.glow.width / S, to: (r * 2.6 * weight) / this.tex.glow.width / S, a0: 0.4 * weight, mode: 'punch', peakAt: 0.15, ease: 'cubic', follow: true,
    });
  }

  /** III-IV: the great crescent IGNITES where it will be held: a long flare of teal along it. */
  ignite(): void {
    const s = this.geo.swing;
    if (this.destroyed || !s) return;
    const S = this.scale, gw = this.tex.glow.width;
    const ang = s.a0 + s.sgn * s.back;
    const rm = s.arm - s.inner * s.blade + s.blade * 0.5;
    const x = s.pivot.x + Math.cos(ang) * rm, y = s.pivot.y + Math.sin(ang) * rm;
    this.spawn('glow', this.tex.glow, this.colors.teal, x, y, { dur: 460, from: (s.blade * 0.5) / gw / S, to: (s.blade * 1.5) / gw / S, a0: 0.55, mode: 'punch', peakAt: 0.18, ease: 'cubic', sy: 0.3, rot: ang });
    this.spawn('core', this.tex.glow, whiten(this.colors.teal, 0.7), x, y, { dur: 240, from: (s.blade * 0.3) / gw / S, to: (s.blade * 1.1) / gw / S, a0: 0.5, mode: 'out', ease: 'cubic', sy: 0.14, rot: ang });
  }

  /** III-IV: the crescent is fully lit and held: a white glint bursts on its point. */
  held(): void {
    const s = this.geo.swing;
    if (this.destroyed || !s) return;
    const S = this.scale, gw = this.tex.glow.width;
    const r1 = s.arm + (1 - s.inner) * s.blade;
    const x = s.pivot.x + Math.cos(s.a0) * r1, y = s.pivot.y + Math.sin(s.a0) * r1;
    const k = (v: number): number => v / gw / S;
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 260, from: k(s.blade * 0.1), to: k(s.blade * 0.5), a0: 0.95, mode: 'out', ease: 'cubic' });
    this.spawn('core', this.tex.glow, whiten(this.colors.teal, 0.5), x, y, { dur: 320, from: k(s.blade * 0.2), to: k(s.blade * 0.9), a0: 0.7, mode: 'out', ease: 'cubic', sy: 0.12, rot: s.a0 + Math.PI / 2 });
  }

  /**
   * III-IV: THE CUT. A white flash on the portrait, a deep teal bloom under it, two shock rings opening from the blow, a
   * hairline of bone light along the cut and sparks thrown along it. `weight` scales it (III 1, IV about 1.5); IV also
   * flashes the whole screen for a moment and sends a third, slow ring right across it.
   */
  strike(weight = 1): void {
    const n = this.geo.cuts[this.geo.cuts.length - 1];
    if (this.destroyed || !n || this.plan.reduced) return;
    const { x, y, r } = this.foe;
    const S = this.scale, gw = this.tex.glow.width;
    const big = this.plan.kind === 'reaping';
    const g = (v: number): number => v / gw / S;
    const ring = (v: number): number => v / (this.tex.ring.width * 0.8) / S;
    const teal = this.colors.teal, hot = whiten(teal, 0.75);
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 170, from: g(r * 2.6), to: g(r * 3.8 * weight), a0: 0.9, mode: 'out', ease: 'cubic', follow: true });
    this.spawn('glow', this.tex.glow, teal, x, y, { dur: 700, from: g(r * 3), to: g(r * 7.5 * weight), a0: 0.55, mode: 'punch', peakAt: 0.1, ease: 'cubic', follow: true });
    this.spawn('core', this.tex.ring, hot, x, y, { dur: 520, from: ring(r * 1.6), to: ring(r * 6 * weight), a0: 0.9, mode: 'out', ease: 'quint' });
    this.spawn('glow', this.tex.ring, teal, x, y, { dur: 900, from: ring(r * 2), to: ring(r * 10 * weight), a0: 0.45, mode: 'out', ease: 'cubic', delay: 70 });
    const len = (big ? 5 : 4.4) * r;
    this.spawn('core', this.tex.line, whiten(this.colors.bone, 0.4), x, y, {
      dur: 420, from: len / LINE_TEX_W / S, to: (len * 1.25) / LINE_TEX_W / S, a0: 1, mode: 'out', ease: 'cubic', sy: (26 * S * LINE_TEX_W) / (LINE_TEX_H * len), rot: n.angle, follow: true,
    });
    // Sparks of the cut, thrown the way the edge was going (and a few the other way).
    const count = Math.round(12 * weight);
    this.burst('core', this.tex.streak, [hot, teal, whiten(this.colors.bone, 0.2)], x, y, count, { speed: 1150 * weight, dir: n.angle, spread: 1.5, life: 520, size: 0.62, to: 0.2, drag: 0.08, align: true });
    this.burst('core', this.tex.streak, [teal, hot], x, y, Math.round(count / 2), { speed: 700, dir: n.angle + Math.PI, spread: 1.9, life: 420, size: 0.5, to: 0.2, drag: 0.1, align: true });
    if (big) {
      const span = Math.hypot(this.geo.bounds.w, this.geo.bounds.h);
      this.spawn('core', this.tex.glow, hot, x, y, { dur: 220, from: g(span * 0.9), to: g(span * 1.5), a0: 0.3, mode: 'out', ease: 'cubic' });
      this.spawn('glow', this.tex.ring, teal, x, y, { dur: 1300, from: ring(r * 3), to: ring(span * 1.1), a0: 0.32, mode: 'out', ease: 'cubic', delay: 120 });
    }
  }

  /**
   * The portrait's colour leaves it: `n` motes lift off (inside cut `along`'s strip when given, anywhere on the face
   * otherwise), spread over `spanMs`, and stream into the striker. `fat` scales them (III-IV: a plume), and `tear`
   * (px) throws them out along a direction first, so the colour is TORN out before it is pulled across.
   */
  stream(n: number, spanMs: number, along: number | null = null, fat = 1, tear: Pt | null = null): void {
    if (this.destroyed || this.plan.reduced) return;
    const { x, y, r } = this.foe;
    const cut = along !== null ? this.geo.cuts[along] : null;
    const hw = this.look.stripWidth * r * 0.5;
    const dx = this.hero.x - x, dy = this.hero.y - y;
    const dist = Math.hypot(dx, dy) || 1;
    const nrm = this.geo.nrm;
    let made = 0;
    for (const m of this.motes) {
      if (made >= n) break;
      if (m.s) continue;
      const tint = this.colors.motes[made % this.colors.motes.length] ?? 0xffb24a;
      // A solid warm fleck (it must read over a pale board as well as a grey one) inside a soft halo of its hue.
      const g = this.take('glow', this.tex.glow, tint);
      const s = this.take('body', this.tex.mote, whiten(tint, 0.25));
      if (!s || !g) { this.give(s); this.give(g); break; }
      if (cut) {
        const al = (this.rnd() - 0.5) * 1.5 * r, ac = (this.rnd() - 0.5) * 2 * hw;
        m.x0 = x + cut.dir.x * al - cut.dir.y * ac; m.y0 = y + cut.dir.y * al + cut.dir.x * ac;
      } else {
        const ang = this.rnd() * Math.PI * 2, rad = Math.sqrt(this.rnd()) * r * 0.8;
        m.x0 = x + Math.cos(ang) * rad; m.y0 = y + Math.sin(ang) * rad;
      }
      // Each bows its own way (mostly toward the top of the screen), and lands somewhere on the striker's face.
      const bow = (0.08 + this.rnd() * 0.2) * (this.rnd() < 0.8 ? 1 : -0.6);
      m.cx = x + dx * 0.4 + nrm.x * bow * dist; m.cy = y + dy * 0.4 + nrm.y * bow * dist - r * 0.3;
      m.x1 = this.hero.x + (this.rnd() - 0.5) * this.hero.r * 0.5; m.y1 = this.hero.y + (this.rnd() - 0.5) * this.hero.r * 0.5;
      m.age = 0; m.delay = n <= 1 ? 0 : (spanMs * made) / (n - 1) * (0.8 + this.rnd() * 0.2);
      m.dur = this.look.moteMs * (0.85 + this.rnd() * 0.4) * Math.min(1.25, Math.max(0.6, Math.sqrt(dist / 1600)));
      m.size = this.look.moteSize * (15 + this.rnd() * 11) * this.scale * fat;
      m.phase = this.rnd() * Math.PI * 2;
      if (tear) {
        // Torn out along the cut: the path first heads the way the edge went, fanned a little.
        const fan = 0.5 + ((made * 7) % 10) / 10;
        m.cx += tear.x * fan; m.cy += tear.y * fan;
        // A plume has BODY: every fourth mote is a big soft one.
        if (made % 4 === 0) m.size *= 2;
      }
      s.alpha = 0; s.position.set(m.x0, m.y0);
      g.alpha = 0; g.position.set(m.x0, m.y0);
      m.s = s; m.g = g; this.flying++; made++;
    }
  }

  /**
   * IV: the bell tolls: a ring of light opens from the striker across the whole screen, a second behind it, and the
   * striker flares.
   */
  toll(): void {
    if (this.destroyed) return;
    const S = this.scale;
    const span = Math.hypot(this.geo.bounds.w, this.geo.bounds.h);
    const k = (v: number): number => v / (this.tex.ring.width * 0.8) / S;
    const g = (v: number): number => v / this.tex.glow.width / S;
    const { x, y, r } = this.hero;
    this.spawn('core', this.tex.ring, whiten(this.colors.teal, 0.6), x, y, { dur: 1300, from: k(r * 2), to: k(span * 0.95), a0: 0.6, mode: 'out', ease: 'cubic' });
    this.spawn('glow', this.tex.ring, this.colors.teal, x, y, { dur: 1700, from: k(r * 2), to: k(span * 0.8), a0: 0.3, mode: 'out', ease: 'cubic', delay: 110 });
    this.spawn('glow', this.tex.glow, this.colors.teal, x, y, { dur: 800, from: g(r * 2.4), to: g(r * 6), a0: 0.6, mode: 'punch', peakAt: 0.12, ease: 'cubic' });
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 200, from: g(r * 1.6), to: g(r * 3), a0: 0.55, mode: 'out', ease: 'cubic' });
  }

  /** IV: colour floods back: a warm ring opens from the striker, with a scatter of warm sparks. */
  flood(): void {
    if (this.destroyed) return;
    const S = this.scale;
    const span = Math.hypot(this.geo.bounds.w, this.geo.bounds.h);
    const k = (v: number): number => v / (this.tex.ring.width * 0.8) / S;
    const { x, y, r } = this.hero;
    const warm = this.colors.motes[2] ?? 0xffe08a;
    this.spawn('glow', this.tex.ring, warm, x, y, { dur: 900, from: k(r * 2), to: k(span * 0.9), a0: 0.5, mode: 'out', ease: 'cubic' });
    this.spawn('glow', this.tex.glow, warm, x, y, { dur: 520, from: (r * 2.4) / this.tex.glow.width / S, to: (r * 5.5) / this.tex.glow.width / S, a0: 0.6, mode: 'punch', peakAt: 0.15, ease: 'cubic' });
    this.burst('core', this.tex.streak, this.colors.motes, x, y, 14, { speed: 900, dir: Math.atan2(this.geo.u.y, this.geo.u.x), spread: 2.2, life: 560, size: 0.5, to: 0.2, drag: 0.12, align: true });
  }

  protected override tick(dt: number): boolean {
    if (!this.flying) return false;
    for (const m of this.motes) {
      const s = m.s;
      if (!s) continue;
      if (m.delay > 0) { m.delay -= dt; if (m.delay > 0) continue; }
      m.age += dt;
      const v = clamp01(m.age / m.dur);
      // It lifts off and hangs a moment, then is drawn in, faster and faster.
      const e = 0.12 * v + 0.88 * v * v * v;
      const q = 1 - e;
      const wob = Math.sin(m.phase + m.age * 0.008) * 6 * this.scale * (1 - e);
      s.position.set(q * q * m.x0 + 2 * q * e * m.cx + e * e * m.x1 + wob, q * q * m.y0 + 2 * q * e * m.cy + e * e * m.y1 - 14 * this.scale * Math.sin(Math.min(1, v * 3) * Math.PI * 0.5) * (1 - e));
      s.alpha = Math.min(1, v / 0.1, (1 - v) / 0.08);
      s.scale.set((m.size * (1 - 0.4 * e)) / MOTE_TEX);
      const g = m.g;
      if (g) { g.position.copyFrom(s.position); g.alpha = 0.55 * s.alpha; g.scale.set((m.size * 3.2 * (1 - 0.4 * e)) / this.tex.glow.width); }
      if (v >= 1) {
        this.give(s); this.give(g); m.s = null; m.g = null; this.flying--; this.arrivedN++;
        // The striker takes it in: a small warm glint where it landed (every third, so a stream does not strobe).
        if (this.arrivedN % 3 === 1) {
          this.spawn('glow', this.tex.glow, this.colors.teal, m.x1, m.y1, { dur: 260, from: (this.hero.r * 0.5) / this.tex.glow.width / this.scale, to: (this.hero.r * 1.3) / this.tex.glow.width / this.scale, a0: 0.3, mode: 'punch', peakAt: 0.25, ease: 'cubic' });
        }
      }
    }
    return this.flying > 0;
  }

  /** Hide everything this scene draws itself (the sequence is over; the motes and glints drain on their own). */
  hideOwn(): void {
    this.ownOn = false;
    for (const s of [...this.blades, ...this.shades, ...this.ghosts, this.swBlade, this.swShade, this.swHalo, this.swGlint, this.lineS, this.lineGlow, this.lineShade, this.frontS, this.frontGlow]) {
      if (s) s.visible = false;
    }
  }

  protected override clearOwn(): void {
    this.hideOwn();
    for (const m of this.motes) { if (m.s) { this.give(m.s); this.give(m.g); m.s = null; m.g = null; } }
    this.flying = 0;
  }
}
