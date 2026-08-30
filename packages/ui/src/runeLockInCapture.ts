import { RUNE_INDEX } from '@game/content';
import type { RuneLockInCard } from './RuneLockIn';

/**
 * MEASURE THE FORGE ROW, once, for the lock-in ceremony.
 *
 * Shared by the two places a rune gets chosen:
 *
 *  · **live play** — `Recruit`'s `onBuy`, measuring the row the player just clicked;
 *  · **replay** — `replayPlayer`, measuring the row a RECORDED player clicked, immediately before the frame
 *    that clears the offer is applied.
 *
 * It has to be one function because the two paths must produce the same ceremony, and the measurement is the
 * whole trick: the ceremony re-renders clones at these exact rects, so the handover from the real forge to
 * the ceremony layer is invisible. Two implementations would drift, and the drift would show as the cards
 * jumping on the first frame.
 *
 * ── Timing is the caller's job, and it is unforgiving ─────────────────────────────────────────────────────
 *
 * The row must still be ON SCREEN when this runs. Buying a rune clears `runeforgeOffer`, which unmounts the
 * forge overlay on the same frame — after that there is nothing left to measure. Live play calls this inside
 * the click handler, before dispatching; replay calls it before applying the frame, while the DOM still
 * shows the previous one.
 */
export function captureRuneLockIn(
  offer: readonly string[],
  /** Sparse in practice — the pivot discount is per-offer-slot and may be absent for a slot. */
  discounts: readonly (number | undefined)[] | undefined,
  chosenIndex: number,
  /** Any element inside the forge row, or null to find the row in the document. */
  from?: HTMLElement | null,
): RuneLockInCard[] | null {
  const row = from?.closest('.forge-cards') ?? document.querySelector('.forge-cards');
  if (!row) return null;
  // `.runecard` siblings are the cards in OFFER ORDER, so the index lines up with the offer array without
  // threading ids through the DOM.
  const els = [...row.querySelectorAll<HTMLElement>('.runecard')];
  const cards: RuneLockInCard[] = [];
  offer.forEach((id, i) => {
    const rune = RUNE_INDEX[id];
    const node = els[i];
    if (!rune || !node) return;
    const r = node.getBoundingClientRect();
    cards.push({
      rune,
      cost: Math.max(0, rune.cost - (discounts?.[i] ?? 0)),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      chosen: i === chosenIndex,
    });
  });
  // No chosen card means the index did not line up with what is on screen — play nothing rather than a
  // ceremony that crowns the wrong rune.
  return cards.some((c) => c.chosen) ? cards : null;
}

/**
 * Which offered rune did a recorded player buy?
 *
 * `causeIndex` is recorded on the frame from the action itself and is the answer whenever it is present.
 * Replays captured before that field existed fall back to diffing owned runes — which is right except when
 * the rune was a DUPLICATE (owning it already means the list does not grow), so that case returns -1 and the
 * caller plays no ceremony. A missing flourish on an old recording is a fair trade for never crowning the
 * wrong rune.
 */
export function chosenRuneIndex(
  causeIndex: number | undefined,
  offer: readonly string[],
  ownedBefore: readonly string[] | undefined,
  ownedAfter: readonly string[] | undefined,
): number {
  if (typeof causeIndex === 'number' && causeIndex >= 0 && causeIndex < offer.length) return causeIndex;
  const before = new Set(ownedBefore ?? []);
  const gained = (ownedAfter ?? []).filter((id) => !before.has(id));
  if (gained.length !== 1) return -1;          // nothing gained (a duplicate) or ambiguous — do not guess
  return offer.indexOf(gained[0]!);
}
