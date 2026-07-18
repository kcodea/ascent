import type { CSSProperties } from 'react';

/**
 * FLURRY (keyword `W`) persistent aura — wind blades swirling the card. Pure CSS, following the Ward/Reborn
 * playbook: a `.flurry` stack rendered by Card.tsx (so it rides drag + the combat lunge for free and vanishes
 * the instant the sim clears the `W` keyword — NO Pixi persistence, which is what fought `syncShields` for
 * ward/reborn). Pixi is reserved for the one-shot sparkle on the actual extra-attack swing (added separately).
 *
 * Each ring is a STATIC `conic-gradient` of N comet arcs (alpha ramps up the tail into a hard bright leading
 * edge, then cuts — that profile reads as a BLADE) masked to a thin band by a radial-gradient. Rings spin via
 * a TRANSFORM-only loop; a per-ring wrapper carries the width/height squash (scaleX/scaleY) so the blades sweep
 * an ellipse; the whole aura breathes on OPACITY only. Gradients + blur are static paint computed once here —
 * only transform/opacity animate, per the perf rule (docs/performance.md).
 *
 * Values owner-tuned in `apps/web/public/fx/flurry-preview.html` (2026-07-17); that rig stays the tuning tool.
 */
export interface FlurryRing {
  /** Ring diameter as a fraction of the aura box (1 = full box). */
  d: number;
  /** Width squash (× — <1 thinner, >1 wider). Static transform on the ring's wrapper. */
  scaleX: number;
  /** Height squash (× — <1 shorter, >1 taller). */
  scaleY: number;
  /** Band thickness (% of the ring's radius) — how fat the swirl track is. */
  thick: number;
  /** Number of comet blades evenly spaced around the ring. */
  blades: number;
  /** Blade tail length (° of arc) — the fading trail behind each leading edge. */
  tail: number;
  /** Leading-edge sharpness (° of arc) — the bright front of each blade. */
  edge: number;
  /** Layer opacity (0–1). */
  alpha: number;
  /** Static blur (px) softening the blades. */
  blur: number;
  /** Spin period — seconds per full revolution. */
  s: number;
  /** Blade colour (hex). */
  col: string;
  /** Reverse the spin direction. */
  rev: boolean;
}

interface FlurryConfig {
  /** Aura box size as a fraction of the card width (--ccw). */
  size: number;
  /** Vertical centre of the aura (% of the card). */
  y: number;
  /** Global cyclone squash (scaleY of the whole aura). */
  squash: number;
  /** Breathe cycle (s). 0 = steady. */
  pulse: number;
  /** Breathe dip (opacity floor). */
  pulseMin: number;
  rings: FlurryRing[];
}

export const FLURRY: FlurryConfig = {
  size: 1.37,
  y: 48,
  squash: 0.91,
  pulse: 3.4,
  pulseMin: 0.72,
  rings: [
    { d: 0.945, scaleX: 0.83, scaleY: 1.22, thick: 2,   blades: 3, tail: 39, edge: 40, alpha: 1, blur: 2, s: 3.8, col: '#c8f4ff', rev: false },
    { d: 0.765, scaleX: 0.83, scaleY: 1.22, thick: 4.5, blades: 3, tail: 39, edge: 40, alpha: 1, blur: 2, s: 8.3, col: '#c8f4ff', rev: false },
    { d: 1.025, scaleX: 0.83, scaleY: 1.22, thick: 2,   blades: 3, tail: 39, edge: 40, alpha: 1, blur: 2, s: 1.8, col: '#c8f4ff', rev: false },
  ],
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** N comet arcs: transparent gap → tail ramp → bright leading edge → hard cut. */
function cometBg(col: string, blades: number, tail: number, edge: number): string {
  const seg = 360 / blades;
  const stops = ['from -90deg'];
  for (let i = 0; i < blades; i++) {
    const a0 = i * seg;
    const tailStart = a0 + Math.max(0, seg - tail - edge);
    const edgeStart = a0 + Math.max(0, seg - edge);
    const end = a0 + seg;
    stops.push(`${rgba(col, 0)} ${a0}deg`);
    stops.push(`${rgba(col, 0)} ${tailStart}deg`);
    stops.push(`${rgba(col, 0.55)} ${edgeStart}deg`);
    stops.push(`${rgba(col, 1)} ${end - 0.5}deg`);
    stops.push(`${rgba(col, 0)} ${end}deg`);
  }
  return `conic-gradient(${stops.join(', ')})`;
}
/** A thin feathered ring, masking the conic to a band. */
function bandMask(thick: number): string {
  const outer = 99, inner = Math.max(1, outer - thick);
  return `radial-gradient(closest-side, transparent ${inner - 2}%, #fff ${inner}%, #fff ${outer - 1}%, transparent ${outer}%)`;
}

/** The rings with their static paint (gradient + mask) precomputed once — Card.tsx maps over these. */
export const FLURRY_RINGS = FLURRY.rings.map((r) => ({
  ...r,
  bg: cometBg(r.col, r.blades, r.tail, r.edge),
  mask: bandMask(r.thick),
}));

/** Box-level CSS vars for the `.flurry` element (size / vertical seat / squash / breathe). */
export function flurryBoxStyle(): CSSProperties {
  return {
    '--fl-size': FLURRY.size,
    '--fl-y': `${FLURRY.y}%`,
    '--fl-squash': FLURRY.squash,
    '--fl-pulse': `${FLURRY.pulse > 0 ? FLURRY.pulse : 9999}s`,
    '--fl-pulse-min': FLURRY.pulse > 0 ? FLURRY.pulseMin : 1,
  } as CSSProperties;
}
/** Per-ring wrapper: the static width/height squash. */
export function flurryWrapStyle(r: FlurryRing): CSSProperties {
  return { transform: `scale(${r.scaleX}, ${r.scaleY})` };
}
/** Per-ring spinner: diameter inset, the comet paint + band mask, blur/opacity, spin period + direction. */
export function flurryRingStyle(r: (typeof FLURRY_RINGS)[number]): CSSProperties {
  return {
    inset: `${(1 - r.d) * 50}%`,
    background: r.bg,
    WebkitMaskImage: r.mask,
    maskImage: r.mask,
    filter: r.blur > 0 ? `blur(${r.blur}px)` : undefined,
    opacity: r.alpha,
    '--fl-s': `${r.s}s`,
    '--fl-dir': r.rev ? 'reverse' : 'normal',
  } as CSSProperties;
}
