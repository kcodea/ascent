import { useEffect, useRef } from 'react';
import { playDef } from './fx/playDef';
import { getDef } from './fx/fxDefs';
import { isSelectorPart, partPointFromRects, partsUsedByLayers } from './fx/anchorParts';
import type { FxAnchorPart } from './fx/def';

/**
 * ON LOAN MARKER — the maximum number of `funeral-on-loan` loops alive at once.
 *
 * The owner-authored def (second save, 2026-10-13) emits at 475/s with a 2840 ms particle life, so ONE loop settles
 * at roughly 1,350 live particles. The shop scene's whole budget is 1,500 (`maxParticlesShop`), and a loop is never
 * thinned, so a second loop cannot fit: the cap is ONE. A hand rarely holds more than one loaned card anyway
 * (Funeral on Loan is one Discover per cast, and the loan ends at the next turn). A card past the cap carries no
 * smoke; it still wears the "On Loan" text, which is the load-bearing half.
 *
 * KNOWN COST: while that loop is alive it holds most of the shop budget, so every other shop effect that plays
 * in the same moment is thinned (fewer particles per play; every play still fires). Lowering the def's `rate` is
 * the dial for that.
 */
export const ON_LOAN_FX_CAP = 1;


/**
 * WHERE ON THE CARD the smoke sits. The owner authors that in the workbench as the layer's anchor PART (the
 * 2026-10-13 save moved it to `bottom`), but a FOLLOWING play hands the engine ONE live point that replaces every
 * anchor, parts included, so the part would be silently ignored and the smoke would sit on the card's centre
 * whatever the def says. So the hook honours it itself: when the def's layers name exactly one EDGE of the card
 * (`top` / `bottom` / `left` / `right`), the followed point is that edge of the card's rect. No part, a part
 * that names a child element, or layers that disagree: the centre, as before.
 */
export function onLoanFollowPart(): FxAnchorPart {
  const parts = partsUsedByLayers(getDef('funeral-on-loan')?.layers ?? []);
  return parts.length === 1 && !isSelectorPart(parts[0]!) ? parts[0]! : 'card';
}

/** How many frames `sync` will wait for a card to paint before giving up on marking it. See `sync`. */
export const ON_LOAN_RETRY_FRAMES = 10;

/**
 * The looping ON LOAN smoke (owner 2026-10-13): while a Funeral on Loan card waits in hand, the owner-authored
 * `funeral-on-loan` def rides it continuously, so it never reads as a card that would stay if played.
 *
 * Built on the same rails as `useCiaEnchantedFx` (and the retired Pixi (Both) ring), for the same reasons:
 *  - `loop: true` runs the def continuously, so THE CALLER OWNS TEARDOWN: a looping player never retires on its
 *    own. Every loop here is disposed the moment its key leaves the list, when the tab is hidden, and on unmount.
 *  - `follow` re-reads the card's rect each frame, so the smoke tracks the card as the hand fans. Returning `null`
 *    (mid-drag, or briefly out of the DOM) hides it for that frame without ending the loop. Bounded to at most
 *    `ON_LOAN_FX_CAP` elements, which is what keeps that sanctioned per-frame layout read cheap.
 *
 * `keys` are the `data-on-loan` values stamped on loaned cards (see `CardView.onLoanKey`): the only contract
 * between the smoke and card rendering. The CALLER hands over `[]` during combat and while an overlay covers the
 * board; that empties the list and tears every loop down, which is the pause.
 */
export function useOnLoanFx(keys: readonly string[]): void {
  const key = keys.slice(0, ON_LOAN_FX_CAP).join(',');
  const active = useRef<Map<string, () => void>>(new Map());
  const hiddenRef = useRef(false);
  const syncRef = useRef<() => void>(() => {});
  const retryRaf = useRef(0);

  useEffect(() => {
    const map = active.current;
    let retries = 0;
    const sync = (): void => {
      // A card added to hand this commit may not have painted yet, so its lookup below finds nothing. It is
      // retried on the next frames rather than dropped (the (Both) marker's 2026-08-31 lesson).
      let unmounted = false;
      const want = new Set(hiddenRef.current || !key ? [] : key.split(','));
      for (const [k, dispose] of map) {
        if (!want.has(k)) { dispose(); map.delete(k); }
      }
      const part = onLoanFollowPart(); // read once per sync, never per frame
      for (const k of want) {
        if (map.has(k)) continue;
        // The live point on THIS card's rect (its centre, or the edge the def is authored on: see
        // `onLoanFollowPart`), or null while it is being dragged / not in the DOM. Matched by
        // dataset rather than a selector built out of run data. The hand card comes first in the DOM, ahead of
        // its drag copy, so the copy (which carries the same key) is never the one followed.
        const at = (): { x: number; y: number } | null => {
          const el = [...document.querySelectorAll<HTMLElement>('[data-on-loan]')].find((n) => n.dataset.onLoan === k);
          if (!el || el.classList.contains('dragsrc')) return null;
          return partPointFromRects(el.getBoundingClientRect(), part, null);
        };
        const start = at();
        if (!start) { unmounted = true; continue; }
        const dispose = playDef('funeral-on-loan', { source: start, target: start, cursor: start }, { loop: true, follow: at });
        if (dispose) map.set(k, dispose);
      }
      // Bounded: a key that never resolves is a card that left before it could be marked, and retrying it
      // forever would be a permanent rAF for a card that no longer exists.
      if (unmounted && retries < ON_LOAN_RETRY_FRAMES) {
        retries += 1;
        if (retryRaf.current) cancelAnimationFrame(retryRaf.current);
        retryRaf.current = requestAnimationFrame(() => { retryRaf.current = 0; sync(); });
      }
    };
    syncRef.current = sync;
    sync();
    return () => {
      if (retryRaf.current) { cancelAnimationFrame(retryRaf.current); retryRaf.current = 0; }
    };
  }, [key]);

  useEffect(() => {
    const onVis = (): void => { hiddenRef.current = document.hidden; syncRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Tear every live loop down when the surface unmounts (combat, title, a new run): a looping player never
  // retires on its own, so an un-disposed loop would run for the rest of the session.
  useEffect(() => {
    const map = active.current;
    return () => { for (const d of map.values()) d(); map.clear(); };
  }, []);
}
