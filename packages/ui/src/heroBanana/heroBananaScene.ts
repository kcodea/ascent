/**
 * THE BANANA BARRAGE SCENE: everything the Banana Barrage hero attack (Oona's Banana Cannon) draws in Pixi, as a plain
 * scene graph with no renderer, so it runs (and is tested) headless. `heroBanana.ts` mounts `root` on the above-portrait
 * overlay and feeds `update(dt)`.
 *
 * Design rule (owner 2026-09-29: "use oona's animation as a guideline"): King Oona's PAINTED art is the star. Every
 * banana is her painted banana (one clean side-on cell of her sheet) SPINNING in the plane with backspin (owner: "the
 * bananas should spin, not flip"), every impact is her painted juice splat sheet played once through, and the particles
 * are hers: an orange-gold spark burst
 * where a banana leaves the hero, gold juice sparkles along its flight, and a gold / amber juice burst on the target
 * (her palette, additive). Glows, rings and rays are soft light that frames the paintings, never drawn shapes that
 * compete with them.
 *
 * TIER IV'S JAM: the giant golden banana (the same painting, huge, gilded, with an additive sheen) lands as a STAKE in
 * the struck portrait's rim; each slam of the striking hero drives it deeper and squashes it flatter. The part driven IN
 * disappears into the face (the stake's texture frame is cropped at the entry point, so only the part still outside is
 * drawn: no stencil, so it never nests with the striker's cut), a crater ring and cracks spread from the entry point,
 * juice squirts out sideways, and from the fourth slam an extra burst of painted juice splats sprays off the target,
 * more each time. By the finisher only
 * its end sticks out; then it bursts into the finale.
 *
 * Z-ORDER (owner: "make sure the attacker hero is on top of it"): the overlay canvas sits above every portrait, so while
 * the striking portrait is in the jam the whole scene is cut by an inverse mask of ITS circle: the striking hero reads on
 * top of the banana and every banana effect, while the banana still covers the struck side's hero power.
 *
 * STUCK things ride the struck portrait: the runner reports the portrait's knockback each frame (`setFoeOffset`) and the
 * stuck giant, every splat on the face and the target ring move with it.
 *
 * LAYERS, bottom to top: haze (normal: the flat shadow, the gold shockwave band) | splat (normal: the painted splats) |
 * glow (additive: juice, sparkles, glows, rings, rays) | body (normal: the painted bananas) | stake (the stuck giant) |
 * core (additive: flashes, the giant's sheen, glints). Sprites are pooled per layer, so every multi-part thing puts each part on its own layer (a
 * fixed draw order). Five batched runs.
 *
 * Contract: sprites are POOLED per layer and bounded by `MAX_BANANA_SPRITES`; textures are the caller's (the painted
 * sheets are shared with the FX library and never destroyed here; each is uploaded by a near-invisible warm sprite
 * during the damage formation); positions are the overlay's px; `setCamera` mirrors the DOM camera; `update` returns
 * whether anything still draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay splats the same way).
 */
import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutBack, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { bananaPos, type BananaMotion } from './heroBananaConfig';

export interface HeroBananaTextures extends HeroArcanaTextures {
  /** Oona's painted banana, tumbling (16 frames; a one-frame stand-in until decoded). Swapped in place when it lands. */
  banana: Texture[];
  /** Oona's painted juice splat, bursting and dissipating (14 frames; a stand-in until decoded). */
  splat: Texture[];
  /** A soft-edged solid disc. */
  disc: Texture;
  /** A thick shockwave ring. */
  shock: Texture;
}

export interface BananaColors { juice: number; amber: number; cream: number; gold: number; spark: number; side: number }

export interface BananaLook {
  /** A banana's size, px at stage scale 1 (the tier size multiplies it). */
  bananaPx: number;
  /** The extra juice burst on the late slams (0 = none; 1 = the shipped amount). */
  burstAmount: number;
  /** Juice running down the struck face during the jam (0 = none; 1 = the shipped amount). */
  juiceDrips: number;
  /** How long a drip runs and lingers before it fades. */
  dripMs: number;
  /** Juice sparkles shed along a flight (0 = none). */
  trailSparks: number;
  /** A splat's size, px at stage scale 1. */
  splatPx: number;
  /** A splat's play-through. */
  splatMs: number;
  /** Juice particles per tick. */
  tickJuice: number;
  juiceSpeed: number;
  juiceLifeMs: number;
  juicePx: number;
  /** Orange-gold sparks as a banana leaves the hero. */
  launchSparks: number;
  /** Tier IV: the finale. */
  giantSplat: number;
  ringSplats: number;
  showerBananas: number;
  shockSize: number;
  goldRays: number;
}

/** Hard cap on sprites alive at once (a Tier IV jam and finale peaks around 890 in the prod capture; headroom above). */
export const MAX_BANANA_SPRITES = 1100;

type LayerId = 'haze' | 'splat' | 'glow' | 'body' | 'core';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['haze', 'normal'], ['splat', 'normal'], ['glow', 'add'], ['body', 'normal'], ['core', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const GLOW_PX = 128;
const RING_PX = 128;
const SHOCK_PX = 256;
const DISC_PX = 128;
/** The painted sheet's cleanest SIDE-ON cell (the banana every projectile spins): a fat crescent, stem up, tip down. */
export const SIDE_FRAME = 3;
/** The slim, straight, upright cell (stem up): the stuck giant driven in like a stake reads best as this one. */
export const STAKE_FRAME = 11;
/** Where the painted banana actually sits inside that 256 px cell (its opaque box, measured off the sheet). */
const STAKE_BOX = { x: 96, y: 42, w: 82, h: 188 };

interface Banana {
  idx: number;
  m: BananaMotion;
  age: number;
  /** Its drawn size, px (the tier size and the stage scale folded in). */
  px: number;
  body: Sprite; glow: Sprite; sheen: Sprite | null;
  sparkAcc: number;
  x: number; y: number;
}

/**
 * A thick run of banana juice down the struck face: a stream (a disc stretched down from where it started) with a fat
 * drop at its head, sliding down faster and faster, over the rim and below it, dripping drops off its end, then fading.
 */
interface Drip { stream: Sprite; head: Sprite; x: number; y0: number; y: number; vy: number; w: number; age: number; life: number; floor: number; dripAcc: number; wob: number }

/** Tier IV's giant, stuck in the struck face as a stake along `u` (its inner part masked away by the face). */
interface Stake {
  entry: Pt; u: Pt; len: number;
  /** How much of its length is sunk (0..1), easing toward `target` after each slam. */
  depth: number; target: number;
  crush: number; kick: number; age: number;
}

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  /** Jam residue (the crater ring and the cracks): cleared by the finale, never left behind. */
  residue?: boolean;
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  sy: number; spin: number; delay: number;
  vx: number; vy: number; drag: number;
  /** Rides the struck portrait (its knockback). */
  follow: boolean;
  x: number; y: number;
}

/** A painted splat playing through its sheet once (fixed size; the painting itself grows and dissipates). */
interface Splat { s: Sprite; age: number; dur: number; delay: number; px: number; follow: boolean; x: number; y: number; flip: number }

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number;
  /** Stretched along its velocity (a spark). */
  align: boolean;
  /** A painted banana (the shower): sized in px against its frame. */
  tumble: number;
  spin: number;
}

interface Aura { bloom: Sprite; ring: Sprite; stars: Sprite[]; x: number; y: number; r: number; age: number; dur: number; moteAcc: number; big: boolean; release: number }

interface Mark { rings: [Sprite, Sprite]; shadow: Sprite; x: number; y: number; r: number; age: number; dur: number }

interface Glint { star: Sprite; ring: Sprite; idx: number; age: number }

export class HeroBananaScene {
  readonly root = new Container();
  /** Every layer (cut by the striking portrait's circle while it is in the jam). */
  private readonly world = new Container();
  /** The stuck giant's own layer (a fixed draw order: over the flying bananas, under the flashes). */
  private readonly stakeLayer = new Container();
  private readonly stakeBody: Sprite;
  private readonly stakeSheen: Sprite;
  /** The stake's texture: the upright cell, its frame cropped each frame to the part still outside the face. */
  private stakeTex: Texture | null = null;
  private stakeCell: Rectangle | null = null;
  private readonly cutA: Graphics;
  private stake: Stake | null = null;
  private cutting = false;
  private drips: Drip[] = [];
  /** The viewport (overlay px), for the screen-edge impact lines. */
  private view = { w: 1920, h: 1080 };
  /** The struck face (centre and radius), for the drips. */
  private face: { x: number; y: number; r: number } | null = null;
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private used = 0;
  private bananas: Banana[] = [];
  private fx: Fx[] = [];
  private splats: Splat[] = [];
  private particles: Particle[] = [];
  private aura: Aura | null = null;
  private mark: Mark | null = null;
  private glintFx: Glint | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private warmedSources = new Set<unknown>();
  private destroyed = false;
  private fox = 0;
  private foy = 0;
  private readonly rnd: () => number;
  private readonly palette: number[];
  private readonly sparkPalette: number[];
  /** The giant's gilding (a multiply tint on the painted yellow). */
  private readonly gild: number;

  constructor(private readonly tex: HeroBananaTextures, private readonly colors: BananaColors, private readonly look: BananaLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroBanana';
    this.world.label = 'banana-world';
    this.root.addChild(this.world);
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `banana-${id}`;
      this.world.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    // The stake layer sits under the flashes (core), over the flying bananas, and is cut by the struck face.
    this.stakeLayer.label = 'banana-stake';
    this.world.addChildAt(this.stakeLayer, this.world.children.indexOf(this.layers.core));
    this.stakeBody = new Sprite(tex.banana[0]!); this.stakeBody.anchor.set(0.5); this.stakeBody.visible = false;
    this.stakeSheen = new Sprite(tex.banana[0]!); this.stakeSheen.anchor.set(0.5); this.stakeSheen.blendMode = 'add'; this.stakeSheen.visible = false;
    this.stakeLayer.addChild(this.stakeBody, this.stakeSheen);
    this.stakeBody.anchor.set(0.5, 1); this.stakeSheen.anchor.set(0.5, 1);
    // The striker's cut circle (a unit circle, placed and scaled per frame). It is in the tree ONLY while it is the
    // mask: Pixi builds an unmasked Graphics back into the render, and a leftover white circle over the striker's
    // portrait is exactly the owner's "the hero gets messed up at the end" (2026-09-29: a blank grey disc).
    this.cutA = new Graphics().circle(0, 0, 1).fill(0xffffff);
    this.cutA.label = 'banana-cut-striker';
    this.rnd = seededRng(seed);
    // Oona's own palettes: the juice (her target burst) and the launch sparks (her source burst).
    this.palette = [colors.juice, colors.amber, colors.gold, colors.cream];
    this.sparkPalette = [colors.spark, mixColor(colors.spark, colors.gold, 0.5), colors.gold, colors.cream];
    this.gild = mixColor(0xffffff, colors.gold, 0.35);
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first banana needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.ring, t.streak, t.star, t.spark, t.disc, t.shock]) this.warmSprite(w);
    this.warmSheets();
    this.warmLeft = 420;
  }

  get liveSprites(): number { return this.used; }
  get liveBananas(): number { return this.bananas.length; }
  get stuckBanana(): boolean { return this.stake !== null; }
  get liveSplats(): number { return this.splats.length; }
  /** The jam's dark residue still drawn (the crater ring and the cracks): 0 once the finale has cleared it. */
  get residue(): number { let n = 0; for (const q of this.fx) if (q.residue) n++; return n; }
  get blazing(): boolean { return this.aura?.big === true && this.aura.release < 0; }
  get marking(): boolean { return this.mark !== null; }
  get glinting(): boolean { return this.glintFx !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }
  /** A layer by name (tests and the capture rig). */
  layer(id: LayerId | 'stake'): Container { return id === 'stake' ? this.stakeLayer : this.layers[id]; }
  /** How crushed the stuck giant is (0 = whole; one step per slam). */
  get crush(): number { return this.stake ? this.stake.crush : 0; }
  /** How deep the stuck giant is sunk into the face (0..1; the target it is easing to). */
  get sunk(): number { return this.stake ? this.stake.target : 0; }
  /** Whether the scene is cut by the striking portrait's circle this frame (it is ON TOP of the banana). */
  get strikerOnTop(): boolean { return this.cutting && this.world.mask != null; }
  /** Whether ANY mask is on the scene (none outside the jam; a leftover one would hide everything outside the circle). */
  get masked(): boolean { return this.world.mask != null; }
  /** Whether a Graphics that is NOT a mask sits in the tree (it would render: a white disc over a portrait). */
  get strayGraphics(): boolean {
    const walk = (c: Container): boolean => c.children.some((k) => (k instanceof Graphics && k.visible && k !== this.world.mask) || (k instanceof Container && walk(k)));
    return walk(this.root);
  }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback this frame (overlay px): the stuck giant, the splats and the ring ride it. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  /** The viewport size (overlay px), for the screen-edge impact lines of the late slams. */
  setView(w: number, h: number): void { if (w > 0 && h > 0) this.view = { w, h }; }

  /**
   * The STRIKING portrait's circle this frame (overlay px, before the camera: the same space as every other point), or
   * null. While it is in the jam it cuts the whole scene (an inverse mask), so the portrait reads ON TOP of the banana
   * and every banana effect, while the banana still covers everything else (the struck side's hero power included).
   */
  setCuts(striker: { x: number; y: number; r: number } | null): void {
    if (this.destroyed) return;
    if (striker && Number.isFinite(striker.x) && Number.isFinite(striker.y) && striker.r > 0) {
      this.cutA.position.set(striker.x, striker.y); this.cutA.scale.set(striker.r);
      if (!this.cutting) { this.root.addChild(this.cutA); this.world.setMask({ mask: this.cutA, inverse: true }); this.cutting = true; }
    } else if (this.cutting) { this.uncut(); }
  }

  /**
   * Lift the striker's cut. NOTE: Pixi's `setMask({ mask: null })` does NOT remove a mask (it only merges options), and
   * the leftover mask then reads as a NORMAL mask, showing the scene only inside the striker's circle. So the mask is
   * cleared by assignment, then the option reset.
   */
  private uncut(): void {
    this.world.mask = null;
    this.world.setMask({ inverse: false } as unknown as Parameters<Container['setMask']>[0]);
    if (this.cutA.parent) this.cutA.parent.removeChild(this.cutA);
    this.cutting = false;
  }

  /** The painted banana every projectile spins (the side-on cell; the stand-in until the sheet lands). */
  private side(): Texture { const f = this.tex.banana; return f[Math.min(SIDE_FRAME, f.length - 1)]!; }
  private upright(): Texture { const f = this.tex.banana; return f[Math.min(STAKE_FRAME, f.length - 1)]!; }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_BANANA_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('banana-', '') ?? 'core') as LayerId;
    s.visible = false; this.freeSprites[layer].push(s); this.used--;
  }

  private warmSprite(t: Texture): void {
    const s = this.take('core', t, 0xffffff);
    if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
  }

  /** Upload each painted sheet to the GPU once (a warm sprite on one of its frames), including one decoded late. */
  private warmSheets(): void {
    for (const frames of [this.tex.banana, this.tex.splat]) {
      const f = frames[0];
      if (!f || this.warmedSources.has(f.source)) continue;
      this.warmedSources.add(f.source);
      this.warmSprite(f);
      this.warmLeft = Math.max(this.warmLeft, 200);
    }
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

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): Particle | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    s.position.set(o.x, o.y);
    s.rotation = o.align ? Math.atan2(o.vy, o.vx) : this.rnd() * Math.PI * 2;
    const p = { ...o, s, max: o.life };
    this.particles.push(p);
    return p;
  }

  /** A painted splat on the face: its sheet played once through, at `px` wide, randomly turned and mirrored. */
  private splatAt(x: number, y: number, px: number, o: { dur?: number; delay?: number; follow?: boolean; tint?: number } = {}): void {
    const frames = this.tex.splat;
    const s = this.take('splat', frames[0]!, o.tint ?? 0xffffff);
    if (!s) return;
    s.rotation = this.rnd() * Math.PI * 2;
    const flip = this.rnd() < 0.5 ? -1 : 1;
    s.alpha = o.delay ? 0 : 1;
    this.splats.push({ s, age: 0, dur: Math.max(60, o.dur ?? this.look.splatMs), delay: o.delay ?? 0, px: px * this.scale, follow: o.follow ?? true, x, y, flip });
    this.drawSplat(this.splats[this.splats.length - 1]!);
  }

  /**
   * Oona's JUICE burst: gold / amber / cream juice blobs (additive) bursting out, slowing hard and shrinking to nothing
   * (her target burst: ~435 px/s, most of the speed gone by the end of a 450 ms life).
   */
  private juice(x: number, y: number, n: number, o: { speed?: number; dir?: number; spread?: number; size?: number; life?: number; follow?: boolean } = {}): void {
    const S = this.scale;
    const L = this.look;
    const sp0 = o.speed ?? L.juiceSpeed;
    const size = (o.size ?? 1) * L.juicePx;
    const fx = o.follow ? this.fox : 0, fy = o.follow ? this.foy : 0;
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.6);
      const sp = sp0 * (0.21 + this.rnd() * 1.58) * S;
      const sz = (size * (0.5 + this.rnd()) * 2) / GLOW_PX;
      this.particle('glow', this.tex.glow, this.palette[i % 4]!, {
        x: x + fx, y: y + fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.08, grav: 0,
        life: (o.life ?? L.juiceLifeMs) * (0.7 + this.rnd() * 0.5), from: sz * S, to: 0, alpha: 0.55, align: false, tumble: 0, spin: 0,
      });
    }
  }

  /** Oona's launch sparks: orange-gold streaks shooting out along `dir` and rising as they slow. */
  private sparks(x: number, y: number, n: number, dir: number, o: { speed?: number; spread?: number; size?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = dir + (this.rnd() - 0.5) * (o.spread ?? 1.1);
      const sp = (o.speed ?? 865) * (0.5 + this.rnd()) * S;
      this.particle('glow', this.tex.streak, this.sparkPalette[i % 4]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.12, grav: -510 * S,
        life: 420 + this.rnd() * 300, from: (o.size ?? 0.9) * S, to: 0.1 * S, alpha: 1, align: true, tumble: 0, spin: 0,
      });
    }
  }

  /** Gold sparkles: glitter stars thrown out (or drawn in with `inward`). */
  private sparkles(x: number, y: number, n: number, speed: number, o: { life?: number; size?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sp = speed * (0.4 + this.rnd() * 0.8) * S;
      this.particle('glow', this.tex.star, i % 2 ? this.colors.gold : this.colors.cream, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.2, grav: 0,
        life: (o.life ?? 480) * (0.7 + this.rnd() * 0.6), from: (o.size ?? 0.35) * S, to: 0.05 * S, alpha: 1, align: false, tumble: 0,
        spin: (this.rnd() - 0.5) * 0.02,
      });
    }
  }

  // ── the hero ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The golden jungle FLOURISH on the striking hero: a warm bloom and a ring open on the portrait and gold motes are
   * drawn in; held through the barrage. `big` = Tier IV's blaze before the giant (a far brighter halo, throbbing faster,
   * glints flashing round the rim), released by the giant's fling.
   */
  flourish(x: number, y: number, radius: number, durMs: number, big = false): void {
    if (this.aura && !big) return;
    if (this.aura) this.dropAura();
    const bloom = this.take('glow', this.tex.glow, this.colors.gold);
    const ring = this.take('glow', this.tex.ring, whiten(this.colors.gold, 0.3));
    const stars: Sprite[] = [];
    for (let i = 0; i < (big ? 4 : 0); i++) { const s = this.take('core', this.tex.star, 0xffffff); if (s) { s.alpha = 0; stars.push(s); } }
    if (!bloom || !ring) { for (const s of [bloom, ring, ...stars]) if (s) this.give(s); return; }
    for (const s of [bloom, ring]) { s.position.set(x, y); s.alpha = 0; }
    this.aura = { bloom, ring, stars, x, y, r: radius, age: 0, dur: Math.max(1, durMs), moteAcc: 0, big, release: -1 };
    if (!big) this.sparkles(x, y, 8, 220, { life: 480 });
  }

  /** Let the flourish go (the last fling, or the giant). */
  release(): void { if (this.aura && this.aura.release < 0) this.aura.release = 0; }

  private dropAura(): void {
    const a = this.aura;
    if (!a) return;
    for (const s of [a.bloom, a.ring, ...a.stars]) this.give(s);
    this.aura = null;
  }

  // ── bananas ────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * FLING: a banana bursts out of the hero along `m` with Oona's spark burst and a flash, tumbling on its arc. `sizeK`
   * is the size multiplier (the tier's, or the giant's); `age0` = ms already elapsed.
   */
  fling(m: BananaMotion, sizeK: number, age0 = 0, idx = this.bananas.length): void {
    this.warmSheets();
    const c = this.colors;
    const a = m.a;
    const head = bananaPos(m, 1).heading;
    const big = m.giant ? 2 : 1;
    this.fxs('core', this.tex.glow, whiten(c.gold, 0.6), a.x, a.y, { dur: 120, from: 0.35 * big, to: 1 * big, a0: 0.9 });
    this.fxs('glow', this.tex.glow, c.gold, a.x, a.y, { dur: 260, from: 0.5 * big, to: 1.6 * big, a0: 0.5, mode: 'punch', peakAt: 0.12 });
    const ring = this.fxs('glow', this.tex.ring, whiten(c.gold, 0.4), a.x, a.y, { dur: 240, from: 0.15 * big, to: 0.75 * big, a0: 0.85, sy: 0.55 });
    if (ring) ring.s.rotation = head + Math.PI / 2;
    this.sparks(a.x, a.y, Math.round(this.look.launchSparks * (m.giant ? 2.5 : 1)), head, { spread: m.giant ? 1.6 : 1.1 });
    if (m.giant) { this.sparkles(a.x, a.y, 16, 420, { life: 650, size: 0.5 }); this.release(); }
    const px = this.look.bananaPx * sizeK * this.scale;
    const body = this.take('body', this.side(), m.giant ? this.gild : 0xffffff);
    const glow = this.take('glow', this.tex.glow, m.giant ? c.gold : c.juice);
    const sheen = m.giant ? this.take('core', this.side(), c.gold) : null;
    if (!body || !glow) { for (const s of [body, glow, sheen]) if (s) this.give(s); return; }
    for (const s of [body, glow, sheen]) if (s) s.alpha = 0;
    const p0 = bananaPos(m, Math.max(0, age0));
    this.bananas.push({ idx, m, age: Math.max(0, age0), px, body, glow, sheen, sparkAcc: 0, x: p0.x, y: p0.y });
  }

  private bananaOf(i: number): Banana | undefined { return this.bananas.find((b) => b.idx === i); }

  private dropBanana(b: Banana): void {
    this.give(b.body); this.give(b.glow); if (b.sheen) this.give(b.sheen);
  }

  private takeBanana(i: number): Banana | undefined {
    const b = this.bananaOf(i);
    if (b) { this.dropBanana(b); this.bananas.splice(this.bananas.indexOf(b), 1); }
    return b;
  }

  // ── the splats ─────────────────────────────────────────────────────────────────────────────────────────────

  /** A banana SPLATS before the last (a tick): the painted splat, Oona's juice burst, a small warm flash. */
  hit(i: number, x: number, y: number, radius: number, step: number): void {
    const b = this.takeBanana(i);
    const at = b ? b.m.b : { x, y };
    const g = 1 + 0.04 * step;
    // Sized to the face: a tick bursts ON the portrait, never way past it.
    this.splatAt(at.x, at.y, Math.min(this.look.splatPx * g, (radius * 2.1) / this.scale));
    this.juice(at.x, at.y, this.look.tickJuice, { follow: true, speed: Math.min(this.look.juiceSpeed, radius * 5) });
    this.fxs('core', this.tex.glow, whiten(this.colors.juice, 0.6), at.x, at.y, { dur: 110, from: 0.3, to: 0.9 * g, a0: 0.7, follow: true });
    void radius;
  }

  /**
   * THE impact (I-III): the last banana bursts. Layered painted splats (one big in the middle, the rest round it,
   * staggered), the biggest juice burst, a short warm flash over the face, two rings. The fills are gone in ~150 ms, so
   * the big -N reads.
   */
  impact(i: number, x: number, y: number, radius: number, o: { k: number; burst: number; juice: number; splats: number; flashAlpha: number }): void {
    const c = this.colors;
    const b = this.takeBanana(i);
    const at = b ? b.m.b : { x, y };
    const S = this.scale;
    const portrait = (radius * 2) / GLOW_PX / S;
    this.fxs('core', this.tex.glow, whiten(c.juice, 0.7), x, y, { dur: 110, from: portrait, to: portrait * 1.2, a0: 0.45 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 110, from: 0.4 * o.burst, to: 1.2 * o.burst, a0: 0.7 * o.flashAlpha, follow: true });
    this.splatAt(at.x, at.y, this.look.splatPx * o.burst * 1.25, { dur: this.look.splatMs * 1.15 });
    for (let s = 1; s < o.splats; s++) {
      const a = (s / Math.max(1, o.splats - 1)) * Math.PI * 2 + this.rnd() * 0.8;
      const r = (radius / S) * (0.35 + this.rnd() * 0.25);
      this.splatAt(at.x + Math.cos(a) * r * S, at.y + Math.sin(a) * r * S, this.look.splatPx * (0.65 + 0.2 * this.rnd()), { delay: 45 * s });
    }
    this.juice(at.x, at.y, o.juice, { speed: this.look.juiceSpeed * (1 + 0.3 * o.k), follow: true });
    this.fxs('glow', this.tex.ring, whiten(c.juice, 0.5), at.x, at.y, { dur: 260, from: 0.2, to: 1.4 * (0.9 + 0.3 * o.k), a0: 0.9, follow: true });
    this.fxs('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 460, from: 0.3, to: 2.3 * (0.85 + 0.4 * o.k), a0: 0.55 });
    if (o.k > 0.5) this.sparkles(at.x, at.y, 10, 320, { life: 520 });
  }

  // ── Tier IV ────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The giant HANGS at its apex: a crown-shaped glint flashes on its top (a big glitter star and a ring riding it), and
   * the flat golden target ring locks on to where it will land (full circles, never a perspective ellipse).
   */
  hang(i: number, landAt: Pt, radius: number, fallMs: number): void {
    const star = this.take('core', this.tex.star, 0xffffff);
    const ring = this.take('glow', this.tex.ring, this.colors.gold);
    if (star && ring) { star.alpha = 0; ring.alpha = 0; this.glintFx = { star, ring, idx: i, age: 0 }; } else { for (const s of [star, ring]) if (s) this.give(s); }
    if (this.mark) return;
    const r1 = this.take('glow', this.tex.ring, this.colors.gold);
    const r2 = this.take('glow', this.tex.ring, whiten(this.colors.gold, 0.4));
    const shadow = this.take('haze', this.tex.disc, 0x3a2408);
    if (!r1 || !r2 || !shadow) { for (const s of [r1, r2, shadow]) if (s) this.give(s); return; }
    for (const s of [r1, r2, shadow]) { s.alpha = 0; s.position.set(landAt.x, landAt.y); }
    this.mark = { rings: [r1, r2], shadow, x: landAt.x, y: landAt.y, r: radius, age: 0, dur: Math.max(1, fallMs) };
  }

  private endMark(): void {
    const mk = this.mark;
    if (mk) { for (const s of [mk.rings[0], mk.rings[1], mk.shadow]) this.give(s); this.mark = null; }
    const g = this.glintFx;
    if (g) { this.give(g.star); this.give(g.ring); this.glintFx = null; }
  }

  /**
   * The giant LANDS as a STAKE in the struck face's rim, pointing in along `u` (`depth` of its `len` already in): the
   * flying banana hands over to the stake sprites; a big splat, a juice burst, a thud of light at the entry.
   */
  land(i: number, stake: { entry: Pt; u: Pt; len: number; depth: number; face?: { x: number; y: number; r: number } }): void {
    this.endMark();
    if (stake.face) this.face = { ...stake.face };
    const b = this.takeBanana(i);
    const e = stake.entry;
    this.stake = { entry: { ...e }, u: { ...stake.u }, len: stake.len, depth: stake.depth, target: stake.depth, crush: 0, kick: -1, age: 0 };
    const cell = this.upright();
    // Crop to the painting itself (the painted sheet's cell; the stand-in uses its whole box), so the stake's length and
    // its cut line are the banana's own.
    const painted = this.tex.banana.length > SIDE_FRAME && cell.frame.width >= 256;
    const k0 = cell.frame.width / 256;
    this.stakeCell = painted
      ? new Rectangle(cell.frame.x + STAKE_BOX.x * k0, cell.frame.y + STAKE_BOX.y * k0, STAKE_BOX.w * k0, STAKE_BOX.h * k0)
      : cell.frame.clone();
    // DYNAMIC, and refreshed with `update()` every frame: a Sprite only re-measures its quad when a dynamic texture
    // emits 'update'; with `updateUvs()` alone the crop squeezed into a fixed quad and the stake STRETCHED as it sank
    // (owner 2026-09-29: "the banana also lengthens as it goes on").
    this.stakeTex = new Texture({ source: cell.source, frame: cell.frame.clone(), dynamic: true });
    this.stakeBody.texture = this.stakeTex; this.stakeBody.tint = this.gild; this.stakeBody.visible = true;
    this.stakeSheen.texture = this.stakeTex; this.stakeSheen.tint = this.colors.gold; this.stakeSheen.visible = true;
    this.drawStake(0);
    void b;
    this.splatAt(e.x, e.y, this.look.splatPx * 1.5, { dur: this.look.splatMs * 1.3 });
    this.juice(e.x, e.y, 70, { speed: this.look.juiceSpeed * 1.2, follow: true });
    this.dripsFrom(e, 4);
    this.fxs('core', this.tex.glow, whiten(this.colors.gold, 0.5), e.x, e.y, { dur: 140, from: 0.8, to: 2.2, a0: 0.75, follow: true });
    this.fxs('glow', this.tex.ring, this.colors.gold, e.x, e.y, { dur: 360, from: 0.3, to: (stake.len * 0.9) / RING_PX / this.scale, a0: 0.8, follow: true });
  }

  /**
   * A SLAM into the stake (`k` = 0 for the first): it is driven to `depth` (the part going in vanishes into the face)
   * and squashed a step flatter; a crater ring and cracks spread from the entry, a painted splat and juice SQUIRT out
   * sideways from the pressure, a flash. `burst` (0 = none) adds an extra juice burst of painted splats, more each time.
   */
  slam(k: number, depth: number, burst = 0, of = 6): void {
    const st = this.stake;
    if (st) { st.target = Math.max(st.target, depth); st.crush = k + 1; st.kick = 0; }
    const u = st ? st.u : { x: 1, y: 0 };
    const at = st ? st.entry : { x: 0, y: 0 };
    const g = 1 + 0.18 * k;
    const S = this.scale;
    const across = Math.atan2(u.y, u.x) + Math.PI / 2;
    this.splatAt(at.x - u.x * 14 * S, at.y - u.y * 14 * S, this.look.splatPx * (0.9 + 0.12 * k));
    this.juice(at.x, at.y, 22 + 8 * k, { dir: across, spread: 0.7, speed: this.look.juiceSpeed * 1.5 * g, follow: true });
    this.juice(at.x, at.y, 22 + 8 * k, { dir: across + Math.PI, spread: 0.7, speed: this.look.juiceSpeed * 1.5 * g, follow: true });
    this.fxs('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 100, from: 0.5 * g, to: 1.4 * g, a0: 0.75, follow: true });
    const ring = this.fxs('glow', this.tex.ring, whiten(this.colors.gold, 0.3), at.x, at.y, { dur: 240, from: 0.2, to: 1.1 * g, a0: 0.8, sy: 0.6, follow: true });
    if (ring) ring.s.rotation = across;
    // THE CRATER: a dark ring round the entry, wider each slam, and cracks running into the face.
    this.fxs('haze', this.tex.ring, 0x2a1406, at.x, at.y, { dur: 2600, from: 0.35 + 0.1 * k, to: 0.5 + 0.14 * k, a0: 0.55, mode: 'hold', follow: true, residue: true });
    const cracks = 2 + k;
    for (let c = 0; c < cracks; c++) {
      const a = Math.atan2(u.y, u.x) + (c / Math.max(1, cracks - 1) - 0.5) * 2.4 + (this.rnd() - 0.5) * 0.3;
      const len = (0.9 + 0.25 * k) * (0.7 + this.rnd() * 0.5);
      const f = this.fxs('haze', this.tex.streak, 0x1e0c04, at.x + Math.cos(a) * 16 * len * S, at.y + Math.sin(a) * 16 * len * S,
        { dur: 2600, from: 0.6 * len, to: 1.1 * len, a0: 0.8, sy: 0.16, mode: 'hold', follow: true, residue: true });
      if (f) f.s.rotation = a;
    }
    if (burst > 0) this.juiceBurst(at, u, burst);
    this.impactBurst(at, u, k, of);
    // The pressure squeezes juice out: runs down the face, more each slam.
    this.dripsFrom(at, 3 + 2 * k);
  }

  /**
   * THE IMPACT BURST of a slam (owner 2026-09-29: "add some pixi impact bursts to make it feel extremely over the top and
   * aggressive"), escalating from the first slam (`k` 0) to the finisher (`k` = `of` - 1): a white impact flash, a
   * spike-star IMPACT FRAME (long thin spikes for a few frames; the clock never stops), radial speed lines flying
   * outward, shockwave rings, sparks, juice and flesh debris flung out and falling, and on the late slams manga
   * speed lines raking in from the screen edges toward the hit.
   */
  private impactBurst(at: Pt, u: Pt, k: number, of: number): void {
    const S = this.scale;
    const c = this.colors;
    const lvl = Math.min(1, (k + 1) / Math.max(1, of));
    const ang = Math.atan2(u.y, u.x);
    // The white impact flash, bigger each slam.
    this.fxs('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 90 + 60 * lvl, from: 0.7 + 0.7 * lvl, to: 2 + 2.6 * lvl, a0: 1, follow: true });
    // THE IMPACT FRAME: a star of long thin spikes, flung out from the hit for a few frames.
    const spikes = 6 + Math.round(8 * lvl);
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + (this.rnd() - 0.5) * 0.35;
      const len = (1.8 + this.rnd() * 1.6) * (0.8 + 1.6 * lvl);
      const f = this.fxs('core', this.tex.streak, i % 3 === 0 ? whiten(c.gold, 0.4) : 0xffffff, at.x + Math.cos(a) * 26 * len * S, at.y + Math.sin(a) * 26 * len * S,
        { dur: 110 + 40 * lvl, from: len * 0.8, to: len, a0: 1, sy: 0.12, follow: true });
      if (f) f.s.rotation = a;
    }
    // Radial speed lines flying out.
    const lines = 10 + Math.round(18 * lvl);
    for (let i = 0; i < lines; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sp = (900 + this.rnd() * 1000) * (0.8 + 0.9 * lvl) * S;
      const f = this.fxs('glow', this.tex.streak, i % 2 ? c.gold : 0xffffff, at.x, at.y,
        { dur: 240 + 60 * lvl, from: 1.1, to: 2 * (1 + lvl), a0: 0.9, sy: 0.16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.03 });
      if (f) f.s.rotation = a;
    }
    // Shockwave rings: one, then two, then three.
    const rings = 1 + Math.round(2 * lvl);
    for (let r = 0; r < rings; r++) {
      this.fxs('glow', this.tex.shock, r % 2 ? c.gold : 0xffffff, at.x, at.y,
        { dur: 300 + 60 * r, from: 0.25, to: (1.2 + 1.8 * lvl) * (1 + 0.35 * r), a0: 0.85 - 0.15 * r, delay: r * 55, follow: true });
    }
    // Sparks, mostly back toward the striker and out to the sides.
    this.sparks(at.x, at.y, 10 + Math.round(24 * lvl), ang + Math.PI, { speed: 1100 + 500 * lvl, spread: 3.4, size: 1 + 0.4 * lvl });
    // Debris: juice and pulp flung out, falling.
    const bits = 8 + Math.round(22 * lvl);
    for (let i = 0; i < bits; i++) {
      const a = ang + Math.PI + (this.rnd() - 0.5) * 3.6;
      const sp = (380 + this.rnd() * 700) * (0.8 + 0.6 * lvl) * S;
      const sz = ((6 + this.rnd() * 10) / DISC_PX) * 2;
      this.particle('splat', this.tex.disc, [c.juice, c.amber, c.cream][i % 3]!, {
        x: at.x + this.fox, y: at.y + this.foy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200 * S, drag: 0.35, grav: 1500 * S,
        life: 520 + this.rnd() * 400, from: sz * S, to: sz * 0.7 * S, alpha: 1, align: false, tumble: 0, spin: 0,
      });
    }
    // The late slams: manga impact lines raking in from the screen edges toward the hit.
    if (lvl >= 0.6) {
      const n = Math.round(12 + 22 * lvl);
      const { w, h } = this.view;
      for (let i = 0; i < n; i++) {
        const side = i % 4, f0 = this.rnd();
        const e = side === 0 ? { x: f0 * w, y: -20 } : side === 1 ? { x: w + 20, y: f0 * h } : side === 2 ? { x: f0 * w, y: h + 20 } : { x: -20, y: f0 * h };
        const a = Math.atan2(at.y - e.y, at.x - e.x);
        const len = (3.5 + this.rnd() * 4) * (0.8 + 0.5 * lvl);
        const f = this.fxs('core', this.tex.streak, 0xffffff, e.x + Math.cos(a) * 32 * len * S * 0.5, e.y + Math.sin(a) * 32 * len * S * 0.5,
          { dur: 170 + 60 * lvl, from: len, to: len * 1.15, a0: 0.8, sy: 0.1, mode: 'punch', peakAt: 0.15 });
        if (f) f.s.rotation = a;
      }
    }
  }

  /**
   * THICK JUICE running down the struck face (owner 2026-09-29: "have a bunch of banana juice drip down"): `n` runs
   * starting round `from` (and across the face), each a stream with a fat drop at its head, sliding down over the rim
   * and below it, dripping drops off its end, lingering, then fading.
   */
  private dripsFrom(from: Pt, n: number): void {
    const L = this.look;
    const f = this.face;
    if (!f || L.juiceDrips <= 0) return;
    const S = this.scale;
    const count = Math.round(n * L.juiceDrips);
    for (let i = 0; i < count; i++) {
      // Start on the face: near the entry for most, anywhere across the upper face for some.
      const near = this.rnd() < 0.65;
      const sx = near ? from.x + (this.rnd() - 0.5) * f.r * 0.7 : f.x + (this.rnd() - 0.5) * f.r * 1.4;
      const sy = near ? from.y + (this.rnd() - 0.3) * f.r * 0.4 : f.y - f.r * (0.2 + this.rnd() * 0.5);
      const dx = sx - f.x;
      const inside = Math.sqrt(Math.max(0, f.r * f.r - dx * dx));
      const x = f.x + Math.max(-f.r * 0.9, Math.min(f.r * 0.9, dx));
      const y0 = Math.max(f.y - inside * 0.95, Math.min(f.y + inside * 0.8, sy));
      const stream = this.take('splat', this.tex.disc, this.rnd() < 0.5 ? this.colors.juice : this.colors.amber);
      const head = this.take('splat', this.tex.disc, whiten(this.colors.juice, 0.25));
      if (!stream || !head) { for (const s of [stream, head]) if (s) this.give(s); return; }
      stream.anchor.set(0.5, 0);
      const w = (10 + this.rnd() * 9) * S;
      this.drips.push({
        stream, head, x, y0, y: y0, vy: (10 + this.rnd() * 20) * S, w, age: 0, life: L.dripMs * (0.75 + this.rnd() * 0.5),
        // Runs over the rim and on below the portrait before it drips off.
        floor: f.y + inside + (30 + this.rnd() * 70) * S, dripAcc: this.rnd() * 200, wob: this.rnd() * Math.PI * 2,
      });
    }
  }

  private drawDrips(dt: number): void {
    const S = this.scale;
    const sec = dt / 1000;
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i]!;
      d.age += dt;
      if (d.age >= d.life) { this.give(d.stream); this.give(d.head); this.drips.splice(i, 1); continue; }
      // Thick juice: it creeps, then runs, faster and faster, until it hangs at its floor and drips off.
      if (d.y < d.floor) { d.vy = Math.min(170 * S, d.vy + 70 * S * sec); d.y = Math.min(d.floor, d.y + d.vy * sec); }
      else {
        d.dripAcc += dt;
        if (d.dripAcc >= 260) {
          d.dripAcc -= 260 + this.rnd() * 160;
          const sz = (d.w * (1 + this.rnd() * 0.4)) / DISC_PX * 2;
          this.particle('splat', this.tex.disc, this.rnd() < 0.5 ? this.colors.juice : this.colors.amber, {
            x: d.x + this.fox, y: d.y + this.foy + d.w * 0.4, vx: 0, vy: 40 * S, drag: 1, grav: 1400 * S,
            life: 420, from: sz * S / S, to: sz * 0.7, alpha: 1, align: false, tumble: 0, spin: 0,
          });
        }
      }
      const fade = d.age > d.life * 0.75 ? 1 - (d.age - d.life * 0.75) / (d.life * 0.25) : 1;
      const wob = Math.sin(d.age * 0.004 + d.wob) * 2 * S;
      const len = Math.max(d.w, d.y - d.y0);
      const x = d.x + wob + this.fox;
      d.stream.position.set(x, d.y0 + this.foy - d.w * 0.3);
      d.stream.scale.set(d.w / DISC_PX * 1.7, (len + d.w * 0.3) / DISC_PX * 1.25);
      d.stream.alpha = fade;
      d.head.position.set(x, d.y + this.foy);
      d.head.scale.set((d.w * 1.5) / DISC_PX * 1.6, (d.w * 1.9) / DISC_PX * 1.6);
      d.head.alpha = fade;
    }
  }

  /**
   * A JUICE BURST off the target on the late slams (owner 2026-09-29: "remove the blood from the banana attack and just
   * keep the banana splats instead"): extra painted splats of Oona's juice, juice thrown back and out and falling, and
   * juice spatter that stays on the face. `level` 1 a little, 2 far more, 3 the most (the escalation the owner asked for
   * on hits 4, 5 and 6). Only the painted juice and its own yellows: nothing red.
   */
  private juiceBurst(at: Pt, u: Pt, level: number): void {
    const S = this.scale;
    const L = this.look;
    const amt = Math.max(0, L.burstAmount);
    if (amt <= 0) return;
    const c = this.colors;
    const yellows = [c.juice, c.amber, c.gold, c.cream];
    const splats = Math.max(1, Math.round((level * 2 - 1) * amt));
    for (let i = 0; i < splats; i++) {
      const a = Math.atan2(-u.y, -u.x) + (this.rnd() - 0.5) * (1.8 + 0.8 * level);
      const r = (i === 0 ? 0 : 16 + this.rnd() * (22 + 18 * level)) * S;
      this.splatAt(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, L.splatPx * (0.5 + 0.3 * level) * (i === 0 ? 1 : 0.65),
        { dur: L.splatMs * (1.2 + 0.4 * level), delay: i * 25 });
    }
    const drops = Math.round(14 * level * level * amt);
    const spread = 2 + 0.7 * level;
    for (let i = 0; i < drops; i++) {
      const a = Math.atan2(-u.y, -u.x) + (this.rnd() - 0.5) * spread;
      const sp = (260 + this.rnd() * 560) * (0.8 + 0.25 * level) * S;
      const sz = (6 + this.rnd() * 11) * (0.85 + 0.2 * level) / DISC_PX * 2;
      this.particle('splat', this.tex.disc, yellows[i % 4]!, {
        x: at.x + this.fox, y: at.y + this.foy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160 * S, drag: 0.4, grav: 1300 * S,
        life: 560 + this.rnd() * 420, from: sz * S, to: sz * 0.6 * S, alpha: 1, align: false, tumble: 0, spin: 0,
      });
    }
    // Juice spatter that STAYS on the face (rides it), more each level, fading late.
    const f = this.face;
    const stay = Math.round(4 * level * level * amt);
    for (let i = 0; i < stay; i++) {
      const a = this.rnd() * Math.PI * 2, rr = Math.sqrt(this.rnd()) * (f ? f.r * 0.9 : 60 * S);
      const cx = f ? f.x : at.x, cy = f ? f.y : at.y;
      const sz = (5 + this.rnd() * 9) * (0.9 + 0.2 * level) / DISC_PX * 2;
      this.fxs('splat', this.tex.disc, yellows[(i + 1) % 4]!, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr,
        { dur: 1800 + 400 * level, from: sz * 0.6, to: sz, a0: 0.95, mode: 'hold', follow: true, sy: 0.8 + this.rnd() * 0.4 });
    }
    // and more juice running down the face
    this.dripsFrom(at, 2 * level);
  }

  /**
   * TIER IV'S FINALE (the finisher): the crushed giant BURSTS. A white-gold flash over the face, a massive painted splat,
   * a RING of splats bursting round it, a golden SHOCKWAVE, gold rays, the biggest juice burst, and a SHOWER of painted
   * bananas bursting up and tumbling down.
   */
  finale(i: number, x: number, y: number, radius: number, o: { burst: number; juice: number; flashAlpha: number }): void {
    this.endMark();
    const b = this.takeBanana(i);
    const st = this.stake;
    const at = st ? { x: st.entry.x, y: st.entry.y } : b ? b.m.b : { x, y };
    this.dropStake();
    const c = this.colors;
    const S = this.scale;
    const L = this.look;
    const portrait = (radius * 2) / GLOW_PX / S;
    const shock = (radius * 2) / SHOCK_PX / S;
    // Short and not too wide: the splats, the rays and the shower carry the finale; a big held glow reads as glare.
    this.fxs('core', this.tex.glow, whiten(c.gold, 0.6), x, y, { dur: 130, from: portrait * 1.1, to: portrait * 1.45, a0: 0.8 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 140, from: 1.1, to: 3.4, a0: o.flashAlpha });
    this.fxs('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 260, from: 1.4, to: 3.4, a0: 0.3 * o.flashAlpha });
    this.splatAt(at.x, at.y, L.splatPx * L.giantSplat * o.burst, { dur: L.splatMs * 1.6 });
    // Owner 2026-09-29: "what's the leftover circle here from the banana final slam? can you remove that?": the crater
    // ring and the cracks fade out with the burst (the splat on the target stays and fades as designed: "keep the
    // banana splat on the target still").
    this.clearResidue();
    const n = Math.max(0, Math.round(L.ringSplats));
    for (let s = 0; s < n; s++) {
      const a = (s / Math.max(1, n)) * Math.PI * 2 + this.rnd() * 0.4;
      const r = (radius / S) * (1.05 + this.rnd() * 0.3);
      this.splatAt(at.x + Math.cos(a) * r * S, at.y + Math.sin(a) * r * S, L.splatPx * (1.05 + 0.3 * this.rnd()), { delay: 40 + 25 * s, follow: false });
    }
    this.fxs('haze', this.tex.shock, c.gold, at.x, at.y, { dur: 640, from: shock * 0.6, to: shock * 4.2 * L.shockSize, a0: 0.7 });
    this.fxs('glow', this.tex.shock, whiten(c.gold, 0.5), at.x, at.y, { dur: 480, from: shock * 0.5, to: shock * 3.3 * L.shockSize, a0: 0.75 });
    const rays = Math.max(0, Math.round(L.goldRays));
    for (let r = 0; r < rays; r++) {
      const a = (r / Math.max(1, rays)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.3;
      const len = 1 + this.rnd() * 0.6;
      const f = this.fxs('glow', this.tex.streak, r % 2 ? c.gold : whiten(c.gold, 0.5), at.x + Math.cos(a) * radius * 0.9, at.y + Math.sin(a) * radius * 0.9,
        { dur: 380, from: 2.4 * len, to: 4.6 * len, a0: 0.7, sy: 0.3 });
      if (f) f.s.rotation = a;
    }
    this.juice(at.x, at.y, o.juice, { speed: L.juiceSpeed * 1.7, size: 1.3, life: L.juiceLifeMs * 1.4 });
    // The burst GUSHES juice down the face.
    this.dripsFrom(at, 22);
    // THE SHOWER: painted bananas burst up out of the splat, SPINNING (with backspin, like every banana), and rain down.
    const shower = Math.max(0, Math.round(L.showerBananas));
    for (let s = 0; s < shower; s++) {
      const a = -Math.PI / 2 + ((s / Math.max(1, shower - 1)) - 0.5) * 2.6 + (this.rnd() - 0.5) * 0.3;
      const sp = (520 + this.rnd() * 460) * S;
      const px = L.bananaPx * (0.55 + this.rnd() * 0.35) * S;
      const back = Math.cos(a) >= 0 ? -1 : 1;
      const p = this.particle('body', this.side(), s % 4 === 0 ? this.gild : 0xffffff, {
        x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.5, grav: 1500 * S,
        life: 1000 + this.rnd() * 400, from: px, to: px * 0.9, alpha: 1, align: false,
        tumble: 1, spin: back * (0.012 + this.rnd() * 0.01),
      });
      if (p) p.s.rotation = this.rnd() * Math.PI * 2;
    }
    this.sparkles(at.x, at.y, 18, 560, { life: 700, size: 0.5 });
  }

  /**
   * Clear the jam's dark residue (owner 2026-09-29: "what's the leftover circle here from the banana final slam? can you
   * remove that?": the crater ring was holding for 2.6 s, past the end of the attack): the crater ring and the cracks
   * fade out over ~180 ms. The juice (the splat, spatter and drips) plays out its own designed fade.
   */
  private clearResidue(): void {
    for (const q of this.fx) {
      if (!q.residue) continue;
      // Continue from the current opacity to nothing over ~180 ms.
      const now = q.s.alpha;
      const sc = q.s.scale.x / this.scale;
      q.mode = 'out'; q.a0 = now; q.age = 0; q.dur = 180; q.from = sc; q.to = sc; q.delay = 0;
    }
  }

  /** A splat pop round the target after the finale (IV): a painted splat and a juice puff. */
  boom(x: number, y: number, size: number): void {
    this.splatAt(x, y, this.look.splatPx * 0.8 * size, { follow: false });
    this.juice(x, y, 24, { speed: this.look.juiceSpeed * 0.9 });
  }

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

    if (this.aura) this.drawAura(this.aura, dt);

    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i]!;
      b.age += dt;
      // A banana with no splat cue (a cancelled tick) clears itself shortly after it lands.
      if (b.age > b.m.flightMs + 400) { this.dropBanana(b); this.bananas.splice(i, 1); continue; }
      this.drawBanana(b);
    }
    if (this.stake) this.drawStake(dt);
    if (this.drips.length) this.drawDrips(dt);

    const g = this.glintFx;
    if (g) {
      g.age += dt;
      const b = this.bananaOf(g.idx);
      if (b) {
        // A crown of light on the giant's top: two flashes, the second bigger, turning.
        const flash = Math.max(Math.exp(-(((g.age - 90) / 60) ** 2)), 1.3 * Math.exp(-(((g.age - 300) / 80) ** 2)));
        const tx = b.x, ty = b.y - b.px * 0.32;
        g.star.position.set(tx, ty); g.star.rotation += dt * 0.006; g.star.scale.set((0.4 + 1.3 * flash) * S); g.star.alpha = Math.min(1, flash);
        g.ring.position.set(tx, ty); g.ring.scale.set((0.1 + 0.5 * flash) * S); g.ring.alpha = 0.8 * Math.min(1, flash);
      } else { g.star.alpha = 0; g.ring.alpha = 0; }
    }

    const mk = this.mark;
    if (mk) {
      mk.age += dt;
      const u = clamp01(mk.age / mk.dur);
      const cx = mk.x + this.fox, cy = mk.y + this.foy;
      const base = (mk.r * 2) / RING_PX;
      mk.rings.forEach((s, j) => {
        const ph = (mk.age * 0.004 + j * 0.5) % 1;
        s.position.set(cx, cy);
        s.scale.set(base * (1.9 - 0.75 * ph) * (1 - 0.25 * u));
        s.alpha = Math.min(1, u * 4) * (1 - ph) * (0.7 + 0.3 * u);
      });
      const sd = (mk.r * 2) / DISC_PX;
      mk.shadow.position.set(cx, cy);
      mk.shadow.scale.set(sd * (0.35 + 0.65 * easeInOutSine(u)));
      mk.shadow.alpha = 0.3 * u;
    }

    const frames = this.tex.splat;
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const q = this.splats[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      if (q.age >= q.dur) { this.give(q.s); this.splats.splice(i, 1); continue; }
      this.drawSplat(q, frames);
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
        : q.mode === 'hold' ? q.a0 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
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
        p.s.scale.set(sc * (1 + Math.min(1.6, v / (900 * S))), sc * 0.5);
        p.s.alpha = p.alpha * (1 - t * t);
      } else if (p.tumble) {
        // A shower banana: its painting SPINS as it flies (fixed px size, whatever the frame's own box).
        const f = p.s.texture;
        p.s.scale.set(sc / Math.max(1, f.frame.width, f.frame.height));
        if (p.spin) p.s.rotation += p.spin * dt;
        p.s.alpha = p.alpha * (1 - Math.max(0, t - 0.75) / 0.25);
      } else {
        p.s.scale.set(sc);
        if (p.spin) p.s.rotation += p.spin * dt;
        p.s.alpha = p.alpha * (1 - t * t * t);
      }
    }

    return this.used > this.warm.length || this.aura !== null || this.mark !== null || this.stake !== null;
  }

  private drawSplat(q: Splat, frames = this.tex.splat): void {
    const u = clamp01(q.age / q.dur);
    const f = frames[Math.min(frames.length - 1, Math.floor(u * frames.length))]!;
    q.s.texture = f;
    const k = q.px / Math.max(1, f.frame.width);
    q.s.scale.set(k * q.flip, k);
    q.s.position.set(q.x + (q.follow ? this.fox : 0), q.y + (q.follow ? this.foy : 0));
    // The painting dissipates on its own; a soft fade over the last fifth keeps the end clean.
    q.s.alpha = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
  }

  private drawAura(a: Aura, dt: number): void {
    const S = this.scale;
    a.age += dt;
    const u = clamp01(a.age / a.dur);
    const e = easeInOutSine(u);
    let fade = 1;
    if (a.release >= 0) {
      a.release += dt;
      fade = 1 - clamp01(a.release / 220);
      if (fade <= 0) { this.dropAura(); return; }
    }
    const size = (a.r * 2) / GLOW_PX / S;
    const throb = 1 + (a.big ? 0.05 + 0.05 * u : 0.03) * Math.sin(a.age * (a.big ? 0.02 + 0.05 * u : 0.02));
    a.bloom.position.set(a.x, a.y);
    a.bloom.scale.set(size * (a.big ? 1.4 + 1.1 * e : 1.2 + 0.4 * e) * throb * S);
    a.bloom.alpha = (a.big ? 0.25 + 0.45 * e : 0.18 + 0.2 * e) * fade;
    const rs = ((a.r * 2) / RING_PX) * (a.big ? 1.25 + 0.1 * Math.sin(a.age * 0.03) : 1.6 - 0.45 * e);
    a.ring.position.set(a.x, a.y); a.ring.scale.set(rs); a.ring.alpha = (a.big ? 0.55 : 0.4) * Math.min(1, u * 3) * fade;
    // Gold motes drawn in to the hero, faster as it builds.
    a.moteAcc += dt * (a.big ? 0.02 + 0.07 * u : 0.012) * (a.release >= 0 ? 0 : 1);
    while (a.moteAcc >= 1) {
      a.moteAcc -= 1;
      const ang = this.rnd() * Math.PI * 2, r = a.r * (1.4 + this.rnd() * 0.8);
      const life = 200 + this.rnd() * 90;
      const sp = r / (life / 1000);
      this.particle('glow', this.tex.spark, this.rnd() < 0.5 ? this.colors.gold : this.colors.cream, {
        x: a.x + Math.cos(ang) * r, y: a.y + Math.sin(ang) * r, vx: -Math.cos(ang) * sp, vy: -Math.sin(ang) * sp, drag: 1, grav: 0,
        life, from: 0.45 * S, to: 0.15 * S, alpha: 1, align: true, tumble: 0, spin: 0,
      });
    }
    // Tier IV: glints flash round the rim, one after another.
    a.stars.forEach((s, j) => {
      const ph = (a.age * 0.0028 + j / Math.max(1, a.stars.length)) % 1;
      const fl = Math.exp(-(((ph - 0.5) / 0.12) ** 2));
      const ang = j * 1.9 + 0.6;
      s.position.set(a.x + Math.cos(ang) * a.r * 0.85, a.y + Math.sin(ang) * a.r * 0.85);
      s.rotation += dt * 0.005;
      s.scale.set((0.2 + 0.7 * fl) * S);
      s.alpha = fl * e * fade;
    });
  }

  /** Pose one banana: SPINNING (backspin) along its arc; the giant gilded, glowing, with a sheen, shedding gold. */
  private drawBanana(b: Banana): void {
    const S = this.scale;
    const L = this.look;
    const m = b.m;
    const p = bananaPos(m, b.age);
    const f = this.side();
    const born = clamp01(b.age / 70);
    const k = (b.px / Math.max(1, f.frame.width, f.frame.height)) * (0.6 + 0.4 * easeOutBack(born, 2));
    const vis = b.age <= m.flightMs ? 1 : 0;
    b.body.texture = f; b.body.position.set(p.x, p.y); b.body.rotation = p.rot; b.body.scale.set(k); b.body.alpha = vis;
    if (b.sheen) {
      b.sheen.texture = f; b.sheen.position.set(p.x, p.y); b.sheen.rotation = p.rot; b.sheen.scale.set(k);
      b.sheen.alpha = vis * (0.3 + 0.2 * Math.sin(b.age * 0.025));
    }
    b.glow.position.set(p.x, p.y);
    b.glow.scale.set((b.px * (m.giant ? 1.25 : 0.9)) / GLOW_PX);
    b.glow.alpha = vis * (m.giant ? 0.55 + 0.15 * Math.sin(b.age * 0.03) : 0.2);
    // Juice sparkles shed along the flight (the giant sheds gold, densely).
    if (vis && L.trailSparks > 0) {
      b.sparkAcc += Math.hypot(p.x - b.x, p.y - b.y);
      const every = ((m.giant ? 16 : 34) / L.trailSparks) * S;
      while (b.sparkAcc >= every) {
        b.sparkAcc -= every;
        const spread = b.px * (m.giant ? 0.35 : 0.2);
        this.particle('glow', m.giant ? this.tex.star : this.tex.glow, this.palette[Math.floor(this.rnd() * 4)]!, {
          x: p.x + (this.rnd() - 0.5) * spread, y: p.y + (this.rnd() - 0.5) * spread, vx: (this.rnd() - 0.5) * 50 * S, vy: (this.rnd() - 0.5) * 50 * S - 20 * S,
          drag: 0.3, grav: 0, life: 360 + this.rnd() * 220, from: (m.giant ? 0.45 : 0.16) * S, to: 0, alpha: 0.9, align: false, tumble: 0, spin: 0.01,
        });
      }
    }
    b.x = p.x; b.y = p.y;
  }

  /**
   * Pose the stake. Its painted upright cell stands stem-up, turned so its tip (local +y) points into the face along `u`;
   * the frame is CROPPED to the top (stem) part still outside, `1 - depth` of it, and anchored at its cut edge on the
   * entry point: the part driven in is simply not drawn, so it disappears into the face. Each slam kicks it (a squash and
   * a spring back) and it eases deeper.
   */
  private drawStake(dt: number): void {
    const st = this.stake!;
    st.age += dt;
    if (st.kick >= 0) st.kick += dt;
    st.depth += (st.target - st.depth) * (1 - Math.exp(-dt / 40));
    const cell = this.stakeCell, tx = this.stakeTex;
    if (!cell || !tx) return;
    // The painted banana spans ~the whole cell height; the cut sits `depth` of the way up from its tip.
    const visible = Math.max(0.06, Math.min(1, 1 - st.depth));
    tx.frame.x = cell.x; tx.frame.y = cell.y; tx.frame.width = cell.width; tx.frame.height = Math.max(2, Math.round(cell.height * visible));
    tx.orig.width = tx.frame.width; tx.orig.height = tx.frame.height;
    tx.update();
    this.stakeBody.texture = tx; this.stakeSheen.texture = tx;
    const k = st.len / Math.max(1, cell.height);
    const kick = st.kick >= 0 ? Math.exp(-st.kick / 70) : 0;
    const wob = 0.05 * Math.exp(-st.age / 260) * Math.sin(st.age * 0.05);
    // Squashed a little flatter per slam (it spreads across the blow), a kick on each slam, a wobble after landing.
    const across = 1 + 0.07 * st.crush + 0.22 * kick + wob;
    const along = Math.max(0.6, 1 - 0.03 * st.crush - 0.08 * kick);
    // Anchored (bottom-centre of the cropped frame) a hair inside the rim, so the cut edge tucks under the portrait.
    const c = { x: st.entry.x + this.fox + st.u.x * 4 * this.scale, y: st.entry.y + this.foy + st.u.y * 4 * this.scale };
    const rot = Math.atan2(st.u.y, st.u.x) - Math.PI / 2;
    for (const s of [this.stakeBody, this.stakeSheen]) { s.position.set(c.x, c.y); s.rotation = rot; s.scale.set(k * across, k * along); }
    this.stakeSheen.alpha = 0.25 + 0.15 * Math.sin(st.age * 0.02) + 0.5 * kick;
  }

  private dropStake(): void {
    this.stake = null;
    this.stakeBody.visible = false; this.stakeSheen.visible = false;
    if (this.stakeTex) {
      // Only the frame wrapper is ours; the source is the shared painted sheet.
      this.stakeBody.texture = Texture.EMPTY; this.stakeSheen.texture = Texture.EMPTY;
      this.stakeTex.destroy(false);
      this.stakeTex = null; this.stakeCell = null;
    }
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const b of this.bananas) this.dropBanana(b);
    for (const q of this.fx) this.give(q.s);
    for (const q of this.splats) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const s of this.warm) this.give(s);
    this.dropAura();
    this.endMark();
    this.dropStake();
    for (const d of this.drips) { this.give(d.stream); this.give(d.head); }
    this.bananas = []; this.fx = []; this.splats = []; this.particles = []; this.warm = []; this.drips = [];
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    if (this.cutting) this.uncut();
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.stakeLayer.removeChildren().forEach((c) => c.destroy());
    this.world.removeChildren().forEach((c) => c.destroy());
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
