import { canPlayDefs, playDef } from '../fx/playDef';
import { playTailedClip } from '../sfx';
import {
  CUE_CATEGORY, cueSetting, entranceTimeline, flyKeyframes, getDiscoverEntranceConfig, startOffset,
  type DiscoverEntranceConfig, type EntranceCue, type EntranceTimeline,
} from './discoverEntranceConfig';

/**
 * THE DISCOVER ENTRANCE: the runner (owner ask 2026-09-25). Built on the Runeforge entrance's runner (PR #1706) and
 * its lessons.
 *
 * ── Perf contract ─────────────────────────────────────────────────────────────────────────────────────────────
 *  · Every DOM animation is WAAPI on transform / opacity, scheduled up front with delays: no per-frame JS.
 *  · Layout is read ONCE per play, before anything moves (each card's resting rect: the dust / glint anchors and
 *    the fan's start offsets). Nothing reads layout while the sequence runs.
 *  · The dust and glints are Pixi defs on the above-modal canvas (`discover-arrive`, `discover-glint`), one-shot and
 *    self-retiring. The shimmer is a pre-rendered gradient band whose transform alone moves.
 *  · `fill: 'backwards'` only: when an animation ends its effect ends with it, so nothing holds a compositor layer
 *    (or a transform) after the entrance and a settled card is exactly the card it was before this existed.
 *
 * ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * A card is marked `data-dce="flying"` from the start of the play until it ARRIVES, and the stylesheet makes a
 * flying card `pointer-events: none`. A press on a card still in flight lands on the overlay behind it, which skips
 * the whole sequence to its settled state and picks nothing (the release then lands on a different element than
 * the press, so no click fires on the card either). An arrived card takes its click at once. `isFlying(i)` backs
 * that up for a keyboard or programmatic pick.
 *
 * ── The clock ─────────────────────────────────────────────────────────────────────────────────────────────────
 * Beats (arrivals, dust, sound) are released on the lead animation's `ready`, minus how long ago it really started,
 * never from the layout effect that scheduled them: a long first frame (cold art decode, a dev StrictMode commit)
 * would otherwise run every sound ahead of the visuals (the Runeforge's "sounds early and continuously" bug).
 */

export interface EntranceOptions {
  /** Compress every beat (a replay at 2x plays its Discover at 2x). */
  speed?: number;
  /** prefers-reduced-motion: one plain fade, no flight, dust, shimmer or whoosh. */
  reduced?: boolean;
  /** Play the OPEN cue (the Discover's). A Choose One has no open cue of its own. Default true. */
  openCue?: boolean;
  /** Override the config (tests). Defaults to the live tuner values. */
  config?: DiscoverEntranceConfig;
  /** Called once when the play is over (finished, skipped or cancelled). */
  onDone?: () => void;
}

export interface EntranceHandle {
  /** Jump straight to the settled state: every card at rest and clickable, no further dust or sound. */
  skip(): void;
  /** Tear down (unmount): as `skip`, and the in-flight FX are retired too. Sounds already playing ring out. */
  cancel(): void;
  isRunning(): boolean;
  /** Is card `i` still in flight (and so not pickable)? */
  isFlying(i: number): boolean;
  readonly timeline: EntranceTimeline;
}

export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** WAAPI when available; jsdom (tests) has none, and the timeline still runs on its timers there. */
function anim(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions, into: Animation[]): void {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  into.push((el as HTMLElement).animate(frames, opts));
}

/** The width the two defs are authored against (a Discover card at 1080p). The dust scales with the real card. */
const AUTHORED_CARD_W = 230;

interface Rect { cx: number; cy: number; bottom: number; w: number }

/** Test hook: every cue this module has played, in order (cleared by `resetDiscoverEntranceForTests`). */
export const cueLog: { cue: EntranceCue; slot: number }[] = [];

/**
 * Start one entrance on `root` (the `.discover-ov` element). Cards are its `.disc-slot` children, in order.
 * Returns the handle; the caller cancels it on unmount.
 */
export function runEntrance(root: HTMLElement, opts: EntranceOptions = {}): EntranceHandle {
  const c = opts.config ?? getDiscoverEntranceConfig();
  const slots = Array.from(root.querySelectorAll<HTMLElement>('.disc-slot'));
  const reduced = !!opts.reduced;
  const t = entranceTimeline(c, slots.length, { reduced, speed: opts.speed });
  const k = 1 / (opts.speed && opts.speed > 0 ? opts.speed : 1);
  const animations: Animation[] = [];
  const timers: number[] = [];
  const fx: (() => void)[] = [];
  let running = true;

  // ── the ONE layout read, while everything is still at rest ──
  const rects: (Rect | null)[] = slots.map((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 ? { cx: b.left + b.width / 2, cy: b.top + b.height / 2, bottom: b.bottom, w: b.width } : null;
  });
  const mid = rects[Math.floor((rects.length - 1) / 2)] ?? null;

  const beats: [number, () => void][] = [];
  const at = (ms: number, fn: () => void): void => { beats.push([ms, fn]); };
  // Each cue plays AT MOST ONCE per card per play, whatever re-runs a beat.
  const played = new Set<string>();
  const cue = (name: EntranceCue, slot: number): void => {
    const key = `${name}:${slot}`;
    if (played.has(key)) return;
    played.add(key);
    cueLog.push({ cue: name, slot });
    const s = cueSetting(c, name);
    if (!s.clip || !(s.gain > 0)) return;
    // Fire and forget: a sound already playing rings out on its own soft tail even if the Discover is picked.
    playTailedClip(s.clip, CUE_CATEGORY[name], { gain: s.gain, startMs: s.startMs, lenMs: s.lenMs, tail: s.tail });
  };
  const arrive = (i: number): void => {
    const el = slots[i];
    if (el && el.dataset.dce === 'flying') delete el.dataset.dce;
  };
  const fxOk = (): boolean => canPlayDefs();

  for (const el of slots) el.dataset.dce = 'flying';
  root.dataset.dcePhase = 'entering';

  // THE OPEN CUE: the overlay's own sound, at the (padded) open. Reduced motion keeps it: it is information.
  if (opts.openCue !== false) at(Math.max(0, t.openAt + Math.round(cueSetting(c, 'open').offsetMs * k)), () => cue('open', -1));

  if (reduced) {
    for (const el of slots) {
      anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.max(1, t.endAt - t.openAt), delay: t.openAt, easing: 'ease-out', fill: 'backwards' }, animations);
    }
    slots.forEach((_, i) => arrive(i));
  } else {
    const first = t.cards[0];
    if (first) at(Math.max(t.openAt, first.startAt + Math.round(cueSetting(c, 'whoosh').offsetMs * k)), () => cue('whoosh', -1));
    let lastArriveSfx = Number.NEGATIVE_INFINITY;
    const shimmer = Math.round(Math.max(0, c.shimmerMs) * k);
    slots.forEach((el, i) => {
      const b = t.cards[i]!;
      const r = rects[i];
      const from = startOffset(c, i, slots.length, r && mid ? mid.cx - r.cx : 0);
      anim(el, flyKeyframes(c, from, i), { duration: Math.max(1, b.settledAt - b.startAt), delay: b.startAt, fill: 'backwards' }, animations);

      // The shimmer: one light band across the card as it arrives (opacity via the band's own static alpha).
      if (shimmer > 0 && c.shimmerOpacity > 0) {
        const band = el.querySelector<HTMLElement>('.dce-sheen-band');
        if (band) band.style.opacity = String(Math.max(0, Math.min(1, c.shimmerOpacity)));
        anim(band, [
          { transform: 'translate3d(-160%, 0, 0) skewX(-16deg)' },
          { transform: 'translate3d(300%, 0, 0) skewX(-16deg)' },
        ], { duration: shimmer, delay: b.arriveAt, easing: 'cubic-bezier(0.37, 0, 0.63, 1)', fill: 'backwards' }, animations);
      }

      // THE ARRIVAL: clickable, dust, glints, the settle cue.
      at(b.arriveAt, () => {
        arrive(i);
        if (!r || !fxOk()) return;
        const scale = Math.max(0.4, r.w / AUTHORED_CARD_W);
        if (c.dustCount > 0) {
          const p = { x: r.cx, y: r.bottom - 8 };
          const stop = playDef('discover-arrive', { source: p, target: p, cursor: p }, {
            intensity: c.dustCount, scale: scale * Math.max(0.05, c.dustSize), time: Math.max(0.1, c.dustLife),
            alpha: Math.max(0, Math.min(1, c.dustOpacity)),
          });
          if (stop) fx.push(stop);
        }
        if (c.glints > 0) {
          const p = { x: r.cx, y: r.cy };
          const stop = playDef('discover-glint', { source: p, target: p, cursor: p }, { intensity: c.glints, scale });
          if (stop) fx.push(stop);
        }
      });
      const a = cueSetting(c, 'arrive');
      if (c.sfxArriveEach >= 0.5 || i === 0) {
        at(Math.max(t.openAt, b.arriveAt + Math.round(a.offsetMs * k)), () => {
          const now = Date.now();
          if (c.sfxArriveEach >= 0.5 && now - lastArriveSfx < Math.max(0, c.sfxArriveGapMs) * k) return;
          lastArriveSfx = now;
          cue('arrive', i);
        });
      }
    });
    const last = t.cards[t.cards.length - 1];
    if (last) at(Math.max(t.openAt, last.arriveAt + Math.round(cueSetting(c, 'sparkle').offsetMs * k)), () => cue('sparkle', -1));
  }

  const settle = (): void => {
    if (!running) return;
    running = false;
    for (const id of timers) window.clearTimeout(id);
    timers.length = 0;
    for (const a of animations) { try { a.finish(); } catch { /* already cancelled */ } }
    animations.length = 0;
    slots.forEach((_, i) => arrive(i));
    root.dataset.dcePhase = 'settled';
    opts.onDone?.();
  };

  const handle: EntranceHandle = {
    skip: settle,
    cancel: () => {
      settle();
      for (const stop of fx) stop();
      fx.length = 0;
    },
    isRunning: () => running,
    isFlying: (i) => slots[i]?.dataset.dce === 'flying',
    timeline: t,
  };

  let clockStarted = false;
  const startClock = (lagMs: number): void => {
    if (clockStarted || !running) return;
    clockStarted = true;
    for (const [ms, fn] of beats) timers.push(window.setTimeout(() => { if (running) fn(); }, Math.max(0, ms - lagMs)));
    timers.push(window.setTimeout(settle, Math.max(0, t.endAt - lagMs)));
  };
  const lead = animations[0];
  const lagOf = (a: Animation): number => {
    const now = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
    const st = a.startTime;
    return typeof now === 'number' && typeof st === 'number' ? Math.max(0, now - st) : 0;
  };
  if (lead && lead.ready) {
    lead.ready.then(() => startClock(lagOf(lead)), () => startClock(0));
    // Backstop: a hidden tab never starts an animation, and a card must never be left un-clickable waiting on it.
    timers.push(window.setTimeout(() => startClock(lagOf(lead)), 250));
  } else {
    startClock(0);
  }
  return handle;
}
