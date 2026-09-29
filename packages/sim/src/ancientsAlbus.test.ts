/**
 * ANCIENTS × ALBUS (owner pairings 2026-09-28). Empowerment: "Choose a Shop minion. Discover a minion from the tier
 * above it for it to become." (1 Gold, once per turn). The pick REPLACES the Shop offer. Each pairing in the phase(s)
 * it fires in, with real-time ordering where it matters (War's payout lands mid-fight).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientCombatMods, ancientOfferText, ancientStartOfTurn, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';

const BASE = 'Choose a Shop minion. Discover a minion from the tier above it for it to become.';
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Effect-less bodies by tier (so a play or a Shout never muddies the numbers). T5B / T4B are the PLAYED cards
 *  (effect-less, no Choose One, so a play lands at once). */
const T1 = 'hm_test_squire', T2 = 'n2_spellsword', T3 = 'tara', T4 = 'dw_brakka', T3B = 'c3_binary', T2B = 'babycub';
/** A Tier 2 minion with an Echo (onDeath) and a Tier 2 without one. */
const ECHO_T2 = 'pack';
const PLAIN_T2 = T2;
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'albus'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const withShop = (s: RunState): RunState => ({ ...s, shop: [{ uid: 's1', cardId: T1 }] });
/** Empower the Tier 1 offer, then force the Discover's options so the pick is known. */
const empowerInto = (s: RunState, pickId: string): RunState => {
  let t = reduce(withShop(s), { type: 'heroPower', uid: 's1' });
  expect(t.discover, 'Empowerment opened its Discover').toBeDefined();
  t = { ...t, discover: [pickId, ...t.discover!.filter((d) => d !== pickId)].slice(0, 3) };
  return reduce(t, { type: 'discover', index: 0 });
};
const foes = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];

describe('Albus × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('albus', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('albus', id)).not.toMatch(/—|--/);
    }
  });
  it('the test fixtures are what they claim', () => {
    expect(CARD_INDEX[ECHO_T2]!.tier).toBe(2);
    expect(CARD_INDEX[ECHO_T2]!.effects.some((e) => e.on === 'onDeath')).toBe(true);
    expect(CARD_INDEX[ECHO_T2]!.keywords).not.toContain('R');
    expect(CARD_INDEX[PLAIN_T2]!.effects.some((e) => e.on === 'onDeath')).toBe(false);
    expect([T1, T2, T3, T4, T3B, T2B].map((id) => CARD_INDEX[id]!.tier)).toEqual([1, 2, 3, 4, 5, 4]);
    expect(CARD_INDEX.strangerevision?.name).toBe('Strange Revision');
  });
});

describe('Albus × DEATH — Echo minions discovered from Empowerment gain Rise', () => {
  it('an Echo pick becomes a Shop offer with Rise, and it keeps Rise when bought', () => {
    let s = empowerInto(picked('death'), ECHO_T2);
    const offer = s.shop.find((o) => o.cardId === ECHO_T2)!;
    expect(offer.keywords).toContain('R');
    s = reduce(s, { type: 'buy', uid: offer.uid });
    expect(s.hand.find((c) => c.cardId === ECHO_T2)!.keywords).toContain('R');
  });
  it('a pick without an Echo gains nothing', () => {
    const s = empowerInto(picked('death'), PLAIN_T2);
    expect(s.shop.find((o) => o.cardId === PLAIN_T2)!.keywords ?? []).not.toContain('R');
  });
  it('an ordinary Discover (not Empowerment) is untouched', () => {
    let s = picked('death');
    s = { ...s, discover: [ECHO_T2] };
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.hand.find((c) => c.cardId === ECHO_T2)!.keywords).not.toContain('R');
  });
  it('prints the live power', () => {
    expect(heroPowerText(picked('death'))).toBe(`${BASE} If it has an **Echo**, it gains **Rise**.`);
  });
});

describe('Albus × FORTUNE — minions discovered by Empowerment are free', () => {
  it('the new offer costs 0 Gold: bought with an empty purse', () => {
    let s = picked('fortune', { embers: 1 });
    s = empowerInto(s, PLAIN_T2);
    expect(s.embers).toBe(0); // the 1 Gold Empowerment itself
    const offer = s.shop.find((o) => o.cardId === PLAIN_T2)!;
    expect(offer.cost).toBe(0);
    s = reduce(s, { type: 'buy', uid: offer.uid });
    expect(s.hand.some((c) => c.cardId === PLAIN_T2), 'bought for 0').toBe(true);
    expect(s.embers).toBe(0);
  });
  it('without Fortune the same offer is not free', () => {
    const s = empowerInto(picked('death', { embers: 1 }), PLAIN_T2);
    expect(s.shop.find((o) => o.cardId === PLAIN_T2)!.cost).toBeUndefined();
  });
  it('prints the live power', () => {
    expect(heroPowerText(picked('fortune'))).toBe(`${BASE} It costs **0 Gold**.`);
  });
});

describe('Albus × GENESIS — Empowerment costs 3 Gold and a copy of the chosen minion goes to hand', () => {
  it('costs 3 Gold (refused with 2)', () => {
    const s = picked('genesis', { embers: 2 });
    expect(activePowers(s)[0]!.cost).toBe(3);
    expect(reduce(withShop(s), { type: 'heroPower', uid: 's1' }).discover).toBeUndefined();
  });
  it('charges 3, the offer becomes the pick, and a plain copy lands in hand', () => {
    let s = picked('genesis', { embers: 3 });
    s = empowerInto(s, PLAIN_T2);
    expect(s.embers).toBe(0);
    expect(s.shop.some((o) => o.cardId === PLAIN_T2)).toBe(true);
    const copy = s.hand.filter((c) => c.cardId === PLAIN_T2);
    expect(copy.length).toBe(1);
    expect(copy[0]!.golden).toBe(false);
  });
  it('prints the live power', () => {
    expect(heroPowerText(picked('genesis'))).toBe(`${BASE} You also get a copy of it in your hand.`);
  });
});

describe('Albus × TIME — Empowerment becomes Start of Turn: Discover a minion from the tier above you', () => {
  it('the power is passive and cannot be activated', () => {
    const s = withShop(picked('time'));
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(reduce(s, { type: 'heroPower', uid: 's1' })).toBe(s);
  });
  it('the next Start of Turn opens a Discover from the tier above the Shop tier, on its own beat', () => {
    let s = picked('time', { board: [card('a', T1, { attack: 50, health: 50 })] });
    const tier = s.tier;
    s = fightNow(s);
    s = reduce(s, { type: 'resolveCombat' });
    const offered = [s.discover ?? [], ...(s.discoverQueue ?? []).map(() => [])].flat();
    expect(offered.length).toBeGreaterThan(0);
    expect(s.tier).toBe(tier);
    for (const id of offered) expect(CARD_INDEX[id]!.tier).toBe(tier + 1);
    const beat = (s.sotBeatFx ?? []).find((b) => b.source.kind === 'hero' && b.source.label === 'Ancient of Time');
    expect(beat?.discovers).toBe(1);
  });
  it('at the top tier it Discovers from your own top tier (Tier 6, or Tier 7 with access)', () => {
    const top = picked('time', { tier: 6 });
    ancientStartOfTurn(top);
    expect(top.discover!.length).toBeGreaterThan(0);
    for (const id of top.discover!) expect(CARD_INDEX[id]!.tier).toBe(6);
    const t7 = picked('time', { tier: 6, tier7Access: true });
    ancientStartOfTurn(t7);
    for (const id of t7.discover!) expect(CARD_INDEX[id]!.tier).toBe(7);
  });
  it('prints the live tier', () => {
    expect(heroPowerText(picked('time', { tier: 3 }))).toBe('**Start of Turn:** **Discover** a minion from the tier above your Shop (**Tier 4**).');
    expect(heroPowerText(picked('time', { tier: 6 }))).toContain('(**Tier 6**)');
  });
});

describe('Albus × WAR — Pummel (80): get 2 Strange Revisions, once per combat', () => {
  it('threads a hero-level Pummel into the fight only while War is picked', () => {
    expect(ancientCombatMods(picked('war')).ancientPummel).toMatchObject({ every: 80, count: 2, cardId: 'strangerevision', dealt: 0 });
    expect(ancientCombatMods(picked('death')).ancientPummel).toBeUndefined();
  });
  it('pays 2 Strange Revisions MID-FIGHT on the hit that crosses 80, once per combat, and settles them into hand', () => {
    // 100 Attack into a 0/400 sandbag: 4 hits = 400 damage, crossing 80 five times; it pays ONCE.
    let s = picked('war', { board: [card('a', T1, { attack: 100, health: 50 })] });
    s = fightNow(s);
    const ev = events(s);
    const grants = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'toHand' && e.cardId === 'strangerevision');
    expect(grants.length, 'once per combat').toBe(2);
    const firstDmg = ev.findIndex((e) => e.type === 'dmg' && e.amount === 100);
    const lastAttack = ev.map((e) => e.type).lastIndexOf('attack');
    expect(grants[0]!.i, 'after the crossing hit').toBeGreaterThan(firstDmg);
    expect(grants[0]!.i, 'mid-fight, before the last swing').toBeLessThan(lastAttack);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.filter((c) => c.cardId === 'strangerevision').length).toBe(2);
    expect(s.ancients!.pummelDealt, 'the lifetime tally carries back').toBe(400);
  });
  it('the tally carries over between combats (70 carried + a 10 hit pays)', () => {
    let s = picked('war', { board: [card('a', T1, { attack: 10, health: 50 })] });
    s = { ...s, ancients: { ...s.ancients!, pummelDealt: 70 } };
    s = fightNow(s, 0, 10);
    expect(events(s).filter((e) => e.type === 'toHand' && e.cardId === 'strangerevision').length).toBe(2);
  });
  it('below the threshold nothing is paid', () => {
    let s = picked('war', { board: [card('a', T1, { attack: 10, health: 50 })] });
    s = fightNow(s, 0, 50);
    expect(events(s).some((e) => e.type === 'toHand' && e.cardId === 'strangerevision')).toBe(false);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.pummelDealt).toBe(50);
  });
  it('prints the live progress, and folds in the fight on screen', () => {
    let s = picked('war');
    s = { ...s, ancients: { ...s.ancients!, pummelDealt: 170 } };
    expect(heroPowerText(s)).toBe(`${BASE} **Pummel (80):** get **2** Strange Revisions. Once per combat. Counts damage dealt by all your minions (**10/80**).`);
    expect(heroPowerText(s, 0, { friendlyDamage: 25 })).toContain('(**35/80**)');
  });
});

describe('Albus × BONDS — playing an odd (even) tier minion gives your other odd (even) tier minions +3/+3', () => {
  const board = (): BoardCard[] => [card('a', T1), card('b', T2), card('c', T3), card('d', T4)];
  it('SHOP: an odd-tier play buffs the other odd-tier minions, not the even ones, not itself', () => {
    let s = picked('bonds', { board: board(), hand: [card('h', T3B)] });
    const before = new Map(s.board.map((c) => [c.uid, [c.attack, c.health]]));
    s = reduce(s, { type: 'play', uid: 'h' });
    const gain = (uid: string): number[] => [at(s, uid).attack - before.get(uid)![0]!, at(s, uid).health - before.get(uid)![1]!];
    expect(gain('a')).toEqual([3, 3]);
    expect(gain('c')).toEqual([3, 3]);
    expect(gain('b')).toEqual([0, 0]);
    expect(gain('d')).toEqual([0, 0]);
    const played = at(s, 'h');
    expect([played.attack, played.health]).toEqual([CARD_INDEX[T3B]!.attack, CARD_INDEX[T3B]!.health]);
  });
  it('SHOP: an even-tier play buffs the other even-tier minions', () => {
    let s = picked('bonds', { board: board(), hand: [card('h', T2B)] });
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(at(s, 'b').attack).toBe(CARD_INDEX[T2]!.attack + 3);
    expect(at(s, 'd').health).toBe(CARD_INDEX[T4]!.health + 3);
    expect(at(s, 'a').attack).toBe(CARD_INDEX[T1]!.attack);
  });
  it('the grant is permanent (it survives a fight on the run card)', () => {
    let s = picked('bonds', { board: [card('a', T1, { attack: 1, health: 50 })], hand: [card('h', T3B)] });
    s = reduce(s, { type: 'play', uid: 'h' });
    s = fightNow(s, 0, 1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'a').attack).toBe(4);
  });
  it('without Bonds nothing is granted', () => {
    let s = picked('death', { board: board(), hand: [card('h', T3B)] });
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(at(s, 'a').attack).toBe(CARD_INDEX[T1]!.attack);
  });
});
