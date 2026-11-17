/**
 * ANCIENTS × BRACKUS (owner pairings 2026-10-06). Summit (passive): "At the start of the game, Discover a Tier 7 minion.
 * It is locked until you spend 70 Gold." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_SUMMIT_AVENGE_FLAG, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';
import { destroyMinionInShop, handCardLocked, isTribe, makeContext } from './recruit';

const BASE = 'At the start of the game, **Discover** a **Tier 7** minion. It is locked until you spend **70 Gold**.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman && c.tier < 7).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
const T7 = 'uron'; // a plain 7/7 Tier 7
const T7B = 'zyff'; // a plain 6/6 Tier 7
const T5 = 'drummer'; // a plain Tier 5 (Drakko: a text-only rule card, inert here)
/** A Tier 6 minion with no effects (its keywords do not matter to these tests). */
const T6 = Object.values(CARD_INDEX).find((c) => !!c && c.tier === 6 && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && !c.universalTribe)!.id;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
// createRun('brackus') opens the Summit Discover; the tests stage the pick themselves.
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'brackus'), phase: 'recruit', embers: 400, hand: [], discover: undefined, discoverQueue: undefined, discoverLockGold: undefined, ...over } as RunState);
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
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const offer = (uid: string, cardId: string, cost?: number): ShopCard => ({ uid, cardId, ...(cost !== undefined ? { cost } : {}) } as ShopCard);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const inHand = (s: RunState, uid: string): BoardCard => s.hand.find((c) => c.uid === uid)!;
/** Spend exactly `gold` through the real buy path (a set-price offer). */
const spend = (s: RunState, gold: number, u = 'spend'): RunState => {
  const next = reduce({ ...s, shop: [offer(u, N(0), gold)] }, { type: 'buy', uid: u });
  expect(next, `spent ${gold}`).not.toBe(s);
  return next;
};
const tier7Ids = (s: RunState) => (s.discover ?? []).map((id) => CARD_INDEX[id]?.tier);

describe('Brackus × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('brackus', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('brackus', id)).not.toMatch(/—|--/);
    }
  });
  it('without Ancients, Summit still opens its locked Tier 7 Discover and the power text is the base', () => {
    const s = createRun(7, 'brackus');
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.discoverLockGold).toBe(70);
    expect(heroPowerText(s)).toBe(BASE);
    expect(s.ancients).toBeUndefined();
  });
});

describe('Brackus × DEATH (ancient pass 1, owner 2026-11-16): "Avenge (3): give all Tier 5 and Tier 6 minions +6/+6" (hand / Shop too)', () => {
  it('Shop: the 3rd friendly death gives every Tier 5 and Tier 6 on the board, in hand AND in the Shop +6/+6; Tier 7 and others get nothing', () => {
    let s = picked('death', {
      board: [card('a', T5, { attack: 1, health: 7 }), card('z', T7B), card('p', 'n2_spellsword'), card('d1', N(2)), card('d2', N(2)), card('d3', N(2))],
      hand: [card('h', T6)],
      shop: [offer('o6', T6), offer('o7', T7), offer('o1', N(3))],
    });
    s = structuredClone(s);
    destroyMinionInShop(makeContext(s), at(s, 'd1'));
    destroyMinionInShop(makeContext(s), at(s, 'd2'));
    expect(s.ancients!.brackusDeaths).toBe(2);
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (3):** give all Tier 5 and Tier 6 minions **+6/+6**, in your warband, your hand and the Shop (**1** more to go).`);
    expect(ancientAvengeCountdown(s)).toBe(1);
    destroyMinionInShop(makeContext(s), at(s, 'd3'));
    expect(s.ancients!.brackusDeaths).toBe(0);
    expect(at(s, 'a')).toMatchObject({ attack: 7, health: 13 });
    expect(inHand(s, 'h')).toMatchObject({ attack: CARD_INDEX[T6]!.attack + 6, health: CARD_INDEX[T6]!.health + 6 });
    expect(s.shop.find((o) => o.uid === 'o6')).toMatchObject({ atk: 6, hp: 6 });
    expect(s.shop.find((o) => o.uid === 'o7')!.atk ?? 0, 'Tier 7 no longer').toBe(0);
    expect(at(s, 'z').attack, 'Tier 7 no longer').toBe(6);
    expect(s.shop.find((o) => o.uid === 'o1')!.atk ?? 0).toBe(0);
    expect(at(s, 'p').attack, 'a Tier 2 gets nothing').toBe(CARD_INDEX['n2_spellsword']!.attack);
  });
  it('combat: the carried count fires MID-FIGHT on the living Tier 5 / 6 bodies (carried home), Tier 7 untouched; settle pays the hand', () => {
    let s = picked('death', {
      wave: 3,
      board: [card('a', T5, { attack: 1, health: 500 }), card('z', T7B, { health: 500 }), card('f1', N(2), { attack: 1, health: 1 }), card('f2', N(2), { attack: 1, health: 1 })],
      hand: [card('h', T6)],
    });
    s = { ...s, ancients: { ...s.ancients!, brackusDeaths: 2 } };
    expect(ancientCombatMods(s).ancientBrackusAvenge).toEqual({ every: 3, tick: 2, attack: 6, health: 6, flag: ANCIENT_SUMMIT_AVENGE_FLAG, label: 'Ancient of Death', tiers: [5, 6] });
    s = fightNow(s, 2, 60);
    const ev = events(s);
    const pulses = ev.filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === ANCIENT_SUMMIT_AVENGE_FLAG);
    expect(pulses.length).toBeGreaterThanOrEqual(1);
    const fires = pulses.length;
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'a').attack).toBe(1 + 6 * fires);
    expect(at(s, 'z').attack).toBe(6);
    expect(inHand(s, 'h')).toMatchObject({ attack: CARD_INDEX[T6]!.attack + 6 * fires, health: CARD_INDEX[T6]!.health + 6 * fires });
  });
});

describe('Brackus × FORTUNE: "When you spend 50g, Discover a Tier 7 minion."', () => {
  it('every 50 Gold spent (since the pick) opens a Tier 7 Discover; the countdown is printed live', () => {
    let s = picked('fortune', { wave: 3 });
    expect(heroPowerText(s)).toBe(`${BASE} Every **50 Gold** spent, **Discover** a **Tier 7** minion (**50** Gold to go).`);
    s = spend(s, 30, 'x1');
    expect(s.discover).toBeUndefined();
    expect(heroPowerText(s)).toContain('(**20** Gold to go)');
    s = spend(s, 25, 'x2');
    expect(tier7Ids(s).length).toBeGreaterThan(0);
    expect(tier7Ids(s).every((t) => t === 7)).toBe(true);
    expect(s.ancients!.brackusGold).toBe(5);
    expect(heroPowerText(s)).toContain('(**45** Gold to go)');
  });
  it('a big spend opens one Discover per 50 crossed (they queue)', () => {
    const s = spend(picked('fortune', { wave: 3 }), 120);
    expect(tier7Ids(s).length).toBeGreaterThan(0);
    expect(s.discoverQueue?.length).toBe(1);
    expect(s.ancients!.brackusGold).toBe(20);
  });
});

describe('Brackus × WAR (ancient pass 1, owner 2026-11-16): "summon a copy, and get one too if you have room"', () => {
  const summons = (s: RunState) => events(s).filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player' && e.minion.cardId === T7);
  it('the offer names the left-most Tier 7, as the power and the behaviour do (R-ANCFIX-08)', () => {
    expect(ancientOfferText('brackus', 'war')).toContain('your left-most Tier 7 minion');
  });
  it('room: an exact copy of the left-most Tier 7 lands at Start of Combat', () => {
    const s = picked('war', { wave: 3, board: [card('p', N(1)), card('a', T7, { attack: 20, health: 30 }), card('b', T7B)] });
    expect(ancientCombatMods(s).ancientSummitCopy).toEqual({ label: 'Ancient of War', toHand: true });
    expect(heroPowerText(s)).toBe(`${BASE} **Start of Combat:** summon a copy of your left-most Tier 7 minion as soon as you have room. Also get a plain copy of it if your hand has room. Copies **${CARD_INDEX[T7]!.name}**.`);
    const t = fightNow(s, 1, 1000);
    const sm = summons(t);
    expect(sm.length).toBe(1);
    expect(sm[0]!.minion).toMatchObject({ attack: 20, health: 30 });
    expect(events(t).filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === T7B).length).toBe(0);
    const firstAttack = events(t).findIndex((e) => e.type === 'attack');
    expect(events(t).indexOf(sm[0]!)).toBeLessThan(firstAttack);
    // …and a plain copy flies to hand at Start of Combat, live, landing at settle.
    const toHand = events(t).findIndex((e) => e.type === 'toHand' && e.side === 'player' && e.cardId === T7);
    expect(toHand).toBeGreaterThanOrEqual(0);
    expect(toHand).toBeLessThan(firstAttack);
    const after = reduce(t, { type: 'resolveCombat' });
    expect(after.hand.filter((c) => c.cardId === T7).map((c) => [c.attack, c.health]), 'plain').toEqual([[7, 7]]);
  });
  it('a full hand gets no copy (the summon still happens)', () => {
    const full = Array.from({ length: 10 }, (_, i) => card(`h${i}`, N(i)));
    const t = reduce(fightNow(picked('war', { wave: 3, board: [card('a', T7)], hand: full }), 1, 1000), { type: 'resolveCombat' });
    expect(t.hand.filter((c) => c.cardId === T7).length).toBe(0);
  });
  it('full board: the copy waits and lands the moment a slot opens', () => {
    const fodder = [1, 2, 3, 4, 5, 6].map((i) => card(`f${i}`, N(2), { attack: 1, health: 1 }));
    const s = picked('war', { wave: 3, board: [card('a', T7, { health: 500 }), ...fodder] });
    const t = fightNow(s, 3, 1000);
    const sm = summons(t);
    expect(sm.length).toBe(1);
    const firstDeath = events(t).findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(firstDeath).toBeGreaterThanOrEqual(0);
    expect(events(t).indexOf(sm[0]!)).toBeGreaterThan(firstDeath);
  });
  it('no Tier 7 on the board: nothing, and the power says so', () => {
    const s = picked('war', { wave: 3, board: [card('p', N(1))] });
    expect(heroPowerText(s)).toContain(' No Tier 7 in your warband.');
    expect(summons(fightNow(s, 1, 1000)).length).toBe(0);
  });
});

describe('Brackus × GENESIS: "Add 40 gold to Summit. When it triggers, it grants or makes your Tier 7 Gilded."', () => {
  it('a locked Summit pick: the lock grows to 110, and the pick becomes Gilded the moment it unlocks', () => {
    let s = picked('genesis', { wave: 3, hand: [card('s', T7, { lockedUntilGoldSpent: 70 })] });
    expect(inHand(s, 's').lockedUntilGoldSpent).toBe(110);
    expect(heroPowerText(s)).toBe('At the start of the game, **Discover** a **Tier 7** minion. It is locked until you spend **110 Gold**. When it unlocks, it becomes **Gilded** (**110** Gold to go).');
    s = spend(s, 100, 'x1');
    expect(handCardLocked(s, inHand(s, 's'))).toBe(true);
    expect(inHand(s, 's').golden).toBe(false);
    expect(heroPowerText(s)).toContain('(**10** Gold to go)');
    s = spend(s, 10, 'x2');
    expect(handCardLocked(s, inHand(s, 's'))).toBe(false);
    expect(inHand(s, 's')).toMatchObject({ golden: true, attack: 14, health: 14 });
    expect(heroPowerText(s)).toContain('Your Tier 7 is **Gilded**.');
  });
  it('already unlocked (owner: "after 30 more gold"): the Tier 7 becomes Gilded 30 Gold after the pick', () => {
    let s = picked('genesis', { wave: 6, goldSpent: 80, board: [card('s', T7, { lockedUntilGoldSpent: 70 })] });
    expect(at(s, 's').lockedUntilGoldSpent).toBe(70);
    expect(heroPowerText(s)).toBe('At the start of the game, **Discover** a **Tier 7** minion. It is locked until you spend **70 Gold**. Your Tier 7 becomes **Gilded** after you spend **30** more Gold.');
    s = spend(s, 29, 'x1');
    expect(at(s, 's').golden).toBe(false);
    s = spend(s, 1, 'x2');
    expect(at(s, 's')).toMatchObject({ golden: true, attack: 14, health: 14 });
  });
  it('the Summit pick is gone: another Tier 7 is Gilded; holding none, a Gilded copy of the pick is granted', () => {
    let s = picked('genesis', { wave: 6, goldSpent: 80, board: [card('s', T7, { lockedUntilGoldSpent: 70 }), card('b', T7B)] });
    s = reduce(s, { type: 'sell', uid: 's' });
    s = spend(s, 30);
    expect(at(s, 'b').golden).toBe(true);
    let t = picked('genesis', { wave: 6, goldSpent: 80, board: [card('s', T7, { lockedUntilGoldSpent: 70 })] });
    t = reduce(t, { type: 'sell', uid: 's' });
    t = spend(t, 30);
    const granted = t.hand.find((c) => c.cardId === T7);
    expect(granted).toMatchObject({ golden: true, attack: 14, health: 14 });
  });
});

describe('Brackus × TIME (ancient pass 1, owner 2026-11-16): "Discover a Tier 7 minion in 2 turns."', () => {
  /** Tier 7 Discovers open or queued right now. */
  const t7Queued = (s: RunState): number =>
    (tier7Ids(s).length > 0 && tier7Ids(s).every((t) => t === 7) ? 1 : 0)
    + (s.discoverQueue ?? []).filter((q) => q.kind === 'minion' && q.exactTier === 7).length;
  const nextTurn = (s: RunState): RunState => reduce(fightNow({ ...s, discover: undefined, discoverQueue: undefined }, 0, 1), { type: 'resolveCombat' });
  it('two turns after the pick, Start of Turn opens a Tier 7 Discover, once; the countdown is printed live', () => {
    let s = picked('time', { wave: 3 });
    expect(s.ancients!.brackusTimeWave).toBe(5);
    expect(heroPowerText(s)).toBe(`${BASE} **Discover** a **Tier 7** minion in **2** turns (**2** turns to go).`);
    s = nextTurn(s);
    expect(s.wave).toBe(4);
    expect(heroPowerText(s)).toContain('(**next turn**)');
    expect(t7Queued(s)).toBe(0);
    s = nextTurn(s);
    expect(s.wave).toBe(5);
    expect(t7Queued(s)).toBe(1);
    expect(heroPowerText(s)).toContain('(done)');
    s = nextTurn(s);
    expect(s.ancients!.brackusTimeDone).toBe(true);
    expect(t7Queued(s)).toBe(0);
  });
});

describe('Brackus × BONDS (ancient pass 1, owner 2026-11-16): "Your Tier 7 becomes all types and gains Rally: give a minion of each type +10/+10 permanently."', () => {
  const RALLY = 'onRallyBuffOnePerTribe';
  it('every Tier 7 on the board and in hand is all types and carries the Rally (once, never stacked); other tiers do not', () => {
    let s = picked('bonds', { wave: 3, board: [card('a', T7), card('p', N(1))], hand: [card('h', T7B)] });
    expect(heroPowerText(s)).toBe(`${BASE} Your Tier 7 minions are all types and have "**Rally:** give a minion of each type **+10/+10** permanently."`);
    for (const c of [at(s, 'a'), inHand(s, 'h')]) {
      expect(c.allTribes).toBe(true);
      expect(isTribe(c, 'beast') && isTribe(c, 'dragon')).toBe(true);
      expect(c.keywords).toContain('RL');
      expect(c.grantedEffects?.filter((e) => e.do === RALLY)).toHaveLength(1);
    }
    expect(at(s, 'p').allTribes).toBeUndefined();
    expect(at(s, 'p').grantedEffects).toBeUndefined();
    // A new Tier 7 arriving later is stamped at the next action boundary; a second action never stacks it.
    s = reduce({ ...s, shop: [offer('o', T7B, 1)] }, { type: 'buy', uid: 'o' });
    s = reduce(s, { type: 'play', uid: 'h' });
    for (const c of [...s.board, ...s.hand].filter((c) => CARD_INDEX[c.cardId]!.tier === 7)) {
      expect(c.allTribes).toBe(true);
      expect(c.grantedEffects?.filter((e) => e.do === RALLY)).toHaveLength(1);
    }
  });
  /** The Rally's buffs in the fight, per target combat uid (Uron's own rule repeats every Rally, so count the fires). */
  const rallyBuffs = (s: RunState, target: string) => events(s).filter((e): e is Extract<CombatEvent, { type: 'buff' }> =>
    e.type === 'buff' && e.target === target && (e as { key?: string }).key === `factory:${RALLY}:onAttack`);
  it('COMBAT: each time the Tier 7 attacks, one minion of each type gains +10/+10 (the Tier 7 itself collects as all types), PERMANENTLY', () => {
    let s = picked('bonds', { wave: 3, board: [card('a', T7, { health: 900 }), card('w', 'whelpling', { attack: 0, health: 900 })] });
    s = fightNow(s, 1, 3000);
    const [aUid, wUid] = [s.lastCombat!.initial.player[0]!.uid, s.lastCombat!.initial.player[1]!.uid];
    const toW = rallyBuffs(s, wUid);
    expect(toW.length).toBeGreaterThanOrEqual(2);
    expect(toW.every((e) => e.attack === 10 && e.health === 10)).toBe(true);
    const toA = rallyBuffs(s, aUid).length;
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'w')).toMatchObject({ attack: 10 * toW.length, health: 900 + 10 * toW.length });
    expect(at(s, 'a').attack).toBe(7 + 10 * toA);
  });
  it('a Gilded Tier 7 still gives +10/+10 per Rally (a hero grant is never doubled)', () => {
    let s = picked('bonds', { wave: 3, board: [card('a', T7, { health: 900, golden: true }), card('w', 'whelpling', { attack: 0, health: 900 })] });
    s = fightNow(s, 1, 3000);
    const toW = rallyBuffs(s, s.lastCombat!.initial.player[1]!.uid);
    expect(toW.length).toBeGreaterThanOrEqual(1);
    expect(toW.every((e) => e.attack === 10 && e.health === 10)).toBe(true);
  });
  it('another pairing: no types, no Rally', () => {
    const s = picked('death', { wave: 3, board: [card('a', T7)] });
    expect(at(s, 'a').allTribes).toBeUndefined();
    expect(at(s, 'a').grantedEffects).toBeUndefined();
  });
});

describe('Brackus × save / restore and determinism', () => {
  it('the counters survive a JSON round trip', () => {
    let s = spend(picked('fortune', { wave: 3 }), 30);
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain('(**20** Gold to go)');
    let g = picked('genesis', { wave: 3, hand: [card('s', T7, { lockedUntilGoldSpent: 70 })] });
    g = JSON.parse(JSON.stringify(g)) as RunState;
    g = spend(g, 110);
    expect(inHand(g, 's').golden).toBe(true);
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, board: [card('a', T7, { health: 300 }), card('b', N(5), { attack: 3, health: 2 }), card('c', N(6), { attack: 3, health: 2 })], hand: [card('h', T7B)] });
        s = spend(s, 60);
        s = { ...s, discover: undefined, discoverQueue: undefined, ancients: { ...s.ancients!, brackusDeaths: 2 } };
        return reduce(fightNow(s, 4, 200), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
