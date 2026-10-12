/**
 * GATE FX — the smoke and sparks of the ranked gate (owner 2026-10-12: "slam shut with smoke and sparks that emit
 * from the impact"). A tiny Pixi layer of its own, the `wipeFx.ts` pattern: the gate covers every screen in the
 * game (z 700), far above the main FX canvas (z 110), so anything that rides ON the doors needs its own canvas.
 * It exists only around a gate: warmed as the ranked confirmation opens, ticking ONLY while a burst is alive, and
 * TORN DOWN (`release`, through `destroyPixiApp`: the bounded-context rule) once the gate has ended and its last
 * particle has faded. A gate plays once per ranked game, so it never holds a WebGL context between them.
 *
 * Two one-shots, both fed the gate's own SCREEN-space seam (measured once by the component, never per frame):
 *  - slam():    the impact. Hot sparks spray sideways off the whole seam and fall, a white-gold flash blooms on
 *               it, and stone dust rolls outward and up from the seam and along the floor.
 *  - shudder(): the rattle. Dust shakes loose from the top of the doors and a few sparks spit from the seam.
 * Sparks are additive streaks turned along their travel; dust is a soft normal-blended puff that grows as it
 * fades. Worst case is ~260 pooled-texture sprites for under two seconds: a one-shot, not a loop.
 */
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { stageHost } from '../stage';
import { detachPixiDomEvents } from '../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from '../pixiAppSafety';

/** The gate's centre seam, in screen px. */
export interface GateSeam { x: number; top: number; bottom: number }

const SPARK_TINTS = [0xffffff, 0xfff2c0, 0xffd27a, 0xffa84a, 0xff7a2e] as const;
const DUST_TINTS = [0x9a9388, 0x7d776d, 0xb3aa9a, 0x625c55, 0x8c8172] as const;
const pick = <T,>(a: readonly T[]): T => a[(Math.random() * a.length) | 0]!;

interface Particle {
  sp: Sprite;
  age: number;
  life: number;
  update: (p: Particle, dt: number) => void;
}

class GateFxController {
  private app: Application | null = null;
  private initing: Promise<void> | null = null;
  private layer: Container | null = null;
  private particles: Particle[] = [];
  private pending: Array<() => void> = [];
  private glowTex: Texture | null = null;
  private sparkTex: Texture | null = null;
  private puffTex: Texture | null = null;
  /** The gate has ended: tear the layer down as soon as nothing is left alive on it. */
  private releaseWhenIdle = false;

  /** Kick the async Pixi init early (the ranked confirmation calls this as it opens) so the first slam has FX. */
  warm(): void {
    this.releaseWhenIdle = false;
    if (this.app || this.initing) return;
    this.initing = this.init().catch((e) => {
      console.error('[gateFx] init failed, gate FX disabled:', e);
    });
  }

  private async init(): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: window, backgroundAlpha: 0, antialias: true, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
    });
    detachPixiDomEvents(app); // no Pixi DOM events: see pixiNoDomEvents.ts
    guardAppRender(app, 'gateFx');
    watchContextLoss(app, 'gateFx');
    const c = app.canvas;
    c.className = 'gatefx-canvas pixi-screen';
    c.style.visibility = 'hidden';
    stageHost().appendChild(c); // inside the stage so it scales with it (stage.ts)
    this.layer = new Container();
    app.stage.addChild(this.layer);

    // A hot glow dot (additive): concentric discs melt into a bloom.
    const glow = new Graphics();
    for (const [r, a] of [[16, 0.08], [12, 0.13], [8, 0.22], [5, 0.4], [2.5, 0.85]] as const) {
      glow.circle(0, 0, r).fill({ color: 0xffffff, alpha: a });
    }
    this.glowTex = app.renderer.generateTexture(glow);
    // A streak: a soft body with a bright core, drawn pointing along +x.
    const spark = new Graphics();
    spark.roundRect(-14, -1.6, 28, 3.2, 1.6).fill({ color: 0xffffff, alpha: 0.32 });
    spark.roundRect(-9, -0.8, 18, 1.6, 0.8).fill({ color: 0xffffff, alpha: 0.95 });
    this.sparkTex = app.renderer.generateTexture(spark);
    // A dust puff (normal blend): many faint discs, so the edge is soft with no additive glow.
    const puff = new Graphics();
    for (let r = 32; r >= 4; r -= 4) puff.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.085 });
    this.puffTex = app.renderer.generateTexture(puff);

    app.ticker.add(() => this.tick(app.ticker.deltaMS));
    app.ticker.stop();
    this.app = app;
    const queued = this.pending;
    this.pending = [];
    for (const fn of queued) fn();
    if (this.particles.length) this.start();
    else if (this.releaseWhenIdle) this.destroy(); // released while it was still starting up
  }

  /**
   * The gate has ended. Whatever is still drifting finishes fading, then the layer is torn down and its WebGL
   * context freed; the next `warm()` builds a fresh one. Safe to call at any time, any number of times.
   */
  release(): void {
    this.releaseWhenIdle = true;
    if (this.app && !this.particles.length) this.destroy();
  }

  private destroy(): void {
    const app = this.app;
    this.app = null;
    this.initing = null;
    this.layer = null;
    this.glowTex = this.sparkTex = this.puffTex = null;
    this.particles.length = 0;
    this.pending.length = 0;
    this.releaseWhenIdle = false;
    if (app) destroyPixiApp(app, { children: true, texture: true });
  }

  /** Run `fn` now if the canvas is live, else queue it behind init (a gate pressed before the warm finished). */
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
    if (!this.particles.length && this.app) {
      this.app.ticker.stop();
      this.app.canvas.style.visibility = 'hidden';
      // Never tear the app down from inside its own ticker callback: let this frame finish first.
      if (this.releaseWhenIdle) window.setTimeout(() => { if (this.releaseWhenIdle && this.app && !this.particles.length) this.destroy(); }, 0);
    }
  }

  /** Kill everything now (the gate unmounted mid-sequence). */
  clear(): void {
    this.pending.length = 0;
    for (const p of this.particles) p.sp.destroy();
    this.particles.length = 0;
    if (this.app) {
      // Render the now-empty stage BEFORE hiding: a stopped ticker leaves the canvas holding its last frame, and
      // the next gate's first visible frame would flash those stale sparks.
      this.app.render();
      this.app.ticker.stop();
      this.app.canvas.style.visibility = 'hidden';
    }
  }

  private spawn(tex: Texture, x: number, y: number, tint: number, life: number, additive: boolean, update: Particle['update']): Sprite {
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    sp.position.set(x, y);
    sp.tint = tint;
    if (additive) sp.blendMode = 'add';
    sp.alpha = 0;
    this.layer!.addChild(sp);
    this.particles.push({ sp, age: 0, life, update });
    return sp;
  }

  /** One spark: thrown sideways off the seam, dragged by the air, pulled down, turned along its travel. */
  private spark(x: number, y: number, k: number, speedMin: number, speedMax: number, delay = 0): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    const ang = (Math.random() - 0.62) * 1.9; // mostly sideways, a bias upward (screen y is down)
    const speed = (speedMin + Math.random() * (speedMax - speedMin)) * k;
    let vx = Math.cos(ang) * speed * side; // px/s
    let vy = Math.sin(ang) * speed;
    const gravity = 1500 * k;
    const life = delay + 320 + Math.random() * 640;
    const len = 0.55 + Math.random() * 0.9;
    this.spawn(this.sparkTex!, x, y, pick(SPARK_TINTS), life, true, (p, dt) => {
      if (p.age < delay) return;
      const s = dt / 1000;
      vx *= 1 - 1.4 * s;
      vy = vy * (1 - 0.6 * s) + gravity * s;
      p.sp.x += vx * s;
      p.sp.y += vy * s;
      p.sp.rotation = Math.atan2(vy, vx);
      const t = (p.age - delay) / (p.life - delay);
      p.sp.alpha = (1 - t) * (1 - t);
      p.sp.scale.set(len * k * (1 - t * 0.5), k * (1 - t * 0.4));
    });
  }

  /** One dust puff: it drifts, slows, rises a little, and grows as it thins out. */
  private puff(x: number, y: number, k: number, vx0: number, vy0: number, size: number, peak: number, life: number, delay = 0): void {
    let vx = vx0 * k, vy = vy0 * k;
    const spin = (Math.random() - 0.5) * 0.6;
    this.spawn(this.puffTex!, x, y, pick(DUST_TINTS), delay + life, false, (p, dt) => {
      if (p.age < delay) return;
      const s = dt / 1000;
      vx *= 1 - 1.7 * s;
      vy = vy * (1 - 1.2 * s) - 14 * k * s; // settles into a slow rise
      p.sp.x += vx * s;
      p.sp.y += vy * s;
      p.sp.rotation += spin * s;
      const t = (p.age - delay) / life;
      p.sp.alpha = peak * Math.min(1, t * 9) * (1 - t) * (1 - t * 0.4);
      p.sp.scale.set(size * k * (1 + t * 1.5));
    });
  }

  /** THE SLAM: sparks off the whole seam, a flash on it, dust rolling out from the seam and along the floor. */
  slam(seam: GateSeam): void {
    this.run(() => {
      const h = Math.max(1, seam.bottom - seam.top);
      const k = Math.max(0.5, h / 1080); // tuned at a 1080-tall gate
      const mid = seam.top + h / 2;
      // Sparks: every stretch of the seam throws some, the middle (the emblem) the most.
      for (let i = 0; i < 170; i++) {
        const centred = Math.random() < 0.45;
        const y = centred ? mid + (Math.random() + Math.random() - 1) * h * 0.18 : seam.top + Math.random() * h;
        this.spark(seam.x + (Math.random() - 0.5) * 6 * k, y, k, 260, 1250, Math.random() * 60);
      }
      // The flash: a column of hot glow on the seam, gone in a blink.
      for (let i = 0; i < 9; i++) {
        const y = seam.top + (h * (i + 0.5)) / 9;
        const big = i === 4 ? 2 : 1;
        const tint = i % 2 ? 0xffe2a0 : 0xffffff;
        this.spawn(this.glowTex!, seam.x, y, tint, 260 + Math.random() * 120, true, (p) => {
          const t = p.age / p.life;
          p.sp.alpha = (1 - t) * 0.9;
          p.sp.scale.set((5 + t * 4) * k * big, (9 + t * 3) * k * big);
        });
      }
      // Dust off the seam: thrown sideways, both ways, the whole height.
      for (let i = 0; i < 38; i++) {
        const side = i % 2 ? -1 : 1;
        const y = seam.top + Math.random() * h;
        this.puff(seam.x + side * Math.random() * 14 * k, y, k, side * (60 + Math.random() * 330), -20 - Math.random() * 70,
          1.6 + Math.random() * 2.6, 0.2 + Math.random() * 0.2, 1000 + Math.random() * 900, Math.random() * 90);
      }
      // Dust off the floor: the doors' feet kick it out along the bottom edge.
      for (let i = 0; i < 26; i++) {
        const side = i % 2 ? -1 : 1;
        const x = seam.x + side * Math.random() * 260 * k;
        this.puff(x, seam.bottom - Math.random() * 30 * k, k, side * (40 + Math.random() * 260), -60 - Math.random() * 150,
          2 + Math.random() * 3, 0.22 + Math.random() * 0.2, 1100 + Math.random() * 900, Math.random() * 120);
      }
    });
  }

  /** THE SHUDDER: dust shaken loose from the top of the doors, and a few sparks spat from the seam. */
  shudder(seam: GateSeam, ms: number): void {
    this.run(() => {
      const h = Math.max(1, seam.bottom - seam.top);
      const k = Math.max(0.5, h / 1080);
      for (let i = 0; i < 22; i++) {
        const x = seam.x + (Math.random() - 0.5) * 900 * k;
        this.puff(x, seam.top + Math.random() * 20 * k, k, (Math.random() - 0.5) * 60, 90 + Math.random() * 150,
          1.1 + Math.random() * 1.6, 0.16 + Math.random() * 0.14, 800 + Math.random() * 600, Math.random() * ms * 0.7);
      }
      for (let i = 0; i < 30; i++) {
        this.spark(seam.x, seam.top + Math.random() * h, k, 140, 520, Math.random() * ms * 0.8);
      }
    });
  }
}

export const gateFx = new GateFxController();
