/**
 * PAID IN FULL'S SCENE: everything the rubber stamp attack draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroStamp.ts` mounts `root` on the above-portrait
 * overlay and feeds `update(dt)`.
 *
 * The STAMP is the subject: one sprite anchored on its rubber face, posed every frame by the pure `stampPose` (the
 * scene keeps its own clock from the charge, advanced by the same `dt` as the sequence, so the two never drift), with a
 * soft shadow on the struck portrait that tightens as it comes down. Big adds the INK PAD beside the striking hero: it
 * pops up, dips when tapped and drops away as the stamp leaves.
 *
 * A THUNK leaves a MARK: the seal (tinted with the ink) and its wet gloss (additive), which ride the struck portrait's
 * knockback. A mark pops in under the stamp, shines, dries (the gloss goes, the ink dulls toward the deep ink), then
 * fades; an older mark dims a little when a new one lands over it. Round it: a puff of paper dust either side of the
 * stamp and a few flung drops of ink; the last thunk of a big one adds a spray of droplets and a few blots round the seal.
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutBack, easeOutCubic, mixColor } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { newStampPose, stampPose, type StampPlan, type StampTrack } from './heroStampConfig';
import { DROP_PX, MARK_INK_PX, PAD_W, SPLAT_PX, STAMP_BASE_W, STAMP_FACE_Y, STAMP_TEX_H } from './heroStampTextures';

export interface HeroStampTextures extends HeroArcanaTextures {
  stampBody: Texture;
  stampMark: Texture;
  stampSkull: Texture;
  stampGloss: Texture;
  stampSkullGloss: Texture;
  stampPad: Texture;
  stampDrop: Texture;
  stampSplat: Texture;
}

export interface StampColors { ink: number; inkDeep: number; shine: number; dust: number }

export interface StampLook {
  /** The mark's diameter, in stamp base widths. */
  markSize: number;
}

/** Hard cap on sprites alive at once (a big impact peaks well under it). */
export const MAX_STAMP_SPRITES = 120;
/** Marks alive at once (one per thunk; the plan caps the thunks at five). */
export const MAX_STAMP_MARKS = 6;
const GLOW_PX = 128;

interface Mark {
  ink: Sprite; gloss: Sprite;
  x: number; y: number; k: number; rot: number;
  age: number; hold: number; fade: number;
  /** Dimmed by a newer mark landing over it. */
  under: boolean;
}

export class HeroStampScene extends FxPool {
  private plan: StampPlan | null = null;
  private track: StampTrack | null = null;
  private age = 0;
  private body: Sprite | null = null;
  private shadow: Sprite | null = null;
  private pad: Sprite | null = null;
  private padHit = -1;
  private readonly marks: Mark[] = [];
  private readonly pose = newStampPose();

  constructor(private readonly tex: HeroStampTextures, private readonly colors: StampColors, private readonly look: StampLook, scale = 1, seed = 1) {
    super('heroStamp', [tex.glow, tex.stampBody, tex.stampMark, tex.stampSkull, tex.stampGloss, tex.stampSkullGloss, tex.stampPad, tex.stampDrop, tex.stampSplat], scale, seed, MAX_STAMP_SPRITES);
  }

  /** The stamp is on screen (risen and not yet lifted away). */
  get hasStamp(): boolean { return this.body !== null; }
  /** The ink pad is up. */
  get hasPad(): boolean { return this.pad !== null; }
  /** Marks still on the struck portrait. */
  get liveMarks(): number { return this.marks.length; }

  /** The stamp rises out of the striking hero (and, big, the ink pad pops up beside it). `age0` = ms already elapsed. */
  start(plan: StampPlan, track: StampTrack, age0 = 0): void {
    if (this.body || plan.reduced || !track.contacts.length) return;
    const body = this.take('body', this.tex.stampBody, 0xffffff);
    const shadow = this.take('under', this.tex.glow, 0x000000);
    if (!body || !shadow) { this.give(body); this.give(shadow); return; }
    body.anchor.set(0.5, STAMP_FACE_Y / STAMP_TEX_H);
    body.alpha = 0; shadow.alpha = 0;
    this.plan = plan; this.track = track; this.age = Math.max(0, age0);
    this.body = body; this.shadow = shadow;
    if (track.pad) {
      const pad = this.take('under', this.tex.stampPad, 0xffffff);
      if (pad) { pad.position.set(track.pad.x, track.pad.y); pad.alpha = 0; this.pad = pad; }
    }
    this.padHit = -1;
    this.draw();
  }

  /** The stamp taps the ink pad: the pad dips, a small splat, a few drops hop up. */
  padTap(): void {
    const tr = this.track;
    if (!tr?.pad) return;
    this.padHit = this.age;
    const u = tr.padW / (this.scale * 100);
    this.spawn('under', this.tex.stampSplat, this.colors.ink, tr.pad.x, tr.pad.y, { dur: 320, from: (0.3 * u * 100) / SPLAT_PX, to: (0.6 * u * 100) / SPLAT_PX, a0: 0.9, rot: this.rnd() * 6 });
    this.burst('body', this.tex.stampDrop, [this.colors.ink, this.colors.inkDeep], tr.pad.x, tr.pad.y, 5, {
      speed: 300 * u, dir: -Math.PI / 2, spread: 2.2, life: 380, size: (0.09 * u * 100) / DROP_PX, grav: 1400 * u, drag: 0.4, to: 0.7,
    });
  }

  /** Thunk `i` lands: its mark, the dust, the ink. `final` is THE impact; `hold` and `fade` are the mark's life from now. */
  thunk(i: number, o: { final: boolean; big: boolean; skull: boolean; droplets: number; hold: number; fade: number }): void {
    const tr = this.track;
    const at = tr?.contacts[i];
    if (!tr || !at) return;
    const c = this.colors;
    const S = this.scale;
    const u = tr.w / (S * 100); // sizes below are written for a 100 px stamp
    const hard = o.final ? (o.big ? 1.35 : 1) : 0.7;
    const up = tr.upD;
    const side = { x: -up.y, y: up.x };
    // The mark (under the stamp), and its wet gloss.
    for (const m of this.marks) m.under = true;
    if (this.marks.length < MAX_STAMP_MARKS) {
      const ink = this.take('under', o.skull ? this.tex.stampSkull : this.tex.stampMark, c.ink);
      const gloss = this.take('glow', o.skull ? this.tex.stampSkullGloss : this.tex.stampGloss, c.shine);
      if (ink && gloss) {
        const k = (tr.w * this.look.markSize * (tr.sizes[i] ?? 1)) / MARK_INK_PX;
        const rot = tr.tilts[i] ?? 0;
        ink.rotation = rot; gloss.rotation = rot;
        this.marks.push({ ink, gloss, x: at.x, y: at.y, k, rot, age: 0, hold: Math.max(1, o.hold), fade: Math.max(1, o.fade), under: false });
        this.drawMark(this.marks[this.marks.length - 1]!);
      } else { this.give(ink); this.give(gloss); }
    }
    // Paper dust puffs out either side of the die.
    for (const s of [-1, 1]) {
      for (let j = 0; j < (o.final ? 2 : 1); j++) {
        const sp = (150 + 110 * this.rnd()) * hard * u;
        this.spawn('under', this.tex.glow, c.dust, at.x + side.x * s * tr.w * 0.4, at.y + side.y * s * tr.w * 0.4, {
          dur: 360 + 120 * this.rnd(), from: (46 * u) / GLOW_PX, to: (120 * hard * u) / GLOW_PX, a0: 0.7, ease: 'cubic',
          vx: side.x * s * sp + up.x * 40 * u * j, vy: side.y * s * sp + up.y * 40 * u * j - 30 * u, drag: 0.02, follow: true,
        });
      }
    }
    // Ink squeezed out from under the die: flung sideways and a little back up the handle.
    if (o.droplets > 0) {
      const n = o.final ? o.droplets : Math.max(2, Math.round(o.droplets * 0.3));
      for (const s of [-1, 1]) {
        this.burst('body', this.tex.stampDrop, [c.ink, c.inkDeep, c.ink], at.x + side.x * s * tr.w * 0.34, at.y + side.y * s * tr.w * 0.34, Math.ceil(n / 2), {
          speed: 430 * hard * u, dir: Math.atan2(side.y * s + up.y * 0.55, side.x * s + up.x * 0.55), spread: 1.5, life: 420, size: (0.085 * hard * u * 100) / DROP_PX,
          grav: 1500 * u, drag: 0.25, align: true, to: 0.6,
        });
      }
    }
    if (o.final && o.big) {
      // The hard one: a few blots land round the seal (never under it: the seal has to stay readable).
      for (let j = 0; j < 4; j++) {
        const a = this.rnd() * Math.PI * 2, r = tr.w * this.look.markSize * (0.56 + 0.16 * this.rnd());
        const sz = (0.2 + 0.16 * this.rnd()) * u * 100;
        this.spawn('under', this.tex.stampSplat, j % 2 ? c.inkDeep : c.ink, at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, {
          dur: o.hold + o.fade * 0.6, from: (sz * 0.5) / SPLAT_PX, to: sz / SPLAT_PX, a0: 0.85, mode: 'hold', rot: this.rnd() * 6, follow: true, delay: 20 + 25 * j,
        });
      }
    }
  }

  protected override tick(dt: number): boolean {
    this.age += dt;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]!;
      m.age += dt;
      if (m.age >= m.hold + m.fade) { this.give(m.ink); this.give(m.gloss); this.marks.splice(i, 1); continue; }
      this.drawMark(m);
    }
    this.draw();
    return this.body !== null || this.pad !== null || this.marks.length > 0;
  }

  private drawMark(m: Mark): void {
    const pop = m.age < 80 ? 0.82 + 0.18 * easeOutBack(m.age / 80, 2.4) : 1;
    const out = m.age < m.hold ? 1 : 1 - clamp01((m.age - m.hold) / m.fade);
    // Wet for the first part of its hold, then dry: the shine goes and the ink dulls.
    const wet = 1 - clamp01(m.age / (m.hold * 0.75));
    const x = m.x + this.fox, y = m.y + this.foy;
    m.ink.position.set(x, y); m.ink.scale.set(m.k * pop);
    m.ink.tint = mixColor(mixColor(this.colors.ink, this.colors.inkDeep, 0.4), this.colors.ink, wet);
    m.ink.alpha = (m.under ? 0.36 : 0.96) * out;
    m.gloss.position.set(x, y); m.gloss.scale.set(m.k * pop);
    m.gloss.alpha = 0.8 * wet * wet * out * (m.under ? 0.25 : 1);
  }

  private draw(): void {
    const p = this.plan, tr = this.track;
    if (!p || !tr) return;
    const t = p.chargeAt + this.age;
    const body = this.body, shadow = this.shadow;
    if (body && shadow) {
      const q = stampPose(p, tr, t, this.pose);
      if (q.alpha <= 0 && t > p.impactAt) {
        this.give(body); this.give(shadow); this.body = null; this.shadow = null;
      } else {
        const k = tr.w / STAMP_BASE_W;
        // Over the struck portrait it rides the knockback it causes (so the die never floats off the mark).
        const ride = q.target >= 0 && t >= p.thunks[0]! ? 1 : 0;
        body.position.set(q.x + this.fox * ride, q.y + this.foy * ride);
        body.rotation = q.rot; body.scale.set(k * q.sx, k * q.sy); body.alpha = q.alpha;
        const hit = q.target >= 0 ? tr.contacts[q.target] : undefined;
        if (hit) {
          const dist = Math.hypot(q.x - hit.x, q.y - hit.y);
          const near = 1 - clamp01(dist / (tr.w * 1.6));
          shadow.position.set(hit.x + this.fox, hit.y + this.foy);
          shadow.scale.set((tr.w * (1.5 + 0.9 * (1 - near))) / GLOW_PX);
          shadow.alpha = 0.5 * near * near * q.alpha;
        } else shadow.alpha = 0;
      }
    }
    const pad = this.pad;
    if (pad && tr.pad) {
      const k = tr.padW / PAD_W;
      const since = t - p.chargeAt - 40;
      const gone = t - p.launchAt - 60;
      if (gone >= 220) { this.give(pad); this.pad = null; } else {
        const pop = since <= 0 ? 0 : easeOutBack(since / 200, 2);
        const dip = this.padHit >= 0 ? 0.16 * Math.exp(-(this.age - this.padHit) / 90) * Math.cos((this.age - this.padHit) * 0.03) : 0;
        const leave = gone > 0 ? easeOutCubic(gone / 220) : 0;
        pad.alpha = clamp01(since / 80) * (1 - leave);
        pad.scale.set(k * pop * (1 + dip * 0.4) * (1 - 0.15 * leave), k * pop * (1 - dip) * (1 - 0.15 * leave));
        pad.position.set(tr.pad.x, tr.pad.y + tr.padW * (0.12 * leave + 0.055)); // the felt sits a little above the tin's centre
      }
    }
  }

  protected override clearOwn(): void {
    this.give(this.body); this.give(this.shadow); this.give(this.pad);
    this.body = null; this.shadow = null; this.pad = null;
    for (const m of this.marks) { this.give(m.ink); this.give(m.gloss); }
    this.marks.length = 0;
    this.plan = null; this.track = null;
  }
}
