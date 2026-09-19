/**
 * Tunable placement for the REPLAY ROUND RAIL (`replay/RoundRail.tsx`) — the per-round index shown during
 * replay playback (owner ask 2026-08-19: "add this rail to the dev tuner so that i can increase its size and
 * change its position"). Since 2026-09-19 the rail is also DRAGGABLE by its grab handle and COLLAPSIBLE: `x`/`y`
 * here are its HOME position (where it sits before the viewer drags it — a dragged offset persists separately,
 * for players too, in `replay/railPlacement.ts`), and the metrics dock is folded into the rail as columns.
 *
 * Config is localStorage-persisted in DEV only; production always renders DEFAULTS (Layout Lab convention).
 * Values reflect to `--rrl-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS.
 */
export interface ReplayRailConfig {
  /** Rail — home horizontal offset (px) from the viewport's left edge. */
  x: number;
  /** Rail — home vertical nudge (px) off dead-center. Negative lifts it. */
  y: number;
  /** Rail — overall scale (×), all columns together (transform-origin left center). */
  s: number;
  /** Data column width (px) — Gold / Acts / Tier / Power / Win % share it. */
  colW: number;
  /** Collapsed handle width (px) — the slim plate showing the current round. */
  collapsedW: number;
}

// Owner-tuned 2026-08-21: nudged left, lifted well above center, slightly enlarged. Column/collapsed widths
// added 2026-09-19 with the column + collapse rework.
const DEFAULTS: ReplayRailConfig = {
  x: 11,
  y: -300,
  s: 1.09,
  colW: 34,
  collapsedW: 118,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const RRL_RANGES: Record<keyof ReplayRailConfig, [number, number, number]> = {
  x: [0, 300, 1],
  y: [-300, 300, 1],
  s: [0.5, 2, 0.01],
  colW: [24, 60, 1],
  collapsedW: [80, 200, 2],
};

/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as RRL_DEFAULTS };

const KEY = 'ascent.replayrail';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: ReplayRailConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ReplayRailConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getReplayRailConfig(): ReplayRailConfig {
  return cfg;
}

/** Reflect everything onto :root as `--rrl-*`. */
export function applyReplayRailVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--rrl-x', String(cfg.x));
  root.setProperty('--rrl-y', String(cfg.y));
  root.setProperty('--rrl-s', String(cfg.s));
  root.setProperty('--rrl-col-w', `${cfg.colW}px`);
  root.setProperty('--rrl-collapsed-w', `${cfg.collapsedW}px`);
}

export function setReplayRailValue(key: keyof ReplayRailConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyReplayRailVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetReplayRailConfig(): void {
  cfg = { ...DEFAULTS };
  applyReplayRailVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
applyReplayRailVars();
