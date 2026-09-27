import { canPlayDefs, playDef } from '../fx/playDef';
import { getAncientsConfig } from './ancientsConfig';

/**
 * THE ANCIENTS' PIXI, RESTRAINED (owner 2026-09-25: "the smoke effect is all biffed and so sloppy. make the animation
 * cleaner"). Less is more:
 *  · the eruption is one short burst of the Runeforge tablet landing's own dust def (`runeforge-land-dust`, the
 *    owner-approved tuning), tinted, from the hero power;
 *  · each Ancient's reveal is a spark (`ancient-reveal-spark`) and a burst: the pick's own ring (`ancient-pick-impact`)
 *    plus the turbulent spark blast (`ancient-slam-sparks`), in its colour;
 *  · the pick: the recoloured triple trail and the ring (see `ancientPickSlam.ts`).
 * Nothing loops: no curtain smoke, no settled particles. All on the main FX canvas (z110), under the offer's cards.
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
    // `boost`: more dust, spread a little wider.
    intensity: c.dustAmount * boost, scale: c.dustSize * fit * (1 + (boost - 1) * 0.25), time: c.dustLife * lifeMul, alpha: c.dustOpacity,
    recolor: tint(color), slot: 'over',
  }) ?? null;
}

/** THE REVEAL'S SPARK (owner 2026-09-27: "if they revealed out of the spark"): motes of the Ancient's colour drawn in
 *  and a faint ring contracting onto the point where the card will appear (`ancient-reveal-spark`), stretched to the
 *  spark's length. `fit` sizes it to the card. */
export function ancientRevealSpark(color: string, at: Pt, fit: number, ms: number): void {
  if (!canPlayDefs()) return;
  playDef('ancient-reveal-spark', { source: at, target: at, cursor: at }, {
    scale: fit, time: Math.max(0.3, ms / 300), recolor: [shade(color, -0.2), shade(color, 0.1), shade(color, 0.45), 0xffffff], slot: 'over',
  });
}

/** THE REVEAL'S BURST: the pick's own ring (`ancient-pick-impact`, so the reveal and the pick speak one language) and
 *  the turbulent spark blast (`ancient-slam-sparks`, owner 2026-09-26: "pixi blast sparks ... with some turbulence"),
 *  in the Ancient's colour, from the spark's point. `burstRing` / `slamSparks` scale them (0 = none). */
export function ancientRevealBurst(color: string, at: Pt, fit: number): void {
  const c = getAncientsConfig();
  if (!canPlayDefs()) return;
  if (c.burstRing > 0) ancientPickBurst(color, at, c.burstRing * fit);
  if (c.slamSparks > 0) {
    playDef('ancient-slam-sparks', { source: at, target: at, cursor: at }, { intensity: c.slamSparks, scale: fit, recolor: tint(color), slot: 'over' });
  }
}

/** THE PICK'S IMPACT on the hero power (owner 2026-09-27: "a slight pixi burst"): one crisp round ring and a few
 *  fast sparks (`ancient-pick-impact`), in the chosen Ancient's colour, at the moment its slam releases. No
 *  confetti, no lingering particles. `scale` is the tuner's "Burst size" (0 = none). */
export function ancientPickBurst(color: string, at: Pt, scale: number, intensity = 1, alpha?: number): void {
  if (!canPlayDefs() || scale <= 0) return;
  // Brighter than the dust's muted tint: this is a flash of light off the hit, rim in the colour, core white-hot.
  playDef('ancient-pick-impact', { source: at, target: at, cursor: at }, { scale, intensity, recolor: [shade(color, -0.1), shade(color, 0.2), shade(color, 0.55), 0xffffff], slot: 'over', ...(alpha != null ? { alpha } : {}) });
}

/** The TRIPLE trail's palette in an Ancient's colour: the gild's own ramp shape (a deep rim through to a near-white
 *  core, `gild-trail`'s gold 8A5A0C → C9901F → F1CB5E → FFF3C4), so the recoloured trail reads as the same light. */
export function ancientTrailPalette(color: string): number[] {
  // Saturated all the way up: the ribbon's banding (gain 2) pushes it toward the top stops, so a near-white top read
  // as cream on the tan board (passes 1 + 2). The top stop is only a light tint of the colour.
  return [shade(color, -0.35), shade(color, 0), shade(color, 0.1), shade(color, 0.3)];
}

/** The reveal's Pixi (the spark's gather + the burst's spark blast), pre-played invisibly and off screen when the
 *  awakening starts, so the first spark pays no first-play cost (a cold first play landed ~130 ms late, 2026-09-27). */
export function warmRevealFx(): void {
  if (!canPlayDefs()) return;
  const at = { x: -4000, y: -4000 };
  playDef('ancient-reveal-spark', { source: at, target: at, cursor: at }, { alpha: 0.001 });
  playDef('ancient-slam-sparks', { source: at, target: at, cursor: at }, { alpha: 0.001, intensity: 0.1 });
}
