export interface ConsumeFxConfig {
  durationMs: number;   // D — the whole eat; matches the authored def's duration
  shakePhase: number;   // fraction of the eat spent on the initial shake (independent of the pull below)
  shakeAmp: number;     // px of jitter at the shake peak
  shakeFreq: number;    // shake oscillations/sec
  stretch: number;      // taffy elongation DOWNWARD, bottom-led (0..2)
  thin: number;         // thinning across (horizontal) while it stretches (0..1)
  lag: number;          // how long the top waits before it follows the bottom (0..~0.9 of the eat)
  pullDist: number;     // fraction of the ghost→eater vector travelled (0..1)
  collapseStart: number; // fraction of the eat at which the ghost starts to SHRINK toward the eater (0..1)
  fadeStart: number;    // fraction of the eat at which the ghost starts to FADE OUT (0..1)
  eaterGrowAmount: number; // how much bigger the CONSUMING minion swells at its peak (0 = none, 0.2 = +20%)
  eaterGrowLength: number; // fraction of the eat where the swell peaks before it snaps back (0..1)
  eaterRecoil: number;  // overshoot as it snaps back to true size — the little settle bounce (0..0.3)
  showStats: boolean;   // render the eaten minion's stats on the ghost
}

const DEFAULTS: ConsumeFxConfig = {
  durationMs: 530, shakePhase: 0.76, shakeAmp: 18.5, shakeFreq: 60, stretch: 0.2, thin: 0.66, lag: 0.52,
  pullDist: 1.08, collapseStart: 0.92, fadeStart: 0, eaterGrowAmount: 0.12, eaterGrowLength: 0.82,
  eaterRecoil: 0.05, showStats: true,
};

// [min, max, step] for the tuner sliders (booleans handled as a toggle, not here).
export const CONSUMEFX_RANGES: Partial<Record<keyof ConsumeFxConfig, [number, number, number]>> = {
  durationMs: [200, 2000, 10], shakePhase: [0, 0.9, 0.02], shakeAmp: [0, 20, 0.5], shakeFreq: [0, 60, 1],
  stretch: [0, 2.5, 0.05], thin: [0, 1, 0.02], lag: [0, 0.9, 0.02], pullDist: [0, 1.2, 0.02],
  collapseStart: [0, 1, 0.02], fadeStart: [0, 1, 0.02],
  eaterGrowAmount: [0, 0.6, 0.01], eaterGrowLength: [0, 1, 0.02], eaterRecoil: [0, 0.3, 0.01],
};

const KEY = 'ascent.consumeFx';
let cfg: ConsumeFxConfig = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ConsumeFxConfig>) : {}) };
  } catch { return { ...DEFAULTS }; }
})();

export function getConsumeFxConfig(): ConsumeFxConfig { return cfg; }
export function setConsumeFxValue(key: keyof ConsumeFxConfig, value: number | boolean): void {
  // showStats is typed boolean; the schema toggle writes a numeric 1/0, so coerce here to keep the stored
  // value a real boolean — otherwise the "Shipped (N)" strict compare and Copy-values emit `1` not `true`.
  const v = key === 'showStats' ? Boolean(value) : value;
  cfg = { ...cfg, [key]: v };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetConsumeFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export { DEFAULTS as CONSUMEFX_DEFAULTS };
