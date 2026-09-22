import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
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
 *
 * `useLassoCascade` is the whole wiring — the render-phase seed, the per-steal clock and the escape hatches —
 * living here rather than inline in `Recruit.tsx` precisely so a component test can drive TWO steal actions in
 * one recruit phase and prove the second one still holds its card (see `lassoCascade.test.tsx`).
 */

export type LassoSteal = NonNullable<RunState['lassoFx']>[number];

/** One stolen offer still on screen, with the Shop row it was taken out of. */
export interface HeldLassoSteal {
  readonly steal: LassoSteal;
  /** `run.shop`'s uids the moment this hold was seeded — the row AFTER the splice, so it never names the held
   *  offer itself. A Refresh mid-beam replaces every uid in it, which is how `foldLassoHolds` knows the hold
   *  belongs to a row that is gone and must not be folded into the new one. */
  readonly row: readonly string[];
}

export interface LassoHolds {
  /** Stolen offers still rendered in the Shop row, oldest first. */
  readonly shop: readonly HeldLassoSteal[];
  /** Hand uids still held out of the fan. */
  readonly hand: ReadonlySet<string>;
}

const NO_UIDS: ReadonlySet<string> = new Set();
export const EMPTY_LASSO_HOLDS: LassoHolds = { shop: [], hand: NO_UIDS };

/** Seed holds for a fresh batch of steals. Re-entrant: a uid already held is not doubled. */
export function holdLassoSteals(holds: LassoHolds, events: readonly LassoSteal[], row: readonly string[] = []): LassoHolds {
  const fresh = events.filter((e) => !holds.shop.some((h) => h.steal.offer.uid === e.offer.uid));
  if (fresh.length === 0) return holds;
  return {
    shop: [...holds.shop, ...fresh.map((steal) => ({ steal, row }))],
    hand: new Set([...holds.hand, ...fresh.map((e) => e.handUid).filter(Boolean)]),
  };
}

/** CONTACT: one beam landed, so its card (and only its card) is let go on both sides. */
export function releaseLassoSteal(holds: LassoHolds, offerUid: string, handUid: string): LassoHolds {
  const shop = holds.shop.filter((h) => h.steal.offer.uid !== offerUid);
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
 *
 * A hold whose row is GONE is dropped rather than folded. Refresh the Shop while a beam is still in the air
 * and every uid of the recorded row is replaced at once; without this the stolen offer rendered among the new
 * ones — a dead card that no longer exists in state (it could never duplicate anything, `case 'buy'` bails on
 * a missing uid, but it read as a bug). A row recorded EMPTY (the last offer was the one stolen) has nothing
 * to test and is always kept; its release timer is milliseconds away.
 */
export function foldLassoHolds<T extends { uid: string }>(shop: readonly T[], holds: LassoHolds): readonly T[] {
  if (holds.shop.length === 0) return shop;
  const live = holds.shop.filter((h) => h.row.length === 0 || h.row.some((u) => shop.some((o) => o.uid === u)));
  if (live.length === 0) return shop;
  const arr = [...shop];
  for (let i = live.length - 1; i >= 0; i--) {
    const h = live[i]!;
    if (arr.some((o) => o.uid === h.steal.offer.uid)) continue;
    arr.splice(Math.min(Math.max(h.steal.index, 0), arr.length), 0, h.steal.offer as unknown as T);
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

/** What the screen does with each steal. Held in a ref so the wiring can be declared at the top of `Recruit`,
 *  where the holds are rendered, while the beam code stays down beside the other FX watchers. */
export interface LassoCascadeHandlers {
  /** Once per action, BEFORE anything is scheduled — Recruit snapshots the spell's drop point here. */
  onBatch?: () => void;
  /** LAUNCH: throw one beam, origin → the stolen offer. */
  onLaunch: (ev: LassoSteal, index: number) => void;
  /** CONTACT: the rope has the card. Its hold has already been released when this runs. */
  onContact: (ev: LassoSteal) => void;
}

export interface LassoCascadeOpts {
  /** `run.lassoFxSeq` — the sim's per-action bump. */
  seq: number;
  /** `run.lassoFx` — this action's steals. */
  events: readonly LassoSteal[];
  phase: RunState['phase'];
  /** `run.shop`'s uids as they stand now (post-splice): the row a hold belongs to. */
  shopUids: readonly string[];
  handlers: MutableRefObject<LassoCascadeHandlers>;
}

export interface LassoCascade {
  /** What the Shop row and the hand fan must render right now. */
  holds: LassoHolds;
  /** Let everything go and drop the pending timers. */
  resolve: () => void;
  /** Register a timer owned by an End-of-Turn BEAT so an unmount clears it. Deliberately NOT cleared by the
   *  phase watcher: those beams play across the flip to combat by design, and the cascade they belong to has
   *  already reserved its room in the timeline (`lassoCascadeMs`). */
  trackBeatTimer: (id: number) => number;
}

/**
 * The whole lasso presentation clock for one recruit screen.
 *
 * ORDERING, the part that broke once (2026-09-22): the holds are seeded DURING RENDER, and React runs a
 * changed-dep effect's CLEANUP after that render has committed. Resolving the holds from the cascade effect's
 * cleanup therefore wiped the batch the same render had just seeded, so every steal after the FIRST one in a
 * recruit phase showed no hold at all — the card left the Shop and reached the hand before the rope was drawn,
 * which is exactly the thing the feature exists to prevent. So the "a second lasso cancels the first" step
 * happens in the seed itself, and the old batch's timers are dropped at the TOP of the effect body. The effect
 * registers no cleanup; the phase watcher and the unmount hatch below are the only ones.
 */
export function useLassoCascade(opts: LassoCascadeOpts): LassoCascade {
  const { seq, phase, events, shopUids } = opts;
  const latest = useRef(opts);
  latest.current = opts;

  const [raw, setRaw] = useState<LassoHolds>(EMPTY_LASSO_HOLDS);
  const [heldSeq, setHeldSeq] = useState(seq);
  if (seq !== heldSeq) {
    setHeldSeq(seq);
    const fresh = phase === 'recruit' ? events : [];
    if (fresh.length) setRaw((prev) => holdLassoSteals(resolveAllLassoHolds(prev), fresh, shopUids));
  }

  const timersRef = useRef<number[]>([]);
  const beatTimersRef = useRef<number[]>([]);
  const resolve = useCallback((): void => {
    for (const t of timersRef.current.splice(0)) window.clearTimeout(t);
    setRaw(resolveAllLassoHolds);
  }, []);
  const trackBeatTimer = useCallback((id: number): number => {
    beatTimersRef.current.push(id);
    return id;
  }, []);

  const prevSeq = useRef(seq);
  useEffect(() => {
    if (seq === prevSeq.current) return;
    prevSeq.current = seq; // advance FIRST — exactly once per action (the #947 lesson)
    for (const t of timersRef.current.splice(0)) window.clearTimeout(t); // the PREVIOUS cascade's clock
    const o = latest.current;
    o.handlers.current.onBatch?.(); // one release point, one cast — read and cleared even with nothing to play
    const batch = o.phase === 'recruit' ? o.events : [];
    if (batch.length === 0) return;
    const schedule = lassoBeamSchedule(batch.length);
    batch.forEach((ev, i) => {
      const { launchAt, contactAt } = schedule[i]!;
      timersRef.current.push(window.setTimeout(() => latest.current.handlers.current.onLaunch(ev, i), launchAt));
      timersRef.current.push(window.setTimeout(() => {
        // CONTACT. The rope has the card: drop the Shop hold (which changes `flipKey`, so the survivors glide
        // closed from where they were holding) and let the copy into the hand.
        setRaw((prev) => releaseLassoSteal(prev, ev.offer.uid, ev.handUid));
        latest.current.handlers.current.onContact(ev);
      }, contactAt));
    });
    // NO cleanup — see the ordering note above.
    // Keyed on the SEQ only (everything else is read through `latest`): the arrays change identity every action.
  }, [seq]);

  // Leaving the shop (End Turn, a combat, a restore) resolves every outstanding hold at once, so a card can
  // never be stranded invisible in a row that is no longer on screen.
  useEffect(() => { if (phase !== 'recruit') resolve(); }, [phase, resolve]);
  useEffect(() => () => {
    for (const t of timersRef.current.splice(0)) window.clearTimeout(t);
    for (const t of beatTimersRef.current.splice(0)) window.clearTimeout(t);
  }, []);

  return { holds: lassoHoldsForPhase(raw, phase), resolve, trackBeatTimer };
}
