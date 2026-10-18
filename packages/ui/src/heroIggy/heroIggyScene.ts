/**
 * THE IGGY BLAST SCENE: everything the Iggy Blast hero attack draws in Pixi, as a plain scene graph with no renderer, so
 * it runs (and is tested) headless. `heroIggy.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * What it draws (concept A, "Recoil Ward", owner pick 2026-10-18; pushed to a showstopper the same day: "seems pretty
 * uninspired right now"):
 *  - THE PRESENCE (the inhale): Immune Iggy rises behind the striking hero as FLAME, never a drawn prop. Two crimson
 *    flame WINGS (a crimson live fire of their own, white-hot along the leading edge) unfurl up and back off the
 *    portrait's shoulders, two cyan EYES open above it, and light and embers are PULLED INTO the mouth (sparks spiralling
 *    in, accelerating) while a glow swells in the throat.
 *  - THE WARD: a bubble round the hero, turned to face the target, with three concentric HEX RINGS that light one per
 *    stage. It FLATTENS against the back of the hero as the breath pushes, FLEXES harder just before the peak, holds
 *    through the hit-stop, then SLAMS outward. IV: it SHATTERS into glowing hex shards that rain out.
 *    PLACEHOLDER ART: the ward is built from textures the attacks already paint (the shock ring as the rim and the hex
 *    rings, the soft glow as its body, the Blast's ring as the cell glow) until the owner's painted hex ward dome lands.
 *    Swap the slots in `heroIggyTextures.ts`; nothing else changes.
 *  - THE BREATH: three LAYERED live-fire streams (`pixiFire`, its LINE shape) on a blue palette: wide, licking OUTER
 *    flames, a dense cyan MID body, and (from the top stage) a thin white-hot CORE. Sparks are kicked along its path and
 *    debris off the ground under it. Each stage is a real step: a gust front races down the stream, a hex ring lights,
 *    the stream thickens and roars.
 *  - THE SLAM (the hero moment): the whole scene FREEZES for the hit-stop (`freeze`), then a bloom flash, a ward rim
 *    blasting outward off the back, three staggered shockwaves and a dark pressure ring, a backward cone of fire, ground
 *    debris, the wings beating, and the MEGA-SURGE: a big white-blue head racing down a stream that swells behind it.
 *  - THE IMPACT: a blue flame detonation on the target. IV: a flame nova ring, a pillar of blue fire and a lingering
 *    blue-fire SCORCH.
 *
 * LAYERS, bottom to top: ground (normal: the scorch, the pressure ring, the ward body) | under (additive: the light the
 * fire casts) | the wing fire | the breath fire's back (normal) | fx (additive: rings, the ward rim, hex rings, shards,
 * sparks) | the breath fire's front (additive) | hot (additive: flashes, eyes, the surge head).
 *
 * Contract: one-shot, transform/opacity only (sprite position, rotation, scale, alpha, tint). Sprites are POOLED per
 * layer, bounded by `MAX_IGGY_SPRITES`; fire particles by `MAX_IGGY_PARTICLES` (+ `MAX_WING_PARTICLES`); textures are
 * the caller's and are pre-warmed at construction; `setCamera` mirrors the DOM camera; `update` returns whether anything
 * still draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay burns the same fire).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import { clamp01, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { PixiFire, type FireEmitter, type FireTextures } from '../heroAttack/pixiFire';

export interface HeroIggyTextures {
  fire: FireTextures;
  /** A soft round glow (the light, flashes, eyes). */
  glow: Texture;
  /** A small hot spark (debris, shards, sparks). */
  spark: Texture;
  /** A thin shock ring (its line at 115 of 256 px). */
  shock: Texture;
  /** A dark ragged burn ring (the Tier IV scorch). */
  scorch: Texture;
  /** THE WARD (placeholder until the painted dome): its body, its rim and its cell glow. */
  wardBody: Texture;
  wardRim: Texture;
  wardCells: Texture;
}

export interface IggyColors {
  core: number; hot: number; flame: number; deep: number; ember: number; smoke: number; ward: number;
  wing: number; wingHot: number; side: number;
}

export interface IggyLook {
  streamFlame: number;
  streamSpeed: number;
  turbulence: number; buoyancy: number; smoke: number; embers: number;
  wardAlpha: number;
  wings: number; eyes: number; inhale: number; sparks: number;
  backBlast: number;
  slamSize: number;
  shards: number;
  scorch: number;
  explodeSize: number;
}

/** Hard cap on the sprites (light, rings, flashes, the ward, shards, sparks) alive at once. */
export const MAX_IGGY_SPRITES = 380;
/** Hard cap on live breath-fire particles (a Tier IV impact peaks near it; the pool never grows past it). */
export const MAX_IGGY_PARTICLES = 1100;
/** Hard cap on the wing fire's particles. */
export const MAX_WING_PARTICLES = 600;

type LayerId = 'ground' | 'under' | 'fx' | 'hot';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['ground', 'normal'], ['under', 'add'], ['fx', 'add'], ['hot', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
/** Radius (px) a sprite of scale 1 covers: the soft glow (64 of 128 px), the shock ring (115 of 256), the scorch. */
const GLOW_R = 64, RING_R = 115, SCORCH_R = 102;
/** The three hex rings, as fractions of the ward's radius (innermost first: they light out from the hero). */
const HEX_RINGS = [0.5, 0.74, 0.97] as const;

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number; delay: number }

/** A flying piece (a glass shard, debris, a spark): ballistic, spinning, fading. */
interface Bit { s: Sprite; x: number; y: number; vx: number; vy: number; spin: number; age: number; life: number; a0: number; grav: number; drag: number; stretch: boolean; sx: number; sy: number }

/** A mote of light being PULLED INTO the mouth: it spirals in from `from`, accelerating. */
interface Mote { s: Sprite; fx: number; fy: number; age: number; life: number; swirl: number; size: number }

interface Ward {
  body: Sprite; rim: Sprite; cells: Sprite; hex: Sprite[]; lit: number[];
  x: number; y: number; R: number; rot: number;
}

interface Stream { outer: FireEmitter; mid: FireEmitter; core: FireEmitter; throat: FireEmitter; light: Sprite | null; mouth: Pt; to: Pt; dir: Pt; R: number; width: number; reach: number; level: number; sparkAcc: number; boost: number }

interface Surge { em: FireEmitter; head: Sprite; halo: Sprite; ring: Sprite }

/** One flame feather of a wing: a line emitter from the shoulder whose tip unfurls out to `tip`. */
interface Feather { em: FireEmitter; sx: number; sy: number; tx: number; ty: number }

interface Presence { feathers: Feather[]; eyes: Sprite[]; throat: Sprite | null; x: number; y: number; R: number; dir: Pt }

export class HeroIggyScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly fire: PixiFire;
  private readonly wingFire: PixiFire;
  private readonly rnd: () => number;
  private used = 0;
  private clock = 0;
  private frozen = 0;
  private fx: Fx[] = [];
  private bits: Bit[] = [];
  private motes: Mote[] = [];
  private ward: Ward | null = null;
  private stream: Stream | null = null;
  private surge: Surge | null = null;
  private presence: Presence | null = null;
  private inhaling: { x: number; y: number; R: number; dir: Pt; left: number; acc: number } | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private reserving = false;
  private destroyed = false;
  private readonly S: number;

  constructor(private readonly tex: HeroIggyTextures, private readonly colors: IggyColors, private readonly look: IggyLook, scale = 1, seed = 1) {
    this.S = scale;
    this.rnd = seededRng(seed * 31 + 7);
    this.root.eventMode = 'none';
    this.root.label = 'heroIggy';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `iggy-${id}`;
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    this.fire = new PixiFire(tex.fire, {
      cap: MAX_IGGY_PARTICLES, scale, seed: seed * 17 + 5,
      palette: { core: colors.core, hot: colors.hot, mid: colors.flame, deep: colors.deep, dark: colors.ember, smoke: colors.smoke },
      smoke: look.smoke, embers: look.embers, turb: look.turbulence, lift: look.buoyancy,
    });
    // Iggy's wings burn crimson with white-hot leading edges (his own colours, not the breath's).
    this.wingFire = new PixiFire(tex.fire, {
      cap: MAX_WING_PARTICLES, scale, seed: seed * 13 + 11,
      palette: { core: colors.wingHot, hot: mixColor(colors.wingHot, colors.wing, 0.45), mid: colors.wing, deep: mixColor(colors.wing, 0x000000, 0.35), dark: mixColor(colors.wing, 0x000000, 0.75), smoke: 0x1c1216 },
      smoke: 0.3 * look.smoke, embers: look.embers, turb: look.turbulence, lift: 1,
    });
    const L = this.layers;
    this.root.addChild(L.ground, L.under, this.wingFire.root, this.fire.back, L.fx, this.fire.front, L.hot);
    // PRE-WARM: one near-invisible sprite per texture while the damage formation plays (no first-use upload spike).
    const f = tex.fire;
    for (const w of [tex.glow, tex.spark, tex.shock, tex.scorch, tex.wardBody, tex.wardRim, tex.wardCells, ...f.puffs, f.tongue, f.smoke, f.ember, f.glow]) {
      const s = this.take('hot', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
    // The fire's sprite pools are built a slice a frame while the formation plays (no burst of creation at the slam).
    this.fire.planReserve();
    this.wingFire.planReserve([0.1, 0.2, 0.62, 0.08]);
    this.reserving = true;
  }

  get liveSprites(): number { return this.used - this.warm.length + this.fire.count + this.wingFire.count; }
  get liveFire(): number { return this.fire.count + this.wingFire.count; }
  get wardUp(): boolean { return this.ward !== null; }
  get breathing(): boolean { return this.stream !== null; }
  get surging(): boolean { return this.surge !== null; }
  get liveBits(): number { return this.bits.length; }
  get liveMotes(): number { return this.motes.length; }
  get isFrozen(): boolean { return this.frozen > 0; }
  get emitters(): number { return this.fire.emitting + this.wingFire.emitting; }
  get time(): number { return this.clock; }
  get litRings(): number { return this.ward ? this.ward.lit.filter((v) => v >= 0).length : 0; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_IGGY_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1); s.position.set(0, 0);
    (s as Sprite & { iggyLayer?: LayerId }).iggyLayer = layer;
    this.used++;
    return s;
  }

  private give(s: Sprite | null | undefined): void {
    if (!s) return;
    const layer = (s as Sprite & { iggyLayer?: LayerId }).iggyLayer ?? 'hot';
    s.visible = false;
    this.freeSprites[layer].push(s);
    this.used--;
  }

  /** A one-shot sprite: scale `from` -> `to` (radii in px, converted by `unit`), fading by `mode`. */
  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, unit: number, o: Partial<Omit<Fx, 's' | 'age'>> & { dur: number; from: number; to: number; a0: number }): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.25, delay: 0, ...o, from: o.from / unit, to: o.to / unit };
    s.position.set(x, y);
    s.scale.set(f.from);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  /** A flying piece thrown from (x, y) along `ang`. `stretch` keeps it pointing along its motion (a streak). */
  private bit(layer: LayerId, t: Texture, tint: number, x: number, y: number, ang: number, speed: number, life: number, sx: number, sy: number, a0: number, grav: number, o: { drag?: number; stretch?: boolean; spin?: number } = {}): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(x, y);
    s.scale.set(sx, sy);
    s.rotation = ang;
    s.alpha = a0;
    this.bits.push({
      s, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, spin: o.spin ?? (this.rnd() - 0.5) * 0.02, age: 0, life, a0, grav,
      drag: o.drag ?? 1.2, stretch: o.stretch ?? false, sx, sy,
    });
  }

  /** THE HIT-STOP: everything in the scene holds still for `ms` (the clock, the fire, the bits). */
  freeze(ms: number): void {
    if (this.destroyed || !(ms > 0)) return;
    this.frozen = Math.max(this.frozen, ms);
  }

  // ── the presence: wings, eyes, the inhale ─────────────────────────────────────────────────────────────────

  /**
   * Iggy rises behind the hero (at x, y, radius R, facing `dir`) for `durMs`: crimson flame wings unfurl up and back off
   * its shoulders, two cyan eyes open above it, and light is pulled into the mouth until the breath.
   */
  rise(x: number, y: number, R: number, dir: Pt, durMs: number): void {
    if (this.destroyed || this.presence) return;
    const L = this.look;
    // THE WINGS: a fan of three flame feathers off each shoulder, swept UP and out (screen up, whichever way the hero
    // faces), leaning a little away from the target. The top feather burns white-hot along the leading edge (Iggy's
    // white), the lower two crimson. Each feather's tip UNFURLS out from the shoulder through the inhale.
    const back = Math.sign(-dir.x) || 1;
    const feathers: Feather[] = [];
    if (L.wings > 0) {
      for (const side of [-1, 1] as const) {
        const sx = x + side * R * 0.62, sy = y - R * 0.35;
        const lean = side === back ? 1.15 : 0.9; // the wing on the side away from the target spreads a touch wider
        const fan: [number, number, number][] = [[2.5, -2.05, 1], [2.75, -1.25, 0.82], [2.35, -0.45, 0.7]];
        fan.forEach(([ox, oy, heat], i) => {
          const tx = sx + side * R * ox * lean, ty = sy + R * oy;
          const em = this.wingFire.emitter({
            shape: 'line', x: sx, y: sy, x2: sx, y2: sy, r: R * (0.14 + 0.05 * i), rate: (380 - 70 * i) * L.wings, size: R * (0.78 - 0.1 * i),
            life: 300, lift: 190, speed: 30, vx: side * 40, vy: -30, heat, turb: 220, tongues: 0.45, body: 0.3, smoke: 0.04,
            embers: i === 0 ? 18 : 6, emberSpeed: 200,
          });
          em.intensity = 0;
          feathers.push({ em, sx, sy, tx, ty });
        });
      }
    }
    // THE EYES: two slanted cyan slits that open above the hero, each with a white-hot core.
    const eyes: Sprite[] = [];
    if (L.eyes > 0) {
      for (const side of [-1, 1]) {
        const e = this.take('hot', this.tex.glow, this.colors.hot);
        const core = this.take('hot', this.tex.glow, 0xffffff);
        if (e && core) {
          const ex = x + side * R * 0.42, ey = y - R * 1.55;
          e.position.set(ex, ey); core.position.set(ex, ey);
          e.rotation = side * 0.32; core.rotation = side * 0.32;
          e.alpha = 0; core.alpha = 0;
          eyes.push(e, core);
        } else { this.give(e); this.give(core); }
      }
    }
    const throat = this.take('under', this.tex.fire.glow, this.colors.flame);
    if (throat) { throat.alpha = 0; throat.position.set(x + dir.x * R * 0.9, y + dir.y * R * 0.9); }
    this.presence = { feathers, eyes, throat, x, y, R, dir };
    this.inhaling = { x: x + dir.x * R * 0.9, y: y + dir.y * R * 0.9, R, dir, left: durMs, acc: 0 };
    // A wing-unfurl whoosh of crimson off each shoulder.
    for (const side of [-1, 1]) {
      this.wingFire.burst(x + side * R * 0.7, y - R * 0.35, { n: 14 * L.wings, radius: R * 0.25, speed: 460, size: R * 0.45, life: 420, dir: Math.atan2(-0.8, side), spread: 1, drag: 3, heat: 0.9, smoke: 0.05 });
    }
  }

  /** Paint the presence for this frame: `u` 0..1 how far it has risen (and how wide the eyes are), `flare` a pulse. */
  setPresence(u: number, flare: number): void {
    const p = this.presence;
    if (!p) return;
    const L = this.look;
    const k = clamp01(u);
    const R = p.R;
    // The wings unfurl (an ease-out: they snap open, then settle) and burn hotter on the slam.
    const open = 1 - (1 - k) * (1 - k) * (1 - k);
    const beat = 1 + 0.18 * flare;
    for (const f of p.feathers) {
      f.em.x2 = f.sx + (f.tx - f.sx) * open * beat; f.em.y2 = f.sy + (f.ty - f.sy) * open * beat;
      f.em.intensity = Math.min(1, k * 1.6) * (1 + 0.9 * flare);
    }
    for (let i = 0; i < p.eyes.length; i++) {
      const s = p.eyes[i]!;
      const core = i % 2 === 1;
      // They open late in the inhale (a beat after the wings), then blaze on the slam.
      const lid = clamp01((k - 0.35) / 0.5);
      const opened = lid * lid * (3 - 2 * lid);
      const blink = 0.9 + 0.1 * Math.sin(this.clock * 0.03 + i);
      s.scale.set((R * (core ? 0.3 : 0.62) * (1 + 0.5 * flare)) / GLOW_R, (R * (core ? 0.07 : 0.2) * opened * (1 + 0.5 * flare)) / GLOW_R);
      s.alpha = Math.min(1, L.eyes * opened * (core ? 1 : 0.9) * blink * (1 + flare));
    }
    if (p.throat) {
      p.throat.scale.set((R * (0.8 + 1.4 * k + 1.2 * flare)) / GLOW_R);
      p.throat.alpha = Math.min(0.9, 0.2 + 0.5 * k + 0.4 * flare);
    }
  }

  /** The wings BEAT (the slam): a gust of crimson flame off each wing. */
  wingBeat(size: number): void {
    const p = this.presence;
    if (!p) return;
    for (let i = 0; i < p.feathers.length; i += 3) {
      const f = p.feathers[i]!;
      this.wingFire.burst(f.em.x2, f.em.y2, { n: 20 * size * this.look.wings, radius: p.R * 0.45, speed: 560, size: p.R * 0.5, life: 480, drag: 2.6, heat: 0.95, tongues: 0.3, smoke: 0.08, embers: 8 });
    }
  }

  /** The presence fades: the wings burn out, the eyes close. */
  fadePresence(): void {
    const p = this.presence;
    if (!p) return;
    for (const f of p.feathers) this.wingFire.stop(f.em);
    for (const e of p.eyes) this.fxs('hot', this.tex.glow, e.tint as number, e.x, e.y, GLOW_R, { dur: 260, from: (e.scale.x * GLOW_R), to: e.scale.x * GLOW_R * 0.3, a0: e.alpha });
    for (const e of p.eyes) this.give(e);
    this.give(p.throat);
    this.presence = null;
    this.inhaling = null;
  }

  /** Spawn the motes pulled into the mouth (the inhale) for this frame. */
  private updateInhale(step: number): void {
    const ih = this.inhaling;
    if (!ih) return;
    ih.left -= step;
    if (ih.left <= 0) { this.inhaling = null; return; }
    ih.acc += (step / 1000) * 150 * this.look.inhale;
    while (ih.acc >= 1) {
      ih.acc -= 1;
      // From a wide arc AHEAD of the mouth (and a little round it), so the light streams in from where the breath will go.
      const base = Math.atan2(ih.dir.y, ih.dir.x);
      const a = base + (this.rnd() - 0.5) * Math.PI * 1.5;
      const d = ih.R * (1.8 + this.rnd() * 2.2);
      const s = this.take('fx', this.tex.spark, this.rnd() < 0.35 ? 0xffffff : this.colors.hot);
      if (!s) break;
      const size = (this.rnd() < 0.5 ? 0.55 : 0.3) * this.S;
      s.alpha = 0;
      this.motes.push({ s, fx: ih.x + Math.cos(a) * d, fy: ih.y + Math.sin(a) * d, age: 0, life: 380 + this.rnd() * 260, swirl: (this.rnd() < 0.5 ? -1 : 1) * (0.6 + this.rnd() * 0.8), size });
    }
  }

  private updateMotes(step: number): void {
    const ih = this.presence;
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i]!;
      m.age += step;
      const u = m.age / m.life;
      if (u >= 1 || !ih) { this.give(m.s); this.motes.splice(i, 1); continue; }
      // Ease IN: it drifts, then is sucked in faster and faster, curling as it goes.
      const e = u * u * u;
      const tx = ih.x + ih.dir.x * ih.R * 0.9, ty = ih.y + ih.dir.y * ih.R * 0.9;
      const dx = m.fx - tx, dy = m.fy - ty;
      const ang = m.swirl * (1 - e) * 1.2;
      const ca = Math.cos(ang * e), sa = Math.sin(ang * e);
      const rx = (dx * ca - dy * sa) * (1 - e), ry = (dx * sa + dy * ca) * (1 - e);
      const x = tx + rx, y = ty + ry;
      const prevX = m.s.x, prevY = m.s.y;
      m.s.position.set(x, y);
      if (m.age > step) m.s.rotation = Math.atan2(y - prevY, x - prevX);
      m.s.scale.set(m.size * (1 + 3 * e), m.size * (1 - 0.5 * e));
      m.s.alpha = Math.min(1, u * 4) * (1 - e * 0.3);
    }
  }

  // ── the ward ───────────────────────────────────────────────────────────────────────────────────────────────

  /** The ward shimmers up round the attacker (radius R), turned to face along `dir`. */
  wardUpAt(x: number, y: number, R: number, dir: Pt): void {
    if (this.destroyed || this.ward) return;
    // The ward lives in two layers: its body (normal, behind the fire) and its rim + cells + hex rings (additive, over
    // it); every frame `setWard` writes one transform (position, rotation, scale) and an alpha onto each.
    const body = this.take('ground', this.tex.wardBody, this.colors.ward);
    const rim = this.take('fx', this.tex.wardRim, whiten(this.colors.ward, 0.35));
    const cells = this.take('fx', this.tex.wardCells, this.colors.ward);
    if (!body || !rim || !cells) { this.give(body); this.give(rim); this.give(cells); return; }
    const hex: Sprite[] = [];
    for (let i = 0; i < HEX_RINGS.length; i++) {
      const h = this.take('fx', this.tex.shock, whiten(this.colors.ward, 0.55));
      if (h) { h.alpha = 0; hex.push(h); }
    }
    body.alpha = 0; rim.alpha = 0; cells.alpha = 0;
    this.ward = { body, rim, cells, hex, lit: hex.map(() => -1), x, y, R, rot: Math.atan2(dir.y, dir.x) };
    // The shimmer up: a ring closing in, a glint.
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.5), x, y, RING_R, { dur: 360, from: R * 2.1, to: R * 1.02, a0: 0.7, mode: 'punch', peakAt: 0.45 });
  }

  /** A hex ring LIGHTS (one per stage, innermost first): it flashes on and then stays lit. */
  lightRing(i: number): void {
    const w = this.ward;
    if (!w || i < 0 || i >= w.hex.length || w.lit[i]! >= 0) return;
    w.lit[i] = this.clock;
    const r = w.R * HEX_RINGS[i]!;
    this.fxs('fx', this.tex.shock, 0xffffff, w.x, w.y, RING_R, { dur: 240, from: r * 0.85, to: r * 1.25, a0: 0.9 });
    this.fxs('hot', this.tex.glow, whiten(this.colors.ward, 0.5), w.x, w.y, GLOW_R, { dur: 200, from: r * 0.6, to: r * 1.1, a0: 0.3 });
  }

  /**
   * Paint the ward for this frame: `up` 0..1, flattened by `flatten` against the back of the hero along the line of
   * fire, glowing by `glow`, and bursting outward by `slam` (0..1, the overshoot after the hit-stop).
   */
  setWard(up: number, flatten: number, glow: number, slam = 0): void {
    const w = this.ward;
    if (!w) return;
    const R = w.R * (1 + 0.32 * slam);
    // Squash along the line of fire (the push), bulge across it; the centre slides back so the BACK face flattens.
    const f = Math.min(0.62, flatten);
    const along = Math.max(0.38, 1 - f);
    const across = 1 + f * 0.5;
    const back = w.R * f * 0.55;
    const cx = w.x - Math.cos(w.rot) * back, cy = w.y - Math.sin(w.rot) * back;
    const shimmer = 0.92 + 0.08 * Math.sin(this.clock * 0.021);
    const a = this.look.wardAlpha * up;
    const place = (s: Sprite, rad: number, unit: number, alpha: number): void => {
      s.position.set(cx, cy);
      s.rotation = w.rot;
      s.scale.set((rad * along) / unit, (rad * across) / unit);
      s.alpha = Math.max(0, alpha);
    };
    place(w.body, R, GLOW_R, a * 0.42 * (0.8 + 0.2 * glow));
    place(w.rim, R, RING_R, a * (0.6 + 0.4 * Math.min(1.6, glow)) * shimmer * (1 + slam));
    place(w.cells, R * 0.92, RING_R, a * 0.6 * Math.min(1.6, glow) * (0.85 + 0.15 * Math.sin(this.clock * 0.05)));
    for (let i = 0; i < w.hex.length; i++) {
      const lit = w.lit[i]!;
      const on = lit >= 0 ? Math.min(1, (this.clock - lit) / 80) : 0;
      // A lit ring hums (each a little out of phase), brighter with the glow.
      const hum = 0.75 + 0.25 * Math.sin(this.clock * 0.04 + i * 1.9);
      place(w.hex[i]!, R * HEX_RINGS[i]!, RING_R, a * on * hum * (0.55 + 0.3 * Math.min(1.6, glow)));
    }
  }

  /** Drop the ward sprites (shattered, or faded out). */
  dropWard(): void {
    const w = this.ward;
    if (!w) return;
    this.give(w.body); this.give(w.rim); this.give(w.cells);
    for (const h of w.hex) this.give(h);
    this.ward = null;
  }

  /** Debris flicked off the crouching hero's base (Iggy's claws kicking up the ground). */
  kickDebris(x: number, y: number, R: number, dir: Pt, n: number): void {
    if (this.destroyed) return;
    const backAng = Math.atan2(-dir.y, -dir.x);
    for (let i = 0; i < n; i++) {
      const ang = backAng + (this.rnd() - 0.5) * 1.4 - 0.5;
      const sz = (0.2 + this.rnd() * 0.25) * this.S;
      this.bit('fx', this.tex.spark, mixColor(this.colors.smoke, 0xffffff, 0.35), x + (this.rnd() - 0.5) * R, y + R * 0.8, ang, (260 + this.rnd() * 320) * this.S, 460 + this.rnd() * 260, sz, sz, 0.8, 1500 * this.S);
    }
  }

  // ── the breath ─────────────────────────────────────────────────────────────────────────────────────────────

  /** The breath starts: three layered streams pour from `mouth` toward `to`, the front advancing (`setStream`). */
  startStream(mouth: Pt, to: Pt, R: number, width: number): void {
    if (this.destroyed || this.stream) return;
    const dx = to.x - mouth.x, dy = to.y - mouth.y;
    const L = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / L, y: dy / L };
    const flow = 900 * this.look.streamSpeed;
    const F = this.look.streamFlame;
    const line = (o: { r: number; rate: number; size: number; life: number; heat: number; tongues: number; lift: number; flowK: number; turb: number; embers: number; body: number }): FireEmitter =>
      this.fire.emitter({
        shape: 'line', x: mouth.x, y: mouth.y, x2: mouth.x, y2: mouth.y, r: R * o.r * width, rate: o.rate * F, size: R * o.size * width,
        life: o.life, lift: o.lift, speed: 50, vx: dir.x * flow * o.flowK, vy: dir.y * flow * o.flowK, heat: o.heat, turb: o.turb,
        tongues: o.tongues, body: o.body, smoke: 0.03, embers: o.embers, emberSpeed: 180, drag: 1.2, sweep: false,
      });
    // OUTER: wide, slower, licking flames curling off the edges. MID: the dense cyan body. CORE: white-hot (top stage).
    const outer = line({ r: 0.42, rate: 520, size: 0.62, life: 320, heat: 0.45, tongues: 0.6, lift: 160, flowK: 0.25, turb: 520, embers: 8, body: 0.35 });
    const mid = line({ r: 0.2, rate: 900, size: 0.5, life: 260, heat: 0.6, tongues: 0.3, lift: 80, flowK: 0.4, turb: 300, embers: 10, body: 0.2 });
    const core = line({ r: 0.06, rate: 700, size: 0.26, life: 180, heat: 1, tongues: 0.05, lift: 20, flowK: 0.6, turb: 120, embers: 0, body: 0 });
    core.intensity = 0;
    const throat = this.fire.emitter({
      shape: 'point', x: mouth.x, y: mouth.y, r: R * 0.18 * width, rate: 420 * F, size: R * 0.6 * width,
      life: 200, lift: 60, speed: 60, vx: dir.x * flow, vy: dir.y * flow, heat: 0.75, turb: 240, tongues: 0.35, body: 0.2,
      smoke: 0.02, drag: 2.4, sweep: false,
    });
    const light = this.take('under', this.tex.fire.glow, this.colors.flame);
    if (light) { light.alpha = 0; light.rotation = Math.atan2(dir.y, dir.x); }
    this.stream = { outer, mid, core, throat, light, mouth, to, dir, R, width, reach: 0, level: 1, sparkAcc: 0, boost: 0 };
    // The first gout: a burst off the mouth and a ring.
    this.fire.burst(mouth.x, mouth.y, { n: 18, radius: R * 0.2, speed: 620, size: R * 0.5, life: 300, dir: Math.atan2(dir.y, dir.x), spread: 0.9, drag: 3.5, heat: 0.75, smoke: 0.05 });
    this.fxs('fx', this.tex.shock, whiten(this.colors.hot, 0.3), mouth.x, mouth.y, RING_R, { dur: 220, from: R * 0.2, to: R * 0.8, a0: 0.7 });
  }

  /** Paint the stream's front for this frame (`reach` 0..1 of the way to the target). */
  setStream(reach: number): void {
    const st = this.stream;
    if (!st) return;
    const r = clamp01(reach);
    st.reach = r;
    const fx = st.mouth.x + (st.to.x - st.mouth.x) * r, fy = st.mouth.y + (st.to.y - st.mouth.y) * r;
    st.outer.x2 = fx; st.outer.y2 = fy; st.mid.x2 = fx; st.mid.y2 = fy; st.core.x2 = fx; st.core.y2 = fy;
    if (st.light) {
      const len = Math.hypot(fx - st.mouth.x, fy - st.mouth.y);
      st.light.position.set((st.mouth.x + fx) / 2, (st.mouth.y + fy) / 2);
      st.light.scale.set(Math.max(0.01, len / (GLOW_R * 1.6)), (st.R * 0.42 * st.width * 2.8 * (1 + 0.5 * st.boost)) / GLOW_R);
    }
  }

  /**
   * The breath SHIFTS UP to `level` (1 thin blue, 2 cyan, 3 white-cored): every layer retuned hotter, wider and denser,
   * the core lights on the top stage, a gust front races down the stream, the mouth flashes and a hex ring lights.
   */
  shiftStream(o: { heat: number; width: number; rate: number; level: number; top: boolean; gustMs: number }): void {
    const st = this.stream;
    if (!st) return;
    const R = st.R;
    st.level = o.level;
    st.width = o.width;
    const F = this.look.streamFlame;
    st.outer.heat = Math.max(0.4, o.heat - 0.2); st.mid.heat = o.heat; st.throat.heat = Math.min(1, o.heat + 0.15);
    st.outer.r = R * 0.42 * o.width; st.outer.size = R * 0.62 * o.width; st.outer.rate = 520 * F * o.rate;
    st.mid.r = R * 0.2 * o.width; st.mid.size = R * 0.5 * o.width; st.mid.rate = 900 * F * o.rate;
    st.core.r = R * 0.06 * o.width; st.core.size = R * 0.26 * o.width;
    st.throat.r = R * 0.18 * o.width; st.throat.size = R * 0.6 * o.width; st.throat.rate = 420 * F * o.rate;
    st.core.intensity = o.top ? 1 : 0;
    st.outer.embers = 8 + 8 * o.level; st.mid.embers = 10 + 10 * o.level;
    if (st.light) st.light.alpha = 0.2 + 0.12 * o.level;
    const ang = Math.atan2(st.dir.y, st.dir.x);
    this.fire.burst(st.mouth.x, st.mouth.y, { n: 12 + 10 * o.level, radius: R * 0.22, speed: 760, size: R * 0.5 * o.width, life: 320, dir: ang, spread: 0.8, drag: 3, heat: o.heat, smoke: 0.04 });
    this.fxs('hot', this.tex.glow, whiten(this.colors.hot, 0.35), st.mouth.x, st.mouth.y, GLOW_R, { dur: 180, from: R * 0.35, to: R * (0.8 + 0.25 * o.level), a0: 0.55 + 0.12 * o.level });
    this.fxs('fx', this.tex.shock, whiten(this.colors.hot, 0.3), st.mouth.x, st.mouth.y, RING_R, { dur: 260, from: R * 0.25, to: R * (0.8 + 0.2 * o.level), a0: 0.6 });
    // THE GUST FRONT: a bright knot of flame racing down the stream to the target (it lands as the stage's tick).
    const head = this.take('hot', this.tex.glow, whiten(this.colors.hot, 0.5));
    if (head) {
      head.position.set(st.mouth.x, st.mouth.y);
      head.scale.set((R * 0.5 * o.width) / GLOW_R);
      head.alpha = 0.7;
      const sp = Math.hypot(st.to.x - st.mouth.x, st.to.y - st.mouth.y) / Math.max(60, o.gustMs) * 1000;
      this.bits.push({ s: head, x: st.mouth.x, y: st.mouth.y, vx: st.dir.x * sp, vy: st.dir.y * sp, spin: 0, age: 0, life: Math.max(60, o.gustMs), a0: 0.7, grav: 0, drag: 0, stretch: false, sx: head.scale.x, sy: head.scale.y });
    }
    this.lightRing(o.level - 1);
  }

  /** A stage front reaching the target: a gust of blue flame splashes off it (a tick). */
  splash(x: number, y: number, R: number, dir: Pt, level: number): void {
    if (this.destroyed) return;
    const ang = Math.atan2(dir.y, dir.x);
    this.fire.burst(x, y, { n: 14 + 8 * level, radius: R * 0.3, speed: 460, size: R * 0.5, life: 400, dir: ang, spread: 2.4, drag: 3, heat: 0.8, smoke: 0.12, embers: 4 + 2 * level });
    this.fxs('hot', this.tex.glow, whiten(this.colors.hot, 0.4), x, y, GLOW_R, { dur: 130, from: R * 0.4, to: R * (0.9 + 0.15 * level), a0: 0.55 });
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.3), x, y, RING_R, { dur: 260, from: R * 0.4, to: R * (1.1 + 0.2 * level), a0: 0.5 });
  }

  /** Sparks kicked along the stream and debris off the ground under it, at a rate that climbs with the stage. */
  private updateStreamSparks(step: number): void {
    const st = this.stream;
    if (!st || st.reach <= 0.05) return;
    st.sparkAcc += (step / 1000) * (24 + 22 * st.level) * this.look.sparks * (1 + st.boost);
    const ang = Math.atan2(st.dir.y, st.dir.x);
    while (st.sparkAcc >= 1) {
      st.sparkAcc -= 1;
      const f = this.rnd() * st.reach;
      const x = st.mouth.x + (st.to.x - st.mouth.x) * f + (this.rnd() - 0.5) * st.R * 0.5 * st.width;
      const y = st.mouth.y + (st.to.y - st.mouth.y) * f + (this.rnd() - 0.5) * st.R * 0.5 * st.width;
      if (this.rnd() < 0.8) {
        // A spark flung forward and out of the stream, streaking.
        const a = ang + (this.rnd() - 0.5) * 0.9;
        const sz = (0.16 + this.rnd() * 0.18) * this.S;
        this.bit('fx', this.tex.spark, this.rnd() < 0.4 ? 0xffffff : this.colors.hot, x, y, a, (620 + this.rnd() * 620) * this.S, 220 + this.rnd() * 220, sz * 2.4, sz * 0.6, 0.95, 260 * this.S, { stretch: true, drag: 2.2 });
      } else {
        // Debris torn up off the ground under the stream.
        const a = -Math.PI / 2 + (this.rnd() - 0.5) * 1.2;
        const sz = (0.2 + this.rnd() * 0.22) * this.S;
        this.bit('fx', this.tex.spark, mixColor(this.colors.smoke, 0xffffff, 0.4), x, y + st.R * 0.4, a, (260 + this.rnd() * 260) * this.S, 420 + this.rnd() * 200, sz, sz, 0.75, 1500 * this.S);
      }
    }
  }

  /** The stream is cut: nothing new pours, what is burning burns out. */
  stopStream(): void {
    const st = this.stream;
    if (!st) return;
    this.fire.stop(st.outer); this.fire.stop(st.mid); this.fire.stop(st.core); this.fire.stop(st.throat);
    this.give(st.light);
    this.stream = null;
  }

  // ── the slam, the surge, the impact ───────────────────────────────────────────────────────────────────────

  /**
   * THE SLAM (after the hit-stop): the ward bursts outward behind the hero. A bloom flash, the ward rim blasted off its
   * back face, three staggered shockwaves and a dark pressure ring, a backward cone of fire, ground debris, the wings
   * beating; IV: the ward SHATTERS into glowing hex shards that rain out. Then the MEGA-SURGE leaves the mouth.
   */
  slam(o: { shatter: boolean; R: number; size: number; screen: number }): void {
    if (this.destroyed) return;
    const w = this.ward;
    const st = this.stream;
    const R = o.R;
    const L = this.look;
    const rot = w ? w.rot : st ? Math.atan2(st.dir.y, st.dir.x) : 0;
    const cx = w ? w.x : st ? st.mouth.x : 0, cy = w ? w.y : st ? st.mouth.y : 0;
    const bx = cx - Math.cos(rot) * R * 1.05, by = cy - Math.sin(rot) * R * 1.05;
    const backAng = rot + Math.PI;
    const k = L.backBlast * o.size * L.slamSize;
    const wardC = whiten(this.colors.ward, 0.55);
    // BLOOM: a white flash on the back face and a wide, soft wash across the screen.
    this.fxs('hot', this.tex.glow, 0xffffff, bx, by, GLOW_R, { dur: 120, from: R * 0.8, to: R * 2.2 * k, a0: 1 });
    this.fxs('hot', this.tex.glow, wardC, cx, cy, GLOW_R, { dur: 200, from: R * 1.4, to: R * 3.2 * k, a0: 0.75 });
    this.fxs('hot', this.tex.glow, whiten(this.colors.flame, 0.4), cx, cy, GLOW_R, { dur: 220, from: o.screen * 0.35, to: o.screen * 0.6, a0: 0.22 * Math.min(1.5, k) });
    // THE WARD BLASTED OFF ITS BACK: its rim flung outward and back, fast, then three staggered shockwaves.
    this.fxs('fx', this.tex.wardRim, wardC, bx, by, RING_R, { dur: 360, from: R * 0.9, to: R * 3.6 * k, a0: 1 });
    this.fxs('fx', this.tex.shock, 0xffffff, bx, by, RING_R, { dur: 420, from: R * 0.5, to: R * 4.4 * k, a0: 0.95 });
    this.fxs('fx', this.tex.shock, wardC, bx, by, RING_R, { dur: 560, delay: 70, from: R * 0.5, to: R * 3.4 * k, a0: 0.75 });
    this.fxs('fx', this.tex.shock, this.colors.flame, bx, by, RING_R, { dur: 700, delay: 140, from: R * 0.4, to: R * 2.6 * k, a0: 0.55 });
    this.fxs('ground', this.tex.shock, mixColor(this.colors.ember, 0x000000, 0.5), bx, by, RING_R, { dur: 640, delay: 30, from: R * 0.8, to: R * 4 * k, a0: 0.5 });
    // A backward cone of blue fire, embers flung with it.
    this.fire.burst(bx, by, { n: 44 * k, radius: R * 0.4, speed: 900 * k, size: R * 0.62, life: 480, dir: backAng, spread: 1.5, drag: 3.2, heat: 0.95, tongues: 0.25, smoke: 0.25, embers: 16 * k, emberSpeed: 640 });
    // GROUND DEBRIS: chunks thrown up and back off the ground behind the hero, falling.
    const debris = Math.round(16 * k);
    for (let i = 0; i < debris; i++) {
      const ang = backAng + (this.rnd() - 0.5) * 1.5 - 0.35 * Math.sign(Math.cos(backAng) || 1);
      const sz = (0.5 + this.rnd() * 0.6) * this.S;
      this.bit('fx', this.tex.spark, mixColor(this.colors.smoke, 0xffffff, 0.45), bx, by + R * 0.4, ang, (560 + this.rnd() * 640) * this.S, 560 + this.rnd() * 300, sz * 1.5, sz, 0.9, 1300 * this.S);
    }
    this.fire.smokePuffs(bx, by, 4, { radius: R * 0.6, size: R * 1.2, life: 1200, rise: 50, alpha: 0.28 });
    this.wingBeat(Math.min(2, k));
    if (o.shatter && w) {
      // THE SHATTER (IV): glowing hex shards burst off the whole ward (mostly backward) and rain out.
      const n = Math.max(0, Math.round(L.shards));
      for (let i = 0; i < n; i++) {
        const a = rot + Math.PI + (i / Math.max(1, n - 1) - 0.5) * Math.PI * 1.9 + (this.rnd() - 0.5) * 0.3;
        const sx = cx + Math.cos(a) * R * 0.95, sy = cy + Math.sin(a) * R * 0.95;
        const len = (1.2 + this.rnd() * 1.1) * this.S;
        const sp = (460 + this.rnd() * 680) * this.S;
        const life = 700 + this.rnd() * 400;
        this.bit('fx', this.tex.spark, whiten(this.colors.ward, 0.5), sx, sy, a, sp, life, len * 1.6, len * 1.1, 1, 1000 * this.S, { drag: 1, spin: (this.rnd() - 0.5) * 0.03 });
        // Every other shard carries its own glow.
        if (i % 2 === 0) this.bit('hot', this.tex.glow, this.colors.ward, sx, sy, a, sp, life, len * 0.45, len * 0.45, 0.6, 1000 * this.S, { drag: 1, spin: 0 });
      }
      this.fxs('fx', this.tex.shock, 0xffffff, cx, cy, RING_R, { dur: 320, from: R, to: R * 1.9, a0: 1 });
      this.dropWard();
    }
    // THE MEGA-SURGE: a big white-blue head with its own fire and a ring riding it; the stream swells behind it.
    if (st && !this.surge) {
      const head = this.take('hot', this.tex.glow, 0xffffff);
      const halo = this.take('hot', this.tex.glow, whiten(this.colors.hot, 0.3));
      const ring = this.take('fx', this.tex.shock, wardC);
      if (head && halo && ring) {
        head.position.set(st.mouth.x, st.mouth.y); halo.position.set(st.mouth.x, st.mouth.y); ring.position.set(st.mouth.x, st.mouth.y);
        const em = this.fire.emitter({
          shape: 'point', x: st.mouth.x, y: st.mouth.y, r: st.R * 0.35, rate: 1300, size: st.R * 0.85 * st.width, life: 300, lift: 60, speed: 80,
          heat: 1, turb: 220, tongues: 0.3, body: 0.2, smoke: 0.04, embers: 50, emberSpeed: 360,
        });
        this.surge = { em, head, halo, ring };
      } else { this.give(head); this.give(halo); this.give(ring); }
      st.core.intensity = 1.4;
      st.boost = 1;
    }
  }

  /** Paint the surge for this frame (`u` 0..1 down the stream). */
  setSurge(u: number): void {
    const sg = this.surge;
    const st = this.stream;
    if (!sg || !st) return;
    const e = clamp01(u);
    const x = st.mouth.x + (st.to.x - st.mouth.x) * e, y = st.mouth.y + (st.to.y - st.mouth.y) * e;
    const R = st.R;
    sg.em.x = x; sg.em.y = y;
    const pulse = 1 + 0.12 * Math.sin(this.clock * 0.09);
    sg.head.position.set(x, y); sg.head.scale.set((R * 0.75 * pulse) / GLOW_R); sg.head.alpha = 1;
    sg.halo.position.set(x, y); sg.halo.scale.set((R * 1.9 * pulse) / GLOW_R); sg.halo.alpha = 0.6;
    sg.ring.position.set(x, y); sg.ring.rotation = Math.atan2(st.dir.y, st.dir.x);
    sg.ring.scale.set((R * 0.5) / RING_R, (R * 1.2 * st.width) / RING_R); sg.ring.alpha = 0.8;
    // The stream swells BEHIND the surge (everything it has passed burns hotter and wider).
    const b = 1 + 0.6 * e;
    st.outer.intensity = b; st.mid.intensity = b;
  }

  /** THE IMPACT: the surge detonates on the target; the stream is cut. `big` (IV) adds a flame nova, a pillar, a scorch. */
  impact(x: number, y: number, R: number, o: { size: number; big: boolean; dir: Pt; flashAlpha: number; embers: number; lingerMs: number }): void {
    if (this.destroyed) return;
    const sg = this.surge;
    if (sg) { this.fire.stop(sg.em); this.give(sg.head); this.give(sg.halo); this.give(sg.ring); this.surge = null; }
    this.stopStream();
    const L = this.look;
    const sz = o.size * L.explodeSize;
    const ang = Math.atan2(o.dir.y, o.dir.x);
    this.fxs('hot', this.tex.glow, 0xffffff, x, y, GLOW_R, { dur: 120, from: R * 0.7, to: R * 1.9 * sz, a0: o.flashAlpha });
    this.fxs('hot', this.tex.glow, whiten(this.colors.hot, 0.3), x, y, GLOW_R, { dur: 200, from: R * 1.1, to: R * 2.6 * sz, a0: o.flashAlpha * 0.75 });
    this.fxs('under', this.tex.fire.glow, this.colors.flame, x, y, GLOW_R, { dur: 800, from: R * 1.6 * sz, to: R * 3.2 * sz, a0: 0.7 });
    this.fxs('fx', this.tex.shock, 0xffffff, x, y, RING_R, { dur: 340, from: R * 0.6, to: R * 2.8 * sz, a0: 0.9 });
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.4), x, y, RING_R, { dur: 520, delay: 60, from: R * 0.5, to: R * 2.2 * sz, a0: 0.7 });
    this.fire.burst(x, y, {
      n: (o.big ? 90 : 46) * sz, radius: R * 0.32 * sz, speed: (o.big ? 820 : 560) * sz, size: R * 0.64 * sz, life: o.big ? 680 : 520,
      lift: 300, drag: 3.2, heat: 1, tongues: 0.22, body: 0.35, smoke: 0.3, embers: o.embers, emberSpeed: o.big ? 620 : 440,
    });
    // Flame carried on through, along the stream.
    this.fire.burst(x, y, { n: 18 * sz, radius: R * 0.2, speed: 920 * sz, size: R * 0.5 * sz, life: 380, dir: ang, spread: 1.2, drag: 4.5, heat: 0.9, smoke: 0.1 });
    // Sparks blown out round the hit.
    for (let i = 0; i < (o.big ? 18 : 10); i++) {
      const a = ang + (this.rnd() - 0.5) * 2.6;
      const s2 = (0.18 + this.rnd() * 0.2) * this.S;
      this.bit('fx', this.tex.spark, this.rnd() < 0.5 ? 0xffffff : this.colors.hot, x, y, a, (700 + this.rnd() * 700) * this.S, 260 + this.rnd() * 200, s2 * 2.6, s2 * 0.6, 1, 500 * this.S, { stretch: true, drag: 2.4 });
    }
    if (o.big) {
      this.fxs('fx', this.tex.shock, this.colors.flame, x, y, RING_R, { dur: 720, delay: 90, from: R * 0.8, to: R * 5 * sz, a0: 0.75 });
      // A FLAME NOVA ring thrown outward, and a PILLAR of blue fire on the struck hero.
      this.fire.emitter({
        shape: 'ring', x, y, r: R * 1.05, rate: 620, size: R * 0.55, life: 440, lift: 500, out: 320, speed: 40, heat: 0.95, turb: 280,
        tongues: 0.3, body: 0.25, smoke: 0.15, embers: 24,
      }, { hold: 260, fade: 420 });
      this.fire.emitter({
        shape: 'disc', x, y, r: R * 0.85, rate: 380, size: R * 0.8, life: 640, lift: 1300, speed: 50, heat: 1, turb: 320,
        tongues: 0.35, body: 0.35, smoke: 0.25, embers: 24, emberSpeed: 300,
      }, { hold: 380, fade: 620 });
      // THE SCORCH: a lingering ring of low blue fire licking round the struck hero on a burnt ground.
      if (L.scorch > 0) {
        this.fxs('ground', this.tex.scorch, mixColor(this.colors.ember, 0x000000, 0.35), x, y, SCORCH_R, { dur: o.lingerMs + 900, from: R * 2.1 * L.scorch, to: R * 2.4 * L.scorch, a0: 0.85, mode: 'hold' });
        this.fire.emitter({
          shape: 'ring', x, y, r: R * 1.08, a0: -Math.PI, a1: Math.PI, rate: 150 * L.scorch, size: R * 0.32, life: 460, lift: 700, speed: 20, out: 10,
          heat: 0.7, turb: 280, tongues: 0.5, body: 0.3, smoke: 0.2, embers: 8,
        }, { hold: o.lingerMs, fade: 700 });
      }
    }
  }

  /** An aftershock: a small blue burst round the blast. */
  boom(x: number, y: number, R: number, size: number): void {
    if (this.destroyed) return;
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.3), x, y, RING_R, { dur: 260, from: R * 0.2, to: R * 0.9 * size, a0: 0.6 });
    this.fire.burst(x, y, { n: 14 * size, radius: R * 0.2, speed: 420, size: R * 0.45 * size, life: 420, lift: 300, drag: 3.5, heat: 0.85, smoke: 0.2, embers: 6 });
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance everything by `dt` ms. Returns whether anything still draws. */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    let step = Math.max(0, Math.min(100, Number.isFinite(dt) ? dt : 0));
    // THE HIT-STOP: the frame holds; nothing advances until it is spent (only the remainder of this frame runs).
    if (this.frozen > 0) {
      const used = Math.min(this.frozen, step);
      this.frozen -= used;
      step -= used;
      if (step <= 0) return true;
    }
    this.clock += step;
    if (this.warm.length) {
      this.warmLeft -= Math.max(step, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }
    if (this.reserving) {
      const a = this.fire.reserveStep(100);
      const b = this.wingFire.reserveStep(30);
      this.reserving = a || b;
    }
    this.updateInhale(step);
    this.updateMotes(step);
    this.updateStreamSparks(step);
    const sec = step / 1000;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i]!;
      b.age += step;
      if (b.age >= b.life) { this.give(b.s); this.bits.splice(i, 1); continue; }
      if (b.drag > 0) { const k = Math.exp(-b.drag * sec); b.vx *= k; b.vy *= k; }
      b.vy += b.grav * sec;
      b.x += b.vx * sec; b.y += b.vy * sec;
      const u = b.age / b.life;
      b.s.position.set(b.x, b.y);
      if (b.stretch) {
        b.s.rotation = Math.atan2(b.vy, b.vx);
        const v = Math.min(1.6, Math.hypot(b.vx, b.vy) / (600 * this.S));
        b.s.scale.set(b.sx * (0.4 + 0.6 * v), b.sy);
      } else b.s.rotation += b.spin * step;
      b.s.alpha = b.a0 * (1 - u * u);
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= step; if (q.delay > 0) continue; }
      q.age += step;
      const u = clamp01(q.age / q.dur);
      q.s.scale.set(q.from + (q.to - q.from) * easeOutQuint(u));
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
          : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }
    const a = this.fire.update(step);
    const b = this.wingFire.update(step);
    return a || b || this.used > this.warm.length || this.ward !== null || this.stream !== null || this.surge !== null
      || this.presence !== null || this.bits.length > 0 || this.motes.length > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const q of this.fx) this.give(q.s);
    for (const b of this.bits) this.give(b.s);
    for (const m of this.motes) this.give(m.s);
    for (const s of this.warm) this.give(s);
    if (this.surge) { this.give(this.surge.head); this.give(this.surge.halo); this.give(this.surge.ring); }
    if (this.stream) this.give(this.stream.light);
    if (this.presence) { for (const e of this.presence.eyes) this.give(e); this.give(this.presence.throat); }
    this.dropWard();
    this.fire.clear();
    this.wingFire.clear();
    this.fx = []; this.bits = []; this.motes = []; this.warm = []; this.surge = null; this.stream = null; this.presence = null; this.inhaling = null;
    this.frozen = 0;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.fire.destroy();
    this.wingFire.destroy();
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((ch) => ch.destroy());
    }
    this.root.removeChildren().forEach((ch) => ch.destroy());
    this.root.destroy();
  }
}
