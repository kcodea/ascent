/**
 * THE COMBO SCENE: what the Combo attack ("Flawless") draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. The PORTRAITS are the two fighters (the runner moves
 * both); this draws the fighting game around them. `heroCombo.ts` mounts `root` on the above-portrait overlay.
 *
 * THE HUD (own objects, on their own top layer; written by the runner every frame from the pure state, hidden the moment
 * they are not needed and on every exit):
 *  - THE COMBO COUNTER: pooled digit sprites and a HIT / HITS label, composed from painted textures (no DOM text), with a
 *    scale punch each time it moves and a bigger one when it reads the final number.
 *  - THE SUPER CUT-IN (IV): the screen dim, the slanted band, the striking hero's portrait art on it, the input glyphs.
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the flat hit sparks, the fist, the step's and the launch's dust, the slam,
 * the super's flash and the band's speed lines, the heavy blow and K.O.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { GLYPHS, GLYPH_GAP_MS, type CounterState, type CutinState, type HitKind } from './heroComboConfig';

export interface HeroComboTextures extends HeroArcanaTextures {
  hitLight: Texture;
  hitSharp: Texture;
  hitHeavy: Texture;
  fistR: Texture;
  fistL: Texture;
  arrow: Texture;
  button: Texture;
  band: Texture;
  dust: Texture;
  labelHit: Texture;
  labelHits: Texture;
  wordKo: Texture;
  d0: Texture; d1: Texture; d2: Texture; d3: Texture; d4: Texture; d5: Texture; d6: Texture; d7: Texture; d8: Texture; d9: Texture;
}

export interface ComboColors { spark: number; heavy: number; flash: number; dust: number; side: number }

export interface ComboLook {
  sparkSize: number;
  /** The way the striker faces (+1 = toward +x). */
  face: 1 | -1;
  /** The counter: its centre, a digit's height (px) and how many digit slots (the final number's length). */
  counter: Pt;
  digit: number;
  digits: number;
  /** IV: the cut-in band (centre, length, height, tilt) and the frame it crosses. */
  band: { x: number; y: number; w: number; h: number; rot: number };
  frameW: number;
  frameH: number;
}

/** Hard cap on pooled sprites alive at once (a Tier IV flurry peaks near 120). The HUD's own sprites are outside it. */
export const MAX_COMBO_SPRITES = 260;
const RING_PX = 160;
const GLOW_PX = 128;
const STREAK_PX = 64;
const SPARK_PX = 256;
const FIST_PX = 160;
const GLYPH_PX = 112;
const BAND_W = 512;
const BAND_H = 128;
const PUFF_PX = 96;
const DIGIT_H = 128;
const LABEL_H = 96;
const KO_W = 512;
const CUTIN_H = 288;
/** The counter never needs more digit slots than this (a blow past 9999 is not a thing). */
const MAX_DIGITS = 4;

export class HeroComboScene extends FxPool {
  private readonly hud = new Container();
  private readonly dim: Sprite;
  private readonly band: Sprite;
  private readonly cutin: Sprite | null;
  private readonly glyphs: Sprite[] = [];
  private readonly counter = new Container();
  private readonly digitSprites: Sprite[] = [];
  private readonly label: Sprite;
  private readonly digitTex: Texture[];
  private shown = -1;
  private own = false;

  /** `aR` / `dR`: the striking and the struck portraits' radii (screen px). `cutin`: the striker's portrait panel. */
  constructor(
    private readonly tex: HeroComboTextures, private readonly colors: ComboColors, private readonly look: ComboLook,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1, cutin: Texture | null = null,
  ) {
    super('heroCombo', [
      tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.hitLight, tex.hitSharp, tex.hitHeavy, tex.fistR, tex.fistL, tex.arrow, tex.button, tex.band, tex.dust,
      tex.labelHit, tex.labelHits, tex.wordKo, tex.d0, tex.d1, tex.d2, tex.d3, tex.d4, tex.d5, tex.d6, tex.d7, tex.d8, tex.d9, ...(cutin ? [cutin] : []),
    ], scale, seed, MAX_COMBO_SPRITES);
    this.digitTex = [tex.d0, tex.d1, tex.d2, tex.d3, tex.d4, tex.d5, tex.d6, tex.d7, tex.d8, tex.d9];
    const mk = (parent: Container, t: Texture, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.visible = false; s.eventMode = 'none';
      parent.addChild(s);
      return s;
    };
    this.hud.label = 'heroCombo-hud';
    this.hud.eventMode = 'none';
    this.dim = mk(this.layers.under, Texture.WHITE);
    this.dim.tint = 0x05060c;
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
    this.root.addChild(this.hud);
  }

  /** Whether any own object (the counter, the cut-in) still draws. */
  get ownVisible(): boolean { return this.own; }
  /** What the counter reads on screen right now (-1 = hidden). Tests. */
  get counterValue(): number { return this.counter.visible ? this.shown : -1; }

  // ── the HUD (the runner writes it every frame) ────────────────────────────────────────────────────────────────

  /** The combo counter. Textures are only swapped when the number changes. */
  setCounter(s: CounterState): void {
    if (this.destroyed) return;
    const c = this.counter;
    if (s.alpha <= 0.002) { if (c.visible) { c.visible = false; this.refresh(); } return; }
    if (s.value !== this.shown) {
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
    c.scale.set((s.final ? 1.1 : 1) + punch);
    c.alpha = s.alpha;
    if (!c.visible) { c.visible = true; this.refresh(); }
  }

  /** IV: the super cut-in (null hides it): the dim, the band on its slide, the portrait panel and the input glyphs. */
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

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    this.dim.visible = false; this.band.visible = false; this.counter.visible = false;
    if (this.cutin) this.cutin.visible = false;
    for (const g of this.glyphs) g.visible = false;
    this.own = false;
  }

  private refresh(): void { this.own = this.counter.visible || this.band.visible || this.dim.visible; }

  protected override tick(): boolean { return this.own; }
  protected override clearOwn(): void { this.hideOwn(); }

  override destroy(): void {
    if (this.destroyed) return;
    this.hideOwn();
    const mine = [...this.hud.children, ...this.counter.children];
    super.destroy();
    for (const c of mine) if (!c.destroyed) c.destroy();
  }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /** A HIT SPARK: the flat chunky burst of its kind, a quick flash under it and a few shards thrown back. */
  hitSpark(at: Pt, kind: HitKind, power: number): void {
    const S = this.scale;
    const c = this.colors;
    const t = kind === 'cross' || kind === 'upper' ? this.tex.hitSharp : kind === 'spike' || kind === 'heavy' ? this.tex.hitHeavy : this.tex.hitLight;
    const px = this.dR * (1.15 + 1.05 * power) * this.look.sparkSize;
    const k = px / SPARK_PX / S;
    this.spawn('body', t, 0xffffff, at.x, at.y, { dur: 150 + 110 * power, from: k * 0.45, to: k, a0: 1, mode: 'hold', ease: 'quint', rot: this.rnd() * Math.PI });
    if (kind === 'flurry') return;
    this.spawn('glow', this.tex.glow, c.flash, at.x, at.y, { dur: 150, from: (px * 0.5) / GLOW_PX / S, to: (px * 1.3) / GLOW_PX / S, a0: 0.45, mode: 'punch', peakAt: 0.15 });
    this.burst('core', this.tex.spark, [c.spark, c.flash], at.x, at.y, 2 + Math.round(3 * power), {
      speed: 560, dir: this.look.face > 0 ? Math.PI : 0, spread: 2.4, life: 210, size: 0.42, drag: 0.1, align: true,
    });
  }

  /** The FIST: the jab's fist-shaped spark (and, bigger, the heavy blow's), driving in the way the striker faces. */
  fist(at: Pt, big = false): void {
    const S = this.scale;
    const face = this.look.face;
    const px = this.dR * (big ? 1.7 : 1.2) * this.look.sparkSize;
    const k = px / FIST_PX / S;
    this.spawn('body', face > 0 ? this.tex.fistR : this.tex.fistL, 0xffffff, at.x - face * px * 0.42, at.y, {
      dur: big ? 320 : 210, from: k * 0.7, to: k * 1.06, a0: 1, mode: 'hold', ease: 'quint', vx: face * 120, drag: 0.02,
    });
  }

  /** The step in: a couple of flat dust puffs kicked up behind the striker. */
  stepDust(at: Pt, dirX: number): void {
    const S = this.scale;
    const r = this.aR;
    for (let i = 0; i < 2; i++) {
      this.spawn('body', this.tex.dust, this.colors.dust, at.x - dirX * r * (0.5 + 0.3 * i), at.y + r * 0.6, {
        dur: 300 + 60 * i, from: (r * 0.35) / PUFF_PX / S, to: (r * 0.7) / PUFF_PX / S, a0: 0.9, ease: 'cubic', vx: -dirX * 160, vy: -50, drag: 0.1,
      });
    }
  }

  /** III: the LAUNCH. Speed lines straight up and dust where the target stood. */
  launch(at: Pt): void {
    const S = this.scale;
    const r = this.dR;
    for (const off of [-0.5, 0, 0.5]) {
      this.spawn('glow', this.tex.streak, 0xffffff, at.x + r * off, at.y - r * 0.2, {
        dur: 260, from: (r * 2.2) / STREAK_PX / S, to: (r * 3) / STREAK_PX / S, a0: 0.55, sy: 0.14, rot: -Math.PI / 2, vy: -900, drag: 0.2, ease: 'linear',
      });
    }
    for (const sx of [-1, 1]) {
      this.spawn('body', this.tex.dust, this.colors.dust, at.x + sx * r * 0.4, at.y + r * 0.7, {
        dur: 360, from: (r * 0.4) / PUFF_PX / S, to: (r * 0.8) / PUFF_PX / S, a0: 0.9, ease: 'cubic', vx: sx * 200, vy: -40, drag: 0.08,
      });
    }
  }

  /** III: the SLAM into the socket (THE impact): the heavy spark, flat rings along the ground and dust thrown both ways. */
  slam(at: Pt, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const r = this.dR;
    this.hitSpark(at, 'heavy', Math.max(0.6, k * 0.8));
    for (let i = 0; i < Math.min(6, rings); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.flash, at.x, at.y + r * 0.55, {
        dur: 380 + 70 * i, from: (r * 0.6) / RING_PX / S, to: (r * (2.2 + 0.8 * i) * k) / RING_PX / S, a0: 0.75 - 0.1 * i, sy: 0.36, ease: 'cubic', delay: 50 * i,
      });
    }
    for (let i = 0; i < 6; i++) {
      const sx = i % 2 ? 1 : -1;
      this.spawn('body', this.tex.dust, i % 3 ? c.dust : whiten(c.dust, 0.4), at.x + sx * r * 0.5, at.y + r * 0.7, {
        dur: 420 + this.rnd() * 160, from: (r * 0.4) / PUFF_PX / S, to: (r * 0.85) / PUFF_PX / S, a0: 0.92, mode: 'hold', ease: 'cubic',
        vx: sx * (180 + 90 * i) * k, vy: -60 - this.rnd() * 60, drag: 0.07,
      });
    }
  }

  /** I and II: the last hit of a short combo. Rings off it and a few extra shards. */
  finisher(at: Pt, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const r = this.dR;
    for (let i = 0; i < Math.min(4, rings); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.flash, at.x, at.y, {
        dur: 340 + 60 * i, from: (r * 0.4) / RING_PX / S, to: (r * (1.6 + 0.7 * i) * k) / RING_PX / S, a0: 0.7, ease: 'cubic', delay: 50 * i,
      });
    }
    this.burst('core', this.tex.spark, [c.spark, c.flash, c.side], at.x, at.y, Math.round(6 * k), { speed: 620 * k, dir: this.look.face > 0 ? 0 : Math.PI, spread: 2.2, life: 260, size: 0.45, drag: 0.1, align: true });
  }

  /** IV: the SUPER activates. A white star flash on the striker and rings in its colour. */
  superFlash(at: Pt): void {
    const S = this.scale;
    const c = this.colors;
    const r = this.aR;
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 360, from: 0.8, to: 3.4, a0: 1, mode: 'punch', peakAt: 0.14, rot: 0.2, spin: 0.002 });
    this.spawn('core', this.tex.glow, c.side, at.x, at.y, { dur: 420, from: (r * 1.2) / GLOW_PX / S, to: (r * 3.6) / GLOW_PX / S, a0: 0.8, mode: 'punch', peakAt: 0.12 });
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', this.tex.ring, i ? 0xffffff : c.side, at.x, at.y, { dur: 420 + 120 * i, from: (r * 0.8) / RING_PX / S, to: (r * (3.4 + i)) / RING_PX / S, a0: 0.85, ease: 'cubic', delay: 70 * i });
    }
  }

  /** IV: one SPEED LINE racing along the cut-in band (the runner keeps them coming while it holds). */
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

  /** IV: THE HEAVY BLOW (THE impact): the big red spark, the big fist, rings, speed lines the way it sends the target. */
  heavy(at: Pt, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const r = this.dR;
    const face = this.look.face;
    this.hitSpark(at, 'heavy', Math.min(1.6, 0.7 * k));
    this.fist(at, true);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 260, from: (r * 1.2) / GLOW_PX / S, to: (r * 3.4 * k) / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.1 });
    for (let i = 0; i < Math.min(6, rings); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.heavy, at.x, at.y, {
        dur: 420 + 70 * i, from: (r * 0.5) / RING_PX / S, to: (r * (1.8 + 0.8 * i) * k) / RING_PX / S, a0: 0.8 - 0.1 * i, ease: 'cubic', delay: 55 * i,
      });
    }
    for (let i = 0; i < 6; i++) {
      const y = at.y + (i - 2.5) * r * 0.3;
      this.spawn('glow', this.tex.streak, i % 2 ? c.side : 0xffffff, at.x + face * r * 0.4, y, {
        dur: 240, from: (r * 1.6) / STREAK_PX / S, to: (r * 3) / STREAK_PX / S, a0: 0.6, sy: 0.1, rot: 0, vx: face * 1500, drag: 0.1, ease: 'linear', delay: i * 12,
      });
    }
    this.burst('core', this.tex.spark, [c.heavy, c.spark, 0xffffff], at.x, at.y, Math.round(8 * k), { speed: 760, dir: face > 0 ? 0 : Math.PI, spread: 2.6, life: 320, size: 0.5, drag: 0.1, align: true });
  }

  /** IV: "K.O." SLAMS IN: it starts huge and lands hard at its size, holds, then fades. A white flash behind it. */
  ko(at: Pt, width: number): void {
    if (width <= 0) return;
    const S = this.scale;
    const k = width / KO_W / S;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 300, from: (width * 0.8) / GLOW_PX / S, to: (width * 2) / GLOW_PX / S, a0: 0.7, mode: 'punch', peakAt: 0.1, sy: 0.5 });
    this.spawn('glow', this.tex.ring, this.colors.heavy, at.x, at.y, { dur: 460, from: (width * 0.4) / RING_PX / S, to: (width * 1.5) / RING_PX / S, a0: 0.7, sy: 0.45, ease: 'cubic' });
    this.spawn('body', this.tex.wordKo, 0xffffff, at.x, at.y, { dur: 1150, from: k * 2.9, to: k, a0: 1, mode: 'hold', ease: 'quint', rot: -0.07 });
  }
}
