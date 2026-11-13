/**
 * THE WRITTEN IN THE STARS SCENE: everything the attack draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroStars.ts` mounts `root` on the above-portrait
 * overlay, hands it the sky (`setSky`), the constellation (`setFigure`) and the shot's path (`setPath`) once, feeds
 * `update(dt)`, and each frame tells it the time and a handful of amounts (`frame`, `shotFrame`): how present the sky
 * is, how far the bow is drawn, how alive the figure is, where the shot is. Every star and line is then placed from the
 * figure's own data: nothing is allocated per frame.
 *
 * WHAT IT DRAWS
 *  - THE SKY: one blue-black veil quad over the whole board (a sprite with alpha, never a filter) and a seeded scatter
 *    of small twinkling stars.
 *  - THE CONSTELLATION: each star is a four-point glint over a soft halo that pops as the line reaches it; each line is
 *    one glowing thread stretched from its first star toward its second as its slot plays, a bright pen point riding
 *    its tip. The moving stars (the string, the arrow, the bow tips, the reaching arm) carry their lines with them, so
 *    the string bends into a V as the bow draws. A soft GLOW builds behind the figure as each star joins it, and the
 *    higher the look the thicker and brighter its lines.
 *  - THE GHOST BODY (the hunter, the giant): a soft capsule along each body line, a soft head and torso, faint.
 *  - Written in the stars: the striking hero's own portrait, faint and cold, inside the medallion.
 *  - THE SHOT: a bolt of starlight on a curved PATH: a bright head (an arrow, a large white-gold comet, or a spark at
 *    the nose of a leaping wolf, a striking serpent, a falling fist or a beam) and a long luminous tail laid in
 *    segments along the path, which hangs there after the blow and drains toward the hit. RIDING stars move with the
 *    head (the wolf whole, tipping with its leap; the serpent's head with its body stretching after it; the fist).
 *  - THE WHEEL turns its stars about its pivot; THE NOVA draws every star of the sky into its heart.
 *  - Tier 4's HELD BREATH: the charging star swells and blazes, motes of light stream into it, every other star dims
 *    and leans toward it.
 *  - THE BLOW: a nova of stardust that expands and hangs, a flash over the whole sky, rings, and a JOLT that travels
 *    outward through every star (they are shoved away from the hit and spring back). All of it scales with the tier.
 *    Tier 4's lines and the beasts flare and then SCATTER into sparks that drift down.
 *
 * Perf: pooled sprites under a hard cap; the sky, the constellation and the shot are own sprites made once per attack
 * and only moved, scaled and faded after that (transform, alpha and tint writes only).
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA } from '../heroAttack/knockout';
import type { Box, ShotHead, StarFigure } from './heroStarsConfig';
import { ARROW_W, DOT_PX, GLINT_PX, HALO_PX, LIMB_H, LIMB_W, LINE_H, LINE_W, VEIL_H, VEIL_W } from './heroStarsTextures';

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
  impactSize: number;
  /** The look (1..4): the higher, the thicker and brighter the lines, the bigger the shot and the blow. */
  tier: number;
  /** Tier 4: how far the charging star swells (x its own size), and how far the rest of the sky dims while it does. */
  swell: number;
  hush: number;
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
  /** Tier 3's ghost body / Tier 4's portrait (0..1). */
  ghost: number;
  /** The arrow's stars and lines (and Tier 4's plucked star): 1 until they leave with the shot, then 0. */
  arrow: number;
  /** Tier 4: how brightly the charging star burns (0..1). */
  pluck: number;
  /** Tier 4: how far the charging star has swollen (0..1), and the sky's held breath (0..1: the other stars dim and lean in). */
  swell: number;
  hush: number;
  /** The wheel: how far its stars have turned (radians). */
  spin: number;
  /** How far along its path the shot is (0 until the loose, 1 from the blow): the riding stars follow it. */
  ride: number;
  /** Whether the shot has left (the riding stars then stay at full draw instead of springing back). */
  loosed: boolean;
  /** The nova: how far the sky has been drawn into its heart (0..1). */
  gather: number;
  /** After the blow: the constellation's lines flare (0..1). */
  flare: number;
  /** How much of the constellation is still drawn (Tier 4: 1 until its lines scatter, then 0). */
  fig: number;
  /** When the blow landed (the stars shimmer and jolt outward from it), or Infinity. */
  shimmerAt: number;
  shimmerX: number;
  shimmerY: number;
}

/** Hard cap on sprites alive at once (Tier 4's sky, medallion, comet, nova and falling sparks peak well under it). */
export const MAX_STARS_SPRITES = 900;
/** How many segments the shot's tail is laid in along its path. */
export const TAIL_SEGMENTS = 20;
const GLOW_PX = 128;
const RING_PX = HALO_PX;

interface SkyStar { s: Sprite; x: number; y: number; a: number; size: number; phase: number; speed: number; delay: number }
interface FigSprites { glint: Sprite; halo: Sprite }
interface Shot {
  body: Sprite; glint: Sprite; glow: Sprite; core: Sprite; tail: Sprite[]; under: Sprite[];
  lead: ShotHead; on: boolean; x: number; y: number; acc: number; tailPx: number; headPx: number;
  x0: number; y0: number; cx: number; cy: number; x1: number; y1: number;
}

export class HeroStarsScene extends FxPool {
  private veil: Sprite | null = null;
  private haze: Sprite | null = null;
  private area: Box | null = null;
  private sky: SkyStar[] = [];
  private skyMoved = false;
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
  private aura: Sprite | null = null;
  private swellGlow: Sprite | null = null;
  private swellRays: Sprite | null = null;
  private px: Float32Array = new Float32Array(0);
  private py: Float32Array = new Float32Array(0);
  private readonly tx = new Float32Array(TAIL_SEGMENTS + 1);
  private readonly ty = new Float32Array(TAIL_SEGMENTS + 1);
  private shot: Shot | null = null;
  private age = 0;
  private ownOn = false;
  private lit = 0;
  private drawn = 0;
  private swellNow = 0;
  private swellAcc = 0;
  private joltAmp = 0;
  private joltReach = 1;
  private jx = 0;
  private jy = 0;
  private readonly lineK: number;
  private readonly starK: number;

  constructor(private readonly tex: HeroStarsTextures, private readonly colors: StarsColors, private readonly look: StarsLook, scale = 1, seed = 1) {
    super('heroStars', [tex.glow, tex.halo, tex.glint, tex.dot, tex.line, tex.trail, tex.arrow, tex.limb, tex.veil], scale, seed, MAX_STARS_SPRITES);
    const tier = Math.max(1, Math.min(4, look.tier || 1));
    this.lineK = 1 + 0.3 * (tier - 1);
    this.starK = 1 + 0.1 * (tier - 1);
  }

  /** Stars of the constellation alight this frame. */
  get litStars(): number { return this.lit; }
  /** Lines of the constellation fully drawn this frame. */
  get drawnLines(): number { return this.drawn; }
  get skyStars(): number { return this.sky.length; }
  get shotFlying(): boolean { return !!this.shot?.on; }
  /** Whether the shot's tail still hangs in the sky. */
  get tailShown(): boolean { return !!this.shot && this.shot.tail.some((s) => s.alpha > 0.01); }
  get veilAlpha(): number { return this.veil && this.veil.visible ? this.veil.alpha : 0; }
  get portraitShown(): boolean { return !!this.portrait && this.portrait.visible && this.portrait.alpha > 0.01; }
  /** A constellation star's position this frame (tests). */
  starPos(i: number): Pt { return { x: this.px[i] ?? 0, y: this.py[i] ?? 0 }; }
  /** The shot's head this frame (tests). */
  get shotPos(): Pt { return { x: this.shot?.x ?? 0, y: this.shot?.y ?? 0 }; }

  /** A texture-px scale that draws `px` screen px (the pool multiplies every scale by the stage scale). */
  private k(px: number, texPx: number): number { return px / texPx / this.scale; }

  /** THE SKY: the veil over `area` (overscanned, so the camera never shows its edge) and `n` small stars across it. */
  setSky(area: Box, n: number): void {
    if (this.veil) return;
    const c = this.colors;
    const veil = this.take('under', this.tex.veil, c.sky);
    if (!veil) return;
    this.area = area;
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
    // Bottom to top within the glow layer: the building glow, the medallion's disc and portrait, the ghost body, the
    // lines, the halos.
    this.aura = this.take('glow', this.tex.glow, mixColor(c.line, c.star, 0.3));
    if (this.aura) {
      const U = fig.unit;
      this.aura.position.set(fig.centre.x, fig.centre.y);
      if (fig.kind === 'hunter' || fig.kind === 'serpent') this.aura.scale.set((U * 1.25) / GLOW_PX, (U * 1.7) / GLOW_PX);
      else if (fig.kind === 'giant') this.aura.scale.set((U * 0.9) / GLOW_PX, (U * 1.25) / GLOW_PX);
      else if (fig.kind === 'wolf') this.aura.scale.set((U * 4.6) / GLOW_PX, (U * 2.6) / GLOW_PX);
      else this.aura.scale.set((U * (fig.kind === 'written' ? 3.7 : fig.kind === 'wheel' ? 3.6 : fig.kind === 'nova' ? 3.4 : 4.4)) / GLOW_PX);
      this.aura.alpha = 0;
    }
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
    if (fig.charge >= 0) {
      // Tier 4: the charging star's blaze (a wide glow under it and a second, counter-turning set of rays).
      this.swellGlow = this.take('glow', this.tex.glow, mixColor(c.gold, c.star, 0.4));
      this.swellRays = this.take('core', this.tex.glint, mixColor(c.star, c.gold, 0.5));
      if (this.swellGlow) this.swellGlow.alpha = 0;
      if (this.swellRays) this.swellRays.alpha = 0;
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

  /** Tier 4: the striking hero's portrait (a round soft-edged texture), shown faintly inside the medallion. */
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

  /**
   * THE SHOT's path (a quadratic curve from `from` through the control point `ctrl` to `to`) and its sprites: the head
   * (`lead`: a comet; an arrow of starlight with a bright point at its tip; or a spark), `headPx` across (the arrow:
   * long), and a tail `tailPx` wide at the head, laid in segments along the path. Made once, hidden until `shotFrame`.
   */
  setPath(from: Pt, ctrl: Pt, to: Pt, lead: ShotHead, headPx: number, tailPx: number): void {
    if (this.shot) return;
    const c = this.colors;
    const under: Sprite[] = [], tail: Sprite[] = [];
    for (let i = 0; i < TAIL_SEGMENTS; i++) { const s = this.take('glow', this.tex.limb, mixColor(c.line, c.gold, 0.35)); if (s) { s.alpha = 0; under.push(s); } }
    for (let i = 0; i < TAIL_SEGMENTS; i++) { const s = this.take('glow', this.tex.line, mixColor(c.gold, c.star, 0.6)); if (s) { s.anchor.set(0, 0.5); s.alpha = 0; tail.push(s); } }
    const glow = this.take('glow', this.tex.glow, c.gold);
    const star = lead !== 'arrow';
    const body = this.take('core', star ? this.tex.glint : this.tex.arrow, star ? mixColor(c.star, c.gold, 0.3) : c.star);
    const glint = this.take('core', this.tex.glint, star ? mixColor(c.star, c.gold, 0.5) : 0xffffff);
    const core = this.take('core', this.tex.dot, 0xffffff);
    if (!glow || !body || !glint || !core || tail.length < TAIL_SEGMENTS || under.length < TAIL_SEGMENTS) { for (const s of [glow, body, glint, core, ...tail, ...under]) this.give(s); return; }
    if (!star) body.anchor.set(0.97, 0.5);
    glow.alpha = body.alpha = glint.alpha = core.alpha = 0;
    this.shot = { body, glint, glow, core, tail, under, lead, on: false, x: from.x, y: from.y, acc: 0, tailPx, headPx, x0: from.x, y0: from.y, cx: ctrl.x, cy: ctrl.y, x1: to.x, y1: to.y };
    this.ownOn = true;
  }

  /**
   * The shot this frame: its head at `u` along the path (shown while `head`), and its tail laid from `tailFrom` to `u`
   * at opacity `alpha` (after the blow the runner keeps the tail, drains it toward the hit and fades it).
   */
  shotFrame(u: number, tailFrom: number, head: boolean, alpha: number): void {
    const sh = this.shot;
    if (!sh || this.destroyed) return;
    const m = 1 - u;
    const x = m * m * sh.x0 + 2 * m * u * sh.cx + u * u * sh.x1, y = m * m * sh.y0 + 2 * m * u * sh.cy + u * u * sh.y1;
    const angle = Math.atan2(2 * m * (sh.cy - sh.y0) + 2 * u * (sh.y1 - sh.cy), 2 * m * (sh.cx - sh.x0) + 2 * u * (sh.x1 - sh.cx));
    sh.x = x; sh.y = y; sh.on = head;
    if (!head) sh.body.alpha = sh.glint.alpha = sh.glow.alpha = sh.core.alpha = 0;
    else {
      const flick = 1 + 0.07 * Math.sin(this.age * 0.05);
      sh.body.position.set(x, y); sh.glint.position.set(x, y); sh.glow.position.set(x, y); sh.core.position.set(x, y);
      if (sh.lead === 'spark') {
        // A spark: a turning glint and a white core in a gold glow (the stars that ride the shot carry the shape).
        sh.body.scale.set((sh.headPx * 0.7 * flick) / GLINT_PX); sh.body.rotation = this.age * 0.006;
        sh.glint.scale.set((sh.headPx * 0.45) / GLINT_PX); sh.glint.rotation = Math.PI / 4 - this.age * 0.008;
        sh.core.scale.set((sh.headPx * 0.2) / DOT_PX);
        sh.glow.scale.set((sh.headPx * 1.2 * flick) / GLOW_PX); sh.glow.alpha = 0.75;
      } else if (sh.lead === 'comet') {
        // The comet: long turning rays, a second set across them, a white-hot core in a wide gold glow.
        sh.body.scale.set((sh.headPx * flick) / GLINT_PX); sh.body.rotation = this.age * 0.004;
        sh.glint.scale.set((sh.headPx * 0.62) / GLINT_PX); sh.glint.rotation = Math.PI / 4 - this.age * 0.006;
        sh.core.scale.set((sh.headPx * 0.34) / DOT_PX);
        sh.glow.scale.set((sh.headPx * 1.5 * flick) / GLOW_PX); sh.glow.alpha = 0.9;
      } else {
        sh.body.scale.set(sh.headPx / ARROW_W); sh.body.rotation = angle;
        sh.glint.scale.set((sh.tailPx * 6.5 * flick) / GLINT_PX); sh.glint.rotation = this.age * 0.006;
        sh.core.scale.set((sh.tailPx * 1.5) / DOT_PX);
        sh.glow.scale.set((sh.tailPx * 9) / GLOW_PX); sh.glow.alpha = 0.7;
      }
      sh.body.alpha = sh.glint.alpha = sh.core.alpha = 1;
    }
    // The tail: segments along the path from `tailFrom` to the head, thickest and brightest at the head.
    const N = TAIL_SEGMENTS;
    const a = Math.max(0, Math.min(1, alpha));
    const t0 = Math.max(0, Math.min(u, tailFrom));
    if (a <= 0.003 || u - t0 < 1e-4) { for (let i = 0; i < N; i++) { sh.tail[i]!.alpha = 0; sh.under[i]!.alpha = 0; } return; }
    for (let i = 0; i <= N; i++) {
      const q = t0 + ((u - t0) * i) / N, n = 1 - q;
      this.tx[i] = n * n * sh.x0 + 2 * n * q * sh.cx + q * q * sh.x1;
      this.ty[i] = n * n * sh.y0 + 2 * n * q * sh.cy + q * q * sh.y1;
    }
    for (let i = 0; i < N; i++) {
      const ax = this.tx[i]!, ay = this.ty[i]!, bx = this.tx[i + 1]!, by = this.ty[i + 1]!;
      const len = Math.hypot(bx - ax, by - ay), rot = Math.atan2(by - ay, bx - ax);
      const f = (i + 1) / N;
      const w = sh.tailPx * (0.18 + 0.82 * f * Math.sqrt(f));
      const line = sh.tail[i]!, soft = sh.under[i]!;
      line.position.set(ax, ay); line.rotation = rot; line.scale.set(Math.max(0.001, (len * 1.06) / LINE_W), w / LINE_H); line.alpha = a * (0.12 + 0.88 * f * f);
      soft.position.set((ax + bx) / 2, (ay + by) / 2); soft.rotation = rot; soft.scale.set(Math.max(0.001, (len * 1.7) / LIMB_W), (w * 2.6) / LIMB_H); soft.alpha = a * 0.3 * f;
    }
  }

  /** Paint the sky and the constellation for this frame. */
  frame(f: SkyFrame): void {
    if (this.destroyed || !this.ownOn) return;
    const { t } = f;
    const S = this.scale;
    const sky = clamp01(f.sky);
    const tw = this.look.twinkle;
    const fig = this.fig;
    const hush = clamp01(f.hush), swell = clamp01(f.swell), flare = clamp01(f.flare), fg = clamp01(f.fig);
    this.swellNow = swell;
    const shimmer = Number.isFinite(f.shimmerAt) && t >= f.shimmerAt;
    const jolting = shimmer && this.joltAmp > 0 && t - f.shimmerAt < 1500;
    if (this.veil) this.veil.alpha = Math.min(1, f.veil * sky * (1 + 0.16 * hush));
    if (this.haze) this.haze.alpha = 0.16 * sky * (1 - 0.5 * hush);
    // The held breath: every other star dims and leans a little toward the star that is charging (where it is now). The
    // nova instead draws every star of the sky INTO it.
    const gather = fig?.gather ? clamp01(f.gather) : 0;
    const ci = fig ? fig.charge : -1;
    const pkx = ci >= 0 ? (this.px[ci] ?? 0) : 0, pky = ci >= 0 ? (this.py[ci] ?? 0) : 0;
    const dimSky = fig?.gather ? 1 : 1 - this.look.hush * hush;
    const lean = ci >= 0 && !fig?.gather ? 0.045 * hush : 0;
    const move = jolting || lean > 0 || gather > 0 || this.skyMoved;
    for (const st of this.sky) {
      const appear = clamp01(sky * 2.4 - st.delay * 1.3);
      const b = this.wave(f, st.x, st.y);
      let a = st.a * appear * (1 - tw + tw * (0.5 + 0.5 * Math.sin(this.age * st.speed + st.phase))) * (1 + 1.6 * b) * dimSky;
      let x = st.x, y = st.y, sx = 1;
      if (gather > 0) {
        // The near stars go first; each one falls in faster and faster, stretched along its way, and goes out as it arrives.
        const g = clamp01(gather * 1.7 - st.delay * 0.7);
        const e = g * g * g;
        x += (pkx - x) * e; y += (pky - y) * e;
        sx = 1 + 5 * g * (1 - g) * 4 * (1 - e);
        a = Math.min(1, a * (1 + 1.5 * g)) * (1 - clamp01((g - 0.82) / 0.18));
        st.s.rotation = Math.atan2(pky - st.y, pkx - st.x);
      }
      st.s.alpha = Math.min(1, a);
      if (shimmer || gather > 0) st.s.scale.set(st.size * (1 + 0.6 * b) * sx, st.size * (1 + 0.6 * b));
      if (move) {
        if (lean > 0) { x += (pkx - x) * lean; y += (pky - y) * lean; }
        if (jolting) { this.jolt(f, x, y); x += this.jx; y += this.jy; }
        st.s.position.set(x, y);
      }
    }
    this.skyMoved = jolting || lean > 0 || gather > 0;
    if (!fig) return;
    const w = f.draw;
    const alive = clamp01(f.alive);
    const dimFig = (1 - 0.45 * this.look.hush * hush) * fg;
    // The wheel's turn, and where the shot's head is (the riders follow it; the wolf tips with the curve of its leap).
    const spinC = Math.cos(f.spin), spinS = Math.sin(f.spin), pv = fig.pivot;
    const sh = this.shot;
    let rx = 0, ry = 0, tiltC = 1, tiltS = 0;
    if (sh && f.ride > 0) {
      const u = clamp01(f.ride), m = 1 - u;
      rx = m * m * sh.x0 + 2 * m * u * sh.cx + u * u * sh.x1 - sh.x0;
      ry = m * m * sh.y0 + 2 * m * u * sh.cy + u * u * sh.y1 - sh.y0;
      if (fig.tilt) {
        const tu = Math.min(u, 0.999), tm = 1 - tu;
        const ang = Math.atan2(2 * tm * (sh.cy - sh.y0) + 2 * tu * (sh.y1 - sh.cy), 2 * tm * (sh.cx - sh.x0) + 2 * tu * (sh.x1 - sh.cx));
        let rel = ang - (fig.facing > 0 ? 0 : Math.PI);
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const tilt = Math.max(-0.75, Math.min(0.75, rel * 0.65)) * Math.min(1, u * 6);
        tiltC = Math.cos(tilt); tiltS = Math.sin(tilt);
      }
    }
    let lit = 0;
    for (let i = 0; i < this.starSprites.length; i++) {
      const st = fig.stars[i]!, sp = this.starSprites[i]!;
      const wd = st.ride > 0 && f.loosed ? 1 : w;
      let x = st.x + st.px * wd, y = st.y + st.py * wd;
      if (st.spin && pv) { const dx = x - pv.x, dy = y - pv.y; x = pv.x + dx * spinC - dy * spinS; y = pv.y + dx * spinS + dy * spinC; }
      if (st.ride > 0 && sh && f.ride > 0) {
        if (fig.tilt) { const dx = x - sh.x0, dy = y - sh.y0; x = sh.x0 + dx * tiltC - dy * tiltS; y = sh.y0 + dx * tiltS + dy * tiltC; }
        x += rx * st.ride; y += ry * st.ride;
      }
      // At full draw the moving stars tremble a hair (the bow is under strain).
      if (w > 0.96 && (st.px || st.py)) { x += Math.sin(this.age * 0.09 + i) * 0.7 * S; y += Math.cos(this.age * 0.11 + i * 2) * 0.7 * S; }
      if (jolting) { this.jolt(f, x, y); x += this.jx; y += this.jy; }
      this.px[i] = x; this.py[i] = y;
      const u = (t - this.litAt[i]!) / 150;
      const part = st.arrow || st.pluck ? f.arrow : dimFig;
      if (u <= 0 || part <= 0.002 || sky <= 0.002) { sp.glint.alpha = 0; sp.halo.alpha = 0; continue; }
      lit++;
      // It POPS as the line reaches it, then settles.
      const pop = u >= 1 ? 1 : (1 + 0.9 * (1 - u)) * clamp01(u * 4);
      const b = this.wave(f, x, y);
      const charging = i === fig.charge;
      const burn = charging ? f.pluck : 0;
      const grow = charging ? this.look.swell * (fig.gather ? 1.3 : 1) * swell * (1 + 0.06 * Math.sin(this.age * 0.04)) : 0;
      const flick = 1 + 0.06 * Math.sin(this.age * 0.006 + i * 1.7);
      const size = this.look.starPx * this.starK * S * st.size * pop * (1 + 0.3 * alive + 0.5 * b + 0.9 * burn + grow + 0.5 * flare) * flick;
      const a = Math.min(1, sky * part);
      sp.glint.position.set(x, y); sp.glint.scale.set(size / GLINT_PX); sp.glint.alpha = a;
      if (charging) sp.glint.rotation = this.age * 0.0012 * (1 + 4 * burn);
      sp.halo.position.set(x, y); sp.halo.scale.set((size * (1.5 + 0.9 * burn)) / GLOW_PX); sp.halo.alpha = a * Math.min(1, 0.32 + 0.22 * alive + 0.4 * b + 0.45 * burn + 0.4 * flare);
      if (charging) {
        const g = this.swellGlow, r = this.swellRays;
        // (The nova's heart is already huge: a smaller, fainter glow there, so its rays carry it.)
        const gk = fig.gather ? 0.55 : 1;
        if (g) { g.position.set(x, y); g.scale.set((size * (1.2 + 1.6 * swell * gk) * (fig.gather ? 0.8 : 1)) / GLOW_PX); g.alpha = a * Math.min(1, 1.1 * swell) * (fig.gather ? 0.55 : 1); }
        if (r) { r.position.set(x, y); r.scale.set((size * (fig.gather ? 0.9 : 0.66)) / GLINT_PX); r.rotation = Math.PI / 4 - this.age * 0.004; r.alpha = a * Math.min(1, 1.6 * swell); }
      }
    }
    this.lit = lit;
    if (this.swellGlow && ((ci >= 0 && (fig.stars[ci]!.pluck || fig.stars[ci]!.arrow) && f.arrow <= 0.002) || sky <= 0.002 || (f.loosed && swell <= 0))) { this.swellGlow.alpha = 0; if (this.swellRays) this.swellRays.alpha = 0; }
    // The glow that builds behind the figure as each star joins it (and flares with the blow).
    if (this.aura) this.aura.alpha = Math.min(0.6, (lit / Math.max(1, this.starSprites.length)) * (0.1 + 0.035 * this.look.tier) * (1 + 0.5 * alive + 2.2 * flare)) * sky * dimFig;
    let pen = 0, drawn = 0;
    const lineH = (this.look.lineWidth * this.lineK * S * (1 + 0.35 * alive + 0.9 * flare)) / LINE_H;
    for (let i = 0; i < this.lineSprites.length; i++) {
      const e = fig.edges[i]!, s = this.lineSprites[i]!;
      const prog = clamp01((t - this.edgeAt[i]!) / this.stepMs);
      const part = e.arrow ? f.arrow : dimFig;
      const limb = this.limbSprites[i];
      if (prog <= 0 || part <= 0.002 || sky <= 0.002) { s.alpha = 0; if (limb) limb.alpha = 0; continue; }
      const ax = this.px[e.a]!, ay = this.py[e.a]!, bx = this.px[e.b]!, by = this.py[e.b]!;
      const len = Math.hypot(bx - ax, by - ay);
      const rot = Math.atan2(by - ay, bx - ax);
      s.position.set(ax, ay); s.rotation = rot; s.scale.set(Math.max(0.001, (len * prog) / LINE_W), lineH);
      s.alpha = Math.min(1, (0.66 + 0.04 * this.look.tier + 0.3 * alive + 0.5 * flare + 0.3 * this.wave(f, (ax + bx) / 2, (ay + by) / 2)) * sky * part * (e.soft ? 0.5 * (this.portrait ? 1 - 0.6 * clamp01(f.ghost) * (1 - flare) : 1) : 1));
      if (prog >= 1) drawn++;
      else if (pen < this.pens.length) {
        // The pen: a bright point riding the tip of the line as it is drawn.
        const p = this.pens[pen++]!;
        p.position.set(ax + (bx - ax) * prog, ay + (by - ay) * prog);
        p.scale.set((this.look.starPx * this.starK * 0.7 * S) / GLINT_PX); p.rotation = this.age * 0.01; p.alpha = sky;
      }
      if (limb) {
        const g = clamp01(f.ghost) * this.look.ghostAlpha * sky;
        limb.position.set((ax + bx) / 2, (ay + by) / 2); limb.rotation = rot;
        limb.scale.set((len * 1.28) / LIMB_W, (fig.unit * 0.085) / LIMB_H); limb.alpha = prog >= 1 ? g : 0;
      }
    }
    for (let i = pen; i < this.pens.length; i++) this.pens[i]!.alpha = 0;
    this.drawn = drawn;
    // Tier 3's ghost head and torso.
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
    if (this.disc) this.disc.alpha = 0.2 * clamp01(f.ghost) * sky * dimFig;
    if (this.portrait) this.portrait.alpha = Math.min(1, clamp01(f.ghost) * this.look.portraitAlpha * sky * dimFig * (1 + 0.5 * this.wave(f, this.portrait.x, this.portrait.y) + 0.8 * flare));
  }

  /** The shimmer: a wave of brightness running outward from the blow through every star (0 before the blow). */
  private wave(f: SkyFrame, x: number, y: number): number {
    if (!(f.t >= f.shimmerAt)) return 0;
    const u = (f.t - f.shimmerAt - Math.hypot(x - f.shimmerX, y - f.shimmerY) * 0.3) / 300;
    return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u);
  }

  /**
   * The JOLT: the blow shoves every star away from itself and they spring back (into `jx`, `jy`). The shove travels
   * outward with the shimmer and weakens with distance.
   */
  private jolt(f: SkyFrame, x: number, y: number): void {
    const dx = x - f.shimmerX, dy = y - f.shimmerY;
    const d = Math.hypot(dx, dy) || 1;
    const ms = f.t - f.shimmerAt - d * 0.3;
    if (ms <= 0 || ms > 900) { this.jx = 0; this.jy = 0; return; }
    const amp = this.joltAmp * Math.exp(-d / this.joltReach) * Math.min(1, ms / 30) * Math.exp(-ms / 170) * Math.cos(2 * Math.PI * 4.5 * (ms / 1000));
    this.jx = (dx / d) * amp; this.jy = (dy / d) * amp;
  }

  /** A star lights: a small ring opens round it. */
  starPop(i: number): void {
    const st = this.fig?.stars[i];
    if (!st) return;
    const r = this.look.starPx * this.starK * st.size * this.scale;
    this.spawn('glow', this.tex.halo, this.colors.line, st.x, st.y, { dur: 320, from: this.k(r * 0.2, RING_PX), to: this.k(r * 1.7, RING_PX), a0: 0.6, ease: 'cubic' });
  }

  /** The figure is whole: it comes alive (a soft breath of light through it). */
  comeAlive(): void {
    const f = this.fig;
    if (!f) return;
    const tall = f.kind === 'hunter' || f.kind === 'serpent' ? 1 : f.kind === 'giant' ? 0.6 : 0;
    const k0 = tall ? 0.9 * tall : f.kind === 'wolf' ? 1.6 : 2.2, k1 = tall ? 1.4 * tall : f.kind === 'wolf' ? 2.6 : 3.4;
    this.spawn('glow', this.tex.glow, this.colors.line, f.centre.x, f.centre.y, { dur: 560, from: this.k(f.unit * k0, GLOW_PX), to: this.k(f.unit * k1, GLOW_PX), a0: 0.2 + 0.04 * this.look.tier, mode: 'punch', peakAt: 0.3, ease: 'linear' });
  }

  /** Tier 4: the star is taken: a ring closes on it. */
  plucked(at: Pt, radius: number): void {
    this.spawn('glow', this.tex.halo, this.colors.gold, at.x, at.y, { dur: 340, from: this.k(radius * 1.9, RING_PX), to: this.k(radius * 0.25, RING_PX), a0: 0.8, mode: 'punch', peakAt: 0.7, ease: 'cubic' });
  }

  /** Tier 4: the star starts to swell: a second, wider ring closes on it. */
  swelling(at: Pt, radius: number): void {
    this.spawn('glow', this.tex.halo, this.colors.star, at.x, at.y, { dur: 520, from: this.k(radius * 3.4, RING_PX), to: this.k(radius * 0.3, RING_PX), a0: 0.5, mode: 'punch', peakAt: 0.75, ease: 'cubic' });
  }

  /** The shot leaves: a flash, a ring and a puff of points where it was (bigger with the tier). */
  loosed(at: Pt, angle: number, radius: number): void {
    const c = this.colors;
    const T = this.look.tier;
    const X = 0.7 + 0.3 * T;
    this.spawn('glow', this.tex.halo, c.star, at.x, at.y, { dur: 260 + 40 * T, from: this.k(radius * 0.15, RING_PX), to: this.k(radius * 0.8 * X, RING_PX), a0: 0.5, ease: 'cubic' });
    this.spawn('core', this.tex.glow, c.star, at.x, at.y, { dur: 200 + 30 * T, from: this.k(radius * 0.5 * X, GLOW_PX), to: this.k(radius * 1.3 * X, GLOW_PX), a0: 0.55, mode: 'punch', peakAt: 0.15 });
    this.burst('core', this.tex.dot, [c.star, c.gold], at.x, at.y, 4 + 4 * T, { speed: 150 * X, dir: angle + Math.PI, spread: 1.8, life: 460, size: 0.38, drag: 0.3, to: 0.2 });
    if (T < 4) return;
    // Tier 4: the swollen star lets go: its rays flash wide and a ring of motes is thrown off.
    this.spawn('core', this.tex.glint, 0xffffff, at.x, at.y, { dur: 300, from: this.k(radius * 2.2, GLINT_PX), to: this.k(radius * 4.4, GLINT_PX), a0: 0.9, mode: 'punch', peakAt: 0.15, ease: 'cubic' });
    this.spawn('glow', this.tex.halo, c.gold, at.x, at.y, { dur: 520, from: this.k(radius * 0.6, RING_PX), to: this.k(radius * 3.2, RING_PX), a0: 0.6, ease: 'cubic' });
    this.burst('core', this.tex.dot, [c.star, c.gold, c.line], at.x, at.y, 18, { speed: 380, life: 620, size: 0.42, drag: 0.08, to: 0.2 });
  }

  /**
   * THE BLOW: a NOVA of stardust (glints and points thrown every way, fast and then hanging in the air), a flash over
   * the whole sky (`flash`: its peak opacity), a hot flash and long rays at the hit, rings, and the jolt through the
   * stars. Everything scales with the tier. Tier 4 adds its even ring of stardust, a second wave and a cloud that hangs.
   */
  impact(at: Pt, dir: Pt, radius: number, tier: number, flash = 0): void {
    const c = this.colors;
    const X = this.look.impactSize * (0.9 + 0.2 * tier);
    const R = radius * X;
    this.joltAmp = radius * (0.1 + 0.1 * tier);
    this.joltReach = radius * (2.5 + 1.5 * tier);
    const ar = this.area;
    if (flash > 0 && ar) {
      const kx = (ar.w * 1.5) / VEIL_W / this.scale;
      this.spawn('core', this.tex.veil, mixColor(c.line, 0xffffff, 0.55), ar.x + ar.w / 2, ar.y + ar.h / 2, { dur: 240 + 120 * tier, from: kx, to: kx, sy: ((ar.h * 1.5) / VEIL_H) / ((ar.w * 1.5) / VEIL_W), a0: Math.min(1, flash), mode: 'punch', peakAt: 0.07, ease: 'linear' });
    }
    this.spawn('core', this.tex.glow, c.star, at.x, at.y, { dur: 260 + 60 * tier, from: this.k(R * 1.2, GLOW_PX), to: this.k(R * (2.8 + 0.7 * tier), GLOW_PX), a0: 0.85, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.glint, 0xffffff, at.x, at.y, { dur: 340 + 90 * tier, from: this.k(R * 1.4, GLINT_PX), to: this.k(R * (3.4 + 1.3 * tier), GLINT_PX), a0: 1, mode: 'punch', peakAt: 0.12, ease: 'cubic' });
    if (tier >= 2) this.spawn('core', this.tex.glint, c.gold, at.x, at.y, { dur: 300 + 80 * tier, from: this.k(R, GLINT_PX), to: this.k(R * (2 + 0.8 * tier), GLINT_PX), a0: 0.8, mode: 'punch', peakAt: 0.14, ease: 'cubic', rot: Math.PI / 4 });
    for (let i = 0; i < Math.min(3, tier); i++) this.spawn('glow', this.tex.halo, i % 2 ? c.gold : c.line, at.x, at.y, { dur: 480 + 150 * i, from: this.k(R * 0.6, RING_PX), to: this.k(R * (3 + 1.4 * i), RING_PX), a0: 0.8 - 0.15 * i, ease: 'cubic', delay: 60 * i });
    const back = Math.atan2(-dir.y, -dir.x);
    this.burst('core', this.tex.glint, [c.star, c.gold, 0xffffff], at.x, at.y, 5 + 3 * tier, { speed: 520 * X, dir: back, spread: 2.6, life: 560, size: 0.22 * X, drag: 0.2, spin: 0.012, to: 0.2 });
    // The nova: thrown hard, stopped by the air within a third of a second, then hanging and sinking a little.
    const v = (620 + 140 * tier) * X;
    this.burst('core', this.tex.glint, [c.star, c.gold, 0xffffff], at.x, at.y, 10 + 8 * tier, { speed: v, life: 700 + 260 * tier, size: 0.2 * X, drag: 0.012, spin: 0.01, grav: 30, to: 0.3 });
    this.burst('core', this.tex.dot, [c.star, c.gold, c.line], at.x, at.y, 16 + 12 * tier, { speed: v * 0.8, life: 900 + 300 * tier, size: 0.45 * X, drag: 0.02, grav: 50, to: 0.3 });
    this.spawn('glow', this.tex.glow, mixColor(c.line, c.star, 0.4), at.x, at.y, { dur: 900 + 300 * tier, from: this.k(R * 1.6, GLOW_PX), to: this.k(R * (3 + tier), GLOW_PX), a0: 0.2 + 0.05 * tier, mode: 'punch', peakAt: 0.15 });
    if (tier < 4) return;
    // The ring of stardust: an even ring of glints flying outward together, and a slower ring of points inside it.
    const N = 30;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.12;
      const sz = (i % 2 ? 0.22 : 0.34) * X;
      this.spawn('core', this.tex.glint, i % 3 === 0 ? c.gold : c.star, at.x + Math.cos(a) * R * 0.5, at.y + Math.sin(a) * R * 0.5, {
        dur: 1100, from: sz, to: sz * 0.35, a0: 1, ease: 'linear', vx: Math.cos(a) * 760 * X, vy: Math.sin(a) * 760 * X, drag: 0.1, spin: 0.006,
      });
      this.spawn('core', this.tex.dot, c.line, at.x + Math.cos(a + 0.12) * R * 0.4, at.y + Math.sin(a + 0.12) * R * 0.4, {
        dur: 1300, from: 0.55 * X, to: 0.2 * X, a0: 0.9, ease: 'linear', vx: Math.cos(a + 0.12) * 400 * X, vy: Math.sin(a + 0.12) * 400 * X, drag: 0.12,
      });
    }
    this.spawn('glow', this.tex.glow, mixColor(c.line, c.star, 0.5), at.x, at.y, { dur: 760, from: this.k(R * 2, GLOW_PX), to: this.k(R * 8, GLOW_PX), a0: 0.5, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.halo, c.star, at.x, at.y, { dur: 1100, from: this.k(R, RING_PX), to: this.k(R * 9, RING_PX), a0: 0.4, ease: 'cubic', delay: 160 });
  }

  /**
   * Tier 4's aftermath: the constellation's lines break up. Every drawn line sheds points of light along its length and
   * every star a glint; they drift, sink and go out over about `lifeMs`. (The runner fades the lines themselves.)
   */
  scatter(lifeMs: number): void {
    const fig = this.fig;
    if (!fig || this.destroyed) return;
    const c = this.colors;
    const tints = [c.line, c.star, c.gold];
    for (let i = 0; i < this.lineSprites.length; i++) {
      const e = fig.edges[i]!;
      if (e.arrow || this.lineSprites[i]!.alpha <= 0.01) continue;
      const ax = this.px[e.a]!, ay = this.py[e.a]!, bx = this.px[e.b]!, by = this.py[e.b]!;
      const n = e.soft ? 2 : 4;
      for (let j = 0; j < n; j++) {
        const q = (j + 0.2 + this.rnd() * 0.6) / n;
        const sz = 0.34 + this.rnd() * 0.3;
        this.spawn('core', this.tex.dot, tints[(i + j) % 3]!, ax + (bx - ax) * q, ay + (by - ay) * q, {
          dur: lifeMs * (0.6 + this.rnd() * 0.7), from: sz, to: sz * 0.3, a0: 0.95, ease: 'linear', vx: (this.rnd() - 0.5) * 110, vy: -30 + this.rnd() * 100, drag: 0.5, grav: 170,
        });
      }
    }
    for (let i = 0; i < this.starSprites.length; i++) {
      const st = fig.stars[i]!;
      if (st.arrow || st.pluck || this.starSprites[i]!.glint.alpha <= 0.01) continue;
      const sz = this.k(this.look.starPx * this.starK * st.size * this.scale * 1.1, GLINT_PX);
      this.spawn('core', this.tex.glint, i % 3 === 0 ? c.gold : c.star, this.px[i]!, this.py[i]!, {
        dur: lifeMs * (0.8 + this.rnd() * 0.5), from: sz, to: sz * 0.3, a0: 1, ease: 'linear', vx: (this.rnd() - 0.5) * 60, vy: 10 + this.rnd() * 60, drag: 0.6, grav: 150, spin: (this.rnd() - 0.5) * 0.008,
      });
    }
  }

  /**
   * The wheel's BEAM from `from` to `to`, `width` px wide: a white-hot core over a wide soft glow, both stretched along
   * the line at once and fading over `dur`, with a burst of sparks running down it.
   */
  beam(from: Pt, to: Pt, width: number, dur: number): void {
    const c = this.colors;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len < 1) return;
    const rot = Math.atan2(to.y - from.y, to.x - from.x);
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const layer = (tex: Texture, tw: number, th: number, w: number, tint: number, a0: number, d: number): void => {
      const kx = len / tw / this.scale;
      this.spawn('core', tex, tint, mx, my, { dur: d, from: kx, to: kx, sy: (w / th) / (len / tw), a0, mode: 'punch', peakAt: 0.06, ease: 'linear', rot });
    };
    layer(this.tex.limb, LIMB_W, LIMB_H, width * 2.6, mixColor(c.line, c.gold, 0.4), 0.55, dur * 1.2);
    layer(this.tex.line, LINE_W, LINE_H, width, mixColor(c.gold, c.star, 0.6), 0.95, dur);
    layer(this.tex.line, LINE_W, LINE_H, width * 0.35, 0xffffff, 1, dur * 0.8);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const q = (i + this.rnd()) / n;
      const v = 200 + this.rnd() * 260;
      this.spawn('core', this.rnd() < 0.3 ? this.tex.glint : this.tex.dot, i % 2 ? c.star : c.gold, from.x + (to.x - from.x) * q, from.y + (to.y - from.y) * q, {
        dur: 380 + this.rnd() * 300, from: 0.45, to: 0.1, a0: 1, ease: 'linear', vx: Math.cos(rot) * v + (this.rnd() - 0.5) * 120, vy: Math.sin(rot) * v + (this.rnd() - 0.5) * 120, drag: 0.3, delay: q * 120,
      });
    }
  }

  /**
   * The nova's explosion, over the usual blow: the sky it swallowed is thrown back out (long glints flying to every
   * edge of the sky and slowing there), a white core that blooms wide and two slow rings.
   */
  novaBurst(at: Pt, radius: number): void {
    const c = this.colors;
    const X = this.look.impactSize;
    const R = radius * X;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 520, from: this.k(R * 1.5, GLOW_PX), to: this.k(R * 5, GLOW_PX), a0: 0.7, mode: 'punch', peakAt: 0.08 });
    this.spawn('core', this.tex.glint, mixColor(c.star, c.gold, 0.4), at.x, at.y, { dur: 700, from: this.k(R * 3, GLINT_PX), to: this.k(R * 11, GLINT_PX), a0: 0.9, mode: 'punch', peakAt: 0.1, ease: 'cubic', rot: Math.PI / 8 });
    for (let i = 0; i < 2; i++) this.spawn('glow', this.tex.halo, i ? c.gold : c.star, at.x, at.y, { dur: 1300 + 300 * i, from: this.k(R * 0.8, RING_PX), to: this.k(R * (12 + 4 * i), RING_PX), a0: 0.55, ease: 'cubic', delay: 90 + 140 * i });
    const N = 44;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + this.rnd() * 0.12;
      const v = (900 + this.rnd() * 900) * X;
      this.spawn('core', i % 4 ? this.tex.dot : this.tex.glint, i % 3 === 0 ? c.gold : i % 3 === 1 ? c.star : c.line, at.x, at.y, {
        dur: 1100 + this.rnd() * 600, from: (i % 4 ? 0.7 : 0.3) * X, to: 0.15 * X, a0: 1, ease: 'linear', vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.06, spin: 0.008,
      });
    }
  }

  /** THE KNOCKOUT's remix of Tier 4: the ring of stardust goes prismatic (cyan, lilac, magenta) with three soft rings. */
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
    this.swellNow = 0;
    if (this.veil) this.veil.alpha = 0;
    if (this.haze) this.haze.alpha = 0;
    for (const st of this.sky) st.s.alpha = 0;
    for (const sp of this.starSprites) { sp.glint.alpha = 0; sp.halo.alpha = 0; }
    for (const s of this.lineSprites) s.alpha = 0;
    for (const s of this.limbSprites) if (s) s.alpha = 0;
    for (const s of this.bodySprites) s.alpha = 0;
    for (const s of this.pens) s.alpha = 0;
    for (const s of [this.portrait, this.disc, this.aura, this.swellGlow, this.swellRays]) if (s) s.alpha = 0;
    const sh = this.shot;
    if (sh) { sh.on = false; for (const s of [sh.body, sh.glint, sh.glow, sh.core, ...sh.tail, ...sh.under]) s.alpha = 0; }
    this.lit = 0; this.drawn = 0;
  }

  protected override tick(dt: number): boolean {
    this.age += dt;
    const c = this.colors;
    const S = this.scale;
    // Stardust shed along the shot's path (the comet sheds more, and bigger).
    const sh = this.shot;
    if (sh?.on) {
      sh.acc = Math.min(sh.acc + dt, 80);
      const comet = sh.lead === 'comet', spark = sh.lead === 'spark';
      const every = comet ? 11 : spark ? 16 : 26 - 3 * this.look.tier;
      while (sh.acc >= every) {
        sh.acc -= every;
        const j = comet ? sh.headPx * 0.16 : spark ? sh.headPx * 0.35 : sh.tailPx * 0.8;
        this.spawn('core', this.rnd() < 0.2 ? this.tex.glint : this.tex.dot, this.rnd() < 0.5 ? c.star : c.gold, sh.x + (this.rnd() - 0.5) * j, sh.y + (this.rnd() - 0.5) * j, {
          dur: comet ? 700 + this.rnd() * 500 : spark ? 520 : 380, from: comet ? 0.5 + this.rnd() * 0.4 : spark ? 0.44 : 0.36, to: 0.08, a0: 0.9, ease: 'linear', vx: (this.rnd() - 0.5) * 70, vy: (this.rnd() - 0.5) * 70 + (comet ? 40 : 0), drag: 0.5, grav: comet || spark ? 60 : 0,
        });
      }
    }
    // Tier 4's held breath: motes of light stream INTO the charging star (where it is now), faster and thicker as it grows.
    const ci = this.fig ? this.fig.charge : -1;
    if (ci >= 0 && this.swellNow > 0.02) {
      const pkX = this.px[ci] ?? 0, pkY = this.py[ci] ?? 0;
      this.swellAcc = Math.min(this.swellAcc + dt, 80);
      const every = 46 - 30 * this.swellNow;
      while (this.swellAcc >= every) {
        this.swellAcc -= every;
        const a = this.rnd() * Math.PI * 2, d = this.look.starPx * (3 + this.rnd() * 5) * S, ms = 300 + this.rnd() * 160;
        // Speeds are px/s at stage scale 1 (the pool multiplies by the stage scale), so divide it back out.
        this.spawn('core', this.tex.dot, this.rnd() < 0.5 ? c.star : c.gold, pkX + Math.cos(a) * d, pkY + Math.sin(a) * d, {
          dur: ms, from: 0.2, to: 0.5, a0: 0.9, mode: 'punch', peakAt: 0.6, ease: 'linear', vx: (-Math.cos(a) * d) / (ms / 1000) / S, vy: (-Math.sin(a) * d) / (ms / 1000) / S,
        });
      }
    }
    return this.ownOn;
  }

  protected override clearOwn(): void {
    const all: (Sprite | null)[] = [this.veil, this.haze, this.portrait, this.disc, this.aura, this.swellGlow, this.swellRays, ...this.sky.map((s) => s.s), ...this.lineSprites, ...this.limbSprites, ...this.bodySprites, ...this.pens];
    for (const sp of this.starSprites) all.push(sp.glint, sp.halo);
    const sh = this.shot;
    if (sh) all.push(sh.body, sh.glint, sh.glow, sh.core, ...sh.tail, ...sh.under);
    for (const s of all) if (s) { s.visible = true; this.give(s); }
    this.veil = this.haze = this.portrait = this.disc = this.aura = this.swellGlow = this.swellRays = null;
    this.sky = []; this.lineSprites = []; this.limbSprites = []; this.bodySprites = []; this.pens = []; this.starSprites = [];
    this.shot = null; this.fig = null; this.area = null; this.ownOn = false; this.lit = 0; this.drawn = 0; this.swellNow = 0; this.joltAmp = 0;
  }
}
