import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult, type QuestCombatMods } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { destroyMinionInShop, makeContext } from './recruit';

/**
 * R-DEATH-RETURN-01 (owner ruling 2026-10-06): "yeah a minion that rises/rebirths should get benefits from beastial
 * swarm" - a death that leads to a Rise or Rebirth is a real death for every death listener.
 *
 * Before the fix the combat death watchers that live inline in `killOrReborn` (Rune of Beastial Swarm and its Avenge (2)
 * improvement, The Bone Throne, Assembly Line, Rune of Blood and Coin, Rune of Backbeat, Moonhowl, Ancestral Roar,
 * Ruby Shrapnel, Emberline, Candlelight Toll, Gem Golem, Parting Cry) sat on the TRUE-death branch only, so a body that
 * died and then Rose or was Reborn never reached them. The death side of R-SUMMON-RETURN-01.
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const bm = (cardId: string, uid: string, attack = 2, health = 20, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const sim = (p: BoardMinion[], e: BoardMinion[], mods: QuestCombatMods = {}, seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods }), combatSide({ tier: 6 }));
/** An enemy that kills a 1-Health body on contact and never dies. */
const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 90000 }];
const uidAt = (r: CombatResult, i: number) => r.initial.player[i]!.uid;
const swarmBuffs = (r: CombatResult) =>
  r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of Beastial Swarm');
const swarmTriggers = (r: CombatResult) =>
  r.events.filter((e) => e.type === 'questTrigger' && e.flag === 'runeBeastialSwarm' && e.side === 'player');
/** Index of the FIRST death event of a player body (its Rise/Rebirth death when it has one). */
const firstDeath = (r: CombatResult, uid: string) => r.events.findIndex((e) => e.type === 'death' && e.target === uid);

describe('Rune of Beastial Swarm counts a Beast that Rises or is Reborn (R-DEATH-RETURN-01)', () => {
  for (const [label, kw] of [['Rise', 'R'], ['Rebirth', 'RB']] as const) {
    it(`a ${label} Beast's death buffs the other Beasts, once`, () => {
      // Slot 0: a 1-Health Beast that returns. Slot 1: a sturdy Beast that should feel the rune on the first death.
      const r = sim([bm('alley', 'A', 1, 1, { keywords: [kw] }), bm('alley', 'B', 0, 9000)], killer, { runeBeastialSwarm: true });
      const a = uidAt(r, 0);
      const b = uidAt(r, 1);
      const d = firstDeath(r, a);
      expect(d).toBeGreaterThanOrEqual(0);
      const deathEv = r.events[d] as Extract<CombatEvent, { type: 'death' }>;
      expect(deathEv.rise, 'the first death is the returning one').toBe(true);
      // The returning body comes back
      const back = r.events.findIndex((e, i) => i > d && e.type === 'reborn' && e.target === a);
      expect(back).toBeGreaterThan(d);
      // …and between its death and its return, the rune pays the sturdy Beast exactly once.
      const paid = swarmBuffs(r).filter((e) => e.target === b && r.events.indexOf(e) > d && r.events.indexOf(e) < back);
      expect(paid.map((e) => [e.attack, e.health])).toEqual([[2, 2]]);
      const pulses = swarmTriggers(r).filter((e) => { const i = r.events.indexOf(e); return i > d && i < back; });
      expect(pulses.length, 'the rune badge pulses once for the returning death').toBe(1);
    });
  }

  it('a Rise Beast returns carrying the swarm granted by its own death (it is a summoned Beast)', () => {
    const r = sim([bm('alley', 'A', 1, 1, { keywords: ['R'] }), bm('alley', 'B', 0, 9000)], killer, { runeBeastialSwarm: true });
    const a = uidAt(r, 0);
    const back = r.events.find((e) => e.type === 'reborn' && e.target === a) as Extract<CombatEvent, { type: 'reborn' }>;
    const def = CARD_INDEX['alley']!;
    expect(back.attack).toBe(def.attack + 2);
    expect(back.hp).toBe(1 + 2);
  });

  it('a Rebirth Beast returns with its full body PLUS the swarm granted by its own death', () => {
    const r = sim([bm('alley', 'A', 1, 1, { keywords: ['RB'] }), bm('alley', 'B', 0, 9000)], killer, { runeBeastialSwarm: true });
    const a = uidAt(r, 0);
    const d = firstDeath(r, a);
    const back = r.events.findIndex((e, i) => i > d && e.type === 'reborn' && e.target === a);
    const after = swarmBuffs(r).filter((e) => e.target === a && r.events.indexOf(e) > back);
    expect(after.length, 'the returned body gains the +2/+2 it missed while dead').toBeGreaterThanOrEqual(1);
    expect([after[0]!.attack, after[0]!.health]).toEqual([2, 2]);
  });

  it('a plain (true) Beast death is unchanged: one pulse, the sturdy Beast +2/+2', () => {
    const r = sim([bm('alley', 'A', 1, 1, { keywords: [] }), bm('alley', 'B', 0, 9000)], killer, { runeBeastialSwarm: true });
    const a = uidAt(r, 0);
    const b = uidAt(r, 1);
    const d = firstDeath(r, a);
    expect((r.events[d] as Extract<CombatEvent, { type: 'death' }>).rise).toBeFalsy();
    const firstPay = swarmBuffs(r).find((e) => e.target === b)!;
    expect([firstPay.attack, firstPay.health]).toEqual([2, 2]);
    expect(r.events.indexOf(firstPay)).toBeGreaterThan(d);
  });

  it('the Avenge (2) improvement counts a Rise death (two Rise deaths improve the level once)', () => {
    const r = sim([bm('alley', 'A', 1, 1, { keywords: ['R'] }), bm('alley', 'C', 1, 1, { keywords: ['R'] }), bm('alley', 'B', 0, 9000)], killer, { runeBeastialSwarm: true });
    // The improvement fires on the 2nd friendly death; both first deaths here are Rise deaths. After the
    // improvement, the next swarm payout is +4/+4.
    const b = uidAt(r, 2);
    const amounts = swarmBuffs(r).filter((e) => e.target === b).map((e) => e.attack);
    expect(amounts.slice(0, 2)).toEqual([2, 2]);
    expect(amounts[2]).toBe(4);
  });
});

describe('the other Avenge-paced death watchers count a Rise / Rebirth death (R-DEATH-RETURN-01)', () => {
  for (const [label, kw] of [['Rise', 'R'], ['Rebirth', 'RB']] as const) {
    it(`Assembly Line pays on a ${label} death that lands on its Nth friendly death`, () => {
      const r = sim([bm('alley', 'A', 1, 1, { keywords: [kw] }), bm('alley', 'B', 0, 9000)], killer, { assemblyLineStep: 1 });
      const a = uidAt(r, 0);
      const d = firstDeath(r, a);
      const back = r.events.findIndex((e, i) => i > d && e.type === 'reborn' && e.target === a);
      const pay = r.events.findIndex((e, i) => i > d && i < back && e.type === 'questTrigger' && e.flag === 'assemblyLine');
      expect(pay, 'Assembly Line pays before the return').toBeGreaterThan(d);
    });

    it(`Rune of the Gem Golem summons its Golem from a Kobold's ${label} death, once`, () => {
      const r = sim([bm('k_chipwick', 'K', 1, 1, { keywords: [kw] }), bm('sandbag', 'S', 0, 9000)], killer, { runeGemGolem: true });
      const k = uidAt(r, 0);
      const d = firstDeath(r, k);
      const back = r.events.findIndex((e, i) => i > d && e.type === 'reborn' && e.target === k);
      expect(back).toBeGreaterThan(d);
      const golems = r.events.filter((e, i) => i > d && i < back && e.type === 'summon' && e.minion.cardId === 'gemheart-shard');
      expect(golems.length).toBe(1);
    });

    it(`Candlelight Toll grants a Ruby from a Kobold's ${label} death`, () => {
      const plain = sim([bm('k_chipwick', 'K', 1, 1, { keywords: [] }), bm('sandbag', 'S', 0, 9000)], killer, { candlelightToll: true });
      const ret = sim([bm('k_chipwick', 'K', 1, 1, { keywords: [kw] }), bm('sandbag', 'S', 0, 9000)], killer, { candlelightToll: true });
      // The returned Kobold dies again later, so a returning Kobold pays for BOTH its deaths.
      expect(plain.playerRubyGrants ?? 0).toBeGreaterThan(0);
      expect(ret.playerRubyGrants ?? 0).toBeGreaterThan(plain.playerRubyGrants ?? 0);
    });
  }
});

describe('the Shop half already counts a returning Beast; a Rebirth return keeps its own death\'s swarm', () => {
  const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra } as BoardCard;
  };
  const shopRun = (board: BoardCard[]): RunState =>
    ({ ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, board, hand: [], questFlags: { runeBeastialSwarm: true } } as RunState);

  it('a Rise Beast destroyed in the Shop pays the other Beast', () => {
    const s = shopRun([bc('a', 'alley', { keywords: ['R'] }), bc('b', 'alley')]);
    const before = s.board[1]!.attack;
    destroyMinionInShop(makeContext(s), s.board[0]!);
    expect(s.board.find((c) => c.uid === 'b')!.attack).toBe(before + 2);
  });

  it('a Rebirth Beast destroyed in the Shop returns with the +2/+2 its own death paid', () => {
    const s = shopRun([bc('a', 'alley', { keywords: ['RB'], attack: 5, health: 5 }), bc('b', 'alley')]);
    destroyMinionInShop(makeContext(s), s.board[0]!);
    const back = s.board.find((c) => c.uid !== 'b' && c.cardId === 'alley')!;
    expect(back, 'the Rebirth body is back').toBeTruthy();
    expect([back.attack, back.health]).toEqual([5 + 2, 5 + 2]);
  });
});
