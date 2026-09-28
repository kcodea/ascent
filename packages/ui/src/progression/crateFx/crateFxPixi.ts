/**
 * THE CRATE FX CONTROLLER: owns its OWN Pixi `Application` (a transparent, pointer-events:none canvas inside the
 * crate theatre), never the gameplay `pixiFx` singleton, which is not mounted on the menus anyway. The drawing
 * lives in `CrateScene` (headless-testable); this file is only the renderer, the ticker and the art loader.
 *
 * The hero ceremony's contract (`HeroCeremonyPixi.ts`):
 *  - `mount` resolves false (and every call becomes a no-op) if Pixi cannot start: the theatre then draws its
 *    DOM crate and the opening still works, just without particles.
 *  - `destroy()` is safe at any moment, including before the async init resolves (the late Application is
 *    destroyed on arrival). It removes the canvas and destroys every sprite, texture and the renderer.
 *  - The ticker runs only while the scene has work, and stops the frame it goes idle.
 *  - Geometry comes from `resize()` (mount + a ResizeObserver), never a per-frame DOM read.
 *  - The renderer's resolution folds in the stage scale (`stageScale()`), so a phone never renders ~8x the pixels
 *    it shows (the stage tripwire enforces this).
 */
import { Application, Assets, CanvasSource, Container, Graphics, Texture } from 'pixi.js';
import { stageScale } from '../../stage';
import type { CratePreset } from './crateFxConfig';
import { CrateScene, GLOW_TEX_R, RAY_TEX_LEN, RING_TEX_R, type CrateAnticipation, type CrateSceneTextures } from './crateScene';

export interface CrateFx {
  /** Start Pixi in `host`. Resolves true when it is live, false when it is not (DOM fallback). */
  mount(host: HTMLElement): Promise<boolean>;
  /** The host's size changed (layout px). */
  resize(w: number, h: number, crateScale: number): void;
  /** Playback speed (the tuner's slow motion). Scales the scene clock. */
  setSpeed(speed: number): void;
  /** The one art key: a URL for the crate picture ('' = the drawn crate). */
  setArt(url: string): void;
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

class CrateFxPixi implements CrateFx {
  private app: Application | null = null;
  private scene: CrateScene | null = null;
  private textures: Texture[] = [];
  private destroyed = false;
  private speed = 1;
  private artUrl = '';
  private artToken = 0;
  private pendingSize: [number, number, number] | null = null;

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
      if (this.destroyed) {
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
        return false;
      }
      const canvas = app.canvas;
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.display = 'block';
      host.appendChild(canvas);
      const tex: CrateSceneTextures = {
        spark: makeSpark(app), glow: makeGlow(app), ring: makeRing(app), frag: makeFrag(app), ray: makeRay(app),
      };
      this.textures = Object.values(tex);
      const root = new Container();
      app.stage.addChild(root);
      this.scene = new CrateScene(root, tex);
      this.app = app;
      const [w, h, k] = this.pendingSize ?? [host.clientWidth, host.clientHeight, 1];
      this.scene.layout(w, h, k);
      if (this.artUrl) this.loadArt(this.artUrl);
      app.ticker.add(this.tick);
      app.ticker.stop();
      app.render(); // paint the sealed crate once; the ticker wakes on the first beat
      return true;
    } catch (e) {
      console.error('[crateFx] pixi init failed; the crate opening falls back to the DOM crate:', e);
      return false;
    }
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
    }).catch(() => { /* a bad URL keeps the drawn crate */ });
  }

  reset(): void { this.scene?.reset(); if (this.app && !this.app.ticker.started) this.app.render(); }
  anticipate(a: CrateAnticipation): void { this.scene?.anticipate(a); this.wake(); }
  charge(p: CratePreset): void { this.scene?.charge(p); this.wake(); }
  burst(p: CratePreset): void { this.scene?.burst(p); this.wake(); }
  reveal(p: CratePreset): void { this.scene?.reveal(p); this.wake(); }
  settle(ms: number): void { this.scene?.settle(ms); this.wake(); }
  skipToSettled(p: CratePreset): void { this.scene?.skipToSettled(p); this.app?.render(); }
  windDown(ms: number): void { this.scene?.windDown(ms); this.wake(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.artToken++;
    const app = this.app;
    this.scene?.destroy();
    this.scene = null;
    if (!app) return; // pre-init: mount()'s "still wanted?" check destroys the late Application
    app.ticker.remove(this.tick);
    app.ticker.stop();
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    this.app = null;
  }
}

// ─── textures (built once per mount) ────────────────────────────────────────────────────────────────────────

function bake(app: Application, g: Graphics): Texture {
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}
function makeSpark(app: Application): Texture {
  const g = new Graphics();
  for (let r = 8; r >= 1; r--) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.2 });
  return bake(app, g);
}
/** The big soft glow (aura, flash, crate glow). A canvas radial gradient rather than stacked circles: scaled up
 *  ten times for the aura, stacked translucent circles show visible bands. */
function makeGlow(app: Application): Texture {
  const size = GLOW_TEX_R * 2 * 4; // drawn at 4x so the upscaled aura stays smooth
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) {
    const g = new Graphics();
    for (let r = GLOW_TEX_R; r >= 2; r -= 2) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.05 });
    return bake(app, g);
  }
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // The scene sizes sprites against a GLOW_TEX_R-radius texture; this one is drawn at 4x, so it reports 1x.
  return new Texture({ source: new CanvasSource({ resource: c, resolution: 4 }) });
}
function makeRing(app: Application): Texture {
  const g = new Graphics();
  g.circle(0, 0, RING_TEX_R).stroke({ width: 10, color: 0xffffff, alpha: 0.14 });
  g.circle(0, 0, RING_TEX_R).stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
  return bake(app, g);
}
function makeFrag(app: Application): Texture {
  const g = new Graphics();
  g.rect(-7, -3, 14, 6).fill({ color: 0xffffff, alpha: 0.95 });
  g.rect(-7, -3, 14, 1.5).fill({ color: 0xffffff, alpha: 1 });
  return bake(app, g);
}
/** A soft wedge: narrow at its base (the reward), widening and fading out to its tip. */
function makeRay(app: Application): Texture {
  const g = new Graphics();
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const y0 = -(i / steps) * RAY_TEX_LEN;
    const y1 = -((i + 1) / steps) * RAY_TEX_LEN;
    const w0 = 2 + (i / steps) * 22;
    const w1 = 2 + ((i + 1) / steps) * 22;
    g.poly([-w0 / 2, y0, w0 / 2, y0, w1 / 2, y1, -w1 / 2, y1]).fill({ color: 0xffffff, alpha: 0.22 * (1 - i / steps) });
  }
  return bake(app, g);
}

let factory: () => CrateFx = () => new CrateFxPixi();

/** One controller per theatre, destroyed on unmount. */
export function createCrateFx(): CrateFx { return factory(); }

/** Tests (jsdom has no WebGL): swap in a recorder. Pass null to restore the Pixi controller. */
export function setCrateFxFactoryForTests(f: (() => CrateFx) | null): void {
  factory = f ?? (() => new CrateFxPixi());
}
