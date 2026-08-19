import type { StoredFxDef } from './fx/defStore';

/**
 * DEV-only live tuning for HAWKUS'S UPDRAFT — the wind gust that plays when Hawkus's Rally trigger fires
 * (`fx/defs/hawkus-updraft.json`, bound as `cards.b2_hawkus.rally`).
 *
 * WHY THIS EXISTS ALONGSIDE THE FX WORKBENCH. The workbench is the full authoring tool, but it edits a DRAFT
 * and its changes only reach the game once they are SAVED back to the committed JSON. This panel is the other
 * half of that loop: it overrides the committed def's params AT PLAY TIME, so the gust can be dialled while
 * watching Hawkus actually trigger in a fight rather than previewing it in isolation. Nothing here is
 * persistent authoring — when a value reads right, put it in the JSON (Copy values → the def) and reset.
 *
 * The levers are the owner's ask (2026-08-19): GRAVITY, SPEEDS and EASE, on both layers, plus the two shape
 * dials (spread/count, rate) that decide whether it reads as a gust at all.
 *
 * `applyHawkusFxTuning` is PURE and total: it returns the def untouched unless it is the Hawkus def, and it
 * clones rather than mutating, so the cached registry def is never edited in place.
 */
export interface HawkusFxConfig {
  gustSpeed: number;    // burst: launch speed of the streaks (px/s)
  gustGravity: number;  // burst: downward pull — low keeps them rising, high makes it a fountain
  gustEase: number;     // burst: drag, i.e. how hard the air slows them (0 = coast forever, 1 = stops fast)
  gustLife: number;     // burst: how long a streak lives (ms)
  gustSpread: number;   // burst: cone width (radians) — narrow = a column, wide = a fan
  gustCount: number;    // burst: how many streaks
  airSpeed: number;     // smoke: rise speed of the soft body (px/s)
  airGravity: number;   // smoke: negative lifts it, positive lets it settle
  airLife: number;      // smoke: how long a puff lives (ms)
  airRate: number;      // smoke: puffs per second
}

/** DEFAULTS MIRROR THE COMMITTED DEF. Keep them in lockstep with `fx/defs/hawkus-updraft.json`, or the
 *  tuner's "Shipped" readout lies about what players see. */
const DEFAULTS: HawkusFxConfig = {
  gustSpeed: 1180, gustGravity: 220, gustEase: 0.86, gustLife: 1150, gustSpread: 0.42, gustCount: 46,
  airSpeed: 210, airGravity: -60, airLife: 780, airRate: 120,
};

/** [min, max, step] per slider. Gravity ranges cross ZERO on purpose — negative is what makes the gust keep
 *  climbing instead of arcing back down, and that is the difference between "wind" and "fountain". */
export const HAWKUSFX_RANGES: Record<keyof HawkusFxConfig, [number, number, number]> = {
  gustSpeed: [0, 3000, 20], gustGravity: [-1500, 3000, 20], gustEase: [0, 1, 0.01],
  gustLife: [200, 3000, 25], gustSpread: [0, 2, 0.02], gustCount: [0, 200, 1],
  airSpeed: [0, 900, 5], airGravity: [-600, 600, 10], airLife: [200, 2000, 20], airRate: [0, 400, 5],
};

const KEY = 'ascent.hawkusFx';
let cfg: HawkusFxConfig = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HawkusFxConfig>) : {}) };
  } catch { return { ...DEFAULTS }; }
})();

export function getHawkusFxConfig(): HawkusFxConfig { return cfg; }
export function setHawkusFxValue(key: keyof HawkusFxConfig, value: number | boolean): void {
  cfg = { ...cfg, [key]: Number(value) };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetHawkusFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export { DEFAULTS as HAWKUSFX_DEFAULTS };

/** The def this panel drives — the id `playDef` is asked for, and the filename under `fx/defs/`. */
export const HAWKUS_FX_ID = 'hawkus-updraft';

/** Which config keys drive which layer, keyed by the layer's authored `name`. Matching on NAME (not on index
 *  or primitive) means re-ordering the def's layers, or adding a third, can't silently retarget a slider. */
const LAYER_KEYS: Record<string, Partial<Record<keyof HawkusFxConfig, string>>> = {
  'gust-streaks': { gustSpeed: 'speed', gustGravity: 'gravity', gustEase: 'drag', gustLife: 'life', gustSpread: 'spread', gustCount: 'count' },
  'rising-air': { airSpeed: 'speed', airGravity: 'gravity', airLife: 'life', airRate: 'rate' },
};

/**
 * Overlay the live tuner values onto the Hawkus def. Returns `def` UNCHANGED for every other def (so the hot
 * `playDef` path pays one string compare) and when nothing has been dialled away from the shipped values —
 * which keeps the untouched case byte-identical to what players get.
 */
export function applyHawkusFxTuning(def: StoredFxDef): StoredFxDef {
  if (def.id !== HAWKUS_FX_ID) return def;
  const c = cfg;
  const keys = Object.keys(DEFAULTS) as (keyof HawkusFxConfig)[];
  if (keys.every((k) => c[k] === DEFAULTS[k])) return def; // untouched → the shipped def, verbatim
  return {
    ...def,
    layers: def.layers.map((layer) => {
      const map = LAYER_KEYS[layer.name ?? ''];
      if (!map) return layer;
      const params = { ...layer.params };
      for (const [cfgKey, paramKey] of Object.entries(map)) {
        params[paramKey] = c[cfgKey as keyof HawkusFxConfig];
      }
      return { ...layer, params };
    }),
  };
}
