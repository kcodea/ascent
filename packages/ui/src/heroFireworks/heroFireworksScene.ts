/**
 * THE GRAND FINALE SCENE: everything the fireworks attack draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroFireworks.ts` mounts `root` on the
 * above-portrait overlay and feeds `update(dt)`.
 *
 * WHAT IT DRAWS
 *  - THE FIREWORK: one painted sprite (the bottle rocket, the roman candle or the mortar) planted on a soft contact
 *    shadow. It pops up from its foot, trembles a little while its fuse burns, squashes on every thump and is taken
 *    away at the end. The rocket IS its own projectile: on launch the same sprite flies the path, nose first.
 *  - THE FUSE: a bright point that burns along the painted fuse toward the body, spitting tiny sparks. Sparks only,
 *    no flame.
 *  - FLIGHTS: the rocket (a thin trail of sparks dropped behind it), the candle's balls (a glow, a white core and a
 *    few afterimages sampled back along the path), and the mortar's comet (a faint streak that leaves the top of the
 *    screen).
 *  - A POP: a small star burst of ONE colour (even spokes of streaks that slow and droop, a ring, a flash, a few
 *    crackle twinkles).
 *  - THE BLOOM: a chrysanthemum. Two rings of stars thrown evenly outward that slow hard and droop under gravity, a
 *    smaller bloom inside a moment later, crackle glitter, a brief light across the sky, and sparks that fall on true
 *    ballistic paths onto the struck portrait and twinkle out where they land.
 *
 * THE BLOOM'S STARS are the only crowd here, so they are kept honest: one sprite each, in flat typed arrays (no object
 * per star, nothing allocated per frame), hard capped at `MAX_STARS`, additive, no filters. Their sprites are created
 * ahead of time, a few per frame while the damage formation still plays (`prefill`), so the bloom frame creates none.
 *
 * LAYERS (the pool's): under (normal: shadow, smoke) | glow (additive) | body (normal: the firework) | core (additive:
 * sparks, stars, flashes). Contract: sprites are POOLED and bounded by `MAX_FIREWORKS_SPRITES`; textures are the
 * caller's; positions are the overlay's px; `update` returns whether anything still draws; `destroy()` leaves nothing
 * behind. Everything random is seeded (a replay throws the same sparks).
 */
import { Texture, type Sprite } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInBack, easeOutBack, mixColor, spring, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { PROP_METRICS, fireworksPathAt, propPoint, type FireworkProp, type FireworksGeo, type FireworksPath } from './heroFireworksConfig';

export interface HeroFireworksTextures extends HeroArcanaTextures {
  /** The three painted fireworks (full colour, upright, fuse on the left). */
  rocket: Texture;
  candle: Texture;
  mortar: Texture;
}

export interface FireworksColors { core: number; gold: number; magenta: number; cyan: number; green: number; side: number }

export interface FireworksLook {
  /** A spark is dropped behind the rocket this often (ms). */
  trailMs: number;
  /** How long a bloom star lives. */
  bloomMs: number;
  /** Sparks that fall from the bloom onto the struck portrait, and how long they take. */
  rain: number;
  rainMs: number;
  /** Crackle twinkles inside the bloom. */
  glitter: number;
  /** The light the bloom throws across the whole view (peak opacity). */
  skyFlash: number;
  dismissMs: number;
  flashAlpha: number;
  /** Star sprites to create ahead of the bloom (0 = none: the rocket and the candle need none). */
  prefill: number;
}

/** Hard cap on sprites alive at once (a bloom peaks around 230). */
export const MAX_FIREWORKS_SPRITES = 420;
/** Hard cap on bloom stars (and falling sparks) alive at once. */
export const MAX_STARS = 240;

const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
const STREAK_PX = 64;
const SMOKE = 0xcfd3e6;
const SHADOW = 0x070a1c;
/** A thump's squash is over (exactly) after this long. */
const RECOIL_MS = 240;

interface Prop {
  kind: FireworkProp;
  s: Sprite; shadow: Sprite | null;
  g: FireworksGeo;
  sx: number; sy: number;
  age: number; plantMs: number;
  /** Ms since the last thump (-1 = none yet). */
  recoil: number; recoilAmp: number;
  /** Ms into being taken away (-1 = standing). */
  leaving: number;
  /** The rocket has left the ground (the sprite is flying). */
  flown: boolean;
}

interface Fuse { glow: Sprite; star: Sprite; age: number; dur: number; acc: number }

interface Rocket { path: FireworksPath; age: number; dur: number; tint: number; acc: number; px: number; py: number; glow: Sprite | null }

interface Ball { path: FireworksPath; age: number; dur: number; tint: number; glow: Sprite; core: Sprite; ghosts: Sprite[]; acc: number }

interface Comet { path: FireworksPath; age: number; dur: number; head: Sprite; tail: Sprite; acc: number; px: number; py: number }

/** A star's kind: a bloom star (slows hard, droops) or a falling spark (ballistic, twinkles out where it lands). */
const STAR = 0;
const RAIN = 1;

export class HeroFireworksScene extends FxPool {
  private prop: Prop | null = null;
  private fuseFx: Fuse | null = null;
  private rocket: Rocket | null = null;
  private balls: Ball[] = [];
  private cometFx: Comet | null = null;
  private sky: { s: Sprite; age: number; a0: number } | null = null;
  private viewW = 1920;
  private viewH = 1080;
  private readonly pt: Pt = { x: 0, y: 0 };
  // The bloom's stars, as flat arrays (index 0..nStars-1 alive).
  private nStars = 0;
  private readonly sS: (Sprite | null)[] = new Array<Sprite | null>(MAX_STARS).fill(null);
  private readonly sX = new Float32Array(MAX_STARS);
  private readonly sY = new Float32Array(MAX_STARS);
  private readonly sVx = new Float32Array(MAX_STARS);
  private readonly sVy = new Float32Array(MAX_STARS);
  private readonly sLife = new Float32Array(MAX_STARS);
  private readonly sMax = new Float32Array(MAX_STARS);
  private readonly sDelay = new Float32Array(MAX_STARS);
  private readonly sSize = new Float32Array(MAX_STARS);
  private readonly sDrag = new Float32Array(MAX_STARS);
  private readonly sGrav = new Float32Array(MAX_STARS);
  private readonly sKind = new Uint8Array(MAX_STARS);
  // Star sprites made ahead of the bloom.
  private prefillLeft: number;
  private held: Sprite[] = [];

  constructor(private readonly tex: HeroFireworksTextures, private readonly colors: FireworksColors, private readonly look: FireworksLook, scale = 1, seed = 1) {
    super('heroFireworks', [tex.glow, tex.spark, tex.streak, tex.ring, tex.star, tex.rocket, tex.candle, tex.mortar], scale, seed, MAX_FIREWORKS_SPRITES);
    this.prefillLeft = Math.max(0, Math.min(MAX_STARS, Math.round(look.prefill)));
  }

  get planted(): boolean { return !!this.prop && !this.prop.flown && this.prop.leaving < 0; }
  get fuseLit(): boolean { return this.fuseFx !== null; }
  get rocketFlying(): boolean { return this.rocket !== null; }
  get liveBalls(): number { return this.balls.length; }
  get cometUp(): boolean { return this.cometFx !== null; }
  get liveStars(): number { return this.nStars; }
  /** Whether anything at all is in motion (false through the mortar's held beat: only the standing tube is drawn). */
  get moving(): boolean { return this.liveFx > 0 || this.nStars > 0 || !!this.fuseFx || !!this.rocket || this.balls.length > 0 || !!this.cometFx || !!this.sky || (!!this.prop && (this.prop.leaving >= 0 || this.prop.age < this.prop.plantMs || this.prop.recoil >= 0)); }

  /** The view (overlay px), measured once by the runner: the bloom's light covers it. */
  setView(w: number, h: number): void { if (w > 0 && h > 0) { this.viewW = w; this.viewH = h; } }

  // ── the firework ──────────────────────────────────────────────────────────────────────────────────────────

  /** Plant the firework: it pops up from its foot over `plantMs`, on a soft contact shadow. */
  plant(g: FireworksGeo, plantMs: number): void {
    if (this.prop || !g.prop) return;
    const M = PROP_METRICS[g.prop];
    const t = this.tex[g.prop];
    const s = this.take('body', t, 0xffffff);
    if (!s) return;
    s.anchor.set(M.ax, M.ay);
    const shadow = this.take('under', this.tex.glow, SHADOW);
    if (shadow) { shadow.position.set(g.base.x, g.base.y); shadow.alpha = 0; }
    this.prop = {
      kind: g.prop, s, shadow, g, sx: ((M.w * g.k) / (t.width || 1)) * g.flip, sy: (M.h * g.k) / (t.height || 1),
      age: 0, plantMs: Math.max(1, plantMs), recoil: -1, recoilAmp: 0, leaving: -1, flown: false,
    };
    // A little puff of dust where it lands.
    const S = this.scale;
    for (const sd of [-1, 1]) this.spawn('under', this.tex.glow, SMOKE, g.base.x + sd * 14 * S, g.base.y, { dur: 380, from: 0.1, to: 0.34, a0: 0.4, vx: sd * 70, vy: -18, drag: 0.05, delay: plantMs * 0.5 });
    this.drawProp(0);
  }

  /** Light the fuse: a bright point burns along it toward the body for `durMs`, spitting tiny sparks. */
  fuse(durMs: number): void {
    if (!this.prop || this.fuseFx) return;
    const glow = this.take('glow', this.tex.glow, this.colors.gold);
    const star = this.take('core', this.tex.star, this.colors.core);
    if (!glow || !star) { this.give(glow); this.give(star); return; }
    glow.alpha = 0; star.alpha = 0;
    this.fuseFx = { glow, star, age: 0, dur: Math.max(1, durMs), acc: 0 };
  }

  private endFuse(): void {
    const f = this.fuseFx;
    if (!f) return;
    this.give(f.glow); this.give(f.star);
    this.fuseFx = null;
  }

  /** The firework is taken away (it sinks a little and fades). */
  dismiss(): void { if (this.prop && this.prop.leaving < 0 && !this.prop.flown) this.prop.leaving = 0; }

  private dropProp(): void {
    const p = this.prop;
    if (!p) return;
    this.give(p.s); this.give(p.shadow);
    this.prop = null;
  }

  private drawProp(dt: number): void {
    const p = this.prop;
    if (!p) return;
    p.age += dt;
    if (p.recoil >= 0) p.recoil += dt;
    if (p.flown) return; // the rocket's sprite is drawn by its flight
    const g = p.g;
    const M = PROP_METRICS[p.kind];
    const S = this.scale;
    const grow = easeOutBack(p.age / p.plantMs, 1.8);
    let sx = grow, sy = grow, alpha = 1, rot = g.angle, sink = 0;
    if (p.recoil >= RECOIL_MS) p.recoil = -1; // at rest again (exactly: nothing moves through the held beat)
    if (p.recoil >= 0) {
      const r = (1 - p.recoil / RECOIL_MS) * p.recoilAmp * Math.max(-0.4, spring(p.recoil, 7, 70));
      sy *= 1 - r; sx *= 1 + r * 0.55;
    }
    // While its fuse burns the rocket and the candle tremble on the spot.
    if (this.fuseFx && p.kind !== 'mortar') rot += 0.022 * Math.sin(p.age * 0.085) * clamp01(this.fuseFx.age / this.fuseFx.dur + 0.3);
    if (p.leaving >= 0) {
      p.leaving += dt;
      const u = clamp01(p.leaving / this.look.dismissMs);
      alpha = 1 - u; sink = 12 * S * u;
      const k = 1 - 0.22 * easeInBack(u);
      sx *= k; sy *= k;
    }
    // The rocket turns about its body, so it is carried up its stick as it grows.
    const foot = M.foot * g.k * grow;
    p.s.position.set(g.base.x + g.dir.x * foot, g.base.y + g.dir.y * foot + sink);
    p.s.rotation = rot;
    p.s.scale.set(p.sx * sx, p.sy * sy);
    p.s.alpha = alpha;
    if (p.shadow) {
      const w = (M.w * g.k * (p.kind === 'rocket' ? 0.5 : 1.25)) / GLOW_PX;
      p.shadow.scale.set(w * grow, w * 0.22 * grow);
      p.shadow.alpha = 0.55 * Math.min(1, grow) * alpha;
    }
    if (p.leaving >= this.look.dismissMs) this.dropProp();
  }

  private drawFuse(dt: number): void {
    const f = this.fuseFx, p = this.prop;
    if (!f) return;
    if (!p) { this.endFuse(); return; }
    f.age += dt;
    if (f.age >= f.dur) { this.endFuse(); return; }
    const M = PROP_METRICS[p.kind];
    const u = f.age / f.dur;
    const at = propPoint(p.g, M.fuse0[0] + (M.fuse1[0] - M.fuse0[0]) * u, M.fuse0[1] + (M.fuse1[1] - M.fuse0[1]) * u, this.pt);
    const S = this.scale;
    const flick = 0.75 + 0.25 * Math.sin(f.age * 0.11) * Math.sin(f.age * 0.037 + 1);
    f.glow.position.set(at.x, at.y); f.glow.scale.set((46 * S * flick) / GLOW_PX); f.glow.alpha = 0.85 * Math.min(1, f.age / 50);
    f.star.position.set(at.x, at.y); f.star.scale.set((30 * S * flick) / STAR_PX); f.star.rotation = f.age * 0.012; f.star.alpha = Math.min(1, f.age / 50);
    f.acc += dt;
    while (f.acc >= 20) {
      f.acc -= 20;
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.6;
      const sp = 90 + this.rnd() * 190;
      this.spawn('core', this.tex.spark, this.rnd() < 0.4 ? this.colors.core : this.colors.gold, at.x, at.y, {
        dur: 150 + this.rnd() * 130, from: 0.2 + this.rnd() * 0.12, to: 0.05, a0: 1, ease: 'linear', vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.15, grav: 620,
      });
    }
  }

  // ── flights ───────────────────────────────────────────────────────────────────────────────────────────────

  /** The rocket leaves its stand: the planted sprite itself flies `path`, nose first, dropping a thin spark trail. */
  launchRocket(path: FireworksPath, flyMs: number, tint: number, late = 0): void {
    const p = this.prop;
    this.endFuse();
    if (!p || p.flown) return;
    p.flown = true;
    this.give(p.shadow); p.shadow = null;
    const S = this.scale;
    // The kick off the ground: a puff and a few sparks thrown back down the stick.
    const b = p.g.base;
    this.spawn('under', this.tex.glow, SMOKE, b.x, b.y, { dur: 420, from: 0.14, to: 0.5, a0: 0.5, vy: -30, drag: 0.1 });
    this.burst('core', this.tex.spark, [this.colors.core, tint], path.from.x - p.g.dir.x * 30 * S, path.from.y - p.g.dir.y * 30 * S, 7, {
      speed: 260, dir: Math.atan2(-p.g.dir.y, -p.g.dir.x), spread: 1.1, life: 240, size: 0.26, grav: 500, drag: 0.1,
    });
    const glow = this.take('glow', this.tex.glow, tint);
    this.rocket = { path, age: Math.max(0, late), dur: Math.max(1, flyMs), tint, acc: 0, px: path.from.x - p.g.dir.x, py: path.from.y - p.g.dir.y, glow };
    this.drawRocket(0);
  }

  private endRocket(): void {
    const r = this.rocket;
    if (!r) return;
    this.give(r.glow);
    this.rocket = null;
    this.dropProp();
  }

  private drawRocket(dt: number): void {
    const r = this.rocket, p = this.prop;
    if (!r) return;
    if (!p) { this.give(r.glow); this.rocket = null; return; }
    r.age += dt;
    const u = r.age / r.dur;
    if (u >= 1) { this.endRocket(); return; }
    // It gathers speed as it goes.
    const e = 0.3 * u + 0.7 * u * u;
    const at = fireworksPathAt(r.path, e, this.pt);
    const dx = at.x - r.px, dy = at.y - r.py;
    const L = Math.hypot(dx, dy);
    const hx = L > 0.01 ? dx / L : p.g.dir.x, hy = L > 0.01 ? dy / L : p.g.dir.y;
    if (L > 0.01) p.s.rotation = Math.atan2(hy, hx) + Math.PI / 2;
    p.s.position.set(at.x, at.y);
    p.s.scale.set(p.sx, p.sy);
    p.s.alpha = 1;
    r.px = at.x; r.py = at.y;
    const S = this.scale;
    const tail = 34 * p.g.k;
    const tx = at.x - hx * tail, ty = at.y - hy * tail;
    if (r.glow) { r.glow.position.set(tx, ty); r.glow.scale.set((84 * S * (0.85 + 0.15 * Math.sin(r.age * 0.09))) / GLOW_PX); r.glow.alpha = 0.9; }
    r.acc += dt;
    while (r.acc >= this.look.trailMs) {
      r.acc -= this.look.trailMs;
      const side = (this.rnd() - 0.5) * 70;
      this.spawn('core', this.tex.spark, this.rnd() < 0.35 ? this.colors.core : r.tint, tx, ty, {
        dur: 380 + this.rnd() * 260, from: 0.42 + this.rnd() * 0.26, to: 0.06, a0: 1, ease: 'linear',
        vx: -hx * 60 - hy * side, vy: -hy * 60 + hx * side, drag: 0.2, grav: 160,
      });
    }
  }

  /**
   * A thump: the tube squashes, its mouth flashes in the ball's colour and coughs a puff and a few sparks. `quick`
   * (the mortar): everything it throws is gone within 260 ms, so nothing of it lingers into the held beat.
   */
  thump(tint: number, strength: number, quick = false): void {
    const p = this.prop;
    this.endFuse();
    if (!p) return;
    p.recoil = 0; p.recoilAmp = 0.11 + 0.07 * strength;
    const m = p.g.mouth, d = p.g.dir;
    const S = this.scale;
    const P = strength;
    this.spawn('core', this.tex.glow, this.colors.core, m.x, m.y, { dur: 150, from: (60 * P) / GLOW_PX, to: (200 * P) / GLOW_PX, a0: 0.95, mode: 'punch', peakAt: 0.15 });
    this.spawn('glow', this.tex.glow, tint, m.x, m.y, { dur: quick ? 240 : 300, from: (100 * P) / GLOW_PX, to: (300 * P) / GLOW_PX, a0: 0.7, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.ring, tint, m.x, m.y, { dur: 260, from: (20 * P) / RING_PX, to: (120 * P) / RING_PX, a0: 0.7, sy: 0.45, rot: p.g.angle, ease: 'cubic' });
    this.burst('core', this.tex.spark, [this.colors.core, tint, this.colors.gold], m.x, m.y, Math.round(5 + 5 * P), {
      speed: 300 * P, dir: Math.atan2(d.y, d.x), spread: 1.0, life: quick ? 190 : 260, size: 0.24, grav: 520, drag: 0.08,
    });
    for (let i = 0; i < 2 + Math.round(P); i++) {
      this.spawn('under', this.tex.glow, SMOKE, m.x + (this.rnd() - 0.5) * 24 * S, m.y, {
        dur: quick ? 200 : 520 + this.rnd() * 200, from: 0.22 * P, to: 0.62 * P, a0: 0.55, vx: d.x * 90 + (this.rnd() - 0.5) * 60, vy: d.y * 90 - 20, drag: 0.06, delay: quick ? i * 15 : i * 40,
      });
    }
    if (p.kind === 'mortar') {
      // The plank jumps: dust off both ends.
      for (const sd of [-1, 1]) this.spawn('under', this.tex.glow, SMOKE, p.g.base.x + sd * 50 * S, p.g.base.y - 4 * S, { dur: quick ? 230 : 440, from: 0.14, to: 0.46, a0: 0.45, vx: sd * 130, vy: -30, drag: 0.04 });
    }
  }

  /** A candle ball leaves the mouth along `path`: a glow, a white core and a few afterimages. */
  ball(path: FireworksPath, flyMs: number, tint: number, late = 0): void {
    const glow = this.take('glow', this.tex.glow, tint);
    const core = this.take('core', this.tex.spark, whiten(tint, 0.75));
    if (!glow || !core) { this.give(glow); this.give(core); return; }
    const ghosts: Sprite[] = [];
    for (let i = 0; i < 5; i++) { const s = this.take('core', this.tex.spark, tint); if (s) ghosts.push(s); }
    this.balls.push({ path, age: Math.max(0, late), dur: Math.max(1, flyMs), tint, glow, core, ghosts, acc: 0 });
  }

  private endBall(b: Ball): void {
    this.give(b.glow); this.give(b.core);
    for (const s of b.ghosts) this.give(s);
  }

  private drawBalls(dt: number): void {
    const S = this.scale;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i]!;
      b.age += dt;
      const u = b.age / b.dur;
      if (u >= 1) { this.endBall(b); this.balls.splice(i, 1); continue; }
      // Thumped out fast, easing a touch as it arrives.
      const e = 1 - Math.pow(1 - u, 1.35);
      const at = fireworksPathAt(b.path, e, this.pt);
      const pulse = 1 + 0.08 * Math.sin(b.age * 0.07);
      b.glow.position.set(at.x, at.y); b.glow.scale.set((190 * S * pulse) / GLOW_PX); b.glow.alpha = 0.95;
      b.core.position.set(at.x, at.y); b.core.scale.set((58 * S) / 32); b.core.alpha = 1;
      const x0 = at.x, y0 = at.y;
      for (let j = 0; j < b.ghosts.length; j++) {
        const g = b.ghosts[j]!;
        const q = fireworksPathAt(b.path, e - (j + 1) * 0.045, this.pt);
        const f = 1 - (j + 1) / (b.ghosts.length + 1);
        g.position.set(q.x, q.y); g.scale.set((50 * S * f) / 32); g.alpha = e > (j + 1) * 0.045 ? 0.8 * f : 0;
      }
      b.acc += dt;
      while (b.acc >= 34) {
        b.acc -= 34;
        this.spawn('core', this.tex.star, this.rnd() < 0.3 ? this.colors.core : b.tint, x0 + (this.rnd() - 0.5) * 14 * S, y0 + (this.rnd() - 0.5) * 14 * S, {
          dur: 260 + this.rnd() * 140, from: 0.3, to: 0.08, a0: 0.9, ease: 'linear', vy: 30, grav: 220, rot: this.rnd() * 3, spin: 0.006,
        });
      }
    }
  }

  /** The mortar's shell: a FAINT comet that rises fast along `path` and is gone off the top of the view. */
  comet(path: FireworksPath, riseMs: number, late = 0): void {
    if (this.cometFx) return;
    const head = this.take('core', this.tex.spark, this.colors.core);
    const tail = this.take('core', this.tex.streak, this.colors.gold);
    if (!head || !tail) { this.give(head); this.give(tail); return; }
    tail.anchor.set(0.94, 0.5);
    this.cometFx = { path, age: Math.max(0, late), dur: Math.max(1, riseMs), head, tail, acc: 0, px: path.from.x, py: path.from.y + 1 };
    this.drawComet(0);
  }

  private drawComet(dt: number): void {
    const c = this.cometFx;
    if (!c) return;
    c.age += dt;
    const u = c.age / c.dur;
    if (u >= 1) { this.give(c.head); this.give(c.tail); this.cometFx = null; return; }
    const at = fireworksPathAt(c.path, u, this.pt);
    const S = this.scale;
    const dx = at.x - c.px, dy = at.y - c.py;
    c.head.position.set(at.x, at.y); c.head.scale.set((22 * S) / 32); c.head.alpha = 0.7;
    c.tail.position.set(at.x, at.y); c.tail.rotation = Math.atan2(dy, dx); c.tail.scale.set((150 * S) / STREAK_PX, (9 * S) / 18); c.tail.alpha = 0.5;
    c.px = at.x; c.py = at.y;
    c.acc += dt;
    // Its trail thins out before it leaves, and the last of it winks out just after (then nothing moves).
    while (c.acc >= 22) {
      c.acc -= 22;
      if (u > 0.85) continue;
      this.spawn('core', this.tex.spark, this.colors.gold, at.x + (this.rnd() - 0.5) * 8 * S, at.y, { dur: 110 + this.rnd() * 80, from: 0.16, to: 0.03, a0: 0.55, ease: 'linear', vx: (this.rnd() - 0.5) * 40, vy: 60, grav: 200 });
    }
  }

  // ── bursts ────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A POP on the struck portrait: a small star burst of ONE colour. Even spokes of streaks that slow and droop, a
   * ring, a flash and a few crackle twinkles. It rides the portrait's knockback. Ends the rocket if it is the rocket's.
   */
  pop(at: Pt, tint: number, strength: number, spokes: number): void {
    this.endRocket();
    const P = strength;
    const S = this.scale;
    const hot = whiten(tint, 0.6);
    this.spawn('core', this.tex.glow, this.colors.core, at.x, at.y, { dur: 170, from: (50 * P) / GLOW_PX, to: (190 * P) / GLOW_PX, a0: this.look.flashAlpha, mode: 'punch', peakAt: 0.12, follow: true });
    this.spawn('glow', this.tex.glow, tint, at.x, at.y, { dur: 460, from: (110 * P) / GLOW_PX, to: (330 * P) / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.1, follow: true });
    this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 340, from: (30 * P) / RING_PX, to: (210 * P) / RING_PX, a0: 0.8, ease: 'cubic', follow: true });
    this.spawn('core', this.tex.star, hot, at.x, at.y, { dur: 180, from: (50 * P) / STAR_PX, to: (130 * P) / STAR_PX, a0: 0.8, mode: 'punch', peakAt: 0.15, rot: 0.4, follow: true });
    const n = Math.max(0, Math.round(spokes));
    const off = this.rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + (this.rnd() - 0.5) * 0.14;
      const sp = 620 * P * (0.88 + this.rnd() * 0.24);
      this.spawn('core', this.tex.streak, i % 3 === 2 ? hot : tint, at.x, at.y, {
        dur: 460 + this.rnd() * 180, from: 0.8 * P, to: 0.4 * P, a0: 1, mode: 'hold', ease: 'linear', sy: 0.6,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.02, grav: 380, align: true,
      });
    }
    // A short inner spray, white hot.
    for (let i = 0; i < Math.round(n * 0.5); i++) {
      const a = off + ((i + 0.5) / Math.max(1, Math.round(n * 0.5))) * Math.PI * 2;
      const sp = 300 * P * (0.8 + this.rnd() * 0.4);
      this.spawn('core', this.tex.streak, this.colors.core, at.x, at.y, { dur: 280, from: 0.5 * P, to: 0.2 * P, a0: 0.95, ease: 'linear', sy: 0.55, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.01, grav: 300, align: true });
    }
    // Crackle: a few twinkles where the spokes die.
    for (let i = 0; i < 5; i++) {
      const a = this.rnd() * Math.PI * 2, rr = (60 + this.rnd() * 70) * P * S;
      this.spawn('core', this.tex.star, i % 2 ? this.colors.core : tint, at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr + 18 * S, {
        dur: 150 + this.rnd() * 90, from: 0.12, to: 0.5 * P, a0: 1, mode: 'punch', peakAt: 0.3, rot: this.rnd() * 3, delay: 200 + this.rnd() * 260,
      });
    }
  }

  private addStar(kind: number, x: number, y: number, vx: number, vy: number, life: number, delay: number, size: number, drag: number, grav: number, tint: number): void {
    if (this.nStars >= MAX_STARS) return;
    const s = this.take('core', this.tex.streak, tint);
    if (!s) return;
    s.anchor.set(0.9, 0.5);
    s.position.set(x, y);
    s.alpha = 0;
    const i = this.nStars++;
    this.sS[i] = s; this.sX[i] = x; this.sY[i] = y; this.sVx[i] = vx; this.sVy[i] = vy; this.sLife[i] = life; this.sMax[i] = life;
    this.sDelay[i] = delay; this.sSize[i] = size; this.sDrag[i] = drag; this.sGrav[i] = grav; this.sKind[i] = kind;
  }

  /**
   * THE BLOOM: a chrysanthemum opens at `at` with radius `R`. `outer` stars in the first ring (gold), a second ring
   * inside it (magenta), a smaller bloom a moment later (cyan), green and white crackle, a light across the sky, and
   * `look.rain` sparks that fall onto the disc of radius `targetR` round `target` and twinkle out there.
   */
  bloom(at: Pt, R: number, target: Pt, targetR: number, outer: number, burst: number): void {
    const S = this.scale;
    const c = this.colors;
    const B = burst;
    // The flash, a flare, a soft halo that lingers, and a shock ring.
    this.spawn('core', this.tex.glow, c.core, at.x, at.y, { dur: 260, from: (R * 0.5) / GLOW_PX / S, to: (R * 2.4 * B) / GLOW_PX / S, a0: this.look.flashAlpha, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, c.core, at.x, at.y, { dur: 300, from: (R * 0.3) / STAR_PX / S, to: (R * 1.1 * B) / STAR_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.14, rot: 0.35 });
    this.spawn('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 1000, from: (R * 2) / GLOW_PX / S, to: (R * 3.4) / GLOW_PX / S, a0: 0.42, mode: 'punch', peakAt: 0.08, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 520, from: (R * 0.3) / RING_PX / S, to: (R * 2.5) / RING_PX / S, a0: 0.26, ease: 'cubic' });
    if (this.look.skyFlash > 0 && !this.sky) {
      const s = this.take('glow', Texture.WHITE, mixColor(c.gold, 0xffffff, 0.5));
      if (s) { s.anchor.set(0); s.alpha = 0; this.sky = { s, age: 0, a0: this.look.skyFlash }; }
    }
    // The rings. A star leaves at v0 and slows at `drag` per second, so it travels v0 / drag: R.
    const drag = 3.3;
    const grav = 300 * S;
    const life = this.look.bloomMs;
    const ring = (n: number, reach: number, tint: number, delay: number, size: number, lifeK: number): void => {
      const off = this.rnd() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2 + (this.rnd() - 0.5) * 0.09;
        const v = R * reach * drag * (0.94 + this.rnd() * 0.12);
        this.addStar(STAR, at.x, at.y, Math.cos(a) * v, Math.sin(a) * v, life * lifeK * (0.86 + this.rnd() * 0.28), delay, size * S, drag, grav, i % 5 === 4 ? whiten(tint, 0.55) : tint);
      }
    };
    const n1 = Math.max(0, Math.round(outer));
    ring(n1, 1, c.gold, 0, 0.95, 1);
    ring(Math.round(n1 * 0.62), 0.68, c.magenta, 0, 0.85, 0.92);
    ring(Math.round(n1 * 0.4), 0.36, c.cyan, 120, 0.75, 0.8);
    this.spawn('core', this.tex.glow, c.cyan, at.x, at.y, { dur: 260, from: (R * 0.3) / GLOW_PX / S, to: (R * 1.1) / GLOW_PX / S, a0: 0.7, mode: 'punch', peakAt: 0.15, delay: 120 });
    // Falling sparks: each leaves the lower half of the bloom and lands on the portrait after its own flight time.
    const g = 900 * S;
    // They start in the half of the bloom that faces the portrait (the lower half when it hangs above it).
    const face = Math.atan2(target.y - at.y, target.x - at.x);
    for (let i = 0; i < Math.round(this.look.rain); i++) {
      const a = face + Math.PI * 0.8 * (this.rnd() - 0.5);
      const r0 = R * (0.25 + 0.5 * this.rnd());
      const x0 = at.x + Math.cos(a) * r0, y0 = at.y + Math.sin(a) * r0;
      const ta = this.rnd() * Math.PI * 2, tr = targetR * 0.8 * Math.sqrt(this.rnd());
      const tx = target.x + Math.cos(ta) * tr, ty = target.y + Math.sin(ta) * tr;
      const tau = this.look.rainMs * (0.5 + 0.45 * this.rnd()) / 1000;
      this.addStar(RAIN, x0, y0, (tx - x0) / tau, (ty - y0) / tau - (g * tau) / 2, tau * 1000, 180 + this.rnd() * 300, 0.8 * S, 0, g, i % 3 ? c.gold : c.core);
    }
    // Crackle glitter all through the bloom as it hangs.
    for (let i = 0; i < Math.round(this.look.glitter); i++) {
      const a = this.rnd() * Math.PI * 2, rr = R * 0.98 * Math.sqrt(this.rnd());
      const delay = 260 + this.rnd() * life * 0.62;
      this.spawn('core', this.tex.star, i % 3 === 0 ? c.core : i % 3 === 1 ? c.green : c.gold, at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr + (delay / 1000) * 70 * S, {
        dur: 130 + this.rnd() * 110, from: 0.14, to: 0.62, a0: 1, mode: 'punch', peakAt: 0.3, rot: this.rnd() * 3, delay,
      });
    }
  }

  private drawStars(dt: number): void {
    const sec = dt / 1000;
    const S = this.scale;
    let n = this.nStars;
    for (let i = 0; i < n; i++) {
      const s = this.sS[i]!;
      const wait = this.sDelay[i]!;
      if (wait > 0) {
        this.sDelay[i] = wait - dt;
        if (wait - dt > 0) continue;
      }
      const life = this.sLife[i]! - dt;
      if (life <= 0) {
        if (this.sKind[i] === RAIN) {
          // It lands on the portrait: a twinkle and a breath of light.
          const x = this.sX[i]!, y = this.sY[i]!;
          this.spawn('core', this.tex.star, this.colors.core, x, y, { dur: 200, from: 0.16, to: 0.62, a0: 1, mode: 'punch', peakAt: 0.25, rot: (i * 0.7) % 3, follow: true });
          this.spawn('glow', this.tex.glow, this.colors.gold, x, y, { dur: 240, from: 0.2, to: 0.5, a0: 0.5, follow: true });
        }
        this.give(s);
        // Swap the last live star into this slot.
        n--;
        if (i < n) {
          this.sS[i] = this.sS[n]!; this.sX[i] = this.sX[n]!; this.sY[i] = this.sY[n]!; this.sVx[i] = this.sVx[n]!; this.sVy[i] = this.sVy[n]!;
          this.sLife[i] = this.sLife[n]!; this.sMax[i] = this.sMax[n]!; this.sDelay[i] = this.sDelay[n]!; this.sSize[i] = this.sSize[n]!;
          this.sDrag[i] = this.sDrag[n]!; this.sGrav[i] = this.sGrav[n]!; this.sKind[i] = this.sKind[n]!;
        }
        this.sS[n] = null;
        i--;
        continue;
      }
      this.sLife[i] = life;
      let vx = this.sVx[i]!, vy = this.sVy[i]!;
      const drag = this.sDrag[i]!;
      if (drag > 0) { const damp = Math.exp(-drag * sec); vx *= damp; vy *= damp; }
      vy += this.sGrav[i]! * sec;
      const x = this.sX[i]! + vx * sec, y = this.sY[i]! + vy * sec;
      this.sVx[i] = vx; this.sVy[i] = vy; this.sX[i] = x; this.sY[i] = y;
      const v = Math.hypot(vx, vy);
      const size = this.sSize[i]!;
      const t = 1 - life / this.sMax[i]!;
      s.position.set(x, y);
      s.rotation = Math.atan2(vy, vx);
      if (this.sKind[i] === RAIN) {
        s.scale.set(size * (0.5 + Math.min(1.6, v / (700 * S))), size * 0.7);
        s.alpha = t < 0.12 ? t / 0.12 : 1;
      } else {
        // A long streak while it flies out, a short falling ember once it hangs; it flickers as it dies.
        s.scale.set(size * (0.34 + Math.min(2.6, v / (330 * S))), size * 0.8);
        s.alpha = t < 0.6 ? 1 : (1 - (t - 0.6) / 0.4) * (0.6 + 0.4 * Math.sin(life * 0.045 + i * 1.7));
      }
    }
    this.nStars = n;
  }

  private drawSky(dt: number): void {
    const k = this.sky;
    if (!k) return;
    k.age += dt;
    const u = clamp01(k.age / 520);
    // Undo the root's camera so the light always covers exactly the view.
    const z = this.root.scale.x || 1;
    k.s.position.set(-this.root.position.x / z, -this.root.position.y / z);
    k.s.scale.set(this.viewW / z / (k.s.texture.width || 1), this.viewH / z / (k.s.texture.height || 1));
    k.s.alpha = k.a0 * (u < 0.1 ? u / 0.1 : (1 - (u - 0.1) / 0.9) ** 2);
    if (u >= 1) { this.give(k.s); this.sky = null; }
  }

  /** Create a few star sprites per frame ahead of the bloom, hold them unseen, then hand them all back to the pool. */
  private prefill(): void {
    if (this.prefillLeft <= 0) return;
    const n = Math.min(14, this.prefillLeft);
    for (let i = 0; i < n; i++) {
      const s = this.take('core', this.tex.streak, 0xffffff);
      if (!s) { this.prefillLeft = 0; break; }
      s.alpha = 0.004; s.position.set(-60, -60); s.scale.set(0.05);
      this.held.push(s);
      this.prefillLeft--;
    }
    if (this.prefillLeft <= 0) { for (const s of this.held) this.give(s); this.held = []; }
  }

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    this.prefill();
    this.drawProp(dt);
    this.drawFuse(dt);
    this.drawRocket(dt);
    this.drawBalls(dt);
    this.drawComet(dt);
    this.drawStars(dt);
    this.drawSky(dt);
    return !!this.prop || !!this.fuseFx || !!this.rocket || this.balls.length > 0 || !!this.cometFx || this.nStars > 0 || !!this.sky;
  }

  protected override clearOwn(): void {
    this.endFuse();
    if (this.rocket) { this.give(this.rocket.glow); this.rocket = null; }
    this.dropProp();
    for (const b of this.balls) this.endBall(b);
    this.balls = [];
    if (this.cometFx) { this.give(this.cometFx.head); this.give(this.cometFx.tail); this.cometFx = null; }
    for (let i = 0; i < this.nStars; i++) { this.give(this.sS[i]!); this.sS[i] = null; }
    this.nStars = 0;
    if (this.sky) { this.give(this.sky.s); this.sky = null; }
    for (const s of this.held) this.give(s);
    this.held = []; this.prefillLeft = 0;
  }
}

export type { Pt };
