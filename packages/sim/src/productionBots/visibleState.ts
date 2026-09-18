import { CARD_INDEX, EQUIPMENT_INDEX } from '@game/content';
import { activePowers, getHero } from '../heroes';
import { offerBuyPrice, refreshCostOf, upgradeCostOf } from '../reducer';
import { effectiveTargetTribe, isTribe, offerBuyStats, spellAttackBonus, spellCostReduction, spellHealthBonus } from '../recruit';
import { equipmentChargesOf, equipmentCostOf, equipmentState } from '../equipment';
import type { BoardCard, RunState, ShopCard } from '../state';
import { friendlyCombatSideOf } from './combatContext';
import type {
  BotAuraView, BotCardView, BotEconomyView, BotEquipmentView, BotHeroView, BotMandatoryDecision,
  BotOfferView, BotPowerTargeting, BotPowerView, BotRunCounters, BotStarformView, BotVisibleState,
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
 *
 * B2 (balance roadmap) widened what goes IN — every one of these is on the player's own screen:
 *  - Equipment held this turn, with live cost / charges / target mode, so it can be planned with;
 *  - the Starform token's stats and price;
 *  - every wielded hero power with its targeting shape (Void's second slot included);
 *  - the run counters live card text depends on (Ruby casts, the Reveler value, the run-wide shop buff);
 *  - the friendly side PREPARED AS COMBAT WOULD PREPARE IT (`combatContext.ts`), so the evaluator fights the
 *    board that will actually fight, not a stat-only silhouette of it;
 *  - the LIVE buy price of every offer (`offerBuyPrice`), not the printed one.
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
  // `offerBuyStats` folds in any buffs applied to the OFFER while it sat in the tavern (a hero power, Apples,
  // Fortify) — the stats it will actually buy in at, which is what a purchase decision turns on.
  const { attack, health } = offerBuyStats(s, o);
  // The price actually payable now, not the printed one — Lazarus, Tradesman, Layaway, Cadence, Trade-In, the
  // Starform's ticking price and a free first buy all move it. `offerBuyPrice` is the reducer's own source.
  const cost = spell
    ? Math.max(0, (def?.cost ?? 0) - spellCostReduction(s, def))
    : offerBuyPrice(s, o).cost;
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
    cost,
    spell,
    ruby: !!def?.ruby,
    kept: !!o.kept,
  };
};

/** Legal targets for a pending aim, mirroring the reducer's `battlecryTarget` guards: the Choose One pool for a
 *  deferred play (board minus self, tribe-filtered, plus non-spell offers for an `any` card), board minus the
 *  first pick for a two-target spell, board minus self for a tribe-restricted / not-self Shout. */
function pendingTargets(s: RunState): string[] {
  const pt = s.pendingTarget!;
  const def = CARD_INDEX[pt.cardId];
  if (pt.spell && !pt.deferredPlay) return s.board.filter((c) => c.uid !== pt.spellFirstUid).map((c) => c.uid);
  const tribe = effectiveTargetTribe(s, def);
  // R-TARGET-03: every aimed pick excludes the source (the reducer refuses a self-target outright).
  const board = s.board.filter((c) => c.uid !== pt.uid && (!tribe || isTribe(c, tribe)));
  const offers = pt.deferredPlay && def?.target === 'any' ? s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell) : [];
  return [...board.map((c) => c.uid), ...offers.map((o) => o.uid)];
}

/** The one decision the run is blocked on, if any. Everything else is illegal until it's answered. */
function mandatoryOf(s: RunState): BotMandatoryDecision | null {
  if (s.discover?.length) return { kind: 'discover', options: [...s.discover] };
  if (s.chooseOne) {
    if (s.chooseOne.equipmentId) {
      const eq = EQUIPMENT_INDEX[s.chooseOne.equipmentId];
      return { kind: 'chooseOne', sourceUid: s.chooseOne.uid, options: (eq?.chooseOne ?? []).map((o) => o.text), equipmentId: s.chooseOne.equipmentId };
    }
    const def = CARD_INDEX[s.chooseOne.cardId];
    return {
      kind: 'chooseOne',
      sourceUid: s.chooseOne.uid,
      options: (def?.chooseOne ?? []).map((o) => o.text),
    };
  }
  if (s.pendingTarget) {
    return { kind: 'battlecryTarget', sourceUid: s.pendingTarget.uid, legalTargets: pendingTargets(s) };
  }
  if (s.powerOffer) return { kind: 'powerOffer', options: [...s.powerOffer.heroIds] };
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

/** Hero powers whose target is a friendly board minion OR a shop offer (Quillen's archive). */
const SHOP_TARGET_POWERS = new Set<string>(['archive']);

/** The wielded powers, with the reducer's availability gates mirrored so a candidate is rarely a wasted node. */
function powersOf(s: RunState): BotPowerView[] {
  return activePowers(s).slice(0, 2).map((power, i): BotPowerView => {
    const slot = i === 1 ? 1 : 0;
    const heroUses = (slot === 1 ? s.heroPowerUses2 : s.heroPowerUses) ?? 0;
    const slotReady = slot === 1 ? (s.heroReady2 ?? true) : s.heroReady;
    const slotSpent = slot === 1 ? s.heroPowerSpent2 : s.heroPowerSpent;
    const usesThisTurn = s.heroUsesThisTurn ?? 0;
    const available = power.usesPerTurn
      ? usesThisTurn < power.usesPerTurn
      : power.maxUses
        ? heroUses < power.maxUses && slotReady
        : power.oncePerGame
          ? !slotSpent
          : slotReady;
    const unlocked = s.wave >= (power.unlockWave ?? 1);
    const cost = power.cost ?? 0;
    const targeting: BotPowerTargeting = power.passive
      ? 'passive'
      : power.kind === 'commission'
        ? 'commission'
        : power.kind === 'firstOrLast'
          ? 'flashPick'
          : power.untargeted
            ? 'untargeted'
            : SHOP_TARGET_POWERS.has(power.kind) ? 'friendlyOrShop' : 'friendly';
    return { slot, kind: power.kind, targeting, cost, ready: !power.passive && unlocked && available && s.embers >= cost };
  });
}

function equipmentOf(s: RunState): BotEquipmentView[] {
  const e = equipmentState(s);
  return e.available.flatMap((g): BotEquipmentView[] => {
    const def = EQUIPMENT_INDEX[g.equipmentId];
    if (!def) return [];
    return [{
      equipmentId: g.equipmentId,
      name: def.name,
      version: g.version,
      cost: equipmentCostOf(s, def),
      charges: equipmentChargesOf(s, g.equipmentId),
      targetMode: def.targetMode,
      sourceUids: [...g.sourceUids], // R-TARGET-03: an aimed Equipment never lands on its own granting body
      effectId: def.effectId,
      chooseOne: (def.chooseOne ?? []).map((o) => o.effectId),
      selected: e.selectedEquipmentId === g.equipmentId,
    }];
  });
}

function starformOf(s: RunState): BotStarformView | null {
  const o = s.shop.find((x) => x.starform);
  if (!o) return null;
  const { attack, health } = offerBuyStats(s, o);
  return { uid: o.uid, attack, health, cost: offerBuyPrice(s, o).cost };
}

export function toBotVisibleState(s: RunState): BotVisibleState {
  const hero = getHero(s.heroId);
  const powers = powersOf(s);
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
    powerReady: powers[0]?.ready ?? false,
    powerKind: hero.power.kind,
    powers,
  };
  const runCounters: BotRunCounters = {
    spellsCast: s.spellsCast ?? 0,
    spellsThisTurn: s.spellsThisTurn ?? 0,
    deathrattlesTriggered: s.deathrattlesTriggered ?? 0,
    triplesMade: s.triplesMade ?? 0,
    cardsBoughtThisTurn: s.cardsBoughtThisTurn ?? 0,
    playedThisTurn: [...(s.playedThisTurn ?? [])],
    rubyCasts: s.rubyCasts ?? 0,
    revelerX: s.revelerX ?? 0,
    tavernBuyBonus: { attack: s.tavernBuyBonus?.atk ?? 0, health: s.tavernBuyBonus?.hp ?? 0 },
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
    equipment: equipmentOf(s),
    starform: starformOf(s),
    friendly: friendlyCombatSideOf(s),
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
