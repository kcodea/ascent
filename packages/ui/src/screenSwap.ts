import { useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { RunState } from '@game/sim';

/**
 * THE SCREEN SWAP WITHOUT A REMOUNT (R-DUOS-VIEW-NOREMOUNT-01, owner 2026-10-29 "Option A").
 *
 * The recruit screen is keyed on the run's identity (Game.tsx), so a new run or a replay seek gets a fresh board. A Duos
 * player watching their teammate puts THE TEAMMATE'S run in the store (another seed, hero and uid space). That used to
 * change the key too and rebuild the whole board on every swap (one or two frames over 33 ms on desktop, 250-500 ms of
 * long tasks on a phone). The key now holds through a teammate view (`heldScreenKey`), and what the remount used to
 * reset is reset here instead, on the render where the run ON SCREEN changes identity:
 *  - `useSwapRef`: a ref re-initialised from the new run (an FX sequence watcher's last-seen seq, a diff snapshot), so no
 *    watcher fires for the jump between two runs;
 *  - `useSwapState`: transient animation state back to its resting value;
 *  - the rows, overlays and FLIP runner below the shop are keyed on the screen (`screenIdOf`), so every card and its
 *    own stat-roll / pop state starts fresh (both runs mint uids from `b0`, so the same uid names two different cards);
 *  - effects that cancel in-flight work on unmount also run their cleanup on a swap (`screenId` in their deps).
 */

/** The identity of the run on screen: stable for a run's whole life, different for a teammate's. */
export function screenIdOf(run: Pick<RunState, 'seed' | 'heroId' | 'runId'>): string {
  return `${run.seed}:${run.heroId}:${run.runId ?? ''}`;
}

/** Game.tsx's mount key: holds the one it had while my teammate's screen is on (the store holds their run then). */
export function heldScreenKey(prev: string, live: string, watchingMate: boolean): string {
  return watchingMate ? prev : live;
}

/**
 * True on every render, up to its commit, where the run on screen has changed identity since the last commit. Committed
 * in a layout effect, so a render React throws away (StrictMode's double render) still sees the swap; every reset below
 * is idempotent, so seeing it twice is harmless.
 */
export function useScreenSwapped(screenId: string): boolean {
  const seen = useRef(screenId);
  const swapped = seen.current !== screenId;
  useLayoutEffect(() => { seen.current = screenId; }, [screenId]);
  return swapped;
}

/** `useRef(init)`, re-initialised to `init` (evaluated on this render, from the new run) on a screen swap. */
export function useSwapRef<T>(init: T, swapped: boolean): MutableRefObject<T> {
  const ref = useRef(init);
  if (swapped) ref.current = init;
  return ref;
}

/** Empty collections and equal primitives are the same resting value (no re-render to reset an already-empty Set). */
function atRest(v: unknown, rest: unknown): boolean {
  if (Object.is(v, rest)) return true;
  if (v instanceof Set && rest instanceof Set) return v.size === 0 && rest.size === 0;
  if (v instanceof Map && rest instanceof Map) return v.size === 0 && rest.size === 0;
  if (Array.isArray(v) && Array.isArray(rest)) return v.length === 0 && rest.length === 0;
  return false;
}

/**
 * `useState(init)`, put back to `init` on a screen swap (during the render, React's "adjust state on a prop change"
 * pattern: React re-renders at once, before anything commits, so no effect or paint ever sees the old screen's value).
 * `init` is read on every render for this; pass a function when building it costs anything.
 */
export function useSwapState<S>(init: S | (() => S), swapped: boolean): [S, Dispatch<SetStateAction<S>>] {
  const pair = useState(init);
  if (swapped) {
    const rest = typeof init === 'function' ? (init as () => S)() : init;
    if (!atRest(pair[0], rest)) pair[1](() => rest);
  }
  return pair;
}
