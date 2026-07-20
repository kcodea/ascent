/**
 * Tunable look for the standalone REFRESH button (`RefreshButton.tsx`) — the board-art button
 * (frames/refresh_button.webp) pinned TOP-CENTRE of the board, replacing the old "Reroll" tray plaque.
 * Same reducer wiring (dispatch `{type:'roll'}`), stage-pinned like the End Turn diamond and the Tavern stone.
 *
 * Deliberately mirrors `tavernUpConfig.ts` dial-for-dial (owner request: "the same style tuning modifiers
 * as the tavern up button") MINUS the gem/pip seats, which are specific to the tavern stone's layered art —
 * the refresh art is a single button image, so there is no hole to seat anything into.
 *
 * Dial groups (🔄 tuner): POSITION/SCALE · COST badge seat · GLOW (hover halo, breath = opacity only) ·
 * SHEEN sweep · STRIKE (press flash + dust + shockwave ring) · disabled ART DIM. Config is
 * localStorage-persisted in DEV only; production always renders DEFAULTS (Layout Lab convention). Values
 * reflect to `--rfb-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS (update both when baking
 * tuned values).
 */
export interface RefreshConfig {
  /** Position — px offset from the stage-pinned base point (board's TOP-CENTRE), × --scale. +x → right. */
  x: number;
  /** Position — px offset from the base point, × --scale. +y → down. */
  y: number;
  /** Overall button scale (×). The base art renders 112 design-px wide before this. */
  scale: number;
  /** Cost badge — nudge x (design px × --u) from the button centre. */
  costX: number;
  /** Cost badge — nudge y (design px × --u). */
  costY: number;
  /** Cost badge size (×). */
  costS: number;
  /** Label pill — nudge y (design px × --u); the glass "Refresh" pill sits ABOVE the button. */
  labelY: number;
  /** Label pill size (×). */
  labelS: number;
  /** Glow — blur radius (px) of each shadow pass. */
  glowBlur: number;
  /** Glow — peak opacity (0–1). 0 disables the hover glow. */
  glowAlpha: number;
  /** Glow — shadow stack count. 1 = soft halo, higher = hot rim. */
  glowStrength: number;
  /** Glow — breathing speed: seconds per pulse cycle. 0 = steady. */
  glowPulse: number;
  /** Glow — breath depth: eases between peak and peak×(1−depth). */
  glowPulseDepth: number;
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
  /** Strike — the press SPIN duration (ms). The refresh art rotates on press. 0 disables it. */
  spinMs: number;
  /** Strike — press flash duration (ms). 0 disables it. */
  flashMs: number;
  /** Strike — dust billow AMOUNT (× the combat impact dust). 0 disables. */
  dustCount: number;
  /** Strike — dust puff SIZE (×). */
  dustSize: number;
  /** Strike — dust LIFETIME (×). */
  dustLife: number;
  /** Strike — shockwave ring COUNT (0–2). 0 disables. */
  rings: number;
  /** Strike — shockwave ring RADIUS (×). */
  ringRadius: number;
  /** Strike — shockwave ring LIFETIME (×). */
  ringLife: number;
  /** Disabled (can't afford / frozen) — the button art's brightness while dimmed. */
  artDim: number;
}

// Starting values, deliberately conservative — the owner tunes these by eye in the 🔄 tuner and bakes the
// result, exactly like the Tavern stone's were. Mirror position/scale/glow changes into the styles.css
// `var(--rfb-*, …)` fallbacks.
const DEFAULTS: RefreshConfig = {
  x: 0,
  y: 168,
  scale: 1,
  costX: 34,
  costY: 32,
  costS: 0.84,
  labelY: -46,
  labelS: 1,
  glowBlur: 10,
  glowAlpha: 0.9,
  glowStrength: 6,
  glowPulse: 3.2,
  glowPulseDepth: 0.6,
  glowW: 0.9,
  glowH: 0.9,
  glowColor: '#4bc0ff',
  sheenCycle: 5.2,
  sheenAlpha: 0.55,
  spinMs: 420,
  flashMs: 320,
  dustCount: 0.8,
  dustSize: 2,
  dustLife: 1.4,
  rings: 1,
  ringRadius: 2.6,
  ringLife: 1.7,
  artDim: 0.5,
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const RFB_RANGES: Record<Exclude<keyof RefreshConfig, 'glowColor'>, [number, number, number]> = {
  x: [-800, 800, 1],
  y: [-400, 600, 1],
  scale: [0.4, 2.5, 0.01],
  costX: [-90, 90, 1],
  costY: [-90, 90, 1],
  costS: [0.5, 2, 0.02],
  labelY: [-140, 40, 1],
  labelS: [0.5, 2, 0.02],
  glowBlur: [0, 48, 1],
  glowAlpha: [0, 1, 0.01],
  glowStrength: [1, 8, 1],
  glowPulse: [0, 6, 0.1],
  glowPulseDepth: [0, 1, 0.01],
  glowW: [0.85, 1.15, 0.005],
  glowH: [0.85, 1.15, 0.005],
  sheenCycle: [1, 12, 0.1],
  sheenAlpha: [0, 1, 0.01],
  spinMs: [0, 1200, 10],
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
export const RFB_DESC: Record<keyof RefreshConfig, string> = {
  x: 'Horizontal offset (px × scale) from the stage-pinned base point at the board’s top-centre.',
  y: 'Vertical offset (px × scale) from the base point. Positive = down.',
  scale: 'Overall button size (×).',
  costX: 'Cost coin — nudge horizontally (design px) from the button centre.',
  costY: 'Cost coin — nudge vertically (design px).',
  costS: 'Cost coin size (×).',
  labelY: 'Refresh label — how far ABOVE the button the glass pill sits (design px).',
  labelS: 'Refresh label — pill size (×).',
  glowBlur: 'Hover glow softness — blur radius (px) of each shadow pass.',
  glowAlpha: 'Hover glow peak opacity. 0 turns the glow off.',
  glowStrength: 'Glow intensity — how many times the shadow is stacked. Higher = hotter rim.',
  glowPulse: 'Breathing speed — seconds per pulse cycle. 0 = steady glow.',
  glowPulseDepth: 'Breathing depth — how far the glow dips each cycle.',
  glowW: 'Glow fit — halo width (× the button).',
  glowH: 'Glow fit — halo height (× the button).',
  glowColor: 'Hover glow colour.',
  sheenCycle: 'Sheen — seconds per glare sweep cycle (one sweep, then a rest). Lower = livelier.',
  sheenAlpha: 'Sheen — glare strength. 0 = no sweep.',
  spinMs: 'Press — how long the refresh art spins (ms). 0 = no spin.',
  flashMs: 'Press flash duration (ms). 0 = no flash.',
  dustCount: 'Press — dust billow amount (× the combat impact dust). 0 = no dust.',
  dustSize: 'Press — dust puff size (×).',
  dustLife: 'Press — dust lifetime (×).',
  rings: 'Press — shockwave ring count (0–2). 0 = no ripple.',
  ringRadius: 'Press — shockwave radius (×).',
  ringLife: 'Press — shockwave lifetime (×).',
  artDim: 'Disabled (can’t afford) — the button art’s brightness while dimmed.',
};

/** Keys grouped by control type for the tuner UI. */
export const RFB_NUM_KEYS = [
  'x', 'y', 'scale',
  'labelY', 'labelS',
  'costX', 'costY', 'costS',
  'glowW', 'glowH', 'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth',
  'sheenCycle', 'sheenAlpha',
  'spinMs', 'flashMs', 'dustCount', 'dustSize', 'dustLife',
  'rings', 'ringRadius', 'ringLife',
  'artDim',
] as const;
export const RFB_COLOR_KEYS = ['glowColor'] as const;

const KEY = 'ascent.refreshbtn';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: RefreshConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<RefreshConfig>) : {}) };
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

export function getRefreshConfig(): RefreshConfig {
  return cfg;
}

/** Reflect everything CSS-driven onto :root as `--rfb-*` (the press dust/rings are read from `cfg` at click
 *  time — no vars needed). Mirrors `applyTavernUpVars`. */
export function applyRefreshVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--rfb-x', `${cfg.x}px`);
  root.setProperty('--rfb-y', `${cfg.y}px`);
  root.setProperty('--rfb-s', String(cfg.scale));
  root.setProperty('--rfb-cost-x', String(cfg.costX));
  root.setProperty('--rfb-cost-y', String(cfg.costY));
  root.setProperty('--rfb-cost-s', String(cfg.costS));
  root.setProperty('--rfb-label-y', String(cfg.labelY));
  root.setProperty('--rfb-label-s', String(cfg.labelS));
  root.setProperty('--rfb-glow-w', String(cfg.glowW));
  root.setProperty('--rfb-glow-h', String(cfg.glowH));
  root.setProperty('--rfb-glow-alpha', String(cfg.glowAlpha));
  // Pulse 0 = steady: pin the dip to the peak (and park the duration) rather than running a 0s loop.
  root.setProperty('--rfb-glow-dim', String(cfg.glowPulse > 0 ? cfg.glowAlpha * (1 - cfg.glowPulseDepth) : cfg.glowAlpha));
  root.setProperty('--rfb-glow-pulse', `${cfg.glowPulse > 0 ? cfg.glowPulse : 9999}s`);
  // The glow — a BOX-SHADOW stacked `glowStrength` times (composed here because CSS can't repeat a shadow a
  // variable number of times). STATIC shadow; only the glow layer's OPACITY animates, per docs/performance.md
  // (a looping box-shadow animation repaints every frame).
  const one = `0 0 ${cfg.glowBlur}px ${rgba(cfg.glowColor, 1)}`;
  root.setProperty('--rfb-glow-shadow', Array(Math.max(1, Math.round(cfg.glowStrength))).fill(one).join(', '));
  root.setProperty('--rfb-sheen-cycle', `${Math.max(0.5, cfg.sheenCycle)}s`);
  root.setProperty('--rfb-sheen-alpha', String(cfg.sheenAlpha));
  root.setProperty('--rfb-spin-ms', `${Math.max(1, cfg.spinMs)}ms`);
  root.setProperty('--rfb-flash-ms', `${Math.max(1, cfg.flashMs)}ms`);
  root.setProperty('--rfb-art-dim', String(cfg.artDim));
}

export function setRefreshValue(key: keyof RefreshConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyRefreshVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetRefreshConfig(): void {
  cfg = { ...DEFAULTS };
  applyRefreshVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyRefreshVars();
