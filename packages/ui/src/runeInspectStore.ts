/**
 * THE RUNE INSPECT state (owner 2026-10-25, R-TOUCH-TAPINSPECT-01: "a TAP on a minion/card ... runes ... opens Inspect").
 * On a touch device a tap on a Runeforge offer opens its enlarged view (RuneInspect.tsx) instead of buying it; the view's
 * Pick button runs the buy the tap used to. Kept out of the game store: it is a view of one offer, never recorded.
 */
import { create } from 'zustand';
import type { RuneDef } from '@game/core';

export interface RuneInspectView {
  rune: RuneDef;
  /** The live price (the forge's pivot discount) when it differs from the printed one. */
  cost?: number;
  duplicating?: boolean;
  /** Can it be bought right now (the Gold)? The Pick button shows only then. */
  affordable: boolean;
  /** Run the buy the tap used to (the RuneCard's own `onBuy` with its element, for the lock-in ceremony). */
  pick: () => void;
}

export const useRuneInspect = create<{ view: RuneInspectView | null }>(() => ({ view: null }));
export const openRuneInspect = (view: RuneInspectView): void => useRuneInspect.setState({ view });
export const closeRuneInspect = (): void => useRuneInspect.setState({ view: null });
