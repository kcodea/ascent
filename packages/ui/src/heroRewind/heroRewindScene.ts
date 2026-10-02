/**
 * THE REWIND SCENE: everything the Rewind draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so it
 * runs (and is tested) headless. `heroRewind.ts` mounts `root` on the above-portrait overlay, feeds `update(dt)`, and
 * each frame tells it where the story is (`setBolt`, `setHalo`, `setDial`, `setEchoS`).
 *
 * THE BOLT is a comet of golden sand: a warm glow, a bright core, a glitter star, and a ribbon trail drawn along its own
 * path sampled back in STORY time (`RibbonTrail`). Forward, the trail streams behind it and grains fall off it.
 * REWINDING, the runner runs story time backward: the same call draws the same frame at an earlier moment, so the trail
 * LEADS the bolt toward the hand (a reversed film), the glow turns violet, it splits into RGB ghosts (a magenta and a
 * cyan copy either side of it), and grains fly UP into it from where they fell.
 *
 * TIME BREAKING (every rewind): the splash is sucked back into the hit in a spiralling sand VORTEX, a contracting violet
 * ring and the flash re-forming; VHS SCRUB BARS (thin magenta / cyan / gold bands) tear across the board; a faint clock
 * dial spins backward on the target. Back in the hand, sand pours UP into it.
 *
 * THE HALO is the reference art's broken orbital rings round the striking hero (a broken clock ring with hour ticks, a
 * tilted inner orbit with orbs) and, on IV, a clock hand; IV also spins a big clock DIAL on the target. The runner
 * integrates their spin (backward while time rewinds).
 *
 * ECHOES: Tier III's afterimages freeze at the contact and then fly with the last replay (a stutter); Tier IV's freeze in
 * mid flight (trembling) until the finale moves them all to land together. The HOURGLASS forms round the target and
 * SHATTERS: glass shards, a sand explosion, gold and violet shock rings, the dial bursting, and a crystal-sand RAIN.
 *
 * Perf: pooled sprites under a hard cap (fire-and-forget grains, rings, bars, shards); a fixed set of own objects (the
 * bolt and its two split ghosts, the halo, the dial, at most six echoes, the hourglass, the vortex grains) made once and
 * reused; ribbon strips made once; the offset samplers are made once (no closure per frame).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { RibbonTrail } from '../heroAttack/ribbonTrail';
import { BIG_SHARD_PX, FACE_PX, GOD_FEATURES, HALO_PX, HAND_PX, HOURGLASS_H, SHARD_PX, WASH_PX } from './heroRewindTextures';

export interface HeroRewindTextures extends HeroArcanaTextures {
  grain: Texture;
  halo: Texture;
  orbit: Texture;
  clockHand: Texture;
  hourglass: Texture;
  shard: Texture;
  /** God scale: the board-spanning clock face, a big pane of broken glass, a flat white quad (the washes). */
  clockFace: Texture;
  bigShard: Texture;
  wash: Texture;
}

export interface RewindColors { sand: number; sandLight: number; gold: number; violet: number; splitA: number; splitB: number; side: number }

export interface RewindLook {
  /** The bolt head's size, px at stage scale 1. */
  boltPx: number;
  trailWidth: number;
  /** The rewinding bolt's RGB split, px. */
  splitPx: number;
  /** Grains shed (or gathered) per second of flight. */
  grainRate: number;
  /** Tier III: how long the afterimages take to fade after the impact. */
  echoMs: number;
  /** Tier IV: the frozen echoes' tremble, px. */
  echoTremble: number;
  /** The hourglass height, in struck-portrait radii. */
  hourglassSize: number;
  shatterSize: number;
}

/** What the runner tells the scene about the live bolt each frame. */
export interface BoltState {
  /** The bolt's position at story time `ms` (ms since it left the hand). */
  sample: (ms: number) => Pt;
  /** The story time now. */
  s: number;
  /** When it lands (story ms): from there on it is inside the impact and not drawn. */
  flyMs: number;
  /** The trail's span, story ms. */
  span: number;
  /** Story ms per clock ms: 1 forward, negative rewinding. */
  rate: number;
  size: number;
  /** Story ms the torrent keeps DRAINING into the hit after it lands (its tail catching up); rewinding, it un-drains. */
  drain: number;
}

/** Hard cap on sprites alive at once (Tier IV's shatter and rain peak well under it). */
export const MAX_REWIND_SPRITES = 440;
export const MAX_ECHOES = 6;
/** Grains in one vortex (own objects, reused). */
const VORTEX_MAX = 36;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
const BEAM_PX = 64;

interface Echo {
  glow: Sprite; core: Sprite; trail: RibbonTrail;
  /** 'after' holds until it flies or is released; 'flying' is moved by the runner; 'fading' fades by age; 'frozen' trembles until the finale. */
  kind: 'after' | 'flying' | 'fading' | 'frozen';
  pathS: number;
  age: number;
  size: number;
  on: boolean;
  phase: number;
}

interface VortexGrain { s: Sprite; a0: number; r0: number; age: number; dur: number; turns: number; size: number }

export class HeroRewindScene extends FxPool {
  private path: ((s: number) => Pt) | null = null;
  private bolt: {
    glow: Sprite; core: Sprite; star: Sprite; soft: RibbonTrail; body: RibbonTrail;
    ghostA: Sprite; ghostB: Sprite; trailA: RibbonTrail; trailB: RibbonTrail;
  } | null = null;
  private live: BoltState | null = null;
  private grainAcc = 0;
  private charge: { top: Pt; hand: Pt; age: number; dur: number; glow: Sprite | null } | null = null;
  private halo: { ring: Sprite; glow: Sprite; orbitWrap: Container; orbit: Sprite; hand: Sprite } | null = null;
  private haloOn = false;
  private dial: { s: Sprite; glow: Sprite } | null = null;
  private dialOn = false;
  private echoes: Echo[] = [];
  private glass: { s: Sprite; glow: Sprite; at: Pt; age: number; dur: number; k: number } | null = null;
  private vortex: { at: Pt; grains: VortexGrain[] } | null = null;
  /** THE GOD: the Ancient of Time's feathered bust over the board, and its two eyes (gold, violet). */
  private godTex: Texture | null = null;
  private god: { bust: Sprite; glow: Sprite; gold: Sprite; violet: Sprite; aura: Sprite } | null = null;
  private godOn = false;
  /** The stage halo's second clock hand, and the board clock's two hands. */
  private hand2: Sprite | null = null;
  private dialHands: { long: Sprite; short: Sprite } | null = null;
  /** The RGB split's offset this frame (px), read by the two offset samplers below (made once). */
  private splitX = 0;
  private splitY = 0;
  private readonly sampleA = (ms: number): Pt => { const p = this.live!.sample(ms); return { x: p.x + this.splitX, y: p.y + this.splitY }; };
  private readonly sampleB = (ms: number): Pt => { const p = this.live!.sample(ms); return { x: p.x - this.splitX, y: p.y - this.splitY }; };

  constructor(private readonly tex: HeroRewindTextures, private readonly colors: RewindColors, private readonly look: RewindLook, scale = 1, seed = 1) {
    super('heroRewind', [tex.glow, tex.ring, tex.star, tex.spark, tex.beam, tex.grain, tex.halo, tex.orbit, tex.clockHand, tex.hourglass, tex.shard, tex.clockFace, tex.bigShard, tex.wash, tex.ribbonSoft, tex.ribbonBody], scale, seed, MAX_REWIND_SPRITES);
  }

  /** The one strike path (path parameter 0..1), for the echoes. */
  setPath(path: (s: number) => Pt): void { this.path = path; }

  get boltVisible(): boolean { return !!this.bolt && this.bolt.core.visible; }
  get splitVisible(): boolean { return !!this.bolt && this.bolt.ghostA.visible; }
  get liveEchoes(): number { let n = 0; for (const e of this.echoes) if (e.on) n++; return n; }
  get frozenEchoes(): number { let n = 0; for (const e of this.echoes) if (e.on && e.kind === 'frozen') n++; return n; }
  get haloVisible(): boolean { return this.haloOn; }
  get dialVisible(): boolean { return this.dialOn; }
  get hourglassVisible(): boolean { return !!this.glass; }
  get vortexGrains(): number { return this.vortex?.grains.length ?? 0; }
  get godVisible(): boolean { return this.godOn; }

  /** The god's art (null until it has decoded; the attack plays without the apparition until then). */
  setGodTexture(t: Texture | null): void { if (t) this.godTex = t; }

  /**
   * THE GOD over the board: its feathered bust centred on `at`, `h` px tall, mirrored when `flip` (so its pouring hand is
   * on the target's side), at opacity `a`, risen by `rise` px; `flare` (0..1) blazes the eyes (each rewind).
   */
  setGod(at: Pt, h: number, flip: boolean, a: number, rise: number, flare: number, rewinding: boolean): void {
    if (!this.god) {
      if (a <= 0.001 || !this.godTex) return;
      const c = this.colors;
      // The bust twice: once NORMAL (its colour survives the light board) and once ADDITIVE (it glows: a god, not a
      // decal), with a violet aura behind and the two eyes on top.
      const bust = this.take('under', this.godTex, 0xffffff);
      const glow = this.take('glow', this.godTex, 0xffffff);
      const aura = this.take('under', this.tex.glow, c.violet);
      const gold = this.take('core', this.tex.glow, c.gold);
      const violet = this.take('core', this.tex.glow, c.violet);
      if (!bust || !glow || !aura || !gold || !violet) { for (const q of [bust, glow, aura, gold, violet]) this.give(q); return; }
      this.god = { bust, glow, gold, violet, aura };
    }
    const g = this.god;
    const on = a > 0.001;
    this.godOn = on;
    g.bust.visible = g.glow.visible = g.gold.visible = g.violet.visible = g.aura.visible = on;
    if (!on) return;
    const k = h / FACE_PX;
    const sx = flip ? -1 : 1;
    const cy = at.y - rise;
    g.bust.position.set(at.x, cy); g.bust.scale.set(k * sx, k); g.bust.alpha = 0.34 * a;
    g.glow.position.set(at.x, cy); g.glow.scale.set(k * sx, k); g.glow.alpha = (0.3 + 0.25 * flare) * a;
    g.aura.position.set(at.x, cy - h * 0.18); g.aura.scale.set((h * 1.1) / GLOW_PX, (h * 0.8) / GLOW_PX); g.aura.alpha = 0.22 * a * (1 + flare);
    const eye = (f: { x: number; y: number }): Pt => ({ x: at.x + sx * (f.x - 0.5) * h, y: cy + (f.y - 0.5) * h });
    const ge = eye(flip ? GOD_FEATURES.violetEye : GOD_FEATURES.goldEye), ve = eye(flip ? GOD_FEATURES.goldEye : GOD_FEATURES.violetEye);
    const e = (h * (0.09 + 0.16 * flare)) / GLOW_PX;
    g.gold.position.set(ge.x, ge.y); g.gold.scale.set(e * 1.6, e); g.gold.alpha = a * (0.65 + 0.35 * flare);
    g.violet.position.set(ve.x, ve.y); g.violet.scale.set(e * 1.6, e); g.violet.alpha = a * (0.65 + 0.35 * flare);
    // Rewinding, both eyes burn violet-white; forward, one gold and one violet.
    g.gold.tint = rewinding ? whiten(this.colors.violet, 0.4) : this.colors.gold;
    g.violet.tint = rewinding ? whiten(this.colors.violet, 0.4) : this.colors.violet;
  }

  /** Where the god's pouring hand is, for a bust centred on `at`, `h` px tall (pure geometry; see `setGod`). */
  static godHand(at: Pt, h: number, flip: boolean, rise = 0): Pt {
    const sx = flip ? -1 : 1;
    return { x: at.x + sx * (GOD_FEATURES.hand.x - 0.5) * h, y: at.y - rise + (GOD_FEATURES.hand.y - 0.5) * h };
  }

  /** Where the god's head (the halo's centre) is. */
  static godHead(at: Pt, h: number, rise = 0): Pt {
    return { x: at.x, y: at.y - rise + (GOD_FEATURES.head.y - 0.5) * h };
  }

  /** A full-screen colour wash for a beat (time bending the whole board): a flat quad, additive, short. */
  wash(area: { x: number; y: number; w: number; h: number }, tint: number, a: number, ms: number): void {
    const s = this.spawn('glow', this.tex.wash, tint, area.x + area.w / 2, area.y + area.h / 2, {
      dur: ms, from: area.w / WASH_PX / this.scale, to: area.w / WASH_PX / this.scale, sy: area.h / area.w, a0: a, mode: 'punch', peakAt: 0.15, ease: 'linear',
    });
    void s;
  }

  /**
   * THE WHOLE SCREEN SHATTERS like glass (Tier IV): big panes of glass over the whole area burst outward from the impact,
   * spinning, a white flash, then gone (time snapping back).
   */
  screenShatter(area: { x: number; y: number; w: number; h: number }, from: Pt, cols: number, rows: number, strength: number): void {
    const c = this.colors;
    const tints = [0xffffff, whiten(c.violet, 0.6), whiten(c.gold, 0.5), whiten(c.splitB, 0.5)];
    this.wash(area, 0xffffff, 0.55, 220);
    const cw = area.w / cols, rh = area.h / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const x = area.x + (q + 0.2 + this.rnd() * 0.6) * cw;
        const y = area.y + (r + 0.2 + this.rnd() * 0.6) * rh;
        const dx = x - from.x, dy = y - from.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = (500 + 700 * this.rnd()) * strength;
        const size = (Math.min(cw, rh) * (1 + this.rnd() * 0.6)) / BIG_SHARD_PX / this.scale;
        this.spawn('body', this.tex.bigShard, tints[i++ % tints.length]!, x, y, {
          dur: 620 + this.rnd() * 260, from: size, to: size * 0.75, a0: 0.9, mode: 'hold', ease: 'linear',
          vx: (dx / d) * sp, vy: (dy / d) * sp - 120, grav: 900, drag: 0.6, rot: this.rnd() * Math.PI * 2, spin: (this.rnd() - 0.5) * 0.012,
          delay: Math.min(140, d * 0.06),
        });
      }
    }
  }

  /** The god's grip closing (Tier IV): its halo rings clamp down onto the target like a fist, in `ms`. */
  clamp(at: Pt, fromR: number, ms: number): void {
    const c = this.colors;
    this.spawn('glow', this.tex.halo, c.gold, at.x, at.y, { dur: ms, from: (fromR * 2) / (HALO_PX * 0.86), to: 0.15, a0: 0.95, mode: 'hold', ease: 'cubic', spin: -0.01 });
    this.spawn('glow', this.tex.orbit, whiten(c.gold, 0.3), at.x, at.y, { dur: ms, from: (fromR * 2.4) / (HALO_PX * 0.9), to: 0.2, a0: 0.9, mode: 'hold', ease: 'cubic', spin: 0.014, sy: 0.4 });
    this.spawn('glow', this.tex.ring, c.violet, at.x, at.y, { dur: ms, from: (fromR * 1.6) / RING_PX, to: 0.1, a0: 0.8, mode: 'hold', ease: 'cubic' });
  }

  // ── the ready: sand pours down into the hand ─────────────────────────────────────────────────────────────────

  startCharge(hand: Pt, pourPx: number, durMs: number): void {
    if (this.charge) return;
    const glow = this.take('glow', this.tex.glow, this.colors.gold);
    if (glow) { glow.position.set(hand.x, hand.y); glow.alpha = 0; }
    this.charge = { top: { x: hand.x, y: hand.y - pourPx }, hand, age: 0, dur: Math.max(1, durMs), glow };
  }

  private endCharge(): void {
    if (!this.charge) return;
    this.give(this.charge.glow);
    this.charge = null;
  }

  // ── the bolt ─────────────────────────────────────────────────────────────────────────────────────────────────

  private boltObj(): NonNullable<HeroRewindScene['bolt']> | null {
    if (this.bolt) return this.bolt;
    const c = this.colors;
    const glow = this.take('glow', this.tex.glow, c.gold);
    const core = this.take('core', this.tex.glow, c.sandLight);
    const star = this.take('core', this.tex.star, 0xffffff);
    const ghostA = this.take('core', this.tex.glow, c.splitA);
    const ghostB = this.take('core', this.tex.glow, c.splitB);
    if (!glow || !core || !star || !ghostA || !ghostB) { for (const s of [glow, core, star, ghostA, ghostB]) this.give(s); return null; }
    const trailA = new RibbonTrail(this.layers.glow, this.tex.ribbonBody, c.splitA, 'add');
    const trailB = new RibbonTrail(this.layers.glow, this.tex.ribbonBody, c.splitB, 'add');
    // The torrent's body is NORMAL blend (the Arcana lesson: additive washes out on the light board), its core additive.
    const soft = new RibbonTrail(this.layers.body, this.tex.ribbonSoft, c.gold, 'normal');
    const body = new RibbonTrail(this.layers.glow, this.tex.ribbonBody, c.sandLight, 'add');
    this.bolt = { glow, core, star, soft, body, ghostA, ghostB, trailA, trailB };
    for (const s of [glow, core, star, ghostA, ghostB]) s.visible = false;
    return this.bolt;
  }

  /** A throw: a puff of sand and a ring at the hand as the bolt leaves it (a snap, bigger on a replay). */
  launch(hand: Pt, dir: number, k = 1): void {
    this.endCharge();
    const c = this.colors;
    this.spawn('glow', this.tex.glow, c.gold, hand.x, hand.y, { dur: 200, from: 0.3 * k, to: 1 * k, a0: 0.7, mode: 'punch', peakAt: 0.12 });
    const ring = this.spawn('glow', this.tex.ring, c.sandLight, hand.x, hand.y, { dur: 220, from: 0.1, to: 0.5 * k, a0: 0.85, sy: 0.45 });
    if (ring) ring.rotation = dir + Math.PI / 2;
  }

  /** Where the live bolt is this frame (null = no bolt: in the hand, or inside the impact). */
  setBolt(b: BoltState | null): void {
    this.live = b && b.s >= 0 && b.s < b.flyMs + Math.max(0, b.drain) ? b : null;
    if (this.live) this.endCharge();
    const o = this.bolt ?? (this.live ? this.boltObj() : null);
    if (!o) return;
    if (!this.live) {
      for (const s of [o.glow, o.core, o.star, o.ghostA, o.ghostB]) s.visible = false;
      for (const t of [o.soft, o.body, o.trailA, o.trailB]) t.hide();
      return;
    }
    const L = this.live;
    const c = this.colors;
    const S = this.scale;
    const p = L.sample(L.s);
    const rew = L.rate < 0;
    const k = this.look.boltPx * L.size * S;
    // Emerging from the hand / the face: a short grow so it never pops. After landing, the head is gone into the hit and
    // only the torrent's tail is left, draining into it.
    const landed = L.s >= L.flyMs;
    const born = clamp01(L.s / 40) * (landed ? 1 : clamp01((L.flyMs - L.s) / 30 + 0.4));
    const drainA = landed ? 1 - clamp01((L.s - L.flyMs) / Math.max(1, L.drain)) : 1;
    o.glow.visible = o.core.visible = o.star.visible = !landed;
    o.glow.position.set(p.x, p.y); o.glow.scale.set((k * 2.8) / GLOW_PX); o.glow.alpha = 0.75 * born;
    o.glow.tint = rew ? mixColor(c.gold, c.violet, 0.65) : c.gold;
    o.core.position.set(p.x, p.y); o.core.scale.set((k * 0.95) / GLOW_PX); o.core.alpha = born;
    o.core.tint = rew ? whiten(c.violet, 0.65) : c.sandLight;
    o.star.position.set(p.x, p.y); o.star.scale.set((k * 1.5) / STAR_PX); o.star.alpha = 0.9 * born;
    o.star.rotation = L.s * 0.014 * (rew ? -1 : 1);
    // The trail, sampled back in STORY time: forward it streams behind; rewinding the same frame shows it LEADING.
    o.soft.mesh.tint = rew ? mixColor(c.gold, c.violet, 0.75) : c.gold;
    o.body.mesh.tint = rew ? whiten(c.violet, 0.55) : c.sandLight;
    o.soft.draw(L.sample, L.s, L.span, this.look.trailWidth * 2 * L.size * S, 0.85 * born * drainA);
    o.body.draw(L.sample, L.s, L.span * 0.6, this.look.trailWidth * 0.55 * L.size * S, 0.95 * born * drainA);
    // REWINDING: the RGB split, a magenta and a cyan ghost either side of the bolt (and their trails).
    const split = rew && !landed && this.look.splitPx > 0;
    o.ghostA.visible = o.ghostB.visible = split;
    if (split) {
      const q = L.sample(Math.max(0, L.s - 12));
      const dx = p.x - q.x, dy = p.y - q.y;
      const l = Math.hypot(dx, dy) || 1;
      const amp = this.look.splitPx * S * (0.8 + 0.4 * Math.sin(L.s * 0.25));
      this.splitX = (-dy / l) * amp; this.splitY = (dx / l) * amp;
      o.ghostA.position.set(p.x + this.splitX, p.y + this.splitY); o.ghostA.scale.set((k * 1.1) / GLOW_PX); o.ghostA.alpha = 0.8 * born;
      o.ghostB.position.set(p.x - this.splitX, p.y - this.splitY); o.ghostB.scale.set((k * 1.1) / GLOW_PX); o.ghostB.alpha = 0.8 * born;
      o.trailA.draw(this.sampleA, L.s, L.span * 0.7, this.look.trailWidth * 0.5 * L.size * S, 0.7 * born);
      o.trailB.draw(this.sampleB, L.s, L.span * 0.7, this.look.trailWidth * 0.5 * L.size * S, 0.7 * born);
    } else { o.trailA.hide(); o.trailB.hide(); }
  }

  private grains(dt: number): void {
    const L = this.live;
    if (!L || this.look.grainRate <= 0 || L.s >= L.flyMs) return;
    this.grainAcc += (dt / 1000) * this.look.grainRate * (L.rate < 0 ? 1.4 : 1);
    const c = this.colors;
    const tints = [c.sand, c.sandLight, c.gold];
    const S = this.scale;
    while (this.grainAcc >= 1) {
      this.grainAcc -= 1;
      const sz = (0.5 + this.rnd() * 0.6) * L.size;
      if (L.rate >= 0) {
        // Forward: a grain falls off the bolt and drifts down.
        const p = L.sample(L.s);
        this.spawn('core', this.tex.grain, tints[Math.floor(this.rnd() * 3)]!, p.x + (this.rnd() - 0.5) * 14 * S, p.y + (this.rnd() - 0.5) * 14 * S, {
          dur: 360 + this.rnd() * 220, from: sz, to: sz * 0.5, a0: 0.95, ease: 'linear',
          vx: (this.rnd() - 0.5) * 80, vy: -20 + this.rnd() * 40, grav: 520, drag: 0.6,
        });
      } else {
        // Rewinding: a grain flies UP into the path just as the bolt passes that point (a fall, run backward).
        const life = 70 + this.rnd() * 80;
        const target = L.sample(Math.max(0, L.s + L.rate * life));
        const ox = (this.rnd() - 0.5) * 50, oy = 18 + this.rnd() * 40;
        this.spawn('core', this.tex.grain, tints[Math.floor(this.rnd() * 3)]!, target.x + ox * S, target.y + oy * S, {
          dur: life, from: sz * 0.6, to: sz, a0: 0.95, mode: 'punch', peakAt: 0.75, ease: 'linear',
          vx: (-ox / life) * 1000, vy: (-oy / life) * 1000, drag: 1,
        });
      }
    }
  }

  // ── landings, rewinds and the hand ───────────────────────────────────────────────────────────────────────────

  /** A landing: a flash, a star, a shockwave ring (two), a burst of sand. `strength` grows every loop. */
  hit(at: Pt, dir: Pt, strength: number, grains: number): void {
    const c = this.colors;
    const T = strength;
    this.spawn('core', this.tex.glow, whiten(c.sandLight, 0.5), at.x, at.y, { dur: 160, from: (60 * T) / GLOW_PX, to: (170 * T) / GLOW_PX, a0: 0.95, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 280, from: (80 * T) / GLOW_PX, to: (230 * T) / GLOW_PX, a0: 0.75, mode: 'punch', peakAt: 0.12 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 200, from: (50 * T) / STAR_PX, to: (140 * T) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.15, rot: 0.4 });
    this.spawn('glow', this.tex.ring, c.sandLight, at.x, at.y, { dur: 300, from: (24 * T) / RING_PX, to: (190 * T) / RING_PX, a0: 0.9, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 380, from: (20 * T) / RING_PX, to: (260 * T) / RING_PX, a0: 0.55, ease: 'cubic', delay: 40 });
    const back = Math.atan2(-dir.y, -dir.x);
    this.burst('core', this.tex.grain, [c.sand, c.sandLight, c.gold], at.x, at.y, grains, { speed: 420 * T, dir: back, spread: 2.8, life: 520, size: 1 * T, grav: 760, drag: 0.35, to: 0.5, lift: 90 });
  }

  /**
   * A rewind begins at the impact: the splash runs BACKWARD into it over `ms`, sucked up in a spiralling sand VORTEX,
   * with a contracting violet ring and the flash re-forming; a faint clock dial spins backward on the target.
   */
  unsplash(at: Pt, radius: number, ms: number, grains: number, strength: number): void {
    const c = this.colors;
    const d = Math.max(60, ms);
    this.spawn('glow', this.tex.ring, mixColor(c.violet, c.sandLight, 0.25), at.x, at.y, { dur: d, from: (190 * strength) / RING_PX, to: (14 * strength) / RING_PX, a0: 0.9, mode: 'punch', peakAt: 0.25, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.gold, at.x, at.y, { dur: d, from: (60 * strength) / GLOW_PX, to: (150 * strength) / GLOW_PX, a0: 0.7, mode: 'punch', peakAt: 0.9 });
    this.spawn('glow', this.tex.halo, c.violet, at.x, at.y, { dur: d * 2, from: (radius * 2.3) / HALO_PX, to: (radius * 2.0) / HALO_PX, a0: 0.55, mode: 'punch', peakAt: 0.25, spin: -0.02, ease: 'linear' });
    this.startVortex(at, d, Math.min(VORTEX_MAX, grains), strength);
  }

  /** The vortex: grains spiral IN to the hit (own objects; positions solved in `tick`). */
  private startVortex(at: Pt, ms: number, n: number, strength: number): void {
    this.endVortex();
    const c = this.colors;
    const grains: VortexGrain[] = [];
    for (let i = 0; i < n; i++) {
      const s = this.take('core', this.tex.grain, [c.sand, c.sandLight, c.gold, c.violet][i % 4]!);
      if (!s) break;
      const size = (0.6 + this.rnd() * 0.7) * strength;
      grains.push({ s, a0: this.rnd() * Math.PI * 2, r0: (60 + this.rnd() * 90) * strength * this.scale, age: -this.rnd() * ms * 0.2, dur: ms * (0.7 + this.rnd() * 0.3), turns: 0.6 + this.rnd() * 0.6, size });
      s.alpha = 0;
    }
    this.vortex = { at, grains };
  }

  private endVortex(): void {
    if (!this.vortex) return;
    for (const g of this.vortex.grains) { g.s.visible = true; this.give(g.s); }
    this.vortex = null;
  }

  /**
   * VHS SCRUB BARS across the board for `ms`: thin magenta / cyan / gold bands tearing across the strip between the two
   * heroes, sliding as they flicker (pooled sprites; transform and opacity only).
   */
  scrub(area: { x: number; y: number; w: number; h: number }, ms: number, n: number): void {
    const c = this.colors;
    const tints = [c.splitA, c.splitB, c.sandLight, c.violet];
    for (let i = 0; i < n; i++) {
      const w = area.w * (0.5 + this.rnd() * 0.6);
      const hpx = (2 + this.rnd() * 5) * this.scale;
      const x = area.x + area.w * (0.2 + this.rnd() * 0.6);
      const y = area.y + this.rnd() * area.h;
      this.spawn('glow', this.tex.beam, tints[i % tints.length]!, x, y, {
        dur: ms * (0.5 + this.rnd() * 0.5), from: w / BEAM_PX / this.scale, to: (w * 1.1) / BEAM_PX / this.scale, sy: hpx / w, a0: 0.55 + this.rnd() * 0.35,
        mode: 'punch', peakAt: 0.3, ease: 'linear', vy: (this.rnd() - 0.5) * 900, delay: this.rnd() * ms * 0.35,
      });
    }
  }

  /** The bolt is back in the hand: sand pours UP into it; a glint and a small contracting ring. */
  back(hand: Pt, pourPx: number, grains: number): void {
    const c = this.colors;
    this.spawn('core', this.tex.star, c.sandLight, hand.x, hand.y, { dur: 180, from: 0.35, to: 1, a0: 1, mode: 'punch', peakAt: 0.2, rot: 0.3 });
    this.spawn('glow', this.tex.ring, c.violet, hand.x, hand.y, { dur: 180, from: 0.55, to: 0.1, a0: 0.75, ease: 'cubic' });
    for (let i = 0; i < grains; i++) {
      const rise = pourPx * (0.6 + this.rnd() * 0.5);
      const life = 200 + this.rnd() * 120;
      const sz = 0.45 + this.rnd() * 0.5;
      this.spawn('core', this.tex.grain, [c.sand, c.sandLight, c.gold][i % 3]!, hand.x + (this.rnd() - 0.5) * 10 * this.scale, hand.y, {
        dur: life, from: sz, to: sz * 0.6, a0: 0.95, ease: 'linear', delay: this.rnd() * 60,
        vx: (this.rnd() - 0.5) * 20, vy: -(rise / life) * 1000 / this.scale, drag: 1,
      });
    }
  }

  // ── the halo and the dial ────────────────────────────────────────────────────────────────────────────────────

  /** The broken halo round the striking hero: rings at their spin angles, the clock hand (IV), at opacity `a`. */
  setHalo(at: Pt, r: number, rotA: number, rotB: number, handRot: number, a: number, showHand: boolean): void {
    if (!this.halo) {
      if (a <= 0.001) return;
      const c = this.colors;
      const glow = this.take('glow', this.tex.glow, c.violet);
      const ring = this.take('body', this.tex.halo, c.gold);
      const hand = this.take('body', this.tex.clockHand, c.sandLight);
      if (!glow || !ring || !hand) { for (const s of [glow, ring, hand]) this.give(s); return; }
      // The orbit is a tilted ring: a wrapper squashes and tilts it, the sprite inside spins in its own plane (one own
      // sprite, made once, outside the pool: it lives in its own wrapper).
      const orbit = new Sprite(this.tex.orbit);
      orbit.anchor.set(0.5);
      orbit.tint = whiten(c.gold, 0.2);
      const orbitWrap = new Container();
      orbitWrap.label = 'heroRewind-orbit';
      this.layers.body.addChild(orbitWrap);
      orbitWrap.addChild(orbit);
      orbitWrap.scale.set(1, 0.36);
      orbitWrap.rotation = -0.38;
      hand.anchor.set(10 / HAND_PX, 0.5);
      this.halo = { ring, glow, orbitWrap, orbit, hand };
    }
    const h = this.halo;
    const on = a > 0.001;
    this.haloOn = on;
    h.ring.visible = h.glow.visible = h.orbitWrap.visible = on;
    h.hand.visible = on && showHand;
    if (!on) return;
    h.ring.position.set(at.x, at.y); h.ring.scale.set((r * 2) / (HALO_PX * 0.86)); h.ring.rotation = rotA; h.ring.alpha = a;
    h.glow.position.set(at.x, at.y); h.glow.scale.set((r * 2.4) / GLOW_PX); h.glow.alpha = 0.25 * a;
    h.orbitWrap.position.set(at.x, at.y);
    h.orbit.position.set(0, 0); h.orbit.scale.set((r * 2.5) / (HALO_PX * 0.9)); h.orbit.rotation = rotB; h.orbit.alpha = 0.9 * a;
    h.hand.position.set(at.x, at.y); h.hand.scale.set((r * 0.95) / HAND_PX); h.hand.rotation = handRot; h.hand.alpha = a;
    // The short hand (it turns a twelfth as fast).
    if (!this.hand2 && showHand) {
      this.hand2 = this.take('body', this.tex.clockHand, this.colors.gold);
      this.hand2?.anchor.set(10 / HAND_PX, 0.5);
    }
    if (this.hand2) {
      this.hand2.visible = on && showHand;
      this.hand2.position.set(at.x, at.y); this.hand2.scale.set((r * 0.6) / HAND_PX, (r * 0.9) / HAND_PX); this.hand2.rotation = handRot / 12 - 1.2; this.hand2.alpha = a;
    }
  }

  /** Tier IV: the board-spanning CLOCK FACE behind everything, its two hands spinning backward, at opacity `a`. */
  setDial(at: Pt, r: number, rot: number, a: number): void {
    if (!this.dial) {
      if (a <= 0.001) return;
      const s = this.take('under', this.tex.clockFace, this.colors.sandLight);
      const glow = this.take('under', this.tex.glow, this.colors.violet);
      const long = this.take('under', this.tex.clockHand, this.colors.gold);
      const short = this.take('under', this.tex.clockHand, this.colors.sandLight);
      if (!s || !glow || !long || !short) { for (const q of [s, glow, long, short]) this.give(q); return; }
      long.anchor.set(10 / HAND_PX, 0.5); short.anchor.set(10 / HAND_PX, 0.5);
      this.dial = { s, glow };
      this.dialHands = { long, short };
    }
    const on = a > 0.001;
    this.dialOn = on;
    this.dial.s.visible = this.dial.glow.visible = on;
    if (this.dialHands) this.dialHands.long.visible = this.dialHands.short.visible = on;
    if (!on) return;
    this.dial.s.position.set(at.x, at.y); this.dial.s.scale.set((r * 2) / (FACE_PX * 0.94)); this.dial.s.rotation = rot * 0.08; this.dial.s.alpha = 0.5 * a;
    this.dial.glow.position.set(at.x, at.y); this.dial.glow.scale.set((r * 2.4) / GLOW_PX); this.dial.glow.alpha = 0.22 * a;
    if (this.dialHands) {
      const { long, short } = this.dialHands;
      long.position.set(at.x, at.y); long.scale.set((r * 0.9) / HAND_PX, (r * 0.5) / HAND_PX); long.rotation = rot; long.alpha = 0.8 * a;
      short.position.set(at.x, at.y); short.scale.set((r * 0.55) / HAND_PX, (r * 0.65) / HAND_PX); short.rotation = rot / 12 - 0.9; short.alpha = 0.8 * a;
    }
  }

  // ── echoes ───────────────────────────────────────────────────────────────────────────────────────────────────

  private echoAt(i: number): Echo | null {
    if (i < 0 || i >= MAX_ECHOES) return null;
    let e = this.echoes[i];
    if (!e) {
      const c = this.colors;
      const glow = this.take('glow', this.tex.glow, c.gold);
      const core = this.take('core', this.tex.glow, c.sandLight);
      if (!glow || !core) { this.give(glow); this.give(core); return null; }
      const trail = new RibbonTrail(this.layers.glow, this.tex.ribbonSoft, mixColor(c.gold, c.violet, 0.35), 'add');
      e = { glow, core, trail, kind: 'after', pathS: 0, age: 0, size: 1, on: false, phase: this.rnd() * 6 };
      this.echoes[i] = e;
    }
    return e;
  }

  /** Tier III: an afterimage, frozen at the moment of contact (stacked back along the path). */
  afterimage(i: number, pathS: number, size: number): void {
    const e = this.echoAt(i);
    if (!e) return;
    e.kind = 'after'; e.pathS = pathS; e.age = 0; e.size = size; e.on = true;
    this.drawEcho(e, 1, 0);
  }

  /** Tier III's last replay: afterimage `i` flies with the bolt (the runner moves it with `setEchoS`). */
  flyEcho(i: number): void {
    const e = this.echoes[i];
    if (e?.on) e.kind = 'flying';
  }

  /** An echo lands (the stutter): it is spent. */
  consumeEcho(i: number): void {
    const e = this.echoes[i];
    if (e?.on) this.hideEcho(e);
  }

  /** Tier III's impact: any afterimage left fades out over `echoMs`. */
  releaseEchoes(): void {
    for (const e of this.echoes) if (e.on && (e.kind === 'after' || e.kind === 'flying')) { e.kind = 'fading'; e.age = 0; }
  }

  /** Tier IV: an echo shed by the rewinding bolt, frozen in mid flight until the finale. */
  freezeEcho(i: number, pathS: number, size: number): void {
    const e = this.echoAt(i);
    if (!e) return;
    e.kind = 'frozen'; e.pathS = pathS; e.age = 0; e.size = size; e.on = true;
    const p = this.path?.(pathS);
    if (p) {
      const c = this.colors;
      this.spawn('core', this.tex.star, c.sandLight, p.x, p.y, { dur: 200, from: 0.5, to: 1.2, a0: 1, mode: 'punch', peakAt: 0.2 });
      this.spawn('glow', this.tex.ring, c.violet, p.x, p.y, { dur: 240, from: 0.1, to: 0.5, a0: 0.8, ease: 'cubic' });
    }
    this.drawEcho(e, 1, 0);
  }

  /** Move echo `i` to `pathS` along the path (Tier III's stutter, Tier IV's finale). */
  setEchoS(i: number, pathS: number): void {
    const e = this.echoes[i];
    if (!e || !e.on) return;
    e.pathS = pathS;
  }

  /** Every echo bursts into sand (the last impact). */
  burstEchoes(): void {
    const c = this.colors;
    for (const e of this.echoes) {
      if (!e.on) continue;
      const p = this.path?.(e.pathS);
      if (p) this.burst('core', this.tex.grain, [c.sand, c.sandLight, c.violet], p.x, p.y, 6, { speed: 280, life: 480, size: 0.8, grav: 500, drag: 0.4, to: 0.4 });
      this.hideEcho(e);
    }
  }

  private drawEcho(e: Echo, a: number, dt: number): void {
    const path = this.path;
    if (!path) return;
    const S = this.scale;
    let p = path(e.pathS);
    if (e.kind === 'frozen' && this.look.echoTremble > 0) {
      e.phase += dt * 0.05;
      p = { x: p.x + Math.sin(e.phase * 1.7) * this.look.echoTremble * S, y: p.y + Math.cos(e.phase * 2.3) * this.look.echoTremble * S };
    }
    const k = this.look.boltPx * e.size * S;
    const c = this.colors;
    e.glow.position.set(p.x, p.y); e.glow.scale.set((k * 2.2) / GLOW_PX); e.glow.alpha = 0.6 * a;
    e.glow.tint = e.kind === 'frozen' ? mixColor(c.gold, c.violet, 0.5) : c.gold;
    e.core.position.set(p.x, p.y); e.core.scale.set((k * 0.8) / GLOW_PX); e.core.alpha = 0.8 * a;
    e.glow.visible = e.core.visible = a > 0.001;
    const span = e.kind === 'flying' ? 0.24 : 0.16;
    e.trail.draw((ms) => path(ms / 1000), e.pathS * 1000, span * 1000, this.look.trailWidth * 1.6 * e.size * S, 0.5 * a);
  }

  private hideEcho(e: Echo): void {
    e.on = false;
    e.glow.visible = e.core.visible = false;
    e.trail.hide();
  }

  // ── the hourglass and the shatter ─────────────────────────────────────────────────────────────────────────────

  /** Tier IV: the hourglass forms round the target over `ms`. */
  hourglass(at: Pt, radius: number, ms: number): void {
    if (this.glass) return;
    const s = this.take('body', this.tex.hourglass, 0xffffff);
    const glow = this.take('glow', this.tex.glow, this.colors.violet);
    if (!s || !glow) { this.give(s); this.give(glow); return; }
    s.alpha = 0; glow.alpha = 0;
    const k = (radius * this.look.hourglassSize) / HOURGLASS_H;
    this.glass = { s, glow, at, age: 0, dur: Math.max(1, ms), k };
  }

  /**
   * THE impact. I-III: a big landing (flash, star, two shockwave rings, sand), a clock dial flashing forward from II,
   * the afterimages released at III. IV: the hourglass SHATTERS: a white flash, glass shards, a sand explosion, four gold,
   * violet and cyan shock rings, the dial bursting outward, and a crystal-sand RAIN over the board.
   */
  impact(at: Pt, dir: Pt, radius: number, o: { tier: number; grains: number; area: { x: number; y: number; w: number; h: number }; rain: number; screen?: { x: number; y: number; w: number; h: number } }): void {
    const c = this.colors;
    const T = 1.2 + 0.18 * (o.tier - 1);
    this.hit(at, dir, T, o.grains);
    this.spawn('glow', this.tex.glow, whiten(c.sandLight, 0.4), at.x, at.y, { dur: 320, from: (100 * T) / GLOW_PX, to: (300 * T) / GLOW_PX, a0: 0.85, mode: 'punch', peakAt: 0.1 });
    if (o.tier >= 2) {
      this.spawn('glow', this.tex.halo, c.gold, at.x, at.y, { dur: 480, from: (radius * 1.6) / HALO_PX, to: (radius * 3.4) / HALO_PX, a0: 0.8, spin: 0.01, ease: 'cubic' });
      this.spawn('glow', this.tex.ring, c.violet, at.x, at.y, { dur: 420, from: (30 * T) / RING_PX, to: (260 * T) / RING_PX, a0: 0.75, ease: 'cubic', delay: 50 });
    }
    if (o.tier < 4) { this.releaseEchoes(); return; }
    this.burstEchoes();
    // THE HOURGLASS SHATTER.
    const X = this.look.shatterSize;
    const g = this.glass;
    if (g) { this.give(g.s); this.give(g.glow); this.glass = null; }
    this.setDial(at, 0, 0, 0);
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 380, from: (140 * X) / GLOW_PX, to: (520 * X) / GLOW_PX, a0: 1, mode: 'punch', peakAt: 0.06 });
    this.spawn('glow', this.tex.glow, c.violet, at.x, at.y, { dur: 900, from: (180 * X) / GLOW_PX, to: (620 * X) / GLOW_PX, a0: 0.65, mode: 'punch', peakAt: 0.12 });
    [c.sandLight, c.violet, c.gold, c.splitB].forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 560 + i * 130, from: (40 * X) / RING_PX, to: ((380 + i * 140) * X) / RING_PX, a0: 0.95, ease: 'cubic', delay: i * 70 }));
    this.spawn('glow', this.tex.halo, c.gold, at.x, at.y, { dur: 700, from: (radius * 2.2) / HALO_PX, to: (radius * 6 * X) / HALO_PX, a0: 0.9, spin: 0.012, ease: 'cubic' });
    // Glass shards (violet glass, gold frame) and the sand, flung every way.
    this.burst('body', this.tex.shard, [whiten(c.violet, 0.5), 0xffffff, c.gold, whiten(c.violet, 0.2)], at.x, at.y, 18, {
      speed: 1000 * X, life: 900, size: (28 * X) / SHARD_PX, grav: 900, drag: 0.5, spin: 0.04, to: 0.7, lift: 180,
    });
    this.burst('core', this.tex.grain, [c.sand, c.sandLight, c.gold, c.sandLight], at.x, at.y, 60, {
      speed: 860 * X, life: 1000, size: 1.2 * X, grav: 520, drag: 0.4, to: 0.4, lift: 120,
    });
    this.burst('core', this.tex.star, [c.sandLight, c.violet, 0xffffff], at.x, at.y, 12, { speed: 600 * X, life: 600, size: (20 * X) / STAR_PX, drag: 0.3, spin: 0.02 });
    this.burst('under', this.tex.glow, [mixColor(c.sand, c.violet, 0.4)], at.x, at.y, 6, { speed: 170, life: 1100, size: (100 * X) / GLOW_PX, drag: 0.3, to: 1.6, mode: 'hold' });
    this.rain(o.area, o.rain);
    // ...and the WHOLE SCREEN shatters like glass, bursting out from the hit.
    if (o.screen) this.screenShatter(o.screen, at, 6, 4, X);
  }

  /** The crystal-sand rain: glittering grains and a few glints falling across the board after the shatter. */
  private rain(area: { x: number; y: number; w: number; h: number }, n: number): void {
    const c = this.colors;
    for (let i = 0; i < n; i++) {
      const x = area.x + this.rnd() * area.w;
      const y = area.y - 40 * this.scale + this.rnd() * area.h * 0.5;
      const glint = i % 7 === 0;
      const sz = glint ? (10 + this.rnd() * 8) / STAR_PX : 0.6 + this.rnd() * 0.7;
      this.spawn('core', glint ? this.tex.star : this.tex.grain, [c.sandLight, 0xffffff, whiten(c.violet, 0.55), c.sand][i % 4]!, x, y, {
        dur: 900 + this.rnd() * 500, from: sz, to: sz * 0.7, a0: 0.95, mode: 'punch', peakAt: 0.15, ease: 'linear',
        vx: (this.rnd() - 0.5) * 40, vy: 80 + this.rnd() * 120, grav: 380, drag: 0.9, delay: 60 + this.rnd() * 420, spin: glint ? 0.01 : 0,
      });
    }
  }

  // ── the frame ────────────────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    let own = false;
    const ch = this.charge;
    if (ch) {
      own = true;
      ch.age += dt;
      const u = clamp01(ch.age / ch.dur);
      if (ch.glow) { ch.glow.alpha = 0.75 * u; ch.glow.scale.set(((20 + 46 * u) * this.scale) / GLOW_PX); }
      // The pour: grains fall from above into the hand.
      this.grainAcc += (dt / 1000) * Math.max(60, this.look.grainRate);
      const c = this.colors;
      while (this.grainAcc >= 1 && !this.live) {
        this.grainAcc -= 1;
        const fall = ch.hand.y - ch.top.y;
        const life = 200 + this.rnd() * 60;
        const sz = 0.4 + this.rnd() * 0.45;
        this.spawn('core', this.tex.grain, [c.sand, c.sandLight, c.gold][Math.floor(this.rnd() * 3)]!, ch.top.x + (this.rnd() - 0.5) * 6 * this.scale, ch.top.y, {
          dur: life, from: sz, to: sz, a0: 0.95, ease: 'linear', vx: (this.rnd() - 0.5) * 12, vy: (fall / life) * 1000 / this.scale, drag: 1,
        });
      }
    }
    this.grains(dt);
    if (this.live) own = true;
    const v = this.vortex;
    if (v) {
      own = true;
      let alive = 0;
      for (const g of v.grains) {
        g.age += dt;
        if (g.age < 0) { g.s.alpha = 0; alive++; continue; }
        const u = clamp01(g.age / g.dur);
        if (u >= 1) { g.s.alpha = 0; continue; }
        alive++;
        // A spiral: the radius collapses (fast at the end) while the angle winds round.
        const e = u * u;
        const r = g.r0 * (1 - e);
        const a = g.a0 + g.turns * Math.PI * 2 * u;
        g.s.position.set(v.at.x + Math.cos(a) * r, v.at.y + Math.sin(a) * r * 0.85);
        g.s.scale.set(g.size * (0.6 + 0.6 * u) * this.scale);
        g.s.alpha = Math.min(1, u * 4) * (1 - Math.max(0, u - 0.9) * 10);
      }
      if (!alive) this.endVortex();
    }
    for (const e of this.echoes) {
      if (!e.on) continue;
      e.age += dt;
      if (e.kind === 'fading') {
        const u = e.age / Math.max(1, this.look.echoMs);
        if (u >= 1) { this.hideEcho(e); continue; }
        this.drawEcho(e, 0.6 * (1 - u) * (1 - u), dt);
      } else if (e.kind === 'after') {
        this.drawEcho(e, 0.75 * Math.max(0.45, 1 - e.age / 1600), dt);
      } else if (e.kind === 'flying') {
        this.drawEcho(e, 0.9, dt);
      } else {
        this.drawEcho(e, 0.8 + 0.2 * Math.sin(e.age * 0.03 + e.phase), dt);
      }
      own = true;
    }
    const g = this.glass;
    if (g) {
      own = true;
      g.age += dt;
      const u = clamp01(g.age / g.dur);
      const e = 1 - Math.pow(1 - u, 3);
      g.s.position.set(g.at.x, g.at.y);
      g.s.scale.set(g.k * (0.7 + 0.3 * e));
      g.s.alpha = 0.92 * e;
      // It strains as the echoes close in: a tremble that grows.
      g.s.rotation = Math.sin(g.age * 0.06) * 0.05 * u * u;
      g.glow.position.set(g.at.x, g.at.y);
      g.glow.scale.set((g.k * HOURGLASS_H * 1.4) / GLOW_PX);
      g.glow.alpha = 0.4 * e;
    }
    if (this.haloOn || this.dialOn || this.godOn) own = true;
    return own;
  }

  protected override clearOwn(): void {
    this.endCharge();
    this.endVortex();
    this.live = null;
    if (this.bolt) {
      const b = this.bolt;
      for (const s of [b.glow, b.core, b.star, b.ghostA, b.ghostB]) { s.visible = true; this.give(s); }
      for (const t of [b.soft, b.body, b.trailA, b.trailB]) t.hide();
      this.bolt = null;
    }
    if (this.halo) {
      const h = this.halo;
      for (const s of [h.ring, h.glow, h.hand]) { s.visible = true; this.give(s); }
      h.orbitWrap.removeFromParent();
      h.orbitWrap.destroy({ children: true });
      this.halo = null;
      this.haloOn = false;
    }
    if (this.dial) { for (const s of [this.dial.s, this.dial.glow]) { s.visible = true; this.give(s); } this.dial = null; this.dialOn = false; }
    if (this.dialHands) { for (const s of [this.dialHands.long, this.dialHands.short]) { s.visible = true; this.give(s); } this.dialHands = null; }
    if (this.hand2) { this.hand2.visible = true; this.give(this.hand2); this.hand2 = null; }
    if (this.god) { for (const s of [this.god.bust, this.god.glow, this.god.gold, this.god.violet, this.god.aura]) { s.visible = true; this.give(s); } this.god = null; this.godOn = false; }
    for (const e of this.echoes) { this.hideEcho(e); for (const s of [e.glow, e.core]) { s.visible = true; this.give(s); } }
    this.echoes = [];
    if (this.glass) { this.give(this.glass.s); this.give(this.glass.glow); this.glass = null; }
  }
}
