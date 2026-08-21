/**
 * DEV-tunable overrides for the HERO CEREMONY timing (hero-select-ceremony-blueprint.md §4).
 *
 * Follows the Layout Lab convention: localStorage-persisted in DEV only; production always plays
 * `HERO_CEREMONY_TIMING`. Values flow through `setCeremonyTiming`, the same override hook the ceremony's
 * sequence runner reads on every run — so moving a slider changes the NEXT ceremony, and the tuner's Replay
 * action lets you watch it immediately. Shipping a feel means pasting the tuned JSON into
 * `HERO_CEREMONY_TIMING`'s defaults (never publishing tuner state as a side effect).
 */
import { HERO_CEREMONY_TIMING, setCeremonyTiming, type HeroCeremonyTiming } from './heroCeremonyTiming';

export const HSC_DEFAULTS: HeroCeremonyTiming = HERO_CEREMONY_TIMING;

/** Slider bounds — [min, max, step] per key. Wide enough to explore, bounded enough to stay a ceremony. */
export const HSC_RANGES: Record<keyof HeroCeremonyTiming, [number, number, number]> = {
  pressMs: [0, 300, 10],
  headerExitDelayMs: [0, 500, 10],
  optionExitDelayMs: [0, 500, 10],
  optionExitMs: [100, 800, 10],
  optionStaggerMs: [0, 120, 5],
  focusDelayMs: [0, 500, 10],
  focusMs: [200, 1200, 20],
  settleMs: [40, 400, 10],
  arrivalAtMs: [200, 1500, 20],
  voiceAtMs: [200, 2000, 20],
  transformAtMs: [400, 2500, 25],
  transformMs: [200, 1500, 25],
  identityAtMs: [600, 3000, 25],
  readyAtMs: [800, 3500, 25],
  readyMs: [80, 600, 10],
  launchCoverMs: [100, 800, 10],
  launchRevealMs: [100, 800, 10],
};

const KEY = 'ascent.heroceremony';

let cfg: HeroCeremonyTiming = (() => {
  if (!import.meta.env.DEV) return { ...HSC_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...HSC_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HeroCeremonyTiming>) : {}) };
  } catch {
    return { ...HSC_DEFAULTS };
  }
})();

/** Push the current config into the live override the ceremony reads. Defaults → clear the override, so
 *  prod-parity is the resting state rather than a copied object that could drift. */
function apply(): void {
  const isDefault = (Object.keys(HSC_DEFAULTS) as (keyof HeroCeremonyTiming)[])
    .every((k) => cfg[k] === HSC_DEFAULTS[k]);
  setCeremonyTiming(isDefault ? null : { ...cfg });
}
if (import.meta.env.DEV) apply(); // saved values take effect on load, like every other tuner

export function getHeroCeremonyConfig(): HeroCeremonyTiming {
  return cfg;
}

export function setHeroCeremonyValue(key: keyof HeroCeremonyTiming, value: number): void {
  cfg = { ...cfg, [key]: value };
  apply();
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroCeremonyConfig(): void {
  cfg = { ...HSC_DEFAULTS };
  apply();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuner's Replay action: re-run the ceremony on the CURRENT hero-select screen without re-clicking
 *  through Title → mode. The ceremony component listens (dev builds) and restarts from `committed` with the
 *  last-selected hero. Dispatching with no listener (no ceremony mounted yet) is a harmless no-op. */
export const HSC_REPLAY_EVENT = 'ascent:heroceremony-replay';
export function requestCeremonyReplay(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HSC_REPLAY_EVENT));
}
