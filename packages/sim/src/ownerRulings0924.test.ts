/**
 * OWNER RULINGS 2026-09-24 — Karwind's stats, the Grave Orbit / Full Hand archive, and the Spare Forge /
 * Runic Passage rune grant scoped to the run's own set. (Gilded Wolvie + Humphry live beside their cards in
 * beastDragonBatch0924.test.ts / beastBatchAug12.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, QUEST_INDEX, RUNES, RUNE_INDEX, type SetId } from '@game/content';
import { createRun, type RunState } from './state';
import { reduce, runeforgePool } from './reducer';

describe('Karwind: 2/8 (owner ruling 2026-09-24, stats only)', () => {
  it('is a T4 2/8 Ward Dragon with the same +2/+2 Shout payoff and text', () => {
    const k = CARD_INDEX['karwind']!;
    expect([k.tribe, k.tier, k.attack, k.health, k.keywords]).toEqual(['dragon', 4, 2, 8, ['DS']]);
    expect(k.effects).toEqual([{ on: 'battlecryTriggered', do: 'onBattlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 2 } }]);
    expect(k.text).toBe('**Ward.** Whenever a **Shout** triggers, give your Dragons **+2/+2**.');
  });
});

describe('Rune of the Grave Orbit + Rune of the Full Hand are ARCHIVED (owner 2026-09-24: "remove them")', () => {
  const IDS = ['rune_grave_orbit', 'rune_full_hand'];

  it('are out of both forge stocks, recorded in ARCHIVED_RUNES, and still resolve by id for saved runs', () => {
    const live = new Set([...RUNES, ...EPIC_RUNES].map((r) => r.id));
    for (const id of IDS) {
      expect(live.has(id), `${id} must not stock the forge`).toBe(false);
      expect(ARCHIVED_RUNES.some((r) => r.id === id), `${id} recorded as archived`).toBe(true);
      expect(RUNE_INDEX[id], `${id} still resolves`).toBeDefined();
    }
  });

  it('no Runeforge in any set can offer them, whatever tribes rolled', () => {
    for (const setId of ['set1', 'set2', 'set3'] as SetId[]) {
      for (const epic of [false, true]) {
        const s = { ...createRun(7, 'warden', 'ascent', undefined, setId), tribes: ['undead', 'celestial', 'spirit'], ownedRunes: [], runeforgeEpic: epic || undefined } as RunState;
        const pool = runeforgePool(s);
        for (const id of IDS) expect(pool.includes(id), `${setId} ${epic ? 'epic' : 'basic'} forge offered ${id}`).toBe(false);
      }
    }
  });
});

/** Complete a hero quest in place (the quest system is archived, so it is seeded — see heroQuests.test.ts). */
function completeVia(s: RunState, questId: string): RunState {
  const def = QUEST_INDEX[questId]!;
  const primed: RunState = {
    ...s,
    activeQuests: [{ questId, progress: def.objective.count - 1, completed: false }],
    embers: 20,
    board: [],
    hand: [{ uid: 'h1', cardId: 'b2_packstrider', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
  };
  return reduce(primed, { type: 'play', uid: 'h1', toIndex: 0 });
}

describe('Spare Forge / Runic Passage grant a rune from the run\'s OWN set (owner 2026-09-24: "limit to the runs own set only")', () => {
  const cases = [
    { hero: 'fi', quest: 'hq_spare_forge', epic: false },
    { hero: 'coran', quest: 'hq_runic_passage', epic: true },
  ];

  for (const { hero, quest, epic } of cases) {
    it(`${quest}: across seeds and every set, the granted rune is offered in the run's pinned set`, () => {
      const archived = new Set(ARCHIVED_RUNES.map((r) => r.id));
      for (const setId of ['set1', 'set2', 'set3'] as SetId[]) {
        for (let seed = 1; seed <= 40; seed++) {
          const s = completeVia(createRun(seed, hero, 'ascent', undefined, setId), quest);
          expect(s.ownedRunes?.length, `${setId} seed ${seed}`).toBe(1);
          const rune = RUNE_INDEX[s.ownedRunes![0]!]!;
          expect(!rune.sets || rune.sets.includes(setId), `${setId} seed ${seed}: ${rune.id} (${rune.sets?.join(',')}) is out of set`).toBe(true);
          expect(!!rune.epic, `${rune.id} rarity`).toBe(epic);
          expect(archived.has(rune.id), `${rune.id} is archived`).toBe(false);
        }
      }
    });
  }

  it('reads the PINNED set: the same seed on different sets can differ, and each stays in its own set', () => {
    // A Set 3 run never draws a set-2-only rune (Rubies, Ales), and a Set 2 run never draws a set-3-only one.
    for (let seed = 1; seed <= 40; seed++) {
      const s3 = RUNE_INDEX[completeVia(createRun(seed, 'fi', 'ascent', undefined, 'set3'), 'hq_spare_forge').ownedRunes![0]!]!;
      const s2 = RUNE_INDEX[completeVia(createRun(seed, 'fi', 'ascent', undefined, 'set2'), 'hq_spare_forge').ownedRunes![0]!]!;
      expect(!s3.sets || s3.sets.includes('set3'), `seed ${seed} set3 drew ${s3.id}`).toBe(true);
      expect(!s2.sets || s2.sets.includes('set2'), `seed ${seed} set2 drew ${s2.id}`).toBe(true);
    }
  });

  it('is deterministic: the same seed and set grant the same rune', () => {
    const a = completeVia(createRun(11, 'coran', 'ascent', undefined, 'set3'), 'hq_runic_passage');
    const b = completeVia(createRun(11, 'coran', 'ascent', undefined, 'set3'), 'hq_runic_passage');
    expect(a.ownedRunes).toEqual(b.ownedRunes);
  });
});
