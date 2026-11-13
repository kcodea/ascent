/**
 * THE WRITTEN IN THE STARS SCENE: everything the attack draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroStars.ts` mounts `root` on the above-portrait
 * overlay, hands it the sky (`setSky`) and the constellation (`setFigure`) once, feeds `update(dt)`, and each frame
 * tells it the time and a handful of amounts (`frame`): how present the sky is, how far the bow is drawn, how alive the
 * figure is. Every star and line is then placed from the figure's own data: nothing is allocated per frame.
 *
 * WHAT IT DRAWS
 *  - THE SKY: one blue-black veil quad over the whole board (a sprite with alpha, never a filter) and a seeded scatter
 *    of small twinkling stars.
 *  - THE CONSTELLATION: each star is a four-point glint over a soft halo that pops as the line reaches it; each line is
 *    one thin glowing thread stretched from its first star toward its second as its slot plays, a bright pen point
 *    riding its tip. The moving stars (the string, the arrow, the bow tips, the reaching arm) carry their lines with
 *    them, so the string bends into a V as the bow draws.
 *  - III's GHOST: a soft capsule along each body line, a soft head and torso, faint, for a beat.
 *  - IV's PORTRAIT: the striking hero's own portrait, faint and cold, inside the medallion.
 *  - THE SHOT: the arrow of starlight with a thin trail, or IV's falling star: a white-gold point with a thin trail.
 *  - THE BLOW: stardust (small glints and points), a soft ring and a soft flash; IV a clean ring of stardust.
 *
 * Perf: pooled sprites under a hard cap; the sky, the constellation and the shot are own sprites made once per attack
 * and only moved, scaled and faded after that (transform, alpha and tint writes only).
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA } from '../heroAttack/knockout';
import type { Box, StarFigure } from './heroStarsConfig';
import { ARROW_W, DOT_PX, GLINT_PX, HALO_PX, LIMB_H, LIMB_W, LINE_H, LINE_W, TRAIL_H, TRAIL_W, VEIL_H, VEIL_W } from './heroStarsTextures';

export interface HeroStarsTextures extends HeroArcanaTextures {
  glint: Texture;
  dot: Texture;
  line: Texture;
  trail: Texture;
  arrow: Texture;
  limb: Texture;
  veil: Texture;
  halo: Texture;
}

export interface StarsColors { star: number; gold: number; line: number; sky: number; side: number }

export interface StarsLook {
  starPx: number;
  lineWidth: number;
  twinkle: number;
  ghostAlpha: number;
  portraitAlpha: number;
  arrowPx: number;
  trailWidth: number;
  impactSize: number;
}

/** What the runner tells the scene each frame (one object, reused). */
export interface SkyFrame {
  /** Sequence ms. */
  t: number;
  /** How present the night is (0..1: in through the opening, out after the blow). */
  sky: number;
  /** The veil's peak opacity. */
  veil: number;
  /** How far the bow is drawn (0..1, ringing past 0 on the loose). */
  draw: number;
  /** How alive the figure is (0 while traced, 1 once it has brightened). */
  alive: number;
  /** III's ghost body / IV's portrait (0..1). */
  ghost: number;
  /** The arrow's stars and lines (and IV's plucked star): 1 until they leave with the shot, then 0. */
  arrow: number;
  /** IV: how brightly the star being plucked burns (0..1). */
  pluck: number;
  /** When the blow landed (the stars shimmer outward from it), or Infinity. */
  shimmerAt: number;
  shimmerX: number;
  shimmerY: number;
}

/** Hard cap on sprites alive at once (IV's sky, medallion and stardust peak well under it). */
export const MAX_STARS_SPRITES = 640;
const GLOW_PX = 128;
const RING_PX = HALO_PX;

interface SkyStar { s: Sprite; x: number; y: number; a: number; size: number; phase: number; speed: number; delay: number }
interface FigSprites { glint: Sprite; halo: Sprite }

export class HeroStarsScene extends FxPool {
  private veil: Sprite | null = null;
  private haze: Sprite | null = null;
  private sky: SkyStar[] = [];
  private fig: StarFigure | null = null;
  private litAt: number[] = [];
  private edgeAt: number[] = [];
  private stepMs = 60;
  private starSprites: FigSprites[] = [];
  private lineSprites: Sprite[] = [];
  private limbSprites: (Sprite | null)[] = [];
  private bodySprites: Sprite[] = [];
  private pens: Sprite[] = [];
  private portrait: Sprite | null = null;
  private disc: Sprite | null = null;
  private px: Float32Array = new Float32Array(0);
  private py: Float32Array = new Float32Array(0);
  private shot: { body: Sprite; halo: Sprite; trail: Sprite; on: boolean; x: number; y: number; star: boolean; acc: number } | null = null;
  private age = 0;
  private ownOn = false;
  private lit = 0;
  private drawn = 0;

  constructor(private readonly tex: HeroStarsTextures, private readonly colors: StarsColors, private readonly look: StarsLook, scale = 1, seed = 1) {
    super('heroStars', [tex.glow, tex.halo, tex.glint, tex.dot, tex.line, tex.trail, tex.arrow, tex.limb, tex.veil], scale, seed, MAX_STARS_SPRITES);
  }

  /** Stars of the constellation alight this frame. */
  get litStars(): number { return this.lit; }
  /** Lines of the constellation fully drawn this frame. */
  get drawnLines(): number { return this.drawn; }
  get skyStars(): number { return this.sky.length; }
  get shotFlying(): boolean { return !!this.shot?.on; }
  get veilAlpha(): number { return this.veil && this.veil.visible ? this.veil.alpha : 0; }
  get portraitShown(): boolean { return !!this.portrait && this.portrait.visible && this.portrait.alpha > 0.01; }
  /** A constellation star's position this frame (tests). */
  starPos(i: number): Pt { return { x: this.px[i] ?? 0, y: this.py[i] ?? 0 }; }

  /** A texture-px scale that draws `px` screen px (the pool multiplies every scale by the stage scale). */
  private k(px: number, texPx: number): number { return px / texPx / this.scale; }

  /** THE SKY: the veil over `area` (overscanned, so the camera never shows its edge) and `n` small stars across it. */
  setSky(area: Box, n: number): void {
    if (this.veil) return;
    const c = this.colors;
    const veil = this.take('under', this.tex.veil, c.sky);
    if (!veil) return;
    veil.position.set(area.x + area.w / 2, area.y + area.h / 2);
    veil.scale.set((area.w * 1.5) / VEIL_W, (area.h * 1.5) / VEIL_H);
    veil.alpha = 0;
    this.veil = veil;
    // A faint band of light high in the sky (depth, so the veil is not a flat sheet).
    const haze = this.take('glow', this.tex.glow, mixColor(c.sky, c.line, 0.45));
    if (haze) { haze.position.set(area.x + area.w * 0.5, area.y + area.h * 0.28); haze.scale.set((area.w * 1.3) / GLOW_PX, (area.h * 0.7) / GLOW_PX); haze.alpha = 0; this.haze = haze; }
    for (let i = 0; i < n; i++) {
      // More of them high up; one in seven is a bigger star with a glint.
      const y = Math.pow(this.rnd(), 1.35);
      const big = this.rnd() < 0.15;
      const s = this.take('glow', big ? this.tex.glint : this.tex.dot, i % 5 === 0 ? c.gold : i % 3 === 0 ? c.line : c.star);
      if (!s) break;
      const st: SkyStar = {
        s, x: area.x + this.rnd() * area.w, y: area.y + y * area.h * 0.96, a: (big ? 0.9 : 0.5 + this.rnd() * 0.45) * (1 - 0.3 * y),
        size: big ? ((20 + this.rnd() * 14) * this.scale) / GLINT_PX : ((5 + this.rnd() * 5) * this.scale) / DOT_PX, phase: this.rnd() * Math.PI * 2, speed: 0.0016 + this.rnd() * 0.0042, delay: this.rnd(),
      };
      s.position.set(st.x, st.y); s.scale.set(st.size); s.alpha = 0;
      this.sky.push(st);
    }
    this.ownOn = true;
  }

  /** THE CONSTELLATION: its stars and lines, when each star lights and each line starts, and how long a line takes. */
  setFigure(fig: StarFigure, litAt: readonly number[], edgeAt: readonly number[], stepMs: number): void {
    if (this.fig) return;
    const c = this.colors;
    this.fig = fig; this.litAt = [...litAt]; this.edgeAt = [...edgeAt]; this.stepMs = Math.max(1, stepMs);
    this.px = new Float32Array(fig.stars.length); this.py = new Float32Array(fig.stars.length);
    // Bottom to top within the glow layer: the medallion's disc and portrait, the ghost body, the lines, the halos.
    if (fig.medallion) {
      this.disc = this.take('glow', this.tex.glow, mixColor(c.sky, c.line, 0.6));
      if (this.disc) { this.disc.position.set(fig.medallion.x, fig.medallion.y); this.disc.scale.set((fig.medallion.r * 2.9) / GLOW_PX); this.disc.alpha = 0; }
    }
    if (fig.head >= 0) {
      for (let i = 0; i < 2; i++) { const s = this.take('glow', this.tex.glow, c.line); if (s) { s.alpha = 0; this.bodySprites.push(s); } }
    }
    for (const e of fig.edges) {
      let limb: Sprite | null = null;
      if (e.limb) { limb = this.take('glow', this.tex.limb, c.line); if (limb) limb.alpha = 0; }
      this.limbSprites.push(limb);
    }
    for (const e of fig.edges) {
      const s = this.take('glow', this.tex.line, e.arrow ? mixColor(c.line, c.gold, 0.55) : c.line);
      if (!s) break;
      s.anchor.set(0, 0.5); s.alpha = 0;
      this.lineSprites.push(s);
    }
    for (const st of fig.stars) {
      const halo = this.take('glow', this.tex.glow, st.arrow || st.pluck ? c.gold : c.line);
      const glint = this.take('core', this.tex.glint, st.arrow || st.pluck ? mixColor(c.star, c.gold, 0.35) : c.star);
      if (!halo || !glint) { this.give(halo); this.give(glint); break; }
      halo.alpha = 0; glint.alpha = 0;
      this.starSprites.push({ glint, halo });
    }
    for (let i = 0; i < 2; i++) { const s = this.take('core', this.tex.glint, 0xffffff); if (s) { s.alpha = 0; this.pens.push(s); } }
    this.ownOn = true;
  }

  /** IV: the striking hero's portrait (a round soft-edged texture), shown faintly inside the medallion. */
  setPortrait(t: Texture | null): void {
    if (!t || this.portrait || !this.fig?.medallion) return;
    const s = this.take('glow', t, mixColor(this.colors.line, 0xffffff, 0.35));
    if (!s) return;
    const m = this.fig.medallion;
    s.position.set(m.x, m.y);
    s.scale.set((m.r * 1.86) / Math.max(1, t.width));
    s.alpha = 0;
    this.portrait = s;
  }

  /** Paint the sky and the constellation for this frame. */
  frame(f: SkyFrame): void {
    if (this.destroyed || !this.ownOn) return;
    const { t } = f;
    const S = this.scale;
    const sky = clamp01(f.sky);
    const tw = this.look.twinkle;
    const shimmer = Number.isFinite(f.shimmerAt) && t >= f.shimmerAt;
    if (this.veil) this.veil.alpha = f.veil * sky;
    if (this.haze) this.haze.alpha = 0.16 * sky;
    for (const st of this.sky) {
      const appear = clamp01(sky * 2.4 - st.delay * 1.3);
      const b = this.wave(f, st.x, st.y);
      st.s.alpha = Math.min(1, st.a * appear * (1 - tw + tw * (0.5 + 0.5 * Math.sin(this.age * st.speed + st.phase))) * (1 + 1.6 * b));
      if (shimmer) st.s.scale.set(st.size * (1 + 0.6 * b));
    }
    const fig = this.fig;
    if (!fig) return;
    const w = f.draw;
    const alive = clamp01(f.alive);
    let lit = 0;
    for (let i = 0; i < this.starSprites.length; i++) {
      const st = fig.stars[i]!, sp = this.starSprites[i]!;
      let x = st.x + st.px * w, y = st.y + st.py * w;
      // At full draw the moving stars tremble a hair (the bow is under strain).
      if (w > 0.96 && (st.px || st.py)) { x += Math.sin(this.age * 0.09 + i) * 0.7 * S; y += Math.cos(this.age * 0.11 + i * 2) * 0.7 * S; }
      this.px[i] = x; this.py[i] = y;
      const u = (t - this.litAt[i]!) / 150;
      const part = st.arrow || st.pluck ? f.arrow : 1;
      if (u <= 0 || part <= 0.002 || sky <= 0.002) { sp.glint.alpha = 0; sp.halo.alpha = 0; continue; }
      lit++;
      // It POPS as the line reaches it, then settles.
      const pop = u >= 1 ? 1 : (1 + 0.9 * (1 - u)) * clamp01(u * 4);
      const b = this.wave(f, x, y);
      const burn = st.pluck ? f.pluck : 0;
      const flick = 1 + 0.06 * Math.sin(this.age * 0.006 + i * 1.7);
      const size = this.look.starPx * S * st.size * pop * (1 + 0.3 * alive + 0.5 * b + 0.9 * burn) * flick;
      const a = Math.min(1, sky * part);
      sp.glint.position.set(x, y); sp.glint.scale.set(size / GLINT_PX); sp.glint.alpha = a;
      if (st.pluck) sp.glint.rotation = this.age * 0.0012 * (1 + 4 * burn);
      sp.halo.position.set(x, y); sp.halo.scale.set((size * (1.5 + 0.9 * burn)) / GLOW_PX); sp.halo.alpha = a * Math.min(1, 0.26 + 0.2 * alive + 0.4 * b + 0.45 * burn);
    }
    this.lit = lit;
    let pen = 0, drawn = 0;
    const lineH = (this.look.lineWidth * S * (1 + 0.35 * alive)) / LINE_H;
    for (let i = 0; i < this.lineSprites.length; i++) {
      const e = fig.edges[i]!, s = this.lineSprites[i]!;
      const prog = clamp01((t - this.edgeAt[i]!) / this.stepMs);
      const part = e.arrow ? f.arrow : 1;
      const limb = this.limbSprites[i];
      if (prog <= 0 || part <= 0.002 || sky <= 0.002) { s.alpha = 0; if (limb) limb.alpha = 0; continue; }
      const ax = this.px[e.a]!, ay = this.py[e.a]!, bx = this.px[e.b]!, by = this.py[e.b]!;
      const len = Math.hypot(bx - ax, by - ay);
      const rot = Math.atan2(by - ay, bx - ax);
      s.position.set(ax, ay); s.rotation = rot; s.scale.set(Math.max(0.001, (len * prog) / LINE_W), lineH);
      s.alpha = Math.min(1, (0.62 + 0.3 * alive + 0.3 * this.wave(f, (ax + bx) / 2, (ay + by) / 2)) * sky * part * (e.soft ? 0.5 * (this.portrait ? 1 - 0.6 * clamp01(f.ghost) : 1) : 1));
      if (prog >= 1) drawn++;
      else if (pen < this.pens.length) {
        // The pen: a bright point riding the tip of the line as it is drawn.
        const p = this.pens[pen++]!;
        p.position.set(ax + (bx - ax) * prog, ay + (by - ay) * prog);
        p.scale.set((this.look.starPx * 0.62 * S) / GLINT_PX); p.rotation = this.age * 0.01; p.alpha = sky;
      }
      if (limb) {
        const g = clamp01(f.ghost) * this.look.ghostAlpha * sky;
        limb.position.set((ax + bx) / 2, (ay + by) / 2); limb.rotation = rot;
        limb.scale.set((len * 1.28) / LIMB_W, (fig.unit * 0.085) / LIMB_H); limb.alpha = prog >= 1 ? g : 0;
      }
    }
    for (let i = pen; i < this.pens.length; i++) this.pens[i]!.alpha = 0;
    this.drawn = drawn;
    // III's ghost head and torso.
    if (this.bodySprites.length === 2 && fig.head >= 0 && fig.torso.length === 3) {
      const g = clamp01(f.ghost) * this.look.ghostAlpha * sky;
      const head = this.bodySprites[0]!, torso = this.bodySprites[1]!;
      head.position.set(this.px[fig.head]!, this.py[fig.head]!); head.scale.set((fig.unit * 0.2) / GLOW_PX); head.alpha = Math.min(1, g * 1.8);
      const a = fig.torso[0]!, b = fig.torso[1]!, c = fig.torso[2]!;
      const sx = (this.px[a]! + this.px[b]!) / 2, sy = (this.py[a]! + this.py[b]!) / 2;
      const hx = this.px[c]!, hy = this.py[c]!;
      torso.position.set((sx + hx) / 2, (sy + hy) / 2); torso.rotation = Math.atan2(hy - sy, hx - sx) - Math.PI / 2;
      torso.scale.set((fig.unit * 0.34) / GLOW_PX, (Math.hypot(hx - sx, hy - sy) * 1.7) / GLOW_PX); torso.alpha = g * 1.3;
    }
    if (this.disc) this.disc.alpha = 0.2 * clamp01(f.ghost) * sky;
    if (this.portrait) this.portrait.alpha = clamp01(f.ghost) * this.look.portraitAlpha * sky * (1 + 0.5 * this.wave(f, this.portrait.x, this.portrait.y));
  }

  /** The shimmer: a wave of brightness running outward from the blow through every star (0 before the blow). */
  private wave(f: SkyFrame, x: number, y: number): number {
    if (!(f.t >= f.shimmerAt)) return 0;
    const u = (f.t - f.shimmerAt - Math.hypot(x - f.shimmerX, y - f.shimmerY) * 0.3) / 300;
    return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u);
  }

  /** A star lights: a small ring opens round it. */
  starPop(i: number): void {
    const st = this.fig?.stars[i];
    if (!st) return;
    const r = this.look.starPx * st.size * this.scale;
    this.spawn('glow', this.tex.halo, this.colors.line, st.x, st.y, { dur: 300, from: this.k(r * 0.2, RING_PX), to: this.k(r * 1.5, RING_PX), a0: 0.55, ease: 'cubic' });
  }

  /** The figure is whole: it comes alive (a soft breath of light through it). */
  comeAlive(): void {
    const f = this.fig;
    if (!f) return;
    this.spawn('glow', this.tex.glow, this.colors.line, f.centre.x, f.centre.y, { dur: 520, from: this.k(f.unit * (f.kind === 'hunter' ? 0.9 : 2.2), GLOW_PX), to: this.k(f.unit * (f.kind === 'hunter' ? 1.3 : 3.2), GLOW_PX), a0: 0.2, mode: 'punch', peakAt: 0.3, ease: 'linear' });
  }

  /** IV: the star is taken: a ring closes on it. */
  plucked(at: Pt, radius: number): void {
    this.spawn('glow', this.tex.halo, this.colors.gold, at.x, at.y, { dur: 320, from: this.k(radius * 1.5, RING_PX), to: this.k(radius * 0.25, RING_PX), a0: 0.7, mode: 'punch', peakAt: 0.7, ease: 'cubic' });
  }

  /** The shot leaves: a small ring and a puff of points where it was. */
  loosed(at: Pt, angle: number, radius: number): void {
    const c = this.colors;
    this.spawn('glow', this.tex.halo, c.star, at.x, at.y, { dur: 240, from: this.k(radius * 0.15, RING_PX), to: this.k(radius * 0.8, RING_PX), a0: 0.4, ease: 'cubic' });
    this.burst('core', this.tex.dot, [c.star, c.gold], at.x, at.y, 6, { speed: 130, dir: angle + Math.PI, spread: 1.6, life: 420, size: 0.35, drag: 0.3, to: 0.2 });
  }

  /**
   * The shot this frame: the arrow of starlight (`star` false) or IV's falling star, at (x, y) heading `angle`, with a
   * thin trail back toward (fx, fy) at most `trailLen` long. `on` false hides it.
   */
  setShot(on: boolean, x = 0, y = 0, angle = 0, fx = 0, fy = 0, size = 1, star = false, trailLen = Infinity): void {
    if (!this.shot) {
      if (!on) return;
      const c = this.colors;
      const trail = this.take('glow', this.tex.trail, mixColor(c.gold, c.star, 0.5));
      const halo = this.take('glow', this.tex.glow, c.gold);
      const body = this.take('core', star ? this.tex.glint : this.tex.arrow, star ? mixColor(c.star, c.gold, 0.3) : c.star);
      if (!trail || !halo || !body) { for (const s of [trail, halo, body]) this.give(s); return; }
      trail.anchor.set(1, 0.5);
      if (!star) body.anchor.set(0.97, 0.5);
      this.shot = { body, halo, trail, on: false, x, y, star, acc: 0 };
      this.ownOn = true;
    }
    const sh = this.shot;
    sh.on = on;
    sh.body.alpha = sh.halo.alpha = sh.trail.alpha = on ? 1 : 0;
    if (!on) return;
    const S = this.scale;
    sh.x = x; sh.y = y;
    sh.body.position.set(x, y);
    if (sh.star) { const k = (this.look.starPx * 2.3 * size * S) / GLINT_PX; sh.body.scale.set(k); sh.body.rotation = this.age * 0.004; }
    else { sh.body.scale.set((this.look.arrowPx * size * S) / ARROW_W); sh.body.rotation = angle; }
    sh.halo.position.set(x, y); sh.halo.scale.set((this.look.starPx * (sh.star ? 3.4 : 2.2) * size * S) / GLOW_PX); sh.halo.alpha = sh.star ? 0.7 : 0.5;
    const len = Math.min(trailLen, Math.hypot(x - fx, y - fy));
    sh.trail.position.set(x, y); sh.trail.rotation = angle;
    sh.trail.scale.set(Math.max(0.001, len / TRAIL_W), (this.look.trailWidth * (sh.star ? 1.25 : 1) * size * S) / TRAIL_H);
    sh.trail.alpha = 0.9;
  }

  /** The shot's line of light lingers after it lands, then fades. */
  linger(from: Pt, to: Pt, ms: number, size = 1): void {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len < 4 || ms <= 0) return;
    const kx = this.k(len, TRAIL_W);
    const s = this.spawn('glow', this.tex.trail, mixColor(this.colors.gold, this.colors.star, 0.5), to.x, to.y, {
      dur: ms, from: kx, to: kx, sy: (this.look.trailWidth * size) / TRAIL_H / kx, a0: 0.85, ease: 'linear', rot: Math.atan2(to.y - from.y, to.x - from.x),
    });
    if (s) s.anchor.set(1, 0.5);
  }

  /**
   * THE BLOW: stardust (small glints flung out, points of light that drift and settle), a soft ring and a soft flash.
   * IV: the falling star lands in a clean RING of stardust, with a second slower ring and a wider flash.
   */
  impact(at: Pt, dir: Pt, radius: number, tier: number): void {
    const c = this.colors;
    const X = this.look.impactSize * (0.85 + 0.12 * tier);
    const R = radius * X;
    this.spawn('core', this.tex.glow, c.star, at.x, at.y, { dur: 240, from: this.k(R * 1.1, GLOW_PX), to: this.k(R * 2.8, GLOW_PX), a0: 0.75, mode: 'punch', peakAt: 0.12 });
    this.spawn('core', this.tex.glint, 0xffffff, at.x, at.y, { dur: 300, from: this.k(R * 1.2, GLINT_PX), to: this.k(R * 3.4, GLINT_PX), a0: 0.95, mode: 'punch', peakAt: 0.15, ease: 'cubic' });
    this.spawn('glow', this.tex.halo, c.line, at.x, at.y, { dur: 460, from: this.k(R * 0.6, RING_PX), to: this.k(R * 3, RING_PX), a0: 0.75, ease: 'cubic' });
    const back = Math.atan2(-dir.y, -dir.x);
    this.burst('core', this.tex.glint, [c.star, c.gold, 0xffffff], at.x, at.y, 6 + 4 * tier, { speed: 420 * X, dir: back, spread: 4.4, life: 560, size: 0.2 * X, drag: 0.2, spin: 0.012, to: 0.2 });
    this.burst('core', this.tex.dot, [c.star, c.gold, c.line], at.x, at.y, 10 + 6 * tier, { speed: 300 * X, life: 820, size: 0.42 * X, drag: 0.25, grav: 140, to: 0.25 });
    if (tier < 4) return;
    // The ring of stardust: an even ring of glints flying outward together, and a slower ring of points inside it.
    const N = 26;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.12;
      const sz = (i % 2 ? 0.2 : 0.3) * X;
      this.spawn('core', this.tex.glint, i % 3 === 0 ? c.gold : c.star, at.x + Math.cos(a) * R * 0.5, at.y + Math.sin(a) * R * 0.5, {
        dur: 760, from: sz, to: sz * 0.35, a0: 1, ease: 'linear', vx: Math.cos(a) * 560 * X, vy: Math.sin(a) * 560 * X, drag: 0.12, spin: 0.006,
      });
      this.spawn('core', this.tex.dot, c.line, at.x + Math.cos(a + 0.12) * R * 0.4, at.y + Math.sin(a + 0.12) * R * 0.4, {
        dur: 980, from: 0.5 * X, to: 0.2 * X, a0: 0.9, ease: 'linear', vx: Math.cos(a + 0.12) * 300 * X, vy: Math.sin(a + 0.12) * 300 * X, drag: 0.14,
      });
    }
    this.spawn('glow', this.tex.glow, mixColor(c.line, c.star, 0.5), at.x, at.y, { dur: 620, from: this.k(R * 2, GLOW_PX), to: this.k(R * 6.5, GLOW_PX), a0: 0.42, mode: 'punch', peakAt: 0.14 });
    this.spawn('glow', this.tex.halo, c.gold, at.x, at.y, { dur: 700, from: this.k(R * 0.8, RING_PX), to: this.k(R * 5, RING_PX), a0: 0.6, ease: 'cubic', delay: 70 });
    this.spawn('glow', this.tex.halo, c.star, at.x, at.y, { dur: 900, from: this.k(R, RING_PX), to: this.k(R * 7.5, RING_PX), a0: 0.35, ease: 'cubic', delay: 150 });
  }

  /** THE KNOCKOUT's remix of IV: the ring of stardust goes prismatic (cyan, lilac, magenta) with three soft rings. */
  koFlourish(at: Pt, radius: number): void {
    const X = this.look.impactSize * 1.3;
    const R = radius * X;
    [KO_CYAN, KO_LILAC, KO_MAGENTA].forEach((tint, i) => this.spawn('glow', this.tex.halo, tint, at.x, at.y, { dur: 760 + i * 120, from: this.k(R * 0.8, RING_PX), to: this.k(R * (5.5 + i * 1.6), RING_PX), a0: 0.7, ease: 'cubic', delay: 60 + i * 80 }));
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      this.spawn('core', this.tex.glint, [KO_CYAN, KO_LILAC, KO_MAGENTA][i % 3]!, at.x, at.y, { dur: 900, from: 0.3 * X, to: 0.1 * X, a0: 1, ease: 'linear', vx: Math.cos(a) * 760 * X, vy: Math.sin(a) * 760 * X, drag: 0.14, spin: 0.01, delay: 60 });
    }
  }

  /** The night is over: every own sprite is hidden (the stardust still in the air drains by itself). */
  endSky(): void {
    this.ownOn = false;
    if (this.veil) this.veil.alpha = 0;
    if (this.haze) this.haze.alpha = 0;
    for (const st of this.sky) st.s.alpha = 0;
    for (const sp of this.starSprites) { sp.glint.alpha = 0; sp.halo.alpha = 0; }
    for (const s of this.lineSprites) s.alpha = 0;
    for (const s of this.limbSprites) if (s) s.alpha = 0;
    for (const s of this.bodySprites) s.alpha = 0;
    for (const s of this.pens) s.alpha = 0;
    if (this.portrait) this.portrait.alpha = 0;
    if (this.disc) this.disc.alpha = 0;
    if (this.shot) { this.shot.on = false; this.shot.body.alpha = this.shot.halo.alpha = this.shot.trail.alpha = 0; }
    this.lit = 0; this.drawn = 0;
  }

  protected override tick(dt: number): boolean {
    this.age += dt;
    // Stardust shed along the shot's path.
    const sh = this.shot;
    if (sh?.on) {
      sh.acc += dt;
      if (sh.acc >= (sh.star ? 16 : 24)) {
        sh.acc = 0;
        const c = this.colors;
        this.spawn('core', this.tex.dot, this.rnd() < 0.5 ? c.star : c.gold, sh.x + (this.rnd() - 0.5) * 8 * this.scale, sh.y + (this.rnd() - 0.5) * 8 * this.scale, {
          dur: sh.star ? 520 : 360, from: sh.star ? 0.5 : 0.36, to: 0.08, a0: 0.9, ease: 'linear', vx: (this.rnd() - 0.5) * 50, vy: (this.rnd() - 0.5) * 50 + (sh.star ? 30 : 0), drag: 0.5,
        });
      }
    }
    return this.ownOn;
  }

  protected override clearOwn(): void {
    const all: (Sprite | null)[] = [this.veil, this.haze, this.portrait, this.disc, ...this.sky.map((s) => s.s), ...this.lineSprites, ...this.limbSprites, ...this.bodySprites, ...this.pens];
    for (const sp of this.starSprites) all.push(sp.glint, sp.halo);
    if (this.shot) all.push(this.shot.body, this.shot.halo, this.shot.trail);
    for (const s of all) if (s) { s.visible = true; this.give(s); }
    this.veil = this.haze = this.portrait = this.disc = null;
    this.sky = []; this.lineSprites = []; this.limbSprites = []; this.bodySprites = []; this.pens = []; this.starSprites = [];
    this.shot = null; this.fig = null; this.ownOn = false; this.lit = 0; this.drawn = 0;
  }
}
