import { describe, it, expect } from 'vitest';
import { makeRng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import {
  createRun,
  reduce,
  serialize,
  deserialize,
  selectThreat,
  buildEnemyBoard,
  THREAT_IDS,
  type BoardCard,
  type RunState,
} from './index';

/** Play greedily to game over: buy an offer, play the hand onto the board, else face the omen. */
function playToEnd(seed: number): RunState {
  let s = createRun(seed);
  let steps = 0;
  while (s.phase !== 'gameover' && steps++ < 10000) {
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

  it('Toxin Tender grants Poison to your highest-attack minion when played', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'g', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'toxin' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.find((c) => c.cardId === 'gnash')?.keywords).toContain('P');
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

  it('Soulfeeder Battlecry consumes the weakest friend and grows', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'v', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'feed' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.length).toBe(1); // the sandbag was eaten
    const feed = s.board.find((c) => c.cardId === 'feed');
    expect(feed?.attack).toBe(3); // 3 + 0
    expect(feed?.health).toBe(6); // 2 + 4
  });

  it('Pactstone Acolyte gains an extra +1/+1 when you consume', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [
        { uid: 'p', cardId: 'pact', tribe: 'demon', attack: 2, health: 3, keywords: [], golden: false },
        { uid: 'v', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 2, keywords: [], golden: false },
      ],
      shop: [{ uid: 'x', cardId: 'feed' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // Soulfeeder eats the sandbag → onConsume
    const pact = s.board.find((c) => c.cardId === 'pact');
    expect(pact?.attack).toBe(3); // 2 + 1
    expect(pact?.health).toBe(4); // 3 + 1
  });

  it('Maw of the Pit gains a Divine Shield when you consume', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [
        { uid: 'm', cardId: 'maw', tribe: 'demon', attack: 4, health: 5, keywords: ['T'], golden: false },
        { uid: 'v', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 2, keywords: [], golden: false },
      ],
      shop: [{ uid: 'x', cardId: 'feed' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.find((c) => c.cardId === 'maw')?.keywords).toContain('DS');
  });

  it('Voracious Imp ignores a non-Fodder summon (a Stray token is not Fodder)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'i', cardId: 'imp', tribe: 'demon', attack: 2, health: 2, keywords: ['CN'], golden: false }],
      shop: [{ uid: 'x', cardId: 'alley' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // Alleycat summons a Stray — not Fodder
    expect(s.board.some((c) => c.cardId === 'stray')).toBe(true); // Stray stays — the Imp won't eat it
    const imp = s.board.find((c) => c.cardId === 'imp');
    expect(imp?.attack).toBe(2); // unchanged — ate nothing
    expect(imp?.health).toBe(2);
  });

  it('Voracious Imp eats a Fodder-keyword minion played beside it (demons need fuel)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'i', cardId: 'imp', tribe: 'demon', attack: 2, health: 2, keywords: ['CN'], golden: false }],
      hand: [{ uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'f' }); // Fred (Fodder) played → Imp consumes it
    expect(s.board.some((c) => c.cardId === 'fred')).toBe(false); // eaten, not placed
    const imp = s.board.find((c) => c.cardId === 'imp');
    expect([imp?.attack, imp?.health]).toEqual([3, 3]); // 2/2 + 1/1
  });

  it('Deathrattle fires out of combat — a Consumed minion triggers it', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      hand: [{ uid: 'f', cardId: 'feed', tribe: 'demon', attack: 3, health: 3, keywords: ['CN'], golden: false }],
      board: [
        { uid: 'sp', cardId: 'spore', tribe: 'undead', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'c', cardId: 'sandbag', tribe: 'neutral', attack: 10, health: 10, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'f' }); // Soulfeeder's Battlecry eats the weakest friend (Sporeling)
    expect(s.board.some((c) => c.uid === 'sp')).toBe(false); // Sporeling was consumed/destroyed
    // Sporeling's Deathrattle (give a friend +1/+1) fired out of combat → the carry grew.
    const carry = s.board.find((c) => c.uid === 'c');
    expect(carry?.attack).toBe(11);
    expect(carry?.health).toBe(11);
  });

  it('always offers one spell on the right of the shop', () => {
    const s = createRun(1);
    expect(s.spell).not.toBeNull();
    expect(CARD_INDEX[s.spell!.cardId]?.spell).toBe(true);
  });

  it('buys a spell into the hand at its own cost (not the minion cost)', () => {
    let s: RunState = { ...createRun(1), embers: 5 };
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
    let s: RunState = { ...createRun(1), embers: 5, board: [] };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const spell = s.hand.find((c) => c.cardId === 'spiritfire')!;
    const after = reduce(s, { type: 'play', uid: spell.uid }); // no targetUid
    expect(after.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // stays in hand
    expect(after.spellsCast).toBe(0);
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
    let s: RunState = { ...createRun(1), hand: [], discover: ['whelp', 'cleric', 'nadir'] };
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

  it('a keyword grant targets a minion that lacks it, never one that already has it', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [
        { uid: 'big', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: ['P'], golden: false },
        { uid: 'mid', cardId: 'cleaver', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false },
      ],
      shop: [{ uid: 'x', cardId: 'toxin' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.find((c) => c.uid === 'mid')?.keywords).toContain('P'); // the one lacking Poison
    expect(s.board.find((c) => c.uid === 'big')?.keywords.filter((k) => k === 'P').length).toBe(1); // not re-granted
  });

  it('tripling combines current stats (top two) and unions keywords', () => {
    const mk = (uid: string, attack: number, health: number, keywords: ('P' | 'T')[]): BoardCard => ({
      uid, cardId: 'sandbag', tribe: 'neutral', attack, health, keywords, golden: false,
    });
    // 1/1 Poison · 2/3 · 1/3  →  3/6 Poison
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [mk('a', 1, 1, ['P']), mk('b', 2, 3, []), mk('c', 1, 3, [])],
    };
    s = reduce(s, { type: 'play', uid: 'a' });
    s = reduce(s, { type: 'play', uid: 'b' });
    s = reduce(s, { type: 'play', uid: 'c' });
    const golden = [...s.board, ...s.hand].find((c) => c.golden)!;
    expect(golden.attack).toBe(3); // 2 + 1 (top two attacks)
    expect(golden.health).toBe(6); // 3 + 3 (top two healths)
    expect(golden.keywords).toContain('P'); // keyword retained across the combine
  });

  it('Doublecast Drummer makes a Battlecry fire twice', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'al' }); // Alleycur Battlecry: summon a Stray → fires twice
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
});
