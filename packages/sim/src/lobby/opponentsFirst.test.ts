import { afterEach, describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { playableHeroes } from '../heroes';
import { runTribesForSeed } from '../state';
import { createLobbyRun, createLobbyTable, createRunLobby, lobbyTableHeroes, resetLobbyDrivers, seatPlayerAtTable } from './runLobby';
import { freeRankedHeroes, rankedHeroOffer } from './opponentsFirst';

/**
 * OPPONENTS FIRST (owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01): "i want the players in ranked modes to get their
 * options technically after the opponents are chosen, so it forces more variety in hero selection". The ranked table is
 * picked before the hero offer, and the offer is dealt from the heroes no seat holds.
 */

const HEROES = playableHeroes().map((h) => h.id);
const snap = (author: string, heroId: string, seed: number, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: [], threat: 'glass',
  power: wave * 10, seed, origin: 'self', author, setId: 'set1', ownerId: `o-${author}`,
  minions: [{ cardId: 'pack', attack: wave, health: wave, keywords: [], golden: false }],
} as unknown as BoardSnapshot);
const run = (author: string, heroId: string, seed: number): BoardSnapshot[] => Array.from({ length: 8 }, (_, i) => snap(author, heroId, seed, i + 1));

afterEach(() => { OPPONENT_POOL.length = 0; });

describe('the ranked table is picked before the hero', () => {
  it('a table has seven opponents on seven different heroes and an empty player seat; the same seed gives the same table', () => {
    registerOpponentRuns(HEROES.slice(0, 10).map((h, i) => run(`P${i}`, h, 100 + i)));
    const t = createLobbyTable(77, {}, 'set1');
    resetLobbyDrivers(t.seats);
    expect(t.opponentsFirst).toBe(true);
    expect(t.seats[0]!.kind).toBe('player');
    expect(t.seats[0]!.heroId).toBe('');
    expect(t.seats).toHaveLength(8);
    expect(lobbyTableHeroes(t).size).toBe(7);
    const again = createLobbyTable(77, {}, 'set1');
    resetLobbyDrivers(again.seats);
    expect(again.seats.map((s) => s.runKey ?? s.heroId)).toEqual(t.seats.map((s) => s.runKey ?? s.heroId));
  });

  it('a seat may wear any hero, the one the player will pick included: nothing is reserved before the offer', () => {
    // Seven runs, all on different heroes. The old order (player first) could never seat the player's hero; the new
    // order seats all seven runs whatever the player then picks.
    registerOpponentRuns(HEROES.slice(0, 7).map((h, i) => run(`R${i}`, h, 200 + i)));
    const t = createLobbyTable(5, {}, 'set1');
    resetLobbyDrivers(t.seats);
    expect(t.seats.filter((s) => s.kind === 'snapshot')).toHaveLength(7);
    const old = createRunLobby(5, HEROES[0]!, {}, 'set1');
    resetLobbyDrivers(old.seats);
    expect(old.seats.filter((s) => s.kind === 'snapshot')).toHaveLength(6);
  });

  it('the offer never holds a seated hero, and the picked hero sits at exactly that table', () => {
    registerOpponentRuns(HEROES.slice(0, 12).map((h, i) => run(`Q${i}`, h, 300 + i)));
    for (const seed of [1, 2, 3, 99, 4242]) {
      const t = createLobbyTable(seed, {}, 'set1');
      resetLobbyDrivers(t.seats);
      const held = lobbyTableHeroes(t);
      const { offer, toppedUp } = rankedHeroOffer(runTribesForSeed(seed, 'set1'), held, makeRng(seed).next);
      expect(toppedUp).toBe(false);
      expect(offer).toHaveLength(3);
      for (const h of offer) expect(held.has(h), h).toBe(false);
      const r = createLobbyRun(seed, offer[1]!, {}, 'lobby', undefined, 'set1', { table: t });
      resetLobbyDrivers(r.lobby!.seats);
      expect(r.lobby!.opponentsFirst).toBe(true);
      expect(r.lobby!.seats.map((s) => s.runKey ?? s.heroId).slice(1)).toEqual(t.seats.map((s) => s.runKey ?? s.heroId).slice(1));
      expect(r.lobby!.seats[0]!.heroId).toBe(offer[1]);
      expect(new Set(r.lobby!.seats.map((s) => s.heroId)).size).toBe(8);
      // The table handed in is untouched (it is the entry's record).
      expect(t.seats[0]!.heroId).toBe('');
    }
  });

  it('FALLBACK: a pick an opponent wears (only via a topped-up offer) re-picks the table the old way, so heroes stay unique', () => {
    registerOpponentRuns(HEROES.slice(0, 7).map((h, i) => run(`F${i}`, h, 400 + i)));
    const t = createLobbyTable(8, {}, 'set1');
    resetLobbyDrivers(t.seats);
    const held = [...lobbyTableHeroes(t)][0]!;
    expect(seatPlayerAtTable(t, held, 8, 'set1')).toBeNull();
    const r = createLobbyRun(8, held, {}, 'lobby', undefined, 'set1', { table: t });
    resetLobbyDrivers(r.lobby!.seats);
    expect(r.lobby!.opponentsFirst).toBeUndefined();
    expect(new Set(r.lobby!.seats.map((s) => s.heroId)).size).toBe(8);
    // Another seed's or set's table is never used.
    expect(seatPlayerAtTable(t, HEROES[30] ?? 'x', 9, 'set1')).toBeNull();
    expect(seatPlayerAtTable(t, HEROES[30] ?? 'x', 8, 'set2')).toBeNull();
  });

  it('the offer tops up with held heroes only when fewer than three are free, and says so', () => {
    const all = new Set(HEROES);
    const keep = HEROES.slice(0, 2);
    const held = new Set([...all].filter((h) => !keep.includes(h)));
    const { offer, toppedUp } = rankedHeroOffer(undefined, held, makeRng(1).next);
    expect(toppedUp).toBe(true);
    expect(offer).toHaveLength(3);
    expect(offer.filter((h) => keep.includes(h)).sort()).toEqual([...keep].sort());
    expect(freeRankedHeroes(undefined, held).sort()).toEqual([...keep].sort());
  });

  it('a lobby without a table (casual, Practice, an older entry) is seated exactly as before', () => {
    registerOpponentRuns(HEROES.slice(0, 9).map((h, i) => run(`C${i}`, h, 500 + i)));
    const a = createLobbyRun(31, HEROES[3]!, {}, 'lobby', undefined, 'set1');
    const b = createRunLobby(31, HEROES[3]!, {}, 'set1');
    resetLobbyDrivers(a.lobby!.seats); resetLobbyDrivers(b.seats);
    expect(a.lobby!.opponentsFirst).toBeUndefined();
    expect(a.lobby!.seats.map((s) => s.runKey ?? s.heroId)).toEqual(b.seats.map((s) => s.runKey ?? s.heroId));
  });
});
