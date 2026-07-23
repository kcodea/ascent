import { magnetizesTo } from '@game/sim';
import type { Tribe } from '@game/core';
import type { CardView } from './Card';

/**
 * The PURE drag-decision layer: everything the recruit render draws differently as the pointer moves during a
 * card drag, computed from the pointer position + drag context, with NO React and NO DOM. One source of truth,
 * called from two places:
 *
 *  - the render body (`Recruit`), which turns the decision into the drop-gap slides, magnetize/cast highlights
 *    and FLIP key, exactly as the inline block used to; and
 *  - `flushMove` (the pointermove handler), which computes the decision at the exact pointer AND at the last
 *    committed position and only pushes a `setDrag` when they DIFFER — so a re-render happens when a visible
 *    decision actually changes, not merely every few pixels of travel.
 *
 * The dragged card's own transform/aim/trail never come through here — those ride `dragPosRef` frame-exact
 * (see the drag rAF), so gating the React state on decision-change can't make the card stutter. Keeping the
 * two callers on ONE function is what guarantees the gate and the render never disagree.
 *
 * `Zone`, the geometry hit-tests (`geo`) and the board magnet-targets are passed in so this stays a plain,
 * unit-testable function — the geometry closures read the per-drag rect cache in `Recruit`, but their SHAPE
 * is all this needs.
 */
export type Zone = 'tavern' | 'warband' | 'hand';
export type DragSource = 'hand' | 'board' | 'shop';

/** The drag-state fields the decision reads (a structural subset of `Recruit`'s `DragState`). */
export interface DragLike {
  uid: string;
  source: DragSource;
  view: Pick<CardView, 'cardId' | 'keywords' | 'spell' | 'ruby' | 'target'>;
  ox: number;
  w: number;
  startY: number;
  active: boolean;
}

/** A board minion, reduced to what the magnetize check needs. */
export interface MagTarget {
  cardId: string;
  addedTribes?: Tribe[];
  allTribes?: boolean;
}

/** The pointer→index / pointer→uid hit-tests (backed by the per-drag rect cache in `Recruit`). */
export interface DragGeo {
  warbandIndexAt: (x: number, excludeUid?: string) => number;
  shopIndexAt: (x: number, excludeUid?: string) => number;
  handIndexAt: (x: number, excludeUid?: string) => number;
  boardUidAt: (x: number, y: number) => string | null;
  shopUidAt: (x: number, y: number) => string | null;
}

export interface DragDecisionInput {
  drag: DragLike | null;
  /** The pointer position to evaluate the decision at (the exact cursor, or the last committed point). */
  x: number;
  y: number;
  overZone: Zone | null;
  magSlide: boolean;
  playFloor: number;
  collapseY: number;
  boardMax: number;
  board: readonly MagTarget[];
  spellUid: string | undefined;
  geo: DragGeo;
}

/** The pointer-derived decision the render consumes — the gap indices, the magnetize/cast highlight flags and
 *  the lift state. Everything else the render derives (slides, FLIP key, classes) is a function of these. */
export interface DragDecision {
  wouldMagnetize: boolean;
  castTargetUid: string | null;
  overWarband: boolean;
  collapsedLift: boolean;
  shopGapIndex: number;
  gapIndex: number;
  handGapIndex: number;
}

/** The decision when nothing is being dragged (or the drag is a pre-threshold press). */
export const NO_DRAG_DECISION: DragDecision = {
  wouldMagnetize: false,
  castTargetUid: null,
  overWarband: false,
  collapsedLift: false,
  shopGapIndex: -1,
  gapIndex: -1,
  handGapIndex: -1,
};

/** A targeted spell dragged from the hand enters "aiming" only once its centre is ABOVE the play floor — below
 *  that (down in the hand) it's a reorder, so the reticle stays hidden. Shared by the render (`castingSpell`,
 *  which also gates the floating-card mount / aim rAF) and the decision below, so both agree on the boundary. */
export function computeCastingSpell(drag: DragLike | null, y: number, playFloor: number): boolean {
  return (
    !!drag?.active &&
    drag.source === 'hand' &&
    // A Ruby (set 2) aims like a targeted spell — same drag-to-cast, different card class.
    (!!drag.view.spell || !!drag.view.ruby) &&
    (drag.view.target === 'friendly' || drag.view.target === 'any') &&
    y < playFloor
  );
}

/** Compute the pointer-derived drag decision. Pure: same inputs → same output, no React/DOM. */
export function deriveDragDecision(inp: DragDecisionInput): DragDecision {
  const { drag, x, y, overZone, magSlide, playFloor, collapseY, boardMax, board, spellUid, geo } = inp;
  if (!drag) return NO_DRAG_DECISION;

  // Insertion / hover tracks the dragged card's CENTRE (not the raw pointer, which is offset by wherever you
  // grabbed the card) — so the drop slot lands where the card visually sits.
  const dragCx = x - drag.ox + drag.w / 2;
  const castingSpell = computeCastingSpell(drag, y, playFloor);

  const magHoverTarget =
    drag.active && drag.source === 'hand' && drag.view.keywords.includes('M') && overZone === 'warband'
      ? board[geo.warbandIndexAt(dragCx)]
      : undefined;
  const wouldMagnetize =
    !!drag.active &&
    !magSlide && // once the slide starts, the warband settles (no more shove preview)
    !!magHoverTarget &&
    magnetizesTo(drag.view.cardId, magHoverTarget.cardId, magHoverTarget.addedTribes, magHoverTarget.allTribes);

  // Casting a targeted spell: the friendly minion (or, for `any`, tavern offer) under the cursor IS the target.
  const castTargetUid = castingSpell
    ? geo.boardUidAt(x, y) ?? (drag.view.target === 'any' ? geo.shopUidAt(x, y) : null)
    : null;

  const overWarband =
    !!drag.active &&
    !magSlide &&
    !wouldMagnetize &&
    !drag.view.spell &&
    !drag.view.ruby && // a Ruby aims like a spell — it casts on a minion, it doesn't open an insertion gap
    // A board minion reorders only while over the warband row (dragging it up = sell). A HAND minion plays
    // anywhere ABOVE the play floor; below it the preview clears (a release there cancels back to hand).
    ((drag.source === 'board' && overZone === 'warband') ||
      (drag.source === 'hand' && y < playFloor && board.length < boardMax));

  const draggingShop = !!drag.active && drag.source === 'shop';
  const draggingHand = !!drag.active && drag.source === 'hand';

  // Vertical lift from the press point — once it clears `collapseY` it's a pull-OUT (buy/sell/play), not a reorder.
  const dragLiftY = drag.active ? Math.abs(y - drag.startY) : 0;
  const collapsedLift = dragLiftY > collapseY;

  // A dragged offer (not the pinned spell) reorders the shop while it stays near the row; lifted clear = a buy.
  const overShop = draggingShop && overZone === 'tavern' && !collapsedLift && drag.uid !== spellUid;
  const shopGapIndex = overShop ? geo.shopIndexAt(dragCx, drag.uid) : -1;

  // Where the empty drop-slot opens (a magnetizing minion also shoves a slot open beside its target).
  const gapIndex =
    overWarband || wouldMagnetize
      ? geo.warbandIndexAt(dragCx, drag.source === 'board' ? drag.uid : undefined)
      : -1;

  const overHandReorder = draggingHand && y >= playFloor;
  const handGapIndex = overHandReorder ? geo.handIndexAt(dragCx, drag.uid) : -1;

  return { wouldMagnetize, castTargetUid, overWarband, collapsedLift, shopGapIndex, gapIndex, handGapIndex };
}

/** True when two decisions would render identically — the gate `flushMove` uses to skip a no-op `setDrag`. */
export function dragDecisionEqual(a: DragDecision, b: DragDecision): boolean {
  return (
    a.wouldMagnetize === b.wouldMagnetize &&
    a.castTargetUid === b.castTargetUid &&
    a.overWarband === b.overWarband &&
    a.collapsedLift === b.collapsedLift &&
    a.shopGapIndex === b.shopGapIndex &&
    a.gapIndex === b.gapIndex &&
    a.handGapIndex === b.handGapIndex
  );
}
