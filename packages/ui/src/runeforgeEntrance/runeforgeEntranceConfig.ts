import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import { clipNames } from '../sfx';

/**
 * THE RUNEFORGE ENTRANCE — its tunable numbers (owner ask 2026-09-24: *"i want the runeforge entrances to have a
 * small animation of them coming into view with dust settling etc ... make a tuner to sim this as well for us"*).
 *
 * Follows the tuner convention: localStorage-persisted in DEV only, production always plays `RFE_DEFAULTS`. Every
 * value is read when an entrance STARTS, so moving a slider changes the next play and the ▶ Play buttons show it at
 * once. Shipping a feel = pasting the tuned numbers into `RFE_DEFAULTS` (the tuner never publishes).
 *
 * The sequence, per forge opening:
 *
 *   the overlay fades up over the board, the forge still in shadow (the shade)  →  embers rise off the forge floor
 *   →  the rune tablets drop in, left to right, each landing with a squash, a dust puff and a thud  →  the shade
 *   lifts as they land  →  once settled, each tablet ignites (a one-shot glow sweep)  →  done.
 *
 * The Epic Runeforge plays the same sequence through the Epic multipliers (heavier drop, more dust, more embers)
 * plus a purple/gold flare as the last tablet lands.
 */
export interface RuneforgeEntranceConfig {
  // ── Timing ──
  /**
   * The pause between the return-to-shop wipe fully ending and the forge starting to open (owner 2026-09-24: "make
   * sure the runeforge opening is delayed enough to not trigger until the player has fully come back from combat and
   * the screen wipe has ended"). The forge overlay is only mounted once the wipe is idle (`overlaysHeld`), and this
   * pad runs from that moment. Nothing (visual or sound) plays inside it.
   */
  openDelayMs: number;
  /** The overlay (backdrop + scrim) fading up over the board. */
  backdropFadeMs: number;
  /** Wait from the overlay appearing to the first tablet starting its drop. */
  startDelayMs: number;
  /** Gap between one tablet starting its drop and the next (left to right). */
  staggerMs: number;
  /** One tablet's whole drop: the fall, the impact, the rebound and the settle. */
  dropMs: number;
  // ── Motion ──
  /** How far above (or below) its resting place a tablet starts, in px. */
  dropDistance: number;
  /** 1 = the tablets rise up from below instead of dropping from above. */
  fromBelow: number;
  /** How far past its resting place a tablet sinks on impact before settling back, in px. */
  overshootPx: number;
  /** The impact squash: how much a tablet flattens and widens as it lands (0 = rigid). */
  squash: number;
  // ── Dust ──
  /** Dust particles, as a multiplier on the authored puff (`runeforge-land-dust`). 0 = no dust. */
  dustCount: number;
  /** Dust size and spread, as a multiplier. */
  dustSize: number;
  /** How long the dust hangs before it settles, as a multiplier. */
  dustLife: number;
  /** How opaque the dust is (0..1). */
  dustOpacity: number;
  // ── Atmosphere ──
  /** How dark the forge starts before the tablets land (0 = no shade). It lifts as they land. */
  backdropDim: number;
  /** Embers rising off the forge floor as it opens. 0 = none. */
  emberCount: number;
  /** The one-shot glow sweep across each tablet once it has settled. 0 = no sweep. */
  glowSweepMs: number;
  // ── Epic ──
  /** Epic: multiplier on the drop distance. */
  epicDropMul: number;
  /** Epic: multiplier on the impact squash. */
  epicSquashMul: number;
  /** Epic: multiplier on the dust (count and size). */
  epicDustMul: number;
  /** Epic: multiplier on the ember count. */
  epicEmberMul: number;
  /** Epic: the purple/gold flare as the last tablet lands, as a multiplier. 0 = no flare. */
  epicFlare: number;
  // ── Sound cues (land and sweep ship with existing clips; dust and epicFlare await sourced SFX) ──
  sfxLandClip: string;
  sfxLandGain: number;
  sfxLandOffsetMs: number;
  sfxDustClip: string;
  sfxDustGain: number;
  sfxDustOffsetMs: number;
  /** The glow SWEEP sound (owner 2026-09-24: "add a sound section for the golden wipe/glow sweep"). */
  sfxSweepClip: string;
  sfxSweepGain: number;
  /** ms from each tablet's sweep start. */
  sfxSweepOffsetMs: number;
  /** 0 = once per forge (on the first tablet's sweep); 1 = on every tablet's sweep. */
  sfxSweepEach: number;
  /** Every-tablet mode: a sweep sound within this many ms of the last one is skipped, so they never stack. */
  sfxSweepGapMs: number;
  sfxEpicFlareClip: string;
  sfxEpicFlareGain: number;
  sfxEpicFlareOffsetMs: number;
}

/** "No clip mapped" — the cue fires nothing. The select shows it as "(none)". */
export const NO_CLIP = '';

/**
 * Shipped values: the owner's tuned feel (2026-09-24), plus the glow sweep sound section added after it. Measured from
 * the wipe ending, for the usual four tablets: 150 ms pad, then the first tablet starts dropping at 290 ms and lands
 * (clickable) at ~570 ms; the last lands at ~1020 ms and settles at 1220 ms; its 180 ms sweep is done by 1400 ms
 * and its glow has faded by ~1640 ms.
 */
export const RFE_DEFAULTS: RuneforgeEntranceConfig = {
  openDelayMs: 150,
  backdropFadeMs: 240,
  startDelayMs: 140,
  staggerMs: 150,
  dropMs: 480,
  dropDistance: 555,
  fromBelow: 0,
  overshootPx: 9,
  squash: 0.07,
  dustCount: 1,
  dustSize: 1,
  dustLife: 1,
  dustOpacity: 0.85,
  backdropDim: 0.66,
  emberCount: 47,
  glowSweepMs: 180,
  epicDropMul: 1.25,
  epicSquashMul: 1.35,
  epicDustMul: 1.7,
  epicEmberMul: 2.45,
  epicFlare: 2,
  // Land: the card landing thud, the one existing clip that clearly fits. Dust and epicFlare await sourced SFX.
  sfxLandClip: 'cardlanding',
  sfxLandGain: 0.55,
  sfxLandOffsetMs: 0,
  sfxDustClip: NO_CLIP,
  sfxDustGain: 0.5,
  sfxDustOffsetMs: 20,
  // The Equipment art sheen (the Good Luck intro's shine uses it too): the one existing shimmer that fits.
  sfxSweepClip: 'equipmentsheen',
  sfxSweepGain: 0.45,
  sfxSweepOffsetMs: 0,
  sfxSweepEach: 0,
  sfxSweepGapMs: 120,
  sfxEpicFlareClip: NO_CLIP,
  sfxEpicFlareGain: 0.55,
  sfxEpicFlareOffsetMs: 0,
};

type NumKey = { [K in keyof RuneforgeEntranceConfig]: RuneforgeEntranceConfig[K] extends number ? K : never }[keyof RuneforgeEntranceConfig];
type ClipKey = { [K in keyof RuneforgeEntranceConfig]: RuneforgeEntranceConfig[K] extends string ? K : never }[keyof RuneforgeEntranceConfig];
const CLIP_KEYS: readonly ClipKey[] = ['sfxLandClip', 'sfxDustClip', 'sfxSweepClip', 'sfxEpicFlareClip'];
const isClipKey = (k: string): k is ClipKey => (CLIP_KEYS as readonly string[]).includes(k);

export const RFE_RANGES: Record<NumKey, [number, number, number]> = {
  openDelayMs: [0, 1500, 10],
  backdropFadeMs: [0, 1200, 10],
  startDelayMs: [0, 1000, 10],
  staggerMs: [0, 600, 5],
  dropMs: [120, 1500, 10],
  dropDistance: [0, 800, 5],
  fromBelow: [0, 1, 1],
  overshootPx: [0, 60, 1],
  squash: [0, 0.3, 0.005],
  dustCount: [0, 4, 0.05],
  dustSize: [0.2, 3, 0.05],
  dustLife: [0.3, 3, 0.05],
  dustOpacity: [0, 1, 0.01],
  backdropDim: [0, 0.95, 0.01],
  emberCount: [0, 300, 1],
  glowSweepMs: [0, 1500, 10],
  epicDropMul: [0.5, 3, 0.05],
  epicSquashMul: [0.5, 3, 0.05],
  epicDustMul: [0.5, 4, 0.05],
  epicEmberMul: [0.5, 5, 0.05],
  epicFlare: [0, 3, 0.05],
  sfxLandGain: [0, 2, 0.01],
  sfxLandOffsetMs: [-300, 600, 5],
  sfxDustGain: [0, 2, 0.01],
  sfxDustOffsetMs: [-300, 600, 5],
  sfxSweepGain: [0, 2, 0.01],
  sfxSweepOffsetMs: [-300, 600, 5],
  sfxSweepEach: [0, 1, 1],
  sfxSweepGapMs: [0, 600, 10],
  sfxEpicFlareGain: [0, 2, 0.01],
  sfxEpicFlareOffsetMs: [-300, 600, 5],
};

const KEY = 'ascent.runeforgeentrance';

let cfg: RuneforgeEntranceConfig = (() => {
  if (!import.meta.env.DEV) return { ...RFE_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...RFE_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<RuneforgeEntranceConfig>) : {}) };
  } catch {
    return { ...RFE_DEFAULTS };
  }
})();

export function getRuneforgeEntranceConfig(): RuneforgeEntranceConfig {
  return cfg;
}

export function setRuneforgeEntranceValue(key: keyof RuneforgeEntranceConfig, value: number | string): void {
  cfg = { ...cfg, [key]: isClipKey(key) ? String(value) : Number(value) };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetRuneforgeEntranceConfig(): void {
  cfg = { ...RFE_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// ─── the resolved sequence (pure) ─────────────────────────────────────────────────────────────────────────────

/** Where on its drop a tablet touches down (the impact), as a fraction of `dropMs`. */
export const IMPACT_AT = 0.58;

/** The numbers one play actually uses: the config with the Epic multipliers folded in (or not). */
export interface ResolvedEntrance {
  epic: boolean;
  openDelayMs: number;
  backdropFadeMs: number;
  startDelayMs: number;
  staggerMs: number;
  dropMs: number;
  /** Signed start offset in px: negative = above its resting place, positive = below. */
  dropFrom: number;
  overshootPx: number;
  squash: number;
  dustIntensity: number;
  dustScale: number;
  dustTime: number;
  dustOpacity: number;
  backdropDim: number;
  emberCount: number;
  glowSweepMs: number;
  /** 0 = no flare (always 0 for a basic forge). */
  flare: number;
}

/** Fold the Epic multipliers in. A basic forge gets the config as-is and never a flare. */
export function resolveEntrance(c: RuneforgeEntranceConfig, epic: boolean): ResolvedEntrance {
  const m = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 1);
  const drop = Math.max(0, c.dropDistance) * (epic ? m(c.epicDropMul) : 1);
  const dustMul = epic ? m(c.epicDustMul) : 1;
  return {
    epic,
    openDelayMs: Math.max(0, Number.isFinite(c.openDelayMs) ? c.openDelayMs : 0),
    backdropFadeMs: Math.max(0, c.backdropFadeMs),
    startDelayMs: Math.max(0, c.startDelayMs),
    staggerMs: Math.max(0, c.staggerMs),
    dropMs: Math.max(1, c.dropMs),
    dropFrom: c.fromBelow >= 0.5 ? drop : -drop,
    overshootPx: Math.max(0, c.overshootPx),
    squash: Math.max(0, Math.min(0.5, c.squash * (epic ? m(c.epicSquashMul) : 1))),
    dustIntensity: Math.max(0, c.dustCount) * dustMul,
    // Size grows slower than count on the Epic: the extra dust should read as MORE, not as one giant cloud.
    dustScale: Math.max(0.05, c.dustSize) * Math.sqrt(dustMul),
    dustTime: Math.max(0.1, c.dustLife),
    dustOpacity: Math.max(0, Math.min(1, c.dustOpacity)),
    backdropDim: Math.max(0, Math.min(0.95, c.backdropDim)),
    emberCount: Math.max(0, Math.round(c.emberCount * (epic ? m(c.epicEmberMul) : 1))),
    glowSweepMs: Math.max(0, c.glowSweepMs),
    flare: epic ? Math.max(0, c.epicFlare) : 0,
  };
}

/** The ignite ring's fade on a settled tablet: a touch longer than the quick sweep, never shorter than 420 ms. */
export function igniteMs(r: ResolvedEntrance): number {
  return Math.max(420, r.glowSweepMs * 1.5);
}

/** One tablet's beats, in ms from the overlay appearing. */
export interface CardBeats {
  /** Starts its drop. */
  startAt: number;
  /** Touches down: the squash, the dust, the thud. The tablet is CLICKABLE from here. */
  landAt: number;
  /** Fully at rest. The glow sweep starts here. */
  settledAt: number;
}

/** A play's whole timeline. Pure, so ordering (and the Epic/basic split) is testable without a DOM. */
export interface EntranceTimeline {
  /** The overlay starts fading up (after the post-wipe pad; 0 for a re-roll). */
  openAt: number;
  cards: CardBeats[];
  /** The Epic flare (the last tablet's landing), or null when there is none. */
  flareAt: number | null;
  /** The shade starts lifting (the first landing) and is gone by `shadeOutAt`. */
  shadeInAt: number;
  shadeOutAt: number;
  /** Everything has played: the overlay is back to its plain settled state. */
  endAt: number;
}

/**
 * The beats for one play of `count` tablets. `speed` > 1 compresses every beat (a replay at 2x plays its forge at
 * 2x), and `reduced` (prefers-reduced-motion) collapses the whole thing to one fade: every tablet is clickable at
 * once and nothing drops, sweeps or flares.
 */
export function entranceTimeline(
  r: ResolvedEntrance, count: number, opts: { reduced?: boolean; speed?: number; opening?: boolean } = {},
): EntranceTimeline {
  const k = 1 / (opts.speed && Number.isFinite(opts.speed) && opts.speed > 0 ? opts.speed : 1);
  const n = Math.max(0, Math.floor(count));
  // The post-wipe pad applies to the forge OPENING only (default); a re-roll drops its tablets at once.
  const openAt = opts.opening === false ? 0 : Math.round(r.openDelayMs * k);
  if (opts.reduced) {
    const fade = Math.round(r.backdropFadeMs * k);
    return {
      openAt,
      cards: Array.from({ length: n }, () => ({ startAt: openAt, landAt: openAt, settledAt: openAt })),
      flareAt: null, shadeInAt: openAt, shadeOutAt: openAt, endAt: openAt + fade,
    };
  }
  const cards: CardBeats[] = Array.from({ length: n }, (_, i) => {
    const startAt = openAt + Math.round((r.startDelayMs + i * r.staggerMs) * k);
    const dur = r.dropMs * k;
    return { startAt, landAt: Math.round(startAt + dur * IMPACT_AT), settledAt: Math.round(startAt + dur) };
  });
  const first = cards[0];
  const last = cards[cards.length - 1];
  // The flourish is over when the last tablet's ignite ring has faded (it outlasts the quick sweep).
  const sweep = r.glowSweepMs > 0 ? Math.round(igniteMs(r) * k) : 0;
  const shadeInAt = first ? first.landAt : openAt;
  const shadeOutAt = last ? last.settledAt : shadeInAt;
  const endAt = Math.max(openAt + Math.round(r.backdropFadeMs * k), last ? last.settledAt + sweep : 0, shadeOutAt);
  return { openAt, cards, flareAt: r.flare > 0 && last ? last.landAt : null, shadeInAt, shadeOutAt, endAt };
}

/**
 * The drop's keyframes for one tablet, as WAAPI frames on its SLOT wrapper (never the button itself, whose
 * `:hover` owns its own transform). Transform + opacity only: compositor work, no paint. The squash is anchored at
 * the tablet's base (the slot's `transform-origin: 50% 100%`), so it flattens onto the floor it landed on.
 */
export function dropKeyframes(r: ResolvedEntrance): Keyframe[] {
  const from = r.dropFrom;
  const down = from < 0; // dropping from above: the overshoot sinks INTO the floor (positive y)
  const sink = down ? r.overshootPx : -r.overshootPx;
  const s = r.squash;
  const fall = 'cubic-bezier(0.55, 0, 0.9, 0.45)';   // gravity: slow out of the top, fast into the floor
  const recoil = 'cubic-bezier(0.2, 0.7, 0.4, 1)';
  return [
    { offset: 0, opacity: 0, transform: `translateY(${from}px) scale(${1 - s * 0.35}, ${1 + s * 0.5})`, easing: fall },
    { offset: IMPACT_AT * 0.45, opacity: 1 },
    { offset: IMPACT_AT, opacity: 1, transform: `translateY(${sink}px) scale(${1 + s}, ${1 - s})`, easing: recoil },
    { offset: IMPACT_AT + (1 - IMPACT_AT) * 0.45, transform: `translateY(${-sink * 0.35}px) scale(${1 - s * 0.3}, ${1 + s * 0.25})`, easing: recoil },
    { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1, 1)' },
  ];
}

// ─── sound cues ───────────────────────────────────────────────────────────────────────────────────────────────

/** The named cue points, for the owner to source SFX against. */
export type EntranceCue = 'land' | 'dust' | 'sweep' | 'epicFlare';
export const ENTRANCE_CUES: readonly EntranceCue[] = ['land', 'dust', 'sweep', 'epicFlare'];

/** A cue's currently-mapped clip, gain and offset. An empty clip or a zero gain = the cue is silent. */
export function cueSetting(c: RuneforgeEntranceConfig, cue: EntranceCue): { clip: string; gain: number; offsetMs: number } {
  switch (cue) {
    case 'land': return { clip: c.sfxLandClip, gain: c.sfxLandGain, offsetMs: c.sfxLandOffsetMs };
    case 'dust': return { clip: c.sfxDustClip, gain: c.sfxDustGain, offsetMs: c.sfxDustOffsetMs };
    case 'sweep': return { clip: c.sfxSweepClip, gain: c.sfxSweepGain, offsetMs: c.sfxSweepOffsetMs };
    case 'epicFlare': return { clip: c.sfxEpicFlareClip, gain: c.sfxEpicFlareGain, offsetMs: c.sfxEpicFlareOffsetMs };
  }
}

// ─── the tuner ────────────────────────────────────────────────────────────────────────────────────────────────

/** [label, unit, hint, group]. Declaration order is render order. */
const SPECS: Record<NumKey, [string, TunerUnit | undefined, string, string]> = {
  openDelayMs: ['Start delay after wipe', 'ms', 'The pause after the return-to-shop wipe has fully finished, before the forge starts to open. Nothing plays inside it.', 'Timing'],
  backdropFadeMs: ['Backdrop fade', 'ms', 'The forge overlay fading up over the board.', 'Timing'],
  startDelayMs: ['Start delay', 'ms', 'Wait from the overlay appearing to the first tablet starting to drop.', 'Timing'],
  staggerMs: ['Stagger', 'ms', 'Gap between one tablet starting its drop and the next, left to right.', 'Timing'],
  dropMs: ['Drop duration', 'ms', "One tablet's whole drop: fall, impact, rebound, settle. It lands (and becomes clickable) 58% of the way in.", 'Timing'],
  dropDistance: ['Drop distance', 'px', 'How far above its resting place a tablet starts.', 'Motion'],
  fromBelow: ['Rise from below', undefined, 'Off: the tablets drop from above. On: they rise up from below.', 'Motion'],
  overshootPx: ['Overshoot', 'px', 'How far past its resting place a tablet sinks on impact before settling back.', 'Motion'],
  squash: ['Squash', undefined, 'How much a tablet flattens and widens as it lands. 0 = rigid.', 'Motion'],
  dustCount: ['Dust count', '×', 'Dust particles per landing, as a multiplier on the authored puff. 0 = no dust.', 'Dust'],
  dustSize: ['Dust size', '×', 'Dust particle size and spread.', 'Dust'],
  dustLife: ['Dust lifetime', '×', 'How long the dust hangs before it settles.', 'Dust'],
  dustOpacity: ['Dust opacity', 'opacity', 'How opaque the dust is.', 'Dust'],
  backdropDim: ['Backdrop dim', 'opacity', 'How dark the forge starts. It lifts as the tablets land. 0 = no shade.', 'Atmosphere'],
  emberCount: ['Ember count', undefined, 'Embers rising off the forge floor as it opens. 0 = none.', 'Atmosphere'],
  glowSweepMs: ['Glow sweep', 'ms', 'How long the one quick light sweep across each tablet takes, once it settles. 0 = no sweep.', 'Atmosphere'],
  epicDropMul: ['Epic drop', '×', 'Epic Runeforge: multiplier on the drop distance.', 'Epic'],
  epicSquashMul: ['Epic squash', '×', 'Epic Runeforge: multiplier on the impact squash.', 'Epic'],
  epicDustMul: ['Epic dust', '×', 'Epic Runeforge: multiplier on the dust.', 'Epic'],
  epicEmberMul: ['Epic embers', '×', 'Epic Runeforge: multiplier on the ember count.', 'Epic'],
  epicFlare: ['Epic flare', '×', 'Epic Runeforge: the purple and gold flare as the last tablet lands. 0 = no flare.', 'Epic'],
  sfxLandGain: ['land: gain', undefined, 'Volume of the land cue (each tablet touching down).', 'Sound: land'],
  sfxLandOffsetMs: ['land: offset', 'ms', 'Shift the land cue from the impact. Negative = earlier.', 'Sound: land'],
  sfxDustGain: ['dust: gain', undefined, 'Volume of the dust cue (the puff off each landing).', 'Sound: dust'],
  sfxDustOffsetMs: ['dust: offset', 'ms', 'Shift the dust cue from the impact.', 'Sound: dust'],
  sfxSweepGain: ['sweep: gain', undefined, 'Volume of the glow sweep sound (the golden wipe across a settled tablet).', 'Glow sweep sound'],
  sfxSweepOffsetMs: ['sweep: offset', 'ms', "Shift the sweep sound from each tablet's sweep start. Negative = earlier.", 'Glow sweep sound'],
  sfxSweepEach: ['sweep: every tablet', undefined, "Off: one sweep sound per forge, on the first tablet's sweep. On: one on every tablet's sweep, spaced by the gap below.", 'Glow sweep sound'],
  sfxSweepGapMs: ['sweep: min gap', 'ms', 'Every-tablet mode only: a sweep sound this soon after the last one is skipped, so they never stack.', 'Glow sweep sound'],
  sfxEpicFlareGain: ['epicFlare: gain', undefined, 'Volume of the Epic flare cue.', 'Sound: epicFlare'],
  sfxEpicFlareOffsetMs: ['epicFlare: offset', 'ms', 'Shift the Epic flare cue from the flare.', 'Sound: epicFlare'],
};

/** Which clip select sits at the head of each sound group. */
const CLIP_FOR_GROUP: Partial<Record<NumKey, [ClipKey, string]>> = {
  sfxLandGain: ['sfxLandClip', 'land: clip'],
  sfxDustGain: ['sfxDustClip', 'dust: clip'],
  sfxSweepGain: ['sfxSweepClip', 'sweep: clip'],
  sfxEpicFlareGain: ['sfxEpicFlareClip', 'epicFlare: clip'],
};

function clipOptions(): string[] {
  let names: string[] = [];
  try { names = clipNames(); } catch { /* no audio in this environment */ }
  return [NO_CLIP, ...names.filter((n) => n !== NO_CLIP)];
}

function buildControls(): TunerControl<Extract<keyof RuneforgeEntranceConfig, string>>[] {
  const out: TunerControl<Extract<keyof RuneforgeEntranceConfig, string>>[] = [];
  const options = clipOptions();
  for (const key of Object.keys(SPECS) as NumKey[]) {
    const [label, unit, hint, group] = SPECS[key];
    const clip = CLIP_FOR_GROUP[key];
    if (clip) {
      out.push({
        key: clip[0], label: clip[1], group, kind: 'select', options, optionLabels: { [NO_CLIP]: '(none)' },
        hint: 'Which clip this cue plays. (none) = silent until a sound is sourced.', min: 0, max: 0, step: 0,
      });
    }
    const [min, max, step] = RFE_RANGES[key];
    out.push(key === 'fromBelow' || key === 'sfxSweepEach'
      ? { key, label, unit, hint, group, min, max, step, kind: 'toggle', onValue: 1, offValue: 0 }
      : { key, label, unit, hint, group, min, max, step });
  }
  return out;
}

/** Window event the ▶ Play actions fire; the entrance preview listens for it in dev builds. */
export const RFE_PLAY_EVENT = 'ascent:runeforge-entrance-play';
export interface RfePlayDetail { epic: boolean }

function firePlay(epic: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<RfePlayDetail>(RFE_PLAY_EVENT, { detail: { epic } }));
}

export const SPEC: TunerSpec<RuneforgeEntranceConfig> = {
  id: 'runeforgeentrance',          // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Runeforge entrance',
  note: () => {
    const t = entranceTimeline(resolveEntrance(getRuneforgeEntranceConfig(), false), 4);
    return `dev · ▶ to play · ${(t.endAt / 1000).toFixed(2)} s`;
  },
  read: getRuneforgeEntranceConfig,
  write: (key, value) => setRuneforgeEntranceValue(key, value),
  writeColor: (key, value) => setRuneforgeEntranceValue(key, value),
  reset: resetRuneforgeEntranceConfig,
  defaults: RFE_DEFAULTS,
  controls: buildControls(),
  actions: [
    {
      label: '▶ Play (Basic)',
      hint: 'Open a sample Runeforge over the current screen and play the entrance with the values above. Click a tablet or press Esc to close it.',
      run: () => firePlay(false),
    },
    {
      label: '▶ Play (Epic)',
      hint: 'The same, as the Epic Runeforge: the Epic multipliers and the flare.',
      run: () => firePlay(true),
    },
  ],
};
