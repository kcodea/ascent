import { describe, it, expect } from 'vitest';
import { makeRng } from '@game/core';
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
  boardManaBonus,
  THREAT_IDS,
  addBuff,
  getHero,
  spellStatBonus,
  spellDisplayText,
  type BoardCard,
  type RunState,
} from './index';

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
    let s: RunState = { ...createRun(1), board: [mk('a', 'sandbag'), mk('b', 'alley'), mk('c', 'whelp')] };
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
    expect(bought?.health).toBe(5); // 4 + 1
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
        initial: { player: [], enemy: [] },
        playerSummonBonus: [{ sourceUid: 'k', bonus: 2 }],
      },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 'k')?.summonBonus).toBe(2); // carried back from combat
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

  it('Dragon Battlecries bake into stats when played', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'w', cardId: 'whelp', tribe: 'dragon', attack: 2, health: 1, keywords: ['SC'], golden: false }],
      shop: [{ uid: 'x', cardId: 'cleric' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.find((c) => c.cardId === 'whelp')?.attack).toBe(3); // 2 + 1
    const cleric = s.board.find((c) => c.cardId === 'cleric');
    expect(cleric?.attack).toBe(2); // 1 + 1 (Battlecry includes self)
    expect(cleric?.health).toBe(4);
  });

  it('Toxin Tender grants Venomous to the minion you target after playing it', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'g', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'toxin' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'g' }); // pick the target after playing
    expect(s.board.find((c) => c.cardId === 'gnash')?.keywords).toContain('V');
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
    expect(s.cardBuffs.fred).toEqual({ attack: 1, health: 1 }); // persists for the run
    const f1 = s.board.find((c) => c.uid === 'f1');
    expect([f1?.attack, f1?.health]).toEqual([2, 2]); // Fodder on the board buffed now
    const f2 = s.hand.find((c) => c.uid === 'f2');
    expect([f2?.attack, f2?.health]).toEqual([2, 2]); // Fodder in the hand too
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
      lastCombat: { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } },
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
      lastCombat: { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } },
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
      lastCombat: { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.cardId === 'feed')!.attack).toBe(3); // the demon ate the queued Fred (+1/+1)
    expect(s.pendingTavern).toEqual([]); // queue cleared — not stranded by the freeze
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
    // Play Hoard Cleric (Dragon Battlecry +1/+1 to dragons) with Karwind on board: the Cleric's
    // Battlecry buffs Karwind +1/+1, then the battlecry-triggered proc gives Dragons +1/+2.
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'k', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false }],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const k = s.board.find((c) => c.uid === 'k')!;
    expect([k.attack, k.health]).toEqual([4, 15]); // 2/12 +1/+1 (Cleric) +1/+2 (Karwind proc)
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
    // Cleric Battlecry fires 2× (+2/+2) and Karwind procs 2× (+2/+4): 2/12 → 6/18
    expect([k.attack, k.health]).toEqual([6, 18]);
  });

  it('Money Bot raises max mana while on board; selling it removes the income', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'mb', cardId: 'moneybot', tribe: 'mech', attack: 3, health: 3, keywords: ['M'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } },
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

  it('Combinator magnetizes a Cling Drone (+2/+2) onto 2 other friendly Mechs at end of turn', () => {
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
    expect([d1.attack, d1.health]).toEqual([4, 3]); // 2/1 + a Cling Drone (2/2)
    expect([d2.attack, d2.health]).toEqual([4, 3]);
    expect([cmb.attack, cmb.health]).toEqual([6, 7]); // self is not a target
  });

  it('Combinator welds onto 2 RANDOM Mechs — the pair varies by seed, not the highest-Attack', () => {
    const everBuffed = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      let s: RunState = {
        ...createRun(seed),
        phase: 'recruit',
        embers: 0,
        shop: [],
        board: [
          { uid: 'cmb', cardId: 'combinator', tribe: 'mech', attack: 6, health: 7, keywords: [], golden: false },
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
    expect(s.cardBuffs.fred).toEqual({ attack: 2, health: 2 }); // +1/+1 applied twice
    const f = s.board.find((c) => c.uid === 'f')!;
    expect([f.attack, f.health]).toEqual([3, 3]); // the on-board Fred: 1/1 + 2/2
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

  it('on-consume Demons pay off when they eat tavern Fodder (Ravening Glutton)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'p', cardId: 'glut', tribe: 'demon', attack: 2, health: 3, keywords: [], golden: false }],
      pendingTavern: ['fred'],
    };
    s = reduce(s, { type: 'roll' });
    const glut = s.board.find((c) => c.cardId === 'glut');
    expect([glut?.attack, glut?.health]).toEqual([5, 6]); // 2/3 +1/+1 (Fodder ×1) +2/+2 (on-consume)
  });

  it('Maw of the Pit gains a Divine Shield eating tavern Fodder', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'm', cardId: 'maw', tribe: 'demon', attack: 4, health: 5, keywords: ['T'], golden: false }],
      pendingTavern: ['fred'],
    };
    s = reduce(s, { type: 'roll' });
    expect(s.board.find((c) => c.cardId === 'maw')?.keywords).toContain('DS');
  });

  it('Maw of the Pit Divine Shield is spent after one combat', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'm', cardId: 'maw', tribe: 'demon', attack: 4, health: 5, keywords: ['T'], golden: false }],
      pendingTavern: ['fred'],
    };
    s = reduce(s, { type: 'roll' }); // Maw eats Fodder → a one-combat Divine Shield
    expect(s.board.find((c) => c.cardId === 'maw')?.keywords).toContain('DS');
    expect(s.board.find((c) => c.cardId === 'maw')?.tempShield).toBe(true);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    const maw = s.board.find((c) => c.cardId === 'maw');
    expect(maw?.keywords).not.toContain('DS'); // spent — gone after the fight
    expect(maw?.tempShield).toBeFalsy();
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

  it('Corrupted Lifebinder Battlecry links to the chosen friendly demon', () => {
    let s: RunState = {
      ...createRun(1),
      hand: [{ uid: 'lb', cardId: 'lifebinder', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false }],
      board: [{ uid: 'd', cardId: 'glut', tribe: 'demon', attack: 5, health: 5, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'lb' }); // targeted Battlecry defers to a friendly-demon pick
    expect(s.pendingTarget?.uid).toBe('lb');
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'd' });
    expect(s.board.find((c) => c.uid === 'lb')?.linkUid).toBe('d');
  });

  it('Corrupted Lifebinder with no other friendly Demon plays without a prompt or link', () => {
    let s: RunState = {
      ...createRun(1),
      hand: [{ uid: 'lb', cardId: 'lifebinder', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false }],
      board: [{ uid: 'b', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'lb' });
    expect(s.pendingTarget).toBeUndefined(); // no viable Demon → no targeting prompt
    expect(s.board.find((c) => c.uid === 'lb')?.linkUid).toBeUndefined(); // played without effect
  });

  it('Corrupted Lifebinder mirrors its linked demon\'s recruit gains', () => {
    let s: RunState = {
      ...createRun(1),
      heroReady: true,
      board: [
        { uid: 'lb', cardId: 'lifebinder', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false, linkUid: 'd', linkBase: { attack: 5, health: 5 }, linkApplied: { attack: 0, health: 0 } },
        { uid: 'd', cardId: 'glut', tribe: 'demon', attack: 5, health: 5, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'heroPower', uid: 'd' }); // Fortify the linked demon +1/+1
    const lb = s.board.find((c) => c.uid === 'lb');
    expect([s.board.find((c) => c.uid === 'd')?.attack, s.board.find((c) => c.uid === 'd')?.health]).toEqual([6, 6]);
    expect([lb?.attack, lb?.health]).toEqual([2, 2]); // mirrored the +1/+1
  });

  it('Corrupted Lifebinder keeps its stats but stops mirroring when the demon leaves', () => {
    let s: RunState = {
      ...createRun(1),
      heroReady: true,
      board: [
        { uid: 'lb', cardId: 'lifebinder', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false, linkUid: 'd', linkBase: { attack: 5, health: 5 }, linkApplied: { attack: 2, health: 2 } },
        { uid: 'd', cardId: 'glut', tribe: 'demon', attack: 7, health: 7, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'sell', uid: 'd' }); // the linked demon leaves
    const lb = s.board.find((c) => c.uid === 'lb');
    expect([lb?.attack, lb?.health]).toEqual([3, 3]); // keeps what it had
    expect(lb?.linkUid).toBeUndefined(); // link ended
  });

  it('Fodder with no Demon on board just sits in the tavern (buyable)', () => {
    let s: RunState = { ...createRun(1), embers: 3, board: [], pendingTavern: ['fred'] };
    s = reduce(s, { type: 'roll' });
    expect(s.shop.some((o) => o.cardId === 'fred')).toBe(true); // not eaten — stays for you to buy
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

  it('Spirit Fire buffs the targeted friend +3/+3, is consumed, and counts as a cast', () => {
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
    expect([m.attack, m.health]).toEqual([4, 4]); // 1/1 + 3/3
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
    let s: RunState = { ...createRun(1), hand: [], discover: ['whelp', 'cleric', 'razor'] };
    s = reduce(s, { type: 'discover', index: 1 });
    expect(s.hand.some((c) => c.cardId === 'cleric')).toBe(true);
    expect(s.discover).toBeUndefined();
  });

  it('a golden minion bakes its Battlecry in at doubled magnitude', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'w', cardId: 'whelp', tribe: 'dragon', attack: 2, health: 1, keywords: ['SC'], golden: false }],
      hand: [{ uid: 'gc', cardId: 'cleric', tribe: 'dragon', attack: 2, health: 6, keywords: [], golden: true }],
    };
    s = reduce(s, { type: 'play', uid: 'gc' }); // golden Hoard Cleric: Dragons +2/+2 (doubled)
    expect(s.board.find((c) => c.cardId === 'whelp')?.attack).toBe(4); // 2 + 2
    expect(s.board.find((c) => c.cardId === 'whelp')?.health).toBe(3); // 1 + 2
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

  it('Toxin Tender is player-targeted: its Battlecry waits, then grants Venomous to the chosen minion', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [
        { uid: 'big', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false },
        { uid: 'mid', cardId: 'cleaver', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false },
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
      board: [{ uid: 'big', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'toxin' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.pendingTarget?.cardId).toBe('toxin');
    s = reduce(s, { type: 'faceOmen' }); // end the turn without picking → grant lands on the carry (big)
    expect(s.pendingTarget).toBeUndefined();
    expect(s.board.find((c) => c.uid === 'big')?.keywords).toContain('V');
  });

  it('Plaguebringer auto-grants Venomous + Windfury to the highest-attack friend that lacks it', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [
        { uid: 'big', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: ['V', 'W'], golden: false },
        { uid: 'mid', cardId: 'cleaver', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'p', cardId: 'plague', tribe: 'undead', attack: 5, health: 5, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(s.pendingTarget).toBeUndefined(); // Plaguebringer is untargeted (auto)
    expect(s.board.find((c) => c.uid === 'mid')?.keywords).toEqual(expect.arrayContaining(['V', 'W']));
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
    // Hoard Cleric (+1/+1 to Dragons, incl. self) — avoids token triples. Golden Drakko fires it 3×.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: true }],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const cleric = s.board.find((c) => c.cardId === 'cleric');
    expect([cleric?.attack, cleric?.health]).toEqual([4, 6]); // 1/3 + 3×(+1/+1)
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
    const card: BoardCard = { uid: 'x', cardId: 'whelp', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false };
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

  it('hero Fortify records its source on the buffed minion (inspect breakdown)', () => {
    let s: RunState = {
      ...createRun(7),
      heroReady: true,
      board: [{ uid: 'd', cardId: 'whelp', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false }],
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
        { uid: 'd', cardId: 'whelp', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false },
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
        { uid: 'b', cardId: 'cleaver', tribe: 'beast', attack: 2, health: 4, keywords: ['C'], golden: false },
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
    expect(createRun(1, 'oner').heroId).toBe('oner');
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

  it("Oner's Gild doubles a minion's stats, turns it golden, and is once per game", () => {
    let s: RunState = { ...createRun(1, 'oner'), board: [mk('a', 3, 4), mk('b', 2, 2)] };
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

  it("Oner's Gild no-ops (no charge spent) on an already-golden minion", () => {
    const s: RunState = { ...createRun(1, 'oner'), board: [{ ...mk('a', 3, 4), golden: true }] };
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s); // rejected → same reference
    expect(after.heroPowerSpent).toBe(false); // charge preserved for a real target
  });

  it("Myra's Encore re-fires a friendly minion's Battlecry, once per turn", () => {
    // Hoard Cleric's Battlecry buffs all your Dragons +1/+1 (includes itself).
    const cleric = (): BoardCard => ({
      uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false,
    });
    let s: RunState = { ...createRun(1, 'myra'), wave: 3, board: [cleric()] }; // Encore unlocks turn 3
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    expect(s.board[0]!.attack).toBe(2); // 1 + 1
    expect(s.board[0]!.health).toBe(4); // 3 + 1
    expect(s.board[0]!.buffs).toEqual([{ source: 'Hoard Cleric', attack: 1, health: 1, count: 1 }]);
    expect(s.heroReady).toBe(false);
    // Once per turn: a second use this wave is rejected.
    expect(reduce(s, { type: 'heroPower', uid: 'c' })).toBe(s);
  });

  it("Myra's Encore auto-targets a targeted Battlecry (Toxin Tender → best friend gets Venomous)", () => {
    const s: RunState = {
      ...createRun(1, 'myra'),
      wave: 3, // Encore unlocks turn 3
      board: [
        { uid: 't', cardId: 'toxin', tribe: 'undead', attack: 1, health: 3, keywords: [], golden: false },
        mk('f', 5, 5), // highest-attack friend → auto-picked
      ],
    };
    const after = reduce(s, { type: 'heroPower', uid: 't' });
    expect(after.board.find((c) => c.uid === 'f')!.keywords).toContain('V');
    expect(after.heroReady).toBe(false);
  });

  it("Myra's Encore no-ops (no charge spent) on a minion with no Battlecry", () => {
    // wave 3 so it's unlocked — this tests the no-Battlecry path, not the turn lock.
    const s: RunState = { ...createRun(1, 'myra'), wave: 3, board: [mk('a', 2, 2)] }; // sandbag = vanilla
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s); // rejected → same reference
    expect(after.heroReady).toBe(true); // charge preserved
  });

  it("Myra's Encore is locked until turn 3", () => {
    const cleric = (): BoardCard => ({
      uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false,
    });
    // Turns 1 & 2: locked — rejected, the minion is untouched, the charge preserved.
    for (const wave of [1, 2]) {
      const s: RunState = { ...createRun(1, 'myra'), wave, board: [cleric()] };
      const after = reduce(s, { type: 'heroPower', uid: 'c' });
      expect(after).toBe(s);
      expect(after.board[0]!.attack).toBe(1);
      expect(after.heroReady).toBe(true);
    }
    // Turn 3: unlocked — the Battlecry fires.
    let s3: RunState = { ...createRun(1, 'myra'), wave: 3, board: [cleric()] };
    s3 = reduce(s3, { type: 'heroPower', uid: 'c' });
    expect(s3.board[0]!.attack).toBe(2);
    expect(s3.heroReady).toBe(false);
  });

  it("createRun seeds the run with the hero's Resolve (HP)", () => {
    for (const id of ['warden', 'oner', 'myra']) {
      const s = createRun(1, id);
      expect(s.resolve).toBe(getHero(id).resolve);
      expect(s.maxResolve).toBe(getHero(id).resolve);
    }
  });

  it("Djinn's Cadence procs a friendly minion's End of Turn now (once per turn)", () => {
    // Ritualist's End of Turn buffs every Fodder +1/+1; Fred is Fodder.
    const board = (): BoardCard[] => [
      { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false },
      { uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false },
    ];
    let s: RunState = { ...createRun(1, 'djinn'), board: board() };
    s = reduce(s, { type: 'heroPower', uid: 'r' });
    const fred = s.board.find((c) => c.uid === 'f')!;
    expect(fred.attack).toBe(2); // 1 + 1
    expect(fred.health).toBe(2);
    expect(s.heroReady).toBe(false);
    expect(reduce(s, { type: 'heroPower', uid: 'r' })).toBe(s); // once per turn
  });

  it("Djinn's Cadence no-ops (no charge) on a minion with no End of Turn effect", () => {
    const s: RunState = { ...createRun(1, 'djinn'), board: [mk('a', 2, 2)] }; // sandbag = vanilla
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s);
    expect(after.heroReady).toBe(true);
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
    // Spirit Fire = +3/+3. Rohan adds +1 at turn 1 → +4/+4 (2/2 → 6/6).
    expect(cast('rohan', 1).attack).toBe(6);
    // Scales: +2 at turn 4 → +5/+5 (→ 7/7).
    expect(cast('rohan', 4).attack).toBe(7);
    // Hero-gated: a non-Rohan gets the base +3/+3 (→ 5/5).
    expect(cast('warden', 1).attack).toBe(5);
  });

  it('Sporen marks one minion for resummon (clearing any previous mark)', () => {
    let s: RunState = { ...createRun(1, 'sporen'), board: [mk('a', 2, 2), mk('b', 3, 3)] };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.board.find((c) => c.uid === 'a')!.resummon).toBe(true);
    expect(s.board.find((c) => c.uid === 'b')!.resummon ?? false).toBe(false);
    expect(s.heroReady).toBe(false);
  });

  it("Sporen's mark carries into combat (marked minion destroyed + resummoned)", () => {
    // Pack Scrounger marked → at start of combat it dies (Deathrattle → 2 Pups) and a copy returns.
    let s: RunState = {
      ...createRun(1, 'sporen'),
      board: [{ uid: 'p', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'p' });
    s = reduce(s, { type: 'faceOmen' });
    const ev = s.lastCombat!.events;
    expect(ev.some((e) => e.type === 'summon' && e.minion.cardId === 'pup')).toBe(true); // Deathrattle fired
    expect(ev.some((e) => e.type === 'summon' && e.minion.cardId === 'pack')).toBe(true); // copy resummoned
  });
});

describe('PvE win condition (@game/sim)', () => {
  // High Resolve so the player survives whatever the wave throws (isolates the wave-cap logic
  // from the combat outcome) — then fight one combat and check where the run lands.
  const fightOnce = (wave: number): RunState => {
    let s: RunState = { ...createRun(1), wave, resolve: 100, maxResolve: 100 };
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'faceOmen' });
    return reduce(s, { type: 'resolveCombat' });
  };

  it('surviving the final wave (maxWave) ends the run in victory', () => {
    const s = fightOnce(CONFIG.maxWave);
    expect(s.phase).toBe('victory');
    expect(s.wave).toBe(CONFIG.maxWave); // did not advance past the cap
  });

  it('does not declare victory before the final wave', () => {
    const s = fightOnce(CONFIG.maxWave - 1);
    expect(s.phase).toBe('recruit'); // survived → advance, not victory
    expect(s.wave).toBe(CONFIG.maxWave);
  });

  it('losing the final wave (Resolve to 0) is a game over, not a victory', () => {
    // 1 Resolve + an empty board at the cap → the wave breaks through → game over.
    let s: RunState = { ...createRun(1), wave: CONFIG.maxWave, resolve: 1, maxResolve: 1 };
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
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
    expect(spellDisplayText('spiritfire', 0)).toBe('Give a friendly minion **+3/+3**.');
    // +1 bonus → the value updates and is highlighted.
    expect(spellDisplayText('spiritfire', 1)).toBe('Give a friendly minion **{{+4/+4}}**.');
    expect(spellDisplayText('bulwark', 1)).toBe('Give a friendly minion **{{+1/+2}}** and **Taunt**.');
    // A non-stat spell (Mana Pouch) is untouched even with a bonus.
    expect(spellDisplayText('emberpouch', 2)).toBe('Gain **1 Mana**.');
  });

  it('the displayed value matches what a cast actually grants (Rohan, turn 1)', () => {
    const s = { ...createRun(1, 'rohan'), wave: 1 };
    const bonus = spellStatBonus(s);
    // Spirit Fire's base is +3/+3; the card shows +4/+4 and a cast grants +4/+4 — same number.
    expect(spellDisplayText('spiritfire', bonus)).toContain('+4/+4');
    let r: RunState = {
      ...s, board: [{ uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'sf', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }],
    };
    r = reduce(r, { type: 'play', uid: 'sf', targetUid: 't' });
    expect(r.board[0]!.attack).toBe(6); // 2 + 4
    expect(r.board[0]!.health).toBe(6);
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
    ({ uid, cardId: 'whelp', tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false });
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
});

describe('Corrupted Lifebinder End-of-Turn timing (@game/sim)', () => {
  it("mirrors a linked minion's End-of-Turn gain before combat, not at the next turn", () => {
    // Lifebinder bound to Fred (a Demon Fodder). A Ritualist's End of Turn buffs all Fodder +1/+1 →
    // Fred gains; faceOmen must mirror it onto the Lifebinder *before* the combat snapshot so it fights
    // with the gain (the bug: it only caught up at the next turn's reduce).
    let s: RunState = {
      ...createRun(1), resolve: 100, maxResolve: 100,
      board: [
        { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false },
        {
          uid: 'lb', cardId: 'lifebinder', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false,
          linkUid: 'f', linkBase: { attack: 1, health: 1 }, linkApplied: { attack: 0, health: 0 },
        },
      ],
    };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.board.find((c) => c.uid === 'f')!.attack).toBe(2); // Ritualist EoT: Fred 1→2
    expect(s.board.find((c) => c.uid === 'lb')!.attack).toBe(4); // Lifebinder mirrored +1
    // And the combat snapshot carried the mirrored Lifebinder (it fought with the gain).
    expect(s.lastCombat!.initial.player.find((m) => m.cardId === 'lifebinder')?.attack).toBe(4);
  });
});
