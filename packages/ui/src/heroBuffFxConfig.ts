/**
 * Tunable parameters for the HERO BUFF FLASH — a shard/blast pop with a small eased ripple over the hero
 * portrait whenever ANY run buff grows (spell power, a tribe aura, max Gold, …). Owner ask 2026-07-21.
 *
 * Unlike the Pixi FX tuners this one drives a pure-CSS one-shot: the values reflect to `--hbf-*` CSS vars
 * that `.herobuff-blast` reads, and the animation is transform/opacity only (a profiled one-shot, so it may
 * touch paint — it never loops, so it never repaints at rest). Same trio shape as the others: DEV-persisted,
 * dialed via the "💥 Hero Buff Flash" tuner, read live off the CSS vars.
 */
export interface HeroBuffFxConfig {
  rippleScale: number;   // × — how far the ring expands (1 = the portrait's 60% base size)
  rippleMs: number;      // ms — the ring's expand + fade
  rippleWidth: number;   // px — the ring's stroke
  shardScale: number;    // × — how far the shard burst expands
  shardMs: number;       // ms — the shard burst's flash + fade
  shardRotate: number;   // deg — total rotation across the shard burst
  shardSpokes: number;   // number of shard spokes (the conic burst's slices)
  peakAlpha: number;     // 0..1 — brightness of the shards at their peak
  colorCore: string;     // the flash colour (mixed toward white at the core)
}

const DEFAULTS: HeroBuffFxConfig = {
  rippleScale: 1.5,
  rippleMs: 620,
  rippleWidth: 3,
  shardScale: 1.15,
  shardMs: 460,
  shardRotate: 24,
  shardSpokes: 8,
  peakAlpha: 1,
  colorCore: '#f4be35',
};

export const HEROBUFFFX_KEYS = [
  'rippleScale', 'rippleMs', 'rippleWidth',
  'shardScale', 'shardMs', 'shardRotate', 'shardSpokes',
  'peakAlpha', 'colorCore',
] as const satisfies readonly (keyof HeroBuffFxConfig)[];

export const HEROBUFFFX_COLOR_KEYS: (keyof HeroBuffFxConfig)[] = ['colorCore'];

export const HEROBUFFFX_RANGES: Partial<Record<keyof HeroBuffFxConfig, [number, number, number]>> = {
  rippleScale: [1, 3, 0.05], rippleMs: [120, 1600, 20], rippleWidth: [1, 12, 0.5],
  shardScale: [0.6, 2.5, 0.05], shardMs: [120, 1200, 20], shardRotate: [0, 90, 1], shardSpokes: [3, 16, 1],
  peakAlpha: [0, 1, 0.02],
};

const KEY = 'ascent.heroBuffFx';

let cfg: HeroBuffFxConfig = load();

function load(): HeroBuffFxConfig {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<HeroBuffFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getHeroBuffFxConfig(): HeroBuffFxConfig {
  return cfg;
}
export function setHeroBuffFxValue(key: keyof HeroBuffFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  reflect();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetHeroBuffFxConfig(): void {
  cfg = { ...DEFAULTS };
  reflect();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Push the config to the `--hbf-*` CSS vars `.herobuff-blast` reads. Called once at boot (so a DEV-persisted
 *  config applies) and on every tuner edit (so the NEXT flash reflects it). Production renders DEFAULTS, which
 *  the CSS fallbacks already MIRROR, so this is a no-op-safe convenience there. */
export function reflect(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--hbf-ripple-scale', String(cfg.rippleScale));
  r.setProperty('--hbf-ripple-ms', `${cfg.rippleMs}ms`);
  r.setProperty('--hbf-ripple-width', String(cfg.rippleWidth));
  r.setProperty('--hbf-shard-scale', String(cfg.shardScale));
  r.setProperty('--hbf-shard-ms', `${cfg.shardMs}ms`);
  r.setProperty('--hbf-shard-rotate', `${cfg.shardRotate}deg`);
  r.setProperty('--hbf-spokes', String(cfg.shardSpokes));
  r.setProperty('--hbf-peak-alpha', String(cfg.peakAlpha));
  r.setProperty('--hbf-color', cfg.colorCore);
  // The conic shard gradient — one bright spoke per slice, N slices from the dial. Built here (not in CSS)
  // because a gradient's stop COUNT can't be a CSS var. Uses the same color-mix as the fallback so the tuned
  // and default looks match.
  const spokes = Math.max(3, Math.round(cfg.shardSpokes));
  const seg = 360 / spokes;
  const spokeDeg = Math.min(seg * 0.35, 8); // bright arc width per spoke, capped so many spokes stay crisp
  const bright = `color-mix(in srgb, ${cfg.colorCore} 90%, #fff)`;
  const stops: string[] = [];
  for (let i = 0; i < spokes; i++) {
    const a = i * seg;
    stops.push(`${bright} ${a}deg ${a + spokeDeg}deg`, `transparent ${a + spokeDeg}deg ${a + seg}deg`);
  }
  r.setProperty('--hbf-shard-gradient', `conic-gradient(from 0deg, ${stops.join(', ')})`);
}

// Apply the DEV-persisted (or default) config to the CSS vars at module load, like `applyRefreshVars`.
reflect();
