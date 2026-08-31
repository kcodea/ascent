/**
 * How many End-of-Turn hand-grant PREVIEWS should still be drawn.
 *
 * ── The bug this exists for (player report bb5195d5, 2026-08-31) ──────────────────────────────────────────
 *
 * *"when rope wrangler triggers end of turn. it briefly displays 2x the amount of cards given to hand, before
 * correcting and displaying the correct amount."*
 *
 * End of Turn animates beat by beat, and each beat that grants a card shows a PREVIEW in the hand row so the
 * card materialises on its own pulse instead of the whole batch appearing at once. The real cards arrive
 * later, in one `faceOmen` commit.
 *
 * The previews were cleared in the same callback as that commit — but they are REACT state while the run is
 * ZUSTAND state, and the store notifies its subscribers synchronously. So the store's new hand could paint
 * while the queued `setEotGrants([])` had not flushed yet, and the row drew the real cards AND their
 * previews: exactly twice the grant, for a frame, then correcting. Rope Wrangler makes it obvious because it
 * grants up to five cards at once.
 *
 * ── Why this is derived rather than better-ordered ────────────────────────────────────────────────────────
 *
 * Any fix that sequences two stores has a frame in which one has moved and the other has not — inverting the
 * order just moves the flicker (previews vanish before the real cards land) rather than removing it. Deriving
 * the preview count from what has already ARRIVED cannot race at all: every card the commit adds removes
 * exactly one preview, so the visible total never changes across the commit.
 */
export function visibleHandPreviews(args: {
  /** Preview cardIds captured from the projection, in beat order. */
  previews: readonly string[];
  /** Hand size when End of Turn began — the baseline arrivals are measured against. */
  baseHandSize: number;
  /** Hand size right now. */
  handSize: number;
  /** Free hand slots, so a full hand shows nothing (the cap is enforced by the reducer too). */
  room: number;
}): string[] {
  const { previews, baseHandSize, handSize, room } = args;
  // Cards that have already really arrived. Clamped at 0 because the hand can also SHRINK mid-animation
  // (a Fodder consumed out of hand), and a negative would wrongly re-show a preview.
  const arrived = Math.max(0, handSize - baseHandSize);
  return previews.slice(arrived, arrived + Math.max(0, room));
}
