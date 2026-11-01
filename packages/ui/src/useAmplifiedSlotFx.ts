import { useEffect, useRef } from 'react';
import type { EquipFx } from '@game/sim';
import { canPlayDefs, ensureDefsReady, playDef, type PlayDefOptions } from './fx/playDef';
import type { FxAnchors } from './fx/anchors';
import { pixiFx } from './pixiFx';
import { useAmplifiedVariant, type AmplifiedVariant } from './amplifiedFxConfig';

/**
 * THE AMPLIFIED LOOP (owner ask 2026-09-22): *"i created an amplified effect that should play on equipment when
 * amplified. it should only play when a usable equipment is equipped/selected. if an equipment has 0 charges it
 * should not show the animation."*
 *
 * The Amplified def rides the Equipment
 * SLOT BUTTON for as long as the SELECTED Equipment will Amplify its next activation AND has a charge to spend.
 * The CALLER decides that (StatusBar derives it off `run.equipment`, the same reads that paint the charge number
 * blue); this hook only turns `active` into exactly one live loop, and turns it off again.
 *
 * Built on the same rails as `useCiaEnchantedFx` (and the retired Pixi (Both) ring), for the same reasons:
 *  - `loop: true` runs the def continuously, so THE CALLER OWNS TEARDOWN — a looping player never retires on
 *    its own. The loop here is disposed the moment `active` goes false (used, swapped to an unamplified
 *    Equipment, the turn ends, the phase leaves the shop, the slot is gone, an overlay covers the board), when
 *    the tab is hidden, and on unmount. Nothing can outlive the state it marks.
 *  - ONE loop, never two. There is one slot, so the loop is keyed on nothing but `active`: swapping between two
 *    Amplified Equipment keeps the same loop running on the same point, and a re-render while it runs starts
 *    nothing (`disposeRef` is the whole guard).
 *
 * Where it departs from those two: the slot does not fan or reorder, so the play gets FIXED anchors measured once
 * per (re)start: no layout read per frame. The lightning looks need more than a centre (arcs run along the frame's
 * edges and across its diagonals), so the anchors carry the slot's edge and corner points as `parts`
 * (`amplifiedAnchors`), which is why there is no `follow` (a follow point collapses every anchor to one). The only
 * thing that moves the slot is a resize (`--scale` is rewritten by Game.tsx), so a resize re-measures (rAF-debounced)
 * and, when the box really moved, restarts the loop once on the new box.
 *
 * WHICH def (owner ask 2026-11-01, "Design a new one"; direction: energy / lightning): the look is a DEV switch
 * (`amplifiedFxConfig.ts`) over three lightning loops (twin snap, the default; corona; rim crackle) and the original
 * `amplified-slot` ring. A switch while the loop runs disposes it and starts the new look once. Production always
 * plays the default.
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

/** The slot button's screen box: left / top / width / height. */
export type SlotBox = { x: number; y: number; w: number; h: number };

/** How far outside the frame the arcs run, as a fraction of the slot's width: they lick the frame, not the art. */
export const AMPLIFIED_RIM_MARGIN = 0.06;

/**
 * The anchors every Amplified play gets: `source` / `target` / `cursor` at the slot's centre (the ring, the corona,
 * the release discharge), plus the frame's edge and corner points as anchor PARTS for the lightning looks:
 *  - `source.top/right/bottom/left` = that edge's midpoint; `target.<same>` = the NEXT corner clockwise, so a
 *    travel bolt on part `top` runs along the top edge (a radiating crackle on it sparks off the edge's middle);
 *  - `badge.attack` = top-left corner to bottom-right corner, `badge.health` = top-right to bottom-left: the two
 *    diagonals of the twin snap's X. (The slot has no badges; these are just the two spare part names.)
 * Every point sits `AMPLIFIED_RIM_MARGIN` outside the frame. Pure, so the geometry is tested without a renderer.
 */
export function amplifiedAnchors(b: SlotBox): FxAnchors {
  const m = b.w * AMPLIFIED_RIM_MARGIN;
  const l = b.x - m, t = b.y - m, r = b.x + b.w + m, btm = b.y + b.h + m;
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const tl = { x: l, y: t }, tr = { x: r, y: t }, br = { x: r, y: btm }, bl = { x: l, y: btm };
  return {
    source: c, target: c, cursor: c,
    parts: {
      source: { top: { x: c.x, y: t }, right: { x: r, y: c.y }, bottom: { x: c.x, y: btm }, left: { x: l, y: c.y }, 'badge.attack': tl, 'badge.health': tr },
      target: { top: tr, right: br, bottom: bl, left: tl, 'badge.attack': br, 'badge.health': bl },
    },
  };
}

/**
 * Start the loop in the given look. One LITERAL id per branch, so `directCalls.ts`'s scan attributes every
 * Amplified def to this file (an id passed as an expression would be a dynamic call site the scan cannot see).
 */
function playAmplifiedLoop(variant: AmplifiedVariant, b: SlotBox, opts: PlayDefOptions): (() => void) | null {
  const anchors = amplifiedAnchors(b);
  switch (variant) {
    case 'corona':
      return playDef('amplified-corona', anchors, opts);
    case 'rim-crackle':
      return playDef('amplified-rim-crackle', anchors, opts);
    case 'classic':
      return playDef('amplified-slot', anchors, opts);
    default:
      return playDef('amplified-twin-snap', anchors, opts);
  }
}

/** The live box of the slot button, or null when it is not in the DOM / has no layout box this frame. */
function slotBox(): SlotBox | null {
  const el = document.querySelector<HTMLElement>(AMPLIFIED_SLOT_SELECTOR);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

const sameBox = (a: SlotBox, b: SlotBox): boolean =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

export function useAmplifiedSlotFx(active: boolean): void {
  const variant = useAmplifiedVariant();
  const variantRef = useRef(variant);
  const activeRef = useRef(active);
  /** The one live loop's caller-owned teardown. Set = a loop is running; nothing starts while it is set. */
  const disposeRef = useRef<(() => void) | null>(null);
  /** The slot box the live loop was started on. Measured on start and on resize only. */
  const boxRef = useRef<SlotBox | null>(null);
  // Hidden tab: a background tab still runs the ticker in some browsers, and a glow nobody can see should not
  // be spending particles and bolts every frame. Seeded from the live value so a hook mounting in a background tab
  // (a Continue in a tab the player left) starts nothing until it is looked at.
  const hiddenRef = useRef(typeof document !== 'undefined' && document.hidden);
  const syncRef = useRef<() => void>(() => {});
  /** Tear the live loop down (if any) and re-sync — how a look switch restarts it in the new look. */
  const restartRef = useRef<() => void>(() => {});

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
      boxRef.current = null;
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
      const b = slotBox();
      if (!b) {
        // Not painted yet (or no layout box this frame) — bounded retry, never dropped, never forever.
        if (retries < AMPLIFIED_RETRY_FRAMES) { retries += 1; syncNextFrame(); }
        return;
      }
      boxRef.current = b;
      // Fixed anchors off the box: no layout read per frame.
      const dispose = playAmplifiedLoop(variantRef.current, b, { loop: true });
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
    restartRef.current = () => {
      if (disposeRef.current) { disposeRef.current(); disposeRef.current = null; }
      sync();
    };

    // The slot MOVES on resize (`--scale` is rewritten by Game.tsx's resize handler), so re-measure — one layout
    // read per resize, debounced to a frame, and only while a loop is live. Game's handler is a layout effect on the
    // same event, so by the next frame the slot is already where it will stay. A box that really moved restarts the
    // loop once on the new box (its edge / corner anchors are fixed per play).
    const onResize = (): void => {
      if (!disposeRef.current || resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (!disposeRef.current) return;
        const b = slotBox();
        if (b && boxRef.current && !sameBox(b, boxRef.current)) restartRef.current();
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
      restartRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    syncRef.current();
  }, [active]);

  // A LOOK SWITCH (DEV tuner): a running loop is swapped for the new look, exactly once; an idle one stays idle.
  useEffect(() => {
    if (variantRef.current === variant) return;
    variantRef.current = variant;
    restartRef.current();
  }, [variant]);
}

/**
 * THE RELEASE (owner ask 2026-11-01): the moment an Amplified activation FIRES, the slot lets go of its charge in
 * two sharp lightning discharges, one per trigger (`amplified-release`).
 *
 * "An Amplified activation fired" is read off the two things StatusBar already has: the Equipment that WAS
 * Amplified on the previous render (`amplifiedId`, the same read that paints the charge blue and gates the loop),
 * and a fresh Equipment-use cue for that same Equipment on the per-action channel (`equipFxSeq` / `equipFx`).
 * Both are needed: a use of an unamplified Equipment is not a release, and the Amplification ending without a use
 * (a swap, End of Turn) is not one either. Mounting with a cue already on the channel fires nothing, and a
 * re-render without a new `seq` fires nothing, so each press releases once.
 *
 * Played at the slot button's centre, measured once at the fire (a one-shot, no `follow`). Instant, not on the
 * use def's tuner delay: it is the slot discharging as it is pressed, the use def is what travels after.
 */
export function useAmplifiedReleaseFx(seq: number | undefined, cues: readonly EquipFx[] | undefined, amplifiedId: string | null): void {
  const seqRef = useRef(seq);
  const ampRef = useRef(amplifiedId);
  const stopsRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    const wasAmplified = ampRef.current;
    ampRef.current = amplifiedId;
    if (seq === seqRef.current) return;
    seqRef.current = seq;
    if (!wasAmplified || !cues?.some((c) => c.kind === 'use' && c.equipmentId === wasAmplified)) return;
    if (!canPlayDefs()) return;
    const b = slotBox();
    if (!b) return;
    const stop = playDef('amplified-release', amplifiedAnchors(b));
    if (stop) stopsRef.current.push(stop);
  }, [seq, amplifiedId, cues]);
  // A one-shot retires on its own; unmount (a new run, the title) retires whatever is still playing.
  useEffect(() => () => { for (const f of stopsRef.current.splice(0)) f(); }, []);
}
