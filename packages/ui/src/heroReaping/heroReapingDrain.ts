/**
 * THE REAPING'S COLOUR DRAIN: the panes that take the colour out of the struck portrait and (Tier 4) the whole screen.
 *
 * HOW (measured, see the devlog): each pane is an empty `div` with `backdrop-filter: grayscale(1)`. A pane turns
 * whatever is painted UNDER it grey and touches no other element: no clone of the portrait, no filter on the game root,
 * no Pixi filter. The panes sit just under the above-portrait FX canvas (z 200) and over both portraits, so the teal
 * scythe and the warm motes drawn on that canvas keep their colour over a monochrome screen.
 *
 * Only `opacity` and `transform` are ever written after they are built (compositor only, from the one clock):
 *  - a STRIP (Tiers 1-2) is a thin bar across the portrait, turned to the cut and grown along it with `scaleX` as the blade
 *    passes, inside a round wrapper that clips it to the portrait;
 *  - the FULL pane covers the round portrait and fades in and out with `opacity` (a half-opaque grey pane is a
 *    half-drained portrait). On Tier 2 it is two WEDGES instead: two squares with a corner on the portrait's middle, turned
 *    so each fills the quarter between the cuts (a `clip-path` polygon on one pane was tried first and drained the whole portrait in the captures);
 *  - the GATHER (Tier 3) covers the screen with a round HOLE over the struck portrait, cut by an even-odd
 *    `clip-path: path()` whose circle closes from past the screen's corners onto the portrait, so the grey closes in
 *    from the edges of the screen; it lifts with `opacity`. (The one exception to "opacity and transform only": the
 *    pane paints nothing, so a new clip costs no raster; it was measured. A huge SCALED masked pane was tried first and
 *    rendered a black band in the captures.)
 *  - the VEIL (Tier 4) covers the screen and fades in with `opacity`, sparing the struck portrait (a round hole in its
 *    mask, dropped in ONE write as the flood starts); colour floods back by SLIDING it off along the strike line with
 *    `translateX`, its trailing edge feathered by a mask painted once.
 * The wrapper rides the struck portrait's own transform, so the grey stays on the face while it is knocked.
 *
 * `remove()` takes every pane out of the DOM: every exit of the attack calls it (the end, finish, cancel, the safety
 * timer; an unmount cancels the attack).
 */
import type { Pt } from '../heroAttack/easing';
import { gatherRadius, type DrainState, type ReapingKind } from './heroReapingConfig';

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
  /** The strike line's angle (striker -> struck): Tier 2's wedges straddle it, Tier 4's flood runs along it. */
  strike: number;
  /** The strip's width, in radii. */
  stripWidth: number;
  /** How grey (0..1). */
  grey: number;
  /** The screen (or sandbox box). */
  bounds: { w: number; h: number };
}

/** The farthest corner of the screen from a point (pure). */
export function farCorner(d: Pt, b: { w: number; h: number }): number {
  return Math.max(Math.hypot(d.x, d.y), Math.hypot(b.w - d.x, d.y), Math.hypot(d.x, b.h - d.y), Math.hypot(b.w - d.x, b.h - d.y));
}

/**
 * Tier 3: the gather's clip (pure): the whole box (`w` x `h`) minus a circle of radius `rad` round (`cx`, `cy`), even-odd,
 * every number in the pane's own CSS px.
 */
export function gatherClip(w: number, h: number, cx: number, cy: number, rad: number): string {
  const R = Math.max(0, rad);
  const f = (v: number): string => v.toFixed(1);
  return `path(evenodd, "M0 0 H${f(w)} V${f(h)} H0 Z M${f(cx - R)} ${f(cy)} a${f(R)} ${f(R)} 0 1 0 ${f(2 * R)} 0 a${f(R)} ${f(R)} 0 1 0 ${f(-2 * R)} 0 Z")`;
}

/** The panes' z-order: over the dim (150) and both portraits, under the above-portrait FX canvas (200). */
export const DRAIN_Z = 160;

/**
 * Tier 4's veil, in whatever px `w`, `h` and `pad` are given in (pure): a square of `side` that covers the screen at any
 * angle, a `feather` strip on its trailing (striker's) side, and the distance it slides off along the strike line.
 * `frontAt(flood)` is where the middle of that feathered edge is, along the strike line from the screen's middle: the
 * scene draws the bright front of the returning colour there.
 */
export function veilSpan(w: number, h: number, pad: number): { side: number; feather: number; slide: number; frontAt: (flood: number) => number } {
  const side = Math.hypot(w, h) + pad;
  const feather = side * 0.2;
  const slide = side + feather + pad / 6;
  return { side, feather, slide, frontAt: (flood: number) => -side / 2 - feather / 2 + slide * flood };
}

const put = (el: HTMLElement, css: Record<string, string>): void => { for (const k of Object.keys(css)) el.style.setProperty(k, css[k]!); };

export class ReapingDrain {
  readonly veil: HTMLDivElement | null = null;
  readonly gatherPane: HTMLDivElement | null = null;
  readonly patch: HTMLDivElement | null = null;
  readonly strips: HTMLDivElement[] = [];
  /** The rest of the portrait: one round pane (Tiers 3-4), or Tier 2's two wedges. They fade together. */
  readonly fulls: HTMLDivElement[] = [];
  private readonly lenPx: number = 0;
  private readonly slidePx: number = 0;
  private readonly veilRot: string = '';
  private readonly veilMask: string = '';
  private readonly dMax: number = 0;
  private readonly r: number = 0;
  private readonly toCss: (v: number) => number = (v) => v;
  private readonly gw: number = 0;
  private readonly gh: number = 0;
  private readonly gcx: number = 0;
  private readonly gcy: number = 0;
  private lastGather = -1;
  private lastGatherA = -1;
  /** 1 while the veil's mask still spares the struck portrait (it is dropped once, as the flood starts). */
  private lastHole = 0;
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
      const { side, feather, slide } = veilSpan(css(o.bounds.w), css(o.bounds.h), 240);
      const cx = css(o.bounds.w / 2), cy = css(o.bounds.h / 2);
      const veil = pane('hreaping-veil');
      const mask = `linear-gradient(to right, transparent 0px, #000 ${feather.toFixed(0)}px)`;
      // The hole that spares the struck portrait: its middle in the veil's own (unrotated) px.
      const ox = feather + side / 2, oy = side / 2;
      const vx = css(o.d.x) - cx, vy = css(o.d.y) - cy, ca = Math.cos(-o.strike), sa = Math.sin(-o.strike);
      const hx = ox + vx * ca - vy * sa, hy = oy + vx * sa + vy * ca, hr = css(o.r);
      const hole = `radial-gradient(circle at ${hx.toFixed(1)}px ${hy.toFixed(1)}px, transparent ${(hr * 0.98).toFixed(1)}px, #000 ${(hr * 1.14).toFixed(1)}px)`;
      this.veilMask = mask;
      put(veil, {
        position: pos, left: `${(cx - side / 2 - feather).toFixed(1)}px`, top: `${(cy - side / 2).toFixed(1)}px`,
        width: `${(side + feather).toFixed(1)}px`, height: `${side.toFixed(1)}px`, 'z-index': String(DRAIN_Z),
        'transform-origin': `${ox.toFixed(1)}px ${oy.toFixed(1)}px`, opacity: '0', 'will-change': 'opacity, transform',
        'mask-image': `${mask}, ${hole}`, '-webkit-mask-image': `${mask}, ${hole}`,
        'mask-composite': 'intersect', '-webkit-mask-composite': 'source-in',
      });
      this.lastHole = 1;
      this.veilRot = `rotate(${o.strike.toFixed(4)}rad)`;
      veil.style.transform = this.veilRot;
      this.slidePx = slide;
      o.parent.appendChild(veil);
      this.veil = veil;
    }
    if (o.kind === 'harvest') {
      // A square centred on the struck portrait with a round hole in its mask, scaled about its middle.
      this.dMax = farCorner(o.d, o.bounds);
      this.toCss = css;
      this.r = o.r;
      const g = pane('hreaping-gather');
      this.gw = css(o.bounds.w); this.gh = css(o.bounds.h); this.gcx = css(o.d.x); this.gcy = css(o.d.y);
      put(g, {
        position: pos, left: '0px', top: '0px', width: `${this.gw.toFixed(1)}px`, height: `${this.gh.toFixed(1)}px`, 'z-index': String(DRAIN_Z),
        opacity: '0', 'will-change': 'opacity', 'clip-path': gatherClip(this.gw, this.gh, this.gcx, this.gcy, this.toCss(this.dMax * 1.2)),
      });
      o.parent.appendChild(g);
      this.gatherPane = g;
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
    if (o.kind === 'cross') {
      // The two wedges between the cuts, either side of the strike line: exactly half the portrait. Each is a square
      // with one corner on the portrait's middle, turned so its two edges lie along the cuts.
      for (const a of [o.strike - Math.PI / 4, o.strike + Math.PI * 0.75]) {
        const w = pane('hreaping-full');
        put(w, {
          position: 'absolute', left: '50%', top: '50%', width: `${(size * 0.55).toFixed(1)}px`, height: `${(size * 0.55).toFixed(1)}px`,
          'transform-origin': '0 0', transform: `rotate(${a.toFixed(4)}rad)`, opacity: '0', 'will-change': 'opacity',
        });
        patch.appendChild(w);
        this.fulls.push(w);
      }
    } else if (o.kind !== 'cut') {
      const full = pane('hreaping-full');
      put(full, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', 'border-radius': '50%', opacity: '0', 'will-change': 'opacity' });
      patch.appendChild(full);
      this.fulls.push(full);
    }
    o.parent.appendChild(patch);
    this.patch = patch;
  }

  /** The first of the full panes (null on Tier 1). */
  get full(): HTMLDivElement | null { return this.fulls[0] ?? null; }

  /** Every pane this attack has in the DOM right now. */
  get panes(): number { return this.gone ? 0 : (this.veil ? 1 : 0) + (this.gatherPane ? 1 : 0) + (this.patch ? 1 : 0); }

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
    if (this.fulls.length && s.full !== this.lastFull) {
      const a = s.full.toFixed(3);
      for (const el of this.fulls) el.style.opacity = a;
      this.lastFull = s.full;
    }
    if (this.gatherPane) {
      if (s.gather !== this.lastGather) {
        this.gatherPane.style.setProperty('clip-path', gatherClip(this.gw, this.gh, this.gcx, this.gcy, this.toCss(gatherRadius(s.gather, this.dMax, this.r))));
        this.lastGather = s.gather;
      }
      if (s.gatherA !== this.lastGatherA) { this.gatherPane.style.opacity = s.gatherA.toFixed(3); this.lastGatherA = s.gatherA; }
    }
    if (this.veil) {
      if (this.lastHole === 1 && s.flood > 0) {
        // The flood: the portrait is no longer spared (the round pane over it keeps it grey). One write.
        this.veil.style.setProperty('mask-image', this.veilMask); this.veil.style.setProperty('-webkit-mask-image', this.veilMask);
        this.lastHole = 0;
      }
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
    this.gatherPane?.remove();
    this.patch?.remove();
  }
}
