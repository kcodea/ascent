import { useRef, useSyncExternalStore } from 'react';
import type { CardView } from './Card';
import { NO_DRAG_DECISION, type DragDecision, type DragSource, type Zone } from './dragDecision';

/**
 * THE TRANSIENT POINTER STATE of the recruit screen — the live drag, its decision, the hero-aim target — kept
 * in a tiny external store INSTEAD of `Recruit`-local React state (perf 2026-09-17, `docs/perf-handoff-2026-09-17.md`
 * PR 2).
 *
 * Why: every one of these used to be a `useState` inside `Recruit`, so each time the drag's decision moved (the
 * drop gap crossing a slot, the aim reticle crossing a card, the sell zone lighting up) the ENTIRE shop screen
 * re-rendered — ~30 `recruit renders` in a bad second of the owner's 240 Hz capture, on top of the action's own
 * render. The rows are memoized (2026-09-16), but a memo only skips work the parent didn't ask for, and the
 * parent asked on every pointer decision.
 *
 * Now the pointer path writes HERE (`dragStore.set` from the rAF-coalesced move flush), and only the components
 * that DRAW from it subscribe — each row (`useDragSlice`), the floating card overlay, the FLIP runner — through
 * `useSyncExternalStore`. A pointermove never re-renders `Recruit`: the row whose gap moved re-renders, nothing
 * else does. Same pattern as `turnClock.ts` (the per-second tick that used to reconcile every card).
 *
 * The store is a snapshot object replaced on every `set` (never mutated) so subscribers can compare by identity;
 * `pos` is the one deliberately MUTABLE field — the exact pointer position the visual layers (card transform,
 * aim line, trail) read per frame — and writing it notifies nobody, by design: nothing rendered by React needs it.
 */
export interface DragState {
  uid: string;
  source: DragSource;
  view: CardView;
  ox: number; oy: number; // anchor offset within the card — set to the CENTRE so the card rides centred on
                          // the cursor once dragging (all drop/insertion math is `x - ox + w/2` = cursor).
  grabOx: number; grabOy: number; // the ACTUAL grab point within the card — the floating card starts here
                                  // (no pickup pop) then smoothly recentres to the cursor over the first frames.
  w: number; h: number; // the source card's size, so the floating card matches exactly
  startX: number; startY: number; // pointer position at press
  x: number; y: number; // current pointer (the last DECISION point — coarse; `dragStore.pos` is exact)
  active: boolean; // crossed the drag threshold (vs a click)
  /** A REPLAY GHOST flight (2026-09-19): the replay player sets this drag while a recorded drag path plays, so
   *  the rows lift the source card exactly as they do for a live drag (`dimmed` → `.dragsrc`, the drop gap
   *  opening at the recorded destination). The floating `.dragcard` overlay skips it — the ghost layer is the
   *  moving card — and no pointer session exists behind it. Never set by a live drag. */
  ghost?: true;
}

export interface DragSnapshot {
  drag: DragState | null;
  overZone: Zone | null;
  /** The pointer-derived decision at `drag.x/y` — computed by the move flush, never during a render. */
  decision: DragDecision;
  /** A targeted spell/Ruby dragged above its cast line (aiming). Derived alongside `decision`. */
  castingSpell: boolean;
  snapping: boolean;      // the invalid-drop snap-back is animating (React/CSS own the floating card's transform)
  magSlide: boolean;      // a Magnetic card sliding into its Mech
  magTargetUid: string | null; // the Mech being merged into (crackles)
  sellTop: number;        // px — the sell region is the whole upper screen above the warband, measured per drag
  buyTop: number;         // px — the buy region is everything below the board's midline, measured per drag
  handSlotW: number;      // the hand's measured slot spacing (cards overlap), for the reorder parting
  touch: boolean;         // a touch/pen drag snaps to the finger (no weighted lag)
  /** The card under the hero-power / battlecry aim (the `targeted` highlight). Only crossings write it. */
  aimTargetUid: string | null;
}

const INITIAL: DragSnapshot = {
  drag: null, overZone: null, decision: NO_DRAG_DECISION, castingSpell: false,
  snapping: false, magSlide: false, magTargetUid: null, sellTop: 0, buyTop: 0, handSlotW: 0, touch: false,
  aimTargetUid: null,
};

let snap: DragSnapshot = INITIAL;
const listeners = new Set<() => void>();

export const dragStore = {
  get: (): DragSnapshot => snap,
  /** Shallow-merge a patch. Notifies only when a field actually changed (Object.is), so a no-op write costs
   *  nothing downstream — the move flush already gates on the decision, this is the second guard. */
  set: (patch: Partial<DragSnapshot>): void => {
    let changed = false;
    for (const k in patch) {
      if (!Object.is((snap as unknown as Record<string, unknown>)[k], (patch as unknown as Record<string, unknown>)[k])) { changed = true; break; }
    }
    if (!changed) return;
    snap = { ...snap, ...patch };
    listeners.forEach((l) => l());
  },
  /** Back to idle — a drag ended (dropped, snapped back, cancelled, unmounted). The aim target is NOT touched:
   *  it belongs to the hero-power gesture, which has its own lifecycle. */
  endDrag: (): void => {
    dragStore.pos = null;
    dragStore.set({ drag: null, overZone: null, decision: NO_DRAG_DECISION, castingSpell: false, snapping: false, magSlide: false });
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** The EXACT live pointer position during a drag, written on every pointermove and read per frame by the
   *  floating card's rAF, the aim line and the trail. Mutable and non-reactive on purpose (see the module doc). */
  pos: null as { x: number; y: number } | null,
  /** Test hook — never called by the game. */
  reset: (): void => { snap = INITIAL; dragStore.pos = null; listeners.forEach((l) => l()); },
};

/** Shallow equality over own enumerable keys — the default comparator for object slices. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/**
 * Subscribe a component to a SLICE of the pointer state. The selector runs on every store change; the
 * component re-renders only when the slice differs by `equal` (shallow by default, so a selector may return a
 * fresh object of scalars each time). Keep selectors pure over the snapshot — they are cached by snapshot
 * identity, so a selector that closes over render-time values would serve a stale slice.
 */
export function useDragSlice<T>(selector: (s: DragSnapshot) => T, equal: (a: T, b: T) => boolean = shallowEqual as (a: T, b: T) => boolean): T {
  const cache = useRef<{ snap: DragSnapshot; val: T } | null>(null);
  const getSnap = (): T => {
    const s = snap;
    const c = cache.current;
    if (c && c.snap === s) return c.val;
    const val = selector(s);
    if (c && equal(c.val, val)) { cache.current = { snap: s, val: c.val }; return c.val; }
    cache.current = { snap: s, val };
    return val;
  };
  return useSyncExternalStore(dragStore.subscribe, getSnap, getSnap);
}
