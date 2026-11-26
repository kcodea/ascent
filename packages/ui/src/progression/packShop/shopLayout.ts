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
const PEDESTAL_H = 0.414; // owner 2026-11-26: the featured (centre) pack is 10% smaller (was 0.46)
const SHELF_SCALE = 0.8;
/** The line the packs' feet share, in canvas heights. */
const FLOOR_Y = 0.65; // owner 2026-11-25 / 26: the shop's display packs stand lower (was 0.585, then 0.62)
/** A pack in the hand lies on the counter, nearer than the shelf: it is drawn reclined (`shopScene.ts HAND_RECLINE`), so
 *  its drawn height is well under this. */
const HAND_SCALE = 0.667;
/** Steps out from the centre that are shown at full strength (two each side: five packs). */
const SHOWN_STEPS = 2;
/** The pack past them peeks in at the edge: this share of a step further out, this much smaller, at this alpha; it is gone `PEEK_FADE` of a step later. */
const PEEK_STEP = 0.7;
const PEEK_SHRINK = 0.12;
const PEEK_ALPHA = 0.4;
const PEEK_FADE = 0.6;
/** Extra room between the (larger) pedestal pack and its neighbours, in shelf pack widths. */
const PEDESTAL_GAP = 0.2;
/** Half the extra room between the two large packs of a pair, in shelf pack widths. */
const PAIR_GAP = 0.16;
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
    // the shelf packs share ONE CENTRE LINE, `shelfY` (owner 2026-11-26: "make the packs all vertically aligned instead of
    // bottom aligned"); `floorY` is the pedestal pack's foot. `shelfY` is also the pedestal pack's centre (the pedestal zone and
    // the spotlight aim there).
    floorY: FLOOR_Y * h,
    shelfY: FLOOR_Y * h - pedestalH / 2, lineY: 0.73 * h, handY: 0.845 * h, // owner 2026-11-25: "lower the table by a good amount" (the line was 0.66)
    packH, pedestalH, handPackH,
    slotStep: packH * ASPECT * 1.25,
  };
}

/**
 * `pair` (an even number of offers, owner 2026-11-26: "when there are even amounts of packs for sale in a window can you
 * make sure they are centered? make two center most packs the larger size"): the rack is centred BETWEEN offers `scroll`
 * and `scroll + 1`, and both of them are the pedestal size.
 */
export function shelfPoseInto(out: PackPose, L: ShopLayout, index: number, scroll: number, pair = false): PackPose {
  const half = pair ? 0.5 : 0;
  const d = index - scroll - half, a = Math.abs(d);
  const e = a - half; // steps out from the centre pack (or pair)
  const near = Math.max(0, Math.min(1, e));
  // PAST THE FIVE SHOWN (owner 2026-11-26: "have the others on the edge low opacity"): the next pack each side peeks in at
  // the edge, closer in than a full step, a little smaller and faded; the ones beyond it are gone.
  const over = Math.max(0, e - SHOWN_STEPS);
  const steps = Math.min(a, SHOWN_STEPS + half) + Math.min(over, 1 + PEEK_FADE) * PEEK_STEP;
  // the two large packs of a pair stand a little apart (the offset grows from the centre, so a scroll through it is smooth)
  const apart = pair ? Math.min(a, 0.5) * 2 * PAIR_GAP : 0;
  out.x = L.w / 2 + Math.sign(d) * (steps * L.slotStep + (apart + near * PEDESTAL_GAP) * L.packH * ASPECT);
  out.h = (L.pedestalH - (L.pedestalH - L.packH) * near) * (1 - PEEK_SHRINK * Math.min(1, over));
  out.y = L.shelfY; // every shelf pack is centred on the one line, whatever its size
  out.rot = 0;
  out.alpha = over <= 1 ? 1 - (1 - PEEK_ALPHA) * over : Math.max(0, PEEK_ALPHA * (1 - (over - 1) / PEEK_FADE));
  return out;
}

/** The most packs a shelf shows at full strength; a longer shelf scrolls (owner 2026-11-26: "more than 5"). */
export const SHELF_SHOWN = 5;
/** A shelf of 2 or 4 is posed as a pair (`shelfPoseInto`): centred on its two middle packs. */
export const isPairRack = (count: number): boolean => count > 0 && count <= SHELF_SHOWN && count % 2 === 0;
/**
 * The scroll range of a rack (`scroll` is its centre pack; a pair rack's is its LEFT centre pack). A shelf of up to
 * `SHELF_SHOWN` shows every pack, so it stays centred. A longer one scrolls with a full row always showing: its centre
 * runs from the third pack to the third from last.
 */
export function rackRange(count: number): { min: number; max: number } {
  if (count <= 0) return { min: 0, max: 0 };
  if (count <= SHELF_SHOWN) { const c = isPairRack(count) ? count / 2 - 1 : (count - 1) / 2; return { min: c, max: c }; }
  const side = (SHELF_SHOWN - 1) / 2;
  return { min: side, max: count - 1 - side };
}
export function clampRack(scroll: number, count: number): number {
  const r = rackRange(count);
  return Math.max(r.min, Math.min(r.max, scroll));
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
  out.x = L.w / 2 + o * L.handPackH * ASPECT * 1.08; // owner 2026-11-26: "a little more space between the pack sections" (was 0.85)
  out.y = L.handY + o * o * HAND_SAG * L.handPackH;
  out.h = L.handPackH;
  out.rot = o * HAND_LEAN;
  out.alpha = 1;
  return out;
}
