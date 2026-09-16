/**
 * A hermetic RECORDED-PLAYER corpus for pinned-lobby tests: nine set-2 runs on distinct authors + heroes, fourteen
 * waves each, vanilla bodies scaled with the wave (so a weak pilot LOSES and the elimination path is exercised)
 * and with the run's index (so recording-vs-recording fights resolve rather than draw forever). Registered into
 * the module-global opponent pool by the test that needs it (`registerOpponents(PINNED_FIXTURE_SHUFFLED)`) —
 * which is why the tests that use it live apart from the self-play tests.
 */
import type { BoardSnapshot } from '../../snapshot';

export const PINNED_FIXTURE_HEROES = ['warden', 'indy', 'myra', 'soren', 'rohan', 'nadja', 'cassen', 'drakko', 'robin'];
export const PINNED_FIXTURE_WAVES = 14;

const fixtureBoard = (author: string, heroId: string, seed: number, wave: number, patch: string, strength: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, armor: 0, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0,
  tribes: ['dragon', 'demon', 'beast', 'dwarf', 'kobold'], threat: 'glass', power: 0,
  minions: Array.from({ length: Math.min(7, wave) }, () => ({ cardId: 'n2_spellsword', attack: 3 + 2 * wave + 4 * strength, health: 4 + 2 * wave + 3 * strength, keywords: [], golden: false })),
  marksCarried: true, seed, origin: 'self', author, setId: 'set2', patch,
} as BoardSnapshot);

/** In run order (hero i, waves 1..14). */
export const PINNED_FIXTURE: BoardSnapshot[] = PINNED_FIXTURE_HEROES.flatMap((heroId, i) =>
  Array.from({ length: PINNED_FIXTURE_WAVES }, (_, w) => fixtureBoard(`author${i}`, heroId, 5000 + i, w + 1, i % 2 ? '0.1.0+aaaa' : '0.1.0+bbbb', i)));

/** Registration order shuffled, to prove the seat fill does not depend on it (`playerRunsFrom` sorts by key). */
export const PINNED_FIXTURE_SHUFFLED: BoardSnapshot[] = [...PINNED_FIXTURE].sort((a, b) => ((a.seed * 31 + a.wave * 7) % 97) - ((b.seed * 31 + b.wave * 7) % 97));
