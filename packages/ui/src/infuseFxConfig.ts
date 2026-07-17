/**
 * Tunable parameters for the FODDER INFUSION FX — "the unit is sending Fodder into the shop": when a card
 * queues Fodder for the tavern (Maw of the Pit's End of Turn, The Godfodder's pick, Soulfeeder's Shout,
 * Korok's gold meter, Burial Imp), organic violet tendrils reach from THAT unit up to the shop line —
 * branching ribbons that strike just below the row (never wrapping the shop cards), each landing with a
 * small flash + motes, plus one "sending" pulse at the source.
 *
 * Built ENTIRELY on the existing `pixiFx.buffTendril` ribbons — this config just fans N of them out
 * (count / spread / stagger) and carries the per-tendril TendrilCfg dials. Same trio pattern as
 * `gustFxConfig.ts`: dev-persisted, dialed via the "🍖 Fodder Infusion" tuner, DEFAULTS are the shipped
 * look (`getInfuseFxConfig()` is read at fire time — edits apply to the NEXT infusion).
 */
export interface InfuseFxConfig {
  count: number;       // tendrils per infusion (fanned across the shop row)
  spreadFrac: number;  // 0..1 — fraction of the row's width the endpoints span (centred)
  staggerMs: number;   // ms — launch delay between successive tendrils
  endYOff: number;     // px — how far BELOW the shop row's bottom edge the tendrils strike
  travelMs: number;    // ms — each ribbon's head travel time
  retractMs: number;   // ms — tail retract + fade after the strike
  curve: number;       // arc bulge per tendril (alternating sides for the organic branch look)
  wobbleAmp: number;   // px — sine wobble along the ribbon
  wobbleFreq: number;  // wobble cycles along the ribbon
  baseWidth: number;   // px — ribbon width at the source
  tipWidth: number;    // px — ribbon width at the head
  coreAlpha: number;   // 0..1 — bright core opacity
  glowWidth: number;   // px — soft underlay width
  glowAlpha: number;   // 0..1 — underlay opacity
  flashSize: number;   // px radius — the strike flash where a tendril lands
  flashMs: number;     // ms — strike flash fade
  moteCount: number;   // motes scattered at each strike
  moteSpeed: number;   // px/s
  moteLife: number;    // ms
  pulseSize: number;   // px radius — the "sending" pulse at the SOURCE unit (fires once, 0 = none)
  pulseAlpha: number;  // 0..1
  pulseMs: number;     // ms
  colorCore: string;
  colorGlow: string;
}

// First-pass defaults eyeballed to the owner's reference (2026-07-16) — organic violet tendrils in the
// Fodder palette (matching the Buff Gust's pink/violet). Tune in the 🍖 tuner, Copy values, bake back.
const DEFAULTS: InfuseFxConfig = {
  count: 3,
  spreadFrac: 0.6,
  staggerMs: 70,
  endYOff: 10,
  travelMs: 450,
  retractMs: 350,
  curve: 0.3,
  wobbleAmp: 12,
  wobbleFreq: 2.5,
  baseWidth: 7,
  tipWidth: 3,
  coreAlpha: 0.9,
  glowWidth: 18,
  glowAlpha: 0.5,
  flashSize: 46,
  flashMs: 260,
  moteCount: 6,
  moteSpeed: 240,
  moteLife: 420,
  pulseSize: 70,
  pulseAlpha: 0.6,
  pulseMs: 300,
  colorCore: '#ec3cbd',
  colorGlow: '#c64dff',
};

export const INFUSEFX_KEYS = [
  'count', 'spreadFrac', 'staggerMs', 'endYOff',
  'travelMs', 'retractMs', 'curve', 'wobbleAmp', 'wobbleFreq',
  'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha',
  'flashSize', 'flashMs', 'moteCount', 'moteSpeed', 'moteLife',
  'pulseSize', 'pulseAlpha', 'pulseMs',
  'colorCore', 'colorGlow',
] as const satisfies readonly (keyof InfuseFxConfig)[];

export const INFUSEFX_COLOR_KEYS: (keyof InfuseFxConfig)[] = ['colorCore', 'colorGlow'];

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const INFUSEFX_RANGES: Partial<Record<keyof InfuseFxConfig, [number, number, number]>> = {
  count: [1, 7, 1], spreadFrac: [0, 1, 0.05], staggerMs: [0, 300, 5], endYOff: [-60, 120, 2],
  travelMs: [150, 1500, 10], retractMs: [0, 1200, 10], curve: [0, 1, 0.02], wobbleAmp: [0, 40, 1], wobbleFreq: [0, 8, 0.5],
  baseWidth: [1, 24, 0.5], tipWidth: [1, 24, 0.5], coreAlpha: [0, 1, 0.05], glowWidth: [0, 48, 1], glowAlpha: [0, 1, 0.05],
  flashSize: [0, 160, 2], flashMs: [0, 1000, 10], moteCount: [0, 24, 1], moteSpeed: [0, 900, 10], moteLife: [0, 1500, 10],
  pulseSize: [0, 200, 2], pulseAlpha: [0, 1, 0.05], pulseMs: [0, 1000, 10],
};

const KEY = 'ascent.infusefx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: InfuseFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<InfuseFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getInfuseFxConfig(): InfuseFxConfig {
  return cfg;
}
export function setInfuseFxValue(key: keyof InfuseFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetInfuseFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
