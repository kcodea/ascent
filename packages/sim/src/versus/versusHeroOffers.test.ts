/**
 * UNIQUE HEROES PER LOBBY in Versus (owner 2026-10-31, R-VERSUS-UNIQUE-HEROES-01): the room's deal of every seat's three
 * heroes. No hero is ever offered twice, each seat's three are heroes its own run may play, the deal is a pure function
 * of the seeds, and a seat alone is dealt exactly the three `versusHeroOffer` always gave (so the client's fallback and
 * every older match read the same heroes).
 */
import { describe, expect, it } from 'vitest';
import { playableHeroes } from '../heroes';
import { runTribesForSeed } from '../state';
import { uniqueAutoHeroIndex, versusDisjointHeroOffers, versusHeroShuffle, versusRerollCandidatesFree } from './heroOffers';
import { versusHeroOffer } from './run';

const seatsFor = (base: number, n: number) => Array.from({ length: n }, (_, i) => ({ heroSeed: (base * 2654435761 + i * 40503) >>> 1, runSeed: (base * 97 + i * 1013) >>> 0 }));

describe('versusDisjointHeroOffers', () => {
  for (const setId of ['set1', 'set2'] as const) {
    for (const n of [2, 3, 4]) {
      it(`${setId}, ${n} seats: never a hero twice, three each, all playable by the seat's run, over 1000 seeds`, () => {
        for (let base = 1; base <= 1000; base++) {
          const seats = seatsFor(base, n);
          const offers = versusDisjointHeroOffers(seats, setId);
          const all = offers.flat();
          expect(new Set(all).size).toBe(all.length);
          offers.forEach((o, i) => {
            expect(o).toHaveLength(3);
            const allowed = new Set(playableHeroes(runTribesForSeed(seats[i]!.runSeed, setId)).map((h) => h.id));
            for (const h of o) expect(allowed.has(h)).toBe(true);
          });
          expect(versusDisjointHeroOffers(seats, setId)).toEqual(offers); // deterministic
        }
      });
    }
  }

  it('a seat alone is dealt exactly versusHeroOffer (the deal of before)', () => {
    for (let base = 1; base <= 500; base++) {
      const [s] = seatsFor(base, 1);
      expect(versusDisjointHeroOffers([s!], 'set2')).toEqual([versusHeroOffer(s!.heroSeed, s!.runSeed, 'set2')]);
      expect(versusHeroShuffle(s!.heroSeed, s!.runSeed, 'set2').slice(0, 3)).toEqual(versusHeroOffer(s!.heroSeed, s!.runSeed, 'set2'));
    }
  });

  it('pins versusHeroOffer: old matches and saved runs read the same three heroes', () => {
    expect(versusHeroOffer(123456, 987654, 'set2')).toEqual(['warden', 'cassen', 'risen']);
    expect(versusHeroOffer(2147483000, 77, 'set2')).toEqual(['kindness', 'runeguard', 'myra']);
  });

  it('the first-dealt seat rotates slot by slot, so no seat always takes first', () => {
    // Two seats with the SAME shuffle: whoever deals first in a slot takes that shuffle's next hero.
    const same = { heroSeed: 42, runSeed: 7 };
    const list = versusHeroShuffle(42, 7, 'set2');
    const [a, b] = versusDisjointHeroOffers([same, same], 'set2');
    expect(a).toEqual([list[0], list[3], list[4]]);
    expect(b).toEqual([list[1], list[2], list[5]]);
  });
});

describe('the pick guards', () => {
  it('a re-roll keeps only candidates nobody else was dealt', () => {
    expect(versusRerollCandidatesFree(['a', 'b', 'c', 'd'], ['b', 'd'])).toEqual(['a', 'c']);
    expect(versusRerollCandidatesFree(['a'], [])).toEqual(['a']);
  });
  it('an automatic pick keeps its seeded index unless that hero is held, then takes the first free one', () => {
    expect(uniqueAutoHeroIndex(['a', 'b', 'c'], 1, new Set())).toBe(1);
    expect(uniqueAutoHeroIndex(['a', 'b', 'c'], 1, new Set(['b']))).toBe(0);
    expect(uniqueAutoHeroIndex(['a', 'b', 'c'], 0, new Set(['a', 'b']))).toBe(2);
    expect(uniqueAutoHeroIndex(['a', 'b', 'c'], 2, new Set(['a', 'b', 'c']))).toBe(2); // nothing free: unchanged
  });
});

describe('OPPONENTS FIRST (owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01): Ranked Duos deals the party around its seated table', () => {
  it('no dealt hero is one the table holds, the two offers stay disjoint, and nothing excluded is the deal of before', () => {
    for (let base = 1; base <= 1000; base++) {
      const seats = seatsFor(base, 2);
      const plain = versusDisjointHeroOffers(seats, 'set2');
      expect(versusDisjointHeroOffers(seats, 'set2', new Set())).toEqual(plain);
      const ids = playableHeroes().map((h) => h.id);
      const table = new Set(Array.from({ length: 6 }, (_, k) => ids[(base * 7 + k * 5) % ids.length]!));
      const offers = versusDisjointHeroOffers(seats, 'set2', table);
      const all = offers.flat();
      expect(all).toHaveLength(6);
      expect(new Set(all).size).toBe(6);
      for (const h of all) expect(table.has(h), h).toBe(false);
      offers.forEach((o, i) => {
        const allowed = new Set(playableHeroes(runTribesForSeed(seats[i]!.runSeed, 'set2')).map((h) => h.id));
        for (const h of o) expect(allowed.has(h)).toBe(true);
      });
    }
  });

  it('a list with too few free heroes falls back to held ones rather than dealing fewer than three', () => {
    const [s] = seatsFor(3, 1);
    const shuffle = versusHeroShuffle(s!.heroSeed, s!.runSeed, 'set2');
    const exclude = new Set(shuffle.slice(2));
    const [offer] = versusDisjointHeroOffers([s!], 'set2', exclude);
    expect(offer).toHaveLength(3);
    expect(offer!.slice(0, 2)).toEqual(shuffle.slice(0, 2));
  });
});
