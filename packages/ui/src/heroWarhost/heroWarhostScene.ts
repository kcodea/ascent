/**
 * THE WARHOST SCENE: everything the Warhost draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroWarhost.ts` mounts `root` on the above-portrait overlay, hands it the staged
 * look once (`deploy`: every soldier, shot and banner gets its sprite up front, in draw order, while the damage
 * formation is still playing), then each frame calls `paint(t)` (every one of them placed from the clock by the pure
 * `troopAt` / `shotAt`) and `update(dt)` (the fire-and-forget dust and flashes).
 *
 * AN ARMY OF TINY SOLDIERS: each is one sprite cut from the one atlas, with a two-frame run cycle, a bob, a lean into
 * the run and a flip for his heading; the poses (stand, wind-up, throw, cheer, draw, release) are frames of the same
 * atlas, picked from the clock. Riders gallop on two frames with a rocking bob. Spears and arrows turn along their
 * arc, stick, twang and fade; a stuck one rides the struck portrait's knockback. Banners rise on a spring and ripple
 * on two frames with a little skew. Dust is the only "particle": step puffs under the feet, clouds over the trample.
 *
 * Perf: one sprite per soldier (the host: under 400), all from one texture source (one batch per layer); `paint` does
 * a lerp, a sine and at most one texture swap per soldier and allocates nothing; dust is pooled and capped (a step
 * puff only from every few soldiers); nothing is filtered or masked.
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { mixColor, spring, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA } from '../heroAttack/knockout';
import { WARHOST_RELOAD_MS, shotAt, troopAt, type Banner, type Shot, type ShotAt, type Troop, type TroopAt, type WarhostStage } from './heroWarhostConfig';
import {
  ARROW_W, BANNER_AX, BANNER_AY, BANNER_H, CAV_AX, CAV_AY, CAV_H, DUST_PX, FOOT_AX, FOOT_AY, FOOT_H, SPEAR_W,
} from './heroWarhostTextures';

export interface HeroWarhostTextures extends HeroArcanaTextures {
  /** The foot soldier: two run frames, a stand, the wind-up, the throw, the cheer, two empty-handed run frames. */
  infA: Texture; infB: Texture; infStand: Texture; spearWind: Texture; spearThrown: Texture; cheer: Texture; bareA: Texture; bareB: Texture;
  /** The archer: two run frames, a stand, the draw, the release. */
  archA: Texture; archB: Texture; archStand: Texture; archDraw: Texture; archLoose: Texture;
  /** The rider: the stretch and the gather of the gallop. */
  cavA: Texture; cavB: Texture;
  bannerA: Texture; bannerB: Texture;
  spear: Texture; arrow: Texture;
  dust: Texture;
}

export interface WarhostColors { red: number; brass: number; dust: number; side: number }

export interface WarhostLook { soldierPx: number; cavalryPx: number; dust: number; impactSize: number }

/** Hard cap on sprites alive at once (the biggest host the caps allow, its arrows and its dust sit under it). */
export const MAX_WARHOST_SPRITES = 900;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
/** A run frame lasts this long (a pattering little stride); a gallop frame a touch longer. */
const FOOT_STRIDE = 92;
const CAV_STRIDE = 112;
/** The rear ranks shade toward this. */
const SHADE = 0x5a3c30;
const WOOD = 0x9b6a36;

interface TroopSprite { spec: Troop; s: Sprite; tex: Texture | null; on: boolean; x: number; y: number; a: number; nextDust: number }
interface ShotSprite { spec: Shot; s: Sprite }
interface BannerSprite { spec: Banner; s: Sprite; i: number }

export class HeroWarhostScene extends FxPool {
  private troops: TroopSprite[] = [];
  private shots: ShotSprite[] = [];
  private banners: BannerSprite[] = [];
  private face = 1;
  private ownLive = false;
  private readonly ta: TroopAt = { x: 0, y: 0, state: 'wait', alpha: 0, dir: 1 };
  private readonly sa: ShotAt = { x: 0, y: 0, rot: 0, state: 'wait', alpha: 0 };

  constructor(private readonly tex: HeroWarhostTextures, private readonly colors: WarhostColors, private readonly look: WarhostLook, scale = 1, seed = 1) {
    super('heroWarhost', [tex.glow, tex.ring, tex.star, tex.spark, tex.streak, tex.infA], scale, seed, MAX_WARHOST_SPRITES);
  }

  /** Soldiers on screen this frame. */
  get liveTroops(): number { let n = 0; for (const q of this.troops) if (q.on) n++; return n; }
  get deployedTroops(): number { return this.troops.length; }
  /** Soldiers on screen this frame drawn facing right (the rest face left). */
  get liveFacingRight(): number { let n = 0; for (const q of this.troops) if (q.on && q.s.scale.x > 0) n++; return n; }
  /** Spears and arrows in the air or stuck this frame. */
  get liveShots(): number { let n = 0; for (const q of this.shots) if (q.s.visible) n++; return n; }
  get liveBanners(): number { let n = 0; for (const q of this.banners) if (q.s.visible) n++; return n; }

  /**
   * Take a sprite for every soldier, shot and banner of the staged look, in draw order (the striker's banners at the
   * back, then the soldiers far to near, then the shots, then the planted banner). All hidden until their time.
   */
  deploy(stage: WarhostStage): void {
    this.face = stage.face;
    const hold = (s: Sprite | null, ax: number, ay: number): Sprite | null => { if (s) { s.anchor.set(ax, ay); s.visible = false; } return s; };
    stage.banners.forEach((spec, i) => {
      if (spec.follow) return;
      const s = hold(this.take('body', this.tex.bannerA, 0xffffff), BANNER_AX, BANNER_AY);
      if (s) this.banners.push({ spec, s, i });
    });
    // Each soldier's sprite is taken far to near, but kept at his index in the stage (a banner's carrier is an index).
    const order = stage.troops.map((_, i) => i).sort((p, q) => stage.troops[p]!.z - stage.troops[q]!.z);
    const made: (TroopSprite | null)[] = stage.troops.map(() => null);
    for (const i of order) {
      const spec = stage.troops[i]!;
      const cav = spec.unit === 'cav';
      const s = hold(this.take('body', cav ? this.tex.cavA : this.tex.infA, spec.shade > 0 ? mixColor(0xffffff, SHADE, spec.shade) : 0xffffff), cav ? CAV_AX : FOOT_AX, cav ? CAV_AY : FOOT_AY);
      if (s) made[i] = { spec, s, tex: null, on: false, x: spec.p0.x, y: spec.p0.y, a: 0, nextDust: spec.t0 };
    }
    this.troopAtIndex = made;
    for (const q of made) if (q) this.troops.push(q);
    for (const spec of stage.shots) {
      const s = hold(this.take('body', spec.kind === 'spear' ? this.tex.spear : this.tex.arrow, 0xffffff), 1, 0.5);
      if (s) this.shots.push({ spec, s });
    }
    stage.banners.forEach((spec, i) => {
      if (!spec.follow) return;
      const s = hold(this.take('body', this.tex.bannerA, 0xffffff), BANNER_AX, BANNER_AY);
      if (s) this.banners.push({ spec, s, i });
    });
  }

  private troopAtIndex: (TroopSprite | null)[] = [];

  /** Place every soldier, shot and banner for sequence time `t`. Allocation-free. */
  paint(t: number): void {
    if (this.destroyed) return;
    const S = this.scale, T = this.tex;
    let live = false;
    const o = this.ta;
    for (const q of this.troops) {
      const tr = q.spec;
      troopAt(tr, t, o);
      q.x = o.x; q.y = o.y; q.a = o.alpha;
      if (o.state === 'wait' || o.state === 'gone') { q.on = false; if (q.s.visible) q.s.visible = false; continue; }
      live = true; q.on = true;
      const cav = tr.unit === 'cav';
      const moving = o.state !== 'hold';
      const cyc = (t + tr.phase) / (cav ? CAV_STRIDE : FOOT_STRIDE);
      const second = moving && (Math.floor(cyc) & 1) === 1;
      const step = moving ? Math.abs(Math.sin(cyc * Math.PI)) : 0;
      let tex: Texture;
      let lift = 0, rot = 0;
      if (cav) {
        tex = second ? T.cavB : T.cavA;
        lift = step * 4; rot = o.dir * Math.sin(cyc * Math.PI) * 0.055;
      } else {
        lift = step * 2.6; rot = moving ? o.dir * 0.07 : 0;
        switch (tr.unit) {
          case 'inf': tex = second ? T.infB : T.infA; break;
          case 'spear':
            if (o.state === 'out') tex = second ? T.infB : T.infA;
            else if (o.state === 'back') tex = second ? T.bareB : T.bareA;
            else if (t < tr.actAt) tex = T.infStand;
            else if (t < tr.looseAt) { tex = T.spearWind; rot = -o.dir * 0.16 * Math.min(1, (t - tr.actAt) / 90); }
            else if (tr.cheerAt < 0 || t < tr.cheerAt) { tex = T.spearThrown; rot = o.dir * 0.2 * Math.max(0, spring(t - tr.looseAt, 3, 90)); }
            else { tex = T.cheer; lift = hop(t - tr.cheerAt, 2); }
            break;
          case 'archer':
            if (moving) tex = second ? T.archB : T.archA;
            else if (t < tr.actAt) tex = T.archStand;
            else if (t < tr.looseAt) tex = T.archDraw;
            else if (t <= tr.lastLooseAt) tex = (t - tr.looseAt) % WARHOST_RELOAD_MS < 40 ? T.archLoose : T.archDraw;
            else tex = t < tr.lastLooseAt + 220 ? T.archLoose : T.archStand;
            break;
          default: // the banner bearer and the Knockout's cheerers
            if (moving) tex = second ? T.bareB : T.bareA;
            else if (tr.cheerAt >= 0 && t >= tr.cheerAt) { tex = T.cheer; lift = hop(t - tr.cheerAt, 6); }
            else tex = tr.unit === 'bearer' ? T.spearThrown : T.infStand;
        }
      }
      if (q.tex !== tex) { q.tex = tex; q.s.texture = tex; }
      const k = ((cav ? this.look.cavalryPx / CAV_H : this.look.soldierPx / FOOT_H) * tr.size) * S;
      const s = q.s;
      if (!s.visible) s.visible = true;
      s.position.set(o.x, o.y - lift * S);
      s.scale.set(o.dir < 0 ? -k : k, k);
      s.rotation = rot;
      s.alpha = o.alpha;
      if (moving && tr.dustMs > 0 && t >= q.nextDust) {
        q.nextDust = t + tr.dustMs * (0.55 + this.rnd() * 0.9);
        this.puff(o.x - o.dir * (cav ? 22 : 7) * S * tr.size + (this.rnd() - 0.5) * 14 * S, o.y - (2 + this.rnd() * 6) * S, (cav ? 1.3 : 0.8) * tr.size * (0.7 + this.rnd() * 0.6));
      }
    }
    const so = this.sa;
    for (const q of this.shots) {
      const sh = q.spec;
      shotAt(sh, t, so);
      if (so.state === 'wait' || so.state === 'gone') { if (q.s.visible) q.s.visible = false; continue; }
      live = true;
      const s = q.s;
      if (!s.visible) s.visible = true;
      const ride = so.state === 'stuck' && sh.stick;
      s.position.set(so.x + (ride ? this.fox : 0), so.y + (ride ? this.foy : 0));
      s.rotation = so.rot;
      const k = (sh.kind === 'spear' ? (this.look.soldierPx * 1.55) / SPEAR_W : (this.look.soldierPx * 0.86) / ARROW_W) * sh.size * S;
      // Stuck, the point is buried: it sits a little shorter.
      s.scale.set(so.state === 'stuck' ? k * 0.84 : k, k);
      s.alpha = so.alpha;
    }
    for (const q of this.banners) {
      const b = q.spec, s = q.s;
      const base = ((this.look.soldierPx * 2.5) / BANNER_H) * b.size * S;
      if (t >= b.t2) { if (s.visible) s.visible = false; continue; }
      if (t < b.t0) {
        // Not planted yet: carried (small, tilted back over the shoulder) or not there.
        const c = b.carrier >= 0 ? this.troopAtIndex[b.carrier] : null;
        if (!c || !c.on) { if (s.visible) s.visible = false; continue; }
        live = true;
        if (!s.visible) s.visible = true;
        if (s.texture !== this.tex.bannerA) s.texture = this.tex.bannerA;
        s.position.set(c.x - this.face * 5 * S, c.y - this.look.soldierPx * 0.3 * S);
        s.scale.set(-this.face * base * 0.62, base * 0.62);
        s.rotation = -this.face * 0.2; s.skew.set(0.05 * Math.sin(t * 0.03), 0);
        s.alpha = c.a;
        continue;
      }
      live = true;
      if (!s.visible) s.visible = true;
      const since = t - b.t0;
      const rise = Math.max(0, 1 - spring(since, 3.2, 110));
      const frame = (Math.floor(t / 140) + q.i) & 1 ? this.tex.bannerB : this.tex.bannerA;
      if (s.texture !== frame) s.texture = frame;
      s.position.set(b.at.x + (b.follow ? this.fox : 0), b.at.y + (b.follow ? this.foy : 0));
      s.scale.set(-this.face * base, base * rise);
      s.rotation = b.lean + 0.1 * spring(since, 2.4, 160);
      // The flag snaps as it goes up, then ripples.
      s.skew.set(0.05 * Math.sin(t * 0.011 + q.i * 1.7) + 0.24 * spring(since, 4, 170), 0);
      s.alpha = t < b.t1 ? 1 : 1 - (t - b.t1) / Math.max(1, b.t2 - b.t1);
    }
    this.ownLive = live;
  }

  /** The sequence is over: hide every soldier, shot and banner (the dust drains by itself). */
  retire(): void {
    for (const q of this.troops) { q.on = false; q.s.visible = false; }
    for (const q of this.shots) q.s.visible = false;
    for (const q of this.banners) q.s.visible = false;
    this.ownLive = false;
  }

  // ── the dust and the flashes (fire and forget) ──

  /** A step puff under a foot or a hoof. */
  puff(x: number, y: number, k = 1): void {
    const D = this.look.dust;
    if (D <= 0) return;
    this.spawn('under', this.tex.dust, this.colors.dust, x, y, {
      dur: 300 + this.rnd() * 260, from: 0.18 * k * D, to: 0.6 * k * D, a0: 0.42, ease: 'cubic', vx: (this.rnd() - 0.5) * 40, vy: -22 - this.rnd() * 16, drag: 0.3,
      rot: this.rnd() * 6.28, spin: (this.rnd() - 0.5) * 0.003,
    });
  }

  /** A dust cloud rolling up over `at` (the trample burying the portrait): `n` big soft puffs within `r`. */
  cloud(at: Pt, r: number, n: number, k = 1, follow = false): void {
    const D = this.look.dust;
    if (D <= 0) return;
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, rr = Math.sqrt(this.rnd()) * r;
      const size = (r * (0.42 + this.rnd() * 0.4) * k) / DUST_PX / S;
      this.spawn('body', this.tex.dust, mixColor(this.colors.dust, 0xffffff, this.rnd() * 0.18), at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr * 0.7, {
        dur: 620 + this.rnd() * 520, from: size * 0.7, to: size * 1.8, a0: 0.5 * Math.min(1.4, D), mode: 'punch', peakAt: 0.22, ease: 'cubic',
        vx: (this.rnd() - 0.5) * 90, vy: -20 - this.rnd() * 40, drag: 0.4, rot: this.rnd() * 6.28, spin: (this.rnd() - 0.5) * 0.002, delay: this.rnd() * 90, follow,
      });
    }
  }

  /** A spear or an arrow going into wood: a small bright knock, a ring, splinters thrown back the way it came. */
  thunk(at: Pt, dir: Pt, k = 1): void {
    const c = this.colors;
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 170, from: (26 * k) / STAR_PX, to: (78 * k) / STAR_PX, a0: 0.95, mode: 'punch', peakAt: 0.15, rot: 0.4, follow: true });
    this.spawn('glow', this.tex.ring, c.brass, at.x, at.y, { dur: 260, from: (14 * k) / RING_PX, to: (110 * k) / RING_PX, a0: 0.8, ease: 'cubic', follow: true });
    this.burst('body', this.tex.dust, [WOOD, mixColor(WOOD, 0xffffff, 0.35), c.dust], at.x, at.y, Math.round(5 + 3 * k), {
      speed: 300 * k, dir: Math.atan2(-dir.y, -dir.x), spread: 2.2, life: 360, size: 0.1 * k, grav: 700, drag: 0.4, to: 0.6,
    });
  }

  /** One arrow of the rain going in: a speck of a knock and a wisp of dust. */
  arrowTick(at: Pt): void {
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 130, from: 12 / STAR_PX, to: 40 / STAR_PX, a0: 0.85, mode: 'punch', peakAt: 0.2, follow: true });
    this.spawn('body', this.tex.dust, this.colors.dust, at.x, at.y, { dur: 300, from: 0.12, to: 0.4, a0: 0.5, ease: 'cubic', vy: -20, drag: 0.4, follow: true });
  }

  /** A war drum: a low ring off the striking hero's feet and a kick of dust. */
  drum(at: Pt, r: number, i: number): void {
    const c = this.colors;
    this.spawn('glow', this.tex.ring, i === 2 ? whiten(c.brass, 0.3) : c.brass, at.x, at.y, { dur: 420, from: (r * 0.9) / RING_PX, to: (r * (2.6 + 0.5 * i)) / RING_PX, a0: 0.5 + 0.12 * i, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.red, at.x, at.y, { dur: 260, from: (r * 1.6) / GLOW_PX, to: (r * 2.6) / GLOW_PX, a0: 0.3 + 0.08 * i, mode: 'punch', peakAt: 0.15 });
    for (let j = 0; j < 4 + i; j++) this.puff(at.x + (this.rnd() - 0.5) * r * 2.2, at.y + r * (0.8 + this.rnd() * 0.3), 1.3);
  }

  /** The horn: three sound rings rolling off the striker toward the target. */
  horn(at: Pt, dir: Pt, r: number): void {
    const c = this.colors;
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.red : c.brass, at.x + dir.x * r * (0.9 + i * 0.25), at.y + dir.y * r * (0.9 + i * 0.25), {
        dur: 520, from: (r * 0.5) / RING_PX, to: (r * (1.9 + 0.5 * i)) / RING_PX, a0: 0.55, ease: 'cubic', delay: i * 130, vx: dir.x * 220, vy: dir.y * 220, drag: 0.5,
      });
    }
  }

  /**
   * THE blow. I, II: the knock of the spear or the last arrow (a thunk and a ring). III: the point rider's hit (a red
   * and brass shock, speed lines, a first roll of dust). IV: the front rank's (the same, far bigger, and the dust
   * goes up over the whole portrait).
   */
  impact(at: Pt, strike: Pt, dir: Pt, radius: number, tier: number): void {
    const c = this.colors;
    const X = this.look.impactSize;
    if (tier <= 2) {
      this.thunk(strike, dir, (tier === 1 ? 1.5 : 1.3) * X);
      this.spawn('glow', this.tex.ring, c.red, at.x, at.y, { dur: 340, from: (radius * 0.7) / RING_PX, to: (radius * (1.9 + 0.5 * tier) * X) / RING_PX, a0: 0.7, ease: 'cubic', follow: true });
      if (tier === 2) this.cloud(at, radius * 0.7, 3, 0.7, true);
      return;
    }
    const big = tier >= 4 ? 1.5 : 1;
    this.spawn('core', this.tex.glow, whiten(c.brass, 0.4), at.x, at.y, { dur: 180, from: (radius * 1.1) / GLOW_PX, to: (radius * 2.2 * X) / GLOW_PX, a0: 0.55, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 220, from: (radius * 0.8) / STAR_PX, to: (radius * 2.6 * big * X) / STAR_PX, a0: 0.95, mode: 'punch', peakAt: 0.14, rot: 0.3 });
    [c.brass, c.red, whiten(c.brass, 0.3)].forEach((tint, i) => {
      if (i === 2 && tier < 4) return;
      this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 380 + i * 110, from: (radius * 0.6) / RING_PX, to: (radius * (2.6 + i * 0.9) * big * X) / RING_PX, a0: 0.7, ease: 'cubic', delay: i * 50 });
    });
    // Speed lines flung on past the target, the way the charge is going.
    this.burst('glow', this.tex.streak, [c.brass, c.red, whiten(c.brass, 0.5)], at.x, at.y, Math.round(8 * big), {
      speed: 1500 * big * X, dir: Math.atan2(dir.y, dir.x), spread: 1.3, life: 240, size: 1.4 * big * X, drag: 0.2, align: true, to: 0.5,
    });
    this.burst('core', this.tex.spark, [c.brass, 0xffffff, c.red], at.x, at.y, Math.round(14 * big), { speed: 620 * big * X, life: 420, size: 0.6 * X, drag: 0.3, grav: 500, to: 0.3 });
    this.cloud(at, radius * (tier >= 4 ? 1.5 : 1.1), tier >= 4 ? 18 : 9, 1);
  }

  /** A later row or rank going over the target: more dust up over it, a few kicked sparks. */
  buffet(at: Pt, radius: number, k: number): void {
    this.cloud(at, radius * 1.3 * k, Math.round(7 * k + 3), 0.9);
    this.burst('core', this.tex.spark, [this.colors.brass, 0xffffff], at.x, at.y, 5, { speed: 420, life: 320, size: 0.45, drag: 0.3, grav: 500, to: 0.3 });
  }

  /** The banner goes in: a kick of dust round its foot, a brass glint and a ring. */
  plant(at: Pt, radius: number): void {
    const c = this.colors;
    this.spawn('glow', this.tex.ring, c.brass, at.x, at.y, { dur: 420, from: (radius * 0.3) / RING_PX, to: (radius * 2.2) / RING_PX, a0: 0.8, ease: 'cubic', follow: true });
    this.spawn('core', this.tex.star, whiten(c.brass, 0.6), at.x, at.y - radius * 1.2, { dur: 420, from: 0.3, to: 1.3, a0: 0.9, mode: 'punch', peakAt: 0.25, spin: 0.004, follow: true });
    this.cloud({ x: at.x, y: at.y + radius * 0.1 }, radius * 0.6, 4, 0.5, true);
  }

  /** THE KNOCKOUT's prismatic shock (on top of IV's impact): cyan, lilac and magenta rings, prism streaks and stars. */
  koFlourish(at: Pt, radius: number): void {
    const X = this.look.impactSize * 1.3;
    [KO_CYAN, KO_LILAC, KO_MAGENTA].forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, {
      dur: 640 + i * 120, from: (radius * 0.8) / RING_PX, to: (radius * (4.2 + i * 1.2) * X) / RING_PX, a0: 0.85, ease: 'cubic', delay: 40 + i * 70,
    }));
    this.spawn('glow', this.tex.glow, KO_CYAN, at.x, at.y, { dur: 700, from: (radius * 1.6) / GLOW_PX, to: (radius * 4.4 * X) / GLOW_PX, a0: 0.4, mode: 'punch', peakAt: 0.15 });
    this.burst('glow', this.tex.streak, [KO_CYAN, KO_LILAC, KO_MAGENTA], at.x, at.y, 18, { speed: 1900 * X, life: 400, size: 2 * X, drag: 0.2, align: true, to: 0.6 });
    this.burst('core', this.tex.star, [KO_CYAN, KO_MAGENTA, 0xffffff], at.x, at.y, 10, { speed: 620 * X, life: 680, size: (22 * X) / STAR_PX, drag: 0.3, spin: 0.02 });
  }

  protected override tick(dt: number): boolean { void dt; return this.ownLive; }

  protected override clearOwn(): void {
    for (const q of this.troops) { q.s.visible = true; q.s.skew.set(0, 0); this.give(q.s); }
    for (const q of this.shots) { q.s.visible = true; this.give(q.s); }
    for (const q of this.banners) { q.s.visible = true; q.s.skew.set(0, 0); this.give(q.s); }
    this.troops = []; this.shots = []; this.banners = []; this.troopAtIndex = [];
    this.ownLive = false;
  }
}

/** A cheer: `n` little hops (px of lift at stage scale 1), then feet on the ground. */
function hop(ms: number, n: number): number {
  const each = 180;
  if (ms < 0 || ms >= each * n) return 0;
  return Math.abs(Math.sin((ms / each) * Math.PI)) * 12;
}
