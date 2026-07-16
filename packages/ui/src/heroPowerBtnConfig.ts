/**
 * Tunable look for the HERO POWER diamond (`StatusBar.tsx`'s `.heropanel`) — the bronze diamond housing
 * (frames/heropowerbutton.webp) that frames the hero-power art on the board's MIDDLE-LEFT, mirroring the
 * End Turn diamond on the middle-right (owner direction 2026-07-16: same strategy as the End Turn button;
 * its effects will diverge later — this module carries position/scale + the glow).
 *
 * Same architecture as `endTurnConfig.ts`:
 *   - POSITION + SCALE — px offsets from the stage-pinned base point (0.19/0.45 of the stage, × --scale)
 *     and an overall scale factor.
 *   - GLOW — the diamond highlight hugging the power's inner FACE (frames/heropowerbutton_face.webp): a
 *     stacked drop-shadow follows the face cut's alpha, and a CSS mask cuts the source pixels back out so
 *     only the halo paints (offset/fit dials steer the halo alone). Shown on hover AND pinned while the
 *     power is READY/ARMED (the press-me cue the old box-shadow glow provided); breathing animates OPACITY
 *     only (compositor-cheap).
 *
 * Config is localStorage-persisted in dev (the 💠 tuner); PRODUCTION always uses DEFAULTS, which the
 * styles.css `var(--hpb-*, …)` fallbacks mirror.
 */
export interface HeroPowerBtnConfig {
  /** Position — px offset from the base point (middle-left of the stage), × --scale. +x → right. */
  x: number;
  /** Position — px offset from the base point, × --scale. +y → down. */
  y: number;
  /** Overall button scale (×). The base art renders at 128px wide before this. */
  scale: number;
  /** Power ART — offset x inside the face window (design px, × --u). The clip window stays fixed. */
  artX: number;
  /** Power ART — offset y inside the face window (design px, × --u). */
  artY: number;
  /** Power ART — scale inside the face window (×). >1 zooms the art within the fixed diamond clip. */
  artScale: number;
  /** Power ART — opacity while the power is USED / unaffordable (0–1). The art fades against the housing's
   *  dark face (which never fades); 1 = no dim at all. */
  artDim: number;
  /** Refresh FLASH — duration (ms) of the one-shot face bloom when the power comes back up for usage
   *  (start-of-shop recharge, Indy's mid-shop re-arm, re-affording). 0 disables it. */
  refreshFlash: number;
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
  /** Glow — ALIGNMENT nudge x (px of the 128-wide design box, × --u). */
  glowX: number;
  /** Glow — alignment nudge y (px, × --u). */
  glowY: number;
  /** Glow — width fit (×). Small corrections so the halo hugs the face; use blur/strength for SIZE. */
  glowW: number;
  /** Glow — height fit (×). */
  glowH: number;
  /** Glow — colour (hex). */
  glowColor: string;
}

// Position mirrors the End Turn diamond's baked spot across the board's centre line; the glow starts from
// the ETB's baked recipe in the hero-power's amber. All owner-tunable via the 💠 tuner.
const DEFAULTS: HeroPowerBtnConfig = {
  x: -140,
  y: 32,
  scale: 1.14,
  artX: 0,
  artY: 0,
  artScale: 1,
  artDim: 0.5,
  refreshFlash: 450,
  glowBlur: 1,
  glowAlpha: 0.93,
  glowStrength: 6,
  glowPulse: 0.7,
  glowPulseDepth: 0.11,
  glowX: 0,
  glowY: 0,
  glowW: 1,
  glowH: 1,
  glowColor: '#ffb347',
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const HPB_RANGES: Record<Exclude<keyof HeroPowerBtnConfig, 'glowColor'>, [number, number, number]> = {
  x: [-800, 800, 1],
  y: [-500, 500, 1],
  scale: [0.4, 2.5, 0.01],
  artX: [-60, 60, 0.5],
  artY: [-60, 60, 0.5],
  artScale: [0.4, 2.5, 0.01],
  artDim: [0, 1, 0.01],
  refreshFlash: [0, 900, 10],
  glowBlur: [0, 48, 1],
  glowAlpha: [0, 1, 0.01],
  glowStrength: [1, 8, 1],
  glowPulse: [0, 6, 0.1],
  glowPulseDepth: [0, 1, 0.01],
  glowX: [-24, 24, 0.5],
  glowY: [-24, 24, 0.5],
  glowW: [0.85, 1.15, 0.005],
  glowH: [0.85, 1.15, 0.005],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const HPB_DESC: Record<keyof HeroPowerBtnConfig, string> = {
  x: 'Horizontal offset (px × scale) from the stage-pinned base point on the board’s middle-left.',
  y: 'Vertical offset (px × scale) from the base point. Positive = down.',
  scale: 'Overall button size (×).',
  artX: 'Power ART — slide it horizontally inside the face window (the diamond clip stays put).',
  artY: 'Power ART — slide it vertically inside the face window.',
  artScale: 'Power ART — zoom it inside the face window (the diamond clip stays put).',
  artDim: 'Power ART — its opacity while the power is USED / unaffordable; it fades against the dark face. 1 = never dims.',
  refreshFlash: 'Refresh flash — the one-shot face bloom (ms) when the power comes back up. 0 = no flash.',
  glowBlur: 'Face glow softness — blur radius (px) of each drop-shadow pass.',
  glowAlpha: 'Face glow peak opacity. 0 turns the glow off.',
  glowStrength: 'Glow intensity — how many times the shadow is stacked. Higher = hotter rim.',
  glowPulse: 'Breathing speed — seconds per full pulse cycle. 0 = steady glow.',
  glowPulseDepth: 'Breathing depth — how far the glow dips each cycle (0 = none, 1 = fully out).',
  glowX: 'Glow alignment — nudge the halo horizontally (design px) so it sits square on the face.',
  glowY: 'Glow alignment — nudge the halo vertically (design px).',
  glowW: 'Glow fit — halo width (× the face). Small corrections only; use blur/strength for overall size.',
  glowH: 'Glow fit — halo height (× the face).',
  glowColor: 'Face glow colour.',
};

/** Keys grouped by control type for the tuner UI. */
export const HPB_NUM_KEYS = [
  'x', 'y', 'scale',
  'artX', 'artY', 'artScale', 'artDim', 'refreshFlash',
  'glowX', 'glowY', 'glowW', 'glowH',
  'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth',
] as const;
export const HPB_COLOR_KEYS = ['glowColor'] as const;

const KEY = 'ascent.heropowerbtn';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: HeroPowerBtnConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HeroPowerBtnConfig>) : {}) };
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

export function getHeroPowerBtnConfig(): HeroPowerBtnConfig {
  return cfg;
}

/** Reflect the config onto :root as `--hpb-*` so the pure-CSS side picks the values up live. */
export function applyHeroPowerBtnVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--hpb-x', `${cfg.x}px`);
  root.setProperty('--hpb-y', `${cfg.y}px`);
  root.setProperty('--hpb-s', String(cfg.scale));
  // Art fit inside the fixed face window — unitless design-px (the CSS multiplies by --u) + a zoom factor.
  root.setProperty('--hpb-art-x', String(cfg.artX));
  root.setProperty('--hpb-art-y', String(cfg.artY));
  root.setProperty('--hpb-art-s', String(cfg.artScale));
  root.setProperty('--hpb-art-dim', String(cfg.artDim));
  root.setProperty('--hpb-flash-ms', `${Math.max(1, cfg.refreshFlash)}ms`);
  root.setProperty('--hpb-glow-alpha', String(cfg.glowAlpha));
  // Pulse 0 = steady: pin the dip to the peak (and park the duration) rather than running a 0s loop.
  root.setProperty('--hpb-glow-dim', String(cfg.glowPulse > 0 ? cfg.glowAlpha * (1 - cfg.glowPulseDepth) : cfg.glowAlpha));
  root.setProperty('--hpb-glow-pulse', `${cfg.glowPulse > 0 ? cfg.glowPulse : 9999}s`);
  root.setProperty('--hpb-glow-x', String(cfg.glowX));
  root.setProperty('--hpb-glow-y', String(cfg.glowY));
  root.setProperty('--hpb-glow-w', String(cfg.glowW));
  root.setProperty('--hpb-glow-h', String(cfg.glowH));
  // The glow filter — a drop-shadow stacked `glowStrength` times (composed here because CSS can't repeat a
  // filter a variable number of times). STATIC: only the glow layer's opacity animates.
  const one = `drop-shadow(0 0 ${cfg.glowBlur}px ${rgba(cfg.glowColor, 1)})`;
  root.setProperty('--hpb-glow-filter', Array(Math.max(1, Math.round(cfg.glowStrength))).fill(one).join(' '));
}

export function setHeroPowerBtnValue(key: keyof HeroPowerBtnConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyHeroPowerBtnVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetHeroPowerBtnConfig(): void {
  cfg = { ...DEFAULTS };
  applyHeroPowerBtnVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyHeroPowerBtnVars();
