import type { RunState } from '@game/sim';

/**
 * THE LASSO HOLDS (owner ask 2026-09-22) — the state machine behind "the card comes to hand when the beam
 * lands", extracted from `Recruit.tsx` so the one rule that matters can be pinned by a test.
 *
 * The rule: the reducer already resolved the theft. The offer is out of `run.shop` and its copy is in
 * `run.hand` before a single frame of the beam has drawn. Presentation may DELAY what the player sees; it may
 * never change what resolved. So the hold puts the offer back in the row it was rendered in, keeps the arrival
 * out of the fan, and lets both go at contact — 200 ms in, the beam's own `travelMs`.
 *
 * The failure mode this guards against is a card stranded invisible: held out of the hand, with the timer that
 * would have released it cancelled by a phase change, a second cascade or an unmount. Three answers, and the
 * first is the load-bearing one because it cannot be forgotten at a call site:
 *
 *   1. `lassoHoldsForPhase` is applied DURING RENDER. Off the recruit screen there are no holds at all, so the
 *      question "did the timer fire?" never arises once the shop is gone.
 *   2. `resolveAllLassoHolds` is what a cancelled cascade and an unmount both call (the `gambleHold` rule: a
 *      second roll mid-tumble never strands the first prize).
 *   3. A release is keyed on the stolen offer's uid and the arrival's own uid — never a blanket flag, which
 *      once threw away every other fresh card in the same tick (2026-07-23).
 */

export type LassoSteal = NonNullable<RunState['lassoFx']>[number];

export interface LassoHolds {
  /** Stolen offers still rendered in the Shop row, oldest first. */
  readonly shop: readonly LassoSteal[];
  /** Hand uids still held out of the fan. */
  readonly hand: ReadonlySet<string>;
}

const NO_UIDS: ReadonlySet<string> = new Set();
export const EMPTY_LASSO_HOLDS: LassoHolds = { shop: [], hand: NO_UIDS };

/** Seed holds for a fresh batch of steals. Re-entrant: a uid already held is not doubled. */
export function holdLassoSteals(holds: LassoHolds, events: readonly LassoSteal[]): LassoHolds {
  const fresh = events.filter((e) => !holds.shop.some((h) => h.offer.uid === e.offer.uid));
  if (fresh.length === 0) return holds;
  return {
    shop: [...holds.shop, ...fresh],
    hand: new Set([...holds.hand, ...fresh.map((e) => e.handUid).filter(Boolean)]),
  };
}

/** CONTACT: one beam landed, so its card (and only its card) is let go on both sides. */
export function releaseLassoSteal(holds: LassoHolds, offerUid: string, handUid: string): LassoHolds {
  const shop = holds.shop.filter((h) => h.offer.uid !== offerUid);
  if (shop.length === holds.shop.length && !holds.hand.has(handUid)) return holds;
  const hand = new Set(holds.hand);
  hand.delete(handUid);
  return { shop, hand };
}

/** The escape hatch: everything outstanding is let go at once, with nothing left held back. */
export function resolveAllLassoHolds(holds: LassoHolds): LassoHolds {
  return holds.shop.length === 0 && holds.hand.size === 0 ? holds : EMPTY_LASSO_HOLDS;
}

/** Holds only exist while the SHOP is on screen. Applied during render, so leaving the shop cannot strand a
 *  card even if the release timer never ran. */
export function lassoHoldsForPhase(holds: LassoHolds, phase: RunState['phase']): LassoHolds {
  return phase === 'recruit' ? holds : EMPTY_LASSO_HOLDS;
}

/**
 * Put the held offers back into the Shop row they were rendered in.
 *
 * REVERSE order, and that is the whole subtlety: each record's `index` was taken against the row as it stood
 * when THAT steal spliced, so the later (shorter) row is rebuilt first and the earlier indices then land in
 * the right slots. Rebuilding oldest-first puts the second card in the wrong hole.
 */
export function foldLassoHolds<T extends { uid: string }>(shop: readonly T[], holds: LassoHolds): readonly T[] {
  if (holds.shop.length === 0) return shop;
  const arr = [...shop];
  for (let i = holds.shop.length - 1; i >= 0; i--) {
    const h = holds.shop[i]!;
    if (arr.some((o) => o.uid === h.offer.uid)) continue;
    arr.splice(Math.min(Math.max(h.index, 0), arr.length), 0, h.offer as unknown as T);
  }
  return arr;
}

/** One steal to the next — "overlap slightly, about 300 ms apart" (owner 2026-09-22), so five casts read as a
 *  rapid sequence rather than one at a time. */
export const LASSO_STAGGER_MS = 300;
/** The beam's `travelMs` in `fx/defs/lasso.json`: the instant the rope reaches the card, and therefore the
 *  instant the offer may leave the Shop and the copy may enter the hand. */
export const LASSO_CONTACT_MS = 200;

/** When each steal in a cascade launches and lands. Presentation clock only — the reducer already resolved. */
export function lassoBeamSchedule(count: number): { launchAt: number; contactAt: number }[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    launchAt: i * LASSO_STAGGER_MS,
    contactAt: i * LASSO_STAGGER_MS + LASSO_CONTACT_MS,
  }));
}

/** How long a whole cascade needs on screen — what an End-of-Turn beat carrying steals must RESERVE, since
 *  counting beats is not the same as giving them room. 700 ms covers the visible half of the def past contact. */
export function lassoCascadeMs(count: number): number {
  return count <= 0 ? 0 : (count - 1) * LASSO_STAGGER_MS + 700;
}
