/**
 * Tunable placement for the REPLAY ROUND RAIL (`replay/RoundRail.tsx`) — the left-hand per-round index shown
 * during replay playback, with its slide-out metrics dock (owner ask 2026-08-19: "add this rail to the dev
 * tuner so that i can increase its size and change its position").
 *
 * Config is localStorage-persisted in DEV only; production always renders DEFAULTS (Layout Lab convention).
 * Values reflect to `--rrl-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS.
 */
export interface ReplayRailConfig {
  /** Rail — horizontal offset (px) from the viewport's left edge. */
  x: number;
  /** Rail — vertical nudge (px) off dead-center. Negative lifts it. */
  y: number;
  /** Rail — overall scale (×), rail + dock together (transform-origin left center). */
  s: number;
  /** Dock — width (px) of the slide-out metrics panel. */
  dockW: number;
}

// Owner-tuned 2026-08-21: nudged left, lifted well above center, slightly enlarged.
const DEFAULTS: ReplayRailConfig = {
  x: 11,
  y: -300,
  s: 1.09,
  dockW: 128,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const RRL_RANGES: Record<keyof ReplayRailConfig, [number, number, number]> = {
  x: [0, 300, 1],
  y: [-300, 300, 1],
  s: [0.5, 2, 0.01],
  dockW: [90, 240, 2],
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
  root.setProperty('--rrl-dock-w', `${cfg.dockW}px`);
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
