/**
 * GATE FX — the smoke and sparks of the ranked gate (owner 2026-10-12: "slam shut with smoke and sparks that emit
 * from the impact"). A tiny Pixi layer of its own, the `wipeFx.ts` pattern: the gate covers every screen in the
 * game (z 700), far above the main FX canvas (z 110), so anything that rides ON the doors needs its own canvas.
 * It ticks ONLY while a burst is alive. On phones and iPads (`PHONE_GPU`) it exists only around a gate: warmed as the
 * ranked confirmation opens and TORN DOWN (`release`, through `destroyPixiApp`: the bounded-context rule) once the
 * gate has ended and its last particle has faded. On desktop it is warmed behind the boot splash and kept for the
 * session (R-PERF-PIXI-KEEPALIVE-01), so neither gate of a game pays for a new WebGL context.
 *
 * Two one-shots, both fed the gate's own SCREEN-space seam (measured once by the component, never per frame):
 *  - slam():    the impact. Hot sparks spray sideways off the whole seam and fall, a white-gold flash blooms on
 *               it, stone dust rolls outward and up from the seam and along the floor, and BLUE EMBERS lift off the
 *               seam and the floor and float upward like sparks off a fire (owner 2026-10-12).
 *  - shudder(): the rattle. Dust shakes loose from the top of the doors and a few sparks spit from the seam.
 * And the CRYSTAL's three (owner 2026-10-13), fed the crystal's screen centre and size:
 *  - gather():  the centre diamond forming it. Sparks are SUCKED into the diamond's centre from all round, in a
 *               steady stream, and LAND ON THE GROWING GEM'S EDGE, where they shimmer and slide before they
 *               fade: a living, shifting rim of light in the diamond's own outline.
 *  - ambient(): while it waits to be pressed, a steady trickle of embers lifts off it (until `stopAmbient`).
 *  - shatter(): the press. Shards fly out and fall, a flash blooms, and a burst of embers is thrown wide.
 * Sparks are additive streaks turned along their travel; dust is a soft normal-blended puff that grows as it
 * fades; an ember is a small additive glow that rises, sways and flickers out; a shard is a spinning sliver.
 *
 * `FX_AMOUNT` is the one dial on how MUCH there is of all of it (owner 2026-10-12: "amp up the overall effects by
 * about 20% ... not including the motion of the gates itself"): every particle count is multiplied by it, and the
 * seam flash is that much bigger. The doors' own motion (travel, recoil, shudder) lives in rankedGate.css and is
 * untouched by it. The embers were then trebled (owner 2026-10-13: "amplify the blue particles by 200% ... a major
 * part of the sparks that emit"). Worst case is the forming: about 1,970 sprites are created for it at once, most
 * of them invisible (waiting on their delay) at any moment, all gone within its 1.8 s. Every burst is a one-shot;
 * the one thing that runs on is the ambient trickle, twenty embers a second (about sixty alive at once) for as long
 * as the player leaves the crystal unpressed.
 */
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { stageHost } from '../stage';
import { detachPixiDomEvents } from '../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from '../pixiAppSafety';
import { RANKED_GATE_CRYSTAL_BODY, rankedGateCrystalGrowth } from './rankedGateTiming';
import { PIXI_ANTIALIAS } from '../phoneArt';
import { crumb } from '../crashLog';
import { PHONE_GPU, phonePixiOptions, pixiAllowed } from '../phoneDiag';

/** The gate's centre seam, in screen px. */
export interface GateSeam { x: number; top: number; bottom: number }
/** The crystal on the gate's centre diamond: its centre and its (square) size, in screen px. */
export interface GateCrystal { x: number; y: number; size: number }
/** The crystal's size on a 1080-tall 16:9 gate, which the particle sizes and speeds were tuned at. */
const CRYSTAL_REF_SIZE = 271;

const SPARK_TINTS = [0xffffff, 0xfff2c0, 0xffd27a, 0xffa84a, 0xff7a2e] as const;
const DUST_TINTS = [0x9a9388, 0x7d776d, 0xb3aa9a, 0x625c55, 0x8c8172] as const;
/** The landing's debris: chips of grey stone and brown wood. */
const DEBRIS_TINTS = [0x6f675c, 0x8a8174, 0x4f4943, 0x6b4f36, 0x553d2a, 0x8a6a4a] as const;
const EMBER_TINTS = [0xd6f0ff, 0xa8dcff, 0x7fc4ff, 0x4fa8ff, 0x3f8cff] as const;
/** The sparks the forming crystal pulls in: white-hot, with the crystal's own blues among them. */
const HOT_TINTS = [0xffffff, 0xffffff, 0xeaf6ff, 0xbfe4ff, 0x7fc4ff] as const;
/** How hard the portal's round motes are thrown, against their first throw (owner 2026-10-23: "have them launch out 30
 *  percent further"). The air's drag is linear, so the distance they carry scales with it. */
const MOTE_THROW = 1.3;
/** The return trip's portal (the turquoise gem over the shop door): white-hot and turquoise, a touch of violet and gold. */
const PORTAL_TINTS = [0xffffff, 0xe6fffb, 0xa8f6ee, 0x5fe8dc, 0x36cfd6, 0xc9a2ff, 0xffe08a] as const;
/** How much of everything there is: 1 = the first cut, 1.2 = the owner's "+20%" (2026-10-12). Particles only. */
const FX_AMOUNT = 1.2;
/** A particle count at the current amount. */
const amount = (count: number): number => Math.round(count * FX_AMOUNT);
/** Blue embers thrown at the slam, before `FX_AMOUNT`: 70 at first, trebled 2026-10-13 (owner: "amplify the blue
 *  particles by 200%"). */
const EMBERS_AT_SLAM = 210;
/** Embers a second the waiting crystal sheds. */
const AMBIENT_PER_SECOND = 20;
/** The waiting crystal's embers against an ordinary one: how bright, and how long-lived. 12 a second at first; then
 *  more of them, 20% more glow and 20% more life (owner 2026-10-13: "increase the amount of floating particles when
 *  the gem is waiting ... increase their glow by 20% ... increase their life by 20%"). */
const AMBIENT_GLOW = 1.2;
const AMBIENT_LIFE = 1.2;
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
  private shardTex: Texture | null = null;
  /** The crystal's waiting trickle: where it is, and the fraction of an ember owed since the last frame. */
  private ambientAt: GateCrystal | null = null;
  private ambientOwed = 0;
  /** The gate has ended: tear the layer down as soon as nothing is left alive on it. */
  private releaseWhenIdle = false;

  /** Kick the async Pixi init early (the ranked confirmation calls this as it opens) so the first slam has FX. */
  warm(): void {
    this.releaseWhenIdle = false;
    if (this.app || this.initing || !pixiAllowed()) return; // phone `nofx` switch: no canvas, the gate plays bare
    this.initing = this.init().catch((e) => {
      console.error('[gateFx] init failed, gate FX disabled:', e);
    });
  }

  /** Resolves once a `warm()` in flight has finished (immediately when none is). Never rejects. */
  ready(): Promise<void> {
    return this.initing ?? Promise.resolve();
  }

  private async init(): Promise<void> {
    const app = new Application();
    await app.init(phonePixiOptions({
      resizeTo: window, backgroundAlpha: 0, antialias: PIXI_ANTIALIAS, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
    })); // phone: low power, no depth buffer, `res1` switch (phoneDiag.ts); desktop unchanged
    detachPixiDomEvents(app); // no Pixi DOM events: see pixiNoDomEvents.ts
    guardAppRender(app, 'gateFx');
    watchContextLoss(app, 'gateFx');
    crumb('gate fx created'); // phones: every gate (the layer is freed after each one); desktop: once a session
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
    // A crystal shard: a thin sliver with a brighter facet, so it glints as it spins.
    const shard = new Graphics();
    shard.poly([0, -16, 7, 2, 0, 16, -6, 3]).fill({ color: 0xffffff, alpha: 0.7 });
    shard.poly([0, -16, 7, 2, 0, 4]).fill({ color: 0xffffff, alpha: 0.95 });
    this.shardTex = app.renderer.generateTexture(shard);

    app.ticker.add(() => this.tick(app.ticker.deltaMS));
    app.ticker.stop();
    this.app = app;
    const queued = this.pending;
    this.pending = [];
    for (const fn of queued) fn();
    if (this.busy()) this.start();
    else if (this.releaseWhenIdle) this.destroy(); // released while it was still starting up
  }

  /**
   * The gate has ended. Whatever is still drifting finishes fading, then the layer is torn down and its WebGL
   * context freed; the next `warm()` builds a fresh one. Safe to call at any time, any number of times.
   */
  release(): void {
    this.ambientAt = null; // a gate that has ended is not waiting on a crystal any more
    // DESKTOP KEEPS THE LAYER (desktop jank pass 2026-10-18, R-PERF-PIXI-KEEPALIVE-01). Building it is a new WebGL
    // context, 60-90 ms on the main thread in one go, and a desktop game builds it twice (the ranked entry, then
    // the end-of-game gate, which used to stall the doors as they began to close). Warmed behind the boot splash
    // (`bootWarm.ts`) and kept, it costs nothing at either gate. It idles with its ticker stopped and its canvas
    // hidden, exactly as between two bursts. Phones and iPads (`PHONE_GPU`, the memory path) still free it.
    if (!PHONE_GPU) return;
    this.releaseWhenIdle = true;
    if (this.app && !this.busy()) this.destroy();
  }

  /** Is anything alive on the layer (a particle, or the crystal's trickle)? */
  private busy(): boolean {
    return this.particles.length > 0 || this.ambientAt !== null;
  }

  private destroy(): void {
    const app = this.app;
    this.app = null;
    this.initing = null;
    this.layer = null;
    this.glowTex = this.sparkTex = this.puffTex = this.shardTex = null;
    this.ambientAt = null;
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
    if (this.ambientAt) {
      // The waiting crystal sheds embers at a steady rate, whatever the frame rate.
      this.ambientOwed += (Math.min(dt, 100) / 1000) * AMBIENT_PER_SECOND;
      while (this.ambientOwed >= 1) {
        this.ambientOwed -= 1;
        const c = this.ambientAt;
        const k = c.size / CRYSTAL_REF_SIZE;
        this.ember(c.x + (Math.random() - 0.5) * c.size * 0.5, c.y + (Math.random() - 0.3) * c.size * 0.6, k, 0, { kick: 0.35, rise: 0.7, glow: AMBIENT_GLOW, life: AMBIENT_LIFE });
      }
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
    if (!this.busy() && this.app) {
      this.app.ticker.stop();
      this.app.canvas.style.visibility = 'hidden';
      // Never tear the app down from inside its own ticker callback: let this frame finish first.
      if (this.releaseWhenIdle) window.setTimeout(() => { if (this.releaseWhenIdle && this.app && !this.busy()) this.destroy(); }, 0);
    }
  }

  /** Kill everything now (the gate unmounted mid-sequence). */
  clear(): void {
    this.ambientAt = null;
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

  /** One ember: it lifts off with a small sideways kick, then floats up, swaying wider and flickering as it dies. */
  private ember(x: number, y: number, k: number, delay = 0, o: { kick?: number; rise?: number; throwX?: number; throwY?: number; drag?: number; glow?: number; life?: number; fade?: number } = {}): void {
    const drag = o.drag ?? 1; // how hard the air takes the throw back: lower = it carries further
    const rise = (70 + Math.random() * 190) * k * (o.rise ?? 1); // px/s upward
    // The kick off the impact (a random sideways one, or the shatter's own throw); the air takes it back.
    let vx = o.throwX !== undefined ? o.throwX * k : (Math.random() - 0.5) * 170 * k * (o.kick ?? 1);
    let vy = (o.throwY ?? 0) * k;
    let bx = x; // the path it sways around
    const swayAmp = (8 + Math.random() * 24) * k;
    const swayHz = 0.0038 + Math.random() * 0.0062; // rad/ms
    const swayPhase = Math.random() * Math.PI * 2;
    const flickHz = 0.012 + Math.random() * 0.02;
    const flickPhase = Math.random() * Math.PI * 2;
    const life = (1300 + Math.random() * 1700) * (o.life ?? 1);
    // `glow` is how much light it gives off: it is that much brighter (as far as full brightness allows) and its
    // glow covers that much more AREA (so its width grows by the square root), which holds even where it was
    // already at full brightness.
    const glow = o.glow ?? 1;
    const size = (0.16 + Math.random() * 0.3) * Math.sqrt(glow);
    this.spawn(this.glowTex!, x, y, pick(EMBER_TINTS), delay + life, true, (p, dt) => {
      if (p.age < delay) return;
      const s = dt / 1000;
      const age = p.age - delay;
      const t = age / life;
      vx *= 1 - 1.8 * drag * s;
      vy *= 1 - 2.4 * drag * s;
      bx += vx * s;
      p.sp.y += (vy - rise * (1 - t * 0.35)) * s; // it slows a little as it cools
      p.sp.x = bx + Math.sin(age * swayHz + swayPhase) * swayAmp * t;
      // `fade` is how hard it drops off towards the end (higher = it dims sooner and goes out quicker).
      p.sp.alpha = Math.min(1, glow * Math.min(1, t * 8) * Math.pow(1 - t, o.fade ?? 1.2) * (0.75 + 0.25 * Math.sin(age * flickHz + flickPhase)));
      p.sp.scale.set(size * k * (1 - t * 0.55));
    });
  }

  /** THE SLAM: sparks off the whole seam, a flash on it, dust rolling out from the seam and along the floor, and
   *  blue embers floating up off both. */
  slam(seam: GateSeam): void {
    this.run(() => {
      const h = Math.max(1, seam.bottom - seam.top);
      const k = Math.max(0.5, h / 1080); // tuned at a 1080-tall gate
      const mid = seam.top + h / 2;
      // Sparks: every stretch of the seam throws some, the middle (the emblem) the most.
      for (let i = 0, n = amount(170); i < n; i++) {
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
          p.sp.scale.set((5 + t * 4) * k * big * FX_AMOUNT, (9 + t * 3) * k * big * FX_AMOUNT);
        });
      }
      // Dust off the seam: thrown sideways, both ways, the whole height.
      for (let i = 0, n = amount(38); i < n; i++) {
        const side = i % 2 ? -1 : 1;
        const y = seam.top + Math.random() * h;
        this.puff(seam.x + side * Math.random() * 14 * k, y, k, side * (60 + Math.random() * 330), -20 - Math.random() * 70,
          1.6 + Math.random() * 2.6, 0.2 + Math.random() * 0.2, 1000 + Math.random() * 900, Math.random() * 90);
      }
      // Dust off the floor: the doors' feet kick it out along the bottom edge.
      for (let i = 0, n = amount(26); i < n; i++) {
        const side = i % 2 ? -1 : 1;
        const x = seam.x + side * Math.random() * 260 * k;
        this.puff(x, seam.bottom - Math.random() * 30 * k, k, side * (40 + Math.random() * 260), -60 - Math.random() * 150,
          2 + Math.random() * 3, 0.22 + Math.random() * 0.2, 1100 + Math.random() * 900, Math.random() * 120);
      }
      // Blue embers: most lift off the seam (more from its lower half), the rest off the floor either side of it.
      // They leave over the first half second, so the seam keeps giving them up after the hit.
      for (let i = 0, n = amount(EMBERS_AT_SLAM); i < n; i++) {
        const offSeam = Math.random() < 0.6;
        const x = offSeam ? seam.x + (Math.random() - 0.5) * 26 * k : seam.x + (Math.random() - 0.5) * 840 * k;
        const y = offSeam ? seam.top + h * (1 - Math.random() * Math.random()) : seam.bottom - Math.random() * 24 * k;
        this.ember(x, y, k, Math.random() * 480);
      }
    });
  }

  /**
   * THE LANDING (owner 2026-10-21, the shop/combat falling gate: "create the dust from the bottom"): a slab that hits
   * the floor across the whole screen width. Stone dust bursts up and out along its bottom edge, pushed away from the
   * middle, with a low, wide bank that rolls sideways along the floor. `bottom` / `left` / `right` are screen px.
   */
  land(edge: { left: number; right: number; bottom: number }): void {
    this.run(() => {
      const w = Math.max(1, edge.right - edge.left);
      const k = Math.max(0.5, window.innerHeight / 1080); // tuned at 1080 tall, like the slam
      const mid = edge.left + w / 2;
      // THE DEBRIS (owner 2026-10-23: "can we add a bit more debris to the door slam effect when it hits the bottom?"):
      // chips of stone and wood kicked up off the floor along the whole edge. Each spins, arcs up and falls back under
      // gravity, thrown outward like the dust; normal blend, so they read as solid bits, not light.
      for (let i = 0, n = amount(60); i < n; i++) {
        const x = edge.left + Math.random() * w;
        const out = (x - mid) / (w / 2);
        let vx = (out * (80 + Math.random() * 320) + (Math.random() - 0.5) * 160) * k;
        let vy = -(320 + Math.random() * 620) * k;
        const spin = (Math.random() - 0.5) * 22;
        const sz = (0.22 + Math.random() * 0.4) * k;
        const sx = sz * (0.7 + Math.random() * 0.6), sy = sz * (0.5 + Math.random() * 0.5);
        const delay = Math.random() * 70;
        const sp = this.spawn(this.shardTex!, x, edge.bottom - Math.random() * 14 * k, pick(DEBRIS_TINTS), delay + 650 + Math.random() * 550, false, (p, dt) => {
          if (p.age < delay) { p.sp.alpha = 0; return; }
          const s = dt / 1000;
          vx *= 1 - 0.6 * s;
          vy += 2100 * k * s;
          p.sp.x += vx * s;
          p.sp.y += vy * s;
          p.sp.rotation += spin * s;
          const t = (p.age - delay) / (p.life - delay);
          p.sp.alpha = 0.95 * (1 - t * t * t);
          p.sp.scale.set(sx, sy);
        });
        sp.rotation = Math.random() * Math.PI * 2;
      }
      // The burst: all along the edge, thrown up and outward (harder towards the sides). (70 -> 88 with the debris.)
      for (let i = 0, n = amount(88); i < n; i++) {
        const x = edge.left + Math.random() * w;
        const out = (x - mid) / (w / 2); // -1 at the left edge, +1 at the right
        this.puff(x, edge.bottom - Math.random() * 24 * k, k, out * (60 + Math.random() * 240), -90 - Math.random() * 230,
          2.4 + Math.random() * 3.4, 0.24 + Math.random() * 0.22, 1200 + Math.random() * 900, Math.random() * 90);
      }
      // The rolling bank: low and wide, sliding sideways along the floor and only slowly rising. (40 -> 50 with the debris.)
      for (let i = 0, n = amount(50); i < n; i++) {
        const side = i % 2 ? -1 : 1;
        const x = edge.left + Math.random() * w;
        this.puff(x, edge.bottom - Math.random() * 10 * k, k, side * (180 + Math.random() * 380), -15 - Math.random() * 55,
          3.2 + Math.random() * 3, 0.2 + Math.random() * 0.18, 1400 + Math.random() * 900, 30 + Math.random() * 120);
      }
    });
  }

  /**
   * THE PORTAL (owner 2026-10-23: "a flash of sparks and energy emit ... almost like the door way is a magical portal into
   * the shop", then "lets actually have the burst and flash come from the turquoise gemstone above the shop door"): the
   * return trip's GEM, on the medallion over the shop's doorway, charges and bursts. A turquoise glow swells on it (the
   * charge), then at `chargeMs` it flashes in a starburst, sparks spray out from it in every direction, and glowing motes
   * are flung out and float up. The doorway's own glow is DOM (`.wipevista-doorglow`). `gem` is screen px: centre and radius.
   */
  portal(gem: { x: number; y: number; r: number }, chargeMs = 160): void {
    this.run(() => {
      const k = Math.max(0.5, window.innerHeight / 1080);
      const r = Math.max(4, gem.r);
      // THE CHARGE: the gem swelling with light, peaking as the burst goes.
      for (let i = 0; i < 3; i++) {
        this.spawn(this.glowTex!, gem.x, gem.y, i === 0 ? 0xffffff : pick(PORTAL_TINTS), chargeMs + 240, true, (p) => {
          const t = p.age / p.life, c = chargeMs / p.life;
          p.sp.alpha = t < c ? 0.85 * (t / c) : 0.85 * (1 - (t - c) / (1 - c));
          p.sp.scale.set((r / 16) * (1.2 + 2.2 * (t < c ? t / c : 1)) * (1 + i * 0.6));
        });
      }
      // THE FLASH: a starburst on the gem, a bright core and a wide soft bloom, gone in a blink.
      for (const [size, a, life] of [[5, 1, 260], [12, 0.7, 380], [22, 0.35, 460]] as const) {
        this.spawn(this.glowTex!, gem.x, gem.y, size === 5 ? 0xffffff : 0x9ff7ef, chargeMs + life, true, (p) => {
          if (p.age < chargeMs) return;
          const t = (p.age - chargeMs) / (p.life - chargeMs);
          p.sp.alpha = a * (1 - t);
          p.sp.scale.set((r / 16) * size * (0.7 + t * 0.8));
        });
      }
      // THE BURST: sparks thrown straight out from the gem in every direction. Short-lived since the owner asked for
      // them to "fade way faster" (2026-10-23): under half their first life, and a steeper fade. Fewer of these long
      // streaks since "lets remove some of the longer sparks, add more of the circular sparks" (140 -> 80).
      for (let i = 0, n = amount(80); i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = (420 + Math.random() * 1200) * k;
        let vx = Math.cos(a) * speed, vy = Math.sin(a) * speed;
        const delay = chargeMs + Math.random() * 60;
        const len = 0.5 + Math.random() * 0.9;
        this.spawn(this.sparkTex!, gem.x + Math.cos(a) * r, gem.y + Math.sin(a) * r, pick(PORTAL_TINTS), delay + 150 + Math.random() * 230, true, (p, dt) => {
          if (p.age < delay) return;
          const s = dt / 1000;
          vx *= 1 - 2.1 * s;
          vy = vy * (1 - 2.1 * s) + 380 * k * s; // magic falls slowly
          p.sp.x += vx * s;
          p.sp.y += vy * s;
          p.sp.rotation = Math.atan2(vy, vx);
          const t = (p.age - delay) / (p.life - delay);
          p.sp.alpha = Math.pow(1 - t, 2.5);
          p.sp.scale.set(len * k * (1 - t * 0.5), k * (1 - t * 0.4));
        });
      }
      // THE ENERGY: glowing motes flung out from the gem, flickering out fast (a third of their first life). More of
      // them (70 -> 120) and thrown 30% further (owner 2026-10-23: "have them launch out 30 percent further").
      for (let i = 0, n = amount(120); i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        this.ember(gem.x + Math.cos(a) * r, gem.y + Math.sin(a) * r, k, chargeMs + Math.random() * 120, {
          throwX: Math.cos(a) * (220 + Math.random() * 420) * MOTE_THROW, throwY: Math.sin(a) * (200 + Math.random() * 380) * MOTE_THROW, drag: 0.8, glow: 1.4, life: 0.25, fade: 2,
        });
      }
    });
  }

  /**
   * THROUGH THE DOOR (owner 2026-10-23: "at the moment that we pass through the glowing door completely, have those same
   * fluttery sparks bloom out from all four sides of the player screen"): the portal's own sparks and motes, born along
   * every edge of the screen and thrown inward, as the return trip comes out of the doorway onto the shop. They fade
   * as fast as the gem's.
   */
  edgeBloom(): void {
    this.run(() => {
      const W = window.innerWidth, H = window.innerHeight;
      const k = Math.max(0.5, H / 1080);
      // A point on an edge (0 top, 1 right, 2 bottom, 3 left), weighted by the edge's length, and its inward direction.
      const onEdge = (): { x: number; y: number; nx: number; ny: number } => {
        const u = Math.random() * 2 * (W + H);
        if (u < W) return { x: u, y: 0, nx: 0, ny: 1 };
        if (u < W + H) return { x: W, y: u - W, nx: -1, ny: 0 };
        if (u < 2 * W + H) return { x: u - W - H, y: H, nx: 0, ny: -1 };
        return { x: 0, y: u - 2 * W - H, nx: 1, ny: 0 };
      };
      // Sparks, thrown in off the edge with a little spread either way (fewer long streaks, like the gem's: 160 -> 90).
      for (let i = 0, n = amount(90); i < n; i++) {
        const e = onEdge();
        const ang = Math.atan2(e.ny, e.nx) + (Math.random() - 0.5) * 1.3;
        const speed = (380 + Math.random() * 1000) * k;
        let vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
        const delay = Math.random() * 90;
        const len = 0.5 + Math.random() * 0.9;
        this.spawn(this.sparkTex!, e.x, e.y, pick(PORTAL_TINTS), delay + 150 + Math.random() * 230, true, (p, dt) => {
          if (p.age < delay) return;
          const s = dt / 1000;
          vx *= 1 - 2.1 * s;
          vy = vy * (1 - 2.1 * s) + 380 * k * s;
          p.sp.x += vx * s;
          p.sp.y += vy * s;
          p.sp.rotation = Math.atan2(vy, vx);
          const t = (p.age - delay) / (p.life - delay);
          p.sp.alpha = Math.pow(1 - t, 2.5);
          p.sp.scale.set(len * k * (1 - t * 0.5), k * (1 - t * 0.4));
        });
      }
      // The fluttery motes, flung in off the edge and flickering out (more of them, 110 -> 180, and 30% further).
      for (let i = 0, n = amount(180); i < n; i++) {
        const e = onEdge();
        const ang = Math.atan2(e.ny, e.nx) + (Math.random() - 0.5) * 1.1;
        const push = (220 + Math.random() * 460) * MOTE_THROW;
        this.ember(e.x, e.y, k, Math.random() * 120, {
          throwX: Math.cos(ang) * push, throwY: Math.sin(ang) * push, drag: 0.8, glow: 1.4, life: 0.25, fade: 2,
        });
      }
    });
  }

  /** THE SHUDDER: dust shaken loose from the top of the doors, and a few sparks spat from the seam. */
  shudder(seam: GateSeam, ms: number): void {
    this.run(() => {
      const h = Math.max(1, seam.bottom - seam.top);
      const k = Math.max(0.5, h / 1080);
      for (let i = 0, n = amount(22); i < n; i++) {
        const x = seam.x + (Math.random() - 0.5) * 900 * k;
        this.puff(x, seam.top + Math.random() * 20 * k, k, (Math.random() - 0.5) * 60, 90 + Math.random() * 150,
          1.1 + Math.random() * 1.6, 0.16 + Math.random() * 0.14, 800 + Math.random() * 600, Math.random() * ms * 0.7);
      }
      for (let i = 0, n = amount(30); i < n; i++) {
        this.spark(seam.x, seam.top + Math.random() * h, k, 140, 520, Math.random() * ms * 0.8);
      }
    });
  }

  /**
   * THE CRYSTAL FORMING (owner 2026-10-13: "have the gem almost coalesce from sparks that suck into the middle ...
   * glowing hot white as its forming. growing from the center"). For the whole of `ms` sparks are pulled in from
   * all round: each starts slow, far out, and accelerates in along a slightly curved path, stretching into a streak.
   *
   * WHERE THEY END is the gem's own EDGE (owner, later the same day: "i want the edges to still warble and shift as
   * the diamond glows. like the circle did. can you have the particals instead have the diamond shape around the
   * edge?"). The first cut ended them all on one point, where hundreds of additive sparks piled up into a bright
   * round spot whose edge crawled as they came and went. That crawl was the good part; the disc was not. So each
   * one now lands on the diamond's outline at the size the gem is AT THAT MOMENT (`rankedGateCrystalGrowth`, the
   * stylesheet's own growth curve), then rides the edge for a moment, sliding along it and breathing in and out of
   * it, before it fades. A crowd of soft motes born on the edge does the same throughout. Together they are a rim
   * of light in the diamond's shape that never holds still, growing with the gem and cooling off with it.
   */
  gather(c: GateCrystal, ms: number): void {
    this.run(() => {
      const k = c.size / CRYSTAL_REF_SIZE;
      const B = RANKED_GATE_CRYSTAL_BODY;
      /** The gem's scale `tau` ms into its forming. */
      const grown = (tau: number): number => rankedGateCrystalGrowth(tau / ms);
      /** From the gem's centre to its edge in direction `ang`, `tau` ms in: a diamond, |x|/halfW + |y|/halfH = 1. */
      const edge = (ang: number, tau: number): number =>
        (grown(tau) * c.size) / (Math.abs(Math.cos(ang)) / B.halfW + Math.abs(Math.sin(ang)) / B.halfH);
      /** Which way the edge runs where direction `ang` meets it (for a streak lying along it). */
      const alongEdge = (ang: number): number => Math.atan2(Math.sign(Math.sin(ang) || 1) * B.halfH, -Math.sign(Math.cos(ang) || 1) * B.halfW);
      /** Full while the gem is white-hot, letting go over the last 30% as it cools (the stylesheet's `rg-cry-heat`). */
      const heat = (tau: number): number => { const t = tau / ms; return t < 0.7 ? 1 : Math.max(0, (1 - t) / 0.3); };
      const place = (sp: Sprite, ang: number, r: number, tau: number): void => {
        sp.position.set(c.x + Math.cos(ang) * r, c.y + B.dy * c.size * grown(tau) + Math.sin(ang) * r);
      };

      // The streaks: they leave all through the first three quarters, so the stream is steady. Each flies in to the
      // edge, then lies along it and slides, breathing, as it fades. Nearly twice as many since the owner asked for
      // more of them (2026-10-13: "increase the particles that are being sucked into the edges"): 170 -> 320, then
      // 800 ("add more particles being sucked in too"). The forming is 1.8 s, so they arrive thick and fast.
      for (let i = 0, n = amount(800); i < n; i++) {
        const ang0 = Math.random() * Math.PI * 2;
        const r0 = c.size * (1 + Math.random() * 2.8);
        const swirl = (Math.random() - 0.5) * 1.1; // rad of curve over its flight
        const delay = Math.random() * ms * 0.72;
        const fly = 300 + Math.random() * 380;
        const dwell = 170 + Math.random() * 230;
        const slide = (Math.random() - 0.5) * 0.7; // rad along the edge while it dwells
        const breathe = 0.05 + Math.random() * 0.15, hz = 0.012 + Math.random() * 0.02, phase = Math.random() * Math.PI * 2;
        const len = 0.5 + Math.random() * 0.8;
        const sp = this.spawn(this.sparkTex!, c.x + Math.cos(ang0) * r0, c.y + Math.sin(ang0) * r0, pick(HOT_TINTS), delay + fly + dwell, true, (p) => {
          const a = p.age - delay;
          if (a < 0) return;
          if (a < fly) {
            const t = a / fly;
            const pull = t * t * (0.4 + 0.6 * t); // slow to start, then it is taken
            const ang = ang0 + swirl * pull;
            const land = edge(ang, p.age) * 1.03;
            place(p.sp, ang, land + (r0 - land) * (1 - pull), p.age);
            p.sp.rotation = ang + Math.PI; // pointing at the gem it is falling to
            p.sp.alpha = Math.min(1, t * 5) * heat(p.age);
            p.sp.scale.set(len * k * (0.5 + t * 1.6), k * (1 - t * 0.35));
            return;
          }
          const u = (a - fly) / dwell;
          const ang = ang0 + swirl + slide * u;
          place(p.sp, ang, edge(ang, p.age) * (1.03 + breathe * Math.sin(a * hz + phase)), p.age);
          p.sp.rotation = alongEdge(ang);
          p.sp.alpha = (1 - u) * heat(p.age);
          p.sp.scale.set(len * k * (2.1 - u * 1.2), k * (0.65 + 0.5 * (1 - u)));
        });
        sp.rotation = ang0 + Math.PI;
      }
      // Fine motes among them, on wider spirals, so the pull reads as a draw from all round and not as lines. They
      // too come to rest on the edge.
      for (let i = 0, n = amount(300); i < n; i++) {
        const ang0 = Math.random() * Math.PI * 2;
        const r0 = c.size * (0.8 + Math.random() * 1.9);
        const angVel = ((1.6 + Math.random() * 2.2) * (Math.random() < 0.5 ? 1 : -1)) / 1000; // rad/ms
        const delay = Math.random() * ms * 0.6;
        const life = ms * (0.28 + Math.random() * 0.2);
        const scale = (0.14 + Math.random() * 0.22) * k;
        this.spawn(this.glowTex!, c.x + Math.cos(ang0) * r0, c.y + Math.sin(ang0) * r0, pick(EMBER_TINTS), delay + life, true, (p) => {
          if (p.age < delay) return;
          const t = (p.age - delay) / life;
          const ang = ang0 + angVel * (p.age - delay);
          const land = edge(ang, p.age);
          place(p.sp, ang, land + (r0 - land) * (1 - t * t), p.age);
          p.sp.alpha = Math.min(1, t * 4) * (1 - t * 0.5) * heat(p.age);
          p.sp.scale.set(scale * (1 - t * 0.4));
        });
      }
      // THE RIM: soft motes born on the edge all through the forming. Each drifts along it and breathes in and out
      // of it as it swells and fades, and they overlap, so the outline's brightness and thickness keep shifting:
      // the warble. Their size follows the gem's, so the rim is in proportion from a point to full size.
      for (let i = 0, n = amount(540); i < n; i++) {
        const ang0 = Math.random() * Math.PI * 2;
        const delay = ms * (0.04 + Math.random() * 0.8);
        const life = 240 + Math.random() * 340;
        const drift = (Math.random() - 0.5) * 1.0; // rad along the edge over its life
        // Fatter and looser with each ask (owner 2026-10-13: "add more particles and distortion to the edges when the
        // gem is building"): they stray up to a quarter of the way out from the edge and back, so the outline itself
        // bulges and breaks. About half as many again are alive at once as before.
        const breathe = 0.07 + Math.random() * 0.2, hz = 0.01 + Math.random() * 0.026, phase = Math.random() * Math.PI * 2;
        const size = 0.7 + Math.random() * 1.0;
        const peak = 0.4 + Math.random() * 0.3;
        this.spawn(this.glowTex!, c.x, c.y, pick(HOT_TINTS), delay + life, true, (p) => {
          const a = p.age - delay;
          if (a < 0) return;
          const u = a / life;
          const ang = ang0 + drift * u;
          place(p.sp, ang, edge(ang, p.age) * (1 + breathe * Math.sin(a * hz + phase)), p.age);
          p.sp.alpha = Math.sin(Math.PI * u) * peak * heat(p.age);
          p.sp.scale.set(size * k * Math.max(0.14, grown(p.age)));
        });
      }
      // No glow at the centre: the white heat INSIDE the outline is the crystal's own shape, drawn by the stylesheet
      // (`.rgate-crystal-hot` / `-heat`).
    });
  }

  /** THE CRYSTAL WAITING: start its steady trickle of embers. It runs until `stopAmbient` (or the gate ends). */
  ambient(c: GateCrystal): void {
    this.run(() => {
      this.ambientAt = c;
      this.ambientOwed = 0;
    });
  }

  stopAmbient(): void {
    this.ambientAt = null;
  }

  /** THE SHATTER: shards fly out of the crystal and fall, a flash blooms, and embers are thrown wide before they
   *  float up. */
  shatter(c: GateCrystal): void {
    this.run(() => {
      this.ambientAt = null;
      const k = c.size / CRYSTAL_REF_SIZE;
      // Shards: every direction, the upper ones thrown a little harder, all of them spinning and falling. Fast and
      // far (owner 2026-10-13: "fly outward faster and further"): the quickest cross half the screen.
      for (let i = 0, n = amount(56); i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = (560 + Math.random() * 1700) * k;
        let vx = Math.cos(ang) * speed;
        let vy = Math.sin(ang) * speed - 220 * k;
        const spin = (Math.random() - 0.5) * 26; // rad/s
        const life = 750 + Math.random() * 850;
        const sx = (0.5 + Math.random() * 1.1) * k, sy = (0.6 + Math.random() * 1.2) * k;
        const r0 = Math.random() * c.size * 0.22;
        const sp = this.spawn(this.shardTex!, c.x + Math.cos(ang) * r0, c.y + Math.sin(ang) * r0, pick(EMBER_TINTS), life, true, (p, dt) => {
          const s = dt / 1000;
          vx *= 1 - 0.5 * s;
          vy = vy * (1 - 0.35 * s) + 1500 * k * s;
          p.sp.x += vx * s;
          p.sp.y += vy * s;
          p.sp.rotation += spin * s;
          const t = p.age / p.life;
          p.sp.alpha = Math.min(1, t * 20) * (1 - t * t);
          p.sp.scale.set(sx * (1 - t * 0.3), sy * (1 - t * 0.3));
        });
        sp.rotation = Math.random() * Math.PI * 2;
      }
      // The flash: the crystal's light let go at once.
      for (const [tint, mul, life] of [[0xffffff, 1.3, 240], [0x7fc4ff, 2.6, 420], [0x3f8cff, 4, 560]] as const) {
        this.spawn(this.glowTex!, c.x, c.y, tint, life, true, (p) => {
          const t = p.age / p.life;
          p.sp.alpha = (1 - t) * 0.95;
          p.sp.scale.set((c.size / 32) * mul * (0.5 + t * 0.9));
        });
      }
      // The burst of embers: thrown out in a ring, then they do what embers do and float up.
      for (let i = 0, n = amount(120); i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const out = 520 + Math.random() * 1300;
        this.ember(c.x + Math.cos(ang) * c.size * 0.15, c.y + Math.sin(ang) * c.size * 0.2, k, Math.random() * 70,
          { throwX: Math.cos(ang) * out, throwY: Math.sin(ang) * out, rise: 0.8 + Math.random() * 0.5, drag: 0.55 });
      }
    });
  }
}

export const gateFx = new GateFxController();
