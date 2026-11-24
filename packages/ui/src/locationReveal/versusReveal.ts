/**
 * THE LOCATION REVEAL IN THE LIVE MODES (owner 2026-11-24, R-LOCATION-03): Versus 1v1, Group, Duos and Ranked Duos. Every
 * player's crystal breaks as the match is made, so it plays for all of them together. The server holds the Hero Select
 * clock for it (`versusHeroSelectMs`); against a server that does not, or for a player who arrives late, it is skipped, so
 * it never costs anyone their pick. Pure: the store hands in what it knows.
 */
import { SETS, type SetId } from '@game/content';
import { runTribesForSeed } from '@game/sim';
import { VERSUS_HERO_SELECT_SECONDS } from '@game/sim';
import { locationOfSet, postersFor, type LocationDef } from './locations';
import type { LocationRevealRequest } from './revealPlayer';
import { revealSeconds } from './revealTimeline';

/** The least of the pick clock a reveal may leave. */
const KEEP_MS = VERSUS_HERO_SELECT_SECONDS * 1000 - 3000;

export function versusLocation(setId: string | null | undefined): LocationDef | null {
  return setId && setId in SETS ? locationOfSet(setId as SetId) : null;
}

export interface VersusRevealInput {
  setId: string;
  runSeed: number;
  phase: string;
  paused: boolean;
  /** Left on the Hero Select deadline, by the server's clock (null = it has none yet). */
  remainingMs: number | null;
}

export function versusReveal(x: VersusRevealInput): LocationRevealRequest | null {
  const location = versusLocation(x.setId);
  if (!location || x.phase !== 'hero_select' || x.paused || x.remainingMs == null) return null;
  const tribes = postersFor(location, runTribesForSeed(x.runSeed, x.setId as SetId));
  const shown = tribes.length > 0 ? tribes : [...location.posters];
  if (x.remainingMs - revealSeconds(shown.length) * 1000 < KEEP_MS) return null;
  return { location, tribes: shown };
}

/** The Hero Select clock's face: it waits at its full time while the reveal's own seconds run (`moving` false). */
export function versusHeroClock(remainingMs: number): { shownMs: number; holdMs: number } {
  const full = VERSUS_HERO_SELECT_SECONDS * 1000;
  return { shownMs: Math.min(full, remainingMs), holdMs: Math.max(0, remainingMs - full) };
}
