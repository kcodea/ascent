/**
 * Tunable parameters for the AURA WAVE FX — the "a run-wide tribe aura just grew" cue. When an aura
 * channel rises (the Undead Lantern aura, the Imp aura, Scrap Herald's Attachment aura, the Beast
 * buy-aura — see `RunState.auraFx`), a soft TRIBE-COLORED wave blooms from the CENTRE of the board out
 * to both edges and dissipates. It's a GLOBAL cue — "a field touched the whole board" — so it fires over
 * the board region regardless of which cards happen to be on screen, distinct from the tendril (a source
 * hit a target) and the gust (the shop row got rushed).
 *
 * Same pattern as `gustFxConfig.ts`: one mutable, localStorage-persisted config dialed via the DEV
 * "🌀 Aura Wave" tuner (`AuraFxTuner.tsx`); `getAuraFxConfig()` is read at fire time, so edits apply to
 * the NEXT wave. Colors are NOT here — they come from the tribe's `BUFF_PRESETS` palette at fire time,
 * so the wave always matches the tribe's tendril look.
 */
export interface AuraFxConfig {
  travelMs: number;       // ms — the crest's centre→edge travel time
  holdMs: number;         // ms — full-brightness pause once the crest reaches the edges
  fadeMs: number;         // ms — the whole wave's fade-out
  fillAlpha: number;      // 0..1 — the soft full-board glow at peak (0 = off)
  fillPadPx: number;      // px — how far the board glow extends beyond the board bounds
  crestAlpha: number;     // 0..1 — the moving crest band's brightness (0 = off)
  crestWidthFrac: number; // 0..1 — the crest band's horizontal thickness as a fraction of the half-board width
  crestHeightFrac: number;// 0..2 — the crest band's height as a fraction of the board height
  edgeFadePow: number;    // dissipation exponent — the crest fades ∝ (1 − progress)^pow toward the edges
  centerFlash: number;    // 0..1 — a bright flash at the board centre where the wave is born (0 = off)
  moteCount: number;      // rising sparkle motes across the whole board (0 = off)
  moteSize: number;       // px — sparkle size
  moteLife: number;       // ms — sparkle lifetime
  moteRise: number;       // px/s — upward drift of the sparkles
}

const DEFAULTS: AuraFxConfig = {
  travelMs: 560,
  holdMs: 60,
  fadeMs: 380,
  fillAlpha: 0.13,
  fillPadPx: 12,
  crestAlpha: 0.34,
  crestWidthFrac: 0.18,
  crestHeightFrac: 1.0,
  edgeFadePow: 1.9,
  centerFlash: 0.32,
  moteCount: 18,
  moteSize: 10,
  moteLife: 760,
  moteRise: 130,
};

export const AURAFX_KEYS = [
  'travelMs', 'holdMs', 'fadeMs',
  'fillAlpha', 'fillPadPx',
  'crestAlpha', 'crestWidthFrac', 'crestHeightFrac', 'edgeFadePow', 'centerFlash',
  'moteCount', 'moteSize', 'moteLife', 'moteRise',
] as const satisfies readonly (keyof AuraFxConfig)[];

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const AURAFX_RANGES: Partial<Record<keyof AuraFxConfig, [number, number, number]>> = {
  travelMs: [150, 1400, 10], holdMs: [0, 800, 10], fadeMs: [80, 1200, 10],
  fillAlpha: [0, 0.6, 0.02], fillPadPx: [0, 40, 1],
  crestAlpha: [0, 1, 0.05], crestWidthFrac: [0.05, 0.8, 0.01], crestHeightFrac: [0.4, 2, 0.05], edgeFadePow: [0.4, 4, 0.1], centerFlash: [0, 1, 0.05],
  moteCount: [0, 40, 1], moteSize: [2, 20, 1], moteLife: [100, 1500, 10], moteRise: [0, 300, 5],
};

const KEY = 'ascent.aurafx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: AuraFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<AuraFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getAuraFxConfig(): AuraFxConfig {
  return cfg;
}
export function setAuraFxValue(key: keyof AuraFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetAuraFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
