/**
 * Tunable look for the CELESTIAL ALIGNMENT ARC — the luminous crescent beneath each Celestial (Codex handoff,
 * 2026-08-05). Replaces the pool-of-light config: the brief is a narrow line, not an aura.
 *
 * Unlike the CSS tuners, these values are read by a PIXI layer rather than reflected onto CSS vars, so there
 * is nothing to mirror in styles.css — the defaults here are the whole contract. Ranges follow the handoff's
 * suggested starting bands.
 */
export interface AlignArcConfig {
  /** Master switch (0/1 so the shared tuner toggle can drive it). */
  on: number;
  /** Arc width as a % of the card's width. */
  width: number;
  /** How far the curve dips below its ends (px) — the crescent's depth. */
  depth: number;
  /** Vertical position relative to the card's bottom edge (px; positive is down). */
  y: number;
  /** The thick blurred stroke that makes the bloom (px). */
  glowStroke: number;
  /** Shared blur strength for every glow stroke (ONE filter for the whole board). */
  blur: number;
  /** The saturated, readable line (px). */
  coreStroke: number;
  /** Opacity of the bloom. */
  glowAlpha: number;
  /** Opacity of the readable line. */
  coreAlpha: number;
  /** Opacity of the 1px white centre. */
  highlightAlpha: number;
  /** Multiplier applied to the drag CANDIDATE slot, so the previewed position reads brighter. */
  emphasis: number;
  /** Dawn colour (hex). */
  dawnColor: string;
  /** Eclipse colour (hex). */
  eclipseColor: string;
  /** Dusk colour (hex). */
  duskColor: string;
}

// The owner's dialled look (2026-08-06), shipped verbatim. Notables: the 1px highlight is OFF (it read as
// noise at this size), the bloom carries the colour (high glowAlpha over a soft core), and Dusk is a deep
// navy rather than the handoff's violet — legible on the light stone where a bright violet washed out.
const DEFAULTS: AlignArcConfig = {
  on: 1,
  width: 94,
  depth: 30,
  y: 24,
  glowStroke: 13,
  blur: 7,
  coreStroke: 6,
  glowAlpha: 0.92,
  coreAlpha: 0.39,
  highlightAlpha: 0,
  emphasis: 1.55,
  dawnColor: '#feb248',
  eclipseColor: '#bff5ee',
  duskColor: '#000c66',
};

export const ALIGNARC_RANGES: Record<
  'width' | 'depth' | 'y' | 'glowStroke' | 'blur' | 'coreStroke' | 'glowAlpha' | 'coreAlpha' | 'highlightAlpha' | 'emphasis',
  [number, number, number]
> = {
  width: [40, 120, 1],
  depth: [0, 30, 1],
  y: [-24, 24, 1],
  glowStroke: [2, 24, 1],
  blur: [0, 20, 1],
  coreStroke: [1, 10, 1],
  glowAlpha: [0, 1, 0.01],
  coreAlpha: [0, 1, 0.01],
  highlightAlpha: [0, 1, 0.01],
  emphasis: [1, 2, 0.05],
};

export const ALIGNARC_COLOR_KEYS = ['dawnColor', 'eclipseColor', 'duskColor'] as const;
export { DEFAULTS as ALIGNARC_DEFAULTS };

const KEY = 'ascent.alignarc';
let cfg: AlignArcConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<AlignArcConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** Packed 0xRRGGBB for a Pixi tint. */
const packed = (hex: string): number => parseInt(hex.replace('#', ''), 16) >>> 0;

export function getAlignArcConfig(): AlignArcConfig {
  return cfg;
}

/** The tint for an alignment, from the configurable palette — the layer never hardcodes a colour. */
export function alignArcColor(align: 'dawn' | 'dusk' | 'eclipse'): number {
  return packed(align === 'dawn' ? cfg.dawnColor : align === 'dusk' ? cfg.duskColor : cfg.eclipseColor);
}

/** Listeners re-sync (and rebuild the shared blur) when a dial moves — the Pixi layer has no CSS vars to
 *  ride on, so it has to be told. */
const listeners = new Set<() => void>();
export function onAlignArcChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setAlignArcConfig(patch: Partial<AlignArcConfig>): void {
  cfg = { ...cfg, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}

export function resetAlignArcConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}
