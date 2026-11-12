/**
 * THE REAPING'S COLOUR DRAIN: the panes that take the colour out of the struck portrait and (IV) the whole screen.
 *
 * HOW (measured, see the devlog): each pane is an empty `div` with `backdrop-filter: grayscale(1)`. A pane turns
 * whatever is painted UNDER it grey and touches no other element: no clone of the portrait, no filter on the game root,
 * no Pixi filter. The panes sit just under the above-portrait FX canvas (z 200) and over both portraits, so the teal
 * scythe and the warm motes drawn on that canvas keep their colour over a monochrome screen.
 *
 * Only `opacity` and `transform` are ever written after they are built (compositor only, from the one clock):
 *  - a STRIP (I-II) is a thin bar across the portrait, turned to the cut and grown along it with `scaleX` as the blade
 *    passes, inside a round wrapper that clips it to the portrait;
 *  - the FULL pane covers the round portrait (II: clipped ONCE, at build, to the two wedges between the cuts) and fades
 *    in and out with `opacity` (a half-opaque grey pane is a half-drained portrait);
 *  - the VEIL (IV) covers the screen and fades in with `opacity`; colour floods back by SLIDING it off along the strike
 *    line with `translateX`, its trailing edge feathered by a mask painted once.
 * The wrapper rides the struck portrait's own transform, so the grey stays on the face while it is knocked.
 *
 * `remove()` takes every pane out of the DOM: every exit of the attack calls it (the end, finish, cancel, the safety
 * timer; an unmount cancels the attack).
 */
import type { Pt } from '../heroAttack/easing';
import type { DrainState, ReapingKind } from './heroReapingConfig';

export interface DrainSetup {
  doc: Document;
  /** Where the panes are appended (`#stage`, or the sandbox box). */
  parent: HTMLElement;
  /** `local`: the points are the parent's own px (the Collection sandbox), panes are `absolute`. */
  local: boolean;
  /** Screen (or host-local) px -> the CSS px written into a positioned element. */
  css: (v: number) => number;
  kind: ReapingKind;
  /** The struck portrait's centre and radius. */
  d: Pt;
  r: number;
  /** Each cut's angle (radians). */
  angles: readonly number[];
  /** The strike line's angle (striker -> struck): II's wedges straddle it, IV's flood runs along it. */
  strike: number;
  /** The strip's width, in radii. */
  stripWidth: number;
  /** How grey (0..1). */
  grey: number;
  /** The screen (or sandbox box). */
  bounds: { w: number; h: number };
}

/** The panes' z-order: over the dim (150) and both portraits, under the above-portrait FX canvas (200). */
export const DRAIN_Z = 160;

const put = (el: HTMLElement, css: Record<string, string>): void => { for (const k of Object.keys(css)) el.style.setProperty(k, css[k]!); };

export class ReapingDrain {
  readonly veil: HTMLDivElement | null = null;
  readonly patch: HTMLDivElement | null = null;
  readonly strips: HTMLDivElement[] = [];
  readonly full: HTMLDivElement | null = null;
  private readonly lenPx: number = 0;
  private readonly slidePx: number = 0;
  private readonly veilRot: string = '';
  private readonly stripRot: string[] = [];
  // The last values written (a frame that changes nothing writes nothing).
  private lastStrip: number[] = [-1, -1];
  private lastStripA = -1;
  private lastFull = -1;
  private lastVeil = -1;
  private lastFlood = -1;
  private lastTf = '';
  private gone = false;

  constructor(o: DrainSetup | null) {
    if (!o) { this.gone = true; return; }
    const { doc, css } = o;
    const pos = o.local ? 'absolute' : 'fixed';
    const filter = `grayscale(${o.grey.toFixed(2)}) brightness(0.9)`;
    const pane = (cls: string): HTMLDivElement => {
      const el = doc.createElement('div');
      el.className = cls;
      el.setAttribute('aria-hidden', 'true');
      put(el, { 'pointer-events': 'none', 'backdrop-filter': filter, '-webkit-backdrop-filter': filter });
      return el;
    };
    if (o.kind === 'reaping') {
      // A square big enough to cover the screen at any angle, plus a feathered strip on its trailing (striker's) side.
      const side = Math.hypot(css(o.bounds.w), css(o.bounds.h)) + 240;
      const feather = side * 0.2;
      const cx = css(o.bounds.w / 2), cy = css(o.bounds.h / 2);
      const veil = pane('hreaping-veil');
      const mask = `linear-gradient(to right, transparent 0px, #000 ${feather.toFixed(0)}px)`;
      put(veil, {
        position: pos, left: `${(cx - side / 2 - feather).toFixed(1)}px`, top: `${(cy - side / 2).toFixed(1)}px`,
        width: `${(side + feather).toFixed(1)}px`, height: `${side.toFixed(1)}px`, 'z-index': String(DRAIN_Z),
        'transform-origin': `${(feather + side / 2).toFixed(1)}px ${(side / 2).toFixed(1)}px`, opacity: '0', 'will-change': 'opacity, transform',
        'mask-image': mask, '-webkit-mask-image': mask,
      });
      this.veilRot = `rotate(${o.strike.toFixed(4)}rad)`;
      veil.style.transform = this.veilRot;
      this.slidePx = side + feather + 40;
      o.parent.appendChild(veil);
      this.veil = veil;
    }
    const size = css(o.r * 2);
    const patch = doc.createElement('div');
    patch.className = 'hreaping-patch';
    patch.setAttribute('aria-hidden', 'true');
    put(patch, {
      position: pos, left: `${css(o.d.x - o.r).toFixed(1)}px`, top: `${css(o.d.y - o.r).toFixed(1)}px`, width: `${size.toFixed(1)}px`, height: `${size.toFixed(1)}px`,
      'border-radius': '50%', overflow: 'hidden', 'pointer-events': 'none', 'z-index': String(DRAIN_Z + 1), 'will-change': 'transform',
    });
    if (o.kind === 'cut' || o.kind === 'cross') {
      const hw = (o.stripWidth * size) / 4; // half the strip's width (stripWidth is in radii; size is two radii)
      this.lenPx = size;
      o.angles.forEach((ang, i) => {
        const s = pane('hreaping-strip');
        put(s, {
          position: 'absolute', left: '0', top: `${(size / 2 - hw).toFixed(1)}px`, width: `${size.toFixed(1)}px`, height: `${(hw * 2).toFixed(1)}px`,
          'transform-origin': '50% 50%', opacity: '0', 'will-change': 'transform, opacity',
        });
        this.stripRot[i] = `rotate(${ang.toFixed(4)}rad)`;
        s.style.transform = `${this.stripRot[i]} scaleX(0.001)`;
        patch.appendChild(s);
        this.strips.push(s);
      });
    }
    if (o.kind !== 'cut') {
      const full = pane('hreaping-full');
      put(full, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', 'border-radius': '50%', opacity: '0', 'will-change': 'opacity' });
      if (o.kind === 'cross') {
        // The two wedges between the cuts, either side of the strike line: exactly half the portrait.
        const pt = (a: number): string => `${(50 + 80 * Math.cos(a)).toFixed(1)}% ${(50 + 80 * Math.sin(a)).toFixed(1)}%`;
        const q = Math.PI / 4, s = o.strike;
        full.style.setProperty('clip-path', `polygon(50% 50%, ${pt(s + q)}, ${pt(s - q)}, 50% 50%, ${pt(s + Math.PI + q)}, ${pt(s + Math.PI - q)})`);
      }
      patch.appendChild(full);
      this.full = full;
    }
    o.parent.appendChild(patch);
    this.patch = patch;
  }

  /** Every pane this attack has in the DOM right now. */
  get panes(): number { return this.gone ? 0 : (this.veil ? 1 : 0) + (this.patch ? 1 : 0); }

  /**
   * Write the frame: the drain's state, and the struck portrait's own transform this frame (CSS, or null at rest) so
   * the grey rides it. Opacity and transform only.
   */
  paint(s: DrainState, foeTransform: string | null): void {
    if (this.gone) return;
    const tf = foeTransform ?? '';
    if (this.patch && tf !== this.lastTf) { this.patch.style.transform = tf; this.lastTf = tf; }
    for (let i = 0; i < this.strips.length; i++) {
      const k = Math.max(0.001, Math.min(1, s.strip[i] ?? 0));
      if (k !== this.lastStrip[i]) {
        // Grown from the end the blade came in at: scaled about the middle, then slid back so that end stays put.
        this.strips[i]!.style.transform = `${this.stripRot[i]} translateX(${(-this.lenPx * 0.5 * (1 - k)).toFixed(2)}px) scaleX(${k.toFixed(4)})`;
        this.lastStrip[i] = k;
      }
    }
    if (this.strips.length && s.stripA !== this.lastStripA) {
      const a = s.stripA.toFixed(3);
      for (const el of this.strips) el.style.opacity = a;
      this.lastStripA = s.stripA;
    }
    if (this.full && s.full !== this.lastFull) { this.full.style.opacity = s.full.toFixed(3); this.lastFull = s.full; }
    if (this.veil) {
      if (s.veil !== this.lastVeil) { this.veil.style.opacity = s.veil.toFixed(3); this.lastVeil = s.veil; }
      if (s.flood !== this.lastFlood) {
        this.veil.style.transform = `${this.veilRot} translateX(${(this.slidePx * s.flood).toFixed(1)}px)`;
        this.lastFlood = s.flood;
      }
    }
  }

  /** Take every pane out of the DOM. Safe to call twice. */
  remove(): void {
    if (this.gone) return;
    this.gone = true;
    this.veil?.remove();
    this.patch?.remove();
  }
}
