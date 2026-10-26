import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type CombatResult, type MinionBuff } from '../index';

/**
 * A RISEN COPY HAS NO RUBIES PLAYED ON IT (owner report 2026-10-26, R-RISE-07).
 *
 * Owner: "the gem carver had rise and when the risen copy died it summoned full-ruby buffed golems. the golems
 * summoned should have been 1/1's since the risen copy had 0 rubies played on it."
 *
 * A combat Rise is a fresh combat-only copy (R-RISE-06): the risen body's Ruby ledger (the carried shop 'Ruby'
 * entry AND this fight's `rubyGain`) restarts at zero, while the run board card keeps its Rubies. Gem Crypt is the
 * one sanctioned exception ("Friendly minions that Rise keep their Rubies", R-SET3RUNE-31).
 */

const fight = (player: BoardMinion[], enemy: BoardMinion[], seed: number, cards = CARD_INDEX, mods: Record<string, unknown> = {}): CombatResult =>
  simulate(player, enemy, makeRng(seed), cards, combatSide({ tier: 6, questMods: mods }), combatSide({ tier: 6, questMods: mods }));
const golemsOf = (events: CombatEvent[], side: 'player' | 'enemy'): Array<[number, number]> =>
  events.flatMap((e) => (e.type === 'summon' && e.side === side && e.minion.cardId === 'gemheart-shard' ? [[e.minion.attack, e.minion.health] as [number, number]] : []));

/** Gem Carver (printed 5/3) holding 4 shop Rubies (+4/+4) and a granted Rise. */
const rubyBuffs = (): MinionBuff[] => [{ source: 'Ruby', attack: 4, health: 4, count: 4 }];
const carver = (buffs: MinionBuff[], sourceUid = 'GC'): BoardMinion =>
  ({ cardId: 'k_gemheart', attack: 9, health: 7, keywords: ['R'], sourceUid, buffs });
const wall = (): BoardMinion => ({ cardId: 'sandbag', attack: 50, health: 90000, keywords: [] });

describe('Gem Carver with Rubies + Rise (the owner report)', () => {
  it('the original summons 5/5 Golems; the risen copy summons 1/1 Golems', () => {
    const buffs = rubyBuffs();
    const r = fight([carver(buffs)], [wall()], 1);
    expect(r.events.some((e) => e.type === 'reborn' && !e.rebirth)).toBe(true);
    // 2 from the original (1/1 + its 4 Rubies), then 2 from the risen fresh copy (1/1, 0 Rubies).
    expect(golemsOf(r.events, 'player')).toEqual([[5, 5], [5, 5], [1, 1], [1, 1]]);
    // The run board card is untouched: its Ruby ledger (shared by reference into combat) is not mutated.
    expect(buffs).toEqual(rubyBuffs());
  });

  it('the same on the enemy seat (combat sides stay symmetric)', () => {
    const r = fight([wall()], [carver(rubyBuffs())], 1);
    expect(golemsOf(r.events, 'enemy')).toEqual([[5, 5], [5, 5], [1, 1], [1, 1]]);
  });

  it('Rubies played on the original MID-FIGHT do not ride the Rise either', () => {
    // A Start-of-Combat gifter plays 3 Rubies on the Carver in combat (its `rubyGain`), no shop Rubies.
    const gifter: CardDef = { id: 'rfgift', name: 'GIFT', tribe: 'kobold', tier: 5, attack: 0, health: 90000, keywords: ['SC'],
      effects: [{ on: 'startOfCombat', do: 'scPlayRubies', params: { count: 3 } }], text: '' };
    const cards = { ...CARD_INDEX, rfgift: gifter };
    const r = fight([{ cardId: 'rfgift', attack: 0, health: 90000, keywords: ['SC'] }, carver([])], [wall()], 1, cards);
    const g = golemsOf(r.events, 'player');
    expect(g.length).toBe(4);
    expect(g[0]![0]).toBeGreaterThan(1); // the original carried its combat Rubies
    expect(g.slice(2)).toEqual([[1, 1], [1, 1]]); // the risen copy did not
  });

  it('Gem Crypt is the exception: the risen copy keeps its Rubies, so its Golems carry them', () => {
    const r = fight([carver(rubyBuffs())], [wall()], 1, CARD_INDEX, { runeGemCrypt: true });
    expect(golemsOf(r.events, 'player')).toEqual([[5, 5], [5, 5], [5, 5], [5, 5]]);
  });
});

describe('Ashen Heir + Rise: the bank of Imp stats does not ride the Rise', () => {
  // A 0-Attack Heir with Rise (it never swings, so only the wall's attacks kill it). Every swinging player body dies
  // on its swing into the wall. The Imp dies with no living Imp -> the Heir banks it; the Heir dies and Rises (a fresh
  // copy, empty bank); a later body's Echo summons an Imp while the risen Heir is alive.
  const heir: CardDef = { ...CARD_INDEX['ashen_heir']!, id: 'rfheir', token: true, attack: 0, health: 1, keywords: [] };
  const popper: CardDef = { id: 'rfpop', name: 'POP', tribe: 'demon', tier: 1, attack: 1, health: 1, keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 1, fixed: true } }], text: '' };
  const cards = { ...CARD_INDEX, rfheir: heir, rfpop: popper };

  it('a risen Heir never pays the bank of the original to the next Imp', () => {
    let checked = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const r = fight([
        { cardId: 'impscrap', attack: 7, health: 1, keywords: [] }, // banked by the ORIGINAL Heir: 7/1
        { cardId: 'rfheir', attack: 0, health: 1, keywords: ['R'], sourceUid: 'H' },
        { cardId: 'rfpop', attack: 1, health: 1, keywords: [] },
        { cardId: 'rfpop', attack: 1, health: 1, keywords: [] },
        { cardId: 'rfpop', attack: 1, health: 1, keywords: [] },
      ], [wall()], seed, cards);
      const heirUid = r.initial.player[1]!.uid;
      const rise = r.events.findIndex((e) => e.type === 'reborn' && e.target === heirUid && !e.rebirth);
      if (rise < 0) continue;
      // Only seeds where the 7/1 is still sitting in the bank at the Rise: no Imp arrived before it to take it.
      const isImpSummon = (e: CombatEvent) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'impscrap';
      if (r.events.slice(0, rise).some(isImpSummon)) continue;
      const after = r.events.slice(rise);
      const end = after.findIndex((e) => e.type === 'death' && e.target === heirUid);
      const window = end < 0 ? after : after.slice(0, end);
      if (!window.some(isImpSummon)) continue;
      checked++;
      // Post-Rise Imps are 1/1s from 3 poppers, so a payout of 7+ Attack can only be the original's banked 7/1.
      expect(window.filter((e) => e.type === 'buff' && e.source === heirUid && (e as { key?: string }).key === 'factory:impInheritOnSummon:onSummon' && e.attack >= 7), `seed ${seed}`).toEqual([]);
    }
    expect(checked, 'some seeds summon an Imp while the risen Heir lives').toBeGreaterThan(0);
  });
});
