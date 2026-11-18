/**
 * Draws the crystal fuse simulation (`fuseSim.ts`) on two 2D canvases — one sim, two passes, no duplication:
 *   - `drawBehind`: the debris stream, on the `.charge-motes` canvas behind the cards;
 *   - `drawGem`: the gem's glow, the 0:00 collapse burst and every particle inside `captureR`, on the `.fuse-gemfx`
 *     canvas over the End Turn button (so debris visibly ENTERS the gem instead of vanishing behind the button).
 *
 * Perf (CLAUDE.md north star): every sprite is baked ONCE per cfg (radial glows, a heat ramp per kind, a ring);
 * the per-frame path is only `drawImage` blits with additive ('lighter') compositing — never a gradient per
 * particle or per frame.
 */
import type { FuseCfg } from './fuseTune';
import type { FuseGeom, FuseParticle, FuseSim } from './fuseSim';

/** Stage px → canvas backing px: `((x - ox) * scale) * dpr`. `ox`/`oy` = the canvas's top-left in stage px. */
export interface FuseView { ox: number; oy: number; scale: number; dpr: number }

/** Makes an offscreen canvas for baking a sprite (injectable for tests). */
export type SpriteFactory = (w: number, h: number) => { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

/** The radius the gem canvas must cover: the capture radius (at least the button's own half-size, `minCapture`),
 *  the waiting orbit, and the glow beyond them. */
export function gemCanvasHalf(c: FuseCfg, minCapture = 0): number {
  return Math.max(c.captureR * 1.8, c.vortexR * 1.3, minCapture * 1.15) + c.gemGlowSize;
}

export function inGemPass(p: FuseParticle, g: FuseGeom, captureR: number): boolean {
  const dx = p.x - g.gemX;
  const dy = p.y - g.gemY;
  return dx * dx + dy * dy < captureR * captureR;
}

const domFactory: SpriteFactory = (w, h) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
};

const HEAT_LEVELS = 4;
/** Collapse burst: ring and flash lengths (s). */
const BURST_RING_SEC = 0.6;
const BURST_FLASH_SEC = 0.28;

function hex(h: string): [number, number, number] {
  const s = h.replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
}
type Rgb = [number, number, number];
function mix(a: string, b: string, t: number): Rgb {
  const x = hex(a); const y = hex(b);
  return [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t)) as Rgb;
}
function rgba(c: string | Rgb, a: number): string {
  const v = typeof c === 'string' ? hex(c) : c;
  return `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${a})`;
}

type Sprite = HTMLCanvasElement;

export class FuseRenderer {
  private cfg: FuseCfg;
  private factory: SpriteFactory;
  private motes: Sprite[] = [];
  private shards: Sprite[] = [];
  private glow!: Sprite;
  private core!: Sprite;
  private ring!: Sprite;
  private burstPending = false;
  /** The End Turn button's half-size (stage px): pieces over the button always draw on top of it (owner 2026-10-27). */
  private minCapture = 0;
  /** The behind-cards canvas may hold pixels (true until a frame finds nothing to draw and clears it). */
  private behindDrawn = true;
  /** Last frame's behind-pass bounding box in backing px [x0, y0, x1, y1], and whether it is known. */
  private readonly behindDirty: [number, number, number, number] = [0, 0, 0, 0];
  private behindDirtyKnown = false;
  private burstAt = -1;

  constructor(cfg: FuseCfg, factory: SpriteFactory = domFactory) {
    this.cfg = cfg;
    this.factory = factory;
    this.bake();
  }

  setCfg(cfg: FuseCfg): void {
    this.cfg = cfg;
    this.bake();
  }

  setMinCapture(r: number): void {
    this.minCapture = Math.max(0, r);
  }

  /** The 0:00 collapse burst: a one-shot ring + white flash on the gem pass. */
  burst(): void {
    this.burstPending = true;
  }

  /** Draws the particles outside the gem pass; returns how many. An empty frame on an already-clean canvas does
   *  nothing at all (the charged wait after 0:00 keeps every orbiter in the gem pass, so this canvas goes idle). */
  drawBehind(ctx: CanvasRenderingContext2D, sim: FuseSim, g: FuseGeom, v: FuseView): number {
    return this.drawFrame(ctx, null, sim, g, v, v, 0, 0);
  }

  drawGem(ctx: CanvasRenderingContext2D, sim: FuseSim, g: FuseGeom, v: FuseView, charge: number, timeSec: number): void {
    this.drawFrame(null, ctx, sim, g, v, v, charge, timeSec);
  }

  /**
   * ONE FRAME, ONE WALK over the particles (R-PERF-FUSE-BURN-01, perf pass 2026-11-18): each particle is classified
   * once (inside the gem's capture radius or not) and blitted to its canvas. It used to be three walks (count the
   * behind pass, draw it, draw the gem pass), each re-testing every particle. Also:
   *   - the behind canvas clears only the rectangle last frame's debris covered, not its whole backing store (it spans
   *     the fuse and 180 px around it; the debris is a narrow band in it for most of the burn);
   *   - a shard no longer resets the transform after itself: the next mote does, if one follows.
   * The picture is the same: additive blits, the same sprite, size, alpha and place for every particle.
   * Either context may be null (a pass with no canvas). Returns how many particles the behind pass drew.
   */
  drawFrame(
    behind: CanvasRenderingContext2D | null, gem: CanvasRenderingContext2D | null, sim: FuseSim, g: FuseGeom,
    bv: FuseView, gv: FuseView, charge: number, timeSec: number,
  ): number {
    const c = this.cfg;
    const R = Math.max(c.captureR, this.minCapture);
    const R2 = R * R;
    const ps = sim.particles;
    // The charged wait's orbiters always ride the gem pass (whatever the capture radius), so the big canvas goes idle.
    const idle = sim.mode === 'idle';
    const bk = bv.scale * bv.dpr;
    const gk = gv.scale * gv.dpr;

    if (gem) {
      gem.setTransform(1, 0, 0, 1, 0, 0);
      gem.clearRect(0, 0, gem.canvas.width, gem.canvas.height);
      gem.globalCompositeOperation = 'lighter';
      this.drawGemGlow(gem, sim, g, gv, charge, timeSec);
    }

    // The behind canvas is cleared lazily: when the first behind particle turns up, or at the end if none did and
    // last frame left pixels.
    let n = 0;
    let bx0 = Infinity; let by0 = Infinity; let bx1 = -Infinity; let by1 = -Infinity;
    let bRot = false; // the context is left under a shard's rotation
    let gRot = false;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const dx = p.x - g.gemX;
      const dy = p.y - g.gemY;
      const inGem = idle || dx * dx + dy * dy < R2;
      const ctx = inGem ? gem : behind;
      if (!ctx) continue;
      const k = inGem ? gk : bk;
      const v = inGem ? gv : bv;
      let alpha: number;
      if (p.life === Infinity) alpha = 0.85;
      else {
        const fadeIn = Math.min(1, p.age / 0.12);
        const fadeOut = Math.min(1, Math.max(0, (p.life - p.age) / (p.life * 0.25)));
        alpha = fadeIn * fadeOut;
      }
      if (alpha <= 0.002) alpha = 0; // still one blit, so the passes stay exactly-once
      const lvl = Math.min(HEAT_LEVELS - 1, Math.floor(p.heat * HEAT_LEVELS));
      const shard = p.kind === 'shard';
      const s = p.size * k * (shard ? 2.4 : 3.2);
      const px = (p.x - v.ox) * k;
      const py = (p.y - v.oy) * k;
      if (!inGem) {
        if (n === 0) this.clearBehind(ctx);
        n++;
        // A rotated square of side s fits a circle of radius s * 0.7072.
        const h = shard ? s * 0.7072 : s * 0.5;
        if (px - h < bx0) bx0 = px - h;
        if (py - h < by0) by0 = py - h;
        if (px + h > bx1) bx1 = px + h;
        if (py + h > by1) by1 = py + h;
      }
      ctx.globalAlpha = alpha;
      if (shard) {
        const cs = Math.cos(p.rot); const sn = Math.sin(p.rot);
        ctx.setTransform(cs, sn, -sn, cs, px, py);
        ctx.drawImage(this.shards[lvl], -s / 2, -s / 2, s, s);
        if (inGem) gRot = true; else bRot = true;
      } else {
        if (inGem ? gRot : bRot) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          if (inGem) gRot = false; else bRot = false;
        }
        ctx.drawImage(this.motes[lvl], px - s / 2, py - s / 2, s, s);
      }
    }
    if (gem) { gem.setTransform(1, 0, 0, 1, 0, 0); gem.globalAlpha = 1; }
    if (behind) {
      if (n === 0 && this.behindDrawn) this.clearBehind(behind);
      if (n > 0) { behind.setTransform(1, 0, 0, 1, 0, 0); behind.globalAlpha = 1; }
      this.behindDrawn = n > 0;
      if (n > 0) {
        const d = this.behindDirty;
        d[0] = Math.floor(bx0) - 2; d[1] = Math.floor(by0) - 2; d[2] = Math.ceil(bx1) + 2; d[3] = Math.ceil(by1) + 2;
        this.behindDirtyKnown = true;
      }
    }
    return n;
  }

  /** The debris canvas's size changed (a resize, a new light): the next clear takes the whole canvas. */
  resetBehind(): void {
    this.behindDrawn = true;
    this.behindDirtyKnown = false;
  }

  /** Clear what last frame's behind pass drew (its bounding box, when known; the whole canvas otherwise), and leave
   *  the context ready for additive blits. */
  private clearBehind(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const w = ctx.canvas.width; const h = ctx.canvas.height;
    if (this.behindDirtyKnown) {
      const d = this.behindDirty;
      const x0 = Math.max(0, d[0]); const y0 = Math.max(0, d[1]);
      const x1 = Math.min(w, d[2]); const y1 = Math.min(h, d[3]);
      if (x1 > x0 && y1 > y0) ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
    this.behindDirtyKnown = false;
    ctx.globalCompositeOperation = 'lighter';
  }

  /** The gem pass's own layers, under its particles: the glow, and the 0:00 collapse burst. */
  private drawGemGlow(ctx: CanvasRenderingContext2D, sim: FuseSim, g: FuseGeom, v: FuseView, charge: number, timeSec: number): void {
    const c = this.cfg;
    const k = v.scale * v.dpr;
    const gx = (g.gemX - v.ox) * k;
    const gy = (g.gemY - v.oy) * k;
    const p = Math.min(1, Math.max(0, charge));

    // Glow: faint to white-hot over the window, kicked by absorbs; a slow hum once charged and waiting.
    const hum = sim.mode === 'idle' ? 0.9 + 0.1 * Math.sin(timeSec * 2.6) : 1;
    const a = Math.min(1, (c.gemGlow * (0.15 + 0.85 * p * p) + sim.absorbPulse * 0.5) * hum);
    if (a > 0.001) {
      const s = c.gemGlowSize * 2 * k * (0.8 + 0.3 * p);
      ctx.globalAlpha = a;
      ctx.drawImage(this.glow, gx - s / 2, gy - s / 2, s, s);
      const cs = s * 0.38;
      ctx.globalAlpha = Math.min(1, a * p);
      ctx.drawImage(this.core, gx - cs / 2, gy - cs / 2, cs, cs);
    }

    // 0:00 collapse burst.
    if (this.burstPending) { this.burstPending = false; this.burstAt = timeSec; }
    if (this.burstAt >= 0) {
      const age = timeSec - this.burstAt;
      if (age < 0 || age > BURST_RING_SEC) {
        if (age > BURST_RING_SEC) this.burstAt = -1;
      } else {
        const u = age / BURST_RING_SEC;
        const rs = c.captureR * 2 * k * (0.2 + 1.5 * (1 - (1 - u) * (1 - u)));
        ctx.globalAlpha = 1 - u;
        ctx.drawImage(this.ring, gx - rs / 2, gy - rs / 2, rs, rs);
        if (age < BURST_FLASH_SEC) {
          const fs = c.gemGlowSize * 2.4 * k;
          ctx.globalAlpha = 1 - age / BURST_FLASH_SEC;
          ctx.drawImage(this.core, gx - fs / 2, gy - fs / 2, fs, fs);
        }
      }
    }
  }

  private bake(): void {
    const c = this.cfg;
    this.motes = [];
    this.shards = [];
    for (let i = 0; i < HEAT_LEVELS; i++) {
      const heat = i / (HEAT_LEVELS - 1);
      this.motes.push(this.bakeGlow(32, mix(c.colorMote, c.colorHot, heat), 0.35));
      this.shards.push(this.bakeShard(32, mix(c.colorShard, c.colorHot, heat)));
    }
    this.glow = this.bakeGlow(128, c.colorGem, 0.12);
    this.core = this.bakeGlow(64, c.colorHot, 0.45);
    this.ring = this.bakeRing(128, c.colorGem);
  }

  /** A soft radial glow: a hot centre fading to transparent. `coreStop` = how far the solid core reaches. */
  private bakeGlow(size: number, color: string | Rgb, coreStop: number): Sprite {
    const { canvas, ctx } = this.factory(size, size);
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, rgba(this.cfg.colorHot, 1));
    grad.addColorStop(coreStop, rgba(color, 0.9));
    grad.addColorStop(0.6, rgba(color, 0.25));
    grad.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = grad as unknown as string;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }

  /** A crystal shard: a faceted diamond with a bright edge and a faint halo. */
  private bakeShard(size: number, color: Rgb): Sprite {
    const { canvas, ctx } = this.factory(size, size);
    const r = size / 2;
    const halo = ctx.createRadialGradient(r, r, 0, r, r, r);
    halo.addColorStop(0, rgba(color, 0.35));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo as unknown as string;
    ctx.fillRect(0, 0, size, size);
    const lin = ctx.createLinearGradient(r * 0.55, r * 0.4, r * 1.45, r * 1.6);
    lin.addColorStop(0, rgba(this.cfg.colorHot, 1));
    lin.addColorStop(0.5, rgba(color, 0.95));
    lin.addColorStop(1, rgba(color, 0.55));
    ctx.beginPath();
    ctx.moveTo(r, r * 0.35);
    ctx.lineTo(r * 1.32, r);
    ctx.lineTo(r, r * 1.65);
    ctx.lineTo(r * 0.7, r);
    ctx.closePath();
    ctx.fillStyle = lin as unknown as string;
    ctx.fill();
    ctx.strokeStyle = rgba(this.cfg.colorHot, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    return canvas;
  }

  /** The collapse shockwave ring. */
  private bakeRing(size: number, color: string): Sprite {
    const { canvas, ctx } = this.factory(size, size);
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, r * 0.62, r, r, r);
    grad.addColorStop(0, rgba(color, 0));
    grad.addColorStop(0.55, rgba(this.cfg.colorHot, 0.9));
    grad.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = grad as unknown as string;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }
}
