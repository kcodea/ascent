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

/** Identity-block LAYOUT knobs (owner ask 2026-08-21: "re-position the hero name and the play button").
 *  Reflected as `--hsc-*` CSS vars; heroCeremony.css carries fallbacks that MUST mirror these defaults
 *  (the ReplayRail convention — prod never sets the vars). Offsets ride `position: relative` left/top and
 *  size rides font-size / `zoom`, deliberately NOT transform: both elements' entrances animate transform
 *  (`hscRise`), and a static transform would be overwritten by the animation's fill. */
export interface HscLayout {
  /** Hero name — horizontal nudge (px) off center. */
  nameX: number;
  /** Hero name — vertical nudge (px); negative lifts it toward the portrait. */
  nameY: number;
  /** Hero name — font size (px). */
  nameSize: number;
  /** Start Game — horizontal nudge (px) off center. */
  btnX: number;
  /** Start Game — vertical nudge (px); negative lifts it. */
  btnY: number;
  /** Start Game — overall scale (×), text + padding together (CSS zoom). */
  btnScale: number;
}

/** One config object so the panel stays one panel: the timing keys flow into `setCeremonyTiming`, the
 *  layout keys into CSS vars — `apply()` routes by key. */
export type HscTunerConfig = HeroCeremonyTiming & HscLayout;

const LAYOUT_DEFAULTS: HscLayout = { nameX: 0, nameY: 0, nameSize: 44, btnX: 0, btnY: 0, btnScale: 1 };
const LAYOUT_KEYS = Object.keys(LAYOUT_DEFAULTS) as (keyof HscLayout)[];

export const HSC_DEFAULTS: HscTunerConfig = { ...HERO_CEREMONY_TIMING, ...LAYOUT_DEFAULTS };

/** Slider bounds — [min, max, step] per key. Wide enough to explore, bounded enough to stay a ceremony. */
export const HSC_RANGES: Record<keyof HscTunerConfig, [number, number, number]> = {
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
  nameX: [-400, 400, 1],
  nameY: [-300, 300, 1],
  nameSize: [20, 80, 1],
  btnX: [-400, 400, 1],
  btnY: [-200, 300, 1],
  btnScale: [0.6, 1.6, 0.01],
};

const KEY = 'ascent.heroceremony';

let cfg: HscTunerConfig = (() => {
  if (!import.meta.env.DEV) return { ...HSC_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...HSC_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HscTunerConfig>) : {}) };
  } catch {
    return { ...HSC_DEFAULTS };
  }
})();

/** Push the current config into what the ceremony reads: TIMING keys into the live override (defaults →
 *  clear it, so prod-parity is the resting state), LAYOUT keys onto :root as `--hsc-*` vars (dev only —
 *  prod renders the CSS fallbacks, which mirror LAYOUT_DEFAULTS). */
function apply(): void {
  const timingKeys = Object.keys(HERO_CEREMONY_TIMING) as (keyof HeroCeremonyTiming)[];
  const timingDefault = timingKeys.every((k) => cfg[k] === HERO_CEREMONY_TIMING[k]);
  const timing = Object.fromEntries(timingKeys.map((k) => [k, cfg[k]])) as unknown as HeroCeremonyTiming;
  setCeremonyTiming(timingDefault ? null : timing);
  if (import.meta.env.DEV && typeof document !== 'undefined') {
    const root = document.documentElement.style;
    for (const k of LAYOUT_KEYS) root.setProperty(`--hsc-${k.toLowerCase()}`, String(cfg[k]));
  }
}
if (import.meta.env.DEV) apply(); // saved values take effect on load, like every other tuner

export function getHeroCeremonyConfig(): HscTunerConfig {
  return cfg;
}

export function setHeroCeremonyValue(key: keyof HscTunerConfig, value: number): void {
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
