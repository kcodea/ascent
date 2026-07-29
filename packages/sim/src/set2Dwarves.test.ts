import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { ALE_IDS, applyGoldSpent } from './recruit';

/**
 * SET 2 — DWARVES (tranche A). These assert the MECHANICS fire, not merely that the cards exist: a roster test
 * that only counts ids passes just as happily when every effect is inert.
 */

const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const body = (cardId: string, uid = 'm'): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
/** Play a card from hand, which is what fires a Shout. */
const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid });
/**
 * Play a TARGETED Shout minion. Playing it only opens the aim picker (`pendingTarget`); the effect resolves on
 * the follow-up `battlecryTarget` action — the same two steps the UI drives.
 */
const playAimed = (s: RunState, uid: string, targetUid: string): RunState => {
  const opened = reduce(s, { type: 'play', uid });
  expect(opened.pendingTarget?.uid, 'the aim picker never opened').toBe(uid);
  return reduce(opened, { type: 'battlecryTarget', targetUid });
};

describe('the tribe itself', () => {
  it('dwarf is a playable tribe of set 2, and set 1 can never see it', () => {
    expect(poolFor('set2').all.some((c) => c.tribe === 'dwarf')).toBe(true);
    expect(poolFor('set1').all.some((c) => c.tribe === 'dwarf'), 'a Dwarf leaked into set 1').toBe(false);
  });

  it('every tranche-A Dwarf is in the set 2 pool', () => {
    const ids = ['dw_orin', 'dw_ironlung', 'dw_brunni', 'dw_wardkeeper', 'dw_coinfire', 'dw_brakka',
      'dw_runekeg', 'dw_dorrin', 'dw_foreman', 'dw_chirurgeon', 'dw_brewer', 'dw_tapkeeper', 'dw_runemaster'];
    const pool = new Set(poolFor('set2').all.map((c) => c.id));
    for (const id of ids) expect(pool.has(id), `${id} is missing from set 2`).toBe(true);
  });

  it('the token and the rune minion exist but are NOT buyable', () => {
    // A token in the tavern would be a bug; both need to be in CARD_INDEX so they can be summoned/granted.
    expect(CARD_INDEX['dw_soldier']).toBeDefined();
    expect(CARD_INDEX['dw_brill']).toBeDefined();
    const buyable = new Set(poolFor('set2').buyable.map((c) => c.id));
    expect(buyable.has('dw_soldier'), 'the Charging Soldier token is buyable').toBe(false);
  });
});

describe('Ales', () => {
  it('all five Ale ids resolve to real Set 2 spells', () => {
    for (const id of ALE_IDS) {
      const def = CARD_INDEX[id];
      expect(def, `${id} does not exist`).toBeDefined();
      expect(def!.spell, `${id} is not a spell`).toBe(true);
    }
  });

  it('Brunni pours one at End of Turn', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brunni')], hand: [] };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'no Ale was granted').toBe(1);
  });

  it('Doubletap Brewer pours one on its Shout', () => {
    let s = set2();
    s = { ...s, board: [], hand: [body('dw_brewer', 'b')] };
    s = play(s, 'b');
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBe(1);
  });

  it('Tapkeeper pours one per 10 Gold spent, and banks the remainder', () => {
    // The `every` threshold is the dispatcher's job — this pins that it actually applies rather than firing
    // on every coin.
    let s = set2();
    s = { ...s, board: [body('dw_tapkeeper')], hand: [] };
    applyGoldSpent(s, 7);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'fired below the threshold').toBe(0);
    applyGoldSpent(s, 5); // 12 total → one payout, 2 banked
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBe(1);
  });
});

describe('Gold and throughput', () => {
  it('Coinfire Forewoman buffs Dwarves only, Attack only', () => {
    let s = set2();
    const captain = body('dw_ironlung', 'd1');
    const beast = { ...body('dw_brakka', 'b1'), cardId: 'pack', tribe: 'beast' as const };
    s = { ...s, board: [body('dw_coinfire', 'c'), captain, beast] };
    applyGoldSpent(s, 5);
    const d = s.board.find((x) => x.uid === 'd1')!;
    const b = s.board.find((x) => x.uid === 'b1')!;
    expect(d.attack, 'the Dwarf got no Attack').toBe(CARD_INDEX['dw_ironlung']!.attack + 2);
    expect(d.health, 'Health should not move').toBe(CARD_INDEX['dw_ironlung']!.health);
    expect(b.attack, 'a non-Dwarf was buffed').toBe(beast.attack);
  });

  it('Ironlung Captain buffs its OTHER Dwarves, never itself', () => {
    let s = set2();
    const other = body('dw_brunni', 'o');
    s = { ...s, board: [other], hand: [body('dw_ironlung', 'cap')] };
    s = play(s, 'cap');
    expect(s.board.find((x) => x.uid === 'o')!.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 3);
    const cap = s.board.find((x) => x.cardId === 'dw_ironlung')!;
    expect(cap.attack, 'the Captain buffed itself').toBe(CARD_INDEX['dw_ironlung']!.attack);
  });

  it('Quartermaster Dorrin scales with Gold spent THIS TURN', () => {
    let s = set2();
    const target = body('dw_brunni', 't');
    s = { ...s, board: [target], hand: [body('dw_dorrin', 'q')], goldSpentThisTurn: 4 };
    s = playAimed(s, 'q', 't');
    expect(s.board.find((x) => x.uid === 't')!.health).toBe(CARD_INDEX['dw_brunni']!.health + 4);
  });

  it('Dorrin with nothing spent grants nothing — no phantom buff', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brunni', 't')], hand: [body('dw_dorrin', 'q')], goldSpentThisTurn: 0 };
    s = playAimed(s, 'q', 't');
    expect(s.board.find((x) => x.uid === 't')!.health).toBe(CARD_INDEX['dw_brunni']!.health);
  });

  it('Closing-Time Foreman scales with cards played this turn', () => {
    let s = set2();
    // Left-most Dwarf is the recipient; `playedThisTurn` is the multiplier.
    s = { ...s, board: [body('dw_brunni', 'left'), body('dw_foreman', 'f')], playedThisTurn: ['a', 'b', 'c'] };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.board.find((x) => x.uid === 'left')!.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 3);
  });
});

describe('utility Dwarves', () => {
  it('Oathshield Orin gains Ward, and does not double-add it', () => {
    let s = set2();
    s = { ...s, board: [], hand: [body('dw_orin', 'o')] };
    s = play(s, 'o');
    const orin = s.board.find((x) => x.cardId === 'dw_orin')!;
    expect(orin.keywords.filter((k) => k === 'DS').length, 'Ward was added twice').toBe(1);
  });

  it('Wardkeeper raises the run-wide Shop-spell power', () => {
    let s = set2();
    const before = s.spellBonus?.attack ?? 0;
    s = { ...s, board: [], hand: [body('dw_wardkeeper', 'w')] };
    s = play(s, 'w');
    expect(s.spellBonus?.attack ?? 0).toBe(before + 1);
  });

  it('Auric Runemaster gilds its target', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brunni', 't')], hand: [body('dw_runemaster', 'r')] };
    s = playAimed(s, 'r', 't');
    expect(s.board.find((x) => x.uid === 't')!.golden, 'the target was not gilded').toBe(true);
  });

  it('Broad-Axe Brakka just has Cleave', () => {
    expect(CARD_INDEX['dw_brakka']!.keywords).toContain('C');
    expect(CARD_INDEX['dw_brakka']!.effects).toHaveLength(0);
  });
});

describe('Dwarf King, Brill (rune)', () => {
  it('grants a DWARF, not any minion', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brill')], hand: [] };
    applyGoldSpent(s, 10);
    expect(s.hand.length, 'nothing was granted').toBe(1);
    const got = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(got.tribe === 'dwarf' || got.tribe2 === 'dwarf', `granted ${got.name}, not a Dwarf`).toBe(true);
  });
});
