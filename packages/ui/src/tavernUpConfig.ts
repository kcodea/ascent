/**
 * Tunable look for the standalone TAVERN UP stone button (`TavernUpButton.tsx`) — the carved rock medallion
 * (frames/tavernup_base.webp) with the blue arrow gem seated in its gold ring and 1–6 lit slot pips showing the
 * CURRENT tavern tier. Replaces the plain "Upgrade Tavern" plaque in the shop tray; same reducer wiring
 * (dispatch {type:'upgrade'}), stage-pinned like the End Turn diamond.
 *
 * Layer geometry baked from the source art (see the conversion notes in the devlog):
 *   - base trimmed 1149×1126 → 512×502 webp; the gem HOLE centre sits at (52.56%, 48.93%) of the base,
 *     diameter 27.7% of its width. The gem art is 28.1% — it seats UNDER the base so the ring overlaps its rim.
 *   - the 6 tier-pip crops were centroid-aligned onto ONE shared canvas (pip 1 anchored), 71.63% of the base's
 *     width — so a single position/scale seats every tier identically.
 *
 * Dial groups (🍺 tuner): POSITION/SCALE · GEM seat · PIPS seat · COST badge seat · GLOW (hover halo hugging
 * the gem silhouette — stacked drop-shadow, breath = opacity only) · SHEEN sweep · STRIKE (press flash +
 * dust + shockwave ring) · disabled ART DIM. Config is localStorage-persisted in DEV only; production always
 * renders DEFAULTS (Layout Lab convention). Values reflect to `--tvb-*` CSS vars — the styles.css fallbacks
 * MUST mirror DEFAULTS (update both when baking Kevin/Mike-tuned values).
 */
export interface TavernUpConfig {
  /** Position — px offset from the stage-pinned base point (board's left-middle), × --scale. +x → right. */
  x: number;
  /** Position — px offset from the base point, × --scale. +y → down. */
  y: number;
  /** Overall button scale (×). The base art renders 128 design-px wide before this. */
  scale: number;
  /** Gem seat — nudge x (design px × --u) off the measured hole centre. */
  gemX: number;
  /** Gem seat — nudge y (design px × --u). */
  gemY: number;
  /** Gem size (× the measured hole fit). */
  gemS: number;
  /** Pips seat — nudge x (design px × --u) off the default arc position. */
  pipX: number;
  /** Pips seat — nudge y (design px × --u). */
  pipY: number;
  /** Pips size (× the art-true fit to the base's slots). */
  pipS: number;
  /** Cost badge — nudge x (design px × --u) from the button centre. */
  costX: number;
  /** Cost badge — nudge y (design px × --u). */
  costY: number;
  /** Cost badge size (×). */
  costS: number;
  /** Glow — blur radius (px) of each drop-shadow pass. */
  glowBlur: number;
  /** Glow — peak opacity (0–1). 0 disables the hover glow. */
  glowAlpha: number;
  /** Glow — drop-shadow stack count. 1 = soft halo, higher = hot rim. */
  glowStrength: number;
  /** Glow — breathing speed: seconds per pulse cycle. 0 = steady. */
  glowPulse: number;
  /** Glow — breath depth: eases between peak and peak×(1−depth). */
  glowPulseDepth: number;
  /** Glow — alignment nudge x (design px × --u) within the gem box. */
  glowX: number;
  /** Glow — alignment nudge y (design px × --u). */
  glowY: number;
  /** Glow — width fit (×). */
  glowW: number;
  /** Glow — height fit (×). */
  glowH: number;
  /** Glow — colour (hex). */
  glowColor: string;
  /** Sheen — the ambient glare sweep's full cycle (seconds): one sweep then a rest. */
  sheenCycle: number;
  /** Sheen — glare strength (0–1). 0 disables the sweep. */
  sheenAlpha: number;
  /** Strike — the press flash duration (ms). 0 disables it. */
  flashMs: number;
  /** Strike — dirt/smoke billow AMOUNT (× the combat impact dust). 0 disables. */
  dustCount: number;
  /** Strike — dirt/smoke puff SIZE (×). */
  dustSize: number;
  /** Strike — dirt/smoke LIFETIME (×). */
  dustLife: number;
  /** Strike — shockwave ring COUNT (0–2). 0 disables. */
  rings: number;
  /** Strike — shockwave ring RADIUS (×). */
  ringRadius: number;
  /** Strike — shockwave ring LIFETIME (×). */
  ringLife: number;
  /** Disabled (can't afford / locked) — the GEM's brightness while dimmed (the stone base never dims: it's
   *  board furniture cut from the board art and must sit flush). */
  artDim: number;
}

// Owner-tuned by eye in the 🍺 tuner and baked as the shipped look (2026-07-16). Notables: pinned high on the
// board's left (y −287), a cool BLUE gem glow (8× 15px stack, slow deep breath), a lively 2.8s sheen, a snappy
// 220ms flash with a thick double-ring shockwave, and artDim 1 (the gem only desaturates when locked, no
// darkening). Mirror position/scale/glow changes into the styles.css `var(--tvb-*, …)` fallbacks.
const DEFAULTS: TavernUpConfig = {
  x: 8,
  y: -287,
  scale: 1.46,
  gemX: 0,
  gemY: 0,
  gemS: 1.2,
  pipX: 6.5,
  pipY: -6.5,
  pipS: 1,
  costX: 37,
  costY: 36,
  costS: 0.84,
  glowBlur: 10,
  glowAlpha: 1,
  glowStrength: 8,
  glowPulse: 2.6,
  glowPulseDepth: 0.65,
  glowX: 0.5,
  glowY: 0.5,
  glowW: 0.85,
  glowH: 0.85,
  glowColor: '#00bfff',
  sheenCycle: 4.8,
  sheenAlpha: 0.67,
  flashMs: 740,
  dustCount: 1.4,
  dustSize: 3,
  dustLife: 1.95,
  rings: 1,
  ringRadius: 3.65,
  ringLife: 2.35,
  artDim: 0.44,
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const TVB_RANGES: Record<Exclude<keyof TavernUpConfig, 'glowColor'>, [number, number, number]> = {
  x: [-800, 800, 1],
  y: [-500, 500, 1],
  scale: [0.4, 2.5, 0.01],
  gemX: [-24, 24, 0.5],
  gemY: [-24, 24, 0.5],
  gemS: [0.8, 1.2, 0.005],
  pipX: [-40, 40, 0.5],
  pipY: [-40, 40, 0.5],
  pipS: [0.7, 1.3, 0.005],
  costX: [-90, 90, 1],
  costY: [-90, 90, 1],
  costS: [0.5, 2, 0.02],
  glowBlur: [0, 48, 1],
  glowAlpha: [0, 1, 0.01],
  glowStrength: [1, 8, 1],
  glowPulse: [0, 6, 0.1],
  glowPulseDepth: [0, 1, 0.01],
  glowX: [-24, 24, 0.5],
  glowY: [-24, 24, 0.5],
  glowW: [0.85, 1.15, 0.005],
  glowH: [0.85, 1.15, 0.005],
  sheenCycle: [1, 12, 0.1],
  sheenAlpha: [0, 1, 0.01],
  flashMs: [0, 900, 10],
  dustCount: [0, 4, 0.05],
  dustSize: [0.2, 3, 0.05],
  dustLife: [0.2, 3, 0.05],
  rings: [0, 2, 1],
  ringRadius: [0, 4, 0.05],
  ringLife: [0.2, 3, 0.05],
  artDim: [0.3, 1, 0.01],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const TVB_DESC: Record<keyof TavernUpConfig, string> = {
  x: 'Horizontal offset (px × scale) from the stage-pinned base point on the board’s left.',
  y: 'Vertical offset (px × scale) from the base point. Positive = down.',
  scale: 'Overall button size (×).',
  gemX: 'Gem seat — nudge the gem horizontally (design px) in the stone’s gold ring.',
  gemY: 'Gem seat — nudge the gem vertically (design px).',
  gemS: 'Gem size (× the measured hole fit).',
  pipX: 'Tier pips — nudge the whole pip arc horizontally (design px) onto the stone’s slots.',
  pipY: 'Tier pips — nudge the pip arc vertically (design px).',
  pipS: 'Tier pips — size of the pip arc (× the art-true fit).',
  costX: 'Cost coin — nudge horizontally (design px) from the button centre.',
  costY: 'Cost coin — nudge vertically (design px).',
  costS: 'Cost coin size (×).',
  glowBlur: 'Gem glow softness — blur radius (px) of each drop-shadow pass.',
  glowAlpha: 'Gem glow peak opacity. 0 turns the hover glow off.',
  glowStrength: 'Glow intensity — how many times the shadow is stacked. Higher = hotter rim.',
  glowPulse: 'Breathing speed — seconds per pulse cycle. 0 = steady glow.',
  glowPulseDepth: 'Breathing depth — how far the glow dips each cycle.',
  glowX: 'Glow alignment — nudge the halo horizontally (design px) so it sits square on the gem.',
  glowY: 'Glow alignment — nudge the halo vertically (design px).',
  glowW: 'Glow fit — halo width (× the gem). Small corrections only; use blur/strength for size.',
  glowH: 'Glow fit — halo height (× the gem).',
  glowColor: 'Gem glow colour.',
  sheenCycle: 'Sheen — seconds per glare sweep cycle (one sweep, then a rest). Lower = livelier.',
  sheenAlpha: 'Sheen — glare strength. 0 = no sweep.',
  flashMs: 'Press flash duration (ms) — the warm pop masking the tier-pip advance. 0 = no flash.',
  dustCount: 'Press — dirt/smoke billow amount (× the combat impact dust). 0 = no dust.',
  dustSize: 'Press — dirt/smoke puff size (×).',
  dustLife: 'Press — dirt/smoke lifetime (×).',
  rings: 'Press — shockwave ring count (0–2). 0 = no ripple.',
  ringRadius: 'Press — shockwave radius (×).',
  ringLife: 'Press — shockwave lifetime (×).',
  artDim: 'Disabled (can’t afford / locked) — the GEM’s brightness while dimmed (the stone never dims).',
};

/** Keys grouped by control type for the tuner UI. */
export const TVB_NUM_KEYS = [
  'x', 'y', 'scale',
  'gemX', 'gemY', 'gemS',
  'pipX', 'pipY', 'pipS',
  'costX', 'costY', 'costS',
  'glowX', 'glowY', 'glowW', 'glowH',
  'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth',
  'sheenCycle', 'sheenAlpha',
  'flashMs', 'dustCount', 'dustSize', 'dustLife',
  'rings', 'ringRadius', 'ringLife',
  'artDim',
] as const;
export const TVB_COLOR_KEYS = ['glowColor'] as const;

const KEY = 'ascent.tavernupbtn';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: TavernUpConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TavernUpConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function getTavernUpConfig(): TavernUpConfig {
  return cfg;
}

/** Reflect everything CSS-driven onto :root as `--tvb-*` (the press dust/rings are read from `cfg` at click
 *  time — no vars needed). */
export function applyTavernUpVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--tvb-x', `${cfg.x}px`);
  root.setProperty('--tvb-y', `${cfg.y}px`);
  root.setProperty('--tvb-s', String(cfg.scale));
  root.setProperty('--tvb-gem-x', String(cfg.gemX));
  root.setProperty('--tvb-gem-y', String(cfg.gemY));
  root.setProperty('--tvb-gem-s', String(cfg.gemS));
  root.setProperty('--tvb-pip-x', String(cfg.pipX));
  root.setProperty('--tvb-pip-y', String(cfg.pipY));
  root.setProperty('--tvb-pip-s', String(cfg.pipS));
  root.setProperty('--tvb-cost-x', String(cfg.costX));
  root.setProperty('--tvb-cost-y', String(cfg.costY));
  root.setProperty('--tvb-cost-s', String(cfg.costS));
  root.setProperty('--tvb-glow-x', String(cfg.glowX));
  root.setProperty('--tvb-glow-y', String(cfg.glowY));
  root.setProperty('--tvb-glow-w', String(cfg.glowW));
  root.setProperty('--tvb-glow-h', String(cfg.glowH));
  root.setProperty('--tvb-glow-alpha', String(cfg.glowAlpha));
  // Pulse 0 = steady: pin the dip to the peak (and park the duration) rather than running a 0s loop.
  root.setProperty('--tvb-glow-dim', String(cfg.glowPulse > 0 ? cfg.glowAlpha * (1 - cfg.glowPulseDepth) : cfg.glowAlpha));
  root.setProperty('--tvb-glow-pulse', `${cfg.glowPulse > 0 ? cfg.glowPulse : 9999}s`);
  // The glow — a BOX-SHADOW stacked `glowStrength` times (composed here because CSS can't repeat a shadow a
  // variable number of times). Box-shadow (not drop-shadow-of-the-art): the gem is a circle, and an outset
  // box-shadow on the circular span paints OUTSIDE the element and never clips square at the box the way a
  // filter drop-shadow does. STATIC: only the glow layer's opacity animates.
  const one = `0 0 ${cfg.glowBlur}px ${rgba(cfg.glowColor, 1)}`;
  root.setProperty('--tvb-glow-shadow', Array(Math.max(1, Math.round(cfg.glowStrength))).fill(one).join(', '));
  root.setProperty('--tvb-sheen-cycle', `${Math.max(0.5, cfg.sheenCycle)}s`);
  root.setProperty('--tvb-sheen-alpha', String(cfg.sheenAlpha));
  root.setProperty('--tvb-flash-ms', `${Math.max(1, cfg.flashMs)}ms`);
  root.setProperty('--tvb-art-dim', String(cfg.artDim));
}

export function setTavernUpValue(key: keyof TavernUpConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyTavernUpVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetTavernUpConfig(): void {
  cfg = { ...DEFAULTS };
  applyTavernUpVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyTavernUpVars();
