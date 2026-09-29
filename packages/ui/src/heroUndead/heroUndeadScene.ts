/**
 * THE UNDEAD SCENE: everything the Undead (Grave Call) hero attack draws in Pixi, as a plain scene graph with no renderer,
 * so it runs (and is tested) headless. `heroUndead.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (the Arcana bar: one hero element per beat, drawn as geometry; particles only as seasoning):
 *  - THE RAISE: a necrotic grave circle turns on the board under the striking hero, grave smoke circles its rim and ghost
 *    wisps spiral in; it flares when the dead answer.
 *  - THE SKULL: a spectral skull in three aligned layers (a purple-black body a touch larger than the rest, so it keeps a
 *    dark rim on the light board; a sickly green additive fill; bone-white line work on top) plus a soft green halo and
 *    two burning eyes. Its jaw is its own piece on the same hinge: it DROPS to shriek, hangs open in flight and SNAPS
 *    shut to bite. It flies on a slight arc with a wobble, trailing AFTERIMAGES (its silhouette sampled from where it
 *    was) and shedding wisps. The bite: a short flash, a spectral echo of the skull swelling off it, a ring, bone shards
 *    and a swirl of wisps.
 *  - WISPS are alive: a bright head, a feathered tail stretched along its velocity (longer the faster it goes), an echo
 *    a beat behind it, and a wander across its heading, so they curl and drift instead of flying straight.
 *  - THE HANDS (III): skeletal hands claw up out of dark holes round the target (they grow out of the board, flat, reaching
 *    in), grip, and drag at it, trembling; they shatter into bone on the blow.
 *  - THE RIFT (IV): a jagged void tears open across the board, lit green inside, cracks racing off it, grave dust and
 *    motes pouring up; the MAW (the same skull, huge) rises out of it, its eyes ignite, it shrieks (shriek rings), lunges
 *    trailing afterimages, and chomps. Then a wave of necrotic MIST washes out across the board.
 *
 * LAYERS, bottom to top: ground (normal: the dark bodies on the board, circle lines, holes, cracks, the rift's void) |
 * under (additive: glows behind things) | body (normal: the skull bodies, the bones, the mist) | glow (additive: the green
 * fills, afterimages, wisp tails) | hot (additive: edges, eyes, flashes, wisp heads). Every sprite is pooled per layer.
 *
 * Contract: sprites are POOLED per layer (hidden and reused) and bounded by `MAX_UNDEAD_SPRITES`; textures are the
 * caller's and are pre-warmed at construction (a near-invisible sprite each while the damage formation plays, so no
 * texture uploads on the first skull); positions are the overlay's px; `setCamera` mirrors the DOM camera; `update`
 * returns whether anything still draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay throws the same
 * wisps). Everything is FLAT (rotation and scale only; never a skew).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { skullAt, type HandSpot, type SkullPath, type WispPath } from './heroUndeadConfig';
import {
  EYE_OFFSETS, GLOW_H, GLOW_HINGE_Y, HAND_H, HAND_WRIST_Y, HINGE_Y, CRANIUM_H, JAW_DROP, SKULL_CENTRE_ABOVE_HINGE, SKULL_SPAN,
  WISP_HEAD_X,
} from './heroUndeadTextures';

export interface HeroUndeadTextures extends HeroArcanaTextures {
  cranium: Texture; craniumEdge: Texture; jaw: Texture; jawEdge: Texture; skullGlow: Texture;
  wisp: Texture; hand: Texture; necro: Texture; rift: Texture; riftEdge: Texture; crack: Texture; mist: Texture; shard: Texture;
}

export interface UndeadColors { core: number; ghost: number; teal: number; void: number; bone: number; side: number }

export interface UndeadLook {
  circleSize: number; circleSpin: number; smokeRing: number;
  skullWobble: number; afterimages: number; shedWisps: number; echoSize: number;
  wispLife: number; wispWander: number; wispSize: number;
  handSize: number;
}

/** Hard cap on sprites alive at once (a Tier IV chomp and mist wave peaks around 400). */
export const MAX_UNDEAD_SPRITES = 900;

type LayerId = 'ground' | 'under' | 'body' | 'glow' | 'hot';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['ground', 'normal'], ['under', 'add'], ['body', 'normal'], ['glow', 'add'], ['hot', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const NECRO_PX = 256 * 0.93; // the circle's outer ring spans 0.93 of its box
const GLOW_PX = 128;
const RING_PX = 160 * 0.8;
const MIST_PX = 64;
const RIFT_W = 256, RIFT_H = 96;
const HAND_LEN = HAND_WRIST_Y - 8;

type Ease = (u: number) => number;

/** Turn and scale a sprite in the screen plane: FLAT (no skew, no perspective squash). Pure transform. */
export function flatTransform(s: Sprite, th: number, sx: number, sy: number): void {
  s.rotation = th;
  s.skew.set(0, 0);
  s.scale.set(sx, sy);
}

interface Fx {
  s: Sprite; age: number; delay: number; dur: number;
  sx0: number; sx1: number; sy0: number; sy1: number; ease: Ease;
  a0: number; inMs: number; outFrom: number;
  rot: number; spin: number; flick: number; phase: number;
  x: number; y: number; vx: number; vy: number;
}
type FxOpts = Partial<Omit<Fx, 's' | 'age' | 'x' | 'y'>> & { dur: number; from: number; to: number; ry?: number; a0: number; ax?: number; ay?: number };

interface Held {
  s: Sprite; tag: string; age: number; a: number; inMs: number;
  g0: number; g1: number; gMs: number; back: boolean; ry: number; rot: number; spin: number;
  pulse: number; phase: number; kick: number; kickAge: number;
  fadeT: number; fadeMs: number; flare: number;
  /** A crack: its length (x scale); `ry` is its width. */
  len?: number;
}
type HeldOpts = Partial<Omit<Held, 's' | 'tag' | 'age' | 'fadeT' | 'kick' | 'kickAge'>> & { a: number; g1: number; ax?: number; ay?: number };

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number; spin: number; align: boolean;
}

/**
 * A ghost wisp: a head, a tail stretched along its velocity and an echo a beat behind. FREE wisps drift (velocity, drag,
 * a rise and a wander across their heading); PATH wisps (the Tier III swarm) ride a bent curve to their target and
 * arrive on the planned beat.
 */
interface Wisp {
  head: Sprite; tail: Sprite; echo: Sprite;
  x: number; y: number; vx: number; vy: number; drag: number; grav: number; wander: number; phase: number;
  life: number; max: number; size: number; alpha: number;
  path: (WispPath & { dur: number }) | null;
  hx: number[]; hy: number[]; hi: number; hAcc: number;
}

type SkullPhase = 'emerge' | 'hover' | 'fly' | 'rise' | 'hold' | 'shriek' | 'lunge' | 'chomp' | 'die';

/** A spectral skull (a flying skull, or the Tier IV maw): its pieces, where it is, its jaw, what it is doing. */
interface Skull {
  id: number;
  body: Sprite; jawBody: Sprite; fill: Sprite; jawFill: Sprite; edge: Sprite; jawEdge: Sprite; halo: Sprite; eyes: Sprite[];
  ghosts: Sprite[];
  x: number; y: number; k: number; k0: number; k1: number; rot: number; open: number; alpha: number; eyeA: number;
  phase: SkullPhase; age: number; dur: number;
  from: Pt; to: Pt; path: SkullPath | null; wob: number;
  hx: number[]; hy: number[]; hi: number; hAcc: number; shedAcc: number; maw: boolean;
}

/** A skeletal hand clawing up round the target. */
interface Hand {
  hole: Sprite; shadow: Sprite; bone: Sprite; glow: Sprite;
  at: Pt; ang: number; len: number; age: number; rise: number; grip: number; drag: number; out: number; outT: number;
}

interface Rift {
  voidS: Sprite; inner: Sprite; edge: Sprite; hot: Sprite;
  at: Pt; ang: number; len: number; age: number; tear: number; fadeT: number; fadeMs: number; moteAcc: number; mistAcc: number;
}

const HIST = 12;
/** History samples are this far apart (ms): an afterimage `i` sits (i + 1) x 2 samples behind. */
const SAMPLE_MS = 16;

export class HeroUndeadScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly free: Record<LayerId, Sprite[]>;
  private used = 0;
  private fx: Fx[] = [];
  private held: Held[] = [];
  private particles: Particle[] = [];
  private wisps: Wisp[] = [];
  private skulls: Skull[] = [];
  private hands: Hand[] = [];
  private rift: Rift | null = null;
  private raiseAcc: { x: number; y: number; r: number; left: number; acc: number; smoke: number; turn: number } | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private clock = 0;
  private readonly rnd: () => number;
  private readonly colors: UndeadColors;

  constructor(private readonly tex: HeroUndeadTextures, colors: UndeadColors, private readonly look: UndeadLook, private readonly scale = 1, seed = 1) {
    this.colors = colors;
    this.root.eventMode = 'none';
    this.root.label = 'heroUndead';
    this.layers = {} as Record<LayerId, Container>;
    this.free = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `undead-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.free[id] = [];
    }
    this.rnd = seededRng(seed);
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first beat needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.spark, t.streak, t.ring, t.beam, t.star, t.cranium, t.craniumEdge, t.jaw, t.jawEdge, t.skullGlow, t.wisp,
      t.hand, t.necro, t.rift, t.riftEdge, t.crack, t.mist, t.shard]) {
      const s = this.take('hot', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used - this.warm.length; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }
  get liveSkulls(): number { return this.skulls.filter((s) => !s.maw).length; }
  get hasMaw(): boolean { return this.skulls.some((s) => s.maw); }
  /** The maw's jaw (0 shut .. 1 wide) and phase, or null: for tests and the capture rig. */
  get mawState(): { open: number; phase: string; x: number; y: number } | null {
    const m = this.skulls.find((s) => s.maw);
    return m ? { open: m.open, phase: m.phase, x: m.x, y: m.y } : null;
  }
  get liveWisps(): number { return this.wisps.length; }
  get liveHands(): number { return this.hands.length; }
  get riftOpen(): boolean { return this.rift !== null && this.rift.fadeT < 0; }
  get graveHeld(): number { return this.held.filter((h) => h.tag === 'grave').length; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_UNDEAD_SPRITES) return null;
    let s = this.free[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1); s.skew.set(0, 0);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('undead-', '') ?? 'hot') as LayerId;
    s.visible = false;
    this.free[layer].push(s);
    this.used--;
  }

  /** Take several sprites at once, or none (all given back if the cap is hit part way). */
  private takeAll(specs: [LayerId, Texture, number][]): Sprite[] | null {
    const out: Sprite[] = [];
    for (const [l, t, c] of specs) {
      const s = this.take(l, t, c);
      if (!s) { for (const x of out) this.give(x); return null; }
      out.push(s);
    }
    return out;
  }

  /** A one-shot tween: scale from `from` to `to` (y = x * `ry`, or its own `sy0`/`sy1`), fade in, hold, fade out. */
  private tw(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: FxOpts): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    if (o.ax !== undefined || o.ay !== undefined) s.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5);
    const ry = o.ry ?? 1;
    const f: Fx = {
      s, age: 0, delay: o.delay ?? 0, dur: Math.max(1, o.dur), sx0: o.from, sx1: o.to, sy0: o.sy0 ?? o.from * ry, sy1: o.sy1 ?? o.to * ry,
      ease: o.ease ?? easeOutQuint, a0: o.a0, inMs: o.inMs ?? 0, outFrom: o.outFrom ?? 0, rot: o.rot ?? 0, spin: o.spin ?? 0,
      flick: o.flick ?? 0, phase: o.phase ?? this.rnd() * 6.28, x, y, vx: o.vx ?? 0, vy: o.vy ?? 0,
    };
    s.position.set(x, y);
    s.alpha = 0;
    this.paintFx(f);
    if (f.delay > 0) s.alpha = 0;
    this.fx.push(f);
    return s;
  }

  /** A held sprite: grows in, stays (pulsing gently) until its tag is faded. */
  private hold(layer: LayerId, t: Texture, tint: number, x: number, y: number, tag: string, o: HeldOpts): Held | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    if (o.ax !== undefined || o.ay !== undefined) s.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5);
    s.position.set(x, y);
    s.alpha = 0;
    const h: Held = {
      s, tag, age: 0, a: o.a, inMs: o.inMs ?? 120, g0: o.g0 ?? o.g1, g1: o.g1, gMs: o.gMs ?? 1, back: o.back ?? false, ry: o.ry ?? 1,
      rot: o.rot ?? 0, spin: o.spin ?? 0, pulse: o.pulse ?? 0, phase: o.phase ?? this.rnd() * 6.28, kick: 0, kickAge: 0,
      fadeT: -1, fadeMs: 1, flare: 0,
    };
    this.held.push(h);
    this.paintHeld(h);
    return h;
  }

  private fadeTag(tag: string, ms: number, flare = 0): void {
    for (const h of this.held) if (h.tag === tag && h.fadeT < 0) { h.fadeT = 0; h.fadeMs = Math.max(1, ms); h.flare = flare; }
  }

  private kickTag(tag: string, amount: number): void {
    for (const h of this.held) if (h.tag === tag && h.fadeT < 0) { h.kick = amount; h.kickAge = 0; }
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max' | 'align'> & { align?: boolean }): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = this.rnd() * Math.PI;
    s.alpha = 0;
    this.particles.push({ ...o, align: o.align ?? false, s, max: o.life });
  }

  /** Bone shards flung out from a point (normal-blend bone, some lit green). */
  private shards(x: number, y: number, n: number, speed: number, away = -Math.PI / 2, spread = Math.PI * 2): void {
    const c = this.colors, S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = away + (this.rnd() - 0.5) * spread, sp = speed * (0.5 + this.rnd() * 0.8) * S;
      this.particle(i % 3 === 0 ? 'glow' : 'body', this.tex.shard, i % 3 === 0 ? c.ghost : c.bone, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.15, grav: 900 * S, life: 420 + this.rnd() * 260,
        from: (0.9 + this.rnd() * 0.7) * S, to: 0.5 * S, alpha: 1, spin: (this.rnd() - 0.5) * 0.03, align: false,
      });
    }
  }

  /** Grave motes: small green-white stars drifting up. */
  private motes(x: number, y: number, n: number, o: { speed?: number; lift?: number; life?: number; ring?: number; grav?: number } = {}): void {
    const c = this.colors, S = this.scale;
    const tints = [c.ghost, c.core, c.teal];
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = (o.ring ?? 0) * (0.4 + this.rnd() * 0.6);
      const sp = (o.speed ?? 90) * (0.4 + this.rnd() * 0.8) * S;
      const up = (o.lift ?? 60) * (0.6 + this.rnd() * 0.8) * S;
      this.particle('hot', i % 4 === 3 ? this.tex.spark : this.tex.star, tints[i % 3]!, {
        x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - up, drag: 0.3, grav: (o.grav ?? -30) * S,
        life: (o.life ?? 900) * (0.7 + this.rnd() * 0.6), from: 0.36 * S, to: 0.1 * S, alpha: 1, spin: (this.rnd() - 0.5) * 0.01,
      });
    }
  }

  // ── wisps ──────────────────────────────────────────────────────────────────────────────────────────────────

  private makeWisp(x: number, y: number, size: number, tint: number): Wisp | null {
    const parts = this.takeAll([['hot', this.tex.glow, this.colors.core], ['glow', this.tex.wisp, tint], ['under', this.tex.glow, tint]]);
    if (!parts) return null;
    const [head, tail, echo] = parts as [Sprite, Sprite, Sprite];
    tail.anchor.set(WISP_HEAD_X, 0.5);
    for (const s of parts) { s.alpha = 0; s.position.set(x, y); }
    return {
      head, tail, echo, x, y, vx: 0, vy: 0, drag: 1, grav: 0, wander: 0, phase: this.rnd() * 6.28, life: 1, max: 1, size, alpha: 1,
      path: null, hx: new Array<number>(HIST).fill(x), hy: new Array<number>(HIST).fill(y), hi: 0, hAcc: 0,
    };
  }

  /** A free wisp: thrown at (vx, vy) px/s, dragged, rising (grav < 0), wandering across its heading. */
  private freeWisp(x: number, y: number, vx: number, vy: number, o: { life?: number; size?: number; grav?: number; drag?: number; tint?: number; wander?: number } = {}): void {
    const L = this.look, S = this.scale;
    const w = this.makeWisp(x, y, (o.size ?? 1) * L.wispSize, o.tint ?? (this.rnd() < 0.6 ? this.colors.ghost : this.colors.teal));
    if (!w) return;
    w.vx = vx * S; w.vy = vy * S; w.drag = o.drag ?? 0.1; w.grav = (o.grav ?? -120) * S; w.wander = (o.wander ?? 260) * L.wispWander * S;
    w.life = w.max = (o.life ?? 700) * L.wispLife * (0.75 + this.rnd() * 0.5);
    this.wisps.push(w);
  }

  /** A burst of free wisps out of a point, curling up and away. */
  private wispBurst(x: number, y: number, n: number, speed: number, o: { life?: number; size?: number; ring?: number } = {}): void {
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.8;
      const sp = speed * (0.55 + this.rnd() * 0.7);
      const rr = (o.ring ?? 0) * (0.3 + this.rnd() * 0.7);
      this.freeWisp(x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.cos(a) * sp, Math.sin(a) * sp - 60, { life: o.life, size: o.size });
    }
  }

  // ── skulls ─────────────────────────────────────────────────────────────────────────────────────────────────

  private makeSkull(id: number, x: number, y: number, widthPx: number, maw: boolean): Skull | null {
    const c = this.colors, t = this.tex;
    const nGhost = Math.max(0, Math.min(6, Math.round(this.look.afterimages)));
    const specs: [LayerId, Texture, number][] = [
      ['body', t.cranium, c.void], ['body', t.jaw, c.void],
      ['glow', t.cranium, c.ghost], ['glow', t.jaw, c.ghost],
      ['hot', t.craniumEdge, mixColor(c.bone, c.ghost, 0.35)], ['hot', t.jawEdge, mixColor(c.bone, c.ghost, 0.35)],
      ['under', t.skullGlow, c.teal],
      ['hot', t.glow, mixColor(c.ghost, c.core, 0.35)], ['hot', t.glow, mixColor(c.ghost, c.core, 0.35)],
    ];
    for (let i = 0; i < nGhost; i++) specs.push(['glow', t.craniumEdge, i % 2 ? c.teal : c.ghost]);
    const parts = this.takeAll(specs);
    if (!parts) return null;
    const [body, jawBody, fill, jawFill, edge, jawEdge, halo, e0, e1, ...ghosts] = parts as Sprite[];
    for (const s of [body!, fill!, edge!, ...ghosts]) s.anchor.set(0.5, HINGE_Y / CRANIUM_H);
    for (const s of [jawBody!, jawFill!, jawEdge!]) s.anchor.set(0.5, 0);
    halo!.anchor.set(0.5, GLOW_HINGE_Y / GLOW_H);
    for (const s of parts) s.alpha = 0;
    const k = widthPx / SKULL_SPAN;
    return {
      id, body: body!, jawBody: jawBody!, fill: fill!, jawFill: jawFill!, edge: edge!, jawEdge: jawEdge!, halo: halo!, eyes: [e0!, e1!], ghosts,
      x, y, k, k0: k, k1: k, rot: 0, open: 0, alpha: 0, eyeA: 0, phase: 'emerge', age: 0, dur: 1,
      from: { x, y }, to: { x, y }, path: null, wob: this.rnd() * 6.28,
      hx: new Array<number>(HIST).fill(x), hy: new Array<number>(HIST).fill(y), hi: 0, hAcc: 0, shedAcc: 0, maw,
    };
  }

  private skullOf(id: number): Skull | undefined { return this.skulls.find((s) => s.id === id); }

  private dropSkull(sk: Skull): void {
    for (const s of [sk.body, sk.jawBody, sk.fill, sk.jawFill, sk.edge, sk.jawEdge, sk.halo, ...sk.eyes, ...sk.ghosts]) this.give(s);
    const i = this.skulls.indexOf(sk);
    if (i >= 0) this.skulls.splice(i, 1);
  }

  /** Shriek rings off a skull's mouth: a crisp ring and a green one, pulsing out. */
  private shriekRings(x: number, y: number, r: number, n: number, gapMs: number, big: number): void {
    const c = this.colors, S = this.scale;
    for (let i = 0; i < n; i++) {
      this.tw('hot', this.tex.ring, whiten(c.ghost, 0.45), x, y, { delay: i * gapMs, dur: 380, from: (r * 0.5) / RING_PX / S, to: (r * big) / RING_PX / S, a0: 0.7, ease: easeOutCubic, inMs: 30 });
      this.tw('under', this.tex.ring, c.teal, x, y, { delay: i * gapMs + 30, dur: 460, from: (r * 0.6) / RING_PX / S, to: (r * big * 1.15) / RING_PX / S, a0: 0.45, ease: easeOutCubic, inMs: 30 });
    }
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * THE RAISE: a necrotic grave circle turns on the board under the striking hero (a dark body under a green light),
   * grave smoke circles the rim and ghost wisps spiral in. Held until `raise`.
   */
  startRaise(x: number, y: number, r: number, durMs: number, k: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    if (L.circleSize > 0) {
      const sz = ((r * 2.9) / NECRO_PX / S) * L.circleSize * (1 + 0.12 * k);
      const spin = 0.0009 * L.circleSpin;
      this.hold('ground', this.tex.necro, c.void, x, y, 'raise', { a: 0.55, g0: sz * 0.5, g1: sz, gMs: durMs * 0.7, back: true, inMs: durMs * 0.4, spin });
      this.hold('under', this.tex.necro, c.ghost, x, y, 'raise', { a: 0.95, g0: sz * 0.5, g1: sz, gMs: durMs * 0.7, back: true, inMs: durMs * 0.4, spin, pulse: 0.12 });
      this.hold('under', this.tex.ring, c.teal, x, y, 'raise', { a: 0.5, g0: ((r * 3.6) / RING_PX / S), g1: ((r * 2.5) / RING_PX / S), gMs: durMs, inMs: durMs * 0.5, spin: -spin });
    }
    this.hold('under', this.tex.glow, c.ghost, x, y, 'raise', { a: 0.3, g0: (r * 1.6) / GLOW_PX / S, g1: (r * 2.4) / GLOW_PX / S, gMs: durMs, inMs: durMs * 0.8 });
    this.raiseAcc = { x, y, r, left: durMs, acc: 0, smoke: 0, turn: this.rnd() * 6.28 };
  }

  /** The dead answer: the circle flares, a ring snaps out, a gasp of wisps rises off the hero. */
  raise(x: number, y: number, r: number, k: number): void {
    const c = this.colors, S = this.scale;
    this.raiseAcc = null;
    this.fadeTag('raise', 420, 0.18);
    this.tw('hot', this.tex.glow, c.core, x, y, { dur: 150, from: (r * 1.2) / GLOW_PX / S, to: (r * 1.9) / GLOW_PX / S, a0: 0.4 });
    this.tw('hot', this.tex.ring, whiten(c.ghost, 0.4), x, y, { dur: 320, from: (r * 1.05) / RING_PX / S, to: (r * 2.2) / RING_PX / S, a0: 0.85 });
    this.tw('ground', this.tex.ring, c.void, x, y, { dur: 360, from: (r * 1.1) / RING_PX / S, to: (r * 2.4) / RING_PX / S, a0: 0.35 });
    this.wispBurst(x, y, 6 + Math.round(4 * k), 160, { ring: r * 0.8, life: 650 });
  }

  /**
   * A skull POPS out of the hero at `at` and SHRIEKS: it swells in with an overshoot, its jaw drops, its eyes flare and
   * shriek rings pulse off it, over `shriekMs`; it hovers there, jaw open, until `launchSkull`.
   */
  emergeSkull(id: number, at: Pt, widthPx: number, shriekMs: number): void {
    const sk = this.makeSkull(id, at.x, at.y, widthPx, false);
    if (!sk) return;
    sk.phase = 'emerge'; sk.dur = Math.max(1, shriekMs);
    this.skulls.push(sk);
    const S = this.scale;
    this.shriekRings(at.x, at.y + widthPx * 0.2, widthPx * 0.9, 2, Math.max(40, shriekMs * 0.35), 2.2);
    this.tw('hot', this.tex.glow, this.colors.ghost, at.x, at.y, { dur: 200, from: (widthPx * 0.6) / GLOW_PX / S, to: (widthPx * 1.3) / GLOW_PX / S, a0: 0.55 });
  }

  /** The skull is LOOSED along `path` over `flightMs` (arcing, wobbling, jaw wide, afterimages, shedding wisps). */
  launchSkull(id: number, path: SkullPath, flightMs: number): void {
    const sk = this.skullOf(id);
    if (!sk) return;
    sk.phase = 'fly'; sk.age = 0; sk.dur = Math.max(1, flightMs); sk.path = { from: { x: sk.x, y: sk.y }, to: { ...path.to }, arc: path.arc };
  }

  /**
   * THE BITE: the skull lands (its jaw has just snapped shut) and bursts: a short flash, a spectral ECHO of the skull
   * swelling off it, rings, bone shards, a swirl of wisps curling up and away. `last` is THE blow (bigger); a tick is
   * smaller and quicker.
   */
  skullBite(id: number, at: Pt, r: number, o: { last: boolean; k: number; burst: number; motes: number; flashAlpha: number; shards: number }): void {
    const c = this.colors, L = this.look, S = this.scale;
    const sk = this.skullOf(id);
    const w = sk ? sk.k * SKULL_SPAN : r * 1.4;
    if (sk) this.dropSkull(sk);
    const fs = o.last ? o.burst : 0.7;
    const portrait = (r * 2) / GLOW_PX / S;
    this.tw('hot', this.tex.glow, c.core, at.x, at.y, { dur: o.last ? 110 : 80, from: portrait * 0.8, to: portrait * 1.1, a0: (o.last ? 0.5 : 0.3) * o.flashAlpha });
    this.tw('under', this.tex.glow, c.ghost, at.x, at.y, { dur: 380, from: portrait * 0.9 * fs, to: portrait * 1.7 * fs, a0: 0.3 * o.flashAlpha });
    // The spectral ECHO: the skull's own outline swelling off the hit and fading (the undead signature), in line work
    // so the struck portrait and the big number stay clear under it.
    if (L.echoSize > 0) {
      const ek = w / SKULL_SPAN;
      for (const [tint, a, grow, dur] of [[c.ghost, 0.85, 1.7, 420], [c.teal, 0.5, 2.3, 560]] as [number, number, number, number][]) {
        this.tw('glow', this.tex.craniumEdge, tint, at.x, at.y + SKULL_CENTRE_ABOVE_HINGE * ek, {
          dur, from: ek / S, to: (ek * grow * L.echoSize * (o.last ? 1 : 0.8)) / S, a0: a, ease: easeOutCubic, ay: HINGE_Y / CRANIUM_H,
        });
      }
    }
    this.tw('hot', this.tex.ring, whiten(c.ghost, 0.5), at.x, at.y, { dur: 300, from: (r * 0.9) / RING_PX / S, to: ((r * (o.last ? 3 : 2)) / RING_PX / S) * (0.85 + 0.35 * o.k), a0: 0.9 });
    this.tw('under', this.tex.ring, c.teal, at.x, at.y, { dur: 520, from: (r * 1.1) / RING_PX / S, to: ((r * (o.last ? 4.2 : 2.6)) / RING_PX / S) * (0.85 + 0.35 * o.k), a0: 0.55 });
    this.tw('ground', this.tex.ring, c.void, at.x, at.y, { dur: 480, from: (r * 1.1) / RING_PX / S, to: (r * (o.last ? 3.4 : 2.2)) / RING_PX / S, a0: 0.4 });
    this.shards(at.x, at.y, Math.round(o.shards * (o.last ? 1 : 0.5)), o.last ? 520 : 360);
    this.wispBurst(at.x, at.y, o.last ? Math.round(8 + o.motes * 0.25) : 5, o.last ? 190 : 140, { ring: r * 0.5, life: o.last ? 1000 : 650, size: o.last ? 1.15 : 0.9 });
    this.motes(at.x, at.y, Math.round(o.motes * (o.last ? 0.6 : 0.25)), { lift: 150, speed: 160, life: 900, ring: r * 0.6 });
    if (o.last) {
      // The grave (III) flares with the blow; the hands shatter into bone.
      this.kickTag('grave', 0.8);
      this.fadeTag('grave', 620, 0.3);
      for (const h of this.hands) if (h.outT < 0) h.outT = 0;
      this.tw('under', this.tex.glow, c.ghost, at.x, at.y, { dur: 900, from: portrait * 1.2, to: portrait * 1.6, a0: 0.14 });
    }
  }

  /** III: a grave circle opens under the target, a dark pit in its middle. */
  openGrave(x: number, y: number, r: number, durMs: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    const sz = ((r * 2.8) / NECRO_PX / S) * Math.max(0.3, L.circleSize);
    const spin = -0.0008 * L.circleSpin;
    this.hold('ground', this.tex.necro, c.void, x, y, 'grave', { a: 0.62, g0: sz * 1.6, g1: sz, gMs: durMs, back: true, inMs: durMs * 0.5, spin });
    this.hold('under', this.tex.necro, c.ghost, x, y, 'grave', { a: 0.95, g0: sz * 1.6, g1: sz, gMs: durMs, back: true, inMs: durMs * 0.5, spin, pulse: 0.1 });
    this.hold('under', this.tex.glow, c.ghost, x, y, 'grave', { a: 0.3, g1: (r * 2.6) / GLOW_PX / S, inMs: 200, pulse: 0.2 });
    this.tw('hot', this.tex.ring, whiten(c.ghost, 0.4), x, y, { delay: durMs * 0.8, dur: 260, from: (r * 2.8) / RING_PX / S, to: (r * 2.3) / RING_PX / S, a0: 0.8, ease: easeOutCubic });
  }

  /** III: a skeletal hand claws up out of a dark hole at `spot`, reaching in; it grips at the end of `riseMs`, then drags. */
  raiseHand(spot: HandSpot, riseMs: number, dragPx: number): void {
    const c = this.colors, S = this.scale;
    const parts = this.takeAll([
      ['ground', this.tex.glow, c.void], ['body', this.tex.hand, c.void], ['body', this.tex.hand, c.bone], ['glow', this.tex.hand, c.ghost],
    ]);
    if (!parts) return;
    const [hole, shadow, bone, glow] = parts as [Sprite, Sprite, Sprite, Sprite];
    for (const s of [shadow, bone, glow]) s.anchor.set(0.5, HAND_WRIST_Y / HAND_H);
    for (const s of parts) { s.alpha = 0; s.position.set(spot.at.x, spot.at.y); }
    this.hands.push({ hole, shadow, bone, glow, at: { ...spot.at }, ang: spot.ang, len: spot.len * this.look.handSize, age: 0, rise: Math.max(1, riseMs), grip: 0, drag: dragPx * S, out: 0, outT: -1 });
    // Earth breaking where it comes up: a dark splash, a few shards, a puff of grave dust.
    this.tw('ground', this.tex.ring, c.void, spot.at.x, spot.at.y, { dur: 320, from: 0.1, to: (spot.len * 0.7) / RING_PX / S, a0: 0.5 });
    this.shards(spot.at.x, spot.at.y, 3, 220, spot.ang + Math.PI, 2);
    this.tw('body', this.tex.mist, mixColor(c.void, c.ghost, 0.25), spot.at.x, spot.at.y, { dur: 520, from: 0.5, to: 1.5, a0: 0.35, ease: easeOutCubic, inMs: 40 });
  }

  /** III: a hand GRIPS (a tick): it clenches, the grave pulses. */
  gripHand(i: number, at: Pt): void {
    const h = this.hands[i];
    const c = this.colors, S = this.scale;
    if (h) { h.grip = 1; }
    this.kickTag('grave', 0.35);
    this.tw('hot', this.tex.glow, c.ghost, at.x, at.y, { dur: 130, from: 0.3, to: (28 * S) / GLOW_PX / S, a0: 0.5 });
  }

  /** III: a wisp of the swarm, loosed off the hero along its bent path, arriving in `flightMs`. */
  launchWisp(path: WispPath, flightMs: number): void {
    const w = this.makeWisp(path.from.x, path.from.y, 1.05 * this.look.wispSize, this.rnd() < 0.5 ? this.colors.ghost : this.colors.teal);
    if (!w) return;
    w.path = { ...path, dur: Math.max(1, flightMs) };
    w.life = w.max = flightMs + 1;
    w.phase = path.phase;
    this.wisps.push(w);
  }

  /** III: a wisp strikes the target (a tick): a small green flash, a ring, a few wisps curling off. */
  wispHit(to: Pt, r: number, step: number): void {
    const c = this.colors, S = this.scale;
    this.tw('hot', this.tex.glow, c.core, to.x, to.y, { dur: 100, from: 0.3, to: 0.9, a0: 0.7 });
    this.tw('under', this.tex.ring, c.ghost, to.x, to.y, { dur: 260, from: 0.12, to: (r * 0.9) / RING_PX / S, a0: 0.75 });
    const a = -Math.PI / 2 + (step % 2 ? 0.8 : -0.8);
    this.freeWisp(to.x, to.y, Math.cos(a) * 140, Math.sin(a) * 140, { life: 420, size: 0.7 });
  }

  /**
   * IV: the RIFT tears open at `at` across the board over `ms`: a jagged void (normal-blend purple-black) lit green inside,
   * a burning rim, cracks racing off it, a kick of grave dust and bone; it keeps pouring motes and mist while open.
   */
  tearRift(at: Pt, ang: number, len: number, ms: number, cracks: { ang: number; len: number }[]): void {
    const c = this.colors, S = this.scale;
    const parts = this.takeAll([
      ['ground', this.tex.rift, c.void], ['under', this.tex.rift, c.ghost], ['glow', this.tex.riftEdge, c.ghost], ['hot', this.tex.riftEdge, mixColor(c.ghost, c.core, 0.5)],
    ]);
    if (!parts) return;
    const [voidS, inner, edge, hot] = parts as [Sprite, Sprite, Sprite, Sprite];
    // A deep shadow pooling round the tear (the ground falling away into it).
    this.hold('ground', this.tex.glow, c.void, at.x, at.y, 'rift', { a: 0.55, g0: 0.2, g1: (len * 0.75) / GLOW_PX / S, gMs: ms, inMs: ms * 0.5, ry: 0.55, rot: ang });
    for (const s of parts) { s.alpha = 0; s.position.set(at.x, at.y); s.rotation = ang; s.scale.set(0, 0); }
    if (this.rift) this.dropRift(this.rift);
    this.rift = { voidS, inner, edge, hot, at: { ...at }, ang, len, age: 0, tear: Math.max(1, ms), fadeT: -1, fadeMs: 1, moteAcc: 0, mistAcc: 0 };
    cracks.forEach((cr, i) => {
      const cl = (cr.len / 128) / S;
      const sx = at.x + Math.cos(ang) * (len * 0.3) * (i % 2 ? 1 : -1) * 0.6, sy = at.y + Math.sin(ang) * (len * 0.3) * (i % 2 ? 1 : -1) * 0.6;
      for (const [layer, tint, a] of [['ground', c.void, 0.8], ['under', c.ghost, 0.85]] as [LayerId, number, number][]) {
        const h = this.hold(layer, this.tex.crack, tint, sx, sy, 'rift', { a, g0: 0, g1: 1, gMs: ms * 0.8, inMs: 30, rot: cr.ang, ax: 0, ay: 0.5 });
        if (h) { h.ry = 0.9 + (i % 3) * 0.2; h.len = cl; }
      }
    });
    this.shards(at.x, at.y, 10, 420);
    this.tw('hot', this.tex.glow, c.core, at.x, at.y, { dur: 140, from: (len * 0.3) / GLOW_PX / S, to: (len * 0.8) / GLOW_PX / S, a0: 0.5 });
    for (let i = 0; i < 6; i++) {
      const u = (i / 5 - 0.5) * 0.9;
      const px = at.x + Math.cos(ang) * len * u, py = at.y + Math.sin(ang) * len * u;
      this.tw('body', this.tex.mist, mixColor(c.void, c.ghost, 0.2), px, py, { dur: 700 + this.rnd() * 200, from: 0.6, to: 1.8, a0: 0.4, ease: easeOutCubic, inMs: 40, vx: (this.rnd() - 0.5) * 60 * S, vy: -80 * S });
    }
  }

  private dropRift(r: Rift): void {
    for (const s of [r.voidS, r.inner, r.edge, r.hot]) this.give(s);
    if (this.rift === r) this.rift = null;
  }

  /** IV: the MAW rises out of the rift: from the rift (small, dim) up to `up`, swelling to `widthPx`, over `ms`. */
  riseMaw(from: Pt, up: Pt, widthPx: number, ms: number): void {
    const sk = this.makeSkull(99, from.x, from.y, widthPx, true);
    if (!sk) return;
    sk.phase = 'rise'; sk.dur = Math.max(1, ms); sk.from = { ...from }; sk.to = { ...up }; sk.k0 = sk.k * 0.35; sk.k1 = sk.k;
    this.skulls.push(sk);
    const S = this.scale;
    this.wispBurst(from.x, from.y, 12, 220, { ring: widthPx * 0.3, life: 900, size: 1.1 });
    this.tw('under', this.tex.glow, this.colors.ghost, from.x, from.y, { dur: ms, from: (widthPx * 0.5) / GLOW_PX / S, to: (widthPx * 1.3) / GLOW_PX / S, a0: 0.4, outFrom: 0.6 });
  }

  /** IV: the maw SHRIEKS over `ms`: the jaw drops wide, the eyes blaze, shriek rings pulse off it, wisps are blown out. */
  shriekMaw(ms: number, r: number): void {
    const sk = this.skulls.find((s) => s.maw);
    if (!sk) return;
    sk.phase = 'shriek'; sk.age = 0; sk.dur = Math.max(1, ms);
    const w = sk.k * SKULL_SPAN;
    const mouth = { x: sk.x, y: sk.y + w * 0.34 };
    this.shriekRings(mouth.x, mouth.y, Math.max(r, w * 0.5), 3, ms * 0.26, 3.2);
    // The scream blows wisps out of its mouth in every direction.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + this.rnd() * 0.4;
      this.freeWisp(mouth.x, mouth.y, Math.cos(a) * 280, Math.sin(a) * 220, { life: 700, size: 1.1 });
    }
  }

  /** IV: the maw LUNGES at `to` over `ms` (accelerating, growing by `grow`, jaw wide, afterimages streaming). */
  lungeMaw(to: Pt, ms: number, grow: number): void {
    const sk = this.skulls.find((s) => s.maw);
    if (!sk) return;
    sk.phase = 'lunge'; sk.age = 0; sk.dur = Math.max(1, ms); sk.from = { x: sk.x, y: sk.y }; sk.to = { ...to }; sk.k0 = sk.k; sk.k1 = sk.k * grow;
  }

  /** IV: the maw arrives and its jaw SNAPS shut over `ms` onto the impact. */
  chompMaw(ms: number): void {
    const sk = this.skulls.find((s) => s.maw);
    if (!sk) return;
    sk.phase = 'chomp'; sk.age = 0; sk.dur = Math.max(1, ms); sk.x = sk.to.x; sk.y = sk.to.y;
  }

  /**
   * IV, THE blow: the chomp lands. A short flash, the maw's spectral echo, rings, bone shards and a storm of wisps; the
   * maw dissolves; and a WAVE of necrotic mist washes out across the board (two rings of puffs racing out, dark under
   * green, with a flat ring leading them). The rift starts to close.
   */
  mawImpact(at: Pt, r: number, o: { k: number; burst: number; motes: number; flashAlpha: number; shards: number; mistMs: number; mistReach: number; mistPuffs: number }): void {
    const c = this.colors, S = this.scale;
    const sk = this.skulls.find((s) => s.maw);
    const w = sk ? sk.k * SKULL_SPAN : r * 3;
    if (sk) { sk.phase = 'die'; sk.age = 0; sk.dur = 280; }
    const fs = o.burst;
    const portrait = (r * 2) / GLOW_PX / S;
    this.tw('hot', this.tex.glow, c.core, at.x, at.y, { dur: 120, from: portrait, to: portrait * 1.35, a0: 0.62 * o.flashAlpha });
    this.tw('under', this.tex.glow, c.ghost, at.x, at.y, { dur: 480, from: portrait * fs, to: portrait * 2 * fs, a0: 0.32 * o.flashAlpha });
    const ek = w / SKULL_SPAN;
    this.tw('glow', this.tex.craniumEdge, c.ghost, at.x, at.y + SKULL_CENTRE_ABOVE_HINGE * ek, { dur: 520, from: ek / S, to: (ek * 1.6) / S, a0: 0.8, ease: easeOutCubic, ay: HINGE_Y / CRANIUM_H });
    this.tw('glow', this.tex.craniumEdge, c.teal, at.x, at.y + SKULL_CENTRE_ABOVE_HINGE * ek, { dur: 680, from: ek / S, to: (ek * 2.1) / S, a0: 0.45, ease: easeOutCubic, ay: HINGE_Y / CRANIUM_H });
    this.tw('hot', this.tex.ring, whiten(c.ghost, 0.5), at.x, at.y, { dur: 340, from: (r * 1) / RING_PX / S, to: (r * 4.2) / RING_PX / S, a0: 1 });
    this.shards(at.x, at.y, o.shards * 2, 640);
    this.wispBurst(at.x, at.y, Math.round(10 + o.motes * 0.2), 240, { ring: r * 0.8, life: 1200, size: 1.2 });
    this.motes(at.x, at.y, Math.round(o.motes * 0.6), { lift: 200, speed: 260, life: 1100, ring: r });
    // THE MIST WAVE.
    const reach = r * 11 * o.mistReach;
    const dur = Math.max(200, o.mistMs);
    this.tw('under', this.tex.ring, c.ghost, at.x, at.y, { dur: dur * 0.6, from: (r * 1.2) / RING_PX / S, to: reach / RING_PX / S, a0: 0.3, ease: easeOutCubic, inMs: 30 });
    this.tw('under', this.tex.glow, c.ghost, at.x, at.y, { dur: dur * 0.5, from: (r * 2) / GLOW_PX / S, to: (reach * 1.2) / GLOW_PX / S, a0: 0.22, ease: easeOutCubic, inMs: 40 });
    const n = Math.max(0, Math.round(o.mistPuffs));
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.3;
      const inner = i % 2 === 1;
      const sp = (reach / (dur / 1000)) * (inner ? 0.55 : 0.95) * (0.8 + this.rnd() * 0.4) * 1.6;
      const rr = r * (0.7 + this.rnd() * 0.4);
      const px = at.x + Math.cos(a) * rr, py = at.y + Math.sin(a) * rr;
      const sz = (r * (inner ? 1.4 : 1.9)) / MIST_PX / S;
      this.tw('body', this.tex.mist, mixColor(c.void, c.ghost, 0.16), px, py, {
        delay: inner ? 90 : 0, dur: dur * (0.9 + this.rnd() * 0.35), from: sz * 0.6, to: sz * 2.6, a0: 0.6, ease: easeOutCubic, inMs: 60, outFrom: 0.45,
        vx: Math.cos(a) * sp * S, vy: Math.sin(a) * sp * S, spin: (this.rnd() - 0.5) * 0.002,
      });
      if (i % 2 === 0) this.tw('under', this.tex.mist, c.ghost, px, py, {
        dur: dur * 0.7, from: sz * 0.5, to: sz * 2, a0: 0.2, ease: easeOutCubic, inMs: 60, outFrom: 0.25,
        vx: Math.cos(a) * sp * S, vy: Math.sin(a) * sp * S,
      });
    }
    this.fadeTag('rift', 700, 0.1);
  }

  /** The rift closes and the marks on the board fade. */
  fadeGround(ms: number): void {
    this.fadeTag('grave', ms, 0.1);
    this.fadeTag('rift', ms, 0.05);
    if (this.rift && this.rift.fadeT < 0) { this.rift.fadeT = 0; this.rift.fadeMs = Math.max(1, ms); }
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  private paintFx(q: Fx): void {
    const u = clamp01(q.age / q.dur);
    const e = q.ease(u);
    const S = this.scale;
    const sx = (q.sx0 + (q.sx1 - q.sx0) * e) * S, sy = (q.sy0 + (q.sy1 - q.sy0) * e) * S;
    flatTransform(q.s, q.rot, sx, sy);
    let a = q.a0 * (q.inMs > 0 ? clamp01(q.age / q.inMs) : 1);
    if (u > q.outFrom) a *= 1 - (u - q.outFrom) / Math.max(1e-6, 1 - q.outFrom);
    if (q.flick) a *= 1 - q.flick * (0.5 + 0.5 * Math.sin(q.age * 0.045 + q.phase));
    q.s.alpha = Math.max(0, a);
    q.s.position.set(q.x, q.y);
  }

  private paintHeld(h: Held): void {
    const S = this.scale;
    const t = Math.max(0, h.age);
    const u = clamp01(t / h.gMs);
    let g = h.g0 + (h.g1 - h.g0) * (h.back ? easeOutBack(u, 1.6) : easeOutCubic(u));
    let a = h.a * clamp01(t / Math.max(1, h.inMs));
    if (h.pulse) a *= 1 - h.pulse * (0.5 + 0.5 * Math.sin(t * 0.008 + h.phase));
    if (h.kick > 0) { const kk = h.kick * Math.exp(-h.kickAge / 140); a *= 1 + kk; g *= 1 + 0.1 * kk; }
    if (h.fadeT >= 0) { const f = clamp01(h.fadeT / h.fadeMs); a *= 1 - f; g *= 1 + h.flare * easeOutCubic(f); }
    if (h.age < 0) a = 0;
    const len = h.len;
    const sx = (len !== undefined ? len * g : g) * S, sy = (len !== undefined ? h.ry : g * h.ry) * S;
    flatTransform(h.s, h.rot, sx, sy);
    h.s.alpha = Math.max(0, Math.min(1, a));
  }

  /** Paint a skull at its centre (x, y), scale k, jaw `open`, alpha, lean `rot`. */
  private paintSkull(sk: Skull, flicker: number): void {
    const k = sk.k, a = sk.alpha;
    const cosR = Math.cos(sk.rot), sinR = Math.sin(sk.rot);
    // The hinge sits below the visual centre; everything is placed about it, turned by the lean.
    const hy = SKULL_CENTRE_ABOVE_HINGE * k;
    const hx0 = sk.x - sinR * hy, hy0 = sk.y + cosR * hy;
    // The jaw OPENS about the hinge: it stretches down from it (so its sides stay on the skull) and drops a little.
    const drop = sk.open * JAW_DROP * 0.3 * k;
    const jx = hx0 - sinR * drop, jy = hy0 + cosR * drop;
    const jawSy = k * (1 + 0.62 * sk.open);
    const set = (s: Sprite, x: number, y: number, sx: number, sy: number, al: number): void => {
      s.position.set(x, y); flatTransform(s, sk.rot, sx, sy); s.alpha = Math.max(0, Math.min(1, al));
    };
    set(sk.body, hx0, hy0, k * 1.04, k * 1.04, a * 0.8);
    set(sk.jawBody, jx, jy, k * 1.04, jawSy * 1.04, a * 0.8);
    set(sk.fill, hx0, hy0, k, k, a * 0.52 * flicker);
    set(sk.jawFill, jx, jy, k, jawSy, a * 0.45 * flicker);
    set(sk.edge, hx0, hy0, k, k, a * (sk.maw ? 0.8 : 0.92));
    set(sk.jawEdge, jx, jy, k, jawSy, a * (sk.maw ? 0.8 : 0.92));
    set(sk.halo, hx0, hy0, k * 2.25, k * 2.25 * (1 + 0.18 * sk.open), a * 0.3 * flicker);
    EYE_OFFSETS.forEach(([ex, ey], i) => {
      const e = sk.eyes[i]!;
      const px = hx0 + (cosR * ex - sinR * ey) * k, py = hy0 + (sinR * ex + cosR * ey) * k;
      const es = (58 * k) / GLOW_PX * (0.9 + 0.3 * sk.eyeA);
      e.position.set(px, py); e.scale.set(es, es * 0.8); e.rotation = 0;
      e.alpha = Math.max(0, Math.min(1, a * (0.3 + 0.7 * Math.min(1, sk.eyeA)) * (0.85 + 0.15 * Math.sin(this.clock * 0.05 + i * 2 + sk.wob))));
    });
    // Afterimages: its silhouette where it was, a beat apart, fading (only while it moves fast).
    const moving = sk.phase === 'fly' || sk.phase === 'lunge' || sk.phase === 'chomp';
    sk.ghosts.forEach((g, i) => {
      const lag = (i + 1) * 2;
      const idx = (sk.hi - lag + HIST * 4) % HIST;
      const gx = sk.hx[idx]!, gy = sk.hy[idx]!;
      g.position.set(gx - sinR * hy, gy + cosR * hy); flatTransform(g, sk.rot, k * (1 + 0.03 * i), k * (1 + 0.03 * i));
      g.alpha = moving ? Math.max(0, a * 0.5 * (1 - (i + 0.5) / Math.max(1, sk.ghosts.length + 0.5))) : Math.max(0, g.alpha - 0.08);
    });
  }

  private stepSkull(sk: Skull, dt: number): boolean {
    sk.age += dt;
    const u = clamp01(sk.age / sk.dur);
    const L = this.look, S = this.scale;
    let flick = 0.85 + 0.15 * Math.sin(this.clock * 0.031 + sk.wob);
    switch (sk.phase) {
      case 'emerge': {
        // Pops out with an overshoot, the jaw DROPS (the shriek) past a third of the way, the eyes flare.
        const g = easeOutBack(clamp01(u * 1.4), 2);
        sk.k = sk.k1 * (0.3 + 0.7 * g);
        sk.alpha = clamp01(u * 3);
        sk.open = easeOutBack(clamp01((u - 0.3) / 0.4), 2.4) * 0.95;
        sk.eyeA = clamp01((u - 0.25) / 0.3);
        sk.y = sk.from.y - 6 * S * easeOutCubic(u);
        if (u >= 1) { sk.phase = 'hover'; sk.age = 0; }
        break;
      }
      case 'hover':
        sk.open = 0.85 + 0.1 * Math.sin(sk.age * 0.05);
        sk.y = sk.from.y - 6 * S + 2 * S * Math.sin(sk.age * 0.02);
        break;
      case 'fly': {
        const p = sk.path!;
        const e = 0.25 * u + 0.75 * u * u;
        const pt = skullAt(p, e);
        const dx = p.to.x - p.from.x, dy = p.to.y - p.from.y;
        const d = Math.hypot(dx, dy) || 1;
        const wob = Math.sin(u * Math.PI * 3 + sk.wob) * sk.k1 * SKULL_SPAN * 0.1 * L.skullWobble * (1 - u);
        sk.x = pt.x + (-dy / d) * wob; sk.y = pt.y + (dx / d) * wob;
        sk.rot = Math.max(-0.35, Math.min(0.35, (dx / d) * 0.28)) + Math.sin(sk.age * 0.018 + sk.wob) * 0.06 * L.skullWobble;
        // Jaw wide in flight, snapping shut over the last 70 ms: it BITES as it lands.
        const left = sk.dur - sk.age;
        sk.open = left > 70 ? 0.9 : 0.9 * clamp01(left / 70);
        sk.eyeA = 1;
        sk.k = sk.k1 * (1 + 0.12 * u);
        // Shed wisps as it flies.
        sk.shedAcc += dt * 0.025 * L.shedWisps;
        while (sk.shedAcc >= 1) {
          sk.shedAcc -= 1;
          this.freeWisp(sk.x + (this.rnd() - 0.5) * sk.k * 120, sk.y + (this.rnd() - 0.5) * sk.k * 80, -(dx / d) * 90 + (this.rnd() - 0.5) * 80, -(dy / d) * 90 - 40, { life: 520, size: 0.75 });
        }
        break;
      }
      case 'rise': {
        const e = easeOutCubic(u);
        sk.x = sk.from.x + (sk.to.x - sk.from.x) * e; sk.y = sk.from.y + (sk.to.y - sk.from.y) * e;
        sk.k = sk.k0 + (sk.k1 - sk.k0) * easeOutBack(u, 1.4);
        sk.alpha = clamp01(u * 2.2);
        sk.open = 0.12 * Math.sin(u * Math.PI);
        sk.eyeA = clamp01((u - 0.7) / 0.2);
        if (u >= 0.7 && sk.eyeA < 0.2) flick = 1.2;
        sk.rot = Math.sin(sk.age * 0.008) * 0.03;
        sk.shedAcc += dt * 0.02 * L.shedWisps;
        while (sk.shedAcc >= 1) { sk.shedAcc -= 1; this.freeWisp(sk.x + (this.rnd() - 0.5) * sk.k * 240, sk.y + sk.k * 120, (this.rnd() - 0.5) * 60, -120, { life: 700 }); }
        if (u >= 1) { sk.phase = 'hold'; sk.age = 0; }
        break;
      }
      case 'hold':
        sk.open = 0.08 + 0.04 * Math.sin(sk.age * 0.02);
        sk.y = sk.to.y + 3 * S * Math.sin(sk.age * 0.01);
        break;
      case 'shriek': {
        // The jaw drops wide (overshooting), then trembles open; the whole skull shudders with the scream.
        sk.open = Math.min(1.15, easeOutBack(clamp01(u / 0.3), 2.6));
        const tr = sk.k * 7 * Math.sin(Math.PI * Math.min(1, u * 1.2));
        sk.x = sk.to.x + tr * Math.sin(sk.age * 0.41); sk.y = sk.to.y + tr * Math.sin(sk.age * 0.37 + 1);
        sk.rot = 0.04 * Math.sin(sk.age * 0.3);
        sk.eyeA = 1 + 0.3 * Math.sin(sk.age * 0.08);
        sk.k = sk.k1 * (1 + 0.05 * Math.sin(Math.PI * u));
        break;
      }
      case 'lunge': {
        const e = u * u;
        sk.x = sk.from.x + (sk.to.x - sk.from.x) * e; sk.y = sk.from.y + (sk.to.y - sk.from.y) * e;
        sk.k = sk.k0 + (sk.k1 - sk.k0) * easeInOutSine(u);
        sk.open = 1.1;
        const dx = sk.to.x - sk.from.x;
        sk.rot = Math.max(-0.2, Math.min(0.2, (dx / (Math.abs(dx) + 200)) * 0.2));
        sk.eyeA = 1.2;
        break;
      }
      case 'chomp':
        sk.open = 1.1 * (1 - u * u);
        sk.k = sk.k1 * (1 + 0.04 * u);
        sk.rot *= 0.8;
        break;
      case 'die':
        sk.alpha = 1 - easeOutCubic(u);
        sk.k = sk.k1 * (1 + 0.15 * u);
        sk.open = 0.3 * u;
        if (u >= 1) return false;
        break;
      default:
        break;
    }
    // Sample where it is every SAMPLE_MS (time-based, so the afterimages sit the same distance apart at any frame rate).
    sk.hAcc += dt;
    if (sk.hAcc >= SAMPLE_MS) { sk.hAcc %= SAMPLE_MS; sk.hi = (sk.hi + 1) % HIST; }
    sk.hx[sk.hi] = sk.x; sk.hy[sk.hi] = sk.y;
    this.paintSkull(sk, flick);
    return true;
  }

  private stepWisp(w: Wisp, dt: number, sec: number): boolean {
    w.life -= dt;
    if (w.life <= 0) return false;
    const px = w.x, py = w.y;
    if (w.path) {
      const p = w.path;
      const u = clamp01((p.dur - w.life) / p.dur);
      const e = 0.3 * u + 0.7 * u * u;
      const dx = p.to.x - p.from.x, dy = p.to.y - p.from.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d, ny = dx / d;
      const bend = p.bend * d * 4 * u * (1 - u);
      const wig = Math.sin(u * Math.PI * 4 + w.phase) * 14 * this.scale * this.look.wispWander * (1 - u);
      w.x = p.from.x + dx * e + nx * (bend + wig);
      w.y = p.from.y + dy * e + ny * (bend + wig);
      w.vx = (w.x - px) / Math.max(1e-3, sec); w.vy = (w.y - py) / Math.max(1e-3, sec);
    } else {
      const sp = Math.hypot(w.vx, w.vy) || 1;
      const acc = w.wander * Math.sin((w.max - w.life) * 0.012 + w.phase);
      const damp = Math.pow(w.drag, sec);
      w.vx = w.vx * damp + (-w.vy / sp) * acc * sec;
      w.vy = w.vy * damp + (w.vx / sp) * acc * sec + w.grav * sec;
      w.x += w.vx * sec; w.y += w.vy * sec;
    }
    w.hAcc += dt;
    if (w.hAcc >= SAMPLE_MS) { w.hAcc %= SAMPLE_MS; w.hi = (w.hi + 1) % HIST; }
    w.hx[w.hi] = w.x; w.hy[w.hi] = w.y;
    const t = 1 - w.life / w.max;
    const fade = w.path ? clamp01((w.max - w.life) / 60) : clamp01((w.max - w.life) / 60) * (1 - t * t);
    const S = this.scale;
    const speed = Math.hypot(w.vx, w.vy);
    const hs = (w.size * 26 * S) / GLOW_PX * (w.path ? 1 : 1 - 0.5 * t);
    w.head.position.set(w.x, w.y); w.head.scale.set(hs); w.head.alpha = 0.95 * fade * w.alpha;
    const ang = Math.atan2(w.vy, w.vx);
    const len = Math.min(1.9, 0.45 + speed / (420 * S)) * w.size;
    w.tail.position.set(w.x, w.y); flatTransform(w.tail, ang, len * S, w.size * 0.8 * S * (w.path ? 1 : 1 - 0.4 * t)); w.tail.alpha = 0.8 * fade * w.alpha;
    const ei = (w.hi - 3 + HIST) % HIST;
    w.echo.position.set(w.hx[ei]!, w.hy[ei]!); w.echo.scale.set(hs * 1.6); w.echo.alpha = 0.4 * fade * w.alpha;
    return true;
  }

  private stepHand(h: Hand, dt: number): boolean {
    h.age += dt;
    const u = clamp01(h.age / h.rise);
    const grow = easeOutBack(u, 1.8);
    let out = 1;
    if (h.outT >= 0) {
      h.outT += dt;
      out = 1 - clamp01(h.outT / 180);
      if (h.outT < dt + 1) this.shards(h.at.x + Math.cos(h.ang) * h.len * 0.5, h.at.y + Math.sin(h.ang) * h.len * 0.5, 5, 420, h.ang + Math.PI, 2.6);
      if (out <= 0) { for (const s of [h.hole, h.shadow, h.bone, h.glow]) this.give(s); return false; }
    }
    // After the grip it DRAGS: the wrist creeps back out (pulling), the fingers clench and tremble.
    const since = h.age - h.rise;
    const pull = since > 0 ? Math.min(1, since / 500) * h.drag : 0;
    const trem = since > 0 ? Math.sin(h.age * 0.09) * 0.05 : 0;
    const clench = h.grip > 0 ? 0.86 + 0.04 * Math.sin(h.age * 0.05) : 1;
    const bx = h.at.x - Math.cos(h.ang) * pull, by = h.at.y - Math.sin(h.ang) * pull;
    const k = h.len / HAND_LEN;
    const rot = h.ang + Math.PI / 2 + trem;
    const sx = k * (0.55 + 0.45 * clamp01(u * 1.5)) * out, sy = k * grow * clench * out;
    for (const [s, m, a] of [[h.shadow, 1.1, 0.5], [h.bone, 1, 0.95], [h.glow, 1.04, 0.55]] as [Sprite, number, number][]) {
      s.position.set(bx, by); flatTransform(s, rot, sx * m, sy * m); s.alpha = a * clamp01(u * 4) * out;
    }
    const hs = (h.len * 0.9) / GLOW_PX;
    h.hole.position.set(h.at.x, h.at.y); flatTransform(h.hole, h.ang, hs * 0.8, hs * 0.6); h.hole.alpha = 0.6 * clamp01(u * 3) * out;
    return true;
  }

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;
    this.clock += dt;
    const S = this.scale;
    const c = this.colors;

    if (this.warm.length) {
      this.warmLeft -= Math.max(dt, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    // The raise: wisps spiral in round the hero's rim, grave smoke circles it.
    const ra = this.raiseAcc;
    if (ra) {
      ra.acc += dt * 0.03;
      while (ra.acc >= 1) {
        ra.acc -= 1;
        const a = this.rnd() * Math.PI * 2;
        const rr = ra.r * (1.6 + this.rnd() * 0.6);
        const tang = 1;
        const sp = 260;
        this.freeWisp(ra.x + Math.cos(a) * rr, ra.y + Math.sin(a) * rr,
          (-Math.sin(a) * tang - Math.cos(a) * 0.9) * sp, (Math.cos(a) * tang - Math.sin(a) * 0.9) * sp,
          { life: 360, size: 0.75, grav: 0, drag: 0.6, wander: 0 });
      }
      if (this.look.smokeRing > 0) {
        ra.smoke += dt * 0.022 * this.look.smokeRing;
        while (ra.smoke >= 1) {
          ra.smoke -= 1;
          ra.turn += 0.9;
          const a = ra.turn;
          const px = ra.x + Math.cos(a) * ra.r * 1.08, py = ra.y + Math.sin(a) * ra.r * 1.08;
          this.tw('body', this.tex.mist, mixColor(c.void, c.ghost, 0.18), px, py, {
            dur: 620, from: (ra.r * 0.5) / MIST_PX / S, to: (ra.r * 1) / MIST_PX / S, a0: 0.42, ease: easeOutCubic, inMs: 90, outFrom: 0.35,
            vx: -Math.sin(a) * 120 * S, vy: Math.cos(a) * 120 * S, spin: 0.002,
          });
        }
      }
    }

    // The rift: it tears open, glows, pours motes and mist while open, and closes.
    const rf = this.rift;
    if (rf) {
      rf.age += dt;
      const u = clamp01(rf.age / rf.tear);
      const open = easeOutCubic(u);
      const fade = rf.fadeT >= 0 ? clamp01((rf.fadeT += dt) / rf.fadeMs) : 0;
      const live = 1 - fade;
      const sx = ((rf.len * open) / RIFT_W) / 1, syBase = (rf.len * 0.34) / RIFT_H;
      const sy = syBase * (0.35 + 0.65 * easeOutBack(u, 1.6)) * (1 - 0.8 * easeInOutSine(fade));
      const pulse = 0.85 + 0.15 * Math.sin(rf.age * 0.012);
      for (const [s, m, a] of [[rf.voidS, 1, 1], [rf.inner, 0.42, 0.5 * pulse], [rf.edge, 1, 0.8], [rf.hot, 0.97, 0.32 * pulse]] as [Sprite, number, number][]) {
        flatTransform(s, rf.ang, sx * (m < 0.5 ? 0.82 : 1), sy * m);
        s.alpha = a * live * clamp01(rf.age / 40);
      }
      if (fade < 0.6) {
        rf.moteAcc += dt * 0.06;
        while (rf.moteAcc >= 1) {
          rf.moteAcc -= 1;
          const along = (this.rnd() - 0.5) * rf.len * open * 0.85;
          const px = rf.at.x + Math.cos(rf.ang) * along, py = rf.at.y + Math.sin(rf.ang) * along;
          if (this.rnd() < 0.45) this.freeWisp(px, py, (this.rnd() - 0.5) * 50, -(120 + this.rnd() * 120), { life: 650, size: 0.7 });
          else this.particle('hot', this.tex.star, this.rnd() < 0.5 ? c.ghost : c.core, {
            x: px, y: py, vx: (this.rnd() - 0.5) * 40 * S, vy: -(100 + this.rnd() * 160) * S, drag: 0.4, grav: -40 * S, life: 700 + this.rnd() * 400,
            from: 0.34 * S, to: 0.08 * S, alpha: 1, spin: 0.004,
          });
        }
        rf.mistAcc += dt * 0.012;
        while (rf.mistAcc >= 1) {
          rf.mistAcc -= 1;
          const along = (this.rnd() - 0.5) * rf.len * open * 0.7;
          const px = rf.at.x + Math.cos(rf.ang) * along, py = rf.at.y + Math.sin(rf.ang) * along;
          this.tw('body', this.tex.mist, mixColor(c.void, c.ghost, 0.22), px, py, { dur: 900, from: 0.7, to: 2, a0: 0.3, ease: easeOutCubic, inMs: 120, outFrom: 0.3, vx: (this.rnd() - 0.5) * 30 * S, vy: -60 * S });
        }
      }
      if (fade >= 1) this.dropRift(rf);
    }

    for (let i = this.skulls.length - 1; i >= 0; i--) {
      const sk = this.skulls[i]!;
      if (!this.stepSkull(sk, dt)) this.dropSkull(sk);
    }

    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const w = this.wisps[i]!;
      if (!this.stepWisp(w, dt, sec)) { this.give(w.head); this.give(w.tail); this.give(w.echo); this.wisps.splice(i, 1); }
    }

    for (let i = this.hands.length - 1; i >= 0; i--) {
      if (!this.stepHand(this.hands[i]!, dt)) this.hands.splice(i, 1);
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) { q.s.alpha = 0; continue; } }
      q.age += dt;
      q.rot += q.spin * dt;
      q.x += q.vx * sec; q.y += q.vy * sec;
      q.vx *= Math.pow(0.12, sec); q.vy *= Math.pow(0.12, sec);
      this.paintFx(q);
      if (q.age >= q.dur) { this.give(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.held.length - 1; i >= 0; i--) {
      const h = this.held[i]!;
      h.age += dt;
      h.rot += h.spin * dt;
      if (h.kick > 0) { h.kickAge += dt; if (h.kickAge > 600) h.kick = 0; }
      if (h.fadeT >= 0) h.fadeT += dt;
      this.paintHeld(h);
      if (h.fadeT >= h.fadeMs && h.fadeT >= 0) { this.give(h.s); this.held.splice(i, 1); }
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
      if (p.align) { p.s.rotation = Math.atan2(p.vy, p.vx); p.s.scale.set(sc * 1.6, sc * 0.7); } else { p.s.scale.set(sc); if (p.spin) p.s.rotation += p.spin * dt; }
      p.s.alpha = p.alpha * Math.min(1, (p.max - p.life) / 40) * (1 - t * t);
    }

    return this.used > this.warm.length;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const q of this.fx) this.give(q.s);
    for (const h of this.held) this.give(h.s);
    for (const p of this.particles) this.give(p.s);
    for (const w of this.wisps) { this.give(w.head); this.give(w.tail); this.give(w.echo); }
    for (const sk of [...this.skulls]) this.dropSkull(sk);
    for (const h of this.hands) for (const s of [h.hole, h.shadow, h.bone, h.glow]) this.give(s);
    if (this.rift) this.dropRift(this.rift);
    for (const s of this.warm) this.give(s);
    this.fx = []; this.held = []; this.particles = []; this.wisps = []; this.skulls = []; this.hands = []; this.rift = null;
    this.warm = []; this.raiseAcc = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.free[id].length = 0;
      this.layers[id].removeChildren().forEach((ch) => ch.destroy());
    }
    this.root.removeChildren().forEach((ch) => ch.destroy());
    this.root.destroy();
  }
}
