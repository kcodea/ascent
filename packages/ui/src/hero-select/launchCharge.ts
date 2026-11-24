/**
 * THE CHARGE (owner 2026-11-24: "make the push in a bit more exciting ... add some whimsy and polish"; R-LOCATION-06): as the
 * hero finishes their line, sparks rush out of the place into their frame, two lights chase round it faster and faster, and a halo
 * beats, until the frame opens. Plain layers moved by WAAPI transform / opacity only, so the browser runs every one of them
 * on its own: building the game stops the page's scripts for half a second, and none of this stops with it.
 *
 * MADE BEFORE IT IS NEEDED (`new LaunchCharge`, while the hero speaks): every layer is on screen, painted, and all but transparent.
 * Layers made as it starts are first painted when the game has finished building, which is when they are no longer needed.
 */
import type { Point, RippleScene } from '../locationReveal/heroRipple';
import type { LocationDef } from '../locationReveal/locations';

/** How long the lights take to reach full speed; they keep it for as long as the game needs. */
export const CHARGE_MS = 900;
/** How long one press can be charged. ONE animation a property on each layer, however long: two on the same property are run by the
 *  page instead of by the browser, and stop when it does. */
const LONG_MS = 6000;
const SPARKS = 46;
const STREAM = 22;

type Css = Partial<CSSStyleDeclaration>;
const rgb = (c: readonly [number, number, number], k = 1): string => `rgb(${c.map((v) => Math.round(Math.min(1, v * k) * 255)).join(' ')})`;
/** A repeatable scatter: the same press always looks as it was made. */
const rnd = (n: number): number => { const s = Math.sin(n * 127.1 + 3.7) * 43758.5453; return s - Math.floor(s); };

/** A spark's way from `a` to a point on the ring: it leaps, curls round the frame and drops into it. Pure. */
export function sparkPath(a: Point, c: Point, r: number, seed: number, steps = 9): Point[] {
  const end = Math.atan2(a.y - c.y, a.x - c.x) + (rnd(seed) < 0.5 ? -1 : 1) * (0.6 + 2.1 * rnd(seed + 1.3));
  const from = Math.atan2(a.y - c.y, a.x - c.x);
  const d0 = Math.hypot(a.x - c.x, a.y - c.y);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const u = i / steps;
    const th = from + (end - from) * u * u * (3 - 2 * u);
    const d = d0 + (r - d0) * (1 - (1 - u) ** 2) + Math.sin(Math.PI * u) * r * (0.12 + 0.3 * rnd(seed + 2.9));
    return { x: c.x + Math.cos(th) * d, y: c.y + Math.sin(th) * d };
  });
}

export class LaunchCharge {
  readonly root = document.createElement('div');
  private cam: HTMLElement;
  private lights: HTMLElement[] = [];
  private halo: HTMLElement;
  private c: Point;
  private r: number;
  private bits: { e: HTMLElement; frames: Keyframe[]; opts: KeyframeAnimationOptions }[] = [];
  /** The launch has it: whoever made it leaves it alone. */
  started = false;

  constructor(host: HTMLElement, sc: RippleScene, loc: LocationDef) {
    this.root.className = 'hsc-charge';
    this.cam = this.add(this.root, 'hsc-charge-cam', {});
    this.c = { x: sc.clip.x, y: sc.clip.y };
    this.r = sc.clip.r;
    const { x, y } = this.c;
    const R = this.r * 1.17; // the ring's own outer edge
    const warm = loc.warm ?? [1, 0.82, 0.5];
    const cool = loc.cool ?? [0.5, 0.86, 1];
    this.root.style.setProperty('--lit-warm', rgb(warm as [number, number, number]));
    this.root.style.setProperty('--lit-cool', rgb(cool as [number, number, number], 1.15));
    this.halo = this.add(this.cam, 'hsc-charge-halo', { left: `${x - R * 1.5}px`, top: `${y - R * 1.5}px`, width: `${R * 3}px`, height: `${R * 3}px` });
    for (const cls of ['warm', 'cool']) this.lights.push(this.add(this.cam, `hsc-comet ${cls}`, { left: `${x - R * 1.06}px`, top: `${y - R * 1.06}px`, width: `${R * 2.12}px`, height: `${R * 2.12}px` }));
    this.sparks();
    host.appendChild(this.root);
  }
  private add(to: HTMLElement, cls: string, css: Css): HTMLElement {
    const e = document.createElement('div');
    e.className = cls;
    Object.assign(e.style, css);
    to.appendChild(e);
    return e;
  }

  /** `push` is the camera's own move (the picture's), so all of this rides on it. */
  start(push: { frames: Keyframe[]; opts: KeyframeAnimationOptions; origin: string }): void {
    this.started = true;
    this.cam.style.transformOrigin = push.origin;
    this.cam.animate(push.frames, push.opts);
    // The lights: from rest to a blur, then round and round for as long as it takes.
    this.lights.forEach((e, i) => {
      const at = i * 180;
      e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 110, fill: 'forwards' });
      e.animate([
        { transform: `rotate(${at}deg)`, easing: 'cubic-bezier(0.35, 0.15, 0.8, 0.55)' },
        { transform: `rotate(${at + 900}deg)`, offset: CHARGE_MS / LONG_MS },
        { transform: `rotate(${at + 900 + ((LONG_MS - CHARGE_MS) / 250) * 360}deg)` },
      ], { duration: LONG_MS, fill: 'forwards' });
    });
    // The halo: a heart that quickens.
    const beat: Keyframe[] = [
      { opacity: 0.05, transform: 'scale(0.82)' },
      { opacity: 0.8, transform: 'scale(1.03)', offset: 0.13 }, { opacity: 0.4, transform: 'scale(0.95)', offset: 0.36 },
      { opacity: 0.9, transform: 'scale(1.05)', offset: 0.5 }, { opacity: 0.55, transform: 'scale(0.98)', offset: 0.66 },
      { opacity: 1, transform: 'scale(1.07)', offset: 0.78 }, { opacity: 0.75, transform: 'scale(1.01)', offset: 0.89 }, { opacity: 1, transform: 'scale(1.09)', offset: 1 },
    ].map((k) => ({ ...k, easing: 'ease-in-out', offset: ((k as { offset?: number }).offset ?? 0) * (CHARGE_MS / LONG_MS) }));
    const n = Math.round((LONG_MS - CHARGE_MS) / 110);
    for (let i = 1; i <= n; i++) beat.push({ opacity: i % 2 ? 0.8 : 1, transform: `scale(${i % 2 ? 1.03 : 1.09})`, easing: 'ease-in-out', offset: CHARGE_MS / LONG_MS + (i / n) * (1 - CHARGE_MS / LONG_MS) });
    this.halo.animate(beat, { duration: LONG_MS, fill: 'forwards' });
    for (const b of this.bits) b.e.animate(b.frames, b.opts);
  }

  private sparks(): void {
    for (let i = 0; i < SPARKS + STREAM; i++) {
      const burst = i < SPARKS;
      const th = rnd(i + 0.4) * Math.PI * 2;
      const far = this.r * (burst ? 1.35 + 1.2 * rnd(i + 5.1) : 1.9 + 1.5 * rnd(i + 5.1));
      // The first lot rush in at once; the rest are drawn in, round and round, until the frame opens.
      const a: Point = { x: this.c.x + Math.cos(th) * far, y: this.c.y + Math.sin(th) * far * 0.8 };
      const path = sparkPath(a, this.c, this.r * 1.08, i + 0.9);
      const size = 5 + 11 * rnd(i + 7.7) ** 3;
      const e = this.add(this.cam, `hsc-spark${rnd(i + 3.3) < 0.6 ? '' : ' cool'}`, { left: `${-size / 2}px`, top: `${-size / 2}px`, width: `${size}px`, height: `${size}px` });
      const n = path.length - 1;
      e.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) scale(0.3)`;
      const frames = path.map((p, k): Keyframe => {
        const u = k / n;
        const s = u < 0.15 ? 0.3 + (u / 0.15) * 1.1 : 1.4 - 1.1 * u;
        return { transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${s.toFixed(3)})`, opacity: u < 0.08 ? u / 0.08 : u > 0.9 ? (1 - u) / 0.1 : 1, offset: u };
      });
      this.bits.push({
        e, frames, opts: burst
          ? { duration: 460 + 320 * rnd(i + 8.2), delay: 300 * rnd(i + 4.6) ** 2, easing: 'cubic-bezier(0.25, 0.3, 0.6, 1)', fill: 'both' }
          : { duration: 620 + 300 * rnd(i + 8.2), delay: 120 + 700 * rnd(i + 4.6), easing: 'cubic-bezier(0.4, 0, 0.8, 1)', iterations: Infinity, fill: 'backwards' },
      });
    }
  }

  /** The frame opens: everything that was going in goes out. */
  release(): void {
    this.halo.animate([{ opacity: 1, transform: 'scale(1.09)' }, { opacity: 0, transform: 'scale(1.9)' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' });
    this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in', fill: 'forwards' });
    window.setTimeout(() => this.destroy(), 320);
  }
  destroy(): void { this.root.remove(); }
}

/** The board as the ring goes past: its painting eases back into place, and the shop's cards spring up one after another. */
export function boardArrives(c: Point, openMs: number): void {
  const at = (e: Element): string => { const r = e.getBoundingClientRect(); return `${(c.x - r.left).toFixed(0)}px ${(c.y - r.top).toFixed(0)}px`; };
  for (const e of document.querySelectorAll<HTMLElement>('.boardbg')) {
    if (typeof e.animate !== 'function' || e.getBoundingClientRect().width === 0) continue;
    const origin = at(e);
    e.animate([{ scale: '1.16', transformOrigin: origin }, { scale: '1', transformOrigin: origin }], { duration: openMs + 260, easing: 'cubic-bezier(0.3, 0.5, 0.2, 1)' });
  }
  const cards = [...document.querySelectorAll<HTMLElement>('[data-zone="tavern"] .row > *')];
  cards.forEach((e, i) => {
    if (typeof e.animate !== 'function') return;
    e.animate([
      { scale: '0.55', translate: '0 26px', offset: 0 },
      { scale: '1.09', translate: '0 -7px', offset: 0.5 },
      { scale: '0.975', translate: '0 2px', offset: 0.75 },
      { scale: '1', translate: '0 0' },
    ], { duration: 520, delay: openMs * 0.22 + i * 60, easing: 'ease-out', fill: 'backwards' });
  });
}
