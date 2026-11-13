/**
 * THE COMBO SCENE: what the Combo attack ("Flawless") draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. The PORTRAITS are the two fighters (the runner moves
 * both); this draws the fighting game around them. `heroCombo.ts` mounts `root` on the above-portrait overlay.
 *
 * EVERY HIT IS LIVE LIGHT, never a painted picture: a hot additive core, fighting-game HIT BLADES crossing at the contact,
 * radial SPEED LINES flying out, a SHOCK RING squashed along the hit, and SPARKS that stream trails as they fall. All of
 * it is tinted the tier's own colour (Tier 1 ice blue, Tier 2 neon pink, Tier 3 gold, Tier 4 red), so the four tiers
 * never look alike. The portraits' own smear (skew) and squash on contact are the runner's impact frames.
 *
 * THE HUD (own objects, on their own top layer; written by the runner every frame from the pure state, hidden the moment
 * they are not needed and on every exit):
 *  - THE COMBO COUNTER: pooled digit sprites and a HIT / HITS label, composed from painted textures (no DOM text). Each
 *    time it moves it punches, shakes and throws an AFTERIMAGE of itself; the final count gets a glint.
 *  - THE SUPER CUT-IN (Tier 4): the screen dim, the slanted band, the striking hero's portrait art on it, the inputs.
 *  - THE LETTERBOX (Tier 4): two black bars with a hairline of the tier's colour.
 *  - THE DIZZY BIRDS (Tier 2, Tier 3): three little stars circling the struck head, shedding sparkles.
 *  - THE CALL-OUTS ("COUNTER", "BREAKER?", "K.O.", "PERFECT"): each SLAMS in from big with an overshoot, shakes, trails
 *    two additive afterimages, catches a glint, holds and fades; "BREAKER?" can be SMASHED into shards.
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the hit effects, the parry, the strike trails, the drive lines, dust, the
 * launch, the slam, the super's flash and the band's speed lines, the wind-up's gather, the impact frame, the heavy blow
 * and its aftermath. No drawn props.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { arcPoint, clamp01, easeOutCubic, spring, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { GLYPHS, GLYPH_GAP_MS, type CounterState, type CutinState, type HitKind } from './heroComboConfig';

export interface HeroComboTextures extends HeroArcanaTextures {
  blade: Texture;
  dizzyStar: Texture;
  arrow: Texture;
  button: Texture;
  band: Texture;
  dust: Texture;
  labelHit: Texture;
  labelHits: Texture;
  wordKo: Texture;
  wordCounter: Texture;
  wordPerfect: Texture;
  wordBreaker: Texture;
  d0: Texture; d1: Texture; d2: Texture; d3: Texture; d4: Texture; d5: Texture; d6: Texture; d7: Texture; d8: Texture; d9: Texture;
}

/** `tier`: the tier's own colour (its hits, trails, rings). `flash`, `dust`, `side` (the striker's side colour). */
export interface ComboColors { tier: number; flash: number; dust: number; side: number }

export interface ComboLook {
  sparkSize: number;
  /** The way the striker faces (+1 = toward +x). */
  face: 1 | -1;
  /** The counter: its centre, a digit's height (px) and how many digit slots (the final number's length). */
  counter: Pt;
  digit: number;
  digits: number;
  /** Tier 4: the cut-in band (centre, length, height, tilt) and the frame it crosses. */
  band: { x: number; y: number; w: number; h: number; rot: number };
  frameW: number;
  frameH: number;
  /** Tier 4: the letterbox bars' height (a part of the screen). */
  barsH?: number;
}

export type CalloutKind = 'counter' | 'breaker' | 'ko' | 'perfect';

/** Hard cap on pooled sprites alive at once (a Tier 4 flurry peaks near 150). The HUD's own sprites are outside it. */
export const MAX_COMBO_SPRITES = 320;
const RING_PX = 160;
const GLOW_PX = 128;
const STREAK_PX = 64;
const BLADE_W = 256;
const STAR_PX = 48;
const DIZZY_PX = 64;
const GLYPH_PX = 112;
const BAND_W = 512;
const BAND_H = 128;
const PUFF_PX = 96;
const DIGIT_H = 128;
const LABEL_H = 96;
const WORD_W = 640;
const KO_W = 512;
const CUTIN_H = 288;
/** The counter never needs more digit slots than this (a blow past 9999 is not a thing). */
const MAX_DIGITS = 4;
const WORDS = 4;
const BIRDS = 3;

/** A call-out word: the word, its two afterimages, and its little life. */
interface Word { s: Sprite; g: [Sprite, Sprite]; kind: CalloutKind | null; age: number; hold: number; x: number; y: number; k: number; w: number; tint: number; glint: boolean; smash: number }

/** The call-out's slam: big to its size in 150 ms, with an overshoot that rings out. */
function slamScale(age: number): number {
  if (age < 0) return 0;
  if (age < 150) return 1 + 1.7 * (1 - easeOutCubic(age / 150));
  return 1 + 0.14 * spring(age - 150, 5, 120);
}

export class HeroComboScene extends FxPool {
  private readonly hud = new Container();
  private readonly dim: Sprite;
  private readonly bars: Sprite[] = [];
  private readonly band: Sprite;
  private readonly cutin: Sprite | null;
  private readonly glyphs: Sprite[] = [];
  private readonly counter = new Container();
  private readonly digitSprites: Sprite[] = [];
  private readonly label: Sprite;
  private readonly digitTex: Texture[];
  private readonly birds: Sprite[] = [];
  private readonly birdGlows: Sprite[] = [];
  private readonly words: Word[] = [];
  private shown = -1;
  private glinted = false;
  private birdTrail = -1;
  private own = false;

  /** `aR` / `dR`: the striking and the struck portraits' radii (screen px). `cutin`: the striker's portrait panel. */
  constructor(
    private readonly tex: HeroComboTextures, private readonly colors: ComboColors, private readonly look: ComboLook,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1, cutin: Texture | null = null,
  ) {
    super('heroCombo', [
      tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.blade, tex.dizzyStar, tex.arrow, tex.button, tex.band, tex.dust,
      tex.labelHit, tex.labelHits, tex.wordKo, tex.wordCounter, tex.wordPerfect, tex.wordBreaker,
      tex.d0, tex.d1, tex.d2, tex.d3, tex.d4, tex.d5, tex.d6, tex.d7, tex.d8, tex.d9, ...(cutin ? [cutin] : []),
    ], scale, seed, MAX_COMBO_SPRITES);
    this.digitTex = [tex.d0, tex.d1, tex.d2, tex.d3, tex.d4, tex.d5, tex.d6, tex.d7, tex.d8, tex.d9];
    const mk = (parent: Container, t: Texture, ax = 0.5, ay = 0.5, add = false): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.visible = false; s.eventMode = 'none';
      if (add) s.blendMode = 'add';
      parent.addChild(s);
      return s;
    };
    this.hud.label = 'heroCombo-hud';
    this.hud.eventMode = 'none';
    this.dim = mk(this.layers.under, Texture.WHITE);
    this.dim.tint = 0x05060c;
    // The letterbox: two black bars, a hairline of the tier's colour on each inner edge.
    for (let i = 0; i < 2; i++) { const b = mk(this.hud, Texture.WHITE, 0.5, i ? 0 : 1); b.tint = 0x000000; this.bars.push(b); }
    for (let i = 0; i < 2; i++) { const b = mk(this.hud, Texture.WHITE, 0.5, 0.5, true); b.tint = colors.tier; this.bars.push(b); }
    this.band = mk(this.hud, tex.band);
    this.cutin = cutin ? mk(this.hud, cutin) : null;
    for (let i = 0; i < GLYPHS; i++) this.glyphs.push(mk(this.hud, i === GLYPHS - 1 ? tex.button : tex.arrow));
    // The counter: `digits` slots (right-aligned) and the label after them, laid out once about the counter's centre.
    const n = Math.min(MAX_DIGITS, Math.max(1, look.digits));
    const h = look.digit, adv = h * 0.56, lh = h * 0.5;
    const width = adv * n + h * 0.12 + lh * 2.3;
    for (let i = 0; i < n; i++) {
      const s = mk(this.counter, tex.d0);
      s.scale.set(h / DIGIT_H);
      s.position.set(-width / 2 + adv * (i + 0.5), 0);
      s.visible = true;
      this.digitSprites.push(s);
    }
    this.label = mk(this.counter, tex.labelHits, 0, 0.5);
    this.label.scale.set(lh / LABEL_H);
    this.label.position.set(-width / 2 + adv * n + h * 0.04, h * 0.2);
    this.label.visible = true;
    this.counter.position.set(look.counter.x, look.counter.y);
    this.counter.rotation = -0.07;
    this.counter.visible = false;
    this.counter.eventMode = 'none';
    this.hud.addChild(this.counter);
    // The dizzy birds: a soft glow under each little star.
    for (let i = 0; i < BIRDS; i++) { const g = mk(this.hud, tex.glow, 0.5, 0.5, true); g.tint = colors.tier; this.birdGlows.push(g); }
    for (let i = 0; i < BIRDS; i++) { const s = mk(this.hud, tex.dizzyStar, 0.5, 0.5, true); s.tint = 0xffe46a; this.birds.push(s); }
    // The call-outs: afterimages under the word.
    for (let i = 0; i < WORDS; i++) {
      const g: [Sprite, Sprite] = [mk(this.hud, tex.wordKo, 0.5, 0.5, true), mk(this.hud, tex.wordKo, 0.5, 0.5, true)];
      const s = mk(this.hud, tex.wordKo);
      this.words.push({ s, g, kind: null, age: 0, hold: 0, x: 0, y: 0, k: 1, w: 0, tint: 0xffffff, glint: false, smash: -1 });
    }
    this.root.addChild(this.hud);
  }

  /** Whether any own object (the counter, the cut-in, the bars, the birds, a call-out) still draws. */
  get ownVisible(): boolean { return this.own; }
  /** What the counter reads on screen right now (-1 = hidden). Tests. */
  get counterValue(): number { return this.counter.visible ? this.shown : -1; }
  /** The call-outs on screen right now (tests). */
  get callouts(): CalloutKind[] { return this.words.filter((w) => w.kind && w.s.visible).map((w) => w.kind!); }

  // ── the HUD (the runner writes it every frame) ────────────────────────────────────────────────────────────────

  /** The combo counter. Textures are only swapped when the number changes. */
  setCounter(s: CounterState): void {
    if (this.destroyed) return;
    const c = this.counter;
    if (s.alpha <= 0.002) { if (c.visible) { c.visible = false; this.refresh(); } return; }
    const moved = s.value !== this.shown;
    if (moved) {
      this.shown = s.value;
      const n = this.digitSprites.length;
      let v = Math.max(0, Math.floor(s.value));
      for (let i = n - 1; i >= 0; i--) {
        const d = this.digitSprites[i]!;
        d.visible = v > 0 || i === n - 1;
        if (d.visible) d.texture = this.digitTex[v % 10]!;
        v = Math.floor(v / 10);
      }
      this.label.texture = s.value === 1 ? this.tex.labelHit : this.tex.labelHits;
    }
    const punch = (s.final ? 0.6 : 0.36) * Math.exp(-Math.max(0, s.pulse) / 85);
    const sc = (s.final ? 1.1 : 1) + punch;
    c.scale.set(sc);
    // It SHAKES as it moves (the number rattles into place).
    const p = Math.max(0, s.pulse);
    const amp = this.look.digit * (s.final ? 0.09 : 0.05) * Math.exp(-p / 90);
    c.position.set(this.look.counter.x + Math.sin(p * 0.9) * amp, this.look.counter.y + Math.cos(p * 1.13) * amp * 0.6);
    c.alpha = s.alpha;
    if (moved && s.pulse < 40) this.counterGhost(sc / (1 + punch));
    if (s.final && !this.glinted && s.pulse < 60) { this.glinted = true; this.glint(this.look.counter.x, this.look.counter.y, this.look.digit * (0.56 * this.digitSprites.length + 1.4), this.look.digit, 80); }
    if (!c.visible) { c.visible = true; this.refresh(); }
  }

  /** The counter's AFTERIMAGE: an additive copy of every glyph it shows, blown up and gone in a quarter second. */
  private counterGhost(sc: number): void {
    const S = this.scale;
    const c = this.counter;
    const cos = Math.cos(c.rotation), sin = Math.sin(c.rotation);
    const each = (sp: Sprite, ax: number): void => {
      if (!sp.visible) return;
      // The label is anchored at its left edge: its middle is half a width along.
      const lx = sp.position.x + (ax ? (sp.texture.width * sp.scale.x) / 2 : 0), ly = sp.position.y;
      const x = c.position.x + (lx * cos - ly * sin) * sc, y = c.position.y + (lx * sin + ly * cos) * sc;
      const k = (sp.scale.x * sc) / S;
      this.spawn('glow', sp.texture, this.colors.tier, x, y, { dur: 260, from: k * 1.05, to: k * 1.7, a0: 0.6, rot: c.rotation, ease: 'cubic' });
    };
    for (const d of this.digitSprites) each(d, 0);
    each(this.label, 1);
  }

  /** A GLINT: a four-point star of light sweeping across a word or the counter. */
  private glint(x: number, y: number, w: number, h: number, delay = 0): void {
    const S = this.scale;
    const sz = (h * 0.9) / STAR_PX / S;
    const life = 300;
    this.spawn('core', this.tex.star, 0xffffff, x - w * 0.42, y - h * 0.18, { dur: life, from: sz * 0.5, to: sz * 1.3, a0: 1, mode: 'punch', peakAt: 0.45, vx: (w * 0.84) / (life / 1000) / S, spin: 0.012, ease: 'linear', delay });
    this.spawn('core', this.tex.glow, 0xffffff, x - w * 0.42, y - h * 0.18, { dur: life, from: (h * 0.5) / GLOW_PX / S, to: (h * 0.8) / GLOW_PX / S, a0: 0.5, mode: 'punch', peakAt: 0.45, vx: (w * 0.84) / (life / 1000) / S, ease: 'linear', delay });
  }

  /** Tier 4: the super cut-in (null hides it): the dim, the band on its slide, the portrait panel and the input glyphs. */
  setCutin(s: CutinState | null): void {
    if (this.destroyed) return;
    if (!s) {
      if (this.band.visible || this.dim.visible) {
        this.dim.visible = false; this.band.visible = false;
        if (this.cutin) this.cutin.visible = false;
        for (const g of this.glyphs) g.visible = false;
        this.refresh();
      }
      return;
    }
    const { band: b, face, frameW, frameH } = this.look;
    const ax = Math.cos(b.rot), ay = Math.sin(b.rot);
    this.dim.visible = s.dim > 0.002;
    this.dim.position.set(b.x, b.y);
    this.dim.width = frameW * 1.5; this.dim.height = frameH * 1.5;
    this.dim.alpha = s.dim;
    // The band comes from behind the striker and leaves the way it faces.
    const off = face * s.slide * b.w;
    this.band.visible = true;
    this.band.position.set(b.x + ax * off, b.y + ay * off);
    this.band.rotation = b.rot;
    this.band.scale.set(b.w / BAND_W, b.h / BAND_H);
    if (this.cutin) {
      // The portrait panel sits on the striker's side of the band and creeps forward while it holds.
      const along = off * 1.15 - face * frameW * 0.2 + face * Math.min(40, s.age * 0.035) * (b.h / 280);
      this.cutin.visible = true;
      this.cutin.position.set(b.x + ax * along, b.y + ay * along);
      this.cutin.rotation = b.rot;
      this.cutin.scale.set((b.h * 1.2) / CUTIN_H);
    }
    const size = b.h * 0.42, gap = b.h * 0.5;
    for (let i = 0; i < this.glyphs.length; i++) {
      const g = this.glyphs[i]!;
      const age = s.glyphAge - i * GLYPH_GAP_MS;
      if (age < 0) { g.visible = false; continue; }
      const along = off + face * frameW * (this.cutin ? 0.2 : 0) + (i - (this.glyphs.length - 1) / 2) * gap;
      g.visible = true;
      g.position.set(b.x + ax * along, b.y + ay * along);
      // A quarter circle toward the foe, then the button: down, down-forward, forward, attack.
      g.rotation = i === GLYPHS - 1 ? 0 : face > 0 ? [Math.PI / 2, Math.PI / 4, 0][i]! : [Math.PI / 2, (Math.PI * 3) / 4, Math.PI][i]!;
      g.scale.set((size / GLYPH_PX) * (1 + 0.7 * Math.exp(-age / 70)));
    }
    this.refresh();
  }

  /** Tier 4: THE LETTERBOX (0 = gone, 1 = in). */
  setBars(k: number): void {
    if (this.destroyed) return;
    const on = k > 0.002 && (this.look.barsH ?? 0) > 0;
    if (!on) { if (this.bars[0]!.visible) { for (const b of this.bars) b.visible = false; this.refresh(); } return; }
    const { frameW: W, frameH: H } = this.look;
    const h = H * (this.look.barsH ?? 0);
    const tw = Texture.WHITE.width || 1, th = Texture.WHITE.height || 1;
    const extra = 240; // overscan, so the shake never shows a gap above the bar
    const [top, bot, lt, lb] = this.bars as [Sprite, Sprite, Sprite, Sprite];
    for (const b of [top, bot]) { b.visible = true; b.scale.set((W * 1.6) / tw, (h + extra) / th); b.alpha = 1; }
    top.position.set(W / 2, h * k); bot.position.set(W / 2, H - h * k);
    for (const b of [lt, lb]) { b.visible = true; b.scale.set((W * 1.6) / tw, 3 / th); b.alpha = 0.85 * k; }
    lt.position.set(W / 2, h * k); lb.position.set(W / 2, H - h * k);
    this.refresh();
  }

  /** Tier 2 and Tier 3: THE DIZZY BIRDS over the struck head (`at` = its centre); `age` < 0 hides them. */
  setDizzy(at: Pt, age: number, alpha: number): void {
    if (this.destroyed) return;
    if (age < 0 || alpha <= 0.002) {
      if (this.birds[0]!.visible) { for (const b of this.birds) b.visible = false; for (const g of this.birdGlows) g.visible = false; this.birdTrail = -1; this.refresh(); }
      return;
    }
    const r = this.dR;
    const cx = at.x, cy = at.y - r * 1.08;
    const sz = (r * 0.42) / DIZZY_PX;
    const trail = this.birdTrail < 0 || age - this.birdTrail >= 55;
    if (trail) this.birdTrail = age;
    for (let i = 0; i < BIRDS; i++) {
      const a = age * 0.0078 + (i * Math.PI * 2) / BIRDS;
      const depth = (Math.sin(a) + 1) / 2;
      const x = cx + Math.cos(a) * r * 0.66, y = cy + Math.sin(a) * r * 0.2;
      const s = this.birds[i]!, g = this.birdGlows[i]!;
      s.visible = true; g.visible = true;
      s.position.set(x, y); g.position.set(x, y);
      s.scale.set(sz * (0.7 + 0.45 * depth));
      s.rotation = Math.sin(age * 0.006 + i) * 0.5;
      s.alpha = alpha * (0.7 + 0.3 * depth);
      g.scale.set((r * 0.7 * (0.7 + 0.4 * depth)) / GLOW_PX);
      g.alpha = alpha * 0.85 * (0.5 + 0.5 * depth);
      // A sparkle shed behind each bird (pooled, fire-and-forget).
      if (trail) this.spawn('core', this.tex.star, i % 2 ? 0xffffff : whiten(this.colors.tier, 0.5), x, y, { dur: 300, from: (r * 0.3) / STAR_PX / this.scale, to: 0.02, a0: 0.8 * alpha, ease: 'linear', vy: 30, rot: a });
    }
    this.refresh();
  }

  /** A CALL-OUT slams in at `at`, `width` px wide, holds `holdMs` and fades. Replaces one of the same kind. */
  callout(kind: CalloutKind, at: Pt, width: number, holdMs: number): void {
    if (this.destroyed || width <= 0) return;
    const t = kind === 'ko' ? this.tex.wordKo : kind === 'counter' ? this.tex.wordCounter : kind === 'perfect' ? this.tex.wordPerfect : this.tex.wordBreaker;
    const base = kind === 'ko' ? KO_W : WORD_W;
    const w = this.words.find((q) => q.kind === kind) ?? this.words.find((q) => !q.kind) ?? this.words[0]!;
    w.kind = kind; w.age = 0; w.hold = holdMs; w.x = at.x; w.y = at.y; w.k = width / base; w.w = width; w.glint = false; w.smash = -1;
    w.tint = kind === 'counter' ? 0x5fe3ff : kind === 'breaker' ? 0xff4fd2 : kind === 'perfect' ? 0xffd21f : this.colors.tier;
    w.s.texture = t; w.g[0].texture = t; w.g[1].texture = t;
    w.g[0].tint = w.tint; w.g[1].tint = w.tint;
    this.paintWord(w);
    this.refresh();
    // The slam: a flash behind it and a ring off it.
    const S = this.scale;
    this.spawn('glow', this.tex.glow, w.tint, at.x, at.y, { dur: 300, from: (width * 0.6) / GLOW_PX / S, to: (width * 1.4) / GLOW_PX / S, a0: 0.7, mode: 'punch', peakAt: 0.1, sy: 0.45 });
    this.spawn('glow', this.tex.ring, whiten(w.tint, 0.4), at.x, at.y, { dur: 380, from: (width * 0.3) / RING_PX / S, to: (width * 1.2) / RING_PX / S, a0: 0.8, sy: 0.4, ease: 'cubic', delay: 90 });
  }

  /** "BREAKER?" is SMASHED: the word bursts into shards of light and is gone. */
  smash(kind: CalloutKind): void {
    const w = this.words.find((q) => q.kind === kind && q.smash < 0);
    if (!w || this.destroyed) return;
    w.smash = 0;
    const S = this.scale;
    this.burst('core', this.tex.blade, [w.tint, 0xffffff], w.x, w.y, 12, { speed: 900, life: 380, size: (w.w * 0.18) / BLADE_W / S, drag: 0.1, grav: 1300, align: true });
    this.burst('core', this.tex.spark, [w.tint, 0xffffff], w.x, w.y, 10, { speed: 700, life: 420, size: 0.5, drag: 0.15, grav: 1100, align: true });
    this.spawn('core', this.tex.glow, 0xffffff, w.x, w.y, { dur: 140, from: (w.w * 0.4) / GLOW_PX / S, to: (w.w * 0.9) / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.1, sy: 0.5 });
  }

  /** One frame of a call-out: the slam, the shake, the afterimages, the glint, the hold and the fade (or the smash). */
  private paintWord(w: Word): void {
    const a = w.age;
    const fade = a > w.hold ? clamp01((a - w.hold) / 220) : 0;
    const sm = w.smash >= 0 ? clamp01(w.smash / 110) : 0;
    const sc = w.k * slamScale(a) * (1 + 0.1 * fade + 0.3 * sm);
    const amp = w.w * 0.022 * Math.exp(-a / 170);
    const rot = -0.07 + 0.035 * Math.sin(a * 0.011);
    w.s.visible = true;
    w.s.position.set(w.x + Math.sin(a * 0.95) * amp, w.y + Math.cos(a * 1.21) * amp * 0.7);
    w.s.scale.set(sc);
    w.s.rotation = rot;
    w.s.alpha = clamp01(a / 50) * (1 - fade) * (1 - sm);
    for (let i = 0; i < 2; i++) {
      const g = w.g[i]!;
      const ga = a - 45 * (i + 1);
      const ghost = 0.5 / (i + 1) * (1 - clamp01(a / 420)) * (1 - sm);
      g.visible = ga > 0 && ghost > 0.01;
      if (!g.visible) continue;
      g.position.set(w.x, w.y);
      g.scale.set(w.k * slamScale(ga) * (1.06 + 0.06 * i));
      g.rotation = rot;
      g.alpha = ghost;
    }
    if (!w.glint && a >= 170 && w.smash < 0) { w.glint = true; this.glint(w.x, w.y, w.w * 0.92, w.w * 0.27); }
  }

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    this.dim.visible = false; this.band.visible = false; this.counter.visible = false;
    if (this.cutin) this.cutin.visible = false;
    for (const g of this.glyphs) g.visible = false;
    for (const b of this.bars) b.visible = false;
    for (const b of this.birds) b.visible = false;
    for (const g of this.birdGlows) g.visible = false;
    for (const w of this.words) { w.kind = null; w.s.visible = false; w.g[0].visible = false; w.g[1].visible = false; }
    this.own = false;
  }

  private refresh(): void {
    this.own = this.counter.visible || this.band.visible || this.dim.visible || this.bars[0]!.visible || this.birds[0]!.visible || this.words.some((w) => w.kind !== null);
  }

  protected override tick(dt: number): boolean {
    let died = false;
    for (const w of this.words) {
      if (!w.kind) continue;
      w.age += dt;
      if (w.smash >= 0) w.smash += dt;
      if ((w.smash >= 0 && w.smash > 120) || w.age > w.hold + 230) {
        w.kind = null; w.s.visible = false; w.g[0].visible = false; w.g[1].visible = false;
        died = true;
        continue;
      }
      this.paintWord(w);
    }
    if (died) this.refresh();
    return this.own;
  }
  protected override clearOwn(): void { this.hideOwn(); }

  override destroy(): void {
    if (this.destroyed) return;
    this.hideOwn();
    const mine = [...this.hud.children, ...this.counter.children];
    super.destroy();
    for (const c of mine) if (!c.destroyed) c.destroy();
  }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A HIT, built from light: a hot additive core, fighting-game blades crossing at the contact, speed lines flying out,
   * a shock ring squashed along the hit, and sparks that stream as they fall. Bigger with `power`; a flurry tick is a
   * lighter version. Tinted the tier's colour.
   */
  hitFx(at: Pt, kind: HitKind, power: number): void {
    const S = this.scale;
    const P = this.colors.tier, hot = whiten(P, 0.55);
    const face = this.look.face;
    const dir = face > 0 ? 0 : Math.PI;
    const tick = kind === 'flurry';
    const r = this.dR * this.look.sparkSize * (0.55 + 0.6 * Math.min(1.4, power));
    // The core: white-hot, then the tier's colour blooming round it.
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: tick ? 80 : 110, from: (r * 0.4) / GLOW_PX / S, to: (r * 1.3) / GLOW_PX / S, a0: 1, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.glow, P, at.x, at.y, { dur: tick ? 150 : 240, from: (r * 0.8) / GLOW_PX / S, to: (r * 2.1) / GLOW_PX / S, a0: 0.8, mode: 'punch', peakAt: 0.08 });
    // THE HIT BLADES: crossing spindles of light, the long one along the hit, snapping open then thinning out.
    const nb = tick ? 2 : power > 0.8 ? 4 : 3;
    for (let i = 0; i < nb; i++) {
      const a = dir + (i - (nb - 1) / 2) * (tick ? 1.1 : 0.72) + (this.rnd() - 0.5) * 0.3;
      const len = r * (i === Math.floor(nb / 2) ? 2.4 : 1.6 + this.rnd() * 0.5);
      const life = (tick ? 90 : 130) + 50 * power;
      this.spawn('glow', this.tex.blade, P, at.x, at.y, { dur: life, from: (len * 0.4) / BLADE_W / S, to: len / BLADE_W / S, a0: 0.9, mode: 'punch', peakAt: 0.15, sy: 2.2, rot: a });
      this.spawn('core', this.tex.blade, 0xffffff, at.x, at.y, { dur: life * 0.8, from: (len * 0.35) / BLADE_W / S, to: (len * 0.9) / BLADE_W / S, a0: 1, mode: 'punch', peakAt: 0.15, sy: 0.7, rot: a });
    }
    // SPEED LINES flying out from the contact, every way.
    const nl = tick ? 4 : 7 + Math.round(5 * Math.min(1.3, power));
    for (let i = 0; i < nl; i++) {
      const a = (i / nl) * Math.PI * 2 + this.rnd() * 0.5;
      const d0 = r * 0.45, len = r * (0.7 + 0.5 * this.rnd());
      const sp = (r * (4 + 3 * this.rnd())) / S;
      this.spawn('core', this.tex.blade, i % 3 ? hot : 0xffffff, at.x + Math.cos(a) * d0, at.y + Math.sin(a) * d0, {
        dur: (tick ? 110 : 170) + 60 * power, from: (len * 0.6) / BLADE_W / S, to: len / BLADE_W / S, a0: 0.9, sy: 0.55, rot: a,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.03, ease: 'linear',
      });
    }
    // THE SHOCK RING, squashed along the hit (seen edge-on, the way it travels).
    this.spawn('glow', this.tex.ring, hot, at.x, at.y, { dur: (tick ? 160 : 230) + 80 * power, from: (r * 0.3) / RING_PX / S, to: (r * (tick ? 1.1 : 1.8)) / RING_PX / S, a0: 0.9, sy: 0.4, rot: dir + Math.PI / 2, ease: 'cubic' });
    if (!tick && power > 0.6) this.spawn('glow', this.tex.ring, 0xffffff, at.x, at.y, { dur: 300, from: (r * 0.5) / RING_PX / S, to: (r * 2.2) / RING_PX / S, a0: 0.5, ease: 'cubic', delay: 30 });
    // SPARKS that stream trails as they arc down.
    this.burst('core', this.tex.spark, [hot, 0xffffff, P], at.x, at.y, tick ? 2 : 3 + Math.round(6 * Math.min(1.3, power)), {
      speed: 950 * (0.6 + 0.5 * Math.min(1.3, power)), dir, spread: 2, life: tick ? 200 : 300 + 100 * power, size: 0.5, drag: 0.08, grav: 1100, align: true,
    });
  }

  /**
   * A STRIKE TRAIL (Tier 1's counter, every Tier 2 strike): a ribbon of light drawn along the strike from `from` to the
   * contact, a segment at a time so it sweeps, fading from its tail. `arc` bows it (the roundhouse's sweep).
   */
  trail(from: Pt, to: Pt, arc: number, width: number): void {
    const S = this.scale;
    const P = this.colors.tier;
    const n = arc ? 11 : 7;
    let prev = from;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const q = arcPoint(from, to, arc, u);
      const dx = q.x - prev.x, dy = q.y - prev.y;
      const seg = Math.hypot(dx, dy) * 1.9;
      const mx = (q.x + prev.x) / 2, my = (q.y + prev.y) / 2, a = Math.atan2(dy, dx);
      const w = width * (0.35 + 0.65 * u);
      this.spawn('glow', this.tex.blade, P, mx, my, { dur: 170 + 10 * i, from: seg / BLADE_W / S, to: (seg * 0.8) / BLADE_W / S, a0: 0.85, sy: (w / (seg || 1)) * 8, rot: a, delay: i * 9, ease: 'linear' });
      this.spawn('core', this.tex.blade, 0xffffff, mx, my, { dur: 130 + 8 * i, from: seg / BLADE_W / S, to: (seg * 0.75) / BLADE_W / S, a0: 0.9 * u, sy: (w / (seg || 1)) * 3, rot: a, delay: i * 9, ease: 'linear' });
      prev = q;
    }
  }

  /**
   * Tier 1: THE PARRY. Where the incoming lunge meets the guard: a white flash, a tall guard line of ice-blue light,
   * a star of short blades, two rings snapping out and sparks deflected up and away.
   */
  parry(at: Pt): void {
    const S = this.scale;
    const P = this.colors.tier, hot = whiten(P, 0.6);
    const r = this.dR;
    const face = this.look.face;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 160, from: (r * 0.6) / GLOW_PX / S, to: (r * 2) / GLOW_PX / S, a0: 1, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.glow, P, at.x, at.y, { dur: 420, from: (r * 1.2) / GLOW_PX / S, to: (r * 2.8) / GLOW_PX / S, a0: 0.8, mode: 'punch', peakAt: 0.06 });
    // The guard line: tall, upright, white-hot inside the blue.
    this.spawn('glow', this.tex.blade, P, at.x, at.y, { dur: 320, from: (r * 1.2) / BLADE_W / S, to: (r * 2.8) / BLADE_W / S, a0: 1, mode: 'punch', peakAt: 0.1, sy: 2.4, rot: Math.PI / 2 });
    this.spawn('core', this.tex.blade, 0xffffff, at.x, at.y, { dur: 260, from: (r * 1) / BLADE_W / S, to: (r * 2.4) / BLADE_W / S, a0: 1, mode: 'punch', peakAt: 0.1, sy: 0.8, rot: Math.PI / 2 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      this.spawn('core', this.tex.blade, i % 2 ? hot : 0xffffff, at.x, at.y, { dur: 200, from: (r * 0.3) / BLADE_W / S, to: (r * 1.2) / BLADE_W / S, a0: 0.9, mode: 'punch', peakAt: 0.12, sy: 0.6, rot: a });
    }
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', this.tex.ring, i ? 0xffffff : hot, at.x, at.y, { dur: 300 + 100 * i, from: (r * 0.3) / RING_PX / S, to: (r * (1.8 + 0.8 * i)) / RING_PX / S, a0: 0.9, ease: 'cubic', delay: 40 * i });
    }
    // Deflected: up and back toward the attacker that lunged (the struck side, along the facing).
    this.burst('core', this.tex.spark, [hot, 0xffffff], at.x, at.y, 12, { speed: 1000, dir: face > 0 ? -0.9 : Math.PI + 0.9, spread: 1.4, life: 420, size: 0.5, drag: 0.1, grav: 1500, align: true });
  }

  /** The DRIVE: speed lines punched through the hit the way the striker faces (bigger, the heavy blow). */
  drive(at: Pt, big = false): void {
    const S = this.scale;
    const face = this.look.face;
    const r = this.dR * this.look.sparkSize;
    const n = big ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const y = at.y + ((i + 0.5) / n - 0.5) * r * (big ? 1.5 : 0.9);
      this.spawn('core', this.tex.streak, i % 3 === 1 ? this.colors.tier : 0xffffff, at.x - face * r * (big ? 1.5 : 0.9), y, {
        dur: big ? 300 : 200, from: (r * (big ? 2.4 : 1.3)) / STREAK_PX / S, to: (r * (big ? 4.2 : 2.1)) / STREAK_PX / S, a0: big ? 0.85 : 0.65, sy: big ? 0.11 : 0.09,
        rot: 0, vx: face * (big ? 2200 : 1400), drag: 0.05, ease: 'linear', delay: i * (big ? 8 : 6),
      });
    }
  }

  /** Soft dust kicked up at `at`, thrown along `dirX`. */
  private puffs(at: Pt, n: number, r: number, dirX: number, spread: number, k = 1): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const sx = dirX || (i % 2 ? 1 : -1);
      this.spawn('body', this.tex.dust, i % 3 ? this.colors.dust : whiten(this.colors.dust, 0.4), at.x + sx * r * (0.3 + 0.15 * i), at.y, {
        dur: 420 + this.rnd() * 300, from: (r * 0.4) / PUFF_PX / S, to: (r * (0.9 + this.rnd() * 0.5)) / PUFF_PX / S, a0: 0.8, mode: 'hold', ease: 'cubic',
        vx: sx * (120 + spread * i) * k, vy: -40 - this.rnd() * 80, drag: 0.08,
      });
    }
  }

  /** The step in: soft dust kicked up behind the striker. */
  stepDust(at: Pt, dirX: number): void { this.puffs({ x: at.x - dirX * this.aR * 0.4, y: at.y + this.aR * 0.6 }, 2, this.aR, -dirX, 40); }

  /** Tier 3: the LAUNCH. A pillar of gold light streaking straight up, a ground ring and dust where the target stood. */
  launch(at: Pt): void {
    const S = this.scale;
    const P = this.colors.tier;
    const r = this.dR;
    for (let i = 0; i < 6; i++) {
      const off = (i / 5 - 0.5) * r * 1.1;
      this.spawn('core', this.tex.blade, i % 2 ? P : 0xffffff, at.x + off, at.y - r * 0.2, {
        dur: 300, from: (r * 1.4) / BLADE_W / S, to: (r * 2.6) / BLADE_W / S, a0: 0.9, sy: 0.7, rot: -Math.PI / 2, vy: -1300 - 300 * (i % 3), drag: 0.15, ease: 'linear', delay: (i % 3) * 20,
      });
    }
    this.spawn('glow', this.tex.ring, whiten(P, 0.4), at.x, at.y + r * 0.6, { dur: 380, from: (r * 0.5) / RING_PX / S, to: (r * 2.4) / RING_PX / S, a0: 0.85, sy: 0.3, ease: 'cubic' });
    this.puffs({ x: at.x, y: at.y + r * 0.7 }, 4, r, 0, 90);
  }

  /** Tier 3: the SLAM into the socket (THE impact): a big hit, rings along the ground, ground speed lines, dust, embers. */
  slam(at: Pt, k: number, rings: number): void {
    const S = this.scale;
    const P = this.colors.tier;
    const r = this.dR;
    this.hitFx(at, 'spike', Math.max(0.9, k * 0.85));
    for (let i = 0; i < Math.min(6, rings); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? this.colors.side : whiten(P, 0.3), at.x, at.y + r * 0.55, {
        dur: 380 + 70 * i, from: (r * 0.6) / RING_PX / S, to: (r * (2.2 + 0.8 * i) * k) / RING_PX / S, a0: 0.8 - 0.1 * i, sy: 0.32, ease: 'cubic', delay: 50 * i,
      });
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        this.spawn('core', this.tex.blade, i % 2 ? P : 0xffffff, at.x + sx * r * 0.6, at.y + r * (0.45 + 0.1 * i), {
          dur: 260, from: (r * 0.8) / BLADE_W / S, to: (r * 1.6) / BLADE_W / S, a0: 0.85, sy: 0.5, rot: sx > 0 ? 0 : Math.PI, vx: sx * (1400 + 200 * i), drag: 0.05, ease: 'linear', delay: i * 12,
        });
      }
    }
    this.puffs({ x: at.x, y: at.y + r * 0.7 }, 6, r, 0, 90, k);
    this.burst('core', this.tex.spark, [P, 0xffffff], at.x, at.y + r * 0.3, 12, { speed: 900, dir: -Math.PI / 2, spread: 2.4, life: 560, size: 0.5, drag: 0.15, grav: 1600, align: true });
  }

  /** Tier 1 and Tier 2: the finishing hit. Rings off it, extra blades and sparks. */
  finisher(at: Pt, k: number, rings: number): void {
    const S = this.scale;
    const P = this.colors.tier;
    const r = this.dR;
    for (let i = 0; i < Math.min(4, rings); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? this.colors.side : whiten(P, 0.35), at.x, at.y, {
        dur: 340 + 60 * i, from: (r * 0.4) / RING_PX / S, to: (r * (1.6 + 0.7 * i) * k) / RING_PX / S, a0: 0.75, ease: 'cubic', delay: 50 * i,
      });
    }
    this.burst('core', this.tex.spark, [P, 0xffffff, this.colors.side], at.x, at.y, Math.round(8 * k), { speed: 700 * k, dir: this.look.face > 0 ? 0 : Math.PI, spread: 2.2, life: 360, size: 0.5, drag: 0.1, grav: 900, align: true });
  }

  /** Tier 4: the SUPER activates. A cross of white blades on the striker, a bloom and rings in its colour. */
  superFlash(at: Pt): void {
    const S = this.scale;
    const P = this.colors.tier;
    const r = this.aR;
    for (let i = 0; i < 4; i++) {
      this.spawn('core', this.tex.blade, 0xffffff, at.x, at.y, { dur: 380, from: (r * 0.6) / BLADE_W / S, to: (r * (i % 2 ? 2.6 : 4)) / BLADE_W / S, a0: 1, mode: 'punch', peakAt: 0.14, sy: 0.9, rot: (i * Math.PI) / 4 + 0.2 });
    }
    this.spawn('core', this.tex.glow, P, at.x, at.y, { dur: 420, from: (r * 1.2) / GLOW_PX / S, to: (r * 3.6) / GLOW_PX / S, a0: 0.8, mode: 'punch', peakAt: 0.12 });
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', this.tex.ring, i ? 0xffffff : P, at.x, at.y, { dur: 420 + 120 * i, from: (r * 0.8) / RING_PX / S, to: (r * (3.4 + i)) / RING_PX / S, a0: 0.85, ease: 'cubic', delay: 70 * i });
    }
  }

  /** Tier 4: one SPEED LINE racing along the cut-in band (the runner keeps them coming while it holds). */
  bandLine(): void {
    const S = this.scale;
    const { band: b, face, frameW } = this.look;
    const ax = Math.cos(b.rot), ay = Math.sin(b.rot);
    const along = (this.rnd() - 0.5) * frameW * 0.9, across = (this.rnd() - 0.5) * b.h * 0.72;
    const len = b.h * (0.9 + this.rnd() * 1.6);
    const v = (2600 + this.rnd() * 1400) * (b.h / 280) / S;
    this.spawn('core', this.tex.streak, this.rnd() < 0.35 ? this.colors.side : 0xffffff, b.x + ax * along - ay * across, b.y + ay * along + ax * across, {
      dur: 170 + this.rnd() * 80, from: len / STREAK_PX / S, to: (len * 1.3) / STREAK_PX / S, a0: 0.5 + this.rnd() * 0.3, sy: 0.05 + this.rnd() * 0.05, rot: b.rot,
      vx: ax * face * v, vy: ay * face * v, ease: 'linear',
    });
  }

  /**
   * Tier 4: THE WIND-UP (the anticipation before THE impact): light is pulled into the striker over `ms`, a glow swelling on
   * it and rings closing in, so the blow has something to release.
   */
  gather(at: Pt, ms: number): void {
    const S = this.scale;
    const P = this.colors.tier;
    const r = this.aR;
    this.spawn('core', this.tex.glow, P, at.x, at.y, { dur: ms + 60, from: (r * 1.0) / GLOW_PX / S, to: (r * 3.4) / GLOW_PX / S, a0: 0.85, mode: 'punch', peakAt: 0.92, ease: 'linear' });
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: ms + 40, from: (r * 0.5) / GLOW_PX / S, to: (r * 1.7) / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.95, ease: 'linear' });
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? 0xffffff : P, at.x, at.y, {
        dur: ms * 0.5, from: (r * 5) / RING_PX / S, to: (r * 0.9) / RING_PX / S, a0: 0.7, mode: 'punch', peakAt: 0.7, ease: 'cubic', delay: i * ms * 0.2,
      });
    }
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.3;
      const d = r * (3.2 + this.rnd() * 1.6), life = 230 + this.rnd() * 90;
      const sp = (d / S) / (life / 1000) * 1.05;
      this.spawn('core', this.tex.blade, i % 3 ? whiten(P, 0.4) : 0xffffff, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, {
        dur: life, from: (r * 1.3) / BLADE_W / S, to: (r * 0.4) / BLADE_W / S, a0: 0.8, mode: 'punch', peakAt: 0.5, sy: 0.6, rot: a,
        vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, ease: 'linear', delay: (i * 37) % Math.max(1, ms - life),
      });
    }
  }

  /** A whole-screen white flash (bright at once, gone in `ms`). */
  screenFlash(alpha: number, ms = 170): void {
    if (alpha <= 0) return;
    const { frameW, frameH, band } = this.look;
    const S = this.scale;
    const k = (frameW * 1.6) / GLOW_PX / S;
    // The soft glow texture stretched far past the screen: its middle is flat white across the whole view.
    this.spawn('core', this.tex.glow, 0xffffff, band.x, band.y, { dur: ms, from: k * 3, to: k * 3, a0: alpha, sy: Math.max(1, frameH / Math.max(1, frameW)), ease: 'linear' });
  }

  /**
   * Tier 4: THE IMPACT FRAME (the frame a fighting game freezes on a super's connect): the whole screen thrown dark for
   * a blink with a white starburst of blades at the contact, before the flash.
   */
  impactFrame(at: Pt): void {
    const S = this.scale;
    const { frameW, frameH, band } = this.look;
    const tw = Texture.WHITE.width || 1;
    this.spawn('under', Texture.WHITE, 0x000000, band.x, band.y, { dur: 90, from: (frameW * 1.6) / tw / S, to: (frameW * 1.6) / tw / S, a0: 0.8, mode: 'hold', sy: frameH / frameW, ease: 'linear' });
    const r = this.dR;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.15;
      this.spawn('core', this.tex.blade, 0xffffff, at.x, at.y, { dur: 110, from: (r * (i % 2 ? 3 : 5)) / BLADE_W / S, to: (r * (i % 2 ? 3.4 : 6)) / BLADE_W / S, a0: 1, mode: 'hold', sy: 0.8, rot: a, ease: 'linear' });
    }
  }

  /**
   * Tier 4: THE HEAVY BLOW (THE impact): the biggest hit, drive lines blown through the target, a white-hot core, shock
   * rings, and shards thrown wide that arc down under gravity.
   */
  heavy(at: Pt, k: number, rings: number): void {
    const S = this.scale;
    const P = this.colors.tier;
    const r = this.dR;
    const face = this.look.face;
    this.hitFx(at, 'heavy', Math.min(1.9, 0.85 * k));
    this.drive(at, true);
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 200, from: (r * 2) / GLOW_PX / S, to: (r * 5 * k) / GLOW_PX / S, a0: 1, mode: 'punch', peakAt: 0.08 });
    this.spawn('core', this.tex.glow, P, at.x, at.y, { dur: 900, from: (r * 2.2) / GLOW_PX / S, to: (r * 4.4 * k) / GLOW_PX / S, a0: 0.75, ease: 'cubic' });
    for (let i = 0; i < Math.min(7, rings + 1); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? this.colors.side : P, at.x, at.y, {
        dur: 520 + 90 * i, from: (r * 0.5) / RING_PX / S, to: (r * (2.2 + 1.0 * i) * k) / RING_PX / S, a0: 0.9 - 0.1 * i, ease: 'cubic', delay: 60 * i,
      });
    }
    this.burst('core', this.tex.spark, [P, whiten(P, 0.5), 0xffffff], at.x, at.y, Math.round(14 * k), { speed: 1100, dir: face > 0 ? 0 : Math.PI, spread: 2.9, life: 760, size: 0.62, drag: 0.25, grav: 1500, align: true, lift: 260 });
    this.burst('core', this.tex.spark, [0xffffff, whiten(P, 0.5)], at.x, at.y, Math.round(8 * k), { speed: 520, life: 520, size: 0.4, drag: 0.2, align: true });
  }

  /**
   * Tier 4 (and Tier 3's slam): THE AFTERMATH, where the struck portrait comes down (`at`): dust thrown up both ways,
   * embers drifting up and a low glow that takes its time to go. It is what makes the blow linger.
   */
  aftermath(at: Pt, strength = 1): void {
    const S = this.scale;
    const P = this.colors.tier;
    const r = this.dR;
    this.spawn('glow', this.tex.glow, P, at.x, at.y, { dur: 1300 * strength, from: (r * 2.6) / GLOW_PX / S, to: (r * 3.6) / GLOW_PX / S, a0: 0.4 * strength, mode: 'hold', ease: 'cubic' });
    this.spawn('glow', this.tex.ring, this.colors.flash, at.x, at.y + r * 0.6, { dur: 520, from: (r * 0.7) / RING_PX / S, to: (r * 3.4 * strength) / RING_PX / S, a0: 0.7 * strength, sy: 0.34, ease: 'cubic' });
    this.puffs({ x: at.x, y: at.y + r * 0.7 }, Math.round(8 * strength), r, 0, 110, strength);
    this.burst('core', this.tex.spark, [P, whiten(P, 0.5)], at.x, at.y + r * 0.3, Math.round(10 * strength), { speed: 260, dir: -Math.PI / 2, spread: 2.2, life: 1100, size: 0.32, drag: 0.5, grav: -140 });
  }

  /**
   * Tier 4: "K.O." SLAMS IN (a call-out, with its afterimages and its glint): a white flash and a hot bar of light behind
   * it, shock rings off the landing, and sparks knocked out along its length.
   */
  ko(at: Pt, width: number, holdMs = 1750): void {
    if (width <= 0) return;
    const S = this.scale;
    const P = this.colors.tier;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 340, from: (width * 0.9) / GLOW_PX / S, to: (width * 2.4) / GLOW_PX / S, a0: 0.85, mode: 'punch', peakAt: 0.1, sy: 0.5 });
    this.spawn('glow', this.tex.glow, P, at.x, at.y, { dur: holdMs, from: (width * 1.5) / GLOW_PX / S, to: (width * 1.8) / GLOW_PX / S, a0: 0.5, mode: 'hold', sy: 0.42, ease: 'cubic' });
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.ring, i === 1 ? 0xffffff : P, at.x, at.y, { dur: 520 + 110 * i, from: (width * 0.4) / RING_PX / S, to: (width * (1.5 + 0.5 * i)) / RING_PX / S, a0: 0.8 - 0.15 * i, sy: 0.45, ease: 'cubic', delay: 60 * i });
    }
    for (const sx of [-1, 1]) {
      this.burst('core', this.tex.spark, [whiten(P, 0.5), 0xffffff, P], at.x + sx * width * 0.3, at.y + width * 0.12, 7, { speed: 720, dir: sx > 0 ? -0.5 : Math.PI + 0.5, spread: 1.6, life: 620, size: 0.5, drag: 0.25, grav: 1300, align: true });
    }
    this.callout('ko', at, width, holdMs);
  }
}
