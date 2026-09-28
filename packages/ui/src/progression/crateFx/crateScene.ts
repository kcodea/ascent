/**
 * THE CRATE SCENE (2026-09-28; redone the same day after the owner's "looks like a 2/10"; the owner's two-layer chest
 * art wired in the same day: "added new chest pngs here ... can you wire this up to work"): everything the crate
 * opening DRAWS, as a plain Pixi scene graph with no renderer, so it runs (and is tested) headless.
 * `crateFxPixi.ts` owns the Application + ticker, loads the chest art (or paints the fallback) and feeds
 * `update(dtMs)`; this file owns the staging, the chest, the particles, the camera and every beat.
 *
 * THE CHEST is two layers, the BODY and the LID, placed by a `ChestModel` (`chestModel.ts`): the owner's art, or the
 * painted chest if the art cannot load. Light is added ON TOP of the art, never baked into it: a soft bar along the
 * SEAM between lid and body, the KEYHOLE's own shape cut from the art as a light mask plus a glow around it, an
 * additive copy of the body for its flashes, and the glow of the open body once the lid is gone.
 *
 * STAGING: a CAMERA container holds the whole set (pedestal + rune ring, floor glow, contact shadow, the chest, the
 * burst). It pushes in slowly through the charge, snaps back past rest on the burst, and carries the screen shake
 * (a decaying impulse). A full-screen white flash and a rarity-coloured punch sit outside it.
 *
 * THE BEATS:
 *  - anticipation: the chest breathes in PULSES (a squash kick; the LID jumps a few px on its own and settles back,
 *    tilting a touch; a flare of warm light from the seam and the keyhole). `onPulse` fires per pulse so the
 *    theatre can play a tick on the beat. The shake escalates.
 *  - charge: the rarity is known. The seam and keyhole light turn the rarity's colour and climb, the pulses and
 *    the lid's jumps grow, energy streaks are pulled INTO the keyhole, the camera pushes in, the chest compresses.
 *    The last `hitchMs` run in slow motion (the held breath before a big burst).
 *  - burst: the LID blasts off (up, spinning, with gravity) and a light column pours out of the open body; a white
 *    flash, a rarity punch and bloom, rings, a ray burst, shards from the rim, sparks and embers, a heavy decaying
 *    shake. Legendary: the lid pops on the first burst, the BODY flashes on the second, and gold coins fly.
 *  - reveal / settle: the open body stays on the pedestal, glowing, while the nameplate (DOM) rises above it; then
 *    the scene quiets and goes IDLE (the ticker stops).
 *
 * Contract: geometry only via `layout(w, h)`; sprites pooled, every list bounded (`MAX_PARTICLES`); textures are
 * the caller's (built once, destroyed by the caller); `update` returns whether anything still moves; `destroy()`
 * leaves the root empty. Math.random is fine here (presentation only).
 */
import { Container, Sprite, Texture } from 'pixi.js';
import type { CratePreset } from './crateFxConfig';
import type { ChestModel } from './chestModel';

export interface CrateSceneTextures {
  /** The chest: the owner's two layers (or the painted fallback) and where its parts are. */
  chest: ChestModel;
  /** A soft horizontal bar of light (the seam). */
  seamBar: Texture;
  pedestal: Texture;
  runeRing: Texture;
  rays: Texture;
  glow: Texture;
  spark: Texture;
  streak: Texture;
  ring: Texture;
  coin: Texture;
  shards: Texture[];
}

/** The chest's tunable fit and motion (the tuner's "Chest" group; see `crateFxConfig.ts`). */
export interface ChestTuning {
  lidOffsetX: number; lidOffsetY: number; lidScale: number; lidJump: number;
  lidLaunchX: number; lidLaunchY: number; lidSpin: number; lidGravity: number;
  seamOffsetY: number; seamWidth: number; seamGlow: number; keyholeGlow: number; openGlow: number;
}
export const DEFAULT_CHEST_TUNING: ChestTuning = {
  lidOffsetX: 0, lidOffsetY: 0, lidScale: 1, lidJump: 2.2, lidLaunchX: 1.4, lidLaunchY: 6.2, lidSpin: 1.1, lidGravity: 13,
  seamOffsetY: 0, seamWidth: 1, seamGlow: 1, keyholeGlow: 1, openGlow: 0.85,
};

export interface CrateAnticipation { antMs: number; antShake: number; antGlow: number; pulseMs: number }

export type ScenePhase = 'idle' | 'anticipation' | 'charge' | 'burst' | 'reveal' | 'settle' | 'settled' | 'winddown';

/** Hard cap on live particles. */
export const MAX_PARTICLES = 320;
/** The warm light the chest leaks before the rarity is known. */
export const NEUTRAL_GLOW = 0xffe2a8;

const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInQuad = (t: number): number => clamp01(t) * clamp01(t);
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);
export const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
/** Overshoot then settle (back-out). */
export const easeOutBack = (t: number, k = 1.7): number => { const x = clamp01(t) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };

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

/** The chest's width for a stage of `w` × `h` (pure): a third of the short side, clamped, times the tuner's size. */
export function crateSizeFor(w: number, h: number, scale = 1): number {
  const short = Math.max(1, Math.min(w > 0 ? w : 600, h > 0 ? h : 400));
  return Math.max(120, Math.min(420, short * 0.34)) * Math.max(0.5, Math.min(2, scale || 1));
}

interface Particle {
  sprite: Sprite;
  kind: 'mote' | 'pull' | 'spark' | 'streak' | 'ember' | 'shard' | 'coin' | 'rise';
  x: number; y: number;
  vx: number; vy: number;
  drag: number;
  gravity: number;
  spin: number;
  life: number; maxLife: number;
  fromScale: number; toScale: number;
  peakAlpha: number;
  seed: number;
}
interface Ring { sprite: Sprite; age: number; dur: number; fromR: number; toR: number; peak: number; delay: number; thin: number }
interface Flash { sprite: Sprite; age: number; dur: number; peak: number; fromScale: number; toScale: number; delay: number; attack: number }

export interface CrateSceneOptions {
  /** Fires on every anticipation/charge pulse (the theatre ticks a sound on the beat). `k` is 0..1 intensity. */
  onPulse?: (k: number) => void;
}

export class CrateScene {
  readonly root: Container;
  private readonly tex: CrateSceneTextures;
  private readonly opts: CrateSceneOptions;
  private readonly cam = new Container();
  private readonly set = new Container();   // pedestal, glow pool, shadow
  private readonly crate = new Container(); // the chest (squash pivot at its base)
  private readonly front = new Container(); // particles, rings, flashes
  private readonly overlay = new Container(); // full-screen flash + punch (outside the camera)
  private pedestal: Sprite;
  private runeRing: Sprite;
  private floorGlow: Sprite;
  private shadow: Sprite;
  private backRays: Sprite;
  private burstRays: Sprite;
  private aura: Sprite;
  private pillar: Sprite;
  private body: Sprite;
  private bodyFlash: Sprite;
  private mouth: Sprite;
  private lid: Sprite;
  private seam: Sprite;
  private seamHalo: Sprite;
  private keyhole: Sprite;
  private keyholeGlow: Sprite;
  private art: Sprite | null = null;
  private white: Sprite;
  private punch: Sprite;
  private pool: Sprite[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private destroyed = false;
  private tune: ChestTuning = { ...DEFAULT_CHEST_TUNING };

  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private baseY = 0;
  private size = 300;
  private scale = 1;
  /** Screen px per body-texture px. */
  private k = 1;
  /** The lid's resting position (screen), the seam line, the keyhole centre. */
  private lidRest = { x: 0, y: 0 };
  private rimY = 0;
  private rimCx = 0;
  private rimW = 0;
  private keyholeAt = { x: 0, y: 0 };

  private phase: ScenePhase = 'idle';
  private age = 0;
  private dur = 0;
  private ant: CrateAnticipation = { antMs: 600, antShake: 1.6, antGlow: 0.5, pulseMs: 520 };
  private preset: CratePreset | null = null;
  private color = NEUTRAL_GLOW;
  private pulseAcc = 0;
  private pulseEvery = 520;
  private pulseIntensity = 0.4;
  private pullAcc = 0;
  private pulled = 0;
  private moteAcc = 0;
  private kick = 0;          // squash impulse from a pulse (decays)
  private seamKick = 0;      // light impulse from a pulse (decays)
  private lidLift = 0;       // the lid's jump (screen px, decays)
  private lidLiftV = 0;
  private lidTilt = 0;
  private camShake = 0;      // screen shake amplitude (decays)
  private camShakeHold = 0;  // sustained ground shake (charge)
  private zoom = 1;
  private zoomVel = 0;
  private zoomTarget = 1;
  private lidV = { x: 0, y: 0, r: 0 };
  private lidFlying = false;
  private lidOff = false;
  private secondBurstIn = -1;
  private timeScale = 1;
  private raysFrom = 0;
  private raysTo = 0;
  private auraFrom = 0;
  private auraTo = 0;

  constructor(root: Container, textures: CrateSceneTextures, opts: CrateSceneOptions = {}) {
    this.root = root;
    this.tex = textures;
    this.opts = opts;
    const add = (t: Texture, alpha: number, blend: 'add' | 'normal' = 'add', parent: Container = this.set): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.blendMode = blend;
      s.alpha = alpha;
      parent.addChild(s);
      return s;
    };
    const M = textures.chest;
    this.backRays = add(textures.rays, 0, 'add', this.cam);
    this.aura = add(textures.glow, 0, 'add', this.cam);
    this.cam.addChild(this.set);
    this.floorGlow = add(textures.glow, 0.25);
    this.pedestal = add(textures.pedestal, 1, 'normal');
    this.runeRing = add(textures.runeRing, 0.12);
    this.shadow = add(textures.glow, 0.75, 'normal');
    this.shadow.tint = 0x000000;
    this.cam.addChild(this.crate);
    this.body = add(M.body, 1, 'normal', this.crate);
    this.bodyFlash = add(M.body, 0, 'add', this.crate);
    this.keyholeGlow = add(textures.glow, 0, 'add', this.crate);
    this.keyhole = add(M.keyhole ?? Texture.EMPTY, 0, 'add', this.crate);
    this.keyhole.visible = !!M.keyhole;
    this.mouth = add(textures.glow, 0, 'add', this.crate);
    this.lid = add(M.lid, 1, 'normal', this.crate);
    this.seamHalo = add(textures.glow, 0, 'add', this.crate); // a soft halo either side of the seam
    this.seam = add(textures.seamBar, 0, 'add', this.crate); // over the lid: the light spills out of the gap
    this.pillar = add(textures.glow, 0, 'add', this.cam);
    this.burstRays = add(textures.rays, 0, 'add', this.cam);
    this.cam.addChild(this.front);
    this.white = add(Texture.WHITE, 0, 'add', this.overlay);
    this.punch = add(Texture.WHITE, 0, 'add', this.overlay);
    root.addChild(this.cam, this.overlay);
    this.layout(800, 500);
    this.reset();
  }

  // ─── geometry ───────────────────────────────────────────────────────────────────────────────────────────

  /** The stage size (layout px). Event-driven: mount + resize only. */
  layout(w: number, h: number, crateScale = this.scale): void {
    this.w = w;
    this.h = h;
    this.scale = crateScale;
    this.size = crateSizeFor(w, h, crateScale);
    this.cx = w / 2;
    this.cy = h / 2;
    this.place();
  }

  /** The chest's fit and motion values (the tuner's Chest group). Re-places the chest. */
  setTuning(t: ChestTuning): void {
    this.tune = { ...DEFAULT_CHEST_TUNING, ...t };
    this.place();
  }

  /** A point on the body texture, in screen (crate-local) px. */
  private at(x: number, y: number): { x: number; y: number } {
    const M = this.tex.chest;
    return { x: this.cx + (x - M.cx) * this.k, y: this.baseY + (y - M.baseY) * this.k };
  }

  private place(): void {
    const S = this.size;
    const T = this.tex;
    const M = T.chest;
    const tn = this.tune;
    this.k = S / Math.max(1, M.width);
    const k = this.k;
    this.baseY = this.cy + S * 0.36;
    this.cam.pivot.set(this.cx, this.cy);
    this.cam.position.set(this.cx, this.cy);
    // the chest: pivot at its base centre so squash/stretch reads as weight
    this.crate.pivot.set(this.cx, this.baseY);
    this.crate.position.set(this.cx, this.baseY);
    for (const s of [this.body, this.bodyFlash]) {
      s.anchor.set(M.cx / Math.max(1, M.body.width), M.baseY / Math.max(1, M.body.height));
      s.scale.set(k);
      s.position.set(this.cx, this.baseY);
    }
    // the lid: its notch on the spike, on the rim; the tuner nudges it
    const lidAt = this.at(M.lidAtX, M.lidAtY);
    this.lidRest = { x: lidAt.x + (tn.lidOffsetX / 100) * S, y: lidAt.y + (tn.lidOffsetY / 100) * S };
    if (!this.lidFlying && !this.lidOff) {
      this.lid.anchor.set(M.lidAttachX / Math.max(1, M.lid.width), M.lidAttachY / Math.max(1, M.lid.height));
      this.lid.scale.set(k * M.lidRel * tn.lidScale);
      this.lid.position.set(this.lidRest.x, this.lidRest.y);
      this.lid.rotation = 0;
    }
    // the seam light along the rim, the keyhole's mask and glow, the open body's glow
    const rimL = this.at(M.rimX0, M.rimY);
    const rimR = this.at(M.rimX1, M.rimY);
    this.rimY = rimL.y + (tn.seamOffsetY / 100) * S;
    this.rimCx = (rimL.x + rimR.x) / 2;
    const rimW = rimR.x - rimL.x;
    this.rimW = rimW;
    this.seam.position.set(this.rimCx, this.rimY);
    this.seam.scale.set((rimW * tn.seamWidth) / Math.max(1, T.seamBar.width), (S * 0.07) / Math.max(1, T.seamBar.height));
    this.seamHalo.position.set(this.rimCx, this.rimY);
    this.seamHalo.scale.set((rimW * 1.2 * tn.seamWidth) / Math.max(1, T.glow.width), (S * 0.32) / Math.max(1, T.glow.width));
    this.keyholeAt = this.at(M.keyholeX, M.keyholeY);
    this.keyholeGlow.position.set(this.keyholeAt.x, this.keyholeAt.y);
    this.keyholeGlow.scale.set((M.keyholeR * k * 16) / Math.max(1, T.glow.width));
    if (M.keyhole) {
      const kx = this.at(M.keyholeX0, M.keyholeY0);
      this.keyhole.anchor.set(0);
      this.keyhole.scale.set(k);
      this.keyhole.position.set(kx.x, kx.y);
    }
    this.mouth.position.set(this.rimCx, this.rimY);
    this.mouth.scale.set((rimW * 1.15) / Math.max(1, T.glow.width), (S * 0.34) / Math.max(1, T.glow.width));
    // the set
    const pw = S * 1.55;
    const pk = pw / Math.max(1, T.pedestal.width);
    const faceY = (T.pedestal.width * 0.16) / 2;
    this.pedestal.anchor.set(0.5, faceY / Math.max(1, T.pedestal.height));
    this.pedestal.scale.set(pk);
    this.pedestal.position.set(this.cx, this.baseY + S * 0.02);
    this.runeRing.scale.set(pk);
    this.runeRing.position.set(this.cx, this.baseY + S * 0.02);
    this.floorGlow.position.set(this.cx, this.baseY + S * 0.02);
    this.floorGlow.scale.set((S * 2.6) / Math.max(1, T.glow.width), (S * 0.6) / Math.max(1, T.glow.width));
    this.shadow.position.set(this.cx, this.baseY + S * 0.01);
    this.shadow.scale.set((S * 1.25) / Math.max(1, T.glow.width), (S * 0.2) / Math.max(1, T.glow.width));
    const diag = Math.hypot(this.w, this.h) * 1.1;
    for (const r of [this.backRays, this.burstRays]) { r.position.set(this.cx, this.rimY - S * 0.35); r.scale.set(diag / Math.max(1, T.rays.width)); }
    this.aura.position.set(this.cx, this.rimY - S * 0.35);
    this.aura.scale.set((S * 3.2) / Math.max(1, T.glow.width));
    // the light column: rises out of the open body (its bright lower part sits in the mouth)
    this.pillar.anchor.set(0.5, 0.8);
    this.pillar.position.set(this.rimCx, this.rimY + S * 0.05);
    this.pillar.scale.set((rimW * 0.8) / Math.max(1, T.glow.width), (S * 3.4) / Math.max(1, T.glow.width));
    for (const s of [this.white, this.punch]) { s.anchor.set(0); s.position.set(0, 0); s.width = this.w; s.height = this.h; }
    if (this.art) this.fitArt(this.art);
  }

  /** The one-picture override: a texture replaces the two-layer chest (null = back to the two layers). */
  setCrateArt(texture: Texture | null): void {
    if (this.destroyed) return;
    if (this.art) { this.crate.removeChild(this.art); this.art.destroy(); this.art = null; }
    if (texture) {
      const s = new Sprite(texture);
      s.anchor.set(0.5, 1);
      this.art = s;
      this.crate.addChildAt(s, this.crate.getChildIndex(this.body));
      this.fitArt(s);
    }
    for (const part of [this.body, this.bodyFlash, this.lid, this.seam, this.seamHalo, this.keyhole, this.keyholeGlow, this.mouth]) part.visible = !texture;
    if (!texture) this.keyhole.visible = !!this.tex.chest.keyhole;
  }

  private fitArt(s: Sprite): void {
    s.scale.set((this.size * 1.05) / Math.max(1, s.texture.width));
    s.position.set(this.cx, this.baseY);
  }

  get center(): { x: number; y: number } { return { x: this.cx, y: this.cy }; }
  get crateSize(): number { return this.size; }
  get currentPhase(): ScenePhase { return this.phase; }
  get cameraZoom(): number { return this.zoom; }
  /** The chest in use ('art' = the owner's two layers, 'painted' = the fallback). */
  get chestKind(): 'art' | 'painted' { return this.tex.chest.kind; }
  /** The lid's state, for tests: where it is against its rest, its spin, whether it has come off. */
  get lidState(): { dx: number; dy: number; rotation: number; off: boolean; alpha: number } {
    return { dx: this.lid.position.x - this.lidRest.x, dy: this.lid.position.y - this.lidRest.y, rotation: this.lid.rotation, off: this.lidOff, alpha: this.lid.alpha };
  }

  // ─── beats ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Back to a sealed chest at rest (a fresh crate, or after Try again). */
  reset(): void {
    this.clearFx();
    this.setPhase('idle', 0);
    this.color = NEUTRAL_GLOW;
    this.preset = null;
    this.lidFlying = false;
    this.lidOff = false;
    this.secondBurstIn = -1;
    this.timeScale = 1;
    this.kick = this.seamKick = this.camShake = this.camShakeHold = 0;
    this.lidLift = this.lidLiftV = this.lidTilt = 0;
    this.zoom = this.zoomTarget = 1;
    this.zoomVel = 0;
    this.crate.alpha = 1;
    this.crate.scale.set(1);
    this.crate.rotation = 0;
    this.body.alpha = 1;
    this.bodyFlash.alpha = 0;
    this.lid.alpha = 1;
    this.seam.alpha = 0;
    this.seamHalo.alpha = 0;
    this.keyhole.alpha = 0;
    this.keyholeGlow.alpha = 0;
    this.mouth.alpha = 0;
    this.backRays.alpha = 0;
    this.burstRays.alpha = 0;
    this.aura.alpha = 0;
    this.pillar.alpha = 0;
    this.white.alpha = 0;
    this.punch.alpha = 0;
    this.runeRing.alpha = 0.12;
    this.runeRing.tint = NEUTRAL_GLOW;
    this.floorGlow.alpha = 0.22;
    this.floorGlow.tint = 0x6a86c8;
    this.shadow.alpha = 0.75;
    this.pedestal.alpha = 1;
    if (this.art) this.art.alpha = 1;
    for (const s of [this.seamHalo, this.keyholeGlow, this.mouth]) s.tint = NEUTRAL_GLOW;
    // the cores run white-hot: the rarity shows in the halos around them
    for (const s of [this.seam, this.keyhole]) s.tint = lerpColor(NEUTRAL_GLOW, 0xffffff, 0.6);
    this.place();
  }

  anticipate(a: CrateAnticipation): void {
    this.ant = a;
    this.pulseEvery = Math.max(120, a.pulseMs);
    this.pulseAcc = this.pulseEvery * 0.6; // the first pulse lands quickly after the click
    this.setPhase('anticipation', Math.max(1, a.antMs));
  }

  charge(p: CratePreset): void {
    this.preset = p;
    this.pulled = 0;
    this.pullAcc = 0;
    this.timeScale = 1;
    // the keyhole ignites: a flare at the keyhole, the first rarity pulse, a bigger lid jump
    this.spawnFlash(this.keyholeAt.x, this.keyholeAt.y, p.color, 0.9, 0.05, (this.size * 0.9) / this.tex.glow.width, 380, 0, 0.15);
    this.seamKick = 1;
    this.kick = 1;
    this.lidPop(1);
    this.opts.onPulse?.(0.6);
    this.zoomTarget = 1 + p.push;
    this.setPhase('charge', Math.max(1, p.chargeMs));
  }

  burst(p: CratePreset): void {
    this.preset = p;
    this.color = p.color;
    this.timeScale = 1;
    this.setPhase('burst', Math.max(1, p.burstMs));
    this.detonate(p, 1);
    // the light stays up from the hit on, so there is no dark beat between the burst and the plate
    this.aura.tint = p.color;
    this.aura.alpha = 0.9;
    this.pillar.tint = p.color;
    this.pillar.alpha = 1;
    if (p.doubleBurst) this.secondBurstIn = Math.min(320, p.burstMs * 0.3);
    // the camera snaps back past rest, then settles (a spring from here)
    this.zoomTarget = 1;
    this.zoom = 1 + p.push * 0.35;
    this.zoomVel = -p.push * 14;
  }

  /** The lid launches: up, to a random side, spinning; gravity brings it back down and off the screen. */
  private launchLid(): void {
    const S = this.size;
    const tn = this.tune;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.lidFlying = true;
    this.lidOff = true;
    this.lidV = {
      x: S * tn.lidLaunchX * side * (0.8 + Math.random() * 0.4),
      y: -S * tn.lidLaunchY * (0.9 + Math.random() * 0.2),
      r: side * Math.PI * 2 * tn.lidSpin * (0.8 + Math.random() * 0.4),
    };
  }

  private detonate(p: CratePreset, weight: number): void {
    const S = this.size;
    const tn = this.tune;
    const bx = this.rimCx;
    const by = this.rimY - S * 0.05;
    // white-hot flash (screen), then the rarity punch and a bloom
    this.white.alpha = Math.min(0.85, p.flash * 0.8 * weight);
    this.punch.tint = p.color;
    this.punch.alpha = 0;
    this.spawnFlash(bx, by, p.color, 0.3 * weight, 0, 0, 320, 50, 0.12, this.punch);
    this.spawnFlash(bx, by, 0xffffff, 1 * weight, (S * 0.3) / this.tex.glow.width, (S * 2.4) / this.tex.glow.width, 260, 0, 0.1);
    this.spawnFlash(bx, by, p.color, 0.95 * weight, (S * 0.8) / this.tex.glow.width, (S * 5.5) / this.tex.glow.width, p.burstMs * 0.8, 30, 0.12);
    // shockwave rings: the first white and fast, then rarity-coloured, slower and wider
    const n = weight < 1 ? 1 : p.rings;
    for (let i = 0; i < n; i++) {
      this.spawnRing(bx, by, S * (0.2 + i * 0.1), S * (1.9 + i * 1.3) * (weight < 1 ? 0.8 : 1), p.burstMs * (0.42 + i * 0.3), i === 0 ? 0xffffff : p.color, 0.95 - i * 0.15, i * 70);
    }
    // the ray burst
    this.burstRays.tint = p.color;
    this.burstRays.alpha = 0.9 * weight;
    this.burstRays.rotation = Math.random() * Math.PI;
    this.burstRays.scale.set((S * 0.8) / this.tex.rays.width);
    // the open body's light, and a flash of the body itself (the second, Legendary burst is ALL body flash)
    for (const s of [this.mouth, this.seamHalo, this.keyholeGlow]) s.tint = p.color;
    this.mouth.alpha = Math.min(1, tn.openGlow * 1.2);
    this.bodyFlash.tint = weight < 1 ? 0xffffff : p.color;
    this.bodyFlash.alpha = weight < 1 ? 0.95 : 0.55;
    // sparks: fast radial streaks out of the open chest, a hot white core
    const sparks = Math.round(p.burstSparks * weight);
    for (let i = 0; i < sparks; i++) {
      const a = -Math.PI / 2 + (i / Math.max(1, sparks) - 0.5) * Math.PI * 1.9 + (Math.random() - 0.5) * 0.4;
      const sp = S * (4 + Math.random() * 7);
      const streak = i % 2 === 0;
      this.spawn(streak ? 'streak' : 'spark', streak ? this.tex.streak : this.tex.spark, bx + (Math.random() - 0.5) * S * 0.6, by, i % 4 === 0 ? 0xffffff : p.color, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - S * 1.5, drag: 0.03, gravity: S * 5,
        life: 420 + Math.random() * 420, fromScale: streak ? 0.55 + Math.random() * 0.4 : 0.35 + Math.random() * 0.35, toScale: 0.05, peakAlpha: 1,
      });
    }
    if (weight < 1) { this.shake(p.screenShake * 0.6); this.spawnCoins(p); return; }
    // embers: slow, drifting, falling, flickering
    for (let i = 0; i < p.embers; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
      const sp = S * (0.8 + Math.random() * 2.2);
      this.spawn('ember', this.tex.spark, bx + (Math.random() - 0.5) * S * 0.8, by, Math.random() < 0.3 ? 0xffffff : p.color, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.25, gravity: S * 0.5,
        life: 1400 + Math.random() * 1400, fromScale: 0.22 + Math.random() * 0.2, toScale: 0.06, peakAlpha: 0.95,
      });
    }
    if (!this.art) {
      // shards and splinters burst off the RIM (the body stays whole on the pedestal)
      const M = this.tex.chest;
      const x0 = this.at(M.rimX0, M.rimY).x;
      const x1 = this.at(M.rimX1, M.rimY).x;
      for (let i = 0; i < p.debris; i++) {
        const u = Math.random();
        const x = x0 + (x1 - x0) * u;
        const a = -Math.PI / 2 + (u - 0.5) * Math.PI * 0.9 + (Math.random() - 0.5) * 0.5;
        const sp = S * (2.5 + Math.random() * 4);
        const tex = this.tex.shards[i % Math.max(1, this.tex.shards.length)] ?? this.tex.spark;
        this.spawn('shard', tex, x, this.rimY, 0xffffff, {
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.5, gravity: S * 11, spin: (Math.random() - 0.5) * 22,
          life: 900 + Math.random() * 600, fromScale: (S * (0.07 + Math.random() * 0.08)) / Math.max(1, tex.width), toScale: (S * 0.06) / Math.max(1, tex.width), peakAlpha: 1,
        }, 'normal');
      }
      this.launchLid();
    }
    this.crate.scale.set(1.08, 0.92);
    this.shake(p.screenShake);
    if (!p.doubleBurst) this.spawnCoins(p);
  }

  private spawnCoins(p: CratePreset): void {
    const S = this.size;
    for (let i = 0; i < p.coins; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const sp = S * (5 + Math.random() * 5);
      this.spawn('coin', this.tex.coin, this.rimCx + (Math.random() - 0.5) * S * 0.5, this.rimY, 0xffffff, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.35, gravity: S * 12, spin: 6 + Math.random() * 10,
        life: 1500 + Math.random() * 700, fromScale: (S * (0.11 + Math.random() * 0.05)) / Math.max(1, this.tex.coin.width), toScale: (S * 0.1) / Math.max(1, this.tex.coin.width), peakAlpha: 1,
      }, 'normal');
    }
  }

  reveal(p: CratePreset): void {
    this.preset = p;
    this.color = p.color;
    this.aura.tint = p.color;
    this.auraFrom = this.aura.alpha;
    this.auraTo = 0.75;
    this.raysFrom = this.backRays.alpha;
    this.raysTo = 0; // the DOM ray backdrop takes over (it keeps turning after the ticker stops)
    this.backRays.tint = p.color;
    this.runeRing.tint = p.color;
    this.floorGlow.tint = p.color;
    this.moteAcc = 0;
    this.setPhase('reveal', Math.max(1, p.burstMs * 0.7 + p.revealHoldMs));
  }

  settle(ms: number): void {
    this.auraFrom = this.aura.alpha;
    this.auraTo = 0.35;
    this.raysFrom = this.backRays.alpha;
    this.raysTo = 0;
    this.setPhase('settle', Math.max(1, ms));
  }

  /** Skip: straight to the settled reveal (the open body glowing on the pedestal). Every in-flight effect is dropped. */
  skipToSettled(p: CratePreset): void {
    this.clearFx();
    this.preset = p;
    this.color = p.color;
    this.lidFlying = false;
    this.lidOff = true;
    this.secondBurstIn = -1;
    this.timeScale = 1;
    this.kick = this.seamKick = this.camShake = this.camShakeHold = 0;
    this.lidLift = this.lidLiftV = 0;
    this.zoom = this.zoomTarget = 1;
    this.zoomVel = 0;
    this.crate.alpha = 1;
    this.crate.scale.set(1);
    this.crate.rotation = 0;
    this.crate.position.set(this.cx, this.baseY);
    this.lid.alpha = 0;
    this.bodyFlash.alpha = 0;
    this.seam.alpha = 0;
    this.seamHalo.alpha = 0;
    this.keyhole.alpha = 0.5 * this.tune.keyholeGlow;
    this.keyholeGlow.alpha = 0;
    for (const s of [this.mouth, this.keyhole]) s.tint = p.color;
    this.mouth.alpha = this.tune.openGlow * 0.6;
    if (this.art) this.art.alpha = 0;
    this.white.alpha = 0;
    this.punch.alpha = 0;
    this.burstRays.alpha = 0;
    this.backRays.alpha = 0;
    this.aura.tint = p.color;
    this.aura.alpha = 0.35;
    this.pillar.alpha = 0;
    this.runeRing.tint = p.color;
    this.runeRing.alpha = 0.5;
    this.floorGlow.tint = p.color;
    this.floorGlow.alpha = 0.35;
    this.applyCamera(0);
    this.setPhase('settled', 0);
  }

  /** A failed or empty answer: the light and shake die down to a sealed chest at rest. */
  windDown(ms: number): void {
    this.zoomTarget = 1;
    this.setPhase('winddown', Math.max(1, ms));
  }

  private setPhase(p: ScenePhase, dur: number): void {
    this.phase = p;
    this.age = 0;
    this.dur = dur;
  }

  private shake(amp: number): void { this.camShake = Math.max(this.camShake, amp); }

  /** The lid jumps: an upward kick on its spring and a small random tilt. `k` = 0..1 pressure. */
  private lidPop(k: number): void {
    if (this.lidOff) return;
    this.lidLiftV -= this.size * (this.tune.lidJump / 100) * 26 * (0.5 + k);
    this.lidTilt = (Math.random() - 0.5) * 0.05 * (0.4 + k);
  }

  // ─── the frame ──────────────────────────────────────────────────────────────────────────────────────────

  /** Whether anything is still moving (the ticker stops when this is false). */
  hasWork(): boolean {
    if (this.destroyed) return false;
    return this.particles.length > 0 || this.rings.length > 0 || this.flashes.length > 0 || this.lidFlying
      || this.camShake > 0.05 || Math.abs(this.zoom - this.zoomTarget) > 0.0005 || Math.abs(this.zoomVel) > 0.001
      || this.white.alpha > 0.01 || this.burstRays.alpha > 0.01 || this.bodyFlash.alpha > 0.01 || this.secondBurstIn >= 0
      || Math.abs(this.lidLift) > 0.1 || Math.abs(this.lidLiftV) > 1
      || (this.phase !== 'idle' && this.phase !== 'settled');
  }

  /** Advance by `dtMs` of (speed-scaled) time. Returns `hasWork()`. */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const real = Math.min(Math.max(0, dtMs), 64);
    this.age += real;
    const t = this.dur > 0 ? clamp01(this.age / this.dur) : 1;
    const p = this.preset;
    const S = this.size;
    const tn = this.tune;
    // the Legendary hitch: the last `hitchMs` of the charge run in slow motion
    if (this.phase === 'charge' && p && p.hitchMs > 0 && this.age > this.dur - p.hitchMs) this.timeScale = p.hitchScale;
    const dt = real * this.timeScale;
    const sec = dt / 1000;
    let crateShake = 0;
    let seamBase = 0;
    let keyBase = 0;

    switch (this.phase) {
      case 'anticipation': {
        crateShake = this.ant.antShake * (0.35 + 0.65 * easeInQuad(t));
        seamBase = this.ant.antGlow * (0.3 + 0.3 * easeOutCubic(t));
        keyBase = this.ant.antGlow * (0.35 + 0.35 * easeOutCubic(t));
        this.runeRing.alpha = 0.12 + 0.18 * t;
        this.pulse(dt, 0.35 + 0.35 * t);
        this.moteAcc += dt;
        if (this.moteAcc >= 140) { this.moteAcc -= 140; this.spawnMote(NEUTRAL_GLOW); }
        break;
      }
      case 'charge': {
        if (!p) break;
        const ct = clamp01(this.age / Math.max(1, this.dur - p.hitchMs));
        this.color = lerpColor(NEUTRAL_GLOW, p.color, easeOutCubic(Math.min(1, ct / 0.3)));
        for (const s of [this.seamHalo, this.keyholeGlow, this.runeRing, this.floorGlow]) s.tint = this.color;
        for (const s of [this.seam, this.keyhole]) s.tint = lerpColor(this.color, 0xffffff, 0.55);
        this.backRays.tint = this.color;
        crateShake = this.ant.antShake + (p.shake - this.ant.antShake) * easeInQuad(ct);
        this.camShakeHold = p.screenShake * 0.22 * easeInCubic(ct);
        seamBase = 0.5 + 0.5 * easeInQuad(ct);
        keyBase = 0.7 + 0.3 * ct;
        this.runeRing.alpha = 0.3 + 0.6 * ct;
        this.floorGlow.alpha = 0.25 + 0.5 * ct;
        this.backRays.alpha = p.rays * 0.16 * easeInQuad(ct);
        this.backRays.rotation += 0.2 * sec;
        // the pulses accelerate toward the burst
        this.pulseEvery = this.ant.pulseMs + (p.pulseEndMs - this.ant.pulseMs) * easeInQuad(ct);
        this.pulse(dt, 0.6 + 0.4 * ct);
        // compress
        this.crate.scale.set(1 + 0.04 * easeInQuad(ct), 1 - 0.06 * easeInQuad(ct));
        // energy pulled in: spread over the first 85%
        this.pullAcc += dt;
        const want = Math.min(p.chargeParticles, Math.ceil(p.chargeParticles * Math.min(1, ct / 0.85)));
        while (this.pulled < want) { this.pulled++; this.spawnPull(p); }
        break;
      }
      case 'burst': {
        this.backRays.alpha = Math.max(0, this.backRays.alpha - sec * 1.5);
        this.seam.alpha = Math.max(0, this.seam.alpha - sec * 4);
        this.seamHalo.alpha = Math.max(0, this.seamHalo.alpha - sec * 4);
        this.keyholeGlow.alpha = Math.max(0, this.keyholeGlow.alpha - sec * 3);
        this.keyhole.alpha = Math.max(0.5 * tn.keyholeGlow, this.keyhole.alpha - sec * 2);
        this.mouth.alpha = Math.max(tn.openGlow, this.mouth.alpha - sec);
        if (this.art) this.art.alpha = Math.max(0, this.art.alpha - sec * 7);
        this.runeRing.alpha = 0.9;
        this.floorGlow.alpha = Math.max(0.35, this.floorGlow.alpha - sec);
        break;
      }
      case 'reveal': {
        const rt = clamp01(this.age / 500);
        this.aura.alpha = this.auraFrom + (this.auraTo - this.auraFrom) * easeOutCubic(rt);
        this.aura.scale.set((S * 3.2 / Math.max(1, this.tex.glow.width)) * (0.8 + 0.2 * easeOutBack(rt)));
        this.backRays.alpha = this.raysFrom + (this.raysTo - this.raysFrom) * easeOutCubic(rt);
        this.backRays.rotation += 0.12 * sec;
        this.runeRing.alpha = 0.9 - 0.35 * rt;
        const pt = easeOutCubic(clamp01(this.age / 900));
        this.pillar.alpha = Math.max(0, 1 - pt);
        this.pillar.scale.x = ((this.rimW * 0.8) / Math.max(1, this.tex.glow.width)) * (1 - 0.5 * pt);
        // the open body keeps glowing while the plate rises above it
        this.mouth.alpha = tn.openGlow * (1 - 0.35 * pt);
        this.keyhole.alpha = 0.5 * tn.keyholeGlow;
        this.moteAcc += dt;
        if (this.moteAcc >= 70) { this.moteAcc -= 70; this.spawnRise(this.color); }
        break;
      }
      case 'settle': {
        this.aura.alpha = this.auraFrom + (this.auraTo - this.auraFrom) * easeOutCubic(t);
        this.backRays.alpha = this.raysFrom + (this.raysTo - this.raysFrom) * easeOutCubic(t);
        this.backRays.rotation += 0.1 * sec;
        this.runeRing.alpha = 0.55 - 0.1 * t;
        this.mouth.alpha = tn.openGlow * (0.65 - 0.05 * t);
        if (t >= 1) this.setPhase('settled', 0);
        break;
      }
      case 'winddown': {
        seamBase = Math.max(0, this.seam.alpha / Math.max(0.01, tn.seamGlow) - sec * 3);
        keyBase = Math.max(0, this.keyhole.alpha / Math.max(0.01, tn.keyholeGlow) - sec * 3);
        this.runeRing.alpha = Math.max(0.12, this.runeRing.alpha - sec);
        this.backRays.alpha = Math.max(0, this.backRays.alpha - sec * 2);
        this.camShakeHold = 0;
        this.crate.scale.set(1);
        if (t >= 1) this.setPhase('idle', 0);
        break;
      }
      default: break;
    }

    // the seam and keyhole light: a base level plus the pulse flare (the lid's jump opens the seam further)
    if (this.phase === 'anticipation' || this.phase === 'charge' || this.phase === 'winddown') {
      const open = Math.min(1, Math.max(0, -this.lidLift) / Math.max(1, S * 0.02));
      this.seam.alpha = Math.min(1, (seamBase + this.seamKick * 0.5 + open * 0.35) * tn.seamGlow);
      this.seamHalo.alpha = Math.min(1, (seamBase * 0.55 + this.seamKick * 0.35 + open * 0.2) * tn.seamGlow);
      this.keyhole.alpha = Math.min(1, (keyBase + this.seamKick * 0.4) * tn.keyholeGlow);
      this.keyholeGlow.alpha = Math.min(1, (keyBase * 0.7 + this.seamKick * 0.45) * tn.keyholeGlow);
      this.floorGlow.alpha = Math.max(this.floorGlow.alpha, 0.2 + this.seamKick * 0.3);
    }
    this.seamKick *= Math.exp(-dt / 140);
    this.kick *= Math.exp(-dt / 110);
    this.bodyFlash.alpha = Math.max(0, this.bodyFlash.alpha - sec * 2.8);

    // the lid's own spring (its jumps) and its tilt
    this.lidLiftV += (-this.lidLift * 900 - this.lidLiftV * 22) * sec;
    this.lidLift += this.lidLiftV * sec;
    if (this.lidLift > 0) { this.lidLift = 0; this.lidLiftV = -this.lidLiftV * 0.25; } // it lands on the rim, a small bounce
    this.lidTilt *= Math.exp(-dt / 160);

    // the chest: squash from pulses, shake, the lid rattling on top
    if (this.phase === 'anticipation' || this.phase === 'charge') {
      const q = this.kick;
      const baseX = this.phase === 'charge' ? this.crate.scale.x : 1;
      const baseY = this.phase === 'charge' ? this.crate.scale.y : 1;
      this.crate.scale.set(baseX * (1 + 0.035 * q), baseY * (1 - 0.05 * q));
      const a = this.age;
      this.crate.position.set(this.cx + crateShake * Math.sin(a * 0.071) * Math.cos(a * 0.019), this.baseY);
      this.crate.rotation = (crateShake / Math.max(40, S)) * 0.8 * Math.sin(a * 0.057);
      if (!this.lidFlying && !this.lidOff) {
        const rattle = this.phase === 'charge' ? crateShake * 0.25 * Math.abs(Math.sin(a * 0.09)) : 0;
        this.lid.position.set(this.lidRest.x + crateShake * 0.15 * Math.sin(a * 0.13), this.lidRest.y + this.lidLift - rattle);
        this.lid.rotation = this.lidTilt + Math.sin(a * 0.11) * crateShake * 0.0015;
      }
    } else if (this.phase === 'burst') {
      // spring the squash back
      const sx = 1 + (this.crate.scale.x - 1) * Math.exp(-dt / 70);
      const sy = 1 + (this.crate.scale.y - 1) * Math.exp(-dt / 70);
      this.crate.scale.set(sx, sy);
      this.crate.position.set(this.cx, this.baseY);
      this.crate.rotation = 0;
    } else if (this.phase === 'idle' || this.phase === 'winddown') {
      this.crate.position.set(this.cx, this.baseY);
      this.crate.rotation = 0;
      if (!this.lidFlying && !this.lidOff) { this.lid.position.set(this.lidRest.x, this.lidRest.y + this.lidLift); this.lid.rotation = this.lidTilt; }
    }

    // the lid in flight: up, spinning, pulled back down by gravity, fading as it leaves
    if (this.lidFlying) {
      this.lidV.y += S * tn.lidGravity * sec;
      this.lid.position.x += this.lidV.x * sec;
      this.lid.position.y += this.lidV.y * sec;
      this.lid.rotation += this.lidV.r * sec;
      if (this.lidV.y > 0) this.lid.alpha = Math.max(0, this.lid.alpha - sec * 2.2);
      if (this.lid.alpha <= 0 || this.lid.position.y > this.h + S) { this.lidFlying = false; this.lid.alpha = 0; }
    }

    // the second (Legendary) burst
    if (this.secondBurstIn >= 0) {
      this.secondBurstIn -= dt;
      if (this.secondBurstIn < 0 && p) this.detonate(p, 0.7);
    }

    // screen flash (fast) and the burst rays (scale out, fade)
    this.white.alpha = Math.max(0, this.white.alpha - sec * 8);
    if (this.burstRays.alpha > 0) {
      this.burstRays.alpha = Math.max(0, this.burstRays.alpha - sec * 1.6);
      const target = (Math.hypot(this.w, this.h) * 1.1) / Math.max(1, this.tex.rays.width);
      this.burstRays.scale.set(this.burstRays.scale.x + (target - this.burstRays.scale.x) * (1 - Math.exp(-dt / 120)));
      this.burstRays.rotation += 0.4 * sec;
    }

    // camera: the push-in spring, the ground shake, the decaying burst shake
    this.zoomTarget = this.phase === 'charge' && p ? 1 + p.push * easeInOutSine(clamp01(this.age / Math.max(1, this.dur))) + (this.timeScale < 1 ? p.push * 0.25 : 0) : this.zoomTarget;
    const k = 180, damp = 18;
    this.zoomVel += ((this.zoomTarget - this.zoom) * k - this.zoomVel * damp) * (real / 1000);
    this.zoom += this.zoomVel * (real / 1000);
    this.camShake *= Math.exp(-real / 130);
    if (this.camShake < 0.05) this.camShake = 0;
    this.applyCamera(this.age);

    this.stepParticles(dt, sec);
    this.stepRings(dt);
    this.stepFlashes(dt);
    return this.hasWork();
  }

  private applyCamera(a: number): void {
    const amp = this.camShake + this.camShakeHold;
    const sx = amp * (Math.sin(a * 0.093) * 0.7 + Math.sin(a * 0.171) * 0.3);
    const sy = amp * (Math.cos(a * 0.081) * 0.7 + Math.sin(a * 0.143) * 0.3);
    this.cam.scale.set(this.zoom);
    this.cam.position.set(this.cx + sx, this.cy + sy);
  }

  /** The heartbeat: a kick every `pulseEvery` ms, with a flare of light and a sound hook. */
  private pulse(dt: number, intensity: number): void {
    this.pulseAcc += dt;
    if (this.pulseAcc >= this.pulseEvery) {
      this.pulseAcc -= this.pulseEvery;
      this.kick = 1;
      this.seamKick = intensity;
      this.lidPop(intensity);
      this.opts.onPulse?.(intensity);
      // a faint ring breathing out from the base on each beat
      this.spawnRing(this.cx, this.baseY + this.size * 0.02, this.size * 0.5, this.size * 0.9, 420, this.color, 0.25 * intensity, 0, true);
    }
  }

  private stepParticles(dt: number, sec: number): void {
    const S = this.size;
    // energy is pulled INTO the keyhole
    const tx = this.keyholeAt.x, ty = this.keyholeAt.y;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) { this.release(q.sprite); this.particles.splice(i, 1); continue; }
      const lived = 1 - q.life / q.maxLife;
      const s = q.sprite;
      if (q.kind === 'pull') {
        // accelerate toward the chest, oriented along the flight
        const dx = tx - q.x, dy = ty - q.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const acc = S * 14;
        q.vx += (dx / d) * acc * sec;
        q.vy += (dy / d) * acc * sec;
        q.x += q.vx * sec;
        q.y += q.vy * sec;
        s.rotation = Math.atan2(q.vy, q.vx);
        s.alpha = q.peakAlpha * Math.min(1, lived * 5);
        if (d < S * 0.05) q.life = 0;
      } else {
        const k = Math.pow(q.drag, sec);
        q.vx *= k;
        q.vy = q.vy * k + q.gravity * sec;
        q.x += q.vx * sec;
        q.y += q.vy * sec;
        if (q.kind === 'streak') s.rotation = Math.atan2(q.vy, q.vx);
        else s.rotation += q.spin * sec;
        if (q.kind === 'mote' || q.kind === 'rise') s.alpha = q.peakAlpha * Math.sin(Math.PI * lived);
        else if (q.kind === 'ember') s.alpha = q.peakAlpha * (1 - easeInQuad(lived)) * (0.65 + 0.35 * Math.sin(q.seed + lived * 40));
        else if (q.kind === 'coin') s.alpha = lived > 0.8 ? (1 - lived) / 0.2 : 1;
        else s.alpha = q.peakAlpha * (1 - easeInQuad(lived));
      }
      s.position.set(q.x, q.y);
      const sc = q.fromScale + (q.toScale - q.fromScale) * lived;
      if (q.kind === 'coin') {
        const spinX = Math.cos(q.seed + lived * q.spin * 3);
        s.scale.set(sc * Math.max(0.08, Math.abs(spinX)), sc);
        s.tint = spinX < 0 ? 0xc89a40 : 0xffffff;
        s.rotation = 0;
      } else if (q.kind === 'streak' || q.kind === 'pull') {
        const v = Math.hypot(q.vx, q.vy);
        s.scale.set(sc * Math.min(3, 0.4 + v / (S * 6)), sc);
      } else s.scale.set(sc);
    }
  }

  private stepRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r.delay > 0) { r.delay -= dt; r.sprite.alpha = 0; continue; }
      r.age += dt;
      const t = r.age / r.dur;
      if (t >= 1) { this.release(r.sprite); this.rings.splice(i, 1); continue; }
      const rad = r.fromR + (r.toR - r.fromR) * easeOutCubic(t);
      const base = rad / (this.tex.ring.width * 0.42);
      r.sprite.scale.set(base, base * r.thin);
      r.sprite.alpha = r.peak * (1 - easeInQuad(t));
    }
  }

  private stepFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.age += dt;
      const t = f.age / f.dur;
      if (t >= 1) {
        if (f.sprite === this.punch) this.punch.alpha = 0; else this.release(f.sprite);
        this.flashes.splice(i, 1);
        continue;
      }
      if (f.sprite !== this.punch) f.sprite.scale.set(f.fromScale + (f.toScale - f.fromScale) * easeOutCubic(t));
      f.sprite.alpha = f.peak * (t < f.attack ? t / f.attack : 1 - easeOutCubic((t - f.attack) / (1 - f.attack)));
    }
  }

  // ─── spawning (pooled) ──────────────────────────────────────────────────────────────────────────────────

  private acquire(tex: Texture): Sprite | null {
    if (this.destroyed) return null;
    if (this.front.children.length >= MAX_PARTICLES + 24) return null;
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
    o: { vx?: number; vy?: number; drag?: number; gravity?: number; spin?: number; life: number; fromScale?: number; toScale?: number; peakAlpha?: number },
    blend: 'add' | 'normal' = 'add'): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const s = this.acquire(tex);
    if (!s) return;
    s.tint = tint;
    s.blendMode = blend;
    s.rotation = Math.random() * Math.PI * 2;
    const q: Particle = {
      sprite: s, kind, x, y,
      vx: o.vx ?? 0, vy: o.vy ?? 0, drag: o.drag ?? 1, gravity: o.gravity ?? 0, spin: o.spin ?? 0,
      life: Math.max(1, o.life), maxLife: Math.max(1, o.life),
      fromScale: o.fromScale ?? 1, toScale: o.toScale ?? 1, peakAlpha: o.peakAlpha ?? 1, seed: Math.random() * 10,
    };
    s.position.set(x, y);
    s.scale.set(q.fromScale);
    s.alpha = kind === 'mote' || kind === 'rise' || kind === 'pull' ? 0 : q.peakAlpha;
    this.particles.push(q);
  }

  private spawnMote(tint: number): void {
    const S = this.size;
    this.spawn('mote', this.tex.spark, this.cx + (Math.random() - 0.5) * S * 1.3, this.baseY - Math.random() * S * 0.1, tint, {
      vx: (Math.random() - 0.5) * S * 0.1, vy: -S * (0.25 + Math.random() * 0.35), life: 1400 + Math.random() * 800,
      fromScale: 0.12 + Math.random() * 0.12, toScale: 0.05, peakAlpha: 0.7,
    });
  }

  private spawnPull(p: CratePreset): void {
    const S = this.size;
    const a = Math.random() * Math.PI * 2;
    const r = S * (1.4 + Math.random() * 1.3);
    this.spawn('pull', this.tex.streak, this.keyholeAt.x + Math.cos(a) * r, this.keyholeAt.y + Math.sin(a) * r * 0.75, Math.random() < 0.25 ? 0xffffff : p.color, {
      life: 1200, fromScale: 0.6 + Math.random() * 0.4, toScale: 0.35, peakAlpha: 1,
    });
  }

  private spawnRise(tint: number): void {
    const S = this.size;
    // motes rising out of the open chest's mouth
    this.spawn('rise', this.tex.spark, this.rimCx + (Math.random() - 0.5) * this.rimW * 0.9, this.rimY - Math.random() * S * 0.1, tint, {
      vx: (Math.random() - 0.5) * S * 0.08, vy: -S * (0.35 + Math.random() * 0.45), life: 1600 + Math.random() * 900,
      fromScale: 0.12 + Math.random() * 0.14, toScale: 0.04, peakAlpha: 0.8,
    });
  }

  private spawnRing(x: number, y: number, fromR: number, toR: number, dur: number, tint: number, peak: number, delay: number, flat = false): void {
    const s = this.acquire(this.tex.ring);
    if (!s) return;
    s.tint = tint;
    s.position.set(x, y);
    s.alpha = 0;
    // a flat ring lies on the floor (squashed); a burst ring is round
    this.rings.push({ sprite: s, age: 0, dur: Math.max(1, dur), fromR, toR, peak: Math.max(0.05, peak), delay, thin: flat ? 0.2 : 1 });
  }

  private spawnFlash(x: number, y: number, tint: number, peak: number, fromScale: number, toScale: number, dur: number, delay: number, attack: number, sprite?: Sprite): void {
    if (!(peak > 0)) return;
    const s = sprite ?? this.acquire(this.tex.glow);
    if (!s) return;
    if (!sprite) { s.tint = tint; s.position.set(x, y); s.scale.set(fromScale); }
    s.alpha = 0;
    this.flashes.push({ sprite: s, age: 0, dur: Math.max(1, dur), peak, fromScale, toScale, delay, attack: Math.min(0.9, Math.max(0.01, attack)) });
  }

  private clearFx(): void {
    for (const q of this.particles) this.release(q.sprite);
    for (const r of this.rings) this.release(r.sprite);
    for (const f of this.flashes) { if (f.sprite === this.punch) this.punch.alpha = 0; else this.release(f.sprite); }
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
    this.art = null;
    // children:true destroys every container and sprite below; textures stay (the caller owns them).
    for (const c of [this.cam, this.overlay]) {
      this.root.removeChild(c);
      c.destroy({ children: true });
    }
  }
}
