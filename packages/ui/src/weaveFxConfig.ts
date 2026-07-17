/**
 * Tunable parameters for the ENCHANT WEAVE FX — the "row lights up" group-buff cue: when Fodder is
 * enchanted run-wide (Ritualist's End of Turn, Rune of Consumption, Bane) or a Staff of Guel is cast,
 * every affected visible card is wrapped in a crackling violet weave — writhing filament wreaths hugging
 * each frame, lens link-arcs jumping between adjacent affected cards, and star twinkles — igniting,
 * holding, and fading as one.
 *
 * Same pattern as `swapFxConfig.ts`: one mutable, localStorage-persisted config dialed via the DEV
 * "✨ Enchant Weave" tuner (`WeaveFxTuner.tsx`); `getWeaveFxConfig()` is read at fire time
 * (`pixiFx.enchantWeave`), so edits apply to the NEXT weave. Field names + units match the preview rig
 * (apps/web/public/fx/enchant-weave-preview.html) 1:1, so rig-tuned JSON bakes verbatim.
 */
export interface WeaveFxConfig {
  igniteMs: number;    // ms — per-card wreath fade/scale-in
  staggerMs: number;   // ms — left→right ignition delay between cards (0 = simultaneous)
  holdMs: number;      // ms — full-brightness writhe after the LAST card ignites
  fadeMs: number;      // ms — whole-weave fade-out
  filaments: number;   // crackling loops per card
  inset: number;       // px the base loop sits OUTSIDE the card edge
  writheAmp: number;   // px — noise displacement of each loop (the crackle)
  writheSpeed: number; // writhe cycles per second
  jag: number;         // higher = more, sharper kinks per loop (noise frequency)
  coreWidth: number;   // px — bright core stroke
  coreAlpha: number;   // 0..1
  glowWidth: number;   // px — soft underlay stroke
  glowAlpha: number;   // 0..1
  linkArcs: number;    // arcs joining each adjacent affected pair (0 = none)
  linkBulge: number;   // px — how far the link arcs bow from the straight line
  linkWidth: number;   // px — link core width
  sparkleCount: number; // star twinkles per card
  sparkleSize: number;  // px — star radius
  sparkleRate: number;  // twinkle pulses per second
  colorCore: string;
  colorGlow: string;
  colorSparkle: string;
}

// Owner-tuned on the preview rig (2026-07-16) — "a good starting place": an instant, snappy ~620ms pop
// with tight 2-filament wreaths, one bold link arc per pair, and a dense twinkle field.
const DEFAULTS: WeaveFxConfig = {
  igniteMs: 0,
  staggerMs: 0,
  holdMs: 300,
  fadeMs: 320,
  filaments: 2,
  inset: 2,
  writheAmp: 4,
  writheSpeed: 1.6,
  jag: 6,
  coreWidth: 2.2,
  coreAlpha: 0.95,
  glowWidth: 11,
  glowAlpha: 0.5,
  linkArcs: 1,
  linkBulge: 38,
  linkWidth: 4.1,
  sparkleCount: 24,
  sparkleSize: 12,
  sparkleRate: 2.9,
  colorCore: '#ffd9ff',
  colorGlow: '#c44dff',
  colorSparkle: '#f7c9ff',
};

export const WEAVEFX_KEYS = [
  'igniteMs', 'staggerMs', 'holdMs', 'fadeMs',
  'filaments', 'inset', 'writheAmp', 'writheSpeed', 'jag',
  'coreWidth', 'coreAlpha', 'glowWidth', 'glowAlpha',
  'linkArcs', 'linkBulge', 'linkWidth',
  'sparkleCount', 'sparkleSize', 'sparkleRate',
  'colorCore', 'colorGlow', 'colorSparkle',
] as const satisfies readonly (keyof WeaveFxConfig)[];

export const WEAVEFX_COLOR_KEYS: (keyof WeaveFxConfig)[] = ['colorCore', 'colorGlow', 'colorSparkle'];

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key (mirrors the rig's ranges). */
export const WEAVEFX_RANGES: Partial<Record<keyof WeaveFxConfig, [number, number, number]>> = {
  igniteMs: [0, 1000, 10], staggerMs: [0, 400, 5], holdMs: [100, 4000, 20], fadeMs: [100, 1500, 10],
  filaments: [1, 6, 1], inset: [0, 30, 1], writheAmp: [0, 40, 1], writheSpeed: [0.2, 5, 0.1], jag: [2, 14, 1],
  coreWidth: [0.5, 8, 0.1], coreAlpha: [0, 1, 0.05], glowWidth: [0, 30, 1], glowAlpha: [0, 1, 0.05],
  linkArcs: [0, 4, 1], linkBulge: [0, 80, 1], linkWidth: [0.5, 8, 0.1],
  sparkleCount: [0, 24, 1], sparkleSize: [2, 16, 1], sparkleRate: [0.3, 6, 0.1],
};

const KEY = 'ascent.weavefx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: WeaveFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<WeaveFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getWeaveFxConfig(): WeaveFxConfig {
  return cfg;
}
export function setWeaveFxValue(key: keyof WeaveFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetWeaveFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
