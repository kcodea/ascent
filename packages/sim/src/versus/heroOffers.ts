/**
 * UNIQUE HEROES PER LOBBY in VERSUS (owner 2026-10-31, R-VERSUS-UNIQUE-HEROES-01: "build unique heroes per lobby
 * rule"; every hero in a game is unique, in every mode). The room (Cloudflare Worker) deals every seat's three heroes
 * itself, at match creation, so no two seats are ever OFFERED the same hero, and it refuses a pick of a hero another
 * seat holds. Deterministic: a pure function of the seats' private hero and run seeds (drawn once per match and
 * stored) and the set.
 *
 * The deal: each seat keeps its own seeded shuffle (`versusHeroShuffle`, the list `versusHeroOffer` always drew its
 * three from), filtered by its own run's tribes. Then slot by slot, the seats take turns (slot k starts at seat k, so
 * no seat always picks first) and each takes the next hero of its shuffle that no seat has been dealt. A seat alone
 * gets exactly `versusHeroOffer`'s three. Only when a seat's list runs out of free heroes (more seats than the roster
 * covers, never with today's roster) does it repeat a hero another seat holds; the pick refusal then still keeps the
 * PICKED heroes unique.
 */
import { makeRng } from '@game/core';
import type { SetId } from '@game/content';
import { playableHeroes } from '../heroes';
import { mixSeed, runTribesForSeed } from '../runTribes';
import { VERSUS_HERO_OFFER_SIZE } from './constants';

/** A seat's whole seeded hero order: the heroes its run's tribes allow, shuffled from its private hero seed. The
 *  first three are `versusHeroOffer` (unchanged since 2026-10-13). */
export function versusHeroShuffle(heroSeed: number, runSeed: number, setId: SetId): string[] {
  const ids = playableHeroes(runTribesForSeed(runSeed, setId)).map((h) => h.id);
  const rng = makeRng(mixSeed(heroSeed, 0x4e50));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

/**
 * Every seat's three heroes, dealt so no hero is offered twice (see the module note). `seats` in seat order.
 *
 * `exclude` (OPPONENTS FIRST, owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01: Ranked Duos seats its three recorded teams
 * BEFORE the party's offers are dealt): heroes the table already holds, never dealt. Each seat's list simply loses them
 * first, so with nothing excluded the deal is exactly the one of before. A list that runs out of free heroes falls back to
 * the excluded ones (never with today's roster: the tribe gate leaves 20+ heroes, the table holds 6).
 */
export function versusDisjointHeroOffers(seats: readonly { heroSeed: number; runSeed: number }[], setId: SetId, exclude?: ReadonlySet<string>): string[][] {
  const full = seats.map((s) => versusHeroShuffle(s.heroSeed, s.runSeed, setId));
  const lists = exclude?.size
    ? full.map((l) => [...l.filter((h) => !exclude.has(h)), ...l.filter((h) => exclude.has(h))])
    : full;
  const offers: string[][] = seats.map(() => []);
  const dealt = new Set<string>();
  const n = seats.length;
  for (let slot = 0; slot < VERSUS_HERO_OFFER_SIZE; slot++) {
    for (let k = 0; k < n; k++) {
      const i = (slot + k) % n;
      const list = lists[i]!;
      const mine = offers[i]!;
      const hero = list.find((h) => !dealt.has(h)) ?? list.find((h) => !mine.includes(h));
      if (hero === undefined) continue;
      mine.push(hero);
      dealt.add(hero);
    }
  }
  return offers;
}

/** The heroes a seat's re-roll may land on: its candidates minus every hero another seat was dealt or holds. */
export function versusRerollCandidatesFree(candidates: readonly string[], heldElsewhere: Iterable<string>): string[] {
  const taken = new Set(heldElsewhere);
  return candidates.filter((c) => !taken.has(c));
}

/**
 * One automatic Hero Select pick (the clock ran out), deterministic and unique: the seat's seeded index (the room's own
 * draw, unchanged), or, when another seat already holds that hero, the first of its three nobody holds. `held` = the
 * heroes the other seats picked (manual picks first, then the earlier seats' automatic ones).
 */
export function uniqueAutoHeroIndex(offer: readonly string[], seededIndex: number, held: ReadonlySet<string>): number {
  if (!held.has(offer[seededIndex] ?? '')) return seededIndex;
  const free = offer.findIndex((h) => !held.has(h));
  return free >= 0 ? free : seededIndex;
}
