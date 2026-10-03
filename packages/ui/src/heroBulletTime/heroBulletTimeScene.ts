/**
 * THE TIMEBREAK SCENE: everything Timebreak draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`),
 * so it runs (and is tested) headless. `heroBulletTime.ts` mounts `root` on the above-portrait overlay, feeds
 * `update(dt)`, and each frame tells it where every dart is (`setDart`), how the clock reads (`setClock`) and how fast
 * the FX run (`setTimeScale`: the slow motion).
 *
 * CUTTING THROUGH TIME (owner review 2026-10-02: "more cutting through time than stopping it and dont grey out"): the
 * darts are gold clock-hand blades with a glow and a ribbon streak drawn along their own motion. As each one drops into
 * the slow motion it leaves a TEAR sliced through the air behind it (a white-hot gold slash over a violet rift glow
 * that lingers through the slow motion), and while it crawls, afterimages peel off it and glints run along its edge.
 * The clock over the target sweeps its hand, a spark trailing off its tip. The snap back is hard (a flash, a chromatic
 * burst); the impact is gold and violet, IV the biggest in the roster. Full colour throughout.
 *
 * Perf: pooled sprites under a hard cap; the darts (at most 64: a body, a glow and one ribbon strip each) and the clock
 * (a face and two hands) are own objects made once and reused; no allocation per frame beyond the pool's own.
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA } from '../heroAttack/knockout';
import { RibbonTrail } from '../heroAttack/ribbonTrail';
import { DART_W, DIGIT_PX, FACE_PX, GLYPH_PX, WASH_PX } from './heroBulletTimeTextures';

export interface HeroBulletTimeTextures extends HeroArcanaTextures {
  /** A crystalline lance of light (the projectile). */
  lance: Texture;
  /** A spinning time rune. */
  glyph: Texture;
  glint: Texture;
  mote: Texture;
  clockFace: Texture;
  wash: Texture;
  digit3: Texture;
  digit2: Texture;
  digit1: Texture;
}

export interface BulletColors { gold: number; light: number; violet: number; side: number }

export interface BulletLook {
  dartPx: number;
  trailMs: number;
  trailWidth: number;
  riftWidth: number;
  impactSize: number;
}

export type DartPhase = 'hand' | 'fly' | 'crawl' | 'strike' | 'done';

/** Hard cap on sprites alive at once (IV's dome + collapse peak well under it). */
export const MAX_BULLET_SPRITES = 900;
export const MAX_DARTS = 64;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
/** The chromatic burst on the restart: the Ancient prismatic pair (cyan, magenta). */
const CHROMA_A = 0x8af5ff;
const CHROMA_B = 0xff7ae0;

interface Dart { body: Sprite; glow: Sprite; rune: Sprite; trail: RibbonTrail; sparkAcc: number; on: boolean; phase: DartPhase; seed: number; tint: number; x: number; y: number; angle: number; k: number }

export class HeroBulletTimeScene extends FxPool {
  private darts: Dart[] = [];
  private clock: { face: Sprite; long: Sprite; short: Sprite; glow: Sprite } | null = null;
  private clockOn = false;
  private age = 0;
  private glintAcc = 0;
  private handAcc = 0;
  private handTip: Pt | null = null;
  /** The FX's own speed (the slow motion slows every spark, mote, ripple, glint and tear). */
  private timeK = 1;

  constructor(private readonly tex: HeroBulletTimeTextures, private readonly colors: BulletColors, private readonly look: BulletLook, scale = 1, seed = 1) {
    super('heroBulletTime', [tex.glow, tex.ring, tex.star, tex.spark, tex.lance, tex.glyph, tex.glint, tex.mote, tex.clockFace, tex.wash, tex.digit3, tex.digit2, tex.digit1, tex.ribbonSoft, tex.ribbonBody], scale, seed, MAX_BULLET_SPRITES);
  }

  get liveDarts(): number { let n = 0; for (const d of this.darts) if (d.on) n++; return n; }
  get crawlingDarts(): number { let n = 0; for (const d of this.darts) if (d.on && d.phase === 'crawl') n++; return n; }
  get timeScale(): number { return this.timeK; }
  get clockVisible(): boolean { return this.clockOn; }

  private dartAt(i: number, tint: number): Dart | null {
    if (i < 0 || i >= MAX_DARTS) return null;
    let d = this.darts[i];
    if (!d) {
      // A cast missile: a crystal lance of light (additive: it glows), a soft halo, a time rune spinning at its head,
      // and a soft sparkling comet tail.
      const glow = this.take('glow', this.tex.glow, tint);
      const body = this.take('glow', this.tex.lance, tint);
      const rune = this.take('core', this.tex.glyph, 0xffffff);
      if (!glow || !body || !rune) { for (const q of [glow, body, rune]) this.give(q); return null; }
      body.anchor.set(0.97, 0.5);
      const trail = new RibbonTrail(this.layers.glow, this.tex.ribbonSoft, whiten(tint, 0.3), 'add');
      d = { body, glow, rune, trail, sparkAcc: 0, on: false, phase: 'hand', seed: this.rnd() * 100, tint, x: 0, y: 0, angle: 0, k: 1 };
      this.darts[i] = d;
    }
    return d;
  }

  /** The slow motion: every FX advances at `k` x the clock (1 = full speed). */
  setTimeScale(k: number): void { this.timeK = Number.isFinite(k) ? Math.min(1, Math.max(0.02, k)) : 1; }

  override update(dt: number): boolean { return super.update(dt * this.timeK); }

  /**
   * Dart `i` this frame: `sample(ms)` is its position on the clock, `te` the time to draw it at, `phase` where it is in
   * its life, `angle` its heading, `size` its scale, `tension` (0..1) the strain in the last beat before the snap.
   */
  setDart(i: number, sample: (ms: number) => Pt, te: number, phase: DartPhase, angle: number, size: number, tint: number, tension = 0): void {
    const d = this.darts[i] ?? (phase === 'fly' || phase === 'crawl' || phase === 'strike' ? this.dartAt(i, tint) : null);
    if (!d) return;
    const on = phase === 'fly' || phase === 'crawl' || phase === 'strike';
    d.on = on; d.phase = phase;
    d.body.visible = d.glow.visible = d.rune.visible = on;
    if (!on) { d.trail.hide(); return; }
    const S = this.scale;
    const p = sample(te);
    let x = p.x, y = p.y;
    const a = angle;
    if (phase === 'crawl' && tension > 0) {
      // The strain in the last beat before the snap: a fine vibration (the anticipation).
      const w = this.age * 0.08 + d.seed;
      x += Math.sin(w * 3.1) * 2.2 * tension * S;
      y += Math.cos(w * 2.3) * 2.2 * tension * S;
    }
    d.x = x; d.y = y; d.angle = a;
    const k = (this.look.dartPx * size * S) / DART_W;
    d.k = k;
    d.body.position.set(x, y); d.body.rotation = a; d.body.scale.set(k, k * 1.3); d.body.alpha = 1; d.body.tint = whiten(tint, 0.35);
    // The rune spins at the lance's head.
    const rk = (this.look.dartPx * size * S * 0.34) / GLYPH_PX;
    d.rune.position.set(x, y); d.rune.scale.set(rk); d.rune.rotation = this.age * 0.006 + d.seed; d.rune.tint = whiten(tint, 0.55); d.rune.alpha = 0.95;
    d.glow.position.set(x, y); d.glow.scale.set((this.look.dartPx * size * S * 1.1) / GLOW_PX);
    d.glow.alpha = phase === 'crawl' ? 0.6 + 0.2 * Math.sin(this.age * 0.012 + d.seed) + 0.2 * tension : 0.7;
    d.glow.tint = tint;
    if (this.look.trailMs > 0) {
      d.trail.mesh.tint = whiten(tint, 0.3);
      d.trail.draw(sample, te, this.look.trailMs, this.look.trailWidth * 1.6 * size * S, 0.85);
    }
  }

  /**
   * A blade drops into the slow motion: the TEAR it sliced through the air from `from` to `to` (a white-hot gold slash
   * over a wider violet rift glow) lingers for `ms` (FX time), and a tick ring flashes at its tip.
   */
  cut(from: Pt, to: Pt, ms: number, k = 1): void {
    const c = this.colors;
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > 4 && this.look.riftWidth > 0) {
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
      const rot = Math.atan2(dy, dx);
      const w = this.look.riftWidth * k * this.scale;
      // A MAGICAL RIFT, not a hard slash: a soft violet aurora, a shimmering gold seam and a thin white-hot thread of light
      // (soft-ended glows stretched along the cut), with time runes drifting off it.
      const G = len / GLOW_PX / this.scale;
      this.spawn('glow', this.tex.glow, c.violet, mx, my, { dur: ms + 180, from: G * 1.15, to: G * 1.2, sy: (w * 4.5) / len, a0: 0.6, mode: 'hold', ease: 'linear', rot });
      this.spawn('glow', this.tex.glow, c.gold, mx, my, { dur: ms + 140, from: G, to: G * 1.04, sy: (w * 1.8) / len, a0: 0.85, mode: 'hold', ease: 'linear', rot });
      this.spawn('core', this.tex.glint, 0xffffff, mx, my, { dur: ms * 0.7 + 90, from: len / 64 / this.scale, to: len / 64 / this.scale, sy: (8 * w * 0.5) / len, a0: 1, mode: 'hold', ease: 'linear', rot });
      // (A dome of dozens sheds one rune per rift; a few blades shed three.)
      const motes = k < 1 ? 1 : 3;
      for (let i = 0; i < motes; i++) {
        const u = 0.2 + this.rnd() * 0.6;
        const gs = (0.25 + this.rnd() * 0.2) * k;
        this.spawn('core', this.tex.glyph, i % 2 ? c.light : whiten(c.violet, 0.4), from.x + dx * u, from.y + dy * u, {
          dur: ms + 200, from: gs, to: gs * 0.6, a0: 0.85, mode: 'punch', peakAt: 0.25, ease: 'linear', vx: (this.rnd() - 0.5) * 30, vy: -25 - this.rnd() * 30, drag: 1, spin: (this.rnd() - 0.5) * 0.01,
        });
      }
    }
    this.freeze(to, k);
  }

  /** An afterimage peeling off a crawling blade: a ghost of it, fading where it was. */
  ghost(i: number, k = 1): void {
    const d = this.darts[i];
    if (!d || !d.on) return;
    const s = this.spawn('glow', this.tex.lance, mixColor(d.tint, this.colors.violet, 0.4), d.x, d.y, { dur: 110, from: d.k * k, to: d.k * k, sy: 1.3, a0: 0.45, ease: 'linear', rot: d.angle });
    if (s) s.anchor.set(0.97, 0.5);
  }

  /** A tick ring and a glint at a blade's tip. */
  freeze(at: Pt, k = 1): void {
    const c = this.colors;
    this.spawn('glow', this.tex.ring, c.light, at.x, at.y, { dur: 220, from: 0.05 * k, to: 0.35 * k, a0: 0.9, ease: 'cubic' });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 180, from: 0.3 * k, to: 0.9 * k, a0: 1, mode: 'punch', peakAt: 0.2, rot: 0.4 });
  }

  /** TIME STOPS: a ripple off the target, a violet flash, dust motes over the area. */
  stop(at: Pt, radius: number, area: { x: number; y: number; w: number; h: number }, motes: number, big: boolean): void {
    const c = this.colors;
    this.ripple(at, radius * (big ? 1.6 : 1));
    // The gold time ripple SWEEPS the whole screen as time stops.
    const far = Math.hypot(area.w, area.h);
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 620, from: (radius * 0.8) / RING_PX, to: (far * 1.1) / RING_PX / this.scale, a0: 0.75, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.light, at.x, at.y, { dur: 700, from: (radius * 0.5) / RING_PX, to: (far * 0.9) / RING_PX / this.scale, a0: 0.5, ease: 'cubic', delay: 70 });
    this.spawn('glow', this.tex.glow, c.violet, at.x, at.y, { dur: 260, from: (radius * 1.2) / GLOW_PX, to: (radius * 3) / GLOW_PX, a0: 0.5, mode: 'punch', peakAt: 0.15 });
    this.motes(area, motes);
  }

  /** A gold time ripple pulsing off the target (stopped time stays alive). */
  ripple(at: Pt, radius: number): void {
    const c = this.colors;
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 520, from: (radius * 0.6) / RING_PX, to: (radius * 3.2) / RING_PX, a0: 0.5, ease: 'cubic' });
  }

  /** Dust motes drifting slowly through stopped time. */
  motes(area: { x: number; y: number; w: number; h: number }, n: number): void {
    const c = this.colors;
    for (let i = 0; i < n; i++) {
      const sz = 0.5 + this.rnd() * 0.7;
      this.spawn('core', this.tex.mote, [c.light, c.gold, whiten(c.violet, 0.5)][i % 3]!, area.x + this.rnd() * area.w, area.y + this.rnd() * area.h, {
        dur: 900 + this.rnd() * 900, from: sz, to: sz * 0.8, a0: 0.7, mode: 'punch', peakAt: 0.3, ease: 'linear',
        vx: (this.rnd() - 0.5) * 30, vy: -10 - this.rnd() * 20, drag: 1, delay: this.rnd() * 300,
      });
    }
  }

  /** The clock over the target: its face and two hands at opacity `a` (null hides). */
  setClock(at: Pt, r: number, minute: number, a: number): void {
    if (!this.clock) {
      if (a <= 0.001) return;
      const c = this.colors;
      const face = this.take('glow', this.tex.clockFace, c.light);
      const glow = this.take('glow', this.tex.glow, c.violet);
      // The "hands" are two runes orbiting the circle (the long one the minutes, the short one the hours).
      const long = this.take('core', this.tex.glyph, c.light);
      const short = this.take('core', this.tex.glyph, whiten(c.violet, 0.4));
      if (!face || !glow || !long || !short) { for (const s of [face, glow, long, short]) this.give(s); return; }
      this.clock = { face, glow, long, short };
    }
    const k = this.clock;
    const on = a > 0.001;
    this.clockOn = on;
    k.face.visible = k.glow.visible = k.long.visible = k.short.visible = on;
    if (!on) return;
    // The circle turns slowly against its runes (a magic circle, alive).
    k.face.position.set(at.x, at.y); k.face.scale.set((r * 2) / (FACE_PX * 0.92)); k.face.alpha = 0.75 * a; k.face.rotation = -minute * 0.08;
    k.glow.position.set(at.x, at.y); k.glow.scale.set((r * 2.4) / GLOW_PX); k.glow.alpha = 0.22 * a;
    const la = minute - Math.PI / 2, sa = minute / 12 - Math.PI / 2 + 2.1;
    const lr = r * 0.9, sr = r * 0.62;
    k.long.position.set(at.x + Math.cos(la) * lr, at.y + Math.sin(la) * lr); k.long.scale.set((r * 0.22) / GLYPH_PX); k.long.rotation = minute * 2; k.long.alpha = a;
    // The orbiting rune CUTS through time too: sparks trail off it as it sweeps.
    this.handTip = { x: at.x + Math.cos(la) * lr, y: at.y + Math.sin(la) * lr };
    k.short.position.set(at.x + Math.cos(sa) * sr, at.y + Math.sin(sa) * sr); k.short.scale.set((r * 0.16) / GLYPH_PX); k.short.rotation = -minute; k.short.alpha = 0.9 * a;
  }

  /** A clock flash (III): the big face flares over the target and fades. */
  clockFlash(at: Pt, r: number): void {
    const c = this.colors;
    this.spawn('glow', this.tex.clockFace, c.gold, at.x, at.y, { dur: 480, from: (r * 1.6) / FACE_PX, to: (r * 2.2) / FACE_PX, a0: 0.9, mode: 'punch', peakAt: 0.12, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.light, at.x, at.y, { dur: 260, from: (r * 1.2) / GLOW_PX, to: (r * 2.4) / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.1 });
  }

  /** IV's countdown: a big digit slams in over the target and fades as the next comes. */
  count(at: Pt, n: 1 | 2 | 3, r: number, ms: number): void {
    const c = this.colors;
    const t = n === 3 ? this.tex.digit3 : n === 2 ? this.tex.digit2 : this.tex.digit1;
    const k = (r * 1.6) / DIGIT_PX;
    this.spawn('glow', this.tex.glow, c.violet, at.x, at.y, { dur: ms, from: (r * 2.4) / GLOW_PX, to: (r * 2) / GLOW_PX, a0: 0.5, mode: 'hold', ease: 'quint' });
    this.spawn('core', t, n === 1 ? 0xffffff : c.light, at.x, at.y, { dur: ms, from: k * 1.6, to: k, a0: 1, mode: 'hold', ease: 'quint' });
    this.spawn('glow', this.tex.ring, c.violet, at.x, at.y, { dur: ms * 0.8, from: (r * 0.8) / RING_PX, to: (r * 2.2) / RING_PX, a0: 0.7, ease: 'cubic' });
  }

  /** The glints: now and then one runs along a crawling blade's edge. */
  private glints(dt: number): void {
    this.glintAcc += dt;
    if (this.glintAcc < 45) return;
    this.glintAcc = 0;
    const hung = this.darts.filter((d) => d.on && d.phase === 'crawl');
    if (!hung.length) return;
    const d = hung[Math.floor(this.rnd() * hung.length)]!;
    const len = DART_W * d.k;
    const back = d.angle + Math.PI;
    const sx = d.x + Math.cos(back) * len * 0.8, sy = d.y + Math.sin(back) * len * 0.8;
    const sp = (len * 0.8) / 0.16; // run the length of the blade in 160 ms
    this.spawn('core', this.tex.glint, 0xffffff, sx, sy, {
      dur: 160, from: (len * 0.35) / 64 / this.scale, to: (len * 0.35) / 64 / this.scale, sy: 0.4, a0: 0.95, mode: 'punch', peakAt: 0.5, ease: 'linear',
      vx: (Math.cos(d.angle) * sp) / this.scale, vy: (Math.sin(d.angle) * sp) / this.scale, drag: 1, rot: d.angle,
    });
  }

  /** TIME RESTARTS: a hard snap (a white flash over the area, a shock ring off the target). */
  snap(at: Pt, radius: number, area: { x: number; y: number; w: number; h: number }, k = 1): void {
    const c = this.colors;
    this.spawn('glow', this.tex.wash, 0xffffff, area.x + area.w / 2, area.y + area.h / 2, {
      dur: 150, from: area.w / WASH_PX / this.scale, to: area.w / WASH_PX / this.scale, sy: area.h / area.w, a0: 0.55 * Math.min(1.2, k), mode: 'punch', peakAt: 0.08, ease: 'linear',
    });
    // A CHROMATIC burst: a cyan and a magenta ring split either side of the light one, and streaks flung outward.
    const o = radius * 0.12;
    this.spawn('glow', this.tex.ring, CHROMA_A, at.x - o, at.y, { dur: 300, from: (radius * 0.5) / RING_PX, to: (radius * 4.4 * k) / RING_PX, a0: 0.85, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, CHROMA_B, at.x + o, at.y, { dur: 300, from: (radius * 0.5) / RING_PX, to: (radius * 4.4 * k) / RING_PX, a0: 0.85, ease: 'cubic' });
    this.burst('glow', this.tex.streak, [c.light, CHROMA_A, CHROMA_B], at.x, at.y, Math.round(14 * k), { speed: 1500 * k, life: 260, size: 1.6 * k, drag: 0.2, align: true, to: 0.6 });
    this.spawn('glow', this.tex.ring, c.light, at.x, at.y, { dur: 260, from: (radius * 0.6) / RING_PX, to: (radius * 4 * k) / RING_PX, a0: 1, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.violet, at.x, at.y, { dur: 340, from: (radius * 0.4) / RING_PX, to: (radius * 3 * k) / RING_PX, a0: 0.7, ease: 'cubic', delay: 40 });
  }

  /** A hit (a tick, or the impact's own): a flash, a star, rings, sparks. */
  hit(at: Pt, dir: Pt, strength: number, sparks: number): void {
    const c = this.colors;
    const T = strength;
    this.spawn('core', this.tex.glow, whiten(c.light, 0.5), at.x, at.y, { dur: 150, from: (50 * T) / GLOW_PX, to: (150 * T) / GLOW_PX, a0: 0.95, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 180, from: (40 * T) / STAR_PX, to: (120 * T) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.15, rot: 0.3 });
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 280, from: (20 * T) / RING_PX, to: (170 * T) / RING_PX, a0: 0.9, ease: 'cubic' });
    this.burst('core', this.tex.spark, [c.light, c.gold, 0xffffff], at.x, at.y, sparks, { speed: 520 * T, dir: Math.atan2(-dir.y, -dir.x), spread: 2.6, life: 380, size: 0.6 * T, drag: 0.3, to: 0.3 });
    this.burst('glow', this.tex.streak, [c.light, c.gold], at.x, at.y, Math.round(6 + 2 * T), { speed: 1100 * T, life: 200, size: 1.1 * T, drag: 0.2, align: true, to: 0.5 });
  }

  /**
   * THE impact. I-III: a big gold hit with a violet ring. IV, the dome collapsing: the biggest in the roster: a white
   * core, a gold and violet fireball, four shock rings, the clock face blown outward, a storm of sparks and glints.
   */
  impact(at: Pt, dir: Pt, radius: number, tier: number, area: { x: number; y: number; w: number; h: number }): void {
    const c = this.colors;
    const X = this.look.impactSize * (1 + 0.15 * (tier - 1));
    this.hit(at, dir, 1.3 * X, 16 + 4 * tier);
    this.spawn('glow', this.tex.ring, c.violet, at.x, at.y, { dur: 420, from: (30 * X) / RING_PX, to: (260 * X) / RING_PX, a0: 0.8, ease: 'cubic', delay: 40 });
    // A RUNE-RING shockwave: the time circle itself blasts outward off the hit.
    this.spawn('glow', this.tex.clockFace, c.light, at.x, at.y, { dur: 460, from: (radius * 1.2) / FACE_PX, to: (radius * 3.4 * X) / FACE_PX, a0: 0.85, spin: 0.006, ease: 'cubic' });
    this.burst('core', this.tex.star, [c.light, 0xffffff, whiten(c.violet, 0.4)], at.x, at.y, 6 + 2 * tier, { speed: 520 * X, life: 520, size: (16 * X) / STAR_PX, drag: 0.3, spin: 0.02 });
    if (tier < 4) return;
    this.spawn('glow', this.tex.wash, mixColor(c.gold, 0xffffff, 0.5), area.x + area.w / 2, area.y + area.h / 2, {
      dur: 180, from: area.w / WASH_PX / this.scale, to: area.w / WASH_PX / this.scale, sy: area.h / area.w, a0: 0.3, mode: 'punch', peakAt: 0.08, ease: 'linear',
    });
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 360, from: (140 * X) / GLOW_PX, to: (520 * X) / GLOW_PX, a0: 1, mode: 'punch', peakAt: 0.06 });
    this.spawn('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 700, from: (200 * X) / GLOW_PX, to: (640 * X) / GLOW_PX, a0: 0.7, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.glow, c.violet, at.x, at.y, { dur: 900, from: (220 * X) / GLOW_PX, to: (760 * X) / GLOW_PX, a0: 0.5, mode: 'punch', peakAt: 0.2 });
    [c.light, c.gold, c.violet, 0xffffff].forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 560 + i * 140, from: (40 * X) / RING_PX, to: ((420 + i * 160) * X) / RING_PX, a0: 0.95, ease: 'cubic', delay: i * 60 }));
    this.spawn('glow', this.tex.clockFace, c.gold, at.x, at.y, { dur: 700, from: (radius * 2.6) / FACE_PX, to: (radius * 7 * X) / FACE_PX, a0: 0.85, spin: 0.004, ease: 'cubic' });
    this.burst('core', this.tex.spark, [c.light, c.gold, c.violet, 0xffffff], at.x, at.y, 70, { speed: 1000 * X, life: 700, size: 0.9 * X, drag: 0.35, to: 0.3 });
    this.burst('glow', this.tex.streak, [c.light, c.gold, c.violet, CHROMA_A, CHROMA_B], at.x, at.y, 26, { speed: 2000 * X, life: 380, size: 2.4 * X, drag: 0.2, align: true, to: 0.6 });
    this.spawn('glow', this.tex.ring, CHROMA_A, at.x - radius * 0.15, at.y, { dur: 480, from: (60 * X) / RING_PX, to: (700 * X) / RING_PX, a0: 0.7, ease: 'cubic', delay: 30 });
    this.spawn('glow', this.tex.ring, CHROMA_B, at.x + radius * 0.15, at.y, { dur: 480, from: (60 * X) / RING_PX, to: (700 * X) / RING_PX, a0: 0.7, ease: 'cubic', delay: 30 });
    this.burst('core', this.tex.star, [c.light, c.violet], at.x, at.y, 14, { speed: 640 * X, life: 600, size: (22 * X) / STAR_PX, drag: 0.3, spin: 0.02 });
    // Prismatic flecks and drifting runes (starlight, not debris).
    this.burst('core', this.tex.mote, [CHROMA_A, c.light, CHROMA_B, c.gold], at.x, at.y, 30, { speed: 760 * X, life: 900, size: 1.2 * X, drag: 0.4, to: 0.3 });
    this.burst('core', this.tex.glyph, [c.light, whiten(c.violet, 0.4)], at.x, at.y, 8, { speed: 420 * X, life: 900, size: 0.4 * X, drag: 0.3, spin: 0.01, to: 0.5 });
  }

  /**
   * THE KNOCKOUT's PRISMATIC collapse (on top of IV's impact): cyan, lilac and magenta shockwaves, a prism clock face
   * blown outward, prism streaks and glints.
   */
  koFlourish(at: Pt, radius: number): void {
    const X = this.look.impactSize * 1.5;
    [KO_CYAN, KO_LILAC, KO_MAGENTA].forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 700 + i * 120, from: (60 * X) / RING_PX, to: ((520 + i * 180) * X) / RING_PX, a0: 0.9, ease: 'cubic', delay: 40 + i * 70 }));
    this.spawn('glow', this.tex.clockFace, KO_MAGENTA, at.x, at.y, { dur: 760, from: (radius * 3) / FACE_PX, to: (radius * 9 * X) / FACE_PX, a0: 0.75, spin: -0.006, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, KO_CYAN, at.x, at.y, { dur: 820, from: (200 * X) / GLOW_PX, to: (640 * X) / GLOW_PX, a0: 0.5, mode: 'punch', peakAt: 0.15 });
    this.burst('glow', this.tex.streak, [KO_CYAN, KO_LILAC, KO_MAGENTA], at.x, at.y, 22, { speed: 2200 * X, life: 420, size: 2.4 * X, drag: 0.2, align: true, to: 0.6 });
    this.burst('core', this.tex.star, [KO_CYAN, KO_MAGENTA, 0xffffff], at.x, at.y, 12, { speed: 700 * X, life: 700, size: (24 * X) / STAR_PX, drag: 0.3, spin: 0.02 });
  }

  protected override tick(dt: number): boolean {
    this.age += dt;
    this.glints(dt);
    // The comet tails sparkle: specks of light shed off each flying missile (fewer when there are dozens).
    const every = this.darts.length > 12 ? 90 : 30;
    for (const d of this.darts) {
      if (!d.on || d.phase !== 'fly') continue;
      d.sparkAcc += dt;
      if (d.sparkAcc < every) continue;
      d.sparkAcc = 0;
      this.spawn('core', this.tex.star, whiten(d.tint, 0.5), d.x, d.y, { dur: 300, from: 0.22, to: 0.05, a0: 0.9, ease: 'linear', vx: (this.rnd() - 0.5) * 60, vy: (this.rnd() - 0.5) * 60, drag: 0.5, spin: 0.02 });
    }
    if (this.clockOn && this.handTip) {
      this.handAcc += dt;
      if (this.handAcc >= 14) {
        this.handAcc = 0;
        const h = this.handTip;
        this.spawn('core', this.tex.star, this.colors.light, h.x, h.y, { dur: 260, from: 0.25, to: 0.05, a0: 0.9, ease: 'linear' });
      }
    }
    let own = this.clockOn;
    for (const d of this.darts) if (d.on) { own = true; break; }
    return own;
  }

  protected override clearOwn(): void {
    for (const d of this.darts) { d.trail.hide(); for (const s of [d.body, d.glow, d.rune]) { s.visible = true; this.give(s); } }
    this.darts = [];
    if (this.clock) { for (const s of [this.clock.face, this.clock.glow, this.clock.long, this.clock.short]) { s.visible = true; this.give(s); } this.clock = null; this.clockOn = false; }
  }
}

