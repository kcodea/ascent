import { useEffect, useRef } from 'react';
import { playDef } from './fx/playDef';

/**
 * (BOTH) MARKER — the maximum number of `choose-one-both` loops alive at once.
 *
 * The def emits at 80/s with a 2710 ms particle life, so ONE loop settles at roughly 215 live particles. Several
 * cards can qualify at the same moment — hold the Rune of Facetwright and every Facetwright's Choice in hand
 * AND in the tavern lights up — so the marker is capped rather than left to scale with the board. Four is the
 * shipped cap: ~860 particles, comfortably inside what the shared overlay already carries for a combat moment,
 * and past the point where a fifth ring adds information rather than noise. Cards past the cap simply carry no
 * emitter; they still print the (Both) text, which is the load-bearing half of the cue.
 *
 * The order the caller passes is the priority order, so put the surfaces the player is looking at first.
 */
export const CHOOSE_BOTH_FX_CAP = 4;

/**
 * The looping (Both) marker: while a card's Choose One will resolve as BOTH branches, the owner-authored
 * `choose-one-both` def rides it continuously (owner ruling 2026-08-28 — a persistent marker, explicitly
 * chosen over a one-shot, and deliberately NOT fired on play; a resolution effect is separate authoring work).
 *
 * Built on the same rails as `useCiaEnchantedFx`, for the same reasons:
 *  - `loop: true` runs the def continuously, so THE CALLER OWNS TEARDOWN — a looping player never retires on
 *    its own. Every loop here is disposed the moment its key leaves the list, when the tab is hidden, and on
 *    unmount, so nothing can outlive the card it marks.
 *  - `follow` re-reads the card's rect each frame, so the ring tracks a card as the hand fans or the shop
 *    reorders. Returning `null` (mid-drag, or briefly out of the DOM) hides it for that frame without ending
 *    the loop. Bounded to at most `CHOOSE_BOTH_FX_CAP` elements, which is what keeps that sanctioned
 *    per-frame layout read cheap.
 *
 * `keys` are the `data-choose-both` values stamped on qualifying cards (see `CardView.chooseBothKey`) — the
 * only contract between the marker and card rendering. The CALLER decides which surfaces contribute, and
 * hands over `[]` while the board is covered by an unrelated overlay or during combat; that empties the list
 * and tears every loop down, which is the pause.
 */
export function useChooseBothFx(keys: readonly string[]): void {
  const key = keys.slice(0, CHOOSE_BOTH_FX_CAP).join(',');
  const active = useRef<Map<string, () => void>>(new Map());
  // Hidden tab: a background tab still runs the ticker in some browsers, and a marker nobody can see should
  // not be spending frames. Stored as a ref read by the sync effect (rather than a second effect racing it),
  // and bumped through a state-free re-run by re-invoking the sync from the listener.
  const hiddenRef = useRef(false);
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    const map = active.current;
    const sync = (): void => {
      const want = new Set(hiddenRef.current || !key ? [] : key.split(','));
      // Stop the loop on any card that no longer qualifies (the predicate flipped off, the card left the
      // zone, it fell past the cap, or the tab went away).
      for (const [k, dispose] of map) {
        if (!want.has(k)) { dispose(); map.delete(k); }
      }
      for (const k of want) {
        if (map.has(k)) continue;
        // The live centre of THIS card's rect, or null while it is being dragged / not in the DOM.
        const at = (): { x: number; y: number } | null => {
          // Matched by dataset rather than by an attribute selector: a key is a run uid or `disc:N`, but
          // building a selector out of run data is how a quoting bug gets in, and `CSS.escape` is not
          // available under jsdom. The scan is over at most `CHOOSE_BOTH_FX_CAP` marked elements.
          const el = [...document.querySelectorAll<HTMLElement>('[data-choose-both]')].find((n) => n.dataset.chooseBoth === k);
          if (!el || el.classList.contains('dragsrc')) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        const start = at();
        if (!start) continue; // not mounted yet — the next sync picks it up
        const dispose = playDef('choose-one-both', { source: start, target: start, cursor: start }, { loop: true, follow: at });
        if (dispose) map.set(k, dispose);
      }
    };
    syncRef.current = sync;
    sync();
  }, [key]);

  useEffect(() => {
    const onVis = (): void => { hiddenRef.current = document.hidden; syncRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Tear every live loop down when the surface unmounts (combat, title, a new run) — a looping player never
  // retires on its own, so an un-disposed loop would run for the rest of the session.
  useEffect(() => {
    const map = active.current;
    return () => { for (const d of map.values()) d(); map.clear(); };
  }, []);
}
