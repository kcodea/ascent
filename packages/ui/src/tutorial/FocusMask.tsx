/**
 * TUTORIAL — the focus mask (spotlight).
 *
 * A single root-level, full-screen `fixed; inset:0` layer that dims everything EXCEPT the cutouts, so the eye
 * lands on the coached target. Matches the game's overlay convention (`.inspect-ov`: `inset:0`, dim bg) but
 * sits higher (z ~600) so it floats above the inspect popover (z-500).
 *
 * IMPLEMENTATION — one SVG `<mask>`: a full white rect with black rounded-rects punched out for each cutout,
 * applied to a single dim `<rect>`. That's one composited layer (no four-div framing tricks, no per-cutout
 * DOM churn). An outline `<rect>` is stroked around each hole so the focus reads without relying on color
 * alone. The layer is `pointer-events: none`, so the live control under the hole stays clickable — the game
 * owns the actual input; the mask only directs attention.
 *
 * PERF: rects are passed IN (measured once upstream, cached). We animate only `opacity` on mount (a one-shot
 * ~180ms transition) — no paint-property animation in any loop.
 */

import { useEffect, useState } from 'react';

/** One spotlight hole. `padding` is the breathing room around the rect (default 14px); `radius` the corner
 *  round; `shape` picks a sensible default radius/rounding when `radius` is omitted. */
export interface FocusCutout {
  rect: DOMRect;
  radius?: number;
  padding?: number;
  shape?: 'card' | 'pill' | 'rect' | 'circle';
}

/** Default corner radius per shape when `radius` isn't given. `pill`/`circle` round fully via the rect size. */
function radiusFor(cutout: FocusCutout, w: number, h: number): number {
  if (cutout.radius != null) return cutout.radius;
  switch (cutout.shape) {
    case 'pill':
    case 'circle':
      return Math.min(w, h) / 2;
    case 'card':
      return 16;
    case 'rect':
    default:
      return 12;
  }
}

/**
 * Breathing room around a spotlit element (owner 2026-08-21: "increase the size of the spotlights, a lot of
 * them don't fully cover certain things"). 14px was tight enough that a card's own glow/shadow, a pill's
 * outline, or a row's overflow sat OUTSIDE the hole and stayed dimmed — the highlight read as missing the
 * thing it was pointing at. Scales with the stage so it stays proportional at every resolution.
 */
const BASE_PAD = 26;

/** The stage scale the rest of the UI multiplies its authored sizes by (`--scale`, set by Game.tsx). */
function stageScale(): number {
  if (typeof document === 'undefined') return 1;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Expand a rect by its padding into the {x,y,w,h,r} the SVG rects consume. */
function padded(cutout: FocusCutout, scale = 1): { x: number; y: number; w: number; h: number; r: number } {
  const pad = (cutout.padding ?? BASE_PAD) * scale;
  const x = cutout.rect.left - pad;
  const y = cutout.rect.top - pad;
  const w = cutout.rect.width + pad * 2;
  const h = cutout.rect.height + pad * 2;
  return { x, y, w, h, r: radiusFor(cutout, w, h) };
}

/**
 * The dim-with-holes overlay. `dim` is the base scrim opacity (0.7 default); `combat` lowers it to ~0.55 so
 * the board stays readable during a Predict/Confirm hold. Supports many cutouts (1 primary + secondaries);
 * no hard cap.
 */
export function FocusMask({
  cutouts,
  dim = 0.7,
  combat = false,
}: {
  cutouts: FocusCutout[];
  dim?: number;
  combat?: boolean;
}): JSX.Element {
  // One-shot opacity fade-in on mount (compositor-only; never looped).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const scrim = combat ? Math.min(dim, 0.55) : dim;
  // A stable-enough mask id per mount; the holes are addressed within this SVG only.
  const maskId = 'tut-focus-mask';
  // FEATHER: the hole edges are Gaussian-blurred inside the mask, so the scrim FADES into the cutout instead
  // of ending on a hard square line. A SOFTER edge than the original 11 (owner 2026-08-21: "feather more, not
  // such harsh lines") — the blur is what turns a punched hole into a gradient rather than a cut-out
  // rectangle. Both it and the padding scale with the stage, so the softness stays proportional.
  const scale = stageScale();
  const FEATHER = 22 * scale;
  const holes = cutouts.map((c) => padded(c, scale));

  return (
    <div
      className="tut-focus-mask"
      style={{ opacity: shown ? 1 : 0 }}
      aria-hidden="true"
    >
      <svg className="tut-focus-svg" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          {/* Generous region so the blur isn't clipped at the SVG/object bounds. */}
          <filter id="tut-feather" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={FEATHER} />
          </filter>
          <filter id="tut-feather-ring" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={6 * scale} />
          </filter>
          <mask id={maskId}>
            {/* White = visible scrim; black rounded-rects = punched-out holes, blurred for a soft feathered edge. */}
            <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
            <g filter="url(#tut-feather)">
              {holes.map((h, i) => (
                <rect key={i} x={h.x} y={h.y} width={h.w} height={h.h} rx={h.r} ry={h.r} fill="#000" />
              ))}
            </g>
          </mask>
        </defs>
        {/* The dim scrim, holes cut by the mask. Colour matches the game's warm dark scrim (`.inspect-ov`). */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill={`rgba(26, 16, 6, ${scrim})`}
          mask={`url(#${maskId})`}
        />
        {/* A soft ring around each hole — blurred into a gentle halo so focus reads without colour alone but
            never draws a hard square outline against the feathered scrim. */}
        <g filter="url(#tut-feather-ring)">
          {holes.map((h, i) => (
            <rect
              key={i}
              className="tut-focus-ring"
              x={h.x}
              y={h.y}
              width={h.w}
              height={h.h}
              rx={h.r}
              ry={h.r}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
