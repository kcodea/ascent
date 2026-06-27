/**
 * Tunable parameters for the weighted card-drag feel (the floating `.dragcard` in Recruit). A dragged card
 * lags slightly behind the cursor (weight) and tilts in 3D toward its motion (a perspective lean, à la the
 * PixiJS perspective-mesh example) — both driven off the SAME signal: the gap between the cursor (target) and
 * the card's smoothed render position. Bigger gap ⇒ faster motion ⇒ more lean; when the cursor stops the gap
 * closes and the card settles flat. Held in one mutable, localStorage-persisted config so the feel can be
 * dialed by eye via the DEV Drag tuner (`DragTuner.tsx`) without a code round-trip; Recruit's drag rAF reads
 * `getDragFeel()` every frame.
 */
export interface DragFeel {
  /** Catch-up fraction per 60 fps frame toward the cursor (1 = instant/no lag; lower = heavier/laggier). */
  follow: number;
  /** Degrees of tilt per px of lag-gap — how hard the card leans into its motion. */
  tiltPerPx: number;
  /** Max tilt (deg) — clamps the lean so a fast fling can't over-rotate. */
  tiltMax: number;
  /** CSS perspective (px) for the 3D tilt — smaller = stronger foreshortening. */
  perspective: number;
}

const DEFAULTS: DragFeel = {
  follow: 0.4,      // a slight, weighty lag (closes 40% of the gap each frame ≈ 33 ms time constant)
  tiltPerPx: 0.16,  // gentle lean
  tiltMax: 6,       // the slightest tilt
  perspective: 800,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const DRAG_RANGES: Record<keyof DragFeel, [number, number, number]> = {
  follow: [0.1, 1, 0.02],
  tiltPerPx: [0, 0.6, 0.01],
  tiltMax: [0, 20, 0.5],
  perspective: [200, 1600, 50],
};
export const DRAG_KEYS = Object.keys(DEFAULTS) as (keyof DragFeel)[];

const KEY = 'ascent.dragfeel';
let cfg: DragFeel = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<DragFeel>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getDragFeel(): DragFeel {
  return cfg;
}
export function setDragValue(key: keyof DragFeel, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetDragFeel(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
