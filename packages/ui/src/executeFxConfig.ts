/**
 * Tunable parameters for the EXECUTION STRIKE — the one-shot Pixi flourish when an Execute (`V`) minion procs
 * and destroys what it damaged. Fires at the VICTIM's slot on the `{ type: 'poison' }` combat event, via the
 * choreo `executeFx` cue on the `poisonTick` moment.
 *
 * The persistent red rage aura on the card is a separate, CSS-only thing (`executeConfig.ts`) — Pixi is
 * reserved for this moment, per the CSS-for-persistence / Pixi-for-moments split that keeps auras from
 * fighting `syncShields`.
 *
 * THE LOOK (owner reference: a MOBA "EXECUTION STRIKE" crescent): a big curved slash that expands and rotates
 * as it fades, a hot core flash under it, embers flung along the cut, and heavy dark-red blood droplets that
 * arc and fall. The crescent is a BAKED texture drawn as many short arc segments, which is what lets it carry
 * both a TAPER (fine tail → swell → drawn-out point) and a GRADIENT along its path (crimson → orange →
 * white-hot tip) in a single sprite. That texture is cached and only re-baked when a shape/colour dial
 * changes, so the per-proc cost is just the sprite spawns.
 *
 * Dialled via the DEV "🩸 Execute Strike" tuner, which has a Test button (`pixiFx.testExecute()`) so the look
 * can be iterated without finding a real proc. `getExecuteFxConfig()` is read at FIRE TIME, so an edit applies
 * to the next strike with no reload. DEV-only persistence — production always ships DEFAULTS.
 */
export interface ExecuteFxConfig {
  /** Overall size multiplier for the whole flourish. */
  power: number;

  // ---- the crescent slash ----
  /** How many crescents per strike (1 = a single clean cut; 2–3 = a flurry of cuts). */
  arcCount: number;
  /** Crescent width (px) at spawn. */
  arcSize: number;
  /** End scale × the spawn size — the expansion as it fades. */
  arcGrow: number;
  /** Lifetime (ms). */
  arcLife: number;
  /** Base tilt (°) of the cut. */
  arcTilt: number;
  /** Random tilt variance (°) between crescents. */
  arcSpread: number;
  /** Rotation over the crescent's life (°/s) — the sweep. */
  arcSpin: number;
  /** Peak opacity (0–1). */
  arcAlpha: number;
  /** How much of a circle the crescent spans (°) — its length. */
  arcSweep: number;
  /** Peak stroke width (px) of the baked crescent — how fat the cut swells in the middle. */
  arcThick: number;

  // ---- the hot core flash under the cut ----
  /** Flash diameter (px). 0 = off. */
  flashSize: number;
  /** Flash lifetime (ms). */
  flashLife: number;
  /** Flash opacity (0–1). */
  flashAlpha: number;

  // ---- embers flung along the cut ----
  /** Ember count. 0 = off. */
  emberCount: number;
  /** Launch speed (px/s). */
  emberSpeed: number;
  /** Ember size (px). */
  emberSize: number;
  /** Ember lifetime (ms). */
  emberLife: number;
  /** Cone the embers spray across (°). */
  emberSpread: number;
  /** Downward pull (px/s²). */
  emberGravity: number;

  // ---- blood droplets ----
  /** Droplet count. 0 = off. */
  bloodCount: number;
  /** Launch speed (px/s). */
  bloodSpeed: number;
  /** Droplet size (px). */
  bloodSize: number;
  /** Droplet lifetime (ms). */
  bloodLife: number;
  /** Cone the spray covers (°). */
  bloodSpread: number;
  /** Downward pull (px/s²) — heavier than the embers so the blood arcs and falls. */
  bloodGravity: number;

  // ---- palette ----
  /** Crescent TAIL colour — the dark start of the cut. */
  tailColor: string;
  /** Crescent MID colour — the hot body. */
  midColor: string;
  /** Crescent TIP colour — the white-hot leading point. */
  tipColor: string;
  /** Core flash colour. */
  flashColor: string;
  /** Ember colour. */
  emberColor: string;
  /** Blood droplet colour. */
  bloodColor: string;
}

/**
 * Starting values, aimed at the owner's reference: one dominant crescent with a second lighter cut crossing it,
 * a tight hot flash, a spray of embers along the cut, and heavier blood arcing away. Not owner-dialled yet —
 * these are a considered first pass to tune from via the 🩸 Execute Strike tuner's Test button.
 */
const DEFAULTS: ExecuteFxConfig = {
  power: 1,

  arcCount: 2,
  arcSize: 170,
  arcGrow: 1.55,
  arcLife: 420,
  arcTilt: -28,
  arcSpread: 46,
  arcSpin: 95,
  arcAlpha: 1,
  arcSweep: 140,
  arcThick: 17,

  flashSize: 120,
  flashLife: 260,
  flashAlpha: 0.85,

  emberCount: 22,
  emberSpeed: 430,
  emberSize: 6,
  emberLife: 620,
  emberSpread: 120,
  emberGravity: 260,

  bloodCount: 16,
  bloodSpeed: 300,
  bloodSize: 7,
  bloodLife: 780,
  bloodSpread: 150,
  bloodGravity: 900,

  tailColor: '#8e0b18',
  midColor: '#ff5a1e',
  tipColor: '#fff3e6',
  flashColor: '#ff8a4c',
  emberColor: '#ff9a3c',
  bloodColor: '#9e0d1c',
};

export const EXECUTEFX_COLOR_KEYS = [
  'tailColor', 'midColor', 'tipColor', 'flashColor', 'emberColor', 'bloodColor',
] as const satisfies readonly (keyof ExecuteFxConfig)[];

export type ExecuteFxNumKey = Exclude<keyof ExecuteFxConfig, (typeof EXECUTEFX_COLOR_KEYS)[number]>;

export const EXECUTEFX_RANGES: Record<ExecuteFxNumKey, [number, number, number]> = {
  power: [0.2, 3, 0.05],
  arcCount: [0, 6, 1],
  arcSize: [20, 420, 5],
  arcGrow: [0.5, 3, 0.05],
  arcLife: [80, 1600, 20],
  arcTilt: [-180, 180, 2],
  arcSpread: [0, 180, 2],
  arcSpin: [-720, 720, 5],
  arcAlpha: [0, 1, 0.02],
  arcSweep: [20, 320, 5],
  arcThick: [1, 60, 0.5],
  flashSize: [0, 400, 5],
  flashLife: [60, 1200, 20],
  flashAlpha: [0, 1, 0.02],
  emberCount: [0, 60, 1],
  emberSpeed: [0, 900, 10],
  emberSize: [1, 24, 0.5],
  emberLife: [80, 1600, 20],
  emberSpread: [0, 360, 5],
  emberGravity: [0, 1200, 20],
  bloodCount: [0, 60, 1],
  bloodSpeed: [0, 900, 10],
  bloodSize: [1, 24, 0.5],
  bloodLife: [80, 2000, 20],
  bloodSpread: [0, 360, 5],
  bloodGravity: [0, 2000, 20],
};

export const EXECUTEFX_KEYS = Object.keys(DEFAULTS).filter(
  (k) => !(EXECUTEFX_COLOR_KEYS as readonly string[]).includes(k),
) as ExecuteFxNumKey[];

/** Tuner grouping — every numeric key appears in exactly one group (enforced by test). */
export const EXECUTEFX_GROUPS: { title: string; keys: ExecuteFxNumKey[] }[] = [
  { title: 'Overall', keys: ['power'] },
  { title: 'Crescent slash', keys: ['arcCount', 'arcSize', 'arcGrow', 'arcLife', 'arcTilt', 'arcSpread', 'arcSpin', 'arcAlpha', 'arcSweep', 'arcThick'] },
  { title: 'Core flash', keys: ['flashSize', 'flashLife', 'flashAlpha'] },
  { title: 'Embers', keys: ['emberCount', 'emberSpeed', 'emberSize', 'emberLife', 'emberSpread', 'emberGravity'] },
  { title: 'Blood', keys: ['bloodCount', 'bloodSpeed', 'bloodSize', 'bloodLife', 'bloodSpread', 'bloodGravity'] },
];

export const EXECUTEFX_COLOR_GROUPS: { title: string; keys: (typeof EXECUTEFX_COLOR_KEYS)[number][] }[] = [
  { title: 'Colours', keys: ['tailColor', 'midColor', 'tipColor', 'flashColor', 'emberColor', 'bloodColor'] },
];

/** The dials the BAKED crescent texture depends on. Changing any of these has to invalidate the cached bake;
 *  everything else (counts, speeds, lifetimes) only affects spawning and is free. */
export function executeCrescentKey(c: ExecuteFxConfig): string {
  return `${c.arcSweep}|${c.arcThick}|${c.tailColor}|${c.midColor}|${c.tipColor}`;
}

/** Blend two 0xRRGGBB colours per channel. */
function lerpHex(a: number, b: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * k);
  return (r << 16) | (g << 8) | bl;
}
function hexNum(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? 0xffffff : n;
}

/** One drawn slice of the baked crescent. */
export interface CrescentSegment {
  /** Start / end angle (radians). */
  a0: number;
  a1: number;
  /** Stroke width (px). */
  width: number;
  /** 0xRRGGBB. */
  color: number;
  /** 0–1. */
  alpha: number;
}

/** Nominal width (px) the crescent is baked at. Dividing the configured `arcSize` by this turns the dial into
 *  honest on-screen pixels — the same trick the Flurry slash uses with its 80px crescent. */
export const EXEC_CRESCENT_TEX_W = 200;

/** How many slices the crescent is chopped into. More = smoother taper/gradient, at bake time only. */
const CRESCENT_SEGMENTS = 56;

/** How much wider the soft bloom underlay is than the blade itself. */
const CRESCENT_BLOOM_MUL = 2.6;

/**
 * The crescent's geometry, as a list of short arc segments — extracted from the Pixi bake so the (fiddly)
 * taper + gradient maths is testable without a renderer.
 *
 * Drawing many short segments rather than one stroke is what buys both properties a single stroke can't have
 * at once:
 *   - a TAPER along the path: each segment carries its own width, so the cut opens as a fine hairline, swells
 *     through the body, and draws back out to a point at the tip
 *   - a GRADIENT along the path: each segment carries its own colour, ramping tail → mid → tip (crimson →
 *     orange → white-hot), with a rising alpha so the tail fades in rather than starting abruptly
 *
 * `bloom: true` returns the wide, faint underlay pass that gives the blade its own glow; the caller draws that
 * first, then the sharp pass over it.
 */
export function executeCrescentSegments(c: ExecuteFxConfig, bloom = false): CrescentSegment[] {
  const sweep = (c.arcSweep * Math.PI) / 180;
  const a0 = -Math.PI / 2 - sweep / 2; // centred on "up", so the tilt dial reads naturally
  const tail = hexNum(c.tailColor), mid = hexNum(c.midColor), tip = hexNum(c.tipColor);
  const out: CrescentSegment[] = [];
  for (let i = 0; i < CRESCENT_SEGMENTS; i++) {
    const t0 = i / CRESCENT_SEGMENTS, t1 = (i + 1) / CRESCENT_SEGMENTS;
    const t = (t0 + t1) / 2;
    // taper, skewed (the pow) so the swell sits past the middle and the tip draws out to a long fine point
    const shape = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 1.35);
    const width = c.arcThick * shape * (bloom ? CRESCENT_BLOOM_MUL : 1);
    if (width < 0.35) continue; // sub-pixel slivers at the very ends aren't worth a draw call
    const color = t < 0.55 ? lerpHex(tail, mid, t / 0.55) : lerpHex(mid, tip, (t - 0.55) / 0.45);
    out.push({
      a0: a0 + sweep * t0,
      a1: a0 + sweep * t1,
      width,
      color,
      alpha: (bloom ? 0.16 : 0.95) * Math.min(1, 0.25 + t * 1.5),
    });
  }
  return out;
}

/**
 * The radius the crescent is drawn at.
 *
 * Must leave room for HALF the fattest stroke — and the fattest stroke is the BLOOM pass, not the blade. Sizing
 * off `arcThick` alone put the glow ~5px outside the texture at the shipped thickness, clipping it to a hard
 * straight edge (caught by the geometry test, not by eye — the bake is invisible until it renders).
 */
export function executeCrescentRadius(c: ExecuteFxConfig): number {
  return Math.max(8, EXEC_CRESCENT_TEX_W / 2 - (c.arcThick * CRESCENT_BLOOM_MUL) / 2);
}

const KEY = 'ascent.executeFx';

let cfg: ExecuteFxConfig = load();

function load(): ExecuteFxConfig {
  // DEV-only persistence, matching every other FX tuner: production always renders DEFAULTS, so a dialled-in
  // localStorage on a dev machine can never leak into what players see.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ExecuteFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getExecuteFxConfig(): ExecuteFxConfig {
  return cfg;
}
export function getExecuteFxDefaults(): ExecuteFxConfig {
  return { ...DEFAULTS };
}
export function executeFxOverrides(): (keyof ExecuteFxConfig)[] {
  return (Object.keys(DEFAULTS) as (keyof ExecuteFxConfig)[]).filter((k) => cfg[k] !== DEFAULTS[k]);
}
export function setExecuteFxValue(key: keyof ExecuteFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetExecuteFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
