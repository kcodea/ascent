/**
 * Tunable look + physics for the end-of-turn CRYSTAL FUSE (the Charge Glyph's look since 2026-10-26: a blue
 * crystal fuse burns left→right along the board midline into the End Turn gem; the debris is a seeded force
 * simulation, `fuseSim.ts`, drawn by `fuseRender.ts`). Dev Menu → Crystal Fuse (`CrystalFuseTuner.tsx`).
 *
 * Same persistence convention as `endTurnConfig.ts`: overrides are DEV-only (localStorage); production always
 * renders `FUSE_DEFAULTS`. Every distance is in STAGE px (the 1920×1080 design space).
 *
 * Force ramp: every force is `base × forceRamp(cfg, charge)`, where
 * `forceRamp = (rampFloor + (1 − rampFloor) × charge^rampPow) × aggression` — calm at 20 s, frantic at 0:00.
 */
export interface FuseCfg {
  /** Master: scales every force's ramp (0..2). */
  aggression: number;
  /** Ramp curve exponent (>1 = holds back, then surges late). */
  rampPow: number;
  /** Share (0..1) of each force already present at charge 0. */
  rampFloor: number;
  /** px/s² constant-magnitude pull toward the gem. */
  pull: number;
  /** px/s² tangential push at `vortexR`. */
  vortex: number;
  /** px radius where the vortex is at full strength; falls off as vortexR / max(d, vortexR/4). */
  vortexR: number;
  /** px/s² layered-sine turbulence. */
  turbulence: number;
  /** Spatial frequency of the turbulence field. */
  turbScale: number;
  /** Per-second velocity retention (0..1), applied as drag^dt. */
  drag: number;
  /** Shard mass (≥1): heavier = swings wider, orbits longer. */
  shardMass: number;
  /** Mote mass (light = darts straight in). */
  moteMass: number;
  /** Particles spawned over the whole fuse (charge 0→1). */
  spawnPerFuse: number;
  /** Share (0..1) of spawns that are crystal shards. */
  shardShare: number;
  /** px/s launch speed off the burning front, and its ± variance (0..1). */
  spawnSpeed: number;
  spawnSpeedVar: number;
  /** px sizes and ± variance (0..1). */
  shardSize: number;
  moteSize: number;
  sizeVar: number;
  /** Seconds a particle lives (it also dies on absorb), and ± variance (0..1). */
  life: number;
  lifeVar: number;
  /** Hard cap on live particles. */
  maxLive: number;
  /** px: inside this a particle is drawn over the End Turn button instead of behind the cards. */
  captureR: number;
  /** px: inside this a particle is absorbed by the gem. */
  absorbR: number;
  /** px/s² pull during the 0:00 collapse. */
  collapsePull: number;
  /** Particles left orbiting during the 0:00 → End Turn wait. */
  idleOrbiters: number;
  /** px/s calm orbit speed during the 0:00 → End Turn wait. */
  idleVortex: number;
  /** Gem glow peak alpha and radius (px). */
  gemGlow: number;
  gemGlowSize: number;
  /** % soft edge of the burning front. */
  burnFeather: number;
  /** Front glow opacity (0..1) and width (px). */
  frontGlow: number;
  frontGlowW: number;
  /** Front-glow multiplier as the front crosses a bright seam (1 = no seam flare). */
  seamBoost: number;
  /** Early End Turn flash-and-fade length (ms; owner: very quick). */
  flashOutMs: number;
  /** Brightness multiplier of that flash. */
  flashOutPeak: number;
  colorShard: string;
  colorMote: string;
  colorHot: string;
  colorGem: string;
}

export const FUSE_DEFAULTS: FuseCfg = {
  aggression: 1,
  rampPow: 1.8,
  rampFloor: 0.3,
  pull: 600,
  vortex: 520,
  vortexR: 70,
  turbulence: 140,
  turbScale: 0.018,
  drag: 0.35,
  shardMass: 2.4,
  moteMass: 0.6,
  spawnPerFuse: 1400,
  shardShare: 0.35,
  spawnSpeed: 90,
  spawnSpeedVar: 0.6,
  shardSize: 7,
  moteSize: 4,
  sizeVar: 0.5,
  life: 8,
  lifeVar: 0.4,
  maxLive: 700,
  captureR: 90,
  absorbR: 14,
  collapsePull: 1600,
  idleOrbiters: 10,
  idleVortex: 60,
  gemGlow: 0.9,
  gemGlowSize: 90,
  burnFeather: 2.5,
  frontGlow: 0.85,
  frontGlowW: 46,
  seamBoost: 1.8,
  flashOutMs: 180,
  flashOutPeak: 2.4,
  colorShard: '#5fb8ff',
  colorMote: '#9fe6ff',
  colorHot: '#f2fbff',
  colorGem: '#7fd4ff',
};

/** The bright-seam x positions of `crystal-fuse.png`, as fractions of its width (measured from its brightest
 *  columns, 2026-10-26). The burning front flares as it crosses one (`seamBoost`). */
export const FUSE_SEAMS: readonly number[] = [
  0.083, 0.136, 0.199, 0.269, 0.354, 0.441, 0.527, 0.625, 0.712, 0.749, 0.811, 0.89, 0.951,
];

/** Where the crystal starts and ends inside `crystal-fuse.png` (x fractions of its width): the burn runs tip to tip. */
export const FUSE_ART_SPAN: readonly [number, number] = [0.027, 0.971];

/** Front-glow multiplier at burn position `x` (image fraction): `seamBoost` at a seam, easing to 1 over ±2%. */
export function seamBoostAt(c: FuseCfg, x: number): number {
  let near = 1;
  for (const s of FUSE_SEAMS) near = Math.min(near, Math.abs(x - s));
  const w = 0.02;
  return near >= w ? 1 : 1 + (c.seamBoost - 1) * (1 - near / w);
}

/** Seed control for the tuner's "Lock seed" toggle: a number replays one look; null = fresh per light. */
export const fuseSeed: { locked: number | null } = { locked: null };

/** Fired on `window` whenever a value changes, so a lit fuse re-reads its config live. */
export const FUSE_CFG_EVENT = 'ascent:fusecfg';

const KEY = 'ascent.crystalFuse';
let cfg: FuseCfg = (() => {
  if (!import.meta.env.DEV) return { ...FUSE_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...FUSE_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<FuseCfg>) : {}) };
  } catch {
    return { ...FUSE_DEFAULTS };
  }
})();

function notify(): void {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new Event(FUSE_CFG_EVENT)); } catch { /* ignore */ }
}

export function getFuseCfg(): FuseCfg {
  return cfg;
}

export function setFuseValue(key: keyof FuseCfg, v: number | string): void {
  cfg = { ...cfg, [key]: v };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  notify();
}

export function resetFuseCfg(): void {
  cfg = { ...FUSE_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  notify();
}

/** The force multiplier at `charge` (0..1). */
export function forceRamp(c: FuseCfg, charge: number): number {
  const p = Math.min(1, Math.max(0, charge));
  return (c.rampFloor + (1 - c.rampFloor) * Math.pow(p, c.rampPow)) * c.aggression;
}
