/**
 * Tunable look for the CELESTIAL ALIGNMENT ARC — the luminous crescent beneath each Celestial.
 *
 * SECOND ARCHITECTURE (owner report 2026-08-06: "they still hate being moved — the lines should maybe be
 * attached to the minions"). The first cut was the Codex handoff's Pixi layer: a separate under-card canvas,
 * positioned by rect sweeps. It looked right standing still and could never look right in motion — a drag, a
 * row slide, a pop-in all move the DOM card between measurements, and the canvas only knows where cards
 * WERE. The arc is now a CHILD OF THE CARD, so every movement is inherited for free; only its COLOUR is
 * derived from board position. What Pixi bought (a real BlurFilter bloom) is reproduced with layered
 * radial-gradients — softness from gradient stops, no `filter: blur()` at all, which is also cheaper.
 *
 * The dials keep their Pixi-era names ON PURPOSE: the owner has dialled values saved under this localStorage
 * key twice already, and renaming keys would silently discard them. `blur` now feathers the bloom band and
 * `glowStroke`/`coreStroke` are band thicknesses — the same knobs, the same feel.
 *
 * Values reflect onto `--aa-*` vars like every CSS config module — but the gradient STRINGS are composed
 * here in TS, so the CSS stays a dumb `background: var(...)` and the stop math lives in one place.
 */
export interface AlignArcConfig {
  /** Master switch (0/1 so the shared tuner toggle can drive it). */
  on: number;
  /** Arc width as a % of the card's width. */
  width: number;
  /** How far the crescent dips below its origin line (px) — the ellipse's vertical radius. */
  depth: number;
  /** Vertical position of the arc's origin relative to the card's bottom edge (px; positive is down). */
  y: number;
  /** Thickness of the soft bloom band (px). */
  glowStroke: number;
  /** Feather on the bloom band's edges (px) — the stand-in for the Pixi BlurFilter. */
  blur: number;
  /** Thickness of the crisp readable band (px). */
  coreStroke: number;
  /** Opacity of the bloom. */
  glowAlpha: number;
  /** Opacity of the readable band. */
  coreAlpha: number;
  /** Opacity of the thin white centre line. */
  highlightAlpha: number;
  /** Brightness multiplier reserved for the drag-candidate preview (a follow-up slice; the dial is kept so
   *  saved configs keep their shape). */
  emphasis: number;
  /** Dawn colour (hex). */
  dawnColor: string;
  /** Eclipse colour (hex). */
  eclipseColor: string;
  /** Dusk colour (hex). */
  duskColor: string;
}

// The owner's dial-in (2026-08-06, second pass), shipped verbatim.
const DEFAULTS: AlignArcConfig = {
  on: 1,
  width: 85,
  depth: 30,
  y: 18,
  glowStroke: 13,
  blur: 8,
  coreStroke: 6,
  glowAlpha: 0.72,
  coreAlpha: 0.51,
  highlightAlpha: 1,
  emphasis: 1.2,
  dawnColor: '#feb248',
  eclipseColor: '#ffb3fc',
  duskColor: '#6281fe',
};

export const ALIGNARC_RANGES: Record<
  'width' | 'depth' | 'y' | 'glowStroke' | 'blur' | 'coreStroke' | 'glowAlpha' | 'coreAlpha' | 'highlightAlpha' | 'emphasis',
  [number, number, number]
> = {
  width: [40, 120, 1],
  depth: [4, 60, 1],
  y: [-24, 40, 1],
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

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function getAlignArcConfig(): AlignArcConfig {
  return cfg;
}

/**
 * Compose one alignment's full `background` value: three ring bands on the SAME ellipse — the feathered
 * bloom, the crisp core, and the thin white highlight — of which only the lower half shows, because the
 * element's top edge sits on the ellipse's centre line.
 *
 * All band edges are computed in px along the ellipse's vertical radius and expressed as % stops, so the
 * horizontal radius scales with the card while the band thicknesses stay true. `blur` feathers both edges of
 * the bloom; the core and highlight keep hairline feathers so they read crisp without shimmering.
 */
function arcGradient(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const tint = (a: number): string => `rgba(${r}, ${g}, ${b}, ${a})`;
  const R = cfg.depth + cfg.glowStroke / 2 + cfg.blur; // vertical radius: the ring line + the bloom's reach
  const pct = (px: number): string => `${Math.max(0, Math.min(100, (px / R) * 100)).toFixed(2)}%`;
  const ellipse = `ellipse 50% ${R}px at 50% 0`;
  const layers: string[] = [];
  // Highlight — the energised white centre line (on top, so first in the background list).
  if (cfg.highlightAlpha > 0) {
    layers.push(
      `radial-gradient(${ellipse}, transparent ${pct(cfg.depth - 1.5)}, rgba(255,255,255,${cfg.highlightAlpha}) ${pct(cfg.depth - 0.5)}, rgba(255,255,255,${cfg.highlightAlpha}) ${pct(cfg.depth + 0.5)}, transparent ${pct(cfg.depth + 1.5)})`,
    );
  }
  // Core — the readable line.
  const coreIn = cfg.depth - cfg.coreStroke / 2;
  const coreOut = cfg.depth + cfg.coreStroke / 2;
  layers.push(
    `radial-gradient(${ellipse}, transparent ${pct(coreIn - 1)}, ${tint(cfg.coreAlpha)} ${pct(coreIn)}, ${tint(cfg.coreAlpha)} ${pct(coreOut)}, transparent ${pct(coreOut + 1)})`,
  );
  // Bloom — the soft halo, feathered by `blur` on both edges.
  const bloomIn = cfg.depth - cfg.glowStroke / 2;
  const bloomOut = cfg.depth + cfg.glowStroke / 2;
  layers.push(
    `radial-gradient(${ellipse}, transparent ${pct(bloomIn - cfg.blur)}, ${tint(cfg.glowAlpha)} ${pct(bloomIn)}, ${tint(cfg.glowAlpha)} ${pct(bloomOut)}, transparent ${pct(bloomOut + cfg.blur)})`,
  );
  return layers.join(', ');
}

/** Reflect the tuned arc onto :root so the pure-CSS element picks the current values up live. */
export function applyAlignArcVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--aa-w', `${cfg.width}%`);
  root.setProperty('--aa-h', `${cfg.depth + cfg.glowStroke / 2 + cfg.blur}px`);
  root.setProperty('--aa-y', `${cfg.y}px`);
  root.setProperty('--aa-op', String(cfg.on ? 1 : 0));
  root.setProperty('--aa-grad-dawn', arcGradient(cfg.dawnColor));
  root.setProperty('--aa-grad-dusk', arcGradient(cfg.duskColor));
  root.setProperty('--aa-grad-eclipse', arcGradient(cfg.eclipseColor));
}

export function setAlignArcConfig(patch: Partial<AlignArcConfig>): void {
  cfg = { ...cfg, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  applyAlignArcVars();
}

export function resetAlignArcConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyAlignArcVars();
}

// Apply on module load, so the shipped look is live before any tuner is opened (the same self-applying
// contract every other CSS config module has).
applyAlignArcVars();
