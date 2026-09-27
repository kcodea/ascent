import { canPlayDefs, playDef } from '../fx/playDef';
import { getAncientsConfig } from './ancientsConfig';

/**
 * THE ANCIENTS' PIXI, RESTRAINED (owner 2026-09-25: "the smoke effect is all biffed and so sloppy. make the animation
 * cleaner"). Less is more, and nothing new is invented:
 *  · each slam plays the Runeforge tablet landing's OWN dust def (`runeforge-land-dust`, the owner-approved tuning),
 *    only tinted to the Ancient's colour, centred on the card's bottom edge, on the main FX canvas (z110) so it
 *    sits UNDER the offer's cards (z160) and never over the art;
 *  · the eruption is one short burst of that same dust from the hero power, in the curtain's colour;
 *  · a flat gold shockwave (`ancient-slam`) under each slam.
 * Nothing loops: no curtain smoke, no settled particles. Dials: the ✦ Ancients "Dust" rows (count / size / life /
 * opacity, the Runeforge entrance's pattern) and "Hero-power dust life".
 */
type Pt = { x: number; y: number };

function shade(hex: string, k: number): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number): number => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** The Runeforge dust's four stops (rim → core), tinted to one colour: muted, never blown out on the dark backdrop. */
function tint(col: string): number[] {
  return [shade(col, -0.5), shade(col, -0.25), shade(col, 0.05), shade(col, 0.35)];
}

/** The width the Runeforge landing dust is tuned for (a rune tablet, px). */
const RUNE_TABLET_PX = 170;

/** One clean puff of the Runeforge landing dust at `at`, tinted `color`. `lifeMul` shortens it (the eruption);
 *  `widthPx` is the width of what landed (the dust is sized in proportion). */
export function ancientLandDust(color: string, at: Pt, lifeMul = 1, widthPx = RUNE_TABLET_PX, boost = 1): (() => void) | null {
  const c = getAncientsConfig();
  if (!canPlayDefs() || c.dustAmount <= 0 || c.dustOpacity <= 0) return null;
  // Scaled to the thing that lands: the def is tuned for a rune tablet, an Ancient card is wider, so the same puff is
  // sized in proportion (it spreads just past the card's edges, where it shows from under the card).
  const fit = Math.max(0.5, Math.min(3, widthPx / RUNE_TABLET_PX));
  return playDef('runeforge-land-dust', { source: at, target: at, cursor: at }, {
    // `boost` (the reveal slams' `slamDust`): more dust, spread a little wider, so a slam visibly throws it out.
    intensity: c.dustAmount * boost, scale: c.dustSize * fit * (1 + (boost - 1) * 0.25), time: c.dustLife * lifeMul, alpha: c.dustOpacity,
    recolor: tint(color), slot: 'over',
  }) ?? null;
}

/** The slam's SPARK BLAST (owner 2026-09-26: "add some pixi blast sparks to the overall reveal animations with some
 *  turbulence"): hot shards thrown up and out plus drifting embers, both pushed around by turbulence, in the
 *  Ancient's colour. One-shot; `slamSparks` scales it (0 = none). */
export function ancientSlamSparks(color: string, at: Pt): void {
  const c = getAncientsConfig();
  if (!canPlayDefs() || c.slamSparks <= 0) return;
  playDef('ancient-slam-sparks', { source: at, target: at, cursor: at }, {
    intensity: c.slamSparks, scale: Math.max(0.3, c.slamStrength), recolor: tint(color), slot: 'over',
  });
}

/** The slam's flat gold shockwave at `at`, scaled by the slam strength. */
export function ancientSlam(at: Pt): void {
  if (!canPlayDefs()) return;
  playDef('ancient-slam', { target: at }, { scale: Math.max(0.3, getAncientsConfig().slamStrength) });
}

/** THE PICK'S IMPACT on the hero power (owner 2026-09-27: "a slight pixi burst"): one crisp round ring and a few
 *  fast sparks (`ancient-pick-impact`), in the chosen Ancient's colour, at the moment its slam releases. No
 *  confetti, no lingering particles. `scale` is the tuner's "Burst size" (0 = none). */
export function ancientPickBurst(color: string, at: Pt, scale: number, intensity = 1, alpha?: number): void {
  if (!canPlayDefs() || scale <= 0) return;
  // Brighter than the dust's muted tint: this is a flash of light off the hit, rim in the colour, core white-hot.
  playDef('ancient-pick-impact', { source: at, target: at, cursor: at }, { scale, intensity, recolor: [shade(color, -0.1), shade(color, 0.2), shade(color, 0.55), 0xffffff], slot: 'over', ...(alpha != null ? { alpha } : {}) });
}
