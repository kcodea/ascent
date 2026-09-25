import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';

/**
 * THE "GOOD LUCK" INTRO — its tunable numbers (owner ask 2026-09-24).
 *
 * Follows the tuner convention: localStorage-persisted in DEV only, production always plays `GLI_DEFAULTS`.
 * Every value is read when an intro STARTS, so moving a slider changes the next play and the ▶ replay action
 * shows it at once. Shipping a feel = pasting the tuned numbers into `GLI_DEFAULTS` (the tuner never publishes).
 *
 * The timeline runs from the moment the run is built under the launch curtain (see `HeroLaunchCurtain`), so
 * `startDelayMs` overlaps the curtain's own reveal: the board comes up already dimmed and the words arrive
 * while the curtain is still lifting.
 */
export interface GoodLuckIntroConfig {
  /** How dark the board is behind the words (0 = not at all, 1 = black). */
  dimOpacity: number;
  /** Wait before the words start to appear (from the run being built; the curtain lifts over this). */
  startDelayMs: number;
  /** The words fading and growing in. The sparks fire as this starts. */
  fadeInMs: number;
  /** The light sweep across the words, left to right. Starts as the fade-in finishes. */
  shineMs: number;
  /** How long the finished words stay up after the fade-in, before everything fades out. */
  holdMs: number;
  /** The words and the dim fading away to the live board. The shop clock starts when this ends. */
  fadeOutMs: number;
  /** How many sparks the burst throws. */
  sparkCount: number;
  /** The words' size, in reference px (scales with the UI like every other size). */
  textSize: number;
  /** The shine sound's level, on top of its mixer fader (0 = silent). */
  shineSoundGain: number;
  /** Nudge the shine sound against the sweep: negative plays it earlier, positive later. */
  shineSoundOffsetMs: number;
  /** The spark burst's sparkle sound level, on top of its mixer fader (0 = silent). */
  sparkSoundGain: number;
}

/** Shipped values. Total from the run being built: 250 + 500 + 900 + 500 = 2150 ms, plus the 280 ms
 *  curtain cover before it = ~2.4 s from the Start Game press to a live clock. */
export const GLI_DEFAULTS: GoodLuckIntroConfig = {
  dimOpacity: 0.72,
  startDelayMs: 250,
  fadeInMs: 500,
  shineMs: 650,
  holdMs: 900,
  fadeOutMs: 500,
  sparkCount: 70,
  textSize: 112,
  shineSoundGain: 1,
  shineSoundOffsetMs: 0,
  sparkSoundGain: 0.8,
};

export const GLI_RANGES: Record<keyof GoodLuckIntroConfig, [number, number, number]> = {
  dimOpacity: [0, 0.95, 0.01],
  startDelayMs: [0, 1000, 10],
  fadeInMs: [100, 1500, 10],
  shineMs: [150, 1500, 10],
  holdMs: [0, 2500, 10],
  fadeOutMs: [100, 1500, 10],
  sparkCount: [0, 400, 1],
  textSize: [40, 220, 1],
  shineSoundGain: [0, 2, 0.01],
  shineSoundOffsetMs: [-400, 400, 10],
  sparkSoundGain: [0, 2, 0.01],
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
  /** The words start fading in (and the sparks fire). */
  inAt: number;
  /** The shine starts sweeping. */
  shineAt: number;
  /** The shine sound starts (the sweep's start plus the tuner's offset, never before the intro). */
  shineSoundAt: number;
  /** The sparks burst (a beat into the fade-in), and their sparkle sound with them. */
  sparkAt: number;
  /** Everything starts fading out. */
  outAt: number;
  /** The intro is over: the overlay unmounts and the shop clock starts. */
  endAt: number;
}

/**
 * The beats for one play. Under `prefers-reduced-motion` there is no shine to wait for and the hold is
 * shortened, so the whole thing is a plain fade in, a short read and a fade out.
 */
export function goodLuckTimeline(c: GoodLuckIntroConfig, reduced: boolean): GoodLuckTimeline {
  const inAt = Math.max(0, c.startDelayMs);
  const shineAt = inAt + Math.max(0, c.fadeInMs);
  const hold = reduced ? Math.min(c.holdMs, 600) : c.holdMs;
  const outAt = shineAt + Math.max(0, hold);
  const endAt = outAt + Math.max(0, c.fadeOutMs);
  const shineSoundAt = Math.max(0, shineAt + (c.shineSoundOffsetMs || 0));
  const sparkAt = inAt + Math.round(Math.max(0, c.fadeInMs) * 0.2);
  return { inAt, shineAt, shineSoundAt, sparkAt, outAt, endAt };
}

/** [label, unit, hint, group]. Declaration order is render order. */
const SPECS: Record<keyof GoodLuckIntroConfig, [string, TunerUnit | undefined, string, string]> = {
  dimOpacity: ['Dim', 'opacity', 'How dark the board is behind the words. 0 = not dimmed, 1 = black.', 'Look'],
  textSize: ['Text size', 'px', 'The size of the words (reference px, scales with the UI).', 'Look'],
  sparkCount: ['Spark count', undefined, 'How many sparks the burst throws as the words appear. 0 = none.', 'Look'],
  startDelayMs: ['Start delay', 'ms', 'Wait before the words appear. The launch curtain is lifting during this.', 'Timing'],
  fadeInMs: ['Fade in', 'ms', 'The words fading and growing in. The sparks fire as it starts.', 'Timing'],
  shineMs: ['Shine', 'ms', 'The light sweeping across the words, left to right. Starts as the fade-in ends.', 'Timing'],
  holdMs: ['Hold', 'ms', 'How long the words stay up after the fade-in, before everything fades.', 'Timing'],
  fadeOutMs: ['Fade out', 'ms', 'The words and the dim fading to the live board. The shop clock starts when this ends.', 'Timing'],
  shineSoundGain: ['Shine sound', '×', 'How loud the shine sound is, on top of its mixer fader. 0 = silent.', 'Sound'],
  shineSoundOffsetMs: ['Shine sound offset', 'ms', 'Moves the shine sound against the sweep. Below 0 plays it earlier, above 0 later.', 'Sound'],
  sparkSoundGain: ['Spark sound', '×', 'How loud the sparkle is as the sparks burst, on top of its mixer fader. 0 = silent.', 'Sound'],
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
