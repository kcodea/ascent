/**
 * THE CRATE SCENE: everything the crate opening DRAWS, as a plain Pixi scene graph with no renderer, so it runs
 * (and is tested) headless. `crateFxPixi.ts` owns the Application + ticker and feeds `update(dtMs)`; this file owns
 * the crate, the particles, the rings, the flash, the aura and the god rays.
 *
 * Contract (the hero ceremony's, `HeroCeremonyPixi.ts`):
 *  - Geometry arrives only through `layout(w, h)` (event-driven), never read per frame.
 *  - Sprites are pooled; every live list is bounded (`MAX_PARTICLES`); the textures are built once per mount by
 *    the caller and passed in, and destroyed by the caller.
 *  - `update` returns whether anything is still moving, so the ticker can stop the moment the scene is idle.
 *  - `destroy()` empties every list, destroys every display object it created, and leaves the root empty.
 *  - Math.random is fine here (presentation only; the engine RNG ban covers core/content/sim).
 *
 * THE CRATE is drawn procedurally (layered Graphics: wood, planks, gold bands, a lock plate with a gem) as two
 * parts, the body and the lid, so the lid can blow off. `setCrateArt(texture)` swaps both for one Sprite: that is
 * the drop-in for the owner's crate art (config key `crateArt`), which then shakes, charges and bursts whole.
 */
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CratePreset } from './crateFxConfig';

export interface CrateSceneTextures {
  /** Small soft dot: motes, sparks, pulled particles. */
  spark: Texture;
  /** Large soft glow: the crate glow, the seam light, the flash, the aura. */
  glow: Texture;
  /** A thin bright ring, natural radius `RING_TEX_R`. */
  ring: Texture;
  /** A sliver: debris chips. */
  frag: Texture;
  /** A long soft wedge pointing up from its base: one god ray. */
  ray: Texture;
}

export interface CrateAnticipation { antMs: number; antShake: number; antGlow: number }

export type ScenePhase = 'idle' | 'anticipation' | 'charge' | 'burst' | 'reveal' | 'settle' | 'settled' | 'winddown';

export const RING_TEX_R = 60;
/** Natural radius of the glow texture (the caller draws it at this size). */
export const GLOW_TEX_R = 40;
/** Natural length of the ray texture. */
export const RAY_TEX_LEN = 128;
/** Hard cap on live particles. */
export const MAX_PARTICLES = 260;
/** The neutral gold the crate glows before the rarity is known. */
export const NEUTRAL_GLOW = 0xffd88a;

const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInQuad = (t: number): number => clamp01(t) * clamp01(t);
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);

/** Linear blend of two 0xRRGGBB colours (pure, tested). */
export function lerpColor(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The crate's width for a stage of `w` × `h` (pure): a quarter of the short side, clamped, times the tuner's size. */
export function crateSizeFor(w: number, h: number, scale = 1): number {
  const short = Math.max(1, Math.min(w > 0 ? w : 600, h > 0 ? h : 400));
  return Math.max(70, Math.min(280, short * 0.3)) * Math.max(0.5, Math.min(2, scale || 1));
}

interface Particle {
  sprite: Sprite;
  kind: 'mote' | 'pull' | 'spark' | 'debris' | 'rise';
  x: number; y: number;
  vx: number; vy: number;
  sx: number; sy: number; // pull: start point (it travels to the crate centre)
  drag: number;
  gravity: number;
  spin: number;
  life: number; maxLife: number;
  fromScale: number; toScale: number;
  peakAlpha: number;
}
interface Ring { sprite: Sprite; age: number; dur: number; fromR: number; toR: number; peak: number; delay: number }
interface Flash { sprite: Sprite; age: number; dur: number; peak: number; fromScale: number; toScale: number }

export class CrateScene {
  readonly root: Container;
  private readonly tex: CrateSceneTextures;
  private readonly back = new Container();   // rays + aura (behind the crate)
  private readonly rays = new Container();
  private readonly crate = new Container();  // the crate (shaken, squashed)
  private readonly front = new Container();  // particles, rings, flash
  private body: Container | null = null;
  private lid: Container | null = null;
  private gem: Graphics | null = null;
  private art: Sprite | null = null;
  private glow: Sprite;
  private seam: Sprite;
  private aura: Sprite;
  private pool: Sprite[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private raySprites: Sprite[] = [];
  private destroyed = false;

  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private size = 120;
  private scale = 1;

  private phase: ScenePhase = 'idle';
  private age = 0;
  private dur = 0;
  private ant: CrateAnticipation = { antMs: 700, antShake: 1.4, antGlow: 0.5 };
  private preset: CratePreset | null = null;
  private spawnAcc = 0;
  private pulled = 0;
  private color = NEUTRAL_GLOW;
  // the lid in flight
  private lidV = { x: 0, y: 0, r: 0 };
  private lidFlying = false;
  // values the phases blend between
  private glowFrom = 0.25;
  private glowTo = 0.25;
  private auraFrom = 0;
  private auraTo = 0;
  private raysFrom = 0;
  private raysTo = 0;
  private bodyAlpha = 1;

  constructor(root: Container, textures: CrateSceneTextures) {
    this.root = root;
    this.tex = textures;
    this.rays.alpha = 0;
    this.glow = this.makeSprite(textures.glow, 0.25);
    this.seam = this.makeSprite(textures.glow, 0);
    this.aura = this.makeSprite(textures.glow, 0);
    this.back.addChild(this.aura, this.rays);
    root.addChild(this.back, this.glow, this.crate, this.front);
    this.crate.addChild(this.seam);
    this.buildCrate();
  }

  // ─── geometry ───────────────────────────────────────────────────────────────────────────────────────────

  /** The stage size (layout px). Event-driven: mount + resize only. */
  layout(w: number, h: number, crateScale = this.scale): void {
    this.w = w;
    this.h = h;
    this.scale = crateScale;
    this.cx = w / 2;
    this.cy = h * 0.52;
    const size = crateSizeFor(w, h, crateScale);
    if (Math.abs(size - this.size) > 0.5) { this.size = size; this.buildCrate(); }
    this.place();
  }

  /** The drop-in art: a texture replaces the drawn crate (null = back to the drawn crate). */
  setCrateArt(texture: Texture | null): void {
    if (this.destroyed) return;
    if (this.art) { this.crate.removeChild(this.art); this.art.destroy(); this.art = null; }
    if (texture) {
      const s = new Sprite(texture);
      s.anchor.set(0.5, 0.62);
      const k = (this.size * 1.1) / Math.max(1, texture.width);
      s.scale.set(k);
      this.art = s;
      this.crate.addChild(s);
    }
    if (this.body) this.body.visible = !texture;
    if (this.lid) this.lid.visible = !texture;
  }

  get center(): { x: number; y: number } { return { x: this.cx, y: this.cy }; }
  get crateSize(): number { return this.size; }
  get currentPhase(): ScenePhase { return this.phase; }

  private place(): void {
    this.crate.position.set(this.cx, this.cy);
    this.glow.position.set(this.cx, this.cy - this.size * 0.05);
    this.glow.scale.set((this.size * 1.6) / GLOW_TEX_R / 2);
    this.aura.position.set(this.cx, this.cy - this.size * 0.2);
    this.aura.scale.set((this.size * 2.4) / GLOW_TEX_R / 2);
    this.rays.position.set(this.cx, this.cy - this.size * 0.2);
    for (const r of this.raySprites) r.scale.set(1.2, (Math.max(this.w, this.h) * 0.55) / RAY_TEX_LEN);
    this.seam.position.set(0, -this.size * 0.31);
    this.seam.scale.set((this.size * 0.62) / GLOW_TEX_R, (this.size * 0.07) / GLOW_TEX_R);
  }

  /** The procedural crate: a body and a lid, in crate-local px (origin = the crate's centre). */
  private buildCrate(): void {
    const S = this.size;
    const hadArt = !!this.art;
    for (const part of [this.body, this.lid]) { if (part) { this.crate.removeChild(part); part.destroy({ children: true }); } }
    const bw = S;
    const bh = S * 0.62;
    const x = -bw / 2;
    const y = -S * 0.31; // the seam; the body hangs below it
    const body = new Container();
    const g = new Graphics();
    g.ellipse(0, y + bh + S * 0.06, bw * 0.58, S * 0.08).fill({ color: 0x000000, alpha: 0.4 });
    g.roundRect(x, y, bw, bh, S * 0.06).fill(0x4a2a10).stroke({ width: Math.max(1.5, S * 0.022), color: 0x21110a });
    g.roundRect(x + S * 0.03, y + S * 0.03, bw - S * 0.06, bh * 0.5, S * 0.04).fill({ color: 0x8a5628, alpha: 0.9 });
    g.roundRect(x + S * 0.03, y + bh * 0.52, bw - S * 0.06, bh * 0.42, S * 0.04).fill({ color: 0x6b3e18, alpha: 0.9 });
    for (let i = 1; i <= 2; i++) g.rect(x + S * 0.04, y + (bh * i) / 3, bw - S * 0.08, Math.max(1, S * 0.012)).fill({ color: 0x21110a, alpha: 0.55 });
    const band = S * 0.1;
    for (const bx of [x + bw * 0.14, x + bw * 0.86 - band]) {
      g.rect(bx, y, band, bh).fill(0xb8893e);
      g.rect(bx, y, band * 0.3, bh).fill({ color: 0xf6dc98, alpha: 0.75 });
      g.rect(bx + band * 0.82, y, band * 0.18, bh).fill({ color: 0x6e4d1c, alpha: 0.8 });
      for (const ry of [y + S * 0.07, y + bh - S * 0.07]) g.circle(bx + band / 2, ry, S * 0.018).fill(0xfff0c0);
    }
    g.roundRect(-S * 0.1, y + S * 0.02, S * 0.2, S * 0.22, S * 0.03).fill(0xd8ad5e).stroke({ width: Math.max(1, S * 0.012), color: 0x6e4d1c });
    g.roundRect(-S * 0.075, y + S * 0.035, S * 0.15, S * 0.06, S * 0.02).fill({ color: 0xfff0c0, alpha: 0.55 });
    body.addChild(g);
    const gem = new Graphics();
    gem.circle(0, 0, S * 0.045).fill(0xffffff);
    gem.circle(-S * 0.014, -S * 0.014, S * 0.014).fill({ color: 0xffffff, alpha: 0.9 });
    gem.position.set(0, y + S * 0.14);
    gem.tint = NEUTRAL_GLOW;
    body.addChild(gem);

    const lid = new Container();
    const lg = new Graphics();
    const lw = bw * 1.06;
    const lh = S * 0.3;
    lg.roundRect(-lw / 2, -lh, lw, lh, S * 0.07).fill(0x5a3314).stroke({ width: Math.max(1.5, S * 0.022), color: 0x21110a });
    lg.roundRect(-lw / 2 + S * 0.03, -lh + S * 0.025, lw - S * 0.06, lh * 0.45, S * 0.05).fill({ color: 0xa26a34, alpha: 0.95 });
    for (const bx of [-lw / 2 + lw * 0.15, lw / 2 - lw * 0.15 - band]) {
      lg.rect(bx, -lh, band, lh).fill(0xb8893e);
      lg.rect(bx, -lh, band * 0.3, lh).fill({ color: 0xf6dc98, alpha: 0.75 });
    }
    lg.rect(-lw / 2, -S * 0.02, lw, S * 0.02).fill({ color: 0x21110a, alpha: 0.6 });
    lid.addChild(lg);
    lid.position.set(0, y);

    this.body = body;
    this.lid = lid;
    this.gem = gem;
    this.crate.addChildAt(body, 0);
    this.crate.addChild(lid);
    this.crate.setChildIndex(this.seam, this.crate.children.length - 1);
    body.visible = !hadArt;
    lid.visible = !hadArt;
    if (this.art) this.crate.setChildIndex(this.art, this.crate.children.length - 1);
  }

  // ─── beats ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Back to a sealed crate at rest (a fresh crate, or after Try again). */
  reset(): void {
    this.clearFx();
    this.setPhase('idle', 0);
    this.color = NEUTRAL_GLOW;
    this.preset = null;
    this.lidFlying = false;
    if (this.lid) { this.lid.position.set(0, -this.size * 0.31); this.lid.rotation = 0; this.lid.alpha = 1; }
    this.bodyAlpha = 1;
    this.crate.alpha = 1;
    this.crate.scale.set(1);
    this.crate.rotation = 0;
    if (this.art) { this.art.alpha = 1; this.art.scale.set((this.size * 1.1) / Math.max(1, this.art.texture.width)); }
    this.glow.alpha = 0.25;
    this.glow.tint = NEUTRAL_GLOW;
    this.seam.alpha = 0;
    this.aura.alpha = 0;
    this.rays.alpha = 0;
    if (this.gem) this.gem.tint = NEUTRAL_GLOW;
    this.place();
  }

  anticipate(a: CrateAnticipation): void {
    this.ant = a;
    this.glowFrom = this.glow.alpha;
    this.glowTo = a.antGlow;
    this.setPhase('anticipation', Math.max(1, a.antMs));
  }

  charge(p: CratePreset): void {
    this.preset = p;
    this.pulled = 0;
    this.spawnAcc = 0;
    this.glowFrom = this.glow.alpha;
    this.glowTo = Math.min(1, this.ant.antGlow + 0.35);
    this.buildRays(p.rays);
    this.raysFrom = 0;
    this.raysTo = p.rays > 0 ? 0.3 : 0;
    this.setPhase('charge', Math.max(1, p.chargeMs));
  }

  burst(p: CratePreset): void {
    this.preset = p;
    this.color = p.color;
    this.setPhase('burst', Math.max(1, p.burstMs));
    const S = this.size;
    const cy = this.cy - S * 0.3;
    // the flash: a broad bloom plus a hot white core
    this.spawnFlash(this.cx, cy, p.color, p.flash, S / GLOW_TEX_R * 0.6, S / GLOW_TEX_R * 3.2, p.burstMs * 0.7);
    this.spawnFlash(this.cx, cy, 0xffffff, p.flash * 0.9, S / GLOW_TEX_R * 0.3, S / GLOW_TEX_R * 1.4, p.burstMs * 0.35);
    // shockwave rings, staggered
    for (let i = 0; i < p.rings; i++) this.spawnRing(this.cx, cy, S * 0.3, S * (2.2 + i * 0.8), p.burstMs * (0.8 + i * 0.15), i === 0 ? 0xffffff : p.color, 0.9 - i * 0.18, i * 90);
    // sparks, radial
    for (let i = 0; i < p.burstSparks; i++) {
      const a = (i / Math.max(1, p.burstSparks)) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const sp = S * (3 + Math.random() * 5);
      this.spawn('spark', this.tex.spark, this.cx, cy, i % 3 === 0 ? 0xffffff : p.color, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - S * 1.2, drag: 0.08, gravity: S * 3,
        life: p.burstMs * (0.7 + Math.random() * 0.6), fromScale: 0.8 + Math.random() * 0.7, toScale: 0.1, peakAlpha: 1,
      });
    }
    // debris: wood + gold chips, heavier, spinning
    for (let i = 0; i < p.debris; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const sp = S * (2.5 + Math.random() * 3.5);
      this.spawn('debris', this.tex.frag, this.cx + (Math.random() - 0.5) * S * 0.6, cy, i % 2 ? 0x8a5628 : 0xd8ad5e, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.4, gravity: S * 9, spin: (Math.random() - 0.5) * 16,
        life: p.burstMs * (1 + Math.random() * 0.6), fromScale: 0.6 + Math.random() * 0.8, toScale: 0.5, peakAlpha: 1,
      });
    }
    // the lid blows off (the art crate pops instead)
    if (this.lid && this.lid.visible) {
      this.lidFlying = true;
      this.lidV = { x: S * (1 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), y: -S * 7, r: (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3) };
    }
    this.crate.scale.set(1.08, 0.94);
    this.seam.alpha = 0;
    this.glow.alpha = 1;
    this.glow.tint = p.color;
    if (this.gem) this.gem.tint = p.color;
  }

  reveal(p: CratePreset): void {
    this.preset = p;
    this.color = p.color;
    this.aura.tint = p.color;
    this.auraFrom = this.aura.alpha;
    this.auraTo = 0.85;
    if (this.raySprites.length !== p.rays) this.buildRays(p.rays);
    this.raysFrom = this.rays.alpha;
    this.raysTo = p.rays > 0 ? 0.55 : 0;
    for (const r of this.raySprites) r.tint = p.color;
    this.spawnAcc = 0;
    this.setPhase('reveal', Math.max(1, p.burstMs * 0.6 + p.revealHoldMs));
  }

  settle(ms: number): void {
    this.auraFrom = this.aura.alpha;
    this.auraTo = 0.35;
    this.raysFrom = this.rays.alpha;
    this.raysTo = 0;
    this.glowFrom = this.glow.alpha;
    this.glowTo = 0;
    this.setPhase('settle', Math.max(1, ms));
  }

  /** Skip: straight to the settled reveal. Every in-flight effect is dropped. */
  skipToSettled(p: CratePreset): void {
    this.clearFx();
    this.preset = p;
    this.color = p.color;
    this.lidFlying = false;
    if (this.lid) this.lid.alpha = 0;
    this.bodyAlpha = 0;
    this.crate.alpha = 0;
    this.crate.scale.set(1);
    this.crate.rotation = 0;
    this.crate.position.set(this.cx, this.cy);
    this.glow.alpha = 0;
    this.seam.alpha = 0;
    this.aura.tint = p.color;
    this.aura.alpha = 0.35;
    this.rays.alpha = 0;
    this.setPhase('settled', 0);
  }

  /** A failed or empty answer: the glow and shake die down to a sealed crate at rest. */
  windDown(ms: number): void {
    this.glowFrom = this.glow.alpha;
    this.glowTo = 0.25;
    this.setPhase('winddown', Math.max(1, ms));
  }

  private setPhase(p: ScenePhase, dur: number): void {
    this.phase = p;
    this.age = 0;
    this.dur = dur;
  }

  // ─── the frame ──────────────────────────────────────────────────────────────────────────────────────────

  /** Whether anything is still moving (the ticker stops when this is false). */
  hasWork(): boolean {
    if (this.destroyed) return false;
    return this.particles.length > 0 || this.rings.length > 0 || this.flashes.length > 0 || this.lidFlying
      || (this.phase !== 'idle' && this.phase !== 'settled');
  }

  /** Advance by `dtMs` of (speed-scaled) time. Returns `hasWork()`. */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.min(Math.max(0, dtMs), 64);
    const sec = dt / 1000;
    this.age += dt;
    const t = this.dur > 0 ? clamp01(this.age / this.dur) : 1;
    const S = this.size;
    const p = this.preset;
    let shake = 0;

    switch (this.phase) {
      case 'anticipation': {
        shake = this.ant.antShake * easeInQuad(t) + (t >= 1 ? this.ant.antShake * 0.25 * Math.sin(this.age * 0.009) : 0);
        this.glow.alpha = this.glowFrom + (this.glowTo - this.glowFrom) * easeOutCubic(t) + 0.05 * Math.sin(this.age * 0.012);
        this.spawnAcc += dt;
        if (this.spawnAcc >= 110) { this.spawnAcc -= 110; this.spawnMote(NEUTRAL_GLOW); }
        break;
      }
      case 'charge': {
        if (!p) break;
        this.color = lerpColor(NEUTRAL_GLOW, p.color, easeOutCubic(t));
        this.glow.tint = this.color;
        if (this.gem) this.gem.tint = this.color;
        this.seam.tint = this.color;
        shake = this.ant.antShake + (p.shake - this.ant.antShake) * easeInQuad(t);
        this.glow.alpha = this.glowFrom + (this.glowTo - this.glowFrom) * t;
        this.glow.scale.set(((S * 1.6) / GLOW_TEX_R / 2) * (1 + 0.35 * t));
        this.seam.alpha = easeInQuad(t);
        this.crate.scale.set(1 + 0.03 * easeInQuad(t), 1 - 0.05 * easeInQuad(t));
        this.rays.alpha = this.raysFrom + (this.raysTo - this.raysFrom) * t;
        this.rays.rotation += 0.25 * sec;
        // pulled particles, spread over the first 80% of the charge
        const want = Math.min(p.chargeParticles, Math.floor(p.chargeParticles * Math.min(1, t / 0.8)));
        while (this.pulled < want) { this.pulled++; this.spawnPull(p); }
        // At t = 1 the charge simply holds at its peak until the director calls the burst.
        break;
      }
      case 'burst': {
        this.crate.scale.set(1 + (this.crate.scale.x - 1) * Math.pow(0.001, sec), 1 + (this.crate.scale.y - 1) * Math.pow(0.001, sec));
        this.glow.alpha = Math.max(0, 1 - easeOutCubic(t) * 0.6);
        this.rays.rotation += 0.2 * sec;
        break;
      }
      case 'reveal': {
        const rt = clamp01(this.age / 420);
        this.aura.alpha = this.auraFrom + (this.auraTo - this.auraFrom) * easeOutCubic(rt);
        this.aura.scale.set(((S * 2.4) / GLOW_TEX_R / 2) * (0.85 + 0.15 * easeOutCubic(rt)));
        this.rays.alpha = this.raysFrom + (this.raysTo - this.raysFrom) * easeOutCubic(rt);
        this.rays.rotation += 0.15 * sec;
        this.glow.alpha = Math.max(0, this.glow.alpha - sec * 1.5);
        this.bodyAlpha = Math.max(0, 1 - this.age / 450);
        this.crate.alpha = this.bodyAlpha;
        this.crate.position.y = this.cy + S * 0.12 * easeOutCubic(1 - this.bodyAlpha);
        this.spawnAcc += dt;
        if (this.spawnAcc >= 90) { this.spawnAcc -= 90; this.spawnRise(this.color); }
        break;
      }
      case 'settle': {
        this.aura.alpha = this.auraFrom + (this.auraTo - this.auraFrom) * easeOutCubic(t);
        this.rays.alpha = this.raysFrom + (this.raysTo - this.raysFrom) * easeOutCubic(t);
        this.rays.rotation += 0.1 * sec;
        this.glow.alpha = this.glowFrom * (1 - t);
        if (t >= 1) this.setPhase('settled', 0);
        break;
      }
      case 'winddown': {
        this.glow.alpha = this.glowFrom + (this.glowTo - this.glowFrom) * easeOutCubic(t);
        this.seam.alpha = Math.max(0, this.seam.alpha - sec * 3);
        this.crate.scale.set(1);
        if (t >= 1) this.setPhase('idle', 0);
        break;
      }
      default: break;
    }

    // the crate shake (transform only; never read back)
    if (shake > 0 && this.phase !== 'reveal') {
      const a = this.age;
      this.crate.position.set(this.cx + shake * Math.sin(a * 0.071) * Math.cos(a * 0.023), this.cy + shake * 0.6 * Math.sin(a * 0.053));
      this.crate.rotation = (shake / Math.max(20, S)) * 0.9 * Math.sin(a * 0.061);
    } else if (this.phase !== 'reveal') {
      this.crate.position.set(this.cx, this.cy);
      this.crate.rotation = 0;
    }

    // the lid in flight
    if (this.lidFlying && this.lid) {
      this.lidV.y += S * 16 * sec;
      this.lid.position.x += this.lidV.x * sec;
      this.lid.position.y += this.lidV.y * sec;
      this.lid.rotation += this.lidV.r * sec;
      this.lid.alpha = Math.max(0, this.lid.alpha - sec * 1.8);
      if (this.lid.alpha <= 0) this.lidFlying = false;
    }
    // the art crate pops and fades at the burst instead
    if (this.art && this.phase === 'burst') {
      this.art.alpha = Math.max(0, 1 - t * 1.6);
    }

    this.stepParticles(dt, sec);
    this.stepRings(dt);
    this.stepFlashes(dt);
    return this.hasWork();
  }

  private stepParticles(dt: number, sec: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) { this.release(q.sprite); this.particles.splice(i, 1); continue; }
      const lived = 1 - q.life / q.maxLife;
      const s = q.sprite;
      if (q.kind === 'pull') {
        const e = easeInCubic(lived);
        q.x = q.sx + (this.cx - q.sx) * e;
        q.y = q.sy + (this.cy - this.size * 0.3 - q.sy) * e;
        s.alpha = q.peakAlpha * Math.min(1, lived * 4);
      } else {
        const k = Math.pow(q.drag, sec);
        q.vx *= k;
        q.vy = q.vy * k + q.gravity * sec;
        q.x += q.vx * sec;
        q.y += q.vy * sec;
        s.alpha = q.kind === 'mote' || q.kind === 'rise' ? q.peakAlpha * Math.sin(Math.PI * lived) : q.peakAlpha * (1 - easeInQuad(lived));
      }
      s.position.set(q.x, q.y);
      s.scale.set(q.fromScale + (q.toScale - q.fromScale) * lived);
      s.rotation += q.spin * sec;
    }
  }

  private stepRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r.delay > 0) { r.delay -= dt; r.sprite.alpha = 0; continue; }
      r.age += dt;
      const t = r.age / r.dur;
      if (t >= 1) { this.release(r.sprite); this.rings.splice(i, 1); continue; }
      r.sprite.scale.set((r.fromR + (r.toR - r.fromR) * easeOutCubic(t)) / RING_TEX_R);
      r.sprite.alpha = r.peak * (1 - easeInQuad(t));
    }
  }

  private stepFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const t = f.age / f.dur;
      if (t >= 1) { this.release(f.sprite); this.flashes.splice(i, 1); continue; }
      f.sprite.scale.set(f.fromScale + (f.toScale - f.fromScale) * easeOutCubic(t));
      f.sprite.alpha = f.peak * (t < 0.12 ? t / 0.12 : 1 - easeOutCubic((t - 0.12) / 0.88));
    }
  }

  // ─── spawning (pooled) ──────────────────────────────────────────────────────────────────────────────────

  private makeSprite(tex: Texture, alpha: number): Sprite {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.alpha = alpha;
    s.tint = NEUTRAL_GLOW;
    return s;
  }

  private acquire(tex: Texture): Sprite | null {
    if (this.destroyed) return null;
    if (this.front.children.length >= MAX_PARTICLES + 16) return null;
    const s = this.pool.pop() ?? new Sprite();
    s.texture = tex;
    s.anchor.set(0.5);
    s.rotation = 0;
    s.blendMode = 'add';
    s.visible = true;
    this.front.addChild(s);
    return s;
  }

  private release(s: Sprite): void {
    this.front.removeChild(s);
    s.visible = false;
    if (this.pool.length < MAX_PARTICLES) this.pool.push(s);
    else s.destroy();
  }

  private spawn(kind: Particle['kind'], tex: Texture, x: number, y: number, tint: number,
    o: { vx?: number; vy?: number; drag?: number; gravity?: number; spin?: number; life: number; fromScale?: number; toScale?: number; peakAlpha?: number }): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const s = this.acquire(tex);
    if (!s) return;
    s.tint = tint;
    s.rotation = Math.random() * Math.PI * 2;
    const q: Particle = {
      sprite: s, kind, x, y, sx: x, sy: y,
      vx: o.vx ?? 0, vy: o.vy ?? 0, drag: o.drag ?? 1, gravity: o.gravity ?? 0, spin: o.spin ?? 0,
      life: Math.max(1, o.life), maxLife: Math.max(1, o.life),
      fromScale: o.fromScale ?? 1, toScale: o.toScale ?? 1, peakAlpha: o.peakAlpha ?? 1,
    };
    s.position.set(x, y);
    s.scale.set(q.fromScale);
    s.alpha = kind === 'spark' || kind === 'debris' ? q.peakAlpha : 0;
    this.particles.push(q);
  }

  private spawnMote(tint: number): void {
    const S = this.size;
    this.spawn('mote', this.tex.spark, this.cx + (Math.random() - 0.5) * S * 1.4, this.cy + S * (0.1 + Math.random() * 0.25), tint, {
      vx: (Math.random() - 0.5) * S * 0.12, vy: -S * (0.3 + Math.random() * 0.35), life: 1200 + Math.random() * 700,
      fromScale: 0.35 + Math.random() * 0.3, toScale: 0.15, peakAlpha: 0.6,
    });
  }

  private spawnPull(p: CratePreset): void {
    const S = this.size;
    const a = Math.random() * Math.PI * 2;
    const r = S * (1.3 + Math.random() * 1.1);
    const life = Math.max(160, p.chargeMs * (0.35 + Math.random() * 0.3));
    this.spawn('pull', this.tex.spark, this.cx + Math.cos(a) * r, this.cy - S * 0.3 + Math.sin(a) * r * 0.8, Math.random() < 0.3 ? 0xffffff : p.color, {
      life, fromScale: 0.9 + Math.random() * 0.5, toScale: 0.25, peakAlpha: 0.95,
    });
  }

  private spawnRise(tint: number): void {
    const S = this.size;
    this.spawn('rise', this.tex.spark, this.cx + (Math.random() - 0.5) * S * 1.6, this.cy - S * (Math.random() * 0.2), tint, {
      vx: (Math.random() - 0.5) * S * 0.1, vy: -S * (0.45 + Math.random() * 0.5), life: 1400 + Math.random() * 900,
      fromScale: 0.4 + Math.random() * 0.4, toScale: 0.1, peakAlpha: 0.7,
    });
  }

  private spawnRing(x: number, y: number, fromR: number, toR: number, dur: number, tint: number, peak: number, delay: number): void {
    const s = this.acquire(this.tex.ring);
    if (!s) return;
    s.tint = tint;
    s.position.set(x, y);
    s.scale.set(fromR / RING_TEX_R);
    s.alpha = 0;
    this.rings.push({ sprite: s, age: 0, dur: Math.max(1, dur), fromR, toR, peak: Math.max(0.1, peak), delay });
  }

  private spawnFlash(x: number, y: number, tint: number, peak: number, fromScale: number, toScale: number, dur: number): void {
    if (!(peak > 0)) return;
    const s = this.acquire(this.tex.glow);
    if (!s) return;
    s.tint = tint;
    s.position.set(x, y);
    s.scale.set(fromScale);
    s.alpha = 0;
    this.flashes.push({ sprite: s, age: 0, dur: Math.max(1, dur), peak, fromScale, toScale });
  }

  /** God rays: `n` wedges fanned evenly around the reward. Rebuilt only when the count changes. */
  private buildRays(n: number): void {
    const count = Math.max(0, Math.min(24, Math.round(n)));
    if (count === this.raySprites.length) return;
    for (const r of this.raySprites) { this.rays.removeChild(r); r.destroy(); }
    this.raySprites = [];
    for (let i = 0; i < count; i++) {
      const s = new Sprite(this.tex.ray);
      s.anchor.set(0.5, 1); // the wedge's base sits on the reward
      s.blendMode = 'add';
      s.rotation = (i / count) * Math.PI * 2;
      s.tint = this.color;
      s.alpha = i % 2 ? 0.6 : 1;
      this.raySprites.push(s);
      this.rays.addChild(s);
    }
    this.place();
  }

  private clearFx(): void {
    for (const q of this.particles) this.release(q.sprite);
    for (const r of this.rings) this.release(r.sprite);
    for (const f of this.flashes) this.release(f.sprite);
    this.particles.length = 0;
    this.rings.length = 0;
    this.flashes.length = 0;
  }

  /** Live counts, for tests and the perf check. */
  stats(): { particles: number; rings: number; flashes: number; pooled: number; frontChildren: number; rootChildren: number } {
    return {
      particles: this.particles.length, rings: this.rings.length, flashes: this.flashes.length,
      pooled: this.pool.length, frontChildren: this.front.children.length, rootChildren: this.root.children.length,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clearFx();
    this.destroyed = true;
    for (const s of this.pool) s.destroy();
    this.pool.length = 0;
    this.raySprites.length = 0;
    this.body = this.lid = this.gem = this.art = null;
    // children:true destroys every container, sprite and Graphics below; textures stay (the caller owns them).
    for (const c of [this.back, this.glow, this.crate, this.front]) {
      this.root.removeChild(c);
      c.destroy({ children: true });
    }
  }
}
