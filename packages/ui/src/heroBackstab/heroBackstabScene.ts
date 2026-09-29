/**
 * THE BACKSTAB SCENE: the smoke and the steel the Backstab draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. The PORTRAIT is the subject (the runner moves it);
 * this only dresses its vanishes and its cuts. `heroBackstab.ts` mounts `root` on the above-portrait overlay.
 *
 *  - VANISH: a burst of dark smoke billows where the portrait stood (normal blend, so it reads as shadow on any board),
 *    a few violet wisps curling off, a faint ring.
 *  - APPEAR: smoke drawn IN to the spot as the portrait steps out of it, a violet glint.
 *  - SLASH: a crisp crescent cut across the stab's heading (a white core over a violet / teal edge), a dagger glint at
 *    its point, a few sparks thrown on along the stab; the last cut crosses a second one over it (an X).
 */
import type { Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';

export interface HeroBackstabTextures extends HeroArcanaTextures {
  smoke: Texture;
  slash: Texture;
}

export interface BackstabColors { smoke: number; shadow: number; violet: number; teal: number; flash: number; side: number }

/** Hard cap on sprites alive at once (a big run peaks well under 120). */
export const MAX_BACKSTAB_SPRITES = 220;
const SMOKE_PX = 128;
const SLASH_W = 160;
const RING_PX = 160;
const GLOW_PX = 128;

export class HeroBackstabScene extends FxPool {
  constructor(private readonly tex: HeroBackstabTextures, private readonly colors: BackstabColors, scale = 1, seed = 1) {
    super('heroBackstab', [tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.smoke, tex.slash], scale, seed, MAX_BACKSTAB_SPRITES);
  }

  /** A burst of smoke where the portrait stood (`r` = its radius, px). */
  vanish(at: Pt, r: number, strength: number): void {
    if (strength <= 0) return;
    const c = this.colors;
    const S = this.scale;
    const n = Math.round(7 * Math.min(2, strength));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.6;
      const d = r * (0.25 + this.rnd() * 0.35);
      const sz = ((r * (0.9 + this.rnd() * 0.5)) / SMOKE_PX / S) * strength;
      const s = this.spawn('under', this.tex.smoke, i % 3 ? c.smoke : c.shadow, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, {
        dur: 520 + this.rnd() * 220, from: sz * 0.7, to: sz * 1.5, a0: 0.8, mode: 'hold', ease: 'cubic',
        vx: Math.cos(a) * 70, vy: Math.sin(a) * 50 - 50, drag: 0.3, spin: (this.rnd() - 0.5) * 0.002,
      });
      if (s) s.rotation = this.rnd() * Math.PI * 2;
    }
    // Wisps curling off (violet, additive, thin), and a faint ring.
    for (let i = 0; i < 4; i++) {
      const a = this.rnd() * Math.PI * 2;
      this.spawn('glow', this.tex.streak, c.violet, at.x + Math.cos(a) * r * 0.5, at.y + Math.sin(a) * r * 0.5, {
        dur: 380, from: 0.5 * strength, to: 0.9 * strength, a0: 0.5, sy: 0.35, vx: Math.cos(a) * 110, vy: Math.sin(a) * 80 - 60, drag: 0.2, align: true,
      });
    }
    this.spawn('glow', this.tex.ring, c.violet, at.x, at.y, { dur: 300, from: (r * 1.2) / RING_PX / S, to: (r * 2.4) / RING_PX / S, a0: 0.22, ease: 'cubic' });
  }

  /** Smoke drawn in to the spot as the portrait steps out of it, and a violet glint. */
  appear(at: Pt, r: number, strength: number): void {
    if (strength <= 0) return;
    const c = this.colors;
    const S = this.scale;
    const n = Math.round(6 * Math.min(2, strength));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.5;
      const d = r * (1 + this.rnd() * 0.3);
      const sz = ((r * (0.8 + this.rnd() * 0.4)) / SMOKE_PX / S) * strength;
      const s = this.spawn('under', this.tex.smoke, i % 2 ? c.smoke : c.shadow, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, {
        dur: 300, from: sz, to: sz * 0.5, a0: 0.75, mode: 'punch', peakAt: 0.25, ease: 'cubic',
        vx: -Math.cos(a) * (d / S) * 2.4, vy: -Math.sin(a) * (d / S) * 2.4, drag: 0.05,
      });
      if (s) s.rotation = this.rnd() * Math.PI * 2;
    }
    this.spawn('core', this.tex.star, whiten(c.violet, 0.4), at.x, at.y - r * 0.55, { dur: 240, from: 0.3, to: 0.9, a0: 0.9, mode: 'punch', peakAt: 0.3, rot: 0.4 });
  }

  /**
   * A cut: `at` is where the blade meets the face (px), `dir` the stab's heading (unit). The crescent lies ACROSS the
   * heading and sweeps; `final` crosses a second cut over it and throws more sparks.
   */
  slash(at: Pt, dir: Pt, strength: number, final: boolean): void {
    const c = this.colors;
    const across = Math.atan2(dir.y, dir.x) + Math.PI / 2;
    const k = (strength * 150) / SLASH_W;
    const edge = mixColor(c.violet, c.teal, 0.45);
    const cut = (rot: number, delay: number, w: number): void => {
      this.spawn('glow', this.tex.slash, edge, at.x, at.y, { dur: 230, from: k * 0.55 * w, to: k * 1.25 * w, a0: 1, mode: 'punch', peakAt: 0.18, rot, sy: 1.25, delay });
      this.spawn('core', this.tex.slash, c.flash, at.x, at.y, { dur: 190, from: k * 0.5 * w, to: k * 1.1 * w, a0: 1, mode: 'punch', peakAt: 0.15, rot, sy: 0.55, delay });
    };
    cut(across, 0, 1);
    if (final) cut(across + 1.1, 70, 1.1);
    // The dagger glint at the point of the stab, a flash under it, and sparks thrown on along the stab.
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 220, from: 0.4 * strength, to: 1.3 * strength, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.3 });
    this.spawn('glow', this.tex.glow, final ? c.violet : c.teal, at.x, at.y, { dur: 260, from: (50 * strength) / GLOW_PX, to: (150 * strength) / GLOW_PX, a0: 0.55, mode: 'punch', peakAt: 0.1 });
    const head = Math.atan2(dir.y, dir.x);
    this.burst('core', this.tex.spark, [c.flash, c.teal, c.violet], at.x, at.y, final ? 12 : 6, { speed: 520 * strength, dir: head, spread: 1.6, life: 300, size: 0.5 * strength, drag: 0.1, align: true });
    if (final) this.spawn('glow', this.tex.ring, c.violet, at.x, at.y, { dur: 340, from: 0.12, to: 0.9 * strength, a0: 0.7, ease: 'cubic' });
  }
}
