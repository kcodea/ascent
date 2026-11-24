import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import type { TailOpts } from '../audio/tailFade';

/**
 * THE "GOOD LUCK" INTRO — its tunable numbers (owner ask 2026-09-24).
 *
 * Follows the tuner convention: localStorage-persisted in DEV only, production always plays `GLI_DEFAULTS`.
 * Every value is read when an intro STARTS, so moving a slider changes the next play and the ▶ replay action
 * shows it at once. Shipping a feel = pasting the tuned numbers into `GLI_DEFAULTS` (the tuner never publishes).
 *
 * The timeline runs from the moment the board is the player's (the lobby reveal over, or the run built where there is none).
 */
export interface GoodLuckIntroConfig {
  /** How dark the board is behind the words (0 = not at all, 1 = black). */
  dimOpacity: number;
  /** Wait before the star leaps off the hero (from the run being built, or the lobby reveal ending). */
  startDelayMs: number;
  /** The star's flight from the hero to the first letter. */
  flightMs: number;
  /** The star writing the letters, each popping up as it passes, and looping back over them to burst. */
  writeMs: number;
  /** How long the finished words stay up after the burst. */
  holdMs: number;
  /** The letters swept up into the star. */
  gatherMs: number;
  /** The star's dive into the End Turn crystal. The shop clock starts as it lands. */
  diveMs: number;
  /** How many sparks the burst throws where the star cannot be drawn (phones). */
  sparkCount: number;
  /** The words' size, in reference px (scales with the UI like every other size). */
  textSize: number;
  /** The chime as the light reaches the crystal (0 = silent). */
  landSoundGain: number;
  /** The star's two whooshes: off the hero, and into the crystal (0 = silent). */
  whooshSoundGain: number;
  /** The burst's shine sound level, on top of its mixer fader (0 = silent). */
  shineSoundGain: number;
  /** Nudge the shine sound against the burst: negative plays it earlier, positive later. */
  shineSoundOffsetMs: number;
  /** The take-off's sparkle sound level, on top of its mixer fader (0 = silent). */
  sparkSoundGain: number;
  /** The shine sound's fade over its last N ms, so it does not stop dead (owner 2026-09-24). 0 = no fade. */
  shineFadeOutMs: number;
  /** The sparkle's fade over its last N ms. Its clip is cut mid-ring, so this is what stops the hard end. */
  sparkFadeOutMs: number;
  /** A light reverb tail under both sounds, ringing on after they end (0 = dry). */
  reverbMix: number;
  /** How long that reverb tail rings, in seconds. */
  reverbSec: number;
}

/** Shipped values: 2.7 s from the board being the player's to a live clock. */
export const GLI_DEFAULTS: GoodLuckIntroConfig = {
  dimOpacity: 0.62,
  startDelayMs: 100,
  flightMs: 460,
  writeMs: 900,
  holdMs: 560,
  gatherMs: 320,
  diveMs: 360,
  sparkCount: 70,
  textSize: 136,
  landSoundGain: 0.22,
  whooshSoundGain: 0.4,
  shineSoundGain: 1,
  shineSoundOffsetMs: 0,
  sparkSoundGain: 0.8,
  shineFadeOutMs: 300,
  sparkFadeOutMs: 350,
  reverbMix: 0.2,
  reverbSec: 0.7,
};

export const GLI_RANGES: Record<keyof GoodLuckIntroConfig, [number, number, number]> = {
  dimOpacity: [0, 0.95, 0.01],
  startDelayMs: [0, 1000, 10],
  flightMs: [100, 1500, 10],
  writeMs: [200, 2000, 10],
  holdMs: [0, 2500, 10],
  gatherMs: [100, 1500, 10],
  diveMs: [100, 1500, 10],
  sparkCount: [0, 400, 1],
  textSize: [40, 220, 1],
  landSoundGain: [0, 2, 0.01],
  whooshSoundGain: [0, 2, 0.01],
  shineSoundGain: [0, 2, 0.01],
  shineSoundOffsetMs: [-400, 400, 10],
  sparkSoundGain: [0, 2, 0.01],
  shineFadeOutMs: [0, 1000, 10],
  sparkFadeOutMs: [0, 900, 10],
  reverbMix: [0, 0.6, 0.01],
  reverbSec: [0.2, 2, 0.05],
};

const KEY = 'ascent.goodluckintro';

let cfg: GoodLuckIntroConfig = (() => {
  if (!import.meta.env.DEV) return { ...GLI_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...GLI_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<GoodLuckIntroConfig>) : {}) };
  } catch {
    return { ...GLI_DEFAULTS };
  }
})();

export function getGoodLuckIntroConfig(): GoodLuckIntroConfig {
  return cfg;
}

export function setGoodLuckIntroValue(key: keyof GoodLuckIntroConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetGoodLuckIntroConfig(): void {
  cfg = { ...GLI_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The intro's beats, in ms from its start. Pure, so the ordering is testable without a DOM. */
export interface GoodLuckTimeline {
  /** The star leaps off the hero (and its sparkle sounds). Reduced motion: the words start fading in. */
  inAt: number;
  /** The first letter. */
  writeAt: number;
  /** The star bursts over the finished words, and they shine. */
  shineAt: number;
  /** The shine sound (the burst plus the tuner's offset, never before the intro). */
  shineSoundAt: number;
  /** The take-off sparkle's sound. */
  sparkAt: number;
  /** The words start going (swept up; reduced motion: fading). */
  outAt: number;
  /** The star dives. */
  diveAt: number;
  /** It lands in the End Turn crystal: the overlay unmounts and the shop clock starts. */
  endAt: number;
}

/** A plain fade, where there is no motion (ms). */
export const GLI_FADE_MS = 400;

/** The beats for one play. Under `prefers-reduced-motion` it is a plain fade in, a short read and a fade out. */
export function goodLuckTimeline(c: GoodLuckIntroConfig, reduced: boolean): GoodLuckTimeline {
  const n = (v: number): number => Math.max(0, v);
  const inAt = n(c.startDelayMs);
  const writeAt = reduced ? inAt : inAt + n(c.flightMs);
  const shineAt = reduced ? inAt + GLI_FADE_MS : writeAt + n(c.writeMs);
  const outAt = shineAt + (reduced ? Math.min(n(c.holdMs), 600) : n(c.holdMs));
  const diveAt = reduced ? outAt : outAt + n(c.gatherMs);
  const endAt = reduced ? outAt + GLI_FADE_MS : diveAt + n(c.diveMs);
  return { inAt, writeAt, shineAt, shineSoundAt: n(shineAt + (c.shineSoundOffsetMs || 0)), sparkAt: inAt, outAt, diveAt, endAt };
}

/** One sound's tail dials (its own fade, the shared reverb), as `sfx.goodLuckShine` / `goodLuckSpark` take them. */
export function goodLuckTail(c: GoodLuckIntroConfig, which: 'shine' | 'spark'): TailOpts {
  return {
    fadeOutMs: which === 'shine' ? c.shineFadeOutMs : c.sparkFadeOutMs,
    reverbMix: c.reverbMix,
    reverbSec: c.reverbSec,
  };
}

/** [label, unit, hint, group]. Declaration order is render order. */
const SPECS: Record<keyof GoodLuckIntroConfig, [string, TunerUnit | undefined, string, string]> = {
  dimOpacity: ['Dim', 'opacity', 'How dark the board is behind the words. 0 = not dimmed, 1 = black.', 'Look'],
  textSize: ['Text size', 'px', 'The size of the words (reference px, scales with the UI).', 'Look'],
  sparkCount: ['Spark count', undefined, 'How many sparks the burst throws where the star cannot be drawn (phones). 0 = none.', 'Look'],
  startDelayMs: ['Start delay', 'ms', 'Wait before the star leaps off the hero.', 'Timing'],
  flightMs: ['Flight', 'ms', 'The star flying from the hero to the first letter.', 'Timing'],
  writeMs: ['Write', 'ms', 'The star writing the letters and looping back over them to burst.', 'Timing'],
  holdMs: ['Hold', 'ms', 'How long the finished words stay up after the burst.', 'Timing'],
  gatherMs: ['Gather', 'ms', 'The letters swept up into the star.', 'Timing'],
  diveMs: ['Dive', 'ms', 'The star diving into the End Turn crystal. The shop clock starts as it lands.', 'Timing'],
  landSoundGain: ['Landing chime', '×', 'How loud the chime is as the light reaches the crystal. 0 = silent.', 'Sound'],
  whooshSoundGain: ['Whooshes', '×', 'How loud the star is as it leaps and as it dives. 0 = silent.', 'Sound'],
  shineSoundGain: ['Shine sound', '×', 'How loud the shine sound is, on top of its mixer fader. 0 = silent.', 'Sound'],
  shineSoundOffsetMs: ['Shine sound offset', 'ms', 'Moves the shine sound against the burst. Below 0 plays it earlier, above 0 later.', 'Sound'],
  sparkSoundGain: ['Spark sound', '×', 'How loud the sparkle is as the star takes off, on top of its mixer fader. 0 = silent.', 'Sound'],
  shineFadeOutMs: ['Shine fade-out', 'ms', 'The shine sound fades over its last this-many ms instead of stopping dead. 0 = no fade.', 'Sound'],
  sparkFadeOutMs: ['Spark fade-out', 'ms', 'The sparkle fades over its last this-many ms instead of stopping dead. 0 = no fade.', 'Sound'],
  reverbMix: ['Reverb mix', undefined, 'A light reverb tail under both sounds that rings on after they end. 0 = none.', 'Sound'],
  reverbSec: ['Reverb length', 's', 'How long the reverb tail rings after the sound ends.', 'Sound'],
};

const controls: TunerControl<Extract<keyof GoodLuckIntroConfig, string>>[] =
  (Object.keys(SPECS) as (keyof GoodLuckIntroConfig)[]).map((key) => {
    const [label, unit, hint, group] = SPECS[key];
    const [min, max, step] = GLI_RANGES[key];
    return { key, label, unit, hint, group, min, max, step };
  });

/** Window event the ▶ replay action fires; `GoodLuckIntro` listens for it in dev builds. */
export const GLI_REPLAY_EVENT = 'ascent:goodluck-replay';

export const SPEC: TunerSpec<GoodLuckIntroConfig> = {
  id: 'goodluckintro',             // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Good Luck intro',
  note: 'dev · ▶ to replay',
  read: getGoodLuckIntroConfig,
  write: (key, value) => setGoodLuckIntroValue(key, value),
  reset: resetGoodLuckIntroConfig,
  defaults: GLI_DEFAULTS,
  controls,
  actions: [
    {
      label: '▶ replay',
      hint: 'Play the intro over the current board with the values above. The shop clock holds while it plays, exactly as in a real game start.',
      run: () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(GLI_REPLAY_EVENT)); },
    },
  ],
};
