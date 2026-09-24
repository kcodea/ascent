/**
 * THE COMMIT FLIP'S "FROM" (owner report 2026-09-24, verbatim: *"when casting growth it randomly moves the
 * warband, please fix that"*).
 *
 * `RowFlip`'s commit branch (a sell, a summon, an effect reposition: any committed row change with no drag) glides
 * each warband / tavern card from where it sat at the PREVIOUS row commit to where it sits now. Both ends are
 * `offsetLeft` sweeps, taken whenever the FLIP key changes outside a drag.
 *
 * The bug: the FLIP key also carries the drag's `collapsedLift` flag, so dragging ANY spell up out of the hand and
 * releasing it changes the key twice with no row change at all. The release commit then diffed the row against a
 * sweep of unbounded age, and if the layout had changed since (the window resized, a panel docked, anything that
 * re-centres the row without adding or removing a card), every card got a phantom delta and the WHOLE warband slid
 * in from its old spot. Growth is the spell you cast most, so it read as "Growth moves the warband".
 *
 * The rule: a delta is a MOVE only when the rows themselves changed (`key`, the shop uids + pinned spell + board
 * uids, differs from the sweep it is diffed against). Same rows, different `offsetLeft` = the layout changed under
 * a card that did not move, and nothing should animate. `RowFlip` also drops the sweep on a window resize, so a
 * real row change after a resize snaps instead of flinging the survivors in from the old layout.
 */
export interface CommitSweep {
  /** The row composition the sweep was taken under (`rowsKey`). */
  key: string;
  /** Each flipping card's layout left (`offsetLeft`, transform-immune), by uid. */
  lefts: ReadonlyMap<string, number>;
}

/** Below this a card has not moved (sub-pixel layout rounding). */
const MIN_DELTA_PX = 0.5;

/**
 * uid → how far the card must be pushed back (`old − now`, px) so it can glide home, for every card that MOVED
 * between two row commits. Empty when there is no earlier sweep, or when the rows did not change (same `key`).
 * A card present in only one sweep (newly arrived, or gone) has no delta.
 */
export function commitFlipDeltas(prev: CommitSweep | null, now: CommitSweep): Map<string, number> {
  const out = new Map<string, number>();
  if (!prev || prev.key === now.key) return out;
  for (const [uid, left] of now.lefts) {
    const old = prev.lefts.get(uid);
    if (old === undefined) continue;
    const delta = old - left;
    if (Math.abs(delta) >= MIN_DELTA_PX) out.set(uid, delta);
  }
  return out;
}
