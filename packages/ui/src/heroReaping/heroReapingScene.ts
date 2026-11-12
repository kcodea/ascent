/**
 * THE REAPING'S SCENE: everything The Reaping draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroReaping.ts` mounts `root` on the above-portrait overlay, calls `draw(t)` from
 * the one clock's paint (so the scythe is a pure function of the time), fires the beats (`cross`, `stream`, `toll`,
 * `snuff`) and feeds `update(dt)`.
 *
 * What it draws is LIGHT AND SHADE ONLY. The colour draining out of the portrait and the screen is NOT here: that is
 * DOM (`heroReapingDrain.ts`), underneath this canvas, which is why the teal blade and the warm motes keep their colour
 * over a monochrome screen.
 *
 *  I-II  the BLADE: a long thin crescent of teal light travelling point first along its shallow arc through the
 *        portrait, a soft dark shade under it. As it crosses, a hairline of bone light marks the cut.
 *  III   the hooded SHADOW rises at the portrait's side, a SNATH in its hands with the blade across its end; the scythe
 *        turns about the hands, over the top and down through the portrait. A CANDLE burns at the other side; its flame
 *        gutters on the cut and goes out.
 *  IV    the LINE: one strip of light drawn across the whole screen through the portrait, a glint at its head; it
 *        lingers a moment and thins away. The toll is one faint ring opening from the striker.
 *  The MOTES are the portrait's colour leaving it: warm flecks that lift off, hang a moment, then stream along a bowed
 *  path into the striker.
 *
 * Perf: every sprite is made once (the scythe, the shadow, the candle, the line) or pooled under a hard cap (the motes
 * and the fire-and-forget glints); a frame writes transforms, alpha and tints only; nothing allocates per frame.
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroBlastTextures } from '../heroBlast/heroBlastScene';
import { clamp01, whiten, type Pt } from '../heroAttack/easing';
import { FxPool, type FxLayer } from '../heroAttack/fxPool';
import { bladeAt, flameAt, lineAt, shadowAt, swingAt, type BladeState, type ReapingGeo, type ReapingPlan } from './heroReapingConfig';
import {
  BLADE_HEEL_U, BLADE_POINT_U, BLADE_TEX_W, CANDLE_TEX_H, FLAME_TEX_H, LINE_TEX_H, LINE_TEX_W, MOTE_TEX, SHADOW_TEX_H, SNATH_TEX_H, SNATH_TEX_W,
} from './heroReapingTextures';

export interface HeroReapingTextures extends HeroBlastTextures {
  blade: Texture;
  line: Texture;
  snath: Texture;
  shadow: Texture;
  candle: Texture;
  flame: Texture;
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

/** Hard cap on pooled sprites alive at once (IV's stream peaks well under it). */
export const MAX_REAPING_SPRITES = 220;
/** The most motes in flight at once. */
export const MAX_MOTES = 44;
/** IV: how long the line lingers, thinning, after it has left the screen. */
export const LINE_LINGER_MS = 460;

interface Mote {
  s: Sprite | null; age: number; delay: number; dur: number;
  x0: number; y0: number; cx: number; cy: number; x1: number; y1: number;
  size: number; phase: number;
}

/** What the runner hands `draw` each frame: the two portraits' offsets (overlay px). */
export interface ReapingFrame { heroX: number; heroY: number; foeX: number; foeY: number }

const blade: BladeState = { visible: false, x: 0, y: 0, rot: 0, alpha: 0, k: 0 };

export class HeroReapingScene extends FxPool {
  private readonly blades: Sprite[] = [];
  private readonly shades: Sprite[] = [];
  private shadowS: Sprite | null = null;
  private snathS: Sprite | null = null;
  private candleS: Sprite | null = null;
  private flameS: Sprite | null = null;
  private flameGlow: Sprite | null = null;
  private lineS: Sprite | null = null;
  private lineGlow: Sprite | null = null;
  private lineShade: Sprite | null = null;
  private lineHead: Sprite | null = null;
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
    super('heroReaping', [tex.glow, tex.ring, tex.blade, tex.line, tex.snath, tex.shadow, tex.candle, tex.flame, tex.mote], scale, seed, MAX_REAPING_SPRITES);
    const own = (layer: FxLayer, t: Texture, ax: number, ay: number, tint = 0xffffff): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false;
      if (layer === 'glow' || layer === 'core') s.blendMode = 'add';
      this.layers[layer].addChild(s);
      return s;
    };
    if (plan.reduced) return;
    if (plan.kind === 'shadow') {
      this.shadowS = own('under', tex.shadow, 0.5, 1);
      this.candleS = own('body', tex.candle, 0.5, 1);
      this.flameGlow = own('glow', tex.glow, 0.5, 0.5, 0xffa040);
      this.flameS = own('body', tex.flame, 0.5, 0.95);
      this.snathS = own('body', tex.snath, 0.12, 0.5);
      this.shades.push(own('under', tex.blade, BLADE_HEEL_U, 0.55, 0x000000));
      this.blades.push(own('core', tex.blade, BLADE_HEEL_U, 0.55));
    } else if (plan.kind === 'reaping') {
      this.lineShade = own('under', tex.line, 0, 0.5, 0x000000);
      this.lineGlow = own('glow', tex.line, 0, 0.5, colors.teal);
      this.lineS = own('core', tex.line, 0, 0.5, whiten(colors.teal, 0.55));
      this.lineHead = own('core', tex.glow, 0.5, 0.5, whiten(colors.teal, 0.4));
    } else {
      for (let i = 0; i < plan.cuts.length; i++) {
        this.shades.push(own('under', tex.blade, 0.5, 0.42, 0x000000));
        this.blades.push(own('core', tex.blade, 0.5, 0.42));
      }
    }
    for (let i = 0; i < MAX_MOTES; i++) this.motes.push({ s: null, age: 0, delay: 0, dur: 1, x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0, size: 1, phase: 0 });
  }

  /** Motes in flight (or waiting to lift off). Exposed for tests. */
  get liveMotes(): number { return this.flying; }
  /** Motes that have reached the striker so far. */
  get arrived(): number { return this.arrivedN; }
  /** Blades drawing this frame. */
  get visibleBlades(): number { let n = 0; for (const b of this.blades) n += b.visible ? 1 : 0; return n; }
  /** Where blade `i` is drawn, or null when hidden. */
  bladePos(i: number): Pt | null { const b = this.blades[i]; return b && b.visible ? { x: b.position.x, y: b.position.y } : null; }
  get shadowVisible(): boolean { return !!this.shadowS?.visible; }
  get flameVisible(): boolean { return !!this.flameS?.visible; }
  get lineVisible(): boolean { return !!this.lineS?.visible; }
  /** IV: where the line's head is drawn, or null when hidden. */
  get lineHeadPos(): Pt | null { const h = this.lineHead; return h && h.visible ? { x: h.position.x, y: h.position.y } : null; }

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
        b.position.set(blade.x, blade.y); b.rotation = blade.rot; b.scale.set(k, k * flip); b.alpha = blade.alpha;
        sh.position.set(blade.x + 3 * S, blade.y + 5 * S); sh.rotation = blade.rot; sh.scale.set(k * 1.04, k * 1.25 * flip); sh.alpha = 0.42 * blade.alpha;
      }
    } else if (p.kind === 'shadow' && g.shadow) {
      this.drawShadow(t);
    } else if (p.kind === 'reaping' && g.line) {
      this.drawLine(t);
    }
  }

  private drawShadow(t: number): void {
    const p = this.plan, s = this.geo.shadow!;
    const up = shadowAt(p, t);
    const sh = this.shadowS!, sn = this.snathS!, b = this.blades[0]!, bs = this.shades[0]!;
    const on = up > 0.004;
    sh.visible = on; sn.visible = on; b.visible = on; bs.visible = on;
    if (on) {
      const k = s.h / SHADOW_TEX_H;
      // It rises out of nothing: up from a little below its place, a touch squat until it stands.
      sh.position.set(s.x, s.baseY + (1 - up) * s.h * 0.16);
      sh.scale.set(-s.side * k, k * (0.9 + 0.1 * up));
      sh.alpha = 0.96 * up;
      const ang = swingAt(p, s, t);
      const tx = s.pivot.x + Math.cos(ang) * s.reach, ty = s.pivot.y + Math.sin(ang) * s.reach + (1 - up) * s.h * 0.16;
      sn.position.set(s.pivot.x, s.pivot.y + (1 - up) * s.h * 0.16);
      sn.rotation = ang;
      sn.scale.set(s.reach / (SNATH_TEX_W * 0.88), Math.max(1, (this.foe.r / 80)) * (10 / SNATH_TEX_H));
      sn.alpha = up;
      const r = ang - s.side * Math.PI / 2;
      const kb = s.blade / ((BLADE_POINT_U - BLADE_HEEL_U) * BLADE_TEX_W);
      b.position.set(tx, ty); b.rotation = r; b.scale.set(kb, -s.side * kb); b.alpha = up;
      bs.position.set(tx + 3 * this.scale, ty + 5 * this.scale); bs.rotation = r; bs.scale.set(kb * 1.04, -s.side * kb * 1.25); bs.alpha = 0.4 * up;
    }
    // The candle: there from the rise until the portrait's colour starts back; its flame steady, then guttering, then out.
    const c = this.candleS!, fl = this.flameS!, fg = this.flameGlow!;
    const ca = p.riseAt === null ? 0 : clamp01((t - p.riseAt) / 220) * (1 - clamp01((t - (p.returnAt - 80)) / 300));
    c.visible = ca > 0.004;
    const burn = flameAt(p, t);
    fl.visible = c.visible && burn > 0.02; fg.visible = fl.visible;
    if (!c.visible) return;
    const ch = this.foe.r * 0.5, kc = ch / CANDLE_TEX_H;
    c.position.set(s.candle.x, s.candle.y); c.scale.set(kc); c.alpha = ca;
    if (!fl.visible) return;
    const gut = t >= p.impactAt ? 1 : 0;
    const flick = 0.05 * Math.sin(t * 0.021) + 0.035 * Math.sin(t * 0.047 + 1) + gut * (0.22 * Math.sin(t * 0.09) + 0.12 * Math.sin(t * 0.17 + 2));
    const kf = (ch * 0.62 / FLAME_TEX_H) * (0.35 + 0.65 * burn);
    const fx = s.candle.x + kc, fy = s.candle.y - ch * 0.9;
    fl.position.set(fx, fy);
    fl.scale.set(kf * (1 - flick * 0.5), kf * (1 + flick));
    // The blade's wind bends it away from the scythe as it gutters.
    fl.rotation = -s.side * gut * (0.5 * (1 - burn) + 0.25 * Math.sin(t * 0.06));
    fl.alpha = ca * Math.min(1, burn * 2.5);
    fg.position.set(fx, fy - ch * 0.2);
    fg.scale.set((ch * 1.5 / this.tex.glow.width) * (0.6 + 0.4 * burn + flick));
    fg.alpha = 0.3 * ca * burn;
  }

  private drawLine(t: number): void {
    const p = this.plan, l = this.geo.line!, q = p.cuts[0]!;
    const ls = this.lineS!, lg = this.lineGlow!, lsh = this.lineShade!, lh = this.lineHead!;
    const on = t >= q.startAt && t < q.endAt + LINE_LINGER_MS;
    ls.visible = on; lg.visible = on; lsh.visible = on;
    lh.visible = on && t < q.endAt;
    if (!on) return;
    const k = lineAt(p, this.geo, t);
    const len = Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y);
    const head = Math.max(1, len * k);
    // Once it has crossed the screen it thins away to nothing.
    const gone = clamp01((t - q.endAt) / LINE_LINGER_MS);
    const thick = (1 - gone) * (1 - gone);
    const a = 1 - gone;
    const S = this.scale;
    ls.position.set(l.from.x, l.from.y); ls.rotation = l.angle; ls.scale.set(head / LINE_TEX_W, (13 * S * thick + 1.5 * S * a) / LINE_TEX_H); ls.alpha = a;
    lg.position.set(l.from.x, l.from.y); lg.rotation = l.angle; lg.scale.set(head / LINE_TEX_W, (64 * S * (0.4 + 0.6 * thick)) / LINE_TEX_H); lg.alpha = 0.55 * a;
    lsh.position.set(l.from.x, l.from.y + 5 * S); lsh.rotation = l.angle; lsh.scale.set(head / LINE_TEX_W, (30 * S) / LINE_TEX_H); lsh.alpha = 0.35 * a;
    if (lh.visible) {
      lh.position.set(l.from.x + (l.to.x - l.from.x) * k, l.from.y + (l.to.y - l.from.y) * k);
      const gk = (150 * S) / this.tex.glow.width;
      lh.scale.set(gk * 1.6, gk * 0.5); lh.rotation = l.angle; lh.alpha = 0.9;
    }
  }

  // ── the beats ──────────────────────────────────────────────────────────────────────────────────────────────

  /** A blade crosses the middle of the portrait: a hairline of bone light along the cut, and a breath of teal. */
  cross(i: number, weight = 1): void {
    const n = this.geo.cuts[i];
    if (this.destroyed || !n) return;
    const { x, y, r } = this.foe;
    const S = this.scale;
    const len = (this.plan.kind === 'reaping' ? 3.4 : 2.5) * r;
    this.spawn('core', this.tex.line, whiten(this.colors.bone, 0.3), x, y, {
      dur: 300, from: len / LINE_TEX_W / S, to: (len * 1.12) / LINE_TEX_W / S, a0: 0.95, mode: 'out', ease: 'cubic', sy: (7 * S * LINE_TEX_W) / (LINE_TEX_H * len), rot: n.angle, follow: true,
    });
    this.spawn('glow', this.tex.glow, this.colors.teal, x, y, {
      dur: 420, from: (r * 1.2) / this.tex.glow.width / S, to: (r * 2.6 * weight) / this.tex.glow.width / S, a0: 0.4 * weight, mode: 'punch', peakAt: 0.15, ease: 'cubic', follow: true,
    });
  }

  /**
   * The portrait's colour leaves it: `n` motes lift off (inside cut `along`'s strip when given, anywhere on the face
   * otherwise), spread over `spanMs`, and stream into the striker.
   */
  stream(n: number, spanMs: number, along: number | null = null): void {
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
      const s = this.take('core', this.tex.mote, tint);
      if (!s) break;
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
      m.size = this.look.moteSize * (9 + this.rnd() * 8) * this.scale;
      m.phase = this.rnd() * Math.PI * 2;
      s.alpha = 0; s.position.set(m.x0, m.y0);
      m.s = s; this.flying++; made++;
    }
  }

  /** IV: the bell tolls: one faint ring opens slowly from the striker across the whole screen. */
  toll(): void {
    if (this.destroyed) return;
    const S = this.scale;
    const span = Math.hypot(this.geo.bounds.w, this.geo.bounds.h);
    const k = (v: number): number => v / (this.tex.ring.width * 0.8) / S;
    this.spawn('glow', this.tex.ring, this.colors.teal, this.hero.x, this.hero.y, { dur: 1500, from: k(this.hero.r * 2), to: k(span * 1.5), a0: 0.3, mode: 'out', ease: 'cubic' });
    this.spawn('glow', this.tex.glow, this.colors.teal, this.hero.x, this.hero.y, { dur: 700, from: (this.hero.r * 2) / this.tex.glow.width / S, to: (this.hero.r * 4.4) / this.tex.glow.width / S, a0: 0.4, mode: 'punch', peakAt: 0.2, ease: 'cubic' });
  }

  /** III: the flame is out: two small curls of grey smoke rise off the wick. */
  snuff(): void {
    const s = this.geo.shadow;
    if (this.destroyed || !s) return;
    const S = this.scale;
    const ch = this.foe.r * 0.5;
    const k = (v: number): number => v / this.tex.glow.width / S;
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', this.tex.glow, 0x8f9a98, s.candle.x + (i ? 4 : -2) * S, s.candle.y - ch * 0.95, {
        dur: 800 + 200 * i, from: k(ch * 0.3), to: k(ch * (0.9 + 0.3 * i)), a0: 0.3, mode: 'punch', peakAt: 0.2, ease: 'linear', vx: (i ? 10 : -8), vy: -70 - 20 * i, drag: 0.5, delay: 120 * i,
      });
    }
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
      s.scale.set((m.size * (1 - 0.45 * e)) / MOTE_TEX);
      if (v >= 1) {
        this.give(s); m.s = null; this.flying--; this.arrivedN++;
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
    for (const s of [...this.blades, ...this.shades, this.shadowS, this.snathS, this.candleS, this.flameS, this.flameGlow, this.lineS, this.lineGlow, this.lineShade, this.lineHead]) {
      if (s) s.visible = false;
    }
  }

  protected override clearOwn(): void {
    this.hideOwn();
    for (const m of this.motes) { if (m.s) { this.give(m.s); m.s = null; } }
    this.flying = 0;
  }
}
