/**
 * ROW SLIDES — which cards glide to their new slot after a committed change, and from how far.
 *
 * The pure half of `RowFlip`'s commit animation (Recruit.tsx). `olds` / `nows` are two sweeps of each card's
 * LAYOUT left (`offsetLeft`, transform-immune): the previous commit's and this one's. A card present in both
 * whose left changed slides from the old spot (`delta = old - now`, the tween's starting `x`) to its new one.
 *
 * A DROP commit (a hand minion played, a board / shop reorder, a sell, a buy) animates the row it was dragged
 * in off a drop-time capture of that row's VISUAL spots, so those cards are left to it (`inDropRow`). Every
 * other card is planned here — because a drop can re-lay-out the row it was NOT dragged in: a drag-buy that
 * completes a triple consumes copies from the warband, and a played minion's Shout can take a card out of the
 * shop. Before this, that other row's survivors jumped to their new slots (owner 2026-09-24: "the units do not
 * slide into their new spots, they immediate blink"). R-SLIDE-01.
 */

/** Below this a "move" is sub-pixel noise, not a slide. */
const MIN_SLIDE_PX = 0.5;

export function commitSlidePlan(
  cards: readonly { uid: string; inDropRow: boolean }[],
  olds: ReadonlyMap<string, number> | null,
  nows: ReadonlyMap<string, number> | null,
  isDrop: boolean,
): { uid: string; delta: number }[] {
  if (!olds || !nows) return [];
  const out: { uid: string; delta: number }[] = [];
  for (const c of cards) {
    // An empty uid names no card — two of them would share one sweep entry — so it never slides.
    if (!c.uid || (isDrop && c.inDropRow)) continue;
    const old = olds.get(c.uid);
    const now = nows.get(c.uid);
    if (old === undefined || now === undefined) continue;
    const delta = old - now;
    if (Math.abs(delta) >= MIN_SLIDE_PX) out.push({ uid: c.uid, delta });
  }
  return out;
}
