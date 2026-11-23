/**
 * SET 3 NEW-CONCEPT RUNES, UNDEAD (owner review 2026-11-23): the SHOP / settle halves, through the real reducer and the
 * real Shop chokepoints. The combat halves are `packages/core/src/combat/set3UndeadRunes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { SET3_UNDEAD_RUNES, type CardDef } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { applyRuneGrafts, destroyMinionInShop, makeContext, raiseUndeadAuraShop, socRuneReplaysOf } from './recruit';
import { questCombatMods } from './reducer';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'undead', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const RISER = probe('dbg_s3us_rise', { attack: 5, health: 2, keywords: ['R'] });
const PLAIN = probe('dbg_s3us_plain', { attack: 3, health: 3 });
const NEUTRAL = probe('dbg_s3us_neutral', { tribe: 'neutral', attack: 3, health: 3 });
for (const c of [RISER, PLAIN, NEUTRAL]) CARD_INDEX[c.id] = c;
/** N DISTINCT copies of a probe (distinct ids, so an action boundary never triples them). */
const distinct = (base: CardDef, n: number): string[] => Array.from({ length: n }, (_, i) => {
  const id = `${base.id}_${i}`;
  CARD_INDEX[id] ??= { ...base, id, name: id };
  return id;
});

const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const run = (board: BoardCard[], runes: string[], over: Partial<RunState> = {}): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 0, hand: [], board, ...over } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined };
};
const buy = (s: RunState, cardId: string): RunState => {
  const uid = `o${cardId}${s.uidSeq}`;
  return reduce({ ...s, embers: 10, shop: [{ uid, cardId }] } as RunState, { type: 'buy', uid });
};
const inHand = (s: RunState, cardId: string) => s.hand.filter((c) => c.cardId === cardId);
const fightWave = (s: RunState, foe: { attack: number; health: number }): RunState => {
  const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: foe.attack, health: foe.health, keywords: [] }], seed: 1, origin: 'self' };
  const t = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
  return reduce(t, { type: 'resolveCombat' });
};

describe('the Set 3 Undead new-concept roster (owner review 2026-11-23)', () => {
  it('nine runes, Set 3 only, Undead-gated, Basic in RUNES / Epic in EPIC_RUNES, house style', () => {
    const want: [string, number, boolean][] = [
      ['rune_shallow_graves', 3, false], ['rune_grave_tithe', 2, false], ['rune_dead_weight', 3, false], ['rune_rank_and_file', 2, false],
      ['rune_bone_pile', 3, false], ['rune_second_burial', 4, true], ['rune_night_watch', 3, true], ['rune_requiem', 4, true],
      ['rune_undying_legion', 4, true],
    ];
    for (const [id, cost, epic] of want) {
      const r = RUNE_INDEX[id]!;
      expect([r.cost, !!r.epic, r.sets, r.tribes], id).toEqual([cost, epic, ['set3'], ['undead']]);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
      expect(r.text, `${id}: never Oath / climb`).not.toMatch(/oath|climb/i);
    }
    // The owner notes override the review-board text.
    expect(RUNE_INDEX['rune_shallow_graves']!.text).toBe('The first **Undead** you buy each turn gains **Rise**.');
    expect(RUNE_INDEX['rune_undying_legion']!.text).toBe('**Avenge (5):** get a random **Undead** minion and summon it from hand.');
  });
});

describe('Shallow Graves: the first Undead you buy each turn gains Rise', () => {
  it('the first Undead bought gains Rise; the second that turn does not', () => {
    let s = run([], ['rune_shallow_graves']);
    s = buy(s, PLAIN.id);
    expect(inHand(s, PLAIN.id)[0]!.keywords).toContain('R');
    expect(s.shallowGravesUsedThisTurn).toBe(true);
    s = buy(s, PLAIN.id);
    expect(inHand(s, PLAIN.id).filter((c) => c.keywords.includes('R'))).toHaveLength(1);
  });
  it('a non-Undead buy, or an Undead that already has Rise, does not spend the charge', () => {
    let s = run([], ['rune_shallow_graves']);
    s = buy(s, NEUTRAL.id);
    expect(inHand(s, NEUTRAL.id)[0]!.keywords).not.toContain('R');
    s = buy(s, RISER.id);
    expect(s.shallowGravesUsedThisTurn).toBeFalsy();
    s = buy(s, PLAIN.id);
    expect(inHand(s, PLAIN.id)[0]!.keywords).toContain('R');
  });
  it('without the rune nothing gains Rise; the charge returns at the turn flip', () => {
    expect(inHand(buy(run([], []), PLAIN.id), PLAIN.id)[0]!.keywords).not.toContain('R');
    let s = run([card(PLAIN.id, 'p')], ['rune_shallow_graves']);
    s = buy(s, PLAIN.id);
    s = fightWave({ ...s, hand: [] }, { attack: 0, health: 1 });
    expect(s.shallowGravesUsedThisTurn).toBeFalsy();
  });
});

describe('Dead Weight: a Shop Overflow raises the Undead Aura +2 Attack', () => {
  it('a summon onto a full board raises the Lantern channel, per copy', () => {
    const full = () => distinct(PLAIN, 7).map((id, i) => card(id, `p${i}`));
    const s = run(full(), ['rune_dead_weight']);
    const before = s.undeadAttackBonus ?? 0;
    makeContext(s).summon(CARD_INDEX['u3_skeleton']!, '');
    expect((s.undeadAttackBonus ?? 0) - before).toBe(SET3_UNDEAD_RUNES.deadWeightAttack);
    const off = run(full(), []);
    makeContext(off).summon(CARD_INDEX['u3_skeleton']!, '');
    expect(off.undeadAttackBonus ?? 0).toBe(before);
  });
  it('threads into combat', () => {
    expect(questCombatMods(run([], ['rune_dead_weight'])).runeDeadWeight).toBe(true);
  });
});

describe('Rank and File: Footmen and Spear Wardens have Taunt', () => {
  it('a Spear Warden and a Footman on the board / in hand carry Taunt; other Undead do not', () => {
    const s = run([card('knit', 'k'), card(PLAIN.id, 'p')], ['rune_rank_and_file'], { hand: [] });
    const fm = card('footman', 'f');
    s.hand.push(fm);
    for (const c of [...s.board, ...s.hand]) applyRuneGrafts(s, c);
    expect(s.board.find((c) => c.uid === 'k')!.keywords).toContain('T');
    expect(fm.keywords).toContain('T');
    expect(s.board.find((c) => c.uid === 'p')!.keywords).not.toContain('T');
  });
  it('a Spear Warden summoned in the Shop arrives with Taunt; without the rune it does not', () => {
    const s = run([], ['rune_rank_and_file']);
    expect(makeContext(s).summon(CARD_INDEX['knit']!, '')!.keywords).toContain('T');
    const off = run([], []);
    expect(makeContext(off).summon(CARD_INDEX['knit']!, '')!.keywords).not.toContain('T');
  });
});

describe('Bone Pile / Night Watch: the Shop twins of the Start of Combat summons (Combat Prowess replays)', () => {
  const fire = (s: RunState, id: string) => { for (const r of socRuneReplaysOf(s)) if (r.id === id) r.fire(s); };
  it('Bone Pile: a Skeleton for every 2 Undead on the board', () => {
    const s = run([...distinct(PLAIN, 4).map((id, i) => card(id, `u${i}`)), card(NEUTRAL.id, 'n')], ['rune_bone_pile']);
    fire(s, 'rune_bone_pile');
    expect(s.board.filter((c) => c.cardId === 'u3_skeleton')).toHaveLength(2);
    expect(socRuneReplaysOf(run([], [])).some((r) => r.id === 'rune_bone_pile')).toBe(false);
  });
  it('Night Watch: a Spear Warden with the run\'s Warden enchant twice', () => {
    const s = run([], ['rune_night_watch'], { cardBuffs: { knit: { attack: 4, health: 2 } } });
    fire(s, 'rune_night_watch');
    const w = s.board.find((c) => c.cardId === 'knit')!;
    const k = CARD_INDEX['knit']!;
    expect([w.attack, w.health]).toEqual([k.attack + 8, k.health + 4]);
  });
});

describe('Second Burial, Shop half: a body that already Rose is destroyed -> a Skeleton with its Attack', () => {
  it('the Rise death does not count; the risen body\'s death does', () => {
    const s = run([card(RISER.id, 'r'), card(PLAIN.id, 'p')], ['rune_second_burial']);
    destroyMinionInShop(makeContext(s), s.board.find((c) => c.uid === 'r')!);
    expect(s.board.filter((c) => c.cardId === 'u3_skeleton')).toHaveLength(0);
    const risen = s.board.find((c) => c.cardId === RISER.id)!;
    expect(risen).toBeDefined();
    risen.attack = 7; // grown since its return
    destroyMinionInShop(makeContext(s), risen);
    const sk = s.board.filter((c) => c.cardId === 'u3_skeleton');
    expect(sk).toHaveLength(1);
    expect(sk[0]!.attack).toBeGreaterThanOrEqual(7);
  });
  it('without the rune: no Skeleton', () => {
    const s = run([card(RISER.id, 'r')], []);
    destroyMinionInShop(makeContext(s), s.board[0]!);
    destroyMinionInShop(makeContext(s), s.board.find((c) => c.cardId === RISER.id)!);
    expect(s.board.filter((c) => c.cardId === 'u3_skeleton')).toHaveLength(0);
  });
});

describe('Requiem, Shop half: an Undead Aura rise gives your Undead +1/+1 permanently (5 times per turn)', () => {
  it('each Shop Aura rise pays the board Undead, never a neutral', () => {
    const s = run([card(PLAIN.id, 'p'), card(NEUTRAL.id, 'n')], ['rune_requiem']);
    raiseUndeadAuraShop(s, 1);
    const p = s.board.find((c) => c.uid === 'p')!;
    expect([p.attack, p.health]).toEqual([PLAIN.attack + 1, PLAIN.health + 1]);
    expect(s.board.find((c) => c.uid === 'n')!.attack).toBe(NEUTRAL.attack);
  });
  it('caps at 5 a turn; the combat gets what the Shop left; the budget returns next turn', () => {
    let s = run([card(PLAIN.id, 'p')], ['rune_requiem']);
    raiseUndeadAuraShop(s, 1); raiseUndeadAuraShop(s, 1);
    expect(questCombatMods(s).requiemLeft).toBe(3);
    for (let i = 0; i < 6; i++) raiseUndeadAuraShop(s, 1);
    expect(s.requiemUsedThisTurn).toBe(SET3_UNDEAD_RUNES.requiemPerTurn);
    expect(s.board[0]!.attack).toBe(PLAIN.attack + 5);
    expect(questCombatMods(s).requiemLeft).toBe(0);
    s = fightWave(s, { attack: 0, health: 1 });
    expect(s.requiemUsedThisTurn).toBeFalsy();
  });
  it('without the rune the Aura rise grants nothing', () => {
    const s = run([card(PLAIN.id, 'p')], []);
    raiseUndeadAuraShop(s, 1);
    expect(s.board[0]!.attack).toBe(PLAIN.attack);
  });
});

describe('Grave Tithe / Undying Legion: the combat payouts land at settle', () => {
  it('Grave Tithe: three Rises in the fight bank 2 Gold for the next turn', () => {
    const risers = () => distinct(RISER, 3).map((id, i) => card(id, `r${i}`));
    const s = fightWave(run(risers(), ['rune_grave_tithe']), { attack: 9, health: 900 });
    expect(s.lastCombat?.playerBonusGold ?? 0).toBeGreaterThanOrEqual(SET3_UNDEAD_RUNES.graveTitheGold);
    const off = fightWave(run(risers(), []), { attack: 9, health: 900 });
    expect((s.lastCombat?.playerBonusGold ?? 0) - (off.lastCombat?.playerBonusGold ?? 0)).toBe(SET3_UNDEAD_RUNES.graveTitheGold);
  });
  it('Undying Legion: the 5th friendly death puts a random Undead in the hand', () => {
    const five = () => distinct(NEUTRAL, 5).map((id, i) => card(id, `n${i}`));
    const s = fightWave(run(five(), ['rune_undying_legion']), { attack: 50, health: 900 });
    const undead = s.hand.filter((c) => { const d = CARD_INDEX[c.cardId]!; return d.tribe === 'undead' || d.tribe2 === 'undead' || !!d.universalTribe; });
    expect(undead.length).toBeGreaterThanOrEqual(1);
    const off = fightWave(run(five(), []), { attack: 50, health: 900 });
    expect(off.hand.filter((c) => CARD_INDEX[c.cardId]?.tribe === 'undead')).toHaveLength(0);
  });
});
