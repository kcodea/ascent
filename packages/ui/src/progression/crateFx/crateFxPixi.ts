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
 * as: its two webps load on first use and are cached for the controller's life (Standard is the art baked at mount).
 * An opening never waits on them: if a tier's art fails, or is not ready within `CHEST_ART_WAIT_MS`, that opening
 * plays on the Standard chest and `setChest` says so (it resolves with the tier actually drawn), so the theatre gives
 * the opening the matching layer. The one-picture override (`setArt`) wins over every tier. `setTierLayer` hands the
 * scene the tier's effects layer (`CrateScene.setTierLayer`).
 */
import { Application, Assets, CanvasSource, Container, ImageSource, Texture } from 'pixi.js';
import { stageScale } from '../../stage';
import type { CratePreset } from './crateFxConfig';
import { CrateScene, type ChestTuning, type CrateAnticipation, type CrateSceneTextures } from './crateScene';
import { CHEST_ART, CHEST_TIER_ART, artChestModel, loadChestImages, paintedChestModel, type ChestModel } from './chestModel';
import { NO_TIER_LAYER, type ChestTier, type ChestTierPreset, type LayeredTier } from './chestTiers';
import { detachPixiDomEvents } from '../../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from '../../pixiAppSafety';
import {
  CHEST, cutKeyholeMask, paintAura, paintBand, paintChestBody, paintChestLid, paintCoin, paintGlow, paintPedestal,
  paintRays, paintRing, paintRuneRing, paintSeamBar, paintShards, paintSpark, paintStreak, paintWisp,
} from './crateTextures';
import { PIXI_ANTIALIAS } from '../../phoneArt';
import { phonePixiOptions, pixiAllowed } from '../../phoneDiag';

export interface CrateFx {
  /** Start Pixi in `host`. Resolves true when it is live, false when it is not (DOM fallback). */
  mount(host: HTMLElement): Promise<boolean>;
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
   * within `CHEST_ART_WAIT_MS`, before mount, or after destroy. Never rejects.
   */
  setChest(tier: ChestTier): Promise<ChestTier>;
  /** The chest tier's effects layer (`NO_TIER_LAYER` = none). Call before `anticipate`. */
  setTierLayer(t: ChestTierPreset): void;
  reset(): void;
  anticipate(a: CrateAnticipation): void;
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

export interface CrateFxOptions {
  /** Loads one picture (tests inject a failing or hanging one). Default: an `<img>`. */
  loadImage?: (url: string) => Promise<HTMLImageElement>;
}

const fromCanvas = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });
const fromImage = (img: HTMLImageElement): Texture => new Texture({ source: new ImageSource({ resource: img }) });

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`could not load ${url}`));
    im.src = url;
  });
}

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
  private readonly load: (url: string) => Promise<HTMLImageElement>;
  /** The chest baked at mount (the owner's Standard art, or the painted fallback). */
  private standardChest: ChestModel | null = null;
  /** Each tier's chest, loading or loaded (a failed load is dropped, so a later opening tries again). */
  private tierChests = new Map<LayeredTier, Promise<ChestModel | null>>();
  private chestToken = 0;
  private drawn: ChestTier = 'standard';
  private tierLayer: ChestTierPreset = NO_TIER_LAYER;

  constructor(opts: CrateFxOptions = {}) {
    this.load = opts.loadImage ?? loadImage;
  }

  async mount(host: HTMLElement): Promise<boolean> {
    if (this.destroyed) return false;
    try {
      // Same DPR cap as the gameplay overlay, times the stage scale: `resizeTo: host` sizes the renderer in LAYOUT px.
      if (!pixiAllowed()) return false; // phone diagnostics `nofx`: no canvas
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
      guardAppRender(app, 'crateFx');
      watchContextLoss(app, 'crateFx');
      if (this.destroyed) {
        destroyPixiApp(app); // never releases Pixi's shared global pools (pixiAppSafety.ts)
        return false;
      }
      const tex = await this.bake();
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
      this.scene = new CrateScene(root, tex, { onPulse: (k) => this.pulseFn?.(k) });
      this.standardChest = tex.chest;
      if (this.tuning) this.scene.setTuning(this.tuning);
      if (this.tierLayer !== NO_TIER_LAYER) this.scene.setTierLayer(this.tierLayer);
      this.app = app;
      const [w, h, k] = this.pendingSize ?? [host.clientWidth, host.clientHeight, 1];
      this.scene.layout(w, h, k);
      if (this.artUrl) this.loadArt(this.artUrl);
      app.ticker.add(this.tick);
      app.ticker.stop();
      app.render(); // paint the sealed chest once; the ticker wakes on the first beat
      return true;
    } catch (e) {
      console.error('[crateFx] pixi init failed; the crate opening falls back to the DOM crate:', e);
      return false;
    }
  }

  /**
   * Build every texture once. The chest is the owner's two layers (`collection/crate_body.webp` + `crate_lid.webp`,
   * with the keyhole's light mask cut from the body); if EITHER cannot load, the painted chest stands in whole.
   */
  private async bake(): Promise<CrateSceneTextures> {
    const keep = (t: Texture): Texture => { this.textures.push(t); return t; };
    const imgs = await loadChestImages(import.meta.env.BASE_URL, loadImage);
    let chest: ChestModel;
    if (imgs) {
      const mask = cutKeyholeMask(imgs.body, CHEST_ART.bodySrcW, CHEST_ART.keyhole);
      chest = artChestModel(keep(fromImage(imgs.body)), keep(fromImage(imgs.lid)), mask ? keep(fromCanvas(mask)) : null);
    } else {
      console.warn('[crateFx] chest art did not load; painting the fallback chest');
      chest = paintedChestModel(keep(fromCanvas(paintChestBody(CHEST_TEX_W))), keep(fromCanvas(paintChestLid(CHEST_TEX_W))), CHEST_TEX_W, CHEST_TEX_W * 0.02, CHEST);
    }
    return {
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
  }

  /** A tier's chest: its two webps and keyhole mask, made into a model once per controller. */
  private tierChest(tier: LayeredTier): Promise<ChestModel | null> {
    let p = this.tierChests.get(tier);
    if (!p) {
      p = this.loadTierChest(tier);
      this.tierChests.set(tier, p);
      void p.then((m) => { if (!m && this.tierChests.get(tier) === p) this.tierChests.delete(tier); });
    }
    return p;
  }

  private async loadTierChest(tier: LayeredTier): Promise<ChestModel | null> {
    const art = CHEST_TIER_ART[tier];
    const imgs = await loadChestImages(import.meta.env.BASE_URL, this.load, art);
    if (!imgs || this.destroyed) return null;
    try {
      const keep = (t: Texture): Texture => { this.textures.push(t); return t; };
      const mask = cutKeyholeMask(imgs.body, art.bodySrcW, art.keyhole);
      return artChestModel(keep(fromImage(imgs.body)), keep(fromImage(imgs.lid)), mask ? keep(fromCanvas(mask)) : null, art);
    } catch (e) {
      console.warn(`[crateFx] the ${tier} chest could not be built; that opening uses the Standard chest`, e);
      return null;
    }
  }

  async setChest(tier: ChestTier): Promise<ChestTier> {
    const token = ++this.chestToken;
    if (this.destroyed || !this.scene || !this.standardChest) return 'standard';
    // The one-picture override wins over every tier: nothing to load, and the tier's layer still plays round it.
    if (this.artUrl) return tier;
    if (tier === 'standard') { this.showChest('standard', this.standardChest); return 'standard'; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((res) => { timer = setTimeout(() => res(null), CHEST_ART_WAIT_MS); });
    const model = await Promise.race([this.tierChest(tier), late]);
    clearTimeout(timer);
    if (this.destroyed || !this.scene || !this.standardChest) return 'standard';
    if (token !== this.chestToken) return this.drawn; // a later call owns the chest now
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

  /** Tests only (jsdom has no WebGL): drive a headless scene as if it were mounted, with `standard` as the baked chest. */
  attachSceneForTests(scene: CrateScene, standard: ChestModel): void {
    this.scene = scene;
    this.standardChest = standard;
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

  reset(): void { this.scene?.reset(); if (this.app && !this.app.ticker.started) this.app.render(); }
  anticipate(a: CrateAnticipation): void { this.scene?.anticipate(a); this.wake(); }
  charge(p: CratePreset): void { this.scene?.charge(p); this.wake(); }
  burst(p: CratePreset): void { this.scene?.burst(p); this.wake(); }
  reveal(p: CratePreset): void { this.scene?.reveal(p); this.wake(); }
  settle(ms: number): void { this.scene?.settle(ms); this.wake(); }
  skipToSettled(p: CratePreset): void { this.scene?.skipToSettled(p); this.wake(); }
  windDown(ms: number): void { this.scene?.windDown(ms); this.wake(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.artToken++;
    this.chestToken++;
    this.tierChests.clear();
    this.standardChest = null;
    this.pulseFn = null;
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
