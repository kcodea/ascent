/**
 * THE FOURTH WALL SCENE: everything the attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroGlass.ts` mounts `root` on the above-portrait overlay (a fixed full-screen
 * canvas over the whole game view), hands it the blow's cracks and shards once, and each frame tells it how far the
 * cracks have grown (`growCracks`) and where the cause's own lights are (the beam, the bolt, the tear's heads).
 *
 * THE SCREEN IS THE GLASS, AND IT DOES NOT MOVE WITH THE CAMERA. The overlay canvas rides the stage camera (it sits in
 * `#stage`), so every layer of this scene is counter-transformed each frame (`fixGlass`): the cracks, the shards and the
 * sparks on them stay nailed to the screen while the game zooms and shakes behind them. `root` itself is never touched
 * (it is the camera mirror's). A point that belongs to the WORLD (the striker's hand) goes through `toGlass`.
 *
 * What sells it:
 *  - THE CRACKS: one stretched sprite per crack piece (a bright thread over a dark line; Tier 4's tear a heavier texture
 *    with an open gap), made once per blow, hidden, and grown from its near end by scaling along its length. Nothing is
 *    repainted; a grown crack costs nothing per frame.
 *  - THE CHIPS: the star-shaped pit where the glass was struck.
 *  - THE CAUSES' LIGHTS: ripples (the knock), standing rings (the hum), a rolling ring of force (the shockwave), a thin
 *    beam and its glowing hot spot, a bolt with a tail (the ricochet), the tear's two bright heads. All sprites.
 *  - THE SHARDS: the cracked cells themselves, as a few small meshes (sixteen shards each, so they batch with the
 *    sprites and need no shader of their own). A shard is its triangle plus an inset copy: the band between them is its
 *    bright cut RIM, the middle its pale see-through FACE (the `shard` lookup texture). On the break each one JUMPS AT
 *    THE VIEWER (it swells and spreads from the middle of the screen), tumbles (a spin, an edge-on flip), flashes as it
 *    turns face-on, and falls under gravity. The vertex and UV arrays are rewritten in place every frame: no allocation.
 * Behind the shards there is nothing of ours: the game is simply there.
 *
 * THE GLASS IS ALIVE (third pass, owner: "overall quite boring"):
 *  - ENERGY: every crack has a soft additive line of light under it (`glowLayer`); the runner pulses the whole layer's
 *    opacity (one number per frame), slow on a chip, racing through Tier 4's held beat, blazing on the inhale.
 *  - GLINTS: a few points of prismatic light RUN ALONG the grown cracks, hopping from one piece to the next where they
 *    meet (`setRunners`); each cycles through the rainbow as it goes.
 *  - PRISM: where the glass cracks or the tear forks, the light splits into a rainbow flare (`prism`).
 *  - THE GLARE: a sheen sweeps across the whole screen as the attack starts: there IS a pane of glass here.
 *  - THE GHOST: the striker's own portrait shows faintly in the glass over the target while the cause plays (its
 *    reflection), and splits apart with the crack.
 *  - THE FOG: the struck hero presses its face to the glass and fogs it; THE INHALE darkens the screen before Tier 4's
 *    shatter.
 *
 * Perf: at most `GLASS_CAPS.cracks` crack sprites and `GLASS_CAPS.shards` shards, all built during the damage formation
 * (never on a hot beat); pooled fire-and-forget sprites under a hard cap; no filters, no per-frame painting.
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import { mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool, type FxLayer } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA } from '../heroAttack/knockout';
import { GLASS_CAPS, type Box, type CrackSeg, type ShardTri } from './heroGlassConfig';
import { CHIP_PX, CRACK_W, GHOST_PX, GLINT_W, LINE_H, LINE_W, TEAR_W, WASH_PX } from './heroGlassTextures';

export interface HeroGlassTextures {
  glow: Texture; ring: Texture; star: Texture; spark: Texture; streak: Texture;
  /** One fracture line, along +x (a bright thread over a dark line). */
  crack: Texture;
  /** Tier 4's bold tear, along +x (an open gap between two bright lips). */
  tear: Texture;
  /** The star-shaped pit where the glass was struck. */
  chip: Texture;
  /** The shard lookup: u = rim to face, v = resting to flashing. */
  shard: Texture;
  sliver: Texture;
  glint: Texture;
  wash: Texture;
  /** A soft line of light along +x (the energy glow under a crack). */
  line: Texture;
}

export interface GlassColors { glass: number; edge: number; shade: number; flash: number; heat: number; side: number; energy?: number }

export interface GlassLook {
  /** Shard gravity (px/s^2), outward burst (px/s), tumble (radians/s) and rim width (px), all at stage scale 1. */
  gravity: number;
  burst: number;
  spin: number;
  rim: number;
  /** Tier 4: how far the shards jump toward the viewer (extra scale), and how many motes of dust sparkle after. */
  lunge: number;
  dust: number;
  impactSize: number;
  splitAlpha: number;
  /** How strong the prismatic flares are (0 = none). */
  prism?: number;
}

/** The rainbow a crack splits light into (soft, not neon): cyan, rose, gold, mint, violet. */
export const PRISM = [0x7fe9ff, 0xff8ad8, 0xffe27a, 0x9cffb0, 0xb59cff] as const;

/** A point of light running along the cracks. */
interface Runner { s: Sprite; h: Sprite; seg: number; u: number; hue: number; x: number; y: number; trail: number }

/** A hue (0..1, wrapping) of the soft prism as a colour; allocation-free. */
function prismAt(h: number): number {
  const n = PRISM.length;
  const f = (((h % 1) + 1) % 1) * n;
  const i = Math.floor(f);
  const a = PRISM[i % n]!, b = PRISM[(i + 1) % n]!, k = f - i;
  const ch = (sh: number): number => { const va = (a >> sh) & 0xff, vb = (b >> sh) & 0xff; return Math.round(va + (vb - va) * k) & 0xff; };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Hard cap on pooled fire-and-forget sprites alive at once (the cracks, chips and shards are counted separately). */
export const MAX_GLASS_SPRITES = 760;
/** At most this many glints run along the cracks at once. */
export const MAX_RUNNERS = 16;
/** Shards per mesh: 16 x 6 vertices = 96, under Pixi's 100-vertex batch limit, so every mesh batches. */
export const SHARDS_PER_MESH = 16;
/** A crack this heavy (Tier 4's tear and its forks' first pieces) draws with the tear texture. */
export const BOLD_W = 1.9;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
const VERTS = 6;
/** A shard still on screen this long after the break is dropped (it never happens with the default gravity). */
const SHARD_MAX_MS = 2600;
/** The jump at the viewer takes about this long (seconds of attack time: the slow-mo dip stretches it). */
const LUNGE_TAU = 0.085;

type ShardMode = 'pane' | 'shatter';

interface Shard {
  cx: number; cy: number;
  /** Outer and inner corners, relative to the centre (x0, y0, ... x5, y5). */
  lx: Float32Array;
  delay: number; vx: number; vy: number; spin: number; flip: number; phase: number; cosA: number; sinA: number; grow: number; base: number; reach: number;
  /** The jump at the viewer: extra scale, and the spread from the middle of the screen that goes with it. */
  pop: number; ex: number; ey: number;
  mesh: MeshSimple; at: number; uv: Float32Array;
  gone: boolean;
}

export class HeroGlassScene extends FxPool {
  /** Our own layer, between the pool's `body` and `core` layers: the offset tints, the hole, the cracks, the chips, the shards. */
  private pane: Container | null;
  private readonly marks: Container;
  private readonly crackLayer: Container;
  private readonly glowLayer: Container;
  private readonly shardLayer: Container;
  private cracks: Sprite[] = [];
  private glows: Sprite[] = [];
  /** The indices of the cracks that are whole, in the order they finished (the glints run on these). */
  private whole: Int32Array = new Int32Array(0);
  private wholeN = 0;
  private runners: Runner[] = [];
  private runnerSpeed = 0.8;
  private runnerA = 0;
  private activeRunners = 0;
  private ghostS: Sprite | null = null;
  private darkS: Sprite | null = null;
  private segs: readonly CrackSeg[] = [];
  private grown: Uint8Array = new Uint8Array(0);
  private firstOpen = 0;
  private chips: Sprite[] = [];
  /** The causes' own lights: taken from the pool on first use, hidden when off, given back on a clear. */
  private lights = new Map<string, Sprite>();
  private frostS: Sprite | null = null;
  private shards: Shard[] = [];
  private meshes: MeshSimple[] = [];
  private hole: MeshSimple | null = null;
  private split: [Sprite, Sprite] | null = null;
  private shardT = -1;
  private shardsLeft = 0;
  private warmMs = 400;
  private area: Box = { x: 0, y: 0, w: 1920, h: 1080 };
  private gx = 0;
  private gy = 0;
  private gz = 1;
  private tx = 0;
  private ty = 0;

  constructor(private readonly tex: HeroGlassTextures, private readonly colors: GlassColors, private readonly look: GlassLook, scale = 1, seed = 1) {
    super('heroGlass', [tex.glow, tex.ring, tex.star, tex.spark, tex.streak, tex.crack, tex.tear, tex.chip, tex.shard, tex.sliver, tex.glint, tex.wash, tex.line], scale, seed, MAX_GLASS_SPRITES);
    this.pane = new Container();
    this.pane.label = 'heroGlass-pane';
    this.shardLayer = new Container();
    this.marks = new Container();
    this.crackLayer = new Container();
    // The energy glow sits UNDER the crack lines (additive), inside `marks` so it heals with them.
    this.glowLayer = new Container();
    this.glowLayer.alpha = 0; this.glowLayer.visible = false;
    this.marks.addChild(this.glowLayer, this.crackLayer);
    this.pane.addChild(this.shardLayer, this.marks);
    // Above the pool's under / glow / body layers, below its additive `core` (the glints sparkle over the glass).
    this.root.addChildAt(this.pane, 3);
  }

  get liveCracks(): number { let n = 0; for (const s of this.cracks) if (s.visible) n++; return n; }
  get crackCount(): number { return this.cracks.length; }
  get chipCount(): number { let n = 0; for (const s of this.chips) if (s.visible) n++; return n; }
  get shardCount(): number { return this.shards.length; }
  /** Shards still falling (0 before the break and once the last has left the screen). */
  get shardsFalling(): number { return this.shardT >= 0 ? this.shardsLeft : 0; }
  get marksAlpha(): number { return this.marks.alpha; }
  get holeAlpha(): number { return this.hole && this.hole.visible ? this.hole.alpha : 0; }
  /** The causes' lights showing right now (the beam, the bolt, the tear's heads, the tension wash). */
  get lightsOn(): number { let n = 0; for (const s of this.lights.values()) if (s.visible) n++; return n; }
  /** Glints running along the cracks right now. */
  get runnersOn(): number { let n = 0; for (const r of this.runners) if (r.s.visible) n++; return n; }
  /** How brightly the cracks glow (0 = not at all). */
  get glowAlpha(): number { return this.glowLayer.visible ? this.glowLayer.alpha : 0; }
  get ghostAlpha(): number { return this.ghostS && this.ghostS.visible ? this.ghostS.alpha : 0; }
  get darkAlpha(): number { return this.darkS && this.darkS.visible ? this.darkS.alpha : 0; }
  get frostAlpha(): number { return this.frostS && this.frostS.visible ? this.frostS.alpha * this.marks.alpha : 0; }
  /** Where the glass layers sit inside `root` (the inverse of the camera, plus the tremble): [x, y, scale]. */
  get glassFix(): [number, number, number] { return [this.pane?.position.x ?? 0, this.pane?.position.y ?? 0, this.pane?.scale.x ?? 1]; }

  /** The screen (the flash, the split tints and the shards' fall are measured against it). */
  setArea(area: Box): void { this.area = area; }

  // ── the glass stays on the screen ──────────────────────────────────────────────────────────────────────────

  /**
   * NAIL THE GLASS TO THE SCREEN: the camera this frame is `translate(ax, ay) scale(z)` (on the DOM camera the canvas
   * rides, or mirrored onto `root`); every layer gets its inverse, so what is drawn on the glass does not move with it.
   */
  fixGlass(ax: number, ay: number, z: number): void {
    this.gx = Number.isFinite(ax) ? ax : 0; this.gy = Number.isFinite(ay) ? ay : 0; this.gz = Number.isFinite(z) && z > 0.01 ? z : 1;
    this.applyGlass();
  }

  /** The glass trembles (Tier 4's held beat): a small offset of every layer, on top of the fix. */
  setTremble(dx: number, dy: number): void {
    if (dx === this.tx && dy === this.ty) return;
    this.tx = dx; this.ty = dy;
    this.applyGlass();
  }

  private applyGlass(): void {
    if (this.destroyed) return;
    const inv = 1 / this.gz;
    const x = -this.gx * inv + this.tx, y = -this.gy * inv + this.ty;
    for (const ch of this.root.children) { ch.position.set(x, y); ch.scale.set(inv); }
  }

  /** A WORLD point (it rides the camera: a portrait) as a point on the glass, this frame. */
  toGlass(p: Pt): Pt { return { x: this.gx + this.gz * p.x, y: this.gy + this.gz * p.y }; }

  // ── the cracks ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Hand over the blow's cracks (sorted by start time): one hidden sprite each, made now, during the formation. */
  setCracks(segs: readonly CrackSeg[]): void {
    if (this.destroyed || !this.pane) return;
    const n = Math.min(segs.length, GLASS_CAPS.cracks);
    this.segs = segs;
    this.grown = new Uint8Array(n);
    this.whole = new Int32Array(n);
    this.wholeN = 0;
    this.firstOpen = 0;
    const energy = this.colors.energy ?? this.colors.glass;
    for (let i = 0; i < n; i++) {
      const g = segs[i]!;
      const bold = g.w >= BOLD_W;
      const s = new Sprite(bold ? this.tex.tear : this.tex.crack);
      s.anchor.set(0, 0.5);
      s.position.set(g.ax, g.ay);
      s.rotation = g.ang;
      s.scale.set(0, bold ? g.w * this.scale * 0.62 : g.w * this.scale * 2);
      s.tint = this.colors.edge;
      s.visible = false;
      this.crackLayer.addChild(s);
      this.cracks.push(s);
      // Its energy glow: a soft band of light a few times the crack's weight, grown with it.
      const e = new Sprite(this.tex.line);
      e.anchor.set(0, 0.5);
      e.blendMode = 'add';
      e.position.set(g.ax, g.ay);
      e.rotation = g.ang;
      e.scale.set(0, ((bold ? 52 : 26) * Math.min(2.4, Math.max(0.6, g.w)) * this.scale) / LINE_H);
      e.tint = bold ? whiten(energy, 0.35) : energy;
      e.visible = false;
      this.glowLayer.addChild(e);
      this.glows.push(e);
    }
  }

  /** How brightly the cracks glow with energy (0 hides the glow; the runner pulses it). */
  setGlow(a: number): void {
    if (this.destroyed || !this.pane) return;
    const on = a > 0.004;
    this.glowLayer.visible = on;
    this.glowLayer.alpha = on ? Math.min(1, a) : 0;
  }

  /**
   * Grow the cracks to sequence time `t` (each from its near end, over its own window). Once a crack is whole it is
   * never touched again, and the loop starts past the whole ones: a finished web costs nothing per frame.
   */
  growCracks(t: number): void {
    const n = this.cracks.length;
    let i = this.firstOpen;
    while (i < n && this.grown[i]) i++;
    this.firstOpen = i;
    for (; i < n; i++) {
      if (this.grown[i]) continue;
      const g = this.segs[i]!;
      if (t < g.t0) break; // sorted by start: nothing later has started either
      const u = g.t1 > g.t0 ? Math.min(1, (t - g.t0) / (g.t1 - g.t0)) : 1;
      const s = this.cracks[i]!;
      s.visible = true;
      s.scale.x = (g.len * u) / (g.w >= BOLD_W ? TEAR_W : CRACK_W);
      const e = this.glows[i];
      if (e) { e.visible = true; e.scale.x = (g.len * u) / LINE_W; }
      if (u >= 1) {
        this.grown[i] = 1;
        this.whole[this.wholeN++] = i;
        // A refraction glint where every few cracks stop, split into the prism (picked by index: a replay glints the same).
        if ((i * 7919) % 6 === 0) this.spawn('core', this.tex.star, prismAt(i * 0.37), g.bx, g.by, { dur: 300, from: 0.14, to: 0.5, a0: 1, mode: 'punch', peakAt: 0.25, rot: 0.4 });
      }
    }
  }

  /** The cracks and chips fade together (the glass heals); 0 hides them. */
  setMarksAlpha(a: number): void {
    if (this.destroyed || !this.pane) return;
    const on = a > 0.004;
    this.marks.visible = on;
    this.marks.alpha = on ? Math.min(1, a) : 0;
  }

  /** The star-shaped pit where the glass was struck (`px`: its width on screen). */
  chip(at: Pt, px: number): void {
    if (this.destroyed || !this.pane) return;
    const s = new Sprite(this.tex.chip);
    s.anchor.set(0.5);
    s.position.set(at.x, at.y);
    s.scale.set(px / CHIP_PX);
    s.rotation = this.rnd() * Math.PI * 2;
    s.tint = whiten(this.colors.glass, 0.6);
    this.marks.addChild(s);
    this.chips.push(s);
  }

  /** `shock`: the haze the craze sits in (made now, hidden; `showFrost` fades it in; it heals with the cracks). */
  setFrost(at: Pt, r: number): void {
    if (this.destroyed || !this.pane || this.frostS) return;
    const s = new Sprite(this.tex.glow);
    s.anchor.set(0.5);
    s.position.set(at.x, at.y);
    s.scale.set((r * 2.5) / GLOW_PX);
    s.tint = whiten(this.colors.glass, 0.7);
    s.alpha = 0; s.visible = false;
    this.marks.addChildAt(s, 0);
    this.frostS = s;
  }

  showFrost(a: number): void {
    if (!this.frostS) return;
    this.frostS.visible = a > 0.004;
    this.frostS.alpha = a;
  }

  // ── the causes' lights (persistent sprites, moved per frame) ───────────────────────────────────────────────

  /** A named light from the pool (made on first use); null when the pool is full. */
  private light(id: string, layer: FxLayer, t: Texture, tint: number): Sprite | null {
    let s = this.lights.get(id) ?? null;
    if (!s) {
      s = this.take(layer, t, tint);
      if (!s) return null;
      this.lights.set(id, s);
    }
    return s;
  }

  private lightOff(id: string): void { const s = this.lights.get(id); if (s) s.visible = false; }

  /**
   * `beam`: the thin line of light from `from` to `to` (glass points) at opacity `a`, and the spot it heats (`heat`
   * 0..1: it swells and goes from the heat colour to white). `a` 0 hides all of it.
   */
  setBeam(from: Pt, to: Pt, a: number, heat: number): void {
    if (this.destroyed) return;
    if (a <= 0.004) { for (const id of ['beamGlow', 'beamCore', 'hot', 'hotHalo']) this.lightOff(id); return; }
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1, rot = Math.atan2(dy, dx);
    const S = this.scale;
    const g = this.light('beamGlow', 'glow', this.tex.glint, this.colors.heat), k = this.light('beamCore', 'core', this.tex.wash, 0xffffff);
    if (g) { g.visible = true; g.position.set((from.x + to.x) / 2, (from.y + to.y) / 2); g.rotation = rot; g.scale.set((len * 1.15) / GLINT_W, 7 * S * (0.7 + 0.6 * heat)); g.alpha = 0.95 * a; }
    if (k) { k.visible = true; k.position.set((from.x + to.x) / 2, (from.y + to.y) / 2); k.rotation = rot; k.scale.set(len / WASH_PX, ((4 + 4 * heat) * S) / WASH_PX); k.alpha = 0.95 * a; }
    const h = this.light('hot', 'core', this.tex.glow, mixColor(this.colors.heat, 0xffffff, heat * heat)), halo = this.light('hotHalo', 'glow', this.tex.glow, this.colors.heat);
    if (h) { h.visible = true; h.tint = mixColor(this.colors.heat, 0xffffff, heat * heat); h.position.set(to.x, to.y); h.scale.set(((26 + 70 * heat) * S * this.look.impactSize) / GLOW_PX); h.alpha = Math.min(1, 0.5 + 0.6 * heat) * a; }
    if (halo) { halo.visible = true; halo.position.set(to.x, to.y); halo.scale.set(((70 + 190 * heat) * S * this.look.impactSize) / GLOW_PX); halo.alpha = (0.25 + 0.45 * heat) * a; }
  }

  /** `ricochet`: the bolt, a hard point of light with a tail, at `p` heading along `ang`. */
  setBolt(p: Pt, ang: number, on: boolean): void {
    if (this.destroyed) return;
    if (!on) { for (const id of ['boltGlow', 'boltStar', 'boltTail']) this.lightOff(id); return; }
    const S = this.scale;
    const g = this.light('boltGlow', 'glow', this.tex.glow, this.colors.glass), st = this.light('boltStar', 'core', this.tex.star, 0xffffff), tl = this.light('boltTail', 'core', this.tex.glint, whiten(this.colors.glass, 0.6));
    if (g) { g.visible = true; g.position.set(p.x, p.y); g.scale.set((110 * S) / GLOW_PX); g.alpha = 0.9; }
    if (st) { st.visible = true; st.position.set(p.x, p.y); st.scale.set((84 * S) / STAR_PX); st.rotation = ang; st.alpha = 1; }
    if (tl) { tl.visible = true; tl.position.set(p.x - Math.cos(ang) * 95 * S, p.y - Math.sin(ang) * 95 * S); tl.rotation = ang; tl.scale.set((230 * S) / GLINT_W, 1.5 * S); tl.alpha = 0.9; }
  }

  /** Tier 4: one of the tear's two bright heads at `p` (`spin` turns its star). */
  setTearHead(i: 0 | 1, p: Pt, on: boolean, spin = 0): void {
    if (this.destroyed) return;
    if (!on) { this.lightOff(`headG${i}`); this.lightOff(`headS${i}`); return; }
    const S = this.scale;
    const g = this.light(`headG${i}`, 'glow', this.tex.glow, whiten(this.colors.flash, 0.4)), st = this.light(`headS${i}`, 'core', this.tex.star, 0xffffff);
    if (g) { g.visible = true; g.position.set(p.x, p.y); g.scale.set((230 * S * this.look.impactSize) / GLOW_PX); g.alpha = 0.85; }
    if (st) { st.visible = true; st.position.set(p.x, p.y); st.scale.set((150 * S * this.look.impactSize) / STAR_PX); st.rotation = spin; st.alpha = 1; }
  }

  /** Tier 4: the held beat's tension, a cold light rising over the whole pane (`a` 0 hides it). */
  setTension(a: number): void {
    if (this.destroyed) return;
    if (a <= 0.003) { this.lightOff('tension'); return; }
    const s = this.light('tension', 'glow', this.tex.wash, this.colors.flash);
    if (!s) return;
    const b = this.area;
    s.visible = true; s.position.set(b.x + b.w / 2, b.y + b.h / 2); s.scale.set((b.w * 1.1) / WASH_PX, (b.h * 1.1) / WASH_PX); s.alpha = a;
  }

  // ── the glints that run along the cracks ───────────────────────────────────────────────────────────────────

  /**
   * `n` points of prismatic light run along the whole cracks at `speed` px per ms (each hops onto a piece that starts
   * where its last one ended, so it follows a fracture), at opacity `a`. `n` 0 hides them all.
   */
  setRunners(n: number, speed: number, a = 1): void {
    if (this.destroyed) return;
    const want = Math.max(0, Math.min(MAX_RUNNERS, Math.round(n)));
    this.runnerSpeed = Math.max(0.05, speed);
    this.runnerA = a;
    while (this.runners.length < want) {
      const st = this.take('core', this.tex.star, 0xffffff), h = this.take('glow', this.tex.glow, 0xffffff);
      if (!st || !h) { this.give(st); this.give(h); break; }
      st.visible = false; h.visible = false;
      this.runners.push({ s: st, h, seg: -1, u: 0, hue: this.runners.length * 0.27, x: 0, y: 0, trail: 0 });
    }
    for (let i = 0; i < this.runners.length; i++) if (i >= want) { this.runners[i]!.s.visible = false; this.runners[i]!.h.visible = false; this.runners[i]!.seg = -1; }
    this.activeRunners = want;
  }

  /** A whole crack for a glint to run on next: one that starts where it is (a fracture), else any. -1 if none yet. */
  private nextSeg(x: number, y: number, from: number): number {
    if (this.wholeN <= 0) return -1;
    const tries = Math.min(this.wholeN, 48);
    const start = Math.floor(this.rnd() * this.wholeN);
    if (from >= 0) {
      for (let k = 0; k < tries; k++) {
        const j = this.whole[(start + k) % this.wholeN]!;
        const g = this.segs[j]!;
        if (j !== from && Math.abs(g.ax - x) + Math.abs(g.ay - y) < 4) return j;
      }
    }
    return this.whole[start]!;
  }

  private tickRunners(dt: number): boolean {
    let on = false;
    const S = this.scale;
    const ma = this.marks.visible ? this.marks.alpha : 0;
    for (let i = 0; i < this.activeRunners && i < this.runners.length; i++) {
      const r = this.runners[i]!;
      if (r.seg < 0 || r.u >= 1) {
        const j = this.nextSeg(r.x, r.y, r.seg);
        if (j < 0) { r.s.visible = false; r.h.visible = false; continue; }
        r.seg = j; r.u = 0;
      }
      const g = this.segs[r.seg]!;
      r.u = Math.min(1, r.u + (dt * this.runnerSpeed) / Math.max(4, g.len));
      r.x = g.ax + (g.bx - g.ax) * r.u; r.y = g.ay + (g.by - g.ay) * r.u;
      r.hue += dt * 0.0011;
      const tint = prismAt(r.hue);
      const tw = 0.75 + 0.25 * Math.sin(r.hue * 40);
      const a = Math.min(1, this.runnerA * ma);
      r.s.visible = r.h.visible = a > 0.01;
      if (!r.s.visible) continue;
      r.s.position.set(r.x, r.y); r.s.rotation = g.ang; r.s.tint = tint; r.s.scale.set(1.05 * S * tw, 0.62 * S * tw); r.s.alpha = a;
      r.h.position.set(r.x, r.y); r.h.tint = tint; r.h.scale.set((96 * S) / 128); r.h.alpha = 0.85 * a;
      // A short comet tail of light behind it.
      r.trail -= dt;
      if (r.trail <= 0) { r.trail = 45; this.spawn('core', this.tex.glow, tint, r.x, r.y, { dur: 260, from: 0.32, to: 0.06, a0: 0.7 * a, ease: 'linear' }); }
      on = true;
    }
    return on;
  }

  // ── the prism, the glare, the ghost, the fog, the inhale ───────────────────────────────────────────────────

  /**
   * THE PRISM: where the glass cracks the light splits into a rainbow: three long thin streaks (cyan, rose, gold) a hair
   * apart across the line of the blow, a ring of colours, and a scatter of coloured glints thrown off it.
   */
  prism(at: Pt, ang: number, size: number): void {
    const k = this.look.prism ?? 1;
    if (k <= 0) return;
    const T = size * this.look.impactSize;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 5 * T;
      this.spawn('core', this.tex.glint, PRISM[i]!, at.x + nx * off, at.y + ny * off, {
        dur: 420, from: (520 * T) / GLINT_W, to: (760 * T) / GLINT_W, sy: 0.32, a0: 0.75 * Math.min(1.3, k), mode: 'punch', peakAt: 0.12, ease: 'cubic', rot: ang + 0.2 * (i - 1),
      });
    }
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.ring, PRISM[i]!, at.x, at.y, { dur: 460 + i * 60, from: (30 * T) / 160, to: ((150 + 40 * i) * T) / 160, a0: 0.55 * Math.min(1.3, k), ease: 'cubic', delay: i * 30 });
    }
    for (let i = 0; i < Math.round(5 + 3 * T); i++) {
      const a = this.rnd() * Math.PI * 2, sp = 180 + this.rnd() * 380 * T;
      this.spawn('core', this.tex.star, PRISM[i % PRISM.length]!, at.x, at.y, {
        dur: 380 + this.rnd() * 300, from: 0.16, to: 0.42 + 0.3 * this.rnd(), a0: 1, mode: 'punch', peakAt: 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.08, rot: a,
      });
    }
  }

  /**
   * THE GLARE: a sheen of light sweeps across the whole screen (a wide soft band and a thin bright one behind it), the
   * way light slides over a window. Says: there is a pane of glass here. `k` its strength.
   */
  glare(k: number): void {
    const b = this.area;
    const S = this.scale;
    const diag = Math.hypot(b.w, b.h);
    const rot = -1.05;
    const travel = b.w * 1.5;
    for (let i = 0; i < 2; i++) {
      const L = diag * 1.2, T = i === 0 ? 260 : 40;
      const from = L / GLINT_W / S;
      this.spawn('glow', this.tex.glint, i === 0 ? this.colors.flash : 0xffffff, b.x - b.w * 0.25 - i * 90, b.y + b.h / 2, {
        dur: 620, from, to: from, sy: (T / 8) / (L / GLINT_W), a0: (i === 0 ? 0.16 : 0.34) * k, mode: 'punch', peakAt: 0.45, ease: 'linear', rot,
        vx: travel / 0.62 / S, drag: 1, delay: i * 70,
      });
    }
  }

  /** The striker's reflection (its own portrait art; null skips it). Built once, hidden. */
  setGhost(t: Texture | null): void {
    if (this.destroyed || !this.pane || !t || this.ghostS) return;
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = whiten(this.colors.glass, 0.2);
    s.visible = false; s.alpha = 0;
    this.pane.addChild(s);
    this.ghostS = s;
  }

  /** Show the reflection at `at`, `r` px its radius, opacity `a`. 0 hides it. */
  showGhost(at: Pt, r: number, a: number): void {
    const s = this.ghostS;
    if (!s || this.destroyed) return;
    s.visible = a > 0.004;
    if (!s.visible) return;
    s.position.set(at.x, at.y);
    const k = (r * 2) / GHOST_PX;
    s.scale.set(k);
    s.alpha = Math.min(1, a);
  }

  /** The reflection SPLITS with the crack: two coloured copies fly apart and fade. */
  ghostBreak(at: Pt, r: number): void {
    const s = this.ghostS;
    if (!s || !s.visible) return;
    const k = (r * 2) / GHOST_PX / this.scale;
    const a0 = Math.min(1, s.alpha * 1.6);
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', s.texture, PRISM[i]!, at.x, at.y, { dur: 360, from: k, to: k * 1.25, a0, ease: 'cubic', vx: (i ? 1 : -1) * 260, drag: 0.05 });
    }
    s.visible = false;
  }

  /**
   * THE FOG: the struck hero presses its face to the glass and its breath fogs it: a pale disc that blooms and lingers
   * `ms`, a brighter heart, and a few droplets that run down.
   */
  fog(at: Pt, r: number, ms: number, k = 1): void {
    const S = this.scale;
    const c = whiten(this.colors.glass, 0.75);
    this.spawn('body', this.tex.glow, c, at.x, at.y + r * 0.15, { dur: ms, from: (r * 1.6) / 128 / S, to: (r * 2.5) / 128 / S, sy: 0.82, a0: 0.34 * k, mode: 'hold', ease: 'cubic' });
    this.spawn('body', this.tex.glow, 0xffffff, at.x, at.y + r * 0.25, { dur: ms * 0.8, from: (r * 0.7) / 128 / S, to: (r * 1.3) / 128 / S, sy: 0.6, a0: 0.22 * k, mode: 'hold', ease: 'cubic', delay: 60 });
    for (let i = 0; i < 3; i++) {
      const x = at.x + (this.rnd() - 0.5) * r * 1.4;
      this.spawn('core', this.tex.spark, whiten(this.colors.glass, 0.5), x, at.y + r * (0.3 + this.rnd() * 0.3), {
        dur: ms * 0.9, from: 0.16, to: 0.12, sy: 1.8, a0: 0.7 * k, mode: 'hold', ease: 'linear', vy: 40 + this.rnd() * 50, drag: 1, delay: 200 + this.rnd() * 300,
      });
    }
  }

  /** A knock on the glass FROM THE INSIDE: a ring that bulges outward, a jolt of light through the cracks, dust. */
  knockFromInside(at: Pt, r: number, k: number): void {
    const S = this.scale;
    const c = this.colors;
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.5), at.x, at.y, { dur: 380, from: (r * 0.6) / 160 / S, to: (r * 3.2 * k) / 160 / S, a0: 0.85, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.energy ?? c.glass, at.x, at.y, { dur: 300, from: (r * 0.4) / 160 / S, to: (r * 2 * k) / 160 / S, a0: 0.6, ease: 'cubic', delay: 50 });
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 160, from: (r * 0.8) / 128 / S, to: (r * 1.6) / 128 / S, a0: 0.5, mode: 'punch', peakAt: 0.15 });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), 0xffffff], at.x, at.y, Math.round(3 + 3 * k), { speed: 260 * k, life: 520, size: 0.4, grav: 1800, drag: 0.5, spin: 0.03, lift: 80, flip: 0.012, to: 1.4 });
  }

  /** `butt`: a speed streak left behind the flying portrait. */
  trail(p: Pt, ang: number, r: number): void {
    const S = this.scale;
    this.spawn('glow', this.tex.glint, this.colors.side, p.x - Math.cos(ang) * r * 0.6, p.y - Math.sin(ang) * r * 0.6, {
      dur: 240, from: (r * 2.4) / GLINT_W / S, to: (r * 1.2) / GLINT_W / S, sy: 2.2, a0: 0.5, ease: 'linear', rot: ang,
    });
  }

  /** `ricochet`: the bolt kisses a screen edge: a flare of light along the edge and a prism. */
  edgeFlare(at: Pt): void {
    const b = this.area;
    const vertical = Math.min(Math.abs(at.x - b.x), Math.abs(at.x - b.x - b.w)) < Math.min(Math.abs(at.y - b.y), Math.abs(at.y - b.y - b.h));
    const rot = vertical ? Math.PI / 2 : 0;
    this.spawn('core', this.tex.glint, 0xffffff, at.x, at.y, { dur: 300, from: 600 / GLINT_W, to: 900 / GLINT_W, sy: 0.6, a0: 0.9, mode: 'punch', peakAt: 0.12, rot });
    this.spawn('glow', this.tex.glint, this.colors.glass, at.x, at.y, { dur: 420, from: 900 / GLINT_W, to: 1300 / GLINT_W, sy: 2.4, a0: 0.4, mode: 'punch', peakAt: 0.15, rot });
    this.prism(at, rot, 0.6);
  }

  /** `creep`: the bright head of the creeping crack (a light at `p`), and a puff of frost behind it. */
  setCreepHead(p: Pt, on: boolean, ang = 0): void {
    if (this.destroyed) return;
    if (!on) { this.lightOff('creepG'); this.lightOff('creepS'); return; }
    const S = this.scale;
    const g = this.light('creepG', 'glow', this.tex.glow, this.colors.energy ?? this.colors.glass), st = this.light('creepS', 'core', this.tex.star, 0xffffff);
    if (g) { g.visible = true; g.position.set(p.x, p.y); g.scale.set((150 * S) / 128); g.alpha = 0.8; }
    if (st) { st.visible = true; st.position.set(p.x, p.y); st.scale.set((96 * S) / 48); st.rotation = ang; st.alpha = 1; }
  }

  /**
   * The STRESS POINT on the glass over the target while the cause plays (Tier 2 and up): a light leaking through
   * before anything has cracked, swelling and spinning. `a` 0 hides it.
   */
  setStress(at: Pt, a: number, spin: number): void {
    if (this.destroyed) return;
    if (a <= 0.004) { this.lightOff('stressG'); this.lightOff('stressS'); return; }
    const S = this.scale;
    const g = this.light('stressG', 'glow', this.tex.glow, this.colors.energy ?? this.colors.glass), st = this.light('stressS', 'core', this.tex.star, 0xffffff);
    if (g) { g.visible = true; g.position.set(at.x, at.y); g.scale.set(((60 + 140 * a) * S) / 128); g.alpha = 0.75 * a; }
    if (st) { st.visible = true; st.position.set(at.x, at.y); st.scale.set(((24 + 70 * a) * S) / 48); st.rotation = spin; st.alpha = Math.min(1, 0.4 + a); }
  }

  /** Tier 4's INHALE: the screen darkens under the glowing cracks (`a` 0 hides it). */
  setDark(a: number): void {
    if (this.destroyed || !this.pane) return;
    if (!this.darkS) {
      if (a <= 0.004) return;
      const s = new Sprite(this.tex.wash);
      s.anchor.set(0.5);
      s.tint = this.colors.shade;
      this.pane.addChildAt(s, 0);
      this.darkS = s;
    }
    const s = this.darkS;
    s.visible = a > 0.004;
    if (!s.visible) return;
    const b = this.area;
    s.position.set(b.x + b.w / 2, b.y + b.h / 2);
    s.scale.set((b.w * 1.2) / WASH_PX, (b.h * 1.2) / WASH_PX);
    s.alpha = Math.min(1, a);
  }

  // ── the taps and the causes (fire and forget) ──────────────────────────────────────────────────────────────

  /** The glass is struck: a white tick of light, a ring on the surface, splinters dropping, a glint. */
  tap(at: Pt, strength: number): void {
    const c = this.colors;
    const T = strength * this.look.impactSize;
    this.spawn('core', this.tex.glow, whiten(c.flash, 0.5), at.x, at.y, { dur: 160, from: (50 * T) / GLOW_PX, to: (170 * T) / GLOW_PX, a0: 0.95, mode: 'punch', peakAt: 0.12 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 240, from: (40 * T) / STAR_PX, to: (150 * T) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.18, rot: 0.3 });
    this.spawn('glow', this.tex.ring, c.glass, at.x, at.y, { dur: 320, from: (18 * T) / RING_PX, to: (180 * T) / RING_PX, a0: 0.7, ease: 'cubic' });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), 0xffffff, c.glass], at.x, at.y, Math.round(4 + 6 * T), { speed: 280 * T, life: 560, size: 0.45 * T, grav: 1900, drag: 0.5, spin: 0.03, lift: 120, flip: 0.012, to: 0.7 });
    this.burst('core', this.tex.spark, [0xffffff, c.glass], at.x, at.y, Math.round(3 + 4 * T), { speed: 320 * T, life: 280, size: 0.42 * T, drag: 0.2, to: 0.2 });
    // Splinters that fly AT the viewer (they swell as they come), catching the prism.
    this.burst('core', this.tex.sliver, PRISM, at.x, at.y, Math.round(2 + 3 * T), { speed: 200 * T, life: 420, size: 0.4 * T, drag: 0.4, spin: 0.03, flip: 0.014, to: 2.6 });
  }

  /** `butt`: a body on the glass. A flat pale smear the size of the portrait and a breath of mist round it. */
  smear(at: Pt, r: number, ang: number): void {
    const S = this.scale;
    this.spawn('glow', this.tex.glow, whiten(this.colors.glass, 0.5), at.x, at.y, { dur: 520, from: (r * 2.4) / GLOW_PX / S, to: (r * 3) / GLOW_PX / S, sy: 0.7, a0: 0.5, mode: 'hold', ease: 'cubic', rot: ang + Math.PI / 2 });
    // The FACE PRINT it leaves: a pale smudge that lingers and slowly slides down the glass.
    this.spawn('body', this.tex.glow, whiten(this.colors.glass, 0.8), at.x, at.y, { dur: 1300, from: (r * 1.9) / GLOW_PX / S, to: (r * 2.1) / GLOW_PX / S, sy: 0.86, a0: 0.3, mode: 'hold', ease: 'linear', vy: 30, drag: 1 });
    this.spawn('glow', this.tex.ring, this.colors.glass, at.x, at.y, { dur: 420, from: (r * 1.4) / RING_PX / S, to: (r * 3.4) / RING_PX / S, a0: 0.6, ease: 'cubic' });
  }

  /** `knock`: knuckles on glass. Two quick rings on the surface and a small tick of light. */
  ripple(at: Pt, strength: number): void {
    const T = strength * this.look.impactSize;
    const c = this.colors;
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.4), at.x, at.y, { dur: 380, from: (20 * T) / RING_PX, to: (330 * T) / RING_PX, a0: 0.95, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.glass, at.x, at.y, { dur: 340, from: (14 * T) / RING_PX, to: (200 * T) / RING_PX, a0: 0.75, ease: 'cubic', delay: 60 });
    this.spawn('glow', this.tex.ring, c.energy ?? c.glass, at.x, at.y, { dur: 300, from: (10 * T) / RING_PX, to: (110 * T) / RING_PX, a0: 0.6, ease: 'cubic', delay: 120 });
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 150, from: (40 * T) / GLOW_PX, to: (120 * T) / GLOW_PX, a0: 0.9, mode: 'punch', peakAt: 0.15 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 200, from: (30 * T) / STAR_PX, to: (110 * T) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.15, rot: this.rnd() * 3 });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), 0xffffff], at.x, at.y, Math.round(2 + 2 * T), { speed: 200 * T, life: 420, size: 0.32 * T, grav: 1800, drag: 0.5, spin: 0.03, flip: 0.012, to: 0.8 });
  }

  /** `hum`: one pulse of the standing wave over the target (`r` the portrait's radius, `u` 0..1 how far the tone has risen). */
  humRings(at: Pt, r: number, u: number): void {
    const S = this.scale;
    const c = this.colors;
    [0.55, 0.9, 1.28, 1.7].forEach((f, i) => {
      if (i === 3 && u < 0.5) return;
      const k = (r * 2 * f) / RING_PX / S;
      // A standing ring barely moves: it swells a hair and dies, alternate rings out of step.
      this.spawn('glow', this.tex.ring, u > 0.35 ? PRISM[(i + Math.round(u * 10)) % PRISM.length]! : i % 2 ? c.glass : whiten(c.glass, 0.55), at.x, at.y, { dur: 230 - 70 * u, from: k * (i % 2 ? 1.04 : 0.97), to: k * (i % 2 ? 0.97 : 1.04), a0: 0.22 + 0.6 * u, mode: 'punch', peakAt: 0.4, ease: 'linear' });
    });
    for (let i = 0; i < 2; i++) {
      const a = this.rnd() * Math.PI * 2, d = r * [0.55, 0.9, 1.28][Math.floor(this.rnd() * 3)]!;
      this.spawn('core', this.tex.star, 0xffffff, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, { dur: 200, from: 0.12, to: 0.3 + 0.4 * u, a0: 0.9, mode: 'punch', peakAt: 0.3, rot: a });
    }
  }

  /** A note leaves the striker (the hum's first breath, the beam switching on): one soft ring. */
  note(at: Pt, r: number): void {
    const S = this.scale;
    this.spawn('glow', this.tex.ring, this.colors.side, at.x, at.y, { dur: 420, from: (r * 1.2) / RING_PX / S, to: (r * 3.6) / RING_PX / S, a0: 0.55, ease: 'cubic' });
  }

  /**
   * `shock`: the striker stamps at `at` and a ring of force rolls out, its edge `reach` px away after `ms` (so it
   * crosses the struck portrait exactly on the crack), a fainter one behind it; a kick of dust at the stamp.
   */
  shockRing(at: Pt, reach: number, ms: number): void {
    const S = this.scale;
    const c = this.colors;
    const to = (reach * 2 * 1.5) / RING_PX / S;
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.5), at.x, at.y, { dur: ms * 1.5, from: 0.2, to, a0: 0.8, ease: 'linear' });
    this.spawn('glow', this.tex.ring, c.side, at.x, at.y, { dur: ms * 1.5, from: 0.1, to: to * 0.86, a0: 0.4, ease: 'linear', delay: 50 });
    // A prism fringe on the edge: the force bending the light as it rolls.
    this.spawn('glow', this.tex.ring, PRISM[1]!, at.x, at.y, { dur: ms * 1.5, from: 0.2, to: to * 1.03, a0: 0.3, ease: 'linear', delay: 20 });
    this.spawn('glow', this.tex.ring, PRISM[0]!, at.x, at.y, { dur: ms * 1.5, from: 0.2, to: to * 0.97, a0: 0.3, ease: 'linear', delay: 30 });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), c.side], at.x, at.y, 10, { speed: 520, life: 520, size: 0.5, grav: 1600, drag: 0.4, spin: 0.03, lift: 260, flip: 0.012, to: 0.8 });
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 200, from: 0.6, to: 2.4, a0: 0.8, mode: 'punch', peakAt: 0.1 });
    this.burst('core', this.tex.spark, [0xffffff, c.side], at.x, at.y, 12, { speed: 620, life: 320, size: 0.5, drag: 0.2, to: 0.2 });
  }

  /** `beam`: the hot spot spits. */
  spit(at: Pt, k: number): void {
    this.burst('core', this.tex.spark, [0xffffff, this.colors.heat, whiten(this.colors.heat, 0.5)], at.x, at.y, Math.round(3 + 4 * k), { speed: 260 + 240 * k, life: 300, size: 0.4, grav: 900, drag: 0.3, to: 0.2 });
  }

  /** `beam`: the glass pops. The ember it leaves cools over most of a second. */
  ember(at: Pt, r: number): void {
    const S = this.scale;
    this.spawn('glow', this.tex.glow, this.colors.heat, at.x, at.y, { dur: 900, from: (r * 1.5) / GLOW_PX / S, to: (r * 0.7) / GLOW_PX / S, a0: 0.9, ease: 'linear' });
    this.spawn('core', this.tex.glow, whiten(this.colors.heat, 0.7), at.x, at.y, { dur: 420, from: (r * 0.6) / GLOW_PX / S, to: (r * 0.2) / GLOW_PX / S, a0: 1, ease: 'linear' });
  }

  /** `ricochet`: a fading mote the bolt leaves behind it. */
  boltMote(p: Pt, hue = 0): void {
    this.spawn('core', this.tex.glow, prismAt(hue), p.x, p.y, { dur: 300, from: 0.42, to: 0.08, a0: 0.8, ease: 'linear' });
  }

  /** `creep`, `butt`: a mote of light left behind (`tint`). */
  mote(p: Pt, tint: number, size = 0.4): void {
    this.spawn('core', this.tex.glow, tint, p.x, p.y, { dur: 320, from: size, to: size * 0.2, a0: 0.75, ease: 'linear' });
  }

  /** One creak: a hairline flash and a splinter or two somewhere on the web (`at`), nothing loud. */
  creak(at: Pt, k = 1): void {
    this.spawn('core', this.tex.star, prismAt(this.rnd()), at.x, at.y, { dur: 260, from: 0.15 * k, to: 0.7 * k, a0: 1, mode: 'punch', peakAt: 0.2, rot: this.rnd() * 3 });
    this.burst('body', this.tex.sliver, [whiten(this.colors.glass, 0.5), 0xffffff], at.x, at.y, 2, { speed: 120, life: 480, size: 0.3 * k, grav: 1800, drag: 0.5, spin: 0.03, flip: 0.012, to: 0.7 });
  }

  /** Tier 4: THE TEAR FORKS at `at` (heading `ang`): a hard flash, a kick of sparks along the tear, splinters, a blink of the pane. */
  fork(at: Pt, ang: number): void {
    const c = this.colors;
    const T = this.look.impactSize;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 190, from: (110 * T) / GLOW_PX, to: (360 * T) / GLOW_PX, a0: 1, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 300, from: (90 * T) / STAR_PX, to: (300 * T) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.15, rot: ang });
    this.spawn('core', this.tex.glint, 0xffffff, at.x, at.y, { dur: 220, from: (340 * T) / GLINT_W, to: (520 * T) / GLINT_W, sy: 0.5, a0: 0.9, mode: 'punch', peakAt: 0.15, rot: ang });
    this.burst('core', this.tex.spark, [0xffffff, c.glass], at.x, at.y, 9, { speed: 780, dir: ang, spread: 1.3, life: 300, size: 0.6, drag: 0.2, to: 0.2 });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), 0xffffff, c.glass], at.x, at.y, 6, { speed: 340, life: 620, size: 0.6, grav: 2000, drag: 0.5, spin: 0.03, lift: 120, flip: 0.012, to: 0.7 });
    this.flash(0.07, 110);
    this.prism(at, ang, 0.8);
  }

  /** Tier 4: sparks thrown off a running head of the tear. */
  tearSpark(p: Pt, ang: number): void {
    this.burst('core', this.tex.spark, [0xffffff, this.colors.glass], p.x, p.y, 2, { speed: 420, dir: ang + Math.PI, spread: 1.6, life: 260, size: 0.5, drag: 0.2, to: 0.2 });
    this.spawn('core', this.tex.glow, whiten(this.colors.flash, 0.5), p.x, p.y, { dur: 260, from: 0.7, to: 0.2, a0: 0.5, ease: 'linear' });
  }

  // ── the shards ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Hand over the blow's shards (Tier 3: the pane's; Tier 4: the whole screen's), bursting from `origin`. Built now, hidden;
   * `breakOut()` lets them go. `pane`: also a dark HOLE where they were, shown by `setHole`.
   */
  setShards(tris: readonly ShardTri[], origin: Pt, mode: ShardMode): void {
    if (this.destroyed || !this.pane) return;
    const n = Math.min(tris.length, GLASS_CAPS.shards);
    if (n <= 0) return;
    const S = this.scale;
    const far = Math.max(1, ...tris.map((t) => t.dist));
    const rim = this.look.rim * S;
    const mx = this.area.x + this.area.w / 2, my = this.area.y + this.area.h / 2;
    for (let m = 0; m * SHARDS_PER_MESH < n; m++) {
      const count = Math.min(SHARDS_PER_MESH, n - m * SHARDS_PER_MESH);
      const verts = new Float32Array(count * VERTS * 2);
      const uvs = new Float32Array(count * VERTS * 2);
      const idx = new Uint32Array(count * 21);
      for (let j = 0; j < count; j++) {
        const b = j * VERTS;
        // The rim band (three quads between the outer and the inner triangle), then the face.
        const q = [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4, 2, 0, 5, 0, 3, 5, 3, 4, 5];
        for (let e = 0; e < 21; e++) idx[j * 21 + e] = b + q[e]!;
        for (let v = 0; v < VERTS; v++) { uvs[(b + v) * 2] = v < 3 ? 0.03 : 0.97; uvs[(b + v) * 2 + 1] = 0.1; }
      }
      const mesh = new MeshSimple({ texture: this.tex.shard, vertices: verts, uvs, indices: idx });
      mesh.tint = whiten(this.colors.glass, 0.25);
      // Pre-warm: drawn all but invisible for the first few hundred ms so nothing about it is new on the break.
      mesh.alpha = 0.004;
      this.shardLayer.addChild(mesh);
      this.meshes.push(mesh);
      for (let j = 0; j < count; j++) {
        const t = tris[m * SHARDS_PER_MESH + j]!;
        const lx = new Float32Array(12);
        let reach = 0;
        for (let v = 0; v < 3; v++) {
          const dx = t.x[v]! - t.cx, dy = t.y[v]! - t.cy;
          const d = Math.hypot(dx, dy) || 1;
          const inset = Math.max(0.35, 1 - (rim * 2.2) / d);
          lx[v * 2] = dx; lx[v * 2 + 1] = dy;
          lx[(v + 3) * 2] = dx * inset; lx[(v + 3) * 2 + 1] = dy * inset;
          reach = Math.max(reach, d);
        }
        const near = 1 - Math.min(1, t.dist / far);
        const ox = t.cx - origin.x, oy = t.cy - origin.y;
        const ol = Math.hypot(ox, oy) || 1;
        const axis = mode === 'pane' ? (this.rnd() - 0.5) * 0.5 : this.rnd() * Math.PI;
        const push = this.look.burst * S * (mode === 'pane' ? 0.35 : 0.5 + 0.9 * near) * (0.5 + this.rnd() * 0.8);
        // The jump at the viewer: the shards near the blow come furthest; each spreads from the middle of the screen
        // as it swells (things flying at you fan out).
        const pop = mode === 'pane' ? 0 : this.look.lunge * (0.4 + 0.8 * near) * (0.65 + this.rnd() * 0.7);
        this.shards.push({
          cx: t.cx, cy: t.cy, lx,
          delay: mode === 'pane' ? j * 22 + this.rnd() * 30 : (1 - near) * 120 + this.rnd() * 40,
          vx: (ox / ol) * push + (this.rnd() - 0.5) * 60 * S,
          vy: (oy / ol) * push * 0.6 - (20 + this.rnd() * 90) * S + (mode === 'pane' ? 0 : reach * 0.5),
          spin: (this.rnd() - 0.5) * 2 * this.look.spin * (mode === 'pane' ? 0.5 : 1),
          flip: (mode === 'pane' ? 3 + this.rnd() * 2.5 : 1.6 + this.rnd() * 4.2) * (this.rnd() < 0.5 ? -1 : 1),
          phase: this.rnd() * Math.PI * 2, cosA: Math.cos(axis), sinA: Math.sin(axis),
          grow: mode === 'pane' ? 0.35 + this.rnd() * 0.3 : -0.1 + this.rnd() * 0.6,
          base: 0.04 + this.rnd() * 0.3, reach,
          pop, ex: (t.cx - mx) * 0.3 * pop, ey: (t.cy - my) * 0.3 * pop,
          mesh, at: j * VERTS * 2, uv: uvs, gone: false,
        });
      }
    }
    if (mode === 'pane') {
      // The hole: the same cells, flat and dark, under the cracks.
      const hv = new Float32Array(n * 6), hu = new Float32Array(n * 6).fill(0.5), hi = new Uint32Array(n * 3);
      for (let j = 0; j < n; j++) { const t = tris[j]!; for (let v = 0; v < 3; v++) { hv[j * 6 + v * 2] = t.x[v]!; hv[j * 6 + v * 2 + 1] = t.y[v]!; hi[j * 3 + v] = j * 3 + v; } }
      this.hole = new MeshSimple({ texture: this.tex.wash, vertices: hv, uvs: hu, indices: hi });
      this.hole.tint = this.colors.shade;
      this.hole.alpha = 0; this.hole.visible = false;
      this.pane.addChildAt(this.hole, 0);
    }
    this.placeShards(0);
  }

  /** THE BREAK: the shards let go. */
  breakOut(): void {
    if (!this.shards.length || this.shardT >= 0) return;
    this.shardT = 0;
    this.shardsLeft = this.shards.length;
    this.warmMs = 0;
    for (const m of this.meshes) { m.alpha = 1; m.visible = true; }
  }

  /** The hole the pane left (0 hides it). */
  setHole(a: number): void {
    if (this.destroyed || !this.hole) return;
    const on = a > 0.004;
    this.hole.visible = on;
    this.hole.alpha = on ? a : 0;
  }

  /** Every shard's six vertices and its flash, `ms` after the break. Rewrites the meshes' arrays in place. */
  private placeShards(ms: number): void {
    const g = this.look.gravity * this.scale;
    const bottom = this.area.y + this.area.h, left = this.area.x, right = this.area.x + this.area.w;
    for (const sh of this.shards) {
      if (sh.gone) continue;
      const tau = Math.max(0, ms - sh.delay) / 1000;
      const lunge = sh.pop > 0 ? 1 - Math.exp(-tau / LUNGE_TAU) : 0;
      const px = sh.cx + sh.vx * tau + sh.ex * lunge, py = sh.cy + sh.vy * tau + 0.5 * g * tau * tau + sh.ey * lunge;
      const depth = Math.max(0.3, 1 + sh.pop * lunge + sh.grow * tau);
      const v = sh.mesh.vertices as Float32Array;
      if (tau > 0 && (py - sh.reach * depth > bottom + 8 || px + sh.reach * depth < left - 8 || px - sh.reach * depth > right + 8)) {
        // Off the screen: collapse it to a point and never touch it again.
        for (let i = 0; i < VERTS * 2; i++) v[sh.at + i] = i % 2 ? bottom + 64 : px;
        sh.gone = true; this.shardsLeft--;
        continue;
      }
      const rot = sh.spin * tau, fa = sh.flip * tau;
      const cr = Math.cos(rot) * depth, sr = Math.sin(rot) * depth, cf = Math.cos(fa);
      for (let i = 0; i < VERTS; i++) {
        const x = sh.lx[i * 2]!, y = sh.lx[i * 2 + 1]!;
        // The edge-on flip about the shard's own axis, then the spin, the depth and the fall.
        const along = x * sh.cosA + y * sh.sinA, perp = (-x * sh.sinA + y * sh.cosA) * cf;
        const fx = along * sh.cosA - perp * sh.sinA, fy = along * sh.sinA + perp * sh.cosA;
        v[sh.at + i * 2] = px + fx * cr - fy * sr;
        v[sh.at + i * 2 + 1] = py + fx * sr + fy * cr;
      }
      // It flashes as it lets go (longer when it jumps at the viewer), and again each time it turns face-on to the light.
      const glint = Math.pow(Math.max(0, Math.cos(fa * 0.5 + sh.phase)), 8);
      const let0 = ms > 0 ? (0.38 + 0.3 * sh.pop) * Math.exp(-(ms - Math.min(ms, sh.delay)) / (80 + 160 * sh.pop)) : 0;
      const bright = Math.min(0.97, sh.base + let0 + 0.6 * glint * Math.min(1, tau * 6));
      for (let i = 0; i < VERTS; i++) sh.uv[sh.at + i * 2 + 1] = bright;
    }
    for (const m of this.meshes) { try { m.geometry.getBuffer('aUV').update(); m.geometry.getBuffer('aPosition').update(); } catch { /* headless */ } }
  }

  // ── the big beats ──────────────────────────────────────────────────────────────────────────────────────────

  /** A flash of white-blue over the whole view. */
  flash(a0: number, dur: number): void {
    const b = this.area;
    this.spawn('glow', this.tex.wash, this.colors.flash, b.x + b.w / 2, b.y + b.h / 2, {
      dur, from: (b.w * 1.1) / WASH_PX / this.scale, to: (b.w * 1.1) / WASH_PX / this.scale, sy: (b.h * 1.1) / (b.w * 1.1), a0, mode: 'punch', peakAt: 0.08, ease: 'linear',
    });
  }

  /** Tier 3: the pane breaks out of the web at `at` (the hole's centre, `r` its radius): a surface ring and splinters. */
  paneBreak(at: Pt, r: number): void {
    const c = this.colors;
    this.spawn('core', this.tex.glow, whiten(c.flash, 0.4), at.x, at.y, { dur: 220, from: (r * 1.2) / GLOW_PX / this.scale, to: (r * 3.2) / GLOW_PX / this.scale, a0: 0.7, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.ring, c.glass, at.x, at.y, { dur: 400, from: (r * 0.9) / RING_PX / this.scale, to: (r * 3.6) / RING_PX / this.scale, a0: 0.75, ease: 'cubic' });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), 0xffffff, c.glass], at.x, at.y, 20, { speed: 460, life: 800, size: 0.6, grav: 2200, drag: 0.5, spin: 0.03, lift: 160, flip: 0.012, to: 0.7 });
    this.burst('core', this.tex.spark, [0xffffff, c.glass], at.x, at.y, 10, { speed: 560, life: 320, size: 0.5, drag: 0.2, to: 0.2 });
    this.flash(0.1, 140);
  }

  /** Tier 3: the pane repairs: a shimmer sweeps the hole, a soft ring closes on it, a few stars. */
  repair(at: Pt, r: number): void {
    const c = this.colors;
    const S = this.scale;
    const len = (r * 2.6) / GLINT_W / S;
    for (let i = 0; i < 2; i++) {
      this.spawn('core', this.tex.glint, i ? c.glass : 0xffffff, at.x - r * 1.1, at.y + r * (0.3 - 0.5 * i), {
        dur: 300, from: len, to: len, sy: 0.9 - 0.4 * i, a0: 0.85 - 0.25 * i, mode: 'punch', peakAt: 0.4, ease: 'linear', rot: -0.9, vx: (r * 2.2) / 0.3 / S, drag: 1, delay: i * 70,
      });
    }
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.4), at.x, at.y, { dur: 320, from: (r * 2.8) / RING_PX / S, to: (r * 0.9) / RING_PX / S, a0: 0.6, mode: 'punch', peakAt: 0.5, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.glass, at.x, at.y, { dur: 360, from: (r * 1.6) / GLOW_PX / S, to: (r * 2.6) / GLOW_PX / S, a0: 0.4, mode: 'punch', peakAt: 0.3 });
    for (let i = 0; i < 5; i++) {
      const a = this.rnd() * Math.PI * 2, d = r * (0.3 + this.rnd() * 0.8);
      this.spawn('core', this.tex.star, 0xffffff, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, { dur: 300, from: 0.15, to: 0.6, a0: 1, mode: 'punch', peakAt: 0.3, delay: 60 + this.rnd() * 160, rot: 0.4 });
    }
  }

  /**
   * Tier 4: the faint offset either side of the main crack (the picture seems to sit a hair apart across it): a cool tint on
   * one side and a shade on the other, sliding a few px along the crack as it creaks. `a` 0 hides both.
   */
  setSplit(from: Pt, to: Pt, a: number, slide: number): void {
    if (this.destroyed || !this.pane) return;
    if (!this.split) {
      if (a <= 0.002) return;
      const mk = (tint: number, ay: number): Sprite => { const s = new Sprite(this.tex.wash); s.anchor.set(0.5, ay); s.tint = tint; this.pane!.addChildAt(s, 0); return s; };
      this.split = [mk(whiten(this.colors.glass, 0.3), 1), mk(this.colors.shade, 0)];
    }
    const on = a > 0.002;
    const [p, q] = this.split;
    p.visible = q.visible = on;
    if (!on) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    const rot = Math.atan2(dy, dx);
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const big = Math.hypot(this.area.w, this.area.h);
    const ux = (dx / L) * slide, uy = (dy / L) * slide;
    p.rotation = q.rotation = rot;
    p.scale.set((big * 1.3) / WASH_PX, big / WASH_PX); q.scale.set((big * 1.3) / WASH_PX, big / WASH_PX);
    p.position.set(mx + ux, my + uy); q.position.set(mx - ux, my - uy);
    p.alpha = a; q.alpha = a * 0.8;
  }

  /**
   * Tier 4: THE WHOLE SCREEN SHATTERS (the shards are `breakOut`'s): a hard white-blue flash, a burst of light at the blow,
   * a ripple, a rain of splinters from all over the pane, a glint riding the shards, and the DUST: motes that keep
   * twinkling down for a second and a half after the shards have gone.
   */
  shatterFx(at: Pt, ko: boolean): void {
    const c = this.colors;
    const S = this.scale;
    const b = this.area;
    const far = Math.hypot(b.w, b.h);
    this.flash(0.62, 340);
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 380, from: 2 * this.look.impactSize, to: 8 * this.look.impactSize, a0: 1, mode: 'punch', peakAt: 0.08 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 460, from: 3 * this.look.impactSize, to: 12 * this.look.impactSize, a0: 1, mode: 'punch', peakAt: 0.1, rot: 0.5 });
    // Ripples across the surface (the glass, not an explosion): one hard, one slow.
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.5), at.x, at.y, { dur: 420, from: 0.6, to: (far * 0.9) / RING_PX / S, a0: 0.5, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.3), at.x, at.y, { dur: 760, from: 0.4, to: (far * 0.7) / RING_PX / S, a0: 0.25, ease: 'cubic', delay: 90 });
    // Splinters from all over the pane (not only the impact): the small stuff between the big shards.
    for (let i = 0; i < 60; i++) {
      const x = b.x + this.rnd() * b.w, y = b.y + this.rnd() * b.h * 0.9;
      const dx = x - at.x, dy = y - at.y, d = Math.hypot(dx, dy) || 1;
      const sz = 0.5 + this.rnd() * 1.1;
      this.spawn('body', this.tex.sliver, i % 3 ? whiten(c.glass, 0.4) : 0xffffff, x, y, {
        dur: 1000 + this.rnd() * 600, from: sz, to: sz * 1.3, a0: 1, mode: 'hold', ease: 'linear', vx: (dx / d) * (140 + this.rnd() * 300), vy: (dy / d) * 180 - 80 - this.rnd() * 240,
        grav: 2400, drag: 0.7, spin: (this.rnd() - 0.5) * 0.03, flip: 0.008 + this.rnd() * 0.01, delay: (d / far) * 150, rot: this.rnd() * 6,
      });
    }
    // A glint riding roughly with every other shard as it lets go.
    for (let i = 0; i < this.shards.length; i += 2) {
      const sh = this.shards[i]!;
      this.spawn('core', this.tex.star, 0xffffff, sh.cx + sh.ex, sh.cy + sh.ey, {
        dur: 520, from: 0.4, to: 1.5, a0: 1, mode: 'punch', peakAt: 0.2, delay: sh.delay + 40, vx: sh.vx / S, vy: sh.vy / S, grav: this.look.gravity, drag: 1, rot: 0.3 + this.rnd(),
      });
    }
    this.burst('core', this.tex.spark, [0xffffff, c.glass, whiten(c.glass, 0.5)], at.x, at.y, 40, { speed: 1300, life: 460, size: 0.9, drag: 0.25, to: 0.2 });
    // THE DUST: it hangs in the light and drifts down long after the crash.
    const motes = Math.round(Math.max(0, Math.min(120, this.look.dust)));
    for (let i = 0; i < motes; i++) {
      const x = b.x + this.rnd() * b.w, y = b.y + this.rnd() * b.h * 0.85;
      const sz = 0.22 + this.rnd() * 0.3;
      this.spawn('core', i % 3 === 0 ? this.tex.spark : this.tex.star, i % 4 === 0 ? c.glass : 0xffffff, x, y, {
        dur: 520 + this.rnd() * 620, from: sz, to: sz * 2.4, a0: 0.95, mode: 'punch', peakAt: 0.3, ease: 'linear', delay: 240 + this.rnd() * 1500,
        vx: (this.rnd() - 0.5) * 50, vy: 60 + this.rnd() * 120, drag: 1, rot: this.rnd() * 3, spin: (this.rnd() - 0.5) * 0.004,
      });
    }
    // The light splits as the pane goes: a prism at the blow and rainbow rings rolling out over the whole screen.
    this.prism(at, 0.3, 2.2);
    if (!ko) PRISM.slice(0, 3).forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 620 + i * 90, from: 0.5, to: (far * (0.55 + 0.15 * i)) / RING_PX / S, a0: 0.45, ease: 'cubic', delay: 30 + i * 60 }));
    if (ko) {
      // THE KNOCKOUT: the Ancient prism runs through the break.
      [KO_CYAN, KO_LILAC, KO_MAGENTA].forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 700 + i * 120, from: 0.5, to: (far * (0.6 + 0.2 * i)) / RING_PX / S, a0: 0.8, ease: 'cubic', delay: 40 + i * 70 }));
      this.burst('glow', this.tex.streak, [KO_CYAN, KO_LILAC, KO_MAGENTA], at.x, at.y, 20, { speed: 2000, life: 420, size: 2.2, drag: 0.2, align: true, to: 0.6 });
      for (const m of this.meshes) m.tint = mixColor(whiten(c.glass, 0.25), KO_LILAC, 0.35);
    }
  }

  // ── the pool's hooks ───────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    if (this.warmMs > 0) {
      this.warmMs -= dt;
      if (this.warmMs <= 0 && this.shardT < 0) for (const m of this.meshes) { m.visible = false; m.alpha = 1; }
    }
    if (this.shardT >= 0 && this.shardsLeft > 0) {
      this.shardT += dt;
      this.placeShards(this.shardT);
      if (this.shardT > SHARD_MAX_MS) this.shardsLeft = 0;
      if (this.shardsLeft <= 0) for (const m of this.meshes) m.visible = false;
    }
    let own = this.shardT >= 0 && this.shardsLeft > 0;
    if (this.activeRunners > 0 && this.tickRunners(dt)) own = true;
    if (!own) for (const s of this.lights.values()) if (s.visible) { own = true; break; }
    return own;
  }

  /** Every light off (the sequence is over; the fire-and-forget sparks may still drain). */
  lightsOut(): void {
    for (const s of this.lights.values()) s.visible = false;
    this.setRunners(0, 1);
    if (this.ghostS) this.ghostS.visible = false;
    if (this.darkS) this.darkS.visible = false;
    this.setGlow(0);
  }

  protected override clearOwn(): void {
    for (const s of this.lights.values()) { s.visible = true; this.give(s); }
    this.lights.clear();
    for (const r of this.runners) { r.s.visible = true; r.h.visible = true; this.give(r.s); this.give(r.h); }
    this.runners = []; this.activeRunners = 0;
    if (this.ghostS) this.ghostS.visible = false;
    if (this.darkS) this.darkS.visible = false;
    for (const s of this.cracks) s.visible = false;
    for (const s of this.chips) s.visible = false;
    for (const m of this.meshes) m.visible = false;
    if (this.hole) this.hole.visible = false;
    if (this.frostS) this.frostS.visible = false;
    if (this.split) { this.split[0].visible = false; this.split[1].visible = false; }
    this.shardsLeft = 0;
  }

  /** Tear down: our own layer (the cracks, chips, tints and the shard meshes with their buffers), then the pool. */
  override destroy(): void {
    if (this.destroyed) return;
    this.clear();
    const geos = [...this.meshes, ...(this.hole ? [this.hole] : [])].map((m) => m.geometry);
    this.pane?.destroy({ children: true });
    for (const g of geos) { try { g.destroy(); } catch { /* already gone */ } }
    this.pane = null;
    this.cracks = []; this.glows = []; this.chips = []; this.ghostS = null; this.darkS = null; this.meshes = []; this.shards = []; this.hole = null; this.split = null; this.frostS = null;
    super.destroy();
  }
}
