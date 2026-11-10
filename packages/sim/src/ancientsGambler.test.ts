/**
 * ANCIENTS × GAMBLER (owner pairings 2026-11-10). Dice (1 Gold): "Roll a die: gain that much Gold. This power then locks
 * for that many turns." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_DICE_LOCK_FLAG, ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients,
  heroPowerText, offerBuyPrice, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'Roll a die: gain that much Gold. This power then locks for that many turns.';
const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'gambler'), phase: 'recruit', embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const buyFromRow = (s: RunState, cardId: string): RunState => {
  const withOffer: RunState = { ...s, shop: [...s.shop, { uid: `o_${cardId}_${s.uidSeq}`, cardId }] };
  return reduce(withOffer, { type: 'buy', uid: withOffer.shop[withOffer.shop.length - 1]!.uid });
};
/** The die a plain Gambler rolls from this exact state (the control every pairing is compared with). */
const plainRoll = (s: RunState): number => reduce({ ...s, ancientsEnabled: false }, { type: 'heroPower' }).heroDiceRoll!;

describe('Gambler × every Ancient has a written pairing', () => {
  it('all six are written, with no em dash and none of the banned words', () => {
    for (const id of ANCIENT_IDS) {
      const t = ancientOfferText('gambler', id);
      expect(t).not.toBe('Not written yet.');
      expect(t).not.toMatch(/—|--|[Oo]ath|climb/);
    }
  });
});

describe('Gambler × DEATH: "Avenge (4): reduce the Dice lock by 1 turn."', () => {
  it('Shop: the 4th friendly death ends the lock a turn sooner; an unlocked Dice is untouched', () => {
    let s = picked('death', { wave: 3, heroDiceLockUntil: 6, board: [card('d', N(0)), card('e', N(1))] });
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** reduce the lock by **1** turn (**4** more to go). Locked for **3** more turns.`);
    s = structuredClone({ ...s, ancients: { ...s.ancients!, gamblerDeaths: 3 } });
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.heroDiceLockUntil).toBe(5);
    expect(s.ancients!.gamblerDeaths).toBe(0);
    expect(heroPowerText(s)).toContain('Locked for **2** more turns.');
    const open = structuredClone({ ...s, heroDiceLockUntil: 2, ancients: { ...s.ancients!, gamblerDeaths: 3 } });
    destroyMinionInShop(makeContext(open), at(open, 'e'));
    expect(open.heroDiceLockUntil).toBe(2);
    expect(heroPowerText(open)).toContain('Not locked.');
  });
  it('combat: the carried count pulses mid-fight, and settle shortens the lock', () => {
    let s = picked('death', { wave: 3, heroDiceLockUntil: 7, board: [card('a', N(0), { attack: 1, health: 1 })] });
    s = { ...s, ancients: { ...s.ancients!, gamblerDeaths: 3 } };
    expect(ancientCombatMods(s).ancientAvengePulse).toEqual({ every: 4, tick: 3, flag: ANCIENT_DICE_LOCK_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    expect((s.lastCombat!.events ?? []).filter((e) => e.type === 'questTrigger' && e.flag === ANCIENT_DICE_LOCK_FLAG).length).toBe(1);
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 }), 'live through the fight').toContain('Locked for **3** more turns.');
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.heroDiceLockUntil).toBe(6);
  });
  it('without Death the lock stands', () => {
    const s = structuredClone(picked('war', { wave: 3, heroDiceLockUntil: 6, board: [card('d', N(0))] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.heroDiceLockUntil).toBe(6);
  });
});

describe('Gambler × FORTUNE: "Roll 2 dice. Gain both, and lock for the lower one."', () => {
  it('gains both dice and locks for the lower; the first die is the one a plain roll makes', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s0 = { ...picked('fortune', { wave: 2 }), rngCursor: seed * 7919 };
      const s = reduce(s0, { type: 'heroPower' });
      const dice = s.ancients!.gamblerRoll!.dice;
      expect(dice.length).toBe(2);
      expect(dice[0]).toBe(plainRoll(s0));
      for (const d of dice) { expect(d).toBeGreaterThanOrEqual(1); expect(d).toBeLessThanOrEqual(6); }
      expect(s.embers).toBe(s0.embers - 1 + dice[0]! + dice[1]!);
      expect(s.heroDiceLockUntil).toBe(2 + Math.min(dice[0]!, dice[1]!));
      expect(s.heroDiceRoll).toBe(Math.min(dice[0]!, dice[1]!));
      expect(heroPowerText(s)).toBe(`Roll **2** dice: gain that much Gold. This power then locks for as many turns as the lower die. Rolled **${dice[0]}** and **${dice[1]}**.`);
    }
  });
  it('a plain Gambler rolls one die', () => {
    const s0 = base({ wave: 2 });
    const s = reduce(s0, { type: 'heroPower' });
    expect(s.embers).toBe(s0.embers - 1 + s.heroDiceRoll!);
    expect(s.heroDiceLockUntil).toBe(2 + s.heroDiceRoll!);
  });
});

describe('Gambler × WAR: "When you roll, give your minions +3/+3 for each pip."', () => {
  it('every board minion gains +3/+3 per pip, permanently', () => {
    const s0 = picked('war', { board: [card('a', N(0)), card('b', N(1))] });
    const roll = plainRoll(s0);
    const s = reduce(s0, { type: 'heroPower' });
    expect(s.heroDiceRoll).toBe(roll);
    expect(at(s, 'a')).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + 3 * roll, health: CARD_INDEX[N(0)]!.health + 3 * roll });
    expect(at(s, 'b').attack).toBe(CARD_INDEX[N(1)]!.attack + 3 * roll);
    expect(heroPowerText(s)).toBe(`${BASE} When you roll, give your minions **+3/+3** for each pip. This turn: **+${3 * roll}/+${3 * roll}**.`);
    expect(s.recruitBuffFx.some((f) => f.fromHeroPower)).toBe(true);
  });
  it('without War the board is unchanged', () => {
    const s = reduce(picked('time', { board: [card('a', N(0))] }), { type: 'heroPower' });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[N(0)]!.attack);
  });
});

describe('Gambler × GENESIS: "Dice also casts Gamble, using the same roll."', () => {
  it('Gamble is cast with the Dice roll: a card of that Tier arrives, and the cast counts as a spell cast', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s0 = { ...picked('genesis', { tier: 6 }), rngCursor: seed * 104729 };
      const roll = plainRoll(s0);
      const s = reduce(s0, { type: 'heroPower' });
      expect(s.heroDiceRoll).toBe(roll);
      expect(s.gambleRoll?.tier).toBe(roll);
      expect(s.spellsCast).toBe(s0.spellsCast + 1);
      expect(s.hand.length).toBe(1);
      expect(CARD_INDEX[s.hand[0]!.cardId]!.tier).toBe(roll);
      expect(s.ancients!.forcedGambleRoll).toBeUndefined();
    }
  });
  it('without Genesis no Gamble is cast', () => {
    const s = reduce(picked('war'), { type: 'heroPower' });
    expect(s.gambleRoll).toBeUndefined();
    expect(s.hand.length).toBe(0);
  });
});

describe('Gambler × TIME: "While Dice is locked, your first minion each turn costs 1 Gold less."', () => {
  it('locked: the first minion costs 1 less, the second the full price; unlocked: no discount', () => {
    let s = picked('time', { wave: 3, heroDiceLockUntil: 5 });
    const full = offerBuyPrice({ ...s, heroDiceLockUntil: 0 }, { cardId: N(0) }).cost;
    expect(heroPowerText(s)).toBe(`${BASE} While it is locked, your first minion each turn costs **1 Gold** less. Ready this turn.`);
    expect(offerBuyPrice(s, { cardId: N(0) }).cost).toBe(full - 1);
    const before = s.embers;
    s = buyFromRow(s, N(0));
    expect(s.embers).toBe(before - (full - 1));
    expect(offerBuyPrice(s, { cardId: N(1) }).cost).toBe(full);
    expect(heroPowerText(s)).toContain('Used this turn.');
    expect(heroPowerText({ ...s, heroDiceLockUntil: 0 })).toContain('Not locked.');
  });
  it('rolling this turn locks Dice, so the discount is live right away', () => {
    let s = picked('time', { wave: 3 });
    const full = offerBuyPrice(s, { cardId: N(0) }).cost;
    s = reduce(s, { type: 'heroPower' });
    expect(offerBuyPrice(s, { cardId: N(0) }).cost).toBe(full - 1);
  });
  it('without Time there is no discount', () => {
    const s = picked('war', { wave: 3, heroDiceLockUntil: 5 });
    expect(offerBuyPrice(s, { cardId: N(0) }).cost).toBe(offerBuyPrice({ ...s, heroDiceLockUntil: 0 }, { cardId: N(0) }).cost);
  });
});

describe('Gambler × BONDS: "When you roll, Discover a minion of that Tier."', () => {
  it('the Discover offers minions of exactly the rolled Tier, whatever your Shop tier', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s0 = { ...picked('bonds', { tier: 1 }), rngCursor: seed * 7919 };
      const s = reduce(s0, { type: 'heroPower' });
      const roll = s.heroDiceRoll!;
      expect(s.discover?.length).toBeGreaterThan(0);
      for (const id of s.discover!) { expect(CARD_INDEX[id]!.tier).toBe(roll); expect(CARD_INDEX[id]!.spell).toBeFalsy(); }
    }
  });
  it('without Bonds no Discover opens', () => {
    expect(reduce(picked('war'), { type: 'heroPower' }).discover ?? null).toBeNull();
  });
});

describe('Gambler × save / restore and determinism', () => {
  it('the same seed rolls the same dice, across a JSON round trip', () => {
    const mk = (): RunState => ({ ...picked('fortune', { wave: 2, board: [card('a', N(0))] }), rngCursor: 424242 });
    const a = reduce(mk(), { type: 'heroPower' });
    const b = reduce(JSON.parse(JSON.stringify(mk())) as RunState, { type: 'heroPower' });
    expect(b.ancients).toEqual(a.ancients);
    expect(b.embers).toBe(a.embers);
    expect(b.rngCursor).toBe(a.rngCursor);
    expect(b.heroDiceLockUntil).toBe(a.heroDiceLockUntil);
  });
});
