/**
 * ANCIENTS × FRANTIC FRANK (owner pairings 2026-09-30). Clearance: "Refresh the Shop. Its minions cost 2 Gold this
 * turn." (1 Gold, once per turn). "Clearance minions" = minions bought from a Clearance-marked Shop. Each pairing in
 * the phase(s) it fires in, with real-time ordering where it matters (War's stacks land mid-fight).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_CLEARANCE_STACK_FLAG, ANCIENT_IDS, activePowers, ancientClearanceAvengeLeft, ancientClearanceUsesBadge, ancientCombatMods, ancientOfferText, createRun, defIsTribe, enableAncients,
  heroPowerCostOf, heroPowerText, offerBuyPrice, poolOf, reduce, sellValueOf,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';

const BASE = 'Refresh the Shop. Its minions cost 2 Gold this turn.';
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** An effect-less Tier 1 body (so a death, a play or a sale never muddies the numbers). */
const T1 = 'hm_test_squire';
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'frank'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const clearance = (s: RunState): RunState => reduce(s, { type: 'heroPower' });
const minionOffers = (s: RunState) => s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });
const foes = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
/** Buy the first Clearance minion offer and play it; returns the run and the played uid. */
const buyAndPlay = (s: RunState): { s: RunState; uid: string } => {
  const offer = minionOffers(s)[0]!;
  let t = reduce(s, { type: 'buy', uid: offer.uid });
  const bought = t.hand[t.hand.length - 1]!;
  t = reduce(t, { type: 'play', uid: bought.uid });
  return { s: t, uid: bought.uid };
};

describe('Frank × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('frank', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('frank', id)).not.toMatch(/—|--/);
    }
  });
  it('the fixture is an effect-less Tier 1 minion', () => {
    expect(CARD_INDEX[T1]!.tier).toBe(1);
    expect(CARD_INDEX[T1]!.effects.length).toBe(0);
  });
  it('without Ancients, Clearance stamps no Clearance marks (every other run is byte-identical)', () => {
    const s = clearance(base());
    expect(minionOffers(s).length).toBeGreaterThan(0);
    for (const o of minionOffers(s)) {
      expect(o.cost).toBe(2);
      expect(o.clearance).toBeUndefined();
      expect(o.clearanceFree).toBeUndefined();
    }
  });
});

describe('Frank × DEATH — Clearance destroys your left-most minion; the first minion you buy from it is free', () => {
  it('destroys the left-most board minion and stamps the Clearance offers free', () => {
    let s = picked('death', { board: [card('a', T1), card('b', T1)] });
    s = clearance(s);
    expect(s.board.map((c) => c.uid)).toEqual(['b']);
    expect(minionOffers(s).length).toBeGreaterThan(1);
    for (const o of minionOffers(s)) {
      expect(o.clearance).toBe(true);
      expect(o.cost).toBe(0);
      expect(offerBuyPrice(s, o).cost).toBe(0);
    }
  });
  it('the destroy plays its own Shop death beat on the left-most minion', () => {
    const s = clearance(picked('death', { board: [card('a', T1), card('b', T1)] }));
    expect((s.shopDeathFx ?? []).some((f) => f.kind === 'death' && f.uid === 'a')).toBe(true);
  });
  it('the first buy is free; the rest of the set goes back to the Clearance 2 Gold', () => {
    let s = clearance(picked('death', { board: [card('a', T1)] }));
    const gold = s.embers;
    const [first, second] = minionOffers(s);
    s = reduce(s, { type: 'buy', uid: first!.uid });
    expect(s.embers, 'free').toBe(gold);
    for (const o of minionOffers(s)) {
      expect(o.cost).toBe(2);
      expect(o.clearanceFree).toBeUndefined();
    }
    s = reduce(s, { type: 'buy', uid: second!.uid });
    expect(s.embers).toBe(gold - 2);
  });
  it('an empty board just refreshes (nothing to destroy)', () => {
    const s = clearance(picked('death', { board: [] }));
    expect(s.board.length).toBe(0);
    expect(minionOffers(s).every((o) => o.cost === 0)).toBe(true);
  });
  it('prints the live power: "Free buy ready." only while the free buy waits', () => {
    const idle = picked('death');
    const text = 'Destroy your left-most minion. Refresh the Shop. Its minions cost 2 Gold this turn, and the first one you buy is free.';
    expect(heroPowerText(idle)).toBe(text);
    let s = clearance(idle);
    expect(heroPowerText(s)).toBe(`${text} Free buy ready.`);
    s = reduce(s, { type: 'buy', uid: minionOffers(s)[0]!.uid });
    expect(heroPowerText(s)).toBe(text);
  });
});

describe('Frank × FORTUNE — Clearance minions sell for 2 Gold', () => {
  it('a Clearance minion remembers it, through a fight, and sells for 2', () => {
    let s = clearance(picked('fortune', { board: [card('x', T1, { attack: 1, health: 50 })] }));
    const played = buyAndPlay(s);
    s = played.s;
    expect(at(s, played.uid).clearanceBuy).toBe(true);
    s = fightNow(s, 0, 1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, played.uid).clearanceBuy, 'survives combat').toBe(true);
    expect(sellValueOf(at(s, played.uid), s)).toBe(2);
    const gold = s.embers;
    s = reduce(s, { type: 'sell', uid: played.uid });
    expect(s.embers).toBe(gold + 2);
  });
  it('an ordinary minion still sells for 1', () => {
    const s = clearance(picked('fortune', { board: [card('x', T1)] }));
    expect(sellValueOf(at(s, 'x'), s)).toBe(1);
  });
  it('the mark survives a save round trip (JSON)', () => {
    const s = buyAndPlay(clearance(picked('fortune'))).s;
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.board.some((c) => c.clearanceBuy)).toBe(true);
  });
  it('without Fortune a Clearance minion sells for 1', () => {
    const { s, uid } = buyAndPlay(clearance(picked('bonds')));
    expect(sellValueOf(at(s, uid), s)).toBe(1);
  });
  it('prints the live power', () => {
    expect(heroPowerText(picked('fortune'))).toBe(`${BASE} Minions you buy from it sell for **2 Gold**.`);
  });
});

describe('Frank × WAR — Avenge (3): gain a Clearance stack; each stack is one more Clearance use', () => {
  it('threads the hero Avenge into the fight only while War is picked', () => {
    expect(ancientCombatMods(picked('war')).ancientClearanceStacks).toMatchObject({ every: 3, flag: ANCIENT_CLEARANCE_STACK_FLAG });
    expect(ancientCombatMods(picked('death')).ancientClearanceStacks).toBeUndefined();
  });
  it('gains a stack MID-FIGHT on the 3rd friendly death, and banks it at settle', () => {
    // Four 1/1s into a 100/1000 wall: all four die (deaths 1..4), so exactly one Avenge (3) fires.
    let s = picked('war', { board: ['a', 'b', 'c', 'd'].map((u) => card(u, T1, { attack: 1, health: 1 })) });
    s = fightNow(s, 100, 1000);
    const ev = events(s);
    const stacks = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'questTrigger' && e.flag === ANCIENT_CLEARANCE_STACK_FLAG && e.side === 'player');
    expect(stacks.length).toBe(1);
    const deaths = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'death' && e.side === 'player');
    expect(deaths.length).toBe(4);
    expect(stacks[0]!.i, 'after the 3rd death').toBeGreaterThan(deaths[2]!.i);
    expect(stacks[0]!.i, 'before the 4th death: real time, mid-fight').toBeLessThan(deaths[3]!.i);
    expect(s.lastCombat!.playerAncientClearanceStacks).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.clearanceStacks).toBe(1);
  });
  it('a stack lets Clearance fire again in the same turn, and is spent by it; stacks persist across turns', () => {
    let s = picked('war');
    s = { ...s, ancients: { ...s.ancients!, clearanceStacks: 2 } };
    const gold = s.embers;
    s = clearance(s);
    expect(s.heroReady).toBe(false);
    expect(s.ancients!.clearanceStacks, 'the turn\'s own use takes no stack').toBe(2);
    s = clearance(s);
    expect(s.ancients!.clearanceStacks).toBe(1);
    expect(s.embers, 'each use still costs its 1 Gold').toBe(gold - 2);
    expect(minionOffers(s).every((o) => o.cost === 2 && o.clearance)).toBe(true);
    s = clearance(s);
    expect(s.ancients!.clearanceStacks).toBe(0);
    const spent = clearance(s);
    expect(spent, 'no charge, no stack: refused').toBe(s);
  });
  it("the red uses badge: hidden at one use, 3 with the turn's own use + 2 banked, live with the fight's stacks", () => {
    const s = picked('war');
    expect(ancientClearanceUsesBadge(s), 'one use needs no badge').toBeNull();
    const two = { ...s, ancients: { ...s.ancients!, clearanceStacks: 2 } };
    expect(ancientClearanceUsesBadge(two)).toBe(3);
    expect(ancientClearanceUsesBadge({ ...two, heroReady: false })).toBe(2);
    expect(ancientClearanceUsesBadge({ ...two, heroReady: false, ancients: { ...two.ancients!, clearanceStacks: 1 } }), 'one stack left = one use').toBeNull();
    expect(ancientClearanceUsesBadge(s, 1), 'a stack gained mid-fight counts at once').toBe(2);
    expect(ancientClearanceUsesBadge(picked('death', { ancients: undefined } as never)), 'War only').toBeNull();
  });
  it('the centre Avenge countdown: 3 in the Shop, counting down with the fight’s deaths, resetting after each stack', () => {
    const s = picked('war');
    expect(ancientClearanceAvengeLeft(s)).toBe(3);
    expect([1, 2, 3, 4, 6].map((d) => ancientClearanceAvengeLeft(s, d))).toEqual([2, 1, 3, 2, 3]);
    expect(ancientClearanceAvengeLeft(picked('death')), 'War only').toBeNull();
  });
  it('prints the live stack count, and folds in the fight on screen', () => {
    let s = picked('war');
    s = { ...s, ancients: { ...s.ancients!, clearanceStacks: 2 } };
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (3):** gain a Clearance stack. Each stack is one more use (**2** banked).`);
    expect(heroPowerText(s, 0, { clearanceStacks: 1 })).toContain('(**3** banked)');
  });
});

describe('Frank × GENESIS — Clearance costs 3 Gold and refreshes with minions of your most common type', () => {
  const tribeCard = (s: RunState): { id: string; tribe: string } => {
    const tribe = s.tribes.find((t) => t !== 'neutral')!;
    const d = poolOf(s).buyable.find((c) => c.tier === 1 && !c.spell && !c.ruby && c.tribe === tribe && !c.tribe2)!;
    return { id: d.id, tribe };
  };
  it('costs 3 Gold (refused with 2)', () => {
    const s = picked('genesis', { embers: 2 });
    expect(activePowers(s)[0]!.cost).toBe(3);
    expect(clearance(s)).toBe(s);
  });
  it('every minion offer is your most common type, at the Clearance 2 Gold', () => {
    const probe = picked('genesis');
    const { id, tribe } = tribeCard(probe);
    let s = picked('genesis', { board: [card('a', id), card('b', id)] });
    const gold = s.embers;
    s = clearance(s);
    expect(s.embers).toBe(gold - 3);
    expect(minionOffers(s).length).toBeGreaterThan(0);
    for (const o of minionOffers(s)) {
      expect(defIsTribe(CARD_INDEX[o.cardId], tribe as never), `${o.cardId} is ${tribe}`).toBe(true);
      expect(o.cost).toBe(2);
    }
    expect(s.ancients!.rollTribe, 'the narrowing never outlives the roll').toBeUndefined();
  });
  it('an ordinary refresh after it is not narrowed', () => {
    const { id } = tribeCard(picked('genesis'));
    let s = clearance(picked('genesis', { board: [card('a', id)] }));
    s = reduce(s, { type: 'roll' });
    expect(minionOffers(s).every((o) => o.cost === undefined)).toBe(true);
  });
  it('prints the live type it would refresh into', () => {
    const { id, tribe } = tribeCard(picked('genesis'));
    const label = tribe.charAt(0).toUpperCase() + tribe.slice(1);
    expect(heroPowerText(picked('genesis', { board: [card('a', id)] }))).toBe(`Refresh the Shop with minions of your most common type (**${label}**). Its minions cost 2 Gold this turn.`);
    expect(heroPowerText(picked('genesis', { board: [] }))).toBe('Refresh the Shop with minions of your most common type. Its minions cost 2 Gold this turn.');
  });
});

describe('Frank × TIME — Clearance becomes: the first 3 minions you buy each turn cost 2 Gold', () => {
  it('the power is passive and cannot be activated', () => {
    const s = picked('time');
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(clearance(s)).toBe(s);
  });
  it("a passive power has no price, so no cost coin (Frank's and Albus's Time alike)", () => {
    const s = picked('time');
    expect(heroPowerCostOf(activePowers(s)[0]!, s, 0)).toBe(0);
    expect(heroPowerCostOf(activePowers(picked('death'))[0]!, picked('death'), 0), 'an active Clearance keeps its 1 Gold').toBe(1);
    let albus = enableAncients({ ...createRun(7, 'albus'), phase: 'recruit' } as RunState);
    albus = { ...albus, ancients: { ...albus.ancients!, points: albus.ancients!.cost, offer: ['time', 'death', 'war'] } };
    albus = reduce(albus, { type: 'pickAncient', id: 'time' });
    expect(activePowers(albus)[0]!.passive).toBe(true);
    expect(heroPowerCostOf(activePowers(albus)[0]!, albus, 0)).toBe(0);
  });
  it('the first 3 minion buys cost 2, the 4th pays full price, and the count resets next turn', () => {
    let s = picked('time', { board: [card('x', T1, { attack: 1, health: 50 })] });
    // Four DIFFERENT effect-less minions (no buy completes a triple). The uids avoid `s<n>`: the spell slot uses them.
    const plain = ['hm_test_squire', 'n2_spellsword', 'tara', 'c3_binary'];
    for (const id of plain) expect(CARD_INDEX[id]!.effects.length).toBe(0);
    s = { ...s, shop: ['o1', 'o2', 'o3', 'o4'].map((uid, i) => ({ uid, cardId: plain[i]! })) };
    for (const uid of ['o1', 'o2', 'o3']) {
      // `goldSpent`, not the purse: the run's other buy-count rewards may pay Gold back on a buy.
      const spent = s.goldSpent ?? 0;
      expect(offerBuyPrice(s, s.shop.find((o) => o.uid === uid)!).cost).toBe(2);
      s = reduce(s, { type: 'buy', uid });
      expect((s.goldSpent ?? 0) - spent).toBe(2);
    }
    const spent = s.goldSpent ?? 0;
    s = reduce(s, { type: 'buy', uid: 'o4' });
    expect((s.goldSpent ?? 0) - spent).toBe(3);
    s = fightNow({ ...s, hand: [] }, 0, 1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(offerBuyPrice(s, minionOffers(s)[0]!).cost).toBe(2);
  });
  it('prints the live buys left this turn', () => {
    let s = picked('time');
    expect(heroPowerText(s)).toBe('The first **3** minions you buy each turn cost **2 Gold** (**3** left this turn).');
    s = { ...s, shop: [{ uid: 'o1', cardId: T1 }] };
    s = reduce(s, { type: 'buy', uid: 'o1' });
    expect(heroPowerText(s)).toContain('(**2** left this turn)');
  });
});

describe('Frank × BONDS — selling a Clearance minion gives its stats to a random friendly minion', () => {
  it('the sold Clearance minion\'s CURRENT stats go to the other friendly minion, right then', () => {
    let s = clearance(picked('bonds', { board: [card('x', T1, { attack: 1, health: 1 })] }));
    const played = buyAndPlay(s);
    s = played.s;
    s = { ...s, board: s.board.map((c) => (c.uid === played.uid ? { ...c, attack: 7, health: 9 } : c)) };
    s = reduce(s, { type: 'sell', uid: played.uid });
    expect([at(s, 'x').attack, at(s, 'x').health]).toEqual([8, 10]);
    // Its beat: a buff tendril from the sold minion's slot to the recipient, carrying the stats.
    expect(s.recruitBuffFx).toContainEqual(expect.objectContaining({ sourceUid: played.uid, targetUid: 'x', attack: 7, health: 9, kind: 'deathrattle' }));
  });
  it('an ordinary sale gives nothing', () => {
    let s = picked('bonds', { board: [card('x', T1, { attack: 1, health: 1 }), card('y', T1, { attack: 5, health: 5 })] });
    s = reduce(s, { type: 'sell', uid: 'y' });
    expect([at(s, 'x').attack, at(s, 'x').health]).toEqual([1, 1]);
  });
  it('with no other friendly minion nothing happens', () => {
    const { s, uid } = buyAndPlay(clearance(picked('bonds', { board: [] })));
    const t = reduce(s, { type: 'sell', uid });
    expect(t.board.length).toBe(0);
  });
  it('prints the live power', () => {
    expect(heroPowerText(picked('bonds'))).toBe(`${BASE} Selling a minion you bought from it gives its stats to a random friendly minion.`);
  });
});
