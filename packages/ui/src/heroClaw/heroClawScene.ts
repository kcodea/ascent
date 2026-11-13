/**
 * THE GRABBY CLAW SCENE: everything the claw machine draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroClaw.ts` mounts `root` on the above-portrait
 * overlay, hands it the pose each frame (`setPose`) and feeds `update(dt)`.
 *
 * THE CLAW is the subject: a cable stretched from the top of the view to the hub, the chrome hub with its lamp, two
 * SIDE prongs (one texture, mirrored) that each rotate about their hinge on the hub, and a FRONT prong seen end on that
 * shortens as it opens. The whole claw turns about the hub when the load swings. It is drawn OVER the struck portrait
 * (the overlay sits above the DOM), which is what makes the prongs read as wrapped round it.
 *
 * THE PRIZE CHUTE stands in the `under` layer (still above the DOM): the portrait drops BEHIND its face, which is why
 * the texture is opaque. Its two lamps and the WINNER sign are sprites of their own.
 *
 * Everything else is short seasoning from the pool: a glint on the clamp, coins on a shake, dust and a ring on a
 * landing, sparks out of the chute mouth, a ring where the portrait pops back.
 *
 * Contract: the claw's and the chute's sprites are taken ONCE, at construction, in draw order, and only ever moved or
 * hidden; the pool is capped at `MAX_CLAW_SPRITES`; textures are the caller's (pre-warmed during the damage formation);
 * positions are the overlay's px; `hideOwn()` hides the claw, the chute and the sign at once (every exit path calls
 * it); `destroy()` leaves nothing behind. Scatter is seeded (a replay drops the same coins).
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import type { ChuteBox, ClawGeo, ClawPose } from './heroClawConfig';
import {
  CABLE_H, CHUTE_LAMPS, CHUTE_W, CLAW_REF_R, FINGER_H, FINGER_PIVOT, HUB_H, HUB_LUG, PRONG_H, PRONG_PIVOT, PRONG_W, WINNER_W,
} from './heroClawTextures';

export interface HeroClawTextures extends HeroArcanaTextures {
  cable: Texture;
  hub: Texture;
  /** One side prong, closed; drawn twice (mirrored). */
  prong: Texture;
  /** The front prong, end on. */
  finger: Texture;
  chute: Texture;
  winner: Texture;
  coin: Texture;
}

export interface ClawColors { chrome: number; lamp: number; coin: number; dust: number; side: number }

/** Hard cap on sprites alive at once (the Prize peaks around 70). */
export const MAX_CLAW_SPRITES = 160;
/** How far a side prong swings open (radians). */
export const PRONG_OPEN_RAD = 0.44;
const GLOW_PX = 128;
const RING_PX = 160;

export class HeroClawScene extends FxPool {
  private readonly cable: Sprite | null;
  private readonly prongL: Sprite | null;
  private readonly prongR: Sprite | null;
  private readonly hub: Sprite | null;
  private readonly finger: Sprite | null;
  private readonly lamp: Sprite | null;
  private readonly chute: Sprite | null;
  private readonly chuteLamps: (Sprite | null)[];
  private readonly winner: Sprite | null;
  /** Px per texture px: the struck portrait's radius over the radius the textures were painted for. */
  private readonly k: number;
  private clawOn = false;
  private chuteOn = false;
  private age = 0;

  constructor(private readonly tex: HeroClawTextures, private readonly colors: ClawColors, private readonly radius: number, clawSize: number, scale = 1, seed = 1) {
    super('heroClaw', [tex.glow, tex.streak, tex.ring, tex.star, tex.cable, tex.hub, tex.prong, tex.finger, tex.chute, tex.winner, tex.coin], scale, seed, MAX_CLAW_SPRITES);
    this.k = (radius / CLAW_REF_R) * clawSize;
    // Taken once, in draw order: the chute under everything; the cable behind the prongs, the hub over their hinges,
    // the front prong over the hub; the sign on top.
    this.chute = this.take('under', tex.chute, 0xffffff);
    this.cable = this.take('body', tex.cable, 0xffffff);
    this.prongL = this.take('body', tex.prong, colors.chrome);
    this.prongR = this.take('body', tex.prong, colors.chrome);
    this.hub = this.take('body', tex.hub, colors.chrome);
    this.finger = this.take('body', tex.finger, colors.chrome);
    this.winner = this.take('body', tex.winner, 0xffffff);
    this.lamp = this.take('core', tex.glow, colors.lamp);
    this.chuteLamps = [this.take('core', tex.glow, colors.lamp), this.take('core', tex.glow, colors.lamp)];
    this.cable?.anchor.set(0.5, 0);
    this.prongL?.anchor.set(PRONG_PIVOT.x / PRONG_W, PRONG_PIVOT.y / PRONG_H);
    this.prongR?.anchor.set(PRONG_PIVOT.x / PRONG_W, PRONG_PIVOT.y / PRONG_H);
    this.finger?.anchor.set(0.5, FINGER_PIVOT.y / FINGER_H);
    this.chute?.anchor.set(0.5, 0);
    this.hideOwn();
  }

  /** The claw is on screen. */
  get clawVisible(): boolean { return this.clawOn; }
  /** The chute is on screen. */
  get chuteVisible(): boolean { return this.chuteOn; }
  /** How open the side prongs are drawn (radians from closed; 0 = clamped). */
  get prongAngle(): number { return this.prongR ? (this.hub?.rotation ?? 0) - this.prongR.rotation : 0; }

  /** Hide the claw, the chute, its lamps and the sign (every exit path; the pool keeps them). */
  hideOwn(): void {
    for (const s of [this.cable, this.prongL, this.prongR, this.hub, this.finger, this.lamp, this.chute, this.winner, ...this.chuteLamps]) if (s) s.alpha = 0;
    this.clawOn = false; this.chuteOn = false;
  }

  /** Draw the claw (and, on the Prize, the chute, its lamps and the sign) for this frame's pose. No allocation. */
  setPose(p: ClawPose, g: ClawGeo): void {
    if (this.destroyed) return;
    const k = this.k;
    const a = p.calpha;
    this.clawOn = a > 0.004;
    const { cable, prongL, prongR, hub, finger, lamp } = this;
    if (cable && prongL && prongR && hub && finger && lamp) {
      if (!this.clawOn) {
        cable.alpha = prongL.alpha = prongR.alpha = hub.alpha = finger.alpha = lamp.alpha = 0;
      } else {
        const cs = Math.cos(p.crot), sn = Math.sin(p.crot);
        const open = p.open * PRONG_OPEN_RAD;
        hub.position.set(p.hx, p.hy); hub.rotation = p.crot; hub.scale.set(k); hub.alpha = a;
        const lx = HUB_LUG.x * k, ly = HUB_LUG.y * k;
        prongR.position.set(p.hx + lx * cs - ly * sn, p.hy + lx * sn + ly * cs);
        prongR.rotation = p.crot - open; prongR.scale.set(k); prongR.alpha = a;
        prongL.position.set(p.hx - lx * cs - ly * sn, p.hy - lx * sn + ly * cs);
        prongL.rotation = p.crot + open; prongL.scale.set(-k, k); prongL.alpha = a;
        const fy = 30 * k;
        finger.position.set(p.hx - fy * sn, p.hy + fy * cs);
        finger.rotation = p.crot; finger.scale.set(k, k * (1 - 0.42 * Math.min(1, p.open))); finger.alpha = a;
        // The cable: from the trolley above the view to the collar on top of the hub.
        const ty = (HUB_H / 2 - 6) * k;
        const ex = p.hx + ty * sn, ey = p.hy - ty * cs;
        const dx = ex - p.tx, dy = ey - g.topY;
        const len = Math.hypot(dx, dy);
        cable.position.set(p.tx, g.topY); cable.rotation = -Math.atan2(dx, dy); cable.scale.set(k, len / CABLE_H); cable.alpha = a;
        // The lamp glows while it holds something, and flickers while the servo runs.
        lamp.position.set(p.hx + 5 * k * sn, p.hy - 5 * k * cs);
        lamp.scale.set((52 * k) / GLOW_PX);
        lamp.alpha = a * (p.held ? 0.85 : 0.3 + 0.25 * Math.sin(this.age * 0.03));
      }
    }
    const { chute, winner } = this;
    const box = g.chute;
    this.chuteOn = !!box && p.chute > 0.004;
    if (chute) {
      if (!box || !this.chuteOn) {
        chute.alpha = 0; if (winner) winner.alpha = 0;
        for (const l of this.chuteLamps) if (l) l.alpha = 0;
      } else {
        const sc = box.w / CHUTE_W;
        const sink = (1 - Math.min(1, p.chute)) * box.h * 0.45;
        const ca = clamp01(p.chute * 1.8);
        chute.position.set(box.x, box.y + sink); chute.scale.set(sc * (0.96 + 0.04 * Math.min(1.1, p.chute)), sc); chute.alpha = ca;
        for (let i = 0; i < this.chuteLamps.length; i++) {
          const l = this.chuteLamps[i];
          if (!l) continue;
          const at = CHUTE_LAMPS[i]!;
          l.position.set(box.x + (at.x - CHUTE_W / 2) * sc, box.y + sink + at.y * sc);
          l.scale.set((70 * sc) / GLOW_PX);
          l.alpha = ca * p.lamp;
        }
        if (winner) {
          if (p.winAlpha <= 0.004) winner.alpha = 0;
          else {
            const ws = ((this.radius * 2.9) / WINNER_W) * p.win;
            winner.position.set(box.x, box.y - this.radius * 0.72);
            winner.scale.set(ws); winner.rotation = -0.05; winner.alpha = p.winAlpha;
          }
        }
      }
    }
  }

  // ── the seasoning ─────────────────────────────────────────────────────────────────────────────────────────

  /** A size in texture px for a portrait of radius 100, as the pool's `from` / `to` (it multiplies by the stage scale). */
  private u(v: number): number { return (v * this.k) / (this.scale || 1); }

  /** The clamp bites: a glint at each side pad and a tight ring round the portrait. */
  grab(x: number, y: number): void {
    const R = this.radius;
    for (const sgn of [-1, 1]) {
      this.spawn('core', this.tex.star, 0xffffff, x + sgn * R * 0.9, y + R * 0.42, { dur: 220, from: this.u(0.3), to: this.u(1.3), a0: 0.95, mode: 'punch', peakAt: 0.25, spin: 0.006 * sgn, follow: true });
    }
    this.spawn('glow', this.tex.ring, this.colors.side, x, y, { dur: 240, from: this.u(1.55), to: this.u(1.3), a0: 0.5, mode: 'punch', peakAt: 0.2, follow: true });
  }

  /** A hard shake: coins and a couple of glints fall out of the portrait, thrown the way it was flung. */
  shakeOut(x: number, y: number, dir: number, coins: number): void {
    const R = this.radius;
    const dark = mixColor(this.colors.coin, 0x5a3200, 0.6);
    this.burst('body', this.tex.coin, [this.colors.coin], x, y + R * 0.35, coins, {
      speed: 300 * (R / 100), dir: Math.PI / 2 - dir * 0.9, spread: 1.5, life: 620, size: this.u(0.95), grav: 1900 * (R / 100), drag: 0.55,
      flip: 0.022, spin: 0.01, edgeTint: dark, mode: 'hold', to: 1, lift: 120 * (R / 100),
    });
    for (let i = 0; i < 2; i++) {
      this.spawn('core', this.tex.star, 0xffffff, x + (this.rnd() - 0.5) * R * 1.2, y + R * (0.2 + this.rnd() * 0.6), { dur: 260, from: this.u(0.2), to: this.u(0.9), a0: 0.9, mode: 'punch', peakAt: 0.3, vy: 160, delay: i * 50 });
    }
  }

  /**
   * THE landing (Fumble, Shake). Dropped: dust thrown out along the bottom of the socket, a flat ring, a flash and a
   * few sparks. `slam` (yanked home from below): the socket catches it, so the ring is round it and the sparks fly
   * down and out from its rim.
   */
  land(x: number, y: number, o: { level: number; sparks: number; flashAlpha: number; slam?: boolean }): void {
    const R = this.radius;
    const big = o.level >= 2 ? 1.35 : 1;
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 200, from: this.u(1.2), to: this.u(2.3 * big), a0: o.flashAlpha * 0.55 });
    if (o.slam) {
      this.spawn('glow', this.tex.ring, this.colors.side, x, y, { dur: 340, from: this.u(1.2), to: this.u(2.1 * big), a0: 0.75 });
      if (o.level >= 2) this.spawn('glow', this.tex.ring, 0xffffff, x, y, { dur: 460, from: this.u(1.2), to: this.u(2.8 * big), a0: 0.4, delay: 40 });
      this.burst('core', this.tex.streak, [0xffffff, this.colors.side, this.colors.dust], x, y + R * 0.5, o.sparks, { speed: 560 * (R / 100), dir: Math.PI / 2, spread: 2.6, life: 280, size: this.u(0.36), grav: 700, drag: 0.1, align: true });
      for (let i = 0; i < 4; i++) {
        const a = Math.PI * (0.15 + 0.7 * (i / 3));
        this.spawn('core', this.tex.star, 0xffffff, x + Math.cos(a) * R * 1.05, y + Math.sin(a) * R * 1.05, { dur: 280, from: this.u(0.2), to: this.u(1), a0: 0.9, mode: 'punch', peakAt: 0.3, delay: i * 25 });
      }
      return;
    }
    const by = y + R * 0.82;
    this.spawn('glow', this.tex.ring, this.colors.side, x, by, { dur: 360, from: this.u(0.5), to: this.u(2.2 * big), a0: 0.7, sy: 0.3 });
    if (o.level >= 2) this.spawn('glow', this.tex.ring, 0xffffff, x, by, { dur: 460, from: this.u(0.4), to: this.u(3 * big), a0: 0.4, sy: 0.3, delay: 40 });
    const puffs = o.level >= 2 ? 10 : 6;
    for (let i = 0; i < puffs; i++) {
      const sgn = i % 2 === 0 ? 1 : -1;
      const sp = (160 + this.rnd() * 260) * big * (R / 100);
      this.spawn('under', this.tex.glow, this.colors.dust, x + sgn * R * (0.3 + this.rnd() * 0.4), by + (this.rnd() - 0.5) * R * 0.12, {
        dur: 420 + this.rnd() * 220, from: this.u(0.35), to: this.u(0.9 + this.rnd() * 0.5), a0: 0.5, vx: sgn * sp, vy: -(30 + this.rnd() * 90) * (R / 100), drag: 0.02, ease: 'cubic',
      });
    }
    this.burst('core', this.tex.streak, [0xffffff, this.colors.side, this.colors.dust], x, by, o.sparks, { speed: 520 * (R / 100), dir: -Math.PI / 2, spread: 2.9, life: 260, size: this.u(0.34), grav: 900, drag: 0.1, align: true });
  }

  /** THE drop into the chute (Prize): a flash in the mouth, sparks and stars thrown up out of it, a ring on the rim. */
  swallow(box: ChuteBox, o: { sparks: number; flashAlpha: number }): void {
    const R = this.radius;
    const x = box.x, y = box.y + R * 0.1;
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 240, from: this.u(1.4), to: this.u(3), a0: o.flashAlpha * 0.6, sy: 0.5 });
    this.spawn('glow', this.tex.ring, this.colors.coin, x, y, { dur: 420, from: this.u(0.6), to: this.u(2.8), a0: 0.75, sy: 0.28 });
    this.spawn('glow', this.tex.ring, this.colors.side, x, y, { dur: 560, from: this.u(0.5), to: this.u(3.6), a0: 0.45, sy: 0.28, delay: 60 });
    this.burst('core', this.tex.streak, [0xffffff, this.colors.coin, this.colors.side], x, y, o.sparks, { speed: 760 * (R / 100), dir: -Math.PI / 2, spread: 1.7, life: 340, size: this.u(0.4), grav: 1400, drag: 0.12, align: true });
    for (let i = 0; i < 6; i++) {
      this.spawn('core', this.tex.star, i % 2 ? this.colors.coin : 0xffffff, x + (this.rnd() - 0.5) * box.w * 0.8, y - this.rnd() * R * 0.4, {
        dur: 420 + this.rnd() * 200, from: this.u(0.25), to: this.u(0.9 + this.rnd() * 0.6), a0: 0.95, mode: 'punch', peakAt: 0.3, vy: -(140 + this.rnd() * 220), drag: 0.2, spin: 0.004, delay: i * 35,
      });
    }
  }

  /** WINNER: glints round the sign. */
  win(box: ChuteBox): void {
    const R = this.radius;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + this.rnd() * 0.5;
      this.spawn('core', this.tex.star, i % 2 ? this.colors.coin : 0xffffff, box.x + Math.cos(a) * R * 1.5, box.y - R * 0.72 + Math.sin(a) * R * 0.6, {
        dur: 380 + this.rnd() * 240, from: this.u(0.2), to: this.u(1 + this.rnd() * 0.5), a0: 1, mode: 'punch', peakAt: 0.3, spin: 0.005, delay: i * 45,
      });
    }
  }

  /** The portrait pops back up in its socket: a ring out from it and a few glints. */
  pop(x: number, y: number): void {
    const R = this.radius;
    this.spawn('glow', this.tex.ring, this.colors.side, x, y, { dur: 380, from: this.u(0.5), to: this.u(290 / RING_PX), a0: 0.7 });
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 200, from: this.u(0.8), to: this.u(1.9), a0: 0.35 });
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i - 1.5) * 0.7;
      this.spawn('core', this.tex.star, 0xffffff, x + Math.cos(a) * R * 1.05, y + Math.sin(a) * R * 1.05, { dur: 300, from: this.u(0.2), to: this.u(0.9), a0: 0.9, mode: 'punch', peakAt: 0.3, delay: i * 30 });
    }
  }

  // ── the pool's hooks ──────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    this.age += dt;
    return this.clawOn || this.chuteOn;
  }

  protected override clearOwn(): void { this.hideOwn(); }
}
