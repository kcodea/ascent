/**
 * Tunable parameters for the DISPLACEMENT SWAP FX — the circular two-arrow exchange fired when a board
 * minion swaps with a tavern minion (Darah's hero power + the Displacement spell, both via `swapWithTavern`).
 * Two mirrored, tapered energy arcs travel between the two cards in opposite directions — one warm (the
 * tavern minion arriving on the board), one cool (the displaced minion leaving for the tavern) — each with an
 * arrowhead at its travelling tip, an arrival flash + motes, and a soft halo held on both cards for the ride.
 *
 * Same pattern as `critFxConfig.ts`: one mutable, localStorage-persisted config dialed by eye via the DEV
 * "🔀 Swap FX" tuner (`SwapFxTuner.tsx`); `getSwapFxConfig()` is read at fire time (`pixiFx.swapArc`), so
 * edits apply to the NEXT swap. DEFAULTS ship the look; production always renders DEFAULTS (dev-only persist).
 */
export interface SwapFxConfig {
  travelMs: number;    // ms — the arc head's travel time (both arcs)
  retractMs: number;   // ms — tail retract + fade after arrival
  curve: number;       // arc bulge (fraction of the span; both arcs mirror → a circle)
  wobbleAmp: number;   // px — sine wobble along the arc (0 = clean arc)
  wobbleFreq: number;  // wobble cycles along the arc
  baseWidth: number;   // px — ribbon width at the source end
  tipWidth: number;    // px — ribbon width at the head (≥ base reads as a comet)
  coreAlpha: number;   // 0..1 — bright core opacity
  glowWidth: number;   // px — soft underlay width
  glowAlpha: number;   // 0..1 — underlay opacity
  arrowSize: number;   // px — the arrowhead triangle at the travelling tip (0 = none)
  flashSize: number;   // px radius — arrival flash at each destination
  flashMs: number;     // ms — arrival flash fade
  moteCount: number;   // motes scattered on arrival (per arc)
  moteSpeed: number;   // px/s — mote fling speed
  moteLife: number;    // ms — mote lifetime
  haloSize: number;    // px radius — the soft glow held on each swapping card (0 = none)
  haloAlpha: number;   // 0..1 — halo peak opacity
  colorInCore: string;  // arriving arc (tavern → board) — bright core
  colorInGlow: string;  // arriving arc — soft glow/underlay + halo on the board card
  colorOutCore: string; // departing arc (board → tavern) — bright core
  colorOutGlow: string; // departing arc — soft glow/underlay + halo on the tavern card
}

// First-pass defaults eyeballed against the owner's reference shot (2026-07-16) — tune in the 🔀 tuner,
// Copy values, and bake back here.
const DEFAULTS: SwapFxConfig = {
  travelMs: 620,
  retractMs: 340,
  curve: 0.55,
  wobbleAmp: 0,
  wobbleFreq: 2,
  baseWidth: 4,
  tipWidth: 12,
  coreAlpha: 0.95,
  glowWidth: 26,
  glowAlpha: 0.4,
  arrowSize: 26,
  flashSize: 60,
  flashMs: 300,
  moteCount: 10,
  moteSpeed: 260,
  moteLife: 500,
  haloSize: 95,
  haloAlpha: 0.5,
  colorInCore: '#ffd9a0',
  colorInGlow: '#ff9a2e',
  colorOutCore: '#f0c4ff',
  colorOutGlow: '#c44dff',
};

export const SWAPFX_KEYS = [
  'travelMs', 'retractMs', 'curve', 'wobbleAmp', 'wobbleFreq',
  'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha', 'arrowSize',
  'flashSize', 'flashMs', 'moteCount', 'moteSpeed', 'moteLife',
  'haloSize', 'haloAlpha',
  'colorInCore', 'colorInGlow', 'colorOutCore', 'colorOutGlow',
] as const satisfies readonly (keyof SwapFxConfig)[];

export const SWAPFX_COLOR_KEYS: (keyof SwapFxConfig)[] = ['colorInCore', 'colorInGlow', 'colorOutCore', 'colorOutGlow'];

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const SWAPFX_RANGES: Partial<Record<keyof SwapFxConfig, [number, number, number]>> = {
  travelMs: [150, 2000, 10],
  retractMs: [0, 1500, 10],
  curve: [0, 1.4, 0.01],
  wobbleAmp: [0, 40, 1],
  wobbleFreq: [0, 8, 0.5],
  baseWidth: [1, 30, 1],
  tipWidth: [1, 40, 1],
  coreAlpha: [0, 1, 0.05],
  glowWidth: [0, 80, 1],
  glowAlpha: [0, 1, 0.05],
  arrowSize: [0, 70, 1],
  flashSize: [0, 200, 2],
  flashMs: [0, 1200, 10],
  moteCount: [0, 40, 1],
  moteSpeed: [0, 900, 10],
  moteLife: [0, 1600, 10],
  haloSize: [0, 260, 2],
  haloAlpha: [0, 1, 0.05],
};

const KEY = 'ascent.swapfx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: SwapFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<SwapFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getSwapFxConfig(): SwapFxConfig {
  return cfg;
}
export function setSwapFxValue(key: keyof SwapFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetSwapFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
