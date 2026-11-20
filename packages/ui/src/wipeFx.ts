/**
 * WIPE FX — the dedicated ABOVE-CURTAIN Pixi layer (owner ask 2026-08-29: "make the wipe feel more magical
 * and ethereal"). The game's main FX canvas sits at z110, deliberately UNDER the curtain (z3000) so the blue
 * swallows scene FX — which means anything that should ride ON the curtain's seam needs its own canvas.
 * This is that canvas: a tiny second Pixi Application (z3005 while the combat curtain is up, z255 for the Ancients), mounted once, ticking ONLY while a wipe
 * effect is alive (visibility:hidden + stopped ticker otherwise, so it costs nothing between combats).
 *
 * Four one-shot effects, all driven by the same origin/radius/duration Recruit hands the curtain, so they
 * track the clip seam exactly (the seam is the ellipse `(rx, ry) * ease(t)` with the curtain's own cubic-bezier
 * from the Screen wipe tuner, evaluated here numerically):
 *  - charge():  the gem's anticipation tell — motes spiral INTO the gem + a swelling flare, played during
 *               the pre-bloom beat (`chargeIn` / the stretched `primeOut`).
 *  - bloom():   stardust wake + tangential wisps emitted along the expanding seam.
 *  - inhale():  motes streaming INTO the gem from across the scene — played with the EXIT bloom, selling
 *               "the gem drinks the combat scene".
 * Everything is additive-blended pale blue/white (the curtain's palette) with a little gold. Each effect takes an
 * optional `palette` (the Ancients gate plays the same three in its own violet/gold/teal, 2026-09-25). Worst case is
 * a few hundred pooled-texture sprites for under a second — a one-shot, not a loop (see CLAUDE.md perf
 * rules; nothing here runs outside the wipe).
 */
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { cubicBezier } from './wipeGeometry';
import { stageHost } from './stage';
import { detachPixiDomEvents } from './pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from './pixiAppSafety';
import { crumb } from './crashLog';
import { PIXI_ANTIALIAS } from './phoneArt';
import { phonePixiOptions, pixiAllowed } from './phoneDiag';
import { followStage } from './pixiStageFollow';

const PALETTE = [0x9fc0f5, 0xcfe0ff, 0xffffff, 0xbcd4ff] as const;

interface Particle {
  sp: Sprite;
  age: number;
  life: number;
  update: (p: Particle, dt: number) => void;
}
interface Emitter {
  age: number;
  dur: number;
  update: (e: Emitter, dt: number) => void;
}

class WipeFxController {
  private app: Application | null = null;
  private initing: Promise<void> | null = null;
  private layer: Container | null = null;
  private particles: Particle[] = [];
  private emitters: Emitter[] = [];
  private pending: Array<() => void> = [];
  private dotTex: Texture | null = null;
  private sparkTex: Texture | null = null;

  /** Kick the async Pixi init early (Recruit calls this on mount) so the very first wipe's FX are ready. */
  warm(): void {
    if (this.app || this.initing || !pixiAllowed()) return; // phone `nofx` switch: no canvas, the wipe plays bare
    this.initing = this.init().catch((e) => {
      console.error('[wipeFx] init failed — wipe FX disabled:', e);
    });
  }

  private async init(): Promise<void> {
    const app = new Application();
    await app.init(phonePixiOptions({
      resizeTo: window, backgroundAlpha: 0, antialias: PIXI_ANTIALIAS, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
    })); // phone: low power, no depth buffer, `res1` switch (phoneDiag.ts); desktop unchanged
    detachPixiDomEvents(app); // no Pixi DOM events: see pixiNoDomEvents.ts
    followStage(app); // phones: the renderer follows the stage's box + page scale (pixiStageFollow.ts)
    guardAppRender(app, 'wipeFx');
    watchContextLoss(app, 'wipeFx', () => this.recover()); // a loss empties its textures: rebuild on next use (R-PHONE-FX-CTX-01)
    crumb('pixi init wipe');
    const c = app.canvas;
    c.className = 'wipefx-canvas pixi-screen';
    c.style.visibility = 'hidden';
    stageHost().appendChild(c); // inside the stage so it scales with it (stage.ts)
    this.layer = new Container();
    app.stage.addChild(this.layer);

    // Soft glow dot: concentric alpha discs (additive blending melts them into a glow).
    const dot = new Graphics();
    for (const [r, a] of [[16, 0.08], [12, 0.13], [8, 0.22], [5, 0.4], [2.5, 0.85]] as const) {
      dot.circle(0, 0, r).fill({ color: 0xffffff, alpha: a });
    }
    this.dotTex = app.renderer.generateTexture(dot);
    const spark = new Graphics();
    spark.roundRect(-12, -1.5, 24, 3, 1.5).fill({ color: 0xffffff, alpha: 0.35 });
    spark.roundRect(-8, -0.8, 16, 1.6, 0.8).fill({ color: 0xffffff, alpha: 0.9 });
    this.sparkTex = app.renderer.generateTexture(spark);

    app.ticker.add(() => this.tick(app.ticker.deltaMS));
    app.ticker.stop();
    this.app = app;
    const queued = this.pending;
    this.pending = [];
    for (const fn of queued) fn();
  }

  /** Resolves once a `warm()` in flight has finished (immediately when none is). Never rejects. */
  ready(): Promise<void> {
    return this.initing ?? Promise.resolve();
  }

  /** Run `fn` now if the canvas is live, else queue it behind init (first-combat race). */
  private run(fn: () => void): void {
    this.warm();
    if (this.app) { fn(); this.start(); } else this.pending.push(fn);
  }

  private start(): void {
    if (!this.app) return;
    this.app.canvas.style.visibility = 'visible';
    if (!this.app.ticker.started) this.app.ticker.start();
  }

  private tick(dt: number): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]!;
      e.age += dt;
      e.update(e, dt);
      if (e.age >= e.dur) this.emitters.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        p.sp.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.update(p, dt);
    }
    if (!this.emitters.length && !this.particles.length && this.app) {
      this.app.ticker.stop();
      this.app.canvas.style.visibility = 'hidden';
    }
  }

  /**
   * Free the canvas and its WebGL context (R-TOUCH-GPU-MEMORY-01: a phone keeps no FX context on the menus;
   * PixiFxLayer calls this on the way back to them). Waits for an init in flight, and does nothing while a wipe is
   * still playing. The next `warm()` builds a fresh one.
   */
  release(): void {
    if (this.initing && !this.app) { const p = this.initing; void p.then(() => { if (this.app && this.initing === p) this.release(); }); return; }
    const app = this.app;
    if (!app || this.emitters.length || this.particles.length) return;
    this.app = null;
    this.initing = null;
    this.layer = null;
    this.dotTex = this.sparkTex = null;
    this.pending.length = 0;
    destroyPixiApp(app, { children: true, texture: true });
  }

  /** After a WebGL context loss (R-PHONE-FX-CTX-01): drop what is in flight and free the app, so the next wipe builds a
   *  fresh one (its generated textures came back empty with the restored context). */
  recover(): void {
    try { this.clear(); } catch { /* a lost context may refuse the clearing frame */ }
    this.release();
  }

  /** Kill everything instantly (a decisive combat snapping the wipe home). */
  clear(): void {
    this.emitters.length = 0;
    for (const p of this.particles) p.sp.destroy();
    this.particles.length = 0;
    if (this.app) {
      // Render the now-empty stage BEFORE hiding: a stopped ticker leaves the canvas holding its last frame, and
      // the next wipe's first visible frame would flash those stale motes (a one-frame flicker).
      this.app.render();
      this.app.ticker.stop();
      this.app.canvas.style.visibility = 'hidden';
    }
  }

  private spawn(tex: Texture, x: number, y: number, tint: number, life: number, update: Particle['update']): Sprite {
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    sp.position.set(x, y);
    sp.tint = tint;
    sp.blendMode = 'add';
    this.layer!.addChild(sp);
    this.particles.push({ sp, age: 0, life, update });
    return sp;
  }

  /** THE TELL — motes spiral into the gem while a flare swells on it: 'something is about to erupt'. */
  charge(cx: number, cy: number, ms: number, palette: readonly number[] = PALETTE): void {
    const pick = (): number => palette[(Math.random() * palette.length) | 0]!;
    this.run(() => {
      for (let i = 0; i < 34; i++) {
        const ang0 = Math.random() * Math.PI * 2;
        const r0 = 70 + Math.random() * 90;
        const angVel = (2.2 + Math.random() * 2.2) * (Math.random() < 0.5 ? 1 : -1) / 1000; // rad/ms
        const life = ms * (0.55 + Math.random() * 0.45);
        const scale = 0.14 + Math.random() * 0.2;
        this.spawn(this.dotTex!, cx + Math.cos(ang0) * r0, cy + Math.sin(ang0) * r0, pick(), life, (p) => {
          const t = p.age / p.life;
          const r = r0 * (1 - t * t); // accelerating fall into the gem
          const ang = ang0 + angVel * p.age;
          p.sp.position.set(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
          p.sp.alpha = Math.min(1, t * 4) * (1 - t * 0.6);
          p.sp.scale.set(scale * (1 - t * 0.5));
        });
      }
      const flare = this.spawn(this.dotTex!, cx, cy, 0xdce8ff, ms, (p) => {
        const t = p.age / p.life;
        p.sp.scale.set(0.4 + t * t * 2.6);
        p.sp.alpha = t < 0.7 ? t * 1.1 : (1 - t) * 2.6;
      });
      flare.scale.set(0.4);
      flare.alpha = 0;
    });
  }

  /** THE BLOOM WAKE — stardust + tangential wisps emitted along the expanding seam. (Runic flickers were
   *  cut — owner call 2026-08-29: their hard pops read as animation blips on the blue.) */
  bloom(cx: number, cy: number, rx: number, ry: number, ms: number, ease: readonly [number, number, number, number], palette: readonly number[] = PALETTE): void {
    const pick = (): number => palette[(Math.random() * palette.length) | 0]!;
    // The seam is the curtain's ellipse at `ease(t)`: the same cubic-bezier the CSS transition runs (from the
    // Screen wipe tuner), evaluated here so the motes ride the clip edge exactly.
    const seamEase = cubicBezier(ease[0], ease[1], ease[2], ease[3]);
    this.run(() => {
      const em: Emitter & { moteAcc: number } = {
        age: 0, dur: ms, moteAcc: 0,
        update: (e, dt) => {
          const self = e as typeof em;
          const k = seamEase(Math.min(1, e.age / ms));
          self.moteAcc += dt * 0.62; // ~280 motes over a 450ms sweep
          while (self.moteAcc >= 1) {
            self.moteAcc -= 1;
            const ang = Math.random() * Math.PI * 2;
            const px = cx + Math.cos(ang) * rx * k, py = cy + Math.sin(ang) * ry * k;
            if (px < -40 || py < -40 || px > window.innerWidth + 40 || py > window.innerHeight + 40) continue;
            const wisp = Math.random() < 0.4;
            const speed = wisp ? 0 : 30 + Math.random() * 110; // px/s outward
            const tang = wisp ? (60 + Math.random() * 120) * (Math.random() < 0.5 ? 1 : -1) : (Math.random() - 0.5) * 30;
            const vx = (Math.cos(ang) * speed - Math.sin(ang) * tang) / 1000;
            const vy = (Math.sin(ang) * speed + Math.cos(ang) * tang) / 1000;
            const life = 380 + Math.random() * 500;
            const scale = 0.1 + Math.random() * 0.22;
            const twf = 0.008 + Math.random() * 0.014, twp = Math.random() * Math.PI * 2;
            this.spawn(this.dotTex!, px, py, pick(), life, (p, d) => {
              p.sp.x += vx * d; p.sp.y += vy * d;
              const t = p.age / p.life;
              p.sp.alpha = (1 - t) * (0.7 + 0.3 * Math.sin(p.age * twf + twp));
              p.sp.scale.set(scale * (1 - t * 0.4));
            });
          }
        },
      };
      this.emitters.push(em);
    });
  }

  /** THE INHALE — motes from across the scene stream into the gem (played with the EXIT bloom: the gem
   *  drinking the combat scene back in). */
  inhale(cx: number, cy: number, R: number, ms: number, palette: readonly number[] = PALETTE): void {
    const pick = (): number => palette[(Math.random() * palette.length) | 0]!;
    this.run(() => {
      for (let i = 0; i < 120; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r0 = 140 + Math.random() * Math.max(160, R * 0.75);
        const delay = Math.random() * ms * 0.45;
        const life = delay + 260 + Math.random() * (ms * 0.5);
        const scale = 0.1 + Math.random() * 0.18;
        this.spawn(this.dotTex!, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, pick(), life, (p) => {
          if (p.age < delay) { p.sp.alpha = 0; return; }
          const t = (p.age - delay) / (p.life - delay);
          const r = r0 * (1 - t * t * t); // slow start, hard suck at the end
          p.sp.position.set(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
          p.sp.alpha = Math.min(1, t * 5) * (1 - t * 0.35);
          p.sp.scale.set(scale * (1 + t * 0.6));
        });
      }
      // A few sparks aligned to their travel direction, for streaky motion.
      for (let i = 0; i < 24; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r0 = 200 + Math.random() * Math.max(160, R * 0.7);
        const delay = Math.random() * ms * 0.4;
        const life = delay + 220 + Math.random() * (ms * 0.45);
        const sp = this.spawn(this.sparkTex!, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, 0xdce8ff, life, (p) => {
          if (p.age < delay) { p.sp.alpha = 0; return; }
          const t = (p.age - delay) / (p.life - delay);
          const r = r0 * (1 - t * t * t);
          p.sp.position.set(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
          p.sp.alpha = Math.min(1, t * 5) * (1 - t * 0.3);
        });
        sp.rotation = ang + Math.PI; // point along the inward travel
        sp.scale.set(0.7 + Math.random() * 0.5);
      }
    });
  }

  /** One hot spark: a streak thrown at `(vx, vy)` px/s that falls under gravity, pointing along its travel. */
  private streak(x: number, y: number, vx: number, vy: number, life: number, tint: number, scale: number): void {
    const u = window.innerHeight / 1080, grav = 1500 * u;
    let cvx = vx, cvy = vy;
    const sp = this.spawn(this.sparkTex!, x, y, tint, life, (p, d) => {
      const s = d / 1000;
      cvy += grav * s; cvx *= 0.985;
      p.sp.x += cvx * s; p.sp.y += cvy * s;
      p.sp.rotation = Math.atan2(cvy, cvx);
      p.sp.alpha = 1 - p.age / p.life;
    });
    sp.rotation = Math.atan2(vy, vx);
    sp.scale.set(scale * u);
  }

  /**
   * GRINDING SPARKS (the Ancients' panels, owner 2026-11-18: "almost grinding against eachother as their edges meet"):
   * for `ms`, sparks spit from wherever `at(age)` says the two edges are meeting (screen px; `null` = nothing this
   * frame), thrown sideways and back against the travel (`dirY`: -1 up, 1 down). `perSec` sets how many.
   */
  grind(at: (ageMs: number) => { x: number; y: number } | null, ms: number, perSec: number, dirY: number, palette: readonly number[] = PALETTE): void {
    if (perSec <= 0 || ms <= 0) return;
    const pick = (): number => palette[(Math.random() * palette.length) | 0]!;
    this.run(() => {
      const u = window.innerHeight / 1080;
      const em: Emitter & { acc: number } = {
        age: 0, dur: ms, acc: 0,
        update: (e, dt) => {
          const self = e as typeof em;
          const pt = at(e.age);
          if (!pt) return;
          self.acc += dt * perSec / 1000;
          while (self.acc >= 1) {
            self.acc -= 1;
            this.streak(pt.x, pt.y, (Math.random() * 2 - 1) * 320 * u, dirY * (100 + Math.random() * 600) * u, 180 + Math.random() * 240, pick(), 0.35 + Math.random() * 0.3);
          }
        },
      };
      this.emitters.push(em);
    });
  }

  /**
   * A SPRAY of sparks off a hit (the panels' thud on the far edge of the screen): `n` streaks from a `halfW`-wide line
   * centred on `(x, y)`, thrown within `spread` radians either side of `angle` (screen px, radians; -PI/2 is up).
   */
  spray(x: number, y: number, halfW: number, angle: number, spread: number, n: number, palette: readonly number[] = PALETTE): void {
    if (n <= 0) return;
    const pick = (): number => palette[(Math.random() * palette.length) | 0]!;
    this.run(() => {
      const u = window.innerHeight / 1080;
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() * 2 - 1) * spread, sp = (300 + Math.random() * 1000) * u;
        this.streak(x + (Math.random() * 2 - 1) * halfW, y, Math.cos(a) * sp, Math.sin(a) * sp, 300 + Math.random() * 450, pick(), 0.45 + Math.random() * 0.5);
      }
    });
  }
}

export const wipeFx = new WipeFxController();
