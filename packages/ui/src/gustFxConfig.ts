/**
 * Tunable parameters for the BUFF GUST FX — the "tavern just got buffed" cue (owner sketch, take two after
 * the shelved Enchant Weave): when Fodder is enchanted run-wide (Ritualist's End of Turn, Rune of
 * Consumption, Bane) or a Staff of Guel is cast, a rush of violet wind sweeps IN from both flanks of the
 * affected card row — a tall bracket arc hugging each end (stroke-revealed while drifting inward) + a fan
 * of staggered speed-line streaks landing at the row edge.
 *
 * Same pattern as `swapFxConfig.ts`: one mutable, localStorage-persisted config dialed via the DEV
 * "💨 Buff Gust" tuner (`GustFxTuner.tsx`); `getGustFxConfig()` is read at fire time (`pixiFx.buffGust`),
 * so edits apply to the NEXT gust. Field names + units match the preview rig
 * (apps/web/public/fx/buff-gust-preview.html) 1:1, so rig-tuned JSON bakes verbatim.
 */
export interface GustFxConfig {
  sweepMs: number;      // ms — each streak's inward travel time
  staggerMs: number;    // ms — delay between successive streaks on a side
  arcMs: number;        // ms — the bracket arc's draw-in time
  holdMs: number;       // ms — full-brightness pause once everything lands
  fadeMs: number;       // ms — whole-gust fade-out
  streaks: number;      // speed-lines per flank
  streakLen: number;    // px — a streak's full length
  streakTravel: number; // px — how far the streak drifts inward as it draws
  streakWidth: number;  // px — core stroke width
  streakCurve: number;  // slight arc on each streak (0 = straight)
  spreadY: number;      // px — vertical fan the streaks are spread across
  arcHeight: number;    // × the row height — how tall each end-bracket is
  arcBulge: number;     // px — how far the bracket bows outward
  arcWidth: number;     // px — bracket core stroke width
  arcTravel: number;    // px — inward drift as the bracket draws
  edgeOut: number;      // px — push each flank OUTWARD beyond the row bounds (toward the board ends)
  coreAlpha: number;    // 0..1
  glowWidth: number;    // px — soft underlay added around every stroke
  glowAlpha: number;    // 0..1
  taper: number;        // 1 = streaks taper to a point at the tail; 0 = uniform width
  colorCore: string;
  colorGlow: string;
}

// Owner-tuned in the 💨 tuner (2026-07-16, v3): a snappy ~1s rush — 190ms sweeps, brief hold, hot PINK
// cores over violet glow. `edgeOut` pushes the flanks toward the board ends.
const DEFAULTS: GustFxConfig = {
  sweepMs: 190,
  staggerMs: 65,
  arcMs: 520,
  holdMs: 80,
  fadeMs: 240,
  streaks: 5,
  streakLen: 105,
  streakTravel: 80,
  streakWidth: 2.5,
  streakCurve: 0.14,
  spreadY: 175,
  arcHeight: 1.5,
  arcBulge: 106,
  arcWidth: 15,
  arcTravel: 36,
  edgeOut: 90,
  coreAlpha: 0.9,
  glowWidth: 14,
  glowAlpha: 0.5,
  taper: 1,
  colorCore: '#ec3cbd',
  colorGlow: '#c64dff',
};

export const GUSTFX_KEYS = [
  'sweepMs', 'staggerMs', 'arcMs', 'holdMs', 'fadeMs',
  'streaks', 'streakLen', 'streakTravel', 'streakWidth', 'streakCurve', 'spreadY',
  'arcHeight', 'arcBulge', 'arcWidth', 'arcTravel', 'edgeOut',
  'coreAlpha', 'glowWidth', 'glowAlpha', 'taper',
  'colorCore', 'colorGlow',
] as const satisfies readonly (keyof GustFxConfig)[];

export const GUSTFX_COLOR_KEYS: (keyof GustFxConfig)[] = ['colorCore', 'colorGlow'];

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key (mirrors the rig's ranges). */
export const GUSTFX_RANGES: Partial<Record<keyof GustFxConfig, [number, number, number]>> = {
  sweepMs: [100, 1500, 10], staggerMs: [0, 200, 5], arcMs: [80, 1200, 10], holdMs: [0, 1500, 10], fadeMs: [80, 1200, 10],
  streaks: [0, 10, 1], streakLen: [40, 400, 5], streakTravel: [0, 400, 5], streakWidth: [1, 20, 0.5], streakCurve: [0, 0.6, 0.02], spreadY: [40, 400, 5],
  arcHeight: [0.6, 2.5, 0.05], arcBulge: [0, 160, 2], arcWidth: [1, 24, 0.5], arcTravel: [0, 200, 2], edgeOut: [0, 400, 5],
  coreAlpha: [0, 1, 0.05], glowWidth: [0, 48, 1], glowAlpha: [0, 1, 0.05], taper: [0, 1, 1],
};

const KEY = 'ascent.gustfx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: GustFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<GustFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getGustFxConfig(): GustFxConfig {
  return cfg;
}
export function setGustFxValue(key: keyof GustFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetGustFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
