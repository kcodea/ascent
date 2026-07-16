/**
 * Tunable look for the standalone END TURN diamond button (`EndTurnButton.tsx`) — the gem-in-bronze diamond
 * (frames/end_button.webp) pinned to the board's middle-right that ends the turn / starts combat.
 *
 * Three groups of dials, matching the DEV tuner (`EndTurnTuner.tsx`, opened from the Dev Tuning Menu):
 *   - POSITION + SCALE — px offsets from the stage-pinned base point (× --scale, resolution-independent, same
 *     pinning scheme as the hero power) and an overall scale factor.
 *   - GLOW — the diamond-shaped highlight hugging the button, shown ON HOVER ONLY (owner note 2026-07-16).
 *     Implemented as a duplicate of the button art with a stacked drop-shadow filter (the shadow follows the
 *     image's alpha, so the glow IS the diamond silhouette), whose OPACITY breathes while hovered
 *     (compositor-only — the filter itself is static, per the perf rule).
 *   - LIGHTNING — little arcs crackling along the diamond's edges AND across its face on a small canvas
 *     overlay. Speed = spawn cadence, scale = arc length, magnitude = jitter amplitude.
 *
 * Config is localStorage-persisted in dev so the tuner survives reloads; PRODUCTION always uses DEFAULTS (the
 * stored overrides are dev-only, mirroring the Layout Lab convention). Position/scale/glow reflect to `--etb-*`
 * CSS vars (fallbacks in styles.css mirror DEFAULTS); the lightning params are read live by the canvas loop
 * each frame, so slider moves apply instantly without a re-render.
 */
export interface EndTurnConfig {
  /** Position — px offset from the base point (right-middle of the stage), × --scale. +x → right. */
  x: number;
  /** Position — px offset from the base point, × --scale. +y → down. */
  y: number;
  /** Overall button scale (×). The base art renders at 128px wide before this. */
  scale: number;
  /** Glow — blur radius (px) of each drop-shadow pass. */
  glowBlur: number;
  /** Glow — peak opacity of the glow layer (0–1). 0 disables the glow entirely. */
  glowAlpha: number;
  /** Glow — how many times the drop-shadow is stacked. 1 = soft halo, higher = hot rim. */
  glowStrength: number;
  /** Glow — breathing speed: one full pulse cycle in seconds. 0 = steady (no pulse). */
  glowPulse: number;
  /** Glow — how deep the breath dips: the glow eases between peak and peak×(1−depth). */
  glowPulseDepth: number;
  /** Glow — ALIGNMENT nudge x (px of the 128-wide design box, × --u). Fixes the halo sitting off the gem. */
  glowX: number;
  /** Glow — alignment nudge y (px, × --u). */
  glowY: number;
  /** Glow — width fit (×). Small corrections so the halo hugs the gem's sides; use blur/strength for SIZE. */
  glowW: number;
  /** Glow — height fit (×). */
  glowH: number;
  /** Glow — colour (hex). */
  glowColor: string;
  /** Lightning — arcs spawned per second. 0 disables the canvas entirely. */
  boltRate: number;
  /** Lightning — arc length as a fraction of the diamond's edge (0.1 = short sparks, 1 = full edge). */
  boltScale: number;
  /** Lightning — jitter amplitude (px): how far the arc deviates from the edge line. */
  boltMag: number;
  /** Lightning — stroke width (px). */
  boltWidth: number;
  /** Lightning — arc lifetime (ms): how long each arc stays before fading out. */
  boltLife: number;
  /** Lightning — overall opacity of the arcs (0–1). */
  boltAlpha: number;
  /** Lightning — colour (hex). */
  boltColor: string;
  /** Strike — lightning arcs burst out the instant the button is hit (masks the lit→dim art swap). */
  strikeBolts: number;
  /** Strike — the white-hot gem flash's duration (ms). 0 disables the flash. */
  strikeFlash: number;
  /** Strike — dirt/smoke billow AMOUNT (× the combat impact-dust count). 0 disables the dust. */
  strikeDustCount: number;
  /** Strike — dirt/smoke puff SIZE (×). */
  strikeDustSize: number;
  /** Strike — dirt/smoke LIFETIME (×): how long the billow hangs before settling. */
  strikeDustLife: number;
  /** Strike — shockwave RING COUNT (0–2). 0 disables the ripple. */
  strikeRings: number;
  /** Strike — shockwave ring RADIUS (× the combat pulse's base): how far the ripple expands. */
  strikeRingRadius: number;
  /** Strike — shockwave ring LIFETIME (×): slower = a statelier expanding wave. */
  strikeRingLife: number;
  /** Pressed-art variant: 2 = the dim gem (end_button_pressed2), 3 = the cracked gem (end_button_pressed3).
   *  A tuner switch for A/B-ing pressed looks; reflected as `html.etb-p3` so CSS flips the art. */
  pressedVariant: number;
}

const DEFAULTS: EndTurnConfig = {
  x: 0,
  y: 0,
  scale: 1,
  glowBlur: 14,
  glowAlpha: 0.85,
  glowStrength: 3,
  glowPulse: 2.2,
  glowPulseDepth: 0.55,
  glowX: 0,
  glowY: 0,
  glowW: 1,
  glowH: 1,
  glowColor: '#38b6ff',
  boltRate: 3,
  boltScale: 0.45,
  boltMag: 7,
  boltWidth: 2,
  boltLife: 220,
  boltAlpha: 0.9,
  boltColor: '#9fdcff',
  strikeBolts: 8,
  strikeFlash: 340,
  strikeDustCount: 1.5,
  strikeDustSize: 1,
  strikeDustLife: 1,
  strikeRings: 2,
  strikeRingRadius: 1.5,
  strikeRingLife: 1,
  pressedVariant: 2,
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const ETB_RANGES: Record<Exclude<keyof EndTurnConfig, 'glowColor' | 'boltColor'>, [number, number, number]> = {
  x: [-800, 800, 1],
  y: [-500, 500, 1],
  scale: [0.4, 2.5, 0.01],
  glowBlur: [0, 48, 1],
  glowAlpha: [0, 1, 0.01],
  glowStrength: [1, 8, 1],
  glowPulse: [0, 6, 0.1],
  glowPulseDepth: [0, 1, 0.01],
  boltRate: [0, 20, 0.5],
  boltScale: [0.05, 1, 0.01],
  boltMag: [0, 30, 0.5],
  boltWidth: [0.5, 6, 0.25],
  boltLife: [60, 900, 10],
  boltAlpha: [0, 1, 0.01],
  glowX: [-24, 24, 0.5],
  glowY: [-24, 24, 0.5],
  glowW: [0.85, 1.15, 0.005],
  glowH: [0.85, 1.15, 0.005],
  strikeBolts: [0, 20, 1],
  strikeFlash: [0, 900, 10],
  strikeDustCount: [0, 4, 0.05],
  strikeDustSize: [0.2, 3, 0.05],
  strikeDustLife: [0.2, 3, 0.05],
  strikeRings: [0, 2, 1],
  strikeRingRadius: [0, 4, 0.05],
  strikeRingLife: [0.2, 3, 0.05],
  pressedVariant: [2, 3, 1], // rendered as a switch row in the tuner, not a slider
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const ETB_DESC: Record<keyof EndTurnConfig, string> = {
  x: 'Horizontal offset (px × scale) from the stage-pinned base point on the board’s middle-right.',
  y: 'Vertical offset (px × scale) from the base point. Positive = down.',
  scale: 'Overall button size (×).',
  glowBlur: 'Diamond glow softness — blur radius (px) of each drop-shadow pass.',
  glowAlpha: 'Diamond glow peak opacity. 0 turns the glow off.',
  glowStrength: 'Glow intensity — how many times the shadow is stacked. Higher = hotter rim.',
  glowPulse: 'Breathing speed — seconds per full pulse cycle. 0 = steady glow.',
  glowPulseDepth: 'Breathing depth — how far the glow dips each cycle (0 = none, 1 = fully out).',
  glowColor: 'Diamond glow colour.',
  boltRate: 'Lightning — arcs spawned per second. 0 disables lightning.',
  boltScale: 'Lightning — arc length as a fraction of a diamond edge.',
  boltMag: 'Lightning — jitter magnitude (px): how violently the arc deviates from the edge.',
  boltWidth: 'Lightning — stroke width (px).',
  boltLife: 'Lightning — each arc’s lifetime (ms) before it fades.',
  boltAlpha: 'Lightning — arc opacity.',
  boltColor: 'Lightning — arc colour.',
  glowX: 'Glow alignment — nudge the halo horizontally (design px) so it sits square on the gem.',
  glowY: 'Glow alignment — nudge the halo vertically (design px).',
  glowW: 'Glow fit — halo width (× the gem). Small corrections only; use blur/strength for overall size.',
  glowH: 'Glow fit — halo height (× the gem).',
  strikeBolts: 'Strike — how many lightning arcs burst out the instant the button is hit.',
  strikeFlash: 'Strike — the white-hot gem flash duration (ms). 0 = no flash.',
  strikeDustCount: 'Strike — dirt/smoke billow amount (× the combat impact dust). 0 = no dust.',
  strikeDustSize: 'Strike — dirt/smoke puff size (×).',
  strikeDustLife: 'Strike — dirt/smoke lifetime (×): how long the billow hangs.',
  strikeRings: 'Strike — shockwave ring count (0–2). 0 = no ripple.',
  strikeRingRadius: 'Strike — shockwave radius (×): how far the ripple expands.',
  strikeRingLife: 'Strike — shockwave lifetime (×): slower = a statelier wave.',
  pressedVariant: 'Pressed art: OFF = the dim gem (pressed2), ON = the cracked gem (pressed3).',
};

/** Keys grouped by control type for the tuner UI. */
export const ETB_NUM_KEYS = [
  'x', 'y', 'scale',
  'glowX', 'glowY', 'glowW', 'glowH',
  'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth',
  'boltRate', 'boltScale', 'boltMag', 'boltWidth', 'boltLife', 'boltAlpha',
  'strikeBolts', 'strikeFlash',
  'strikeDustCount', 'strikeDustSize', 'strikeDustLife',
  'strikeRings', 'strikeRingRadius', 'strikeRingLife',
] as const;
export const ETB_COLOR_KEYS = ['glowColor', 'boltColor'] as const;

const KEY = 'ascent.endturnbtn';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: EndTurnConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<EndTurnConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function getEndTurnConfig(): EndTurnConfig {
  return cfg;
}

/** Reflect position/scale/glow onto :root as `--etb-*` so the pure-CSS side picks the values up live.
 *  (The lightning canvas reads `cfg` directly each frame — no vars needed.) */
export function applyEndTurnVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--etb-x', `${cfg.x}px`);
  root.setProperty('--etb-y', `${cfg.y}px`);
  root.setProperty('--etb-s', String(cfg.scale));
  // Glow alignment — unitless design-px (the CSS multiplies by --u) + fit scale factors.
  root.setProperty('--etb-glow-x', String(cfg.glowX));
  root.setProperty('--etb-glow-y', String(cfg.glowY));
  root.setProperty('--etb-glow-w', String(cfg.glowW));
  root.setProperty('--etb-glow-h', String(cfg.glowH));
  root.setProperty('--etb-glow-alpha', String(cfg.glowAlpha));
  // Pulse 0 = steady: pin the dip to the peak (and park the duration) rather than running a 0s loop.
  root.setProperty('--etb-glow-dim', String(cfg.glowPulse > 0 ? cfg.glowAlpha * (1 - cfg.glowPulseDepth) : cfg.glowAlpha));
  root.setProperty('--etb-glow-pulse', `${cfg.glowPulse > 0 ? cfg.glowPulse : 9999}s`);
  // The glow filter — a drop-shadow stacked `glowStrength` times (composed here because CSS can't repeat a
  // filter a variable number of times). STATIC: only the glow layer's opacity animates.
  const one = `drop-shadow(0 0 ${cfg.glowBlur}px ${rgba(cfg.glowColor, 1)})`;
  root.setProperty('--etb-glow-filter', Array(Math.max(1, Math.round(cfg.glowStrength))).fill(one).join(' '));
  root.setProperty('--etb-flash-ms', `${Math.max(1, cfg.strikeFlash)}ms`);
  // Pressed-art variant switch — a class, not a var, so plain CSS display rules can flip the art.
  document.documentElement.classList.toggle('etb-p3', cfg.pressedVariant >= 3);
}

export function setEndTurnValue(key: keyof EndTurnConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyEndTurnVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetEndTurnConfig(): void {
  cfg = { ...DEFAULTS };
  applyEndTurnVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyEndTurnVars();
