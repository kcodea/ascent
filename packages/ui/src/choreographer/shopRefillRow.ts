/**
 * SHOP MADNESS, ON ITS BEATS (owner report 2026-11-13, R-SHOPMADNESS-REALTIME-01).
 *
 *   "minions should replace each other in real time ... the consumed stats didnt go up in real time"
 *
 * With Shop Madness every minion that leaves the Shop is replaced in its slot at once. At End of Turn the scene keeps
 * rendering the pre-End-of-Turn row and layers the delivered consequences on top, so a refill the batch never
 * announced stayed invisible until the commit: a Hydraskus feast emptied the row on screen and the later Demons ate
 * minions nobody had seen. The sim now emits each refill as a `shopChanged: refilled` (with the slot it took), the
 * projection collects them (`shopRefills`), and these two pure helpers turn that into the row the player sees:
 *
 *   - `foldShopRefills` puts each delivered refill into the slot of the offer it replaced (that offer is hidden by
 *     its own `consumed` delivery), so the newcomer appears exactly where the eaten minion stood;
 *   - `pendingRefillSlots` names the eaten offers whose refill has not landed YET, so the row holds their slot open
 *     (an invisible placeholder) instead of closing the gap and reopening it a moment later.
 *
 * Presentation only: the committed state already holds the same row, so the commit changes nothing on screen.
 */
import type { ProjectedShopRefill } from './projection';

/** `row` with every delivered refill in its slot. A refill already in the row (the committed state) is left alone. */
export function foldShopRefills<T extends { uid: string; cardId: string }>(
  row: readonly T[],
  refills: readonly ProjectedShopRefill[],
): T[] {
  if (refills.length === 0) return row as T[];
  const out = [...row];
  for (const r of refills) {
    if (out.some((o) => o.uid === r.uid)) continue;
    const offer = { uid: r.uid, cardId: r.cardId } as T;
    const at = r.replaces ? out.findIndex((o) => o.uid === r.replaces) : -1;
    if (at >= 0) out.splice(at + 1, 0, offer); // right after the eaten offer, which its `consumed` delivery hides
    else out.splice(Math.min(r.index, out.length), 0, offer);
  }
  return out;
}

/** The offers whose replacement is still on its way: every `replaces` in the batch minus the refills delivered. */
export function pendingRefillSlots(all: readonly ProjectedShopRefill[], delivered: readonly ProjectedShopRefill[]): ReadonlySet<string> {
  const landed = new Set(delivered.map((r) => r.uid));
  const out = new Set<string>();
  for (const r of all) if (r.replaces && !landed.has(r.uid)) out.add(r.replaces);
  return out;
}
