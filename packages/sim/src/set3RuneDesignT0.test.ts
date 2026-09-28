/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 0 (owner 2026-09-27). Content-only: 10 cuts (Golden Splinter and Deep Feast KEPT),
 * 5 restores, 5 re-tags, the approved reprices, the Grand Procession rename and the War Drum wording. The exact Set 3
 * ids are pinned in set3RuneList.test.ts; this file pins what the tranche changed and proves the restored menagerie
 * runes actually work with Set 3's tribes (their bodies read the run's tribes, never a Set 1 / Set 2 list).
 */
import { describe, expect, it } from 'vitest';
import { BODY_COUNTING_DEATHS, type Tribe } from '@game/core';
import { CARD_INDEX, RUNE_INDEX, SETS } from '@game/content';
import { runeforgePool } from './reducer';
import { applyEndOfTurn } from './recruit';
import { createRun, reduce, type BoardSnapshot, type RunState } from './index';

const card = (id: string, uid: string): RunState['board'][number] => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as RunState['board'][number];
};
/** A plain buyable Set 3 body of exactly one tribe. */
const byTribe = (t: Tribe): string => Object.values(CARD_INDEX).find((c) => c.tribe === t && !c.tribe2 && !c.token && !c.spell && !c.universalTribe && c.id.includes('3'))!.id;
const set3Run = (seed = 11): RunState => ({ ...createRun(seed, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 0, hand: [] }) as RunState;
const forge = (setId: 'set2' | 'set3', tribes: Tribe[], epic: boolean): string[] =>
  runeforgePool({ ...createRun(7, 'warden', 'ascent', undefined, setId), tribes, ownedRunes: [], runeforgeEpic: epic || undefined } as RunState);

describe('tranche 0: reprices, rename, wording (owner 2026-09-27)', () => {
  it('the seven approved reprices hold', () => {
    const cost = (id: string) => RUNE_INDEX[id]!.cost;
    expect([cost('rune_spearline'), cost('rune_bartering'), cost('rune_spirit_crown'), cost('rune_eventide'), cost('rune_first_round'), cost('rune_long_shift')])
      .toEqual([6, 4, 4, 3, 5, 3]);
    expect(BODY_COUNTING_DEATHS).toBe(6);
    expect(RUNE_INDEX['rune_body_counting']!.text).toBe('When **6** friendly minions die, get a random **Undead** minion.');
  });
  it('the Grand Procession rune is renamed (id kept) and the War Drum says which Shout', () => {
    expect(RUNE_INDEX['rune_grand_procession']!.name).toBe('Rune of the Second Showing');
    expect(RUNE_INDEX['rune_war_drum']!.text).toBe('The first **Shout** you trigger each turn triggers **2** more times.');
  });
});

describe('tranche 0: cuts and restores', () => {
  const CUT = ['rune_rubywire', 'rune_living_magic', 'rune_recurrence', 'rune_astral_draft', 'rune_refrain', 'rune_hunting_bell', 'rune_sylus', 'rune_pair', 'rune_quick_release', 'rune_grave_refreshment'];
  it('the 10 cuts leave Set 3 only and are never archived; the Golden Splinter and the Deep Feast stay', () => {
    for (const id of CUT) {
      const r = RUNE_INDEX[id]!;
      expect(r.sets, `${id} scoped`).toBeDefined();
      expect(r.sets!.includes('set3'), `${id} left Set 3`).toBe(false);
    }
    for (const id of ['rune_golden_splinter', 'rune_deep_feast']) {
      const r = RUNE_INDEX[id]!;
      expect(!r.sets || r.sets.includes('set3'), `${id} stays in Set 3`).toBe(true);
    }
  });
  it('the 5 restores are offered in Set 3 again', () => {
    for (const id of ['rune_open_constellation', 'rune_festival_circuit', 'rune_five_banners', 'rune_strange_caravan', 'rune_wishbone']) {
      expect(RUNE_INDEX[id]!.sets, id).toContain('set3');
    }
    expect([...RUNE_INDEX['rune_festival_circuit']!.tribes!].sort()).toEqual(['celestial', 'spirit']);
  });
  it('the Strange Caravan (Start of Turn) grants a minion of a Set 3 tribe the board does not hold', () => {
    let s: RunState = { ...set3Run(), board: [card(byTribe('kobold'), 'k1')] };
    s = reduce(s, { type: 'devGrant', kind: 'rune', id: 'rune_strange_caravan' });
    s = { ...s, discover: undefined, discoverQueue: undefined, hand: [] };
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 1, keywords: [] }], seed: 1, origin: 'self' };
    s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    const got = s.hand.map((c) => CARD_INDEX[c.cardId]!).filter((d) => !d.spell);
    expect(got).toHaveLength(1);
    const t = got[0]!.tribe;
    expect(SETS.set3.tribes).toContain(t);
    expect(t).not.toBe('kobold');
  });
  it('the Five Banners (End of Turn) gives one minion of each Set 3 type +5/+4', () => {
    let s: RunState = { ...set3Run(), board: [card(byTribe('spirit'), 's1'), card(byTribe('celestial'), 'c1'), card(byTribe('spirit'), 's2')] };
    s = reduce(s, { type: 'devGrant', kind: 'rune', id: 'rune_five_banners' });
    const before = s.board.map((m) => [m.attack, m.health]);
    applyEndOfTurn(s);
    const gain = s.board.map((m, i) => [m.attack - before[i]![0]!, m.health - before[i]![1]!]);
    expect(gain).toEqual([[5, 4], [5, 4], [0, 0]]);
  });
});

describe('tranche 0: the five re-tags gate on their tribe', () => {
  const RETAG: [string, Tribe, boolean][] = [
    ['rune_living_treasure', 'kobold', true], ['rune_rising_echoes', 'undead', true], ['rune_crowded_crypt', 'undead', false],
    ['rune_overflow', 'undead', true], ['rune_dreamed_graves', 'spirit', true],
  ];
  it('offered in Set 3 only when the tribe is rolled', () => {
    for (const [id, tribe, epic] of RETAG) {
      expect(RUNE_INDEX[id]!.tribes, id).toEqual([tribe]);
      const others = SETS.set3.tribes.filter((t) => t !== tribe) as Tribe[];
      expect(forge('set3', others, epic), `${id} without ${tribe}`).not.toContain(id);
      expect(forge('set3', [tribe], epic), `${id} with ${tribe}`).toContain(id);
    }
  });
  it('a tribe gate applies in every set: Set 2 (no Undead) no longer offers Overflow or Rising Echoes', () => {
    const s2 = forge('set2', [...SETS.set2.tribes] as Tribe[], true);
    expect(s2).not.toContain('rune_overflow');
    expect(s2).not.toContain('rune_rising_echoes');
    expect(s2).toContain('rune_living_treasure'); // Set 2 fields Kobolds
  });
});
