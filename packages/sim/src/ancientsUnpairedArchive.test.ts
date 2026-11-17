import { afterEach, describe, expect, it } from 'vitest';
import { ANCIENT_PAIRINGS } from './ancients';
import { ANCIENTS_LIVE, heroArchivedByAncients, heroHasAncientPairings, withAncientsLive } from './ancientsRelease';
import { HEROES, HERO_INDEX, getHero, isArchivedHero, playableHeroes, powerDiscoverPool, practiceHeroChoiceIds, practiceHeroes } from './heroes';
import { createRun } from './state';
import { createRunLobby } from './lobby/runLobby';
import { createPracticeBotLobby } from './lobby/practiceBots';
import { freeRankedHeroes, rankedHeroOffer } from './lobby/opponentsFirst';
import { versusDisjointHeroOffers } from './versus/heroOffers';
import { makeRng } from '@game/core';

/**
 * UNPAIRED HEROES ARE ARCHIVED WHILE ANCIENTS ARE LIVE (owner 2026-11-17, verbatim: "when ancients go live, any hero
 * that does not have ancients CANNOT be offered. this means that any hero that does not have ancients should join
 * the archived heroes list until re-added. (guardian + runesmith)"). R-ANCIENTS-UNPAIRED-ARCHIVED-01.
 */
const UNPAIRED = ['runesmith', 'runeguard'];

/** Every place a NEW run can be handed a hero, as one set of ids (the switch is read by each call). */
function everyOffer(): Set<string> {
  const ids = new Set<string>();
  const add = (xs: Iterable<string>): void => { for (const x of xs) ids.add(x); };
  for (const tribes of [undefined, ['dragon', 'beast', 'mech'] as const, ['kobold', 'dwarf', 'undead'] as const]) {
    add(playableHeroes(tribes).map((h) => h.id));
    add(playableHeroes(tribes, { duos: true }).map((h) => h.id));
    add(practiceHeroes(tribes).map((h) => h.id));
    add(practiceHeroChoiceIds('all', tribes));
    add(powerDiscoverPool('mimic', [], tribes));
    add(powerDiscoverPool('void', [], tribes));
    add(freeRankedHeroes(tribes, new Set()));
    add(rankedHeroOffer(tribes, new Set(), ((r) => () => r.next())(makeRng(5)), 60).offer);
  }
  for (const setId of ['set2', 'set3'] as const) {
    const seats = Array.from({ length: 8 }, (_, i) => ({ heroSeed: 100 + i, runSeed: 900 + i }));
    for (const o of versusDisjointHeroOffers(seats, setId)) add(o);
    for (const o of versusDisjointHeroOffers(seats.slice(0, 4), setId, undefined, { duos: true })) add(o);
  }
  return ids;
}

/** Generated rival seats + Practice bot portraits of a few new lobbies (recorded snapshot seats excluded). */
function generatedSeatHeroes(): Set<string> {
  const ids = new Set<string>();
  for (let seed = 1; seed <= 3; seed++) {
    for (const seat of createRunLobby(seed * 977, 'warden', {}, 'set3').seats) {
      if (seat.kind !== 'snapshot' && seat.kind !== 'player') ids.add(seat.heroId);
    }
    for (const seat of createPracticeBotLobby(seed, 'warden', 3).seats.slice(1)) ids.add(seat.heroId);
  }
  return ids;
}

describe('Ancients release: a hero with no pairings is archived while the switch is on', () => {
  const saved = ANCIENT_PAIRINGS.runesmith;
  afterEach(() => {
    if (saved === undefined) delete ANCIENT_PAIRINGS.runesmith;
    else ANCIENT_PAIRINGS.runesmith = saved;
  });

  it('ships off, and today exactly Runesmith and Guardian lack pairings among the live heroes', () => {
    expect(ANCIENTS_LIVE).toBe(false);
    const unpaired = HEROES.filter((h) => !h.wip && !heroHasAncientPairings(h.id)).map((h) => h.id).sort();
    expect(unpaired).toEqual([...UNPAIRED].sort());
  });

  it('switch OFF: nothing changes, Runesmith and Guardian are offered and not archived', () => {
    const offers = withAncientsLive(false, everyOffer);
    for (const id of UNPAIRED) {
      expect(withAncientsLive(false, () => isArchivedHero(HERO_INDEX[id]!)), id).toBe(false);
      expect(heroArchivedByAncients(id), id).toBe(false);
      expect(offers.has(id), `${id} offered with the switch off`).toBe(true);
    }
  });

  it('switch ON: they are archived and appear in no offer path (hero select, Practice, Ranked, Versus, Duos, power Discovers)', () => {
    const offers = withAncientsLive(true, everyOffer);
    for (const id of UNPAIRED) {
      expect(withAncientsLive(true, () => isArchivedHero(HERO_INDEX[id]!)), id).toBe(true);
      expect(offers.has(id), `${id} offered with the switch on`).toBe(false);
    }
    // Every paired live hero is still offered somewhere, so the gate removed only the unpaired ones.
    for (const h of HEROES.filter((x) => !x.wip && !x.practiceOnly && heroHasAncientPairings(x.id))) {
      expect(offers.has(h.id), `${h.id} still offered`).toBe(true);
    }
  });

  it('switch ON: no generated rival seat or Practice bot wears one', () => {
    const seats = withAncientsLive(true, generatedSeatHeroes);
    for (const id of UNPAIRED) expect(seats.has(id), `${id} seated`).toBe(false);
  });

  it('switch ON: a stored reference still resolves and a run on one still starts (saves, replays, recorded seats, Scene Builder)', () => {
    withAncientsLive(true, () => {
      for (const id of UNPAIRED) {
        expect(getHero(id).id).toBe(id);
        expect(createRun(7, id, 'lobby').heroId).toBe(id);
      }
    });
  });

  it('switch ON: writing all six pairings re-adds the hero by itself (no list to maintain)', () => {
    ANCIENT_PAIRINGS.runesmith = { ...ANCIENT_PAIRINGS.indy };
    expect(heroHasAncientPairings('runesmith')).toBe(true);
    const offers = withAncientsLive(true, everyOffer);
    expect(withAncientsLive(true, () => isArchivedHero(HERO_INDEX.runesmith!))).toBe(false);
    expect(offers.has('runesmith')).toBe(true);
    expect(offers.has('runeguard')).toBe(false);
  });

  it('withAncientsLive restores the real switch afterwards, even on a throw', () => {
    expect(() => withAncientsLive(true, () => { throw new Error('x'); })).toThrow('x');
    expect(isArchivedHero(HERO_INDEX.runesmith!)).toBe(false);
  });
});
