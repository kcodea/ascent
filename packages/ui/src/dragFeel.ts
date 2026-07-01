/**
 * Tunable parameters for the weighted card-drag feel (the floating `.dragcard` in Recruit). A dragged card
 * lags slightly behind the cursor (weight) and tilts in 3D toward its motion (a perspective lean, à la the
 * PixiJS perspective-mesh example) — both driven off the SAME signal: the gap between the cursor (target) and
 * the card's smoothed render position. Bigger gap ⇒ faster motion ⇒ more lean; when the cursor stops the gap
 * closes and the card settles flat. Held in one mutable, localStorage-persisted config so the feel can be
 * dialed by eye via the DEV Drag tuner (`DragTuner.tsx`); Recruit's drag rAF reads `getDragFeel()` each frame.
 */
export interface DragFeel {
  /** Catch-up fraction per 60 fps frame toward the cursor (1 = instant/no lag; lower = heavier/laggier). */
  follow: number;
  /** Degrees of tilt per px of lag-gap — how hard the card leans into its motion. */
  tiltPerPx: number;
  /** Max tilt (deg) — clamps the lean so a fast fling can't over-rotate. */
  tiltMax: number;
  /** Horizontal lean — DIRECTIONAL part: leans by left-vs-right direction (mirrored). ± sets which way, 0 = off. */
  hDir: number;
  /** Horizontal lean — MAGNITUDE part: leans by horizontal SPEED regardless of direction. ± sets which way. */
  hAbs: number;
  /** Vertical lean — DIRECTIONAL part: leans by up-vs-down direction (mirrored). ± sets which way, 0 = off. */
  vDir: number;
  /** Vertical lean — MAGNITUDE part: leans by vertical SPEED regardless of direction. ± sets which way. */
  vAbs: number;
  /** CSS perspective (px) for the 3D tilt — smaller = stronger foreshortening. */
  perspective: number;
  /** Hold scale — how much the card grows while lifted (the 'off the table' size). */
  scale: number;
  /** A fixed 2D angle (deg) while held; 0 = sits flat like a card on the table. */
  staticRotate: number;
  /** Pixels the pointer must move before a click becomes a drag. */
  threshold: number;
  /** How fast an invalid drop springs back to its slot (ms). */
  snapMs: number;
  /** Duration of the Mech 'absorb' slide on a magnetic merge (ms). */
  magSlideMs: number;
}

const DEFAULTS: DragFeel = {
  follow: 0.4,      // a slight, weighty lag (closes 40% of the gap each frame ≈ 33 ms time constant)
  tiltPerPx: 0.16,  // gentle lean
  tiltMax: 6,       // the slightest tilt
  hDir: 0,          // horizontal: no directional lean by default…
  hAbs: 1,          // …lean by horizontal speed (both directions the same)
  vDir: 0,          // vertical: no directional lean by default…
  vAbs: -1,         // …lean by vertical speed (both directions the same)
  perspective: 800,
  scale: 1.04,      // lifted a touch off the table
  staticRotate: 0,  // flat when held still
  threshold: 5,
  snapMs: 110,
  magSlideMs: 280,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const DRAG_RANGES: Record<keyof DragFeel, [number, number, number]> = {
  follow: [0.1, 1, 0.02],
  tiltPerPx: [0, 0.6, 0.01],
  tiltMax: [0, 20, 0.5],
  hDir: [-1, 1, 0.1],
  hAbs: [-1, 1, 0.1],
  vDir: [-1, 1, 0.1],
  vAbs: [-1, 1, 0.1],
  perspective: [200, 1600, 50],
  scale: [1, 1.3, 0.01],
  staticRotate: [-8, 8, 0.5],
  threshold: [0, 30, 1],
  snapMs: [40, 400, 10],
  magSlideMs: [100, 600, 10],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const DRAG_DESC: Record<keyof DragFeel, string> = {
  follow: 'How fast the card catches up to the cursor. Lower = heavier/laggier; 1 = instant (no lag).',
  tiltPerPx: 'Degrees of 3D lean per pixel the card trails the cursor. Higher = leans harder when moving.',
  tiltMax: 'Ceiling on the tilt (degrees) so a fast fling can’t over-rotate.',
  hDir: 'Horizontal DIRECTIONAL lean: mirrors left vs right. ± sets which way; 0 = off. (Combines with H speed.)',
  hAbs: 'Horizontal SPEED lean: same tilt whichever way you drag horizontally. ± sets which way; 0 = off.',
  vDir: 'Vertical DIRECTIONAL lean: mirrors up vs down. ± sets which way; 0 = off. (Combines with V speed.)',
  vAbs: 'Vertical SPEED lean: same tilt whichever way you drag vertically. ± sets which way; 0 = off.',
  perspective: 'CSS 3D depth (px). Smaller = stronger foreshortening / more dramatic tilt.',
  scale: 'How much the card grows while held — the “lifted off the table” size.',
  staticRotate: 'A fixed 2D angle (deg) while held. 0 = sits flat like a card on the table.',
  threshold: 'Pixels the pointer must move before a click turns into a drag.',
  snapMs: 'How fast an invalid drop springs back to its slot (milliseconds).',
  magSlideMs: 'Duration of the Mech “absorb” slide when a Magnetic minion merges (milliseconds).',
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
