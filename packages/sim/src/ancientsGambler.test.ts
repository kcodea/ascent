/**
 * ANCIENTS × GAMBLER (owner pairings 2026-11-10). Dice (1 Gold): "Roll a die: gain that much Gold. This power then locks
 * for that many turns." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, GIFT_IDS } from '@game/content';
import {
  ANCIENT_DICE_LOCK_FLAG, ANCIENT_IDS, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients,
  heroPowerText, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
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
  it('combat: the 4th death in the fight pulses mid-fight, and settle shortens the lock (per combat, R-AVENGE-PER-COMBAT-01: the Shop count never comes in)', () => {
    let s = picked('death', { wave: 3, heroDiceLockUntil: 7, board: ['a', 'b', 'c', 'd'].map((u) => card(u, N(0), { attack: 1, health: 1 })) });
    s = { ...s, ancients: { ...s.ancients!, gamblerDeaths: 3 } };
    expect(ancientCombatMods(s).ancientAvengePulse).toEqual({ every: 4, tick: 3, flag: ANCIENT_DICE_LOCK_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    expect((s.lastCombat!.events ?? []).filter((e) => e.type === 'questTrigger' && e.flag === ANCIENT_DICE_LOCK_FLAG).length).toBe(1);
    expect(heroPowerText(s, 0, { friendlyDeaths: 3 }), 'live through the fight: 3 deaths, not yet').toContain('Locked for **4** more turns.');
    expect(heroPowerText(s, 0, { friendlyDeaths: 4 }), 'the 4th death drops the lock right then').toContain('Locked for **3** more turns.');
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.heroDiceLockUntil).toBe(6);
  });
  it('without Death the lock stands', () => {
    const s = structuredClone(picked('war', { wave: 3, heroDiceLockUntil: 6, board: [card('d', N(0))] }));
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.heroDiceLockUntil).toBe(6);
  });
});

describe('Gambler × FORTUNE (ancient pass 2, owner 2026-11-16: "it locks for the average of the 2 die"): "Roll 2 dice. Gain both, and lock for their average."', () => {
  it('gains both dice and locks for their average, rounded up; the first die is the one a plain roll makes', () => {
    let sawRound = false;
    for (let seed = 1; seed <= 12; seed++) {
      const s0 = { ...picked('fortune', { wave: 2 }), rngCursor: seed * 7919 };
      const s = reduce(s0, { type: 'heroPower' });
      const dice = s.ancients!.gamblerRoll!.dice;
      expect(dice.length).toBe(2);
      expect(dice[0]).toBe(plainRoll(s0));
      for (const d of dice) { expect(d).toBeGreaterThanOrEqual(1); expect(d).toBeLessThanOrEqual(6); }
      expect(s.embers).toBe(s0.embers - 1 + dice[0]! + dice[1]!);
      const avg = Math.ceil((dice[0]! + dice[1]!) / 2);
      if ((dice[0]! + dice[1]!) % 2 === 1) sawRound = true;
      expect(s.heroDiceLockUntil).toBe(2 + avg);
      expect(s.heroDiceRoll).toBe(avg);
      expect(heroPowerText(s)).toBe(`Roll **2** dice: gain that much Gold. This power then locks for as many turns as their average, rounded up. Rolled **${dice[0]}** and **${dice[1]}**.`);
    }
    expect(sawRound, 'the seeds include an odd total (the rounding is exercised)').toBe(true);
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

describe('Gambler × TIME (ancient pass 2, owner 2026-11-16): "Roll 1: random Tier 6 spell. Roll 2: random Tier 6 minion. Roll 3: Discover a Gift. 4-6 just give gold."', () => {
  /** A seed whose plain roll is `face` (the Time pairing never draws before the die). */
  const rolling = (face: number): RunState => {
    for (let seed = 1; seed < 400; seed++) {
      const s0 = { ...picked('time', { wave: 3 }), rngCursor: seed * 7919 };
      if (plainRoll(s0) === face) return s0;
    }
    throw new Error(`no seed rolls ${face}`);
  };
  it('the text', () => {
    expect(heroPowerText(picked('time'))).toBe(`${BASE} Roll a **1**: also get a random Tier 6 spell. A **2**: a random Tier 6 minion. A **3**: **Discover** a **Gift**.`);
  });
  it('a 1: the Gold AND a random Tier 6 spell to hand', () => {
    const s0 = rolling(1);
    const s = reduce(s0, { type: 'heroPower' });
    expect(s.embers).toBe(s0.embers - 1 + 1);
    expect(s.hand.length).toBe(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]).toMatchObject({ spell: true, tier: 6 });
  });
  it('a 2: the Gold AND a random Tier 6 minion to hand', () => {
    const s0 = rolling(2);
    const s = reduce(s0, { type: 'heroPower' });
    expect(s.embers).toBe(s0.embers - 1 + 2);
    expect(s.hand.length).toBe(1);
    const d = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(d.tier).toBe(6);
    expect(d.spell).toBeFalsy();
  });
  it('a 3: the Gold AND a Discover of a Gift', () => {
    const s0 = rolling(3);
    const s = reduce(s0, { type: 'heroPower' });
    expect(s.embers).toBe(s0.embers - 1 + 3);
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(GIFT_IDS).toContain(id);
  });
  it('a 4, 5 or 6: just the Gold', () => {
    for (const face of [4, 5, 6]) {
      const s0 = rolling(face);
      const s = reduce(s0, { type: 'heroPower' });
      expect(s.embers).toBe(s0.embers - 1 + face);
      expect(s.hand.length).toBe(0);
      expect(s.discover ?? null).toBeNull();
    }
  });
  it('without Time a 1 gets no card', () => {
    const s0 = rolling(1);
    const s = reduce({ ...s0, ancients: { ...s0.ancients!, picked: 'war' } }, { type: 'heroPower' });
    expect(s.hand.length).toBe(0);
  });
});

describe('Gambler × BONDS (ancient pass 2, owner 2026-11-16): "When you roll, Discover 2 minions of that tier."', () => {
  it('TWO Discovers, each of exactly the rolled Tier, whatever your Shop tier', () => {
    expect(heroPowerText(picked('bonds'))).toBe(`${BASE} When you roll, **Discover** **2** minions of that tier.`);
    for (let seed = 1; seed <= 8; seed++) {
      const s0 = { ...picked('bonds', { tier: 1 }), rngCursor: seed * 7919 };
      let s = reduce(s0, { type: 'heroPower' });
      const roll = s.heroDiceRoll!;
      expect(s.discover?.length).toBeGreaterThan(0);
      for (const id of s.discover!) { expect(CARD_INDEX[id]!.tier).toBe(roll); expect(CARD_INDEX[id]!.spell).toBeFalsy(); }
      expect(s.discoverQueue?.length, 'the second waits behind the first').toBe(1);
      s = reduce(s, { type: 'discover', index: 0 });
      expect(s.discover?.length, 'the second opens').toBeGreaterThan(0);
      for (const id of s.discover!) expect(CARD_INDEX[id]!.tier).toBe(roll);
      s = reduce(s, { type: 'discover', index: 0 });
      expect(s.hand.length).toBe(2);
      expect(s.discover ?? null).toBeNull();
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
