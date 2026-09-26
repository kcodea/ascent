/**
 * The ✦ Ancients tuner's values (DEV, proof of concept 2026-09-25).
 *
 * TWO kinds of value live here:
 *  · the METER's balance numbers (`cost` / `refresh` / `combat`) — handed to `enableAncients` when the Scene
 *    Builder starts a Set 3 run, and pushed into the live run when moved (so the sim stays the only authority:
 *    the UI never counts points itself);
 *  · the PRESENTATION dials (ring size / warm-up / timings / the awakening beat), read by the meter, the
 *    preview and the awakening.
 * Persisted in dev only; production always uses the defaults (it never reaches this system anyway: Ancients are
 * Scene Builder only).
 */
export interface AncientsConfig {
  /** Meter: points to fill it (awaken). */
  cost: number;
  /** Meter: points one Shop refresh adds. */
  refresh: number;
  /** Meter: points one combat adds. */
  combat: number;
  /** Ring: stroke thickness (design px). */
  ringWidth: number;
  /** Ring: gap between the hero-power button's edge and the ring (design px), so it never merges with the frame. */
  ringOffset: number;
  /** Ring: the empty track's colour. */
  trackColor: string;
  /** Ring: the empty track's opacity. */
  trackAlpha: number;
  /** Ring: the fill gradient's start (at the arc's tail). */
  fillFrom: string;
  /** Ring: the fill gradient's end (at the head). */
  fillTo: string;
  /** Ring: the leading-edge cap's size (× the ring width). 0 hides it. */
  capSize: number;
  /** Ring: quarter tick marks on the track (1 on, 0 off). */
  ticks: number;
  /** Fill: the arc's eased sweep when points are added (ms). */
  fillMs: number;
  /** Awaken: the full ring's flash before the Discover rises (ms). */
  flashMs: number;
  /** Awaken: Shop dim behind the Discover (opacity). */
  dim: number;
  /** Pick: the split reveal duration (ms). */
  splitMs: number;
  /** Pick: the shine sweep duration (ms). */
  shineMs: number;
  /** Sound: the fill tick's gain (0 mutes). */
  tickGain: number;
  /** Sound: the awaken / reveal cue's gain (0 mutes). */
  revealGain: number;
}

export const ANCIENTS_DEFAULTS: AncientsConfig = {
  cost: 16,
  refresh: 1,
  combat: 2,
  ringWidth: 12,
  ringOffset: 7,
  trackColor: '#241c3d',
  trackAlpha: 0.55,
  fillFrom: '#ffe36e',
  fillTo: '#ff8a1f',
  capSize: 1.25,
  ticks: 1,
  fillMs: 520,
  flashMs: 480,
  dim: 0.42,
  splitMs: 520,
  shineMs: 800,
  tickGain: 0.5,
  revealGain: 0.8,
};

type NumKey = { [K in keyof AncientsConfig]: AncientsConfig[K] extends number ? K : never }[keyof AncientsConfig];
export type AncientsNumKey = NumKey;
export type AncientsColorKey = Exclude<keyof AncientsConfig, NumKey>;

export const ANCIENTS_RANGES: Record<NumKey, [number, number, number]> = {
  cost: [1, 40, 1],
  refresh: [0, 8, 1],
  combat: [0, 16, 1],
  ringWidth: [2, 30, 0.5],
  ringOffset: [0, 30, 0.5],
  trackAlpha: [0, 1, 0.01],
  capSize: [0, 2.5, 0.05],
  ticks: [0, 1, 1],
  fillMs: [0, 1600, 10],
  flashMs: [0, 1500, 10],
  dim: [0, 0.9, 0.01],
  splitMs: [120, 1600, 10],
  shineMs: [0, 2000, 10],
  tickGain: [0, 1, 0.01],
  revealGain: [0, 1, 0.01],
};

const KEY = 'ascent.ancients';
let cfg: AncientsConfig = (() => {
  if (!import.meta.env.DEV) return { ...ANCIENTS_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...ANCIENTS_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<AncientsConfig>) : {}) };
  } catch {
    return { ...ANCIENTS_DEFAULTS };
  }
})();

const listeners = new Set<() => void>();
export function getAncientsConfig(): AncientsConfig { return cfg; }
export function subscribeAncientsConfig(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function setAncientsValue(key: keyof AncientsConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}
export function resetAncientsConfig(): void {
  cfg = { ...ANCIENTS_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}

/** The meter tuning handed to `enableAncients`. */
export function ancientMeterOverride(): { cost: number; refresh: number; combat: number } {
  return { cost: cfg.cost, refresh: cfg.refresh, combat: cfg.combat };
}
