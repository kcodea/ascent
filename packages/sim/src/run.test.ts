import { describe, it, expect } from 'vitest';
import { makeRng, type CombatResult } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX } from '@game/content';
import {
  CONFIG,
  POOL_QUANTITIES,
  createRun,
  reduce,
  serialize,
  deserialize,
  selectThreat,
  buildEnemyBoard,
  pickOpponent,
  isServableBoard,
  registerOpponents,
  buildBootstrapPool,
  lossDamageCap,
  OPPONENT_POOL,
  type BoardSnapshot,
  boardManaBonus,
  THREAT_IDS,
  addBuff,
  undeadBuyBonus,
  getHero,
  spellStatBonus,
  spellAttackBonus,
  spellHealthBonus,
  spellDisplayText,
  rateBoardForWave,
  buildWaveLadders,
  ratingBand,
  BAND_COUNT,
  type BoardCard,
  type RunState,
} from './index';
import type { BoardMinion } from '@game/core';
import { applyEndOfTurn } from './recruit';

/** Play greedily until the run ends (game over OR victory at maxWave): buy, play, else face omen. */
function playToEnd(seed: number): RunState {
  let s = createRun(seed);
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 10000) {
    if (s.phase === 'combat') {
      s = reduce(s, { type: 'resolveCombat' });
    } else if (s.hand.length > 0 && s.board.length < 7) {
      s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    } else if (s.embers >= 3 && s.board.length + s.hand.length < 7) {
      s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    } else {
      s = reduce(s, { type: 'faceOmen' });
    }
  }
  return s;
}

describe('run loop (@game/sim)', () => {
  it('createRun is deterministic', () => {
    expect(serialize(createRun(42))).toEqual(serialize(createRun(42)));
  });

  it('opens with the handoff economy defaults', () => {
    const s = createRun(1);
    expect(s.embers).toBe(3);
    expect(s.resolve).toBe(30);
    expect(s.tier).toBe(1);
    expect(s.upgradeCost).toBe(5);
    expect(s.shop.length).toBe(3); // tier 1 → 3 slots
    expect(s.hand.length).toBe(0);
    expect(s.board.length).toBe(0);
  });

  it('buy moves a card to the hand for 3 embers (without mutating input)', () => {
    const s0 = createRun(1);
    const s1 = reduce(s0, { type: 'buy', uid: s0.shop[0]!.uid });
    expect(s1.embers).toBe(0);
    expect(s1.hand.length).toBe(1);
    expect(s1.board.length).toBe(0);
    expect(s1.shop.length).toBe(2);
    expect(s0.hand.length).toBe(0); // pure: original untouched
  });

  it('play moves a card from the hand onto the board', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.hand.length).toBe(0);
    expect(s.board.length).toBe(1);
  });

  it('reposition moves a board minion to a new index', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({
      uid, cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false,
    });
    let s: RunState = { ...createRun(1), board: [mk('a', 'sandbag'), mk('b', 'alley'), mk('c', 'frontdrake')] };
    s = reduce(s, { type: 'reposition', uid: 'c', toIndex: 0 });
    expect(s.board.map((m) => m.uid)).toEqual(['c', 'a', 'b']);
  });

  it('rejects a buy without enough embers', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid }); // embers → 0
    const next = reduce(s, { type: 'buy', uid: s.shop[0]?.uid ?? 'x' });
    expect(next).toBe(s); // no-op returns the same reference
  });

  it('sell returns 1 ember', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'sell', uid: s.board[0]!.uid });
    expect(s.board.length).toBe(0);
    expect(s.embers).toBe(1);
  });

  it('roll costs 1 ember and keeps 3 offers at tier 1', () => {
    const s = reduce(createRun(1), { type: 'roll' });
    expect(s.embers).toBe(2);
    expect(s.shop.length).toBe(3);
  });

  it('freeze preserves the shop into the next wave', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'freeze' });
    const frozen = s.shop.map((c) => c.cardId);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    if (s.phase === 'recruit') {
      expect(s.shop.map((c) => c.cardId)).toEqual(frozen);
      expect(s.frozen).toBe(false);
    }
  });

  it('faceOmen enters combat; resolveCombat advances or ends the run', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'faceOmen' });
    expect(s.phase).toBe('combat');
    expect(s.lastCombat).toBeDefined();
    // Recruit actions are inert mid-combat.
    expect(reduce(s, { type: 'roll' })).toBe(s);
    const wave = s.wave;
    s = reduce(s, { type: 'resolveCombat' });
    expect(['recruit', 'gameover']).toContain(s.phase);
    if (s.phase === 'recruit') expect(s.wave).toBe(wave + 1);
  });

  it('upgrade raises the tier and resets the cost to the next target', () => {
    let s = createRun(1);
    s = { ...s, embers: 20 };
    s = reduce(s, { type: 'upgrade' });
    expect(s.tier).toBe(2);
    expect(s.embers).toBe(15); // 20 - 5
    expect(s.upgradeCost).toBe(7); // cost to reach T3
  });

  it('enemy boards are deterministic per (threat, wave)', () => {
    const s = createRun(7);
    const a = buildEnemyBoard(s.threat, s.wave, makeRng(12345));
    const b = buildEnemyBoard(s.threat, s.wave, makeRng(12345));
    expect(a).toEqual(b);
  });

  it('threat selection avoids immediate repeats', () => {
    for (const prev of THREAT_IDS) {
      expect(selectThreat(2, makeRng(99), prev)).not.toBe(prev);
    }
  });

  // --- recruit effects: buy → hand (onBuy) → play → board (onSummon + Battlecry) ---

  it('Brightwing Broker buffs minions bought after it (+1/+1, in hand)', () => {
    const s0: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'br', cardId: 'broker', tribe: 'neutral', attack: 2, health: 3, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'sandbag' }],
    };
    const s1 = reduce(s0, { type: 'buy', uid: 'x' });
    const bought = s1.hand.find((c) => c.cardId === 'sandbag');
    expect(bought?.attack).toBe(1); // 0 + 1, applied on buy
    expect(bought?.health).toBe(7); // 6 + 1 (Target Dummy is 0/6)
  });

  it('Alleycur Battlecry summons a Stray only when played', () => {
    let s: RunState = { ...createRun(1), embers: 3, board: [], hand: [], shop: [{ uid: 'x', cardId: 'alley' }] };
    s = reduce(s, { type: 'buy', uid: 'x' });
    expect(s.hand.some((c) => c.cardId === 'alley')).toBe(true);
    expect(s.board.length).toBe(0); // Battlecry has not fired yet
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.some((c) => c.cardId === 'alley')).toBe(true);
    expect(s.board.some((c) => c.cardId === 'stray')).toBe(true);
  });

  it('Kennelmaster buffs Beasts played and the tokens they summon', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'k', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'alley' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.find((c) => c.cardId === 'alley')?.attack).toBe(2); // 1 + 1
    expect(s.board.find((c) => c.cardId === 'stray')?.attack).toBe(2); // 1 + 1
  });

  it("Kennelmaster's summon buff scales with its accrued Avenge bonus", () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      // a Kennelmaster that has already improved twice (Avenge fired twice in past fights)
      board: [{ uid: 'k', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 2 }],
      hand: [{ uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'a' }); // Alleycat + its Stray are Beasts summoned beside it
    const stray = s.board.find((c) => c.cardId === 'stray');
    expect([stray?.attack, stray?.health]).toEqual([4, 4]); // 1/1 + (1+2)/(1+2)
  });

  it("persists a Kennelmaster's Avenge improvement across combat (whole-run)", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'k', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 0 }],
      lastCombat: {
        events: [],
        result: 'win',
        playerDamage: 0,
        playerDeathrattles: 0,
        enemyDeaths: 0,
        initial: { player: [], enemy: [] },
        playerSummonBonus: [{ sourceUid: 'k', bonus: 2 }],
      },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 'k')?.summonBonus).toBe(2); // carried back from combat
  });

  it('spells cast in combat (Taragosa) permanently bump the run spellsCast at settle', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat', spellsCast: 5,
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerSpellsCast: 3 },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.spellsCast).toBe(8); // 5 (run) + 3 (cast in combat) — permanent, so Guel keeps improving
  });

  it('Tara ascends to Taragosa once granted stats 20 times in combat (at settle), keeping its stats', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat',
      board: [{ uid: 't', cardId: 'tara', tribe: 'dragon', attack: 9, health: 9, keywords: ['EG'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerAscendCount: [{ sourceUid: 't', count: 20 }] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const t = s.board.find((c) => c.uid === 't');
    expect(t?.cardId).toBe('taragosa'); // ascended…
    expect([t?.attack, t?.health]).toEqual([9, 9]); // …keeping its accumulated stats
  });

  it('Tara banks ascend progress across combats — under 20 it stays Tara', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat',
      board: [{ uid: 't', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerAscendCount: [{ sourceUid: 't', count: 12 }] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 't')?.cardId).toBe('tara'); // 12 < 20
    expect(s.board.find((c) => c.uid === 't')?.ascendProgress).toBe(12); // progress banked toward next time
  });

  it('tripling a Kennelmaster combines its accrued Avenge buffs', () => {
    // Two Kennelmasters at +6/+6 (summonBonus 5) and +4/+4 (summonBonus 3) + a fresh one →
    // the golden's buff is the combined +10/+10 (summonBonus 9 = base 1 + top-two 5 + 3).
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [
        { uid: 'k1', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 5 },
        { uid: 'k2', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 3 },
      ],
      shop: [{ uid: 'x', cardId: 'kennel' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' }); // the 3rd copy completes the triple
    const golden = s.hand.find((c) => c.cardId === 'kennel' && c.golden);
    expect(golden?.summonBonus).toBe(9); // base 1 + (5 + 3) → grants +10/+10
  });

  it('a golden Kennelmaster grants its full combined buff (no golden double-counting)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'k', cardId: 'kennel', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: true, summonBonus: 9 }],
      hand: [{ uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'a' });
    const stray = s.board.find((c) => c.cardId === 'stray');
    expect([stray?.attack, stray?.health]).toEqual([11, 11]); // 1/1 + (base 1 + summonBonus 9) = +10/+10
  });

  it('Choose One: playing prompts, then the picked option resolves as the Battlecry', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      hand: [{ uid: 'sh', cardId: 'shaper', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sh' });
    expect(s.chooseOne?.cardId).toBe('shaper'); // the Battlecry waits on the choice
    expect(s.board.find((c) => c.uid === 'b')?.attack).toBe(1); // not buffed yet
    s = reduce(s, { type: 'chooseOne', index: 0 }); // "give your Beasts +1/+1"
    expect(s.chooseOne).toBeUndefined();
    expect(s.board.find((c) => c.uid === 'b')?.attack).toBe(2); // Alleycat 1 → 2
    expect(s.board.find((c) => c.uid === 'sh')?.attack).toBe(3); // Shaper 2 → 3 (includes self)
  });

  it('Choose One: the other option summons tokens', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [],
      hand: [{ uid: 'sh', cardId: 'shaper', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sh' });
    s = reduce(s, { type: 'chooseOne', index: 1 }); // "summon two 1/1 Strays"
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(2);
  });

  it('Choose One is not a Battlecry — Drakko the Drummer does not double it', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [
        { uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sh', cardId: 'shaper', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sh' });
    s = reduce(s, { type: 'chooseOne', index: 0 }); // "give your Beasts +1/+1"
    // Drakko the Drummer doubles Battlecries — but Choose One is its own keyword, not a Battlecry,
    // so the buff lands once (+1/+1), not twice.
    expect(s.board.find((c) => c.uid === 'b')?.attack).toBe(2); // 1 → 2 (would be 3 if doubled)
    expect(s.board.find((c) => c.uid === 'sh')?.attack).toBe(3); // 2 → 3 (would be 4 if doubled)
  });

  it('Dragon Battlecries bake into stats when played', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'w', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: ['SC'], golden: false }],
      shop: [{ uid: 'x', cardId: 'cleric' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.find((c) => c.cardId === 'frontdrake')?.attack).toBe(4); // 2 + 2
    const cleric = s.board.find((c) => c.cardId === 'cleric');
    expect(cleric?.attack).toBe(5); // 3 + 2 (Battlecry includes self)
    expect(cleric?.health).toBe(7); // 4 + 3
  });

  it('Toxin Tender grants Venomous to the minion you target after playing it', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'g', cardId: 'spore', tribe: 'undead', attack: 1, health: 2, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'toxin' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'g' }); // pick the friendly Undead target after playing
    expect(s.board.find((c) => c.cardId === 'spore')?.keywords).toContain('V');
  });

  it("Ritualist's End of Turn buffs all Fodder — existing copies and the run-level card buff", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 5, keywords: [], golden: false },
        { uid: 'f1', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false },
      ],
      hand: [{ uid: 'f2', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false }],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires Ritualist before combat
    expect(s.cardBuffs.fred).toEqual({ attack: 2, health: 2 }); // +2/+2 persists for the run
    const f1 = s.board.find((c) => c.uid === 'f1');
    expect([f1?.attack, f1?.health]).toEqual([3, 3]); // Fodder on the board buffed now (1/1 + 2/2)
    const f2 = s.hand.find((c) => c.uid === 'f2');
    expect([f2?.attack, f2?.health]).toEqual([3, 3]); // Fodder in the hand too
  });

  it('Fodder found after a Ritualist proc carries the run buff — bought from the tavern', () => {
    let s: RunState = { ...createRun(1), embers: 3, shop: [{ uid: 'sf', cardId: 'fred' }], hand: [], board: [], cardBuffs: { fred: { attack: 2, health: 2 } } };
    s = reduce(s, { type: 'buy', uid: 'sf' });
    const bought = s.hand.find((c) => c.cardId === 'fred');
    expect([bought?.attack, bought?.health]).toEqual([3, 3]); // base 1/1 + the +2/+2 run buff
  });

  it('a Demon consuming buffed Fodder gains the buffed stats (×multiplier)', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'imp', cardId: 'imp', tribe: 'demon', attack: 2, health: 2, keywords: ['CN'], golden: false }],
      cardBuffs: { fred: { attack: 2, health: 2 } },
      pendingTavern: ['fred'],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' }); // advance → next tavern injects Fred → the Imp eats it
    const imp = s.board.find((c) => c.cardId === 'imp');
    // Voracious Imp eats a (1+2)/(1+2) Fred at ×2 → +6/+6 → 8/8
    expect([imp?.attack, imp?.health]).toEqual([8, 8]);
    // the consume record carries the Fodder's *buffed* stats (3/3) so the eat animation shows them
    expect(s.fodderEaten?.[0]).toMatchObject({ fodderId: 'fred', attack: 3, health: 3 });
  });

  it('a frozen tavern tops up empty slots + a missing spell after combat', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      frozen: true,
      shop: [{ uid: 'keep', cardId: 'alley' }], // one frozen offer; the rest were bought away
      spell: null, // …and the spell was bought
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.shop.length).toBe(3); // tier 1 → 3 slots, topped up from the 1 frozen offer
    expect(s.shop[0]!.uid).toBe('keep'); // the frozen offer is preserved, still first
    expect(s.spell).not.toBeNull(); // the missing spell is filled in
    expect(s.frozen).toBe(false); // freeze is consumed for the new turn
  });

  it('a frozen tavern still delivers Soulfeeder-queued Fodder (not stranded)', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      frozen: true,
      board: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
      pendingTavern: ['fred'], // queued by Soulfeeder's Battlecry last turn
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.cardId === 'feed')!.attack).toBe(3); // the demon ate the queued Fred (+1/+1)
    expect(s.pendingTavern).toEqual([]); // queue cleared — not stranded by the freeze
  });

  it('triples are checked at shop-start — a combat hand-grant that completes a triple combines without a buy/play', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [
        { uid: 'c1', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'c2', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
      hand: [],
      // The Deathrattle-granted 3rd copy lands in the hand at settle — completing a triple the player never
      // had a buy/play to trigger. The shop-start check must combine it as the new wave opens.
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerHandGrants: ['cleric'] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    const clerics = [...s.board, ...s.hand].filter((c) => c.cardId === 'cleric');
    expect(clerics.length).toBe(1); // all 3 combined
    expect(clerics[0]!.golden).toBe(true); // …into one golden
  });

  it("Bane's Fodder enchant from combat persists — settleCombat applies it run-wide", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerFodderBuffGain: { attack: 2, health: 2 } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.cardBuffs?.fred).toEqual({ attack: 2, health: 2 }); // run-wide enchant → future Fodder inherit it
    const fred = s.board.find((c) => c.uid === 'f')!;
    expect([fred.attack, fred.health]).toEqual([1 + 2, 1 + 2]); // the Fodder already on board got it too
  });

  it('tripling Tara keeps the HIGHEST ascend progress (lowest "to go"), not a reset', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 't1', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false, ascendProgress: 12 },
        { uid: 't2', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false, ascendProgress: 5 },
      ],
      hand: [{ uid: 't3', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false, ascendProgress: 8 }],
    };
    s = reduce(s, { type: 'play', uid: 't3' }); // 3rd Tara → triple
    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'tara' && c.golden);
    expect(golden).toBeDefined();
    expect(golden!.ascendProgress).toBe(12); // max of {12, 5, 8} — the copy closest to ascending
  });

  it('Tara carries its prior ascend progress into combat (so the live tracker shows the total, not just this fight)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 't', cardId: 'tara', tribe: 'dragon', attack: 9, health: 9, keywords: ['EG'], golden: false, ascendProgress: 10 }],
    };
    s = reduce(s, { type: 'faceOmen' });
    const tara = s.lastCombat?.initial.player.find((m) => m.cardId === 'tara');
    expect(tara?.ascendProgress).toBe(10); // seeded from the run board, not reset to 0 each combat
  });

  it('a combat card grant (Sporebat / Ryme→Sea Urchin) lands the actual carried card at settle, with run buffs', () => {
    let s: RunState = {
      ...createRun(1), tier: 3, undeadBuyAtk: 2,
      cardBuffs: { cleric: { attack: 1, health: 1 } },
      phase: 'combat', hand: [],
      // Combat already picked these specific cards (a toHand event animated them in); settle just adds them.
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerHandGrants: ['cleric', 'karthus'] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const cleric = s.hand.find((c) => c.cardId === 'cleric')!;
    const karthus = s.hand.find((c) => c.cardId === 'karthus')!;
    expect(cleric).toBeDefined();
    expect([cleric.attack, cleric.health]).toEqual([CARD_INDEX.cleric!.attack + 1, CARD_INDEX.cleric!.health + 1]); // run-wide cardBuff
    expect(karthus.attack).toBe(CARD_INDEX.karthus!.attack + 2); // Undead bond (undeadBuyAtk) baked in
  });

  it('Ryme-deferred economy Battlecries replay through their recruit factory at settle (Soulfeeder + Hoarder)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat', hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] },
        // 3 economy battlecries Ryme re-fired in combat: 2 Soulfeeders (one golden) + 1 Hoarder.
        playerDeferredBattlecries: [{ cardId: 'feed', golden: false }, { cardId: 'feed', golden: true }, { cardId: 'hoarder', golden: false }] },
    };
    const goldBefore = s.bonusEmbersNextTurn ?? 0;
    s = reduce(s, { type: 'settleCombat' }); // settle WITHOUT advancing, so the queued Fodder isn't injected/cleared yet
    // Soulfeeder queues Fodder into the next tavern: 1 (non-golden) + 2 (golden) = 3 Fred.
    expect((s.pendingTavern ?? []).filter((id) => id === 'fred').length).toBe(3);
    // Hoarder grants +1 Gold next turn (its recruit factory ran with full RunState access).
    expect((s.bonusEmbersNextTurn ?? 0) - goldBefore).toBe(1);
  });

  it('Soulfeeder queues Fodder only once — it does not re-proc on later rounds', () => {
    let s: RunState = {
      ...createRun(1),
      resolve: 999, maxResolve: 999,
      embers: 0, shop: [],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
      board: [],
    };
    s = reduce(s, { type: 'play', uid: 'sf' });
    const atk = () => s.board.find((c) => c.cardId === 'feed')!.attack;
    expect(atk()).toBe(2);
    const seen: number[] = [];
    for (let r = 0; r < 4; r++) {
      s = reduce(s, { type: 'faceOmen' });
      s = reduce(s, { type: 'resolveCombat' });
      seen.push(atk());
    }
    // ate one Fred on the first refresh (2 → 3), then never again — no per-round re-proc
    expect(seen).toEqual([3, 3, 3, 3]);
    expect(s.pendingTavern).toEqual([]);
  });

  it('Buddy Buddy adds a random Tier 1 minion to your hand (golden adds two)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [],
      hand: [{ uid: 'b', cardId: 'buddy', tribe: 'neutral', attack: 3, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'b' });
    expect(s.board.find((c) => c.cardId === 'buddy')).toBeDefined();
    const gained = s.hand;
    expect(gained.length).toBe(1); // one random T1 minion granted to hand
    expect(CARD_INDEX[gained[0]!.cardId]?.tier).toBe(1);

    // golden Buddy Buddy grants two
    let g: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [],
      hand: [{ uid: 'bg', cardId: 'buddy', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'play', uid: 'bg' });
    // two random T1 minions (the golden also grants its usual Discover spell, so ignore that one)
    expect(g.hand.filter((c) => c.cardId !== 'discoverspell').length).toBe(2);
  });

  it('Karwind buffs your Dragons whenever a Battlecry triggers', () => {
    // Play Hoard Cleric (Dragon Battlecry +2/+3 to dragons) with Karwind on board: the Cleric's
    // Battlecry buffs Karwind +2/+3, then the battlecry-triggered proc gives Dragons +1/+2.
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'k', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false }],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const k = s.board.find((c) => c.uid === 'k')!;
    expect([k.attack, k.health]).toEqual([5, 17]); // 2/12 +2/+3 (Cleric) +1/+2 (Karwind proc)
  });

  it('Karwind procs once per Battlecry fire — Drakko doubling triggers it twice', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [
        { uid: 'k', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false },
        { uid: 'd', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const k = s.board.find((c) => c.uid === 'k')!;
    // Cleric Battlecry fires 2× (+4/+6) and Karwind procs 2× (+2/+4): 2/12 → 8/22
    expect([k.attack, k.health]).toEqual([8, 22]);
  });

  it('Money Bot raises max mana while on board; selling it removes the income', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'mb', cardId: 'moneybot', tribe: 'mech', attack: 3, health: 3, keywords: ['M'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    expect(boardManaBonus(s)).toBe(1);
    s = reduce(s, { type: 'resolveCombat' }); // advance a turn → start with base max + the bonus
    expect(s.embers).toBe(s.maxEmbers + 1);
  });

  it('Money Bot magnetized into a Mech passes on its mana; selling the host removes it (survives a triple)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [{ uid: 'mb', cardId: 'moneybot', tribe: 'mech', attack: 3, health: 3, keywords: ['M'], golden: false }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'mb', toIndex: 0 }); // magnetize onto the Spare Part Drone
    expect(s.board.length).toBe(1); // merged, not a new slot
    expect(s.board[0]!.manaBonus).toBe(1); // the host absorbed Money Bot's income
    expect(boardManaBonus(s)).toBe(1);
    s = reduce(s, { type: 'sell', uid: 'd' }); // sell the host
    expect(boardManaBonus(s)).toBe(0); // income gone with it
  });

  it('Better Bot magnetizes its Rally onto a Mech, and it stacks (+5 each)', () => {
    let s: RunState = {
      ...createRun(1),
      hand: [
        { uid: 'bb1', cardId: 'betterbot', tribe: 'mech', attack: 6, health: 4, keywords: ['M', 'RL'], golden: false },
        { uid: 'bb2', cardId: 'betterbot', tribe: 'mech', attack: 6, health: 4, keywords: ['M', 'RL'], golden: false },
      ],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb1', toIndex: 0 }); // weld onto the Drone
    expect(s.board.length).toBe(1); // merged, not a new slot
    expect(s.board[0]!.rallyMechAtk).toBe(5); // host now grants +5 to other Mechs on attack
    s = reduce(s, { type: 'play', uid: 'bb2', toIndex: 0 }); // weld a 2nd Better Bot → stacks
    expect(s.board[0]!.rallyMechAtk).toBe(10); // +5 each → +10
  });

  it('Sheldon / Speedy / Harry Botter are Magnetic — they weld their keyword/aura onto a host Mech', () => {
    // Sheldon welds Divine Shield (+ its 2/4 body) onto the host.
    let sh: RunState = {
      ...createRun(1),
      hand: [{ uid: 'mag', cardId: 'sheldon', tribe: 'mech', attack: 2, health: 4, keywords: ['DS', 'M'], golden: false }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 4, health: 4, keywords: [], golden: false }],
    };
    sh = reduce(sh, { type: 'play', uid: 'mag', toIndex: 0 });
    expect(sh.board.length).toBe(1); // merged, no new slot
    expect(sh.board[0]!.keywords).toContain('DS');
    expect([sh.board[0]!.attack, sh.board[0]!.health]).toEqual([6, 8]); // 4/4 + Sheldon 2/4

    // Speedy welds Windfury.
    let sp: RunState = {
      ...createRun(1),
      hand: [{ uid: 'mag', cardId: 'speedy', tribe: 'mech', attack: 4, health: 4, keywords: ['W', 'M'], golden: false }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 4, health: 4, keywords: [], golden: false }],
    };
    sp = reduce(sp, { type: 'play', uid: 'mag', toIndex: 0 });
    expect(sp.board[0]!.keywords).toContain('W');

    // Harry Botter welds its spell-power aura — the host keeps boosting spells though the body is consumed.
    let hb: RunState = {
      ...createRun(1),
      hand: [{ uid: 'mag', cardId: 'harrybotter', tribe: 'mech', attack: 1, health: 5, keywords: ['M'], golden: false }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 4, health: 4, keywords: [], golden: false }],
    };
    expect(spellStatBonus(hb)).toBe(0); // still in hand — aura inactive
    hb = reduce(hb, { type: 'play', uid: 'mag', toIndex: 0 });
    expect(hb.board.length).toBe(1);
    expect(hb.board[0]!.spellAuraBonus).toBe(1);
    expect(spellStatBonus(hb)).toBe(1); // the welded aura still boosts spells +1/+1
  });

  it('Combinator magnetizes a random Magnetic Mech onto 1 friendly Mech at end of turn (golden: 2)', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'cmb', cardId: 'combinator', tribe: 'mech', attack: 6, health: 7, keywords: [], golden: false },
        { uid: 'd1', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'd2', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires Combinator before combat
    const d1 = s.board.find((c) => c.uid === 'd1')!;
    const d2 = s.board.find((c) => c.uid === 'd2')!;
    const cmb = s.board.find((c) => c.uid === 'cmb')!;
    const welded = [d1, d2].filter((m) => m.attack > 2);
    expect(welded.length).toBe(1); // non-golden welds exactly one Mech (golden would weld two)
    // The host (2/1) gained a random Magnetic Mech's body: Cling (2/2), Money Bot (3/3) or Better Bot (6/4).
    const profiles = [[2 + 2, 1 + 2], [2 + 3, 1 + 3], [2 + 6, 1 + 4]];
    expect(profiles).toContainEqual([welded[0]!.attack, welded[0]!.health]);
    expect([cmb.attack, cmb.health]).toEqual([6, 7]); // self is not a target
  });

  it('a golden Combinator welds onto 2 RANDOM Mechs — the pair varies by seed, not the highest-Attack', () => {
    const everBuffed = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      let s: RunState = {
        ...createRun(seed),
        phase: 'recruit',
        embers: 0,
        shop: [],
        board: [
          { uid: 'cmb', cardId: 'combinator', tribe: 'mech', attack: 6, health: 7, keywords: [], golden: true },
          { uid: 'm1', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
          { uid: 'm2', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
          { uid: 'm3', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
          { uid: 'm4', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
        ],
      };
      s = reduce(s, { type: 'faceOmen' });
      const buffed = s.board.filter((c) => c.uid.startsWith('m') && c.attack > 2).map((c) => c.uid);
      expect(buffed.length).toBe(2); // exactly `targets` (2) Mechs welded each run
      buffed.forEach((u) => everBuffed.add(u));
    }
    // Over 24 seeds the chosen pair shifts around — the old highest-Attack logic would always pick m1/m2.
    expect(everBuffed.size).toBeGreaterThan(2);
  });

  it('Chronos triggers End-of-Turn effects an extra time', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 5, keywords: [], golden: false },
        { uid: 'ch', cardId: 'chronos', tribe: 'neutral', attack: 1, health: 6, keywords: [], golden: false },
        { uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires Ritualist twice (Chronos +1)
    expect(s.cardBuffs.fred).toEqual({ attack: 4, health: 4 }); // +2/+2 applied twice
    const f = s.board.find((c) => c.uid === 'f')!;
    expect([f.attack, f.health]).toEqual([5, 5]); // the on-board Fred: 1/1 + 4/4
  });

  it('Magnetic merges a Cling Drone onto a friendly Mech (no new slot)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
      shop: [{ uid: 'x', cardId: 'cling' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid, toIndex: 0 }); // drop onto the Mech
    expect(s.board.length).toBe(1); // merged, not added
    expect(s.hand.length).toBe(0);
    const drone = s.board[0]!;
    expect(drone.attack).toBe(4); // 2 + 2
    expect(drone.health).toBe(3); // 1 + 2
    expect(drone.keywords).toContain('DS');
    expect(drone.keywords).not.toContain('M'); // Magnetic itself isn't transferred
  });

  it('magnetizing fires summon-buffs first: Mama Bear buffs the Symbiotic Attachment, then it welds onto the host', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false },
        { uid: 'host', cardId: 'gnash', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sym', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sym', toIndex: 1 }); // weld onto the Gnasher host (universalTribe → any non-neutral)
    expect(s.board.length).toBe(2); // merged, no new slot
    const host = s.board.find((c) => c.uid === 'host')!;
    // Attachment 1/1 + Mama Bear (+2/+2, universalTribe counts as a Beast) = 3/3, welded onto the 5/5 host → 8/8.
    expect([host.attack, host.health]).toEqual([8, 8]);
  });

  it('Symbiotic Attachment is Magnetic Reborn — welding it grants the host Reborn', () => {
    expect(CARD_INDEX.symbioticattachment!.keywords).toContain('R'); // the token itself carries Reborn
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'host', cardId: 'gnash', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false }],
      // The real token (from the Symbiote hero power) carries M + R.
      hand: [{ uid: 'sym', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M', 'R'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sym', toIndex: 0 }); // weld onto the host
    const host = s.board.find((c) => c.uid === 'host')!;
    expect(host.keywords).toContain('R'); // Reborn rides along on the weld (applyWeld transfers non-M keywords)
    expect(host.keywords).not.toContain('M'); // Magnetic itself isn't transferred
    expect([host.attack, host.health]).toEqual([6, 6]); // 5/5 host + the Attachment's 1/1
  });

  it('Heckbinder (Demon/Mech) magnetizes onto a Demon or a Mech, but not other tribes', () => {
    const heck = (): BoardCard => ({ uid: 'h', cardId: 'heckbinder', tribe: 'demon', attack: 3, health: 3, keywords: ['M'], golden: false });
    // onto a Demon → merges (+3/+3)
    let d: RunState = { ...createRun(1), embers: 0, shop: [], hand: [heck()], board: [{ uid: 't', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }] };
    d = reduce(d, { type: 'play', uid: 'h', toIndex: 0 });
    expect(d.board.length).toBe(1);
    expect([d.board[0]!.attack, d.board[0]!.health]).toEqual([5, 5]);
    // onto a Mech → merges
    let m: RunState = { ...createRun(1), embers: 0, shop: [], hand: [heck()], board: [{ uid: 't', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }] };
    m = reduce(m, { type: 'play', uid: 'h', toIndex: 0 });
    expect(m.board.length).toBe(1);
    expect([m.board[0]!.attack, m.board[0]!.health]).toEqual([5, 4]);
    // onto a Beast → no merge; plays as its own 3/3 body
    let b: RunState = { ...createRun(1), embers: 0, shop: [], hand: [heck()], board: [{ uid: 't', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }] };
    b = reduce(b, { type: 'play', uid: 'h', toIndex: 0 });
    expect(b.board.length).toBe(2);
  });

  it('a Mech-magnetic card (Cling Drone) can magnetize ONTO Heckbinder — it counts as a Mech', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      hand: [{ uid: 'c', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false }],
      board: [{ uid: 'h', cardId: 'heckbinder', tribe: 'demon', attack: 3, health: 3, keywords: ['M'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c', toIndex: 0 });
    expect(s.board.length).toBe(1); // merged onto Heckbinder (a Demon/Mech)
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([5, 5]); // 3/3 + 2/2
  });

  it('magnetizing a GOLDEN Magnetic still grants the triple Discover', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      hand: [{ uid: 'c', cardId: 'cling', tribe: 'mech', attack: 4, health: 4, keywords: ['M'], golden: true }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c', toIndex: 0 });
    expect(s.board.length).toBe(1); // merged, no board slot taken
    expect(s.hand.some((h) => h.cardId === 'discoverspell')).toBe(true); // golden "play" still grants the Discover
  });

  it('a Magnetic minion dropped off a Mech plays as a normal body', () => {
    let s: RunState = { ...createRun(1), embers: 3, hand: [], board: [], shop: [{ uid: 'x', cardId: 'cling' }] };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // no target → normal play
    expect(s.board.length).toBe(1);
    expect(s.board[0]!.cardId).toBe('cling');
  });

  it('Magnetic does not merge onto a non-Mech', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'g', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'cling' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid, toIndex: 0 });
    expect(s.board.length).toBe(2); // placed as its own minion
    expect(s.board.some((c) => c.cardId === 'cling')).toBe(true);
  });

  it('Fred (Fodder) is not in the buyable shop pool', () => {
    expect(BUYABLE_CARDS.some((c) => c.id === 'fred')).toBe(false);
  });

  it('Soulfeeder Battlecry queues Fodder into the next tavern', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [],
      shop: [{ uid: 'x', cardId: 'feed' }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // Soulfeeder Battlecry
    expect(s.pendingTavern).toContain('fred'); // queued for the next refresh, not placed now
    expect(s.board.some((c) => c.cardId === 'fred')).toBe(false);
  });

  it('a Demon devours Fodder entering the tavern — Voracious Imp at 2x', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'i', cardId: 'imp', tribe: 'demon', attack: 2, health: 2, keywords: ['CN'], golden: false }],
      pendingTavern: ['fred'],
    };
    s = reduce(s, { type: 'roll' }); // tavern refresh injects the Fodder, then the Imp eats it
    expect(s.shop.some((o) => o.cardId === 'fred')).toBe(false); // eaten, not left in the tavern
    const imp = s.board.find((c) => c.cardId === 'imp');
    expect([imp?.attack, imp?.health]).toEqual([4, 4]); // 2/2 + 2×(1/1)
  });

  it('golden Voracious Imp eats Fodder at 3x', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'i', cardId: 'imp', tribe: 'demon', attack: 4, health: 4, keywords: ['CN'], golden: true }],
      pendingTavern: ['fred'],
    };
    s = reduce(s, { type: 'roll' });
    const imp = s.board.find((c) => c.cardId === 'imp');
    expect([imp?.attack, imp?.health]).toEqual([7, 7]); // 4/4 + 3×(1/1)
  });


  it('Maw of the Pit queues a Fodder into the next tavern at End of Turn', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'maw', tribe: 'demon', attack: 4, health: 5, keywords: ['T'], golden: false }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires → Maw queues a Fodder for the next tavern
    expect(s.pendingTavern).toContain('fred');
  });

  it('a golden Maw of the Pit queues two Fodder at End of Turn', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'maw', tribe: 'demon', attack: 8, health: 10, keywords: ['T'], golden: true }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'faceOmen' });
    expect((s.pendingTavern ?? []).filter((c) => c === 'fred')).toHaveLength(2);
  });

  it('Archmagus Guel buffs 2 other friends when you cast a tavern spell', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      hand: [{ uid: 'sp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'g', cardId: 'guel', tribe: 'neutral', attack: 2, health: 3, keywords: [], golden: false },
        { uid: 'a', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sp' }); // cast Mana Pouch (a tavern spell)
    const a = s.board.find((c) => c.uid === 'a');
    const b = s.board.find((c) => c.uid === 'b');
    const g = s.board.find((c) => c.uid === 'g');
    expect([a?.attack, a?.health]).toEqual([2, 2]); // both *other* friends get +1/+1
    expect([b?.attack, b?.health]).toEqual([2, 2]);
    expect([g?.attack, g?.health]).toEqual([2, 3]); // Guel itself does not
  });

  it('Flowing Monk buffs a friend when a summon overflows the full board', () => {
    const filler = (uid: string): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false });
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'mk', cardId: 'monk', tribe: 'neutral', attack: 1, health: 4, keywords: [], golden: false },
        filler('f1'), filler('f2'), filler('f3'), filler('f4'), filler('f5'),
      ],
    };
    // 6 minions → playing Alleycat makes 7, then its Stray Battlecry summon overflows → Monk procs.
    s = reduce(s, { type: 'play', uid: 'al' });
    expect(s.board.some((c) => c.buffs?.some((b) => b.source === 'Flowing Monk'))).toBe(true);
  });

  it('Fodder with no Demon on board is wasted — never enters the tavern, never stored', () => {
    let s: RunState = { ...createRun(1), embers: 3, board: [], pendingTavern: ['fred'] };
    s = reduce(s, { type: 'roll' });
    expect(s.shop.some((o) => o.cardId === 'fred')).toBe(false); // no Demon → wasted, doesn't clutter the shop
    expect(s.pendingTavern).toEqual([]); // and not stored for later
  });

  it('always offers one spell on the right of the shop', () => {
    const s = createRun(1);
    expect(s.spell).not.toBeNull();
    expect(CARD_INDEX[s.spell!.cardId]?.spell).toBe(true);
  });

  it('buys a spell into the hand at its own cost (not the minion cost)', () => {
    let s: RunState = { ...createRun(1), embers: 5, spell: { uid: 'sp', cardId: 'spiritfire' } };
    const def = CARD_INDEX[s.spell!.cardId]!;
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    expect(s.embers).toBe(5 - (def.cost ?? 0)); // Spirit Fire costs 2, not 3
    expect(s.hand.some((c) => c.cardId === 'spiritfire')).toBe(true);
    expect(s.spell).toBeNull(); // slot empties until the next roll
  });

  it('Spirit Fire buffs the targeted friend +4/+4, is consumed, and counts as a cast', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      spell: { uid: 'sp', cardId: 'spiritfire' },
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const spell = s.hand.find((c) => c.cardId === 'spiritfire')!;
    s = reduce(s, { type: 'play', uid: spell.uid, targetUid: 'm' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([5, 5]); // 1/1 + 4/4
    expect(s.hand.some((c) => c.cardId === 'spiritfire')).toBe(false); // no board slot — consumed
    expect(s.spellsCast).toBe(1);
  });

  it('a targeted spell played with no valid target is not cast', () => {
    let s: RunState = { ...createRun(1), embers: 5, board: [], spell: { uid: 'sp', cardId: 'spiritfire' } };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const spell = s.hand.find((c) => c.cardId === 'spiritfire')!;
    const after = reduce(s, { type: 'play', uid: spell.uid }); // no targetUid
    expect(after.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // stays in hand
    expect(after.spellsCast).toBe(0);
  });

  it('Growth buffs every friendly minion (+3/+4, untargeted)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'gnash', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
      ],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' }); // no target — buffs the whole board
    expect([s.board.find((c) => c.uid === 'a')!.attack, s.board.find((c) => c.uid === 'a')!.health]).toEqual([4, 5]);
    expect([s.board.find((c) => c.uid === 'b')!.attack, s.board.find((c) => c.uid === 'b')!.health]).toEqual([5, 6]);
    expect(s.hand.some((c) => c.cardId === 'growth')).toBe(false); // consumed
    expect(s.spellsCast).toBe(1);
  });

  it('Channeling the Devourer removes the target and feeds its stats to a random other friend', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'eat', cardId: 'gnash', tribe: 'beast', attack: 6, health: 5, keywords: [], golden: false },
        { uid: 'recip', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'd', cardId: 'devour', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'd', targetUid: 'eat' }); // devour the 6/5
    expect(s.board.find((c) => c.uid === 'eat')).toBeUndefined(); // devoured
    const recip = s.board.find((c) => c.uid === 'recip')!;
    expect([recip.attack, recip.health]).toEqual([7, 6]); // 1/1 + the devoured 6/5
    expect(s.devourFx).toEqual({ toUid: 'recip', attack: 6, health: 5 }); // projectile hint for the UI
  });

  it('Ember Pouch gains an Ember when cast (net-neutral after its 1 cost)', () => {
    let s: RunState = { ...createRun(1), embers: 5, spell: { uid: 'sp', cardId: 'emberpouch' } };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid }); // pay 1 → 4
    expect(s.embers).toBe(4);
    const pouch = s.hand.find((c) => c.cardId === 'emberpouch')!;
    s = reduce(s, { type: 'play', uid: pouch.uid }); // untargeted → gain 1 → 5
    expect(s.embers).toBe(5);
    expect(s.hand.some((c) => c.cardId === 'emberpouch')).toBe(false); // consumed
    expect(s.spellsCast).toBe(1);
  });

  it('Bulwark gives a friend +0/+1 and Taunt', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      spell: { uid: 'sp', cardId: 'bulwark' },
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const spell = s.hand.find((c) => c.cardId === 'bulwark')!;
    s = reduce(s, { type: 'play', uid: spell.uid, targetUid: 'm' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([2, 3]); // +0/+1
    expect(m.keywords).toContain('T'); // and Taunt
  });

  // --- Spell batch -------------------------------------------------------------------------------

  const castOnBoard = (spellId: string, board: BoardCard[], targetUid?: string, hero?: string): RunState => {
    let s: RunState = {
      ...createRun(1, hero), embers: 0, shop: [], board,
      hand: [{ uid: 'sp', cardId: spellId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', ...(targetUid ? { targetUid } : {}) });
    return s;
  };
  const oneNeutral = (uid = 'm', over: Partial<BoardCard> = {}): BoardCard => ({
    uid, cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false, ...over,
  });

  it('Shatter gives +2/+4 and toggles Taunt (grant when absent, remove when present)', () => {
    // No Taunt → Shatter grants it.
    const grant = castOnBoard('shatter', [oneNeutral('m', { keywords: [] })], 'm');
    const a = grant.board.find((c) => c.uid === 'm')!;
    expect([a.attack, a.health]).toEqual([4, 6]); // 2/2 + 2/4
    expect(a.keywords).toContain('T');
    // Already Taunt → Shatter strips it (and still applies the stats).
    const strip = castOnBoard('shatter', [oneNeutral('m', { keywords: ['T'] })], 'm');
    const b = strip.board.find((c) => c.uid === 'm')!;
    expect([b.attack, b.health]).toEqual([4, 6]);
    expect(b.keywords).not.toContain('T');
  });

  it('Shatter (target: any) buffs a tavern offer, and the buff bakes in when bought', () => {
    let s: RunState = {
      ...createRun(1), embers: 5, board: [],
      shop: [{ uid: 'o', cardId: 'alley' }],
      hand: [{ uid: 'sp', cardId: 'shatter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o' });
    const offer = s.shop.find((o) => o.uid === 'o')!;
    expect([offer.atk, offer.hp]).toEqual([2, 4]); // Shatter's +2/+4 folded onto the ShopCard
    expect(offer.keywords).toContain('T'); // + Taunt
    s = reduce(s, { type: 'buy', uid: 'o' }); // Alleycat 1/1 + the offer buff bakes in
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([3, 5]); // 1/1 + 2/4
    expect(bought.keywords).toContain('T');
  });

  it('Front to Back escalates linearly (+2/+2, then +4/+4, …) and the run tally climbs', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [oneNeutral('m', { attack: 0, health: 1 })],
      hand: [
        { uid: 's1', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
        { uid: 's2', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'm' }); // +2/+2
    expect(s.frontToBackBonus).toBe(2);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([2, 3]);
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 'm' }); // +(2+2) = +4/+4
    expect(s.frontToBackBonus).toBe(4);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([6, 7]); // 2/3 + 4/4
  });

  it('Front to Back adds spell power (Rohan) on top of its escalation', () => {
    // Rohan's amplify is +1 at wave 1 → first cast is +(2 + 0 + 1) = +3/+3.
    const s = castOnBoard('fronttoback', [oneNeutral('m', { attack: 0, health: 1 })], 'm', 'rohan');
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([3, 4]); // 0/1 + 3/3
    expect(s.frontToBackBonus).toBe(2); // the tally still climbs by exactly 2
    // The card shows BOTH the live grant (base 2 + accumulated escalation + spell power) AND the per-cast
    // improvement (base step 2 + spell power). Both slots scale with spell power; only the grant scales
    // with escalation. A slot is greened only when it's actually above its printed base.
    expect(spellDisplayText('fronttoback', 0, 0)).toBe('Give a minion **+2/+2**. Improve this by **+2/+2**.'); // base — no boost
    // +1 spell power, no escalation (the in-game screenshot): grant 2+0+1=3, improve 2+1=3 — both green.
    expect(spellDisplayText('fronttoback', 1, 0)).toBe('Give a minion **{{+3/+3}}**. Improve this by **{{+3/+3}}**.');
    // Escalated (+2) AND +1 power: grant 2+2+1=5; improve does NOT take escalation, only power → 2+1=3.
    expect(spellDisplayText('fronttoback', 1, 2)).toBe('Give a minion **{{+5/+5}}**. Improve this by **{{+3/+3}}**.');
    // Escalated only (+4), no power: grant 2+4=6 green; improve stays the printed +2/+2 (power-only).
    expect(spellDisplayText('fronttoback', 0, 4)).toBe('Give a minion **{{+6/+6}}**. Improve this by **+2/+2**.');
  });

  it('Mana Font raises max Mana permanently but does NOT refill current Mana', () => {
    let s: RunState = {
      ...createRun(1), embers: 2, maxEmbers: 4, shop: [],
      hand: [{ uid: 'sp', cardId: 'manafont', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.maxEmbers).toBe(5); // +1 permanent
    expect(s.embers).toBe(2); // current Mana untouched — no top-up this turn
  });

  it('Nadja Mana Font (hero power): untargeted, +1 max Mana, costs 3 Mana', () => {
    let s: RunState = { ...createRun(1, 'nadja'), embers: 5, maxEmbers: 5 };
    expect(s.heroReady).toBe(true);
    s = reduce(s, { type: 'heroPower' }); // no uid — the power is untargeted
    expect(s.maxEmbers).toBe(6); // +1 permanent max
    expect(s.embers).toBe(2); // spent 3 to use it
    expect(s.heroReady).toBe(false); // once per turn
  });

  it('Nadja Mana Font (hero power): no-op when you cannot afford 3 Mana', () => {
    const s: RunState = { ...createRun(1, 'nadja'), embers: 2, maxEmbers: 5 };
    const after = reduce(s, { type: 'heroPower' });
    expect(after.maxEmbers).toBe(5); // unchanged — couldn't afford the cost
    expect(after.embers).toBe(2);
  });

  it('Mana Font pushes max Mana PAST the cap (uncapped scaling)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, maxEmbers: CONFIG.embersCap, shop: [],
      hand: [{ uid: 'sp', cardId: 'manafont', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.maxEmbers).toBe(CONFIG.embersCap + 1); // no cap on Mana Font — it scales past the normal ceiling
  });

  it('Refreshing Texts banks 2 free rerolls, spent before Mana on a roll', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, freeRolls: 0, shop: [],
      hand: [{ uid: 'sp', cardId: 'refreshtexts', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.freeRolls).toBe(2);
    s = reduce(s, { type: 'roll' }); // free — no Mana charged
    expect(s.freeRolls).toBe(1);
    expect(s.embers).toBe(0);
    s = reduce(s, { type: 'roll' });
    expect(s.freeRolls).toBe(0);
    expect(s.embers).toBe(0); // still free
    const before = s.embers;
    const noMana = reduce(s, { type: 'roll' }); // no free rolls + 0 Mana → no-op
    expect(noMana).toBe(s);
    expect(noMana.embers).toBe(before);
  });

  it('Eyes of Aresmar gilds a Tier-4-or-lower minion, but no-ops above Tier 4', () => {
    // Target Dummy is Tier 1 → gilds (stats double, golden flag set).
    const ok = castOnBoard('aresmar', [oneNeutral('m', { attack: 0, health: 4, keywords: ['T'] })], 'm');
    const low = ok.board.find((c) => c.uid === 'm')!;
    expect(low.golden).toBe(true);
    expect([low.attack, low.health]).toEqual([0, 8]); // 0/4 doubled
    // Grim is Tier 6 → above the cap → the spell is consumed but does nothing.
    const no = castOnBoard('aresmar', [{ uid: 'g', cardId: 'grim', tribe: 'beast', attack: 7, health: 1, keywords: [], golden: false }], 'g');
    const high = no.board.find((c) => c.uid === 'g')!;
    expect(high.golden).toBe(false);
    expect([high.attack, high.health]).toEqual([7, 1]); // untouched
  });

  it('Tribes Choice conjures a minion of the target’s tribe to hand', () => {
    // Target a Beast → the conjured card must be a Beast (up to the tavern tier).
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 0, shop: [],
      board: [{ uid: 'b', cardId: 'gnash', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'sp', cardId: 'tribeschoice', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'b' });
    const conjured = s.hand.find((c) => c.cardId !== 'tribeschoice');
    expect(conjured).toBeDefined();
    const def = CARD_INDEX[conjured!.cardId]!;
    expect(def.tribe === 'beast' || def.tribe2 === 'beast').toBe(true);
    expect(def.tier).toBeLessThanOrEqual(6);
  });

  it('Tribes Choice fizzles on a neutral target (neutral is no longer a type)', () => {
    // Target a neutral minion → no type to roll, so nothing is conjured (the spell still casts + leaves hand).
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 0, shop: [],
      board: [{ uid: 'n', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
      hand: [{ uid: 'sp', cardId: 'tribeschoice', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'n' });
    expect(s.hand.find((c) => c.cardId !== 'tribeschoice')).toBeUndefined(); // no neutral handed out
  });

  it('Summon Stone conjures a random Tier 1 minion to hand', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'summonstone', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const conjured = s.hand.find((c) => c.cardId !== 'summonstone');
    expect(conjured).toBeDefined();
    expect(CARD_INDEX[conjured!.cardId]!.tier).toBe(1);
  });

  it('Frontdrake conjures a Dragon every 3 turns (End-of-Turn counter)', () => {
    // Pool seeded with one Dragon (Hoard Cleric) + dragon active, so the cadence grant has a draw.
    const frontdrake: BoardCard = { uid: 'f', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false };
    const s: RunState = {
      ...createRun(1), tier: 6, hand: [], board: [frontdrake],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
    };
    applyEndOfTurn(s); // turn 1 — counts, no grant
    applyEndOfTurn(s); // turn 2 — counts, no grant
    expect(s.hand.length).toBe(0);
    applyEndOfTurn(s); // turn 3 — cadence hits → conjure a Dragon
    expect(s.hand.map((c) => c.cardId)).toEqual(['cleric']);
    expect(frontdrake.eotTick).toBe(3);
  });

  it('a Frontdrake triple keeps the furthest-along cadence (a copy about to proc keeps that timing)', () => {
    // Three Frontdrakes at eotTick 2 / 1 / 0 → the golden inherits the cadence POSITION of the furthest
    // (2, one shy of every:3), so this turn's End of Turn still lands the cadence.
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 3, board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
      hand: [
        { uid: 'f1', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 2 },
        { uid: 'f2', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 1 },
      ],
      shop: [{ uid: 'x', cardId: 'frontdrake' }], // fresh — eotTick 0
    };
    s = reduce(s, { type: 'buy', uid: 'x' }); // the 3rd copy completes the triple
    const golden = s.hand.find((c) => c.cardId === 'frontdrake' && c.golden)!;
    expect(golden.eotTick).toBe(2); // furthest-along position kept (not reset, not the absolute max-of-something-else)
    // And this turn's End of Turn lands the cadence (2 → 3 → conjure a Dragon).
    s = { ...s, board: [golden], hand: [] };
    applyEndOfTurn(s);
    expect(golden.eotTick).toBe(3);
    expect(s.hand.map((c) => c.cardId)).toContain('cleric');
  });

  it('Mama Bear buffs each summoned Beast, improving the buff by +2/+2 each time (recruit)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }],
      hand: [
        { uid: 'b1', cardId: 'pack', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }, // Deathrattle only — no summon on play
        { uid: 'b2', cardId: 'grim', tribe: 'beast', attack: 7, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'b1' }); // first Beast summoned → +2/+2
    expect(s.board.find((c) => c.uid === 'b1')!.attack).toBe(2 + 2); // 4
    s = reduce(s, { type: 'play', uid: 'b2' }); // next Beast → buff improved to +4/+4
    expect(s.board.find((c) => c.uid === 'b2')!.attack).toBe(7 + 4); // 11
  });

  it('a universalTribe token (Symbiotic Attachment) receives tribe summon-buffs (Mama Bear + Kennelmaster)', () => {
    // Regression: the Symbiote hero-power token counts as EVERY tribe, so playing it must trigger
    // tribe-gated summon buffs. Before the fix the recruit factories only matched tribe/tribe2, so the
    // token was silently skipped (the reported "didn't get Mama Bear stats" bug).
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false },
        { uid: 'k', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false },
      ],
      hand: [
        { uid: 'sym', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sym' }); // standalone play (no weld target) → summon buffs fire
    const sym = s.board.find((c) => c.uid === 'sym')!;
    // Mama Bear (+2/+2) and Kennelmaster (+1/+1) both treat the universalTribe token as a Beast.
    expect(sym.attack).toBe(1 + 2 + 1); // 4
    expect(sym.health).toBe(1 + 2 + 1); // 4
  });

  it('a Mama Bear triple picks up the accrual at its current value — no reset, no double', () => {
    // Two Mama Bears at summonBonus 6 and 3 + a fresh one → the golden keeps the HIGHEST (6), NOT the
    // Kennelmaster-style sum (which would be 9) and NOT 0. Its bigger +6/+6 step comes from being golden.
    let s: RunState = {
      ...createRun(1), embers: 3,
      hand: [
        { uid: 'm1', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false, summonBonus: 6 },
        { uid: 'm2', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false, summonBonus: 3 },
      ],
      shop: [{ uid: 'x', cardId: 'mamabear' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' }); // the 3rd copy completes the triple
    const golden = s.hand.find((c) => c.cardId === 'mamabear' && c.golden)!;
    expect(golden.summonBonus).toBe(6); // current value preserved, not 9 (sum) or 0 (reset)
    // Played, it grants (base 2 + accrual 6) × 2 golden = +16/+16 to the next Beast summoned.
    s = reduce(s, { type: 'play', uid: golden.uid }); // golden Mama Bear → board
    s = { ...s, hand: [{ uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'a' });
    expect(s.board.find((c) => c.uid === 'a')!.attack).toBe(1 + 16);
  });

  it('Sea Urchin Battlecry offers a Discover of Beasts only (up to tavern tier)', () => {
    // Pool mixes Beasts + a Dragon (cleric); the Discover must offer only Beasts.
    let s: RunState = {
      ...createRun(1), tier: 4, embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { alley: 5, pack: 5, kennel: 5, raptor: 5, cleric: 5 },
      hand: [{ uid: 'u', cardId: 'seaurchin', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'u' });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.tribe === 'beast' || def.tribe2 === 'beast').toBe(true); // cleric (Dragon) is never offered
    }
  });

  it('Sea Urchin cannot Discover itself', () => {
    // Pool is all Beasts INCLUDING Sea Urchin — the Discover must still never offer another Sea Urchin.
    let s: RunState = {
      ...createRun(1), tier: 4, embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { seaurchin: 5, raptor: 5, gryphon: 5, alley: 5, pack: 5 },
      hand: [{ uid: 'u', cardId: 'seaurchin', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'u' });
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.discover).not.toContain('seaurchin'); // the source is excluded from its own Discover
  });

  it('card-driven Discover weighs every tier evenly; only the golden reward (topTierFirst) peeks the top tier', () => {
    // Tier-2 beasts (kennel/pack/shaper) give a 3-card top tier; alley (T1) is the low control. The OLD
    // floor-walk showed ONLY the top tier; now a card Discover weighs every tier ≤ target evenly.
    const pool = { kennel: 9, pack: 9, shaper: 9, alley: 9 };
    const base: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool,
    };
    // Sea Urchin at tavern tier 2 → uniform up to 2: the Tier-1 beast IS offered across seeds.
    let urchinLowSeen = false;
    for (let seed = 1; seed <= 50 && !urchinLowSeen; seed++) {
      const s = reduce(
        { ...base, tier: 2, rngCursor: seed, hand: [{ uid: 'u', cardId: 'seaurchin', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false }] },
        { type: 'play', uid: 'u' },
      );
      if ((s.discover ?? []).includes('alley')) urchinLowSeen = true;
    }
    expect(urchinLowSeen).toBe(true); // a Tier-1 beast IS offered → the high-tier floor-walk is gone

    // Golden/triple reward (discoverspell) at tier 1 → peeks tier 2 (topTierFirst): never drops below the top.
    const goldTiers = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const s = reduce(
        { ...base, tier: 1, rngCursor: seed, hand: [{ uid: 'd', cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] },
        { type: 'play', uid: 'd' },
      );
      for (const id of s.discover ?? []) goldTiers.add(CARD_INDEX[id]!.tier);
    }
    expect([...goldTiers]).toEqual([2]); // exclusively the peeked (top) tier — the reward keeps its bias
  });

  it('Tribe Portal Discovers a minion of your most common board tribe', () => {
    // Board is Beast-dominant (2 Beasts vs 1 Dragon) → the Discover offers only Beasts.
    let s: RunState = {
      ...createRun(1), tier: 4, embers: 0, shop: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { alley: 5, pack: 5, cleric: 5, knit: 5 },
      board: [
        { uid: 'b1', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b2', cardId: 'pack', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'd1', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sp', cardId: 'tribeportal', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.tribe === 'beast' || def.tribe2 === 'beast').toBe(true);
    }
  });

  it('Corpse Board Discovers a Deathrattle minion only', () => {
    // Pool mixes Deathrattle minions (pack, manasaber) with non-Deathrattle ones (alley, cleric).
    let s: RunState = {
      ...createRun(1), tier: 5, embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { pack: 5, manasaber: 5, alley: 5, cleric: 5 },
      hand: [{ uid: 'sp', cardId: 'corpseboard', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle'))).toBe(true);
    }
  });

  it('Perfect Vision sets a friendly minion to 20/20', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 4, keywords: ['T'], golden: false }],
      hand: [{ uid: 'sp', cardId: 'perfectvision', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm' });
    const t = s.board.find((c) => c.uid === 'm')!;
    expect([t.attack, t.health]).toEqual([20, 20]);
  });

  it('Cupcakes — the chosen Demon consumes 3 random tavern minions (gains stats; tavern shrinks by 3)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0,
      board: [{ uid: 'd', cardId: 'imp', tribe: 'demon', attack: 2, health: 2, keywords: ['CN'], golden: false }], // Voracious Imp (2× consume)
      shop: [{ uid: 'a', cardId: 'alley' }, { uid: 'b', cardId: 'pack' }, { uid: 'c', cardId: 'kennel' }, { uid: 'e', cardId: 'gnash' }],
      hand: [{ uid: 'sp', cardId: 'cupcakes', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'd' });
    expect(s.shop.length).toBe(1); // 4 − 3 consumed
    expect(s.board.find((c) => c.uid === 'd')!.attack).toBeGreaterThan(2); // the Demon grew from eating
  });

  it('Apples buffs the current tavern offers +2/+3, and a buy bakes it in', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, frozen: false,
      shop: [{ uid: 'x', cardId: 'alley' }, { uid: 'y', cardId: 'pack' }],
      hand: [{ uid: 'sp', cardId: 'apples', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.shop.every((o) => o.atk === 2 && o.hp === 3)).toBe(true); // both offers buffed
    s = { ...s, embers: 10 };
    s = reduce(s, { type: 'buy', uid: 'x' }); // Alleycat 1/1 + Apples
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([3, 4]);
  });

  it('Fleeting Vigor banks a Start-of-Combat buff applied to the next combat, then spent', () => {
    let s: RunState = {
      ...createRun(1), embers: 0,
      hand: [{ uid: 'sp', cardId: 'fleetingvigor', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.fleetingVigor).toEqual({ attack: 2, health: 1 }); // banked
    s = reduce(s, { type: 'faceOmen' }); // combat: the buff lands on the combat board, then is spent
    const startSandbag = s.lastCombat?.initial.player.find((m) => m.cardId === 'sandbag');
    expect([startSandbag?.attack, startSandbag?.health]).toEqual([3, 2]); // 1/1 + Fleeting Vigor 2/1
    expect(s.fleetingVigor).toEqual({ attack: 0, health: 0 }); // spent after the fight
    // …and it's telegraphed as a Start-of-Combat narration (otherwise the pre-baked buff is invisible).
    expect(s.lastCombat?.events[0]).toMatchObject({ type: 'sc', text: expect.stringContaining('Fleeting Vigor') });
  });

  it('undeadBuyBonus applies the run-wide undead Attack bonus to any new Undead (universalTribe counts)', () => {
    const s = { ...createRun(1), undeadBuyAtk: 3 };
    expect(undeadBuyBonus(s, CARD_INDEX.spore!)).toBe(3); // Undead
    expect(undeadBuyBonus(s, CARD_INDEX.symbioticattachment!)).toBe(3); // universalTribe counts as Undead
    expect(undeadBuyBonus(s, CARD_INDEX.kennel!)).toBe(0); // Beast — not Undead
  });

  it('a Discovered Undead carries the run-wide undead Attack bonus (undeadBuyAtk), like a buy', () => {
    let s: RunState = { ...createRun(1), undeadBuyAtk: 3, discover: ['spore'] };
    s = reduce(s, { type: 'discover', index: 0 });
    const got = s.hand.find((c) => c.cardId === 'spore')!;
    expect(got.attack).toBe(1 + 3); // Sporeling base 1 + undeadBuyAtk 3
    expect(got.health).toBe(2); // Health unaffected
  });

  it('Symbiote hero power grants a token at the START of every 5th turn, tripling it on the spot', () => {
    let s: RunState = {
      ...createRun(1, 'symbiote'),
      wave: 4, phase: 'combat', // resolveCombat → advanceCombat → wave 5 → Symbiote grants the 3rd token
      board: [],
      hand: [
        { uid: 't1', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false },
        { uid: 't2', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false },
      ],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.wave).toBe(5); // start of the 5th turn
    expect(s.hand.filter((c) => c.cardId === 'symbioticattachment' && c.golden)).toHaveLength(1); // 3 → 1 golden, now
    expect(s.hand.filter((c) => c.cardId === 'symbioticattachment' && !c.golden)).toHaveLength(0);
  });

  it('Symbiote hero power does NOT grant on a non-5th turn', () => {
    let s: RunState = {
      ...createRun(1, 'symbiote'),
      wave: 5, phase: 'combat', // → wave 6, not a multiple of 5 → no grant
      board: [], hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.wave).toBe(6);
    expect(s.hand.filter((c) => c.cardId === 'symbioticattachment')).toHaveLength(0);
  });

  it('Sergeant: every recruit Attack-gain improves its Deathrattle HP grant (+2 per event, golden +4)', () => {
    // The reported bug: two Forsaken Weavers buffing Sergeant on a spell cast are two separate Attack-gain
    // events, so they improve the Deathrattle twice — not once, and not by the Attack amount.
    const sgt: BoardCard = { uid: 'sg', cardId: 'sergeant', tribe: 'undead', attack: 6, health: 6, keywords: [], golden: false };
    addBuff(sgt, 'Forsaken Weaver', 2, 0); // 1st Weaver → +2
    expect(sgt.hpGrantBonus).toBe(2);
    addBuff(sgt, 'Forsaken Weaver', 2, 0); // 2nd Weaver, same spell → +2 again
    expect(sgt.hpGrantBonus).toBe(4);
    addBuff(sgt, 'Mend', 0, 3); // a Health-only buff is NOT an Attack-gain → no improvement
    expect(sgt.hpGrantBonus).toBe(4);
    // Golden Sergeant improves +4 per event.
    const golden: BoardCard = { uid: 'g', cardId: 'sergeant', tribe: 'undead', attack: 12, health: 12, keywords: [], golden: true };
    addBuff(golden, 'Deathswarmer', 1, 0);
    expect(golden.hpGrantBonus).toBe(4);
  });

  it('Fodder Feeder, when sold, queues a Fodder + accrues the run-wide Imp buff (golden 2×)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0,
      board: [{ uid: 'ff', cardId: 'fodderfeeder', tribe: 'demon', attack: 1, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'sell', uid: 'ff' });
    expect(s.pendingTavern).toContain('fred'); // a Fodder queued for the next tavern
    expect(s.impBuff).toEqual({ attack: 1, health: 1 }); // run-wide Imp buff accrued
    expect(s.embers).toBe(CONFIG.sellValue); // still pays the base sell value
    // Golden accrues +2/+2 and queues 2 Fodder.
    let g: RunState = {
      ...createRun(1), embers: 0,
      board: [{ uid: 'ff', cardId: 'fodderfeeder', tribe: 'demon', attack: 2, health: 4, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'sell', uid: 'ff' });
    expect(g.impBuff).toEqual({ attack: 2, health: 2 });
    expect(g.pendingTavern!.filter((id) => id === 'fred').length).toBe(2);
  });

  it('Demonic Anomaly permanently buffs all tavern minions (+3/+3 run-wide) + grants 2 free refreshes', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, board: [],
      shop: [{ uid: 'x', cardId: 'alley' }],
      hand: [{ uid: 'da', cardId: 'demonanomaly', tribe: 'demon', attack: 4, health: 4, keywords: [], golden: false }],
    };
    const rolls0 = s.freeRolls;
    s = reduce(s, { type: 'play', uid: 'da' }); // Battlecry: run-wide tavern buff + free refreshes
    expect(s.tavernBuyBonus).toEqual({ atk: 3, hp: 3 }); // PERMANENT, not just the current offers
    expect(s.freeRolls).toBe(rolls0 + 2);
    // A minion bought AFTER the Battlecry still carries the buff (current AND future offers).
    s = reduce({ ...s, embers: 3 }, { type: 'buy', uid: 'x' });
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([1 + 3, 1 + 3]); // Alleycat 1/1 + 3/3
  });

  it('Staff of Guel permanently buffs every minion bought from the tavern (+2/+2), not Discovered ones', () => {
    let s: RunState = {
      ...createRun(1), embers: 4, board: [],
      shop: [{ uid: 'x', cardId: 'alley' }],
      hand: [{ uid: 'sp', cardId: 'staffofguel', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.tavernBuyBonus).toEqual({ atk: 2, hp: 2 }); // run-wide buy buff, set on cast
    expect(spellDisplayText('staffofguel', 1)).toContain('{{+3/+3}}'); // +2/+2 + 1 spell power, live
    s = reduce(s, { type: 'buy', uid: 'x' }); // Alleycat 1/1 + the run-wide buy buff
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([3, 3]); // 1/1 + 2/2
    // A Discovered minion does NOT get it (tavern purchases only).
    s = reduce({ ...s, discover: ['sandbag'] }, { type: 'discover', index: 0 });
    const disc = s.hand.find((c) => c.cardId === 'sandbag')!;
    expect([disc.attack, disc.health]).toEqual([0, 6]); // Target Dummy base (0/6), unbuffed
  });

  it('Staff of Guel also enchants Fodder run-wide (Demons eat bigger Fodder); no double on a bought Fodder', () => {
    let s: RunState = {
      ...createRun(1), embers: 4,
      board: [{ uid: 'bf', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false }],
      shop: [{ uid: 'f', cardId: 'fred' }],
      hand: [{ uid: 'sp', cardId: 'staffofguel', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    // The Fodder type is enchanted run-wide (+2/+2), like Ritualist's End-of-Turn buff…
    expect(s.cardBuffs?.fred).toEqual({ attack: 2, health: 2 });
    // …and Fodder already on the board gets it immediately.
    const onBoard = s.board.find((c) => c.cardId === 'fred')!;
    expect([onBoard.attack, onBoard.health]).toEqual([3, 3]);
    // Buying a Fodder applies the Staff buff ONCE (via the enchant), not twice.
    s = reduce(s, { type: 'buy', uid: 'f' });
    const bought = s.hand.find((c) => c.cardId === 'fred')!;
    expect([bought.attack, bought.health]).toEqual([3, 3]); // 1/1 + 2/2, not +4/+4
  });

  it('Undead Army completes a triple (its conjured copies are checked, not just minion plays)', () => {
    let s: RunState = {
      ...createRun(1), tier: 3, embers: 0, board: [],
      tribes: ['undead'],
      pool: { skullblade: 5 }, // the only buyable Undead → Undead Army deterministically conjures 2 Skullblades
      hand: [
        { uid: 'k', cardId: 'skullblade', tribe: 'undead', attack: 5, health: 1, keywords: [], golden: false },
        { uid: 'sp', cardId: 'undeadarmy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    // 1 in hand + 2 conjured = 3 → combine into one golden Skullblade, no stragglers left.
    const all = [...s.hand, ...s.board];
    expect(all.find((c) => c.cardId === 'skullblade' && c.golden)).toBeDefined();
    expect(all.filter((c) => c.cardId === 'skullblade' && !c.golden)).toHaveLength(0);
  });

  it('Sprout Discovers a Tier 1 minion; Help Wanted Discovers a Battlecry minion', () => {
    const sprout = castOnBoard('sprout', []);
    expect(sprout.discover).toBeDefined();
    for (const id of sprout.discover!) expect(CARD_INDEX[id]!.tier).toBe(1);
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 0, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'helpwanted', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.discover).toBeDefined();
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.effects.some((e) => e.on === 'onPlay') || !!def.chooseOne).toBe(true); // a Battlecry
    }
  });

  it('Lantern of Souls raises the run-wide Undead attack bonus', () => {
    const s = castOnBoard('lanternofsouls', []);
    expect(s.undeadAttackBonus).toBe(3);
    expect(s.undeadHealthBonus).toBe(0); // no spell power → a pure Attack buff
    // A second cast stacks.
    const s2 = castOnBoard('lanternofsouls', []);
    let t: RunState = { ...s2, hand: [{ uid: 'sp2', cardId: 'lanternofsouls', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    t = reduce(t, { type: 'play', uid: 'sp2' });
    expect(t.undeadAttackBonus).toBe(6);
  });

  it('Lantern of Souls scales with spell power (+4/+1 at +1) and the card shows it', () => {
    // Rohan amplifies +1 at wave 1 → base +3 Attack becomes +4 Attack / +1 Health.
    const s = castOnBoard('lanternofsouls', [], undefined, 'rohan');
    expect(s.undeadAttackBonus).toBe(4);
    expect(s.undeadHealthBonus).toBe(1);
    // The card text reflects the live value (green {{…}}); the base shows just +3 Attack.
    expect(spellDisplayText('lanternofsouls', 0)).toContain('+3 Attack');
    expect(spellDisplayText('lanternofsouls', 1)).toContain('{{+4/+1}}');
  });

  it('Mend heals the hero 5 (capped at max Resolve, no overheal)', () => {
    // Below max → heals 5.
    let s: RunState = {
      ...createRun(1), resolve: 20, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'mend', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' }); // untargeted
    expect(s.resolve).toBe(25); // 20 + 5
    expect(s.hand.some((c) => c.cardId === 'mend')).toBe(false); // consumed
    // Near max → can't overheal past the hero's max Resolve (30).
    let t: RunState = {
      ...createRun(1), resolve: 28, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'mend', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    t = reduce(t, { type: 'play', uid: 'sp' });
    expect(t.resolve).toBe(getHero(t.heroId).resolve); // clamped to 30, not 33
  });

  it('Undead Army conjures 2 copies of one random Undead to the hand', () => {
    // A run always has all 5 tribes active today, so Undead is buyable.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'undeadarmy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const conjured = s.hand.filter((c) => c.cardId !== 'undeadarmy');
    expect(conjured.length).toBe(2); // two copies
    expect(conjured[0]!.cardId).toBe(conjured[1]!.cardId); // …of the SAME card
    const def = CARD_INDEX[conjured[0]!.cardId]!;
    expect(def.tribe === 'undead' || def.tribe2 === 'undead').toBe(true); // an Undead
  });

  it('Lasso steals a random minion from the tavern into the hand (fizzles on an empty shop)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, board: [],
      shop: [{ uid: 'o1', cardId: 'alley' }, { uid: 'o2', cardId: 'alley' }],
      hand: [{ uid: 'sp', cardId: 'lasso', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.shop.length).toBe(1); // one offer was removed from the tavern
    expect(s.hand.some((c) => c.cardId === 'alley')).toBe(true); // …and landed in the hand (free)
    expect(s.hand.some((c) => c.cardId === 'lasso')).toBe(false); // the spell is consumed
    // Empty shop → the spell fizzles gracefully (consumed, nothing stolen).
    let empty: RunState = {
      ...createRun(1), embers: 0, board: [], shop: [],
      hand: [{ uid: 'sp', cardId: 'lasso', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    empty = reduce(empty, { type: 'play', uid: 'sp' });
    expect(empty.hand.some((c) => c.cardId === 'lasso')).toBe(false); // consumed, no crash
  });

  it('hero power can buff a tavern offer, and the buff is baked in when bought', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      heroReady: true,
      board: [],
      shop: [{ uid: 'x', cardId: 'alley' }], // Alleycat is a 1/1
    };
    s = reduce(s, { type: 'heroPower', uid: 'x' }); // Fortify a *tavern* minion
    expect([s.shop[0]?.atk, s.shop[0]?.hp]).toEqual([1, 1]);
    expect(s.heroReady).toBe(false);
    s = reduce(s, { type: 'buy', uid: 'x' });
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([2, 2]); // 1/1 + the Fortify buff
  });

  it('spells never triple (three copies stay separate)', () => {
    const spell = (uid: string) => ({ uid, cardId: 'spiritfire', tribe: 'neutral' as const, attack: 0, health: 1, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), embers: 3, hand: [spell('a'), spell('b'), spell('c')], shop: [{ uid: 'x', cardId: 'alley' }] };
    s = reduce(s, { type: 'buy', uid: 'x' }); // buying a minion runs checkTriples
    expect(s.hand.filter((c) => c.cardId === 'spiritfire').length).toBe(3); // not combined
    expect(s.hand.some((c) => c.cardId === 'spiritfire' && c.golden)).toBe(false);
  });

  it('spells cannot be sold', () => {
    const s: RunState = { ...createRun(1), embers: 0, hand: [{ uid: 'a', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    const after = reduce(s, { type: 'sell', uid: 'a' });
    expect(after.embers).toBe(0); // no +1
    expect(after.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // stays in hand
  });

  const threeSandbags = (): RunState => {
    const mk = (uid: string): BoardCard => ({
      uid, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false,
    });
    let s: RunState = { ...createRun(1), embers: 0, board: [], shop: [], hand: [mk('a'), mk('b'), mk('c')] };
    s = reduce(s, { type: 'play', uid: 'a' });
    s = reduce(s, { type: 'play', uid: 'b' });
    s = reduce(s, { type: 'play', uid: 'c' }); // the third completes the triple
    return s;
  };

  it('three copies combine into a golden 2x minion in hand — no Discover yet', () => {
    const s = threeSandbags();
    const golden = [...s.board, ...s.hand].find((c) => c.golden);
    expect(golden?.cardId).toBe('sandbag');
    expect(golden?.attack).toBe(0); // 0 × 2
    expect(golden?.health).toBe(8); // 4 × 2 (base stats doubled)
    expect([...s.board, ...s.hand].filter((c) => c.cardId === 'sandbag' && !c.golden).length).toBe(0);
    expect(s.discover).toBeUndefined(); // the Discover comes from the spell, not the triple
  });

  it('playing the golden grants a Discover spell; playing that spell opens the Discover', () => {
    let s = threeSandbags();
    const golden = s.hand.find((c) => c.golden)!;
    s = reduce(s, { type: 'play', uid: golden.uid }); // golden → board + Discover spell to hand
    const spell = s.hand.find((c) => c.cardId === 'discoverspell');
    expect(spell).toBeDefined();
    expect(s.discover).toBeUndefined(); // not until the spell is played
    s = reduce(s, { type: 'play', uid: spell!.uid });
    expect(s.discover?.length).toBe(3);
    expect(s.hand.some((c) => c.cardId === 'discoverspell')).toBe(false); // spell consumed, no board slot
  });

  it('Discover adds the chosen card to the hand and clears the offer', () => {
    let s: RunState = { ...createRun(1), hand: [], discover: ['frontdrake', 'cleric', 'weaver'] };
    s = reduce(s, { type: 'discover', index: 1 });
    expect(s.hand.some((c) => c.cardId === 'cleric')).toBe(true);
    expect(s.discover).toBeUndefined();
  });

  it('a golden minion bakes its Battlecry in at doubled magnitude', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'w', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: ['SC'], golden: false }],
      hand: [{ uid: 'gc', cardId: 'cleric', tribe: 'dragon', attack: 2, health: 6, keywords: [], golden: true }],
    };
    s = reduce(s, { type: 'play', uid: 'gc' }); // golden Hoard Cleric: Dragons +4/+6 (doubled)
    expect(s.board.find((c) => c.cardId === 'frontdrake')?.attack).toBe(6); // 2 + 4
    expect(s.board.find((c) => c.cardId === 'frontdrake')?.health).toBe(7); // 1 + 6
  });

  it('a run draws 5 distinct tribes and the shop only offers them (+ neutral)', () => {
    const s = createRun(7);
    expect(s.tribes.length).toBe(5);
    expect(new Set(s.tribes).size).toBe(5);
    const allowed = new Set<string>([...s.tribes, 'neutral']);
    for (const offer of s.shop) {
      expect(allowed.has(CARD_INDEX[offer.cardId]!.tribe)).toBe(true);
    }
  });

  it('selling adds embers even at the turn income (no max-embers cap)', () => {
    let s: RunState = {
      ...createRun(1), // embers 3 == maxEmbers 3 (start of turn)
      board: [{ uid: 'x', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
    };
    expect(s.embers).toBe(3);
    s = reduce(s, { type: 'sell', uid: 'x' });
    expect(s.embers).toBe(4); // +1, uncapped (previously capped at maxEmbers → bug)
  });

  it('Hoarder sells for a flat 2 Gold (golden 4)', () => {
    let s: RunState = {
      ...createRun(1), wave: 5, embers: 0,
      board: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'sell', uid: 'h' });
    expect(s.embers).toBe(2);
    let g: RunState = {
      ...createRun(1), wave: 5, embers: 0,
      board: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'sell', uid: 'h' });
    expect(g.embers).toBe(4); // golden sells for 4
  });

  it("Hoarder's Battlecry banks bonus Gold for next turn (golden 2×)", () => {
    let s: RunState = {
      ...createRun(1), embers: 0, board: [],
      hand: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(s.bonusEmbersNextTurn).toBe(1); // banked +1 for next turn
    let g: RunState = {
      ...createRun(1), embers: 0, board: [],
      hand: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'play', uid: 'h' });
    expect(g.bonusEmbersNextTurn).toBe(2); // golden banks 2
  });

  it('Robin banks +1 Gold for NEXT turn per minion sold (stacks; other heroes do not)', () => {
    let s: RunState = {
      ...createRun(1, 'robin'),
      board: [
        { uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'c', cardId: 'frontdrake', tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    for (const uid of ['a', 'b', 'c']) s = reduce(s, { type: 'sell', uid });
    expect(s.bonusEmbersNextTurn).toBe(3); // each sell banks +1 for next turn (consumed + reset at turn start, like Hoarder)
    // A non-Robin hero banks nothing from the same sells.
    let w: RunState = {
      ...createRun(1, 'warden'),
      board: [{ uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    w = reduce(w, { type: 'sell', uid: 'a' });
    expect(w.bonusEmbersNextTurn ?? 0).toBe(0);
  });

  it('Black Belt Brian Battlecry Discovers a spell — 3 spell ids offered', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 3, health: 5, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb' });
    expect(s.discover?.length).toBe(3);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.spell).toBe(true); // every offer is a spell
    expect(new Set(s.discover).size).toBe(3); // distinct
  });

  it('a golden Black Belt Brian Discovers TWICE — each pick re-opens a fresh spell Discover', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 6, health: 10, keywords: [], golden: true }],
    };
    s = reduce(s, { type: 'play', uid: 'bb' });
    expect(s.discover?.length).toBe(3); // the first Discover is open
    expect(s.discoverQueue).toEqual([{ kind: 'spell' }]); // a second spell Discover is queued
    s = reduce(s, { type: 'discover', index: 0 }); // pick the first spell
    expect(s.discover?.length).toBe(3); // the second Discover opened from the queue
    expect(s.discoverQueue).toEqual([]); // queue drained
    s = reduce(s, { type: 'discover', index: 0 }); // pick the second spell
    expect(s.discover).toBeUndefined(); // both done
    const handSpells = s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell);
    expect(handSpells.length).toBe(2); // two spells Discovered into the hand
  });

  it('Drakko the Drummer makes a played Black Belt Brian Discover 2 spells (sequential, via the queue)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 3, health: 5, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb' }); // Brian's Battlecry fires twice (Drakko) → 2 spell Discovers
    expect(s.discover?.length).toBe(3); // first Discover open
    expect(s.discoverQueue).toEqual([{ kind: 'spell' }]); // second Discover queued by the doubled Battlecry
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover?.length).toBe(3); // second Discover opened from the queue
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover).toBeUndefined(); // both resolved
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).length).toBe(2); // two spells in hand
  });

  it('a golden Black Belt Brian + Drakko the Drummer Discovers 4 spells', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 6, health: 10, keywords: [], golden: true }],
    };
    // Fires twice (Drakko); each fire queues 1 base + 1 golden spell Discover → 4 total (1 open, 3 queued).
    s = reduce(s, { type: 'play', uid: 'bb' });
    expect(s.discover?.length).toBe(3);
    expect(s.discoverQueue?.length).toBe(3);
    for (let i = 0; i < 4 && s.discover; i++) s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover).toBeUndefined();
    expect(s.discoverQueue).toEqual([]);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).length).toBe(4);
  });

  it('a Battlecry minion fires twice with a Drummer — observable via Soulfeeder queuing 2 Fodder', () => {
    // Soulfeeder's Battlecry queues 1 Fodder; with a Drakko the Drummer out it fires twice → 2 Fodder.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'play', uid: 'sf' });
    expect((s.pendingTavern ?? []).filter((id) => id === 'fred')).toHaveLength(2);
  });

  it('Yazzus does NOT multiply Help Wanted — Discover spells are untargeted (one Discover, nothing queued)', () => {
    const cast = (yazzGolden?: boolean): RunState => {
      const s: RunState = {
        ...createRun(1), embers: 0, shop: [], tier: 4,
        board: [{ uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: !!yazzGolden }],
        hand: [{ uid: 'hw', cardId: 'helpwanted', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      };
      return reduce(s, { type: 'play', uid: 'hw' });
    };
    for (const golden of [false, true]) {
      const s = cast(golden);
      expect(s.discover?.length).toBe(3); // a single Discover opens
      expect(s.discoverQueue ?? []).toEqual([]); // nothing queued — Yazzus only multiplies aimed spells
    }
  });

  it('Yazzus does NOT multiply Triple Reward — it opens only one Discover', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], tier: 3,
      board: [{ uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: true }],
      hand: [{ uid: 'tr', cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'tr' });
    expect(s.discover?.length).toBe(3); // a single Discover opens
    expect(s.discoverQueue ?? []).toEqual([]); // nothing queued — Triple Reward isn't a player-cast spell
  });

  it('a golden Hoarder (from a triple) sells for a flat 4 Gold', () => {
    let s: RunState = {
      ...createRun(1), wave: 1, embers: 0, shop: [],
      hand: [
        { uid: 'h1', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'h2', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'h3', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'h1' }); // playing the 3rd completes the triple → golden Hoarder
    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'hoarder' && c.golden)!;
    const after = reduce({ ...s, embers: 0 }, { type: 'sell', uid: golden.uid });
    expect(after.embers).toBe(4); // golden sells for a flat 4
  });

  it('Yazzus makes an aimed spell resolve twice (golden: three times)', () => {
    // Spirit Fire (+4/+4, targeted) with a Yazzus present resolves 2× → +8/+8 on the target.
    const board = (yazzGolden?: boolean): BoardCard[] => [
      { uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
      { uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: !!yazzGolden },
    ];
    const cast = (yazzGolden?: boolean): RunState => {
      let s: RunState = {
        ...createRun(1), embers: 0, shop: [], board: board(yazzGolden),
        hand: [{ uid: 'sf', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      };
      s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'm' });
      return s;
    };
    const two = cast(false).board.find((c) => c.uid === 'm')!;
    expect([two.attack, two.health]).toEqual([9, 9]); // 1/1 + (4/4 × 2)
    const three = cast(true).board.find((c) => c.uid === 'm')!;
    expect([three.attack, three.health]).toEqual([13, 13]); // 1/1 + (4/4 × 3)
    expect(cast(false).spellsCast).toBe(2); // the effect (and tally) repeats per Yazzus multiplier
  });

  it('Yazzus does NOT multiply an untargeted board spell (Growth resolves once)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: false },
      ],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([4, 5]); // 1/1 + 3/4 ONCE — Yazzus ignores untargeted spells
    expect(s.spellsCast).toBe(1);
  });

  it('without a Yazzus a spell resolves once', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([4, 5]); // 1/1 + 3/4 once
  });

  it('Toxin Tender is player-targeted: its Battlecry waits, then grants Venomous to the chosen minion', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [
        { uid: 'big', cardId: 'skullblade', tribe: 'undead', attack: 6, health: 6, keywords: [], golden: false },
        { uid: 'mid', cardId: 'spore', tribe: 'undead', attack: 4, health: 4, keywords: [], golden: false },
      ],
      shop: [{ uid: 'x', cardId: 'toxin' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    // Played to the board, but the Battlecry waits for a target — nothing has Venomous yet.
    expect(s.pendingTarget?.cardId).toBe('toxin');
    expect(s.board.some((c) => c.keywords.includes('V'))).toBe(false);
    // Pick 'mid', NOT the highest-attack 'big' — proving it's the player's choice, not an auto-carry.
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'mid' });
    expect(s.pendingTarget).toBeUndefined();
    expect(s.board.find((c) => c.uid === 'mid')?.keywords).toContain('V');
    expect(s.board.find((c) => c.uid === 'big')?.keywords).not.toContain('V');
  });

  it('an unresolved Toxin Tender target auto-resolves on the carry when the turn ends', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'big', cardId: 'skullblade', tribe: 'undead', attack: 6, health: 6, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'toxin' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.pendingTarget?.cardId).toBe('toxin');
    s = reduce(s, { type: 'faceOmen' }); // end the turn without picking → grant lands on the carry (the eligible Undead)
    expect(s.pendingTarget).toBeUndefined();
    expect(s.board.find((c) => c.uid === 'big')?.keywords).toContain('V');
  });


  it('tripling combines current stats (top two) and unions keywords', () => {
    const mk = (uid: string, attack: number, health: number, keywords: ('V' | 'T')[]): BoardCard => ({
      uid, cardId: 'sandbag', tribe: 'neutral', attack, health, keywords, golden: false,
    });
    // 1/1 Venomous · 2/3 · 1/3  →  3/6 Venomous
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [mk('a', 1, 1, ['V']), mk('b', 2, 3, []), mk('c', 1, 3, [])],
    };
    s = reduce(s, { type: 'play', uid: 'a' });
    s = reduce(s, { type: 'play', uid: 'b' });
    s = reduce(s, { type: 'play', uid: 'c' });
    const golden = [...s.board, ...s.hand].find((c) => c.golden)!;
    expect(golden.attack).toBe(3); // 2 + 1 (top two attacks)
    expect(golden.health).toBe(6); // 3 + 3 (top two healths)
    expect(golden.keywords).toContain('V'); // keyword retained across the combine
  });

  it('Drakko the Drummer makes a Battlecry fire twice', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'al' }); // Alleycat Battlecry: summon a Stray → fires twice
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(2);
  });

  it('a golden Drakko triples Battlecries', () => {
    // Hoard Cleric (+2/+3 to Dragons, incl. self) — avoids token triples. Golden Drakko fires it 3×.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: true }],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const cleric = s.board.find((c) => c.cardId === 'cleric');
    expect([cleric?.attack, cleric?.health]).toEqual([7, 12]); // 1/3 + 3×(+2/+3)
  });

  it('multiple Drakkos do NOT stack (still fires twice)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'd1', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
        { uid: 'd2', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'al' }); // two Drakkos → still 2x → 2 Strays
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(2);
  });

  it('Drakko hero quest: buying 5 Battlecry minions grants Drakko the Drummer (once per game)', () => {
    let s: RunState = { ...createRun(1, 'drakko'), embers: 99, board: [], hand: [], shop: [] };
    const buyBattlecry = (n: number): void => {
      const uid = `x${n}`;
      s = { ...s, shop: [{ uid, cardId: 'alley' }] }; // Alleycat has a Battlecry
      s = reduce(s, { type: 'buy', uid });
    };
    for (let i = 0; i < 4; i++) buyBattlecry(i);
    expect(s.drakkoBuys).toBe(4);
    expect(s.hand.some((c) => c.cardId === 'drummer')).toBe(false); // not yet
    expect(s.heroPowerSpent).toBe(false);
    buyBattlecry(4); // the 5th completes the quest
    expect(s.drakkoBuys).toBe(5);
    expect(s.hand.some((c) => c.cardId === 'drummer')).toBe(true); // Drakko the Drummer granted
    expect(s.heroPowerSpent).toBe(true); // quest done — stops counting
    // A non-Battlecry buy (Target Dummy) never advances the quest.
    let t: RunState = { ...createRun(1, 'drakko'), embers: 99, board: [], hand: [], shop: [{ uid: 'd', cardId: 'sandbag' }] };
    t = reduce(t, { type: 'buy', uid: 'd' });
    expect(t.drakkoBuys).toBe(0);
  });

  it('a full scripted run is deterministic end to end', () => {
    expect(serialize(playToEnd(999))).toEqual(serialize(playToEnd(999)));
  });

  it('a run reaches game over with a valid score', () => {
    const s = playToEnd(3);
    expect(s.phase).toBe('gameover');
    expect(s.best).toBeGreaterThanOrEqual(s.wave);
    expect(s.resolve).toBe(0);
  });

  it('save/load round-trips', () => {
    const s = createRun(5);
    expect(serialize(deserialize(serialize(s)))).toEqual(serialize(s));
  });

  it('addBuff accumulates per source with a count, and ignores keyword-only (0/0) grants', () => {
    const card: BoardCard = { uid: 'x', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false };
    addBuff(card, 'Spirit Fire', 3, 3);
    addBuff(card, 'Spirit Fire', 3, 3);
    addBuff(card, 'Karwind', 1, 2);
    addBuff(card, 'Toxin Tender', 0, 0); // keyword-only → not listed as a stat buff
    expect([card.attack, card.health]).toEqual([2 + 6 + 1, 1 + 6 + 2]);
    expect(card.buffs).toEqual([
      { source: 'Spirit Fire', attack: 6, health: 6, count: 2 },
      { source: 'Karwind', attack: 1, health: 2, count: 1 },
    ]);
  });

  it('Hunter procs from a recruit Attack-gain (Warden Fortify) → +Health to the board', () => {
    let s: RunState = {
      ...createRun(1), tier: 3, heroReady: true,
      board: [
        { uid: 'h', cardId: 'hunter', tribe: 'dragon', attack: 5, health: 7, keywords: [], golden: false },
        { uid: 'a', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'heroPower', uid: 'h' }); // Fortify +3/+3 → Hunter gains Attack → +2 Health to the board
    const hunter = s.board.find((c) => c.uid === 'h')!;
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect(hunter.attack).toBe(5 + 3); // Fortify +3 Attack (tier 3)
    expect(ally.health).toBe(3 + 2); // Hunter's onGainAttack → +2 Health
    expect(hunter.health).toBe(7 + 3 + 2); // Fortify +3 Health + Hunter's own +2 (it buffs the whole board incl. itself)
  });

  it('Hunter procs from ANY shop Attack gain — a Growth spell, not just Fortify (boundary dispatch)', () => {
    let s: RunState = {
      ...createRun(1), embers: 10, shop: [],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'h', cardId: 'hunter', tribe: 'dragon', attack: 5, health: 7, keywords: [], golden: false },
        { uid: 'a', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'g' }); // Growth: +3/+4 to the board → Hunter gains Attack → +2 Health to all
    const hunter = s.board.find((c) => c.uid === 'h')!;
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect(hunter.attack).toBe(5 + 3); // Growth +3 Attack
    expect(ally.health).toBe(3 + 4 + 2); // Growth +4 + Hunter's onGainAttack +2
    expect(hunter.health).toBe(7 + 4 + 2); // Growth +4 + Hunter's own +2
  });

  it('a shop action with no board Attack gain does NOT proc Hunter (Mend heals the hero)', () => {
    let s: RunState = {
      ...createRun(1), embers: 10, shop: [], resolve: 1,
      // Mend heals the hero — it raises no board minion's Attack, so Hunter's reactor must stay silent.
      hand: [{ uid: 'm', cardId: 'mend', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'h', cardId: 'hunter', tribe: 'dragon', attack: 5, health: 7, keywords: [], golden: false },
        { uid: 'a', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'm' });
    const hunter = s.board.find((c) => c.uid === 'h')!;
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect(ally.health).toBe(3); // no Attack gain anywhere → Hunter added nothing
    expect(hunter.health).toBe(7); // unchanged
  });

  it('hero Fortify records its source on the buffed minion (inspect breakdown)', () => {
    let s: RunState = {
      ...createRun(7),
      heroReady: true,
      board: [{ uid: 'd', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'd' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([3, 2]);
    expect(s.board[0]!.buffs).toEqual([{ source: 'Fortify', attack: 1, health: 1, count: 1 }]);
  });

  it('Karwind flame-flags the Dragons its battlecry-trigger buffs', () => {
    let s: RunState = {
      ...createRun(7),
      embers: 99,
      board: [
        { uid: 'k', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false },
        { uid: 'd', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'p', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'p' }); // Hoard Cleric's Battlecry → triggers Karwind
    expect(s.karwindFlash).toContain('d');
    expect(s.karwindFlash).toContain('k');
    const dragon = s.board.find((c) => c.uid === 'd')!;
    expect(dragon.buffs?.some((b) => b.source === 'Karwind')).toBe(true);
  });

  it('a triple merges the buff breakdown onto the golden (so it itemizes in inspect)', () => {
    const buffed = (uid: string): BoardCard => {
      const c: BoardCard = { uid, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false };
      addBuff(c, 'Spirit Fire', 3, 3); // each copy +3/+3 before combining
      return c;
    };
    let s: RunState = { ...createRun(1), board: [], hand: [buffed('a'), buffed('b'), buffed('c')] };
    s = reduce(s, { type: 'play', uid: 'a' }); // 3rd copy lands → triple combines
    const golden = [...s.board, ...s.hand].find((c) => c.golden);
    expect(golden).toBeDefined();
    expect([golden!.attack, golden!.health]).toEqual([6, 14]); // base 0/4 ×2 = 0/8, + merged +6/+6
    expect(golden!.buffs).toEqual([{ source: 'Spirit Fire', attack: 6, health: 6, count: 2 }]);
  });

  it('createRun stocks the finite pool with the per-tier quantities', () => {
    const s = createRun(11);
    // Some copies of a T1 neutral may already sit in the opening shop, so pool-remaining + offered = stock.
    const inShop = s.shop.filter((o) => o.cardId === 'sandbag').length;
    expect((s.pool['sandbag'] ?? 0) + inShop).toBe(POOL_QUANTITIES[1]);
    expect(CONFIG.maxTier).toBe(6);
  });

  it('Discover (Triple Reward) only offers cards with copies left — respects the finite pool', () => {
    // Exhaust the pool to a single eligible card; a Discover then can't offer any 0-copy card — the bug
    // that let you exceed a card's stock (e.g. an 8th Grim from a 6-copy pool).
    let s: RunState = { ...createRun(1), tier: 6 };
    const keep = Object.keys(s.pool).find((id) => (CARD_INDEX[id]?.tier ?? 0) >= 5) ?? Object.keys(s.pool)[0]!;
    for (const id of Object.keys(s.pool)) s.pool[id] = id === keep ? 5 : 0;
    s.hand = [{ uid: 'd', cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }];
    s = reduce(s, { type: 'play', uid: 'd' });
    expect(s.discover).toBeDefined();
    for (const id of s.discover!) expect(s.pool[id]).toBeGreaterThan(0); // never an exhausted (0-copy) card
  });

  it('the finite pool conserves copies across buy / reroll / sell', () => {
    // Total pooled copies = remaining pool + pooled cards held in shop / hand / board (golden = 3).
    // Buying, rerolling and selling only move copies between those buckets — the total is invariant.
    const poolTotal = (s: RunState): number => {
      const owned = (c: BoardCard): number => (c.cardId in s.pool ? (c.golden ? 3 : 1) : 0);
      let total = Object.values(s.pool).reduce((a, b) => a + b, 0);
      for (const o of s.shop) if (o.cardId in s.pool) total += 1;
      for (const c of s.hand) total += owned(c);
      for (const c of s.board) total += owned(c);
      return total;
    };
    let s = createRun(7);
    const initial = poolTotal(s);
    if (s.shop[0]) s = reduce({ ...s, embers: 50 }, { type: 'buy', uid: s.shop[0].uid });
    expect(poolTotal(s)).toBe(initial); // buy: shop → hand
    for (let i = 0; i < 6; i++) s = reduce({ ...s, embers: 50 }, { type: 'roll' });
    expect(poolTotal(s)).toBe(initial); // reroll: discarded offers return, fresh ones drawn
    if (s.hand[0]) s = reduce(s, { type: 'sell', uid: s.hand[0].uid });
    expect(poolTotal(s)).toBe(initial); // sell: held copy → pool
  });

  it('selling a minion returns its copy to the shared pool (a golden returns three)', () => {
    let s: RunState = {
      ...createRun(3),
      board: [{ uid: 'x', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
    };
    const before = s.pool['sandbag'] ?? 0;
    s = reduce(s, { type: 'sell', uid: 'x' });
    expect(s.pool['sandbag']).toBe(before + 1);

    let g: RunState = {
      ...createRun(3),
      board: [{ uid: 'g', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 8, keywords: ['T'], golden: true }],
    };
    const gBefore = g.pool['sandbag'] ?? 0;
    g = reduce(g, { type: 'sell', uid: 'g' });
    expect(g.pool['sandbag']).toBe(gBefore + 3);
  });

  it('a card with no copies left is never offered; a fully exhausted pool offers nothing', () => {
    let s = createRun(5);
    // Drain every pooled card to 0 except the neutral Target Dummy (always T1-eligible).
    const drained: Record<string, number> = {};
    for (const id of Object.keys(s.pool)) drained[id] = id === 'sandbag' ? 5 : 0;
    s = { ...s, pool: drained, shop: [], tier: 1 };
    for (let r = 0; r < 8; r++) {
      s = reduce({ ...s, embers: 50 }, { type: 'roll' });
      expect(s.shop.length).toBeGreaterThan(0);
      for (const offer of s.shop) expect(offer.cardId).toBe('sandbag'); // only the stocked card appears
    }
    const empty: Record<string, number> = {};
    for (const id of Object.keys(s.pool)) empty[id] = 0;
    s = reduce({ ...s, pool: empty, shop: [], embers: 50 }, { type: 'roll' });
    expect(s.shop.length).toBe(0); // nothing left → no offers conjured from an empty pool
  });

  it('faceOmen computes deterministic outcome odds (win/draw/lose sum to 1)', () => {
    const setup = (): RunState => ({
      ...createRun(42),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'a', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 2, health: 4, keywords: ['C'], golden: false },
      ],
    });
    const odds = reduce(setup(), { type: 'faceOmen' }).lastCombat!.odds!;
    expect(odds).toBeDefined();
    expect(odds.win + odds.draw + odds.lose).toBeCloseTo(1, 6);
    expect(odds.win).toBeGreaterThanOrEqual(0);
    expect(odds.lose).toBeGreaterThanOrEqual(0);
    // Deterministic: the same seed + wave re-derives identical odds (own RNG stream).
    expect(reduce(setup(), { type: 'faceOmen' }).lastCombat!.odds).toEqual(odds);
  });
});

describe('hero powers (@game/sim)', () => {
  const mk = (uid: string, attack: number, health: number): BoardCard => ({
    uid, cardId: 'sandbag', tribe: 'neutral', attack, health, keywords: [], golden: false,
  });

  it('createRun defaults to the Warden and accepts a chosen hero', () => {
    expect(createRun(1).heroId).toBe('warden');
    expect(createRun(1, 'indy').heroId).toBe('indy');
    expect(createRun(1).heroPowerSpent).toBe(false);
  });

  it("Warden's Fortify scales with Tavern Tier (+Tier/+Tier) and spends the wave charge", () => {
    let s: RunState = { ...createRun(1), tier: 3, heroReady: true, board: [mk('a', 2, 2)] };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.board[0]!.attack).toBe(5); // 2 + tier(3)
    expect(s.board[0]!.health).toBe(5);
    expect(s.board[0]!.buffs).toEqual([{ source: 'Fortify', attack: 3, health: 3, count: 1 }]);
    expect(s.heroReady).toBe(false);
    // Second use this wave is rejected (charge spent).
    expect(reduce(s, { type: 'heroPower', uid: 'a' })).toBe(s);
  });

  it("Warden's Fortify on a tavern offer carries +Tier (baked in when bought)", () => {
    let s: RunState = { ...createRun(1), tier: 2, heroReady: true };
    const offerUid = s.shop[0]!.uid;
    s = reduce(s, { type: 'heroPower', uid: offerUid });
    const offer = s.shop.find((c) => c.uid === offerUid)!;
    expect(offer.atk).toBe(2);
    expect(offer.hp).toBe(2);
  });

  it("Indy's Gild doubles a minion's stats, turns it golden, and is once per game", () => {
    let s: RunState = { ...createRun(1, 'indy'), board: [mk('a', 3, 4), mk('b', 2, 2)] };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.board[0]!.golden).toBe(true);
    expect(s.board[0]!.attack).toBe(6); // doubled
    expect(s.board[0]!.health).toBe(8);
    expect(s.board[0]!.buffs).toEqual([{ source: 'Gild', attack: 3, health: 4, count: 1 }]);
    expect(s.heroPowerSpent).toBe(true);
    // Once per *game*: recharging the per-wave flag must not re-enable it.
    s = { ...s, heroReady: true };
    expect(reduce(s, { type: 'heroPower', uid: 'b' })).toBe(s);
  });

  it("Indy's Gild no-ops (no charge spent) on an already-golden minion", () => {
    const s: RunState = { ...createRun(1, 'indy'), board: [{ ...mk('a', 3, 4), golden: true }] };
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s); // rejected → same reference
    expect(after.heroPowerSpent).toBe(false); // charge preserved for a real target
  });

  it("Myra's Pulse re-fires a friendly minion's Battlecry, once per turn (from turn 3)", () => {
    // Hoard Cleric's Battlecry buffs all your Dragons +2/+3 (includes itself).
    const cleric = (): BoardCard => ({
      uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false,
    });
    let s: RunState = { ...createRun(1, 'myra'), wave: 3, board: [cleric()] }; // Pulse unlocks turn 3
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    expect(s.board[0]!.attack).toBe(3); // 1 + 2
    expect(s.board[0]!.health).toBe(6); // 3 + 3
    expect(s.board[0]!.buffs).toEqual([{ source: 'Hoard Cleric', attack: 2, health: 3, count: 1 }]);
    expect(s.heroReady).toBe(false);
    // Once per turn: a second use this wave is rejected.
    expect(reduce(s, { type: 'heroPower', uid: 'c' })).toBe(s);
  });

  it("Myra's Pulse auto-targets a targeted Battlecry (Toxin Tender → best friend gets Venomous)", () => {
    const s: RunState = {
      ...createRun(1, 'myra'),
      wave: 3,
      board: [
        { uid: 't', cardId: 'toxin', tribe: 'undead', attack: 1, health: 3, keywords: [], golden: false },
        { uid: 'f', cardId: 'skullblade', tribe: 'undead', attack: 5, health: 5, keywords: [], golden: false }, // highest-attack Undead friend → auto-picked
      ],
    };
    const after = reduce(s, { type: 'heroPower', uid: 't' });
    expect(after.board.find((c) => c.uid === 'f')!.keywords).toContain('V');
    expect(after.heroReady).toBe(false);
  });

  it("Myra's Pulse no-ops (no charge spent) on a minion with no Battlecry", () => {
    const s: RunState = { ...createRun(1, 'myra'), wave: 3, board: [mk('a', 2, 2)] }; // sandbag = vanilla
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s); // rejected → same reference
    expect(after.heroReady).toBe(true); // charge preserved
  });

  it("Myra's Pulse is locked until turn 3", () => {
    const cleric = (): BoardCard => ({
      uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false,
    });
    // Turn 1: locked — the power is rejected (no charge spent, no Battlecry replay).
    const w1: RunState = { ...createRun(1, 'myra'), wave: 1, board: [cleric()] };
    expect(reduce(w1, { type: 'heroPower', uid: 'c' })).toBe(w1);
    // Turn 3: unlocked — the Battlecry re-fires (+2/+3).
    let w3: RunState = { ...createRun(1, 'myra'), wave: 3, board: [cleric()] };
    w3 = reduce(w3, { type: 'heroPower', uid: 'c' });
    expect(w3.board[0]!.attack).toBe(3);
    expect(w3.heroReady).toBe(false);
  });

  it("Myra's Pulse can complete a triple — a replayed Battlecry's summon golden-combines", () => {
    // Two Strays already down; replaying Alleycat's Battlecry summons the third → triple → a golden
    // Stray lands in the hand. Regression: hero powers used to skip the triple check entirely, so a
    // power-summoned third copy never combined.
    const s: RunState = {
      ...createRun(1, 'myra'),
      wave: 3,
      board: [
        { uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 's1', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 's2', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    // The three Strays combined → none left loose on the board…
    expect(after.board.filter((c) => c.cardId === 'stray' && !c.golden).length).toBe(0);
    // …and a golden Stray (2/2 = top-two of three 1/1s) is now in the hand.
    const golden = after.hand.find((c) => c.cardId === 'stray' && c.golden);
    expect(golden).toBeDefined();
    expect([golden!.attack, golden!.health]).toEqual([2, 2]);
    expect(after.heroReady).toBe(false); // charge spent
  });

  it("createRun seeds the run with the hero's Resolve (HP)", () => {
    for (const id of ['warden', 'indy', 'myra']) {
      const s = createRun(1, id);
      expect(s.resolve).toBe(getHero(id).resolve);
      expect(s.maxResolve).toBe(getHero(id).resolve);
    }
  });

  it("Djinn's Cadence procs a friendly minion's End of Turn now (once per turn)", () => {
    // Ritualist's End of Turn buffs every Fodder +2/+2; Fred is Fodder.
    const board = (): BoardCard[] => [
      { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false },
      { uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false },
    ];
    let s: RunState = { ...createRun(1, 'djinn'), board: board() };
    s = reduce(s, { type: 'heroPower', uid: 'r' });
    const fred = s.board.find((c) => c.uid === 'f')!;
    expect(fred.attack).toBe(3); // 1 + 2
    expect(fred.health).toBe(3);
    expect(s.heroReady).toBe(false);
    expect(reduce(s, { type: 'heroPower', uid: 'r' })).toBe(s); // once per turn
  });

  it("Djinn's Cadence no-ops (no charge) on a minion with no End of Turn effect", () => {
    const s: RunState = { ...createRun(1, 'djinn'), board: [mk('a', 2, 2)] }; // sandbag = vanilla
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s);
    expect(after.heroReady).toBe(true);
  });

  it("Djinn proccing Frontdrake pays off on the proc turn WITHOUT advancing its cadence", () => {
    // eotTick 2 = one shy of every:3, so THIS turn's End of Turn would proc. Djinn fires it now: it conjures
    // a Dragon but must NOT advance the counter (it stays 2, so the natural End of Turn still procs too).
    const f: BoardCard = { uid: 'f', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 2 };
    let s: RunState = {
      ...createRun(1, 'djinn'), tier: 6, hand: [], board: [f],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
    };
    s = reduce(s, { type: 'heroPower', uid: 'f' });
    expect(s.hand.map((c) => c.cardId)).toEqual(['cleric']); // granted on the proc turn
    expect(s.board.find((c) => c.uid === 'f')!.eotTick).toBe(2); // cadence NOT advanced by the Djinn replay
  });

  it("Djinn proccing Frontdrake off its proc turn grants nothing (and still doesn't advance the cadence)", () => {
    // eotTick 1 → not the proc turn. The replay grants no Dragon and leaves the counter at 1.
    const f: BoardCard = { uid: 'f', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 1 };
    let s: RunState = {
      ...createRun(1, 'djinn'), tier: 6, hand: [], board: [f],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
    };
    s = reduce(s, { type: 'heroPower', uid: 'f' });
    expect(s.hand.length).toBe(0); // off-cadence → no Dragon
    expect(s.board.find((c) => c.uid === 'f')!.eotTick).toBe(1); // unchanged
  });

  it('Rohan amplifies stat-granting spells (+1 at turn 1, scaling), hero-gated', () => {
    const cast = (heroId: string, wave: number): BoardCard => {
      let s: RunState = {
        ...createRun(1, heroId), wave, board: [mk('t', 2, 2)],
        hand: [{ uid: 'sf', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }],
      };
      s = reduce(s, { type: 'play', uid: 'sf', targetUid: 't' });
      return s.board[0]!;
    };
    // Spirit Fire = +4/+4. Rohan adds +1 at turn 1 → +5/+5 (2/2 → 7/7).
    expect(cast('rohan', 1).attack).toBe(7);
    // Scales: +2 at turn 4 → +6/+6 (→ 8/8).
    expect(cast('rohan', 4).attack).toBe(8);
    // Hero-gated: a non-Rohan gets the base +4/+4 (→ 6/6).
    expect(cast('warden', 1).attack).toBe(6);
  });

  it('Soren marks one minion for resummon (clearing any previous mark)', () => {
    let s: RunState = { ...createRun(1, 'soren'), board: [mk('a', 2, 2), mk('b', 3, 3)] };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.board.find((c) => c.uid === 'a')!.resummon).toBe(true);
    expect(s.board.find((c) => c.uid === 'b')!.resummon ?? false).toBe(false);
    expect(s.heroReady).toBe(false);
  });

  it("Soren's mark carries into combat (marked minion destroyed + resummoned)", () => {
    // Pack Scrounger marked → at start of combat it dies (Deathrattle → 2 Pups) and a copy returns.
    let s: RunState = {
      ...createRun(1, 'soren'),
      board: [{ uid: 'p', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'p' });
    s = reduce(s, { type: 'faceOmen' });
    const ev = s.lastCombat!.events;
    expect(ev.some((e) => e.type === 'summon' && e.minion.cardId === 'pup')).toBe(true); // Deathrattle fired
    expect(ev.some((e) => e.type === 'summon' && e.minion.cardId === 'pack')).toBe(true); // copy resummoned
  });

  it("Nadja's Mana Font raises max Mana by 1 (uncapped), spending the once-per-turn charge", () => {
    let s: RunState = { ...createRun(1, 'nadja'), maxEmbers: 4, heroReady: true };
    s = reduce(s, { type: 'heroPower', uid: 'x' }); // untargeted — uid is ignored
    expect(s.maxEmbers).toBe(5); // +1 permanent
    expect(s.heroReady).toBe(false); // charge spent (not once-per-game)
    // A second use this turn is rejected (charge spent).
    expect(reduce(s, { type: 'heroPower', uid: 'x' })).toBe(s);
    // Scales PAST the Mana cap — Nadja's Mana Font is uncapped.
    let capped: RunState = { ...createRun(1, 'nadja'), maxEmbers: CONFIG.embersCap, heroReady: true };
    capped = reduce(capped, { type: 'heroPower', uid: 'x' });
    expect(capped.maxEmbers).toBe(CONFIG.embersCap + 1); // no cap — exceeds the normal ceiling
  });

  it("Cassen's Collision banks enemy kills and grants a top-type minion at 5 (neutral isn't a type)", () => {
    // A Beast-dominant board → the grant is a Beast of your tavern tier. Neutral is NOT counted as a type.
    const beast = (uid: string): BoardCard => ({
      uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false,
    });
    // 3 banked + 2 this combat = 5 → one grant, kills back to 0.
    let s: RunState = {
      ...createRun(1, 'cassen'),
      phase: 'combat',
      cassenKills: 3,
      board: [beast('a'), beast('b')],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 2, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.cassenKills).toBe(0); // 5 spent on the grant
    expect(s.hand.length).toBe(1); // a minion was conjured to the hand
    const granted = CARD_INDEX[s.hand[0]!.cardId]!;
    expect([granted.tribe, granted.tribe2]).toContain('beast'); // of the board's most common (non-neutral) tribe
    expect(granted.tier).toBeLessThanOrEqual(s.tier); // bound by your tavern tier

    // Under 5 → no grant, kills simply bank.
    let t: RunState = {
      ...createRun(1, 'cassen'),
      phase: 'combat',
      cassenKills: 0,
      board: [beast('a')],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 3, initial: { player: [], enemy: [] } },
    };
    t = reduce(t, { type: 'resolveCombat' });
    expect(t.cassenKills).toBe(3); // banked, not spent
    expect(t.hand.length).toBe(0); // nothing granted yet
  });

  it("Cassen's Collision does nothing for other heroes", () => {
    let s: RunState = {
      ...createRun(1, 'warden'), // not Cassen
      phase: 'combat',
      cassenKills: 0,
      board: [{ uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 9, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.cassenKills).toBe(0); // never accrues for a non-Collision hero
    expect(s.hand.length).toBe(0);
  });
});

describe('PvE win condition (@game/sim)', () => {
  // The run is won by WINNING `winsToWin` combats — not by reaching a wave cap. Drive a settled combat
  // of a known result without simulating: craft lastCombat + dispatch resolveCombat (which settles +
  // runs the terminal check). High Resolve so a loss survives and the run keeps climbing.
  const winShell: CombatResult = { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
  const loseShell: CombatResult = { ...winShell, result: 'lose', playerDamage: 3 };
  const resolveWith = (over: Partial<RunState>, last: CombatResult): RunState =>
    reduce({ ...createRun(1), resolve: 100, maxResolve: 100, phase: 'combat', combatSettled: false, lastCombat: last, ...over }, { type: 'resolveCombat' });

  it('victory triggers on the Nth WON combat, decoupled from the wave', () => {
    // 14 prior wins banked; the 15th win ends the run in victory — even at an early wave.
    const s = resolveWith({ wave: 6, history: Array(CONFIG.winsToWin - 1).fill('win') }, winShell);
    expect(s.phase).toBe('victory');
  });

  it('does NOT win the run by merely reaching the wave horizon with fewer wins (the bug)', () => {
    // At the wave horizon with only a few wins: a loss here survives (Resolve > 0) and the climb
    // continues PAST the horizon — it is NOT a wave-cap victory.
    const s = resolveWith({ wave: CONFIG.maxWave, history: ['win', 'lose', 'win'] }, loseShell);
    expect(s.phase).toBe('recruit');
    expect(s.wave).toBe(CONFIG.maxWave + 1); // climbs past the horizon, no auto-win
  });

  it('the 14th win advances to the next wave, not yet victory', () => {
    const s = resolveWith({ wave: 14, history: Array(CONFIG.winsToWin - 2).fill('win') }, winShell);
    expect(s.phase).toBe('recruit');
  });

  it('losing with Resolve to 0 is a game over, regardless of wins so far', () => {
    const s = resolveWith({ wave: 8, resolve: 1, maxResolve: 1, history: Array(5).fill('win') }, { ...loseShell, playerDamage: 5 });
    expect(s.phase).toBe('gameover');
  });
});

describe('spell stat bonus + display (@game/sim)', () => {
  it('spellStatBonus aggregates active sources (Rohan scales; others = 0)', () => {
    expect(spellStatBonus(createRun(1, 'warden'))).toBe(0);
    expect(spellStatBonus({ ...createRun(1, 'rohan'), wave: 1 })).toBe(1);
    expect(spellStatBonus({ ...createRun(1, 'rohan'), wave: 4 })).toBe(2);
  });

  it('spellDisplayText substitutes the effective value (green via {{…}}); base text otherwise', () => {
    // No bonus → unchanged base text.
    expect(spellDisplayText('spiritfire', 0)).toBe('Give a friendly minion **+4/+4**.');
    // +1 bonus → the value updates and is highlighted.
    expect(spellDisplayText('spiritfire', 1)).toBe('Give a friendly minion **{{+5/+5}}**.');
    expect(spellDisplayText('bulwark', 1)).toBe('Give a friendly minion **{{+1/+2}}** and **Taunt**.');
    // A non-stat spell (Gold Pouch) is untouched even with a bonus.
    expect(spellDisplayText('emberpouch', 2)).toBe('Gain **1 Gold**.');
  });

  it('Harry Botter is a passive spell-power aura (+1/+1 to spells while on board; golden +2/+2)', () => {
    expect(spellStatBonus({ ...createRun(1), board: [] })).toBe(0);
    const one: RunState = {
      ...createRun(1),
      board: [{ uid: 'h', cardId: 'harrybotter', tribe: 'mech', attack: 1, health: 5, keywords: [], golden: false }],
    };
    expect(spellStatBonus(one)).toBe(1);
    expect(spellAttackBonus(one)).toBe(1);
    expect(spellHealthBonus(one)).toBe(1);
    const golden: RunState = {
      ...createRun(1),
      board: [{ uid: 'h', cardId: 'harrybotter', tribe: 'mech', attack: 2, health: 10, keywords: [], golden: true }],
    };
    expect(spellStatBonus(golden)).toBe(2); // golden Harry Botter → +2/+2
  });

  it('the displayed value matches what a cast actually grants (Rohan, turn 1)', () => {
    const s = { ...createRun(1, 'rohan'), wave: 1 };
    const bonus = spellStatBonus(s);
    // Spirit Fire's base is +4/+4; with Rohan's turn-1 bonus the card shows +5/+5 and a cast grants +5/+5.
    expect(spellDisplayText('spiritfire', bonus)).toContain('+5/+5');
    let r: RunState = {
      ...s, board: [{ uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'sf', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }],
    };
    r = reduce(r, { type: 'play', uid: 'sf', targetUid: 't' });
    expect(r.board[0]!.attack).toBe(7); // 2 + (4 base + 1 Rohan bonus)
    expect(r.board[0]!.health).toBe(7);
  });
});

describe('Spirit Pup → Spirit Worgen (@game/sim)', () => {
  const pouch = (i: number): BoardCard =>
    ({ uid: `s${i}`, cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
  const pup = (): BoardCard =>
    ({ uid: 'p', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false });
  const worgen = (): BoardCard =>
    ({ uid: 'w', cardId: 'spiritworgen', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false });
  const whelp = (uid: string): BoardCard =>
    ({ uid, cardId: 'frontdrake', tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false });
  const worgenAtk = (s: RunState): number => s.board.find((c) => c.uid === 'w')!.attack;

  it('the Pup transforms after 10 spells on board, keeping its stats (no buff on transform)', () => {
    let s: RunState = { ...createRun(1), board: [pup()], hand: Array.from({ length: 10 }, (_, i) => pouch(i)) };
    for (let i = 0; i < 9; i++) s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board[0]!.cardId).toBe('spiritpup'); // 9 spells — not yet
    expect(s.board[0]!.spellProgress).toBe(9);
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // 10th
    expect(s.board[0]!.cardId).toBe('spiritworgen'); // transformed, stats kept (no retroactive buff)
    expect(s.board[0]!.attack).toBe(4);
    expect(s.board[0]!.health).toBe(6);
  });

  it('tripling Spirit Pups keeps the highest spell progress (lowest spells-left)', () => {
    // Three Pups at 8 / 2 / 5 progress → the golden inherits 8 (just 2 spells from evolving).
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'p1', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false, spellProgress: 8 },
        { uid: 'p2', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false, spellProgress: 2 },
      ],
      hand: [
        { uid: 'p3', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false, spellProgress: 5 },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'p3' }); // 3rd Pup → triple → golden in hand
    const golden = s.hand.find((c) => c.cardId === 'spiritpup' && c.golden);
    expect(golden).toBeDefined();
    expect(golden!.spellProgress).toBe(8); // max(8, 2, 5) — keeps the closest-to-evolving
    expect(s.triplesMade).toBe(1); // run-wide triples tally bumped by the merge
  });

  it("the Worgen's per-summon gain scales with spells cast this turn (X = 1 + spellsThisTurn)", () => {
    // No spells this turn → +1/+1 per Beast/Dragon.
    let s: RunState = { ...createRun(1), board: [worgen()], hand: [whelp('d')] };
    s = reduce(s, { type: 'play', uid: 'd' });
    expect(worgenAtk(s)).toBe(5); // 4 + 1

    // 4 spells this turn → +5/+5 per Beast/Dragon.
    let s2: RunState = { ...createRun(1), board: [worgen()], hand: [...Array.from({ length: 4 }, (_, i) => pouch(i)), whelp('d')] };
    for (let i = 0; i < 4; i++) s2 = reduce(s2, { type: 'play', uid: s2.hand[0]!.uid });
    s2 = reduce(s2, { type: 'play', uid: 'd' });
    expect(worgenAtk(s2)).toBe(4 + 5); // 4 + (1 + 4)
  });

  it('an Alleycat (it + its Stray, both Beasts) buffs the Worgen twice', () => {
    // 4 spells → X = 5; Alleycat + its 1 Stray = 2 Beast summons → +10/+10 total.
    let s: RunState = {
      ...createRun(1), board: [worgen()],
      hand: [...Array.from({ length: 4 }, (_, i) => pouch(i)),
        { uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    for (let i = 0; i < 4; i++) s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'play', uid: 'a' });
    expect(worgenAtk(s)).toBe(4 + 10);
  });

  it('the Worgen ignores a summoned neutral', () => {
    let s: RunState = {
      ...createRun(1), board: [worgen()],
      hand: [{ uid: 'x', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'x' });
    expect(worgenAtk(s)).toBe(4); // unchanged
  });

  it('spellsThisTurn resets each wave', () => {
    let s: RunState = { ...createRun(1), resolve: 100, maxResolve: 100, hand: [pouch(0), pouch(1)] };
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.spellsThisTurn).toBe(2);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.spellsThisTurn).toBe(0); // reset on advance to the next wave
  });

  it("the Worgen's in-combat gains are temporary (run board unchanged next shop)", () => {
    // Pack Scrounger's combat Deathrattle summons Beast Pups → the Worgen procs in combat, but combat
    // is a sim, so the run-board Worgen returns to its stats next shop.
    let s: RunState = {
      ...createRun(1), wave: 15, resolve: 100, maxResolve: 100, spellsThisTurn: 4, // tanky wave → the Pack dies + summons
      board: [
        { uid: 'w', cardId: 'spiritworgen', tribe: 'beast', attack: 4, health: 50, keywords: [], golden: false },
        { uid: 'pk', cardId: 'pack', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.lastCombat!.events.some((e) => e.type === 'buff' && e.source === 'Spirit Worgen')).toBe(true); // procced in combat
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 'w')!.attack).toBe(4); // …but the run board is unchanged
  });

  it("a Taurus-engraved neighbor's combat gains carry back to the run board (settleCombat)", () => {
    // The carry-back the task flags: a minion whose run-board card has NO 'EG' keyword (Taurus granted EG
    // only on its combat clone) must still keep its gains, labelled "Engraved". settleCombat applies
    // playerPermaBuffs by the entry's own `engraved` flag — never re-checking the run-board card's keywords.
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [
        { uid: 'n', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }, // no EG
      ],
      lastCombat: {
        events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
        initial: { player: [], enemy: [] },
        playerPermaBuffs: [{ sourceUid: 'n', attack: 5, health: 5, engraved: true }],
      },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const card = s.board.find((c) => c.uid === 'n')!;
    expect([card.attack, card.health]).toEqual([6, 6]); // base 1/1 + the carried-back +5/+5
    expect(card.buffs?.some((b) => b.source === 'Engraved' && b.attack === 5 && b.health === 5)).toBe(true);
  });

  it('Flowing Monk gift (engraved: false) still labels the carry-back "Flowing Monk"', () => {
    // Regression guard: a non-EG carrier that received Flowing Monk's overflow gift carries back labelled
    // "Flowing Monk", exactly as before the refactor (the `engraved` flag steers only the label).
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [{ uid: 'm', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      lastCombat: {
        events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
        initial: { player: [], enemy: [] },
        playerPermaBuffs: [{ sourceUid: 'm', attack: 3, health: 3, engraved: false }],
      },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const card = s.board.find((c) => c.uid === 'm')!;
    expect(card.buffs?.some((b) => b.source === 'Flowing Monk' && b.attack === 3)).toBe(true);
  });

  it('Bane: each Battlecry you trigger gives Fodder +2/+2 run-wide (+4/+4 golden)', () => {
    // Bane subscribes to `battlecryTriggered` (Karwind's hook). Playing Soulfeeder (a Battlecry) fires once
    // → Bane enchants the Fodder card type +2/+2. A golden Bane does +4/+4.
    const setup = (golden: boolean): RunState => ({
      ...createRun(1), embers: 0, shop: [], pendingTavern: [],
      board: [{ uid: 'b', cardId: 'bane', tribe: 'dragon', attack: 12, health: 12, keywords: [], golden }],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
    });
    const s = reduce(setup(false), { type: 'play', uid: 'sf' });
    expect(s.cardBuffs.fred).toEqual({ attack: 2, health: 2 }); // one battlecry → +2/+2
    expect(s.karwindFlash).toContain('b'); // Bane flashes itself so the proc reads even with no Fodder out
    const g = reduce(setup(true), { type: 'play', uid: 'sf' });
    expect(g.cardBuffs.fred).toEqual({ attack: 4, health: 4 }); // golden → +4/+4
  });

  it('Bane: triggering N Battlecries buffs Fodder +N/+N (and respects Drakko doubling)', () => {
    // Play three *distinct* Battlecry minions (distinct ids → no triple combine) → Bane procs three times
    // → Fodder +3/+3. Then with a Drakko the Drummer on board, a single Battlecry fires twice → Bane procs
    // per fire → +2/+2 from one play.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], pendingTavern: [],
      board: [{ uid: 'b', cardId: 'bane', tribe: 'dragon', attack: 12, health: 12, keywords: [], golden: false }],
      hand: [
        { uid: 'f1', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }, // Battlecry: add Fodder
        { uid: 'f2', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }, // Battlecry: buff Dragons
        { uid: 'f3', cardId: 'cleric', tribe: 'dragon', attack: 4, health: 4, keywords: [], golden: false }, // Battlecry: buff Dragons (2nd cleric)
      ],
    };
    s = reduce(s, { type: 'play', uid: 'f1' });
    s = reduce(s, { type: 'play', uid: 'f2' });
    s = reduce(s, { type: 'play', uid: 'f3' });
    expect(s.cardBuffs.fred).toEqual({ attack: 6, health: 6 }); // N=3 battlecries × +2/+2 → +6/+6

    // Drakko doubling: one Battlecry fire becomes two → Bane procs twice for a single play.
    let d: RunState = {
      ...createRun(1), embers: 0, shop: [], pendingTavern: [],
      board: [
        { uid: 'b', cardId: 'bane', tribe: 'dragon', attack: 12, health: 12, keywords: [], golden: false },
        { uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
    };
    d = reduce(d, { type: 'play', uid: 'sf' });
    expect(d.cardBuffs.fred).toEqual({ attack: 4, health: 4 }); // 1 play × 2 fires (Drakko) × +2/+2 → +4/+4
  });
});

describe('opponent pool (M3 step 2 — serve real boards)', () => {
  it('pickOpponent matches by WAVE, prefers real boards, widens to the closest, null only on an empty pool', () => {
    const mk = (over: Partial<BoardSnapshot>): BoardSnapshot => ({
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'frontdrake', attack: 10, health: 10, keywords: [] }], seed: 0, ...over,
    });
    const house3 = mk({ wave: 3, origin: 'house', power: 20 });
    const self3 = mk({ wave: 3, origin: 'self', author: 'Sam', power: 20 });
    const house6 = mk({ wave: 6, origin: 'house', power: 50 });
    // Same wave (development stage) → prefers the REAL (self) board over the house board.
    expect(pickOpponent(3, 20, makeRng(7), [house3, self3])?.author).toBe('Sam');
    // No board at wave 5 → widens to the closest available wave (6), never null on a non-empty pool.
    expect(pickOpponent(5, 50, makeRng(7), [house3, house6])?.wave).toBe(6);
    // Empty pool → null (the caller falls back to the procedural threat).
    expect(pickOpponent(3, 20, makeRng(7), [])).toBeNull();
  });

  it('the sim default pool is empty → headless/tests fight procedural omens (the app injects the bootstrap)', () => {
    expect(OPPONENT_POOL.length).toBe(0); // empty here keeps headless runs deterministic-procedural
    const s: RunState = {
      ...createRun(1),
      wave: 3,
      board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: 4, health: 5, keywords: [], golden: false }],
    };
    const enemy = reduce(s, { type: 'faceOmen' }).lastCombat!.initial.enemy;
    expect(enemy.length).toBeGreaterThan(0);
    expect(enemy.every((m) => m.cardId === 'omen')).toBe(true); // empty pool → procedural omens
  });

  it('a populated pool serves a real captured board through faceOmen (not the procedural omen)', () => {
    const boards = buildBootstrapPool([1, 2]); // generate while the pool is still empty (bot faces procedural)
    OPPONENT_POOL.push(...boards);
    try {
      const target = boards.find((b) => b.minions.length > 0)!;
      const half = Math.max(1, Math.round(target.power / 2));
      const s: RunState = {
        ...createRun(1),
        wave: target.wave,
        board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: half, health: half, keywords: [], golden: false }],
      };
      const enemy = reduce(s, { type: 'faceOmen' }).lastCombat!.initial.enemy;
      expect(enemy.length).toBeGreaterThan(0);
      expect(enemy.some((m) => m.cardId !== 'omen')).toBe(true); // a real captured board, not procedural
    } finally {
      OPPONENT_POOL.length = 0; // restore the empty default so the rest of the suite stays procedural
    }
  });

  it('isServableBoard rejects boards referencing a card this build no longer has (stale capture)', () => {
    const known: BoardSnapshot = {
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'frontdrake', attack: 5, health: 5, keywords: [] }], seed: 0,
    };
    const stale: BoardSnapshot = { ...known, minions: [{ cardId: 'lifebinder', attack: 9, health: 9, keywords: [] }] };
    expect(isServableBoard(known)).toBe(true);
    expect(isServableBoard(stale)).toBe(false); // 'lifebinder' was removed → unfightable
  });

  it('registerOpponents drops stale boards so they never enter the served pool', () => {
    const known: BoardSnapshot = {
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'frontdrake', attack: 5, health: 5, keywords: [] }], seed: 0,
    };
    const stale: BoardSnapshot = { ...known, minions: [{ cardId: 'lifebinder', attack: 9, health: 9, keywords: [] }] };
    try {
      registerOpponents([known, stale]);
      expect(OPPONENT_POOL).toHaveLength(1);
      expect(OPPONENT_POOL[0]!.minions[0]!.cardId).toBe('frontdrake'); // only the fightable board got through
    } finally {
      OPPONENT_POOL.length = 0;
    }
  });

  it('faceOmen never hard-locks on a stale served board — it falls back to the procedural threat', () => {
    // Bypass registerOpponents' filter to force the worst case: a stale board IS in the live pool. Serving it
    // would throw `Unknown card` in instantiate (the old "froze on End of Turn" bug); the fallback must catch
    // it and resolve combat anyway. (This is the belt-and-suspenders behind the load-time filter.)
    const stale: BoardSnapshot = {
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'lifebinder', attack: 9, health: 9, keywords: [] }], seed: 0,
    };
    OPPONENT_POOL.push(stale); // raw push — skips the filter on purpose
    try {
      const s: RunState = {
        ...createRun(1),
        wave: 3,
        turnStartPower: 20,
        board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: 10, health: 10, keywords: [], golden: false }],
      };
      let next!: RunState;
      expect(() => { next = reduce(s, { type: 'faceOmen' }); }).not.toThrow();
      expect(next.phase).toBe('combat'); // combat resolved (didn't strand the turn in recruit)
      const enemy = next.lastCombat!.initial.enemy;
      expect(enemy.length).toBeGreaterThan(0);
      expect(enemy.every((m) => m.cardId !== 'lifebinder')).toBe(true); // fell back to a fightable board
      expect(next.lastCombat!.odds).toBeDefined(); // odds computed on the fallback board too
    } finally {
      OPPONENT_POOL.length = 0;
    }
  });

  it('loss damage = opponent tier + the SUM of surviving enemy tiers (procedural uses the player tier)', () => {
    // An empty board guarantees a loss with the whole enemy surviving → damage = tier + Σ(survivor tiers).
    const s: RunState = { ...createRun(1), wave: 4, tier: 3, board: [] };
    const next = reduce(s, { type: 'faceOmen' });
    expect(next.lastCombat!.result).toBe('lose');
    const enemy = next.lastCombat!.initial.enemy;
    const tierSum = enemy.reduce((sum, m) => sum + (CARD_INDEX[m.cardId]?.tier ?? 1), 0);
    expect(tierSum).toBeGreaterThan(0);
    expect(next.lastCombat!.playerDamage).toBe(Math.min(3 + tierSum, 10)); // s.tier + Σ tiers, capped (wave 4 → 10)
  });

  it('loss damage is capped by round — a low-power, high-tier board exceeds the early cap', () => {
    // A 1/1 Gnasher (T6) board: low power (matches an empty board) but raw damage tier 6 + surviving T6 = 12.
    const board: BoardSnapshot = {
      v: 1, wave: 1, heroId: 'warden', resolve: 30, tier: 6, triples: 0, tribes: [], threat: 'horde', power: 2,
      minions: [{ cardId: 'gnash', attack: 1, health: 1 }], seed: 0,
    };
    OPPONENT_POOL.push(board);
    try {
      const s: RunState = { ...createRun(1), wave: 1, board: [] };
      const next = reduce(s, { type: 'faceOmen' });
      expect(next.lastCombat!.result).toBe('lose');
      expect(next.lastCombat!.playerDamage).toBe(5); // raw 12 capped to 5 at wave 1
    } finally {
      OPPONENT_POOL.length = 0;
    }
  });

  it('lossDamageCap rises by round: 5 (≤3), 10 (4–6), 15 (7+)', () => {
    expect([1, 2, 3].map(lossDamageCap)).toEqual([5, 5, 5]);
    expect([4, 5, 6].map(lossDamageCap)).toEqual([10, 10, 10]);
    expect([7, 12, 30].map(lossDamageCap)).toEqual([15, 15, 15]);
  });

  it('settleCombat keeps the same lastCombat reference (the UI replay must not restart)', () => {
    let s: RunState = {
      ...createRun(1),
      wave: 2,
      board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.phase).toBe('combat');
    const ref = s.lastCombat;
    s = reduce(s, { type: 'settleCombat' });
    expect(s.combatSettled).toBe(true);
    expect(s.phase).toBe('combat'); // settle stays in combat; advancing is the End Combat click
    expect(s.lastCombat).toBe(ref); // SAME object → the replay hook (keyed on the reference) can't reset
  });
});

describe('Beatboxer — mimics magnetizations (M3 content)', () => {
  const clingHand = (uid: string): BoardCard => ({ uid, cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false });

  it('mimics a magnetization onto another mech (Beatboxer gains the stats too)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: false },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 }); // magnetize the Cling onto the drone (index 0)
    const host = s.board.find((c) => c.uid === 'host')!;
    const bb = s.board.find((c) => c.uid === 'bb')!;
    expect([host.attack, host.health]).toEqual([4, 3]); // host welded +2/+2
    expect([bb.attack, bb.health]).toEqual([10, 10]); // Beatboxer mimicked it (8/8 +2/+2)
  });

  it('a golden Beatboxer mimics each magnetization twice', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: true },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 });
    const bb = s.board.find((c) => c.uid === 'bb')!;
    expect([bb.attack, bb.health]).toEqual([12, 12]); // golden → 8/8 + 2×(2/2)
  });

  it('magnetizing directly onto Beatboxer counts once (no self-mimic)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: false }],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 }); // weld onto Beatboxer itself
    const bb = s.board.find((c) => c.uid === 'bb')!;
    expect([bb.attack, bb.health]).toEqual([10, 10]); // 8/8 + 2/2 once, not doubled
  });

  it("a Beatboxer's mimicked Cling copy also stacks the Cling improvement", () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: false },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 }); // 1 Cling onto the drone; Beatboxer mimics a copy
    expect(s.cardBuffs?.cling).toEqual({ attack: 2, health: 2 }); // host weld (1) + Beatboxer's copy (1)
  });

  it("a golden Beatboxer's two Cling copies both stack", () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: true },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 });
    expect(s.cardBuffs?.cling).toEqual({ attack: 3, health: 3 }); // host (1) + golden Beatboxer's 2 copies
  });
});

describe('spell offers respect the tavern tier (M3 fix)', () => {
  it('never offers a spell above the current tier', () => {
    let s: RunState = { ...createRun(1), tier: 2, embers: 200 };
    let sawSpell = false;
    for (let i = 0; i < 40; i++) {
      s = reduce(s, { type: 'roll' });
      if (s.spell) {
        sawSpell = true;
        expect(CARD_INDEX[s.spell.cardId]!.tier).toBeLessThanOrEqual(2); // the T5 Devourer can't appear at T2
      }
    }
    expect(sawSpell).toBe(true);
  });
});

describe('Cling Drones improve per magnetization (M3 content)', () => {
  it('a magnetized Cling improves Cling Drones +1/+1 (enchantment + clings already in hand grow)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
      hand: [
        { uid: 'm1', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false },
        { uid: 'm2', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false }, // stays in hand
      ],
    };
    s = reduce(s, { type: 'play', uid: 'm1', toIndex: 0 }); // magnetize m1 onto the drone
    expect(s.cardBuffs?.cling).toEqual({ attack: 1, health: 1 }); // persistent enchantment grew
    const m2 = s.hand.find((c) => c.uid === 'm2')!;
    expect([m2.attack, m2.health]).toEqual([3, 3]); // the Cling still in hand grew too
  });

  it('Combinator forks into different Magnetic Mechs across seeds (random pick from the whole magnetic pool)', () => {
    // The host (2/1) gains the rolled magnetic mech's body — so its attack jumps by that mech's base attack.
    // Derive the valid jumps from the live pool so this stays correct as magnetic mechs are added/changed.
    const magneticAtks = new Set(
      Object.values(CARD_INDEX)
        .filter((c) => (c.tribe === 'mech' || c.tribe2 === 'mech') && c.keywords.includes('M'))
        .map((c) => c.attack),
    );
    expect(magneticAtks.size).toBeGreaterThan(1); // sanity: there are several magnetic mechs to roll
    const deltaAtk = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      let s: RunState = {
        ...createRun(seed),
        board: [
          { uid: 'comb', cardId: 'combinator', tribe: 'mech', attack: 6, health: 7, keywords: [], golden: false },
          { uid: 'd1', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
          { uid: 'd2', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        ],
      };
      s = reduce(s, { type: 'faceOmen' });
      const welded = s.board.filter((c) => c.uid.startsWith('d') && c.attack > 2);
      expect(welded.length).toBe(1); // non-golden welds exactly one host
      const da = welded[0]!.attack - 2;
      expect(magneticAtks.has(da)).toBe(true); // welded one of the build's Magnetic Mechs
      deltaAtk.add(da);
    }
    expect(deltaAtk.size).toBeGreaterThan(1); // it's RANDOM — not always the same bot
  });
});

describe('content batch: new minions (@game/sim)', () => {
  const card = (uid: string, cardId: string, tribe: BoardCard['tribe'], a: number, h: number, extra: Partial<BoardCard> = {}): BoardCard =>
    ({ uid, cardId, tribe, attack: a, health: h, keywords: [], golden: false, ...extra });

  // Minimal CombatResult shell for the carry-back settleCombat tests — only the fields settleCombat reads
  // matter; the carry-back channels are layered per test.
  const combatShell = (over: Partial<CombatResult>): CombatResult => ({
    events: [],
    result: 'win',
    playerDamage: 0,
    playerDeathrattles: 0,
    enemyDeaths: 0,
    initial: { player: [], enemy: [] },
    ...over,
  });

  it('a triple keeps welded magnetic fields — Better Bot Rally + Harry Botter aura survive the combine', () => {
    // Three Drones: one carries a welded Better Bot Rally, one a welded Harry Botter aura. Playing the
    // third triggers the triple — the golden must inherit BOTH welded attachments (the Better-Bot bug).
    let s: RunState = {
      ...createRun(1),
      hand: [card('d3', 'drone', 'mech', 2, 1, { keywords: ['DS'] })],
      board: [
        card('d1', 'drone', 'mech', 7, 1, { keywords: ['DS'], rallyMechAtk: 5 }),
        card('d2', 'drone', 'mech', 2, 6, { keywords: ['DS'], spellAuraBonus: 1 }),
      ],
    };
    s = reduce(s, { type: 'play', uid: 'd3', toIndex: 2 }); // 3rd Drone → triple → golden in hand
    const golden = [...s.hand, ...s.board].find((c) => c.cardId === 'drone' && c.golden);
    expect(golden).toBeDefined();
    expect(golden!.rallyMechAtk).toBe(5); // Better Bot's welded Rally carried through (was dropped before)
    expect(golden!.spellAuraBonus).toBe(1); // Harry Botter's welded aura carried through
  });

  it('Archmagus Guel scales with spells cast: +1/+1 per 4 (golden +2/+2 per 4)', () => {
    // emberpouch (Gain 1 Gold) doesn't touch minions, so the OTHER friend's gain is purely Guel's.
    const cast = (spellsCast: number, golden: boolean): RunState =>
      reduce(
        {
          ...createRun(1),
          embers: 99,
          spellsCast,
          board: [card('g', 'guel', 'neutral', 2, 3, { golden }), card('t', 'drone', 'mech', 2, 2)],
          hand: [card('sp', 'emberpouch', 'neutral', 0, 0)],
        },
        { type: 'play', uid: 'sp' },
      );
    const buffed = (s: RunState): [number, number] => {
      const t = s.board.find((c) => c.uid === 't')!;
      return [t.attack - 2, t.health - 2];
    };
    expect(buffed(cast(0, false))).toEqual([1, 1]); // cast → 1 spell, step 0 → base +1/+1
    expect(buffed(cast(3, false))).toEqual([2, 2]); // cast → 4 spells, step 1 → +2/+2
    expect(buffed(cast(7, false))).toEqual([3, 3]); // cast → 8 spells, step 2 → +3/+3
    expect(buffed(cast(7, true))).toEqual([6, 6]); // golden: (1 + 2) × 2 → +6/+6
  });

  it('Hoard Cleric (cleric) Battlecry gives your Dragons +2/+3', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        card('d', 'frontdrake', 'dragon', 2, 1), // another Dragon on board
        card('n', 'sandbag', 'neutral', 0, 4), // a non-Dragon: untouched
      ],
      hand: [card('hc', 'cleric', 'dragon', 3, 4)],
    };
    s = reduce(s, { type: 'play', uid: 'hc' });
    const dragon = s.board.find((c) => c.uid === 'd')!;
    expect([dragon.attack, dragon.health]).toEqual([4, 4]); // 2/1 → 4/4
    const cleric = s.board.find((c) => c.uid === 'hc')!;
    expect([cleric.attack, cleric.health]).toEqual([5, 7]); // includes self: 3/4 → 5/7
    const neutral = s.board.find((c) => c.uid === 'n')!;
    expect([neutral.attack, neutral.health]).toEqual([0, 4]); // non-Dragon untouched
  });

  it('Cinderwing Matron (cinder) Battlecry raises the run spell HEALTH bonus; a later Spirit Fire grants +4/+5', () => {
    let s: RunState = {
      ...createRun(1),
      board: [card('t', 'sandbag', 'neutral', 2, 2)],
      hand: [card('cw', 'cinder', 'dragon', 5, 5), card('sf', 'spiritfire', 'neutral', 0, 0)],
    };
    s = reduce(s, { type: 'play', uid: 'cw' });
    expect(s.spellBonus).toEqual({ attack: 0, health: 1 }); // +1 spell Health
    expect(spellAttackBonus(s)).toBe(0); // Attack unchanged (warden hero amplify = 0)
    expect(spellHealthBonus(s)).toBe(1);
    // Spirit Fire (+4/+4) now grants +4/+5 (Health bonus folds onto Health only).
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 't' });
    const target = s.board.find((c) => c.uid === 't')!;
    expect([target.attack, target.health]).toEqual([6, 7]); // 2/2 + 4/5
    // And the card text shows the effective Health bump (Attack unchanged).
    expect(spellDisplayText('spiritfire', spellAttackBonus(s), 0, spellHealthBonus(s))).toBe('Give a friendly minion **{{+4/+5}}**.');
  });

  it('a golden Cinderwing Matron grants +2 spell Health', () => {
    let s: RunState = { ...createRun(1), board: [], hand: [card('cw', 'cinder', 'dragon', 10, 10, { golden: true })] };
    s = reduce(s, { type: 'play', uid: 'cw' });
    expect(s.spellBonus).toEqual({ attack: 0, health: 2 });
  });

  it("Skullblade's spell-power carry-back lands in settleCombat: spellBonus.attack += 1, next spell +5/+4", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [card('t', 'sandbag', 'neutral', 2, 2)],
      hand: [card('sf', 'spiritfire', 'neutral', 0, 0)],
      lastCombat: combatShell({ playerSpellPower: { attack: 1, health: 0 } }),
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.spellBonus).toEqual({ attack: 1, health: 0 }); // carried back
    // A Spirit Fire (+4/+4) now grants +5/+4 (Attack bonus folds onto Attack only).
    s = { ...s, phase: 'recruit' };
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 't' });
    const target = s.board.find((c) => c.uid === 't')!;
    expect([target.attack, target.health]).toEqual([7, 6]); // 2/2 + 5/4
  });

  it('Toxin Tender (toxin) grants Venomous to a friendly Undead you target', () => {
    let s: RunState = {
      ...createRun(1),
      board: [card('u', 'spore', 'undead', 1, 2)], // a friendly Undead
      hand: [card('tt', 'toxin', 'undead', 3, 1)],
    };
    s = reduce(s, { type: 'play', uid: 'tt' });
    expect(s.pendingTarget?.cardId).toBe('toxin'); // waits for a friendly-Undead pick
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'u' });
    expect(s.board.find((c) => c.uid === 'u')?.keywords).toContain('V');
  });

  it('Toxin Tender with no friendly Undead plays without a prompt and grants nothing', () => {
    let s: RunState = {
      ...createRun(1),
      board: [card('b', 'stray', 'beast', 1, 1)], // no friendly Undead (self not yet on board)
      hand: [card('tt', 'toxin', 'undead', 3, 1)],
    };
    s = reduce(s, { type: 'play', uid: 'tt' });
    expect(s.pendingTarget).toBeUndefined(); // no viable Undead → no targeting prompt
    expect(s.board.find((c) => c.uid === 'b')?.keywords ?? []).not.toContain('V'); // Beast never gets it
  });

  it("Toxin Tender's auto-pick (face-Omen carry) only grants Venomous to a friendly Undead", () => {
    // Two Undead present + the played Toxin Tender; ending the turn mid-pick auto-resolves on the
    // highest-attack *Undead* carry — never a higher-attack off-tribe minion.
    let s: RunState = {
      ...createRun(1),
      board: [
        card('big', 'gnash', 'beast', 9, 9), // highest attack, but NOT Undead → ineligible
        card('u', 'spore', 'undead', 4, 4), // the eligible Undead carry
        card('tt', 'toxin', 'undead', 3, 1), // the played Toxin Tender (pending target)
      ],
      pendingTarget: { uid: 'tt', cardId: 'toxin' },
    };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.board.find((c) => c.uid === 'u')?.keywords).toContain('V'); // Undead carry got it
    expect(s.board.find((c) => c.uid === 'big')?.keywords ?? []).not.toContain('V'); // Beast did not
  });

  it('Grave Knit (knit) run-wide +3/+2 carry-back lands in settleCombat — board, hand, and future copies', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [card('k1', 'knit', 'undead', 3, 2)],
      hand: [card('k2', 'knit', 'undead', 3, 2)],
      lastCombat: combatShell({ playerCardBuffs: [{ cardId: 'knit', attack: 3, health: 2 }] }),
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.cardBuffs.knit).toEqual({ attack: 3, health: 2 }); // run-wide enchant recorded
    expect([s.board.find((c) => c.uid === 'k1')!.attack, s.board.find((c) => c.uid === 'k1')!.health]).toEqual([6, 4]); // board copy
    expect([s.hand.find((c) => c.uid === 'k2')!.attack, s.hand.find((c) => c.uid === 'k2')!.health]).toEqual([6, 4]); // hand copy
    // A FUTURE copy bought from the tavern carries the enchant too. Use a clean board/hand (the two
    // existing Grave Knits above would otherwise triple with the buy into a golden, doubling its stats).
    let s2: RunState = { ...createRun(1), embers: 9, board: [], hand: [], cardBuffs: { knit: { attack: 3, health: 2 } }, shop: [{ uid: 'x', cardId: 'knit' }] };
    s2 = reduce(s2, { type: 'buy', uid: 'x' });
    const bought = s2.hand.find((c) => c.cardId === 'knit')!;
    expect([bought.attack, bought.health]).toEqual([6, 4]); // 3/2 base + 3/2 run buff
  });

  it("Grave Knit's run-wide buff stacks across combat deaths (+3/+2 each)", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [card('k1', 'knit', 'undead', 3, 2)],
      hand: [],
      // Two Grave Knits died this combat → the carried entry already sums to +6/+4.
      lastCombat: combatShell({ playerCardBuffs: [{ cardId: 'knit', attack: 6, health: 4 }] }),
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.cardBuffs.knit).toEqual({ attack: 6, health: 4 });
    expect([s.board.find((c) => c.uid === 'k1')!.attack, s.board.find((c) => c.uid === 'k1')!.health]).toEqual([9, 6]); // 3/2 + 6/4
  });

  it('Bane (Dragon/Demon) is consumed as a Demon — it eats Fodder from the tavern via tribe2', () => {
    // Bane on the board (primary Dragon, tribe2 Demon). Fred queued for the next tavern must be brought
    // out (injectPendingTavern's demon check) and devoured by Bane (consumeTavernFodder's demon check),
    // both now recognizing tribe2 === 'demon'. resolveCombat advances → next tavern injects + consumes.
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [card('bane', 'bane', 'dragon', 12, 12)],
      pendingTavern: ['fred'],
      lastCombat: combatShell({}),
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.shop.find((o) => o.cardId === 'fred')).toBeUndefined(); // Fred eaten — left the tavern
    const bane = s.board.find((c) => c.uid === 'bane')!;
    expect([bane.attack, bane.health]).toEqual([13, 13]); // 12/12 + Fred's 1/1
    expect(s.fodderEaten?.[0]).toMatchObject({ eaterUid: 'bane', fodderId: 'fred' }); // Bane recorded as the eater
  });

});

describe('wave-relative board strength rating (@game/sim)', () => {
  const vanilla = (n: number, atk: number, hp: number, kw?: BoardMinion['keywords']): BoardMinion[] =>
    Array.from({ length: n }, () => (kw ? { cardId: 'alley', attack: atk, health: hp, keywords: kw } : { cardId: 'alley', attack: atk, health: hp }));
  // Build the per-wave ladders ONCE (running the bot is the slow part). A small seed/fidelity set still
  // spans weak→strong at each wave for these assertions.
  const ladders = buildWaveLadders([1, 42], [0.3, 0.7, 1.0]);
  const waves = [...ladders.keys()].sort((a, b) => a - b);
  const lowWave = waves[0]!;
  const highWave = waves[waves.length - 1]!;
  const avgPower = (w: number): number => {
    const L = ladders.get(w)!;
    return L.reduce((s, b) => s + b.reduce((p, m) => p + m.attack + m.health, 0), 0) / L.length;
  };

  it('is WAVE-RELATIVE — the ladder scales with the wave, so a fixed board rates no higher at a later wave (no saturation)', () => {
    expect(highWave).toBeGreaterThan(lowWave);
    expect(avgPower(highWave)).toBeGreaterThan(avgPower(lowWave)); // later waves calibrate against stronger boards
    const board = vanilla(5, 6, 6); // a fixed mid board
    const low = rateBoardForWave(board, lowWave, ladders);
    const high = rateBoardForWave(board, highWave, ladders);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(low); // the SAME board is no stronger FOR a later wave — the old fixed gauntlet saturated to 1.0 and couldn't see this
  });

  it('rates 0 for empty, is monotonic in board strength at a fixed wave, and is deterministic', () => {
    expect(rateBoardForWave([], lowWave, ladders)).toBe(0);
    const weak = rateBoardForWave(vanilla(2, 1, 1), lowWave, ladders);
    const strong = rateBoardForWave(vanilla(7, 20, 30, ['DS', 'W']), lowWave, ladders);
    expect(weak).toBeLessThan(strong);
    expect(strong).toBeLessThanOrEqual(1);
    expect(rateBoardForWave(vanilla(2, 1, 1), lowWave, ladders)).toBe(weak); // same board+wave → same rating
  });

  it('ratingBand buckets 0..1 into BAND_COUNT bands', () => {
    expect(ratingBand(0)).toBe(0);
    expect(ratingBand(0.999)).toBe(BAND_COUNT - 1);
    expect(ratingBand(1)).toBe(BAND_COUNT - 1); // clamped, never out of range
  });
});
