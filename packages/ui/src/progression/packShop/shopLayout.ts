/**
 * Pack shop layout maths: where each thing sits on a `w` x `h` scene (px, y down). Pure; the `*Into` functions write
 * into `out` and return it, so a per-frame caller allocates nothing.
 *
 * Three zones top to bottom: the shelf (the centre slot is the pedestal, holding a larger pack), the counter line (a
 * purchase crosses it), and the hand of owned packs.
 */
import { PACK_BASE_SIZE } from '../packOpening/packFxConfig';

/** Places in the hand's fan; when more are owned the last place is the counted pile. */
export const HAND_FAN_MAX = 7;

export interface ShopLayout {
  w: number; h: number;
  shelfY: number; lineY: number; handY: number;
  /** The line every shelf pack stands on (their BOTTOMS share it). */
  floorY: number;
  /** A shelf pack's height (off the pedestal). */
  packH: number;
  /**
   * The pedestal pack's height. Not the opener's sealed size (about 0.63 of the height, which crowded the tab bar and the
   * counter line): a played pack grows to the opener's size on its way there (`shopScene.ts`).
   */
  pedestalH: number;
  /** A pack in the hand. */
  handPackH: number;
  /** Centre-to-centre distance between neighbouring shelf packs (off the pedestal). */
  slotStep: number;
}

/** `rot` is radians. */
export interface PackPose { x: number; y: number; h: number; rot: number; alpha: number }

const ASPECT = PACK_BASE_SIZE.w / PACK_BASE_SIZE.h;
/** The pedestal pack's height, in canvas heights. */
const PEDESTAL_H = 0.46;
const SHELF_SCALE = 0.72;
/** The line the packs' feet share, in canvas heights. */
const FLOOR_Y = 0.62; // owner 2026-11-25: "move the shop display packs down a bit" (was 0.585)
/** A pack in the hand lies on the counter, nearer than the shelf: it is drawn reclined (`shopScene.ts HAND_RECLINE`), so
 *  its drawn height is well under this. */
const HAND_SCALE = 0.6;
/** Past this many steps from the pedestal a slot is invisible; it fades in over the last `FADE_STEPS`. */
const FADE_END = 2.6;
const FADE_STEPS = 0.6;
/** Extra room between the (larger) pedestal pack and its neighbours, in shelf pack widths. */
const PEDESTAL_GAP = 0.2;
/** Lean per place from the hand's centre (radians) and how far the outer packs sag. */
/** How far back a pack in the hand lies on the counter (degrees): its drawn height is `cos` of this of its own. */
export const HAND_RECLINE = 52;
const HAND_LEAN = 0.035;
const HAND_SAG = 0; // a row lying on the counter does not sag (it did, as a held fan)

export function shopLayout(w: number, h: number): ShopLayout {
  const pedestalH = PEDESTAL_H * h;
  const packH = SHELF_SCALE * pedestalH;
  const handPackH = HAND_SCALE * pedestalH;
  return {
    w, h,
    // the packs STAND on one line: bottoms on `floorY`. `shelfY` is the pedestal pack's centre (the pedestal zone and
    // the spotlight aim there).
    floorY: FLOOR_Y * h,
    shelfY: FLOOR_Y * h - pedestalH / 2, lineY: 0.73 * h, handY: 0.86 * h, // owner 2026-11-25: "lower the table by a good amount" (the line was 0.66)
    packH, pedestalH, handPackH,
    slotStep: packH * ASPECT * 1.25,
  };
}

export function shelfPoseInto(out: PackPose, L: ShopLayout, index: number, scroll: number): PackPose {
  const d = index - scroll, a = Math.abs(d);
  const near = Math.min(1, a);
  out.x = L.w / 2 + Math.sign(d) * (a * L.slotStep + near * PEDESTAL_GAP * L.packH * ASPECT);
  out.h = L.pedestalH - (L.pedestalH - L.packH) * near;
  out.y = L.floorY - out.h / 2; // standing on the line
  out.rot = 0;
  out.alpha = Math.max(0, Math.min(1, (FADE_END - a) / FADE_STEPS));
  return out;
}

/** Where a rack of `count` offers starts: the middle offer on the pedestal, so both sides of the shelf are filled. */
export function startScroll(count: number): number {
  return Math.max(0, Math.floor((count - 1) / 2));
}

export function clampScroll(scroll: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, scroll));
}

export function handPile(count: number): { shown: number; piled: number } {
  if (count <= HAND_FAN_MAX) return { shown: Math.max(0, count), piled: 0 };
  return { shown: HAND_FAN_MAX - 1, piled: count - (HAND_FAN_MAX - 1) };
}

/** Place `index` of a hand fanning `shown` places (include the pile's place when there is one). */
export function handPoseInto(out: PackPose, L: ShopLayout, index: number, shown: number): PackPose {
  const o = index - (shown - 1) / 2;
  out.x = L.w / 2 + o * L.handPackH * ASPECT * 0.85;
  out.y = L.handY + o * o * HAND_SAG * L.handPackH;
  out.h = L.handPackH;
  out.rot = o * HAND_LEAN;
  out.alpha = 1;
  return out;
}
