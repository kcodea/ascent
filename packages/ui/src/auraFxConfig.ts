/**
 * Tunable parameters for the AURA WAVE FX — the "a run-wide tribe aura just grew" cue. When an aura
 * channel rises (the Undead Lantern aura, the Imp aura, Scrap Herald's Attachment aura, the Beast
 * buy-aura — see `RunState.auraFx`), a soft TRIBE-COLORED glow is born at the CENTRE of the board and
 * expands out to both edges, dissipating from the centre behind the moving front (a fading wake), while
 * sparkle motes with streak tails float up in mixed colors. It's a GLOBAL cue — "a field touched the
 * whole board" — so it fires over the board region regardless of which cards happen to be on screen,
 * distinct from the tendril (a source hit a target) and the gust (the shop row got rushed).
 *
 * Same pattern as `gustFxConfig.ts`: one mutable, localStorage-persisted config dialed via the DEV
 * "🌀 Aura Wave" tuner (`AuraFxTuner.tsx`); `getAuraFxConfig()` is read at fire time, so edits apply to
 * the NEXT wave. The `widthScale`/`heightScale`/`offsetX`/`offsetY` dials size the wave region relative
 * to the measured board zone (owner ask 2026-07-17: fit the wave to the board's visual spacing — no pads).
 * Colors are NOT here — they come from the tribe's `BUFF_PRESETS` palette at fire time (plus baked
 * white/gold mote accents), so the wave always matches the tribe's tendril look.
 */
export interface AuraFxConfig {
  travelMs: number;    // ms — the front's centre→edge travel time
  fadeMs: number;      // ms — how long the wake (and the board glow) lingers before dissipating
  fillAlpha: number;   // 0..1 — the soft board glow at peak (0 = off); clipped to the sized region, no pad
  glowAlpha: number;   // 0..1 — the expanding front's wake-puff brightness (0 = off)
  glowSize: number;    // px — the wake puffs' horizontal size (their height hugs the band)
  glowSpacing: number; // px — distance between wake puffs along the travel (smaller = denser trail)
  widthScale: number;  // × — wave width as a fraction of the measured board zone (fit-to-board dial)
  heightScale: number; // × — wave height as a fraction of the measured card row
  offsetX: number;     // px — horizontal shift of the wave region
  offsetY: number;     // px — vertical shift of the wave region
  moteCount: number;   // rising sparkle motes across the wave (0 = off) — spawned as the front passes them
  moteSize: number;    // px — sparkle head size
  moteLife: number;    // ms — sparkle lifetime
  moteRise: number;    // px/s — upward drift of the sparkles
  moteTail: number;    // 0.1..1 — tail narrowness (smaller = longer-looking vertical streak; 1 = round, no tail)
}

// Owner-tuned 2026-07-17 (v2): a slow, visible expansion (1140ms travel, short 90ms wake fade — a tight
// crisp front of small dense puffs, 28px at 10px spacing) under the same dense drift of small tailed motes
// (140 × 2170ms, gentle 60px/s rise) — the front sweep IS visible now, the board fill is near-off.
// Sized 1.13× width / 2.2× height, raised 174px to sit over the board.
const DEFAULTS: AuraFxConfig = {
  travelMs: 1140,
  fadeMs: 90,
  fillAlpha: 0.04,
  glowAlpha: 0.16,
  glowSize: 28,
  glowSpacing: 10,
  widthScale: 1.13,
  heightScale: 2.2,
  offsetX: 0,
  offsetY: -174,
  moteCount: 140,
  moteSize: 3,
  moteLife: 2170,
  moteRise: 60,
  moteTail: 0.54,
};

export const AURAFX_KEYS = [
  'travelMs', 'fadeMs',
  'fillAlpha', 'glowAlpha', 'glowSize', 'glowSpacing',
  'widthScale', 'heightScale', 'offsetX', 'offsetY',
  'moteCount', 'moteSize', 'moteLife', 'moteRise', 'moteTail',
] as const satisfies readonly (keyof AuraFxConfig)[];

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const AURAFX_RANGES: Partial<Record<keyof AuraFxConfig, [number, number, number]>> = {
  travelMs: [150, 2400, 10], fadeMs: [80, 2000, 10],
  fillAlpha: [0, 0.4, 0.01], glowAlpha: [0, 1, 0.02], glowSize: [10, 220, 2], glowSpacing: [10, 90, 2],
  widthScale: [0.3, 1.3, 0.01], heightScale: [0.3, 2.2, 0.02], offsetX: [-400, 400, 2], offsetY: [-250, 250, 2],
  moteCount: [0, 140, 2], moteSize: [2, 20, 1], moteLife: [100, 2400, 10], moteRise: [0, 500, 5],
  moteTail: [0.1, 1, 0.02],
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
