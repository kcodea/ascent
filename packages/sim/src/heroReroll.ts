/**
 * THE HERO RE-ROLL (owner 2026-10-15, R-HERO-REROLL-01). Owner, verbatim: "add a feature to the hero select that
 * allows a player to re-roll a single hero option once to get a new one in its place". Owner choices: ONE re-roll per
 * hero select (pick any one offered hero and swap it for a new one; then the option is gone), in every mode.
 *
 * Pure + seeded. The replacement is drawn from `pool` minus every hero already in the offer (the one being re-rolled
 * away is in the offer, so it can never come straight back), with an RNG seeded from the run seed and the label
 * "hero-reroll" (plus the slot), never `Math.random`. The same seed, offer, slot and pool always give the same hero,
 * so a save, a ranked entry resumed after a restart, and a replay all see the same offer history.
 *
 * The pool is the mode's own eligible list (the caller passes it): Ranked = `playableHeroes(runTribes)` (so a hero
 * whose power needs a tribe the run did not roll, like Foreman Flint without Dwarves, is never drawn), Practice and
 * Gauntlet = the list their picker was built from. When the offer already holds the whole pool there is nothing new
 * to draw and `heroRerollCandidates` is empty: the control is simply not offered.
 *
 * Versus draws on the SERVER (`versus_reroll_hero`, 2026-10-15-versus-hero-reroll.sql), from the match seed, over
 * the candidate list `heroRerollCandidates` builds here; the client only displays the answer.
 */
import { makeRng } from '@game/core';
import { mixSeed } from './state';

/** The one re-roll a hero select allows: which slot changed, and from which hero to which. */
export interface HeroReroll {
  slot: number;
  from: string;
  to: string;
}

/** FNV-1a of a label, so the stream is literally "seed + 'hero-reroll'" and stays apart from every other seeded draw. */
function labelHash(label: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
  return h | 0;
}
export const HERO_REROLL_LABEL = 'hero-reroll';
const HERO_REROLL_SALT = labelHash(HERO_REROLL_LABEL);

/** The heroes a re-roll may draw: the pool, in pool order, minus every hero already offered. */
export function heroRerollCandidates(offer: readonly string[], pool: readonly string[]): string[] {
  const offered = new Set(offer);
  const out: string[] = [];
  for (const id of pool) if (!offered.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/** Can this hero select still re-roll? Unused, and at least one hero left to draw. */
export function canRerollHero(offer: readonly string[], pool: readonly string[], used: HeroReroll | null | undefined): boolean {
  return !used && offer.length > 0 && heroRerollCandidates(offer, pool).length > 0;
}

/**
 * The re-roll of `slot`: a seeded draw from `heroRerollCandidates`. Null when the slot is out of range or nothing is
 * left to draw. Deterministic in (seed, offer, slot, pool).
 */
export function rollHeroReroll(seed: number, offer: readonly string[], slot: number, pool: readonly string[]): HeroReroll | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= offer.length) return null;
  const candidates = heroRerollCandidates(offer, pool);
  if (candidates.length === 0) return null;
  const rng = makeRng(mixSeed(seed, HERO_REROLL_SALT, slot));
  const to = candidates[Math.floor(rng.next() * candidates.length)]!;
  return { slot, from: offer[slot]!, to };
}

/** The offer after a re-roll (a new array; the offer passed in is never mutated). A re-roll that does not match the
 *  offer (wrong slot or hero) leaves it unchanged. */
export function applyHeroReroll(offer: readonly string[], r: HeroReroll): string[] {
  const out = [...offer];
  if (out[r.slot] === r.from) out[r.slot] = r.to;
  return out;
}

/** A well-formed re-roll record (saves, ranked entries and server rows are read back through this). */
export function isHeroReroll(x: unknown): x is HeroReroll {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.slot === 'number' && Number.isInteger(o.slot) && o.slot >= 0
    && typeof o.from === 'string' && o.from.length > 0 && typeof o.to === 'string' && o.to.length > 0 && o.from !== o.to;
}
