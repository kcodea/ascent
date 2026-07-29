import { CARD_INDEX } from '@game/content';
import { getHero } from '../heroes';
import { refreshCostOf, upgradeCostOf } from '../reducer';
import { offerBuyStats, spellAttackBonus, spellCostReduction, spellHealthBonus } from '../recruit';
import type { BoardCard, RunState, ShopCard } from '../state';
import type {
  BotAuraView, BotCardView, BotEconomyView, BotHeroView, BotMandatoryDecision,
  BotOfferView, BotRunCounters, BotVisibleState,
} from './types';

/**
 * `RunState` → `BotVisibleState`. The single redaction point.
 *
 * Built by NAMING what goes in, never by copying and deleting. A filtered copy leaks every field added later
 * until someone notices; a curated projection makes a new `RunState` field invisible by default, and making it
 * visible a deliberate act. That matters here because the things being withheld are the ones that would let a
 * bot cheat: the run `seed` and `rngCursor` (which make the next shop derivable), `servedBoards` (this wave's
 * opponent, pinned before the player can see it), `scoutedNextOpponent`, and `lastCombat`.
 *
 * It is also a fair-information boundary, not just a tidiness one — see `transition.ts` on reveal boundaries.
 */

const cardView = (c: BoardCard): BotCardView => ({
  uid: c.uid,
  cardId: c.cardId,
  tribe: c.tribe,
  ...(CARD_INDEX[c.cardId]?.tribe2 ? { tribe2: CARD_INDEX[c.cardId]!.tribe2 } : {}),
  attack: c.attack,
  health: c.health,
  keywords: [...c.keywords],
  golden: !!c.golden,
  // Per-instance accruals: a Kennelmaster that has improved is worth more than its printed text, and a bot
  // reading only cardId + stats would sell it. Included for exactly that reason.
  ...(c.summonBonus ? { summonBonus: c.summonBonus } : {}),
  ...(c.spellProgress ? { spellProgress: c.spellProgress } : {}),
  ...(c.hpGrantBonus ? { hpGrantBonus: c.hpGrantBonus } : {}),
  ...(c.soldProgress ? { soldProgress: c.soldProgress } : {}),
  ...(c.attachments ? { attachments: c.attachments } : {}),
});

const offerView = (s: RunState, o: ShopCard): BotOfferView => {
  const def = CARD_INDEX[o.cardId];
  const spell = !!def?.spell;
  const base = spell ? (def?.cost ?? 0) : (s.minionCostOverride ?? 3);
  // `offerBuyStats` folds in any buffs applied to the OFFER while it sat in the tavern (a hero power, Apples,
  // Fortify) — the stats it will actually buy in at, which is what a purchase decision turns on.
  const { attack, health } = offerBuyStats(s, o);
  return {
    uid: o.uid,
    cardId: o.cardId,
    tribe: def?.tribe ?? 'neutral',
    ...(def?.tribe2 ? { tribe2: def.tribe2 } : {}),
    tier: def?.tier ?? 1,
    attack,
    health,
    keywords: [...(o.keywords ?? def?.keywords ?? [])],
    golden: !!o.golden,
    // The price actually payable now, not the printed one — Lazarus, Tradesman and Layaway all move it, and a
    // bot comparing printed costs would mis-plan every purchase under them.
    cost: spell ? Math.max(0, base - spellCostReduction(s)) : base,
    spell,
    ruby: !!def?.ruby,
    kept: !!o.kept,
  };
};

/** The one decision the run is blocked on, if any. Everything else is illegal until it's answered. */
function mandatoryOf(s: RunState): BotMandatoryDecision | null {
  if (s.discover?.length) return { kind: 'discover', options: [...s.discover] };
  if (s.chooseOne) {
    const def = CARD_INDEX[s.chooseOne.cardId];
    return {
      kind: 'chooseOne',
      sourceUid: s.chooseOne.uid,
      options: (def?.chooseOne ?? []).map((o) => o.text),
    };
  }
  if (s.pendingTarget) {
    const src = s.board.find((c) => c.uid === s.pendingTarget!.uid);
    const def = src ? CARD_INDEX[src.cardId] : undefined;
    const legal = def?.targetTribe
      ? s.board.filter((c) => c.uid !== s.pendingTarget!.uid && (c.tribe === def.targetTribe || CARD_INDEX[c.cardId]?.tribe2 === def.targetTribe))
      : s.board.filter((c) => c.uid !== s.pendingTarget!.uid);
    return { kind: 'battlecryTarget', sourceUid: s.pendingTarget.uid, legalTargets: legal.map((c) => c.uid) };
  }
  if (s.questOffer?.length) return { kind: 'quest', options: [...s.questOffer] };
  if (s.runeforgeOffer?.length) {
    return {
      kind: 'runeforge',
      options: [...s.runeforgeOffer],
      canReroll: !s.runeforgeRerolled,
      canSkip: true,
    };
  }
  if (s.scoutedNextOpponent?.length) return { kind: 'scout' };
  return null;
}

export function toBotVisibleState(s: RunState): BotVisibleState {
  const hero = getHero(s.heroId);
  const economy: BotEconomyView = {
    gold: s.embers,
    maxGold: s.maxEmbers,
    tier: s.tier,
    upgradeCost: upgradeCostOf(s),
    refreshCost: refreshCostOf(s),
    freeRolls: s.freeRolls ?? 0,
    goldSpentThisTurn: s.goldSpentThisTurn ?? 0,
  };
  const heroView: BotHeroView = {
    heroId: s.heroId,
    resolve: s.resolve,
    armor: s.armor,
    powerReady: s.heroReady,
    powerKind: hero.power.kind,
  };
  const runCounters: BotRunCounters = {
    spellsCast: s.spellsCast ?? 0,
    spellsThisTurn: s.spellsThisTurn ?? 0,
    deathrattlesTriggered: s.deathrattlesTriggered ?? 0,
    triplesMade: s.triplesMade ?? 0,
    cardsBoughtThisTurn: s.cardsBoughtThisTurn ?? 0,
    playedThisTurn: [...(s.playedThisTurn ?? [])],
  };
  const auras: BotAuraView = {
    spellPower: { attack: spellAttackBonus(s), health: spellHealthBonus(s) },
    beastBuyAtk: s.beastBuyAtk ?? 0,
    impBuff: { attack: s.impBuff?.attack ?? 0, health: s.impBuff?.health ?? 0 },
    undeadBuyAtk: s.undeadBuyAtk ?? 0,
    magneticBuy: { attack: s.magneticBuyAtk ?? 0, health: s.magneticBuyHp ?? 0 },
    rubyBonus: { attack: s.rubyBonus?.attack ?? 0, health: s.rubyBonus?.health ?? 0 },
  };
  return {
    version: 1,
    setId: s.setId ?? 'set1',
    riftId: s.rift ?? null,
    phase: s.phase,
    wave: s.wave,
    economy,
    hero: heroView,
    board: s.board.map(cardView),
    hand: s.hand.map(cardView),
    shop: s.shop.map((o) => offerView(s, o)),
    spellOffer: s.spell ? offerView(s, s.spell) : null,
    frozen: !!s.frozen,
    runCounters,
    auras,
    runes: [...(s.ownedRunes ?? [])],
    quests: (s.activeQuests ?? []).map((q) => ({ questId: q.questId, progress: q.progress, completed: q.completed })),
    mandatoryDecision: mandatoryOf(s),
    opponentKnowledge: [], // Ticket 7
  };
}

/**
 * A stable digest of everything decision-relevant. Used to reuse a queued plan only while the state it was
 * planned against still holds, and to deduplicate equivalent search nodes.
 *
 * Derived from the VISIBLE state on purpose: two runs that differ only in hidden RNG must fingerprint the same,
 * or a bot could tell them apart and the fairness guarantee would leak through the cache.
 */
export function fingerprint(v: BotVisibleState): string {
  return JSON.stringify(v);
}
