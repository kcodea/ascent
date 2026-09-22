import { useEffect, useRef } from 'react';
import { canPlayDefs, ensureDefsReady, playDef } from './fx/playDef';
import { pixiFx } from './pixiFx';

/**
 * THE AMPLIFIED LOOP (owner ask 2026-09-22): *"i created an amplified effect that should play on equipment when
 * amplified. it should only play when a usable equipment is equipped/selected. if an equipment has 0 charges it
 * should not show the animation."*
 *
 * The owner-authored `amplified-slot` def — a ring of blue motes, `loopMode: seamless` — rides the Equipment
 * SLOT BUTTON for as long as the SELECTED Equipment will Amplify its next activation AND has a charge to spend.
 * The CALLER decides that (StatusBar derives it off `run.equipment`, the same reads that paint the charge number
 * blue); this hook only turns `active` into exactly one live loop, and turns it off again.
 *
 * Built on the same rails as `useChooseBothFx` / `useCiaEnchantedFx`, for the same reasons:
 *  - `loop: true` runs the def continuously, so THE CALLER OWNS TEARDOWN — a looping player never retires on
 *    its own. The loop here is disposed the moment `active` goes false (used, swapped to an unamplified
 *    Equipment, the turn ends, the phase leaves the shop, the slot is gone, an overlay covers the board), when
 *    the tab is hidden, and on unmount. Nothing can outlive the state it marks.
 *  - ONE loop, never two. There is one slot, so the loop is keyed on nothing but `active`: swapping between two
 *    Amplified Equipment keeps the same loop running on the same point, and a re-render while it runs starts
 *    nothing (`disposeRef` is the whole guard).
 *
 * Where it departs from those two: the slot does not fan or reorder, so `follow` returns a CACHED point rather
 * than re-reading layout every frame. The button is measured ONCE per (re)start and again on `resize`
 * (rAF-debounced) — the only thing that moves it, because `--scale` is rewritten on every resize (Game.tsx).
 * Zero layout reads per frame.
 *
 * Two "can't start yet" cases are waited for rather than dropped, and both re-check the LATEST condition when
 * they land so a stale start can never fire after the state moved on:
 *  - the def primitives or the overlay renderer are not up yet (a Continue run landing straight in the shop):
 *    `ensureDefsReady()` resolves when the primitives register and `pixiFx.onRendererReady` fires when the
 *    canvas attaches — whichever lands first schedules a re-sync;
 *  - the slot has no layout box this frame: retried on rAF, bounded by `AMPLIFIED_RETRY_FRAMES`.
 * Every pending wait is cancelled when the loop stops or the hook unmounts (the leak paths of the review).
 */

/**
 * The slot button the loop is centred on. `:not(.leaving)` skips the fade-out copy StatusBar keeps in the DOM
 * for 260 ms after the real slot is gone (`equipLeaving`): the loop keys on STATE, never on an element being
 * present, and that ghost must never be measured as the live slot.
 */
export const AMPLIFIED_SLOT_SELECTOR = '.statusbar .equipslot:not(.leaving) .heropowerbtn';

/** How many frames a start is retried while the slot has no layout box. Far longer than a React commit +
 *  paint, and bounded so a slot that never appears cannot hold a permanent rAF. */
export const AMPLIFIED_RETRY_FRAMES = 10;

type Point = { x: number; y: number };

/** The live centre of the slot button, or null when it is not in the DOM / has no layout box this frame. */
function slotCentre(): Point | null {
  const el = document.querySelector<HTMLElement>(AMPLIFIED_SLOT_SELECTOR);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function useAmplifiedSlotFx(active: boolean): void {
  const activeRef = useRef(active);
  /** The one live loop's caller-owned teardown. Set = a loop is running; nothing starts while it is set. */
  const disposeRef = useRef<(() => void) | null>(null);
  /** The cached slot centre `follow` hands the player every frame. Re-measured on start and on resize only. */
  const pointRef = useRef<Point | null>(null);
  // Hidden tab: a background tab still runs the ticker in some browsers, and a glow nobody can see should not
  // be spending ~3.7k particles a frame. Seeded from the live value so a hook mounting in a background tab
  // (a Continue in a tab the player left) starts nothing until it is looked at.
  const hiddenRef = useRef(typeof document !== 'undefined' && document.hidden);
  const syncRef = useRef<() => void>(() => {});

  // ONE effect owns the machinery — every function below reads refs only, so the first render's closures stay
  // valid for the hook's whole life, and the `[active]` effect further down just re-runs `sync`.
  useEffect(() => {
    let retryRaf = 0;
    let retries = 0;
    let resizeRaf = 0;
    /** Disposer for the readiness wait (renderer listener + the primitives promise), while one is armed. */
    let readyWait: (() => void) | null = null;

    const cancelRetry = (): void => {
      if (retryRaf) { cancelAnimationFrame(retryRaf); retryRaf = 0; }
    };
    const cancelReadyWait = (): void => {
      readyWait?.();
      readyWait = null;
    };
    /** Re-run `sync` on the next frame — off the current call stack, so a readiness callback that fires
     *  synchronously (`onRendererReady` calls back at once when the canvas already exists) cannot re-enter. */
    const syncNextFrame = (): void => {
      cancelRetry();
      retryRaf = requestAnimationFrame(() => { retryRaf = 0; sync(); });
    };
    const stop = (): void => {
      cancelRetry();
      cancelReadyWait();
      retries = 0;
      if (disposeRef.current) { disposeRef.current(); disposeRef.current = null; }
      pointRef.current = null;
    };
    const sync = (): void => {
      const wanted = activeRef.current && !hiddenRef.current;
      if (!wanted) { stop(); return; }
      if (disposeRef.current) return; // already running — never a second loop
      if (!canPlayDefs()) {
        // The primitives are still loading or the overlay renderer is not attached yet. Wait for whichever
        // lands, once; the re-sync goes through `sync` again so it re-reads the LATEST condition.
        if (!readyWait) {
          let done = false;
          const offRenderer = pixiFx.onRendererReady(() => { if (!done) syncNextFrame(); });
          void ensureDefsReady().then(() => { if (!done) syncNextFrame(); });
          readyWait = () => { done = true; offRenderer(); };
        }
        return;
      }
      cancelReadyWait();
      const p = slotCentre();
      if (!p) {
        // Not painted yet (or no layout box this frame) — bounded retry, never dropped, never forever.
        if (retries < AMPLIFIED_RETRY_FRAMES) { retries += 1; syncNextFrame(); }
        return;
      }
      pointRef.current = p;
      // `follow` returns the CACHED point: no layout read per frame. The literal id is what lets
      // `directCalls.ts`'s scan attribute the def to this file.
      const dispose = playDef('amplified-slot', { source: p, target: p, cursor: p }, {
        loop: true,
        follow: () => pointRef.current,
      });
      if (!dispose) {
        // The `over` canvas declined (its renderer went away between the check and the play). Same bounded
        // retry as an unpainted slot; `canPlayDefs()` gates the next attempt.
        if (retries < AMPLIFIED_RETRY_FRAMES) { retries += 1; syncNextFrame(); }
        return;
      }
      retries = 0;
      disposeRef.current = dispose;
    };
    syncRef.current = sync;

    // The slot MOVES on resize (`--scale` is rewritten by Game.tsx's resize handler), so re-measure into the
    // cache — one layout read per resize, debounced to a frame, and only while a loop is live. Game's handler
    // is a layout effect on the same event, so by the next frame the slot is already where it will stay.
    const onResize = (): void => {
      if (!disposeRef.current || resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (!disposeRef.current) return;
        const p = slotCentre();
        if (p) pointRef.current = p;
      });
    };
    // Hidden tab → tear down; visible again → restart (if still wanted). A restart re-measures the slot.
    const onVis = (): void => { hiddenRef.current = document.hidden; sync(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    sync();
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
      // Unmount (title, a new run, the bar's key changing): a looping player never retires on its own.
      stop();
      syncRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    syncRef.current();
  }, [active]);
}
