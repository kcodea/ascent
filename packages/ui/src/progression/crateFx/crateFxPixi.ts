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
 */
import { Application, Assets, CanvasSource, Container, ImageSource, Texture } from 'pixi.js';
import { stageScale } from '../../stage';
import type { CratePreset } from './crateFxConfig';
import { CrateScene, type ChestTuning, type CrateAnticipation, type CrateSceneTextures } from './crateScene';
import { CHEST_ART, artChestModel, loadChestImages, paintedChestModel, type ChestModel } from './chestModel';
import { detachPixiDomEvents } from '../../pixiNoDomEvents';
import {
  CHEST, cutKeyholeMask, paintChestBody, paintChestLid, paintCoin, paintGlow, paintPedestal, paintRays, paintRing,
  paintRuneRing, paintSeamBar, paintShards, paintSpark, paintStreak,
} from './crateTextures';

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

class CrateFxPixi implements CrateFx {
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

  async mount(host: HTMLElement): Promise<boolean> {
    if (this.destroyed) return false;
    try {
      // Same DPR cap as the gameplay overlay, times the stage scale: `resizeTo: host` sizes the renderer in LAYOUT px.
      const res = Math.min(window.devicePixelRatio || 1, 2) * stageScale();
      const app = new Application();
      await app.init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: res,
        preference: 'webgl',
        powerPreference: 'high-performance',
      });
      detachPixiDomEvents(app); // no Pixi DOM events: see pixiNoDomEvents.ts
      if (this.destroyed) {
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
        return false;
      }
      const tex = await this.bake();
      if (this.destroyed) {
        for (const t of this.textures) t.destroy(true);
        this.textures = [];
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
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
      if (this.tuning) this.scene.setTuning(this.tuning);
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
    };
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
    this.pulseFn = null;
    const app = this.app;
    this.scene?.destroy();
    this.scene = null;
    if (!app) return; // pre-init: mount()'s "still wanted?" checks destroy the late Application
    app.ticker.remove(this.tick);
    app.ticker.stop();
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
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
