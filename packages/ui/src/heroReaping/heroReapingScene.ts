/**
 * THE REAPING'S SCENE: everything The Reaping draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroReaping.ts` mounts `root` on the above-portrait overlay, calls `draw(t)` from
 * the one clock's paint (so the blades, the orb, the ribbons, the cracks and the striker's glow are a pure function of
 * the time), fires the beats and feeds `update(dt)`.
 *
 * What it draws is LIGHT and COLOUR: blades, afterimages, rings, sparks, drops, shards and ribbons. No drawn props. The
 * grey itself is NOT here: that is DOM (`heroReapingDrain.ts`), underneath this canvas, which is why everything drawn
 * here keeps its colour over a monochrome screen. Every colour the stolen colour takes is the struck portrait's own
 * (`colors.motes`, read from its art at the start: `heroReapingPalette.ts`).
 *
 *  Tiers 1-2  the BLADE: a long thin crescent of teal light travelling point first along its shallow arc through the
 *             portrait, a soft dark shade under it. As it crosses, a hairline of bone light marks the cut and a spray of
 *             the portrait's colour flies off the cut; drops of it drift to the striker.
 *  Tier 3     the GATHER: drops of every colour run in from the closing edge of the grey, spiralling, into the ORB (a
 *             swirl of the portrait's hues, a white heart, a rim of light) over the struck portrait. The great crescent
 *             is drawn back, held over it, falls; the orb SHATTERS: a flash, rings in its colours, and a storm of
 *             glassy SHARDS that burst out and are drawn into the striker.
 *  Tier 4     the RIBBONS: three long spiralling ribbons of the portrait's colour (rope meshes) wound out of it onto the
 *             blade, which turns RAINBOW (a second crescent in every colour cross-faded in, with a shimmering fringe).
 *             One sweep; rainbow afterimages fanned behind it; a rainbow line across the screen; the loser CRACKS like
 *             old paint (and the paint flakes off as its colour comes back); the colour spills into the striker and the
 *             flood's front is a band of colours.
 *  Every tier: the striker GLOWS with the stolen colour once it arrives (three of its hues turning about it).
 *
 * Perf: every sprite and mesh is made once (the blades, the crescents and their afterimages, the orb, the ribbons, the
 * line, the front, the cracks, the glow, the gather drops) or pooled under a hard cap (the motes and shards and the
 * fire-and-forget rings, glints, sparks and flakes); a frame writes transforms, alpha, tints and the ribbons' points
 * only; nothing allocates per frame.
 */
import { Mesh, Point, RopeGeometry, Sprite, type Texture } from 'pixi.js';
import type { HeroBlastTextures } from '../heroBlast/heroBlastScene';
import { clamp01, easeInOutSine, whiten, type Pt } from '../heroAttack/easing';
import { FxPool, type FxLayer } from '../heroAttack/fxPool';
import {
  bladeAt, crackAt, gatherAt01, gatherRadius, lineAt, orbAt, rainbowAt, ribbonPoint, ribbonSpan, stolenAt, swingAt, swingLight,
  type BladeState, type ReapingGeo, type ReapingPlan,
} from './heroReapingConfig';
import { farCorner, veilSpan } from './heroReapingDrain';
import {
  BLADE_TEX_W, CRACK_TEX, CRESCENT_CHORD_V, CRESCENT_HEEL_U, CRESCENT_POINT_U, CRESCENT_TEX_W, LINE_TEX_H, LINE_TEX_W, MOTE_TEX, SHARD_TEX_W,
} from './heroReapingTextures';

export interface HeroReapingTextures extends HeroBlastTextures {
  blade: Texture;
  crescent: Texture;
  line: Texture;
  mote: Texture;
  rainbow: Texture;
  shard: Texture;
  ribbon: Texture;
  cracks: Texture;
}

/**
 * `motes` are the STOLEN colours (the struck portrait's own hues, strongest first; at least two); `world` the board's
 * colours that Tier 3 gathers with them.
 */
export interface ReapingColors { teal: number; bone: number; shade: number; motes: readonly number[]; world?: readonly number[]; side: number }

export interface ReapingLook {
  /** The blade's length, in struck-portrait radii (Tiers 1-2). */
  bladeSize: number;
  /** A mote's flight to the striker (ms) and its size multiplier. */
  moteMs: number;
  moteSize: number;
  /** Tiers 1-2: the strip's width in radii (the motes lift off inside it). */
  stripWidth: number;
  /** Tier 3: the orb's size (struck-portrait radii) and a shard's flight (ms). */
  orbSize?: number;
  shardMs?: number;
  /** Tier 4: a ribbon's width (px at stage scale 1). */
  ribbonWidth?: number;
  /** How strongly the striker glows with the stolen colour (1 = as tuned). */
  aura?: number;
}

/** Hard cap on pooled sprites alive at once (Tier 3's shatter and Tier 4's strike peak well under it). */
export const MAX_REAPING_SPRITES = 300;
/** The most motes and shards in flight at once. */
export const MAX_MOTES = 72;
/** Tiers 3-4: how many afterimages replay the crescent's pass behind it. */
export const GHOSTS = 5;
/** Tier 3: the drops of colour gathered into the orb. */
export const GATHER_DROPS = 56;
/** Tier 4: the ribbons wound out of the portrait, and the points along each. */
export const RIBBONS = 3;
export const RIBBON_POINTS = 34;
/** The lobes of colour swirling in the orb, and the hues turning about the striker. */
export const ORB_LOBES = 5;
/** Tier 3: bright motes of colour orbiting inside the orb. */
export const ORB_MOTES = 14;
export const AURA_LOBES = 3;
/** How strongly each tier's striker glows with the stolen colour. */
export const AURA_BY_TIER = [0.38, 0.5, 1, 1.15] as const;

/** Afterimage `i` (1..GHOSTS) replays the crescent this many ms late: later and later, so they fan out. */
export function ghostLag(i: number): number { return i * (14 + 10 * i); }

/** A mote of colour (Tiers 1-2, Tier 4's spill) or a shard of the orb (Tier 3), flying to the striker. */
interface Mote {
  s: Sprite | null; g: Sprite | null; age: number; delay: number; dur: number;
  x0: number; y0: number; cx: number; cy: number; x1: number; y1: number;
  size: number; phase: number;
  /** A shard: bursts out fast, hangs, then is drawn in fast; it turns and glints as it flies. */
  shard: boolean; spin: number;
}

/** Tier 3: a drop of the world's colour gathered into the orb (all pure from its spawn time). */
interface Drop { s: Sprite; g: Sprite; at: number; dur: number; ang: number; rad: number; swirl: number; size: number }

/** What the runner hands `draw` each frame: the two portraits' offsets (overlay px). */
export interface ReapingFrame { heroX: number; heroY: number; foeX: number; foeY: number }

const blade: BladeState = { visible: false, x: 0, y: 0, rot: 0, alpha: 0, k: 0 };
const light = { a: 0, build: 0 };
const scar = { len: 0, a: 0 };
const orb = { k: 0, a: 0 };
const span = { tail: 0, head: 0 };
const pa: Pt = { x: 0, y: 0 }, pb: Pt = { x: 0, y: 0 };

export class HeroReapingScene extends FxPool {
  private readonly blades: Sprite[] = [];
  private readonly shades: Sprite[] = [];
  private swBlade: Sprite | null = null;
  private swShade: Sprite | null = null;
  private swHalo: Sprite | null = null;
  private swGlint: Sprite | null = null;
  private swRain: Sprite | null = null;
  private swFringe: Sprite | null = null;
  private readonly ghosts: Sprite[] = [];
  private lineS: Sprite | null = null;
  private readonly lineGlows: Sprite[] = [];
  private lineShade: Sprite | null = null;
  private frontS: Sprite | null = null;
  private readonly frontGlows: Sprite[] = [];
  private readonly orbS: Sprite[] = [];
  private readonly orbMotes: Sprite[] = [];
  private readonly ribbons: { core: Mesh; glow: Mesh; geoC: RopeGeometry; geoG: RopeGeometry; pts: Point[] }[] = [];
  private cracksS: Sprite | null = null;
  private readonly aura: Sprite[] = [];
  private readonly drops: Drop[] = [];
  private edgeS: Sprite | null = null;
  private dMax = 0;
  private readonly motes: Mote[] = [];
  private readonly hues: readonly number[];
  /** Tier 3: the portrait's hues interleaved with the board's (what the orb is made of, and what it shatters into). */
  private readonly gathered: readonly number[];
  private readonly tierAura: number;
  private flying = 0;
  private arrivedN = 0;
  private ownOn = true;

  constructor(
    private readonly tex: HeroReapingTextures,
    private readonly colors: ReapingColors,
    private readonly look: ReapingLook,
    private readonly plan: ReapingPlan,
    private readonly geo: ReapingGeo,
    /** The struck portrait's centre and radius, and the striker's. */
    private readonly foe: { x: number; y: number; r: number } = { x: 0, y: 0, r: 80 },
    private readonly hero: { x: number; y: number; r: number } = { x: 0, y: 0, r: 80 },
    scale = 1,
    seed = 1,
  ) {
    super('heroReaping', [tex.glow, tex.ring, tex.streak, tex.blade, tex.crescent, tex.line, tex.mote, tex.rainbow, tex.shard, tex.ribbon, tex.cracks], scale, seed, MAX_REAPING_SPRITES);
    this.hues = colors.motes.length ? colors.motes : [0xffb24a, 0x5ab4ff];
    const world = colors.world ?? [];
    const mixed: number[] = [];
    for (let i = 0; i < Math.max(this.hues.length, world.length); i++) {
      if (i < this.hues.length) mixed.push(this.hues[i]!);
      if (i < world.length) mixed.push(world[i]!);
    }
    this.gathered = mixed;
    this.tierAura = (AURA_BY_TIER[plan.tier - 1] ?? 1) * (look.aura ?? 1);
    const own = (layer: FxLayer, t: Texture, ax: number, ay: number, tint = 0xffffff): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false;
      if (layer === 'glow' || layer === 'core') s.blendMode = 'add';
      this.layers[layer].addChild(s);
      return s;
    };
    const hue = (i: number): number => this.hues[i % this.hues.length]!;
    if (plan.reduced) return;
    const S = scale;
    if (plan.kind === 'harvest' || plan.kind === 'reaping') {
      this.swShade = own('under', tex.crescent, CRESCENT_HEEL_U, CRESCENT_CHORD_V, 0x000000);
      this.swHalo = own('glow', tex.glow, 0.5, 0.5, colors.teal);
      for (let i = 0; i < GHOSTS; i++) {
        // Tier 4's afterimages are the stolen colours fanned out (a rainbow); Tier 3's are teal.
        if (plan.kind === 'reaping') this.ghosts.push(own('glow', tex.rainbow, CRESCENT_HEEL_U, CRESCENT_CHORD_V, hue(i)));
        else this.ghosts.push(own('glow', tex.crescent, CRESCENT_HEEL_U, CRESCENT_CHORD_V, colors.teal));
      }
      this.swBlade = own('core', tex.crescent, CRESCENT_HEEL_U, CRESCENT_CHORD_V);
      if (plan.kind === 'reaping') {
        this.swFringe = own('glow', tex.rainbow, CRESCENT_HEEL_U, CRESCENT_CHORD_V);
        this.swRain = own('core', tex.rainbow, CRESCENT_HEEL_U, CRESCENT_CHORD_V);
      }
      this.swGlint = own('core', tex.glow, 0.5, 0.5, whiten(colors.teal, 0.7));
      if (plan.kind === 'reaping') {
        this.lineShade = own('under', tex.line, 0.5, 0.5, 0x000000);
        for (let i = 0; i < 3; i++) this.lineGlows.push(own('glow', tex.line, 0.5, 0.5, hue(i)));
        this.lineS = own('core', tex.line, 0.5, 0.5, 0xffffff);
        for (let i = 0; i < 3; i++) this.frontGlows.push(own('glow', tex.line, 0.5, 0.5, hue(i)));
        this.frontS = own('core', tex.line, 0.5, 0.5, whiten(colors.bone, 0.4));
        // The ribbons: a wide soft glow under a bright core, both rope meshes along the same points.
        const w = (look.ribbonWidth ?? 30) * S;
        for (let j = 0; j < RIBBONS; j++) {
          const pts: Point[] = [];
          for (let i = 0; i < RIBBON_POINTS; i++) pts.push(new Point(foe.x, foe.y));
          const geoG = new RopeGeometry({ width: w * 2.6, points: pts, textureScale: 0 });
          const geoC = new RopeGeometry({ width: w, points: pts, textureScale: 0 });
          const glow = new Mesh({ geometry: geoG, texture: tex.ribbon });
          glow.blendMode = 'add'; glow.tint = hue(j); glow.visible = false; glow.alpha = 0.45;
          const core = new Mesh({ geometry: geoC, texture: tex.ribbon });
          core.blendMode = 'add'; core.tint = whiten(hue(j), 0.25); core.visible = false;
          this.layers.glow.addChild(glow);
          this.layers.core.addChild(core);
          this.ribbons.push({ core, glow, geoC, geoG, pts });
        }
        this.cracksS = own('body', tex.cracks, 0.5, 0.5, 0xffffff);
      }
      if (plan.kind === 'harvest') {
        // The orb: lobes of the gathered colours (the portrait's and the board's) swirling inside a rim of light, a
        // soft heart and a glint; motes of each colour orbit inside it.
        for (let i = 0; i < ORB_LOBES; i++) this.orbS.push(own('glow', tex.glow, 0.5, 0.5, this.gathered[i % this.gathered.length]!));
        this.orbS.push(own('core', tex.glow, 0.5, 0.5, 0xffffff));
        this.orbS.push(own('core', tex.ring, 0.5, 0.5, 0xffffff));
        this.orbS.push(own('core', tex.glow, 0.5, 0.5, 0xffffff));
        for (let i = 0; i < ORB_MOTES; i++) this.orbMotes.push(own('core', tex.mote, 0.5, 0.5, whiten(this.gathered[i % this.gathered.length]!, 0.15)));
        // The drops of the world's colour gathered into it, rolled from the seed (their times and paths are fixed).
        const world = this.gathered;
        const g0 = plan.gatherAt ?? plan.chargeAt, g1 = plan.gatherEnd ?? plan.impactAt;
        const dMax = farCorner(foe, geo.bounds);
        this.dMax = dMax;
        this.edgeS = own('glow', tex.ring, 0.5, 0.5, whiten(hue(0), 0.4));
        for (let i = 0; i < GATHER_DROPS; i++) {
          const at = g0 + (g1 - g0 - 160) * (i / GATHER_DROPS) * (0.9 + this.rnd() * 0.1);
          const e = gatherAt01((at - g0) / Math.max(1, g1 - g0));
          // It leaves from the edge of the grey where that edge is ON the screen: on the side of the portrait that
          // faces the middle of the screen, pulled in from wherever the edge has reached.
          const ang = Math.atan2(geo.bounds.h / 2 - foe.y, geo.bounds.w / 2 - foe.x) + (this.rnd() - 0.5) * 2.2;
          let rad = gatherRadius(e, dMax, foe.r) * (0.96 + this.rnd() * 0.08);
          const inside = (q: number): boolean => { const x = foe.x + Math.cos(ang) * q, y = foe.y + Math.sin(ang) * q; return x > 10 && y > 10 && x < geo.bounds.w - 10 && y < geo.bounds.h - 10; };
          for (let k = 0; k < 40 && rad > foe.r * 1.6 && !inside(rad); k++) rad *= 0.93;
          const tint = world[i % world.length]!;
          this.drops.push({
            s: own('core', tex.mote, 0.5, 0.5, whiten(tint, 0.2)), g: own('glow', tex.glow, 0.5, 0.5, tint),
            at, dur: Math.min(900, Math.max(460, rad / 1.9)), ang, rad,
            swirl: (this.rnd() < 0.5 ? 1 : -1) * (0.7 + this.rnd() * 0.7), size: (26 + this.rnd() * 18) * S,
          });
        }
      }
    } else {
      for (let i = 0; i < plan.cuts.length; i++) {
        this.shades.push(own('under', tex.blade, 0.5, 0.42, 0x000000));
        this.blades.push(own('core', tex.blade, 0.5, 0.42));
      }
    }
    // The striker's glow with the stolen colour: rings of its hues round the portrait's rim, turning and breathing.
    for (let i = 0; i < AURA_LOBES; i++) this.aura.push(own('glow', tex.ring, 0.5, 0.5, hue(i)));
    this.aura.push(own('core', tex.ring, 0.5, 0.5, whiten(hue(0), 0.5)));
    if (this.swBlade) {
      // Tiers 3-4 throw most of their sprites on ONE frame (the cut: the rings, the sparks, the shards or the spill).
      // Make the pool's sprites now, while the damage formation is still playing, so the cut itself creates none.
      const made: Sprite[] = [];
      const fill = (layer: FxLayer, t: Texture, n: number): void => { for (let i = 0; i < n; i++) { const sp = this.take(layer, t, 0xffffff); if (sp) { sp.alpha = 0; made.push(sp); } } };
      const n = Math.min(MAX_MOTES, plan.motes);
      fill('glow', tex.glow, n + 16); fill('body', plan.kind === 'harvest' ? tex.shard : tex.mote, n); fill('core', tex.streak, 44);
      if (plan.kind === 'reaping') fill('body', tex.shard, 30);
      for (const sp of made) this.give(sp);
    }
    for (let i = 0; i < MAX_MOTES; i++) this.motes.push({ s: null, g: null, age: 0, delay: 0, dur: 1, x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0, size: 1, phase: 0, shard: false, spin: 0 });
  }

  /** Motes and shards in flight (or waiting to lift off). Exposed for tests. */
  get liveMotes(): number { return this.flying; }
  /** Motes and shards that have reached the striker so far. */
  get arrived(): number { return this.arrivedN; }
  /** The stolen colours this scene carries. */
  get stolen(): readonly number[] { return this.hues; }
  /** Blades drawing this frame (Tiers 1-2). */
  get visibleBlades(): number { let n = 0; for (const b of this.blades) n += b.visible ? 1 : 0; return n; }
  /** Where blade `i` is drawn, or null when hidden. */
  bladePos(i: number): Pt | null { const b = this.blades[i]; return b && b.visible ? { x: b.position.x, y: b.position.y } : null; }
  /** Tiers 3-4: whether the great crescent draws this frame, its heel and its turn (null when hidden). */
  get crescentVisible(): boolean { return !!this.swBlade?.visible; }
  get crescentPose(): { x: number; y: number; rot: number } | null { const b = this.swBlade; return b && b.visible ? { x: b.position.x, y: b.position.y, rot: b.rotation } : null; }
  /** Tier 4: how much of the crescent is rainbow this frame (0 = teal). */
  get rainbowAlpha(): number { return this.swRain?.visible ? this.swRain.alpha : 0; }
  /** Tiers 3-4: afterimages drawing this frame. */
  get visibleGhosts(): number { let n = 0; for (const g of this.ghosts) n += g.visible ? 1 : 0; return n; }
  /** Tier 4: the line the cut leaves, and the bright front of the returning colour. */
  get lineVisible(): boolean { return !!this.lineS?.visible; }
  get frontVisible(): boolean { return !!this.frontS?.visible; }
  get frontPos(): Pt | null { const f = this.frontS; return f && f.visible ? { x: f.position.x, y: f.position.y } : null; }
  /** Tier 3: whether the orb draws, and its radius (px). */
  get orbVisible(): boolean { return !!this.orbS[0]?.visible; }
  get orbRadius(): number { const o = this.orbS[this.orbS.length - 2]; return o && o.visible ? (o.scale.x * this.tex.ring.width * 0.8) / 2 : 0; }
  /** Tier 3: gather drops drawing this frame. */
  get visibleDrops(): number { let n = 0; for (const d of this.drops) n += d.s.visible ? 1 : 0; return n; }
  /** Tier 4: ribbons drawing this frame, and ribbon `j`'s head (null when hidden). */
  get visibleRibbons(): number { let n = 0; for (const r of this.ribbons) n += r.core.visible ? 1 : 0; return n; }
  ribbonHead(j: number): Pt | null { const r = this.ribbons[j]; if (!r || !r.core.visible) return null; const p = r.pts[RIBBON_POINTS - 1]!; return { x: p.x, y: p.y }; }
  /** Tier 4: the cracks' opacity over the loser. */
  get cracksAlpha(): number { return this.cracksS?.visible ? this.cracksS.alpha : 0; }
  /** The striker's glow with the stolen colour (0 = none). */
  get auraAlpha(): number { const a = this.aura[0]; return a && a.visible ? a.alpha : 0; }

  // ── the frame (called from the clock's paint, so it is a pure function of the time) ─────────────────────────────

  draw(t: number, f: ReapingFrame): void {
    if (this.destroyed || !this.ownOn) return;
    this.setFoeOffset(f.foeX, f.foeY);
    const p = this.plan, g = this.geo, S = this.scale;
    if (p.kind === 'cut' || p.kind === 'cross') {
      const len = this.look.bladeSize * this.foe.r;
      const k = len / BLADE_TEX_W;
      for (let i = 0; i < this.blades.length; i++) {
        const b = this.blades[i]!, sh = this.shades[i]!;
        bladeAt(p, g, i, t, blade);
        b.visible = blade.visible; sh.visible = blade.visible;
        if (!blade.visible) continue;
        const flip = g.cuts[i]!.bow;
        b.position.set(blade.x, blade.y); b.rotation = blade.rot; b.scale.set(k, k * 1.5 * flip); b.alpha = blade.alpha;
        sh.position.set(blade.x + 3 * S, blade.y + 5 * S); sh.rotation = blade.rot; sh.scale.set(k * 1.04, k * 1.8 * flip); sh.alpha = 0.42 * blade.alpha;
      }
    } else if (g.swing) {
      this.drawSwing(t);
      if (p.kind === 'harvest') { this.drawOrb(t); this.drawDrops(t); this.drawEdge(t); }
      if (p.kind === 'reaping') { this.drawRibbons(t); this.drawLine(t); this.drawFront(t); this.drawCracks(t); }
    }
    this.drawAura(t);
  }

  /** Tiers 3-4: the great crescent (Tier 4: turning rainbow), its shade, its halo, the glint and the afterimages. */
  private drawSwing(t: number): void {
    const p = this.plan, s = this.geo.swing!, q = p.cuts[0]!, S = this.scale;
    const b = this.swBlade!, sh = this.swShade!, halo = this.swHalo!, gl = this.swGlint!;
    const rain = this.swRain, fr = this.swFringe;
    const r0 = s.arm - s.inner * s.blade;
    const kx = s.blade / ((CRESCENT_POINT_U - CRESCENT_HEEL_U) * CRESCENT_TEX_W);
    // Tier 3's crescent is a touch fatter for its length (it is the shorter one and must still read as HUGE).
    const wide = p.kind === 'harvest' ? 1.2 : 1;
    const L = swingLight(p, t, light);
    const on = L.a > 0.004;
    const rk = rain ? rainbowAt(p, t) : 0;
    b.visible = on; sh.visible = on; halo.visible = on; gl.visible = on;
    if (rain && fr) { rain.visible = on && rk > 0.004; fr.visible = rain.visible; }
    if (on) {
      let ang = swingAt(p, s, t);
      // Held: it strains against the hold (a few px of tremble at its middle; more once it blazes).
      if (p.heldAt !== null && t >= p.heldAt && t < q.startAt) ang += s.sgn * (((4 + 3 * rk) * S) / s.arm) * Math.sin(t * 0.11);
      const cx = Math.cos(ang), sy = Math.sin(ang);
      const hx = s.pivot.x + cx * r0, hy = s.pivot.y + sy * r0;
      const ky = kx * s.sgn * wide * (0.78 + 0.22 * L.build) * (1 + 0.12 * rk);
      b.position.set(hx, hy); b.rotation = ang; b.scale.set(kx, ky); b.alpha = L.a * (1 - 0.85 * rk);
      sh.position.set(hx + 3 * S, hy + 6 * S); sh.rotation = ang; sh.scale.set(kx * 1.03, ky * 1.25); sh.alpha = 0.5 * L.a;
      if (rain && fr && rain.visible) {
        rain.position.set(hx, hy); rain.rotation = ang; rain.scale.set(kx, ky); rain.alpha = L.a * rk;
        // The blaze: a larger copy breathing and shimmering about it (alive every frame).
        const br = 1.06 + 0.04 * Math.sin(t * 0.023);
        fr.position.set(hx - sy * 3 * S * Math.sin(t * 0.031), hy + cx * 3 * S * Math.sin(t * 0.031)); fr.rotation = ang;
        fr.scale.set(kx * br, ky * (1.18 + 0.1 * Math.sin(t * 0.017))); fr.alpha = L.a * rk * (0.5 + 0.2 * Math.sin(t * 0.041));
      }
      const gw = this.tex.glow.width;
      const mx = hx + cx * s.blade * 0.5, my = hy + sy * s.blade * 0.5;
      halo.position.set(mx, my); halo.rotation = ang; halo.scale.set((s.blade * 1.35) / gw, (s.blade * (0.26 + 0.2 * L.build + 0.14 * rk)) / gw);
      halo.alpha = L.a * (0.18 + 0.4 * L.build);
      // Blazing, the halo cycles through the stolen colours.
      halo.tint = rk > 0.02 ? this.hues[Math.floor(t / 90) % this.hues.length]! : this.colors.teal;
      // The light building: a glint runs from the heel to the point through the wind-up, and sits on the point after.
      const run = t < q.startAt ? L.build : 1;
      gl.position.set(hx + cx * s.blade * run, hy + sy * s.blade * run);
      gl.rotation = ang;
      const gk = (s.blade * (0.16 + 0.2 * run)) / gw;
      gl.scale.set(gk * 1.5, gk * 0.8); gl.alpha = L.a * (0.45 + 0.5 * run);
    }
    // The afterimages: each replays the pass a little later than the one before, so they fan out behind the edge.
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i]!;
      const tg = t - ghostLag(i + 1);
      const a = tg > q.startAt ? swingLight(p, tg, light).a : 0;
      g.visible = a > 0.004;
      if (!g.visible) continue;
      const ang = swingAt(p, s, tg);
      g.position.set(s.pivot.x + Math.cos(ang) * r0, s.pivot.y + Math.sin(ang) * r0);
      g.rotation = ang; g.scale.set(kx, kx * s.sgn * wide * (1 + 0.08 * (i + 1)));
      g.alpha = a * (rain ? 0.62 : 0.46) * (1 - i / (this.ghosts.length + 1.5));
    }
  }

  /** Tier 3: the orb of colour over the struck portrait: lobes of its hues swirling about a white heart. */
  private drawOrb(t: number): void {
    const v = orbAt(this.plan, t, orb);
    const on = v.a > 0.004 && v.k > 0.01;
    for (const s of this.orbS) s.visible = on;
    for (const s of this.orbMotes) s.visible = on;
    if (!on) return;
    const x = this.foe.x + this.fox, y = this.foe.y + this.foy;
    const R = this.foe.r * (this.look.orbSize ?? 1) * v.k * (1 + 0.035 * Math.sin(t * 0.03));
    const gw = this.tex.glow.width;
    for (let i = 0; i < ORB_LOBES; i++) {
      const s = this.orbS[i]!;
      const ang = t * (0.0042 + 0.0013 * i) * (i % 2 ? -1 : 1) + (i * Math.PI * 2) / ORB_LOBES;
      const off = R * (0.42 + 0.1 * Math.sin(t * 0.007 + i));
      s.position.set(x + Math.cos(ang) * off, y + Math.sin(ang) * off);
      s.scale.set((R * 1.7) / gw, (R * 1.15) / gw); s.rotation = ang; s.alpha = v.a;
    }
    const heart = this.orbS[ORB_LOBES]!, rim = this.orbS[ORB_LOBES + 1]!, glint = this.orbS[ORB_LOBES + 2]!;
    heart.position.set(x, y); heart.scale.set((R * 1.1) / gw); heart.alpha = 0.6 * v.a;
    rim.position.set(x, y); rim.scale.set((R * 2) / (this.tex.ring.width * 0.8)); rim.alpha = 0.55 * v.a;
    rim.tint = whiten(this.gathered[Math.floor(t / 110) % this.gathered.length]!, 0.5);
    for (let i = 0; i < this.orbMotes.length; i++) {
      const m = this.orbMotes[i]!;
      const ang = t * (0.006 + 0.0011 * (i % 4)) * (i % 2 ? 1 : -1) + i * 2.4;
      const rr = R * (0.25 + 0.55 * ((i * 0.37) % 1));
      m.position.set(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.9);
      m.rotation = ang + Math.PI / 2;
      m.scale.set((R * 0.34) / MOTE_TEX, (R * 0.14) / MOTE_TEX); m.alpha = v.a;
    }
    glint.position.set(x - R * 0.34, y - R * 0.38); glint.scale.set((R * 0.55) / gw, (R * 0.32) / gw); glint.rotation = -0.6; glint.alpha = 0.75 * v.a;
  }

  /** Tier 3: a soft ring of light on the edge of the closing grey (the seam where the colour is being taken). */
  private drawEdge(t: number): void {
    const e = this.edgeS, p = this.plan;
    if (!e || p.gatherAt === null || p.gatherEnd === null) return;
    const on = t >= p.gatherAt && t < p.gatherEnd + 160;
    e.visible = on;
    if (!on) return;
    const v = clamp01((t - p.gatherAt) / Math.max(1, p.gatherEnd - p.gatherAt));
    const R = gatherRadius(gatherAt01(v), this.dMax, this.foe.r);
    e.position.set(this.foe.x + this.fox, this.foe.y + this.foy);
    e.scale.set((R * 2) / (this.tex.ring.width * 0.8));
    e.tint = whiten(this.hues[Math.floor(t / 120) % this.hues.length]!, 0.35);
    e.alpha = 0.55 * Math.min(1, v / 0.15) * (1 - clamp01((t - p.gatherEnd) / 160));
  }

  /** Tier 3: the drops of the world's colour running in from the closing edge of the grey, spiralling into the orb. */
  private drawDrops(t: number): void {
    const x = this.foe.x + this.fox, y = this.foe.y + this.foy;
    const gw = this.tex.glow.width;
    for (const d of this.drops) {
      const v = (t - d.at) / d.dur;
      const on = v >= 0 && v < 1;
      d.s.visible = on; d.g.visible = on;
      if (!on) continue;
      // Accelerating inward, turning as it goes (a whirlpool).
      const e = v * v * (1.6 - 0.6 * v);
      const rad = d.rad * (1 - e) + this.foe.r * 0.2 * e;
      const ang = d.ang + d.swirl * e;
      const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
      // Heading: inward plus the swirl's tangent.
      const tx = -Math.cos(ang) * d.rad - Math.sin(ang) * d.swirl * rad, ty = -Math.sin(ang) * d.rad + Math.cos(ang) * d.swirl * rad;
      const a = Math.min(1, v / 0.12, (1 - v) / 0.1);
      d.s.position.set(px, py); d.s.rotation = Math.atan2(ty, tx);
      d.s.scale.set((d.size * (1.4 + 2.2 * e)) / MOTE_TEX, (d.size * (1 - 0.35 * e)) / MOTE_TEX); d.s.alpha = a;
      d.g.position.set(px, py); d.g.scale.set((d.size * 4) / gw); d.g.alpha = 0.6 * a;
    }
  }

  /** Tier 4: the ribbons of colour wound out of the portrait along their spiral, onto the blade. */
  private drawRibbons(t: number): void {
    const p = this.plan, s = this.geo.swing;
    if (!s || !this.ribbons.length) return;
    pa.x = this.foe.x + this.fox; pa.y = this.foe.y + this.foy;
    const ang = swingAt(p, s, t);
    pb.x = s.pivot.x + Math.cos(ang) * s.arm; pb.y = s.pivot.y + Math.sin(ang) * s.arm;
    const L = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const rr = Math.min(0.22 * L, 2.4 * this.foe.r);
    const twist = t * 0.0024;
    for (let j = 0; j < this.ribbons.length; j++) {
      const r = this.ribbons[j]!;
      ribbonSpan(p, j, t, span);
      const on = span.head - span.tail > 0.004;
      r.core.visible = on; r.glow.visible = on;
      if (!on) continue;
      for (let i = 0; i < RIBBON_POINTS; i++) {
        const sv = span.tail + ((span.head - span.tail) * i) / (RIBBON_POINTS - 1);
        ribbonPoint(pa, pb, j, sv, twist, rr, r.pts[i]!);
      }
      r.geoC.updateVertices(); r.geoG.updateVertices();
      // Fading in as it leaves the portrait, out as the last of it is reeled onto the blade.
      const a = Math.min(1, (span.head - span.tail) / 0.12);
      r.core.alpha = a; r.glow.alpha = 0.45 * a;
    }
  }

  /** Tier 4: the line the cut leaves across the whole screen: white, with the stolen colours fringed either side. */
  private drawLine(t: number): void {
    const l = this.geo.line!;
    const ls = this.lineS!, lsh = this.lineShade!;
    const v = lineAt(this.plan, t, scar);
    const on = v.a > 0.004;
    ls.visible = on; lsh.visible = on;
    for (const g of this.lineGlows) g.visible = on;
    if (!on) return;
    const S = this.scale;
    const len = Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y) * v.len;
    const mx = l.from.x + (l.to.x - l.from.x) * l.hitK, my = l.from.y + (l.to.y - l.from.y) * l.hitK;
    const thick = v.a * v.a;
    const nx = -Math.sin(l.angle), ny = Math.cos(l.angle);
    ls.position.set(mx, my); ls.rotation = l.angle; ls.scale.set(len / LINE_TEX_W, (40 * S * thick + 5 * S * v.a) / LINE_TEX_H); ls.alpha = v.a;
    for (let i = 0; i < this.lineGlows.length; i++) {
      const g = this.lineGlows[i]!;
      const off = (i - 1) * 22 * S * (0.5 + thick);
      g.position.set(mx + nx * off, my + ny * off); g.rotation = l.angle;
      g.scale.set(len / LINE_TEX_W, (150 * S * (0.35 + 0.65 * thick)) / LINE_TEX_H); g.alpha = 0.55 * v.a;
    }
    lsh.position.set(mx, my + 6 * S); lsh.rotation = l.angle; lsh.scale.set(len / LINE_TEX_W, (90 * S) / LINE_TEX_H); lsh.alpha = 0.4 * v.a;
  }

  /** Tier 4: the band of colours that runs with the edge of the returning colour (the veil's feathered edge). */
  private drawFront(t: number): void {
    const p = this.plan, fs = this.frontS!;
    const on = p.floodAt !== null && p.floodEnd !== null && t >= p.floodAt && t < p.floodEnd;
    fs.visible = on;
    for (const g of this.frontGlows) g.visible = on;
    if (!on) return;
    const S = this.scale, b = this.geo.bounds, u = this.geo.u;
    const f = easeInOutSine((t - p.floodAt!) / Math.max(1, p.floodEnd! - p.floodAt!));
    const at = veilSpan(b.w, b.h, 240 * S).frontAt(f);
    const x = b.w / 2 + u.x * at, y = b.h / 2 + u.y * at;
    const rot = Math.atan2(u.y, u.x) + Math.PI / 2;
    const len = Math.hypot(b.w, b.h) * 1.15;
    // Brightest through the middle of the crossing; it comes and goes with the wave.
    const env = Math.pow(Math.sin(Math.PI * clamp01(f)), 0.6);
    fs.position.set(x, y); fs.rotation = rot; fs.scale.set(len / LINE_TEX_W, (200 * S) / LINE_TEX_H); fs.alpha = 0.3 * env;
    for (let i = 0; i < this.frontGlows.length; i++) {
      const g = this.frontGlows[i]!;
      // The colours in bands BEHIND the edge (the side the colour has already come back to).
      const back = (i + 0.5) * 90 * S;
      g.position.set(x - u.x * back, y - u.y * back); g.rotation = rot;
      g.scale.set(len / LINE_TEX_W, (260 * S) / LINE_TEX_H); g.alpha = 0.55 * env;
    }
  }

  /** Tier 4: the loser cracks like old paint (pure in time; it rides the portrait's knock). */
  private drawCracks(t: number): void {
    const c = this.cracksS;
    if (!c) return;
    const a = crackAt(this.plan, t);
    c.visible = a > 0.004;
    if (!c.visible) return;
    c.position.set(this.foe.x + this.fox, this.foe.y + this.foy);
    c.scale.set((this.foe.r * 2 * 0.98 * (0.97 + 0.03 * a)) / CRACK_TEX);
    c.alpha = 0.9 * a;
  }

  /** Every tier: the striker glows with the stolen colour, its hues turning slowly about it. */
  private drawAura(t: number): void {
    const v = stolenAt(this.plan, t) * this.tierAura;
    const on = v > 0.004;
    for (const s of this.aura) s.visible = on;
    if (!on) return;
    const { x, y, r } = this.hero;
    const rw = this.tex.ring.width * 0.8;
    for (let i = 0; i < AURA_LOBES; i++) {
      const s = this.aura[i]!;
      // Each hue's ring sits a little off the middle and turns, so the rim shifts colour as it goes round.
      const ang = t * 0.0032 + (i * Math.PI * 2) / AURA_LOBES;
      s.position.set(x + Math.cos(ang) * r * 0.06, y + Math.sin(ang) * r * 0.06);
      s.scale.set((r * 2 * (1.12 + 0.05 * Math.sin(t * 0.009 + i * 2))) / rw);
      s.alpha = Math.min(0.7, 0.45 * v);
    }
    const ring = this.aura[AURA_LOBES]!;
    ring.position.set(x, y); ring.scale.set((r * 2 * (1.02 + 0.02 * Math.sin(t * 0.012))) / rw);
    ring.alpha = Math.min(0.8, 0.45 * v);
    ring.tint = whiten(this.hues[Math.floor(t / 140) % this.hues.length]!, 0.45);
  }

  // ── the beats ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Tiers 1-2: a blade crosses the middle of the portrait: a hairline of bone light, a breath of teal, and a spray of
   * the portrait's colour flung off the cut. */
  cross(i: number, weight = 1): void {
    const n = this.geo.cuts[i];
    if (this.destroyed || !n) return;
    const { x, y, r } = this.foe;
    const S = this.scale;
    const len = 2.5 * r;
    this.spawn('core', this.tex.line, whiten(this.colors.bone, 0.3), x, y, {
      dur: 300, from: len / LINE_TEX_W / S, to: (len * 1.12) / LINE_TEX_W / S, a0: 0.95, mode: 'out', ease: 'cubic', sy: (7 * S * LINE_TEX_W) / (LINE_TEX_H * len), rot: n.angle, follow: true,
    });
    this.spawn('glow', this.tex.glow, this.colors.teal, x, y, {
      dur: 420, from: (r * 1.2) / this.tex.glow.width / S, to: (r * 2.6 * weight) / this.tex.glow.width / S, a0: 0.4 * weight, mode: 'punch', peakAt: 0.15, ease: 'cubic', follow: true,
    });
    // The colour flies off the cut both ways, like spray off a blade.
    const nn = Math.round(8 * weight);
    this.burst('core', this.tex.mote, this.hues, x, y, nn, { speed: 620, dir: n.angle, spread: 0.7, life: 380, size: 0.42, to: 0.2, drag: 0.05, align: true });
    this.burst('core', this.tex.mote, this.hues, x, y, Math.round(nn / 2), { speed: 480, dir: n.angle + Math.PI, spread: 0.8, life: 320, size: 0.36, to: 0.2, drag: 0.05, align: true });
  }

  /** Tiers 3-4: the great crescent IGNITES where it will be held: a long flare of teal along it. */
  ignite(): void {
    const s = this.geo.swing;
    if (this.destroyed || !s) return;
    const S = this.scale, gw = this.tex.glow.width;
    const ang = s.a0 + s.sgn * s.back;
    const rm = s.arm - s.inner * s.blade + s.blade * 0.5;
    const x = s.pivot.x + Math.cos(ang) * rm, y = s.pivot.y + Math.sin(ang) * rm;
    this.spawn('glow', this.tex.glow, this.colors.teal, x, y, { dur: 460, from: (s.blade * 0.5) / gw / S, to: (s.blade * 1.5) / gw / S, a0: 0.55, mode: 'punch', peakAt: 0.18, ease: 'cubic', sy: 0.3, rot: ang });
    this.spawn('core', this.tex.glow, whiten(this.colors.teal, 0.7), x, y, { dur: 240, from: (s.blade * 0.3) / gw / S, to: (s.blade * 1.1) / gw / S, a0: 0.5, mode: 'out', ease: 'cubic', sy: 0.14, rot: ang });
  }

  /** Tier 3: the orb begins: a breath of every hue opens over the portrait and a ring draws in to it. */
  orbBegin(): void {
    if (this.destroyed) return;
    const { x, y, r } = this.foe;
    const S = this.scale, gw = this.tex.glow.width, rw = this.tex.ring.width * 0.8;
    this.spawn('core', this.tex.ring, whiten(this.hues[0]!, 0.5), x, y, { dur: 520, from: (r * 4) / rw / S, to: (r * 1.2) / rw / S, a0: 0.55, mode: 'punch', peakAt: 0.3, ease: 'cubic', follow: true });
    this.spawn('glow', this.tex.glow, this.hues[1 % this.hues.length]!, x, y, { dur: 600, from: (r * 0.6) / gw / S, to: (r * 2.6) / gw / S, a0: 0.45, mode: 'punch', peakAt: 0.3, ease: 'cubic', follow: true });
  }

  /** Tiers 3-4: the crescent is fully lit and held: a white glint bursts on its point (Tier 4: in every colour). */
  held(): void {
    const s = this.geo.swing;
    if (this.destroyed || !s) return;
    const S = this.scale, gw = this.tex.glow.width;
    const r1 = s.arm + (1 - s.inner) * s.blade;
    const x = s.pivot.x + Math.cos(s.a0) * r1, y = s.pivot.y + Math.sin(s.a0) * r1;
    const k = (v: number): number => v / gw / S;
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 260, from: k(s.blade * 0.1), to: k(s.blade * 0.5), a0: 0.95, mode: 'out', ease: 'cubic' });
    this.spawn('core', this.tex.glow, whiten(this.colors.teal, 0.5), x, y, { dur: 320, from: k(s.blade * 0.2), to: k(s.blade * 0.9), a0: 0.7, mode: 'out', ease: 'cubic', sy: 0.12, rot: s.a0 + Math.PI / 2 });
    if (this.plan.kind === 'reaping') {
      // The blade blazes: its colours flare along it and sparks of them fly off.
      const rm = s.arm - s.inner * s.blade + s.blade * 0.5;
      const mx = s.pivot.x + Math.cos(s.a0) * rm, my = s.pivot.y + Math.sin(s.a0) * rm;
      for (let i = 0; i < 3; i++) {
        this.spawn('glow', this.tex.glow, this.hues[i % this.hues.length]!, mx, my, { dur: 520, from: k(s.blade * 0.5), to: k(s.blade * (1.3 + 0.2 * i)), a0: 0.5, mode: 'punch', peakAt: 0.2, ease: 'cubic', sy: 0.28, rot: s.a0, delay: i * 60 });
      }
      this.burst('core', this.tex.mote, this.hues, mx, my, 18, { speed: 700, spread: 6.3, life: 520, size: 0.5, to: 0.2, drag: 0.08, align: true });
    }
  }

  /**
   * Tiers 3-4: THE CUT. A white flash on the portrait, a deep bloom under it, two shock rings opening from the blow, a
   * hairline of bone light along the cut and sparks thrown along it. `weight` scales it (Tier 3 1, Tier 4 about 1.5);
   * Tier 4 also flashes the whole screen for a moment and sends a third, slow ring right across it, and its sparks and
   * rings are the stolen colours.
   */
  strike(weight = 1): void {
    const n = this.geo.cuts[this.geo.cuts.length - 1];
    if (this.destroyed || !n || this.plan.reduced) return;
    const { x, y, r } = this.foe;
    const S = this.scale, gw = this.tex.glow.width;
    const big = this.plan.kind === 'reaping';
    const g = (v: number): number => v / gw / S;
    const ring = (v: number): number => v / (this.tex.ring.width * 0.8) / S;
    const teal = this.colors.teal, hot = whiten(teal, 0.75);
    const h0 = this.hues[0]!, h1 = this.hues[1 % this.hues.length]!;
    const shard = this.plan.kind === 'harvest';
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 170, from: g(r * 2.6), to: g(r * 3.8 * weight), a0: shard ? 0.6 : 0.9, mode: 'out', ease: 'cubic', follow: true });
    if (!shard) {
      // (Tier 3's rings are the shatter's own, in the orb's colours.)
      this.spawn('glow', this.tex.glow, big ? h0 : teal, x, y, { dur: 700, from: g(r * 3), to: g(r * 7.5 * weight), a0: 0.55, mode: 'punch', peakAt: 0.1, ease: 'cubic', follow: true });
      this.spawn('core', this.tex.ring, hot, x, y, { dur: 520, from: ring(r * 1.6), to: ring(r * 6 * weight), a0: 0.9, mode: 'out', ease: 'quint' });
      this.spawn('glow', this.tex.ring, big ? h1 : teal, x, y, { dur: 900, from: ring(r * 2), to: ring(r * 10 * weight), a0: 0.45, mode: 'out', ease: 'cubic', delay: 70 });
    }
    const len = (big ? 5 : 4.4) * r;
    this.spawn('core', this.tex.line, whiten(this.colors.bone, 0.4), x, y, {
      dur: 420, from: len / LINE_TEX_W / S, to: (len * 1.25) / LINE_TEX_W / S, a0: 1, mode: 'out', ease: 'cubic', sy: (26 * S * LINE_TEX_W) / (LINE_TEX_H * len), rot: n.angle, follow: true,
    });
    // Sparks of the cut, thrown the way the edge was going (and a few the other way).
    const count = Math.round(12 * weight);
    const tints = big ? [...this.hues, hot] : shard ? this.gathered : [hot, teal, whiten(this.colors.bone, 0.2)];
    this.burst('core', this.tex.streak, tints, x, y, count, { speed: 1150 * weight, dir: n.angle, spread: 1.5, life: 520, size: 0.62, to: 0.2, drag: 0.08, align: true });
    this.burst('core', this.tex.streak, big ? this.hues : [teal, hot], x, y, Math.round(count / 2), { speed: 700, dir: n.angle + Math.PI, spread: 1.9, life: 420, size: 0.5, to: 0.2, drag: 0.1, align: true });
    if (big) {
      const span2 = Math.hypot(this.geo.bounds.w, this.geo.bounds.h);
      this.spawn('core', this.tex.glow, hot, x, y, { dur: 220, from: g(span2 * 0.9), to: g(span2 * 1.5), a0: 0.3, mode: 'out', ease: 'cubic' });
      this.spawn('glow', this.tex.ring, this.hues[2 % this.hues.length]!, x, y, { dur: 1300, from: ring(r * 3), to: ring(span2 * 1.1), a0: 0.32, mode: 'out', ease: 'cubic', delay: 120 });
      // The paint gives: a puff of grey dust off the portrait as it cracks.
      this.burst('body', this.tex.shard, [0x9a958c, 0x6e6a63, 0xc4bfb4], x, y, 12, { speed: 420, spread: 6.3, life: 600, size: 0.28, to: 0.6, drag: 0.15, grav: 900, spin: 0.02, flip: 0.02 });
    }
  }

  /**
   * Tier 3: THE SHATTER. The orb bursts: a white flash, its colours thrown out as glows and rings, and `n` glass SHARDS
   * of its hues that burst out (mostly the way the edge went) and are drawn into the striker.
   */
  shatter(n: number): void {
    const cut = this.geo.cuts[this.geo.cuts.length - 1];
    if (this.destroyed || !cut || this.plan.reduced) return;
    const { x, y, r } = this.foe;
    const S = this.scale, gw = this.tex.glow.width, rw = this.tex.ring.width * 0.8;
    const R = r * (this.look.orbSize ?? 1);
    this.strike(1);
    for (let i = 0; i < 3; i++) {
      const hue = this.gathered[i % this.gathered.length]!;
      this.spawn('glow', this.tex.glow, hue, x, y, { dur: 520 + 100 * i, from: (R * 1.6) / gw / S, to: (R * (3.6 + 1.2 * i)) / gw / S, a0: 0.5, mode: 'punch', peakAt: 0.08, ease: 'cubic', delay: i * 40 });
      this.spawn('core', this.tex.ring, whiten(hue, 0.3), x, y, { dur: 480 + 120 * i, from: (R * 1.1) / rw / S, to: (R * (3.2 + 1.3 * i)) / rw / S, a0: 0.6, mode: 'out', ease: 'quint', delay: 30 + i * 70 });
    }
    // Sparkles of every gathered colour, every way.
    this.burst('core', this.tex.mote, this.gathered, x, y, 26, { speed: 1000, spread: 6.3, life: 600, size: 0.55, to: 0.15, drag: 0.08, align: true });
    // The shards: thrown out, then drawn into the striker.
    const dx = this.hero.x - x, dy = this.hero.y - y;
    let made = 0;
    for (const m of this.motes) {
      if (made >= n) break;
      if (m.s) continue;
      const tint = this.gathered[made % this.gathered.length]!;
      const g = this.take('glow', this.tex.glow, tint);
      const s = this.take('body', this.tex.shard, whiten(tint, 0.15));
      if (!s || !g) { this.give(s); this.give(g); break; }
      // Out: mostly the way the edge went (a cone), some every way.
      const a = made % 3 === 0 ? this.rnd() * Math.PI * 2 : cut.angle + (this.rnd() - 0.5) * 2.2;
      const out = R * (2.4 + this.rnd() * 3.2);
      const a0 = this.rnd() * Math.PI * 2, r0 = Math.sqrt(this.rnd()) * R * 0.6;
      m.x0 = x + Math.cos(a0) * r0; m.y0 = y + Math.sin(a0) * r0;
      m.cx = x + Math.cos(a) * out + dx * 0.15; m.cy = y + Math.sin(a) * out + dy * 0.15;
      m.x1 = this.hero.x + (this.rnd() - 0.5) * this.hero.r * 0.6; m.y1 = this.hero.y + (this.rnd() - 0.5) * this.hero.r * 0.6;
      m.age = 0; m.delay = this.rnd() * 60;
      m.dur = (this.look.shardMs ?? 1000) * (0.8 + this.rnd() * 0.4);
      m.size = (made % 5 === 0 ? 92 : 46 + this.rnd() * 34) * S;
      m.phase = this.rnd() * Math.PI * 2;
      m.shard = true; m.spin = (this.rnd() - 0.5) * 0.03;
      s.alpha = 0; s.position.set(m.x0, m.y0); s.rotation = a;
      g.alpha = 0; g.position.set(m.x0, m.y0);
      m.s = s; m.g = g; this.flying++; made++;
    }
  }

  /**
   * The portrait's colour leaves it: `n` motes lift off (inside cut `along`'s strip when given, anywhere on the face
   * otherwise), spread over `spanMs`, and stream into the striker. `fat` scales them (a plume), and `tear` (px) throws
   * them out along a direction first, so the colour is TORN out before it is pulled across. `from` starts them
   * somewhere else than the portrait (Tier 4: along the line the rainbow blade cut).
   */
  stream(n: number, spanMs: number, along: number | null = null, fat = 1, tear: Pt | null = null, from: { x: number; y: number; dx: number; dy: number; len: number } | null = null): void {
    if (this.destroyed || this.plan.reduced) return;
    const { x, y, r } = this.foe;
    const cut = along !== null ? this.geo.cuts[along] : null;
    const hw = this.look.stripWidth * r * 0.5;
    const dx = this.hero.x - x, dy = this.hero.y - y;
    const dist = Math.hypot(dx, dy) || 1;
    const nrm = this.geo.nrm;
    let made = 0;
    for (const m of this.motes) {
      if (made >= n) break;
      if (m.s) continue;
      const tint = this.hues[made % this.hues.length] ?? 0xffb24a;
      // A solid fleck of the stolen colour (it must read over a pale board as well as a grey one) in a soft halo of it.
      const g = this.take('glow', this.tex.glow, tint);
      const s = this.take('body', this.tex.mote, whiten(tint, 0.25));
      if (!s || !g) { this.give(s); this.give(g); break; }
      if (from) {
        const k = (this.rnd() - 0.5) * from.len;
        m.x0 = from.x + from.dx * k + (this.rnd() - 0.5) * 20 * this.scale; m.y0 = from.y + from.dy * k + (this.rnd() - 0.5) * 20 * this.scale;
      } else if (cut) {
        const al = (this.rnd() - 0.5) * 1.5 * r, ac = (this.rnd() - 0.5) * 2 * hw;
        m.x0 = x + cut.dir.x * al - cut.dir.y * ac; m.y0 = y + cut.dir.y * al + cut.dir.x * ac;
      } else {
        const ang = this.rnd() * Math.PI * 2, rad = Math.sqrt(this.rnd()) * r * 0.8;
        m.x0 = x + Math.cos(ang) * rad; m.y0 = y + Math.sin(ang) * rad;
      }
      // Each bows its own way (mostly toward the top of the screen), and lands somewhere on the striker's face.
      const bow = (0.08 + this.rnd() * 0.2) * (this.rnd() < 0.8 ? 1 : -0.6);
      m.cx = (m.x0 + this.hero.x) / 2 + nrm.x * bow * dist; m.cy = (m.y0 + this.hero.y) / 2 + nrm.y * bow * dist - r * 0.3;
      m.x1 = this.hero.x + (this.rnd() - 0.5) * this.hero.r * 0.5; m.y1 = this.hero.y + (this.rnd() - 0.5) * this.hero.r * 0.5;
      m.age = 0; m.delay = n <= 1 ? 0 : (spanMs * made) / (n - 1) * (0.8 + this.rnd() * 0.2);
      m.dur = this.look.moteMs * (0.85 + this.rnd() * 0.4) * Math.min(1.25, Math.max(0.6, Math.sqrt(dist / 1600)));
      m.size = this.look.moteSize * (15 + this.rnd() * 11) * this.scale * fat;
      m.phase = this.rnd() * Math.PI * 2;
      m.shard = false; m.spin = 0;
      if (tear) {
        // Torn out along the cut: the path first heads the way the edge went, fanned a little.
        const fan = 0.5 + ((made * 7) % 10) / 10;
        m.cx += tear.x * fan; m.cy += tear.y * fan;
        // A plume has BODY: every fourth mote is a big soft one.
        if (made % 4 === 0) m.size *= 2;
      }
      s.alpha = 0; s.position.set(m.x0, m.y0); s.rotation = 0;
      g.alpha = 0; g.position.set(m.x0, m.y0);
      m.s = s; m.g = g; this.flying++; made++;
    }
  }

  /**
   * Tier 4: the bell tolls: a ring of light opens from the striker across the whole screen, a second behind it, and
   * the striker flares.
   */
  toll(): void {
    if (this.destroyed) return;
    const S = this.scale;
    const span2 = Math.hypot(this.geo.bounds.w, this.geo.bounds.h);
    const k = (v: number): number => v / (this.tex.ring.width * 0.8) / S;
    const g = (v: number): number => v / this.tex.glow.width / S;
    const { x, y, r } = this.hero;
    this.spawn('core', this.tex.ring, whiten(this.colors.teal, 0.6), x, y, { dur: 1000, from: k(r * 2), to: k(span2 * 0.95), a0: 0.36, mode: 'out', ease: 'cubic' });
    this.spawn('glow', this.tex.ring, this.colors.teal, x, y, { dur: 1200, from: k(r * 2), to: k(span2 * 0.8), a0: 0.12, mode: 'out', ease: 'cubic', delay: 110 });
    this.spawn('glow', this.tex.glow, this.colors.teal, x, y, { dur: 800, from: g(r * 2.4), to: g(r * 6), a0: 0.6, mode: 'punch', peakAt: 0.12, ease: 'cubic' });
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 200, from: g(r * 1.6), to: g(r * 3), a0: 0.55, mode: 'out', ease: 'cubic' });
  }

  /** Tier 4: the ribbons start out of the portrait: its colour flares on it (the last colour in the world, pulled). */
  ribbonsBegin(): void {
    if (this.destroyed) return;
    const { x, y, r } = this.foe;
    const S = this.scale, gw = this.tex.glow.width;
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.glow, this.hues[i % this.hues.length]!, x, y, { dur: 900, from: (r * 1.6) / gw / S, to: (r * 3.4) / gw / S, a0: 0.5, mode: 'punch', peakAt: 0.25, ease: 'cubic', follow: true, delay: i * 110 });
    }
    this.burst('core', this.tex.mote, this.hues, x, y, 14, { speed: 380, spread: 6.3, life: 700, size: 0.4, to: 0.2, drag: 0.1 });
  }

  /** Tier 4: colour floods back: rings of the stolen colours open from the striker, with a scatter of sparks. */
  flood(): void {
    if (this.destroyed) return;
    const S = this.scale;
    const span2 = Math.hypot(this.geo.bounds.w, this.geo.bounds.h);
    const k = (v: number): number => v / (this.tex.ring.width * 0.8) / S;
    const { x, y, r } = this.hero;
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.ring, this.hues[i % this.hues.length]!, x, y, { dur: 800 + 120 * i, from: k(r * 2), to: k(span2 * (0.9 - 0.1 * i)), a0: 0.32, mode: 'out', ease: 'cubic', delay: i * 90 });
    }
    this.spawn('glow', this.tex.glow, this.hues[0]!, x, y, { dur: 520, from: (r * 2.4) / this.tex.glow.width / S, to: (r * 5.5) / this.tex.glow.width / S, a0: 0.6, mode: 'punch', peakAt: 0.15, ease: 'cubic' });
    this.burst('core', this.tex.streak, this.hues, x, y, 18, { speed: 900, dir: Math.atan2(this.geo.u.y, this.geo.u.x), spread: 2.2, life: 560, size: 0.5, to: 0.2, drag: 0.12, align: true });
  }

  /** Tier 4: the loser's colour comes back: the cracked paint flakes off and falls away. */
  flake(): void {
    if (this.destroyed || this.plan.kind !== 'reaping') return;
    const { x, y, r } = this.foe;
    for (let i = 0; i < 26; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * r * 0.9;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      this.spawn('body', this.tex.shard, i % 3 === 0 ? 0x5e5a54 : i % 3 === 1 ? 0x8f8a80 : 0xb9b3a6, px, py, {
        dur: 700 + this.rnd() * 400, from: 0.25 + this.rnd() * 0.25, to: 0.2, a0: 0.95, mode: 'hold', ease: 'linear',
        vx: Math.cos(a) * 90, vy: -120 - this.rnd() * 120, grav: 1500, drag: 0.6, rot: this.rnd() * Math.PI * 2, spin: (this.rnd() - 0.5) * 0.02, flip: 0.012 + this.rnd() * 0.01,
        edgeTint: 0x2a2826, follow: true,
      });
    }
  }

  protected override tick(dt: number): boolean {
    if (!this.flying) return false;
    for (const m of this.motes) {
      const s = m.s;
      if (!s) continue;
      if (m.delay > 0) { m.delay -= dt; if (m.delay > 0) continue; }
      m.age += dt;
      const v = clamp01(m.age / m.dur);
      let e: number;
      if (m.shard) {
        // Out fast, a hang at the far point, then in fast.
        e = v + 0.15 * Math.sin(2 * Math.PI * v);
        s.rotation += m.spin * dt;
      } else {
        // It lifts off and hangs a moment, then is drawn in, faster and faster.
        e = 0.12 * v + 0.88 * v * v * v;
      }
      const q = 1 - e;
      const wob = m.shard ? 0 : Math.sin(m.phase + m.age * 0.008) * 6 * this.scale * (1 - e);
      const lift = m.shard ? 0 : 14 * this.scale * Math.sin(Math.min(1, v * 3) * Math.PI * 0.5) * (1 - e);
      s.position.set(q * q * m.x0 + 2 * q * e * m.cx + e * e * m.x1 + wob, q * q * m.y0 + 2 * q * e * m.cy + e * e * m.y1 - lift);
      s.alpha = Math.min(1, v / (m.shard ? 0.03 : 0.1), (1 - v) / 0.08);
      if (m.shard) {
        // A glint as it turns: its width flickers like a facet catching the light.
        const flick = 0.45 + 0.55 * Math.abs(Math.cos(m.phase + m.age * 0.02));
        const sz = m.size * (1 - 0.35 * e);
        s.scale.set(sz / SHARD_TEX_W, (sz * 0.34 * flick) / SHARD_TEX_W * 3);
      } else s.scale.set((m.size * (1 - 0.4 * e)) / MOTE_TEX);
      const g = m.g;
      if (g) { g.position.copyFrom(s.position); g.alpha = (m.shard ? 0.5 : 0.55) * s.alpha; g.scale.set((m.size * (m.shard ? 1.6 : 3.2) * (1 - 0.4 * e)) / this.tex.glow.width); }
      if (v >= 1) {
        this.give(s); this.give(g); m.s = null; m.g = null; this.flying--; this.arrivedN++;
        // The striker takes it in: a small glint of its colour where it landed (every third, so a stream does not strobe).
        if (this.arrivedN % 3 === 1) {
          this.spawn('glow', this.tex.glow, s.tint, m.x1, m.y1, { dur: 260, from: (this.hero.r * 0.5) / this.tex.glow.width / this.scale, to: (this.hero.r * 1.3) / this.tex.glow.width / this.scale, a0: 0.32, mode: 'punch', peakAt: 0.25, ease: 'cubic' });
        }
      }
    }
    return this.flying > 0;
  }

  /** Hide everything this scene draws itself (the sequence is over; the motes and glints drain on their own). */
  hideOwn(): void {
    this.ownOn = false;
    for (const s of [...this.blades, ...this.shades, ...this.ghosts, ...this.lineGlows, ...this.frontGlows, ...this.orbS, ...this.aura,
      ...this.orbMotes, this.swBlade, this.swShade, this.swHalo, this.swGlint, this.swRain, this.swFringe, this.lineS, this.lineShade, this.frontS, this.cracksS]) {
      if (s) s.visible = false;
    }
    for (const d of this.drops) { d.s.visible = false; d.g.visible = false; }
    if (this.edgeS) this.edgeS.visible = false;
    for (const r of this.ribbons) { r.core.visible = false; r.glow.visible = false; }
  }

  protected override clearOwn(): void {
    this.hideOwn();
    for (const m of this.motes) { if (m.s) { this.give(m.s); this.give(m.g); m.s = null; m.g = null; } }
    this.flying = 0;
  }

  override destroy(): void {
    const geos = this.ribbons.flatMap((r) => [r.geoC, r.geoG]);
    super.destroy();
    for (const g of geos) g.destroy();
    this.ribbons.length = 0;
  }
}

