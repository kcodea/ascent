/**
 * DOC BOT — ECONOMY DIFFERENTIALS.
 *
 * Every economy action (buy / sell / reroll / tier-up / triple) is asserted as an EXACT embers delta against
 * the same helper the UI reads (`sellValueOf` / `spellCostReduction` / `heroOfferPrice` / `minionCostOf` /
 * `refreshCostOf` / `upgradeCostOf`) — the "price shown is the price paid" contract (owner reports 2026-07-24,
 * 2026-08-14). The sweep covers every DISTINCT pricing rule the reducer's `buy` case resolves, in its stated
 * priority order (offer.cost > heroOfferPrice > minionCostOverride > minionCostOf), not every card — a card
 * that prices through a rule already swept adds no information.
 *
 * The second half mirrors `combatModScan` for RECRUIT-side quest rewards: every quest in QUEST_DEFS is armed
 * through the REAL reward engine (`devGrant` → `applyQuestReward`) and its reward's MAGNITUDE is asserted
 * against the def's params — not just "state changed". Rewards that cannot be verified headlessly carry an
 * excuse in QUEST_SCAN_EXCUSED (stale-checked + ratcheted, the `phaseRegistry.ts` discipline).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, QUEST_DEFS, RUNES, EPIC_RUNES } from '@game/content';
import type { CardDef, QuestDef, QuestReward } from '@game/core';
import { createRun, type BoardCard, type RunState } from '../state';
import { reduce, minionCostOf, refreshCostOf, upgradeCostOf } from '../reducer';
import { cardBuff, heroOfferPrice, sellValueOf, sellValueWithBonus, spellCostReduction } from '../recruit';
import { poolOf } from '../cardPool';
import { CONFIG } from '../config';

type SetId = Parameters<typeof createRun>[4];

/** A clean recruit-phase run: empty hand/board, a known bankroll, no shop yet. */
function base(setId?: SetId, heroId = 'warden'): RunState {
  const s = createRun(1, heroId, 'ascent', CONFIG.defaultLine, setId);
  s.phase = 'recruit';
  s.hand = [];
  s.board = [];
  s.embers = 50;
  return s;
}

/** A hand/board instance of `def` at base stats (the shape the reducer's own buy produces). */
function inst(uid: string, def: CardDef, extra: Partial<BoardCard> = {}): BoardCard {
  return { uid, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false, ...extra };
}

/** Triggers that can only ever fire mid-combat — a minion whose every effect lives here is economically
 *  inert in the shop, the cleanest probe body: buying/selling it moves NOTHING but the price. */
const COMBAT_ONLY_TRIGGERS = new Set(['onDeath', 'onAttack', 'onKill', 'onDamaged', 'avenge', 'startOfCombat', 'friendlyDemonDealtDamage']);

/** A shop-inert buyable minion of `tier` from the run's pinned pool (no pool has zero-effect minions at every
 *  tier, so "vanilla" here means combat-only effects — which cannot move Gold on a buy/sell). */
function vanillaOf(s: RunState, tier: number): CardDef {
  const c = poolOf(s).buyable.find((d) => !d.spell && !d.ruby && !d.token && !d.noTriple && d.tier === tier
    && (d.effects ?? []).every((e) => COMBAT_ONLY_TRIGGERS.has(e.on)));
  expect(c, `no vanilla tier-${tier} minion in the pinned pool — pick a new probe`).toBeDefined();
  return c!;
}

describe('Doc Bot — buy differentials (every distinct pricing rule)', () => {
  it('default rule: a shop minion costs CONFIG.minionCost at EVERY tier (tier never prices a minion)', () => {
    for (let tier = 1; tier <= 6; tier++) {
      const s = base();
      s.tier = tier;
      const def = vanillaOf(s, tier);
      s.shop = [{ uid: 'o1', cardId: def.id }];
      const after = reduce(s, { type: 'buy', uid: 'o1' });
      expect(after.embers, `tier-${tier} ${def.id} charged wrong`).toBe(s.embers - CONFIG.minionCost);
      expect(after.embers).toBe(s.embers - minionCostOf(s)); // the UI's coin helper agrees
      expect(after.hand.some((c) => c.cardId === def.id)).toBe(true);
    }
  });

  it('offer.cost outranks everything (Moe set-prices / Restocking 2g offers charge their printed number)', () => {
    const s = base();
    const def = vanillaOf(s, 1);
    s.shop = [{ uid: 'o1', cardId: def.id, cost: 5 }];
    const after = reduce(s, { type: 'buy', uid: 'o1' });
    expect(after.embers).toBe(s.embers - 5);
  });

  it("heroOfferPrice: Foreman Flint's Company Rate charges Dwarves flat 2 and non-Dwarves the default", () => {
    const s = base('set2', 'flint');
    const dwarf = poolOf(s).buyable.find((d) => !d.spell && !d.ruby && !d.token && (d.tribe === 'dwarf' || d.tribe2 === 'dwarf'));
    expect(dwarf, 'no Dwarf in the set2 pool').toBeDefined();
    expect(heroOfferPrice(s, { cardId: dwarf!.id })).toBe(2);
    s.shop = [{ uid: 'o1', cardId: dwarf!.id }];
    const after = reduce(s, { type: 'buy', uid: 'o1' });
    expect(after.embers).toBe(s.embers - 2);
    // A non-Dwarf under Flint prices through the default rule.
    const neutral = poolOf(s).buyable.find((d) => !d.spell && !d.ruby && !d.token && d.tribe !== 'dwarf' && d.tribe2 !== 'dwarf' && !d.universalTribe);
    expect(neutral).toBeDefined();
    expect(heroOfferPrice(s, { cardId: neutral!.id })).toBeUndefined();
    const s2 = base('set2', 'flint');
    s2.shop = [{ uid: 'o1', cardId: neutral!.id }];
    expect(reduce(s2, { type: 'buy', uid: 'o1' }).embers).toBe(s2.embers - CONFIG.minionCost);
  });

  it("Tradesman (cheapMinions): minions 2, rerolls 2, tier-ups +2 — the hero's whole price sheet", () => {
    const s = base(undefined, 'hermithank');
    const def = vanillaOf(s, 1);
    s.shop = [{ uid: 'o1', cardId: def.id }];
    expect(minionCostOf(s)).toBe(2);
    expect(reduce(s, { type: 'buy', uid: 'o1' }).embers).toBe(s.embers - 2);
    expect(refreshCostOf(s)).toBe(2);
    const rolled = reduce(s, { type: 'roll' });
    expect(rolled.embers).toBe(s.embers - 2);
    expect(upgradeCostOf(s)).toBe(s.upgradeCost + 2);
    const upped = reduce(s, { type: 'upgrade' });
    expect(upped.embers).toBe(s.embers - (s.upgradeCost + 2));
  });

  it('minionCostOverride (Merchant\'s Mark, via the REAL reward engine) reprices the default rule', () => {
    let s = base();
    s = reduce(s, { type: 'devGrant', kind: 'quest', id: 'q_merchants_mark' });
    expect(s.minionCostOverride).toBe(2);
    const def = vanillaOf(s, 1);
    s.shop = [{ uid: 'o1', cardId: def.id }];
    const bank = s.embers;
    expect(reduce(s, { type: 'buy', uid: 'o1' }).embers).toBe(bank - 2);
  });

  it("freeFirstBuy (Fi's First Pick): the FIRST minion each turn is free, the second pays full", () => {
    let s = base();
    s = reduce(s, { type: 'devGrant', kind: 'quest', id: 'hq_first_pick' });
    expect(s.questFreeFirstBuy).toBe(true);
    const def = vanillaOf(s, 1);
    s.shop = [{ uid: 'o1', cardId: def.id }, { uid: 'o2', cardId: def.id }];
    const bank = s.embers;
    const one = reduce(s, { type: 'buy', uid: 'o1' });
    expect(one.embers, 'first buy was not free').toBe(bank);
    const two = reduce(one, { type: 'buy', uid: 'o2' });
    expect(two.embers, 'second buy must pay full price').toBe(bank - CONFIG.minionCost);
  });

  it('spell slot: charges max(0, cost − spellCostReduction), and the floor really is 0', () => {
    for (const mod of [0, 1, 99]) {
      const s = base();
      const rolled = reduce(s, { type: 'roll' });
      expect(rolled.spell, 'the roll produced no spell offer').toBeTruthy();
      rolled.spellCostMod = mod;
      const def = CARD_INDEX[rolled.spell!.cardId]!;
      const expected = Math.max(0, (def.cost ?? 0) - spellCostReduction(rolled, def));
      const bank = rolled.embers;
      const bought = reduce(rolled, { type: 'buy', uid: rolled.spell!.uid });
      expect(bought.embers, `spell ${def.id} at spellCostMod=${mod}`).toBe(bank - expected);
      expect(bought.hand.some((c) => c.cardId === def.id)).toBe(true);
    }
  });
});

describe('Doc Bot — sell differentials (the sellValueOf contract)', () => {
  it('a vanilla minion sells for CONFIG.sellValue, exactly', () => {
    const s = base();
    const def = vanillaOf(s, 1);
    s.board = [inst('m1', def)];
    expect(sellValueOf(s.board[0]!, s)).toBe(CONFIG.sellValue);
    const after = reduce(s, { type: 'sell', uid: 'm1' });
    expect(after.embers).toBe(s.embers + CONFIG.sellValue);
    expect(after.board).toHaveLength(0);
  });

  it('Hoarder sells flat 2 (golden 4) — the card-specific rule in sellValueOf', () => {
    for (const golden of [false, true]) {
      const s = base();
      const hoarder = CARD_INDEX['hoarder'];
      if (!hoarder) return; // not in the index any more — the rule would be dead code, caught elsewhere
      s.board = [inst('m1', hoarder, { golden })];
      const expected = sellValueOf(s.board[0]!, s);
      expect(expected).toBe(golden ? 4 : 2);
      expect(reduce(s, { type: 'sell', uid: 'm1' }).embers).toBe(s.embers + expected);
    }
  });

  it('per-instance sellBonus (Trail Forager family) is honoured on top of the base value', () => {
    const s = base();
    const def = vanillaOf(s, 1);
    s.board = [inst('m1', def, { sellBonus: 4 })];
    expect(reduce(s, { type: 'sell', uid: 'm1' }).embers).toBe(s.embers + CONFIG.sellValue + 4);
  });

  it('sellOverride 0 (Bargain Bin) wins over everything — the sale pays nothing', () => {
    const s = base();
    const def = vanillaOf(s, 1);
    s.board = [inst('m1', def, { sellOverride: 0 })];
    expect(reduce(s, { type: 'sell', uid: 'm1' }).embers).toBe(s.embers);
  });

  it('Quick Sale (nextSellBonus): paid once via sellValueWithBonus, then SPENT', () => {
    const s = base();
    const def = vanillaOf(s, 1);
    s.board = [inst('m1', def), inst('m2', def)];
    s.nextSellBonus = 2;
    expect(sellValueWithBonus(s.board[0]!, s)).toBe(CONFIG.sellValue + 2);
    const one = reduce(s, { type: 'sell', uid: 'm1' });
    expect(one.embers).toBe(s.embers + CONFIG.sellValue + 2);
    const two = reduce(one, { type: 'sell', uid: 'm2' });
    expect(two.embers, 'the one-shot bonus paid twice').toBe(one.embers + CONFIG.sellValue);
  });
});

describe('Doc Bot — reroll + tier-up differentials', () => {
  it('a reroll charges CONFIG.refreshCost; a banked free roll charges nothing and is consumed', () => {
    const s = base();
    expect(reduce(s, { type: 'roll' }).embers).toBe(s.embers - CONFIG.refreshCost);
    s.freeRolls = 1;
    const free = reduce(s, { type: 'roll' });
    expect(free.embers).toBe(s.embers);
    expect(free.freeRolls).toBe(0);
  });

  it('a tier-up charges the running upgradeCost and re-bases the next price off the table', () => {
    const s = base();
    expect(s.upgradeCost).toBe(CONFIG.upgradeCost[2]);
    expect(upgradeCostOf(s)).toBe(CONFIG.upgradeCost[2]);
    const after = reduce(s, { type: 'upgrade' });
    expect(after.embers).toBe(s.embers - CONFIG.upgradeCost[2]!);
    expect(after.tier).toBe(2);
    expect(after.upgradeCost, 'the next price must re-base from the config table').toBe(CONFIG.upgradeCost[3]);
  });

  it("Ayse's Ace (aceTierDiscount) reduces the charge, floors at 0, and is spent by the upgrade", () => {
    const s = base();
    s.aceTierDiscount = 3;
    expect(upgradeCostOf(s)).toBe(s.upgradeCost - 3);
    const after = reduce(s, { type: 'upgrade' });
    expect(after.embers).toBe(s.embers - (s.upgradeCost - 3));
    expect(after.aceTierDiscount, 'the banked discount must be spent').toBeUndefined();
    const s2 = base();
    s2.aceTierDiscount = 99;
    expect(upgradeCostOf(s2)).toBe(0);
    expect(reduce(s2, { type: 'upgrade' }).embers).toBe(s2.embers);
  });

  it('the per-turn discount: each new wave shaves CONFIG.upgradeDiscountPerWave off the running cost', () => {
    // Drive a REAL wave advance (resolveCombat → advanceCombat), the only place the discount ticks.
    const s = base();
    const costBefore = s.upgradeCost;
    s.phase = 'combat';
    s.lastCombat = { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
    const after = reduce(s, { type: 'resolveCombat' });
    expect(after.wave).toBe(2);
    expect(after.upgradeCost, 'the wave discount did not tick').toBe(Math.max(CONFIG.upgradeCostFloor, costBefore - CONFIG.upgradeDiscountPerWave));
  });
});

describe('Doc Bot — triples (one golden, the doubling rule, the reward exactly once)', () => {
  it('three fresh copies combine into ONE golden at 2× base, consuming all three; playing it grants ONE Discover spell', () => {
    const s = base();
    const def = vanillaOf(s, 1);
    s.hand = [inst('h1', def), inst('h2', def)];
    s.shop = [{ uid: 'o1', cardId: def.id }];
    const after = reduce(s, { type: 'buy', uid: 'o1' });
    expect(after.embers, 'the triple-completing buy still pays full price').toBe(s.embers - CONFIG.minionCost);
    const goldens = [...after.hand, ...after.board].filter((c) => c.cardId === def.id && c.golden);
    const plains = [...after.hand, ...after.board].filter((c) => c.cardId === def.id && !c.golden);
    expect(goldens, 'exactly one golden').toHaveLength(1);
    expect(plains, 'all three copies consumed').toHaveLength(0);
    expect(goldens[0]!.attack, 'golden = two best copies stacked = 2× base for fresh copies').toBe(def.attack * 2);
    expect(goldens[0]!.health).toBe(def.health * 2);
    expect(after.triplesMade).toBe(1);
    // The Triple Reward: playing the golden grants exactly ONE Discover spell into the hand.
    const played = reduce(after, { type: 'play', uid: goldens[0]!.uid });
    expect(played.hand.filter((c) => c.cardId === 'discoverspell'), 'the reward is one Discover spell, exactly once').toHaveLength(1);
    expect(played.triplesMade, 'playing the golden is not a second triple').toBe(1);
  });

  it('buffed copies: the golden keeps the TWO BEST copies\' stats (base ×2 + the best buff), not 3× and not a reset', () => {
    const s = base();
    const def = vanillaOf(s, 1);
    s.hand = [inst('h1', def, { attack: def.attack + 2, health: def.health + 2 }), inst('h2', def)];
    s.shop = [{ uid: 'o1', cardId: def.id }];
    const after = reduce(s, { type: 'buy', uid: 'o1' });
    const g = [...after.hand, ...after.board].find((c) => c.cardId === def.id && c.golden)!;
    expect(g.attack, 'the two best copies: (base+2) + base').toBe(def.attack * 2 + 2);
    expect(g.health).toBe(def.health * 2 + 2);
  });
});

// ── RECRUIT-SIDE QUEST REWARD MAGNITUDES ─────────────────────────────────────────────────────────────────────

/** Why a quest's reward cannot be magnitude-checked headlessly. Keyed by quest id (stale-checked below). */
interface QuestScanExcuse { kind: QuestReward['kind']; why: string; }
const QUEST_SCAN_EXCUSED: Readonly<Record<string, QuestScanExcuse>> = {
  // (empty at landing — every QUEST_DEFS reward kind checked out headlessly. New unverifiable kinds must add
  //  an entry HERE with a verifiable reason, which shows up in review; they can never silently skip.)
};

type Leaf = Exclude<QuestReward, { kind: 'multi' }>;
function leavesOf(r: QuestReward): Leaf[] {
  return r.kind === 'multi' ? r.rewards.flatMap(leavesOf) : [r as Leaf];
}

interface Ctx { before: RunState; after: RunState; def: QuestDef; }
type Checker<K extends Leaf['kind']> = (c: Ctx, r: Extract<QuestReward, { kind: K }>) => string | null;

const all = (s: RunState): BoardCard[] => [...s.hand, ...s.board];
/** Cards that arrived with the reward (uid diff), the observable payload of a `grant`. */
const arrivals = (c: Ctx): BoardCard[] => {
  const beforeUids = new Set(all(c.before).map((x) => x.uid));
  return all(c.after).filter((x) => !beforeUids.has(x.uid));
};
const isTribeDef = (d: CardDef | undefined, t: string): boolean => !!d && (d.tribe === t || d.tribe2 === t || !!d.universalTribe);
const eq = (label: string, got: unknown, want: unknown): string | null =>
  JSON.stringify(got) === JSON.stringify(want) ? null : `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;

/** Quest combat flags that store their `amount` (everything else stores `true`). Field per the reducer. */
const FLAG_AMOUNT_READ: Record<string, (s: RunState) => number | undefined> = {
  oldHunt: (s) => s.questFlags?.oldHunt,
  assemblyLine: (s) => s.questFlags?.assemblyLine,
  burningLegion: (s) => s.questFlags?.burningLegion,
  sharedCircuit: (s) => s.sharedCircuitWard,
  pitWithoutEnd: (s) => s.pitWithoutEndImps,
};
const FLAG_AMOUNT_DEFAULT: Record<string, number> = { assemblyLine: 4, burningLegion: 3 };

/** One checker per reward kind QUEST_DEFS uses: assert the applied MAGNITUDE equals the def's params. */
const CHECKERS: { [K in Leaf['kind']]?: Checker<K> } = {
  gainGold: (c, r) => r.immediate
    ? eq('embers', c.after.embers - c.before.embers, r.amount)
    : eq('bonusEmbersNextTurn', (c.after.bonusEmbersNextTurn ?? 0) - (c.before.bonusEmbersNextTurn ?? 0), r.amount),
  gainMaxGold: (c, r) => eq('maxGoldBonus', (c.after.maxGoldBonus ?? 0) - (c.before.maxGoldBonus ?? 0), r.amount)
    ?? eq('embers (raised max reflects this turn)', c.after.embers - c.before.embers, r.amount),
  minionCost: (c, r) => eq('minionCostOverride', c.after.minionCostOverride, r.cost),
  spellCost: (c, r) => eq('spellCostMod', c.after.spellCostMod - c.before.spellCostMod, r.cost),
  shopBuff: (c, r) => eq('tavernBuyBonus', { a: c.after.tavernBuyBonus.atk - c.before.tavernBuyBonus.atk, h: c.after.tavernBuyBonus.hp - c.before.tavernBuyBonus.hp }, { a: r.attack, h: r.health }),
  shopBuffPerShouts: (c, r) => eq('shopBuffPerShouts', c.after.shopBuffPerShouts, { per: r.per, attack: r.attack, health: r.health, tick: 0 }),
  shopBuffOnRefresh: (c, r) => eq('shopBuffOnRefresh', c.after.shopBuffOnRefresh, { attack: r.attack, health: r.health, step: r.step, per: r.per, grown: 0, tick: 0 }),
  impAura: (c, r) => eq('impBuff', { a: (c.after.impBuff?.attack ?? 0) - (c.before.impBuff?.attack ?? 0), h: (c.after.impBuff?.health ?? 0) - (c.before.impBuff?.health ?? 0) }, { a: r.attack, h: r.health }),
  rubyStatGain: (c, r) => eq('rubyBonus', { a: (c.after.rubyBonus?.attack ?? 0) - (c.before.rubyBonus?.attack ?? 0), h: (c.after.rubyBonus?.health ?? 0) - (c.before.rubyBonus?.health ?? 0) }, { a: r.attack, h: r.health }),
  rubyExtraCasts: (c, r) => r.scope === 'firstEachTurn'
    ? eq('rubyFirstExtraCasts', (c.after.rubyFirstExtraCasts ?? 0) - (c.before.rubyFirstExtraCasts ?? 0), r.amount)
    : eq('rubyExtraCasts', (c.after.rubyExtraCasts ?? 0) - (c.before.rubyExtraCasts ?? 0), r.amount),
  aleExtraCasts: (c, r) => eq('aleExtraCasts', (c.after.aleExtraCasts ?? 0) - (c.before.aleExtraCasts ?? 0), r.amount ?? 1),
  shoutRepeat: (c, r) => r.scope === 'always'
    ? eq('shoutExtraAlways', (c.after.shoutExtraAlways ?? 0) - (c.before.shoutExtraAlways ?? 0), 1)
    : eq('shoutFirstDoubleEachRound', c.after.shoutFirstDoubleEachRound, true),
  echoRepeat: (c, r) => r.scope === 'always'
    ? eq('echoExtraAlways', (c.after.echoExtraAlways ?? 0) - (c.before.echoExtraAlways ?? 0), 1)
    : eq('echoFirstEachCombat', (c.after.echoFirstEachCombat ?? 0) - (c.before.echoFirstEachCombat ?? 0), 1),
  rallyRepeat: (c, r) => r.scope === 'always'
    ? eq('rallyExtraAlways', (c.after.rallyExtraAlways ?? 0) - (c.before.rallyExtraAlways ?? 0), 1)
    : eq('rallyFirstEachCombat', (c.after.rallyFirstEachCombat ?? 0) - (c.before.rallyFirstEachCombat ?? 0), 1),
  spellRepeat: (c, r) => r.scope === 'always'
    ? eq('spellDoubleAlways', c.after.spellDoubleAlways, true)
    : eq('spellFirstDoubleEachTurn', c.after.spellFirstDoubleEachTurn, true),
  endOfTurnRepeat: (c) => eq('endOfTurnExtra', (c.after.endOfTurnExtra ?? 0) - (c.before.endOfTurnExtra ?? 0), 1),
  beastPlayBuff: (c, r) => eq('denMarker', c.after.denMarker, { attack: r.attack, health: r.health, step: r.step, per: r.per, count: 0 }),
  scalingTribeAura: (c, r) => {
    const reg = c.after.questScalingAuras?.find((a) => a.tribe === r.tribe && a.per === r.per);
    if (!reg || reg.stepAttack !== r.stepAttack || reg.stepHealth !== r.stepHealth) return `questScalingAuras entry missing or wrong step (${JSON.stringify(reg)})`;
    // The base grant lands NOW on the pre-placed tribe body — the magnitude check.
    const probe = c.after.board.find((x) => x.uid === 'auraprobe');
    const was = c.before.board.find((x) => x.uid === 'auraprobe');
    if (!probe || !was) return 'aura probe body missing';
    return eq('base aura on a tribe body', { a: probe.attack - was.attack, h: probe.health - was.health }, { a: r.attack, h: r.health });
  },
  undeadSpellAura: (c, r) => eq('forsakenWillAttack', c.after.forsakenWillAttack, r.attack),
  goldFodder: (c, r) => eq('foodForGold', c.after.foodForGold, { per: r.per, attack: r.attack, health: r.health }),
  fodderReward: (c, r) => {
    const freds = (c.after.pendingTavern ?? []).filter((id) => id === 'fred').length - (c.before.pendingTavern ?? []).filter((id) => id === 'fred').length;
    if (freds !== (r.fodder ?? 0)) return `pendingTavern Fodder: got ${freds}, want ${r.fodder ?? 0}`;
    const d = { a: cardBuff(c.after, 'fred').attack - cardBuff(c.before, 'fred').attack, h: cardBuff(c.after, 'fred').health - cardBuff(c.before, 'fred').health };
    return eq('run-wide Fodder buff', d, { a: r.attack ?? 0, h: r.health ?? 0 });
  },
  dupeFirstBuy: (c) => eq('dupeFirstBuyEachTurn', c.after.dupeFirstBuyEachTurn, true),
  freeFirstBuy: (c) => eq('questFreeFirstBuy', c.after.questFreeFirstBuy, true),
  tier7Access: (c) => eq('tier7Access', c.after.tier7Access, true),
  gildCopies: (c, r) => eq('gildCopies', c.after.gildCopies, r.copies),
  upgradeShopTier: (c, r) => eq('tier', c.after.tier - c.before.tier, r.by),
  shoutEdgeBuff: (c, r) => eq('shoutEdgeBuff', { a: (c.after.shoutEdgeBuff?.attack ?? 0) - (c.before.shoutEdgeBuff?.attack ?? 0), h: (c.after.shoutEdgeBuff?.health ?? 0) - (c.before.shoutEdgeBuff?.health ?? 0) }, { a: r.attack, h: r.health }),
  boneThrone: (c, r) => eq('boneThroneStep', c.after.boneThroneStep, r.every),
  attachmentDeal: (c, r) => eq('attachmentCost', c.after.attachmentCost, r.cost) ?? eq('alwaysAttachmentShop', c.after.alwaysAttachmentShop, true),
  friedCircuits: (c, r) => eq('friedCircuits steps', { a: c.after.friedCircuitsStepAtk, h: c.after.friedCircuitsStepHp }, { a: r.stepAttack, h: r.stepHealth }),
  baneDemonAura: (c, r) => eq('baneBuffsDemons', c.after.baneBuffsDemons, { attack: r.attack, health: r.health }),
  motherlode: (c, r) => eq('motherlode', c.after.motherlode, { count: r.count, tribe: r.tribe }),
  tribeRallySlaughterExtra: (c, r) => eq('questTribeRallySlaughter', c.after.questTribeRallySlaughter, r.tribe),
  endlessVerse: (c, r) => eq('spellFirstDoubleEachTurn', c.after.spellFirstDoubleEachTurn, true) ?? eq('endlessVerse', c.after.endlessVerse, { per: r.per, tick: 0 }),
  consumeDoubleFirstEachTurn: (c) => eq('consumeDoubleFirstEachTurn', c.after.consumeDoubleFirstEachTurn, true),
  questGoldTribeBuff: (c, r) => eq('questGoldTribeBuff', c.after.questGoldTribeBuff, { tribe: r.tribe, per: r.per, attack: r.attack, health: r.health, tick: 0 }),
  recurringGrant: (c, r) => (r.everyTurns ?? 1) > 1
    ? (r.cards.every((id) => c.after.runeCadenceGrants?.some((g) => g.cardId === id && g.everyTurns === r.everyTurns)) ? null : 'runeCadenceGrants missing the cadenced card')
    : (r.cards.every((id) => c.after.questRecurringGrants?.includes(id)) ? null : `questRecurringGrants missing ${r.cards.join(',')}`),
  recurringEndOfTurn: (c, r) => {
    const list: string[] = [...(c.after.questRecurringEndOfTurn ?? []), ...(c.after.questRecurringLimited ?? []).map((x) => x.effect)];
    return list.includes(r.effect) ? null : `recurring EoT effect '${r.effect}' not registered`;
  },
  scheduleRuneforge: (c, r) => r.forge === 'basic'
    ? eq('pendingBasicForge', c.after.pendingBasicForge, { gold: r.gold, deferred: true })
    : (c.after.pendingEpicRuneforge || c.after.epicForgeWave != null ? null : 'no epic forge armed'),
  openEpicRuneforge: (c) => eq('pendingEpicRuneforge', c.after.pendingEpicRuneforge, true),
  grantRune: (c, r) => {
    const gained = (c.after.ownedRunes ?? []).filter((id) => !(c.before.ownedRunes ?? []).includes(id));
    if (gained.length !== 1) return `expected exactly 1 granted rune, got ${gained.length}`;
    const pool = (r.rarity === 'epic' ? EPIC_RUNES : RUNES).map((x) => x.id);
    return pool.includes(gained[0]!) ? null : `granted rune ${gained[0]} is not ${r.rarity}`;
  },
  combatFlag: (c, r) => {
    if ((c.after.flagCopies?.[r.flag] ?? 0) !== 1) return `flagCopies[${r.flag}] != 1`;
    const read = FLAG_AMOUNT_READ[r.flag];
    if (read) return eq(`flag ${r.flag} amount`, read(c.after), r.amount ?? FLAG_AMOUNT_DEFAULT[r.flag]);
    const v = (c.after.questFlags as Record<string, unknown> | undefined)?.[r.flag];
    // Amount-carrying rune flags a QUEST might adopt later store numbers; today's quest booleans store true.
    return v === true || (typeof v === 'number' && v === (r.amount ?? v)) ? null : `questFlags.${r.flag} = ${String(v)}`;
  },
  discover: (c, r) => {
    const t = r.tier;
    if (t == null) return null; // derived-tier discovers have no authored magnitude to pin
    if (c.after.discover?.length) {
      return c.after.discover.every((id) => CARD_INDEX[id]?.tier === t) ? null : `open Discover offers are not all tier ${t}`;
    }
    return c.after.discoverQueue?.some((spec) => (spec as { tier?: number }).tier === t) ? null : `no tier-${t} Discover open or queued`;
  },
  grant: (c, r) => {
    const got = arrivals(c);
    const problems: string[] = [];
    for (const id of r.cards ?? []) {
      const want = (r.cards ?? []).filter((x) => x === id).length;
      const have = got.filter((x) => x.cardId === id).length;
      if (have !== want) problems.push(`card ${id}: got ${have}, want ${want}`);
      if (r.grantKeywords && !got.filter((x) => x.cardId === id).some((x) => r.grantKeywords!.every((k) => x.keywords.includes(k)))) {
        problems.push(`card ${id}: missing grantKeywords ${r.grantKeywords.join('+')}`);
      }
    }
    for (const id of r.grantGolden ?? []) {
      const d = CARD_INDEX[id];
      const g = got.find((x) => x.cardId === id && x.golden);
      if (!g) problems.push(`golden ${id}: not granted golden`);
      else if (d && (g.attack !== d.attack * 2 || g.health !== d.health * 2)) problems.push(`golden ${id}: ${g.attack}/${g.health}, want ${d.attack * 2}/${d.health * 2}`);
    }
    if (r.randomTribe && (r.randomCount ?? 0) > 0) {
      const n = got.filter((x) => isTribeDef(CARD_INDEX[x.cardId], r.randomTribe!) && !CARD_INDEX[x.cardId]?.spell).length;
      if (n < r.randomCount!) problems.push(`random ${r.randomTribe}: got ${n}, want ${r.randomCount}`);
    }
    if ((r.randomSpell ?? 0) > 0 && got.filter((x) => CARD_INDEX[x.cardId]?.spell && !CARD_INDEX[x.cardId]?.ruby).length < r.randomSpell!) problems.push(`randomSpell: fewer than ${r.randomSpell}`);
    if ((r.randomRuby ?? 0) > 0 && got.filter((x) => CARD_INDEX[x.cardId]?.ruby).length !== r.randomRuby) problems.push(`randomRuby: want exactly ${r.randomRuby}`);
    if ((r.randomAle ?? 0) > 0 && got.length < (r.randomAle ?? 0)) problems.push(`randomAle: fewer than ${r.randomAle} arrivals`);
    if (r.randomFilter && got.length < (r.randomFilterCount ?? 1)) problems.push(`randomFilter ${r.randomFilter}: fewer than ${r.randomFilterCount ?? 1} arrivals`);
    if (r.randomTier && got.filter((x) => CARD_INDEX[x.cardId]?.tier === r.randomTier).length < (r.randomCount ?? 1)) problems.push(`randomTier ${r.randomTier}: too few`);
    return problems.length ? problems.join('; ') : null;
  },
};

describe('Doc Bot — recruit-side quest reward magnitudes (QUEST_DEFS × the real reward engine)', () => {
  it('every quest reward magnitude matches its def params, or carries a registered excuse', () => {
    const failures: string[] = [];
    const holes: string[] = [];
    for (const def of QUEST_DEFS) {
      const excuse = QUEST_SCAN_EXCUSED[def.id];
      const leaves = leavesOf(def.reward);
      const setId: SetId = def.sets?.includes('set2') && !def.sets.includes('set1') ? 'set2' : 'set1';
      const before = base(setId);
      // Arm at tier 6: random grants draw from `tier <= s.tier` pools, and some filters (Rally) have no
      // tier-1 member — arming at the top means an empty draw is a real defect, not a pool artifact.
      before.tier = 6;
      // A scalingTribeAura's base grant needs a tribe body on the board to be measured against.
      const auraLeaf = leaves.find((l): l is Extract<QuestReward, { kind: 'scalingTribeAura' }> => l.kind === 'scalingTribeAura');
      if (auraLeaf) before.board.push({ uid: 'auraprobe', cardId: 'sandbag', tribe: auraLeaf.tribe, attack: 10, health: 10, keywords: [], golden: false });
      const after = reduce(before, { type: 'devGrant', kind: 'quest', id: def.id });
      const ctx: Ctx = { before, after, def };
      for (const leaf of leaves) {
        if (excuse && excuse.kind === leaf.kind) continue; // registered, stale-checked below
        const checker = CHECKERS[leaf.kind] as Checker<typeof leaf.kind> | undefined;
        if (!checker) { holes.push(`${def.id}: reward kind '${leaf.kind}' has no checker and no excuse`); continue; }
        const fail = checker(ctx, leaf as never);
        if (fail) failures.push(`${def.id} (${leaf.kind}): ${fail}`);
      }
    }
    expect(holes, `Unchecked reward kind(s):\n  ${holes.join('\n  ')}\nAdd a checker, or a QUEST_SCAN_EXCUSED entry with a verifiable reason.`).toEqual([]);
    expect(failures, `Reward magnitude mismatch(es):\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('excuses are real: each names a live quest whose reward tree still uses the excused kind', () => {
    const stale: string[] = [];
    for (const [id, ex] of Object.entries(QUEST_SCAN_EXCUSED)) {
      const def = QUEST_DEFS.find((q) => q.id === id);
      if (!def) { stale.push(`${id}: excused but no such quest — delete the entry`); continue; }
      if (!leavesOf(def.reward).some((l) => l.kind === ex.kind)) stale.push(`${id}: excused for '${ex.kind}' but its reward no longer uses that kind — delete or fix`);
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });

  it('the excuse backlog can only shrink (ratchet: 0 as of 2026-08-26)', () => {
    expect(Object.keys(QUEST_SCAN_EXCUSED).length).toBeLessThanOrEqual(0);
  });
});
