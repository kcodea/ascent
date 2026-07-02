/**
 * Tunable placement for the persistent divine-shield / reborn aura on RECRUIT cards (shop / warband tiles).
 * Combat units are a clean square and centre perfectly on the art, but recruit cards hang their stat badges
 * below the square art tile, so the aura needs a small vertical nudge to sit centred on the whole card. Held
 * in one mutable, localStorage-persisted config so it can be dialed by eye via the DEV Shield tuner
 * (`ShieldTuner.tsx`); `syncShields` reads `getShieldConfig()` each reconcile, so edits apply on the next sync.
 */
export interface ShieldConfig {
  /** Vertical nudge as a fraction of card height (+down / −up). Recruit cards only; 0 = centred on the art. */
  recruitDy: number;
}

const DEFAULTS: ShieldConfig = {
  recruitDy: 0.01, // dialed by eye: perfect alignment on shop/warband cards
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const SHIELD_RANGES: Record<keyof ShieldConfig, [number, number, number]> = {
  recruitDy: [-0.12, 0.2, 0.005],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const SHIELD_DESC: Record<keyof ShieldConfig, string> = {
  recruitDy: 'Divine-shield / reborn bubble vertical offset on shop & warband cards (fraction of card height; + = down).',
};
export const SHIELD_KEYS = Object.keys(DEFAULTS) as (keyof ShieldConfig)[];

const KEY = 'ascent.shield';
let cfg: ShieldConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ShieldConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getShieldConfig(): ShieldConfig {
  return cfg;
}
export function setShieldValue(key: keyof ShieldConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetShieldConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
