import { useSyncExternalStore } from 'react';
import { getLobbyRailLook, subscribeLobbyRailLook } from './lobbyRailLookConfig';

/**
 * OWNER REVIEW (2026-10-30: "is there a way to make our lobby rail aesthetic nicer / better fit in our overall
 * aesthetic?" then "build 3 versions on a branch so i can see how they look"). Which rail design is on screen:
 *   current    the shipped Gem rail (also Classic): today's markup, untouched
 *   plaque     A: a framed rail of mini hero plaques; the fallen collapse into a strip of small portraits
 *   ledger     B: today's rows, restyled: framed, ringed portraits, a heart + Armor pill, half-height fallen rows
 *   medallion  C: a column of big ringed portrait medallions, no row boxes, a minimal frame
 *   cards      D: C's medallions on card plates again: portrait + Health on one line, the full name on its own line
 *
 * DEV ONLY. Production always reads 'current' (the look never leaves DEFAULTS there, and this returns the constant
 * outside a dev build), and the variants' stylesheet is only loaded in a dev build (LobbyPanel). Picked in the 🎨 Lobby
 * Rail Look tuner ("Lobby rail") or with `?rail=a|b|c|current`; remembered in localStorage.
 */
export type RailVariant = 'current' | 'plaque' | 'ledger' | 'medallion' | 'cards';

export function useRailVariant(): RailVariant {
  const look = useSyncExternalStore(subscribeLobbyRailLook, getLobbyRailLook, getLobbyRailLook);
  if (!import.meta.env.DEV) return 'current';
  return look === 'plaque' || look === 'ledger' || look === 'medallion' || look === 'cards' ? look : 'current';
}
