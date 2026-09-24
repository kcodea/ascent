/**
 * ROW SLIDES — WHICH cards glide to their new slot after a committed change (R-SLIDE-01).
 *
 * The partition half of `RowFlip`'s commit animation (Recruit.tsx). HOW FAR each card moved, and whether anything
 * moved at all, is `commitFlipDeltas` (`commitFlip.ts`, R-PRESENT-14): a delta only when the rows themselves changed
 * since the previous commit's sweep, so a spell cast or a resize never slides a card. This module decides which of
 * those deltas animate here.
 *
 * A DROP commit (a hand minion played, a board / shop reorder, a sell, a buy) animates the row it was dragged in off
 * a drop-time capture of that row's VISUAL spots, so those cards are left to it (`inDropRow`). Every other card
 * with a delta slides here — because a drop can re-lay-out the row it was NOT dragged in: a drag-buy that completes
 * a triple consumes copies from the warband, and a played minion's Shout can take a card out of the shop. Before
 * this, that other row's survivors jumped to their new slots (owner 2026-09-24: "the units do not slide into their
 * new spots, they immediate blink").
 */
export function commitSlidePlan(
  cards: readonly { uid: string; inDropRow: boolean }[],
  deltas: ReadonlyMap<string, number>,
  isDrop: boolean,
): { uid: string; delta: number }[] {
  const out: { uid: string; delta: number }[] = [];
  for (const c of cards) {
    // An empty uid names no card — two of them would share one delta — so it never slides.
    if (!c.uid || (isDrop && c.inDropRow)) continue;
    const delta = deltas.get(c.uid);
    if (delta !== undefined) out.push({ uid: c.uid, delta });
  }
  return out;
}
