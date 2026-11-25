/**
 * PACK OPENING: the card flip's FIRST HALF as pure math (spec §6 "The flip handoff"). The scene turns the top card from
 * 0 to 90 degrees about its vertical axis with real perspective while it moves half way toward its featured slot; at 90
 * degrees it hands the card to a DOM face, which finishes 90 -> 0 and the rest of the move with the same perspective
 * (`FLIP_PERSPECTIVE_PER_WIDTH` x the card's on-screen width). The left edge swings toward the camera and the right
 * edge away, so the card turns off to the right. No Pixi, no allocation: results are written into caller-owned objects.
 */

import type { CrateRarity } from '@game/progression';

/** The flip's perspective distance as a multiple of the card's on-screen width (the DOM half uses the same). */
export const FLIP_PERSPECTIVE_PER_WIDTH = 4;
/**
 * THE REVEAL LAYOUT (owner 2026-11-23: "have the pack slide to the left slightly and have the card flip over and land on
 * the right side"). Tuning values, as fractions of the theatre (the scene's host, the same box as the stage viewport):
 * - `REVEAL_STACK_X`: where the zoomed stack's centre settles once the first card flips (it zooms to dead centre first).
 * - `REVEAL_FACE_X`: where the featured face's centre lands (the flip travels right from the stack to here).
 * - `REVEAL_Y`: the shared vertical centre of both, so the face lands level with the stack it left.
 */
export const REVEAL_STACK_X = 0.34;
export const REVEAL_FACE_X = 0.66;
export const REVEAL_Y = 0.47;
/**
 * The revealed pile's size over the draw pile's (owner 2026-11-23: "the revealed pile should be slightly larger than the
 * draw pile"): a face in the pile is this many times the zoomed back's RESTING on-screen size. The face grows to it from
 * the handoff size while it turns, so nothing pops.
 */
export const REVEALED_SCALE = 1.12;
/**
 * The tallest a revealed face may be, as a share of the theatre's height: keeps the pile clear of the live line and the
 * buttons whatever the stack zoom (the scene's fit uses the same cap, so the edge rect never exceeds it either).
 */
export const PILE_MAX_H = 0.76;

/**
 * How much the card lifts (grows) by edge-on: an ordinary card, and the guaranteed card (the biggest flip). Both stay at
 * or under `REVEALED_SCALE - 1`, so a face never shrinks while it lands in the pile.
 */
export const FLIP_LIFT = 0.08;
export const FLIP_LIFT_GUARANTEED = 0.12;

/** The flip's first half (ms): an ordinary card, and the guaranteed card (the biggest flip). */
export const FLIP_HALF_MS = 260;
export const FLIP_HALF_GUARANTEED_MS = 380;

/**
 * The flip's first half by rarity (ms): the better the card, the slower and heavier the turn, so a big pull is felt
 * coming before its face shows (owner 2026-11-24: "the building excitement of potentially uncovering something great").
 * Common and Rare keep the ordinary turn; a guaranteed card never turns faster than the guaranteed flip.
 */
export const FLIP_HALF_BY_RARITY: Readonly<Record<CrateRarity, number>> = {
  common: FLIP_HALF_MS, rare: FLIP_HALF_MS, epic: 330, legendary: 460, ancient: 560,
};
export const flipHalfMs = (rarity: CrateRarity | undefined, guaranteed: boolean): number =>
  Math.max(guaranteed ? FLIP_HALF_GUARANTEED_MS : FLIP_HALF_MS, rarity ? FLIP_HALF_BY_RARITY[rarity] : FLIP_HALF_MS);

/** The card sinks this much (of its size) as the turn starts, then lifts: the wind-up before the throw. */
export const FLIP_DIP = 0.04;

/** Where a flip starts and heads (any one 2D space), the card's scale at the start, and how much it lifts by 90 deg. */
export interface FlipPath { c0x: number; c0y: number; tx: number; ty: number; scale: number; lift: number }
export interface FlipPose { cx: number; cy: number; s: number }

/** The card's centre and scale at progress p (0..1): it covers HALF the way to its target (the DOM covers the rest). */
export function flipPoseAt(path: FlipPath, p: number, out: FlipPose): FlipPose {
  const move = 0.5 * (1 - (1 - p) * (1 - p));
  out.cx = path.c0x + (path.tx - path.c0x) * move;
  out.cy = path.c0y + (path.ty - path.c0y) * move;
  out.s = path.scale * (1 + path.lift * p - FLIP_DIP * Math.sin(Math.PI * Math.min(1, Math.max(0, p) / 0.32)));
  return out;
}

/** The turn at progress p (radians): accelerating into edge-on, stopping a hair short of 90 degrees (never degenerate). */
export const flipAngle = (p: number): number => (Math.PI / 2) * Math.min(0.9985, 0.35 * p + 0.65 * p * p);

/**
 * A card-local rect (x0,y0)-(x1,y1) (unscaled units, about the card's centre) turned by `ang` about the card's vertical
 * axis and seen with perspective `D`, at centre (cx, cy) and scale `s`. Writes the four corners clockwise from the
 * top-left into `out` (x0,y0, x1,y1, x2,y2, x3,y3), ready for `PerspectiveMesh.setCorners`.
 */
export function projectTurnedRect(
  out: Float64Array, cx: number, cy: number, s: number, ang: number, D: number,
  x0: number, y0: number, x1: number, y1: number,
): Float64Array {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  // depth toward the camera is -x*sin: the left edge (x < 0) comes forward and grows
  const fl = D / Math.max(1, D + x0 * s * sin), fr = D / Math.max(1, D + x1 * s * sin);
  const lx = cx + x0 * s * cos * fl, rx = cx + x1 * s * cos * fr;
  out[0] = lx; out[1] = cy + y0 * s * fl;
  out[2] = rx; out[3] = cy + y0 * s * fr;
  out[4] = rx; out[5] = cy + y1 * s * fr;
  out[6] = lx; out[7] = cy + y1 * s * fl;
  return out;
}
