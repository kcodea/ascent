/**
 * Tunable parameters for the HERO AIM FX (owner redesign 2026-07-16) — the two halves of "using a power":
 *
 * 1. THE AIM LINE — the targeting line from the hero-power diamond (and targeted Battlecries / spells) to
 *    the cursor. Replaces the old dotted SVG dash: a CONTINUOUS curved ribbon with life — a soft breathing
 *    glow under a bright core, a subtle time-based wobble, and a per-aim RANDOM arch (each new aim rolls
 *    its bow side + amplitude, so the curve is never the same twice). Drawn per frame in the Pixi overlay.
 *
 * 2. THE ACTIVATION BURST — when a hero power fires: a simple radial spray of sparks in all directions
 *    from the diamond.
 *
 * Same trio pattern as the other FX configs: dev-persisted, dialed via the "🎯 Hero Aim FX" tuner,
 * DEFAULTS are the shipped look. `getAimFxConfig()` is read live (the line re-reads every frame).
 */
export interface AimFxConfig {
  coreWidth: number;   // px — the line's bright core
  coreAlpha: number;   // 0..1
  glowWidth: number;   // px — soft underlay added around the core
  glowAlpha: number;   // 0..1 — the aura's PEAK alpha (it breathes below this)
  curve: number;       // base arch (fraction of the aim's length)
  curveVar: number;    // 0..1 — per-aim randomness on the arch (0 = the same bow every time)
  wobbleAmp: number;   // px — the living wobble along the line
  wobbleSpeed: number; // wobble cycles per second
  breathe: number;     // 0..1 — how deeply the glow's alpha breathes (0 = steady)
  dotSize: number;     // px — the cursor-end dot (grows ×1.6 when hovering a valid target)
  colorCore: string;
  colorGlow: string;
  burstCount: number;  // activation sparks (0 = off)
  burstSpeed: number;  // px/s — outward spark speed
  burstSize: number;   // px — spark size
  burstLife: number;   // ms — spark lifetime
  colorBurst: string;
}

// Owner-tuned in the 🎯 tuner (2026-07-16): a bold 11.5px ribbon with a strong breathing aura, a deep
// 0.48 arch (±0.45 randomness), no wobble — and a dense fast burst of 60 fine sparks.
const DEFAULTS: AimFxConfig = {
  coreWidth: 11.5,
  coreAlpha: 0.95,
  glowWidth: 10,
  glowAlpha: 0.85,
  curve: 0.48,
  curveVar: 0.45,
  wobbleAmp: 0,
  wobbleSpeed: 2.2,
  breathe: 0.65,
  dotSize: 18,
  colorCore: '#ffd9a0',
  colorGlow: '#ffa82e',
  burstCount: 60,
  burstSpeed: 660,
  burstSize: 3,
  burstLife: 1420,
  colorBurst: '#ffa985',
};

export const AIMFX_KEYS = [
  'coreWidth', 'coreAlpha', 'glowWidth', 'glowAlpha',
  'curve', 'curveVar', 'wobbleAmp', 'wobbleSpeed', 'breathe', 'dotSize',
  'colorCore', 'colorGlow',
  'burstCount', 'burstSpeed', 'burstSize', 'burstLife', 'colorBurst',
] as const satisfies readonly (keyof AimFxConfig)[];

export const AIMFX_COLOR_KEYS: (keyof AimFxConfig)[] = ['colorCore', 'colorGlow', 'colorBurst'];

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const AIMFX_RANGES: Partial<Record<keyof AimFxConfig, [number, number, number]>> = {
  coreWidth: [1, 12, 0.5], coreAlpha: [0, 1, 0.05], glowWidth: [0, 40, 1], glowAlpha: [0, 1, 0.05],
  curve: [0, 0.6, 0.02], curveVar: [0, 1, 0.05], wobbleAmp: [0, 30, 1], wobbleSpeed: [0, 5, 0.1],
  breathe: [0, 1, 0.05], dotSize: [0, 30, 1],
  burstCount: [0, 60, 1], burstSpeed: [50, 1200, 10], burstSize: [2, 24, 1], burstLife: [100, 1500, 10],
};

const KEY = 'ascent.aimfx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: AimFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<AimFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getAimFxConfig(): AimFxConfig {
  return cfg;
}
export function setAimFxValue(key: keyof AimFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetAimFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
