/**
 * THE BLEED SCENE: everything the Bleed ("Hemorrhage") hero attack draws in Pixi, as a plain scene graph with no
 * renderer, so it runs (and is tested) headless. `heroBleed.ts` mounts `root` on the above-portrait overlay and feeds
 * `update(dt)`.
 *
 * Design rule (the owner's Arcana bar: "clean", one readable hero element, never particle soup): the CUT is the
 * subject. A slash is a crimson CRESCENT (a bright core over a crimson body over a bloom, with a few afterimages
 * sampled back along its own path) that flies in, turns to the cut's angle and runs straight through the face. Behind
 * it a white-hot SEAM draws (revealed by stretching, the crescent hiding its leading end), blood SPRAYS off the tip
 * along the blade's direction as it goes, and the line OPENS into a WOUND: a dark gash with a bright red lip. Wounds,
 * stains and drips are the story after; splats and droplets are seasoning, and short.
 *
 * WOUNDS ride the struck portrait: the runner reports the portrait's knockback each frame (`setFoeOffset`) and every
 * wound, drip, stain and the tint over the face move with it, so blood never floats off a portrait that was knocked
 * back.
 *
 * LAYERS, bottom to top: stain (normal: gashes, stains, spatter, drips, the tint over the face, the dark split) | glow
 * (additive: blooms, crescent glows, rings) | body (normal: the crescent body, the wound lips, droplets) | core
 * (additive: crescent cores, seams, flashes, glints), so the scene batches in four runs. No meshes: every piece is a
 * pooled sprite.
 *
 * Contract: sprites are POOLED per layer (hidden and reused) and bounded by `MAX_BLEED_SPRITES`; textures are the
 * caller's (pre-warmed on the GPU during the damage formation, so no first-play spike); positions are the overlay's px;
 * `setCamera` mirrors the DOM camera; `update` returns whether anything still draws; `destroy()` leaves nothing behind.
 * Scatter is seeded (a replay sprays the same droplets).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { megaPos, wavePos, type MegaGeo, type SlashGeo } from './heroBleedConfig';
import { CRESCENT_LEAD, CRESCENT_PX, DRIP_H, GASH_H, GASH_W, SEAM_H, SEAM_W } from './heroBleedTextures';

export interface HeroBleedTextures extends HeroArcanaTextures {
  /** The flying cut: a sharp crescent, bulge toward +X. */
  crescent: Texture;
  crescentGlow: Texture;
  /** The line a cut draws (even along X). */
  seam: Texture;
  seamSoft: Texture;
  /** The wound: a ragged lens, and its bright inner lip. */
  gash: Texture;
  gashLip: Texture;
  /** Blood running down: a thin run ending in a bead (anchored at the top). */
  drip: Texture;
  /** A teardrop, +X aligned. */
  drop: Texture;
  splat: Texture;
  splat2: Texture;
  /** A directional spatter fan toward +X. */
  spray: Texture;
  /** A soft-edged solid disc (the tint over the face). */
  disc: Texture;
  /** A thick shockwave ring. */
  shock: Texture;
}

export interface BleedColors { core: number; bright: number; blood: number; deep: number; side: number }

export interface BleedLook {
  /** The flying crescent's size (x the stage scale). */
  waveSize: number;
  /** Its crimson bloom (0 = none). */
  waveGlow: number;
  /** Afterimages trailing it (0 = none), and their spacing in ms of its flight. */
  afterimages: number;
  afterMs: number;
  /** The seam's width, and the wound's (px at stage scale 1). */
  seamWidth: number;
  gashWidth: number;
  /** Droplets thrown off the tip as a cut draws. */
  spray: number;
  /** Droplets per tick. */
  tickDrops: number;
  /** The crimson tint over the struck face (peak opacity). */
  tint: number;
  /** Droplet gravity (px/s^2 at stage scale 1). */
  gravity: number;
  /** How long a drip takes to run. */
  dripMs: number;
  stainAlpha: number;
  stainMs: number;
  /** Spatter landing round the portrait after the explosion. */
  spatter: number;
  megaWidth: number;
  megaSize: number;
  novaSize: number;
  /** Tier IV: the bloody explosion's scale (on top of the nova size). */
  explosionSize: number;
}

/**
 * Hard cap on sprites alive at once. Tier IV paints the screen in blood (owner 2026-09-29: "it should be hilariously
 * bloody by the end of the combo"): the piled-up spatter from eight zips, every wound, and the explosion peak around 400 live sprites (measured).
 */
export const MAX_BLEED_SPRITES = 1400;

/** The area the blood may land on (overlay px): the screen, or a sandbox box. */
export interface BleedArea { x: number; y: number; w: number; h: number }

type LayerId = 'stain' | 'glow' | 'body' | 'core';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['stain', 'normal'], ['glow', 'add'], ['body', 'normal'], ['core', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const GLOW_PX = 128;
const DISC_PX = 128;
const SHOCK_PX = 256;
const LEAD = CRESCENT_LEAD / CRESCENT_PX;
/** A cut's seam lingers this long after it has drawn. */
const SEAM_FADE_MS = 200;
/** A wound opens over this long once the cut has passed. */
const OPEN_MS = 120;
/** A wound closes over this long. */
const CLOSE_MS = 320;

interface WaveParts { glow: Sprite; body: Sprite; core: Sprite; ghosts: Sprite[] }

interface Wave {
  idx: number;
  g: SlashGeo;
  age: number;
  /** Px per texture px (size, tier and stage scale folded in). */
  k: number;
  parts: WaveParts;
}

interface Wound {
  /** The cut's start (it opens from here along `angle`), in the portrait's resting frame. */
  x: number; y: number; angle: number; len: number;
  /** Thickness px. */
  w: number;
  gash: Sprite; lip: Sprite;
  age: number; drawMs: number;
  /** Ms since the heartbeat flared it (-1 = never). */
  pulse: number;
  /** Ms since the explosion ripped it open (-1 = not yet). */
  rip: number;
  /** Ms into the close (-1 = open). */
  fade: number;
}

interface Cut {
  from: Pt; to: Pt; angle: number; len: number;
  age: number; drawMs: number;
  seam: Sprite; bloom: Sprite; tip: Sprite;
  /** Width multiplier (the impact's cut is bolder). */
  bold: number;
  sprayLeft: number;
  sprayAcc: number;
  /** Droplets per ms of the draw. */
  sprayRate: number;
}

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  /** y scale as a fraction of x (1 = round). */
  sy: number; spin: number; delay: number;
  vx: number; vy: number; drag: number;
  /** Rides the struck portrait (its knockback). */
  follow: boolean;
  x: number; y: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number;
  /** Stretched along its velocity (a droplet). */
  align: boolean;
}

interface Drip { s: Sprite; x: number; y: number; len: number; w: number; age: number; dur: number; delay: number; board?: boolean }

interface Charge { ring: Sprite; glint: Sprite; blade: Sprite; x: number; y: number; hx: number; hy: number; r: number; age: number; dur: number; left: number; releasing: number; heading: number }

interface Wind { glow: Sprite; body: Sprite; core: Sprite; bloom: Sprite; hx: number; hy: number; heading: number; age: number; dur: number; releasing: number }

interface Tension { core: Sprite; ring: Sprite; x: number; y: number; r: number; age: number; dur: number; pulseAcc: number }

interface Mega {
  m: MegaGeo; age: number; dur: number;
  glow: Sprite; body: Sprite; core: Sprite; ghosts: Sprite[];
  seam: Sprite; bloom: Sprite; split: Sprite;
}

export class HeroBleedScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly free: Record<LayerId, Sprite[]>;
  private used = 0;
  private waves: Wave[] = [];
  private cuts: Cut[] = [];
  private wounds: Wound[] = [];
  private drips: Drip[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private charge: Charge | null = null;
  private wind: Wind | null = null;
  private megas: Mega[] = [];
  private tensionS: Tension | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private fox = 0;
  private foy = 0;
  private readonly rnd: () => number;
  /** The tint over a face: blood pushed toward the deep. */
  private readonly sick: number;
  /** A wound's lip: blood lifted toward the bright crimson, so the open flesh reads against the dark edge. */
  private readonly lip: number;

  constructor(private readonly tex: HeroBleedTextures, private readonly colors: BleedColors, private readonly look: BleedLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroBleed';
    this.layers = {} as Record<LayerId, Container>;
    this.free = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `bleed-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.free[id] = [];
    }
    this.rnd = seededRng(seed);
    this.sick = mixColor(colors.blood, colors.deep, 0.35);
    this.lip = mixColor(colors.blood, colors.bright, 0.45);
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first cut or the explosion needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.ring, t.streak, t.star, t.crescent, t.crescentGlow, t.seam, t.seamSoft, t.gash, t.gashLip, t.drip, t.drop, t.splat, t.splat2, t.spray, t.disc, t.shock]) {
      const s = this.take('core', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveWaves(): number { return this.waves.length; }
  get liveWounds(): number { return this.wounds.length; }
  get liveDrips(): number { return this.drips.length; }
  get charging(): boolean { return this.charge !== null; }
  get winding(): boolean { return this.wind !== null; }
  get sweeping(): boolean { return this.megas.length > 0; }
  get liveZips(): number { return this.megas.length; }
  get tense(): boolean { return this.tensionS !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback this frame (overlay px): wounds, drips, stains and the tint ride it. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_BLEED_SPRITES) return null;
    let s = this.free[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('bleed-', '') ?? 'core') as LayerId;
    s.visible = false; this.free[layer].push(s); this.used--;
  }

  private takeAll(specs: readonly [LayerId, Texture, number][]): Sprite[] | null {
    const out: Sprite[] = [];
    for (const [l, t, c] of specs) {
      const s = this.take(l, t, c);
      if (!s) { for (const x of out) this.give(x); return null; }
      out.push(s);
    }
    return out;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age' | 'x' | 'y'>> & { dur: number; from: number; to: number; a0: number }): Fx | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, vx: 0, vy: 0, drag: 1, follow: false, x, y, ...o };
    s.position.set(x + (f.follow ? this.fox : 0), y + (f.follow ? this.foy : 0));
    s.scale.set(f.from * this.scale, f.from * this.scale * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return f;
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = o.align ? Math.atan2(o.vy, o.vx) : this.rnd() * Math.PI * 2;
    this.particles.push({ ...o, s, max: o.life });
  }

  /** Blood droplets flung from a point: teardrops stretched along their flight, falling under gravity. */
  private droplets(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; lift?: number; life?: number; size?: number } = {}): void {
    const S = this.scale;
    const tints = [this.colors.blood, this.colors.bright, mixColor(this.colors.blood, this.colors.deep, 0.4)];
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = speed * (0.4 + this.rnd() * 0.8) * S;
      const sz = (o.size ?? 0.5) * (0.55 + this.rnd() * 0.7);
      this.particle('body', this.tex.drop, tints[i % 3]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 0) * S, drag: 0.35, grav: this.look.gravity * S,
        life: (o.life ?? 520) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.45 * S, alpha: 1, align: true,
      });
    }
  }

  /** The crimson pulse over the struck face (opacity only, kept inside the frame) and a bright bloom at its rim. */
  private tintPulse(x: number, y: number, radius: number, strength: number, dur: number): void {
    const d = (radius * 1.8) / DISC_PX / this.scale;
    this.fxs('stain', this.tex.disc, this.sick, x, y, { dur, from: d * 0.97, to: d, a0: this.look.tint * strength, mode: 'punch', peakAt: 0.16, follow: true });
    const sh = (radius * 2.1) / SHOCK_PX / this.scale;
    this.fxs('glow', this.tex.shock, this.colors.bright, x, y, { dur: dur * 0.9, from: sh * 0.96, to: sh * 1.04, a0: 0.16 * strength, mode: 'punch', peakAt: 0.14, follow: true });
  }

  /** A directional spatter decal off a cut's end, flung along the blade (rides the portrait, holds, fades). */
  private sprayDecal(x: number, y: number, angle: number, size: number, dur: number): void {
    const f = this.fxs('stain', this.tex.spray, this.colors.blood, x, y, { dur, from: 0.3 * size, to: 0.62 * size, a0: 0.9, mode: 'hold', sy: 0.9, follow: true });
    if (f) { f.s.rotation = angle; f.s.anchor.set(0.05, 0.5); }
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The hero readies: a blade is drawn at the striking edge (a thin crescent turning there), a crimson glint gathers
   * and a thin ring closes on the portrait. Held through the swings; released as the LAST crescent leaves.
   */
  startCharge(x: number, y: number, hand: Pt, radius: number, durMs: number, swings: number): void {
    if (this.charge) return;
    const parts = this.takeAll([['glow', this.tex.shock, this.colors.bright], ['core', this.tex.glow, this.colors.bright], ['glow', this.tex.crescentGlow, this.colors.bright]]);
    if (!parts) return;
    const [ring, glint, blade] = parts as [Sprite, Sprite, Sprite];
    ring.position.set(x, y);
    glint.position.set(hand.x, hand.y);
    blade.position.set(hand.x, hand.y);
    blade.anchor.set(LEAD, 0.5);
    for (const s of parts) s.alpha = 0;
    const heading = Math.atan2(hand.y - y, hand.x - x);
    this.charge = { ring, glint, blade, x, y, hx: hand.x, hy: hand.y, r: radius, age: 0, dur: Math.max(1, durMs), left: Math.max(1, swings), releasing: -1, heading };
  }

  /**
   * A swing: a swish arc snaps round the hero's rim and a crimson crescent is loosed along `g`. `age0` = ms already
   * elapsed (a catch-up frame).
   */
  swing(i: number, g: SlashGeo, size: number, age0 = 0): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const c = this.colors;
    const head = Math.atan2(g.c.y - g.a.y, g.c.x - g.a.x);
    // The swish: a crescent swung through ~100 degrees at the rim, fast, and a snap of light.
    const sw = this.fxs('glow', this.tex.crescentGlow, c.bright, g.a.x, g.a.y, { dur: 170, from: 0.55 * size, to: 0.8 * size, a0: 0.8, spin: 0.011 });
    if (sw) { sw.s.rotation = head - 0.9; sw.s.anchor.set(LEAD, 0.5); }
    const sc = this.fxs('core', this.tex.crescent, whiten(c.bright, 0.55), g.a.x, g.a.y, { dur: 140, from: 0.45 * size, to: 0.65 * size, a0: 0.9, sy: 0.7, spin: 0.011 });
    if (sc) { sc.s.rotation = head - 0.9; sc.s.anchor.set(LEAD, 0.5); }
    this.fxs('core', this.tex.glow, c.core, g.a.x, g.a.y, { dur: 110, from: 0.25, to: 0.7, a0: 0.7 });
    const k = (84 / CRESCENT_PX) * this.look.waveSize * size * this.scale;
    const n = Math.max(0, Math.min(5, Math.round(this.look.afterimages)));
    const specs: [LayerId, Texture, number][] = [
      ['glow', this.tex.crescentGlow, mixColor(c.bright, c.side, 0.3)], ['body', this.tex.crescent, c.blood], ['core', this.tex.crescent, whiten(c.bright, 0.7)],
    ];
    for (let j = 0; j < n; j++) specs.push(['glow', this.tex.crescent, c.bright]);
    const parts = this.takeAll(specs);
    if (!parts) return;
    for (const s of parts) { s.anchor.set(LEAD, 0.5); s.alpha = 0; }
    const [glow, body, core, ...ghosts] = parts as [Sprite, Sprite, Sprite, ...Sprite[]];
    this.waves.push({ idx: i, g, age: Math.max(0, age0), k, parts: { glow, body, core, ghosts } });
  }

  /**
   * Cut the face along every line of `g`: the seam draws behind the tip (throwing blood along the blade as it goes)
   * and a wound opens where it has passed. `bold` > 1 for the impact.
   */
  private cutLines(g: SlashGeo, bold: number, spray: number): void {
    g.lines.forEach((ln, j) => {
      const len = Math.hypot(ln.to.x - ln.from.x, ln.to.y - ln.from.y) || 1;
      // A claw rake's lines draw a hair apart (a rake, not one stamp).
      const lag = g.lines.length > 1 ? Math.abs(j - (g.lines.length - 1) / 2) * 18 : 0;
      this.addCut(ln.from, ln.to, g.drawMs * (0.85 + 0.15 * len / Math.max(1, g.len)), bold, spray / g.lines.length, lag, g.lines.length > 1 ? 0.8 : 1);
    });
  }

  /** One cut line: the seam that draws from `from` to `to` over `drawMs` (after `lag`), and the wound it opens. */
  private addCut(from: Pt, to: Pt, drawMs: number, bold: number, spray: number, lag: number, widthMul: number): void {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const parts = this.takeAll([
      ['core', this.tex.seam, whiten(this.colors.core, 1)], ['glow', this.tex.seamSoft, this.colors.bright], ['core', this.tex.glow, this.colors.core],
      ['stain', this.tex.gash, this.colors.deep], ['body', this.tex.gashLip, this.lip],
    ]);
    if (!parts) return;
    const [seam, bloom, tip, gash, lip] = parts as [Sprite, Sprite, Sprite, Sprite, Sprite];
    for (const sp of [seam, bloom, gash, lip]) { sp.anchor.set(0, 0.5); sp.rotation = angle; sp.alpha = 0; }
    tip.alpha = 0;
    this.cuts.push({ from, to, angle, len, age: -lag, drawMs, seam, bloom, tip, bold, sprayLeft: spray, sprayAcc: 0, sprayRate: spray / Math.max(1, drawMs) });
    this.wounds.push({ x: from.x, y: from.y, angle, len, w: this.look.gashWidth * this.scale * (0.85 + 0.25 * bold) * widthMul, gash, lip, age: -lag, drawMs, pulse: -1, rip: -1, fade: -1 });
  }

  /**
   * A cut lands before the last (a tick): the lines draw and open, blood sprays along the blade, a spatter decal is
   * flung off the end, a small splat at the heart of it, a crimson flash and a light pulse over the face.
   */
  hit(g: SlashGeo, x: number, y: number, radius: number, step: number): void {
    const c = this.colors;
    const g1 = 1 + 0.06 * step;
    this.cutLines(g, 1, this.look.spray);
    const f = this.fxs('stain', step % 2 ? this.tex.splat2 : this.tex.splat, mixColor(c.blood, c.deep, 0.3), g.aim.x, g.aim.y, { dur: 520, from: 0.1 * g1, to: 0.3 * g1, a0: 0.85, mode: 'hold', follow: true });
    if (f) f.s.rotation = this.rnd() * Math.PI * 2;
    this.sprayDecal(g.end.x, g.end.y, g.angle, 0.9 * g1, 620);
    this.fxs('glow', this.tex.glow, c.bright, g.aim.x, g.aim.y, { dur: 200, from: 0.45, to: 1.1 * g1, a0: 0.38, mode: 'punch', peakAt: 0.15, follow: true });
    this.droplets(g.end.x, g.end.y, this.look.tickDrops, 480, { dir: g.angle, spread: 1.1, life: 460, size: 0.42, lift: 90 });
    this.tintPulse(x, y, radius, 0.5, 300);
  }

  /**
   * THE impact (I-III): the last cut lands. The first frame is the brightest: a short white-crimson flash over the face,
   * the cut bolder, big crossed splats, rings, arterial streaks off the blade's line, a spray of droplets flung along it
   * and falling, and the strongest pulse over the face. `cross` marks the X (Tier II): a flare where the cuts meet.
   */
  impact(g: SlashGeo, x: number, y: number, radius: number, o: { tier: number; k: number; burst: number; drops: number; flashAlpha: number; cross: boolean }): void {
    const c = this.colors;
    const fs = o.burst;
    const portrait = (radius * 2) / GLOW_PX / this.scale;
    this.cutLines(g, 1.35, this.look.spray * 1.6);
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 110, from: portrait, to: portrait * 1.2, a0: 0.45 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, c.core, g.aim.x, g.aim.y, { dur: 140, from: 0.6 * fs, to: 1.7 * fs, a0: o.flashAlpha, follow: true });
    this.fxs('glow', this.tex.glow, c.bright, g.aim.x, g.aim.y, { dur: 340, from: 1 * fs, to: 2.4 * fs, a0: 0.32 * o.flashAlpha, follow: true });
    if (o.cross) {
      const st = this.fxs('core', this.tex.star, c.core, g.aim.x, g.aim.y, { dur: 300, from: 0.5, to: 1.6 * fs, a0: 1, follow: true, spin: 0.004 });
      if (st) st.s.rotation = Math.PI / 4;
    }
    for (const [t, rr] of [[this.tex.splat, 0], [this.tex.splat2, 1.1]] as const) {
      const f = this.fxs('stain', t, rr ? c.blood : mixColor(c.blood, c.deep, 0.35), g.aim.x, g.aim.y, { dur: 700, from: 0.18 * fs, to: (rr ? 0.5 : 0.62) * fs, a0: 0.92, mode: 'hold', follow: true });
      if (f) f.s.rotation = this.rnd() * Math.PI * 2 + rr;
    }
    this.sprayDecal(g.end.x, g.end.y, g.angle, 1.3 * fs, 800);
    this.fxs('glow', this.tex.ring, c.bright, g.aim.x, g.aim.y, { dur: 300, from: 0.3, to: 1.6 * (0.85 + 0.4 * o.k), a0: 0.45, follow: true });
    // Arterial STREAKS: short bright spurts off the blade's line, fanned forward.
    const spurts = 7;
    for (let s = 0; s < spurts; s++) {
      const a = g.angle + (s / (spurts - 1) - 0.5) * 2.2 + (this.rnd() - 0.5) * 0.2;
      const len = (0.8 + this.rnd() * 0.5) * fs;
      const f = this.fxs('core', this.tex.streak, s % 2 ? c.bright : c.core, g.aim.x + Math.cos(a) * 34 * this.scale * len, g.aim.y + Math.sin(a) * 34 * this.scale * len,
        { dur: 220, from: 1.4 * len, to: 2.6 * len, a0: 0.85, sy: 0.22 });
      if (f) f.s.rotation = a;
    }
    this.droplets(g.end.x, g.end.y, Math.round(o.drops * 0.65), 680, { dir: g.angle, spread: 1.3, life: 720, size: 0.55, lift: 220 });
    this.droplets(g.aim.x, g.aim.y, Math.round(o.drops * 0.35), 380, { life: 600, size: 0.4, lift: 140 });
    this.tintPulse(x, y, radius, 1, 480);
  }

  /** Tier IV: a heartbeat. Every wound flares and throbs, a crimson pulse, a ring pulled in, blood welling from each. */
  beat(x: number, y: number, radius: number, i: number): void {
    const strength = 0.8 + 0.25 * i;
    for (const w of this.wounds) w.pulse = 0;
    this.tintPulse(x, y, radius, strength, 280);
    const sh = (radius * 2) / SHOCK_PX / this.scale;
    this.fxs('glow', this.tex.shock, this.colors.bright, x, y, { dur: 260, from: sh * 1.7, to: sh * 0.95, a0: 0.5 * strength, mode: 'punch', peakAt: 0.3, follow: true });
    for (const w of this.wounds) {
      const mx = w.x + Math.cos(w.angle) * w.len * 0.35, my = w.y + Math.sin(w.angle) * w.len * 0.35;
      this.droplets(mx + this.fox, my + this.foy, 2 + i, 220, { dir: -Math.PI / 2, spread: 2.4, life: 380, size: 0.36, lift: 60 });
    }
  }

  /** Tier IV: the striking hero winds the huge crescent at its hand (it grows, turns back and glows until loosed). */
  windup(hand: Pt, heading: number, durMs: number): void {
    if (this.wind) return;
    const c = this.colors;
    const parts = this.takeAll([
      ['glow', this.tex.crescentGlow, mixColor(c.bright, c.side, 0.3)], ['body', this.tex.crescent, c.blood], ['core', this.tex.crescent, whiten(c.bright, 0.7)], ['glow', this.tex.glow, c.bright],
    ]);
    if (!parts) return;
    const [glow, body, core, bloom] = parts as [Sprite, Sprite, Sprite, Sprite];
    for (const s of [glow, body, core]) s.anchor.set(LEAD, 0.5);
    for (const s of parts) { s.position.set(hand.x, hand.y); s.alpha = 0; }
    this.wind = { glow, body, core, bloom, hx: hand.x, hy: hand.y, heading, age: 0, dur: Math.max(1, durMs), releasing: -1 };
    // Blood drawn in to the hand.
    const S = this.scale;
    for (let j = 0; j < 14; j++) {
      const a = (j / 14) * Math.PI * 2 + this.rnd() * 0.3;
      const r = 150 * S * (0.8 + this.rnd() * 0.5);
      const life = durMs * (0.5 + this.rnd() * 0.4);
      const sp = r / (life / 1000);
      this.particle('body', this.tex.drop, j % 2 ? c.bright : c.blood, {
        x: hand.x + Math.cos(a) * r, y: hand.y + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, drag: 1, grav: 0,
        life, from: 0.42 * S, to: 0.15 * S, alpha: 1, align: true,
      });
    }
  }

  /**
   * Tier IV's MEGA-SLASH, one ZIP of it: a huge crescent sweeps the whole line `m` (it crosses the target half-way), a
   * white seam drawn behind it with a crimson bloom and a dark split beside it, lingering a moment after. Zips overlap
   * freely once they speed up.
   */
  startMega(m: MegaGeo, durMs: number): void {
    const wd = this.wind;
    if (wd && wd.releasing < 0) wd.releasing = 0;
    const c = this.colors;
    const specs: [LayerId, Texture, number][] = [
      ['glow', this.tex.crescentGlow, mixColor(c.bright, c.side, 0.3)], ['body', this.tex.crescent, c.blood], ['core', this.tex.crescent, whiten(c.bright, 0.75)],
      ['core', this.tex.seam, c.core], ['glow', this.tex.seamSoft, c.bright], ['stain', this.tex.seamSoft, c.deep],
    ];
    for (let j = 0; j < 4; j++) specs.push(['glow', this.tex.crescent, c.bright]);
    const parts = this.takeAll(specs);
    if (!parts) return;
    const [glow, body, core, seam, bloom, split, ...ghosts] = parts as [Sprite, Sprite, Sprite, Sprite, Sprite, Sprite, ...Sprite[]];
    for (const s of [glow, body, core, ...ghosts]) s.anchor.set(LEAD, 0.5);
    for (const s of [seam, bloom, split]) { s.anchor.set(0, 0.5); s.rotation = m.angle; }
    for (const s of parts) s.alpha = 0;
    this.megas.push({ m, age: 0, dur: Math.max(1, durMs), glow, body, core, ghosts, seam, bloom, split });
  }

  /**
   * A zip crosses the target (a tick): a fresh gash straight across the face along the zip's line (offset a little
   * each time, so the face fills with them), blood flung down the line both ways, a spatter fan, a flash and a pulse.
   */
  zipCut(angle: number, x: number, y: number, radius: number, i: number): void {
    const c = this.colors;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const off = (((i * 0.618) % 1) - 0.5) * 0.7 * radius;
    const cx = x - dir.y * off, cy = y + dir.x * off;
    const half = radius * 0.78;
    this.addCut({ x: cx - dir.x * half, y: cy - dir.y * half }, { x: cx + dir.x * half, y: cy + dir.y * half }, 45, 1.15, this.look.spray * 0.8, 0, 0.85);
    this.sprayDecal(cx + dir.x * half, cy + dir.y * half, angle, 1 + 0.05 * i, 700);
    this.fxs('core', this.tex.glow, c.core, cx, cy, { dur: 110, from: 0.4, to: 1.1, a0: 0.7, follow: true });
    this.fxs('glow', this.tex.glow, c.bright, cx, cy, { dur: 180, from: 0.6, to: 1.5, a0: 0.3, follow: true });
    this.droplets(cx + dir.x * half * 0.5, cy + dir.y * half * 0.5, this.look.tickDrops, 700, { dir: angle, spread: 0.7, life: 520, size: 0.45, lift: 80 });
    this.droplets(cx - dir.x * half * 0.3, cy - dir.y * half * 0.3, Math.round(this.look.tickDrops * 0.5), 420, { dir: angle + Math.PI, spread: 0.9, life: 420, size: 0.38, lift: 60 });
    this.tintPulse(x, y, radius, 0.45, 220);
  }

  /**
   * Tier IV: a zip FLINGS BLOOD ACROSS THE WHOLE SCREEN along its line: big splats landing along the on-screen half of it
   * (more with every zip as they speed up) that STAY, piling up through the combo until after the explosion (`holdMs`),
   * a few drips running down from them, and a spray of droplets flung back down the line.
   */
  screenBlood(m: MegaGeo, i: number, holdMs: number, area: BleedArea): void {
    const c = this.colors;
    const S = this.scale;
    const dir = { x: Math.cos(m.angle), y: Math.sin(m.angle) };
    const nrm = { x: -dir.y, y: dir.x };
    const n = 7 + 2 * i;
    // Hold ~55% of the life at full, so the pile stays solid until the explosion, then fades out cleanly.
    const dur = Math.max(600, holdMs / 0.55);
    // Only the ON-SCREEN stretch of the line (from the struck hero back to where it leaves the area) gets blood.
    const inArea = (u: number): boolean => {
      const x = m.from.x + (m.to.x - m.from.x) * u, y = m.from.y + (m.to.y - m.from.y) * u;
      return x >= area.x && y >= area.y && x <= area.x + area.w && y <= area.y + area.h;
    };
    let uMin = 0.5;
    while (uMin > 0.02 && inArea(uMin - 0.02)) uMin -= 0.02;
    let landed = 0;
    for (let k = 0; k < n * 4 && landed < n; k++) {
      const u = uMin + this.rnd() * (0.48 - uMin);
      const off = (this.rnd() - 0.5) * 260 * S;
      const x = m.from.x + (m.to.x - m.from.x) * u + nrm.x * off;
      const y = m.from.y + (m.to.y - m.from.y) * u + nrm.y * off;
      if (x < area.x || y < area.y || x > area.x + area.w || y > area.y + area.h) continue;
      landed++;
      const big = 0.55 + this.rnd() * 0.75 + 0.03 * i;
      const tex = landed % 3 === 0 ? this.tex.spray : landed % 2 ? this.tex.splat : this.tex.splat2;
      const f = this.fxs('stain', tex, landed % 4 === 0 ? mixColor(c.blood, c.deep, 0.4) : c.blood, x, y, {
        dur: dur * (0.9 + this.rnd() * 0.2), from: big * 0.55, to: big, a0: 0.88, mode: 'hold', delay: 20 + u * 90,
      });
      if (f) f.s.rotation = tex === this.tex.spray ? m.angle + Math.PI : this.rnd() * Math.PI * 2;
      if (landed % 3 === 1) this.dripAt(x, y + 14 * S * big, (50 + this.rnd() * 90) * S, 120 + this.rnd() * 200);
    }
    // Droplets flung back down the line from the target, over the board.
    const hx = (m.from.x + m.to.x) / 2, hy = (m.from.y + m.to.y) / 2;
    this.droplets(hx, hy, 8 + 2 * i, 1500, { dir: m.angle + Math.PI, spread: 0.5, life: 900, size: 0.7, lift: 120 });
  }

  /** One drip on the board (it does not ride the portrait): blood running down from (x, y). */
  private dripAt(x: number, y: number, len: number, delay: number): void {
    const s = this.take('stain', this.tex.drip, mixColor(this.colors.blood, this.colors.deep, 0.2));
    if (!s) return;
    s.anchor.set(0.5, 0.04);
    s.alpha = 0;
    this.drips.push({ s, x, y, len, w: (1 + this.rnd() * 0.5) * this.scale, age: 0, dur: this.look.dripMs * (1.1 + this.rnd() * 0.5), delay, board: true });
  }

  /**
   * The explosion PAINTS THE SCREEN: big splats flung over the whole board and out to the UI edges (the farther, the
   * later), long spatter streaks, drips running down from the biggest, and a crimson vignette closing in round the edges.
   * All of it holds a moment and fades out cleanly.
   */
  private paintScreen(x: number, y: number, area: BleedArea, size: number): void {
    const c = this.colors;
    const S = this.scale;
    const n = Math.round(30 * size);
    for (let k = 0; k < n; k++) {
      // Spread over the whole area, weighted a little toward the edges.
      const edge = this.rnd() < 0.45;
      const px = edge ? (this.rnd() < 0.5 ? area.x + this.rnd() * area.w * 0.18 : area.x + area.w * (0.82 + this.rnd() * 0.18)) : area.x + this.rnd() * area.w;
      const py = area.y + this.rnd() * area.h;
      const far = Math.hypot(px - x, py - y);
      const big = 0.7 + this.rnd() * 1.1;
      const tex = k % 4 === 0 ? this.tex.spray : k % 2 ? this.tex.splat : this.tex.splat2;
      const f = this.fxs('stain', tex, k % 3 === 0 ? mixColor(c.blood, c.deep, 0.45) : c.blood, px, py, {
        dur: 2600 + this.rnd() * 900, from: big * 0.5, to: big, a0: 0.9, mode: 'hold', delay: 40 + far / (3.2 * S),
      });
      if (f) f.s.rotation = tex === this.tex.spray ? Math.atan2(py - y, px - x) : this.rnd() * Math.PI * 2;
      if (k % 4 === 1) this.dripAt(px, py + 20 * S * big, (70 + this.rnd() * 140) * S, 200 + far / (3.2 * S));
    }
    // The crimson vignette: a thick ring that closes in to sit round the screen's edges.
    const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
    const ringAt = Math.hypot(area.w, area.h) / 2 / (SHOCK_PX * 0.4) / S;
    this.fxs('stain', this.tex.shock, mixColor(c.blood, c.deep, 0.55), cx, cy, { dur: 2400, from: ringAt * 1.6, to: ringAt * 1.05, a0: 0.55, mode: 'hold' });
    this.fxs('glow', this.tex.shock, c.bright, cx, cy, { dur: 1400, from: ringAt * 1.5, to: ringAt * 1.1, a0: 0.25, mode: 'hold' });
  }

  /**
   * Tier IV: the held tension before the explosion (never a freeze). The wounds pulse faster and faster, blood is drawn
   * in to the heart of the face, a crimson core swells there and a ring tightens round it.
   */
  tension(x: number, y: number, radius: number, durMs: number): void {
    if (this.tensionS) return;
    const parts = this.takeAll([['glow', this.tex.glow, this.colors.bright], ['glow', this.tex.shock, this.colors.bright]]);
    if (!parts) return;
    const [core, ring] = parts as [Sprite, Sprite];
    for (const sp of parts) { sp.position.set(x + this.fox, y + this.foy); sp.alpha = 0; }
    this.tensionS = { core, ring, x, y, r: radius, age: 0, dur: Math.max(1, durMs), pulseAcc: 0 };
  }

  private updateTension(dt: number): void {
    const tn = this.tensionS;
    if (!tn) return;
    const S = this.scale;
    tn.age += dt;
    const u = clamp01(tn.age / tn.dur);
    const cx = tn.x + this.fox, cy = tn.y + this.foy;
    const throb = 1 + 0.08 * Math.sin(tn.age * (0.02 + 0.06 * u));
    tn.core.position.set(cx, cy); tn.core.scale.set((0.4 + 1.8 * u * u) * throb * S); tn.core.alpha = 0.15 + 0.55 * u;
    tn.ring.position.set(cx, cy); tn.ring.scale.set(((tn.r * 2) / SHOCK_PX) * (2.4 - 1.3 * easeOutCubic(u))); tn.ring.alpha = 0.5 * Math.min(1, u * 3);
    // The wounds throb, faster and faster; blood is drawn in to the middle on every throb.
    tn.pulseAcc += dt;
    const every = 170 * (1 - 0.6 * u);
    if (tn.pulseAcc >= every) {
      tn.pulseAcc = 0;
      for (const w of this.wounds) w.pulse = 0;
      for (let j = 0; j < 5; j++) {
        const a = this.rnd() * Math.PI * 2, r = tn.r * (1.1 + this.rnd() * 0.7);
        const life = 160 + this.rnd() * 80, sp = r / (life / 1000);
        this.particle('body', this.tex.drop, j % 2 ? this.colors.bright : this.colors.blood, {
          x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, drag: 1, grav: 0,
          life, from: 0.4 * S, to: 0.15 * S, alpha: 1, align: true,
        });
      }
    }
  }

  /**
   * TIER IV's BLOODY EXPLOSION, the biggest thing in the attack roster: every wound RIPS open; a white-red flash core
   * and a crimson wash over the screen; FIVE shockwave rings one after another (dark bands and crimson light
   * alternating); a huge stain over the face; arterial streaks all round; blood thrown HIGH so it rains down over much
   * of the screen; spatter landing on the board out to the edges; and the stain drips.
   */
  explode(x: number, y: number, radius: number, m: MegaGeo | null, o: { burst: number; drops: number; drips: number; flashAlpha: number; toward?: number; area?: BleedArea }): void {
    const tn = this.tensionS;
    if (tn) { this.give(tn.core); this.give(tn.ring); this.tensionS = null; }
    const c = this.colors;
    const S = this.scale;
    const L = this.look;
    const E = L.explosionSize * L.novaSize;
    const fs = o.burst * E;
    const portrait = (radius * 2) / GLOW_PX / S;
    const shock = (radius * 2) / SHOCK_PX / S;
    for (const w of this.wounds) w.rip = 0;
    // The flash core and the crimson wash.
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 170, from: portrait * 1.2, to: portrait * 2.2, a0: 0.95 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 220, from: 1.4 * fs, to: Math.min(7, 3.2 * fs), a0: o.flashAlpha });
    this.fxs('glow', this.tex.glow, c.bright, x, y, { dur: 420, from: 3 * fs, to: Math.min(16, 7 * fs), a0: 0.32 * o.flashAlpha });
    // FIVE shockwaves, one after another.
    for (let j = 0; j < 5; j++) {
      const dark = j % 2 === 0;
      this.fxs(dark ? 'stain' : 'glow', this.tex.shock, dark ? c.deep : c.bright, x, y, {
        dur: 560 + 110 * j, from: shock * 0.5, to: shock * (3.2 + 1.7 * j) * E, a0: dark ? 0.75 : 0.65, delay: j * 75,
      });
    }
    this.fxs('glow', this.tex.ring, c.core, x, y, { dur: 300, from: 0.3, to: 3 * E, a0: 0.7 });
    // The STAIN: huge, over the face, held, then fading.
    const st = this.fxs('stain', this.tex.splat, mixColor(c.blood, c.deep, 0.45), x, y, {
      dur: L.stainMs, from: (radius * 1.4) / 128 / S, to: (radius * 2.3) / 128 / S, a0: L.stainAlpha, mode: 'hold', follow: true,
    });
    if (st) st.s.rotation = this.rnd() * Math.PI * 2;
    const st2 = this.fxs('stain', this.tex.splat2, c.blood, x, y, { dur: L.stainMs * 0.85, from: (radius * 0.9) / 128 / S, to: (radius * 1.6) / 128 / S, a0: L.stainAlpha * 0.85, mode: 'hold', follow: true });
    if (st2) st2.s.rotation = this.rnd() * Math.PI * 2;
    // Arterial streaks all round.
    const along = m ? m.angle : 0;
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2 + (this.rnd() - 0.5) * 0.3;
      const len = (0.8 + this.rnd() * 0.7) * fs * 0.55;
      const f = this.fxs('core', this.tex.streak, k % 2 ? c.bright : c.core, x + Math.cos(a) * 70 * S * len, y + Math.sin(a) * 70 * S * len, { dur: 300, from: 2.4 * len, to: 4.4 * len, a0: 0.9, sy: 0.24 });
      if (f) f.s.rotation = a;
    }
    // BLOOD: thrown HIGH and out over the board (toward the middle of the screen) so it rains down across it, a burst
    // all round, and a heavy spray along the last zip.
    const toward = o.toward ?? Math.PI;
    this.droplets(x, y, Math.round(o.drops * 0.4), 1500 * E, { dir: toward, spread: 1.9, life: 1800, size: 1.05, lift: 1000 * E });
    this.droplets(x, y, Math.round(o.drops * 0.35), 900 * E, { life: 1100, size: 0.8, lift: 380 });
    this.droplets(x, y, Math.round(o.drops * 0.25), 1100 * E, { dir: along, spread: 1.2, life: 1000, size: 0.6, lift: 300 });
    // SPATTER on the board, out toward the edges (the farther, the later).
    const n = Math.max(0, Math.round(L.spatter * 2.2));
    for (let i = 0; i < n; i++) {
      const a = i % 3 === 2 ? this.rnd() * Math.PI * 2 : toward + (this.rnd() - 0.5) * 1.8;
      const r = radius * (1.3 + Math.pow(this.rnd(), 0.8) * 6 * E);
      const sp = i % 3 === 0;
      const f = this.fxs('stain', sp ? this.tex.spray : i % 2 ? this.tex.splat2 : this.tex.splat, mixColor(c.blood, c.deep, 0.25), x + Math.cos(a) * r, y + Math.sin(a) * r, {
        dur: 1400 + this.rnd() * 800, from: 0.16, to: 0.32 + this.rnd() * 0.3, a0: 0.88, mode: 'hold', delay: 60 + (r / radius) * 55,
      });
      if (f) f.s.rotation = sp ? a : this.rnd() * Math.PI * 2;
    }
    if (o.area) this.paintScreen(x, y, o.area, E / 1.6);
    this.tintPulse(x, y, radius, 1.6, 900);
    // The stain drips, a lot.
    this.dripsFrom(x, y, radius, o.drips, 140, true);
  }

  /** An arterial spurt after the explosion (IV): a small splat, a streak, a ring and a flick of droplets upward. */
  spurt(x: number, y: number, size: number, angle: number): void {
    const f = this.fxs('stain', this.tex.splat2, this.colors.blood, x, y, { dur: 420, from: 0.1 * size, to: 0.32 * size, a0: 0.9, mode: 'hold', follow: true });
    if (f) f.s.rotation = this.rnd() * Math.PI * 2;
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 110, from: 0.3 * size, to: 0.75 * size, a0: 0.6 });
    this.fxs('glow', this.tex.ring, this.colors.bright, x, y, { dur: 280, from: 0.15, to: 0.85 * size, a0: 0.8 });
    const sk = this.fxs('core', this.tex.streak, this.colors.bright, x + Math.cos(angle) * 30 * this.scale, y + Math.sin(angle) * 30 * this.scale, { dur: 200, from: 1.6 * size, to: 2.8 * size, a0: 0.8, sy: 0.22 });
    if (sk) sk.s.rotation = angle;
    this.droplets(x, y, 8, 520, { dir: angle, spread: 0.8, life: 560, size: 0.45, lift: 180 });
  }

  /** The wounds keep BLEEDING (I-III): drips run down the portrait from along the wounds, and a crimson pulse. */
  bleed(x: number, y: number, radius: number, drips: number): void {
    this.tintPulse(x, y, radius, 0.65, 520);
    const open = this.wounds.filter((w) => w.fade < 0);
    if (!open.length) { this.dripsFrom(x, y, radius, drips, 0, false); return; }
    for (let i = 0; i < drips; i++) {
      const w = open[i % open.length]!;
      const u = 0.15 + this.rnd() * 0.6;
      const sx = w.x + Math.cos(w.angle) * w.len * u, sy = w.y + Math.sin(w.angle) * w.len * u;
      this.drip(sx, sy, y + radius * 0.86 - sy, 60 + i * 110 + this.rnd() * 80);
    }
  }

  /** Drips from across the upper face (the explosion's stain, or a bleed with no wounds left). */
  private dripsFrom(x: number, y: number, radius: number, n: number, delay0: number, wide: boolean): void {
    for (let i = 0; i < n; i++) {
      const sx = x + (this.rnd() - 0.5) * radius * (wide ? 1.3 : 0.9);
      const sy = y - radius * (0.1 + this.rnd() * 0.35);
      this.drip(sx, sy, y + radius * 0.86 - sy, delay0 + i * 90 + this.rnd() * 120);
    }
  }

  /** One drip: blood that runs from (x, y) down `room` px (at most), slowly then faster, then thins away. */
  private drip(x: number, y: number, room: number, delay: number): void {
    const S = this.scale;
    const len = Math.max(8 * S, Math.min(room, (40 + this.rnd() * 55) * S));
    const s = this.take('stain', this.tex.drip, this.rnd() < 0.5 ? this.colors.blood : mixColor(this.colors.blood, this.colors.deep, 0.3));
    if (!s) return;
    s.anchor.set(0.5, 0.04);
    s.alpha = 0;
    this.drips.push({ s, x, y, len, w: (0.8 + this.rnd() * 0.4) * S, age: 0, dur: this.look.dripMs * (0.8 + this.rnd() * 0.4), delay });
  }

  /** I-III: the wounds close (they narrow and fade). */
  close(): void { for (const w of this.wounds) if (w.fade < 0) w.fade = 0; }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;
    const S = this.scale;

    if (this.warm.length) {
      this.warmLeft -= Math.max(dt, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    this.updateCharge(dt);
    this.updateWind(dt);
    for (let i = this.megas.length - 1; i >= 0; i--) if (!this.updateMega(this.megas[i]!, dt)) this.megas.splice(i, 1);
    this.updateTension(dt);

    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]!;
      w.age += dt;
      if (!this.drawWave(w)) { this.dropWave(w); this.waves.splice(i, 1); }
    }

    for (let i = this.cuts.length - 1; i >= 0; i--) {
      const c = this.cuts[i]!;
      c.age += dt;
      if (!this.drawCut(c, dt)) { for (const s of [c.seam, c.bloom, c.tip]) this.give(s); this.cuts.splice(i, 1); }
    }

    for (let i = this.wounds.length - 1; i >= 0; i--) {
      const w = this.wounds[i]!;
      w.age += dt;
      if (w.pulse >= 0) w.pulse += dt;
      if (w.rip >= 0) w.rip += dt;
      if (w.fade >= 0) w.fade += dt;
      if (!this.drawWound(w)) { this.give(w.gash); this.give(w.lip); this.wounds.splice(i, 1); }
    }

    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i]!;
      if (d.delay > 0) { d.delay -= dt; if (d.delay > 0) continue; }
      d.age += dt;
      const u = clamp01(d.age / d.dur);
      // It wells, runs (fastest in the middle), slows at the end; the tail thins and it fades over the last quarter.
      const run = easeInOutSine(Math.min(1, u * 1.25));
      d.s.position.set(d.x + (d.board ? 0 : this.fox), d.y + (d.board ? 0 : this.foy));
      d.s.scale.set(d.w * (1 - 0.25 * u), (6 * S + d.len * run) / DRIP_H);
      d.s.alpha = Math.min(1, u * 8) * (u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25);
      if (u >= 1) { this.give(d.s); this.drips.splice(i, 1); }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      if (q.vx || q.vy) {
        const damp = Math.pow(q.drag, sec);
        q.vx *= damp; q.vy *= damp;
        q.x += q.vx * sec; q.y += q.vy * sec;
      }
      const sc = (q.from + (q.to - q.from) * easeOutQuint(u)) * S;
      q.s.scale.set(sc, sc * q.sy);
      q.s.position.set(q.x + (q.follow ? this.fox : 0), q.y + (q.follow ? this.foy : 0));
      if (q.spin) q.s.rotation += q.spin * dt * (1 - 0.6 * u);
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45)
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
      const sc = p.from + (p.to - p.from) * t;
      p.s.position.set(p.x, p.y);
      if (p.align) {
        const v = Math.hypot(p.vx, p.vy);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        p.s.scale.set(sc * (1 + Math.min(1.6, v / (900 * S))), sc);
      } else p.s.scale.set(sc);
      p.s.alpha = p.alpha * (1 - t * t);
    }

    return this.used > this.warm.length;
  }

  private updateCharge(dt: number): void {
    const ch = this.charge;
    if (!ch) return;
    const S = this.scale;
    ch.age += dt;
    const u = clamp01(ch.age / ch.dur);
    if (ch.releasing < 0) {
      const e = easeOutCubic(u);
      ch.ring.scale.set(((ch.r * 2) / SHOCK_PX) * (1.9 - 0.75 * e)); ch.ring.alpha = 0.3 * Math.min(1, u * 3);
      const throb = 1 + 0.12 * Math.sin(ch.age * (0.03 + 0.05 * u));
      ch.glint.scale.set((0.25 + 0.4 * e) * throb * S); ch.glint.alpha = 0.3 + 0.55 * u;
      // The blade is drawn: a thin crescent turning back from the heading as it is raised.
      ch.blade.scale.set((0.28 + 0.2 * e) * S * this.look.waveSize, (0.28 + 0.2 * e) * S * this.look.waveSize * 0.8);
      ch.blade.rotation = ch.heading - 0.2 - 0.9 * e;
      ch.blade.alpha = 0.75 * e;
    } else {
      ch.releasing += dt;
      const r = clamp01(ch.releasing / 180);
      ch.ring.alpha = 0.3 * (1 - r);
      ch.glint.scale.set((0.65 + 0.5 * r) * S); ch.glint.alpha = 0.85 * (1 - r);
      ch.blade.alpha = 0.75 * (1 - r);
      if (r >= 1) { for (const s of [ch.ring, ch.glint, ch.blade]) this.give(s); this.charge = null; }
    }
  }

  private updateWind(dt: number): void {
    const wd = this.wind;
    if (!wd) return;
    const S = this.scale;
    const L = this.look;
    wd.age += dt;
    const u = clamp01(wd.age / wd.dur);
    const e = easeOutCubic(u);
    const size = (0.4 + 0.75 * e) * S * L.waveSize * (84 / CRESCENT_PX) * 1.5;
    const throb = 1 + 0.06 * Math.sin(wd.age * (0.02 + 0.06 * u));
    // Raised and turned back, trembling a little as the power builds.
    const rot = wd.heading - 0.3 - 1.2 * e + 0.03 * u * Math.sin(wd.age * 0.09);
    let alpha = Math.min(1, u * 2.5);
    if (wd.releasing >= 0) { wd.releasing += dt; alpha *= 1 - clamp01(wd.releasing / 150); }
    for (const s of [wd.glow, wd.body, wd.core]) { s.rotation = rot; s.scale.set(size * throb, size * throb * 0.9); }
    wd.glow.alpha = alpha * L.waveGlow * (0.6 + 0.4 * u);
    wd.body.alpha = alpha * 0.9;
    wd.core.alpha = alpha * (0.6 + 0.4 * u);
    wd.bloom.scale.set((0.8 + 1.6 * e) * throb * S); wd.bloom.alpha = alpha * (0.15 + 0.3 * u);
    if (wd.releasing >= 150) { for (const s of [wd.glow, wd.body, wd.core, wd.bloom]) this.give(s); this.wind = null; }
  }

  /** Pose one zip. False once it has lingered out (its sprites given back). */
  private updateMega(mg: Mega, dt: number): boolean {
    const S = this.scale;
    const L = this.look;
    mg.age += dt;
    const u = clamp01(mg.age / mg.dur);
    const m = mg.m;
    const p = megaPos(m, u);
    const k = (84 / CRESCENT_PX) * L.megaSize * S;
    const headA = u < 1 ? 1 : 1 - clamp01((mg.age - mg.dur) / 110);
    for (const s of [mg.glow, mg.body, mg.core]) { s.position.set(p.x, p.y); s.rotation = m.angle; s.scale.set(k, k * 1.15); }
    mg.glow.alpha = headA * L.waveGlow;
    mg.body.alpha = headA * 0.95;
    mg.core.alpha = headA;
    mg.ghosts.forEach((g, j) => {
      const q = megaPos(m, u - (j + 1) * 0.05);
      g.position.set(q.x, q.y); g.rotation = m.angle; g.scale.set(k * (1 - 0.08 * (j + 1)), k * 1.15 * (1 - 0.08 * (j + 1)));
      g.alpha = headA * 0.4 * (1 - j / mg.ghosts.length) * (u > (j + 1) * 0.05 ? 1 : 0);
    });
    // The seam drawn behind the head: white-hot, a crimson bloom, and the dark split just beside it (flat, offset).
    const drawn = m.span * u;
    const linger = clamp01((mg.age - mg.dur) / 340);
    const thin = 1 - 0.7 * linger;
    const nx = -Math.sin(m.angle), ny = Math.cos(m.angle);
    mg.seam.position.set(m.from.x, m.from.y); mg.seam.scale.set(drawn / SEAM_W, (L.megaWidth * S * 0.8 * thin) / SEAM_H * 2.2); mg.seam.alpha = 1 - linger;
    mg.bloom.position.set(m.from.x, m.from.y); mg.bloom.scale.set(drawn / SEAM_W, (L.megaWidth * S * 3 * thin) / SEAM_H); mg.bloom.alpha = 0.7 * (1 - linger);
    mg.split.position.set(m.from.x + nx * L.megaWidth * S * 0.7, m.from.y + ny * L.megaWidth * S * 0.7);
    mg.split.scale.set(drawn / SEAM_W, (L.megaWidth * S * 1.4 * thin) / SEAM_H); mg.split.alpha = 0.55 * (1 - linger);
    if (linger >= 1) {
      for (const s of [mg.glow, mg.body, mg.core, mg.seam, mg.bloom, mg.split, ...mg.ghosts]) this.give(s);
      return false;
    }
    return true;
  }

  /** Pose one crescent: in flight (turning to the cut), running through the face, then fading. False when gone. */
  private drawWave(w: Wave): boolean {
    const g = w.g;
    const L = this.look;
    const through = g.flightMs + g.drawMs;
    const gone = w.age - through;
    if (gone >= 100) return false;
    const p = wavePos(g, w.age);
    const born = clamp01(w.age / 50);
    const alpha = gone > 0 ? 1 - gone / 100 : 1;
    // It stretches as it bites through the face.
    const cutting = w.age >= g.flightMs ? 1 : 0;
    const k = w.k * (0.75 + 0.25 * born) * (1 + 0.15 * cutting);
    const P = w.parts;
    for (const s of [P.glow, P.body, P.core]) { s.position.set(p.x, p.y); s.rotation = p.rot; s.scale.set(k, k * (1 + 0.12 * cutting)); }
    P.glow.scale.set(k * 1.05, k * 1.3);
    P.glow.alpha = alpha * L.waveGlow;
    P.body.alpha = alpha * 0.9;
    P.core.alpha = alpha;
    P.core.scale.set(k * 0.95, k * 0.7);
    P.ghosts.forEach((s, j) => {
      const tb = w.age - (j + 1) * L.afterMs;
      if (tb <= 0) { s.alpha = 0; return; }
      const q = wavePos(g, tb);
      s.position.set(q.x, q.y); s.rotation = q.rot;
      const f = 1 - (j + 1) / (P.ghosts.length + 1);
      s.scale.set(k * (0.85 + 0.15 * f), k * (0.85 + 0.15 * f));
      s.alpha = alpha * 0.45 * f;
    });
    return true;
  }

  /** Draw a cut's seam and tip while it runs across the face, throwing blood off the tip; then the seam fades. */
  private drawCut(c: Cut, dt: number): boolean {
    if (c.age < 0) return true;
    const S = this.scale;
    const L = this.look;
    const u = clamp01(c.age / c.drawMs);
    const after = c.age - c.drawMs;
    if (after >= SEAM_FADE_MS) return false;
    const fade = after > 0 ? after / SEAM_FADE_MS : 0;
    const drawn = c.len * easeOutCubic(u);
    const x0 = c.from.x + this.fox, y0 = c.from.y + this.foy;
    const tx = x0 + Math.cos(c.angle) * drawn, ty = y0 + Math.sin(c.angle) * drawn;
    const thin = 1 - 0.65 * fade;
    c.seam.position.set(x0, y0); c.seam.scale.set(Math.max(0.001, drawn / SEAM_W), (L.seamWidth * S * c.bold * thin) / SEAM_H * 2);
    c.seam.alpha = 1 - fade;
    c.bloom.position.set(x0, y0); c.bloom.scale.set(Math.max(0.001, drawn / SEAM_W), (L.seamWidth * S * 3.2 * c.bold * thin) / SEAM_H);
    c.bloom.alpha = 0.75 * (1 - fade);
    c.tip.position.set(tx, ty); c.tip.scale.set((0.35 + 0.2 * c.bold) * S); c.tip.alpha = u < 1 ? 0.95 : 0.95 * (1 - clamp01(after / 80));
    // Blood thrown off the tip along the blade as it cuts.
    if (u < 1 && c.sprayLeft > 0) {
      c.sprayAcc += c.sprayRate * dt;
      while (c.sprayAcc >= 1 && c.sprayLeft > 0) {
        c.sprayAcc -= 1; c.sprayLeft -= 1;
        this.droplets(tx, ty, 1, 420 + 160 * c.bold, { dir: c.angle, spread: 0.9, life: 420, size: 0.38 + 0.08 * c.bold, lift: 60 });
      }
    }
    return true;
  }

  /** Pose one wound: revealed behind the cut, opening (with a small overshoot), flaring on a beat, ripped by the nova, closing. */
  private drawWound(w: Wound): boolean {
    if (w.age < 0) { w.gash.alpha = 0; w.lip.alpha = 0; return true; }
    const reveal = easeOutCubic(clamp01(w.age / w.drawMs));
    const open = easeOutBack(clamp01((w.age - w.drawMs * 0.5) / OPEN_MS), 1.6);
    const pulse = w.pulse >= 0 ? Math.max(0, Math.exp(-w.pulse / 120) * Math.cos(w.pulse * 0.02)) : 0;
    const rip = w.rip >= 0 ? easeOutCubic(clamp01(w.rip / 90)) : 0;
    const ripFade = w.rip >= 0 ? clamp01((w.rip - this.look.stainMs * 0.45) / 420) : 0;
    const close = w.fade >= 0 ? clamp01(w.fade / CLOSE_MS) : 0;
    const gone = Math.max(close, ripFade);
    if (gone >= 1) return false;
    const h = w.w * (0.22 + 0.78 * Math.max(0, open)) * (1 + 0.35 * pulse + 1.1 * rip) * (1 - 0.6 * gone);
    const lx = Math.max(0.001, (w.len * reveal) / GASH_W) * (1 + 0.12 * rip);
    const x = w.x + this.fox - Math.cos(w.angle) * w.len * 0.06 * rip, y = w.y + this.foy - Math.sin(w.angle) * w.len * 0.06 * rip;
    for (const s of [w.gash, w.lip]) { s.position.set(x, y); s.scale.set(lx, h / GASH_H); }
    w.gash.alpha = 0.95 * (1 - gone);
    w.lip.alpha = (1 - gone) * Math.min(1, w.age / 60);
    w.lip.tint = pulse > 0.02 || rip > 0 ? whiten(this.lip, Math.min(0.55, 0.45 * pulse + 0.25 * rip * (1 - ripFade))) : this.lip;
    return true;
  }

  private dropWave(w: Wave): void {
    const P = w.parts;
    for (const s of [P.glow, P.body, P.core, ...P.ghosts]) this.give(s);
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const w of this.waves) this.dropWave(w);
    for (const c of this.cuts) for (const s of [c.seam, c.bloom, c.tip]) this.give(s);
    for (const w of this.wounds) { this.give(w.gash); this.give(w.lip); }
    for (const d of this.drips) this.give(d.s);
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const s of this.warm) this.give(s);
    if (this.charge) for (const s of [this.charge.ring, this.charge.glint, this.charge.blade]) this.give(s);
    if (this.wind) for (const s of [this.wind.glow, this.wind.body, this.wind.core, this.wind.bloom]) this.give(s);
    for (const m of this.megas) for (const s of [m.glow, m.body, m.core, m.seam, m.bloom, m.split, ...m.ghosts]) this.give(s);
    if (this.tensionS) { this.give(this.tensionS.core); this.give(this.tensionS.ring); }
    this.waves = []; this.cuts = []; this.wounds = []; this.drips = []; this.fx = []; this.particles = []; this.warm = [];
    this.charge = null; this.wind = null; this.megas = []; this.tensionS = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.free[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
