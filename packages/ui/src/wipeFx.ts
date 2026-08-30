/**
 * WIPE FX — the dedicated ABOVE-CURTAIN Pixi layer (owner ask 2026-08-29: "make the wipe feel more magical
 * and ethereal"). The game's main FX canvas sits at z110, deliberately UNDER the curtain (z250) so the blue
 * swallows scene FX — which means anything that should ride ON the curtain's seam needs its own canvas.
 * This is that canvas: a tiny second Pixi Application at z255, mounted once, ticking ONLY while a wipe
 * effect is alive (visibility:hidden + stopped ticker otherwise, so it costs nothing between combats).
 *
 * Four one-shot effects, all driven by the same origin/radius/duration Recruit hands the curtain, so they
 * track the clip seam exactly (the seam's radius is `R * ease(t)` with the curtain's own cubic-bezier —
 * replicated here numerically):
 *  - charge():  the gem's anticipation tell — motes spiral INTO the gem + a swelling flare, played during
 *               the pre-bloom beat (`chargeIn` / the stretched `primeOut`).
 *  - bloom():   stardust wake + tangential wisps + runic flickers emitted along the expanding seam.
 *  - inhale():  motes streaming INTO the gem from across the scene — played with the EXIT bloom, selling
 *               "the gem drinks the combat scene".
 * Everything is additive-blended pale blue/white (the curtain's palette) with a little gold. Worst case is
 * a few hundred pooled-texture sprites for under a second — a one-shot, not a loop (see CLAUDE.md perf
 * rules; nothing here runs outside the wipe).
 */
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';

/** Numeric cubic-bezier(x1,y1,x2,y2) easing — mirrors the curtain's CSS `cubic-bezier(.4,0,.2,1)` so the
 *  emitters' seam radius can never drift from the clip's. Newton–Raphson with a bisection fallback. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (hi - lo > 1e-4) {
      if (sampleX(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}
const seamEase = cubicBezier(0.4, 0, 0.2, 1);

const PALETTE = [0x9fc0f5, 0xcfe0ff, 0xffffff, 0xbcd4ff] as const;
const GOLD = 0xc9a35c;

/** Hand-authored angular glyph strokes (32×32 box) — drawn with Graphics, NOT font glyphs: runic unicode
 *  renders as tofu on machines without a historic-scripts font, and these only need to READ arcane. */
const GLYPHS: number[][][] = [
  [[8, 28, 16, 4, 24, 28], [11, 18, 21, 18]],
  [[18, 4, 10, 16, 16, 16, 12, 28]],
  [[8, 4, 24, 28], [24, 4, 8, 28]],
  [[10, 4, 10, 28], [10, 4, 22, 10, 10, 16], [10, 16, 22, 28]],
  [[16, 4, 16, 28], [16, 12, 8, 4], [16, 12, 24, 4]],
  [[12, 4, 12, 28], [12, 10, 22, 16, 12, 22]],
  [[16, 4, 26, 24, 6, 24, 16, 4]],
  [[20, 4, 12, 12, 20, 20, 12, 28]],
];

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
  private glyphTex: Texture[] = [];

  /** Kick the async Pixi init early (Recruit calls this on mount) so the very first wipe's FX are ready. */
  warm(): void {
    if (this.app || this.initing) return;
    this.initing = this.init().catch((e) => {
      console.error('[wipeFx] init failed — wipe FX disabled:', e);
    });
  }

  private async init(): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: window, backgroundAlpha: 0, antialias: true, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
    });
    const c = app.canvas;
    c.className = 'wipefx-canvas';
    c.style.visibility = 'hidden';
    document.body.appendChild(c);
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
    this.glyphTex = GLYPHS.map((strokes) => {
      const g = new Graphics();
      for (const s of strokes) {
        g.moveTo(s[0]!, s[1]!);
        for (let i = 2; i < s.length; i += 2) g.lineTo(s[i]!, s[i + 1]!);
      }
      g.stroke({ width: 2.5, color: 0xffffff, cap: 'round', join: 'round' });
      return app.renderer.generateTexture(g);
    });

    app.ticker.add(() => this.tick(app.ticker.deltaMS));
    app.ticker.stop();
    this.app = app;
    const queued = this.pending;
    this.pending = [];
    for (const fn of queued) fn();
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

  /** Kill everything instantly (a decisive combat snapping the wipe home). */
  clear(): void {
    this.emitters.length = 0;
    for (const p of this.particles) p.sp.destroy();
    this.particles.length = 0;
    if (this.app) { this.app.ticker.stop(); this.app.canvas.style.visibility = 'hidden'; }
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
  private pick(): number { return PALETTE[(Math.random() * PALETTE.length) | 0]!; }

  /** THE TELL — motes spiral into the gem while a flare swells on it: 'something is about to erupt'. */
  charge(cx: number, cy: number, ms: number): void {
    this.run(() => {
      for (let i = 0; i < 34; i++) {
        const ang0 = Math.random() * Math.PI * 2;
        const r0 = 70 + Math.random() * 90;
        const angVel = (2.2 + Math.random() * 2.2) * (Math.random() < 0.5 ? 1 : -1) / 1000; // rad/ms
        const life = ms * (0.55 + Math.random() * 0.45);
        const scale = 0.14 + Math.random() * 0.2;
        this.spawn(this.dotTex!, cx + Math.cos(ang0) * r0, cy + Math.sin(ang0) * r0, this.pick(), life, (p) => {
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

  /** THE BLOOM WAKE — stardust + tangential wisps + runic flickers emitted along the expanding seam. */
  bloom(cx: number, cy: number, R: number, ms: number): void {
    this.run(() => {
      const em: Emitter & { moteAcc: number; runeAcc: number } = {
        age: 0, dur: ms, moteAcc: 0, runeAcc: 0,
        update: (e, dt) => {
          const self = e as typeof em;
          const seamR = R * seamEase(Math.min(1, e.age / ms));
          self.moteAcc += dt * 0.34; // ~150 motes over a 450ms sweep
          while (self.moteAcc >= 1) {
            self.moteAcc -= 1;
            const ang = Math.random() * Math.PI * 2;
            const px = cx + Math.cos(ang) * seamR, py = cy + Math.sin(ang) * seamR;
            if (px < -40 || py < -40 || px > window.innerWidth + 40 || py > window.innerHeight + 40) continue;
            const wisp = Math.random() < 0.28;
            const speed = wisp ? 0 : 30 + Math.random() * 110; // px/s outward
            const tang = wisp ? (60 + Math.random() * 120) * (Math.random() < 0.5 ? 1 : -1) : (Math.random() - 0.5) * 30;
            const vx = (Math.cos(ang) * speed - Math.sin(ang) * tang) / 1000;
            const vy = (Math.sin(ang) * speed + Math.cos(ang) * tang) / 1000;
            const life = 380 + Math.random() * 500;
            const scale = 0.1 + Math.random() * 0.22;
            const twf = 0.008 + Math.random() * 0.014, twp = Math.random() * Math.PI * 2;
            this.spawn(this.dotTex!, px, py, this.pick(), life, (p, d) => {
              p.sp.x += vx * d; p.sp.y += vy * d;
              const t = p.age / p.life;
              p.sp.alpha = (1 - t) * (0.7 + 0.3 * Math.sin(p.age * twf + twp));
              p.sp.scale.set(scale * (1 - t * 0.4));
            });
          }
          self.runeAcc += dt / 55; // a glyph roughly every 55ms
          while (self.runeAcc >= 1) {
            self.runeAcc -= 1;
            const ang = Math.random() * Math.PI * 2;
            const px = cx + Math.cos(ang) * seamR, py = cy + Math.sin(ang) * seamR;
            if (px < -40 || py < -40 || px > window.innerWidth + 40 || py > window.innerHeight + 40) continue;
            const tex = this.glyphTex[(Math.random() * this.glyphTex.length) | 0]!;
            const tint = Math.random() < 0.3 ? GOLD : 0xbcd4ff;
            const rot = Math.random() * Math.PI * 2;
            const vx = Math.cos(ang) * 0.03, vy = Math.sin(ang) * 0.03; // gentle outward drift
            this.spawn(tex, px, py, tint, 480, (p, d) => {
              p.sp.x += vx * d; p.sp.y += vy * d;
              const t = p.age / p.life;
              p.sp.alpha = t < 0.25 ? t * 4 : 1 - (t - 0.25) / 0.75;
              p.sp.scale.set(0.55 + t * 0.35);
              p.sp.rotation = rot;
            });
          }
        },
      };
      this.emitters.push(em);
    });
  }

  /** THE INHALE — motes from across the scene stream into the gem (played with the EXIT bloom: the gem
   *  drinking the combat scene back in). */
  inhale(cx: number, cy: number, R: number, ms: number): void {
    this.run(() => {
      for (let i = 0; i < 70; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r0 = 140 + Math.random() * Math.max(160, R * 0.75);
        const delay = Math.random() * ms * 0.45;
        const life = delay + 260 + Math.random() * (ms * 0.5);
        const scale = 0.1 + Math.random() * 0.18;
        this.spawn(this.dotTex!, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, this.pick(), life, (p) => {
          if (p.age < delay) { p.sp.alpha = 0; return; }
          const t = (p.age - delay) / (p.life - delay);
          const r = r0 * (1 - t * t * t); // slow start, hard suck at the end
          p.sp.position.set(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
          p.sp.alpha = Math.min(1, t * 5) * (1 - t * 0.35);
          p.sp.scale.set(scale * (1 + t * 0.6));
        });
      }
      // A few sparks aligned to their travel direction, for streaky motion.
      for (let i = 0; i < 14; i++) {
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
}

export const wipeFx = new WipeFxController();
