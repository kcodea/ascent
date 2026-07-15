/**
 * Tunable parameters for the CRITICAL-STRIKE impact FX — the amplified crimson-gold burst a crit swing
 * (Commander Impala's CR) fires in place of the normal smack. Same pattern as `strikeFxConfig.ts`: one mutable,
 * localStorage-persisted config dialed by eye via the DEV "Critical Strike FX" tuner (`CritFxTuner.tsx`);
 * `getCritFxConfig()` is read at strike time (`pixiFx.critImpact`), so edits apply to the next crit.
 *
 * The DEFAULTS are the owner-tuned values from the preview rig (apps/web/public/fx/crit-preview.html), and the
 * field names + UNITS match that rig 1:1 — `pixiFx.critImpact` replicates the rig's drawing math (px sizes →
 * sprite scale via the texture's natural pixel size), so a value tuned on the rig transfers verbatim.
 *
 * The CRIT layers: an amplified core flash + saturated shockwave, a bold ring, a wide spark burst, a "CRIT!"
 * text pop, and a red defender flash. (The board SHAKE is a separate CSS keyframe — `.app.shaking-crit` — fired
 * from the replay at contact; its `shakePx`/`shakeMs` here document the tuned feel the keyframe reproduces.)
 */
export interface CritFxConfig {
  critPower: number;      // crit intensity vs a normal hit (normal ≈ 1). Scales core / shock / spark speed.
  flashSize: number;      // hot additive core flash size (rig px factor)
  shockwaveSize: number;  // saturated normal-blend shockwave size (paints over cream)
  ringSize: number;       // px — max radius the bold CRIT ring expands to
  ringWidth: number;      // px — ring stroke width
  ringMs: number;         // ms — ring expand+fade duration
  sparkCount: number;     // shard count
  sparkSpeed: number;     // px/s — initial spark speed
  sparkLife: number;      // ms — spark lifetime
  sparkSize: number;      // px — drawn spark size
  sparkSpread: number;    // deg — cone width around the blow direction
  textSize: number;       // px — "CRIT!" font size
  textRise: number;       // px — how far it floats up over its life
  textMs: number;         // ms — "CRIT!" lifetime
  textPop: number;        // initial overshoot scale (springs down to 1)
  cardFlashAlpha: number; // 0..1 peak red overlay alpha on the defender card
  cardFlashMs: number;    // ms — red flash fade
  shakePx: number;        // px — board shake amplitude (reproduced by the .shaking-crit keyframe)
  shakeMs: number;        // ms — board shake decay (reproduced by the .shaking-crit keyframe)
  colorCore: string;
  colorShock: string;
  colorRing: string;
  colorSpark1: string;
  colorSpark2: string;
  colorSpark3: string;
  colorText: string;
  colorTextEdge: string;
}

// Owner-tuned on the preview rig (2026-07-15) — "this is perfect".
const DEFAULTS: CritFxConfig = {
  critPower: 2.1,
  flashSize: 10.7,
  shockwaveSize: 7.9,
  ringSize: 310,
  ringWidth: 14,
  ringMs: 380,
  sparkCount: 51,
  sparkSpeed: 1260,
  sparkLife: 640,
  sparkSize: 17,
  sparkSpread: 220,
  textSize: 45,
  textRise: 92,
  textMs: 760,
  textPop: 2.45,
  cardFlashAlpha: 0.56,
  cardFlashMs: 470,
  shakePx: 13,
  shakeMs: 280,
  colorCore: '#fff0c0',
  colorShock: '#ff3320',
  colorRing: '#ff704d',
  colorSpark1: '#ff2a14',
  colorSpark2: '#ff781f',
  colorSpark3: '#ff674d',
  colorText: '#ff2424',
  colorTextEdge: '#700000',
};

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key (colours use a colour input). */
export const CRITFX_RANGES: Record<string, [number, number, number]> = {
  critPower: [1, 3, 0.05],
  flashSize: [1, 12, 0.1],
  shockwaveSize: [1, 12, 0.1],
  ringSize: [40, 480, 5],
  ringWidth: [1, 30, 1],
  ringMs: [150, 1000, 10],
  sparkCount: [0, 80, 1],
  sparkSpeed: [100, 1600, 20],
  sparkLife: [200, 1400, 10],
  sparkSize: [2, 40, 1],
  sparkSpread: [20, 360, 5],
  textSize: [16, 96, 1],
  textRise: [0, 140, 2],
  textMs: [300, 1600, 20],
  textPop: [1, 3, 0.05],
  cardFlashAlpha: [0, 1, 0.02],
  cardFlashMs: [100, 800, 10],
  shakePx: [0, 40, 1],
  shakeMs: [0, 700, 10],
};

/** Key order the tuner renders + the exported literal uses (matches the rig's export). */
export const CRITFX_KEYS = Object.keys(DEFAULTS) as (keyof CritFxConfig)[];
/** Which keys are colours (rendered as colour inputs, not sliders). */
export const CRITFX_COLOR_KEYS = CRITFX_KEYS.filter((k) => k.startsWith('color'));

const KEY = 'ascent.critfx';
let cfg: CritFxConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CritFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getCritFxConfig(): CritFxConfig {
  return cfg;
}
export function setCritFxValue(key: keyof CritFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetCritFxConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export const CRITFX_DEFAULTS = DEFAULTS;
