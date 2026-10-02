/**
 * ANCIENTS × TRADESMAN (hero id `hermithank`; owner pairings 2026-10-02). Frugal is PASSIVE: "Shop minions cost 2
 * Gold. Shop upgrades cost 2 more, and rerolls cost 2 Gold." Every pairing in the phase(s) it fires in, plus save /
 * restore and determinism.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_RALLY_GOLD_FLAG, ANCIENT_REFRESH_AVENGE_FLAG, ancientAvengeCountdown, ancientCombatMods, ancientOfferText,
  createRun, enableAncients, fireShopRally, heroPowerText, nextRefreshCostOf, reduce, refreshCostOf, tradesUpgradeCost, upgradeCostOf,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'Shop minions cost 2 Gold. Shop upgrades cost 2 more, and rerolls cost 2 Gold.';
/** An effect-less Tier 1 body (3/3), so a death, a sale or a fight never muddies the numbers. */
const T1 = 'hm_test_squire';
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const OTHER = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.ruby && !c.token && c.id !== T1 && c.effects.length === 0 && c.keywords.length === 0)!.id;
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'hermithank'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const flags = (s: RunState, flag: string): number => events(s).filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === flag).length;
const minionOffer = (s: RunState) => s.shop.find((o) => !o.starform && !CARD_INDEX[o.cardId]?.spell)!;

describe('Tradesman × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('hermithank', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('hermithank', id)).not.toMatch(/—|--/);
    }
  });
  it('the live upgrade price restated in ancients.ts matches the reducer\'s upgradeCostOf', () => {
    const s = picked('time');
    expect(tradesUpgradeCost(s)).toBe(upgradeCostOf(s));
    expect(tradesUpgradeCost({ ...s, upgradeCost: 1, aceTierDiscount: 2 })).toBe(upgradeCostOf({ ...s, upgradeCost: 1, aceTierDiscount: 2 }));
  });
});

describe('Tradesman × DEATH: Avenge (3), gain a free Refresh (Shop and combat, one count)', () => {
  it('every 3rd Shop death banks a free Refresh, right then', () => {
    let s = picked('death', { board: ['a', 'b', 'c', 'd'].map((u) => card(u, OTHER)) });
    s = structuredClone(s);
    const before = s.freeRolls;
    destroyMinionInShop(makeContext(s), at(s, 'a'));
    destroyMinionInShop(makeContext(s), at(s, 'b'));
    expect(s.ancients!.tradesDeaths).toBe(2);
    expect(s.freeRolls).toBe(before);
    destroyMinionInShop(makeContext(s), at(s, 'c'));
    expect(s.ancients!.tradesDeaths, 'the count resets').toBe(0);
    expect(s.freeRolls).toBe(before + 1);
  });
  it('combat: the carried count + this fight\'s deaths fire mid-fight (a questTrigger per Refresh), the Refresh comes home, the remainder carries', () => {
    let s = picked('death', { board: ['a', 'b', 'c', 'd'].map((u) => card(u, T1, { attack: 1, health: 1 })) });
    s = { ...s, ancients: { ...s.ancients!, tradesDeaths: 2 } };
    expect(ancientCombatMods(s).ancientRefreshAvenge).toMatchObject({ every: 3, tick: 2 });
    const rollsBefore = s.freeRolls;
    s = fightNow(s, 100, 1000);
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    expect(deaths).toBe(4);
    const fires = flags(s, ANCIENT_REFRESH_AVENGE_FLAG);
    expect(fires, '(2 + 4) deaths = two Avenge (3) fires').toBe(2);
    expect(s.lastCombat!.playerFreeRolls).toBe(2);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.freeRolls).toBe(rollsBefore + 2);
    expect(s.ancients!.tradesDeaths).toBe((2 + deaths) % 3);
  });
  it('a banked free Refresh is spent by the next roll (0 Gold)', () => {
    let s = picked('death');
    s = { ...s, freeRolls: 1 };
    const gold = s.embers;
    s = reduce(s, { type: 'roll' });
    expect(s.freeRolls).toBe(0);
    expect(s.embers).toBe(gold);
  });
  it('prints the live countdown and the banked Refreshes, folds the fight\'s deaths and Refreshes in, and drives the centre disc', () => {
    const s = picked('death');
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (3):** gain a free Refresh (**3** more to go). Free Refreshes banked: **0**.`);
    const t = { ...s, freeRolls: 2, ancients: { ...s.ancients!, tradesDeaths: 1 } };
    expect(heroPowerText(t)).toContain('(**2** more to go). Free Refreshes banked: **2**.');
    expect(heroPowerText(t, 0, { friendlyDeaths: 2, freeRefreshes: 1 })).toContain('(**3** more to go). Free Refreshes banked: **3**.');
    expect(ancientAvengeCountdown(t, 1)).toBe(1);
  });
});

describe('Tradesman × FORTUNE: when you buy a minion, your next Refresh costs 0', () => {
  const fortuneFree = (s: RunState): boolean => !!s.ancients!.tradesNextRefreshFree;
  it('a minion bought sets ONE pending 0-cost Refresh; more buys never stack it; the bank is untouched', () => {
    let s = picked('fortune');
    const rolls = s.freeRolls;
    expect(refreshCostOf(s)).toBe(2);
    expect(heroPowerText(s)).toContain('Next Refresh free: **No**');
    const offer = minionOffer(s);
    s = reduce(s, { type: 'buy', uid: offer.uid });
    expect(s.hand.some((c) => c.cardId === offer.cardId)).toBe(true);
    expect(fortuneFree(s)).toBe(true);
    expect(refreshCostOf(s), 'the button / bots price').toBe(0);
    expect(nextRefreshCostOf(s)).toBe(0);
    expect(heroPowerText(s)).toContain('Next Refresh free: **Yes**');
    s = reduce(s, { type: 'buy', uid: minionOffer(s).uid });
    expect(s.freeRolls, 'never banks into freeRolls').toBe(rolls);
    // ONE free Refresh, then full price again: two buys did not stack two.
    const gold = s.embers;
    s = reduce(s, { type: 'roll' });
    expect(s.embers, 'the next Refresh costs 0').toBe(gold);
    expect(fortuneFree(s)).toBe(false);
    expect(refreshCostOf(s)).toBe(2);
    s = reduce(s, { type: 'roll' });
    expect(s.embers, 'the one after is paid').toBe(gold - 2);
  });
  it('spent BEFORE a banked free Refresh, which is kept', () => {
    let s = picked('fortune', { freeRolls: 1 });
    s = reduce(s, { type: 'buy', uid: minionOffer(s).uid });
    const gold = s.embers;
    s = reduce(s, { type: 'roll' });
    expect(fortuneFree(s)).toBe(false);
    expect(s.freeRolls, 'the bank is kept').toBe(1);
    expect(s.embers).toBe(gold);
  });
  it('carries across turns until used, and survives a JSON save / restore', () => {
    let s = picked('fortune');
    s = reduce(s, { type: 'buy', uid: minionOffer(s).uid });
    const wave = s.wave;
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.wave).toBe(wave + 1);
    const restored = JSON.parse(JSON.stringify(s)) as RunState;
    expect(fortuneFree(restored), 'carried into the next turn').toBe(true);
    expect(refreshCostOf(restored)).toBe(0);
  });
  it('a spell buy does not count, and without the pairing a minion buy does nothing', () => {
    let s = picked('fortune');
    if (s.spell) {
      s = reduce(s, { type: 'buy', uid: s.spell.uid });
      expect(fortuneFree(s)).toBe(false);
    }
    let plain = enableAncients(base());
    const rolls = plain.freeRolls;
    plain = reduce(plain, { type: 'buy', uid: minionOffer(plain).uid });
    expect(plain.freeRolls).toBe(rolls);
    expect(refreshCostOf(plain)).toBe(2);
  });
});

describe('Tradesman × WAR: your minions gain "Rally: gain 1 Gold next turn"', () => {
  it('every friendly minion (board and hand) carries the Rally keyword and the graft after any action', () => {
    let s = picked('war', { board: [card('a', T1)], hand: [card('h', OTHER)] });
    s = reduce(s, { type: 'freeze' });
    for (const c of [...s.board, ...s.hand]) {
      expect(c.keywords).toContain('RL');
      expect(c.grantedEffects?.filter((e) => e.do === 'rallyGoldNextTurn').length).toBe(1);
    }
    s = reduce(s, { type: 'freeze' });
    expect(at(s, 'a').grantedEffects?.filter((e) => e.do === 'rallyGoldNextTurn').length, 'never stacks').toBe(1);
  });
  it('a bought minion carries it too', () => {
    let s = picked('war');
    const offer = minionOffer(s);
    s = reduce(s, { type: 'buy', uid: offer.uid });
    const got = s.hand.find((c) => c.cardId === offer.cardId)!;
    expect(got.keywords).toContain('RL');
    expect(got.grantedEffects?.some((e) => e.do === 'rallyGoldNextTurn')).toBe(true);
  });
  it('combat: each Rally banks 1 Gold next turn (a questTrigger per fire), paid at the next Shop', () => {
    let s = picked('war', { board: [card('a', T1, { attack: 1, health: 400 }), card('b', T1, { attack: 1, health: 400 })] });
    s = reduce(s, { type: 'freeze' }); // the sweep stamps the graft
    s = fightNow(s, 0, 30);
    const fires = flags(s, ANCIENT_RALLY_GOLD_FLAG);
    const attacks = events(s).filter((e) => e.type === 'attack' && s.lastCombat!.initial.player.some((m) => m.uid === (e as { attacker?: string }).attacker)).length;
    expect(fires).toBeGreaterThan(0);
    if (attacks > 0) expect(fires).toBe(attacks);
    expect(s.lastCombat!.playerBonusGold).toBe(fires);
    expect(heroPowerText(s, 0, { rallyFires: fires })).toContain(`**${fires} Gold** banked for next turn.`);
  });
  it('a Shop Rally (a free Rally) banks the Gold too, and the power prints it', () => {
    let s = picked('war', { board: [card('a', T1)] });
    s = structuredClone(reduce(s, { type: 'freeze' }));
    const before = s.bonusEmbersNextTurn ?? 0;
    fireShopRally(s, at(s, 'a'));
    expect(s.bonusEmbersNextTurn ?? 0).toBe(before + 1);
    expect(heroPowerText(s)).toContain('**1 Gold** banked for next turn.');
  });
  it('a body SUMMONED in combat carries the graft (Mama Pup\'s Pups rally too)', () => {
    const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
      ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])] } as unknown as BoardMinion);
    const fight = (on: boolean) => simulate([bm('pack', 'p', 1, 1)], [bm('sandbag', 'e', 1, 60)], makeRng(3), CARD_INDEX,
      combatSide({ tier: 5, questMods: on ? { ancientRallyGold: { gold: 1 } } : {} }), combatSide({ tier: 5 }));
    const withIt = fight(true);
    const pups = (withIt.events as CombatEvent[]).filter((e) => e.type === 'summon' && e.side === 'player');
    expect(pups.length).toBeGreaterThan(0);
    expect((withIt.events as CombatEvent[]).some((e) => e.type === 'questTrigger' && e.flag === ANCIENT_RALLY_GOLD_FLAG)).toBe(true);
    expect((withIt.playerBonusGold ?? 0)).toBeGreaterThan(0);
    expect(fight(false).playerBonusGold ?? 0).toBe(0);
    expect(JSON.stringify(fight(true).events), 'deterministic').toBe(JSON.stringify(withIt.events));
  });
});

describe('Tradesman × GENESIS: every 2 Refreshes, cast Lasso', () => {
  it('the 2nd Refresh casts Lasso on the FRESH Shop (a stolen minion to hand); free Refreshes count', () => {
    let s = picked('genesis');
    s = reduce(s, { type: 'roll' });
    expect(s.ancients!.tradesRefreshes).toBe(1);
    expect(heroPowerText(s)).toBe(`${BASE} Every **2** Refreshes, cast **Lasso** (**1** more to go).`);
    expect(s.hand.length).toBe(0);
    s = { ...s, freeRolls: 1 };
    s = reduce(s, { type: 'roll' }); // a FREE Refresh
    expect(s.freeRolls).toBe(0);
    expect(s.ancients!.tradesRefreshes).toBe(2);
    expect(s.hand.length, 'Lasso stole a minion').toBe(1);
    expect(s.lassoFx?.[0]?.origin, 'the beam leaves the hero power').toBe('hero');
    expect(s.shop.some((o) => o.uid === s.lassoFx![0]!.offer.uid), 'taken out of the new row').toBe(false);
  });
  it('the cast goes through the real cast pipeline (the run\'s spell count ticks)', () => {
    let s = picked('genesis');
    const cast = s.spellsCast;
    s = reduce(reduce(s, { type: 'roll' }), { type: 'roll' });
    expect(s.spellsCast).toBe(cast + 1);
  });
  it('the turn-start roll is not a Refresh', () => {
    let s = picked('genesis', { board: [card('a', T1, { health: 400 })] });
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.ancients!.tradesRefreshes ?? 0).toBe(0);
  });
});

describe('Tradesman × TIME: End of Turn, reduce the cost of upgrading the Shop by 3', () => {
  it('End of Turn knocks 3 off the FINAL upgrade price (Frugal\'s +2 included), down to 0; the power prints the live price', () => {
    let s = picked('time', { board: [card('a', T1, { health: 400 })], upgradeCost: 7 });
    expect(heroPowerText(s)).toBe(`${BASE} **End of Turn:** reduce the cost of upgrading the Shop by **3**. Upgrading costs **9 Gold** now.`);
    s = fightNow(s);
    expect(s.upgradeCost).toBe(4);
    let low = picked('time', { board: [card('a', T1, { health: 400 })], upgradeCost: 2 });
    expect(upgradeCostOf(low)).toBe(4);
    low = fightNow(low);
    expect(low.upgradeCost, 'the running cost floors at 0').toBe(0);
    expect(upgradeCostOf(low), 'the last 1 eats into Frugal\'s +2 (owner: "Yes, down to 0")').toBe(1);
    expect(tradesUpgradeCost(low)).toBe(upgradeCostOf(low));
    let zero = picked('time', { board: [card('a', T1, { health: 400 })], upgradeCost: 0 });
    zero = fightNow(zero);
    expect(upgradeCostOf(zero), 'the final price floors at 0, never below').toBe(0);
    expect(zero.ancients!.tradesSurchargeOff).toEqual({ tier: zero.tier, gold: 2 });
  });
  it('without the pairing, End of Turn leaves the cost alone', () => {
    const s = fightNow(enableAncients(base({ board: [card('a', T1, { health: 400 })], upgradeCost: 7 })));
    expect(s.upgradeCost).toBe(7);
  });
});

describe('Tradesman × BONDS: refreshing the Shop reduces the cost of upgrading it by 1', () => {
  it('each Refresh, free ones included, knocks 1 off the FINAL price (Frugal\'s +2 included) down to 0; the power prints it', () => {
    let s = picked('bonds', { upgradeCost: 2 });
    expect(upgradeCostOf(s)).toBe(4);
    s = reduce(s, { type: 'roll' });
    expect(s.upgradeCost).toBe(1);
    expect(upgradeCostOf(s)).toBe(3);
    expect(heroPowerText(s)).toContain('Upgrading costs **3 Gold** now.');
    s = reduce({ ...s, freeRolls: 1 }, { type: 'roll' });
    expect(upgradeCostOf(s)).toBe(2);
    expect(s.upgradeCost).toBe(0);
    s = reduce(s, { type: 'roll' });
    expect(upgradeCostOf(s), 'now eating into the surcharge').toBe(1);
    s = reduce(s, { type: 'roll' });
    expect(upgradeCostOf(s)).toBe(0);
    expect(heroPowerText(s)).toContain('Upgrading costs **0 Gold** now.');
    s = reduce(s, { type: 'roll' });
    expect(upgradeCostOf(s), 'floored at 0').toBe(0);
    expect(tradesUpgradeCost(s)).toBe(upgradeCostOf(s));
  });
  it('the eaten surcharge belongs to its tier: upgrading brings Frugal\'s +2 back on the next tier', () => {
    let s = picked('bonds', { upgradeCost: 0 });
    s = reduce(reduce(s, { type: 'roll' }), { type: 'roll' });
    expect(upgradeCostOf(s)).toBe(0);
    const tier = s.tier;
    s = reduce(s, { type: 'upgrade' });
    expect(s.tier).toBe(tier + 1);
    expect(upgradeCostOf(s)).toBe(s.upgradeCost + 2);
  });
  it('the turn-start roll does not cut it', () => {
    let s = picked('bonds', { board: [card('a', T1, { health: 400 })], upgradeCost: 7 });
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    // Only the per-wave discount moved it (never the Ancient).
    const plain = reduce(fightNow(enableAncients(base({ board: [card('a', T1, { health: 400 })], upgradeCost: 7 }))), { type: 'resolveCombat' });
    expect(s.upgradeCost).toBe(plain.upgradeCost);
  });
});

describe('Tradesman: save / restore and determinism', () => {
  it('the running counts survive a JSON save / restore and keep counting', () => {
    let s = picked('genesis');
    s = reduce(s, { type: 'roll' });
    const saved = JSON.parse(JSON.stringify(s)) as RunState;
    expect(saved.ancients!.tradesRefreshes).toBe(1);
    const next = reduce(saved, { type: 'roll' });
    expect(next.hand.length, 'the restored count casts Lasso on the next Refresh').toBe(1);
    let d = picked('death');
    d = { ...d, ancients: { ...d.ancients!, tradesDeaths: 2 } };
    const restored = JSON.parse(JSON.stringify(d)) as RunState;
    expect(ancientCombatMods(restored).ancientRefreshAvenge?.tick).toBe(2);
  });
  it('the same seed and actions give byte-identical runs (every pairing)', () => {
    for (const id of ANCIENT_IDS) {
      const run = (): RunState => {
        let s = picked(id, { board: [card('a', T1, { attack: 1, health: 3 }), card('b', OTHER, { attack: 1, health: 3 })] });
        s = reduce(s, { type: 'roll' });
        s = reduce(s, { type: 'roll' });
        s = reduce(s, { type: 'buy', uid: minionOffer(s).uid });
        s = reduce(fightNow(s, 2, 20), { type: 'resolveCombat' });
        return s;
      };
      expect(JSON.stringify(run()), id).toBe(JSON.stringify(run()));
    }
  });
});
