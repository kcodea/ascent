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
import { destroyMinionInShop, handCardLocked, makeContext } from './recruit';

const BASE = 'At the start of the game, **Discover** a **Tier 7** minion. It is locked until you spend **70 Gold**.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman && c.tier < 7).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
const T7 = 'uron'; // a plain 7/7 Tier 7
const T7B = 'zyff'; // a plain 6/6 Tier 7

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

describe('Brackus × DEATH: "Avenge (3) Give all Tier 7 minions +6/+6." (works in hand / Shop)', () => {
  it('Shop: the 3rd friendly death gives every Tier 7 on the board, in hand AND in the Shop +6/+6; others get nothing', () => {
    let s = picked('death', {
      board: [card('a', T7), card('p', N(1)), card('d1', N(2)), card('d2', N(2)), card('d3', N(2))],
      hand: [card('h', T7B)],
      shop: [offer('o7', T7), offer('o1', N(3))],
    });
    s = structuredClone(s);
    destroyMinionInShop(makeContext(s), at(s, 'd1'));
    destroyMinionInShop(makeContext(s), at(s, 'd2'));
    expect(s.ancients!.brackusDeaths).toBe(2);
    expect(at(s, 'a').attack).toBe(7);
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (3):** give all Tier 7 minions **+6/+6**, in your warband, your hand and the Shop (**1** more to go).`);
    expect(ancientAvengeCountdown(s)).toBe(1);
    destroyMinionInShop(makeContext(s), at(s, 'd3'));
    expect(s.ancients!.brackusDeaths).toBe(0);
    expect(at(s, 'a')).toMatchObject({ attack: 13, health: 13 });
    expect(inHand(s, 'h')).toMatchObject({ attack: 12, health: 12 });
    expect(s.shop.find((o) => o.uid === 'o7')).toMatchObject({ atk: 6, hp: 6 });
    expect(s.shop.find((o) => o.uid === 'o1')!.atk ?? 0).toBe(0);
    expect(at(s, 'p').attack).toBe(CARD_INDEX[N(1)]!.attack);
  });
  it('combat: the carried count fires MID-FIGHT (a live buff on the Tier 7 body that carries home) and settle pays the hand', () => {
    let s = picked('death', {
      wave: 3,
      board: [card('a', T7, { health: 500 }), card('f1', N(2), { attack: 1, health: 1 }), card('f2', N(2), { attack: 1, health: 1 })],
      hand: [card('h', T7B)],
    });
    s = { ...s, ancients: { ...s.ancients!, brackusDeaths: 2 } };
    expect(ancientCombatMods(s).ancientBrackusAvenge).toEqual({ every: 3, tick: 2, attack: 6, health: 6, flag: ANCIENT_SUMMIT_AVENGE_FLAG, label: 'Ancient of Death' });
    expect(heroPowerText(s, 0, { friendlyDeaths: 0 })).toContain('(**1** more to go)');
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 })).toContain('(**3** more to go)');
    s = fightNow(s, 2, 60);
    const ev = events(s);
    const pulses = ev.filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === ANCIENT_SUMMIT_AVENGE_FLAG);
    expect(pulses.length).toBeGreaterThanOrEqual(1);
    const firstDeath = ev.findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(ev.indexOf(pulses[0]!)).toBeGreaterThan(firstDeath);
    const fires = pulses.length;
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.brackusDeaths).toBe((2 + deaths) % 3);
    expect(at(s, 'a').attack).toBe(7 + 6 * fires);
    expect(inHand(s, 'h')).toMatchObject({ attack: 6 + 6 * fires, health: 6 + 6 * fires });
  });
});

describe('Brackus × FORTUNE: "When you spend 50g, Discover a Tier 7 minion."', () => {
  it('every 50 Gold spent (since the pick) opens a Tier 7 Discover; the countdown is printed live', () => {
    let s = picked('fortune', { wave: 3 });
    expect(heroPowerText(s)).toBe(`${BASE} Every time you spend **50 Gold**, **Discover** a **Tier 7** minion (**50** Gold to go).`);
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

describe('Brackus × WAR: "Start of Combat: When you have space, summon a copy of your Tier 7 minion."', () => {
  const summons = (s: RunState) => events(s).filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player' && e.minion.cardId === T7);
  it('room: an exact copy of the left-most Tier 7 lands at Start of Combat', () => {
    const s = picked('war', { wave: 3, board: [card('p', N(1)), card('a', T7, { attack: 20, health: 30 }), card('b', T7B)] });
    expect(ancientCombatMods(s).ancientSummitCopy).toEqual({ label: 'Ancient of War' });
    expect(heroPowerText(s)).toBe(`${BASE} **Start of Combat:** summon a copy of your left-most Tier 7 minion as soon as you have room. Copies **${CARD_INDEX[T7]!.name}**.`);
    const t = fightNow(s, 1, 1000);
    const sm = summons(t);
    expect(sm.length).toBe(1);
    expect(sm[0]!.minion).toMatchObject({ attack: 20, health: 30 });
    expect(events(t).filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === T7B).length).toBe(0);
    const firstAttack = events(t).findIndex((e) => e.type === 'attack');
    expect(events(t).indexOf(sm[0]!)).toBeLessThan(firstAttack);
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

describe('Brackus × TIME: "Discover a Tier 7 minion in 3 turns."', () => {
  /** Tier 7 Discovers open or queued right now. */
  const t7Queued = (s: RunState): number =>
    (tier7Ids(s).length > 0 && tier7Ids(s).every((t) => t === 7) ? 1 : 0)
    + (s.discoverQueue ?? []).filter((q) => q.kind === 'minion' && q.exactTier === 7).length;
  const nextTurn = (s: RunState): RunState => reduce(fightNow({ ...s, discover: undefined, discoverQueue: undefined }, 0, 1), { type: 'resolveCombat' });
  it('three turns after the pick, Start of Turn opens a Tier 7 Discover, once; the countdown is printed live', () => {
    let s = picked('time', { wave: 3 });
    expect(s.ancients!.brackusTimeWave).toBe(6);
    expect(heroPowerText(s)).toBe(`${BASE} **Discover** a **Tier 7** minion in **3** turns (**3** turns to go).`);
    s = nextTurn(s);
    expect(s.wave).toBe(4);
    expect(heroPowerText(s)).toContain('(**2** turns to go)');
    s = nextTurn(s);
    expect(heroPowerText(s)).toContain('(**next turn**)');
    expect(t7Queued(s)).toBe(0);
    s = nextTurn(s);
    expect(s.wave).toBe(6);
    // The Start-of-Turn beat queues it (the Shop opens it once the beats have played, like Albus × Time).
    expect(t7Queued(s)).toBe(1);
    expect(heroPowerText(s)).toContain('(done)');
    s = nextTurn(s);
    expect(s.ancients!.brackusTimeDone).toBe(true);
    expect(t7Queued(s)).toBe(0);
  });
});

describe('Brackus × BONDS: "Your Tier 7 cards gain +1/+1 per card tier when a card is played."', () => {
  it('playing a card gives your OTHER Tier 7 minions (board and hand) +1/+1 per tier of the played card', () => {
    const low = N(0);
    const t = CARD_INDEX[low]!.tier;
    let s = picked('bonds', { wave: 3, board: [card('a', T7)], hand: [card('p', low), card('h', T7B), card('q', N(1))] });
    expect(heroPowerText(s)).toBe(`${BASE} Whenever you play a card, your Tier 7 minions gain **+1/+1** for each tier of that card (**+0/+0** so far).`);
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(at(s, 'a')).toMatchObject({ attack: 7 + t, health: 7 + t });
    expect(inHand(s, 'h')).toMatchObject({ attack: 6 + t, health: 6 + t });
    expect(at(s, 'p').attack).toBe(CARD_INDEX[low]!.attack);
    expect(heroPowerText(s)).toContain(`(**+${t}/+${t}** so far)`);
    // Playing the Tier 7 itself: the other Tier 7 gains +7/+7, the played one does not buff itself.
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(at(s, 'a')).toMatchObject({ attack: 14 + t, health: 14 + t });
    expect(at(s, 'h')).toMatchObject({ attack: 6 + t, health: 6 + t });
  });
  it('a spell played counts by its own tier', () => {
    const spell = Object.values(CARD_INDEX).find((c) => !!c && c.id === 'emberpouch')!;
    let s = picked('bonds', { wave: 3, board: [card('a', T7)], hand: [{ uid: 'sp', cardId: spell.id, tribe: spell.tribe, attack: 0, health: 0, keywords: [], golden: false }] });
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(false);
    expect(at(s, 'a').attack).toBe(7 + spell.tier);
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
