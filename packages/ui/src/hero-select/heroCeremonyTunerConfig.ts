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
  /** Hero power name — horizontal nudge (px) off center. */
  powerX: number;
  /** Hero power name — vertical nudge (px); negative lifts it toward the hero name. */
  powerY: number;
  /** Hero power name — font size (px). */
  powerSize: number;
  /** Start Game — horizontal nudge (px) off center. */
  btnX: number;
  /** Start Game — vertical nudge (px); negative lifts it. */
  btnY: number;
  /** Start Game — overall scale (×), text + padding together (CSS zoom). */
  btnScale: number;
}

/** Ceremony STINGERS (owner assets 2026-08-21: audio/ceremony/*) + the circular-portrait FLASH. Unlike the
 *  layout knobs these are read by the ceremony COMPONENT (scheduling + geometry math), not CSS — so they work
 *  in prod at their defaults with no var plumbing. Each sound: an on/off gate, a timeline mark (ms from the
 *  hero click, same clock as everything else) and a volume multiplier on the ceremony bus gain. */
export interface HscFx {
  /** asiansong.mp3 — the ceremonial sting. */
  songOn: number; songAtMs: number; songVol: number;
  /** woosh1.mp3 — the unselected cards yielding. */
  woosh1On: number; woosh1AtMs: number; woosh1Vol: number;
  /** woosh2.mp3 — the clone's travel/settle. */
  woosh2On: number; woosh2AtMs: number; woosh2Vol: number;
  /** ceremonyrevealsound.mp3 — the circular-portrait flash. */
  revealOn: number; revealAtMs: number; revealVol: number;
  /** When the FLASH fires: the portrait snaps circular inside the ring, the ring appears (ms from click). */
  flashAtMs: number;
  /** RING BURST 1 — arrival: bloom + one thin expanding ring + the small edge flash. */
  ring1On: number; ring1AtMs: number; ring1Ms: number;
  /** SPARKS — accent sparks + rune fragments off the card perimeter. */
  sparksOn: number; sparksAtMs: number; sparksMs: number;
  /** MOTES — the ambient hold (slow motes/wisps + the behind-portrait pulse), from here until launch. */
  motesOn: number; motesAtMs: number;
  /** LINE SWEEP — the light sweep gliding lower-left → upper-right across the artwork. */
  sweepOn: number; sweepAtMs: number; sweepMs: number;
  /** DUST — frame-boundary dissipation dust + fragments + brief inward wisps. */
  dustOn: number; dustAtMs: number; dustMs: number;
  /** RING BURST 2 — the finish ring contracting onto the hero (ambient thins after it). */
  ring2On: number; ring2AtMs: number; ring2Ms: number;
  /** Hero artwork (the materialized portrait) — offsets (px) + scale (×) on its computed final bounds. */
  portraitX: number; portraitY: number; portraitScale: number;
  /** The heroportrait ring image — offsets (px) off the portrait center + diameter (px). */
  ringX: number; ringY: number; ringSize: number;
}

/** One config object so the panel stays one panel: the timing keys flow into `setCeremonyTiming`, the
 *  layout keys into CSS vars — `apply()` routes by key. */
export type HscTunerConfig = HeroCeremonyTiming & HscLayout & HscFx;

// Owner-tuned 2026-08-21 (pill pass): a big 80px name + 22px power on the new dark plate, the button at
// 1.55×. The name offsets move the WHOLE plate (name + power ride inside it); power offsets move the power
// line within the plate.
const LAYOUT_DEFAULTS: HscLayout = { nameX: 0, nameY: -271, nameSize: 80, powerX: 0, powerY: -294, powerSize: 22, btnX: 0, btnY: -135, btnScale: 1.55 };

/** Owner-tuned 2026-08-21: song from the click, wooshes on the exits (100) and the settle (640), reveal +
 *  flash paired at 1320 — after the fast transform finishes (825+350) — with the art at 1.26× inside a big
 *  704px ring. */
const FX_DEFAULTS: HscFx = {
  songOn: 1, songAtMs: 0, songVol: 0.7,
  woosh1On: 1, woosh1AtMs: 100, woosh1Vol: 0.9,
  woosh2On: 1, woosh2AtMs: 640, woosh2Vol: 0.9,
  revealOn: 1, revealAtMs: 1280, revealVol: 1,
  flashAtMs: 1460,
  // Pixi cues, placed on the current shipped timeline: bursts on the settle, sweep + dust with the
  // transform (825), ring 2 paired with the flash.
  ring1On: 1, ring1AtMs: 880, ring1Ms: 520,
  sparksOn: 1, sparksAtMs: 880, sparksMs: 710,
  motesOn: 1, motesAtMs: 950,
  sweepOn: 1, sweepAtMs: 825, sweepMs: 420,
  dustOn: 1, dustAtMs: 825, dustMs: 850,
  ring2On: 1, ring2AtMs: 1320, ring2Ms: 380,
  portraitX: 0, portraitY: 0, portraitScale: 1.26,
  ringX: 0, ringY: 0, ringSize: 704,
};
const LAYOUT_KEYS = Object.keys(LAYOUT_DEFAULTS) as (keyof HscLayout)[];

export const HSC_DEFAULTS: HscTunerConfig = { ...HERO_CEREMONY_TIMING, ...LAYOUT_DEFAULTS, ...FX_DEFAULTS };

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
  powerX: [-400, 400, 1],
  powerY: [-300, 300, 1],
  powerSize: [10, 40, 1],
  btnX: [-400, 400, 1],
  btnY: [-200, 300, 1],
  btnScale: [0.6, 1.6, 0.01],
  songOn: [0, 1, 1], songAtMs: [0, 3000, 10], songVol: [0, 1, 0.01],
  woosh1On: [0, 1, 1], woosh1AtMs: [0, 3000, 10], woosh1Vol: [0, 1, 0.01],
  woosh2On: [0, 1, 1], woosh2AtMs: [0, 3000, 10], woosh2Vol: [0, 1, 0.01],
  revealOn: [0, 1, 1], revealAtMs: [0, 3000, 10], revealVol: [0, 1, 0.01],
  flashAtMs: [400, 2600, 10],
  ring1On: [0, 1, 1], ring1AtMs: [0, 3000, 10], ring1Ms: [120, 1500, 10],
  sparksOn: [0, 1, 1], sparksAtMs: [0, 3000, 10], sparksMs: [120, 1500, 10],
  motesOn: [0, 1, 1], motesAtMs: [0, 3000, 10],
  sweepOn: [0, 1, 1], sweepAtMs: [0, 3000, 10], sweepMs: [120, 1500, 10],
  dustOn: [0, 1, 1], dustAtMs: [0, 3000, 10], dustMs: [150, 2000, 10],
  ring2On: [0, 1, 1], ring2AtMs: [0, 3000, 10], ring2Ms: [120, 1500, 10],
  portraitX: [-400, 400, 1], portraitY: [-400, 400, 1], portraitScale: [0.5, 2, 0.01],
  ringX: [-400, 400, 1], ringY: [-400, 400, 1], ringSize: [120, 900, 2],
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
