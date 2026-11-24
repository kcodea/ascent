/**
 * PACK OPENING: the sealed pack's mouse tilt and the surface gloss band. Pure maths (no Pixi), so it is testable.
 *
 * TILT (owner 2026-11-23: "give the card pack some subtle movement based off your mouse position. use the same exact
 * pixi effects we use for our card tilt in game", and "once you start opening the pack it stays still"). The source is
 * the in-game DRAG DIVE (Recruit.tsx's `.dragcard`, dragFeel.ts): the same ceiling (`tiltMax`), the same eased build
 * and settle (`tiltEase`, per 60 Hz frame, frame-rate independent), the same rotateX / rotateY order and signs, and the
 * same perspective depth (`perspective`, stage px, divided by the pack's on-stage scale into base units). What differs
 * is the DRIVE: the drag dive leans on the card's travel; the pack leans on the pointer's POSITION over it, a normalised
 * offset from its centre (-1..1) times `tiltMax x packTilt` (the Pack Lab's knob). The edge nearest the cursor dips,
 * exactly like the dive's leading edge. Only while sealed: grabbing the tear (or quick open) eases it flat (~150 ms at
 * the owner's `tiltEase` 0.4) and it stays flat until `resetSealed`.
 *
 * GLOSS (owner: "can we add a gloss over the surface?"): one soft specular band across the pack, sliding with the
 * cursor and the tilt. `glossBandInto` places it; the body samples one pre-drawn band texture at `0.5 + d / 2`, the
 * strip's spec lookup reads `glossStripU`, and both give the profile `1 - 3.125 d^2`, so the band crosses the tear seam
 * unbroken.
 */

/** The tilt as it eases: the aim (normalised pointer offset, -1..1) and the angles (degrees), all smoothed. */
export interface TiltState { ax: number; ay: number; rx: number; ry: number }

export const newTilt = (): TiltState => ({ ax: 0, ay: 0, rx: 0, ry: 0 });

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/** A pointer at (px, py) in pack base units as a normalised offset from the centre of a `w` x `h` pack, each axis -1..1. */
export function aimInto(out: { x: number; y: number }, px: number, py: number, w: number, h: number): { x: number; y: number } {
  out.x = clamp((px - w / 2) / (w / 2), -1, 1);
  out.y = clamp((py - h / 2) / (h / 2), -1, 1);
  return out;
}

/**
 * The tilt's target angles (degrees) for a normalised aim: `tiltMax x packTilt` at the edge, clamped there, and flat
 * unless `sealed`. Signs are the drag dive's (screen y is down): aim right -> rotY > 0 (the right edge recedes), aim
 * down -> rotX < 0 (the bottom edge recedes), so the pack leans toward the cursor.
 */
export function tiltTargetInto(
  out: { rx: number; ry: number }, nx: number, ny: number, tiltMax: number, packTilt: number, sealed: boolean,
): { rx: number; ry: number } {
  const max = Math.max(0, tiltMax) * Math.max(0, packTilt);
  if (!sealed || !(max > 0)) { out.rx = 0; out.ry = 0; return out; }
  out.ry = clamp(nx * max, -max, max);
  out.rx = clamp(-ny * max, -max, max);
  return out;
}

/** The drag dive's ease per step: `tiltEase` per 60 Hz frame, frame-rate independent (Recruit.tsx). 1 = instant. */
export const tiltEaseK = (tiltEase: number, dtMs: number): number =>
  (tiltEase >= 1 ? 1 : 1 - Math.pow(1 - clamp(tiltEase, 0, 1), Math.max(0, dtMs) / 16.667));

/** Below this (degrees, and aim units) the tilt snaps to its target, so it settles exactly and the scene can idle. */
const SETTLE = 0.005;

/**
 * Ease the state toward its targets by `k` (`tiltEaseK`). Returns false once everything has settled (nothing moved, so
 * the scene skips the vertex rewrite).
 */
export function stepTilt(s: TiltState, aimX: number, aimY: number, rx: number, ry: number, k: number): boolean {
  const moving = s.ax !== aimX || s.ay !== aimY || s.rx !== rx || s.ry !== ry;
  s.ax = easeTo(s.ax, aimX, k);
  s.ay = easeTo(s.ay, aimY, k);
  s.rx = easeTo(s.rx, rx, k);
  s.ry = easeTo(s.ry, ry, k);
  return moving;
}

function easeTo(from: number, to: number, k: number): number {
  const next = from + (to - from) * k;
  return Math.abs(to - next) < SETTLE ? to : next;
}

/** The pack plane's 3D pose: rotateX(rx) rotateY(ry) about (cx, cy), seen with perspective depth `D` (base units). */
export interface TiltPose { flat: boolean; cx: number; cy: number; D: number; cosX: number; sinX: number; cosY: number; sinY: number }

export const newTiltPose = (): TiltPose => ({ flat: true, cx: 0, cy: 0, D: 600, cosX: 1, sinX: 0, cosY: 1, sinY: 0 });

/** Set `pose` for angles in degrees. `flat` when both are zero (callers then skip the mapping: identity). */
export function setTiltPose(pose: TiltPose, rxDeg: number, ryDeg: number, cx: number, cy: number, D: number): TiltPose {
  const rx = (rxDeg * Math.PI) / 180, ry = (ryDeg * Math.PI) / 180;
  pose.flat = rxDeg === 0 && ryDeg === 0;
  pose.cx = cx; pose.cy = cy; pose.D = Math.max(40, D);
  pose.cosX = Math.cos(rx); pose.sinX = Math.sin(rx);
  pose.cosY = Math.cos(ry); pose.sinY = Math.sin(ry);
  return pose;
}

/**
 * A pack-plane point (x, y) at height z (toward the camera) through the tilt: CSS `rotateX(rx) rotateY(ry)` about the
 * pivot (rotateY first, as CSS composes it), then the perspective divide `D / (D - z)`, the same projection the strip
 * uses (`stripMesh.ts projInto`). Writes `out`.
 */
export function tiltInto(out: { x: number; y: number }, x: number, y: number, z: number, p: TiltPose): { x: number; y: number } {
  const dx = x - p.cx, dy = y - p.cy;
  // rotateY: x' = x cos + z sin, z' = -x sin + z cos (a positive angle sends the right edge away)
  const x1 = dx * p.cosY + z * p.sinY, z1 = -dx * p.sinY + z * p.cosY;
  // rotateX: y' = y cos - z sin, z' = y sin + z cos (a negative angle sends the bottom edge away)
  const y2 = dy * p.cosX - z1 * p.sinX, z2 = dy * p.sinX + z1 * p.cosX;
  const f = p.D / Math.max(40, p.D - z2);
  out.x = p.cx + x1 * f;
  out.y = p.cy + y2 * f;
  return out;
}

// ---------------------------------------------------------------- the gloss band

/** Where the gloss band sits: d = (x + slope (y - cy) - centre) / halfWidth, -1..1 across it. `alpha` is the body's. */
export interface GlossBand { centre: number; cy: number; halfWidth: number; slope: number; alpha: number; stripAmp: number }

export const newGlossBand = (): GlossBand => ({ centre: 0, cy: 0, halfWidth: 1, slope: 0, alpha: 0, stripAmp: 0 });

/** The band's lean: it runs from upper right to lower left, like the idle sheen. */
const GLOSS_SLOPE = 0.35;
/** The strip's spec lookup peaks at u = 0.25 (paintSpec's glint). */
const SPEC_PEAK_U = 0.25;

/**
 * Place the gloss band on a `w` x `h` pack. Strength `gloss` (0..1.5) and finish `sharp` (0 satin: wide and soft, 1
 * glassy: narrow and bright). It slides against the eased aim (a reflection moves opposite the hand) and further with
 * the tilt (`ry`, `rx` in degrees over `tiltMax`).
 */
export function glossBandInto(
  out: GlossBand, gloss: number, sharp: number, aimX: number, aimY: number, rx: number, ry: number, tiltMax: number,
  w: number, h: number,
): GlossBand {
  const g = Math.max(0, gloss), s = clamp(sharp, 0, 1);
  const tx = tiltMax > 0 ? ry / tiltMax : 0, ty = tiltMax > 0 ? -rx / tiltMax : 0;
  out.centre = w / 2 - w * (0.45 * aimX + 0.25 * aimY) - w * (0.35 * tx + 0.2 * ty);
  out.cy = h / 2;
  out.halfWidth = w * (0.9 - 0.6 * s);
  out.slope = GLOSS_SLOPE;
  out.alpha = Math.min(1, g * (0.6 + 0.6 * s));
  // fades in over the knob's first 0.15 so a tiny value never pops a full band onto the strip
  out.stripAmp = g > 0 ? SPEC_PEAK_U * Math.min(1, g / 0.15) : 0;
  return out;
}

/** The band coordinate of a pack-plane point: 0 at the band's centre line, +-1 at its edges. */
export const glossD = (b: GlossBand, x: number, y: number): number => (x + b.slope * (y - b.cy) - b.centre) / b.halfWidth;

/**
 * The strip's spec-lookup u for a vertex at surface angle `th` (radians, the curl) and band coordinate `d`: the band
 * adds a bump that peaks on the spec's glint, so the flat sealed strip shows the band, and it rides the curl. With no
 * gloss (`amp` 0) it is exactly the old `th / PI`.
 */
export const glossStripU = (th: number, d: number, amp: number): number =>
  Math.min(0.999, th / Math.PI + (amp > 0 ? amp * Math.max(0, 1 - d * d) : 0));

/** The strip spec mesh's alpha: the Highlight knob, brightened by the gloss. */
export const glossSpecAlpha = (highlight: number, gloss: number): number => Math.min(1, Math.max(0, highlight) + 0.35 * Math.max(0, gloss));
