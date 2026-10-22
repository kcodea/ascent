/**
 * WIPE SMOKE — the sliding transition panel's art, warbling like magic smoke (owner 2026-10-21: "how can we have it
 * warbling and moving like magic smoke"). The panel itself (`.wipecurtain`) still only SLIDES in CSS; this is a small
 * Pixi canvas INSIDE it, so it travels with the slide and can never fall out of step with it.
 *
 * How it works: the art (`transition-vortex.webp`) is drawn through two DisplacementFilters, each fed a soft, seamless
 * greyscale noise image (`transition-smoke-noise.png`, generated). Mid-grey leaves a pixel where it is; lighter and
 * darker push it one way or the other. Each frame the two noise layers drift (and turn) at different speeds and
 * directions, so the bends roll across the art and the swirls churn instead of scrolling.
 *
 * Safety: the panel's CSS background is the same still art, underneath this canvas. The canvas is hidden until it has
 * drawn its first frame of a pass, so a slow start, a dropped frame or a failed init shows the still art, never the
 * game. Cost: one full-screen filter pass per frame at HALF resolution (smoke is soft; the browser scales it up), and
 * only while the curtain is up (`start` / `stop`); the ticker is stopped otherwise. Phones get no canvas at all (the
 * still art slides). The dials are the three constants below.
 */
import { Application, Assets, Container, DisplacementFilter, Sprite, type Texture } from 'pixi.js';
import { detachPixiDomEvents } from './pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from './pixiAppSafety';
import { PHONE_GPU } from './phoneDiag';

/** How fast the smoke drifts (1 = default). */
const SPEED = 1;
/** How far pixels bend, in screen px at full strength (gentle shimmer ~15, heavy churn ~60). */
const STRENGTH = 38;
/** How big the swirls are: the noise image's scale on screen (small wisps ~1, big billows ~3). */
const SWIRL = 2.2;
/** Render at this fraction of the screen's pixels. */
const RESOLUTION = 0.5;

const ART = `${import.meta.env.BASE_URL}transition-vortex.webp`;
const NOISE = `${import.meta.env.BASE_URL}transition-smoke-noise.png`;

class WipeSmokeController {
  private app: Application | null = null;
  private initing: Promise<void> | null = null;
  private host: HTMLElement | null = null;
  private art: Sprite | null = null;
  private n1: Sprite | null = null;
  private n2: Sprite | null = null;
  private t = 0;
  private wanted = false;
  private readonly onResize = (): void => this.layout();

  /** Hand the panel's smoke slot over (Recruit's ref), or null on unmount. Builds the canvas once. */
  attach(el: HTMLElement | null): void {
    this.host = el;
    if (!el) return;
    if (this.app) { el.appendChild(this.app.canvas); return; }
    if (this.initing || PHONE_GPU) return;
    this.initing = this.init().catch((e) => { console.error('[wipeSmoke] init failed — the panel slides still:', e); });
  }

  private async init(): Promise<void> {
    const app = new Application();
    await app.init({
      width: window.innerWidth, height: window.innerHeight, resolution: RESOLUTION, autoDensity: false,
      backgroundAlpha: 0, antialias: false, autoStart: false,
    });
    detachPixiDomEvents(app);
    guardAppRender(app, 'wipeSmoke');
    watchContextLoss(app, 'wipeSmoke');
    const [artTex, noiseTex] = await Promise.all([Assets.load<Texture>(ART), Assets.load<Texture>(NOISE)]);
    noiseTex.source.addressMode = 'repeat'; // the noise scrolls forever, wrapping seamlessly
    const stage = new Container();
    const n1 = new Sprite(noiseTex);
    const n2 = new Sprite(noiseTex);
    const art = new Sprite(artTex);
    art.filters = [
      new DisplacementFilter({ sprite: n1, scale: STRENGTH }),
      new DisplacementFilter({ sprite: n2, scale: STRENGTH * 0.6 }),
    ];
    stage.addChild(n1, n2, art); // the maps must sit in the scene so their transforms update (they never draw)
    app.stage.addChild(stage);
    const c = app.canvas;
    c.className = 'wipesmoke-canvas';
    c.style.visibility = 'hidden';
    app.ticker.add(() => this.tick(app.ticker.deltaMS));
    this.app = app;
    this.art = art;
    this.n1 = n1;
    this.n2 = n2;
    this.layout();
    window.addEventListener('resize', this.onResize);
    if (this.host) this.host.appendChild(c);
    if (this.wanted) this.start();
  }

  /** Size the renderer to the window and the art to COVER it, a little oversized so the bends never pull in an edge. */
  private layout(): void {
    const { app, art, n1, n2 } = this;
    if (!app || !art || !n1 || !n2) return;
    const w = window.innerWidth, h = window.innerHeight;
    app.renderer.resize(w, h);
    const s = Math.max(w / art.texture.width, h / art.texture.height) * 1.06;
    art.scale.set(s);
    art.anchor.set(0.5);
    art.position.set(w / 2, h / 2);
    const k = (SWIRL * h) / 1080;
    n1.scale.set(k);
    n2.scale.set(k * 0.6);
  }

  private tick(dt: number): void {
    const { n1, n2 } = this;
    if (!n1 || !n2) return;
    this.t += dt * SPEED;
    const t = this.t;
    // Two layers at different speeds and headings, one slowly turning: churn, not a scroll.
    n1.position.set(t * 0.03, t * 0.018);
    n1.rotation = Math.sin(t * 0.0004) * 0.25;
    n2.position.set(-t * 0.024, t * 0.031);
  }

  /** The curtain is up: draw one fresh frame, THEN show the canvas, then animate. */
  start(): void {
    this.wanted = true;
    const app = this.app;
    if (!app) return;
    this.tick(0);
    app.render();
    app.canvas.style.visibility = 'visible';
    if (!app.ticker.started) app.ticker.start();
  }

  /** The curtain is down: stop and hide (the next `start` redraws before it shows, so no stale frame). */
  stop(): void {
    this.wanted = false;
    const app = this.app;
    if (!app) return;
    app.ticker.stop();
    app.canvas.style.visibility = 'hidden';
  }

  /** Free the canvas and its WebGL context (the run's screen unmounted). The next `attach` builds a fresh one. */
  release(): void {
    this.host = null;
    this.wanted = false;
    if (this.initing && !this.app) { const p = this.initing; void p.then(() => { if (this.initing === p && !this.host) this.release(); }); return; }
    const app = this.app;
    if (!app) return;
    window.removeEventListener('resize', this.onResize);
    this.app = null;
    this.initing = null;
    this.art = this.n1 = this.n2 = null;
    destroyPixiApp(app, { children: true });
  }
}

export const wipeSmoke = new WipeSmokeController();
