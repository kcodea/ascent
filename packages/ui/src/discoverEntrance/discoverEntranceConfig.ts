import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import type { TailOpts } from '../audio/tailFade';
import { clipNames } from '../sfx';

/**
 * THE DISCOVER ENTRANCE — its tunable numbers (owner ask 2026-09-25: *"improve our discover card animation. i want
 * a brief but clean fly in or float in of the cards, with some dust and pixi to make it look clean/exciting but not
 * over the top, with sound effects to match the vibe."*).
 *
 * Follows the tuner convention (the Runeforge entrance's, PR #1706): localStorage-persisted in DEV only, production
 * always plays `DCE_DEFAULTS`. Every value is read when an entrance STARTS, so moving a slider changes the next play
 * and ▶ Play shows it at once. Shipping a feel = pasting the tuned numbers into `DCE_DEFAULTS`.
 *
 * The sequence, per Discover (and Choose One) opening:
 *
 *   the overlay's scrim fades up (its own 200 ms CSS fade)  →  the open cue  →  the option cards float in, left to
 *   right, a soft whoosh under them  →  each card arrives with a tiny settle, a puff of golden dust and a few glints,
 *   and is CLICKABLE from that moment  →  a light shimmer crosses each card  →  one sparkle for the set  →  done.
 */
export interface DiscoverEntranceConfig {
  // ── Timing ──
  /** A pause from the overlay mounting to anything moving or sounding (0 = at once). */
  openDelayMs: number;
  /** From the overlay appearing to the first card starting its flight. */
  startDelayMs: number;
  /** Gap between one card starting its flight and the next (left to right). */
  staggerMs: number;
  /** One card's whole flight: the travel, the tiny overshoot and the settle. */
  flyMs: number;
  // ── Motion ──
  /** Where the cards come from: rise (from below), drop (from above), left, right, or fan (out of the middle card). */
  direction: string;
  /** How far from its resting place a card starts, in px. */
  distance: number;
  /** A card's starting size (1 = full size). It grows to full size as it arrives. */
  startScale: number;
  /** A slight starting tilt that straightens as it arrives, in degrees (alternating per card). 0 = none. */
  tiltDeg: number;
  /** How far past its resting place a card drifts before it settles back, in px. 0 = no settle. */
  settlePx: number;
  // ── Dust + glints (Pixi, on the above-modal canvas) ──
  /** Golden dust per arrival, as a multiplier on the authored puff (`discover-arrive`). 0 = no dust. */
  dustCount: number;
  /** Dust size and spread, as a multiplier. */
  dustSize: number;
  /** How opaque the dust is (0..1). */
  dustOpacity: number;
  /** How long the dust hangs, as a multiplier. */
  dustLife: number;
  /** The glints (small star sparkles over each arriving card), as a multiplier on `discover-glint`. 0 = none. */
  glints: number;
  // ── Shimmer (a light band crossing each card once it arrives; transform only) ──
  /** The band's crossing time. 0 = no shimmer. */
  shimmerMs: number;
  /** How bright the band is (0..1). */
  shimmerOpacity: number;
  // ── Sound cues ──
  /** The Discover OPEN cue (the existing `discover` clip). It moved here from the store so it plays with the
   *  overlay, once, for every Discover (the second of a chain included), never while the overlay is held. */
  sfxOpenClip: string;
  sfxOpenGain: number;
  sfxOpenOffsetMs: number;
  sfxOpenStartMs: number;
  sfxOpenLenMs: number;
  sfxOpenFadeMs: number;
  /** The soft whoosh under the cards' flight: once per opening, from the first card's start. */
  sfxWhooshClip: string;
  sfxWhooshGain: number;
  sfxWhooshOffsetMs: number;
  sfxWhooshStartMs: number;
  sfxWhooshLenMs: number;
  sfxWhooshFadeMs: number;
  /** The light settle as a card arrives. */
  sfxArriveClip: string;
  sfxArriveGain: number;
  sfxArriveOffsetMs: number;
  sfxArriveStartMs: number;
  sfxArriveLenMs: number;
  sfxArriveFadeMs: number;
  /** 0 = once per opening (the first card); 1 = on every card, spaced by the gap below. */
  sfxArriveEach: number;
  /** Every-card mode: an arrive sound within this many ms of the last one is skipped, so they never stack. */
  sfxArriveGapMs: number;
  /** The sparkle once the set is in: once per opening, at the LAST card's arrival. */
  sfxSparkleClip: string;
  sfxSparkleGain: number;
  sfxSparkleOffsetMs: number;
  sfxSparkleStartMs: number;
  sfxSparkleLenMs: number;
  sfxSparkleFadeMs: number;
  /** A light reverb tail under every cue (0 = dry), so nothing ends abruptly (the PR #1708 soft-tail voice). */
  reverbMix: number;
  /** How long that tail rings, in seconds. */
  reverbSec: number;
  // ── Look (owner pick 2026-09-25): the ornate title banner and the spotlight backdrop. STATIC, never animated;
  //    applied as CSS custom properties on the document root (see `applyDiscoverLook`), so a dial moves the look live.
  /** The banner's title size, in design px (its flourishes and subtitle scale with it). */
  lookBannerSize: number;
  /** How dark the scrim is behind the cards (the middle of the screen), 0..1. */
  lookTint: number;
  /** How dark the scrim gets at the screen's edges (the vignette), 0..1. */
  lookVignette: number;
  /** The spotlight's size: its vertical radius in vh (it is 1.6x as wide). */
  lookSpotRadius: number;
  /** How bright the warm spotlight behind the cards is, 0..1. 0 = no spotlight. */
  lookSpotStrength: number;
  /** The Peek / Return button under the cards, as a size multiplier (1 = shipped). */
  lookPeekSize: number;
}

/** "No clip mapped": the cue fires nothing. The select shows it as "(none)". */
export const NO_CLIP = '';

/** The flight directions, in select order. */
export const DIRECTIONS = ['rise', 'drop', 'left', 'right', 'fan'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** The owner's sparkle-whoosh (also the Good Luck intro's spark and the Stellar Lens sparkle). */
export const SPARKLE_WHOOSH_CLIP = 'fx/djartmusic-christmas-sparkle-whoosh-1-275404';
/** The soft swish from the FX workbench imports. */
export const SOFT_SWISH_CLIP = 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3';

/**
 * Shipped values. With three cards: the first card starts at 40 ms and is clickable at ~320 ms; the last starts at
 * 180 ms, is clickable at ~460 ms and settled at 580 ms; its shimmer is done by ~860 ms. The whole flight reads as
 * about half a second.
 */
export const DCE_DEFAULTS: DiscoverEntranceConfig = {
  openDelayMs: 0,
  startDelayMs: 40,
  staggerMs: 70,
  flyMs: 400,
  direction: 'rise',
  distance: 70,
  startScale: 0.9,
  tiltDeg: 1.5,
  settlePx: 4,
  dustCount: 1,
  dustSize: 1,
  dustOpacity: 0.7,
  dustLife: 1,
  glints: 1,
  shimmerMs: 360,
  shimmerOpacity: 0.55,
  sfxOpenClip: 'discover',
  sfxOpenGain: 1,
  sfxOpenOffsetMs: 0,
  sfxOpenStartMs: 0,
  sfxOpenLenMs: 0,
  sfxOpenFadeMs: 0,
  sfxWhooshClip: SOFT_SWISH_CLIP,
  sfxWhooshGain: 0.45,
  sfxWhooshOffsetMs: 0,
  // The swish peaks 450 ms into the file; starting 150 ms in puts that peak over the arrivals. Its long tail is cut
  // at 900 ms and faded over the last 350 ms.
  sfxWhooshStartMs: 150,
  sfxWhooshLenMs: 900,
  sfxWhooshFadeMs: 350,
  sfxArriveClip: 'cardtouch',
  sfxArriveGain: 0.6,
  sfxArriveOffsetMs: 0,
  sfxArriveStartMs: 0,
  sfxArriveLenMs: 0,
  sfxArriveFadeMs: 60,
  sfxArriveEach: 1,
  sfxArriveGapMs: 60,
  sfxSparkleClip: SPARKLE_WHOOSH_CLIP,
  sfxSparkleGain: 0.4,
  sfxSparkleOffsetMs: 0,
  // Only the glitter: the file's whoosh builds to its sparkle peak at ~1.5 s, so 1.25 s in puts the peak ~250 ms
  // after the last card arrives, alongside the shimmer.
  sfxSparkleStartMs: 1250,
  sfxSparkleLenMs: 850,
  sfxSparkleFadeMs: 350,
  reverbMix: 0.15,
  reverbSec: 0.6,
  lookBannerSize: 50,
  lookTint: 0.84,
  lookVignette: 0.95,
  lookSpotRadius: 40,
  lookSpotStrength: 0.4,
  lookPeekSize: 1,
};

type NumKey = { [K in keyof DiscoverEntranceConfig]: DiscoverEntranceConfig[K] extends number ? K : never }[keyof DiscoverEntranceConfig];
type StrKey = { [K in keyof DiscoverEntranceConfig]: DiscoverEntranceConfig[K] extends string ? K : never }[keyof DiscoverEntranceConfig];
const STR_KEYS: readonly StrKey[] = ['direction', 'sfxOpenClip', 'sfxWhooshClip', 'sfxArriveClip', 'sfxSparkleClip'];
const isStrKey = (k: string): k is StrKey => (STR_KEYS as readonly string[]).includes(k);

export const DCE_RANGES: Record<NumKey, [number, number, number]> = {
  openDelayMs: [0, 800, 10],
  startDelayMs: [0, 600, 10],
  staggerMs: [0, 300, 5],
  flyMs: [80, 1200, 10],
  distance: [0, 400, 1],
  startScale: [0.5, 1.1, 0.01],
  tiltDeg: [0, 12, 0.25],
  settlePx: [0, 30, 0.5],
  dustCount: [0, 4, 0.05],
  dustSize: [0.2, 3, 0.05],
  dustOpacity: [0, 1, 0.01],
  dustLife: [0.3, 3, 0.05],
  glints: [0, 4, 0.05],
  shimmerMs: [0, 1200, 10],
  shimmerOpacity: [0, 1, 0.01],
  sfxOpenGain: [0, 2, 0.01],
  sfxOpenOffsetMs: [-300, 600, 5],
  sfxOpenStartMs: [0, 4000, 10],
  sfxOpenLenMs: [0, 4000, 10],
  sfxOpenFadeMs: [0, 1000, 10],
  sfxWhooshGain: [0, 2, 0.01],
  sfxWhooshOffsetMs: [-300, 600, 5],
  sfxWhooshStartMs: [0, 4000, 10],
  sfxWhooshLenMs: [0, 4000, 10],
  sfxWhooshFadeMs: [0, 1000, 10],
  sfxArriveGain: [0, 2, 0.01],
  sfxArriveOffsetMs: [-300, 600, 5],
  sfxArriveStartMs: [0, 4000, 10],
  sfxArriveLenMs: [0, 4000, 10],
  sfxArriveFadeMs: [0, 1000, 10],
  sfxArriveEach: [0, 1, 1],
  sfxArriveGapMs: [0, 600, 10],
  sfxSparkleGain: [0, 2, 0.01],
  sfxSparkleOffsetMs: [-300, 600, 5],
  sfxSparkleStartMs: [0, 4000, 10],
  sfxSparkleLenMs: [0, 4000, 10],
  sfxSparkleFadeMs: [0, 1000, 10],
  reverbMix: [0, 0.6, 0.01],
  reverbSec: [0.2, 2, 0.05],
  lookBannerSize: [24, 80, 1],
  lookTint: [0, 1, 0.01],
  lookVignette: [0, 1, 0.01],
  lookSpotRadius: [15, 80, 1],
  lookSpotStrength: [0, 1, 0.01],
  lookPeekSize: [0.6, 1.8, 0.01],
};

const KEY = 'ascent.discoverentrance';

let cfg: DiscoverEntranceConfig = (() => {
  if (!import.meta.env.DEV) return { ...DCE_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DCE_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<DiscoverEntranceConfig>) : {}) };
  } catch {
    return { ...DCE_DEFAULTS };
  }
})();

export function getDiscoverEntranceConfig(): DiscoverEntranceConfig {
  return cfg;
}

/** The look dials as the CSS custom properties `discoverEntrance.css` reads (pure, for the tests). */
export function discoverLookVars(c: DiscoverEntranceConfig): Record<string, string> {
  return {
    '--dcl-banner': String(num(c.lookBannerSize, DCE_DEFAULTS.lookBannerSize)),
    '--dcl-tint': String(num(c.lookTint, DCE_DEFAULTS.lookTint)),
    '--dcl-vignette': String(num(c.lookVignette, DCE_DEFAULTS.lookVignette)),
    '--dcl-spot-r': String(num(c.lookSpotRadius, DCE_DEFAULTS.lookSpotRadius)),
    '--dcl-spot': String(num(c.lookSpotStrength, DCE_DEFAULTS.lookSpotStrength)),
    '--dcl-peek': String(num(c.lookPeekSize, DCE_DEFAULTS.lookPeekSize)),
  };
}

/** Writes the look dials onto the document root: once at load, and again whenever a dial moves. The CSS carries the
 *  same defaults as fallbacks, so a page that never ran this still paints the shipped look. */
export function applyDiscoverLook(c: DiscoverEntranceConfig = cfg): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  for (const [k, v] of Object.entries(discoverLookVars(c))) style.setProperty(k, v);
}

export function setDiscoverEntranceValue(key: keyof DiscoverEntranceConfig, value: number | string): void {
  cfg = { ...cfg, [key]: isStrKey(key) ? String(value) : Number(value) };
  applyDiscoverLook(cfg);
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetDiscoverEntranceConfig(): void {
  cfg = { ...DCE_DEFAULTS };
  applyDiscoverLook(cfg);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

applyDiscoverLook(cfg);

// ─── the sequence (pure) ──────────────────────────────────────────────────────────────────────────────────────

/** Where on its flight a card ARRIVES (reaches its overshoot, the dust puffs, it becomes clickable), as a fraction. */
export const ARRIVE_AT = 0.7;
/** The reduced-motion fade. */
export const REDUCED_FADE_MS = 180;

/** One card's beats, in ms from the overlay appearing. */
export interface CardBeats {
  startAt: number;
  /** Arrived: dust, glints, the arrive cue. CLICKABLE from here. */
  arriveAt: number;
  /** Fully at rest. */
  settledAt: number;
}

export interface EntranceTimeline {
  /** The open pad has passed: the open cue plays here. */
  openAt: number;
  cards: CardBeats[];
  /** Everything has played (the last shimmer included). */
  endAt: number;
}

function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * The beats for one opening of `count` cards. `speed` > 1 compresses every beat (a replay at 2x), and `reduced`
 * (prefers-reduced-motion) collapses the flight into one plain fade: every card is clickable from the first frame.
 */
export function entranceTimeline(
  c: DiscoverEntranceConfig, count: number, opts: { reduced?: boolean; speed?: number } = {},
): EntranceTimeline {
  const k = 1 / (opts.speed && Number.isFinite(opts.speed) && opts.speed > 0 ? opts.speed : 1);
  const n = Math.max(0, Math.floor(count));
  const openAt = Math.round(Math.max(0, num(c.openDelayMs)) * k);
  if (opts.reduced) {
    return {
      openAt,
      cards: Array.from({ length: n }, () => ({ startAt: openAt, arriveAt: openAt, settledAt: openAt })),
      endAt: openAt + Math.round(REDUCED_FADE_MS * k),
    };
  }
  const fly = Math.max(1, num(c.flyMs, 400)) * k;
  const cards: CardBeats[] = Array.from({ length: n }, (_, i) => {
    const startAt = openAt + Math.round((Math.max(0, num(c.startDelayMs)) + i * Math.max(0, num(c.staggerMs))) * k);
    return { startAt, arriveAt: Math.round(startAt + fly * ARRIVE_AT), settledAt: Math.round(startAt + fly) };
  });
  const last = cards[cards.length - 1];
  const shimmer = c.shimmerMs > 0 ? Math.round(c.shimmerMs * k) : 0;
  const endAt = Math.max(openAt, last ? Math.max(last.settledAt, last.arriveAt + shimmer) : openAt);
  return { openAt, cards, endAt };
}

/** A card's start offset for the flight: where it comes from, relative to its resting place (px). */
export function startOffset(c: DiscoverEntranceConfig, i: number, count: number, fanDx = 0): { x: number; y: number } {
  const d = Math.max(0, num(c.distance));
  switch (c.direction as Direction) {
    case 'drop': return { x: 0, y: -d };
    case 'left': return { x: -d, y: 0 };
    case 'right': return { x: d, y: 0 };
    // Fan: every card starts stacked on the middle card (fanDx is centre minus this card's x), a touch below.
    case 'fan': return { x: fanDx, y: d * 0.35 };
    case 'rise':
    default: {
      void i; void count;
      return { x: 0, y: d };
    }
  }
}

/**
 * The flight's keyframes for one card, as WAAPI frames on its SLOT wrapper (never the card itself, whose hover lift
 * owns its own transform). Transform + opacity only. A gentle ease-out into a tiny overshoot past the resting place
 * (along the direction of travel) at the ARRIVE point, then a soft settle back.
 */
export function flyKeyframes(c: DiscoverEntranceConfig, from: { x: number; y: number }, i: number): Keyframe[] {
  const len = Math.hypot(from.x, from.y);
  const settle = Math.max(0, num(c.settlePx));
  // The overshoot continues the travel direction: from (x, y) toward (0, 0), then `settle` px beyond it.
  const ox = len > 0 ? (-from.x / len) * settle : 0;
  const oy = len > 0 ? (-from.y / len) * settle : 0;
  const s0 = Math.max(0.1, num(c.startScale, 1));
  const tilt = Math.max(0, num(c.tiltDeg)) * (i % 2 === 0 ? -1 : 1);
  const r = (v: number): number => Math.round(v * 100) / 100;
  return [
    { offset: 0, opacity: 0, transform: `translate(${r(from.x)}px, ${r(from.y)}px) scale(${s0}) rotate(${tilt}deg)`, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    { offset: ARRIVE_AT * 0.5, opacity: 1 },
    { offset: ARRIVE_AT, opacity: 1, transform: `translate(${r(ox)}px, ${r(oy)}px) scale(1) rotate(0deg)`, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
    { offset: 1, opacity: 1, transform: 'translate(0px, 0px) scale(1) rotate(0deg)' },
  ];
}

// ─── sound cues ───────────────────────────────────────────────────────────────────────────────────────────────

export type EntranceCue = 'open' | 'whoosh' | 'arrive' | 'sparkle';
export const ENTRANCE_CUES: readonly EntranceCue[] = ['open', 'whoosh', 'arrive', 'sparkle'];

/** The mixer category each cue plays through (its own desk fader; `open` keeps the existing Discover fader). */
export const CUE_CATEGORY: Record<EntranceCue, string> = {
  open: 'discover', whoosh: 'discoverWhoosh', arrive: 'discoverArrive', sparkle: 'discoverSparkle',
};

export interface CueSetting {
  clip: string;
  gain: number;
  offsetMs: number;
  /** A window of the clip: start this far in, play this long (0 = to the end). */
  startMs: number;
  lenMs: number;
  tail: TailOpts;
}

/** A cue's currently-mapped clip, gain, offset, window and tail. An empty clip or a zero gain = silent. */
export function cueSetting(c: DiscoverEntranceConfig, cue: EntranceCue): CueSetting {
  const tail = (fadeOutMs: number): TailOpts => ({ fadeOutMs, reverbMix: c.reverbMix, reverbSec: c.reverbSec });
  switch (cue) {
    case 'open': return { clip: c.sfxOpenClip, gain: c.sfxOpenGain, offsetMs: c.sfxOpenOffsetMs, startMs: c.sfxOpenStartMs, lenMs: c.sfxOpenLenMs, tail: tail(c.sfxOpenFadeMs) };
    case 'whoosh': return { clip: c.sfxWhooshClip, gain: c.sfxWhooshGain, offsetMs: c.sfxWhooshOffsetMs, startMs: c.sfxWhooshStartMs, lenMs: c.sfxWhooshLenMs, tail: tail(c.sfxWhooshFadeMs) };
    case 'arrive': return { clip: c.sfxArriveClip, gain: c.sfxArriveGain, offsetMs: c.sfxArriveOffsetMs, startMs: c.sfxArriveStartMs, lenMs: c.sfxArriveLenMs, tail: tail(c.sfxArriveFadeMs) };
    case 'sparkle': return { clip: c.sfxSparkleClip, gain: c.sfxSparkleGain, offsetMs: c.sfxSparkleOffsetMs, startMs: c.sfxSparkleStartMs, lenMs: c.sfxSparkleLenMs, tail: tail(c.sfxSparkleFadeMs) };
  }
}

// ─── the tuner ────────────────────────────────────────────────────────────────────────────────────────────────

/** [label, unit, hint, group]. Declaration order is render order. */
const SPECS: Record<NumKey, [string, TunerUnit | undefined, string, string]> = {
  openDelayMs: ['Open delay', 'ms', 'A pause after the Discover appears before anything moves or sounds. 0 = at once.', 'Timing'],
  startDelayMs: ['Start delay', 'ms', 'From the overlay appearing to the first card starting its flight.', 'Timing'],
  staggerMs: ['Stagger', 'ms', 'Gap between one card starting and the next, left to right.', 'Timing'],
  flyMs: ['Flight duration', 'ms', "One card's whole flight: travel, tiny overshoot, settle. It arrives (and is clickable) 70% of the way in.", 'Timing'],
  distance: ['Distance', 'px', 'How far from its resting place a card starts.', 'Motion'],
  startScale: ['Start scale', '×', 'How big a card is when it starts (it grows to full size as it arrives).', 'Motion'],
  tiltDeg: ['Tilt', '°', 'A slight starting tilt that straightens as it arrives (alternates per card). 0 = none.', 'Motion'],
  settlePx: ['Settle', 'px', 'How far past its resting place a card drifts before settling back. 0 = no settle.', 'Motion'],
  dustCount: ['Dust count', '×', 'Golden dust per arrival, as a multiplier on the authored puff. 0 = no dust.', 'Dust + glints'],
  dustSize: ['Dust size', '×', 'Dust particle size and spread.', 'Dust + glints'],
  dustOpacity: ['Dust opacity', 'opacity', 'How opaque the dust is.', 'Dust + glints'],
  dustLife: ['Dust lifetime', '×', 'How long the dust hangs.', 'Dust + glints'],
  glints: ['Glints', '×', 'Small star sparkles over each arriving card. 0 = none.', 'Dust + glints'],
  shimmerMs: ['Shimmer', 'ms', 'How long the light band takes to cross a card once it arrives. 0 = no shimmer.', 'Shimmer'],
  shimmerOpacity: ['Shimmer brightness', 'opacity', 'How bright the band is.', 'Shimmer'],
  sfxOpenGain: ['open: gain', undefined, 'Volume of the Discover open cue (on top of its mixer fader).', 'Sound: open'],
  sfxOpenOffsetMs: ['open: offset', 'ms', 'Shift the open cue from the overlay appearing.', 'Sound: open'],
  sfxOpenStartMs: ['open: clip start', 'ms', 'Start this far into the clip.', 'Sound: open'],
  sfxOpenLenMs: ['open: clip length', 'ms', 'Play only this long (0 = to the end).', 'Sound: open'],
  sfxOpenFadeMs: ['open: fade-out', 'ms', 'Fade over the last N ms so it never stops dead.', 'Sound: open'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'Volume of the whoosh under the flight.', 'Sound: whoosh'],
  sfxWhooshOffsetMs: ['whoosh: offset', 'ms', "Shift the whoosh from the first card's start. Negative = earlier.", 'Sound: whoosh'],
  sfxWhooshStartMs: ['whoosh: clip start', 'ms', 'Start this far into the clip.', 'Sound: whoosh'],
  sfxWhooshLenMs: ['whoosh: clip length', 'ms', 'Play only this long (0 = to the end).', 'Sound: whoosh'],
  sfxWhooshFadeMs: ['whoosh: fade-out', 'ms', 'Fade over the last N ms.', 'Sound: whoosh'],
  sfxArriveGain: ['arrive: gain', undefined, 'Volume of the settle as a card arrives.', 'Sound: arrive'],
  sfxArriveOffsetMs: ['arrive: offset', 'ms', "Shift the arrive cue from each card's arrival.", 'Sound: arrive'],
  sfxArriveStartMs: ['arrive: clip start', 'ms', 'Start this far into the clip.', 'Sound: arrive'],
  sfxArriveLenMs: ['arrive: clip length', 'ms', 'Play only this long (0 = to the end).', 'Sound: arrive'],
  sfxArriveFadeMs: ['arrive: fade-out', 'ms', 'Fade over the last N ms.', 'Sound: arrive'],
  sfxArriveEach: ['arrive: every card', undefined, 'Off: one arrive sound per opening (the first card). On: one per card, spaced by the gap below.', 'Sound: arrive'],
  sfxArriveGapMs: ['arrive: min gap', 'ms', 'Every-card mode: an arrive sound this soon after the last one is skipped, so they never stack.', 'Sound: arrive'],
  sfxSparkleGain: ['sparkle: gain', undefined, 'Volume of the sparkle once the set is in (the last card arriving).', 'Sound: sparkle'],
  sfxSparkleOffsetMs: ['sparkle: offset', 'ms', "Shift the sparkle from the last card's arrival.", 'Sound: sparkle'],
  sfxSparkleStartMs: ['sparkle: clip start', 'ms', 'Start this far into the clip (the default skips the whoosh and plays the glitter).', 'Sound: sparkle'],
  sfxSparkleLenMs: ['sparkle: clip length', 'ms', 'Play only this long (0 = to the end).', 'Sound: sparkle'],
  sfxSparkleFadeMs: ['sparkle: fade-out', 'ms', 'Fade over the last N ms so the cut window rings out.', 'Sound: sparkle'],
  reverbMix: ['Reverb mix', undefined, 'A light reverb tail under every cue. 0 = dry.', 'Sound: tail'],
  reverbSec: ['Reverb length', 's', 'How long that tail rings.', 'Sound: tail'],
  lookBannerSize: ['Banner size', 'px', 'The gold title banner (Discover / Choose One): its title size. The flourishes and the subtitle scale with it. Moves live.', 'Look'],
  lookTint: ['Backdrop tint', 'opacity', 'How dark the backdrop is behind the cards (the middle of the screen). Moves live.', 'Look'],
  lookVignette: ['Vignette', 'opacity', "How dark the backdrop gets toward the screen's edges. Moves live.", 'Look'],
  lookSpotRadius: ['Spotlight radius', 'vh', 'The size of the soft spotlight behind the cards: its height radius as a share of the screen height (it is 1.6x as wide). Moves live.', 'Look'],
  lookSpotStrength: ['Spotlight strength', 'opacity', 'How bright the warm spotlight behind the cards is. 0 = none. Moves live.', 'Look'],
  lookPeekSize: ['Peek button size', '×', 'The "Peek at board" / "Return to Discover" button under the cards: its overall size. Moves live.', 'Look'],
};

/** Which string select sits at the head of a group, keyed by the first numeric control of that group. */
const SELECT_BEFORE: Partial<Record<NumKey, [StrKey, string, string]>> = {
  distance: ['direction', 'Direction', 'Where the cards come from: rise (from below), drop (from above), left, right, or fan (out of the middle card).'],
  sfxOpenGain: ['sfxOpenClip', 'open: clip', 'Which clip this cue plays. (none) = silent.'],
  sfxWhooshGain: ['sfxWhooshClip', 'whoosh: clip', 'Which clip this cue plays. (none) = silent.'],
  sfxArriveGain: ['sfxArriveClip', 'arrive: clip', 'Which clip this cue plays. (none) = silent.'],
  sfxSparkleGain: ['sfxSparkleClip', 'sparkle: clip', 'Which clip this cue plays. (none) = silent.'],
};

function clipOptions(): string[] {
  let names: string[] = [];
  try { names = clipNames(); } catch { /* no audio in this environment */ }
  return [NO_CLIP, ...names.filter((n) => n !== NO_CLIP)];
}

function buildControls(): TunerControl<Extract<keyof DiscoverEntranceConfig, string>>[] {
  const out: TunerControl<Extract<keyof DiscoverEntranceConfig, string>>[] = [];
  const clips = clipOptions();
  for (const key of Object.keys(SPECS) as NumKey[]) {
    const [label, unit, hint, group] = SPECS[key];
    const sel = SELECT_BEFORE[key];
    if (sel) {
      const isDir = sel[0] === 'direction';
      out.push({
        key: sel[0], label: sel[1], hint: sel[2], group, kind: 'select',
        options: isDir ? DIRECTIONS : clips, optionLabels: isDir ? undefined : { [NO_CLIP]: '(none)' },
        min: 0, max: 0, step: 0,
      });
    }
    const [min, max, step] = DCE_RANGES[key];
    out.push(key === 'sfxArriveEach'
      ? { key, label, unit, hint, group, min, max, step, kind: 'toggle', onValue: 1, offValue: 0 }
      : { key, label, unit, hint, group, min, max, step });
  }
  return out;
}

/** Window event ▶ Play fires; the entrance preview listens for it in dev builds. */
export const DCE_PLAY_EVENT = 'ascent:discover-entrance-play';

export const SPEC: TunerSpec<DiscoverEntranceConfig> = {
  id: 'discoverentrance',           // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Discover entrance',
  note: () => {
    const t = entranceTimeline(getDiscoverEntranceConfig(), 3);
    return `dev · ▶ to play · ${(t.endAt / 1000).toFixed(2)} s`;
  },
  read: getDiscoverEntranceConfig,
  write: (key, value) => setDiscoverEntranceValue(key, value),
  writeColor: (key, value) => setDiscoverEntranceValue(key, value),
  reset: resetDiscoverEntranceConfig,
  defaults: DCE_DEFAULTS,
  controls: buildControls(),
  actions: [
    {
      label: '▶ Play',
      hint: 'Open a sample Discover of three cards over the current screen and play the entrance with the values above. Pick a card or press Esc to close it.',
      run: () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DCE_PLAY_EVENT)); },
    },
  ],
};
