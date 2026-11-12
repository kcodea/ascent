/**
 * THE SUCKER PUNCH SCENE: everything the spring glove draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroGlove.ts` mounts `root` on the above-portrait
 * overlay and feeds `update(dt)`.
 *
 * The GLOVE ON ITS SPRING is the subject, and it is ONE object posed from one pure function of its own clock
 * (`glovePoseAt`): a riveted HATCH on the edge of the striking portrait, a COIL drawn as a zig-zag of steel strokes laid
 * end to end from the hatch to the glove's cuff (a fixed number of strokes for the punch, each holding a fixed length of
 * wire, so the coil is fat and tight when squeezed and thin and open when stretched; it follows a gentle curve when the
 * spring sways), and the red GLOVE on its end, turned to follow the spring's last turn and squashed on a bop. The hatch,
 * every stroke and the glove are taken from the pool ONCE at the pop and only moved after that: no per-frame allocation.
 *
 * A BOP is a comic impact star, a ring, a few flung little stars and a puff. After Big's last bop a few stars CIRCLE the
 * struck head for a moment (they ride its knockback).
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutBack, mixColor, spring, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { coilAmp, glovePoseAt, newGlovePose, type GloveMotion } from './heroGloveConfig';
import { BURST_D, COIL_H, COIL_SPAN, GLOVE_W, HATCH_D, STAR_D } from './heroGloveTextures';

export interface HeroGloveTextures extends HeroArcanaTextures {
  glove: Texture;
  gloveTrim: Texture;
  coil: Texture;
  hatch: Texture;
  star5: Texture;
  burst: Texture;
}

export interface GloveColors { glove: number; trim: number; spring: number; hatch: number; star: number; flash: number; side: number }

export interface GloveLook {
  /** The hatch's width, the coil's widest half width and its wire's thickness: px at stage scale 1. */
  hatchPx: number;
  springWidth: number;
  springThick: number;
  /** The bop's size multiplier. */
  bop: number;
  /** How much the glove squashes on a bop. */
  squash: number;
  /** How long the hatch takes to shut once the glove is home. */
  closeMs: number;
}

/** Hard cap on sprites alive at once (the coil is at most 40; a Big bop with its stars peaks well under 120). */
export const MAX_GLOVE_SPRITES = 180;
const GLOW_PX = 128;
const RING_PX = 160;
/** How long the hatch takes to pop open. */
const HATCH_OPEN_MS = 140;

interface Dizzy { stars: Sprite[]; at: Pt; rx: number; ry: number; age: number; dur: number; size: number }

export class HeroGloveScene extends FxPool {
  private m: GloveMotion | null = null;
  private age = 0;
  /** The pop happened this frame: its `age0` is already this frame's time, so the frame's own update must not add to it. */
  private fresh = false;
  private readonly pose = newGlovePose();
  private hatch: Sprite | null = null;
  private coils: Sprite[] = [];
  private body: Sprite | null = null;
  private trim: Sprite | null = null;
  private dizzy: Dizzy | null = null;
  /** The knuckles, as last drawn (where a bop bursts). */
  private kx = 0;
  private ky = 0;

  constructor(private readonly tex: HeroGloveTextures, private readonly colors: GloveColors, private readonly look: GloveLook, scale = 1, seed = 1) {
    super('heroGlove', [tex.glow, tex.ring, tex.star, tex.streak, tex.glove, tex.gloveTrim, tex.coil, tex.hatch, tex.star5, tex.burst], scale, seed, MAX_GLOVE_SPRITES);
  }

  /** The punch is on screen (from the pop until the hatch has shut). */
  get punching(): boolean { return this.m !== null; }
  /** The glove is out of the hatch. */
  get gloveOut(): boolean { return this.m !== null && this.pose.vis > 0; }
  get liveCoils(): number { return this.coils.length; }
  get liveDizzy(): number { return this.dizzy ? this.dizzy.stars.length : 0; }
  /** The glove's centre as last drawn (overlay px). */
  get glovePoint(): Pt { return { x: this.body?.position.x ?? 0, y: this.body?.position.y ?? 0 }; }
  /** Its knuckles as last drawn. */
  get knuckles(): Pt { return { x: this.kx, y: this.ky }; }

  /** The hatch pops open and the glove pokes out on its spring. `age0` = ms already elapsed. Once per scene. */
  pop(m: GloveMotion, age0 = 0): void {
    if (this.m || this.destroyed) return;
    const c = this.colors;
    // Taken in draw order, once: the hatch, the coil's far strokes, its near strokes (all under), then the glove.
    const hatch = this.take('under', this.tex.hatch, c.hatch);
    const coils: Sprite[] = new Array<Sprite>(m.segs);
    const far = mixColor(c.spring, 0x1c2028, 0.5);
    let ok = hatch !== null;
    for (const near of [false, true]) {
      for (let i = 0; i < m.segs && ok; i++) {
        if ((i % 2 === 0) !== near) continue;
        const s = this.take('under', this.tex.coil, near ? c.spring : far);
        if (s) coils[i] = s; else ok = false;
      }
    }
    const body = ok ? this.take('body', this.tex.glove, c.glove) : null;
    const trim = ok ? this.take('body', this.tex.gloveTrim, c.trim) : null;
    if (!hatch || !body || !trim || !ok) { for (const s of [hatch, body, trim, ...coils]) this.give(s ?? null); return; }
    this.m = m; this.age = Math.max(0, age0); this.fresh = true;
    this.hatch = hatch; this.coils = coils; this.body = body; this.trim = trim;
    hatch.position.set(m.base.x, m.base.y);
    hatch.rotation = Math.atan2(m.u.y, m.u.x);
    // A little puff and a ring as the hatch bursts open.
    this.spawn('glow', this.tex.ring, whiten(c.hatch, 0.4), m.base.x, m.base.y, { dur: 240, from: 0.1, to: 0.5, a0: 0.8, ease: 'cubic' });
    this.burst('under', this.tex.glow, [whiten(c.hatch, 0.6), 0xffffff], m.base.x, m.base.y, 4, { speed: 110, life: 320, size: 0.22, drag: 0.2, to: 1.6, mode: 'hold' });
    this.burst('core', this.tex.star, [c.flash, c.star], m.base.x, m.base.y, 5, { speed: 240, dir: Math.atan2(m.u.y, m.u.x), spread: 2.2, life: 260, size: 0.22 });
    this.draw();
  }

  /** The spring lets go: a kick of air at the hatch and speed lines along the punch. */
  fire(): void {
    const m = this.m; if (!m) return;
    const c = this.colors;
    const rot = Math.atan2(m.u.y, m.u.x);
    const ring = this.spawn('glow', this.tex.ring, 0xffffff, m.base.x, m.base.y, { dur: 220, from: 0.14, to: 0.62, a0: 0.75, sy: 2.4 });
    if (ring) { ring.rotation = rot; }
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * m.glove * 0.26;
      this.spawn('glow', this.tex.streak, whiten(c.glove, 0.55), m.base.x + m.n.x * off + m.u.x * m.glove, m.base.y + m.n.y * off + m.u.y * m.glove, {
        dur: 200 + i * 20, from: 0.9, to: 1.5, a0: 0.5, sy: 0.4, rot, vx: m.u.x * 900, vy: m.u.y * 900, drag: 0.05, mode: 'punch', peakAt: 0.25,
      });
    }
  }

  /**
   * A BOP at the knuckles (a tick, or the impact's own): a comic impact star, a ring, a few flung stars and a puff.
   * `dir` is the punch's direction; the glove's own squash is in its pose.
   */
  bop(at: Pt, dir: Pt, strength: number, stars: number): void {
    const c = this.colors;
    const T = this.look.bop * strength;
    const rot = Math.atan2(dir.y, dir.x);
    this.spawn('body', this.tex.burst, c.star, at.x, at.y, { dur: 260, from: (64 * T) / BURST_D, to: (132 * T) / BURST_D, a0: 0.95, mode: 'punch', peakAt: 0.12, rot: rot + 0.3, follow: true });
    this.spawn('core', this.tex.burst, c.flash, at.x, at.y, { dur: 200, from: (46 * T) / BURST_D, to: (96 * T) / BURST_D, a0: 1, mode: 'punch', peakAt: 0.1, rot, follow: true });
    this.spawn('glow', this.tex.glow, c.star, at.x, at.y, { dur: 260, from: (60 * T) / GLOW_PX, to: (170 * T) / GLOW_PX, a0: 0.5, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.ring, whiten(c.star, 0.4), at.x, at.y, { dur: 320, from: (24 * T) / RING_PX, to: (140 * T) / RING_PX, a0: 0.8, ease: 'cubic' });
    // Little stars knocked loose: flung on past the face and up, tumbling, falling.
    this.burst('body', this.tex.star5, [c.star, whiten(c.star, 0.45), c.flash], at.x, at.y, stars, { speed: 460 * T, dir: rot, spread: 2.6, life: 560, size: 0.42 * T, grav: 1200, drag: 0.35, spin: 0.014, to: 0.7, lift: 180 });
    this.burst('under', this.tex.glow, [0xffffff, whiten(c.glove, 0.7)], at.x, at.y, 3, { speed: 80, life: 380, size: 0.3 * T, drag: 0.3, to: 1.5, mode: 'hold' });
  }

  /** Stars circle the struck head for a moment (they ride its knockback). Once per scene. */
  seeStars(at: Pt, rx: number, ry: number, n: number, durMs: number, size: number): void {
    if (this.dizzy || n <= 0 || durMs <= 0) return;
    const stars: Sprite[] = [];
    for (let i = 0; i < n; i++) { const s = this.take('body', this.tex.star5, this.colors.star); if (s) { s.alpha = 0; stars.push(s); } }
    if (!stars.length) return;
    this.dizzy = { stars, at: { x: at.x, y: at.y }, rx, ry, age: 0, dur: durMs, size };
  }

  /** The glove is home: a clunk of dust at the hatch (it shuts by itself). */
  home(): void {
    const m = this.m; if (!m) return;
    const c = this.colors;
    this.spawn('glow', this.tex.ring, whiten(c.hatch, 0.4), m.base.x, m.base.y, { dur: 220, from: 0.1, to: 0.42, a0: 0.7, ease: 'cubic' });
    this.burst('under', this.tex.glow, [whiten(c.hatch, 0.6), 0xffffff], m.base.x, m.base.y, 3, { speed: 90, life: 280, size: 0.2, drag: 0.2, to: 1.5, mode: 'hold' });
  }

  protected override tick(dt: number): boolean {
    const z = this.dizzy;
    if (z) {
      z.age += dt;
      if (z.age >= z.dur) { for (const s of z.stars) this.give(s); this.dizzy = null; } else this.drawDizzy(z);
    }
    const m = this.m;
    if (m) {
      if (this.fresh) this.fresh = false; else this.age += dt;
      if (this.age >= m.tHome + 60 + this.look.closeMs) this.dropPunch();
      else this.draw();
    }
    return this.m !== null || this.dizzy !== null;
  }

  /** Pose the hatch, the coil and the glove for `age`. Moves sprites only: nothing is made here. */
  private draw(): void {
    const m = this.m, hatch = this.hatch, body = this.body, trim = this.trim;
    if (!m || !hatch || !body || !trim) return;
    const S = this.scale;
    const t = this.age;
    const p = glovePoseAt(m, t, this.look.squash, this.pose);

    // The hatch: pops open, bumps as the glove comes home, then shuts. Seen edge on (squashed along the punch).
    let open = t < HATCH_OPEN_MS ? easeOutBack(t / HATCH_OPEN_MS, 2.6) : 1;
    if (t >= m.tHome) {
      const shut = clamp01((t - m.tHome - 60) / Math.max(1, this.look.closeMs));
      open = (1 + 0.16 * spring(t - m.tHome, 7, 45)) * (1 - shut * shut);
    }
    const hk = (this.look.hatchPx * S) / HATCH_D;
    hatch.scale.set(hk * 0.5 * open, hk * open);
    hatch.alpha = clamp01(open * 3);

    // The glove's centre, and the spring's line to it: a curve through a middle pushed across by the sway.
    const gx = m.base.x + m.u.x * p.ext + m.n.x * p.lat;
    const gy = m.base.y + m.u.y * p.ext + m.n.y * p.lat;
    const cx = (m.base.x + gx) * 0.5 + m.n.x * p.bow;
    const cy = (m.base.y + gy) * 0.5 + m.n.y * p.bow;
    // The glove points along the spring's last turn.
    let dx = gx - cx, dy = gy - cy;
    const dl = Math.hypot(dx, dy);
    if (dl < 2) { dx = m.u.x; dy = m.u.y; } else { dx /= dl; dy /= dl; }
    const tuck = 0.5 + 0.5 * p.vis;
    const k = (m.glove / GLOVE_W) * tuck;
    const rot = Math.atan2(dy, dx);
    const flip = m.u.x < 0 ? -1 : 1; // thumb up whichever way it punches
    const a = clamp01(p.vis * 1.8);
    body.position.set(gx, gy); body.rotation = rot; body.scale.set(k * p.sx, k * p.sy * flip); body.alpha = a;
    trim.position.set(gx, gy); trim.rotation = rot; trim.scale.set(k * p.sx, k * p.sy * flip); trim.alpha = a;
    const half = m.glove * 0.5 * tuck * p.sx;
    this.kx = gx + dx * half * 0.86; this.ky = gy + dy * half * 0.86;

    // The coil: `segs` strokes zig-zagging from the hatch to the cuff, each stretched to span its two corners.
    const wx = gx - dx * half * 0.8, wy = gy - dy * half * 0.8;
    const bx = m.base.x, by = m.base.y;
    const cur = Math.hypot(wx - bx, wy - by);
    const amp = coilAmp(m, cur, this.look.springWidth * S);
    const thick = (this.look.springThick * S) / COIL_H;
    const n = m.segs;
    let px = bx, py = by;
    for (let i = 1; i <= n; i++) {
      const s = i / n, o = 1 - s;
      const qx = o * o * bx + 2 * o * s * cx + s * s * wx;
      const qy = o * o * by + 2 * o * s * cy + s * s * wy;
      let tx = o * (cx - bx) + s * (wx - cx), ty = o * (cy - by) + s * (wy - cy);
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-3) { tx = m.u.x; ty = m.u.y; } else { tx /= tl; ty /= tl; }
      const off = i === n ? 0 : (i % 2 ? amp : -amp);
      const vx = qx - ty * off, vy = qy + tx * off;
      const seg = this.coils[i - 1]!;
      const near = (i - 1) % 2 === 0;
      seg.position.set((px + vx) * 0.5, (py + vy) * 0.5);
      seg.rotation = Math.atan2(vy - py, vx - px);
      seg.scale.set(Math.hypot(vx - px, vy - py) / COIL_SPAN, near ? thick : thick * 0.82);
      seg.alpha = a;
      px = vx; py = vy;
    }
  }

  private drawDizzy(z: Dizzy): void {
    const n = z.stars.length;
    const env = Math.min(clamp01(z.age / 140), clamp01((z.dur - z.age) / 240));
    const popIn = easeOutBack(z.age / 200, 2);
    const k = (z.size * this.scale) / STAR_D;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + z.age * 0.0082;
      const depth = Math.sin(ang); // +1 = nearest (the front of the ring)
      const s = z.stars[i]!;
      s.position.set(z.at.x + this.fox + Math.cos(ang) * z.rx, z.at.y + this.foy + depth * z.ry);
      s.scale.set(k * popIn * (0.84 + 0.2 * depth));
      s.rotation = 0.35 * Math.sin(z.age * 0.012 + i * 2.1);
      s.alpha = env * (0.72 + 0.28 * (depth * 0.5 + 0.5));
    }
  }

  private dropPunch(): void {
    this.give(this.hatch); this.give(this.body); this.give(this.trim);
    for (const s of this.coils) this.give(s ?? null);
    this.hatch = null; this.body = null; this.trim = null; this.coils = []; this.m = null;
    this.pose.vis = 0;
  }

  protected override clearOwn(): void {
    this.dropPunch();
    if (this.dizzy) { for (const s of this.dizzy.stars) this.give(s); this.dizzy = null; }
  }
}
