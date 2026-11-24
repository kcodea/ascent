/**
 * THE HERO TAKES THEIR SEAT (owner 2026-11-24: "maybe the start game into the board should be different from the wipe ...
 * it should come out of the hero instead of start game button", then "build 1"; R-LOCATION-06). Start Game: the hero in
 * their frame lifts toward you on the press itself; the run is built while they hang there; then the place falls away from
 * the board and they fly down into their own portrait on it, and land.
 *
 * Every motion is a WAAPI transform / opacity animation on its own layers, so the browser runs it on its own: building the
 * run stops the page's scripts for a few tenths of a second, and the hero keeps moving straight through it (which is why
 * nothing waits for anything before it starts). Plain DOM, owned by the launch curtain, gone when it lands.
 */
import { canPlayDefs, playDef } from '../fx/playDef';
import { REVEAL_FLIGHT_WHOOSH, REVEAL_LOCK_SHIMMER, REVEAL_LOCK_THUDS } from '../lobbyReveal/lobbyRevealConfig';
import type { RippleScene } from '../locationReveal/heroRipple';
import { playTailedClip, sfx } from '../sfx';
import { rectToStage } from '../stage';

/** The lift: a small dip, then up toward the player (ms), then a slow drift for as long as the run takes. */
export const LIFT_MS = 420;
export const LIFT_SCALE = 1.1;
/** The flight to the seat, and how soon before it the place starts to fall away (ms). */
export const FLY_MS = 560;
export const FALL_MS = 420;
/** How long the board's own portrait takes to take over from the one that landed (ms). */
const HAND_MS = 140;
/** The seat may mount a few frames after the run is built. */
const SEAT_TRIES = 40;

export interface Spot { x: number; y: number; w: number }

/** The flight from the lifted hero (`from`, at `s0`) to the seat: a low arc that leaves slowly and arrives fast. Transforms are
 *  relative to the wrapper at rest (its middle at `from`). Linear between these, so the curve is all here. */
export function flightFrames(from: Spot, to: Spot, s0: number, dy0: number, steps = 22): Keyframe[] {
  const k = to.w / Math.max(1, from.w);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const out: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = t * t * (0.35 + 0.65 * t); // gathers speed all the way in
    const x = dx * u;
    const y = dy0 + (dy - dy0) * u - Math.sin(Math.PI * u) * Math.abs(dx) * 0.16;
    const s = s0 + (k - s0) * (1 - (1 - u) ** 1.35);
    const r = -7 * Math.sin(Math.PI * u) * Math.sign(dx || 1);
    out.push({ offset: t, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})` });
  }
  return out;
}

/** The player's own portrait on the board, and its ring's box (stage px). */
function seat(): { el: HTMLElement; spot: Spot; box: DOMRect } | null {
  const el = document.querySelector<HTMLElement>('.statusbar .hero .herolunge');
  const ring = el?.querySelector<HTMLElement>('.pframe') ?? el;
  const box = ring?.getBoundingClientRect();
  if (!el || !box || box.width <= 0) return null;
  const r = rectToStage(box);
  return { el, box, spot: { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } };
}
const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });
const wait = (ms: number): Promise<void> => new Promise((r) => { window.setTimeout(r, ms); });

/** The board has been built, drawn and drawn again: three frames in a row that came when they should (`most` ms at the most).
 *  Leaving sooner, the last of that work swallows the first part of the flight. */
async function quiet(most = 900): Promise<void> {
  const t0 = performance.now();
  let last = t0;
  for (let calm = 0; calm < 3;) {
    await frame();
    const now = performance.now();
    calm = now - last < 22 ? calm + 1 : 0;
    last = now;
    if (now - t0 > most) return;
  }
}

export class HeroFlight {
  private wrap = document.createElement('div');
  private glow = document.createElement('div');
  private from: Spot;
  private hidden: HTMLElement[] = [];
  private lifted: Animation | null = null;

  constructor(private host: HTMLElement, sc: RippleScene) {
    const rb = sc.ringBox;
    this.from = { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2, w: rb.width };
    const w = this.wrap;
    w.className = 'hsc-fly';
    Object.assign(w.style, { left: `${rb.left}px`, top: `${rb.top}px`, width: `${rb.width}px`, height: `${rb.height}px` });
    this.glow.className = 'hsc-fly-glow';
    w.appendChild(this.glow);
    // The art, cut to the very circle the ceremony cuts it to, and the ring over it.
    const c = sc.clip;
    const disc = document.createElement('div');
    disc.className = 'hsc-fly-disc';
    Object.assign(disc.style, { left: `${c.x - c.r - rb.left}px`, top: `${c.y - c.r - rb.top}px`, width: `${c.r * 2}px`, height: `${c.r * 2}px` });
    const art = new Image();
    art.decoding = 'sync';
    art.src = sc.art;
    art.draggable = false;
    Object.assign(art.style, { left: `${sc.box.left - (c.x - c.r)}px`, top: `${sc.box.top - (c.y - c.r)}px`, width: `${sc.box.width}px`, height: `${sc.box.height}px` });
    disc.appendChild(art);
    const ring = new Image();
    ring.decoding = 'sync';
    ring.className = 'hsc-fly-ring';
    ring.src = sc.ring;
    ring.draggable = false;
    w.append(disc, ring);
    host.appendChild(w);
  }

  /** On the press: up, at once. */
  lift(): void {
    const up = `translate(0px, -14px) scale(${LIFT_SCALE})`;
    this.lifted = this.wrap.animate([
      { transform: 'none', easing: 'cubic-bezier(0.4, 0, 0.6, 1)' },
      { transform: 'translate(0px, 5px) scale(0.965)', offset: 0.07, easing: 'cubic-bezier(0.15, 0.8, 0.25, 1)' },
      { transform: up, offset: 0.34, easing: 'ease-in-out' },
      { transform: `translate(0px, -20px) scale(${LIFT_SCALE + 0.035})`, offset: 0.67, easing: 'ease-in-out' },
      { transform: up },
    ], { duration: LIFT_MS / 0.34 * 1.6, fill: 'both' });
    this.glow.animate([{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.3 }, { opacity: 0.75, transform: 'scale(1)' }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
    playTailedClip(REVEAL_LOCK_SHIMMER.clip, 'ceremony', { gain: 0.22, rate: 0.9 });
    sfx.warmClips([REVEAL_FLIGHT_WHOOSH.clip, REVEAL_LOCK_THUDS[0]!]);
  }

  /** Down to the seat. `onLeave` as they go (the place falls away with them). Resolves when they have landed; false when there
   *  was no seat to land in (they fade where they are). */
  async land(onLeave: () => void): Promise<boolean> {
    await quiet();
    let s = seat();
    for (let i = 0; !s && i < SEAT_TRIES; i++) { await frame(); s = seat(); }
    // Wherever the lift has got to is where the flight starts.
    const now = new DOMMatrixReadOnly(getComputedStyle(this.wrap).transform);
    const s0 = now.a || 1;
    const dy0 = now.f;
    if (!s) {
      onLeave();
      await this.wrap.animate([{ transform: `translate(0px, ${dy0}px) scale(${s0})`, opacity: 1 }, { transform: `translate(0px, ${dy0}px) scale(${s0 * 1.25})`, opacity: 0 }], { duration: FALL_MS, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => undefined);
      return false;
    }
    // One hero on screen at a time: the seat keeps its ring, empty, and waits for them (the board's art has a dark socket there).
    this.hidden = [...(s.el.closest('.f') ?? s.el).querySelectorAll<HTMLElement>('.heroimg, .heroname')];
    this.empty(true);
    playTailedClip(REVEAL_FLIGHT_WHOOSH.clip, 'ceremony', { gain: 0.6, tail: { fadeOutMs: 160, reverbMix: 0, reverbSec: 0.5 } });
    const fly = this.wrap.animate(flightFrames(this.from, s.spot, s0, dy0), { duration: FLY_MS, easing: 'linear', fill: 'both' });
    this.lifted?.cancel();
    onLeave();
    this.glow.animate([{ opacity: 0.75 }, { opacity: 0.35 }], { duration: FLY_MS, fill: 'forwards' });
    await fly.finished.catch(() => undefined);
    this.touch(s);
    await wait(HAND_MS + 60);
    return true;
  }

  /** The landing: the seat gives, a ring of light leaves it, sparks, the thud. */
  private touch(s: NonNullable<ReturnType<typeof seat>>): void {
    this.empty(false);
    s.el.animate([{ scale: '0.93' }, { scale: '1.045', offset: 0.42 }, { scale: '0.99', offset: 0.72 }, { scale: '1' }], { duration: 380, easing: 'ease-out' });
    this.wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HAND_MS, easing: 'ease-out', fill: 'forwards' });
    for (const [cls, grow, ms] of [['', 1.75, 520], [' two', 1.4, 420]] as const) {
      const w = document.createElement('div');
      w.className = `hsc-seat-wave${cls}`;
      Object.assign(w.style, { left: `${s.spot.x - s.spot.w / 2}px`, top: `${s.spot.y - s.spot.w / 2}px`, width: `${s.spot.w}px`, height: `${s.spot.w}px` });
      this.host.appendChild(w);
      w.animate([{ opacity: 0.95, transform: 'scale(0.86)' }, { opacity: 0, transform: `scale(${grow})` }], { duration: ms, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)', fill: 'forwards' });
    }
    playTailedClip(REVEAL_LOCK_THUDS[0]!, 'ceremony', { gain: 0.85 });
    if (canPlayDefs()) {
      const p = { x: s.box.left + s.box.width / 2, y: s.box.top + s.box.height / 2 };
      playDef('hero-power-spark', { source: p, target: p, cursor: p }, { intensity: 1 });
    }
  }

  private empty(on: boolean): void {
    for (const e of this.hidden) e.style.opacity = on ? '0' : '';
    if (!on) this.hidden = [];
  }

  destroy(): void {
    this.empty(false);
    this.wrap.remove();
    this.host.querySelectorAll('.hsc-seat-wave').forEach((e) => e.remove());
  }
}

/** Can the flight play here? (Reduced motion and no WAAPI: no.) */
export const canFly = (): boolean => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function' && typeof DOMMatrixReadOnly !== 'undefined'
  && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
