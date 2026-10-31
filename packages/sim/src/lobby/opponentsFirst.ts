/**
 * OPPONENTS FIRST (owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01). Owner, verbatim: "we want full unique heroes, and i
 * want the players in ranked modes to get their options technically after the opponents are chosen, so it forces more
 * variety in hero selection".
 *
 * A ranked lobby picks its seven seats at Play (`createLobbyTable`), BEFORE the hero offer, and the offer is then dealt
 * from the heroes no seat holds. Before this, the player's offer was the whole roster and the seats skipped the picked
 * hero, so a popular hero could be offered (and picked) every game while the seats worked around it.
 *
 * THE FALLBACK (flagged rule): the offer must still show three heroes. When the run's tribes leave fewer than three
 * heroes outside the table, the offer is topped up with held heroes (`toppedUp`). Picking one of those is the only way
 * a pick can meet an opponent, and `createLobbyRun` then re-picks the table the old way (seats skip the picked hero),
 * so every hero in the lobby is still unique. Never happens with today's roster (the tribe gate leaves 20+ heroes).
 */
import { playableHeroes } from '../heroes';
import type { Tribe } from '@game/core';

export const RANKED_HERO_OFFER_SIZE = 3;

/** A seeded-or-not shuffle source: a function returning [0, 1). The UI passes `Math.random`; tools pass a seeded rng. */
export type UnitRandom = () => number;

function shuffled<T>(xs: readonly T[], rand: UnitRandom): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The heroes a ranked offer (and its re-roll) may draw: the run's tribes' playable heroes minus the table's. */
export function freeRankedHeroes(tribes: readonly Tribe[] | undefined, held: ReadonlySet<string>): string[] {
  return playableHeroes(tribes).map((h) => h.id).filter((id) => !held.has(id));
}

/**
 * The ranked hero offer, dealt AFTER the table: three heroes no seat holds, shuffled. `toppedUp` when the free list was
 * shorter than three and held heroes filled the rest (see the module note).
 */
export function rankedHeroOffer(tribes: readonly Tribe[] | undefined, held: ReadonlySet<string>, rand: UnitRandom, size = RANKED_HERO_OFFER_SIZE): { offer: string[]; toppedUp: boolean } {
  const free = shuffled(freeRankedHeroes(tribes, held), rand);
  if (free.length >= size) return { offer: free.slice(0, size), toppedUp: false };
  const rest = shuffled(playableHeroes(tribes).map((h) => h.id).filter((id) => held.has(id)), rand);
  return { offer: [...free, ...rest].slice(0, size), toppedUp: free.length < Math.min(size, free.length + rest.length) };
}
