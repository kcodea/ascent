/**
 * THE CARD SHARK SCENE: everything Card Shark draws in Pixi, as a plain scene graph with no renderer, so it runs (and is
 * tested) headless. `heroCards.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (the owner's "clean" bar; an Epic is one strong idea): the CARD is the subject. A card is three sprites on
 * one transform (a soft glow in the side colour, additive; the card itself, normal blend so it reads on any board; a
 * flash overlay, additive, for the snap and the gilding) plus two faint GHOSTS sampled back along its flight (a spin
 * smear, not a particle trail). Everything else (the stick flash, sparks, glints, the confetti) is short seasoning.
 *
 * STUCK CARDS ride the struck portrait: the runner reports its knockback each frame (`setFoeOffset`).
 *
 * LAYERS, bottom to top: glow (additive: card glows, rings, blooms) | body (normal: cards, ghosts, confetti) | core
 * (additive: flashes, sparks, glints), so the scene batches in three runs.
 *
 * Contract: sprites are POOLED per layer (hidden and reused) and bounded by `MAX_CARDS_SPRITES`; textures are the
 * caller's (pre-warmed on the GPU during the damage formation, so no first-play spike); positions are the overlay's px;
 * `setCamera` mirrors the DOM camera when the runner asks it to; `update` returns whether anything still draws;
 * `destroy()` leaves nothing behind. Scatter is seeded (a replay throws the same confetti).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutBack, easeOutCubic, easeOutQuint, mixColor, seededRng, type Pt } from '../heroAttack/easing';
import { cardPos, type CardFace, type CardMotion, type FanPose } from './heroCardsConfig';
import { CARD_H, CARD_W } from './heroCardsTextures';

export interface HeroCardsTextures extends HeroArcanaTextures {
  cardBack: Texture;
  cardFaces: Record<CardFace, Texture>;
  /** The card silhouette, blurred, on a padded box. */
  cardGlow: Texture;
  /** The card silhouette, solid, on the same padded box. */
  cardFlash: Texture;
  /** A confetti chip. */
  chip: Texture;
  /** Spade, heart, diamond, club pips (white; tinted). */
  pips: [Texture, Texture, Texture, Texture];
}

export interface CardsColors { ivory: number; red: number; gold: number; ink: number; side: number }

export interface CardLook {
  /** A thrown card's height, px at stage scale 1. */
  length: number;
  /** The card glow (0 = none). */
  glow: number;
  /** The spin ghosts' opacity (0 = none). */
  ghosts: number;
  /** How far a stuck card quivers (radians). */
  quiver: number;
  /** Confetti chips per card in the flush burst. */
  confetti: number;
  /** Confetti gravity (px/s^2 at stage scale 1). */
  gravity: number;
}

/** Hard cap on sprites alive at once (a Big burst peaks around 220). */
export const MAX_CARDS_SPRITES = 600;
/** The spin ghosts per flying card, and how far back each is sampled (ms of flight). */
export const CARD_GHOSTS = 2;
const GHOST_STEP_MS = 16;

type LayerId = 'glow' | 'body' | 'core';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['glow', 'add'], ['body', 'normal'], ['core', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;

type Phase = 'hand' | 'deal' | 'flight' | 'stuck' | 'fall';

interface Card {
  idx: number;
  phase: Phase;
  age: number;
  /** Px per texture px (the length, the size and the stage scale folded in). */
  k: number;
  body: Sprite; glow: Sprite; flash: Sprite; ghosts: Sprite[];
  face: Texture;
  faceUp: boolean;
  m: CardMotion | null;
  /** The hand / deal pose. */
  from: FanPose; to: FanPose; dealMs: number;
  /** Ms into its flip (-1 = not flipping). */
  flip: number; flipMs: number;
  /** Ms into its gilding (-1 = not yet; it starts after `goldDelay`). */
  gold: number; goldDelay: number; goldMs: number;
  glint: Sprite | null;
  /** The gilding flash and glint have played (once per card). */
  gilded: boolean;
  /** The falling-away drift once released. */
  vx: number; vy: number; spin: number; fall: number;
  phaseOff: number;
  x: number; y: number; rot: number;
}

type AlphaMode = 'out' | 'punch';
interface Fx { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number; sy: number; follow: boolean; x: number; y: number }

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  size: number; alpha: number; spin: number;
  /** A confetti flutter (the chip turning over: its x scale swings through zero); 0 = a plain streak spark. */
  flutter: number; ph: number;
  /** A spark: stretched along its velocity. */
  streak: boolean;
}

interface Charge { ring: Sprite; glint: Sprite; x: number; y: number; age: number; dur: number; releasing: number }

export class HeroCardsScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private used = 0;
  private cards: Card[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private charge: Charge | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private fox = 0;
  private foy = 0;
  private readonly rnd: () => number;

  constructor(private readonly tex: HeroCardsTextures, private readonly colors: CardsColors, private readonly look: CardLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroCards';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `cards-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    this.rnd = seededRng(seed);
    // PRE-WARM: one near-invisible sprite per texture while the damage formation plays, so every texture is on the GPU
    // long before the first card needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.spark, t.streak, t.ring, t.star, t.cardBack, t.cardGlow, t.cardFlash, t.chip, ...t.pips, ...Object.values(t.cardFaces)]) {
      const s = this.take('core', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveCards(): number { return this.cards.length; }
  get stuckCards(): number { let n = 0; for (const c of this.cards) if (c.phase === 'stuck') n++; return n; }
  get flyingCards(): number { let n = 0; for (const c of this.cards) if (c.phase === 'flight') n++; return n; }
  get handCards(): number { let n = 0; for (const c of this.cards) if (c.phase === 'hand' || c.phase === 'deal') n++; return n; }
  /** Cards whose faces show gold (fully gilded). */
  get goldCards(): number { let n = 0; for (const c of this.cards) if (c.gold >= c.goldMs) n++; return n; }
  get faceUpCards(): number { let n = 0; for (const c of this.cards) if (c.faceUp) n++; return n; }
  get charging(): boolean { return this.charge !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback this frame (overlay px): stuck cards ride it. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_CARDS_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('cards-', '') ?? 'core') as LayerId;
    s.visible = false; this.freeSprites[layer].push(s); this.used--;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age' | 'x' | 'y'>> & { dur: number; from: number; to: number; a0: number }): Fx | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, follow: false, x, y, ...o };
    s.position.set(x + (f.follow ? this.fox : 0), y + (f.follow ? this.foy : 0));
    s.scale.set(f.from * this.scale, f.from * this.scale * f.sy);
    s.alpha = f.mode === 'punch' ? 0 : f.a0;
    this.fx.push(f);
    return f;
  }

  private sparks(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; life?: number; size?: number; tint?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const s = this.take('core', this.tex.streak, o.tint ?? (i % 3 === 0 ? this.colors.gold : i % 3 === 1 ? 0xffffff : this.colors.side));
      if (!s) return;
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = speed * (0.45 + this.rnd() * 0.75) * S;
      const life = (o.life ?? 260) * (0.7 + this.rnd() * 0.6);
      s.position.set(x, y);
      this.particles.push({ s, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.02, grav: 300 * S, life, max: life, size: (o.size ?? 0.34) * S, alpha: 1, spin: 0, flutter: 0, ph: 0, streak: true });
    }
  }

  private glints(x: number, y: number, n: number, r: number, tint: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, rr = r * (0.3 + this.rnd() * 0.8);
      const f = this.fxs('core', this.tex.star, tint, x + Math.cos(a) * rr, y + Math.sin(a) * rr, { dur: 260 + this.rnd() * 200, from: 0.05, to: 0.28 + this.rnd() * 0.18, a0: 0.95, mode: 'punch', peakAt: 0.3 });
      if (f) f.s.rotation = this.rnd() * Math.PI;
    }
  }

  private newCard(idx: number, face: CardFace, faceUp: boolean, k: number, pose: FanPose): Card | null {
    const body = this.take('body', faceUp ? this.tex.cardFaces[face] : this.tex.cardBack, faceUp ? this.colors.ivory : 0xffffff);
    const glow = this.take('glow', this.tex.cardGlow, this.colors.side);
    const flash = this.take('core', this.tex.cardFlash, 0xffffff);
    if (!body || !glow || !flash) { for (const s of [body, glow, flash]) if (s) this.give(s); return null; }
    flash.alpha = 0;
    const ghosts: Sprite[] = [];
    for (let j = 0; j < CARD_GHOSTS && this.look.ghosts > 0; j++) {
      const g = this.take('body', body.texture, body.tint);
      if (g) { g.alpha = 0; ghosts.push(g); }
    }
    const c: Card = {
      idx, phase: 'hand', age: 0, k, body, glow, flash, ghosts, face: this.tex.cardFaces[face], faceUp, m: null,
      from: pose, to: pose, dealMs: 0, flip: -1, flipMs: 1, gold: -1, goldDelay: 0, goldMs: 1, glint: null, gilded: false,
      vx: 0, vy: 0, spin: 0, fall: -1, phaseOff: this.rnd() * Math.PI * 2, x: pose.x, y: pose.y, rot: pose.rot,
    };
    this.cards.push(c);
    return c;
  }

  private card(idx: number): Card | undefined { return this.cards.find((c) => c.idx === idx); }

  // ── the beats ─────────────────────────────────────────────────────────────────────────────────────────────

  /** The ready: a glint at the hand and a thin ring closing in on it. */
  startCharge(hand: Pt, durMs: number): void {
    const S = this.scale;
    const ring = this.take('glow', this.tex.ring, this.colors.gold);
    const glint = this.take('core', this.tex.star, 0xffffff);
    if (!ring || !glint) { for (const s of [ring, glint]) if (s) this.give(s); return; }
    ring.position.set(hand.x, hand.y); glint.position.set(hand.x, hand.y);
    ring.scale.set(1.1 * S); ring.alpha = 0; glint.scale.set(0.1 * S); glint.alpha = 0;
    this.charge = { ring, glint, x: hand.x, y: hand.y, age: 0, dur: Math.max(60, durMs), releasing: -1 };
  }

  /** Small, Medium: card `idx` appears in the hand, face up, snapping in. */
  hold(idx: number, face: CardFace, pose: FanPose, sizeK: number): void {
    const k = (this.look.length * this.scale * sizeK) / CARD_H;
    const c = this.newCard(idx, face, true, k, pose);
    if (c) c.age = 0;
  }

  /** Big: card `idx` is dealt face down from the hero into its place in the fanned hand. */
  deal(idx: number, face: CardFace, from: Pt, to: FanPose, sizeK: number, dealMs: number): void {
    const k = (this.look.length * this.scale * sizeK) / CARD_H;
    const c = this.newCard(idx, face, false, k, { x: from.x, y: from.y, rot: to.rot - 1.4 });
    if (!c) return;
    c.phase = 'deal'; c.from = { x: from.x, y: from.y, rot: to.rot - 1.4 }; c.to = to; c.dealMs = Math.max(1, dealMs);
  }

  /** Big: card `idx` turns face up. */
  flip(idx: number, flipMs: number): void {
    const c = this.card(idx);
    if (!c) return;
    c.flip = 0; c.flipMs = Math.max(1, flipMs);
  }

  /** Big: every card in the hand turns GOLD, one after another, with a flash and a glint sweeping across it. */
  gild(goldMs: number): void {
    let i = 0;
    for (const c of this.cards) {
      if (c.phase !== 'hand') continue;
      c.gold = 0; c.goldDelay = i * 45; c.goldMs = Math.max(1, goldMs * 0.6);
      i++;
    }
    if (i) {
      const cx = this.cards.reduce((s, c) => s + c.x, 0) / this.cards.length;
      const cy = this.cards.reduce((s, c) => s + c.y, 0) / this.cards.length;
      const k = this.cards[0]!.k;
      this.fxs('glow', this.tex.glow, this.colors.gold, cx, cy, { dur: goldMs + 200, from: (k * CARD_H * 3.2) / 128 / this.scale, to: (k * CARD_H * 3.8) / 128 / this.scale, a0: 0.45, mode: 'punch', peakAt: 0.35 });
    }
  }

  /** Card `idx` leaves on its flight (`late` ms already into it). A card not yet in the hand is created at its start. */
  throw(idx: number, face: CardFace, m: CardMotion, sizeK: number, late = 0): void {
    let c = this.card(idx);
    if (!c) {
      const k = (this.look.length * this.scale * sizeK) / CARD_H;
      c = this.newCard(idx, face, true, k, { x: m.a.x, y: m.a.y, rot: m.rot0 }) ?? undefined;
      if (!c) return;
    }
    if (!c.faceUp) { c.faceUp = true; c.body.texture = c.face; }
    c.flip = -1; c.body.scale.set(c.k);
    c.phase = 'flight'; c.m = m; c.age = Math.max(0, late);
    c.flash.alpha = 0.7;
    for (const g of c.ghosts) g.texture = c.body.texture;
    // A little snap flash where it leaves the hand.
    this.fxs('core', this.tex.glow, 0xffffff, m.a.x, m.a.y, { dur: 140, from: 0.18, to: 0.45, a0: 0.55 });
  }

  /** A card before the last sticks (a tick): a small flash, a slit at the edge, a few sparks. FX only. */
  hit(idx: number, step: number): void {
    const c = this.card(idx);
    if (!c?.m) return;
    const { aim, h } = c.m;
    this.fxs('core', this.tex.glow, 0xffffff, aim.x, aim.y, { dur: 160, from: 0.2, to: 0.55 + 0.05 * step, a0: 0.85, follow: true });
    const slit = this.fxs('core', this.tex.streak, 0xffffff, aim.x, aim.y, { dur: 200, from: 0.6, to: 0.9, a0: 0.9, sy: 0.18, follow: true });
    if (slit) slit.s.rotation = h + Math.PI / 2;
    this.fxs('glow', this.tex.ring, this.colors.side, aim.x, aim.y, { dur: 240, from: 0.12, to: 0.42, a0: 0.6, follow: true });
    this.sparks(aim.x, aim.y, 6 + step * 2, 520, { dir: h + Math.PI, spread: 2.2, life: 220 });
    c.flash.alpha = Math.max(c.flash.alpha, 0.6);
  }

  /** THE impact of Small and Medium: the last card sticks with a bigger flash, a ring and a spray of sparks. */
  impact(idx: number, radius: number, o: { level: number; burst: number; sparks: number; flashAlpha: number }): void {
    const c = this.card(idx);
    if (!c?.m) return;
    const { aim, h } = c.m;
    const S = this.scale;
    const d = (radius * 2) / 128 / S;
    this.fxs('core', this.tex.glow, 0xffffff, aim.x, aim.y, { dur: 220, from: 0.3, to: 0.9 * o.burst, a0: o.flashAlpha, follow: true });
    this.fxs('glow', this.tex.glow, this.colors.gold, aim.x, aim.y, { dur: 320, from: d * 0.4, to: d * 0.9 * o.burst, a0: 0.4, mode: 'punch', peakAt: 0.15, follow: true });
    const slit = this.fxs('core', this.tex.streak, 0xffffff, aim.x, aim.y, { dur: 260, from: 0.8, to: 1.3, a0: 1, sy: 0.2, follow: true });
    if (slit) slit.s.rotation = h + Math.PI / 2;
    this.fxs('glow', this.tex.ring, this.colors.side, aim.x, aim.y, { dur: 320, from: 0.15, to: 0.6 * o.burst, a0: 0.75, follow: true });
    if (o.level >= 2) this.fxs('glow', this.tex.ring, this.colors.gold, aim.x, aim.y, { dur: 420, from: 0.2, to: 0.9 * o.burst, a0: 0.5, follow: true });
    this.sparks(aim.x, aim.y, o.sparks, 640, { dir: h + Math.PI, spread: 2.6, life: 280 });
    this.glints(aim.x, aim.y, 2 + o.level, radius * 0.5, this.colors.gold);
    c.flash.alpha = 1;
  }

  /** Small, Medium: the stuck cards fall away (a small push off the face, a spin, gravity, fading). */
  dissolve(): void {
    const S = this.scale;
    for (const c of this.cards) {
      if (c.phase !== 'stuck' || !c.m) continue;
      c.phase = 'fall'; c.fall = 0;
      c.x = c.m.b.x + this.fox; c.y = c.m.b.y + this.foy; c.rot = c.body.rotation;
      c.vx = -Math.cos(c.m.h) * 70 * S + (this.rnd() - 0.5) * 60 * S;
      c.vy = -Math.sin(c.m.h) * 40 * S - 90 * S;
      c.spin = (this.rnd() - 0.5) * 0.012;
    }
  }

  /**
   * THE impact of the Big flush: the five cards burst into card confetti on the struck hero (chips in ivory, gold, red
   * and ink and the four suit pips, fluttering as they fall), with a gold flash, two rings, a burst of sparks and glints.
   */
  burst(x: number, y: number, radius: number, o: { burst: number; sparks: number; flashAlpha: number }): void {
    const S = this.scale;
    const d = (radius * 2) / 128 / S;
    const L = this.look;
    for (let i = this.cards.length - 1; i >= 0; i--) {
      const c = this.cards[i]!;
      const cx = c.x, cy = c.y;
      this.dropCard(c); this.cards.splice(i, 1);
      const tints = [this.colors.ivory, this.colors.gold, this.colors.gold, this.colors.red, this.colors.ink];
      for (let j = 0; j < L.confetti; j++) {
        const pip = j % 4 === 3;
        const t = pip ? this.tex.pips[(j + i) % 4]! : this.tex.chip;
        const tint = pip ? ((j + i) % 4 === 1 || (j + i) % 4 === 2 ? this.colors.red : this.colors.ink) : tints[(j + i) % tints.length]!;
        const s = this.take('body', t, tint);
        if (!s) break;
        const a = Math.atan2(cy - y, cx - x) + (this.rnd() - 0.5) * 2.6;
        const sp = (380 + this.rnd() * 520) * o.burst * S;
        const life = 700 + this.rnd() * 500;
        s.position.set(cx, cy);
        this.particles.push({
          s, x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 220 * S, drag: 0.08, grav: L.gravity * S, life, max: life,
          size: (pip ? 0.8 : 1.1 + this.rnd() * 0.5) * S, alpha: 1, spin: (this.rnd() - 0.5) * 0.02, flutter: 0.012 + this.rnd() * 0.02, ph: this.rnd() * 6, streak: false,
        });
      }
    }
    this.fxs('core', this.tex.glow, 0xffffff, x, y, { dur: 260, from: d * 0.3, to: d * 0.9 * o.burst, a0: o.flashAlpha });
    this.fxs('glow', this.tex.glow, this.colors.gold, x, y, { dur: 460, from: d * 0.5, to: d * 1.4 * o.burst, a0: 0.55, mode: 'punch', peakAt: 0.12 });
    this.fxs('glow', this.tex.ring, this.colors.gold, x, y, { dur: 420, from: 0.25, to: 1.3 * o.burst, a0: 0.8 });
    this.fxs('glow', this.tex.ring, this.colors.side, x, y, { dur: 560, from: 0.2, to: 1.8 * o.burst, a0: 0.5 });
    this.sparks(x, y, o.sparks, 900, { life: 360, size: 0.4 });
    this.glints(x, y, 7, radius * 1.1, this.colors.gold);
  }

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance everything by `dt` ms. Returns whether anything still draws. */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    const S = this.scale;
    const sec = dt / 1000;
    if (this.warmLeft > 0) {
      this.warmLeft -= dt;
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    const ch = this.charge;
    if (ch) {
      ch.age += dt;
      if (ch.releasing < 0) {
        const u = clamp01(ch.age / ch.dur);
        ch.ring.scale.set((1.1 - 0.85 * easeOutCubic(u)) * S); ch.ring.alpha = 0.5 * Math.min(1, u * 3);
        ch.glint.scale.set((0.1 + 0.35 * u) * S); ch.glint.alpha = 0.9 * u; ch.glint.rotation += dt * 0.006;
        if (u >= 1) ch.releasing = 0;
      } else {
        ch.releasing += dt;
        const r = clamp01(ch.releasing / 180);
        ch.ring.alpha = 0.5 * (1 - r); ch.glint.alpha = 0.9 * (1 - r); ch.glint.scale.set((0.45 + 0.3 * r) * S);
        if (r >= 1) { this.give(ch.ring); this.give(ch.glint); this.charge = null; }
      }
    }

    for (let i = this.cards.length - 1; i >= 0; i--) {
      const c = this.cards[i]!;
      c.age += dt;
      if (c.phase === 'fall') {
        c.fall += dt;
        const damp = Math.pow(0.2, sec);
        c.vx *= damp; c.vy = c.vy * damp + 900 * S * sec;
        c.x += c.vx * sec; c.y += c.vy * sec; c.rot += c.spin * dt;
        if (c.fall >= 380) { this.dropCard(c); this.cards.splice(i, 1); continue; }
      }
      this.drawCard(c, dt);
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      const sc = (q.from + (q.to - q.from) * easeOutQuint(u)) * S;
      q.s.scale.set(sc, sc * q.sy);
      q.s.position.set(q.x + (q.follow ? this.fox : 0), q.y + (q.follow ? this.foy : 0));
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.give(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      p.s.position.set(p.x, p.y);
      if (p.streak) {
        const v = Math.hypot(p.vx, p.vy);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        p.s.scale.set(p.size * (0.6 + Math.min(1.8, v / (700 * S))), p.size * 0.45);
        p.s.alpha = p.alpha * (1 - t);
      } else {
        // Confetti: it turns over as it falls (its x scale swings through zero) and fades out at the very end.
        const age = p.max - p.life;
        p.s.rotation += p.spin * dt;
        p.s.scale.set(p.size * Math.cos(age * p.flutter + p.ph), p.size);
        p.s.alpha = p.alpha * (t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25);
      }
    }

    return this.used > this.warm.length || this.cards.length > 0;
  }

  /** Pose one card: in the hand, being dealt, flying (spinning, with its ghosts), stuck (quivering) or falling away. */
  private drawCard(c: Card, dt: number): void {
    const L = this.look;
    let x = c.x, y = c.y, rot = c.rot;
    let sx = 1;
    let glowA = L.glow * 0.7;
    if (c.phase === 'hand') {
      // Held up, breathing a touch; a fresh card snaps in.
      const bob = Math.sin(c.age * 0.006 + c.phaseOff) * 1.6 * this.scale;
      x = c.to.x; y = c.to.y + bob; rot = c.to.rot;
    } else if (c.phase === 'deal') {
      const u = clamp01(c.age / c.dealMs);
      const e = easeOutCubic(u);
      x = c.from.x + (c.to.x - c.from.x) * e; y = c.from.y + (c.to.y - c.from.y) * e - Math.sin(Math.PI * u) * 30 * this.scale;
      rot = c.from.rot + (c.to.rot - c.from.rot) * e;
      if (u >= 1) {
        c.phase = 'hand'; c.age = 0;
        this.fxs('core', this.tex.glow, 0xffffff, c.to.x, c.to.y, { dur: 120, from: 0.15, to: 0.4, a0: 0.4 });
      }
    } else if (c.phase === 'flight' && c.m) {
      const p = cardPos(c.m, c.age);
      x = p.x; y = p.y; rot = p.rot;
      glowA = L.glow;
      if (c.age >= c.m.flightMs) { c.phase = 'stuck'; c.age = 0; }
    } else if (c.phase === 'stuck' && c.m) {
      // THUNK: a hard quiver about the buried edge that dies fast.
      const q = L.quiver * Math.exp(-c.age / 110) * Math.sin(c.age * 0.16);
      rot = c.m.rot + q;
      // Rotating about the buried edge moves the centre a little sideways.
      const half = CARD_H * c.k * 0.5;
      x = c.m.b.x + this.fox - Math.cos(c.m.h + Math.PI / 2) * Math.sin(q) * half * 0.6;
      y = c.m.b.y + this.foy - Math.sin(c.m.h + Math.PI / 2) * Math.sin(q) * half * 0.6;
      glowA = L.glow * 0.5;
    } else if (c.phase === 'fall') {
      glowA = L.glow * 0.3 * (1 - clamp01(c.fall / 380));
    }
    c.x = x; c.y = y; c.rot = rot;

    // The flip: the card turns over edge-on (its x scale through zero), swapping to its face halfway.
    if (c.flip >= 0) {
      c.flip += dt;
      const u = clamp01(c.flip / c.flipMs);
      sx = Math.max(0.02, Math.abs(Math.cos(Math.PI * u)));
      if (u >= 0.5 && !c.faceUp) { c.faceUp = true; c.body.texture = c.face; c.body.tint = this.colors.ivory; c.flash.alpha = 0.6; }
      if (u >= 1) c.flip = -1;
    }
    // The gilding: the paper warms to gold with a flash, and a glint sweeps corner to corner.
    let goldU = -1;
    if (c.gold >= 0) {
      c.gold += dt;
      goldU = clamp01((c.gold - c.goldDelay) / c.goldMs);
      if (goldU > 0) {
        c.body.tint = mixColor(this.colors.ivory, this.colors.gold, easeOutCubic(goldU));
        if (!c.gilded) {
          c.gilded = true;
          c.glint = this.take('core', this.tex.star, 0xffffff);
          c.flash.alpha = Math.max(c.flash.alpha, 0.85);
        }
      }
    }

    const k = c.k;
    const born = c.phase === 'hand' && c.fall < 0 && c.flip < 0 && c.gold < 0 ? easeOutBack(clamp01(c.age / 140), 1.8) : 1;
    const kk = k * (c.phase === 'hand' && c.age < 140 ? 0.75 + 0.25 * born : 1);
    const fade = c.phase === 'fall' ? 1 - clamp01(c.fall / 380) : 1;
    c.body.position.set(x, y); c.body.rotation = rot; c.body.scale.set(kk * sx, kk); c.body.alpha = fade;
    // The glow and the flash are painted on a padded box at the card's own px, so they take the card's scale.
    const gk = kk;
    c.glow.position.set(x, y); c.glow.rotation = rot; c.glow.scale.set(gk * sx * 1.06, gk * 1.06);
    c.glow.alpha = glowA * fade * (goldU > 0 ? 1.4 : 1);
    if (goldU > 0) c.glow.tint = this.colors.gold;
    c.flash.position.set(x, y); c.flash.rotation = rot; c.flash.scale.set(gk * sx, gk);
    c.flash.alpha = Math.max(0, c.flash.alpha - dt / 180) * fade;
    if (c.glint) {
      const gu = clamp01((c.gold - c.goldDelay) / 240);
      // From the top-left corner to the bottom-right, in the card's own frame.
      const lx = (-0.42 + 0.84 * gu) * CARD_W * kk * sx, ly = (-0.42 + 0.84 * gu) * CARD_H * kk;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      c.glint.position.set(x + lx * cs - ly * sn, y + lx * sn + ly * cs);
      c.glint.scale.set((0.18 + 0.25 * Math.sin(Math.PI * gu)) * this.scale);
      c.glint.alpha = Math.sin(Math.PI * gu);
      c.glint.rotation = gu * 2;
      if (gu >= 1) { this.give(c.glint); c.glint = null; }
    }

    // The spin ghosts: the same card a few ms back along its flight, faint.
    const flying = c.phase === 'flight' && c.m !== null;
    for (let j = 0; j < c.ghosts.length; j++) {
      const g = c.ghosts[j]!;
      if (!flying || !c.m) { g.alpha = 0; continue; }
      const p = cardPos(c.m, Math.max(0, c.age - GHOST_STEP_MS * (j + 1)));
      g.texture = c.body.texture; g.tint = c.body.tint;
      g.position.set(p.x, p.y); g.rotation = p.rot; g.scale.set(kk);
      g.alpha = L.ghosts * (1 - j * 0.45) * clamp01(c.age / 30);
    }
  }

  private dropCard(c: Card): void {
    for (const s of [c.body, c.glow, c.flash, ...c.ghosts]) this.give(s);
    if (c.glint) { this.give(c.glint); c.glint = null; }
    c.ghosts = [];
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const c of this.cards) this.dropCard(c);
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const s of this.warm) this.give(s);
    if (this.charge) { this.give(this.charge.ring); this.give(this.charge.glint); }
    this.cards = []; this.fx = []; this.particles = []; this.warm = []; this.charge = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
