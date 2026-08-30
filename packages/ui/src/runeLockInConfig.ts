import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * RUNE LOCK-IN CEREMONY — the one config (owner ask 2026-08-29: *"add a tuner that allows me to adjust
 * timings of every aspect of this animation as well as the sound effect volume and timing"*).
 *
 * Shaped like `heroCeremonyTiming.ts` in that every value the ceremony uses lives here and none are scattered
 * through the component — and like `equipSlotConfig.ts` in that it is DEV-tunable, persisted, and inert in
 * production.
 *
 * ── What the ceremony is ──────────────────────────────────────────────────────────────────────────────────
 *
 * Click a rune → it leaves for the centre on that frame, from exactly where it sat, growing as it goes, while
 * the others clear behind it → it arrives, a gold frame clamps shut on it and a flash bursts out → a beat →
 * everything fades back to the board. ~1.16s, no input.
 *
 * The hero ceremony is the model for its STRUCTURE and deliberately not for its length: that one ends on a
 * Start Game button and is allowed to take its time, this one happens mid-run and its whole job is to say
 * "that one, yes, it's yours" and get out of the way.
 *
 * All timings are milliseconds measured FROM THE CLICK.
 */
export interface RuneLockInConfig {
  // ── Sequence ────────────────────────────────────────────────────────────────────────────────────────────
  /** The unchosen runes begin leaving. */
  exitDelayMs: number;
  /** One unchosen rune's exit duration. */
  exitMs: number;
  /** Gap between successive unchosen exits, so they read as a sweep rather than a blink. */
  exitStaggerMs: number;
  /**
   * The chosen rune starts travelling.
   *
   * ZERO by default and that is load-bearing (owner report: *"it kinda slinks back then comes to the
   * front"*). Any wait here puts a beat of nothing between the click and the movement.
   */
  focusDelayMs: number;
  /** Travel + grow duration, into a slight overshoot. */
  focusMs: number;
  /** Overshoot → settle. The snap that reads as the lock engaging. */
  settleMs: number;
  /** When the lock lands: the settle, the clamp's arrival and the flash all fire on this instant. */
  lockAtMs: number;
  /** How long the tableau holds before it leaves. */
  holdMs: number;
  /** The fade back to the board. */
  fadeMs: number;

  // ── The gold clamp + flash ──────────────────────────────────────────────────────────────────────────────
  /** How long the gold frame takes to close. It LANDS on `lockAtMs`, so it starts that much earlier. */
  clampMs: number;
  /** How far outside the card the frame starts, as a scale multiple. Bigger = a longer, more dramatic close. */
  clampFrom: number;
  /** The flash's duration. */
  flashMs: number;
  /** The flash's size, in vmin. */
  flashSize: number;

  // ── Look ────────────────────────────────────────────────────────────────────────────────────────────────
  /** How large the chosen rune grows at centre. */
  focusScale: number;
  /** How dark the board goes behind the ceremony (0 = not at all, 1 = black). */
  veilAlpha: number;

  // ── Sound ───────────────────────────────────────────────────────────────────────────────────────────────
  /** The clang's volume, as a multiple of the clip's normal level. 0 silences it. */
  sfxVolume: number;
  /**
   * ms relative to the LOCK BEAT — negative fires the clang earlier than the clamp lands, positive later.
   *
   * Anchored to the lock rather than to the click so "earlier" means something: the click is time zero and an
   * offset before it could only clamp, while the lock is the moment the sound is supposed to BE.
   */
  sfxDelayMs: number;
}

const DEFAULTS: RuneLockInConfig = {
  exitDelayMs: 0,
  exitMs: 240,
  exitStaggerMs: 40,
  focusDelayMs: 0,
  focusMs: 380,
  settleMs: 130,
  lockAtMs: 380,
  holdMs: 900,
  fadeMs: 260,

  clampMs: 250,
  clampFrom: 1.55,
  flashMs: 460,
  flashSize: 62,

  focusScale: 1.5,
  veilAlpha: 0.62,

  sfxVolume: 1,
  sfxDelayMs: 0,
};

const RANGES: Record<keyof RuneLockInConfig, [number, number, number]> = {
  exitDelayMs: [0, 600, 10],
  exitMs: [60, 900, 10],
  exitStaggerMs: [0, 200, 5],
  focusDelayMs: [0, 600, 10],
  focusMs: [100, 1200, 10],
  settleMs: [0, 500, 10],
  lockAtMs: [100, 1500, 10],
  holdMs: [200, 3000, 20],
  fadeMs: [60, 900, 10],

  clampMs: [60, 900, 10],
  clampFrom: [1.05, 3, 0.05],
  flashMs: [100, 1200, 20],
  flashSize: [10, 140, 2],

  focusScale: [1, 3, 0.05],
  veilAlpha: [0, 0.95, 0.02],

  sfxVolume: [0, 2, 0.05],
  sfxDelayMs: [-400, 800, 10],
};

export { DEFAULTS as RUNE_LOCKIN_DEFAULTS };

const KEY = 'ascent.runelockin';

let cfg: RuneLockInConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<RuneLockInConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getRuneLockInConfig(): RuneLockInConfig {
  return cfg;
}

export function setRuneLockInValue(key: keyof RuneLockInConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetRuneLockInConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** When the ceremony is completely finished — the moment the caller may unmount it. */
export const lockInTotalMs = (t: RuneLockInConfig): number => t.holdMs + t.fadeMs;

/**
 * Slow the whole ceremony by `factor`, preserving the RATIOS between its beats.
 *
 * Dev-only, for watching a ~1.2-second sequence closely enough to judge it. Only the TIMINGS scale — scales,
 * sizes and volume are left alone, because stretching those would show you a different animation rather than
 * the same one slowly.
 */
const TIME_KEYS: (keyof RuneLockInConfig)[] = [
  'exitDelayMs', 'exitMs', 'exitStaggerMs', 'focusDelayMs', 'focusMs', 'settleMs',
  'lockAtMs', 'holdMs', 'fadeMs', 'clampMs', 'flashMs', 'sfxDelayMs',
];
export const stretchLockIn = (t: RuneLockInConfig, factor: number): RuneLockInConfig => {
  const out = { ...t };
  for (const k of TIME_KEYS) out[k] = Math.round(t[k] * factor);
  return out;
};

/** [label, unit, hint, group] per dial. Declaration order IS render order. */
const SPECS: Record<keyof RuneLockInConfig, [string, string | undefined, string, string]> = {
  focusDelayMs: ['Start delay', 'ms', 'Wait before the chosen rune moves. ZERO is deliberate — any wait puts a beat of nothing between the click and the movement, which reads as the card hesitating.', 'The slide'],
  focusMs: ['Travel', 'ms', 'How long the chosen rune takes to reach the centre, growing as it goes.', 'The slide'],
  focusScale: ['Final size', '×', 'How large the rune grows at centre.', 'The slide'],
  settleMs: ['Settle snap', 'ms', 'The overshoot resolving on arrival — the bit that reads as "locked".', 'The slide'],

  exitDelayMs: ['Others start', 'ms', 'When the unchosen runes begin leaving. 0 = the same instant the chosen one moves.', 'The others'],
  exitMs: ['Others fade', 'ms', 'How long one unchosen rune takes to go.', 'The others'],
  exitStaggerMs: ['Others stagger', 'ms', 'Gap between them, so they sweep rather than blink out together.', 'The others'],

  lockAtMs: ['Lock beat', 'ms', 'The instant the settle, the clamp’s arrival and the flash all land. Everything below is timed against it.', 'The lock'],
  clampMs: ['Clamp close', 'ms', 'How long the gold frame takes to shut. It LANDS on the lock beat, so it starts this much earlier.', 'The lock'],
  clampFrom: ['Clamp start size', '×', 'How far outside the card the frame begins. Bigger = a longer, more dramatic close.', 'The lock'],
  flashMs: ['Flash', 'ms', 'How long the burst takes to bloom and dissipate.', 'The lock'],
  flashSize: ['Flash size', 'vmin', 'How far the burst reaches.', 'The lock'],

  holdMs: ['Hold', 'ms', 'How long the finished tableau stays before it leaves.', 'The exit'],
  fadeMs: ['Fade out', 'ms', 'The fade back to the board.', 'The exit'],
  veilAlpha: ['Board dim', undefined, 'How dark the board goes behind the ceremony. 0 leaves it untouched.', 'The exit'],

  sfxVolume: ['Clang volume', '×', 'Multiple of the clip’s normal level. Rides on top of the UI bus, so 0 silences just this one.', 'Sound'],
  sfxDelayMs: ['Clang timing', 'ms', 'Relative to the LOCK BEAT — negative fires the clang before the frame lands, positive after. Audio clock, so it cannot drift from the visual.', 'Sound'],
};

const controls: TunerControl<Extract<keyof RuneLockInConfig, string>>[] =
  (Object.keys(SPECS) as (keyof RuneLockInConfig)[]).map((key) => {
    const [label, unit, hint, group] = SPECS[key];
    const [min, max, step] = RANGES[key];
    return { key, label, unit, hint, group, min, max, step } as TunerControl<Extract<keyof RuneLockInConfig, string>>;
  });

export const SPEC: TunerSpec<RuneLockInConfig> = {
  id: 'runelockin',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Rune Lock-In',
  note: 'dev · ▶ to replay',
  read: getRuneLockInConfig,
  write: (key, value) => setRuneLockInValue(key, value),
  reset: resetRuneLockInConfig,
  defaults: DEFAULTS,
  controls,
  actions: [
    {
      label: '▶ play',
      hint: 'Replay the ceremony with three real runes at the current settings.',
      run: () => { (window as unknown as { __runeLockIn?: (s?: number) => void }).__runeLockIn?.(1); },
    },
    {
      label: '▶ slow 6×',
      hint: 'The same choreography stretched 6× so the beats can actually be judged. Only timings scale — sizes and volume stay put.',
      run: () => { (window as unknown as { __runeLockIn?: (s?: number) => void }).__runeLockIn?.(6); },
    },
  ],
};
