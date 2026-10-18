/**
 * THE IGGY BLAST SCENE: everything the Iggy Blast hero attack draws in Pixi, as a plain scene graph with no renderer, so
 * it runs (and is tested) headless. `heroIggy.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * What it draws (concept A, "Recoil Ward", owner pick 2026-10-18):
 *  - THE WARD: a bubble round the attacking portrait, rotated to face the target. It shimmers up, then FLATTENS against
 *    the back of the hero as the breath pushes (its scale squashes along the line of fire and its centre slides back),
 *    its glow climbing with every stage; on the rebound it springs back, and at Tier IV it SHATTERS into glass shards.
 *    PLACEHOLDER ART: the ward is built from textures the attacks already paint (the thin shock ring as its rim, the soft
 *    glow as its body, the Blast's ring as the cell glow) until the owner's painted hex-cell ward dome lands. Swap
 *    `wardBody` / `wardRim` / `wardCells` in `heroIggyTextures.ts`; nothing else changes.
 *  - THE BREATH: the shared live fire (`../heroAttack/pixiFire.ts`) on its LINE shape, from the mouth to the stream's
 *    front, with a blue palette, every flame born flowing down the line of fire. Each stage shift retunes it (heat,
 *    width, density): thin blue, cyan, white-cored. A short throat emitter at the mouth keeps the source dense.
 *  - THE BACK-BLAST: a shockwave and a backward cone of flame and debris off the back of the ward.
 *  - THE SURGE: a bright head racing down the stream, its own small fire trailing it.
 *  - THE IMPACT: a blue flame burst on the target, a flash, rings; IV adds a flame ring.
 *
 * LAYERS, bottom to top: ward-back (normal: the ward body) | under (additive: the light the fire casts) | the fire's
 * back (normal: smoke, the deep body) | fx (additive: rings, the ward rim, cells, shards) | the fire's front (additive:
 * flame, embers) | hot (additive: flashes, the surge head).
 *
 * Contract: one-shot, transform/opacity only (sprite position, rotation, scale, alpha, tint). Sprites are POOLED per
 * layer, bounded by `MAX_IGGY_SPRITES`; fire particles by `MAX_IGGY_PARTICLES`; textures are the caller's and are
 * pre-warmed at construction; `setCamera` mirrors the DOM camera; `update` returns whether anything still draws;
 * `destroy()` leaves nothing behind. Scatter is seeded (a replay burns the same fire).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import { clamp01, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { PixiFire, type FireEmitter, type FireTextures } from '../heroAttack/pixiFire';

export interface HeroIggyTextures {
  fire: FireTextures;
  /** A soft round glow (the light, flashes). */
  glow: Texture;
  /** A small hot spark (debris, shards). */
  spark: Texture;
  /** A thin shock ring (its line at `SHOCK_LINE_R` of 256 px). */
  shock: Texture;
  /** THE WARD (placeholder until the painted dome): its body, its rim and its cell glow. */
  wardBody: Texture;
  wardRim: Texture;
  wardCells: Texture;
}

export interface IggyColors { core: number; hot: number; flame: number; deep: number; ember: number; smoke: number; ward: number; side: number }

export interface IggyLook {
  streamFlame: number;
  streamSpeed: number;
  turbulence: number; buoyancy: number; smoke: number; embers: number;
  wardAlpha: number;
  backBlast: number;
  shards: number;
  explodeSize: number;
}

/** Hard cap on the sprites (light, rings, flashes, the ward, shards) alive at once. */
export const MAX_IGGY_SPRITES = 220;
/** Hard cap on live fire particles (a Tier IV impact peaks near it; the pool never grows past it). */
export const MAX_IGGY_PARTICLES = 1000;

type LayerId = 'wardBack' | 'under' | 'fx' | 'hot';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['wardBack', 'normal'], ['under', 'add'], ['fx', 'add'], ['hot', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
/** Radius (px) a sprite of scale 1 covers: the soft glow (64 of 128 px), the shock ring (its line at 115 of 256). */
const GLOW_R = 64, RING_R = 115;

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number; delay: number }

/** A flying piece (a glass shard, debris): ballistic, spinning, fading. */
interface Bit { s: Sprite; x: number; y: number; vx: number; vy: number; spin: number; age: number; life: number; a0: number; grav: number }

interface Ward { body: Sprite; rim: Sprite; cells: Sprite; x: number; y: number; R: number; rot: number }

interface Stream { line: FireEmitter; throat: FireEmitter; light: Sprite | null; mouth: Pt; to: Pt; dir: Pt }

interface Surge { em: FireEmitter; head: Sprite }

export class HeroIggyScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly fire: PixiFire;
  private readonly rnd: () => number;
  private used = 0;
  private clock = 0;
  private fx: Fx[] = [];
  private bits: Bit[] = [];
  private ward: Ward | null = null;
  private stream: Stream | null = null;
  private surge: Surge | null = null;
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
    const L = this.layers;
    this.root.addChild(L.wardBack, L.under, this.fire.back, L.fx, this.fire.front, L.hot);
    // PRE-WARM: one near-invisible sprite per texture while the damage formation plays (no first-use upload spike).
    const f = tex.fire;
    for (const w of [tex.glow, tex.spark, tex.shock, tex.wardBody, tex.wardRim, tex.wardCells, ...f.puffs, f.tongue, f.smoke, f.ember, f.glow]) {
      const s = this.take('hot', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
    // The fire's sprite pool is built a slice a frame while the formation plays (no burst of creation at the impact).
    this.fire.planReserve();
    this.reserving = true;
  }

  get liveSprites(): number { return this.used - this.warm.length + this.fire.count; }
  get liveFire(): number { return this.fire.count; }
  get wardUp(): boolean { return this.ward !== null; }
  get breathing(): boolean { return this.stream !== null; }
  get surging(): boolean { return this.surge !== null; }
  get liveBits(): number { return this.bits.length; }
  get emitters(): number { return this.fire.emitting; }
  get time(): number { return this.clock; }
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

  private give(s: Sprite | null): void {
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

  /** A flying piece thrown from (x, y) along `ang`. */
  private bit(t: Texture, tint: number, x: number, y: number, ang: number, speed: number, life: number, sx: number, sy: number, a0: number, grav: number): void {
    const s = this.take('fx', t, tint);
    if (!s) return;
    s.position.set(x, y);
    s.scale.set(sx, sy);
    s.rotation = ang;
    s.alpha = a0;
    this.bits.push({ s, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, spin: (this.rnd() - 0.5) * 0.02, age: 0, life, a0, grav });
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** The ward shimmers up round the attacker (radius R), turned to face along `dir`; blue light gathers in the throat. */
  wardUpAt(x: number, y: number, R: number, dir: Pt): void {
    if (this.destroyed || this.ward) return;
    // The ward lives in two layers: its body (normal, behind the fire) and its rim + cells (additive, over it); every
    // frame `setWard` writes one transform (position, rotation, scale) and an alpha onto each.
    const body = this.take('wardBack', this.tex.wardBody, this.colors.ward);
    const rim = this.take('fx', this.tex.wardRim, whiten(this.colors.ward, 0.35));
    const cells = this.take('fx', this.tex.wardCells, this.colors.ward);
    if (!body || !rim || !cells) { this.give(body); this.give(rim); this.give(cells); return; }
    body.alpha = 0; rim.alpha = 0; cells.alpha = 0;
    this.ward = { body, rim, cells, x, y, R, rot: Math.atan2(dir.y, dir.x) };
    // The shimmer up: a quick ring in, a glint.
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.5), x, y, RING_R, { dur: 320, from: R * 1.8, to: R * 1.05, a0: 0.55, mode: 'punch', peakAt: 0.4 });
    this.fxs('under', this.tex.fire.glow, this.colors.flame, x + dir.x * R * 0.6, y + dir.y * R * 0.6, GLOW_R, { dur: 900, from: R * 0.5, to: R * 1.4, a0: 0.4, mode: 'hold' });
  }

  /**
   * Paint the ward for this frame: `up` 0..1, flattened by `flatten` (0..0.6) against the back of the hero along the
   * line of fire, glowing by `glow`. Transform and alpha only.
   */
  setWard(up: number, flatten: number, glow: number): void {
    const w = this.ward;
    if (!w) return;
    const R = w.R;
    // Squash along the line of fire (the push), bulge across it; the centre slides back so the BACK face flattens.
    const along = Math.max(0.35, 1 - flatten);
    const across = 1 + flatten * 0.45;
    const back = R * flatten * 0.55;
    const cx = w.x - Math.cos(w.rot) * back, cy = w.y - Math.sin(w.rot) * back;
    const shimmer = 0.94 + 0.06 * Math.sin(this.clock * 0.021);
    const a = this.look.wardAlpha * up;
    const place = (s: Sprite, unit: number, alpha: number): void => {
      s.position.set(cx, cy);
      s.rotation = w.rot;
      s.scale.set((R * along) / unit, (R * across) / unit);
      s.alpha = Math.max(0, alpha);
    };
    place(w.body, GLOW_R, a * 0.45 * (0.8 + 0.2 * glow));
    place(w.rim, RING_R, a * (0.6 + 0.4 * Math.min(1.5, glow)) * shimmer);
    place(w.cells, RING_R * 0.92, a * 0.7 * Math.min(1.6, glow) * (0.85 + 0.15 * Math.sin(this.clock * 0.05)));
  }

  /** Debris flicked off the crouching hero's base (Iggy's claws kicking up the ground). */
  kickDebris(x: number, y: number, R: number, dir: Pt, n: number): void {
    if (this.destroyed) return;
    const backAng = Math.atan2(-dir.y, -dir.x);
    for (let i = 0; i < n; i++) {
      const ang = backAng + (this.rnd() - 0.5) * 1.6 - 0.4;
      const sz = (0.18 + this.rnd() * 0.2) * this.S;
      this.bit(this.tex.spark, mixColor(this.colors.smoke, 0xffffff, 0.35), x + (this.rnd() - 0.5) * R, y + R * 0.75, ang, (220 + this.rnd() * 260) * this.S, 420 + this.rnd() * 220, sz, sz, 0.75, 1400 * this.S);
    }
  }

  /** The breath starts: the stream pours from `mouth` toward `to`, its front advancing (`setStream`). */
  startStream(mouth: Pt, to: Pt, R: number, width: number): void {
    if (this.destroyed || this.stream) return;
    const dx = to.x - mouth.x, dy = to.y - mouth.y;
    const L = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / L, y: dy / L };
    const flow = 900 * this.look.streamSpeed;
    const line = this.fire.emitter({
      shape: 'line', x: mouth.x, y: mouth.y, x2: mouth.x, y2: mouth.y, r: R * 0.22 * width, rate: 900 * this.look.streamFlame,
      size: R * 0.5 * width, life: 260, lift: 90, speed: 50, vx: dir.x * flow * 0.35, vy: dir.y * flow * 0.35, heat: 0.55, turb: 320,
      tongues: 0.3, body: 0.25, smoke: 0.04, embers: 10, emberSpeed: 160, drag: 1.2, sweep: false,
    });
    const throat = this.fire.emitter({
      shape: 'point', x: mouth.x, y: mouth.y, r: R * 0.18 * width, rate: 380 * this.look.streamFlame, size: R * 0.55 * width,
      life: 200, lift: 60, speed: 60, vx: dir.x * flow, vy: dir.y * flow, heat: 0.7, turb: 240, tongues: 0.35, body: 0.2,
      smoke: 0.02, drag: 2.4, sweep: false,
    });
    const light = this.take('under', this.tex.fire.glow, this.colors.flame);
    if (light) { light.alpha = 0; light.rotation = Math.atan2(dir.y, dir.x); }
    this.stream = { line, throat, light, mouth, to, dir };
    this.fire.burst(mouth.x, mouth.y, { n: 10, radius: R * 0.2, speed: 420, size: R * 0.4, life: 260, dir: Math.atan2(dir.y, dir.x), spread: 0.9, drag: 4, heat: 0.7, smoke: 0.05 });
  }

  /** Paint the stream's front for this frame (`reach` 0..1 of the way to the target). */
  setStream(reach: number): void {
    const st = this.stream;
    if (!st) return;
    const r = clamp01(reach);
    const fx = st.mouth.x + (st.to.x - st.mouth.x) * r, fy = st.mouth.y + (st.to.y - st.mouth.y) * r;
    st.line.x2 = fx; st.line.y2 = fy;
    if (st.light) {
      const len = Math.hypot(fx - st.mouth.x, fy - st.mouth.y);
      st.light.position.set((st.mouth.x + fx) / 2, (st.mouth.y + fy) / 2);
      st.light.scale.set(Math.max(0.01, len / (GLOW_R * 1.6)), (st.line.r * 2.6) / GLOW_R);
    }
  }

  /**
   * The breath SHIFTS UP: thin blue -> cyan -> white-cored (`heat`), the stream widens and thickens (`width`, `rate`),
   * a gust bursts off the mouth and the ward flares.
   */
  shiftStream(o: { heat: number; width: number; rate: number; R: number; level: number }): void {
    const st = this.stream;
    if (!st) return;
    const R = o.R;
    st.line.heat = o.heat; st.throat.heat = Math.min(1, o.heat + 0.15);
    st.line.r = R * 0.22 * o.width; st.line.size = R * 0.5 * o.width;
    st.throat.r = R * 0.18 * o.width; st.throat.size = R * 0.55 * o.width;
    st.line.rate = 900 * this.look.streamFlame * o.rate; st.throat.rate = 380 * this.look.streamFlame * o.rate;
    st.line.embers = 10 + 10 * o.level;
    if (st.light) st.light.alpha = 0.22 + 0.12 * o.level;
    const ang = Math.atan2(st.dir.y, st.dir.x);
    this.fire.burst(st.mouth.x, st.mouth.y, { n: 8 + 6 * o.level, radius: R * 0.2, speed: 620, size: R * 0.45 * o.width, life: 300, dir: ang, spread: 0.7, drag: 3, heat: o.heat, smoke: 0.04 });
    this.fxs('hot', this.tex.glow, whiten(this.colors.hot, 0.3), st.mouth.x, st.mouth.y, GLOW_R, { dur: 160, from: R * 0.3, to: R * (0.7 + 0.2 * o.level), a0: 0.5 + 0.12 * o.level });
    const w = this.ward;
    if (w) this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.4), w.x - Math.cos(w.rot) * w.R * 0.5, w.y - Math.sin(w.rot) * w.R * 0.5, RING_R, { dur: 260, from: w.R * 0.7, to: w.R * (1.1 + 0.12 * o.level), a0: 0.35 + 0.1 * o.level });
  }

  /** A stage front reaching the target: a gust of blue flame splashes off it (a tick). */
  splash(x: number, y: number, R: number, dir: Pt, level: number): void {
    if (this.destroyed) return;
    const ang = Math.atan2(dir.y, dir.x);
    this.fire.burst(x, y, { n: 10 + 5 * level, radius: R * 0.3, speed: 380, size: R * 0.45, life: 380, dir: ang, spread: 2.2, drag: 3, heat: 0.75, smoke: 0.12, embers: 3 + level });
    this.fxs('hot', this.tex.glow, whiten(this.colors.hot, 0.4), x, y, GLOW_R, { dur: 110, from: R * 0.4, to: R * 0.9, a0: 0.45 });
  }

  /**
   * THE REBOUND: the flattened ward springs back. A shockwave and a backward cone of flame and debris burst off the back
   * of the ward (behind the attacker); IV: the ward SHATTERS into glass shards. The surge leaves the mouth.
   */
  rebound(o: { shatter: boolean; R: number; size: number }): void {
    if (this.destroyed) return;
    const w = this.ward;
    const st = this.stream;
    const R = o.R;
    const L = this.look;
    const rot = w ? w.rot : st ? Math.atan2(st.dir.y, st.dir.x) : 0;
    const cx = w ? w.x : st ? st.mouth.x : 0, cy = w ? w.y : st ? st.mouth.y : 0;
    const bx = cx - Math.cos(rot) * R * 1.05, by = cy - Math.sin(rot) * R * 1.05;
    const backAng = rot + Math.PI;
    const k = L.backBlast * o.size;
    // The back-blast: a hard flash, two shock rings off the back face, a backward cone of fire, debris flung off.
    this.fxs('hot', this.tex.glow, whiten(this.colors.ward, 0.6), bx, by, GLOW_R, { dur: 140, from: R * 0.6, to: R * 1.6 * k, a0: 0.85 });
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.5), bx, by, RING_R, { dur: 420, from: R * 0.6, to: R * 3.2 * k, a0: 0.9 });
    this.fxs('fx', this.tex.shock, this.colors.flame, bx, by, RING_R, { dur: 560, delay: 60, from: R * 0.5, to: R * 2.4 * k, a0: 0.6 });
    this.fire.burst(bx, by, { n: 26 * k, radius: R * 0.35, speed: 700 * k, size: R * 0.55, life: 420, dir: backAng, spread: 1.4, drag: 3.2, heat: 0.85, tongues: 0.2, smoke: 0.25, embers: 10 * k, emberSpeed: 520 });
    const debris = Math.round(8 * k);
    for (let i = 0; i < debris; i++) {
      const ang = backAng + (this.rnd() - 0.5) * 1.6;
      const sz = (0.22 + this.rnd() * 0.25) * this.S;
      this.bit(this.tex.spark, mixColor(this.colors.smoke, 0xffffff, 0.4), bx, by, ang, (520 + this.rnd() * 520) * this.S, 520 + this.rnd() * 260, sz * 1.6, sz, 0.85, 900 * this.S);
    }
    if (o.shatter && w) {
      // THE SHATTER (IV): the ward bursts into glass shards flung out from its back face (mostly backward).
      const n = Math.max(0, Math.round(L.shards));
      for (let i = 0; i < n; i++) {
        const a = rot + Math.PI + (i / Math.max(1, n - 1) - 0.5) * Math.PI * 1.6 + (this.rnd() - 0.5) * 0.3;
        const sx = cx + Math.cos(a) * R * 0.95, sy = cy + Math.sin(a) * R * 0.95;
        const len = (0.5 + this.rnd() * 0.6) * this.S;
        this.bit(this.tex.spark, whiten(this.colors.ward, 0.5), sx, sy, a, (380 + this.rnd() * 520) * this.S, 520 + this.rnd() * 300, len * 2.2, len * 0.55, 0.95, 1100 * this.S);
      }
      this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.7), cx, cy, RING_R, { dur: 300, from: R, to: R * 1.7, a0: 0.9 });
      this.dropWard();
    } else if (w) {
      this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.5), cx, cy, RING_R, { dur: 260, from: R * 0.9, to: R * 1.3, a0: 0.6 });
    }
    // The surge: a bright head with its own fire, raced down the stream by `setSurge`.
    if (st && !this.surge) {
      const head = this.take('hot', this.tex.glow, whiten(this.colors.hot, 0.5));
      if (head) {
        head.position.set(st.mouth.x, st.mouth.y);
        head.scale.set((R * 0.9) / GLOW_R);
        const em = this.fire.emitter({
          shape: 'point', x: st.mouth.x, y: st.mouth.y, r: R * 0.25, rate: 700, size: R * 0.7, life: 260, lift: 60, speed: 60,
          heat: 1, turb: 200, tongues: 0.3, body: 0.2, smoke: 0.04, embers: 30, emberSpeed: 300,
        });
        this.surge = { em, head };
      }
    }
  }

  /** Paint the surge for this frame (`u` 0..1 down the stream). */
  setSurge(u: number): void {
    const sg = this.surge;
    const st = this.stream;
    if (!sg || !st) return;
    const e = clamp01(u);
    const x = st.mouth.x + (st.to.x - st.mouth.x) * e, y = st.mouth.y + (st.to.y - st.mouth.y) * e;
    sg.em.x = x; sg.em.y = y;
    sg.head.position.set(x, y);
    sg.head.alpha = 0.9;
  }

  /** THE IMPACT: the surge detonates on the target; the stream is cut. `big` (IV) adds a flame ring. */
  impact(x: number, y: number, R: number, o: { size: number; big: boolean; dir: Pt; flashAlpha: number; embers: number }): void {
    if (this.destroyed) return;
    const sg = this.surge;
    if (sg) { this.fire.stop(sg.em); this.give(sg.head); this.surge = null; }
    this.stopStream();
    const sz = o.size * this.look.explodeSize;
    const ang = Math.atan2(o.dir.y, o.dir.x);
    this.fxs('hot', this.tex.glow, 0xffffff, x, y, GLOW_R, { dur: 110, from: R * 0.6, to: R * 1.6 * sz, a0: o.flashAlpha });
    this.fxs('hot', this.tex.glow, whiten(this.colors.hot, 0.3), x, y, GLOW_R, { dur: 180, from: R, to: R * 2.2 * sz, a0: o.flashAlpha * 0.7 });
    this.fxs('under', this.tex.fire.glow, this.colors.flame, x, y, GLOW_R, { dur: 700, from: R * 1.5 * sz, to: R * 2.8 * sz, a0: 0.65 });
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.4), x, y, RING_R, { dur: 360, from: R * 0.6, to: R * 2.4 * sz, a0: 0.8 });
    this.fire.burst(x, y, {
      n: (o.big ? 70 : 36) * sz, radius: R * 0.3 * sz, speed: (o.big ? 700 : 480) * sz, size: R * 0.6 * sz, life: o.big ? 620 : 480,
      lift: 300, drag: 3.2, heat: 1, tongues: 0.2, body: 0.35, smoke: 0.3, embers: o.embers, emberSpeed: o.big ? 560 : 400,
    });
    // Flame carried on through, along the stream.
    this.fire.burst(x, y, { n: 14 * sz, radius: R * 0.2, speed: 820 * sz, size: R * 0.45 * sz, life: 360, dir: ang, spread: 1.2, drag: 4.5, heat: 0.9, smoke: 0.1 });
    if (o.big) {
      this.fxs('fx', this.tex.shock, this.colors.flame, x, y, RING_R, { dur: 640, delay: 60, from: R * 0.8, to: R * 4.2 * sz, a0: 0.7 });
      this.fire.emitter({
        shape: 'ring', x, y, r: R * 1.05, rate: 500, size: R * 0.5, life: 420, lift: 500, out: 260, speed: 40, heat: 0.9, turb: 280,
        tongues: 0.3, body: 0.25, smoke: 0.15, embers: 20,
      }, { hold: 220, fade: 380 });
    }
    // The ward (I-III) rides out its calm on its own; it is dropped when its fade ends.
  }

  /** An aftershock: a small blue burst round the blast. */
  boom(x: number, y: number, R: number, size: number): void {
    if (this.destroyed) return;
    this.fxs('fx', this.tex.shock, whiten(this.colors.ward, 0.3), x, y, RING_R, { dur: 260, from: R * 0.2, to: R * 0.9 * size, a0: 0.6 });
    this.fire.burst(x, y, { n: 12 * size, radius: R * 0.2, speed: 380, size: R * 0.42 * size, life: 420, lift: 300, drag: 3.5, heat: 0.85, smoke: 0.2, embers: 5 });
  }

  /** The stream is cut: nothing new pours, what is burning burns out. */
  stopStream(): void {
    const st = this.stream;
    if (!st) return;
    this.fire.stop(st.line); this.fire.stop(st.throat);
    if (st.light) this.give(st.light);
    this.stream = null;
  }

  /** Drop the ward sprites (shattered, or faded out). */
  dropWard(): void {
    const w = this.ward;
    if (!w) return;
    this.give(w.body); this.give(w.rim); this.give(w.cells);
    this.ward = null;
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance everything by `dt` ms. Returns whether anything still draws. */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    const step = Math.max(0, Math.min(100, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    if (this.warm.length) {
      this.warmLeft -= Math.max(step, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }
    if (this.reserving) this.reserving = this.fire.reserveStep(120);
    const sec = step / 1000;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i]!;
      b.age += step;
      if (b.age >= b.life) { this.give(b.s); this.bits.splice(i, 1); continue; }
      b.vx *= Math.exp(-1.2 * sec); b.vy *= Math.exp(-1.2 * sec);
      b.vy += b.grav * sec;
      b.x += b.vx * sec; b.y += b.vy * sec;
      const u = b.age / b.life;
      b.s.position.set(b.x, b.y);
      b.s.rotation += b.spin * step;
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
    const burning = this.fire.update(step);
    return burning || this.used > this.warm.length || this.ward !== null || this.stream !== null || this.surge !== null || this.bits.length > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const q of this.fx) this.give(q.s);
    for (const b of this.bits) this.give(b.s);
    for (const s of this.warm) this.give(s);
    if (this.surge) this.give(this.surge.head);
    if (this.stream?.light) this.give(this.stream.light);
    this.dropWard();
    this.fire.clear();
    this.fx = []; this.bits = []; this.warm = []; this.surge = null; this.stream = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.fire.destroy();
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((ch) => ch.destroy());
    }
    this.root.removeChildren().forEach((ch) => ch.destroy());
    this.root.destroy();
  }
}
