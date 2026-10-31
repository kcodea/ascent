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
  /** The STARFORM offer under a point, or null — the one shop offer a friendly Celestial-aimed spell (Star Crash)
   *  may land on (`starformSpellAimsToken`, set 3 Celestials 2026-09-12). Optional: absent = no such aim. */
  starformUidAt?: (x: number, y: number) => string | null;
}

export interface DragDecisionInput {
  /** The dragged spell may be aimed at the Starform offer (`starformSpellAimsToken` — Star Crash). */
  aimsStarform?: boolean;
  /** See `computeCastingSpell` — a Choose One that will ask before it aims never enters aim mode. */
  asksChoiceFirst?: boolean;
  /** A target the dragged spell may NOT take (a Golden minion for a `targetNoGolden` spell: Handout, CueBee's Pass,
   *  R-DUOS-PASS-GOLDEN-TARGET-01). It never becomes the cast target, so it gets no target glow. */
  castRefuses?: (uid: string) => boolean;
  drag: DragLike | null;
  /** The pointer position to evaluate the decision at (the exact cursor, or the last committed point). */
  x: number;
  y: number;
  overZone: Zone | null;
  magSlide: boolean;
  playFloor: number;
  /** Lower cast/aim line for SPELLS (targeted, untargeted, Ruby). Defaults to `playFloor` when omitted, so a
   *  spell arms/reorders on the same line as a minion unless a distinct (lower) spell line is supplied. */
  spellFloor?: number;
  /** The COMMIT line for a hand MINION: a release plays it only above this line. `playFloor` is where the warband
   *  starts making room; between the two the card previews but a release sends it back to hand. Defaults to
   *  `playFloor` (one line, the old behaviour); never sits below it (the higher of the two wins). */
  commitFloor?: number;
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
  /** A hand minion that WILL PLAY if released right now: past the commit line with a slot open (or a magnetize
   *  target). Drives the blue "release to play" glow on the floating card. */
  willCommit: boolean;
}

/** The commit line actually used: never nearer the hand (larger screen y) than the react line, so a release can
 *  never play a card the warband has not made room for. */
export function effectiveCommitFloor(playFloor: number, commitFloor: number | undefined): number {
  return Math.min(playFloor, commitFloor ?? playFloor);
}

/** True when a hand MINION released at `y` plays (instead of returning to hand). Shared by the decision (glow)
 *  and the drop handler in `Recruit`, so the blue glow and the release always agree (R-PLAYLINE-01). */
export function handMinionCommits(y: number, playFloor: number, commitFloor: number | undefined): boolean {
  return y < effectiveCommitFloor(playFloor, commitFloor);
}

/** How far into a card the cursor must reach (fraction of width) before the insertion point moves past it: insert
 *  after a card once the *dragged card's centre* passes its midpoint. */
export const INSERT_FRAC = 0.5;

/** A row card's cached resting slot (left + width), measured once per drag. SCREEN px, like the pointer. */
export interface InsertSlot { uid: string; left: number; width: number }

/** Count how many cached slot-midpoints the pointer x has passed (the insertion index). `excludeUid` drops the
 *  dragged card from the count when *reordering* (it's still in the DOM, so without this a rightward drag
 *  overshoots by one). `slots` and `x` must be in the SAME space (both screen px) — then the index is the same at
 *  every stage scale (R-PRESENT-27). */
export function indexFromSlots(slots: readonly InsertSlot[], x: number, excludeUid?: string): number {
  let i = 0;
  for (const c of slots) {
    if (c.uid === excludeUid) continue;
    if (x > c.left + c.width * INSERT_FRAC) i++;
  }
  return i;
}

/** Reorder insertion index that measures against each neighbour's CURRENT (shifted) position, not its resting
 *  slot. As you drag a card aside, its neighbour slides a whole slot to make room; the swap-back trigger must
 *  follow the neighbour's NEW spot — otherwise (measuring resting midpoints) you'd have to drag ~half a card
 *  OUT to open the gap but only a sliver BACK to close it (the reported asymmetry). With the gap currently at
 *  `prevGap`, the p-th non-dragged card sits in slot (p < prevGap ? p : p+1); count those whose centre is < x. */
export function reorderIndexFromSlots(slots: readonly InsertSlot[], x: number, excludeUid: string, prevGap: number): number {
  const g = prevGap >= 0 ? prevGap : Math.max(0, slots.findIndex((s) => s.uid === excludeUid));
  let p = 0;
  let count = 0;
  for (const c of slots) {
    if (c.uid === excludeUid) continue;
    const slot = slots[p < g ? p : p + 1] ?? c;
    if (x > slot.left + slot.width * INSERT_FRAC) count++;
    p++;
  }
  return count;
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
  willCommit: false,
};

/** A targeted spell dragged from the hand enters "aiming" only once its centre is ABOVE the play floor — below
 *  that (down in the hand) it's a reorder, so the reticle stays hidden. Shared by the render (`castingSpell`,
 *  which also gates the floating-card mount / aim rAF) and the decision below, so both agree on the boundary. */
export function computeCastingSpell(
  drag: DragLike | null,
  y: number,
  playFloor: number,
  /** True when this card will ASK before it aims — a Choose One whose branch is not already decided. Such a
   *  card is dragged up like an UNTARGETED spell: no reticle, no aim line, no target under the cursor. The
   *  aim picker takes over after the branch is chosen (owner ruling 2026-08-28: "drag the spell up, then
   *  choose one, then target a minion to buff"). The drop path already honoured this; the reticle did not,
   *  so Crest of the Climb still drew a target line while dragging (owner report, same day). */
  asksChoiceFirst = false,
): boolean {
  return (
    !!drag?.active &&
    drag.source === 'hand' &&
    // A Ruby (set 2) aims like a targeted spell — same drag-to-cast, different card class.
    (!!drag.view.spell || !!drag.view.ruby) &&
    (drag.view.target === 'friendly' || drag.view.target === 'any') &&
    !asksChoiceFirst &&
    y < playFloor
  );
}

/** Compute the pointer-derived drag decision. Pure: same inputs → same output, no React/DOM. */
export function deriveDragDecision(inp: DragDecisionInput): DragDecision {
  const { drag, x, y, overZone, magSlide, playFloor, collapseY, boardMax, board, spellUid, geo } = inp;
  if (!drag) return NO_DRAG_DECISION;

  // A spell arms/reorders on its own (lower) line; minions use the play floor. `spellFloor` falls back to
  // `playFloor` when a distinct line isn't supplied, preserving the old single-line behaviour.
  const isSpell = !!drag.view.spell || !!drag.view.ruby;
  const spellFloor = inp.spellFloor ?? playFloor;
  const handFloor = isSpell ? spellFloor : playFloor;

  // Insertion / hover tracks the dragged card's CENTRE (not the raw pointer, which is offset by wherever you
  // grabbed the card) — so the drop slot lands where the card visually sits.
  const dragCx = x - drag.ox + drag.w / 2;
  const castingSpell = computeCastingSpell(drag, y, spellFloor, inp.asksChoiceFirst);

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
  // A friendly Celestial-aimed spell (Star Crash) may also land on the STARFORM offer — `aimsStarform` is set by
  // the drag start from the same sim gate the reducer reads (`starformSpellAimsToken`).
  const castRaw = castingSpell
    ? geo.boardUidAt(x, y) ?? (drag.view.target === 'any' ? geo.shopUidAt(x, y) : inp.aimsStarform ? (geo.starformUidAt?.(x, y) ?? null) : null)
    : null;
  const castTargetUid = castRaw && inp.castRefuses?.(castRaw) ? null : castRaw;

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

  const overHandReorder = draggingHand && y >= handFloor;
  const handGapIndex = overHandReorder ? geo.handIndexAt(dragCx, drag.uid) : -1;

  const willCommit =
    draggingHand && !isSpell && (overWarband || wouldMagnetize) && handMinionCommits(y, playFloor, inp.commitFloor);

  return { wouldMagnetize, castTargetUid, overWarband, collapsedLift, shopGapIndex, gapIndex, handGapIndex, willCommit };
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
    a.handGapIndex === b.handGapIndex &&
    a.willCommit === b.willCommit
  );
}

/** A measured zone box (screen px), the subset of a DOMRect the play lines read. */
export interface LineRect { top: number; bottom: number; height: number }

/** The three hand-drag lines, as screen y (smaller = higher up): where the warband REACTS to a hand minion, where a
 *  release COMMITS it (already clamped, see `effectiveCommitFloor`), and where a spell ARMS. ONE function feeds both
 *  the drag (`Recruit`) and the Drag Feel tuner's guide lines, so what the guides show is what the drag does. */
export function handDragLines(
  wb: LineRect | undefined,
  hand: LineRect | undefined,
  tavern: LineRect | undefined,
  feel: { playLine: number; playCommitLine: number; spellLine: number },
): { react: number; commit: number; spell: number } {
  if (wb && hand) {
    const gap = hand.top - wb.bottom;
    const react = wb.bottom + feel.playLine * gap;
    return {
      react,
      commit: effectiveCommitFloor(react, wb.bottom + feel.playCommitLine * gap),
      spell: wb.bottom + feel.spellLine * gap,
    };
  }
  // Hand unmeasured: the old fixed line, 10% of the play area up from the warband's bottom (or play anywhere).
  const react = wb ? wb.bottom - 0.1 * (tavern ? wb.bottom - tavern.top : wb.height) : Infinity;
  return { react, commit: react, spell: react };
}
