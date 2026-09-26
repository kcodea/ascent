import { ANCIENTS } from '@game/sim';

/**
 * The ✦ Ancients tuner's values (DEV, proof of concept 2026-09-25).
 *
 * TWO kinds of value live here:
 *  · the METER's balance numbers (`cost` / `refresh` / `combat`) — handed to `enableAncients` when the Scene
 *    Builder starts a Set 3 run, and pushed into the live run when moved (so the sim stays the only authority:
 *    the UI never counts points itself);
 *  · the PRESENTATION dials (ring size / warm-up / timings / the awakening beat), read by the meter, the
 *    preview and the awakening.
 * Persisted in dev only; production always uses the defaults (it never reaches this system anyway: Ancients are
 * Scene Builder only).
 */
export interface AncientsConfig {
  /** Meter: points to fill it (awaken). */
  cost: number;
  /** Meter: points one Shop refresh adds. */
  refresh: number;
  /** Meter: points one combat adds. */
  combat: number;
  /** Ring: stroke thickness (design px). */
  ringWidth: number;
  /** Ring: gap between the hero-power button's edge and the ring (design px), so it never merges with the frame. */
  ringOffset: number;
  /** Ring: the empty track's colour. */
  trackColor: string;
  /** Ring: the empty track's opacity. */
  trackAlpha: number;
  /** Ring: the fill gradient's start (at the arc's tail). */
  fillFrom: string;
  /** Ring: the fill gradient's end (at the head). */
  fillTo: string;
  /** Ring: the leading-edge cap's size (× the ring width). 0 hides it. */
  capSize: number;
  /** Ring: quarter tick marks on the track (1 on, 0 off). */
  ticks: number;
  /** Fill: the arc's eased sweep when points are added (ms). */
  fillMs: number;
  /** Awaken: the full ring's flash before the Discover rises (ms). */
  flashMs: number;
  /** Awaken: Shop dim behind the Discover (opacity). */
  dim: number;
  /** Pick: the split reveal duration (ms). */
  splitMs: number;
  /** Pick: the shine sweep duration (ms). */
  shineMs: number;
  /** Sound: the fill tick's gain (0 mutes). */
  tickGain: number;
  /** Sound: the awaken / reveal cue's gain (0 mutes). */
  revealGain: number;
  /** Preview: the slide/fade IN on hover (ms). */
  pvInMs: number;
  /** Preview: the slide/fade OUT when the pointer leaves (ms). */
  pvOutMs: number;
  /** Preview: the grace before it starts leaving, so the pointer can cross from the ring to the card (ms). */
  pvGraceMs: number;
  /** Crack: where the split runs, % of the button width from the left. */
  crackX: number;
  /** Crack: how far each zig swings either side of the line, % of the button width. */
  crackJag: number;
  /** Crack: how many zig-zag segments top to bottom. */
  crackSegs: number;
  /** Crack: the bright edge's width (design px). 0 hides it. */
  crackEdge: number;
  /** Crack: the bright edge's opacity. */
  crackEdgeAlpha: number;
  /** Crack: the shadow along the crack's edge (opacity). */
  crackShadow: number;
  /** Crack: the one-shot "opens" draw on awakening (ms). 0 = no draw. */
  crackOpenMs: number;
}

/** Per-Ancient art fit for the hero-power half: offset (design px), scale (x), rotation (deg), and a crack-position
 *  nudge (% of the button) when the default split cuts the art badly. Keys: `<ancient><X|Y|S|R|Crack>`. */
export type AncientArtKey = `${'death' | 'fortune' | 'war' | 'genesis' | 'time'}${'X' | 'Y' | 'S' | 'R' | 'Crack'}`;
export const ANCIENT_ART_IDS = ['death', 'fortune', 'war', 'genesis', 'time'] as const;
export const ART_FIELDS = ['X', 'Y', 'S', 'R', 'Crack'] as const;
const ART_DEFAULTS = Object.fromEntries(
  ANCIENT_ART_IDS.flatMap((id) => ART_FIELDS.map((f) => [`${id}${f}`, f === 'S' ? 1 : 0])),
) as Record<AncientArtKey, number>;
export type AncientColorKey = `${'death' | 'fortune' | 'war' | 'genesis' | 'time'}Color`;
export type AncientsFullConfig = AncientsConfig & Record<AncientArtKey, number> & Record<AncientColorKey, string>;

export const ANCIENTS_DEFAULTS: AncientsFullConfig = {
  ...ART_DEFAULTS,
  ...(Object.fromEntries(ANCIENT_ART_IDS.map((id) => [`${id}Color`, ANCIENTS[id].color])) as Record<AncientColorKey, string>),
  cost: 16,
  refresh: 1,
  combat: 2,
  ringWidth: 12,
  ringOffset: 7,
  trackColor: '#241c3d',
  trackAlpha: 0.55,
  fillFrom: '#ffe36e',
  fillTo: '#ff8a1f',
  capSize: 1.25,
  ticks: 1,
  fillMs: 520,
  flashMs: 480,
  dim: 0.42,
  splitMs: 520,
  shineMs: 800,
  tickGain: 0.5,
  revealGain: 0.8,
  pvInMs: 180,
  pvOutMs: 110,
  pvGraceMs: 80,
  crackX: 50,
  crackJag: 4.5,
  crackSegs: 9,
  crackEdge: 2,
  crackEdgeAlpha: 0.9,
  crackShadow: 0.45,
  crackOpenMs: 420,
};

type NumKey = { [K in keyof AncientsFullConfig]: AncientsFullConfig[K] extends number ? K : never }[keyof AncientsFullConfig];
export type AncientsNumKey = NumKey;
export type AncientsColorKey = Exclude<keyof AncientsFullConfig, NumKey>;

export const ANCIENTS_RANGES: Record<NumKey, [number, number, number]> = {
  cost: [1, 40, 1],
  refresh: [0, 8, 1],
  combat: [0, 16, 1],
  ringWidth: [2, 30, 0.5],
  ringOffset: [0, 30, 0.5],
  trackAlpha: [0, 1, 0.01],
  capSize: [0, 2.5, 0.05],
  ticks: [0, 1, 1],
  fillMs: [0, 1600, 10],
  flashMs: [0, 1500, 10],
  dim: [0, 0.9, 0.01],
  splitMs: [120, 1600, 10],
  shineMs: [0, 2000, 10],
  tickGain: [0, 1, 0.01],
  revealGain: [0, 1, 0.01],
  pvInMs: [0, 600, 10],
  pvOutMs: [0, 400, 10],
  pvGraceMs: [0, 400, 10],
  crackX: [20, 80, 0.5],
  crackJag: [0, 20, 0.25],
  crackSegs: [2, 20, 1],
  crackEdge: [0, 8, 0.25],
  crackEdgeAlpha: [0, 1, 0.01],
  crackShadow: [0, 1, 0.01],
  crackOpenMs: [0, 1500, 10],
  ...(Object.fromEntries(ANCIENT_ART_IDS.flatMap((id) => [
    [`${id}X`, [-80, 80, 0.5]], [`${id}Y`, [-80, 80, 0.5]], [`${id}S`, [0.3, 3, 0.01]], [`${id}R`, [-180, 180, 0.5]], [`${id}Crack`, [-30, 30, 0.5]],
  ])) as Record<AncientArtKey, [number, number, number]>),
};

const KEY = 'ascent.ancients';
let cfg: AncientsFullConfig = (() => {
  if (!import.meta.env.DEV) return { ...ANCIENTS_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...ANCIENTS_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<AncientsFullConfig>) : {}) };
  } catch {
    return { ...ANCIENTS_DEFAULTS };
  }
})();

const listeners = new Set<() => void>();
export function getAncientsConfig(): AncientsFullConfig { return cfg; }
export function subscribeAncientsConfig(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function setAncientsValue(key: keyof AncientsFullConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}
export function resetAncientsConfig(): void {
  cfg = { ...ANCIENTS_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}

/** The meter tuning handed to `enableAncients`. */
export function ancientMeterOverride(): { cost: number; refresh: number; combat: number } {
  return { cost: cfg.cost, refresh: cfg.refresh, combat: cfg.combat };
}

/** The Ancient's colour — the tuner's override, else the sim's colour table. */
export function ancientColor(id: string): string {
  return (cfg as unknown as Record<string, string>)[`${id}Color`] ?? '#c8922e';
}
