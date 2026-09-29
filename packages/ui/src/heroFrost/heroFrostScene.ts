/**
 * THE FROST SCENE: everything the Frost hero attack draws in Pixi, as a plain scene graph with no renderer, so it runs
 * (and is tested) headless. `heroFrost.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (the Arcana bar: one hero element drawn as geometry, particles only as seasoning):
 *  - THE ICICLE is the lead of every beat but the nova's. Five sprites on one transform (glow, body, core, rim, spec),
 *    each its own blend: the faceted body, the deep core and the frosty rim are NORMAL blend (the ice keeps its colour
 *    and its cut on a light board), the glow and the specular edge are ADDITIVE (they bloom on dark ground).
 *    It CRYSTALLISES from its butt out to its tip with a travelling glint, hovers, draws back and fires; its ice-dust
 *    trail is a thin strip sampled back in time along its pure flight (`trailPos`), plus a few glittering motes.
 *  - A SHATTER is line work over a short flash: a snowflake flash, a crisp ring, faceted shards (sprites with a lit and
 *    a dark facet, spinning under gravity), a snow puff, and frost ferns creeping over the struck portrait's edge.
 *  - THE NOVA is one rolling WAVE FRONT drawn as three crescent strips (a normal-blend frost wall, an additive cold
 *    glow, a white leading-edge line) that bulge ahead in the middle and billow along their edge, over an ICE SHEET
 *    strip that freezes along the path behind it (cracked ice, frost ferns growing off its edges). Snow and crystals
 *    swirl in the front, and snow billows roll off it.
 *  - THE ENCASEMENT is a faceted ice shell snapping shut over the portrait while cracks spread through it; then it
 *    shatters outward (big shards, a crown of ice spikes, rings, a rune flare).
 *
 * LAYERS, bottom to top: ground (normal) | under (additive: runes, blooms) | mist (normal: snow puffs) | glow (additive:
 * icicle glows, trails, the nova's glow) | body | core | rim (normal: the ice) | hot (additive: specular edges, flashes,
 * glitter). Vertex arrays are rewritten in place; every strip is at most 48 vertices (under the batching limit).
 *
 * Contract: sprites and strips are POOLED per layer (hidden and reused) and bounded by `MAX_FROST_SPRITES` /
 * `MAX_FROST_MESHES`; textures are the caller's and are pre-warmed at construction (a near-invisible sprite each, while
 * the damage formation plays, so no texture uploads on the first icicle); positions are the overlay's px; `setCamera`
 * mirrors the DOM camera; `update` returns whether anything still draws; `destroy()` leaves nothing behind. Scatter is
 * seeded (a replay throws the same shards). The scene's clock is the sequence's: it advances by every `update`.
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { iciclePose, novaFront, trailPos, type IcicleMotion, type NovaMotion } from './heroFrostConfig';
import { FERN_W, ICE_LEN_PX, ICE_TIP_X, ICE_W } from './heroFrostTextures';

export interface HeroFrostTextures extends HeroArcanaTextures {
  iceBody: Texture; iceCore: Texture; iceRim: Texture; iceSpec: Texture; iceGlow: Texture;
  shardA: Texture; shardB: Texture; shardC: Texture;
  flake: Texture; rune: Texture; puff: Texture; fern: Texture;
  novaBody: Texture; novaEdge: Texture; sheet: Texture;
  shell: Texture; cracks: Texture; rime: Texture;
}

export interface FrostColors { core: number; ice: number; deep: number; side: number; shade: number }

export interface FrostLook {
  /** Icicle thickness multiplier. */
  thick: number;
  /** Icicle glow strength (0 = none). */
  glow: number;
  /** The deep core's opacity. */
  core: number;
  /** Trail length (ms of flight it spans) and width (px). */
  trailMs: number; trailWidth: number;
  /** Ice-dust density. */
  dust: number;
  shatterSize: number;
  snowPuffs: number;
  creepMs: number; creepFerns: number; creepReach: number;
  snowDensity: number;
  groundFerns: number; groundFadeMs: number;
  encaseSize: number;
}

/** Hard cap on sprites alive at once (a Tier IV shatter peaks around 450). */
export const MAX_FROST_SPRITES = 900;
/** Hard cap on strips alive at once (two per icicle trail, four for the nova). */
export const MAX_FROST_MESHES = 40;
/** Points per strip: at most 48 vertices, so every strip still batches. */
export const TRAIL_POINTS = 16;
export const ARC_POINTS = 20;
export const SHEET_POINTS = 24;

type LayerId = 'ground' | 'under' | 'mist' | 'glow' | 'body' | 'core' | 'rim' | 'hot';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['ground', 'normal'], ['under', 'add'], ['mist', 'normal'], ['glow', 'add'], ['body', 'normal'], ['core', 'normal'], ['rim', 'normal'], ['hot', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const RUNE_PX = 192;
const GLOW_PX = 128;
const SHELL_PX = 256;
const RING_PX = 160;

type StripKind = 'trail' | 'arc' | 'sheet';
const POINTS: Record<StripKind, number> = { trail: TRAIL_POINTS, arc: ARC_POINTS, sheet: SHEET_POINTS };

interface Strip { mesh: MeshSimple; v: Float32Array; layer: LayerId; kind: StripKind }

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  sy: number; spin: number; delay: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number; twinkle: number; spin: number; delay: number;
}

interface Icicle {
  m: IcicleMotion;
  glow: Sprite; body: Sprite; core: Sprite; rim: Sprite; spec: Sprite; flare: Sprite;
  trailGlow: Strip | null; trailCore: Strip | null;
  state: 'form' | 'fly' | 'gone';
  dustAcc: number; lastX: number; lastY: number; formedFx: boolean;
}

/** A frost fern (creeping over a portrait edge, or growing off the frozen ground): grows, holds, thaws. */
interface Fern { s: Sprite; age: number; delay: number; grow: number; scale: number; sy: number; hold: number; fade: number; alpha: number }

interface Charge {
  rune: Sprite; core: Sprite; bloom: Sprite; ring: Sprite;
  x: number; y: number; r: number; age: number; dur: number; k: number; left: number; releasing: number; acc: number; motes: number; mistAcc: number;
}

interface NovaCharge { rune: Sprite; inner: Sprite; core: Sprite; bloom: Sprite; x: number; y: number; r: number; age: number; dur: number; acc: number; dir: Pt; released: number }

interface Nova {
  m: NovaMotion;
  body: Strip; glow: Strip; edge: Strip; sheet: Strip;
  arriving: number; fadeSheet: number; sheetAlpha: number;
  lastAlong: number; fernNext: number; snowAcc: number; puffAcc: number; fernSide: number;
}

interface Encase { shell: Sprite; cracks: Sprite; glint: Sprite; x: number; y: number; r: number; age: number; dur: number }

export class HeroFrostScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly freeMeshes: Map<string, MeshSimple[]> = new Map();
  private used = 0;
  private meshes = 0;
  private clock = 0;
  private icicles: Icicle[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private ferns: Fern[] = [];
  private charge: Charge | null = null;
  private novaCharge: NovaCharge | null = null;
  private nova: Nova | null = null;
  private encase: Encase | null = null;
  private rime: { s: Sprite; level: number; shown: number; hold: number; fade: number; age: number } | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private readonly rnd: () => number;
  private readonly uvs: Record<StripKind, Float32Array>;
  private readonly idx: Record<StripKind, Uint32Array>;
  private readonly frostHot: number;
  private readonly glowC: number;
  // scratch (a centreline, its normals and half-widths, reused by every strip every frame)
  private readonly px = new Float32Array(SHEET_POINTS);
  private readonly py = new Float32Array(SHEET_POINTS);
  private readonly nx = new Float32Array(SHEET_POINTS);
  private readonly ny = new Float32Array(SHEET_POINTS);
  private readonly hw = new Float32Array(SHEET_POINTS);

  constructor(private readonly tex: HeroFrostTextures, private readonly colors: FrostColors, private readonly look: FrostLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroFrost';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `frost-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    this.rnd = seededRng(seed);
    this.frostHot = whiten(colors.ice, 0.55);
    this.glowC = mixColor(colors.side, colors.ice, 0.35);
    this.uvs = {} as Record<StripKind, Float32Array>;
    this.idx = {} as Record<StripKind, Uint32Array>;
    for (const kind of ['trail', 'arc', 'sheet'] as const) {
      const n = POINTS[kind];
      const uv = new Float32Array(n * 4);
      for (let j = 0; j < n; j++) {
        // A trail's head is j = 0 at u = 1 (the ribbon textures fade the tail in); an arc and a sheet run u 0..1.
        const u = kind === 'trail' ? 1 - j / (n - 1) : j / (n - 1);
        uv[j * 4] = u; uv[j * 4 + 1] = 0; uv[j * 4 + 2] = u; uv[j * 4 + 3] = 1;
      }
      this.uvs[kind] = uv;
      const id = new Uint32Array((n - 1) * 6);
      for (let j = 0; j < n - 1; j++) { const a = j * 2; id.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
      this.idx[kind] = id;
    }
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first icicle needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.spark, t.ring, t.star, t.ribbonSoft, t.ribbonBody, t.iceBody, t.iceCore, t.iceRim, t.iceSpec, t.iceGlow,
      t.shardA, t.shardB, t.shardC, t.flake, t.rune, t.puff, t.fern, t.novaBody, t.novaEdge, t.sheet, t.shell, t.cracks, t.rime]) {
      const s = this.take('hot', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used - this.warm.length; }
  get liveMeshes(): number { return this.meshes; }
  get liveIcicles(): number { return this.icicles.filter((i) => i.state !== 'gone').length; }
  get charging(): boolean { return this.charge !== null; }
  get novaLive(): boolean { return this.nova !== null; }
  get encased(): boolean { return this.encase !== null; }
  get liveFerns(): number { return this.ferns.length; }
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
    if (this.destroyed || this.used >= MAX_FROST_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(layer: LayerId, s: Sprite): void { s.visible = false; this.freeSprites[layer].push(s); this.used--; }
  private layerOf(s: Sprite): LayerId { return (s.parent?.label?.replace('frost-', '') ?? 'hot') as LayerId; }
  private giveS(s: Sprite | null): void { if (s) this.give(this.layerOf(s), s); }

  private strip(layer: LayerId, kind: StripKind, t: Texture, tint: number): Strip | null {
    if (this.destroyed || this.meshes >= MAX_FROST_MESHES) return null;
    const key = `${layer}:${kind}`;
    let mesh = this.freeMeshes.get(key)?.pop();
    if (!mesh) {
      mesh = new MeshSimple({ texture: t, vertices: new Float32Array(POINTS[kind] * 4), uvs: this.uvs[kind], indices: this.idx[kind] });
      mesh.blendMode = BLEND[layer];
      mesh.label = key;
      this.layers[layer].addChild(mesh);
    } else mesh.texture = t;
    mesh.tint = tint; mesh.alpha = 0; mesh.visible = true;
    this.meshes++;
    return { mesh, v: mesh.vertices as Float32Array, layer, kind };
  }

  private giveStrip(st: Strip | null): void {
    if (!st) return;
    st.mesh.visible = false;
    const key = `${st.layer}:${st.kind}`;
    const list = this.freeMeshes.get(key) ?? [];
    list.push(st.mesh);
    this.freeMeshes.set(key, list);
    this.meshes--;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age'>> & { dur: number; from: number; to: number; a0: number }, rot = 0): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, ...o };
    s.position.set(x, y); s.rotation = rot;
    s.scale.set(f.from * this.scale, f.from * this.scale * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max' | 'delay'> & { delay?: number }): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = this.rnd() * Math.PI * 2;
    s.alpha = o.delay ? 0 : o.alpha;
    s.scale.set(o.from);
    this.particles.push({ delay: 0, ...o, s, max: o.life });
  }

  /** A burst of glitter stars (additive). */
  private glitter(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; life?: number; size?: number; grav?: number; lift?: number } = {}): void {
    const S = this.scale;
    const tints = [this.colors.core, this.frostHot, this.colors.ice];
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = speed * (0.4 + this.rnd() * 0.8) * S;
      const sz = (o.size ?? 0.45) * (0.6 + this.rnd() * 0.7);
      this.particle('hot', this.tex.star, tints[i % 3]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 0) * S, drag: 0.05, grav: (o.grav ?? 160) * S,
        life: (o.life ?? 560) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.2 * S, alpha: 1,
        twinkle: 0.02 + this.rnd() * 0.025, spin: (this.rnd() - 0.5) * 0.01,
      });
    }
  }

  /** Faceted shards flung from a point: `dir` the main heading, `spread` the fan (2 pi = all round). Normal blend (they keep their cut). */
  private shards(x: number, y: number, n: number, o: { dir: number; spread: number; speed: number; size: number; life?: number; grav?: number; from?: number }): void {
    const S = this.scale;
    const texs = [this.tex.shardA, this.tex.shardB, this.tex.shardC];
    for (let i = 0; i < n; i++) {
      const a = o.dir + (this.rnd() - 0.5) * o.spread;
      const sp = o.speed * (0.45 + this.rnd() * 0.85) * S;
      const sz = o.size * (0.45 + this.rnd() * 0.75) * (i % 5 === 0 ? 1.5 : 1);
      const r0 = (o.from ?? 0) * (0.3 + this.rnd() * 0.7);
      const tint = i % 3 === 0 ? this.colors.core : i % 3 === 1 ? this.colors.ice : whiten(this.colors.ice, 0.4);
      this.particle(i % 4 === 3 ? 'core' : 'body', texs[i % 3]!, tint, {
        x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * S * this.rnd(),
        drag: 0.12, grav: (o.grav ?? 900) * S, life: (o.life ?? 620) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.55 * S, alpha: 0.98,
        twinkle: i % 3 === 0 ? 0.03 : 0, spin: (this.rnd() - 0.5) * 0.04,
      });
    }
  }

  /** Snow puffs (normal blend billows): expanding, drifting along `dir`, fading. */
  private puffs(x: number, y: number, n: number, o: { dir: number; spread: number; speed: number; size: number; life?: number; alpha?: number }): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = o.dir + (this.rnd() - 0.5) * o.spread;
      const sp = o.speed * (0.4 + this.rnd() * 0.8) * S;
      const sz = o.size * (0.7 + this.rnd() * 0.6);
      this.particle('mist', this.tex.puff, i % 2 ? this.colors.core : whiten(this.colors.ice, 0.55), {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.08, grav: -20 * S, life: (o.life ?? 700) * (0.8 + this.rnd() * 0.4),
        from: sz * 0.45 * S, to: sz * S, alpha: o.alpha ?? 0.6, twinkle: 0, spin: (this.rnd() - 0.5) * 0.002,
      });
    }
  }

  /** A fern sprite: rooted at its left middle, pointing along `rot`, `len` px long, growing over `grow` ms after `delay`. */
  private fern(x: number, y: number, rot: number, len: number, o: { grow: number; delay: number; hold: number; fade: number; alpha: number; tint: number; layer?: LayerId }): void {
    const s = this.take(o.layer ?? 'rim', this.tex.fern, o.tint);
    if (!s) return;
    s.anchor.set(3 / FERN_W, 0.5);
    s.position.set(x, y); s.rotation = rot; s.alpha = 0; s.scale.set(0);
    const sc = len / FERN_W;
    this.ferns.push({ s, age: 0, delay: o.delay, grow: Math.max(1, o.grow), scale: sc, sy: 0.8 + this.rnd() * 0.4, hold: o.hold, fade: Math.max(1, o.fade), alpha: o.alpha });
  }

  /** An icicle's size relative to the reference 150 px one, without the stage scale (the fx helpers apply it). */
  private lenK(m: IcicleMotion): number { return m.len / (150 * this.scale); }

  // ── beats: the icicles ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * The hero gathers the cold: a frost rune opens under the portrait and turns, a cold core swells, mist gathers round
   * the rim and snowflakes spiral in. Held while the icicles form; released as the LAST one leaves.
   */
  startCharge(x: number, y: number, radius: number, durMs: number, k: number, launches: number): void {
    if (this.charge) return;
    const rune = this.take('under', this.tex.rune, this.colors.ice);
    const core = this.take('hot', this.tex.glow, this.colors.core);
    const bloom = this.take('under', this.tex.glow, this.glowC);
    const ring = this.take('hot', this.tex.ring, this.frostHot);
    if (!rune || !core || !bloom || !ring) { for (const s of [rune, core, bloom, ring]) this.giveS(s); return; }
    for (const s of [rune, core, bloom, ring]) { s.position.set(x, y); s.alpha = 0; }
    this.charge = { rune, core, bloom, ring, x, y, r: radius, age: 0, dur: Math.max(1, durMs), k, left: Math.max(1, launches), releasing: -1, acc: 0, motes: 10 + 6 * k, mistAcc: 0 };
  }

  /** An icicle starts to crystallise (it draws itself from its pure motion from here on). */
  grow(m: IcicleMotion): void {
    const c = this.colors;
    const glow = this.take('glow', this.tex.iceGlow, this.glowC);
    const body = this.take('body', this.tex.iceBody, c.ice);
    const core = this.take('core', this.tex.iceCore, c.deep);
    const rim = this.take('rim', this.tex.iceRim, whiten(c.ice, 0.6));
    const spec = this.take('hot', this.tex.iceSpec, c.core);
    const flare = this.take('hot', this.tex.star, c.core);
    if (!glow || !body || !core || !rim || !spec || !flare) { for (const s of [glow, body, core, rim, spec, flare]) this.giveS(s); return; }
    for (const s of [glow, body, core, rim, spec]) { s.anchor.set(ICE_TIP_X / ICE_W, 0.5); s.alpha = 0; }
    flare.alpha = 0;
    const p = iciclePose(m, m.formAt);
    this.icicles.push({ m, glow, body, core, rim, spec, flare, trailGlow: null, trailCore: null, state: 'form', dustAcc: 0, lastX: p.x, lastY: p.y, formedFx: false });
    // A cold breath where it condenses.
    this.puffs(m.home.x, m.home.y, 1, { dir: 0, spread: Math.PI * 2, speed: 12, size: 0.9 * this.lenK(m), life: 620, alpha: 0.35 });
  }

  /** An icicle fires: a snap of rime off its tip, a small ring, and its trail begins. */
  fire(m: IcicleMotion): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const ic = this.icicles.find((i) => i.m === m && i.state === 'form');
    if (!ic) return;
    ic.state = 'fly';
    ic.trailGlow = this.strip('glow', 'trail', this.tex.ribbonSoft, this.glowC);
    ic.trailCore = this.strip('glow', 'trail', this.tex.ribbonBody, this.colors.core);
    const dir = Math.atan2(m.aim.y, m.aim.x);
    const bx = m.home.x - m.aim.x * m.len * 0.5, by = m.home.y - m.aim.y * m.len * 0.5;
    const k = this.lenK(m);
    this.fxs('hot', this.tex.ring, this.frostHot, bx, by, { dur: 240, from: 0.2, to: 0.75 * k, a0: 0.8 });
    this.fxs('hot', this.tex.glow, this.colors.core, m.from.x, m.from.y, { dur: 130, from: 0.3, to: 0.9, a0: 0.7 });
    this.puffs(bx, by, 2, { dir: dir + Math.PI, spread: 1.2, speed: 60, size: 0.7 * k, life: 520, alpha: 0.4 });
    this.glitter(bx, by, 4, 260, { dir: dir + Math.PI, spread: 1.6, life: 360, size: 0.35, grav: 40 });
  }

  /** An icicle lands and shatters (a tick, or with `big` the impact). */
  shatter(m: IcicleMotion, dir: Pt, o: { size: number; shards: number; big: boolean; burst: number; flashAlpha: number; radius: number; tier: number; spikes: number }): void {
    const ic = this.icicles.find((i) => i.m === m && i.state !== 'gone');
    if (ic) this.dropIcicle(ic);
    const { x, y } = m.to;
    const c = this.colors;
    const S = this.scale;
    const head = Math.atan2(dir.y, dir.x);
    const L = this.look;
    const g = o.size * L.shatterSize;
    if (!o.big) {
      // A TICK is line work: a snowflake flash and a crisp ring over a tiny, quick flash; shards back toward the thrower.
      this.fxs('hot', this.tex.glow, c.core, x, y, { dur: 110, from: 0.5 * g, to: 1.1 * g, a0: 0.55 });
      this.fxs('rim', this.tex.flake, c.core, x, y, { dur: 360, from: 0.35 * g, to: 1.0 * g, a0: 0.9, spin: 0.004 }, this.rnd() * Math.PI);
      this.fxs('hot', this.tex.ring, this.frostHot, x, y, { dur: 280, from: 0.25, to: 1.1 * g, a0: 0.75 });
      this.shards(x, y, o.shards, { dir: head + Math.PI, spread: 2.6, speed: 520, size: 0.42 * g, life: 560 });
      this.puffs(x, y, Math.round(2 * L.snowPuffs), { dir: head + Math.PI, spread: 1.8, speed: 70, size: 0.9 * g, life: 620, alpha: 0.5 });
      this.glitter(x, y, 6, 380, { dir: head + Math.PI, spread: 2.2, life: 480 });
      return;
    }
    // THE IMPACT: the brightest frame first, then gone in ~150 ms (the big -N must read); line work lingers.
    const portrait = (o.radius * 2) / GLOW_PX / S;
    const rune = (o.radius * 2) / RUNE_PX / S;
    const fs = o.burst;
    this.fxs('hot', this.tex.glow, c.core, x, y, { dur: 110, from: portrait * 1.05, to: portrait * 1.25, a0: 0.55 * o.flashAlpha });
    this.fxs('hot', this.tex.glow, c.core, x, y, { dur: 150, from: 0.9 * fs, to: Math.min(3, 2 * fs), a0: o.flashAlpha });
    this.fxs('under', this.tex.glow, this.glowC, x, y, { dur: 420, from: 1.5 * fs, to: Math.min(5, 3.4 * fs), a0: 0.4 * o.flashAlpha });
    this.fxs('rim', this.tex.flake, c.core, x, y, { dur: 620, from: 0.6 * g, to: 1.9 * g * fs, a0: 0.95, spin: 0.005 }, this.rnd() * Math.PI);
    this.fxs('under', this.tex.rune, c.ice, x, y, { dur: 820, from: rune * 1.0, to: rune * (1.5 + 0.35 * o.tier / 4), a0: 0.8, spin: -0.003 });
    this.fxs('hot', this.tex.ring, c.core, x, y, { dur: 300, from: 0.4, to: 2.6 * (0.8 + 0.2 * o.tier), a0: 1 });
    this.fxs('hot', this.tex.ring, this.glowC, x, y, { dur: 540, from: 0.5, to: 3.8 * (0.8 + 0.2 * o.tier), a0: 0.6 });
    this.shards(x, y, o.shards, { dir: head + Math.PI, spread: 3.4, speed: 720, size: 0.55 * g, life: 700 });
    this.shards(x, y, Math.round(o.shards * 0.35), { dir: head, spread: 1.4, speed: 420, size: 0.4 * g, life: 520 });
    this.puffs(x, y, Math.round(4 * L.snowPuffs), { dir: head + Math.PI, spread: 3, speed: 110, size: 1.2 * g, life: 800, alpha: 0.55 });
    this.glitter(x, y, 14 + 4 * o.tier, 620, { life: 700, size: 0.5, grav: 120 });
    this.spikes(x, y, o.radius, o.spikes, head);
  }

  /** A crown of ice spikes bursting out of the struck portrait's rim (small icicles), then shattering away. */
  private spikes(x: number, y: number, radius: number, n: number, head: number): void {
    if (n <= 0) return;
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = head + Math.PI + (i / n) * Math.PI * 2 + (this.rnd() - 0.5) * 0.3;
      const len = radius * (0.5 + this.rnd() * 0.35);
      const sc = len / ICE_LEN_PX;
      const r0 = radius * 0.72;
      const bx = x + Math.cos(a) * r0, by = y + Math.sin(a) * r0;
      // The spike is anchored at its tip: place the tip `len` beyond the rim point, pointing outward.
      const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len;
      for (const [layer, t, tint, a0] of [
        ['body', this.tex.iceBody, this.colors.ice, 0.95], ['core', this.tex.iceCore, this.colors.deep, 0.6 * this.look.core], ['hot', this.tex.iceSpec, this.colors.core, 0.9],
      ] as const) {
        const s = this.fxs(layer, t, tint, tx, ty, { dur: 420, from: sc * 0.2 / S, to: sc / S, a0, mode: 'hold', sy: 0.8, delay: 20 * (i % 3) }, a);
        if (s) s.anchor.set(ICE_TIP_X / ICE_W, 0.5);
      }
      this.shards(tx, ty, 2, { dir: a, spread: 0.8, speed: 260, size: 0.3, life: 520, grav: 700 });
    }
  }

  /**
   * FROST CREEPS over the struck portrait's edge: ferns grow in from the rim on the side the ice came from, and a rime
   * ring thickens round it. It builds with every hit and thaws after the end (`holdMs` from now).
   */
  creep(x: number, y: number, radius: number, fromAng: number, amount: number, holdMs: number): void {
    const L = this.look;
    if (amount <= 0) return;
    const n = Math.round(L.creepFerns * amount);
    for (let i = 0; i < n; i++) {
      const a = fromAng + (this.rnd() - 0.5) * 2.2 + (i % 2 ? 0.25 : -0.25);
      const r = radius * 1.04;
      const len = radius * L.creepReach * (0.65 + this.rnd() * 0.6) * (0.8 + 0.3 * amount);
      this.fern(x + Math.cos(a) * r, y + Math.sin(a) * r, a + Math.PI + (this.rnd() - 0.5) * 0.5, len, {
        grow: L.creepMs * (0.8 + this.rnd() * 0.4), delay: this.rnd() * 90, hold: holdMs, fade: 420, alpha: 0.9, tint: whiten(this.colors.ice, 0.55),
      });
    }
    if (!this.rime) {
      const s = this.take('rim', this.tex.rime, whiten(this.colors.ice, 0.4));
      if (s) { s.position.set(x, y); s.scale.set((radius * 2.18) / SHELL_PX); s.alpha = 0; this.rime = { s, level: 0, shown: 0, hold: holdMs, fade: 420, age: 0 }; }
    }
    if (this.rime) { this.rime.level = Math.min(1, this.rime.level + 0.35 * amount); this.rime.hold = Math.max(this.rime.hold, holdMs + this.rime.age); }
  }

  // ── beats: the nova ────────────────────────────────────────────────────────────────────────────────────────

  /** The hero gathers the cold for the nova: a big rune spins up, snow spirals in, a cold core builds, facing the target. */
  startNovaCharge(x: number, y: number, radius: number, durMs: number, dir: Pt): void {
    if (this.novaCharge) return;
    const rune = this.take('under', this.tex.rune, this.colors.ice);
    const inner = this.take('under', this.tex.rune, this.glowC);
    const core = this.take('hot', this.tex.glow, this.colors.core);
    const bloom = this.take('under', this.tex.glow, this.glowC);
    if (!rune || !inner || !core || !bloom) { for (const s of [rune, inner, core, bloom]) this.giveS(s); return; }
    for (const s of [rune, inner, core, bloom]) { s.position.set(x, y); s.alpha = 0; }
    this.novaCharge = { rune, inner, core, bloom, x, y, r: radius, age: 0, dur: Math.max(1, durMs), acc: 0, dir: { ...dir }, released: -1 };
  }

  /** THE NOVA is released: a burst at the hero, and the wave front starts to roll across the screen. */
  release(m: NovaMotion): void {
    const nc = this.novaCharge;
    if (nc) nc.released = 0;
    const body = this.strip('body', 'arc', this.tex.novaBody, whiten(this.colors.ice, 0.35));
    const glow = this.strip('glow', 'arc', this.tex.novaBody, this.glowC);
    const edge = this.strip('hot', 'arc', this.tex.novaEdge, this.colors.core);
    const sheet = this.strip('ground', 'sheet', this.tex.sheet, this.colors.ice);
    if (!body || !glow || !edge || !sheet) { for (const s of [body, glow, edge, sheet]) this.giveStrip(s); return; }
    this.nova = { m, body, glow, edge, sheet, arriving: -1, fadeSheet: -1, sheetAlpha: 0, lastAlong: m.start, fernNext: m.start + m.w0 * 0.4, snowAcc: 0, puffAcc: 0, fernSide: 1 };
    const { a } = m;
    const head = Math.atan2(m.dir.y, m.dir.x);
    const S = this.scale;
    this.fxs('hot', this.tex.glow, this.colors.core, a.x, a.y, { dur: 150, from: 0.8, to: 2.2, a0: 0.9 });
    this.fxs('hot', this.tex.ring, this.colors.core, a.x, a.y, { dur: 320, from: 0.4, to: (m.w0 * 2.4) / RING_PX / S, a0: 0.9 });
    this.fxs('hot', this.tex.ring, this.glowC, a.x, a.y, { dur: 520, from: 0.5, to: (m.w0 * 3.4) / RING_PX / S, a0: 0.55, sy: 0.7 }, head);
    this.puffs(a.x, a.y, Math.round(6 * this.look.snowPuffs), { dir: head, spread: 2.2, speed: 180, size: 1.3, life: 700, alpha: 0.5 });
  }

  /** The nova reaches the struck hero: its front breaks round the portrait and the ICE ENCASES it (holding until the shatter). */
  contact(x: number, y: number, radius: number, durMs: number): void {
    const nv = this.nova;
    if (nv && nv.arriving < 0) nv.arriving = 0;
    if (this.encase) return;
    const c = this.colors;
    const shell = this.take('body', this.tex.shell, whiten(c.ice, 0.25));
    const cracks = this.take('rim', this.tex.cracks, c.core);
    const glint = this.take('hot', this.tex.star, c.core);
    if (!shell || !cracks || !glint) { for (const s of [shell, cracks, glint]) this.giveS(s); return; }
    for (const s of [shell, cracks, glint]) { s.position.set(x, y); s.alpha = 0; }
    this.encase = { shell, cracks, glint, x, y, r: radius, age: 0, dur: Math.max(1, durMs) };
    const S = this.scale;
    const portrait = (radius * 2) / GLOW_PX / S;
    // The flash of ice (a short fill), a snap ring closing IN on the portrait, frost bursting round the rim.
    this.fxs('hot', this.tex.glow, c.core, x, y, { dur: 140, from: portrait * 1.1, to: portrait * 1.3, a0: 0.75 });
    this.fxs('hot', this.tex.ring, c.core, x, y, { dur: 200, from: (radius * 3) / RING_PX / S, to: (radius * 2.2) / RING_PX / S, a0: 0.9 });
    this.puffs(x, y, Math.round(6 * this.look.snowPuffs), { dir: 0, spread: Math.PI * 2, speed: 120, size: 1.2, life: 700, alpha: 0.5 });
    this.glitter(x, y, 12, 380, { life: 520, grav: 60 });
  }

  /**
   * THE SHATTER (Tier IV's impact): the encasement bursts outward. A short flash, the rune flaring, three rings (the last
   * a wide slow cold shockwave), big faceted shards thrown off the whole shell, a crown of ice spikes, snow billows and
   * glitter; the frozen ground starts to thaw.
   */
  shatterNova(x: number, y: number, radius: number, dir: Pt, o: { burst: number; shards: number; flashAlpha: number; spikes: number }): void {
    const en = this.encase;
    if (en) { this.giveS(en.shell); this.giveS(en.cracks); this.giveS(en.glint); this.encase = null; }
    const nv = this.nova;
    if (nv && nv.fadeSheet < 0) nv.fadeSheet = 0;
    const c = this.colors;
    const S = this.scale;
    const fs = o.burst;
    const portrait = (radius * 2) / GLOW_PX / S;
    const rune = (radius * 2) / RUNE_PX / S;
    const head = Math.atan2(dir.y, dir.x);
    this.fxs('hot', this.tex.glow, c.core, x, y, { dur: 130, from: portrait * 1.2, to: portrait * 1.5, a0: 0.8 * o.flashAlpha });
    this.fxs('hot', this.tex.glow, c.core, x, y, { dur: 170, from: 1.3 * fs, to: Math.min(5, 2.8 * fs), a0: o.flashAlpha });
    this.fxs('under', this.tex.glow, this.glowC, x, y, { dur: 520, from: 2 * fs, to: Math.min(8, 4.6 * fs), a0: 0.45 * o.flashAlpha });
    this.fxs('hot', this.tex.ring, c.core, x, y, { dur: 300, from: 0.5, to: (radius * 3.2) / RING_PX / S, a0: 1 });
    this.fxs('hot', this.tex.ring, this.glowC, x, y, { dur: 540, from: 0.6, to: (radius * 5) / RING_PX / S, a0: 0.85 });
    this.fxs('under', this.tex.ring, c.ice, x, y, { dur: 860, from: 0.7, to: (radius * 7.5) / RING_PX / S, a0: 0.6, sy: 0.72 });
    this.fxs('under', this.tex.rune, c.ice, x, y, { dur: 900, from: rune * 1.2, to: rune * 2.6, a0: 0.9, spin: 0.004 });
    this.fxs('rim', this.tex.flake, c.core, x, y, { dur: 700, from: rune * 0.8, to: rune * 2.4 * fs * 0.6, a0: 0.9, spin: -0.004 }, this.rnd());
    // Big shards off the whole shell, all round, most flung away from where the wave came from.
    this.shards(x, y, Math.round(o.shards * 0.65), { dir: head, spread: Math.PI * 2, speed: 980, size: 0.95, life: 900, grav: 720, from: radius * 0.9 });
    this.shards(x, y, Math.round(o.shards * 0.35), { dir: head, spread: 1.6, speed: 1150, size: 0.75, life: 760, grav: 620, from: radius * 0.5 });
    this.spikes(x, y, radius, o.spikes, head + Math.PI);
    this.puffs(x, y, Math.round(8 * this.look.snowPuffs), { dir: head, spread: Math.PI * 2, speed: 240, size: 1.6, life: 900, alpha: 0.55 });
    this.glitter(x, y, 30, 900, { life: 820, size: 0.6, grav: 220 });
    this.glitter(x, y, 14, 420, { life: 1100, size: 0.45, grav: -40, lift: 80 });
    this.fxs('under', this.tex.glow, this.glowC, x, y, { dur: 1400, from: 2.4 * fs, to: 3 * fs, a0: 0.4 });
  }

  /** A tinkling aftershock (IV): a small snowflake flash, a ring and a few shards. */
  boom(x: number, y: number, size: number): void {
    this.fxs('hot', this.tex.glow, this.colors.core, x, y, { dur: 160, from: 0.5 * size, to: 1.3 * size, a0: 0.8 });
    this.fxs('rim', this.tex.flake, this.colors.core, x, y, { dur: 380, from: 0.3 * size, to: 0.9 * size, a0: 0.9, spin: 0.006 }, this.rnd());
    this.fxs('hot', this.tex.ring, this.frostHot, x, y, { dur: 320, from: 0.25, to: 1.4 * size, a0: 0.8 });
    this.shards(x, y, 5, { dir: -Math.PI / 2, spread: Math.PI * 2, speed: 380, size: 0.4, life: 520 });
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    this.clock += dt;
    const sec = dt / 1000;
    const S = this.scale;

    if (this.warm.length) {
      this.warmLeft -= dt;
      if (this.warmLeft <= 0) { for (const s of this.warm) this.giveS(s); this.warm = []; }
    }

    this.updateCharge(dt);
    this.updateNovaCharge(dt);

    for (let i = this.icicles.length - 1; i >= 0; i--) {
      const ic = this.icicles[i]!;
      if (ic.state === 'gone') { this.icicles.splice(i, 1); continue; }
      this.drawIcicle(ic);
    }

    if (this.nova) this.updateNova(dt);

    const en = this.encase;
    if (en) {
      en.age += dt;
      const u = clamp01(en.age / en.dur);
      const snap = easeOutBack(clamp01(en.age / 90), 1.8);
      const base = (en.r * 2 * this.look.encaseSize) / (SHELL_PX * 0.94);
      // It snaps shut (from a touch bigger), then strains: a tremble that grows until it bursts.
      const tr = 1.2 * S * u * u;
      en.shell.position.set(en.x + tr * Math.sin(this.clock * 0.41), en.y + tr * Math.sin(this.clock * 0.53 + 1));
      en.shell.scale.set(base * (1.25 - 0.25 * snap) * (1 + 0.025 * u));
      en.shell.alpha = 0.85 * clamp01(en.age / 50);
      en.cracks.position.copyFrom(en.shell.position);
      en.cracks.scale.set(base * (0.35 + 0.65 * easeOutCubic(u)) * 0.96);
      en.cracks.alpha = clamp01((u - 0.12) * 2.2) * 0.95;
      en.glint.position.set(en.x - en.r * 0.45, en.y - en.r * 0.5);
      en.glint.scale.set((0.6 + 0.4 * Math.sin(this.clock * 0.02)) * S);
      en.glint.rotation += dt * 0.003;
      en.glint.alpha = 0.9 * clamp01(en.age / 80);
    }

    if (this.rime) {
      const r = this.rime;
      r.age += dt;
      r.shown += (r.level - r.shown) * Math.min(1, dt / 90);
      const thaw = r.age > r.hold ? clamp01((r.age - r.hold) / r.fade) : 0;
      r.s.alpha = 0.85 * r.shown * (1 - thaw);
      if (thaw >= 1) { this.giveS(r.s); this.rime = null; }
    }

    for (let i = this.ferns.length - 1; i >= 0; i--) {
      const f = this.ferns[i]!;
      if (f.delay > 0) { f.delay -= dt; if (f.delay > 0) continue; }
      f.age += dt;
      const g = easeOutCubic(f.age / f.grow);
      f.s.scale.set(f.scale * g, f.scale * f.sy * (0.6 + 0.4 * g));
      const thaw = f.age > f.hold ? clamp01((f.age - f.hold) / f.fade) : 0;
      f.s.alpha = f.alpha * clamp01(f.age / 60) * (1 - thaw);
      if (thaw >= 1) { this.giveS(f.s); this.ferns.splice(i, 1); }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      const sc = (q.from + (q.to - q.from) * easeOutQuint(u)) * S;
      q.s.scale.set(sc, sc * q.sy);
      if (q.spin) q.s.rotation += q.spin * dt * (1 - 0.6 * u);
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35)
          : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.giveS(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      if (p.delay > 0) { p.delay -= dt; if (p.delay > 0) continue; }
      p.life -= dt;
      if (p.life <= 0) { this.giveS(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      const sc = p.from + (p.to - p.from) * t;
      p.s.position.set(p.x, p.y);
      p.s.scale.set(sc);
      if (p.spin) p.s.rotation += p.spin * dt;
      const tw = p.twinkle ? 0.5 + 0.5 * Math.sin((p.max - p.life) * p.twinkle * 6) : 1;
      p.s.alpha = p.alpha * (1 - t * t) * tw;
    }

    return this.liveSprites > 0 || this.meshes > 0;
  }

  private updateCharge(dt: number): void {
    const ch = this.charge;
    if (!ch) return;
    const S = this.scale;
    ch.age += dt;
    const u = clamp01(ch.age / ch.dur);
    const rs = (ch.r * 2.5) / RUNE_PX;
    if (ch.releasing < 0) {
      const e = easeOutCubic(u);
      ch.rune.scale.set(rs * (0.6 + 0.4 * e)); ch.rune.alpha = 0.8 * Math.min(1, u * 2.5);
      ch.rune.rotation += dt * (0.0008 + 0.002 * u);
      ch.core.scale.set((0.3 + 0.55 * e) * (1 + 0.3 * ch.k) * (1 + 0.06 * Math.sin(ch.age * 0.04)) * S); ch.core.alpha = 0.25 + 0.4 * u;
      ch.bloom.scale.set((1 + 1.2 * u) * (1 + 0.3 * ch.k) * S); ch.bloom.alpha = 0.45 * u;
      ch.ring.scale.set(((ch.r * 2.6) / RING_PX) * (1.6 - 0.6 * e)); ch.ring.alpha = Math.min(0.6, u * 2) * (1 - 0.5 * u);
      // Snowflakes spiral in; mist gathers round the rim.
      ch.acc += ((ch.motes * 2) / Math.max(300, ch.dur)) * dt;
      while (ch.acc >= 1) {
        ch.acc -= 1;
        const a = this.rnd() * Math.PI * 2;
        const r = ch.r * (1.5 + this.rnd() * 0.7);
        const life = 260 + this.rnd() * 90;
        const sp = r / (life / 1000);
        this.particle('rim', this.tex.flake, this.rnd() < 0.5 ? this.colors.core : this.frostHot, {
          x: ch.x + Math.cos(a) * r, y: ch.y + Math.sin(a) * r,
          vx: -Math.cos(a) * sp - Math.sin(a) * sp * 0.45, vy: -Math.sin(a) * sp + Math.cos(a) * sp * 0.45,
          drag: 1, grav: 0, life, from: (0.16 + this.rnd() * 0.12) * S, to: 0.06 * S, alpha: 0.9, twinkle: 0, spin: 0.01,
        });
      }
      ch.mistAcc += dt;
      if (ch.mistAcc > 130) {
        ch.mistAcc = 0;
        const a = this.rnd() * Math.PI * 2;
        this.puffs(ch.x + Math.cos(a) * ch.r * 1.1, ch.y + Math.sin(a) * ch.r * 1.1, 1, { dir: a + Math.PI / 2, spread: 0.6, speed: 30, size: 0.9, life: 800, alpha: 0.32 });
      }
    } else {
      ch.releasing += dt;
      const r = clamp01(ch.releasing / 260);
      ch.rune.scale.set(rs * (1 + 0.3 * easeOutCubic(r))); ch.rune.alpha = 0.8 * (1 - r); ch.rune.rotation += dt * 0.004;
      ch.core.alpha = (0.65) * (1 - r);
      ch.bloom.alpha = 0.45 * (1 - r);
      ch.ring.alpha = 0;
      if (r >= 1) { for (const s of [ch.rune, ch.core, ch.bloom, ch.ring]) this.giveS(s); this.charge = null; }
    }
  }

  private updateNovaCharge(dt: number): void {
    const nc = this.novaCharge;
    if (!nc) return;
    const S = this.scale;
    nc.age += dt;
    const rs = (nc.r * 3.2) / RUNE_PX;
    if (nc.released < 0) {
      const u = clamp01(nc.age / nc.dur);
      const e = easeInOutSine(u);
      nc.rune.scale.set(rs * (0.5 + 0.5 * easeOutCubic(u))); nc.rune.alpha = 0.85 * Math.min(1, u * 2);
      nc.rune.rotation += dt * (0.001 + 0.009 * u * u);
      nc.inner.scale.set(rs * 0.55); nc.inner.alpha = 0.7 * Math.min(1, u * 1.6);
      nc.inner.rotation -= dt * (0.002 + 0.014 * u * u);
      const throb = 1 + (0.05 + 0.08 * u) * Math.sin(nc.age * (0.02 + 0.06 * u));
      nc.core.scale.set((0.4 + 1.1 * e) * throb * S); nc.core.alpha = 0.3 + 0.55 * u;
      nc.bloom.scale.set((1.2 + 2.4 * e) * S); nc.bloom.alpha = 0.3 + 0.35 * u;
      // Snow and crystals spiral in, faster and denser as it builds.
      nc.acc += dt * (0.05 + 0.14 * u) * this.look.snowDensity;
      while (nc.acc >= 1) {
        nc.acc -= 1;
        const a = this.rnd() * Math.PI * 2;
        const r = nc.r * (1.7 + this.rnd() * 1.1);
        const life = 240 + this.rnd() * 110;
        const sp = r / (life / 1000);
        this.particle(this.rnd() < 0.6 ? 'rim' : 'hot', this.rnd() < 0.6 ? this.tex.flake : this.tex.star, this.rnd() < 0.5 ? this.colors.core : this.frostHot, {
          x: nc.x + Math.cos(a) * r, y: nc.y + Math.sin(a) * r,
          vx: -Math.cos(a) * sp - Math.sin(a) * sp * 0.6, vy: -Math.sin(a) * sp + Math.cos(a) * sp * 0.6,
          drag: 1, grav: 0, life, from: (0.2 + this.rnd() * 0.16) * S, to: 0.06 * S, alpha: 1, twinkle: 0, spin: 0.012,
        });
      }
    } else {
      nc.released += dt;
      const r = clamp01(nc.released / 300);
      nc.rune.scale.set(rs * (1 + 0.45 * easeOutCubic(r))); nc.rune.alpha = 0.85 * (1 - r); nc.rune.rotation += dt * 0.01;
      nc.inner.alpha = 0.7 * (1 - r) * (1 - r);
      nc.core.scale.set((1.5 + 1.2 * r) * S); nc.core.alpha = 0.85 * (1 - r) * (1 - r);
      nc.bloom.alpha = 0.65 * (1 - r);
      if (r >= 1) { for (const s of [nc.rune, nc.inner, nc.core, nc.bloom]) this.giveS(s); this.novaCharge = null; }
    }
  }

  /** The icicle: every sprite on the pose's transform; the trail sampled back along the pure flight. */
  private drawIcicle(ic: Icicle): void {
    const { m } = ic;
    const L = this.look;
    const S = this.scale;
    const p = iciclePose(m, this.clock);
    const g = Math.max(0, p.grow);
    const sx = (m.len / ICE_LEN_PX) * g;
    const sy = (m.len / ICE_LEN_PX) * L.thick * Math.sqrt(Math.max(0, Math.min(1.2, g)));
    const formU = clamp01((this.clock - m.formAt) / Math.max(1, m.growMs));
    // Crystallising: it arrives white-hot and settles into its colour; the specular edge flashes along it as it grows.
    const born = clamp01(formU * 1.6);
    for (const s of [ic.glow, ic.body, ic.core, ic.rim, ic.spec]) { s.position.set(p.x, p.y); s.rotation = p.rot; s.scale.set(sx, sy); }
    ic.glow.scale.set(sx * 1.05, sy * 1.35);
    const flying = p.flying;
    ic.body.alpha = 0.95 * born;
    ic.body.tint = mixColor(this.colors.core, this.colors.ice, easeOutCubic(formU));
    ic.core.alpha = L.core * 0.8 * clamp01(formU * 1.3 - 0.2);
    ic.rim.alpha = 0.9 * born;
    const shimmer = 0.75 + 0.25 * Math.sin(this.clock * 0.03 + m.phase);
    ic.spec.alpha = (formU < 1 ? 1 : flying ? 1 : shimmer) * born;
    ic.glow.alpha = L.glow * (flying ? 0.9 : 0.45 + 0.15 * Math.sin(this.clock * 0.012 + m.phase)) * born;
    // The growth glint rides the growing tip, then goes out.
    ic.flare.position.set(p.x, p.y);
    ic.flare.scale.set(this.lenK(m) * 0.55 * S * (1 + 0.3 * Math.sin(this.clock * 0.05)));
    ic.flare.rotation += 0.05;
    ic.flare.alpha = formU < 1 ? 0.95 * (1 - formU * 0.6) : Math.max(0, 0.4 - (this.clock - m.formAt - m.growMs) / 300);
    if (!ic.formedFx && formU >= 1) {
      ic.formedFx = true;
      this.glitter(p.x, p.y, 3, 120, { life: 360, size: 0.32, grav: 20 });
    }
    // Crystals flaking off the growth front.
    if (formU < 1 && this.rnd() < 0.25) {
      this.particle('hot', this.tex.star, this.frostHot, {
        x: p.x, y: p.y, vx: (this.rnd() - 0.5) * 60 * S, vy: (this.rnd() - 0.5) * 60 * S, drag: 0.2, grav: 20 * S,
        life: 300 + this.rnd() * 200, from: 0.22 * S, to: 0.05 * S, alpha: 1, twinkle: 0.03, spin: 0.01,
      });
    }
    if (flying) this.drawTrail(ic, p.rot);
    ic.lastX = p.x; ic.lastY = p.y;
  }

  private drawTrail(ic: Icicle, rot: number): void {
    const { m } = ic;
    const L = this.look;
    const S = this.scale;
    const N = TRAIL_POINTS;
    const { px, py, nx, ny, hw } = this;
    // The trail starts at the icicle's BUTT (behind it), sampled back in time along the pure flight.
    const step = L.trailMs / (N - 1);
    const t0 = this.clock;
    const back = { x: Math.cos(rot), y: Math.sin(rot) };
    const off = m.len * 0.55;
    for (let j = 0; j < N; j++) {
      const q = trailPos(m, t0 - j * step);
      px[j] = q.x - back.x * off; py[j] = q.y - back.y * off;
    }
    let lx = 0, ly = 1;
    for (let j = 0; j < N; j++) {
      const a = Math.max(0, j - 1), b = Math.min(N - 1, j + 1);
      const tx = px[a]! - px[b]!, ty = py[a]! - py[b]!;
      const l = Math.hypot(tx, ty);
      if (l > 0.01) { lx = -ty / l; ly = tx / l; }
      nx[j] = lx; ny[j] = ly;
      hw[j] = L.trailWidth * S * 0.5 * Math.pow(1 - j / (N - 1), 0.7);
    }
    const born = clamp01((this.clock - m.launchAt) / 50);
    this.writeStrip(ic.trailGlow, N, 1.9, 0.55 * born * L.glow);
    this.writeStrip(ic.trailCore, N, 0.35, 0.85 * born);
    // Ice dust shed along the flight (a few glittering motes and tiny flakes that drift and twinkle out).
    const p = trailPos(m, t0);
    ic.dustAcc += Math.hypot(p.x - ic.lastX, p.y - ic.lastY);
    const every = (30 * S) / Math.max(0.05, L.dust);
    while (ic.dustAcc > every) {
      ic.dustAcc -= every;
      const k = this.rnd();
      const bx = p.x - back.x * off * (0.4 + k * 0.8), by = p.y - back.y * off * (0.4 + k * 0.8);
      const sp = (20 + this.rnd() * 50) * S, a = this.rnd() * Math.PI * 2;
      const flake = this.rnd() < 0.3;
      this.particle(flake ? 'rim' : 'hot', flake ? this.tex.flake : this.tex.star, this.rnd() < 0.5 ? this.colors.core : this.frostHot, {
        x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.12, grav: 30 * S,
        life: 420 + this.rnd() * 380, from: (flake ? 0.12 : 0.26) * (0.7 + this.rnd() * 0.6) * S, to: 0.04 * S, alpha: 0.95,
        twinkle: 0.025 + this.rnd() * 0.02, spin: (this.rnd() - 0.5) * 0.01,
      });
    }
  }

  /** The nova: the front's three crescent strips, the ice sheet behind it, snow, billows and ferns off the frozen ground. */
  private updateNova(dt: number): void {
    const nv = this.nova!;
    const m = nv.m;
    const S = this.scale;
    const L = this.look;
    const f = novaFront(m, Math.min(this.clock, m.contactAt));
    const dir = m.dir;
    const perp = { x: -dir.y, y: dir.x };
    const N = ARC_POINTS;
    const { px, py } = this;
    // The front fades as it breaks round the target; the sheet thaws after the shatter.
    let frontA = 1;
    if (nv.arriving >= 0) { nv.arriving += dt; frontA = 1 - clamp01(nv.arriving / 200); }
    const bornA = clamp01((this.clock - m.startAt) / 70);
    // The front edge: a crescent bulging ahead in the middle, billowing along its length as it rolls.
    const halfW = f.halfW * (nv.arriving >= 0 ? 1 + 0.4 * clamp01(nv.arriving / 200) : 1);
    for (let j = 0; j < N; j++) {
      const s = (j / (N - 1)) * 2 - 1;
      const bulge = m.bulge * halfW * (1 - s * s);
      const roll = halfW * 0.05 * Math.sin(s * 7 + this.clock * 0.024) + halfW * 0.03 * Math.sin(s * 13 - this.clock * 0.04);
      px[j] = f.x + dir.x * (bulge + roll) + perp.x * s * halfW;
      py[j] = f.y + dir.y * (bulge + roll) + perp.y * s * halfW;
    }
    const writeArc = (st: Strip, fwd: number, back: number, alpha: number): void => {
      const v = st.v;
      for (let j = 0; j < N; j++) {
        const s = (j / (N - 1)) * 2 - 1;
        const depth = m.depth * (0.3 + 0.7 * (1 - s * s));
        v[j * 4] = px[j]! + dir.x * fwd; v[j * 4 + 1] = py[j]! + dir.y * fwd;
        v[j * 4 + 2] = px[j]! - dir.x * depth * back; v[j * 4 + 3] = py[j]! - dir.y * depth * back;
      }
      st.mesh.alpha = Math.max(0, alpha);
    };
    writeArc(nv.body, 0, 1, 0.92 * frontA * bornA);
    writeArc(nv.glow, m.depth * 0.18, 1.25, 0.7 * frontA * bornA);
    const v = nv.edge.v;
    for (let j = 0; j < N; j++) {
      v[j * 4] = px[j]! + dir.x * 6 * S; v[j * 4 + 1] = py[j]! + dir.y * 6 * S;
      v[j * 4 + 2] = px[j]! - dir.x * 13 * S; v[j * 4 + 3] = py[j]! - dir.y * 13 * S;
    }
    nv.edge.mesh.alpha = frontA * bornA;

    // The ice sheet: from the hero to just behind the front (the points past it collapse onto it; the uvs stay put).
    const SN = SHEET_POINTS;
    const s0 = m.start * 0.55;
    const reach = Math.max(s0, f.along - m.depth * 0.25);
    const sv = nv.sheet.v;
    for (let j = 0; j < SN; j++) {
      const target = s0 + ((m.dist + m.ground * 0.4 - s0) * j) / (SN - 1);
      const along = Math.min(target, reach);
      const grown = clamp01((along - s0) / Math.max(1, m.ground * 1.2));
      const w = m.ground * (0.45 + 0.55 * grown) * (1 + 0.1 * Math.sin(j * 1.7) + 0.06 * Math.sin(j * 4.3));
      const cx = m.a.x + dir.x * along, cy = m.a.y + dir.y * along;
      sv[j * 4] = cx + perp.x * w; sv[j * 4 + 1] = cy + perp.y * w;
      sv[j * 4 + 2] = cx - perp.x * w; sv[j * 4 + 3] = cy - perp.y * w;
    }
    if (nv.fadeSheet >= 0) nv.fadeSheet += dt;
    const thaw = nv.fadeSheet >= 0 ? clamp01((nv.fadeSheet - 200) / Math.max(1, L.groundFadeMs)) : 0;
    nv.sheetAlpha = 0.62 * bornA * (1 - thaw);
    nv.sheet.mesh.alpha = nv.sheetAlpha;

    // Snow swirling in the front, and billows rolling off it (while it rolls).
    if (f.live) {
      const speed = Math.max(1, (f.along - nv.lastAlong) / Math.max(1, dt)) * 1000; // px/s
      nv.snowAcc += dt * 0.14 * L.snowDensity;
      while (nv.snowAcc >= 1) {
        nv.snowAcc -= 1;
        const s = this.rnd() * 2 - 1;
        const bulge = m.bulge * halfW * (1 - s * s);
        const x = f.x + dir.x * bulge * (0.4 + 0.6 * this.rnd()) + perp.x * s * halfW;
        const y = f.y + dir.y * bulge * (0.4 + 0.6 * this.rnd()) + perp.y * s * halfW;
        const lag = 0.35 + this.rnd() * 0.5;
        const sw = (this.rnd() - 0.5) * 260 * S;
        const flake = this.rnd() < 0.55;
        this.particle(flake ? 'rim' : 'hot', flake ? this.tex.flake : this.tex.star, this.rnd() < 0.5 ? this.colors.core : this.frostHot, {
          x, y, vx: dir.x * speed * lag + perp.x * sw, vy: dir.y * speed * lag + perp.y * sw, drag: 0.03, grav: 0,
          life: 380 + this.rnd() * 420, from: (flake ? 0.2 + this.rnd() * 0.22 : 0.3 + this.rnd() * 0.3) * S, to: 0.06 * S, alpha: 1,
          twinkle: flake ? 0 : 0.03, spin: (this.rnd() - 0.5) * 0.03,
        });
      }
      nv.puffAcc += dt * 0.045 * L.snowPuffs;
      while (nv.puffAcc >= 1) {
        nv.puffAcc -= 1;
        const s = this.rnd() * 1.8 - 0.9;
        const x = f.x + perp.x * s * halfW, y = f.y + perp.y * s * halfW;
        const lag = 0.25 + this.rnd() * 0.35;
        this.particle('mist', this.tex.puff, this.rnd() < 0.5 ? this.colors.core : whiten(this.colors.ice, 0.5), {
          x, y, vx: dir.x * speed * lag + perp.x * s * 60 * S, vy: dir.y * speed * lag + perp.y * s * 60 * S - 20 * S, drag: 0.05, grav: -30 * S,
          life: 520 + this.rnd() * 300, from: (halfW / 96) * 0.35, to: (halfW / 96) * (0.6 + this.rnd() * 0.3), alpha: 0.5, twinkle: 0, spin: (this.rnd() - 0.5) * 0.003,
        });
      }
      // Frost ferns growing off the frozen ground's edges as the front passes.
      const every = (m.dist - m.start) / Math.max(1, L.groundFerns);
      while (L.groundFerns > 0 && nv.fernNext < f.along - m.depth * 0.3) {
        const along = nv.fernNext;
        nv.fernNext += every * (0.7 + this.rnd() * 0.6);
        const side = (nv.fernSide = -nv.fernSide);
        const grown = clamp01((along - s0) / Math.max(1, m.ground * 1.2));
        const w = m.ground * (0.45 + 0.55 * grown) * 0.8;
        const x = m.a.x + dir.x * along + perp.x * w * side, y = m.a.y + dir.y * along + perp.y * w * side;
        const rot = Math.atan2(perp.y * side, perp.x * side) + (this.rnd() - 0.5) * 0.9 + (this.rnd() < 0.5 ? 0.4 : -0.4) * side;
        const hold = Math.max(200, m.contactAt - this.clock) + 700;
        this.fern(x, y, rot, m.ground * (0.3 + this.rnd() * 0.4), { grow: 380, delay: 0, hold, fade: L.groundFadeMs * 0.8, alpha: 0.6 + this.rnd() * 0.2, tint: whiten(this.colors.ice, 0.5), layer: 'ground' });
        // A glint where the frost bites.
        this.fxs('hot', this.tex.star, this.colors.core, x, y, { dur: 300, from: 0.2, to: 0.5, a0: 0.9, mode: 'punch', peakAt: 0.25 }, this.rnd());
      }
    }
    nv.lastAlong = f.along;
    if (nv.arriving >= 200 && thaw >= 1) {
      for (const st of [nv.body, nv.glow, nv.edge, nv.sheet]) this.giveStrip(st);
      this.nova = null;
    } else if (nv.arriving >= 200) {
      for (const st of [nv.body, nv.glow, nv.edge]) st.mesh.alpha = 0;
    }
  }

  private writeStrip(st: Strip | null, n: number, mult: number, alpha: number): void {
    if (!st) return;
    const { px, py, nx, ny, hw } = this;
    const v = st.v;
    for (let j = 0; j < n; j++) {
      const h = hw[j]! * mult;
      v[j * 4] = px[j]! + nx[j]! * h; v[j * 4 + 1] = py[j]! + ny[j]! * h;
      v[j * 4 + 2] = px[j]! - nx[j]! * h; v[j * 4 + 3] = py[j]! - ny[j]! * h;
    }
    st.mesh.alpha = Math.max(0, alpha);
  }

  private dropIcicle(ic: Icicle): void {
    for (const s of [ic.glow, ic.body, ic.core, ic.rim, ic.spec, ic.flare]) this.giveS(s);
    this.giveStrip(ic.trailGlow); this.giveStrip(ic.trailCore);
    ic.trailGlow = null; ic.trailCore = null;
    ic.state = 'gone';
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const ic of this.icicles) if (ic.state !== 'gone') this.dropIcicle(ic);
    for (const q of this.fx) this.giveS(q.s);
    for (const p of this.particles) this.giveS(p.s);
    for (const f of this.ferns) this.giveS(f.s);
    for (const s of this.warm) this.giveS(s);
    if (this.charge) for (const s of [this.charge.rune, this.charge.core, this.charge.bloom, this.charge.ring]) this.giveS(s);
    if (this.novaCharge) for (const s of [this.novaCharge.rune, this.novaCharge.inner, this.novaCharge.core, this.novaCharge.bloom]) this.giveS(s);
    if (this.nova) for (const st of [this.nova.body, this.nova.glow, this.nova.edge, this.nova.sheet]) this.giveStrip(st);
    if (this.encase) for (const s of [this.encase.shell, this.encase.cracks, this.encase.glint]) this.giveS(s);
    if (this.rime) this.giveS(this.rime.s);
    this.icicles = []; this.fx = []; this.particles = []; this.ferns = []; this.warm = [];
    this.charge = null; this.novaCharge = null; this.nova = null; this.encase = null; this.rime = null;
  }

  /** Tear down: every sprite and mesh destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((ch) => ch.destroy());
    }
    this.freeMeshes.clear();
    this.root.removeChildren().forEach((ch) => ch.destroy());
    this.root.destroy();
  }
}

