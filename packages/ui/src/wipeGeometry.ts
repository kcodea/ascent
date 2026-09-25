/**
 * WIPE GEOMETRY — the pure maths behind the combat <-> shop curtain's radial bloom (see Recruit's wipe state
 * machine and `.wipecurtain` / `.wipefront` in styles.css). Kept DOM-free so it can be unit-tested at any
 * aspect ratio.
 *
 * Owner bug 2026-09-24: "the screen wipes between combat/shop seem not built for 21:9 and stop/pause here".
 * The curtain's clip radius was already the farthest-corner distance, but the glowing RING that rides the
 * seam was a fixed 1000px texture scaled to a hard-coded `4.4` (a ~2130px ring) — `--wipe-front-scale` was
 * documented as "set by Recruit" but never was. That size only suits a 16:9 screen: on 21:9 / 32:9 the ring
 * decelerated to a halt mid-screen while the blue still had half the width to cover, which read as the
 * wipe stalling. Both sizes now derive from the LIVE viewport through the helpers below.
 */

/** Extra pixels past the farthest corner, so antialiasing on the circle's edge can never leave a corner
 *  pixel half-covered on the final frame of the bloom. */
export const WIPE_COVER_PAD_PX = 2;

/** `.wipefront` is a FIXED `WIPE_FRONT_TEXTURE_PX` square scaled up by the compositor (see styles.css). */
export const WIPE_FRONT_TEXTURE_PX = 1000;

/** Where the ring's brightest stop sits, as a fraction of the texture's radius (the `97%` stop in the
 *  `.wipefront` radial gradient, `closest-side`). The glow's fringe runs on to 100%. */
export const WIPE_FRONT_RING_FRAC = 0.97;

export interface WipeOrigin {
  /** Bloom centre (the End Turn / End Combat gem), viewport px. */
  cx: number;
  cy: number;
  /** Clip radius at full cover: the distance to the farthest viewport corner (+ pad), px. */
  r: number;
  /** `.wipefront` scale at full cover: puts the ring's bright line exactly on the seam at radius `r`, so
   *  the ring rides the clip edge the whole way out and leaves past the farthest corner. */
  frontScale: number;
}

/** The radius that covers the WHOLE viewport from (cx, cy): the distance to the farthest corner, rounded up,
 *  plus a small antialiasing pad. Works for any aspect ratio and any anchor (even one off-screen). */
export function wipeCoverRadius(cx: number, cy: number, vw: number, vh: number): number {
  const dx = Math.max(Math.abs(cx), Math.abs(vw - cx));
  const dy = Math.max(Math.abs(cy), Math.abs(vh - cy));
  return Math.ceil(Math.hypot(dx, dy)) + WIPE_COVER_PAD_PX;
}

/** The `.wipefront` scale whose bright ring line lands on radius `r`. */
export function wipeFrontScale(r: number): number {
  return r / ((WIPE_FRONT_TEXTURE_PX / 2) * WIPE_FRONT_RING_FRAC);
}

/** The bloom's origin + full-cover sizes for a viewport. `gem` is the gem's bounding rect (null = not
 *  mounted: fall back to where it sits on the stage). */
export function wipeOriginFor(
  vw: number,
  vh: number,
  gem: { left: number; top: number; width: number; height: number } | null,
): WipeOrigin {
  const cx = gem ? gem.left + gem.width / 2 : vw * 0.84;
  const cy = gem ? gem.top + gem.height / 2 : vh * 0.62;
  const r = wipeCoverRadius(cx, cy, vw, vh);
  return { cx, cy, r, frontScale: wipeFrontScale(r) };
}
