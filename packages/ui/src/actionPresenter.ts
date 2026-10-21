/**
 * ONE ACTION, ONE PRESENTATION: the player's own, and a spectator's (owner 2026-10-15: "make sure pixi effects are
 * firing as well as sound effects. all animations etc are important to be on there").
 *
 * Part of a card action's presentation is drawn where the INPUT happens: the press on a card sounds its touch, the
 * player's own play lands with the plate dissolve and the landing dust (and is not mistaken for a summon), a spell cast
 * plays its authored def or sparks from the release point, a sold minion floats its Gold and sprinkles coins. A
 * spectator has no input, so all of that used to be lost on the watch screen.
 *
 * Recruit registers the ONE presenter here; the player's input handlers AND the spectator's action queue
 * (`versus/spectate.ts`) both call it, with the same description of the moment. Nothing here decides gameplay.
 */
import type { BoardCard } from '@game/sim';

/** The cast's own card (its per-card cast multipliers), as `spellCasts` reads it. */
export type CastCard = Pick<BoardCard, 'extraCasts' | 'castMult'>;

export interface ScreenPoint { x: number; y: number }

export type PresentedAction =
  /** A card was picked up (its touch). */
  | { kind: 'touch' }
  /** BEFORE the commit of the player's own minion play: it is the player's placement, not an arrival. */
  | { kind: 'placing'; uid: string }
  /** AFTER the commit: the played minion lands (the plate dissolves from `plate`, its screen rect; the landing dust). */
  | { kind: 'played'; uid: string; plate?: { left: number; top: number; width: number; height: number } | null }
  /** AFTER the commit: a spell was cast (`card` is the hand instance, read before the cast removed it). */
  | { kind: 'cast'; cardId: string; at: ScreenPoint; card?: CastCard; targetUid?: string; asksFirst?: boolean }
  /** AFTER the commit: a board minion moved slot. */
  | { kind: 'repositioned'; uid: string }
  /** BEFORE the commit: a board minion is sold (its Gold floats at `at`, coins out of the Gold pill). */
  | { kind: 'sold'; at: ScreenPoint; amount: number }
  /** BEFORE the commit of a drag-drop a VIEWER watched live (R-SPECTATE-SMOOTH-01): the rows are snapshotted with the
   *  held card's gap still open, and the card slides home from `from` (where the watched hand let it go), the same
   *  commit FLIP the player's own `onUp` primes. `drop` is the player's drop kind; `boughtUid` is a buy's new hand card
   *  (it slides in from `from`, as the player's own buy does; absent when the buy completed a triple). */
  | { kind: 'dropping'; uid: string; drop: 'place' | 'reposition' | 'reorderShop' | 'sell' | 'buy'; from: { left: number; top: number; width: number; height: number } | null; boughtUid?: string };

let presenter: ((a: PresentedAction) => void) | null = null;

/** Recruit installs the presenter while it is mounted (returns the uninstall, a `useEffect` cleanup). */
export function setActionPresenter(fn: (a: PresentedAction) => void): () => void {
  presenter = fn;
  return () => { if (presenter === fn) presenter = null; };
}

/** Present one action (a no-op with no screen mounted). A presentation never breaks its caller. */
export function presentAction(a: PresentedAction): void {
  try { presenter?.(a); } catch { /* a visual must never break the action */ }
}
