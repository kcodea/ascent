import { canPlayDefs, playDef } from '../fx/playDef';
import { playFxSound } from '../sfx';
import {
  cueSetting, dropKeyframes, entranceTimeline, getRuneforgeEntranceConfig, igniteMs, resolveEntrance,
  type EntranceCue, type EntranceTimeline, type ResolvedEntrance, type RuneforgeEntranceConfig,
} from './runeforgeEntranceConfig';

/**
 * THE RUNEFORGE ENTRANCE — the runner (owner ask 2026-09-24).
 *
 * One imperative pass over the forge overlay's DOM, started from a layout effect so every animation is scheduled
 * BEFORE the overlay's first paint (a tablet must never flash at rest for a frame and then jump up to fall).
 *
 * ── Perf contract ─────────────────────────────────────────────────────────────────────────────────────────────
 *  · Every DOM animation is WAAPI on transform / opacity, scheduled up front with delays: no per-frame JS at all.
 *  · Layout is read ONCE per play, before anything moves: each tablet's base (the dust anchor) and the panel's
 *    floor (the ember anchor). Nothing reads layout while the sequence runs.
 *  · The dust, embers and flare are Pixi defs on the above-modal canvas (`runeforge-land-dust`,
 *    `runeforge-embers`, `runeforge-epic-flare`), one-shot and self-retiring.
 *  · `fill: 'backwards'` only: when an animation ends, its effect ends with it and the tablet is back on its own
 *    styles. Nothing holds a compositor layer (or a transform) after the entrance, so the rune lock-in ceremony
 *    always measures a tablet's true resting rect.
 *
 * ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * A tablet is marked `data-rfe="falling"` from the start of the play until it LANDS, and the stylesheet makes a
 * falling tablet `pointer-events: none`. So a press on a tablet still in the air lands on the overlay behind it,
 * which skips the whole sequence to its settled state and buys nothing; a landed tablet takes its click at once.
 */

export interface EntranceOptions {
  epic: boolean;
  /** Also fade the overlay up, shade the forge and raise the embers. Off for a re-roll (only the new tablets drop). */
  withBackdrop: boolean;
  /** Compress every beat (a replay at 2x plays its forge at 2x). */
  speed?: number;
  /** prefers-reduced-motion: one plain fade, nothing drops, sweeps or flares. */
  reduced?: boolean;
  /** Override the config (tests). Defaults to the live tuner values. */
  config?: RuneforgeEntranceConfig;
  /** Called once when the play is over (finished, skipped or cancelled). */
  onDone?: () => void;
}

export interface EntranceHandle {
  /** Jump straight to the settled state: every tablet at rest and clickable, no further dust or sound. */
  skip(): void;
  /** Tear down (unmount): as `skip`, and the in-flight FX are retired too. */
  cancel(): void;
  isRunning(): boolean;
  /** The resolved numbers and beats this play used (the tuner readout and the tests read them). */
  readonly resolved: ResolvedEntrance;
  readonly timeline: EntranceTimeline;
}

/** The one entrance playing right now, so a replay's lock-in capture (or a test) can settle it first. */
let active: EntranceHandle | null = null;

/** Settle the playing entrance, if any, so the forge row is measured at rest. */
export function skipRuneforgeEntrance(): void {
  active?.skip();
}

export function runeforgeEntranceRunning(): boolean {
  return active?.isRunning() ?? false;
}

export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** WAAPI when available; jsdom (tests) has none, and the timeline still runs on its timers there. */
function anim(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions, into: Animation[]): void {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  into.push((el as HTMLElement).animate(frames, opts));
}

/** Play a cue's mapped clip, once. An empty clip or a zero gain is silent (the placeholder state). Never looped. */
function playCue(c: RuneforgeEntranceConfig, cue: EntranceCue): void {
  const s = cueSetting(c, cue);
  if (!s.clip || !(s.gain > 0)) return;
  playFxSound(s.clip, { gain: s.gain, bus: 'ui', loop: false });
}

/** The authored spark/ember counts of the committed defs; the tuner's counts become `intensity` on them. */
const DEF_EMBERS = 40;

interface Point { x: number; y: number }

/**
 * Start one entrance on `root` (the `.forge-ov` element). Tablets are its `.rfe-slot` children, in order.
 * Returns the handle; the caller cancels it on unmount.
 */
export function runEntrance(root: HTMLElement, opts: EntranceOptions): EntranceHandle {
  const c = opts.config ?? getRuneforgeEntranceConfig();
  const r = resolveEntrance(c, opts.epic);
  const slots = Array.from(root.querySelectorAll<HTMLElement>('.rfe-slot'));
  const reduced = !!opts.reduced;
  const t = entranceTimeline(r, slots.length, { reduced, speed: opts.speed, opening: opts.withBackdrop });
  const k = 1 / (opts.speed && opts.speed > 0 ? opts.speed : 1);
  const animations: Animation[] = [];
  const timers: number[] = [];
  const fx: (() => void)[] = [];
  let running = true;

  // ── the ONE layout read: every tablet's base, and the forge floor, while everything is still at rest ──
  const bases: (Point | null)[] = slots.map((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 ? { x: b.left + b.width / 2, y: b.bottom - 4 } : null;
  });
  const panel = root.querySelector<HTMLElement>('.forge-cards');
  const pr = panel?.getBoundingClientRect();
  const floor: Point | null = pr && pr.width > 0 ? { x: pr.left + pr.width / 2, y: pr.bottom } : null;
  const centre: Point | null = pr && pr.width > 0 ? { x: pr.left + pr.width / 2, y: pr.top + pr.height * 0.55 } : null;

  // Every timed beat (landings, dust, sound cues, the flare, the end) is QUEUED here and only scheduled once the
  // animations have actually started: see `startClock` below.
  const beats: [number, () => void][] = [];
  const at = (ms: number, fn: () => void): void => { beats.push([ms, fn]); };
  // Each cue plays AT MOST ONCE per tablet per play, whatever re-runs a beat (belt and braces: the owner heard the
  // first cut's thuds "early and continuously").
  const cuesPlayed = new Set<string>();
  let lastSweepSfx = Number.NEGATIVE_INFINITY;
  const cue = (name: EntranceCue, slot: number): void => {
    const key = `${name}:${slot}`;
    if (cuesPlayed.has(key)) return;
    cuesPlayed.add(key);
    playCue(c, name);
  };
  const land = (i: number): void => {
    const el = slots[i];
    if (el && el.dataset.rfe === 'falling') delete el.dataset.rfe;
  };
  const fxOk = (): boolean => canPlayDefs();

  // Every tablet is in the air (and so un-clickable) until its own landing.
  for (const el of slots) el.dataset.rfe = 'falling';
  root.dataset.rfePhase = 'entering';

  if (opts.withBackdrop) {
    // `delay: openAt` is the post-wipe pad: the overlay stays fully transparent (fill: backwards) until it ends.
    anim(root, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.max(1, Math.round(r.backdropFadeMs * k)), delay: t.openAt, easing: 'ease-out', fill: 'backwards' }, animations);
  }

  if (reduced) {
    // One plain fade: the tablets fade in with the overlay, every one clickable from the first frame.
    for (const el of slots) {
      anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.max(1, t.endAt - t.openAt), delay: t.openAt, easing: 'ease-out', fill: 'backwards' }, animations);
    }
    slots.forEach((_, i) => land(i));
  } else {
    // The shade: the forge starts in shadow and lifts as the tablets land. A static-opacity layer, opacity only.
    const shade = root.querySelector<HTMLElement>('.rfe-shade');
    if (opts.withBackdrop && shade && r.backdropDim > 0 && t.shadeOutAt > t.openAt) {
      const span = t.shadeOutAt - t.openAt;
      const hold = Math.min(1, Math.max(0, (t.shadeInAt - t.openAt) / span));
      anim(shade, [
        { offset: 0, opacity: r.backdropDim },
        { offset: hold, opacity: r.backdropDim, easing: 'ease-in-out' },
        { offset: 1, opacity: 0 },
      ], { duration: span, delay: t.openAt, fill: 'backwards' }, animations);
    }

    // The re-roll / footer waits for the last landing, so the eye goes to the tablets first.
    const footer = root.querySelector<HTMLElement>('.forge-actions');
    const lastLand = t.cards.length ? t.cards[t.cards.length - 1]!.landAt : 0;
    if (opts.withBackdrop && footer && lastLand > 0) {
      anim(footer, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.round(220 * k), delay: lastLand, easing: 'ease-out', fill: 'backwards' }, animations);
    }

    const frames = dropKeyframes(r);
    slots.forEach((el, i) => {
      const b = t.cards[i]!;
      anim(el, frames, { duration: Math.max(1, b.settledAt - b.startAt), delay: b.startAt, fill: 'backwards' }, animations);

      // The glow sweep + ignite, once settled. ONE quick, even pass (owner 2026-09-24: "the shine wipe gets slow
      // and choppy at the end ... just make it sweep quickly"): a gentle ease-in-out with no decelerating tail (the
      // first cut's strong ease-out spent its last third crawling a few px per frame, which read as choppy). The band
      // is a pre-rendered gradient on its own layer and only its transform moves; nothing re-rasterizes per frame.
      // The ignite ring (a static glow, opacity only) keeps its own slightly longer fade so the tablet still glows.
      if (r.glowSweepMs > 0) {
        const sweep = Math.round(r.glowSweepMs * k);
        anim(el.querySelector('.rfe-sweep-band'), [
          { transform: 'translate3d(-140%, 0, 0) skewX(-18deg)' },
          { transform: 'translate3d(260%, 0, 0) skewX(-18deg)' },
        ], { duration: sweep, delay: b.settledAt, easing: 'cubic-bezier(0.37, 0, 0.63, 1)', fill: 'backwards' }, animations);
        anim(el.querySelector('.rfe-ignite'), [
          { opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 },
        ], { duration: Math.round(igniteMs(r) * k), delay: b.settledAt, easing: 'ease-out', fill: 'none' }, animations);
      }

      // THE LANDING: clickable, dust, thud.
      at(b.landAt, () => {
        land(i);
        const p = bases[i];
        if (p && r.dustIntensity > 0 && fxOk()) {
          const stop = playDef('runeforge-land-dust', { source: p, target: p, cursor: p }, {
            intensity: r.dustIntensity, scale: r.dustScale, time: r.dustTime, alpha: r.dustOpacity,
            // The Epic forge's dust carries a violet cast. A whole-def palette swap, not a second def.
            recolor: r.epic ? [0x5a4a78, 0x8a76b0, 0xb9a6dc, 0xe6dcf6] : undefined,
          });
          if (stop) fx.push(stop);
        }
      });
      // Sound cues, clamped so a negative offset can never pull one inside the post-wipe pad.
      at(Math.max(t.openAt, b.landAt + cueSetting(c, 'land').offsetMs), () => cue('land', i));
      at(Math.max(t.openAt, b.landAt + cueSetting(c, 'dust').offsetMs), () => { if (r.dustIntensity > 0) cue('dust', i); });
      // The glow SWEEP sound, in sync with the sweep: once per forge (the first tablet's sweep) by default, or on
      // every tablet's sweep with a minimum gap so four of them never stack.
      if (r.glowSweepMs > 0 && (c.sfxSweepEach >= 0.5 || i === 0)) {
        at(Math.max(t.openAt, b.settledAt + cueSetting(c, 'sweep').offsetMs), () => {
          const now = Date.now();
          if (c.sfxSweepEach >= 0.5 && now - lastSweepSfx < Math.max(0, c.sfxSweepGapMs) * k) return;
          lastSweepSfx = now;
          cue('sweep', i);
        });
      }
    });

    // Embers off the forge floor as it opens.
    if (opts.withBackdrop && r.emberCount > 0 && floor) {
      at(t.openAt + Math.round(r.startDelayMs * 0.4 * k), () => {
        if (!fxOk()) return;
        const stop = playDef('runeforge-embers', { source: floor, target: floor, cursor: floor }, {
          intensity: r.emberCount / DEF_EMBERS,
          recolor: r.epic ? [0x6a2fb0, 0xb078e6, 0xffc86a, 0xfff2d8] : undefined,
        });
        if (stop) fx.push(stop);
      });
    }

    // The Epic flare, as the last tablet lands.
    if (t.flareAt !== null && centre) {
      at(t.flareAt, () => {
        if (!fxOk()) return;
        const stop = playDef('runeforge-epic-flare', { source: centre, target: centre, cursor: centre }, { intensity: r.flare, scale: Math.max(0.5, Math.sqrt(r.flare)) });
        if (stop) fx.push(stop);
      });
      at(Math.max(t.openAt, t.flareAt + cueSetting(c, 'epicFlare').offsetMs), () => cue('epicFlare', -1));
    }
  }

  const settle = (): void => {
    if (!running) return;
    running = false;
    for (const id of timers) window.clearTimeout(id);
    timers.length = 0;
    for (const a of animations) { try { a.finish(); } catch { /* an infinite or already-cancelled animation */ } }
    animations.length = 0;
    slots.forEach((_, i) => land(i));
    root.dataset.rfePhase = 'settled';
    if (active === handle) active = null;
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
    resolved: r,
    timeline: t,
  };

  // ── THE CLOCK ──
  // Beats are timed from the moment the animations ACTUALLY START, not from this call. The first cut started its
  // timers here, in the layout effect, which runs BEFORE the commit's paint; WAAPI animations only start on the
  // frame they are first rendered. When that first frame is long (a cold forge decoding four tablets' art with
  // `decoding="sync"`, a dev build's StrictMode commit), every timer ran ahead of the visuals by that frame's
  // length: the thuds (and dust) fired before the tablets had even appeared, then bunched together. That is the
  // owner's "playing the sound early and continuously" (2026-09-24). Now the queue is released on the lead
  // animation's `ready`, minus however long ago it actually started, so the land cue sits on the impact frame.
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
    // Backstop: a hidden tab never starts an animation, and a tablet must never be left un-clickable waiting on it.
    timers.push(window.setTimeout(() => startClock(lagOf(lead)), 250));
  } else {
    startClock(0); // no WAAPI (tests, very old engines): the timers are the only clock
  }

  active?.skip();
  active = handle;
  return handle;
}
