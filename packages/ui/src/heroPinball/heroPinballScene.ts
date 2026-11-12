/**
 * THE PINBALL SCENE: what the Pinball attack ("Multiball") draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroPinball.ts` mounts `root` on the
 * above-portrait overlay and writes every own object from the pure state in `heroPinballConfig.ts`.
 *
 * OWN OBJECTS (made once, placed by `placeTable`, written by the runner every frame, hidden the moment they are not
 * needed and on every exit): the FLIPPER, up to three steel BALLS (each with a shadow and a comet tail), the three pop
 * BUMPERS (an unlit and a lit face), the ring of LAMPS round the target, the lane's insert ARROWS, the wire RAMP (a
 * chain of rail ties in one container, lit entry first) and the dot-matrix DISPLAY (the glass, a word, the score reels).
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the flipper's thwack, a bumper's ring, sparks and "+10", the ramp's
 * glints, the multiball split, the impact (a flash, rings, a starburst; on the jackpot, spokes of light) and the
 * jackpot's flare on the display.
 *
 * THE TILT (IV) turns this scene's own root about the target, and nothing else: the game's DOM is never rotated (the
 * runner turns the two portraits by the same angle with their own transforms).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import {
  BUMPERS, DISPLAY_ASPECT, MAX_BALLS, PINBALL_CAPS, type BallState, type BumperState, type DisplayState, type DisplayWord, type PinballGeo,
} from './heroPinballConfig';

export interface HeroPinballTextures extends HeroArcanaTextures {
  ball: Texture;
  shadow: Texture;
  trail: Texture;
  flipper: Texture;
  bumper: Texture;
  bumperLit: Texture;
  lamps: Texture;
  lampsLit: Texture;
  arrow: Texture;
  arrowLit: Texture;
  rail: Texture;
  panel: Texture;
  wordMultiball: Texture;
  wordTilt: Texture;
  wordJackpot: Texture;
  digit0: Texture; digit1: Texture; digit2: Texture; digit3: Texture; digit4: Texture;
  digit5: Texture; digit6: Texture; digit7: Texture; digit8: Texture; digit9: Texture;
  plus10: Texture;
  plus50: Texture;
}

export interface PinballColors { flash: number; lamp: number; spark: number; side: number }

/** Hard cap on pooled sprites alive at once (a jackpot peaks near 120). The own objects are outside the pool. */
export const MAX_PINBALL_SPRITES = 260;
// Texture sizes (the painters' constants, repeated here so the scene never imports the canvas module).
const RING_PX = 160;
const GLOW_PX = 128;
const BALL_PX = 128;
const SHADOW_PX = 64;
const TRAIL_W = 128;
const FLIPPER_W = 304;
const FLIPPER_PIVOT = 56 / FLIPPER_W;
const FLIPPER_LEN = 228;
const BUMPER_BODY = 76;
const LAMPS_R = 136;
const LAMPS_N = 12;
const ARROW_PX = 96;
const RAIL_W = 48;
const RAIL_GAUGE = 76;
const PANEL_W = 512;
const GLYPH_H = 70;
const GLYPH_W = 50;
const SCORE_W = 128;
/** The lamp ring's radius, in target radii. */
export const LAMP_RING = 1.3;

export class HeroPinballScene extends FxPool {
  private readonly flipper: Sprite;
  private readonly balls: Sprite[] = [];
  private readonly shadows: Sprite[] = [];
  private readonly trails: Sprite[] = [];
  private readonly bumpers: Sprite[] = [];
  private readonly lamps: Sprite;
  private readonly arrows: Sprite[] = [];
  private readonly rampBox = new Container();
  private readonly rails: Sprite[] = [];
  private readonly rampGlow: Sprite;
  private readonly panel: Sprite;
  private readonly word: Sprite;
  private readonly digits: Sprite[] = [];
  private readonly digitTex: Texture[];
  private readonly all: Sprite[] = [];
  private own = false;
  private geo: PinballGeo | null = null;
  private railN = 0;
  private camX = 0;
  private camY = 0;
  private camZ = 1;
  private tilt = 0;
  private tiltX = 0;
  private tiltY = 0;

  /** `aR` / `dR`: the striking and struck portraits' radii (screen px). */
  constructor(
    private readonly tex: HeroPinballTextures, private readonly colors: PinballColors, private readonly scoreSize: number,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1,
  ) {
    super('heroPinball', [
      tex.glow, tex.ring, tex.star, tex.spark, tex.ball, tex.trail, tex.flipper, tex.bumper, tex.bumperLit, tex.lamps, tex.lampsLit, tex.arrow, tex.arrowLit,
      tex.rail, tex.panel, tex.wordMultiball, tex.wordTilt, tex.wordJackpot, tex.digit0, tex.plus10, tex.plus50,
    ], scale, seed, MAX_PINBALL_SPRITES);
    this.digitTex = [tex.digit0, tex.digit1, tex.digit2, tex.digit3, tex.digit4, tex.digit5, tex.digit6, tex.digit7, tex.digit8, tex.digit9];
    const mk = (parent: Container, t: Texture, ax = 0.5, ay = 0.5, add = false): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.visible = false; s.eventMode = 'none';
      if (add) s.blendMode = 'add';
      parent.addChild(s);
      this.all.push(s);
      return s;
    };
    const { under, glow, body } = this.layers;
    // Bottom to top: the lane arrows, the target's lamps, the ramp, the shadows | the tails | bumpers, flipper, balls, display.
    for (let i = 0; i < PINBALL_CAPS.arrows; i++) this.arrows.push(mk(under, tex.arrow));
    this.lamps = mk(under, tex.lamps);
    this.rampBox.visible = false; this.rampBox.eventMode = 'none';
    under.addChild(this.rampBox);
    for (let i = 0; i < PINBALL_CAPS.rampPts; i++) this.rails.push(mk(this.rampBox, tex.rail));
    for (let i = 0; i < MAX_BALLS; i++) { const s = mk(under, tex.shadow); s.tint = 0x000000; this.shadows.push(s); }
    this.rampGlow = mk(glow, tex.glow, 0.5, 0.5, true); this.rampGlow.tint = colors.lamp;
    for (let i = 0; i < MAX_BALLS; i++) { const s = mk(glow, tex.trail, 1, 0.5, true); s.tint = colors.spark; this.trails.push(s); }
    for (let i = 0; i < BUMPERS; i++) this.bumpers.push(mk(body, tex.bumper));
    this.flipper = mk(body, tex.flipper, FLIPPER_PIVOT, 0.5);
    for (let i = 0; i < MAX_BALLS; i++) this.balls.push(mk(body, tex.ball));
    this.panel = mk(body, tex.panel);
    this.word = mk(body, tex.wordJackpot);
    for (let i = 0; i < PINBALL_CAPS.cells; i++) this.digits.push(mk(body, tex.digit0));
  }

  /** Whether any own object still draws. */
  get ownVisible(): boolean { return this.own; }
  /** The scene root's turn (radians): IV's tilt. 0 at rest. */
  get tiltRad(): number { return this.tilt; }

  // ── the camera mirror and the tilt (one root transform) ───────────────────────────────────────────────────────

  override setCamera(ax: number, ay: number, z: number): void {
    this.camX = ax; this.camY = ay; this.camZ = z;
    this.applyRoot();
  }

  /** Turn the whole scene by `rad` about `at` (the target). 0 puts the root back exactly. */
  setTilt(rad: number, at: Pt): void {
    this.tilt = Number.isFinite(rad) ? rad : 0; this.tiltX = at.x; this.tiltY = at.y;
    this.applyRoot();
  }

  private applyRoot(): void {
    if (this.destroyed) return;
    const r = this.root, z = this.camZ;
    r.scale.set(z);
    if (Math.abs(this.tilt) < 1e-6) { r.pivot.set(0, 0); r.rotation = 0; r.position.set(this.camX, this.camY); return; }
    r.pivot.set(this.tiltX, this.tiltY);
    r.rotation = this.tilt;
    r.position.set(this.camX + z * this.tiltX, this.camY + z * this.tiltY);
  }

  // ── own objects (the runner writes them every frame) ──────────────────────────────────────────────────────────

  /** Lay the table out once: what never moves (the ramp's rails, the arrows, the lamps, the display). */
  placeTable(g: PinballGeo): void {
    if (this.destroyed) return;
    this.geo = g;
    const r = g.ramp;
    this.railN = Math.min(r.n, this.rails.length);
    const sy = (g.ballR * 2.5) / RAIL_GAUGE, sx = (r.spacing * 1.02) / RAIL_W;
    for (let i = 0; i < this.railN; i++) {
      const s = this.rails[i]!;
      s.position.set(r.xs[i]!, r.ys[i]!); s.rotation = r.rot[i]!; s.scale.set(sx, sy);
    }
    const ak = (this.aR * 0.78) / ARROW_PX;
    this.arrows.forEach((s, j) => { const p = g.arrows[j]; if (p) { s.position.set(p.x, p.y); s.rotation = g.arrowRot; s.scale.set(ak); } });
    this.lamps.position.set(g.hit.x, g.hit.y);
    this.panel.position.set(g.display.x, g.display.y);
  }

  /** The flipper at `angle`, popped up by `k` (0 hides it). */
  setFlipper(angle: number, k: number): void {
    const s = this.flipper, g = this.geo;
    if (this.destroyed || !g) return;
    s.visible = k > 0.002;
    if (!s.visible) return;
    s.position.set(g.pivot.x, g.pivot.y);
    s.rotation = angle;
    s.scale.set((g.batLen / FLIPPER_LEN) * k);
    s.alpha = Math.min(1, k * 1.6);
  }

  /** Ball `i`, its shadow and its tail (the tail stretches with the speed, px per ms). */
  setBall(i: number, b: BallState): void {
    const s = this.balls[i], sh = this.shadows[i], tr = this.trails[i], g = this.geo;
    if (this.destroyed || !s || !sh || !tr || !g) return;
    const show = b.visible && b.scale > 0.002;
    s.visible = show; sh.visible = show;
    if (!show) { tr.visible = false; return; }
    const d = g.ballR * 2 * b.scale;
    s.position.set(b.x, b.y); s.scale.set(d / BALL_PX);
    sh.position.set(b.x + g.ballR * 0.22, b.y + g.ballR * 0.34); sh.scale.set((d * 1.25) / SHADOW_PX); sh.alpha = 0.42;
    const sp = Math.hypot(b.vx, b.vy);
    tr.visible = sp > 0.25;
    if (tr.visible) {
      const len = Math.min(g.ballR * 11, sp * 85);
      tr.position.set(b.x, b.y); tr.rotation = Math.atan2(b.vy, b.vx);
      tr.scale.set(len / TRAIL_W, (d * 0.95) / 32);
      tr.alpha = Math.min(0.75, sp * 0.45);
    }
  }

  /** Bumper `i`. */
  setBumper(i: number, st: BumperState): void {
    const s = this.bumpers[i], g = this.geo;
    if (this.destroyed || !s || !g) return;
    s.visible = st.alpha > 0.004 && st.scale > 0.002;
    if (!s.visible) return;
    s.texture = st.lit ? this.tex.bumperLit : this.tex.bumper;
    s.position.set(st.x, st.y); s.scale.set((g.bumperR / BUMPER_BODY) * st.scale); s.alpha = st.alpha;
  }

  /** The target's lamps: popped up by `k`, lit or not, turned to marquee step `step`. */
  setLamps(k: number, lit: boolean, step: number): void {
    const s = this.lamps;
    if (this.destroyed) return;
    s.visible = k > 0.002;
    if (!s.visible) return;
    s.texture = lit ? this.tex.lampsLit : this.tex.lamps;
    s.rotation = (step % LAMPS_N) * ((Math.PI * 2) / LAMPS_N);
    s.scale.set(((this.dR * LAMP_RING) / LAMPS_R) * (0.7 + 0.3 * k)); s.alpha = Math.min(1, k * 1.4) * (lit ? 1 : 0.85);
  }

  /** Lane arrow `j`: popped up by `k`, lit or not. */
  setArrow(j: number, k: number, lit: boolean): void {
    const s = this.arrows[j], g = this.geo;
    if (this.destroyed || !s || !g) return;
    s.visible = k > 0.002 && j < g.arrows.length;
    if (!s.visible) return;
    s.texture = lit ? this.tex.arrowLit : this.tex.arrow;
    s.alpha = Math.min(1, k * 1.4) * (lit ? 1 : 0.8);
  }

  /** The ramp: `reveal` (0..1) of its rails showing, entry first, at `alpha`. A glow rides the leading rail as it lights. */
  setRamp(reveal: number, alpha: number): void {
    const g = this.geo;
    if (this.destroyed || !g) return;
    const show = alpha > 0.004 && reveal > 0;
    this.rampBox.visible = show;
    if (!show) { this.rampGlow.visible = false; return; }
    this.rampBox.alpha = alpha;
    const upTo = Math.ceil(reveal * this.railN);
    for (let i = 0; i < this.rails.length; i++) this.rails[i]!.visible = i < upTo && i < this.railN;
    const head = Math.min(this.railN - 1, upTo);
    this.rampGlow.visible = reveal < 1 && head >= 0;
    if (this.rampGlow.visible) {
      this.rampGlow.position.set(g.ramp.xs[head]!, g.ramp.ys[head]!);
      this.rampGlow.scale.set((g.ballR * 7) / GLOW_PX); this.rampGlow.alpha = 0.7;
    }
  }

  /** The dot-matrix display: its word, and (the jackpot) the reels' digits, leftmost first. */
  setDisplay(st: DisplayState, digits: readonly number[] | null): void {
    const g = this.geo;
    if (this.destroyed || !g) return;
    const show = st.alpha > 0.004 && st.scale > 0.002;
    this.panel.visible = show;
    if (!show) { this.word.visible = false; for (const d of this.digits) d.visible = false; return; }
    const W = g.displayW * st.scale, H = W * DISPLAY_ASPECT;
    this.panel.scale.set(W / PANEL_W); this.panel.alpha = st.alpha;
    const w = this.word;
    w.visible = !!st.word && st.wordOn;
    if (w.visible) {
      const t = this.wordTex(st.word!);
      w.texture = t;
      const k = st.score ? (H * 0.2) / GLYPH_H : Math.min((W * 0.84) / t.width, (H * 0.46) / GLYPH_H);
      w.scale.set(k); w.alpha = st.alpha;
      w.position.set(g.display.x, g.display.y - (st.score ? H * 0.23 : 0));
    }
    const n = st.score && digits ? Math.min(digits.length, this.digits.length) : 0;
    const dk = (H * 0.4) / GLYPH_H, pitch = GLYPH_W * dk * 1.24;
    for (let i = 0; i < this.digits.length; i++) {
      const d = this.digits[i]!;
      d.visible = i < n;
      if (!d.visible) continue;
      d.texture = this.digitTex[Math.abs(Math.round(digits![i]!)) % 10]!;
      d.scale.set(dk); d.alpha = st.alpha;
      d.position.set(g.display.x + (i - (n - 1) / 2) * pitch, g.display.y + H * 0.13);
    }
  }

  private wordTex(w: DisplayWord): Texture {
    return w === 'tilt' ? this.tex.wordTilt : w === 'multiball' ? this.tex.wordMultiball : this.tex.wordJackpot;
  }

  /** Hide every own object and level the root (the end, a cancel). */
  hideOwn(): void {
    for (const s of this.all) s.visible = false;
    this.rampBox.visible = false;
    this.own = false;
    this.tilt = 0;
    this.applyRoot();
  }

  /** Called by the runner once per frame, after its writes: is any own object still showing? */
  refresh(): void {
    let any = false;
    for (const s of this.all) { if (s.visible && s.parent !== this.rampBox) { any = true; break; } }
    this.own = any || this.rampBox.visible;
  }

  /** The rails live in their own container, so they are destroyed by hand after the pool. */
  override destroy(): void {
    if (this.destroyed) return;
    super.destroy();
    for (const s of this.rails) if (!s.destroyed) s.destroy();
  }

  protected override tick(): boolean { return this.own; }
  protected override clearOwn(): void { this.hideOwn(); }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /** The flipper meets the ball: a white pop, a ring and streaks of light thrown the way the ball goes. */
  flip(at: Pt, dir: Pt, k = 1): void {
    const S = this.scale, c = this.colors, r = (this.geo?.ballR ?? this.aR * 0.27) * k;
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 220, from: 0.5 * k, to: 1.5 * k, a0: 0.95, mode: 'punch', peakAt: 0.18, rot: 0.4 });
    this.spawn('glow', this.tex.ring, c.side, at.x, at.y, { dur: 260, from: (r * 1.2) / RING_PX / S, to: (r * 5) / RING_PX / S, a0: 0.55, ease: 'cubic' });
    this.burst('core', this.tex.spark, [c.spark, c.flash], at.x, at.y, Math.round(5 * k), { speed: 420, dir: Math.atan2(dir.y, dir.x), spread: 1.1, life: 240, size: 0.4, drag: 0.2, align: true });
  }

  /** A bumper fires: a ring off it, a hot pop and sparks where the ball met it, and the score popping off away from the target. */
  bump(center: Pt, contact: Pt, score: 10 | 50, big: boolean): void {
    const S = this.scale, c = this.colors, R = this.geo?.bumperR ?? this.dR * 0.5;
    this.spawn('glow', this.tex.ring, c.lamp, center.x, center.y, { dur: 280, from: (R * 1.9) / RING_PX / S, to: (R * (big ? 4.4 : 3.6)) / RING_PX / S, a0: 0.6, ease: 'cubic' });
    this.spawn('core', this.tex.glow, c.flash, contact.x, contact.y, { dur: 170, from: (R * 0.5) / GLOW_PX / S, to: (R * 1.5) / GLOW_PX / S, a0: 0.8, mode: 'punch', peakAt: 0.15 });
    const out = Math.atan2(contact.y - center.y, contact.x - center.x);
    this.burst('core', this.tex.spark, [c.spark, c.lamp, c.flash], contact.x, contact.y, big ? 5 : 3, { speed: 360, dir: out, spread: 1.6, life: 260, size: 0.36, drag: 0.2, align: true });
    if (this.scoreSize <= 0) return;
    // The score rises from the bumper's far side (away from the target), so it never covers the portrait.
    const hx = center.x - (this.geo?.hit.x ?? center.x), hy = center.y - (this.geo?.hit.y ?? center.y), hl = Math.hypot(hx, hy) || 1;
    const k = (R * 1.5 * this.scoreSize) / SCORE_W / S;
    this.spawn('body', score === 50 ? this.tex.plus50 : this.tex.plus10, 0xffffff, center.x + (hx / hl) * R * 0.9, center.y + (hy / hl) * R * 0.9 - R * 0.5, {
      dur: 520, from: k * 0.6, to: k * 1.05, a0: 1, mode: 'hold', ease: 'quint', vx: (hx / hl) * 60, vy: (hy / hl) * 60 - 90, drag: 0.25, rot: (this.rnd() - 0.5) * 0.24,
    });
  }

  /** The ball on the wire: a glint thrown off the rail. */
  rail(at: Pt): void {
    const c = this.colors;
    this.spawn('core', this.tex.spark, this.rnd() < 0.5 ? c.spark : c.flash, at.x, at.y, {
      dur: 220, from: 0.34, to: 0.1, a0: 0.9, ease: 'linear', vx: (this.rnd() - 0.5) * 240, vy: (this.rnd() - 0.5) * 240, drag: 0.25, rot: this.rnd() * 3,
    });
  }

  /** MULTIBALL: one ball becomes three: a white burst and three rings where they part. */
  split(at: Pt): void {
    const S = this.scale, c = this.colors, r = this.geo?.ballR ?? this.aR * 0.27;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 260, from: (r * 2) / GLOW_PX / S, to: (r * 7) / GLOW_PX / S, a0: 0.95, mode: 'punch', peakAt: 0.12 });
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 300, from: 0.7, to: 2.2, a0: 1, mode: 'punch', peakAt: 0.15, rot: 0.3 });
    for (let i = 0; i < 3; i++) this.spawn('glow', this.tex.ring, i === 1 ? c.side : c.lamp, at.x, at.y, { dur: 340 + 70 * i, from: (r * 1.5) / RING_PX / S, to: (r * (6 + 2.5 * i)) / RING_PX / S, a0: 0.7 - 0.12 * i, ease: 'cubic', delay: 50 * i });
    this.burst('core', this.tex.spark, [c.spark, c.flash, c.lamp], at.x, at.y, 10, { speed: 520, life: 320, size: 0.45, drag: 0.18, align: true });
  }

  /**
   * THE IMPACT (`at` = the target's centre; `dir` = the way the ball came in): a flash, rings off the lamp ring, a
   * starburst and steel sparks. `big` (the jackpot): spokes of light all round and a second wave.
   */
  impact(at: Pt, dir: Pt, o: { burst: number; rings: number; big: boolean }): void {
    const S = this.scale, c = this.colors, R = this.dR;
    const b = Math.max(0.3, o.burst);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 260, from: (R * 0.7 * b) / GLOW_PX / S, to: (R * 2.2 * b) / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 440, from: (R * 1.1 * b) / GLOW_PX / S, to: (R * 3 * b) / GLOW_PX / S, a0: 0.45, mode: 'punch', peakAt: 0.12 });
    for (let i = 0; i < Math.max(1, Math.min(8, o.rings + 1)); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.lamp, at.x, at.y, {
        dur: 380 + 70 * i, from: (R * LAMP_RING * 1.6) / RING_PX / S, to: (R * (3.2 + 0.9 * i) * Math.min(1.5, b)) / RING_PX / S, a0: 0.75 - 0.08 * i, ease: 'cubic', delay: 60 * i,
      });
    }
    this.burst('core', this.tex.star, [c.flash, c.lamp, c.side], at.x, at.y, Math.round(8 * b), { speed: 380 * b, life: 440, size: 0.36, drag: 0.15, spin: 0.01 });
    this.burst('core', this.tex.spark, [c.spark, c.flash], at.x, at.y, Math.round(8 * b), { speed: 620 * b, dir: Math.atan2(-dir.y, -dir.x), spread: 2.4, life: 340, size: 0.45, drag: 0.15, align: true, grav: 300 });
    if (!o.big) return;
    // The jackpot's spokes: long streaks of light standing all round the target, in two beats.
    for (let w = 0; w < 2; w++) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + w * 0.26;
        this.spawn('glow', this.tex.trail, i % 2 ? c.lamp : c.flash, at.x + Math.cos(a) * R * 3, at.y + Math.sin(a) * R * 3, {
          dur: 420, from: (R * 1.6) / TRAIL_W / S, to: (R * 2.4) / TRAIL_W / S, a0: 0.7 - 0.25 * w, sy: 0.5, rot: a + Math.PI, mode: 'punch', peakAt: 0.2, ease: 'cubic', delay: 130 * w,
        });
      }
    }
    this.spawn('glow', this.tex.ring, 0xffffff, at.x, at.y, { dur: 620, from: (R * 2) / RING_PX / S, to: (R * 8) / RING_PX / S, a0: 0.6, ease: 'cubic', delay: 80 });
  }

  /** III: a following ball hits the target: a smaller flash, one ring, a few sparks. */
  echo(at: Pt, dir: Pt): void {
    const S = this.scale, c = this.colors, R = this.dR;
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 200, from: (R * 0.6) / GLOW_PX / S, to: (R * 1.6) / GLOW_PX / S, a0: 0.75, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.ring, c.lamp, at.x, at.y, { dur: 320, from: (R * LAMP_RING * 1.6) / RING_PX / S, to: (R * 3.4) / RING_PX / S, a0: 0.6, ease: 'cubic' });
    this.burst('core', this.tex.spark, [c.spark, c.flash], at.x, at.y, 5, { speed: 480, dir: Math.atan2(-dir.y, -dir.x), spread: 2.2, life: 280, size: 0.4, drag: 0.15, align: true });
  }

  /** The jackpot stops on its number: the display flares and throws sparks off its top edge. */
  jackpot(): void {
    const g = this.geo;
    if (!g) return;
    const S = this.scale, c = this.colors, W = g.displayW, H = W * DISPLAY_ASPECT;
    this.spawn('glow', this.tex.glow, c.lamp, g.display.x, g.display.y, { dur: 520, from: (W * 0.9) / GLOW_PX / S, to: (W * 1.7) / GLOW_PX / S, a0: 0.7, sy: 0.5, mode: 'punch', peakAt: 0.12 });
    for (let i = 0; i < 10; i++) {
      const x = g.display.x + (this.rnd() - 0.5) * W * 0.9;
      this.spawn('core', this.tex.star, i % 2 ? c.lamp : c.flash, x, g.display.y - H * 0.5, {
        dur: 520 + this.rnd() * 260, from: 0.5, to: 0.15, a0: 1, ease: 'linear', vx: (this.rnd() - 0.5) * 260, vy: -260 - this.rnd() * 240, grav: 700, drag: 0.4, spin: (this.rnd() - 0.5) * 0.02,
      });
    }
  }

  /** The table pops up: a soft ring where each piece lands. */
  popAt(at: Pt, r: number, delay = 0): void {
    const S = this.scale;
    this.spawn('glow', this.tex.ring, whiten(this.colors.lamp, 0.4), at.x, at.y, { dur: 260, from: (r * 1.2) / RING_PX / S, to: (r * 3) / RING_PX / S, a0: 0.4, ease: 'cubic', delay });
  }
}
