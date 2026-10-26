/**
 * THE CRATE FX CONTROLLER: owns its OWN Pixi `Application` (a transparent, pointer-events:none canvas over the
 * whole crate theatre), never the gameplay `pixiFx` singleton, which is not mounted on the menus anyway. The
 * drawing lives in `CrateScene` (headless-testable); the pictures are painted once in `crateTextures.ts`. This
 * file is the renderer, the ticker, the texture bake and the art loader.
 *
 * The hero ceremony's contract (`HeroCeremonyPixi.ts`):
 *  - `mount` resolves false (and every call becomes a no-op) if Pixi cannot start: the theatre then draws its
 *    DOM crate and the opening still works, just without the Pixi layer.
 *  - `destroy()` is safe at any moment, including before the async init resolves (the late Application is
 *    destroyed on arrival). It removes the canvas and destroys every sprite, texture and the renderer.
 *  - The ticker runs only while the scene has work, and stops the frame it goes idle.
 *  - Geometry comes from `resize()` (mount + a ResizeObserver), never a per-frame DOM read.
 *  - The renderer's resolution folds in the stage scale (`stageScale()`), so a phone never renders ~8x the pixels
 *    it shows (the stage tripwire enforces this).
 *  - Every texture is painted once at mount: nothing is redrawn per frame.
 *
 * THE TIER CHESTS (tiered chest openings, 2026-10-19). `setChest(tier)` swaps in the chest the crate's tier was bought
 * as. Its PICTURES come from the page-wide cache (`chestArt.ts`: fetched and decoded once, usually long before the
 * click); this controller makes them into textures once, uploads them to the GPU, and only then swaps them in, so the
 * swap's frame pays no decode and no upload. An opening never waits on them: if a tier's art fails, or is not ready
 * within `CHEST_ART_WAIT_MS`, that opening plays on the Standard chest and `setChest` says so (it resolves with the tier
 * actually drawn). The opening's effects layer and sounds are the asked tier's either way (`setTierLayer`, the theatre's
 * call): only the ART falls back. The one-picture override (`setArt`) wins over every tier.
 *
 * FINAL REVIEW FIXES (2026-10-19):
 *  - THE FIRST FRAME IS THE RIGHT CHEST. `mount(host, firstTier)` starts that tier's pictures before Pixi's own init and
 *    races them (up to `CHEST_ART_WAIT_MS`) inside the bake, BEFORE the first render: a theatre whose first chest is
 *    Epic never paints Standard and then swaps.
 *  - LATE ART NEVER LANDS MID-FINALE. Once the burst has started, a tier swap that arrives late is dropped for that
 *    opening (the cache keeps it for the next one).
 *  - A BEAT ASKED BEFORE THE MOUNT STILL PLAYS. The bay's and the post-game's autoOpen start the opening while Pixi is
 *    still starting. The anticipation (or a skip's settled reveal) asked before the scene exists is kept and replayed when
 *    the mount lands, the anticipation resumed as far in as it already is, with the tier layer handed over first, so the
 *    aura, the motes, the shake and the heartbeat all play. A reset or any later beat drops the waiting one.
 */
import { Application, Assets, CanvasSource, Container, ImageSource, Texture, type TextureSource } from 'pixi.js';
import { stageScale } from '../../stage';
import type { CratePreset } from './crateFxConfig';
import { CrateScene, type ChestTuning, type CrateAnticipation, type CrateSceneTextures, type ScenePhase } from './crateScene';
import { artChestModel, paintedChestModel, type ChestModel } from './chestModel';
import { chestArtFor, preloadChestArt, type ChestArtImages, type ChestImageLoader } from './chestArt';
import { NO_TIER_LAYER, type ChestTier, type ChestTierPreset, type LayeredTier } from './chestTiers';
import { detachPixiDomEvents } from '../../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from '../../pixiAppSafety';
import {
  CHEST, paintAura, paintBand, paintChestBody, paintChestLid, paintCoin, paintGlow, paintPedestal,
  paintRays, paintRing, paintRuneRing, paintSeamBar, paintShards, paintSpark, paintStreak, paintWisp,
} from './crateTextures';
import { PIXI_ANTIALIAS } from '../../phoneArt';
import { phonePixiOptions, pixiAllowed } from '../../phoneDiag';
import { followStage } from '../../pixiStageFollow';

export interface CrateFx {
  /**
   * Start Pixi in `host`, its first frame drawing `firstTier`'s chest when that art is ready in time (Standard
   * otherwise). Resolves true when it is live, false when it is not (DOM fallback).
   */
  mount(host: HTMLElement, firstTier?: ChestTier): Promise<boolean>;
  /** The host's size changed (layout px). */
  resize(w: number, h: number, crateScale: number): void;
  /** Playback speed (the tuner's slow motion). Scales the scene clock. */
  setSpeed(speed: number): void;
  /** The one-picture override: a URL for a single crate picture ('' = the owner's two-layer chest). */
  setArt(url: string): void;
  /** The chest's fit and motion (the tuner's Chest group). */
  tune(t: ChestTuning): void;
  /** Which chest is drawn: the owner's two layers ('art'), the painted fallback, or none yet (not mounted). */
  chestKind(): 'art' | 'painted' | null;
  /** Called on every heartbeat pulse (`k` = 0..1 intensity), so the theatre can tick a sound on the beat. */
  onPulse(fn: ((k: number) => void) | null): void;
  /**
   * Draw the chest of this tier. Resolves with the tier actually drawn: 'standard' when its art fails or is not ready
   * within `CHEST_ART_WAIT_MS`, before mount, or after destroy; the chest already drawn when the art lands after the
   * burst has started. Never rejects.
   */
  setChest(tier: ChestTier): Promise<ChestTier>;
  /** The chest tier's effects layer (`NO_TIER_LAYER` = none). Call before `anticipate`. */
  setTierLayer(t: ChestTierPreset): void;
  reset(): void;
  /** The anticipation; `elapsedMs` = how far into it the opening already is (a remount mid-opening). */
  anticipate(a: CrateAnticipation, elapsedMs?: number): void;
  charge(p: CratePreset): void;
  burst(p: CratePreset): void;
  reveal(p: CratePreset): void;
  settle(ms: number): void;
  skipToSettled(p: CratePreset): void;
  windDown(ms: number): void;
  destroy(): void;
}

/** The painted fallback chest's texture width (px). */
const CHEST_TEX_W = 720;

/** How long an opening waits for its tier's chest art before it plays on the Standard chest (ms). */
export const CHEST_ART_WAIT_MS = 300;

/** The scene phases from the burst on: a tier chest arriving now is dropped for this opening. */
const BURST_ON: readonly ScenePhase[] = ['burst', 'reveal', 'settle', 'settled'];

export interface CrateFxOptions {
  /** Loads one picture (tests inject a failing or hanging one; it bypasses the page-wide cache). Default: the cache's. */
  loadImage?: ChestImageLoader;
}

const fromCanvas = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });
const fromImage = (img: HTMLImageElement): Texture => new Texture({ source: new ImageSource({ resource: img }) });
const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

/** `p`, or null once `ms` have passed (the timer is cleared either way). */
async function within<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
  try { return await Promise.race([p, late]); } finally { clearTimeout(timer); }
}

/** A beat asked before the scene existed, kept for the mount (see the header). */
type PendingBeat = { kind: 'anticipate'; a: CrateAnticipation; elapsed: number; at: number } | { kind: 'settled'; p: CratePreset };

export class CrateFxPixi implements CrateFx {
  private app: Application | null = null;
  private scene: CrateScene | null = null;
  private textures: Texture[] = [];
  private destroyed = false;
  private speed = 1;
  private artUrl = '';
  private artToken = 0;
  private pendingSize: [number, number, number] | null = null;
  private pulseFn: ((k: number) => void) | null = null;
  private tuning: ChestTuning | null = null;
  /** A test's own picture loader (bypasses the page-wide cache), or undefined = the cache. */
  private readonly loadOverride: ChestImageLoader | undefined;
  /** Uploads a texture source to the GPU (the renderer's, once mounted; a test's spy). */
  private upload: ((src: TextureSource) => void) | null = null;
  /** The chest baked at mount (the owner's Standard art, or the painted fallback). */
  private standardChest: ChestModel | null = null;
  /** Each tier's chest, loading or loaded (a failed load is dropped, so a later opening tries again). */
  private tierChests = new Map<LayeredTier, Promise<ChestModel | null>>();
  private chestToken = 0;
  private drawn: ChestTier = 'standard';
  private tierLayer: ChestTierPreset = NO_TIER_LAYER;
  private pendingBeat: PendingBeat | null = null;

  constructor(opts: CrateFxOptions = {}) {
    this.loadOverride = opts.loadImage;
  }

  async mount(host: HTMLElement, firstTier: ChestTier = 'standard'): Promise<boolean> {
    if (this.destroyed) return false;
    try {
      // Same DPR cap as the gameplay overlay, times the stage scale: `resizeTo: host` sizes the renderer in LAYOUT px.
      if (!pixiAllowed()) return false; // phone diagnostics `nofx`: no canvas
      // The first chest's pictures load and decode while the renderer starts (usually already cached by the click).
      const firstArt = firstTier === 'standard' ? null : preloadChestArt(firstTier, this.loadOverride);
      const res = Math.min(window.devicePixelRatio || 1, 2) * stageScale();
      const app = new Application();
      await app.init(phonePixiOptions({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: PIXI_ANTIALIAS,
        autoDensity: true,
        resolution: res,
        preference: 'webgl',
        powerPreference: 'high-performance',
      }, stageScale())); // phone policy (phoneDiag.ts)
      detachPixiDomEvents(app); // no Pixi DOM events: see pixiNoDomEvents.ts
      followStage(app); // phones: the renderer follows the stage's box + page scale (pixiStageFollow.ts)
      guardAppRender(app, 'crateFx');
      watchContextLoss(app, 'crateFx');
      if (this.destroyed) {
        destroyPixiApp(app); // never releases Pixi's shared global pools (pixiAppSafety.ts)
        return false;
      }
      const { tex, first } = await this.bake(firstArt);
      if (this.destroyed) {
        for (const t of this.textures) t.destroy(true);
        this.textures = [];
        destroyPixiApp(app); // never releases Pixi's shared global pools (pixiAppSafety.ts)
        return false;
      }
      const canvas = app.canvas;
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.display = 'block';
      host.appendChild(canvas);
      const root = new Container();
      app.stage.addChild(root);
      this.app = app;
      const sys = (app.renderer as unknown as { texture?: { initSource?: (s: TextureSource) => unknown } }).texture;
      this.upload = sys && typeof sys.initSource === 'function' ? (s) => { sys.initSource!(s); } : null;
      const scene = new CrateScene(root, tex, { onPulse: (k) => this.pulseFn?.(k) });
      const [w, h, k] = this.pendingSize ?? [host.clientWidth, host.clientHeight, 1];
      scene.layout(w, h, k);
      // The first tier's chest, if its art made the race, goes in before anything is drawn (and is cached for setChest).
      if (first && firstTier !== 'standard') {
        const model = this.buildChest(firstTier, first);
        if (model) {
          this.tierChests.set(firstTier, Promise.resolve(model));
          if (!this.artUrl) { this.drawn = firstTier; scene.setChestModel(model); }
        }
      }
      const replayed = this.attach(scene, tex.chest);
      if (this.artUrl) this.loadArt(this.artUrl);
      app.ticker.add(this.tick);
      app.ticker.stop();
      app.render(); // paint the first frame once; the ticker wakes on the first beat (or the beat replayed above)
      if (replayed) this.wake();
      return true;
    } catch (e) {
      console.error('[crateFx] pixi init failed; the crate opening falls back to the DOM crate:', e);
      return false;
    }
  }

  /**
   * Build every texture once. The chest is the owner's two layers (`collection/crate_body.webp` + `crate_lid.webp`,
   * with the keyhole's light mask cut from the body); if EITHER cannot load, the painted chest stands in whole. The first
   * tier's pictures (`firstArt`) are raced alongside, up to `CHEST_ART_WAIT_MS`: `first` is them, or null when late.
   */
  private async bake(firstArt: Promise<ChestArtImages | null> | null): Promise<{ tex: CrateSceneTextures; first: ChestArtImages | null }> {
    const keep = (t: Texture): Texture => { this.textures.push(t); return t; };
    const [imgs, first] = await Promise.all([
      preloadChestArt('standard', this.loadOverride),
      firstArt ? within(firstArt, CHEST_ART_WAIT_MS) : Promise.resolve(null),
    ]);
    let chest: ChestModel;
    if (imgs) {
      chest = artChestModel(keep(fromImage(imgs.body)), keep(fromImage(imgs.lid)), imgs.mask ? keep(fromCanvas(imgs.mask)) : null);
    } else {
      console.warn('[crateFx] chest art did not load; painting the fallback chest');
      chest = paintedChestModel(keep(fromCanvas(paintChestBody(CHEST_TEX_W))), keep(fromCanvas(paintChestLid(CHEST_TEX_W))), CHEST_TEX_W, CHEST_TEX_W * 0.02, CHEST);
    }
    const tex: CrateSceneTextures = {
      chest,
      seamBar: keep(fromCanvas(paintSeamBar(512))),
      pedestal: keep(fromCanvas(paintPedestal(900))),
      runeRing: keep(fromCanvas(paintRuneRing(900))),
      rays: keep(fromCanvas(paintRays(1024, 22))),
      glow: keep(fromCanvas(paintGlow(256))),
      spark: keep(fromCanvas(paintSpark(64))),
      streak: keep(fromCanvas(paintStreak(96))),
      ring: keep(fromCanvas(paintRing(512))),
      coin: keep(fromCanvas(paintCoin(64))),
      shards: paintShards(90, 6).map((c) => keep(fromCanvas(c))),
      // the chest tier layer's (small; a Standard opening never draws them)
      wisp: keep(fromCanvas(paintWisp(128))),
      band: keep(fromCanvas(paintBand(256))),
      aura: keep(fromCanvas(paintAura(256))),
    };
    return { tex, first };
  }

  /**
   * The scene is up: hand it the tuning and the tier layer, then replay the beat asked before it existed. Returns
   * whether a beat was replayed (the ticker must wake).
   */
  private attach(scene: CrateScene, standard: ChestModel): boolean {
    this.scene = scene;
    this.standardChest = standard;
    if (this.tuning) scene.setTuning(this.tuning);
    if (this.tierLayer !== NO_TIER_LAYER) scene.setTierLayer(this.tierLayer);
    const b = this.pendingBeat;
    this.pendingBeat = null;
    if (!b) return false;
    if (b.kind === 'anticipate') scene.anticipate(b.a, b.elapsed + (now() - b.at) * this.speed);
    else scene.skipToSettled(b.p);
    return true;
  }

  /** A tier's pictures as a chest model: textures made once, uploaded to the GPU before anyone draws them. */
  private buildChest(tier: LayeredTier, imgs: ChestArtImages): ChestModel | null {
    try {
      const keep = (t: Texture): Texture => { this.textures.push(t); return t; };
      const model = artChestModel(keep(fromImage(imgs.body)), keep(fromImage(imgs.lid)), imgs.mask ? keep(fromCanvas(imgs.mask)) : null, chestArtFor(tier));
      const up = this.upload;
      if (up) for (const t of [model.body, model.lid, model.keyhole]) if (t) up(t.source);
      return model;
    } catch (e) {
      console.warn(`[crateFx] the ${tier} chest could not be built; that opening uses the Standard chest`, e);
      return null;
    }
  }

  /** A tier's chest, made into a model once per controller (its pictures are the page's, `chestArt.ts`). */
  private tierChest(tier: LayeredTier): Promise<ChestModel | null> {
    let p = this.tierChests.get(tier);
    if (!p) {
      p = preloadChestArt(tier, this.loadOverride).then((imgs) => (imgs && !this.destroyed ? this.buildChest(tier, imgs) : null));
      this.tierChests.set(tier, p);
      const mine = p;
      void mine.then((m) => { if (!m && this.tierChests.get(tier) === mine) this.tierChests.delete(tier); });
    }
    return p;
  }

  async setChest(tier: ChestTier): Promise<ChestTier> {
    const token = ++this.chestToken;
    if (this.destroyed || !this.scene || !this.standardChest) return 'standard';
    // The one-picture override wins over every tier: nothing to load, and the tier's layer still plays round it.
    if (this.artUrl) return tier;
    // Standard is at hand: swapped at once. (The theatre asks at the click, before the scene resets, so the last
    // opening's 'settled' may still show: only the LATE tier swap below checks the burst.)
    if (tier === 'standard') { this.showChest('standard', this.standardChest); return 'standard'; }
    const model = await within(this.tierChest(tier), CHEST_ART_WAIT_MS);
    if (this.destroyed || !this.scene || !this.standardChest) return 'standard';
    if (token !== this.chestToken) return this.drawn; // a later call owns the chest now
    // The burst has started: this opening keeps the chest it is bursting (the art stays cached for the next one).
    if (BURST_ON.includes(this.scene.currentPhase)) return this.drawn;
    // Too slow or failed: this opening plays on Standard (a slow load still lands in the cache for the next one).
    if (!model) { this.showChest('standard', this.standardChest); return 'standard'; }
    this.showChest(tier, model);
    return tier;
  }

  private showChest(tier: ChestTier, model: ChestModel): void {
    this.drawn = tier;
    this.scene?.setChestModel(model);
    if (this.app && !this.app.ticker.started) this.app.render();
  }

  setTierLayer(t: ChestTierPreset): void {
    this.tierLayer = t;
    this.scene?.setTierLayer(t);
  }

  /**
   * Tests only (jsdom has no WebGL): attach a headless scene as the mount would, with `standard` as the baked chest
   * (the tuning, the tier layer and any beat asked before it are handed over). `upload` stands in for the GPU.
   */
  attachSceneForTests(scene: CrateScene, standard: ChestModel, opts: { upload?: (src: TextureSource) => void } = {}): void {
    this.upload = opts.upload ?? null;
    this.attach(scene, standard);
  }

  private tick = (): void => {
    const app = this.app;
    const scene = this.scene;
    if (!app || !scene) return;
    const busy = scene.update(app.ticker.deltaMS * this.speed);
    if (!busy) app.ticker.stop();
  };

  private wake(): void {
    if (this.app && !this.destroyed) this.app.ticker.start();
  }

  resize(w: number, h: number, crateScale: number): void {
    this.pendingSize = [w, h, crateScale];
    if (!this.scene || !this.app) return;
    this.scene.layout(w, h, crateScale);
    if (!this.app.ticker.started) this.app.render();
  }

  setSpeed(speed: number): void { this.speed = Math.max(0.05, speed || 1); }
  tune(t: ChestTuning): void {
    this.tuning = t;
    this.scene?.setTuning(t);
    if (this.app && !this.app.ticker.started) this.app.render();
  }
  chestKind(): 'art' | 'painted' | null { return this.scene?.chestKind ?? null; }
  onPulse(fn: ((k: number) => void) | null): void { this.pulseFn = fn; }

  setArt(url: string): void {
    if (url === this.artUrl) return;
    this.artUrl = url;
    if (this.scene) this.loadArt(url);
  }

  private loadArt(url: string): void {
    const token = ++this.artToken;
    if (!url) { this.scene?.setCrateArt(null); return; }
    void Assets.load<Texture>(url).then((t) => {
      if (this.destroyed || token !== this.artToken) return;
      this.scene?.setCrateArt(t);
      if (this.app && !this.app.ticker.started) this.app.render();
    }).catch(() => { /* a bad URL keeps the painted chest */ });
  }

  reset(): void {
    this.pendingBeat = null;
    this.scene?.reset();
    if (this.app && !this.app.ticker.started) this.app.render();
  }
  anticipate(a: CrateAnticipation, elapsedMs = 0): void {
    if (!this.scene) { this.pendingBeat = { kind: 'anticipate', a, elapsed: Math.max(0, elapsedMs), at: now() }; return; }
    this.scene.anticipate(a, elapsedMs);
    this.wake();
  }
  // A later beat before the mount means the opening has moved past the anticipation: nothing waits to replay.
  charge(p: CratePreset): void { if (!this.scene) { this.pendingBeat = null; return; } this.scene.charge(p); this.wake(); }
  burst(p: CratePreset): void { if (!this.scene) { this.pendingBeat = null; return; } this.scene.burst(p); this.wake(); }
  reveal(p: CratePreset): void { if (!this.scene) { this.pendingBeat = null; return; } this.scene.reveal(p); this.wake(); }
  settle(ms: number): void { if (!this.scene) { this.pendingBeat = null; return; } this.scene.settle(ms); this.wake(); }
  skipToSettled(p: CratePreset): void {
    if (!this.scene) { this.pendingBeat = { kind: 'settled', p }; return; }
    this.scene.skipToSettled(p);
    this.wake();
  }
  windDown(ms: number): void { if (!this.scene) { this.pendingBeat = null; return; } this.scene.windDown(ms); this.wake(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.artToken++;
    this.chestToken++;
    this.tierChests.clear();
    this.standardChest = null;
    this.pulseFn = null;
    this.pendingBeat = null;
    this.upload = null;
    const app = this.app;
    this.scene?.destroy();
    this.scene = null;
    if (!app) return; // pre-init: mount()'s "still wanted?" checks destroy the late Application
    app.ticker.remove(this.tick);
    app.ticker.stop();
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    destroyPixiApp(app); // never releases Pixi's shared global pools (pixiAppSafety.ts)
    this.app = null;
  }
}

let factory: () => CrateFx = () => new CrateFxPixi();

/** One controller per theatre, destroyed on unmount. */
export function createCrateFx(): CrateFx { return factory(); }

/** Tests (jsdom has no WebGL): swap in a recorder. Pass null to restore the Pixi controller. */
export function setCrateFxFactoryForTests(f: (() => CrateFx) | null): void {
  factory = f ?? (() => new CrateFxPixi());
}
