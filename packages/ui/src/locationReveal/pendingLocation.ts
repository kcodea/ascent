/**
 * WHERE THE GAME BEING STARTED IS PLAYED: the location of the hero pick on screen, from the store's pending mode. Only the
 * modes whose gate plays the reveal have one today (Ranked and Practice, owner 2026-11-24); every other mode answers null
 * and its gate and hero select are unchanged.
 */
import type { Tribe } from '@game/core';
import { activeSet } from '@game/content';
import { godPracticeConfig, practiceRunTribes, practiceSetOf, runTribesForSeed, type PracticeConfig } from '@game/sim';
import { locationOfSet, postersFor, type LocationDef } from './locations';
import type { LocationRevealRequest } from './revealPlayer';

/** The store slice these read (structural: tests need no store). */
export interface PendingLocationState {
  pendingMode: string | null;
  pendingSeed?: number | null | undefined;
  practiceDraft: PracticeConfig;
}

/** The Practice config the game will be created with (God Mode plays the live set, whatever the draft holds). */
const effectivePractice = (cfg: PracticeConfig): PracticeConfig => (cfg.godMode === true ? godPracticeConfig(cfg) : cfg);

/** Practice's location from its draft (its Location pick; the live one in a player build, where the draft holds none). */
export function practiceLocation(cfg: PracticeConfig): LocationDef | null {
  return locationOfSet(practiceSetOf(effectivePractice(cfg)));
}

export function pendingLocation(s: PendingLocationState): LocationDef | null {
  if (s.pendingMode === 'lobby') return locationOfSet(activeSet().id);
  if (s.pendingMode === 'practice') return practiceLocation(s.practiceDraft);
  return null;
}

/** The tribes the game being started will play with. */
export function pendingTribes(s: PendingLocationState): Tribe[] {
  if (s.pendingSeed == null) return [];
  if (s.pendingMode === 'practice') return practiceRunTribes(s.pendingSeed, effectivePractice(s.practiceDraft));
  return runTribesForSeed(s.pendingSeed);
}

/** What the gate reveals for the game being started, or null (no location, or nothing is pending). */
export function pendingReveal(s: PendingLocationState): LocationRevealRequest | null {
  const location = pendingLocation(s);
  if (!location || s.pendingSeed == null) return null;
  const tribes = postersFor(location, pendingTribes(s));
  return { location, tribes: tribes.length > 0 ? tribes : [...location.posters] };
}
