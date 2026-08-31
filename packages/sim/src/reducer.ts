import { type PresentationCollector, type CombatEvent, beatIdentity, ALE_IDS, combatSide, makeCollector, makeRng, simulate, type BoardMinion, type CardDef, type CombatConfig, type CombatResult, type CombatSideState, type Keyword, type PendingCombatQuest, type PresentationBatch, type QuestCombatMods, type QuestDef, type QuestObjective, type QuestObjectiveEvent, type Tribe } from '@game/core';
import { currentCollector, withActiveCollector } from './activeCollector';
import { surfaceKeyForRune, surfaceKeyForQuest, CARD_INDEX, EPIC_RUNES, GIFT_IDS, QUEST_INDEX, RUNE_INDEX, RUNES, runeSynergies, type SynergyTag } from '@game/content';
import { sideFromSnapshot } from './boardSide';
import { poolOf, setIdOf } from './cardPool';
import { ACE_DISCOUNT_MAX_TIER, ACE_TIER_DISCOUNT, CONFIG, INDY_GILD_RECHARGE_GOLD, KESHI_CROWN_THRESHOLD, maxTierFor, hasTier7Access } from './config';
import { lobbyOpponentBoard, settleRunLobbyRound, playerEliminated, practicePlayerPlacement, playerLossDamage } from './lobby/runLobby';
import { BOT_DAMAGE_MULT } from './lobby/practiceBots';
import { accumulateContribution, tallyCombat } from './contribution';
import { rollShop, topUpTavern, returnToPool, takeFromPool, rollCiaEnchants, tierSlots } from './shop';
import { generateQuestOffer, questOfferPlan } from './quests';
import { activePowers, getHero, gildCopiesNeeded, hasPower, powerDiscoverPool } from './heroes';
import { buildEnemyBoard, selectThreat } from './threats';
import { pickOpponent, opponentBoard, oppKey } from './opponents';
import type { BoardSnapshot } from './snapshot';
import { EQUIPMENT_INDEX } from '@game/content';
import {
  equipmentCostOf, equipmentUsesLeft, expireEquipmentTurn, rebuildEquipment,
  selectEquipment, selectedEquipment,
} from './equipment';
import { noteSpellCast, applyCastEffects, makeContext, discoverSpecFor, roundedSpellbookCostOf, buyoutCostOf, commissionOffer, COMMISSION_DELAY, aegisGrantOf, allInPayoutOf, threeDistinctTypes, exhibitionGrantOf, stampSableBond, stampSharedSpoils, heroOfferPrice, addBuff, addOfferBuff, applyBattlecryTarget, applyCardsBought, applyCardsPlayed, applyChooseOne, applyChooseOneTarget, chooseBothActive, chooseOneNeedsChoice, applyEndOfTurn, applyStartOfTurn, applyOnBuy, applyGoldSpent, advanceRuneThresholds, applySecondLife, effectiveTargetTribe, dominantBoardTribe, uncontrolledTribes, gainGold, applyRunShopBuff, applyShoutsForEndlessVerse, applyShoutsForShopBuff, auraFxTargets, boardManaBonus, buffImpsRunWide, buffUndeadAttackEverywhere, buffCardTypeRunWide, buffFodderRunWide, cardBuff, captureBuffFx, conjuredStats, castSpell, castSpellOnOffer, conjureToHand, consumeTavernFodder, dragonTamerCostOf, fireGravetwinEchoes, fireOnGainAttack, fireOnRubyCast, fireOnRubyPlayed, fireOnMinionSold, fireOnSell, fireOnGainCard, fireSummonBuffs, gildMinion, grantMinionToHandOrBoard, grantTopTypeMinion, hasBattlecry, isTribe, mintRubies, modalOpen, openDiscover, playCard, queueDiscover, replayBattlecry, replayEconomyBattlecry, replayEndOfTurn, replayRecurringEndOfTurn, withEotDiscoverGrantBeat, sellValueOf, sellValueWithBonus, rubyCastCount, rubyStatBonus, consumeGrimoireCharge, countRubyAsShopSpell, spellAttackBonus, spellCasts, spellCostReduction, spellHealthBonus, stampImproveReps, swapWithTavern, applySpellBought, applyShopRefreshed, taughtAimSpell, triggerBorrowedEcho, landBorrowed, settlePendingDeath, stampEquipFx, fireEquipmentTriggers, buyHealthAura, undeadBuyBonus, weldMagnetic , defIsTribe} from './recruit';
import { handCap, mixSeed, reservedHandSlots, TAG, henchmanOffer, type Action, type ActiveQuest, type AuraFxTribe, type BoardCard, type CardBuff, type ShopCard, type CiaSuit, type Commission, type CommissionKind, type RunState, type RubyLandedFx, gateUses, procRune, procRuneId, runeBuffMagnitude } from './state';
import { alignmentsOf } from './alignment';
import { RUNE_DUP_SWEETENER, RUNE_DUP_UNIQUE, forgeFilteredDuplicate, runeStacksOf } from './runeDup';
import { spellFizzles } from './spellFizzle';
import { MATCHMAKING } from './matchmaking';

/** Spend `amount` Gold and fire any `goldSpent` payoffs (Acid, Banksly) — the single Gold-spend chokepoint
 *  for buys, rerolls, tier-ups and hero powers. */
function spendGold(s: RunState, amount: number): void {
  s.embers -= amount;
  s.goldSpent = (s.goldSpent ?? 0) + amount; // career/post-run stat
  s.goldSpentThisTurn = (s.goldSpentThisTurn ?? 0) + amount; // per-turn (Patch Job); reset each wave
  // Indy: the (spent) Gild charge recharges after every 40 Gold spent — un-spend it the moment the threshold lands.
  if (s.heroId === 'indy' && s.heroPowerSpent && s.indyGildRearmAt != null && s.goldSpent >= s.indyGildRearmAt) {
    s.heroPowerSpent = false;
    s.indyGildRearmAt = undefined;
  }
  applyGoldSpent(s, amount);
  advanceQuestsBy(s, (o) => o.event === 'spendGold', amount); // Coin Hoard: "Spend N Gold"
  // Food for Gold: every `per` Gold spent queues a Fodder into the next shop + bumps the run-wide Fodder aura.
  if (s.foodForGold) {
    s.foodForGoldTick = (s.foodForGoldTick ?? 0) + amount;
    while (s.foodForGoldTick >= s.foodForGold.per) {
      s.foodForGoldTick -= s.foodForGold.per;
      (s.pendingTavern ??= []).push('fred');
      buffFodderRunWide(s, s.foodForGold.attack, s.foodForGold.health, 'Food for Gold');
    }
  }
  // Rune of Spellslinging: every `spellDripPer` Gold spent, conjure a random spell (tavern-tier bound) to hand.
  if (s.spellDripPer) {
    s.spellDripTick = (s.spellDripTick ?? 0) + amount;
    while (s.spellDripTick >= s.spellDripPer) {
      s.spellDripTick -= s.spellDripPer;
      procRuneId(s, 'rune_spellslinging');
      conjureToHand(s, poolOf(s).spells.filter((c) => c.tier <= s.tier), 1);
    }
  }
  // The Golden Ledger: every `per` GOLD spent, your tribe gains stats. Threshold-based, unlike Rune of Bulk
  // Order below which pays per transaction — so a run can hold both and they don't collide. The remainder banks
  // in `tick`, so two small buys pay out exactly as one big one does.
  if (s.questGoldTribeBuff && amount > 0) {
    const g = s.questGoldTribeBuff;
    g.tick += amount;
    while (g.tick >= g.per) {
      g.tick -= g.per;
      for (const c of s.board) if (isTribe(c, g.tribe)) addBuff(c, 'The Golden Ledger', g.attack, g.health);
    }
  }
  // Rune of Bulk Order: gives `count` random board minions +atk/+hp when you spend Gold. With `per` set (owner
  // sheet 2026-07-30: "Every 5 Gold spent") it pays once per `per` Gold and BANKS the remainder across
  // transactions, so two 3-Gold buys pay once — the same threshold contract the Golden Ledger uses. Without
  // `per` it falls back to once per spend transaction. Seeded off the run's RNG cursor.
  if (s.runeScale && amount > 0 && s.board.length > 0) {
    const { count, attack, health } = s.runeScale;
    let payouts = 1;
    if (s.runeScale.per) {
      s.runeScale.tick = (s.runeScale.tick ?? 0) + amount;
      payouts = 0;
      while (s.runeScale.tick >= s.runeScale.per) { s.runeScale.tick -= s.runeScale.per; payouts += 1; }
      if (payouts === 0) return;
    }
    // The rune ITSELF fired — its badge bursts on this. AFTER the `payouts === 0` return above, so banking
    // Gold below the threshold is correctly not a fire; `payouts`, not 1, so 10 Gold at 5-per reads as two.
    procRune(s, 'runeScale', payouts);
    const rng = makeRng(s.rngCursor);
    const pool = [...s.board];
    // Wrapped for FX so each picked ally gets a descend (sourceless — the rune has no board anchor) rather than
    // a silent stat jump. RNG is unchanged: the picks still run inside, s.rngCursor advances exactly as before.
    captureBuffFx(s, undefined, 'spell', () => {
      for (let p = 0; p < payouts; p++) {
        const picks = [...pool];
        for (let i = 0; i < count && picks.length > 0; i++) {
          const pick = picks.splice(rng.int(picks.length), 1)[0]!;
          addBuff(pick, 'Rune of Bulk Order', attack, health); // renamed 2026-07-29; label is player-visible in the buff breakdown
        }
      }
    });
    s.rngCursor = rng.state();
  }
}

/** Tiff's Dragon Tamer: every Dragon or SPELL bought banks a 1-Gold discount on the next power use
 *  (`tiffDiscount`, read by `dragonTamerCostOf`; reset when the power fires). Called from every buy path —
 *  the right-hand spell slot, a Spell-Cart shop spell, a held-Displacement restore, and the normal buy. */
function tiffBuyDiscount(s: RunState, card: CardDef): void {
  if (!hasPower(s, 'dragonTamer')) return;
  if (card.spell || card.tribe === 'dragon' || card.tribe2 === 'dragon' || card.universalTribe) {
    s.tiffDiscount = (s.tiffDiscount ?? 0) + 1;
  }
}

/** Push a PLAIN, base-stat copy of a card to hand (Re-Pete's Second Hand / Gorr's Four Peat) — a CONJURED
 *  card: no per-instance buffs/golden/welds carried, and it does NOT take from the shared pool. Hand-cap-safe. */
function conjurePlainCopy(s: RunState, cardId: string): void {
  const def = CARD_INDEX[cardId];
  if (!def || s.hand.length >= handCap(s)) return;
  s.hand.push({ uid: `b${s.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false });
}

/** Gorr's Four Peat: when you buy your 3rd MINION in a single turn, get a plain copy of one of the three at
 *  random — conjured (no pool take), once per turn (`gorrBuys` resets at turn setup; it keeps counting past 3
 *  but only the exact 3rd buy fires). Called from both paid minion-buy paths (normal + held-Displacement). */
/**
 * How many times a Hero Power's effect resolves — 2 while Rune of the Wishbone is held, else 1.
 *
 * The ACTIVE powers read `reps` inside the power-activation switch. A PASSIVE power never reaches that switch
 * (its work happens on a buy, a play, a turn advance, or in combat), so each passive calls this at its own
 * fire site instead. One helper rather than `s.runeWishbone ? 2 : 1` scattered about, so "what does twice
 * mean" stays one question with one answer.
 */
export function wishboneReps(s: RunState): number {
  // +1 repetition per Wishbone copy held (repeat family, owner 2026-08-27) — 2 with one copy, 3 with two.
  return s.runeWishbone ? 1 + runeStacksOf(s, 'rune_wishbone') : 1;
}

function gorrQuestBuy(s: RunState, card: CardDef): void {
  if (!hasPower(s, 'fourPeat') || card.spell) return;
  const buys = [...(s.gorrBuys ?? []), card.id];
  s.gorrBuys = buys;
  if (buys.length !== 3) return; // fires on EXACTLY the 3rd minion buy each turn
  const rng = makeRng(s.rngCursor);
  // Wishbone: another copy, RE-ROLLED among the same three — "not necessarily the same" (owner ruling).
  for (let r = 0; r < wishboneReps(s); r++) conjurePlainCopy(s, buys[rng.int(3)]!);
  s.rngCursor = rng.state();
}

/** Drakko's quest: buy 5 Battlecry minions → get Drakko the Drummer (once per game). Progresses on every
 *  PAID Battlecry buy — the normal path AND a held-Displacement restore (which used to skip it); the
 *  reward lands in the hand if there's room. */
function drakkoQuestBuy(s: RunState, card: CardDef): void {
  if (s.heroId !== 'drakko' || s.heroPowerSpent || !hasBattlecry(card)) return;
  s.drakkoBuys += 1;
  if (s.drakkoBuys < 5) return;
  if (s.hand.length < handCap(s)) {
    s.hand.push({
      uid: `b${s.uidSeq++}`,
      cardId: 'drummer',
      tribe: CARD_INDEX.drummer!.tribe,
      attack: CARD_INDEX.drummer!.attack,
      health: CARD_INDEX.drummer!.health,
      keywords: [...CARD_INDEX.drummer!.keywords],
      golden: false,
    });
  }
  s.heroPowerSpent = true; // quest complete — stops counting + arms nothing further
}

/** Chronos hero's Encore quest: buy 4 End-of-Turn minions → get a Chronos (once per game). Mirrors
 *  `drakkoQuestBuy` — progresses on every PAID buy of a minion that carries an End-of-Turn effect. */
function chronosQuestBuy(s: RunState, card: CardDef): void {
  if (s.heroId !== 'chronoshero' || s.heroPowerSpent) return;
  if (!card.effects.some((e) => e.on === 'endOfTurn')) return;
  s.eotMinionBuys = (s.eotMinionBuys ?? 0) + 1;
  if ((s.eotMinionBuys ?? 0) < 4) return;
  if (s.hand.length < handCap(s)) {
    s.hand.push({
      uid: `b${s.uidSeq++}`,
      cardId: 'chronos',
      tribe: CARD_INDEX.chronos!.tribe,
      attack: CARD_INDEX.chronos!.attack,
      health: CARD_INDEX.chronos!.health,
      keywords: [...CARD_INDEX.chronos!.keywords],
      golden: false,
    });
  }
  s.heroPowerSpent = true; // quest complete
}

/** Keshi's Crown: every card acquired by a SHOP PURCHASE — including one made free by a discount or the
 *  Freedom rift's free first buy — banks that card's tavern tier; at `KESHI_CROWN_THRESHOLD` the run gets a
 *  Triple Reward (the same `discoverspell` a golden minion grants) and the bank resets to 0 — the overflow is
 *  DISCARDED, not carried (owner spec 2026-08-16; Cassen's counter subtracts instead, so both patterns exist
 *  in here).
 *
 *  Spells count too — "25 shop tiers worth of CARDS" — so this is called from all four `buy` branches plus
 *  `buyHenchman`, the same split-path hazard that once left `applySpellBought` firing from only one of them.
 *
 *  Full hand: `grantGoldenDiscover` silently drops the card when there's no room. Every other hand-capped
 *  grant accepts that, but this is Keshi's ENTIRE power, so the bank is HELD at the threshold+ and pays out
 *  on the next purchase that finds room. `keshiTierPoints` can therefore legitimately read above the
 *  threshold. */
function keshiCrownBuy(s: RunState, card: CardDef): void {
  if (!hasPower(s, 'crownTally')) return;
  s.keshiTierPoints += card.tier * wishboneReps(s); // Wishbone: the buy banks its tier twice
  // A `while` (not an `if`) purely for safety: max tier 7 against KESHI_CROWN_THRESHOLD (25) means one
  // purchase can never pay twice today, but this can't silently break if either number is retuned later.
  while (s.keshiTierPoints >= KESHI_CROWN_THRESHOLD) {
    // Yield to a pending Discover pick: `reservedHandSlots` counts the open prompt + anything queued behind
    // it, and `takeDiscoverPick` FORFEITS its pick outright if the hand is full when the player chooses. A
    // payout that fills the last slot would destroy a choice the player already earned. NOTE (2026-08-16
    // review): under the current reducer, `buy`/`buyHenchman` are already refused outright by the modalOpen
    // guard in `reduceCore` whenever `s.discover` is set — including while the Recruit screen's Discover
    // panel is merely minimized, which only hides the overlay locally and never clears `run.discover` — so
    // `reservedHandSlots(s)` is 0 at every call site this fires from today. This check is defense-in-depth
    // against that invariant changing (e.g. `buy` ever being added to the modalOpen exemption list), not a
    // guard against a currently-reachable interleaving.
    if (s.hand.length >= handCap(s) - reservedHandSlots(s)) break;
    grantGoldenDiscover(s);
    s.keshiTierPoints = 0;
  }
}

/** Shop minion cost for the current hero: Hermit Hank's minions cost 2 Gold; everyone else pays the config
 *  default. A Moe set-price (`offer.cost`) or a Merchant's Mark override still take priority over this. */
export function minionCostOf(s: RunState): number {
  return hasPower(s, 'cheapMinions') ? 2 : CONFIG.minionCost;
}

/** The Gold a tavern-up costs right now: the running `upgradeCost` plus Hermit Hank's +2 surcharge (his
 *  minions are cheap, but climbing tiers costs more). The single source of truth for the reducer + UI. */
export function upgradeCostOf(s: RunState): number {
  const base = s.upgradeCost + (hasPower(s, 'cheapMinions') ? 2 : 0);
  // Ayse's Ace: a banked tier-up discount, floored at 0 so it can never pay you to upgrade.
  return Math.max(0, base - (s.aceTierDiscount ?? 0));
}

/** The Gold a tavern refresh (reroll) costs right now: the config default, but Tradesman (cheapMinions) pays 2
 *  — cheap to shop, dear to churn. The single source of truth for the reducer's roll charge + the UI button. */
export function refreshCostOf(s: RunState): number {
  return hasPower(s, 'cheapMinions') ? 2 : CONFIG.refreshCost;
}

/** What the NEXT refresh actually charges — the number the UI's Refresh pill must print (live-accuracy
 *  rule). Folds the free sources the reducer's `roll` branch consumes, in its order: banked free rolls
 *  (Refreshing Texts), then Rune of Window Shopping's first-3-per-turn allowance, else `refreshCostOf`.
 *  Bug 3abab276 (Bug Board round 1): the pill read `refreshCostOf` directly and never showed Window
 *  Shopping's 0 — keep the pill on THIS helper so the display can't drift from the charge. */
export function nextRefreshCostOf(s: RunState): number {
  if (s.freeRolls > 0) return 0;
  // 3 free per Window Shopping copy held (owner 2026-08-27) — the same window the 'roll' case charges by.
  if (s.runeWindowShopping && (s.windowShopRolls ?? 0) < 3 * runeStacksOf(s, 'rune_window_shopping')) return 0;
  return refreshCostOf(s);
}

/** Rune of Open Enrollment: append ONE extra offer of the board's most common type after a refresh. */
/**
 * Rune of Open Enrollment: after a Refresh, one Shop offer becomes a minion of your most common type.
 *
 * THE SHOP NEVER GROWS (owner ruling 2026-08-31, off player report 5c5b50a0 — *"rune of open enrollement
 * overflows the shop. there are too many minions available ... so there are 7 options instead of 6"*):
 * *"the shop should never overflow beyond its capacity, it should only ever replace available slots with
 * affected minions or spells etc."*
 *
 * This used to `s.shop.push(...)`, which is what put a seventh offer in a six-slot row. It now fills a FREE
 * slot when the row is short and REPLACES the right-most minion offer when it is full — the same shape Pete's
 * `upgradeRightmostOffer` already used, under the same owner ruling from 2026-08-14 ("it upgrades the
 * existing offer rather than adding an eighth").
 *
 * Replacing the right-most MINION specifically, never a spell or Ruby offer: those sit in the row but are not
 * minion slots, and clobbering one would eat a different resource than the rune is about.
 *
 * The pool bookkeeping came along for free and was missing before: the displaced offer returns to the shared
 * pool like a reroll, and the new one is taken from it, so copies stay a contested resource.
 */
function appendDominantTypeOffer(s: RunState): void {
  const tribe = dominantBoardTribe(s);
  if (!tribe) return;
  const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier <= s.tier && (c.tribe === tribe || c.tribe2 === tribe));
  if (pool.length === 0) return;
  const rng = makeRng(s.rngCursor);
  const pick = pool[rng.int(pool.length)]!;
  s.rngCursor = rng.state();

  // A short row (cards bought since the refill) has a slot going spare — filling it is genuinely additional
  // and grows nothing.
  if (s.shop.length < tierSlots(s.tier)) {
    takeFromPool(s, pick.id);
    s.shop.push({ uid: `s${s.uidSeq++}`, cardId: pick.id });
    return;
  }
  // Full row — replace the right-most MINION offer.
  let idx = -1;
  for (let i = s.shop.length - 1; i >= 0; i--) {
    const d = CARD_INDEX[s.shop[i]!.cardId];
    if (d && !d.spell && !d.ruby) { idx = i; break; }
  }
  if (idx < 0) return; // a row of nothing but spells — nothing to replace, and still no overflow
  returnToPool(s, s.shop[idx]!.cardId);
  takeFromPool(s, pick.id);
  s.shop[idx] = { uid: `s${s.uidSeq++}`, cardId: pick.id };
}

/** Pete (Contrabanana): the RIGHT-MOST Shop minion is REPLACED by one from the tier ABOVE the Shop tier —
 *  owner ruling 2026-08-14: it upgrades the existing offer rather than adding an eighth. Capped at 7 only when
 *  the run has Tier-7 access (rune/hero/quest/rift), else 6; at the ceiling the right-most is guaranteed to be
 *  AT that ceiling tier instead. No-op if the pool is empty or the row has no minion offer. */
function upgradeRightmostOffer(s: RunState): void {
  const cap = hasTier7Access(s) ? 7 : 6;
  const tgt = Math.min(s.tier + 1, cap);
  const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier === tgt);
  if (pool.length === 0) return;
  // The right-most MINION offer (spells/Rubies in the row are not minions).
  let idx = -1;
  for (let i = s.shop.length - 1; i >= 0; i--) {
    const d = CARD_INDEX[s.shop[i]!.cardId];
    if (d && !d.spell && !d.ruby) { idx = i; break; }
  }
  if (idx < 0) return;
  const rng = makeRng(s.rngCursor);
  const pick = pool[rng.int(pool.length)]!;
  s.rngCursor = rng.state();
  returnToPool(s, s.shop[idx]!.cardId); // the displaced offer goes back to the shared pool, like a reroll
  takeFromPool(s, pick.id);
  s.shop[idx] = { uid: `s${s.uidSeq++}`, cardId: pick.id, contraband: true }; // flagged so the UI flashes it
}

/**
 * Underdweller (Soulkeeper): every DISTINCT minion that died in the last combat, either side.
 *
 * Derived from `lastCombat` rather than carried back on `CombatResult` — a death is already fully described by
 * the event log, so a new `player*` field would be a redundant carry-back (and would owe the live-tracking
 * audit a classification for nothing). uid→cardId comes from the two initial boards PLUS every `summon` event,
 * so a token that was summoned mid-fight and died is reachable too — the owner's ruling is "ANY minion that
 * died last combat on both sides of the board", and mid-combat summons are exactly that.
 *
 * A `rise` death is skipped: that body came back, so it did not stay dead.
 */
function diedLastCombat(s: RunState): string[] {
  const lc = s.lastCombat;
  if (!lc) return [];
  const byUid = new Map<string, string>();
  for (const m of [...lc.initial.player, ...lc.initial.enemy]) byUid.set(m.uid, m.cardId);
  for (const e of lc.events) if (e.type === 'summon') byUid.set(e.minion.uid, e.minion.cardId);
  const out: string[] = [];
  for (const e of lc.events) {
    if (e.type !== 'death' || e.rise) continue;
    const id = byUid.get(e.target);
    if (id && CARD_INDEX[id] && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Rune of the Bargain Bin: replace every minion offer with a random minion priced at 1 Gold that sells for 0
 *  (the `sellZero` marker rides onto the bought minion as `sellOverride`). Spell/Ruby offers are left as-is. */
function fillBargainBin(s: RunState): void {
  const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier <= s.tier);
  if (pool.length === 0) return;
  const rng = makeRng(s.rngCursor);
  s.shop = s.shop.map((o) => {
    const d = CARD_INDEX[o.cardId];
    if (!d || d.spell || d.ruby) return o;
    const pick = pool[rng.int(pool.length)]!;
    return { uid: `s${s.uidSeq++}`, cardId: pick.id, cost: 1, sellZero: true };
  });
  s.rngCursor = rng.state();
}

/**
 * The board the *next* combat will serve: a wave-matched real opponent from the pool (same development stage),
 * or null when the pool is empty (→ the procedural threat). Pure + deterministic — the opponent frame previews
 * it during recruit, and `faceOmen` resolves exactly this.
 */
/** No-repeat window: the player never faces the same opponent within this many rounds (owner rule 2026-07-15). */
const NO_REPEAT_ROUNDS = 4;

/** The loss-streak softener is armed for the NEXT pick iff the streak is long enough AND it hasn't already
 *  influenced a pick this streak (once per streak — owner call 2026-07-18). Spent at the boundary pin. */
function streakSoftenerLosses(s: RunState): number {
  const losses = s.lossStreak ?? 0;
  return losses >= MATCHMAKING.streak.after && !s.streakSoftened ? losses : 0;
}

export function nextOpponent(s: RunState): BoardSnapshot | null {
  // THE PIN WINS (reload-divergence fix, revived 2026-07-18): once this wave's opponent is stamped into
  // `servedBoards` (on the first recruit action of the turn — see the reduce() boundary — or at faceOmen),
  // every reader serves it verbatim: the recruit preview, the fight, and a reloaded session. Key-presence
  // check, not truthiness — a NULL pin means "this wave fought the procedural threat" and stays procedural.
  if (s.servedBoards && s.wave in s.servedBoards) return s.servedBoards[s.wave] ?? null;
  // Match on WAVE (same development stage — see pickOpponent). Power (captured at TURN START, so the
  // telegraphed foe stays fixed as you shop) is the fairness tiebreak among same-wave boards.
  // No-repeat: exclude the identities of the boards fought in the last NO_REPEAT_ROUNDS waves (recorded in
  // `servedBoards` by the pinning pass). Deterministic — the recruit preview and the actual serve read the same
  // fixed history, so they still agree.
  const exclude = new Set<string>();
  for (let w = s.wave - 1; w >= s.wave - NO_REPEAT_ROUNDS && w >= 1; w--) {
    const b = s.servedBoards?.[w];
    if (b) exclude.add(oppKey(b));
  }
  return pickOpponent(s.wave, s.turnStartPower, makeRng(mixSeed(s.seed, s.wave, TAG.ENEMY)), undefined, exclude, streakSoftenerLosses(s), setIdOf(s));
}

/** Loss-damage cap by round — the most Resolve a single loss can cost, ramping up as the course escalates:
 *  5 (rounds 1–3), 10 (4–7), 15 (8–11), 20 (12–15), then UNCAPPED (full damage) for the finale (16–17). */
export function lossDamageCap(wave: number): number {
  return wave <= 3 ? 5 : wave <= 7 ? 10 : wave <= 11 ? 15 : wave <= 15 ? 20 : Infinity;
}

/** Practice-BOT damage multiplier by difficulty (1 = every other mode, untouched). The stock face-damage formula
 *  tops out around 13 even against a tier-6 full board, which made bot games drag (owner ask 2026-08-25); this
 *  scales what a lost round costs so a sandbox game resolves in a sane number of rounds. Bots only — a Practice
 *  run against recorded PLAYERS keeps the normal numbers. */
export function practiceBotDamageMult(s: Pick<RunState, 'mode' | 'practiceConfig'>): number {
  if (s.mode !== 'practice' || s.practiceConfig?.opponents !== 'bots') return 1;
  return BOT_DAMAGE_MULT[s.practiceConfig.botDifficulty] ?? 1;
}

/** Merge a flat list of buffs by source (summing ±atk/±hp + count) — used to carry the inspect
 *  breakdown through a triple. */
function mergeBuffs(buffs: CardBuff[]): CardBuff[] {
  const out: CardBuff[] = [];
  for (const b of buffs) {
    const e = out.find((x) => x.source === b.source);
    if (e) { e.attack += b.attack; e.health += b.health; e.count += b.count; }
    else out.push({ ...b });
  }
  return out;
}

/** Whether a Magnetic minion can weld onto a target minion: they must share a tribe, counting BOTH
 *  cards' tribes. So Cling Drone (Mech) → any Mech *including* Heckbinder (Demon/Mech); Heckbinder
 *  → a Mech or a Demon; and a Mech-magnetic card can attach onto Heckbinder because it's also a Mech. */
export function magnetizesTo(magneticCardId: string, targetCardId: string, targetAddedTribes?: Tribe[], targetAllTribes?: boolean): boolean {
  const m = CARD_INDEX[magneticCardId];
  const t = CARD_INDEX[targetCardId];
  if (!m || !t) return false;
  // universalTribe Magnetic cards (Chaos Attachment) can weld onto any non-neutral target (or another all-type).
  if (m.universalTribe) return t.tribe !== 'neutral' || !!t.universalTribe || !!targetAllTribes;
  // A universalTribe HOST (CardDef flag) or an Anomaly-Reactor "All" instance counts as every tribe (incl. Mech),
  // so it accepts any Magnetic — e.g. a normal Mech magnetic welding onto it.
  if (t.universalTribe || targetAllTribes) return true;
  const mag: Tribe[] = [m.tribe, m.tribe2].filter((x): x is Tribe => !!x);
  // Anomaly Reactor: a spell-added instance tribe (Mech) makes the host a valid weld target too.
  const tgt: Tribe[] = [t.tribe, t.tribe2, ...(targetAddedTribes ?? [])].filter((x): x is Tribe => !!x);
  return mag.some((x) => tgt.includes(x));
}

/**
 * The run-loop state machine as a pure reducer: `(state, action) => state`
 * (handoff C.6). Never mutates its input — returns the same reference for a
 * no-op (invalid action) and a fresh state for a real transition. Recruit-phase
 * card effects live in `recruit.ts` (RECRUIT_FACTORIES); combat-time effects in
 * `@game/core`.
 */
/** Recruit actions a quest objective can watch → the objective event they count. `buyQuest` is deliberately
 *  absent (buying a quest isn't a "buy" objective). */
const QUEST_TICK_EVENTS: Partial<Record<Action['type'], QuestObjectiveEvent>> = {
  play: 'play', roll: 'roll', // `buy` + `sell` are handled separately (tribe-narrowed: "Buy N Beasts" / "Sell N Mechs")
};

// The odds probe (200 Monte Carlo sims) moved to `odds.ts` (`computeCombatOdds`) — deferred to UI idle
// time since 2026-08-01; faceOmen only stashes `oddsInput` now.

/** Take Discover option `index` into the hand — the ONE take path, shared by the player's click
 *  (`case 'discover'`) and the combat auto-pick (a Discover spell cast mid-fight grants a random choice,
 *  owner ruling 2026-08-08). Returns false when the pick can't resolve (bad index / unknown card); the
 *  full hand is a legitimate forfeit and still counts as taken. */
function takeDiscoverPick(s: RunState, index: number): boolean {
  const id = s.discover?.[index];
  const def = id ? CARD_INDEX[id] : undefined;
  if (!def) return false;
  // Albus (Empowerment): this pick REPLACES a Shop offer instead of joining the hand — the offer "turns into"
  // the chosen card. Handled before the hand path because none of the hand-only modifiers (locks, borrowed,
  // gilded, set-stats) mean anything to a Shop offer: it is still unbought, and gets its treatment on purchase.
  if (s.discoverIntoShopUid) {
    const idx = s.shop.findIndex((o) => o.uid === s.discoverIntoShopUid);
    if (idx >= 0) {
      returnToPool(s, s.shop[idx]!.cardId); // the displaced offer goes back, exactly like a reroll
      takeFromPool(s, def.id);
      s.shop[idx] = { uid: `s${s.uidSeq++}`, cardId: def.id, contraband: true }; // flagged so the UI flashes it
      return true;
    }
    // The offer is gone (bought or rerolled behind a queued Discover) — fall through and grant to hand rather
    // than silently dropping the pick.
  }
  const dcb = cardBuff(s, def.id); // a discovered Fodder carries Ritualist's run buff
  // The hand is a hard 10-card cap: a Discover into a full hand adds nothing (the pick is forfeit rather
  // than over-capping). Only claim a pool copy when the card is actually taken.
  if (s.hand.length < handCap(s)) {
    const taken: BoardCard = {
      uid: `b${s.uidSeq++}`,
      cardId: def.id,
      tribe: def.tribe,
      // A discovered Undead carries the run-wide Undead Attack bonus too (undeadBuyAtk), like a buy.
      ...conjuredStats(s, def, dcb),
      keywords: [...def.keywords],
      golden: false,
      // Disco Dan's Setlist: this pick is locked in hand until you reach its shop tier (T2/T4/T6).
      ...(s.discoverLockTier ? { lockedUntilTier: s.discoverLockTier } : {}),
      ...(s.discoverLockGold ? { lockedUntilGoldSpent: s.discoverLockGold } : {}),
      ...(s.discoverLockWave ? { lockedUntilWave: s.discoverLockWave } : {}), // Hourglass Reserve
      ...(s.discoverBorrowed ? { borrowed: true } : {}), // Funeral on Loan
    };
    // Rune of the Second Path: the pick's stats are SET to the authored line (20/20), replacing the
    // conjured stats entirely — an override, not a buff.
    if (s.discoverSetStats) { taken.attack = s.discoverSetStats.attack; taken.health = s.discoverSetStats.health; }
    // A GILDED Discover (a golden Salvatore McKlusky) hands the pick over already gilded — the same
    // transform a triple applies, so the stats/keywords stay consistent with every other golden.
    if (s.discoverGolden) gildMinion(taken);
    // Rune of Rising Echoes: the pick arrives carrying granted keywords (Rise + Taunt). Applied after the gild
    // so a gilded pick keeps them, and de-duped against what the card already has.
    for (const k of s.discoverKeywords ?? []) if (!taken.keywords.includes(k)) taken.keywords.push(k);
    s.hand.push(taken);
    takeFromPool(s, def.id); // a discovered copy leaves the shared pool (so selling it returns)
  }
  // RUNE OF DRACONIC CURIOSITY: taking a DRAGON out of a Discover hands over a random Shop spell. Fired on the
  // PICK (here) rather than on the offer, so it pays for what you actually took — and outside the hand-cap
  // branch above, because a Discover into a full hand still cost you the pick.
  if (s.runeDraconicCuriosity && (def.tribe === 'dragon' || def.tribe2 === 'dragon' || def.universalTribe)) {
    procRuneId(s, 'rune_draconic_curiosity');
    // One Shop spell per copy held (recurring family, owner 2026-08-27).
    conjureToHand(s, poolOf(s).spells.filter((c) => c.tier <= s.tier && !ALE_IDS.includes(c.id)), runeStacksOf(s, 'rune_draconic_curiosity'), true);
  }
  return true;
}

/**
 * Auto-resolve any Discover raised by an END-OF-TURN trigger (e.g. Moira replaying a Discover Shout like Black
 * Belt Brian) — grant a RANDOM pick from each pool WITHOUT opening the interactive picker (owner ruling
 * 2026-08-11). The shop is mid-transition to combat here, so a window would block the hand-off and read as a
 * bug. Mirrors the mid-combat Discover auto-grant in `settleCombat`: the offer is still BUILT by the real
 * `openDiscover` (same pools / tier rules / rng stream), only the CHOICE is rolled instead of asked, landing
 * through the same `takeDiscoverPick` a clicked Discover uses. Drains the queue too, so several EoT discovers
 * (two Brians via a Moira) all resolve.
 */
function autoResolveEotDiscovers(s: RunState): void {
  const clearDiscoverState = (): void => {
    s.discover = undefined;
    s.discoverLockTier = undefined; s.discoverLockGold = undefined; s.discoverLockWave = undefined;
    s.discoverBorrowed = undefined; s.discoverGolden = undefined; s.discoverSetStats = undefined;
  };
  let guard = 0;
  while ((s.discover?.length || (s.discoverQueue?.length ?? 0) > 0) && guard++ < 20) {
    if (!s.discover?.length) {
      const spec = s.discoverQueue?.shift();
      if (!spec) break;
      openDiscover(s, spec); // the low-level opener sets s.discover directly (no modal/queue check)
    }
    if (s.discover?.length) {
      const rng = makeRng(s.rngCursor);
      const pick = rng.int(s.discover.length);
      s.rngCursor = rng.state();
      // Wrap ONLY the hand-grant in a beat so the discovered card emits `cardGranted` and coalesces into the
      // hand during End-of-Turn playback (owner report 2026-08-14). The rng pick above stays outside the wrap,
      // so the stream position — and the card chosen — is byte-identical to before.
      withEotDiscoverGrantBeat(s, () => takeDiscoverPick(s, pick));
    }
    clearDiscoverState();
  }
}

/**
 * BEAT SYSTEM (PR 3) — `reduce` plus a presentation batch. The gameplay result is byte-for-byte what plain
 * `reduce` produces (the collector only records; it never touches state — see the equivalence test); the batch
 * is the source-attributed trigger/consequence timeline for this action, or null when `capture` is off.
 *
 * `capture` is passed by the caller (the sim package is env-agnostic): the UI store passes `import.meta.env.DEV`
 * so production and headless callers keep the zero-alloc NOOP path. Bots, balance tools and tests keep calling
 * plain `reduce`.
 */
export function reduceWithPresentation(
  state: RunState,
  action: Action,
  capture = false,
): { state: RunState; batch: PresentationBatch | null } {
  if (!capture) return { state: reduce(state, action), batch: null };
  // `faceOmen` runs End of Turn then hands off to combat — tag its batch `endOfTurn` so the viewer groups it
  // correctly; every other recruit action is `recruit`. (Per-trigger phase is set at each emit site too.)
  const phase = action.type === 'faceOmen' ? 'endOfTurn' : 'recruit';
  const collector = makeCollector(action.type, phase);

  // CHOREOGRAPHER PR 22 — hero powers emit, ALL of them, at the one chokepoint every activation passes
  // through. Wrapping the ACTION here rather than surgery inside the 140-line `case 'heroPower'` means every
  // power current and future is covered by construction, a rejected click (locked / unaffordable / passive
  // kind) emits nothing because the reducer returned the same state, and anything the power triggers
  // internally (Myra replaying a Battlecry → `withPlayTrigger`) nests under the hero's beat automatically.
  if (action.type === 'heroPower') {
    const hero = getHero(state.heroId);
    let next: RunState = state;
    withActiveCollector(collector, () => {
      const handle = collector.beginTrigger({
        phase: 'recruit',
        source: { kind: 'hero', id: state.heroId, label: hero.name, side: 'player' },
        trigger: hero.power.kind,
        ...beatIdentity(`hero:${state.heroId}:${hero.power.kind}`),
      });
      next = reduce(state, action);
      // Consequences by DIFF of two immutable states — the same technique the End-of-Turn primitive and the
      // quest-reward wrap use, because a power moves stats, hand, board and Gold through many helpers and
      // instrumenting each would be that many chances to miss one. Pure: reads both states, mutates neither.
      if (next !== state) emitHeroPowerDiff(collector, state, next);
      collector.endTrigger(handle);
    });
    // A rejected click resolved to the same state — discard the lone trigger rather than announcing a
    // moment in which nothing happened.
    return next === state ? { state, batch: null } : { state: next, batch: collector.finish() };
  }

  const next = withActiveCollector(collector, () => reduce(state, action));
  return { state: next, batch: collector.finish() };
}

/** The visible results of a hero power, read off (before, after). Anything not diffed here still has its
 *  MOMENT (the trigger above) — it just carries no itemized consequence yet. */
function emitHeroPowerDiff(collector: PresentationCollector, before: RunState, after: RunState): void {
  const statOf = new Map([...before.board, ...before.hand].map((c) => [c.uid, { a: c.attack, h: c.health }] as const));
  const handBefore = new Set(before.hand.map((c) => c.uid));
  const boardBefore = new Set(before.board.map((c) => c.uid));
  for (const c of [...after.board, ...after.hand]) {
    const was = statOf.get(c.uid);
    if (!was) continue;
    const da = c.attack - was.a;
    const dh = c.health - was.h;
    if (da === 0 && dh === 0) continue;
    const zone = after.hand.some((h) => h.uid === c.uid) ? 'hand' as const : 'board' as const;
    collector.emit({ type: 'statsChanged', target: { zone, uid: c.uid, cardId: c.cardId, side: 'player' }, attack: da, health: dh, permanent: true, channel: 'ordinary' });
  }
  // Keywords a power granted (Warden's Ward) — compared per uid, emitted per keyword gained.
  const kwBefore = new Map(before.board.map((c) => [c.uid, new Set(c.keywords)] as const));
  for (const c of after.board) {
    const was = kwBefore.get(c.uid);
    if (!was) continue;
    for (const kw of c.keywords) {
      if (!was.has(kw)) collector.emit({ type: 'keywordChanged', target: { zone: 'board', uid: c.uid, cardId: c.cardId, side: 'player' }, keyword: kw, gained: true });
    }
  }
  for (const c of after.hand) if (!handBefore.has(c.uid)) collector.emit({ type: 'cardGranted', target: { zone: 'hand', uid: c.uid, cardId: c.cardId, side: 'player' }, cardId: c.cardId });
  for (const c of after.board) if (!boardBefore.has(c.uid)) collector.emit({ type: 'cardSummoned', target: { zone: 'board', uid: c.uid, cardId: c.cardId, side: 'player' }, cardId: c.cardId });
  // Shop offers a targeted power buffed (Warden's Fortify on a tavern minion).
  const offerBefore = new Map(before.shop.map((o) => [o.uid, { a: o.atk ?? 0, h: o.hp ?? 0 }] as const));
  for (const o of after.shop) {
    const was = offerBefore.get(o.uid);
    if (!was) continue;
    const da = (o.atk ?? 0) - was.a;
    const dh = (o.hp ?? 0) - was.h;
    if (da > 0 || dh > 0) collector.emit({ type: 'shopChanged', change: 'buffed', target: { zone: 'shop', uid: o.uid, cardId: o.cardId, side: 'player' }, attack: da, health: dh });
  }
  if (after.embers !== before.embers) collector.emit({ type: 'resourceChanged', resource: 'gold', amount: after.embers - before.embers, valueAfter: after.embers });
  const maxBefore = before.maxEmbers + (before.maxGoldBonus ?? 0);
  const maxAfter = after.maxEmbers + (after.maxGoldBonus ?? 0);
  if (maxAfter !== maxBefore) collector.emit({ type: 'resourceChanged', resource: 'maxGold', amount: maxAfter - maxBefore, valueAfter: maxAfter });
}


/**
 * CHOREOGRAPHER PR 9 — run a hero power inside a source-attributed trigger scope.
 *
 * Hero powers were the last whole CLASS of automatic effect emitting nothing. That is why reclassifying one
 * in the Beat Lab did nothing on screen: the tool could change a beat's declared policy, but gameplay never
 * announced the moment, so there was no beat to reclassify. The registry key is `hero:<id>:<powerKind>` —
 * keyed on the POWER, not the hero's name, so two heroes sharing a mechanic share its presentation.
 *
 * Zero-cost when nothing is capturing (the NOOP collector short-circuits before any object is built).
 */
function heroBeat(state: RunState, powerKind: string, label: string, run: () => void): void {
  const collector = currentCollector();
  if (!collector.enabled) { run(); return; }
  collector.withTrigger(
    {
      phase: 'endOfTurn',
      source: { kind: 'hero', id: state.heroId, label, side: 'player' },
      trigger: powerKind,
      ...beatIdentity(`hero:${state.heroId}:${powerKind}`),
    },
    run,
  );
}

export function reduce(state: RunState, action: Action): RunState {
  // Shop-buff FX are per-ACTION: reset the scratch buffer on the INPUT state BEFORE reduceCore's clone, so the
  // clone (`next`) starts empty and, after the action, holds EXACTLY this action's captures (never accumulated
  // across dispatches). For a rejected no-op reduceCore returns `state` itself → `next.recruitBuffFx` stays [].
  state.recruitBuffFx = [];
  state.aleGranted = []; // per-action scratch: which Dwarf generated an Ale this action (aleGrantSeq stays monotonic)
  state.auraFx = undefined; // same per-action scratch contract as recruitBuffFx (auraFxSeq stays monotonic)
  state.veinstormStamped = undefined; // per-action scratch: which offers Veinstorm gemmed (veinstormFxSeq stays monotonic)
  // Weld FX does NOT use the per-action scratch contract above, and must not: React BATCHES dispatches, so
  // clearing the payload here destroyed welds that had not been rendered yet. A weld followed by any other
  // click in the same frame (in real play, almost always) coalesced into ONE render whose `weldFxUids` the
  // second action had already wiped — the ring never fired. Instead, record where this action starts;
  // `stampWeldFx` replaces on its first stamp of an action and accumulates after, so the payload survives
  // until the UI reads it and still never leaks between actions.
  state.weldFxBaseSeq = state.weldFxSeq ?? 0;
  stampImproveReps(state); // Rune of Mastery: mirror the state's Improve multiplier for the stateless addBuff hook
  // Pin this wave's opponent on the FIRST recruit action of the turn (reload-divergence fix, revived
  // 2026-07-18): the pick is stamped into `servedBoards` as soon as the turn is played, so the telegraphed
  // foe survives a reload instead of being re-picked from a session-variable pool (Supabase drift / fetch
  // timing — and now ledger-weight drift too). faceOmen's own pinning stays as the fallback for a turn with
  // zero prior actions. A null pick (empty pool → procedural fallback) is never pinned — later actions
  // retry as the pool fills. Pinning while the loss-streak softener is armed SPENDS it (once per streak).
  if (state.phase === 'recruit' && !(state.wave in (state.servedBoards ?? {}))) {
    const softening = streakSoftenerLosses(state) > 0;
    const preview = nextOpponent(state);
    if (preview) {
      state.servedBoards = { ...(state.servedBoards ?? {}), [state.wave]: preview };
      if (softening) state.streakSoftened = true;
    }
  }
  // THE TWO-STEP SHOP DEATH, safety half (owner design 2026-08-28). A body that has LANDED and is dying
  // (`pendingDeath`) must never survive into another action: whatever the player does next, the death resolves
  // FIRST. `resolveShopDeath` is the UI's explicit "the landing has been on screen long enough" — every other
  // action settles it implicitly, so a bot, a test or a replay that simply keeps playing reaches exactly the
  // state a player who watched the animation reaches. The intermediate state is therefore visible ONLY to
  // whoever is looking at the screen; it can never be built on.
  if (state.pendingDeath && action.type !== 'resolveShopDeath') {
    // Same carve-out reduceCore uses: deep-clone everything but the two large read-only structures.
    const { lastCombat: lc, servedBoards: sb, ...rest } = state;
    const settled = structuredClone(rest) as RunState;
    settled.lastCombat = lc;
    settled.servedBoards = sb;
    settlePendingDeath(settled);
    state = settled;
  }
  const next = reduceCore(state, action);
  // ── "WHEN A CARD IS ADDED TO YOUR HAND" (Gangplank, Rune of Heavy Payroll) ──────────────────────────────
  // Fired from a HAND UID-DIFF here, exactly like the onGainAttack board diff below, and for the same reason:
  // there is no single place a card enters the hand. There are ~20 `hand.push` sites — buying a minion, buying
  // a spell from the slot OR from the minion row, restoring a displaced minion, a Discover pick, a triple's
  // golden, an Ale, a minted Ruby, every rune/hero grant — and only THREE of them ever called the trigger, so
  // Gangplank silently ignored most of the game (owner report 2026-08-26: shop spells and Rubies didn't proc).
  //
  // The owner's rule is that "card" means ANY card at all, so the trigger belongs at the boundary rather than
  // sprinkled across call sites where the next new path will forget it again. Uids are fresh and monotonic, so
  // "in `next.hand` but not in `state.hand`" is exactly the set of cards that arrived this action — no id
  // guessing, no double-count when a card is merely reordered. Runs BEFORE the board diff so any Attack these
  // reactors grant is itself seen as a gain.
  if (next !== state) {
    const handBeforeUids = new Set(state.hand.map((c) => c.uid));
    const alreadyFired = new Set(next.gainCardFiredUids ?? []);
    for (const c of next.hand) {
      if (handBeforeUids.has(c.uid) || alreadyFired.has(c.uid)) continue;
      fireOnGainCard(next, c.cardId);
    }
  }
  // onGainAttack reactors (Hunter — "when this gains Attack, give your minions +Health") fire whenever a
  // recruit action raises a BOARD minion's Attack, from ANY source (Fortify, spells, tribe Battlecries,
  // weld, buy-triggers, end-of-turn). This mirrors combat, where `ctx.buff` emits onGainAttack on a positive
  // delta. We diff the board by uid: a minion present before AND after whose Attack strictly rose reacts.
  // New minions (played / summoned / Discovered) are creation, not a gain — skipped (a tripled reactor is
  // handled in `checkTriples`). Combat settles run in the combat phase, so the recruit-phase guard skips
  // them; the diff is ≤7 entries and `fireOnGainAttack` bails fast for non-reactors, so it's effectively free.
  if (next !== state && state.phase === 'recruit') {
    const before = new Map(state.board.map((c) => [c.uid, c.attack]));
    const handBefore = next.hand.length; // grows if a quest completing this action grants a card → triple-check
    for (const c of next.board) {
      const prev = before.get(c.uid);
      // Wrap the reactor so Hunter's "give your minions +Health" buff-to-others is captured as shop-buff FX,
      // sourced from the reacting minion `c` (a minion tendril), same as any other buff-other.
      if (prev !== undefined && c.attack > prev) captureBuffFx(next, c, 'minion', () => fireOnGainAttack(next, c));
    }
    // "Give Dragons N total stats" (Skybound Pact / Taragosa's Inheritance): sum the +Attack/+Health BUFFS a
    // Dragon present BEFORE and AFTER this action received (base stats of new Dragons are excluded — only gains
    // on existing Dragons, board + hand). Advances the `tribeStats` objective by that total.
    const statBefore = new Map([...state.board, ...state.hand].map((c) => [c.uid, { attack: c.attack, health: c.health }]));
    let dragonStatGain = 0;
    for (const c of [...next.board, ...next.hand]) {
      const prev = statBefore.get(c.uid);
      if (prev === undefined || !isTribe(c, 'dragon')) continue;
      dragonStatGain += Math.max(0, c.attack - prev.attack) + Math.max(0, c.health - prev.health);
    }
    if (dragonStatGain > 0) advanceQuestsBy(next, (o) => o.event === 'tribeStats' && o.tribe === 'dragon', dragonStatGain);
    // Spell Thesis: "Cast N spells" advances by the run-wide spellsCast delta this action.
    const spellCastDelta = (next.spellsCast ?? 0) - (state.spellsCast ?? 0);
    if (spellCastDelta > 0) advanceQuestsBy(next, (o) => o.event === 'castSpell', spellCastDelta);
    // HERO QUESTS (Fi / Coran): a spell cast is one step down the `journey` road. Advances by the same delta
    // `castSpell` uses — so a spell that casts twice moves the meter twice, exactly as its own quests count it.
    if (spellCastDelta > 0) advanceQuestsBy(next, (o) => o.event === 'journey', spellCastDelta);
    // Kobold quests: "Cast N Rubies" runs on its OWN meter. Deliberately not folded into `castSpell` — the
    // two objectives must stay unfillable by each other's cards (see `castRuby` in types.ts).
    const rubyCastDelta = (next.rubyCasts ?? 0) - (state.rubyCasts ?? 0);
    if (rubyCastDelta > 0) advanceQuestsBy(next, (o) => o.event === 'castRuby', rubyCastDelta);
    // "Grant N total stats to Shop minions": buffs landed on the offers actually sitting in the tavern, PLUS
    // any rise in the run-wide buy bonus (which every future offer inherits). Both are real stats given to the
    // shop; counting only the visible offers would make a run-wide buff read as zero progress.
    const offerBefore = new Map(state.shop.map((o) => [o.uid, { a: o.atk ?? 0, h: o.hp ?? 0 }]));
    let shopStatGain = 0;
    for (const o of next.shop) {
      const prev = offerBefore.get(o.uid);
      if (!prev) continue;
      shopStatGain += Math.max(0, (o.atk ?? 0) - prev.a) + Math.max(0, (o.hp ?? 0) - prev.h);
    }
    shopStatGain += Math.max(0, next.tavernBuyBonus.atk - state.tavernBuyBonus.atk) + Math.max(0, next.tavernBuyBonus.hp - state.tavernBuyBonus.hp);
    // Veinstorm's run-wide Ruby grant is stats given to the shop too — it just lives in its own accumulator.
    if (shopStatGain > 0) advanceQuestsBy(next, (o) => o.event === 'shopStats', shopStatGain);
    // Spell Power FX: one bump per action in which SPELL POWER WENT UP, by any source and any amount — not
    // per spell CAST (owner correction 2026-07-21: Cinderwing Matron's Shout buffs spell power and must fire
    // this, while casting a spell in a run with no spell-power sources must not). Both stats are watched:
    // spell power is a PAIR, and Cinderwing grants Health only, so an Attack-only check missed it entirely.
    // Derived from the before/after delta — NOT a per-action scratch field — so React batching can never
    // swallow it (the weld-FX bug).
    const spDeltaA = spellAttackBonus(next) - spellAttackBonus(state);
    const spDeltaH = spellHealthBonus(next) - spellHealthBonus(state);
    // RUNE OF THE SPELLSTONE (2026-08-14): Rubies inherit spell power, and a minted Ruby BAKES its stats into the
    // hand card — so a spell-power gain has to walk the hand and grow held Rubies, or they'd sit at the value
    // they were minted at while every freshly-minted one came in bigger. Exactly the bookkeeping `rubyStatGain`
    // already does for a `rubyBonus` gain; this is the same rule for the other half of the Spellstone total.
    // Only without the rune is a spell buff none of a Ruby's business (owner ruling 2026-07-23).
    if (next.runeSpellstone && (spDeltaA > 0 || spDeltaH > 0)) {
      for (const card of next.hand) {
        if (CARD_INDEX[card.cardId]?.ruby) { card.attack += Math.max(0, spDeltaA); card.health += Math.max(0, spDeltaH); }
      }
    }
    if (spDeltaA > 0 || spDeltaH > 0) {
      next.spellPowerFxSeq = (next.spellPowerFxSeq ?? 0) + 1;
      next.spellPowerFxAtk = Math.max(0, spDeltaA);
      next.spellPowerFxHp = Math.max(0, spDeltaH);
      // The acting card, when there is one — `play`/`buy`/`sell` all carry the uid, so the UI can anchor the
      // flourish to the minion that caused it. Left undefined for sourceless gains (quest/rune ticks).
      next.spellPowerFxUid = 'uid' in action && typeof action.uid === 'string' ? action.uid : undefined;
    }
    // RUBY POWER FX: the exact same contract for Ruby strength (owner ask 2026-07-24) — one bump per action in
    // which `rubyBonus` WENT UP, by any source and any amount. Derived from the before/after delta rather than a
    // scratch field for the same reason spell power is: React batching can otherwise swallow it. This one delta
    // covers the shop, End of Turn AND the combat carry-back, because Veinbreaker's mid-fight Avenge lands on
    // `rubyBonus` when the fight settles and so shows up here like any other source.
    const rbBefore = state.rubyBonus ?? { attack: 0, health: 0 };
    const rbAfter = next.rubyBonus ?? { attack: 0, health: 0 };
    const rpDeltaA = rbAfter.attack - rbBefore.attack;
    const rpDeltaH = rbAfter.health - rbBefore.health;
    if (rpDeltaA > 0 || rpDeltaH > 0) {
      next.rubyPowerFxSeq = (next.rubyPowerFxSeq ?? 0) + 1;
      next.rubyPowerFxAtk = Math.max(0, rpDeltaA);
      next.rubyPowerFxHp = Math.max(0, rpDeltaH);
      next.rubyPowerFxUid = 'uid' in action && typeof action.uid === 'string' ? action.uid : undefined;
    }
    // RUBY LANDED FX: which minions had a Ruby played ON them this action, for the per-cast cue. Read as a delta
    // of `rubiesOnThisTurn` (bumped by `fireOnRubyPlayed` on every recruit Ruby, whatever played it) so no play
    // site has to remember to stamp anything, and so React batching can't swallow it — the same reasoning as the
    // two power cues above. A minion SUMMONED with Rubies already on it (Geode Guardian's golems) is absent from
    // the before-map and so counts from 0, which is correct: those are Rubies that just landed.
    // Measured off the 'Ruby' BUFF COUNT, on board minions and tavern offers alike (a Ruby targets `any`, so it
    // lands on both). `addBuff`/`addOfferBuff` keep a per-source `count`, and every path that applies a Ruby goes
    // through one of them — which is precisely why the count is the right probe and `rubiesOnThisTurn` was not:
    // that counter only moves via `fireOnRubyPlayed`, and two live paths skip it. The offer path skips it
    // deliberately (firing an offer's on-Ruby watchers would pay out a Ruby Broker sitting in the shop);
    // `battlecryPlayRubiesAll` (Frenzied Excavator) skips it apparently by oversight — see the note on
    // `cardsPlayedPlayRubies`, which describes mirroring it and does make the call. Keying off the buff means the
    // cue is right either way, and stays right if that engine question is settled in either direction.
    const rubyCountOf = (c: { buffs?: { source: string; count: number }[] }): number =>
      c.buffs?.find((b) => b.source === 'Ruby')?.count ?? 0;
    // `settleCombat` carries mid-fight Ruby gains back onto the board as 'Ruby' buffs. That is BOOKKEEPING for
    // something the combat replay already played this cue for, not a landing — counting it would detonate every
    // carried-back minion the instant the shop reopens. Same double-play the Ruby POWER cue guards against.
    if (action.type !== 'settleCombat' && action.type !== 'resolveCombat') {
      const before = new Map<string, number>();
      for (const c of state.board) before.set(c.uid, rubyCountOf(c));
      for (const o of state.shop) before.set(o.uid, rubyCountOf(o));
      // The HAND too. `landed` scans `next.board`/`next.shop`, and a gemmed minion PLACED from the hand
      // (bought off a Veinstorm-gemmed offer, then dropped onto the board) arrives carrying its 'Ruby' buff
      // with the SAME uid it held in hand. Without a `before` entry for that uid its carried count reads as
      // count-minus-nothing and the cue detonates a SECOND time on the place (owner report 2026-08-11). A
      // hand card is never a Ruby TARGET (Rubies hit board minions and offers), so seeding it here can only
      // cancel a carry, never mask a real landing.
      for (const h of state.hand) before.set(h.uid, rubyCountOf(h));
      const rubyLanded: RubyLandedFx[] = [];
      // Offers VEINSTORM gemmed this action are handled by the shop-gem SPAN, not the per-card cue, so they are
      // excluded here — otherwise a gemmed offer would fire both. A lone Ruby dragged onto an offer is NOT in
      // this set (it never went through `stampVeinstormRubies`) and so still lands as an ordinary gem.
      const veinstormUids = new Set(next.veinstormStamped?.uids ?? []);
      // The DELTA, not the total — a minion already carrying Rubies from earlier this turn must report only
      // the ones that just arrived.
      const landed = (c: { uid: string; buffs?: { source: string; count: number }[] }): void => {
        if (veinstormUids.has(c.uid)) return;
        const n = rubyCountOf(c) - (before.get(c.uid) ?? 0);
        if (n > 0) rubyLanded.push({ uid: c.uid, count: n });
      };
      for (const c of next.board) landed(c);
      for (const o of next.shop) landed(o);
      if (rubyLanded.length > 0) {
        next.rubyLandedFxSeq = (next.rubyLandedFxSeq ?? 0) + 1;
        next.rubyLandedFx = rubyLanded;
      }
      // The Veinstorm signal itself: seq-gated like the payloads above, so the UI's span fires once per action.
      if (next.veinstormStamped && next.veinstormStamped.uids.length > 0) {
        next.veinstormFxSeq = (next.veinstormFxSeq ?? 0) + 1;
        next.veinstormFx = next.veinstormStamped;
      }
    }
    // Forsaken Will: each spell cast permanently buffs your Undead's Attack — exactly like the Forsaken Weaver
    // (bakes +N into every current Undead + `undeadBuyAtk` so future buys inherit it), so the quest reward feels
    // identical to the minion instead of a separate Lantern-style aura.
    if (spellCastDelta > 0 && next.forsakenWillAttack) buffUndeadAttackEverywhere(next, next.forsakenWillAttack * spellCastDelta, 'Forsaken Will');
    // Taragosa's Heir: a stat-gain amplifier — every stat gain THIS minion receives from any recruit-phase source
    // is multiplied (×2, golden ×3). We read the Heir's OWN +Attack/+Health this action and top it up by the extra
    // (mult−1)× so the net gain is mult×. The Heir's natural gain already counted toward the Dragon `tribeStats`
    // quest above; the amplified extra deliberately does not (added after that sum). Combat-phase gains aren't
    // amplified (this diff is recruit-only), matching the old reward's scope.
    const heir = next.board.find((c) => c.cardId === 'taragosaheir');
    if (heir) {
      const prev = statBefore.get(heir.uid);
      const dA = prev ? Math.max(0, heir.attack - prev.attack) : 0;
      const dH = prev ? Math.max(0, heir.health - prev.health) : 0;
      if (dA > 0 || dH > 0) {
        const extra = (heir.golden ? 3 : 2) - 1; // ×2 → +1× extra; ×3 → +2× extra
        addBuff(heir, "Taragosa's Inheritance", dA * extra, dH * extra);
      }
    }
    // Quest objectives (a successful recruit action already means `next !== state`):
    //  • buy / play / sell / roll — the tracked action (`buyQuest` itself is excluded from the map).
    //  • shout — the played card was a Battlecry minion (a "shout").
    //  • summon — EVERY minion that just ENTERED the board (the played card AND any tokens it summoned),
    //    narrowed by the objective's optional tribe. Reuses the same before/after board diff as onGainAttack;
    //    a play that immediately completes a triple counts as its NET board delta (the golden), not three.
    const questEvent = QUEST_TICK_EVENTS[action.type];
    if (questEvent) advanceQuests(next, (o) => o.event === questEvent);
    // HERO QUESTS (Fi / Coran): the other two `journey` steps — a MINION played from hand, and a Shop upgrade.
    // The play tick is narrowed to minions because a spell reaches the reducer as a `play` too, and it already
    // took its step through the `castSpell` delta above; without the narrowing every spell would count twice.
    if (action.type === 'play') {
      const played = state.hand.find((c) => c.uid === action.uid);
      const pdef = played ? CARD_INDEX[played.cardId] : undefined;
      if (pdef && !pdef.spell && !pdef.ruby) advanceQuests(next, (o) => o.event === 'journey');
    }
    if (action.type === 'upgrade') advanceQuests(next, (o) => o.event === 'journey');
    // Sell narrowed by the SOLD minion's tribe (Scrap Contract: "Sell 3 Mechs"); an untribed sell objective
    // (Grave Robber / Feed the Alpha) still ticks on any sell. The card is gone from `next` — read it from `state`.
    if (action.type === 'sell') {
      const soldCard = state.board.find((c) => c.uid === action.uid) ?? state.hand.find((c) => c.uid === action.uid);
      const sdef = soldCard ? CARD_INDEX[soldCard.cardId] : undefined;
      const stribes = sdef ? ([sdef.tribe, sdef.tribe2].filter(Boolean) as Tribe[]) : [];
      advanceQuests(next, (o) => o.event === 'sell' && (!o.tribe || stribes.includes(o.tribe)));
    }
    if (action.type === 'buy') {
      // "Buy N <tribe>" (Forager's Trail) / "Buy N Shout minions" (Warm Embers): narrow the buy tick to the
      // bought minion's tribe (dual-types count) and/or `filter: 'shout'` (has a Battlecry). Resolved from the
      // shop offer the action targeted.
      const offer = state.shop.find((c) => c.uid === action.uid);
      const bdef = offer ? CARD_INDEX[offer.cardId] : undefined;
      const tribes = bdef ? ([bdef.tribe, bdef.tribe2].filter(Boolean) as Tribe[]) : [];
      const isShout = !!bdef && hasBattlecry(bdef);
      advanceQuests(next, (o) => o.event === 'buy' && (!o.tribe || tribes.includes(o.tribe)) && (o.filter !== 'shout' || isShout));
      applyCardsBought(next, 1); // Korok / Banksly: "when you buy N cards" (the buy-count sibling of the Gold meter)
      next.cardsBoughtThisTurn = (next.cardsBoughtThisTurn ?? 0) + 1; // set 2: Frenzied Excavator's SoC scaler
      // Rune of the Collector: buying from 3 different TYPES in a turn Discovers a minion of one of them (once/turn).
      if (next.runeCollector && !next.collectorUsedThisTurn) {
        const set = new Set(next.typesBoughtThisTurn ?? []);
        for (const t of tribes) if (t !== 'neutral') set.add(t);
        next.typesBoughtThisTurn = [...set];
        if (set.size >= 3) {
          next.collectorUsedThisTurn = true;
          procRuneId(next, 'rune_collector');
          // Duplicate = doubled payoff per trip (threshold family, owner 2026-08-27): one Discover per copy.
          for (let k = 0; k < runeStacksOf(next, 'rune_collector'); k++) queueDiscover(next, { kind: 'minion', tier: next.tier, tribes: [...set] });
        }
      }
    }
    // A Shout is a TRIGGER: each Battlecry FIRE (Drakko + shout-repeat rewards + charges) counts toward the Shout
    // objective. `lastShoutFires` was recorded during the play / target resolution (0 if no Shout fired).
    for (let i = 0; i < (next.lastShoutFires ?? 0); i++) advanceQuests(next, (o) => o.event === 'shout');
    // Bane's Presence rides the SAME count the Shout objective does, so a doubled Shout advances the quest
    // and pays the reward identically rather than the two disagreeing about what "a Shout" is.
    applyShoutsForShopBuff(next, next.lastShoutFires ?? 0);
    applyShoutsForEndlessVerse(next, next.lastShoutFires ?? 0);
    advanceRuneThresholds(next, 'shout', next.lastShoutFires ?? 0); // Rune of the Chorus / Merchant's Chorus
    if ((next.lastShoutFires ?? 0) > 0) bumpAuthorsHand(next, 'shout', next.lastShoutFires!); // Author's Hand Shout half
    // An Echo (Deathrattle) is a TRIGGER too: a recruit-phase Echo (Grave Robber's destroy, Gravetwin/Crypt Broker,
    // Sylus re-fires) counts toward the `deathrattle` objective + Author's Hand's Echo half, just like a combat one.
    // `lastEchoFires` was accumulated by `fireRecruitDeathrattles` (0 if none fired).
    if ((next.lastEchoFires ?? 0) > 0) {
      advanceQuestsBy(next, (o) => o.event === 'deathrattle', next.lastEchoFires!);
      bumpAuthorsHand(next, 'echo', next.lastEchoFires!);
    }
    // A SHOP Rally (Rune of Lasting Cadence) is a Rally TRIGGER: it advances the `rally` objective and the
    // Author's Hand rally half like a combat one (owner ruling 2026-08-20). `lastRallyFires` accumulated in
    // `fireShopRally` — the one chokepoint every shop rally passes through.
    if ((next.lastRallyFires ?? 0) > 0) {
      advanceQuestsBy(next, (o) => o.event === 'rally', next.lastRallyFires!);
      bumpAuthorsHand(next, 'rally', next.lastRallyFires!);
    }
    if (action.type === 'play') {
      const played = state.hand.find((c) => c.uid === action.uid);
      const pdef = played ? CARD_INDEX[played.cardId] : undefined;
      // Play an Attachment (a Magnetic minion — whether it welds onto a Mech or stands alone): "Play N
      // Attachments" (Perfect Machine / Blueprint Cache / Shared Circuit).
      if (pdef?.keywords.includes('M')) {
        advanceQuests(next, (o) => o.event === 'playAttachment');
        // Rune of Structure: each Attachment you play from hand also conjures a random spell — one per copy
        // held (owner 2026-08-27: "rune of structure = you get 2 random shop spells").
        if (next.runeStructure) { procRuneId(next, 'rune_structure'); conjureToHand(next, poolOf(next).spells.filter((c) => c.tier <= next.tier), runeStacksOf(next, 'rune_structure')); }
      }
      // Trail Forager: each Beast you play raises every OTHER Trail Forager's sell value (+1, ×2 golden).
      if (pdef && (pdef.tribe === 'beast' || pdef.tribe2 === 'beast' || pdef.universalTribe)) {
        for (const c of next.board) {
          if (c.cardId === 'trailforager' && c.uid !== action.uid) c.sellBonus = (c.sellBonus ?? 0) + (c.golden ? 2 : 1);
        }
      }
    }
    for (const c of next.board) {
      if (before.has(c.uid)) continue; // only minions NOT present before this action count as summons
      const cdef = CARD_INDEX[c.cardId];
      const tribes = cdef ? ([cdef.tribe, cdef.tribe2].filter(Boolean) as Tribe[]) : [];
      advanceQuests(next, (o) => o.event === 'summon' && (!o.tribe || tribes.includes(o.tribe)));
      if (cdef?.imp) advanceQuests(next, (o) => o.event === 'summonImp'); // Imp Census / Implosion — recruit-summoned Imps
    }
    // A quest that completed this action may have granted a card to hand — if so, check for a triple (a quest
    // reward that's your 3rd copy combines into a golden). Guarded on a hand grant so it never re-triples the
    // action's own board state (the buy/play cases already handle their triples).
    if (next.hand.length > handBefore) checkTriples(next);
  }
  // Demon "Consume N Fodder" / "Consume N total stats" (Track and Fodder): advance by the run-wide Fodder-Consumed
  // delta this action — OUTSIDE the recruit-phase guard so a START-OF-TURN consume (fodder injected + eaten during
  // `advanceCombat`, part of the `resolveCombat` action while still in the combat phase) ALSO ticks the quest,
  // not just consumes from later recruit rolls (owner bug 2026-07-13).
  if (next !== state) {
    const fcBefore = state.runFodderConsumed ?? { count: 0, stats: 0 };
    const fcAfter = next.runFodderConsumed ?? { count: 0, stats: 0 };
    if (fcAfter.count > fcBefore.count) advanceQuestsBy(next, (o) => o.event === 'consumeFodder', fcAfter.count - fcBefore.count);
    // Bottomless Banquet: SHOP minions eaten, on its own meter — a set-2 Demon eats the tavern row where a
    // set-1 Demon eats Fodder, and neither quest should be fillable by the other's mechanic.
    const eatenDelta = (next.shopMinionsEaten ?? 0) - (state.shopMinionsEaten ?? 0);
    if (eatenDelta > 0) advanceQuestsBy(next, (o) => o.event === 'consumeShopMinion', eatenDelta);
    if (fcAfter.stats > fcBefore.stats) advanceQuestsBy(next, (o) => o.event === 'consumeStats', fcAfter.stats - fcBefore.stats);
  }
  // Bump the FX sequence once per action that actually buffed OTHERS (including the Hunter reaction wrapped
  // above, which runs before this). The UI fires the shop-buff replay once per bump; a no-op / non-buffing
  // action leaves `recruitBuffFx` empty and the seq unchanged.
  if (next !== state && next.recruitBuffFx.length > 0) next.recruitFxSeq += 1;
  // Same per-action contract for the ale-bubbles channel: bump once when a Dwarf generated an Ale this action.
  if (next !== state && next.aleGranted.length > 0) next.aleGrantSeq += 1;
  // AURA WASH FX: if a run-wide tribe-aura channel ROSE this action — the Undead aura (Lantern of Souls's
  // display-fold `undeadAttackBonus` AND the per-instance Undead-Attack snowball `undeadBuyAtk`:
  // Deathswarmer, Forsaken Mage's spell-cast buff, Forsaken Will), the Imp aura, the Attachment aura
  // (Scrap Herald), or the Beast buy-aura — stamp the one-shot wash signal with the affected visible cards.
  // Several of these never touch stored stats (the Lantern folds in at display time; buy-auras only size
  // FUTURE copies), so without the stamp the numbers jump with zero feedback. The undeadBuyAtk sources DO
  // also buff current Undead (→ tendrils) — the wash fires ALONGSIDE those (owner call: wash + tendrils).
  // Recruit-visible only: a faceOmen-time rise lands after the phase flips (the shop can't show it), so it
  // isn't stamped. Pure display metadata — never read by the sim.
  if (next !== state && state.phase === 'recruit' && next.phase === 'recruit') {
    const channels = (s: RunState): Record<AuraFxTribe, { a: number; h: number }> => ({
      undead: { a: s.undeadAttackBonus + (s.undeadBuyAtk ?? 0), h: s.undeadHealthBonus },
      demon: { a: s.impBuff?.attack ?? 0, h: s.impBuff?.health ?? 0 },
      mech: { a: s.magneticBuyAtk, h: s.magneticBuyHp },
      beast: { a: s.beastBuyAtk, h: s.beastBuyHp },
    });
    const cb = channels(state);
    const ca = channels(next);
    const risen: NonNullable<RunState['auraFx']> = [];
    for (const tribe of ['beast', 'demon', 'mech', 'undead'] as const) {
      const da = ca[tribe].a - cb[tribe].a;
      const dh = ca[tribe].h - cb[tribe].h;
      if (da > 0 || dh > 0) risen.push({ tribe, attack: Math.max(0, da), health: Math.max(0, dh), targets: auraFxTargets(next, tribe) });
    }
    if (risen.length > 0) {
      next.auraFx = risen;
      next.auraFxSeq = (next.auraFxSeq ?? 0) + 1;
    }
  }
  // RUN-WIDE SHOP BUFF: "minions in the Shop get +A/+H" landed on the whole row (Staff of Guel's cast,
  // Contract Butcher's Shout, a quest's `shopBuff` reward). Diffed off `tavernBuyBonus` rather than wired per
  // effect, so any future source animates for free — the same argument the aura-wash block above makes.
  //
  // The channel IS the "all shop units" test, which is why nothing here inspects the source: Market
  // Tormentor's single-offer Shout rides the per-offer channel and never moves this, and Veinstorm's shop
  // gemming was deliberately moved OFF this channel (see `spellBuffShopByRuby`) so its Rubies stay real
  // per-offer buffs — so the gem effects, which have their own `shopRubied` cue, cannot reach this signal.
  //
  // NOT gated on the phase staying `recruit`, unlike the aura wash: End of Turn flips to combat, and Soul
  // Defiler / Display Curator buff the shop exactly there. The End-of-Turn BEAT path plays this while the
  // shop is still on screen (see `eotFx`'s `shopBuffAll`); this action-level stamp covers the recruit-phase
  // casts and shouts.
  //
  // EXCEPT combat resolution (`resolveCombat`/`settleCombat`): a Shop buff EARNED in combat (Demon Horse's
  // Rally, etc.) now blooms the aura DURING the fight, in the attacker's lunge (see the `sc`-telegraph block in
  // `useCombatReplay`). Stamping it again here would replay the aura a SECOND time over the shop on return
  // (owner report 2026-08-19) — so skip the stamp for the combat transition; the offers still carry the buff.
  const combatResolve = action.type === 'resolveCombat' || action.type === 'settleCombat';
  if (next !== state && !combatResolve) {
    const da = (next.tavernBuyBonus?.atk ?? 0) - (state.tavernBuyBonus?.atk ?? 0);
    const dh = (next.tavernBuyBonus?.hp ?? 0) - (state.tavernBuyBonus?.hp ?? 0);
    if (da > 0 || dh > 0) {
      next.shopBuffAllFx = { uids: next.shop.map((o) => o.uid), attack: Math.max(0, da), health: Math.max(0, dh) };
      next.shopBuffAllFxSeq = (next.shopBuffAllFxSeq ?? 0) + 1;
    }
  }
  // RUNE-BUFF-UNIT FX: any board/hand minion whose RUNE-sourced buff total ROSE this action gets the
  // `rune-buff-unit` sparkle (owner ask 2026-08-19). Diffed off `runeBuffMagnitude` — the buff's source label
  // is on `card.buffs`, so this one place covers every rune that buffs a unit in the shop, with no per-site
  // wiring. Recruit-phase only: a combat-earned rune buff carried back at settle animates in the fight, and an
  // End-of-Turn rune buff plays on its own beat — both would double here otherwise.
  if (next !== state && state.phase === 'recruit' && next.phase === 'recruit') {
    const before = new Map<string, number>();
    for (const c of [...state.board, ...state.hand]) before.set(c.uid, runeBuffMagnitude(c));
    const hit: string[] = [];
    for (const c of [...next.board, ...next.hand]) if (runeBuffMagnitude(c) > (before.get(c.uid) ?? 0)) hit.push(c.uid);
    if (hit.length > 0) {
      next.runeBuffFxUnits = hit;
      next.runeBuffFxSeq = (next.runeBuffFxSeq ?? 0) + 1;
    }
  }
  return next;
}

function reduceCore(state: RunState, action: Action): RunState {
  // Read-only rejections run BEFORE the deep clone — every no-op dispatch (a click while a Discover is
  // open, an out-of-phase action) used to pay the full structuredClone below for nothing.
  // A finished run (loss or victory) takes no more actions — restart goes through the store.
  if (state.phase === 'gameover' || state.phase === 'victory') return state;
  // Nothing owed — a late or duplicate resolve (the UI timer racing a click) is a free no-op, not a clone.
  if (action.type === 'resolveShopDeath' && !state.pendingDeath) return state;

  // Recruit actions apply only in the recruit phase; `settleCombat` / `resolveCombat` only in combat.
  if (state.phase !== 'recruit' && action.type !== 'resolveCombat' && action.type !== 'settleCombat') return state;

  // Modal recruit states — a pending Discover / Choose One / targeted Battlecry — block every other board
  // action until they resolve. The player can still inspect (a UI-only concern), so a Discover can be
  // minimized to read the board without any action invalidating the pending pick.
  // (`devGrant` is exempt too: the Scene Builder must stay responsive with an overlay up, and a reward that
  // raises a Discover now queues behind the open modal rather than stacking on it.)
  //
  // End Turn (`faceOmen`) is exempt SPECIFICALLY when a battlecry aim (`pendingTarget`) is the blocker, and
  // this is load-bearing. The round timer pauses for the Discover / quest / Runeforge overlays but NOT for a
  // pendingTarget aim, so the timer can expire mid-aim — and the UI then blocks the target pick too (`timeUp`).
  // With End Turn also rejected here, the player was permanently softlocked, and since `pendingTarget` is
  // saved, a reload landed straight back in it (owner report 2026-07-22). `faceOmen` already auto-resolves a
  // pending target onto the highest-Attack legal carry, so ending the turn is a safe, defined escape.
  // The exemption is deliberately NARROW — only `pendingTarget`, NOT the other modals: `chooseOne`'s options
  // stay clickable under `timeUp` (so it can always be resolved and needs no escape), and letting End Turn fire
  // over an open Discover / Choose One / quest / Runeforge would strand it going into combat.
  const endTurnEscapesAim = action.type === 'faceOmen' && !!state.pendingTarget;
  // COMBAT TRANSITIONS ARE EXEMT TOO (found 2026-08-07 by the seed-7 hard bot). The phase guard above allows
  // ONLY `settleCombat`/`resolveCombat` while `phase === 'combat'`. So if a modal is open during a fight, the
  // phase guard rejects the modal-resolving action AND this guard rejects the transition — a hard deadlock
  // with no legal move, for a player as much as a bot. A Discover raised mid-combat is the reachable case.
  // Letting the transitions through is safe: the modal is untouched and presents itself in the next recruit
  // phase, which is where a Discover can be answered anyway.
  const combatTransition = action.type === 'resolveCombat' || action.type === 'settleCombat';
  if (modalOpen(state) && !combatTransition && action.type !== 'discover' && action.type !== 'chooseOne' && action.type !== 'cancelChoice' && action.type !== 'battlecryTarget' && action.type !== 'buyQuest' && action.type !== 'pickPower' && action.type !== 'buyRune' && action.type !== 'skipRuneforge' && action.type !== 'rerollRuneforge' && action.type !== 'devGrant' && action.type !== 'closeScout' && !endTurnEscapesAim) {
    return state;
  }

  // Disco Dan: turn 1 is a pure Setlist — resolve the three locked Discovers, then end the turn straight into
  // combat. Every shop action (buy / sell / roll / freeze / upgrade / play / hero power) is blocked until turn
  // 2; Discover, board reordering, and ending the turn (faceOmen) stay open.
  if (state.heroId === 'discodan' && state.wave === 1
    && (action.type === 'buy' || action.type === 'sell' || action.type === 'roll' || action.type === 'freeze'
      || action.type === 'upgrade' || action.type === 'play' || action.type === 'heroPower')) {
    return state;
  }

  // PERF: `lastCombat` is a large read-only result (the whole prior fight's event log + initial board
  // snapshots) that the reducer never mutates in place — it only ever REPLACES the reference (faceOmen).
  // So deep-clone everything ELSE and share lastCombat by reference, dropping ~80–90% of the per-dispatch
  // clone cost (otherwise every recruit click re-cloned the entire event graph for nothing).
  //
  // `servedBoards` earns the same carve-out (perf audit 2026-08-06): it accumulates one full BoardSnapshot
  // per wave and is only ever REPLACED wholesale (`{ ...old, [wave]: pick }` — the pinning pass and the
  // faceOmen serve), never mutated in place. By late game it measured ~90% of what remained of the clone
  // (0.23ms of 0.26ms at 17 pinned snapshots), paid on every buy/roll/sell/reposition for a structure no
  // action touches. If a future action ever needs to EDIT a pinned snapshot, it must replace the whole
  // record (as both existing writers already do) — mutating in place would leak across states.
  const { lastCombat, servedBoards, ...rest } = state;
  const s = structuredClone(rest) as RunState;
  // PER-ACTION FX SCRATCH (shop deaths / Echoes, and equip cues) is cleared HERE, on the CLONE, not on the
  // input above. Two things depend on that:
  //   · a REFUSED action returns `state` untouched — every rejection above happens before this clone, so a
  //     no-op is byte-identical, which the older input-side clears could not promise once the buffer held
  //     something;
  //   · the action's own stamps still start from empty, which is what stops cues ACCUMULATING — the bug that
  //     made the fifth Alchemist Frank play the equip animation five times (owner report 2026-08-28).
  if (s.shopDeathFx?.length) s.shopDeathFx = [];
  if (s.equipFx?.length) s.equipFx = [];
  s.lastCombat = lastCombat;
  s.servedBoards = servedBoards;
  // Sable: mirror this turn's Soulbind onto the stateless `addBuff` hook. MUST be stamped from the DRAFT `s`,
  // never from `state` — unlike `stampImproveReps` (which stamps a plain number) this captures the BOARD ARRAY,
  // and the pre-clone board is thrown away by the `structuredClone` directly above. Stamping it earlier meant
  // every mirrored buff landed on a discarded object, so the bond silently did nothing (owner report 2026-08-16).
  stampSableBond(s);
  stampSharedSpoils(s); // Rune of Shared Spoils rides the same stateless addBuff hook, from the same draft
  s.lastShoutFires = 0; // transient per-action Shout-fire count (set by a Battlecry play → read by the Shout quest tick)
  s.lastEchoFires = 0; // transient per-action out-of-combat Echo-fire count (set by fireRecruitDeathrattles → read by the deathrattle quest tick)
  s.lastRallyFires = 0; // transient per-action SHOP-Rally-fire count (set by fireShopRally → read by the rally quest tick)
  s.questTendrilFx = []; // transient per-action list of quest-triggered units (read by the tendril FX)
  s.lastEotFires = 0; // transient per-action End-of-Turn-fire count (set by applyEndOfTurn → read by the EoT quest tick)
  // The consume swirl is a PER-ACTION payload too. It used to be cleared only by the handful of call sites that
  // assigned it wholesale, while every other consumer APPENDED — so Set 2's shop-eating Demons grew the list
  // across actions and the UI replayed every past consume on each new one. That showed up as ghost minions
  // stacking over the shop, and as a card that hadn't eaten (Demon Horse) appearing to eat alongside one that had
  // (Hellrider) — owner report 2026-07-25. Clearing here makes each action's consumes self-contained, which
  // is what the FX wants, and leaves multi-consume actions (Feastmaster Vhal's two neighbours) animating fully.
  s.fodderEaten = [];
  s.shopEaten = []; // Set 2's shop-minion consume swirl — same per-action contract, separate channel
  s.gainCardFiredUids = []; // per-action: which hand arrivals already fired onGainCard (see the hand diff in `reduce`)

  switch (action.type) {
    case 'buy': {
      // The right-hand spell slot: pays its own (modifiable) cost, into the hand.
      // No triple / buy-trigger — a spell isn't a minion.
      if (s.spell && s.spell.uid === action.uid) {
        const spellDef = CARD_INDEX[s.spell.cardId];
        if (!spellDef) return state;
        const cost = Math.max(0, (spellDef.cost ?? 0) - spellCostReduction(s, spellDef)); // `spellDef` is load-bearing: Rune of Thrift keys on it
        if (s.embers < cost || s.hand.length >= handCap(s)) return state;
        spendGold(s, cost);
        if (s.cadenceSpellOff) procRuneId(s, 'rune_cadence');
      if (s.cadenceSpellOff) s.cadenceSpellOff = undefined; // Rune of Cadence: the armed spell discount is spent
        s.hand.push({
          uid: `b${s.uidSeq++}`,
          cardId: spellDef.id,
          tribe: spellDef.tribe,
          attack: spellDef.attack,
          health: spellDef.health,
          keywords: [...spellDef.keywords],
          golden: false,
        });
        s.spell = null; // bought — the slot stays empty until the next roll
        tiffBuyDiscount(s, spellDef); // Tiff: a spell buy banks a Dragon Tamer discount
        applySpellBought(s, spellDef.id); // Set 2 — fires `spellBought` (Moonhowl Mentor mints a Mage-Pup taught this spell)
        keshiCrownBuy(s, spellDef); // Keshi: a bought spell banks its tier toward the Crown
        return s;
      }
      const i = s.shop.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const offer = s.shop[i]!;
      const card = CARD_INDEX[offer.cardId];
      if (!card) return state;
      // A spell offer sitting in the minion row (Spell Cart's spell shop) buys into the hand at its OWN cost,
      // exactly like the right-hand spell slot — no minion creation / triple.
      if (card.spell) {
        const sCost = Math.max(0, (card.cost ?? 0) - spellCostReduction(s, card)); // pass the def — see the spell-slot buy above
        if (s.embers < sCost || s.hand.length >= handCap(s)) return state;
        spendGold(s, sCost);
        s.shop.splice(i, 1);
        ciaBuyEnchanted(s, offer); // Croupier Ayse: an Enchanted buy advances her prize counter
        s.hand.push({ uid: `b${s.uidSeq++}`, cardId: card.id, tribe: card.tribe, attack: card.attack, health: card.health, keywords: [...card.keywords], golden: false });
        tiffBuyDiscount(s, card); // Tiff: a spell buy banks a Dragon Tamer discount
        // There are TWO ways to buy a spell — the right-hand spell slot and a spell offer in the minion row —
        // and `spellBought` must fire from both. It only fired from the slot, so Moonhowl Mentor silently did
        // nothing for any spell bought from the row (owner report 2026-07-24: buying Spirit Fire didn't proc).
        applySpellBought(s, card.id);
        keshiCrownBuy(s, card); // Keshi: same for a spell bought out of the minion row
        return s;
      }
      // Displacement: a minion stashed in the tavern (held) is restored INTACT on buy — all buffs/progression
      // (deliberately NO applyOnBuy: it's a restoration, not a fresh purchase, so Broker & co. don't re-bake).
      if (offer.held) {
        const heldCost = minionCostOf(s);
        if (s.embers < heldCost || s.hand.length >= handCap(s)) return state;
        spendGold(s, heldCost);
        s.shop.splice(i, 1);
        ciaBuyEnchanted(s, offer); // Croupier Ayse: an Enchanted buy advances her prize counter
        // Clone the mutable arrays so the re-bought minion doesn't SHARE keywords/buffs with its held copy.
        const restored: BoardCard = { ...offer.held, uid: `b${s.uidSeq++}`, keywords: [...offer.held.keywords], buffs: offer.held.buffs ? [...offer.held.buffs] : undefined };
        // A HELD offer that was GILDED in the tavern must come back golden (owner bug report 2026-07-29: Golden
        // Touch appeared to do nothing on a displaced minion). This branch restores `held` verbatim and never
        // read `offer.golden`, so the gild was silently discarded — it looked tier-related because displacement
        // is how a high-tier minion tends to end up in the shop, but it affected every displaced minion.
        if (offer.golden && !restored.golden) gildMinion(restored);
        s.hand.push(restored);
        drakkoQuestBuy(s, card); // a paid buy still progresses Drakko's quest (it used to be skipped)
        chronosQuestBuy(s, card); // …and Chronos's End-of-Turn quest
        tiffBuyDiscount(s, card); // …and a restored Dragon banks Tiff's discount
        gorrQuestBuy(s, card); // …and a restored minion counts toward Gorr's Four Peat
        jugglerBuy(s);
        checkTriples(s); // a restored copy can still complete a triple
        keshiCrownBuy(s, card); // …and a re-bought displaced minion is still a paid purchase — AFTER checkTriples,
        // so a buy that completes a triple (3→1) frees hand space before the guard checks it (owner report: a
        // triple-completing buy at bank 24 was held against a hand that was about to empty)
        return s;
      }
      // "Freedom" rift OR Fi's First Pick quest: the FIRST minion bought each turn is free (overriding every
      // price source below). ONE shared spend-marker, so holding both is still one freebie per turn.
      const freeBuy = (s.rift === 'freedom' || !!s.questFreeFirstBuy) && !s.freeBuyUsedThisTurn;
      // Rune of Cadence: an armed minion discount knocks 1 off whatever the price source says.
      const cadenceOff = !freeBuy ? gateUses(s.cadenceMinionOff) : 0; // −1 per Cadence copy held (owner 2026-08-27)
      // GIFT — Friends and Family: shop minions cost less for the rest of this turn.
      const giftMinionOff = freeBuy ? 0 : (s.minionCostOffTurn ?? 0);
      // Rune of Trade-In: an armed per-type discount (from this turn's first sale) knocks 1 off a matching minion.
      const tiDef = s.tradeInTribe ? CARD_INDEX[offer.cardId] : undefined;
      const tradeInOff = !freeBuy && s.runeTradeIn && s.tradeInTribe && defIsTribe(tiDef, s.tradeInTribe) ? runeStacksOf(s, 'rune_trade_in') : 0; // All-types matches any armed tribe; −1 per copy held (owner 2026-08-27)
      // `heroOfferPrice` = Frantic Frank's Clearance / Foreman Flint's Company Rate (flat 2). Shared with the
      // UI's cost coin so the shown price is the charged price.
      const buyCost = freeBuy ? 0 : Math.max(0, (offer.cost ?? heroOfferPrice(s, offer) ?? s.minionCostOverride ?? minionCostOf(s)) - cadenceOff - tradeInOff - giftMinionOff); // Moe's set price > Frank/Flint 2g > Merchant's Mark override > Hank/default
      if (s.embers < buyCost || s.hand.length >= handCap(s)) return state;
      s.shop.splice(i, 1);
      ciaBuyEnchanted(s, offer); // Croupier Ayse: an Enchanted buy advances her prize counter
      spendGold(s, buyCost);
      if (cadenceOff) procRuneId(s, 'rune_cadence');
      if (cadenceOff) s.cadenceMinionOff = undefined; // spent
      if (tradeInOff) procRuneId(s, 'rune_trade_in');
      if (tradeInOff) s.tradeInTribe = undefined; // spent
      // Rune of Restocking: the FIRST minion you buy each turn refills its slot with a random same-Tier minion
      // priced at 2 Gold (owner 2026-08-18). Injected at the same index so the shop keeps its shape. A
      // duplicate widens the window — the first buy per copy restocks (owner 2026-08-27, unique-engine doubling).
      if (s.runeRestocking && gateUses(s.restockUsedThisTurn) < runeStacksOf(s, 'rune_restocking')) {
        procRune(s, 'runeRestocking');
        const boughtTier = CARD_INDEX[offer.cardId]?.tier;
        const pool = boughtTier ? poolOf(s).buyable.filter((c) => c.tier === boughtTier && !c.spell && !c.ruby) : [];
        if (pool.length > 0) {
          const rng = makeRng(s.rngCursor);
          const pick = pool[rng.int(pool.length)]!;
          s.rngCursor = rng.state();
          s.shop.splice(i, 0, { uid: `s${s.uidSeq++}`, cardId: pick.id, cost: 2 });
          s.restockUsedThisTurn = gateUses(s.restockUsedThisTurn) + 1;
        }
      }
      if (s.runeCadence) s.cadenceSpellOff = runeStacksOf(s, 'rune_cadence'); // …and buying a minion arms the spell discount (−1 per copy)
      if (freeBuy) s.freeBuyUsedThisTurn = true;
      // Fried Circuits: each minion bought buffs every Mech OFFER remaining in the shop, escalating by step per
      // purchase (buy 1 → +step, buy 2 → +2·step, …). The buff bakes into the offer's atk/hp when it's bought.
      if (s.friedCircuitsStepAtk || s.friedCircuitsStepHp) {
        s.friedCircuitsBuys = (s.friedCircuitsBuys ?? 0) + 1;
        const aAtk = (s.friedCircuitsStepAtk ?? 0) * s.friedCircuitsBuys;
        const aHp = (s.friedCircuitsStepHp ?? 0) * s.friedCircuitsBuys;
        for (const o of s.shop) {
          const d = CARD_INDEX[o.cardId];
          if (d && (d.tribe === 'mech' || d.tribe2 === 'mech' || d.universalTribe)) addOfferBuff(o, 'Fried Circuits', aAtk, aHp);
        }
      }
      const cb = cardBuff(s, card.id); // persistent run buff (Ritualist's Fodder enchantment)
      // Run-wide tribe ATTACK aura baked at buy: Undead (Lantern/Toxin Tender) + Beast (Squirl Scout), via the
      // shared helper so every tribe is handled. Applied ONCE, through addBuff below (which also records the
      // inspect breakdown). NB: this used to bake it into `attack` here AND addBuff it again → a double-count
      // bug (a bought Undead got 2× undeadBuyAtk); it's now applied exactly once, and Beasts get it too.
      const buyAura = undeadBuyBonus(s, card);
      const bought: BoardCard = {
        uid: `b${s.uidSeq++}`,
        cardId: card.id,
        tribe: card.tribe,
        attack: card.attack + cb.attack, // base + persistent run buff; the tribe aura is added just below
        health: card.health + cb.health,
        keywords: [...card.keywords, ...(offer.keywords ?? []).filter((k) => !card.keywords.includes(k))],
        golden: offer.golden ?? false, // Golden Touch: a gilded tavern offer buys in as a Golden
        boughtWave: s.wave, // Hoarder's sell value climbs from the wave it was bought
        ...(offer.sellZero ? { sellOverride: 0 } : {}), // Rune of the Bargain Bin: bought from the bin → sells for 0
      };
      // Tavern buffs on the offer (Apples / Fortify / Fried Circuits / next-shop) bake in under their REAL
      // source names, not a blanket "Fortify"; fall back to a generic label for any legacy offer with no breakdown.
      if (offer.buffs?.length) for (const b of offer.buffs) addBuff(bought, b.source, b.attack, b.health, b.count);
      else addBuff(bought, 'Tavern buff', offer.atk ?? 0, offer.hp ?? 0);
      const buyAuraHp = buyHealthAura(s, card); // Scrap Herald: Magnetic minions also carry a Health aura
      if (buyAura > 0 || buyAuraHp > 0) addBuff(bought, 'Tribe Bond', buyAura, buyAuraHp);
      // Staff of Guel — the run-wide "every minion you buy" buff bakes in too (tavern purchases only).
      // Fodder is excluded: it already carries the Staff buff via its run-wide enchant (cardBuff above),
      // so applying it again here would double it on the rare directly-bought Fodder.
      if ((s.tavernBuyBonus.atk || s.tavernBuyBonus.hp) && !card.keywords.includes('FD')) {
        addBuff(bought, 'Staff of Guel', s.tavernBuyBonus.atk, s.tavernBuyBonus.hp);
      }
      // …and the THIS-TURN shop enchant (`tavernBuyBonusTurn` — Rune of the Merchant's Chorus, Night Market
      // Horror) on exactly the same rails, with the same Fodder exclusion for the same reason.
      //
      // "This turn" scopes WHICH OFFERS get enchanted, not how long a bought minion keeps it: once you pay for
      // a +40/+40 body it is yours, buffs and all. Without this the shop advertised the enchanted stats (the
      // row view sums BOTH layers) and the purchase quietly paid only the permanent half (owner report
      // 2026-08-26). `offerBuyStats` — the CONSUME path's "what is this offer worth" — has always summed both,
      // so buying and eating the same offer disagreed, which is its own proof this line was the missing one.
      const turnShop = s.tavernBuyBonusTurn;
      if (turnShop && (turnShop.atk || turnShop.hp) && !card.keywords.includes('FD')) {
        addBuff(bought, 'Shop Enchant', turnShop.atk, turnShop.hp);
      }
      // Veinstorm — the run-wide shop grant that is made of RUBIES (owner 2026-08-06). Same shape as the Staff
      // bonus above and the same Fodder exclusion, but recorded under the `Ruby` source, which is the entry
      // `rubyTallyOf` reads in BOTH phases: the bought minion now genuinely carries "N Rubies", so a Gemheart
      // Carver's Echo sizes its Golem off it. No `fireOnRubyPlayed` here — see `spellBuffShopByRuby` for why
      // a shop-wide grant deliberately doesn't notify the on-Ruby watchers.
      // Golden Touch: a gilded offer buys in Golden — double the BASE stats only (accrued buffs stay single,
      // like a gild / triple), recorded as a buff so the inspect breakdown still itemizes it. The golden flag
      // (set above) doubles its effects (Deathrattles twice, ×N multipliers) and shows the golden frame.
      if (offer.golden) addBuff(bought, 'Golden Touch', card.attack, card.health);
      s.hand.push(bought); // buy → hand (Battlegrounds flow)
      // (a card reaching hand now fires `onGainCard` from the hand diff in `reduce` — see there)
      applyOnBuy(s, bought); // buy-triggers (Broker) bake in now (handoff C.5)
      // Dupes: the FIRST minion you buy each turn is copied into your hand (a fresh base copy, run buffs baked in).
      if (s.dupeFirstBuyEachTurn && !s.dupeUsedThisTurn && s.hand.length < handCap(s)) {
        s.dupeUsedThisTurn = true;
        conjureToHand(s, CARD_INDEX[card.id] ? [CARD_INDEX[card.id]!] : [], 1);
      }
      // Rune of Transcription: the next N bought minions each come with a free extra copy — counts DOWN and
      // retires at 0. Stacks with the first-buy dupe (they are separate purchases of the same idea).
      if ((s.runeTranscription ?? 0) > 0 && s.hand.length < handCap(s)) {
        procRune(s, 'runeTranscription');
        s.runeTranscription = (s.runeTranscription ?? 0) - 1;
        if (s.runeTranscription <= 0) s.runeTranscription = undefined;
        conjureToHand(s, CARD_INDEX[card.id] ? [CARD_INDEX[card.id]!] : [], 1);
      }
      drakkoQuestBuy(s, card); // Drakko's quest counts every paid Battlecry buy
      chronosQuestBuy(s, card); // Chronos's quest counts every paid End-of-Turn buy
      tiffBuyDiscount(s, card); // Tiff: a Dragon buy banks a Dragon Tamer discount
      gorrQuestBuy(s, card); // Gorr: the 3rd minion bought this turn conjures a random plain copy
      jugglerBuy(s);
      checkTriples(s); // a 3rd copy combines into a golden + grants a Discover
      keshiCrownBuy(s, card); // Keshi: bank this minion's tier toward the Crown — AFTER checkTriples, so a
      // buy that completes a triple (3→1) frees hand space before the full-hand guard checks it
      return s;
    }

    case 'play': {
      // hand → board (Battlegrounds: play to trigger summon-buffs + Battlecry)
      const i = s.hand.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const card = s.hand[i]!;
      // Disco Dan: a Setlist minion is locked until you reach its shop tier — unplayable before then.
      if (card.lockedUntilTier && s.tier < card.lockedUntilTier) return state;
      // Brackus's Summit pick — locked until the run has spent enough Gold.
      if (card.lockedUntilGoldSpent && (s.goldSpent ?? 0) < card.lockedUntilGoldSpent) return state;
      // Hourglass Reserve: locked until next turn — unplayable until the wave advances.
      if (card.lockedUntilWave && s.wave < card.lockedUntilWave) return state;

      const def = CARD_INDEX[card.cardId];

      // ── CHOOSE ONE: THE CHOICE COMES FIRST (owner ruling 2026-08-28) ─────────────────────────────────────
      // "You should drag the spell up, then choose one, then target a minion to buff." So playing a Choose One
      // card COMMITS NOTHING: no card leaves hand, no minion reaches the board, no counter moves, no RNG is
      // drawn. All this branch does is open the prompt.
      //
      // Once the branch is picked, the play is REPLAYED from the top with the pick in hand (`chooseOnePick`),
      // so every consequence below — the cards-played meter, `playedThisTurn`, the board splice + Odelle, the
      // summon buffs in `playCard`, the Attachment/Refrain riders (and Refrain's RNG roll), triples, the golden
      // Discover — fires exactly ONCE, AFTER the choice, in the same order it always did. That equivalence is
      // what makes the deferral safe for old recordings: the action SEQUENCE for a minion Choose One is
      // unchanged (`play` → `chooseOne` → maybe `battlecryTarget`), only the moment the body appears moves.
      //
      // It is also what makes a cancel a pure no-op: there is nothing to undo.
      //
      // Skipped for a card whose branches are ALREADY all enabled (`chooseBothActive` — a golden Orivax, or
      // Facetwright / Veinbreaker under their runes): those never prompt, so they fall straight through and
      // resolve every branch at the normal site.
      //
      // LEGACY REPLAY SHAPE: before this change a targeted Choose One SPELL was aimed during the drag, so an
      // old recording carries `play { targetUid }`. That shape still routes down the old target-first path
      // (see the spell branch below) — `!action.targetUid` is what separates the two, and nothing in the new
      // flow ever sends a `targetUid` on a Choose One play.
      if (def?.chooseOne?.length && !card.borrowed && !action.targetUid
          && s.chooseOnePick?.uid !== card.uid && chooseOneNeedsChoice(s, card, def)) {
        // A minion needs a free board slot before we bother asking (a spell takes none). Checked here as well
        // as at the normal site so a full board refuses the play outright rather than prompting for nothing.
        if (!def.spell && !def.ruby && s.board.length >= CONFIG.boardMax) return state;
        // A targeted Choose One SPELL with no legal target fizzles before the prompt (kept in hand, nothing
        // spent) — exactly as it did when the drag had to hit a target, and so the pick can never open an aim
        // with no answer. Minions deliberately do NOT fizzle: a Runic Beetle with no other Beast has always
        // played and auto-granted to itself, and the pick step still resolves it that way.
        if (def.spell && def.target && chooseOneTargetPool(s, def).length === 0) return state;
        s.chooseOne = { uid: card.uid, cardId: def.id, spell: !!def.spell, toIndex: action.toIndex };
        return s;
      }

      // Set 2 — the play-count meter (Mountainbond). "Cards" means EVERYTHING you play: minions, spells and
      // Rubies alike (owner 2026-07-29). It was on the minion branch only, so spells never counted. Fired here,
      // once, before the type branches — every branch below is a real play. A fizzle (no legal target) returns
      // the ORIGINAL `state`, so an increment on the draft is discarded with everything else, which is correct.
      applyCardsPlayed(s, 1);

      // Funeral on Loan: playing a BORROWED minion triggers its Echo out of combat, then it's destroyed.
      //
      // It OCCUPIES ITS DROP SLOT while the Echo fires (owner report 2026-08-04: a borrowed Dawnclaw dropped
      // beside a Shout "does not trigger the adjacent shouts"). Positional Echoes need the body to actually
      // BE somewhere — Dawnclaw's neighbours, Legion Shepherd's overflow counting against a real board — so
      // the card is spliced in at `toIndex` for the duration of the trigger and removed after, never staying.
      if (card.borrowed) {
        s.hand.splice(i, 1);
        s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId];
        const at = Math.max(0, Math.min(action.toIndex ?? s.board.length, s.board.length));
        // TWO BEATS, not one silent mutation (owner report 2026-08-28). The arrival is seen to take a slot,
        // and the Echo + departure get an animation window of their own — the gameplay and its ORDER are
        // unchanged, both helpers live in recruit.ts beside the trigger primitive they use.
        landBorrowed(s, card, at);
        return s;
      }

      // Discover-on-play (data-driven): playing this card isn't a minion — it opens a Discover (a peek) and
      // is consumed (no board slot). The offer is resolved from the card's `discoverOnPlay` spec against the
      // live run. These are untargeted, so Yazzus does NOT multiply them (we return before `spellCasts`) —
      // exactly one Discover. Covers Sprout / Help Wanted / Tribe Portal / Corpse Board and the golden
      // Triple Reward token; new Discover spells need only the data field, no reducer change.
      if (def?.discoverOnPlay) {
        const dop = def.discoverOnPlay;
        s.hand.splice(i, 1);
        s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId]; // counts as a card played (Rune of Action)
        // `grantKeywords` bakes keywords onto whatever is PICKED (Grave Invitation: an Echo minion that also
        // gains Rise + Taunt). Routed through `discoverKeywords`, the same channel the quest rewards use — the
        // pick-time application already lives there, so this only has to arm it. Without this the field parsed
        // and validated but nothing ever read it, and the grant silently did nothing.
        if (dop.grantKeywords?.length) s.discoverKeywords = [...dop.grantKeywords];
        // Discover a SHOP SPELL (Rift-Sunk Codex) — a spell Discover ignores tier/tribe/filter (it draws the
        // tavern spell pool up to the current tier). Multi-cast by the full spell multiplier, like the minion
        // path below.
        if (dop.spell) {
          const spellCastsN = def.singleCast ? 1 : spellCasts(s, def);
          for (let n = 0; n < spellCastsN; n++) { queueDiscover(s, { kind: 'spell' }); noteSpellCast(s, def); }
          if (!def.singleCast) s.nextSpellExtraCasts = undefined;
          if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true;
          if (!def.singleCast && s.runeSharedPour && ALE_IDS.includes(def.id)) s.sharedPourUsedThisTurn = true;
          return s;
        }
        // A triple-reward Discover carries the tier it was GRANTED at (`grantedTier`) so its "one tier up" is
        // frozen — taverning up with it in hand no longer bumps the offer. Other Discovers read the live tier.
        // The spec itself is built by the shared `discoverSpecFor` so a taught (Mage-Pup) cast of the same
        // spell offers exactly the same thing.
        const spec = discoverSpecFor(s, def, card.grantedTier);
        if (!spec) return s;
        // A TOKEN here (the Triple Reward) is NOT a Shop spell (owner rule 2026-08-01): it opens its Discover
        // and nothing else. No spell multiplier (Nimbus/Ancient Runes never double it), and no `noteSpellCast`
        // — so it is never the first/last spell the copy effects remember (Recurrence's End-of-Turn recast,
        // Steward of Spells, Recaller, Mushy), never advances a spell tally or threshold, and never fires a
        // spellCast watcher. It still counts as a CARD played (`playedThisTurn`, stamped above).
        if (def.token) {
          queueDiscover(s, { ...spec });
          return s;
        }
        // Multi-cast a Discover-spell by the full spell multiplier — open the Discover once per cast, the extras
        // queued behind the first. `spellCasts` folds in Nimbus (nextSpellExtraCasts), Ancient Runes (spellDoubleAlways)
        // and Spell Thesis (first-spell-each-turn); Yazzus is aimed-only so it's auto-excluded (a Discover spell is
        // untargeted). `singleCast` never multiplies. Bug fix (owner 2026-07-09): the old code read only
        // `nextSpellExtraCasts`, so Ancient Runes' "spells cast twice" silently did nothing for Discover spells.
        const casts = def.singleCast ? 1 : spellCasts(s, def);
        // A Discover spell IS a spell cast. This path used to return without ever reaching `castSpell`, so it
        // counted as nothing at all — no `spellsCast`, no quest tally, and no `spellCast` watchers, which is
        // why Sprout didn't trigger Runebloom Matriarch or Groveweaver (owner report 2026-07-27). Once per
        // cast, so a multiplied Discover counts each time, exactly like a multiplied ordinary spell.
        for (let n = 0; n < casts; n++) { queueDiscover(s, { ...spec }); noteSpellCast(s, def); }
        if (!def.singleCast) s.nextSpellExtraCasts = undefined; // Nimbus charge spent (already folded into `casts`)
        if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true; // Spell Thesis freebie spent
        if (!def.singleCast && s.runeSharedPour && ALE_IDS.includes(def.id) && !s.sharedPourUsedThisTurn) procRuneId(s, 'rune_shared_pour');
        if (!def.singleCast && s.runeSharedPour && ALE_IDS.includes(def.id)) s.sharedPourUsedThisTurn = true; // Shared Pour freebie spent
        return s;
      }

      // Rubies (set 2): a Ruby plays from hand onto a friendly minion — it grants that minion the Ruby's
      // current Attack/Health as a PERMANENT buff (source 'Ruby', itemized in the inspect breakdown so other
      // Kobolds can key off it), then is consumed. The buff is permanent exactly like a spell buff — shop or
      // combat, it never falls off (owner ruling 2026-07-23). A Ruby is NOT a Shop Spell: it
      // never touches `spellsCast` or any Shop-Spell trigger/quest; it advances its OWN `rubyCasts` counter,
      // and umbrella cards ("both spells and Rubies") read `spellsCast + rubyCasts`. No target → fizzle (kept).
      if (def?.ruby) {
        // A Ruby (target 'any') can land on a warband minion OR a tavern offer (buff it pre-buy) — same as an
        // `any` spell. No valid target → fizzle (kept in hand).
        const boardTarget = s.board.find((c) => c.uid === action.targetUid);
        const offer = s.shop.find((o) => o.uid === action.targetUid && !CARD_INDEX[o.cardId]?.spell);
        // Prismcaster: a Ruby played from hand casts `1 + Σ rubyExtraCast` times (× golden per Prismcaster).
        // Living Grimoire multiplies a RUBY too — it charges "the first spell", and a Ruby is a spell (owner
        // 2026-07-24: the card doesn't say "shop spell"). `grimoireMultActive` reads the charge; it's spent
        // below so the next cast of either kind is single.
        // Shared with the UI's ×N badge (`rubyCastCount`), so the number shown and the number resolved can't drift.
        const casts = rubyCastCount(s);
        if (boardTarget) {
          for (let n = 0; n < casts; n++) {
            addBuff(boardTarget, 'Ruby', card.attack, card.health);
            // Set 2 — the target's "when a Ruby is played on this" effects (Ruby Broker → Gold, Resonance → bounce).
            fireOnRubyPlayed(s, boardTarget, card.attack, card.health);
          }
          // Rune of Redirection: a Ruby landing on your LEFT-most minion also casts on your right-most. Fires
          // the target's own on-Ruby watchers too, so the second landing is a real Ruby cast rather than a
          // silent stat copy. Guarded against a one-minion board, where left-most IS right-most.
          const tail = s.board[s.board.length - 1];
          if (s.runeRedirection && boardTarget === s.board[0] && tail && tail !== boardTarget) {
            procRuneId(s, 'rune_redirection');
            // One extra landing per copy held (owner 2026-08-27, unique-engine doubling).
            for (let n = 0; n < casts * runeStacksOf(s, 'rune_redirection'); n++) {
              addBuff(tail, 'Ruby', card.attack, card.health);
              fireOnRubyPlayed(s, tail, card.attack, card.health);
            }
          }
          // Warding Ruby: grant its keyword (Ward = DS) — but only to a KOBOLD (owner spec 2026-07-31: "give it
          // Ward if it is a Kobold"). The stat half lands on anyone; the keyword is the tribe payoff.
          const kw = def.rubyGrantKeyword;
          if (kw && isTribe(boardTarget, 'kobold') && !boardTarget.keywords.includes(kw)) boardTarget.keywords.push(kw);
        } else if (offer) {
          for (let n = 0; n < casts; n++) addOfferBuff(offer, 'Ruby', card.attack, card.health);
          // Rune of Distillation says "Spells", not "Shop Spells" (owner 2026-08-04) — a RUBY cast on a Shop
          // minion also casts on your left-most minion: a real Ruby landing (stat buff + the target's own
          // on-Ruby watchers), mirroring the spell path's Distillation echo below.
          const lead = s.runeDistillation ? s.board[0] : undefined;
          if (lead) procRune(s, 'runeDistillation');
          // One extra landing per copy held (owner 2026-08-27, unique-engine doubling).
          if (lead) for (let n = 0; n < casts * runeStacksOf(s, 'rune_distillation'); n++) {
            addBuff(lead, 'Ruby', card.attack, card.health);
            fireOnRubyPlayed(s, lead, card.attack, card.health);
          }
        }
        else return state;
        s.hand.splice(i, 1);
        // A Ruby is a card played (owner ruling 2026-07-31: EVERYTHING you literally play or cast counts —
        // minions, Shop spells, Rubies, tokens). This was the one hand-consuming branch that never pushed,
        // so Kringle (the ex-Closing-Time Foreman) and Rune of Action undercounted on every Ruby.
        s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId];
        // Rune of Contraband: the FIRST Ruby cast each turn smuggles back a random Dwarven Ale.
        if (s.runeContraband && !s.contrabandRubyUsed) {
          procRune(s, 'runeContraband');
          s.contrabandRubyUsed = true;
          const ales = poolOf(s).spells.filter((c) => ALE_IDS.includes(c.id));
          // One Ale per copy held (owner 2026-08-27: "rune of contraband doubles the output of the ale/ruby per trigger").
          if (ales.length > 0) conjureToHand(s, ales, runeStacksOf(s, 'rune_contraband'));
        }
        // Rune of Gemscript: the FIRST Ruby cast each turn raises the run's SPELL power +1/+1.
        if (s.runeGemscript && !s.gemscriptRubyUsed) {
          procRuneId(s, 'rune_gemscript');
          s.gemscriptRubyUsed = true;
          // +1/+1 per copy held (owner 2026-08-27, unique-engine doubling).
          const gsr = runeStacksOf(s, 'rune_gemscript');
          s.spellBonus = { attack: (s.spellBonus?.attack ?? 0) + gsr, health: (s.spellBonus?.health ?? 0) + gsr };
        }
        const rubyCastsBefore = s.rubyCasts ?? 0;
        // The trigger meter is the UMBRELLA of Rubies + Shop Spells (see `fireOnRubyCast`), so both paths must
        // measure the SAME number — counting rubies on their own meter here would let the two drift and a
        // 3-cast threshold fire early or late depending on the mix.
        const umbrellaBefore = s.spellsCast + rubyCastsBefore;
        s.rubyCasts = rubyCastsBefore + casts;
        // ONE per play (not `casts`): this is the first-N-each-turn gate's meter, and counting resolved
        // casts made the doubled first Ruby consume the whole window (2026-08-06, with the Resonance rework).
        s.rubyCastsThisTurn = (s.rubyCastsThisTurn ?? 0) + 1;
        advanceRuneThresholds(s, 'castRuby', casts); // Rune of the Cindergem
        consumeGrimoireCharge(s); // a Ruby spends the Grimoire charge, same as a Shop Spell
        // Rune of the Spellstone: the Ruby ALSO counts as a Shop-spell cast. Deliberately after the Grimoire
        // spend and before the umbrella fire below, and via a narrow counter rather than `noteSpellCast` —
        // that would re-fire the umbrella this path already fires.
        if (s.runeSpellstone && def) { procRuneId(s, 'rune_spellstone'); countRubyAsShopSpell(s, def, casts); }
        fireOnRubyCast(s, umbrellaBefore, s.spellsCast + s.rubyCasts); // Gemgorge Fiend: every 3 → Consume a Shop minion
        return s;
      }

      // Other spells: cast on the chosen target, then consume — no board slot.
      if (def?.spell) {
        // Spell Choose One (Apples): a SPELL choice — its own thing, NOT a Battlecry. Pause for the pick,
        // keeping the spell in hand; the chosen effect is cast (and the spell consumed) in `chooseOne`.
        if (def.chooseOne?.length) {
          // THE PICK IS ALREADY IN (the new flow, replaying the deferred play): cast the chosen branch — with
          // its target, when the target step ran — and consume the spell. Every cast-bookkeeping rider lives in
          // the shared resolver so the choice step and the target step can never drift.
          const pick = s.chooseOnePick?.uid === card.uid ? s.chooseOnePick : undefined;
          if (pick) {
            s.chooseOnePick = undefined;
            return resolveChooseOneSpell(s, card, def, pick.index, pick.targetUid) ?? state;
          }
          // (BOTH) — a Choose One whose branches are all enabled already never prompts: it resolves every
          // branch right now, still aiming from the drag if the card targets.
          if (chooseBothActive(s, card, def)) {
            return resolveChooseOneSpell(s, card, def, 0, action.targetUid) ?? state;
          }
          // LEGACY TARGET-FIRST SHAPE (pre-2026-08-28 recordings only): the drag already aimed, so capture the
          // target uid now and let the pick land on it. `any` also accepts a tavern offer (buff it pre-buy).
          // No valid target → fizzle (spell kept in hand). The live game never produces this shape any more —
          // it is kept solely so old `replayActions` logs reproduce.
          if (action.targetUid && (def.target === 'friendly' || def.target === 'any')) {
            const boardTarget = s.board.find((c) => c.uid === action.targetUid);
            const offer = def.target === 'any' ? s.shop.find((o) => o.uid === action.targetUid && !CARD_INDEX[o.cardId]?.spell) : undefined;
            if (!boardTarget && !offer) return state;
            s.chooseOne = { uid: card.uid, cardId: def.id, spell: true, targetUid: action.targetUid };
            return s;
          }
          s.chooseOne = { uid: card.uid, cardId: def.id, spell: true };
          return s;
        }
        // A REWARD SPELL (Copycat — owner spec 2026-08-02): NOT a Shop spell. It resolves its effect exactly
        // ONCE — no Yazzus/Nimbus/Ancient-Runes multipliers, and none of the cast bookkeeping
        // (`castSpell`/`noteSpellCast`): no tallies, no first/last-spell memory the copy effects read, no
        // spellCast watchers, no Gemscript/Cadence/Contraband riders. It still counts as a card played.
        // Gated on `rewardSpell`, NOT `token` — Implosion is a token that IS a real Shop spell (test-caught).
        //
        // A GIFT (`def.gift`) is the SIBLING case and deliberately falls through to its own branch below: it
        // also resolves once with no multipliers, but it DOES pay the cast bookkeeping.
        if (def.rewardSpell) {
          const rewardTarget = def.target ? s.board.find((c) => c.uid === action.targetUid) : undefined;
          if (def.target && !rewardTarget) return state; // aimed reward with no valid friendly target → fizzle, kept
          applyCastEffects(makeContext(s), def, rewardTarget);
          s.hand.splice(i, 1);
          s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId];
          checkTriples(s); // the copy can complete a triple
          return s;
        }
        // A GIFT (owner design 2026-08-26): resolves exactly ONCE — never multiplied — but unlike a reward
        // spell it PAYS THE CAST BOOKKEEPING via `noteSpellCast`, so it counts as a spell cast for tallies,
        // thresholds, the Ruby+Spell umbrella and every `spellCast` watcher. `noteSpellCast` itself skips the
        // copy-memory writes for a Gift (see there), which is what makes a Gift uncopyable.
        if (def.gift) {
          const giftTarget = def.target ? s.board.find((c) => c.uid === action.targetUid) : undefined;
          if (def.target && !giftTarget) return state; // aimed gift with no valid friendly target → fizzle, kept
          applyCastEffects(makeContext(s), def, giftTarget);
          s.hand.splice(i, 1);
          s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId];
          noteSpellCast(s, def); // counts as a spell CAST (but never as a Shop spell — see the flag's doc)
          checkTriples(s);
          return s;
        }
        // Yazzus: while it's on the board, an *aimed* spell's effect resolves N times (2, or 3 if golden)
        // — the card is still consumed once. Untargeted economy/utility spells and `singleCast` spells
        // (Channeling the Devourer) never multi-fire (see `spellCasts`). The Discover-spells returned early
        // above. A bad target still fizzles before any cast (no partial state change).
        const casts = spellCasts(s, def);
        if (def.target === 'friendly' || def.target === 'any') {
          const boardTarget = s.board.find((c) => c.uid === action.targetUid);
          // A spell that cannot accomplish ANYTHING in this state is refused outright — kept in hand, no Gold
          // spent (owner audit 2026-08-03). The specific guards below predate this and stay: they encode
          // per-spell rules that aren't "would this do nothing" (Layaway wants a SHOP offer; Common Ground
          // defers to a second pick). See `spellFizzle.ts` for the general rule + why it errs toward casting.
          if (spellFizzles(s, def, boardTarget)) return state;
          // A tribe-restricted spell (Cupcakes: `targetTribe: 'demon'`) FIZZLES on any other tribe — kept in
          // hand, no cast, no partial state. The aim UI mirrors this, but the reducer is what actually decides
          // (owner report 2026-08-03: Cupcakes was landing on non-Demons — this guard simply didn't exist on
          // the SPELL path; only the minion-Battlecry paths checked `targetTribe`).
          const aimTribe = effectiveTargetTribe(s, def); // Rune of Open Appetite can lift this restriction
          if (boardTarget && aimTribe && !isTribe(boardTarget, aimTribe)) return state;
          // Resonance only fires on a Battlecry minion — a non-Battlecry target fizzles (spell kept in hand).
          if (boardTarget && def.effects.some((e) => e.do === 'spellReplayBattlecry') &&
              !CARD_INDEX[boardTarget.cardId]?.effects.some((e) => e.on === 'onPlay')) return state;
          // Displacement (targetNoGolden): can't trade away a golden (triple) — fizzles, spell kept in hand.
          if (boardTarget && def.targetNoGolden && boardTarget.golden) return state;
          // Layaway needs a SHOP offer (keep + cost cut) — aimed at a board minion it fizzles, kept in hand.
          if (boardTarget && def.effects.some((e) => e.do === 'spellLayaway')) return state;
          // Common Ground: the drag picked the FIRST friendly minion — defer to the aim picker for the SECOND,
          // then average the pair on `battlecryTarget`. Needs another friendly minion to exist, else it fizzles.
          if (boardTarget && def.effects.some((e) => e.do === 'spellAverageStats')) {
            if (!s.board.some((c) => c.uid !== boardTarget.uid)) return state; // no second minion → keep in hand
            s.pendingTarget = { uid: card.uid, cardId: def.id, spell: true, spellFirstUid: boardTarget.uid };
            return s;
          }
          // Displacement needs a tavern MINION to swap with (spells can't be displaced) — with none in the
          // tavern the swap can't happen, so the spell fizzles and stays in hand.
          if (boardTarget && def.effects.some((e) => e.do === 'spellDisplace') &&
              !s.shop.some((o) => !CARD_INDEX[o.cardId]?.spell)) return state;
          // `any` spells (Shatter, Front to Back) can also land on a tavern offer — buff it pre-buy.
          const offer = def.target === 'any' ? s.shop.find((o) => o.uid === action.targetUid) : undefined;
          if (boardTarget) for (let n = 0; n < casts; n++) castSpell(s, def, boardTarget);
          else if (offer) {
            for (let n = 0; n < casts; n++) castSpellOnOffer(s, def, offer);
            // Rune of Distillation: a spell that landed on a SHOP minion also casts on your left-most board
            // minion. A real second cast (same `castSpell` path), so the target's own on-spell watchers see it.
            const lead = s.runeDistillation ? s.board[0] : undefined;
            if (lead) procRune(s, 'runeDistillation');
            // One extra cast per copy held (owner 2026-08-27, unique-engine doubling).
            if (lead) for (let n = 0; n < casts * runeStacksOf(s, 'rune_distillation'); n++) castSpell(s, def, lead);
          }
          else return state; // a valid target is required (a friendly minion, or a tavern offer for `any`)
        } else {
          // Same rule for an UNTARGETED spell — Deep Delve Writ with no Dwarf in the tavern, Growth on an
          // empty board, Mend at full Resolve. This is where most of the audit's findings landed.
          if (spellFizzles(s, def)) return state;
          for (let n = 0; n < casts; n++) castSpell(s, def, undefined); // untargeted run spell (Growth, Ember Pouch)
        }
        if (!def.singleCast) s.nextSpellExtraCasts = undefined; // Nimbus charge spent on this cast (already folded into `casts`)
        if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true; // Spell Thesis freebie spent
        if (!def.singleCast && s.runeSharedPour && ALE_IDS.includes(def.id) && !s.sharedPourUsedThisTurn) procRuneId(s, 'rune_shared_pour');
        if (!def.singleCast && s.runeSharedPour && ALE_IDS.includes(def.id)) s.sharedPourUsedThisTurn = true; // Shared Pour freebie spent
        s.hand.splice(i, 1);
        s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId]; // one card played, even if it multi-cast (Rune of Action)
        // Rune of Contraband: the FIRST Dwarven Ale cast each turn smuggles back a Ruby.
        if (s.runeContraband && !s.contrabandAleUsed && ALE_IDS.includes(card.cardId)) {
          procRune(s, 'runeContraband');
          s.contrabandAleUsed = true;
          // One Ruby per copy held (owner 2026-08-27: "doubles the output of the ale/ruby per trigger").
          mintRubies(s, runeStacksOf(s, 'rune_contraband'));
        }
        // Rune of Gemscript: the FIRST Shop spell cast each turn raises RUBY power +1/+1 (run bonus + held Rubies,
        // the same shape the Veinbreaker burst uses).
        if (s.runeGemscript && !s.gemscriptSpellUsed) {
          procRuneId(s, 'rune_gemscript');
          s.gemscriptSpellUsed = true;
          // +1/+1 per copy held (owner 2026-08-27, unique-engine doubling).
          const gss = runeStacksOf(s, 'rune_gemscript');
          const b = s.rubyBonus ?? { attack: 0, health: 0 };
          s.rubyBonus = { attack: b.attack + gss, health: b.health + gss };
          for (const c of s.hand) if (CARD_INDEX[c.cardId]?.ruby) { c.attack += gss; c.health += gss; }
        }
        // Rune of Cadence: casting a Shop spell arms the 1-Gold discount on your next minion.
        if (s.runeCadence) s.cadenceMinionOff = runeStacksOf(s, 'rune_cadence');
        // A spell that conjures minions (Undead Army, Summon Stone) can hand you a 3rd copy — combine it.
        checkTriples(s);
        return s;
      }

      // Magnetic (handoff A.4): a Magnetic minion dropped directly onto a friendly minion sharing
      // one of its tribes merges its stats in instead of taking a board slot — so it works on a full
      // board and fires no summon-buff / Battlecry. (Cling Drone → Mech; Heckbinder, a Demon/Mech,
      // → Mech or Demon.)
      if (card.keywords.includes('M') && action.toIndex !== undefined && action.toIndex < s.board.length) {
        const target = s.board[action.toIndex];
        if (target && magnetizesTo(card.cardId, target.cardId, target.addedTribes, target.allTribes)) {
          s.hand.splice(i, 1);
          s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId]; // a welded Magnetic is still a card played (Rune of Action)
          // Playing a Magnetic minion IS a summon — fire summon-buffs on it BEFORE welding, so the absorbed
          // body carries any tribe summon-buff into the host (Chaos Attachment counts as a Beast → Mama
          // Bear's +X/+X lands on it, then welds onto the host). Mutates card.attack/health, read below.
          fireSummonBuffs(s, card);
          // Money Bot magnetized in: its mana-per-turn rides along on the host Mech (and survives the
          // host's triple); selling the host removes it.
          const mDef = CARD_INDEX[card.cardId];
          const mana = (mDef?.manaPerTurn ?? 0) * (card.golden ? 2 : 1) + (card.manaBonus ?? 0);
          // Weld the magnetic onto the host — stats, keywords, mana — and let any Beatboxer mimic it.
          const weldPayload = {
            source: mDef?.name ?? card.cardId,
            attack: card.attack,
            health: card.health,
            keywords: card.keywords,
            mana,
            // Better Bot: weld its Rally (+5 Attack to other Mechs on attack, golden ×2) onto the host — stacks.
            // `card.rallyMechAtk` is added too: a magnetic can ITSELF be carrying an accrued Better Bot rally (a
            // host welded onto, then bounced to hand by Rune of Refrain), and re-welding it must pass that along —
            // exactly as `spellAura`/`fodderAura` below fold in their `card.*Bonus`. Dropping it silently lost the
            // rally when a carrier magnetic was re-welded (owner report 2026-07-22). A freshly-bought Better Bot
            // has no instance value (its base lives on the def), so def×golden + accrued never double-counts.
            rallyMechAtk: (mDef?.rallyMechAtk ?? 0) * (card.golden ? 2 : 1) + (card.rallyMechAtk ?? 0) || undefined,
            // Perfect Core: weld its "Rally: get a random spell" onto the host (golden grants 2) — stacks.
            rallySpell:
              (mDef?.effects?.some((e) => e.do === 'rallyGrantSpell') ? (card.golden ? 2 : 1) : 0) || undefined,
            // Spell-power aura (def.spellAura — no card carries it in the current set): welds onto the host — stacks.
            spellAura: (mDef?.spellAura ?? 0) * (card.golden ? 2 : 1) + (card.spellAuraBonus ?? 0) || undefined,
            // Heckbinder: weld its Fodder aura (+1/+2 to new Fodder, golden ×2) onto the host — stacks, and
            // carries any aura already welded onto the magnetic itself (a hosted Heckbinder re-welded).
            fodderAura: mDef?.fodderAura || card.fodderAuraBonus
              ? {
                  attack: (mDef?.fodderAura?.attack ?? 0) * (card.golden ? 2 : 1) + (card.fodderAuraBonus?.attack ?? 0),
                  health: (mDef?.fodderAura?.health ?? 0) * (card.golden ? 2 : 1) + (card.fodderAuraBonus?.health ?? 0),
                }
              : undefined,
          };
          weldMagnetic(s, target, weldPayload, card.cardId === 'cling' ? 1 : 0, 'play'); // 'play' = the card slid in from hand
          // The FIRST Attachment played each turn (this weld counts; a standalone Magnetic play counts at its
          // own site below): Rune of Tempering also gives the minion it attached to Ward; Rune of Replication
          // also welds a copy of the same payload onto your leftmost Mech (which may be this same host — the
          // copy stacks, matching the text "attaches a copy").
          s.attachmentsThisTurn = (s.attachmentsThisTurn ?? 0) + 1;
          // Tempering's window widens with its copies (first attachment per copy — owner 2026-08-27);
          // Replication instead welds one copy PER COPY HELD onto the leftmost Mech, still on the turn's first.
          if (s.runeTempering && s.attachmentsThisTurn <= runeStacksOf(s, 'rune_tempering') && !target.keywords.includes('DS')) {
            procRune(s, 'runeTempering');
            target.keywords = [...target.keywords, 'DS'];
          }
          if (s.attachmentsThisTurn === 1 && s.runeReplication) {
            const leftMech = s.board.find((c) => isTribe(c, 'mech'));
            if (leftMech) {
              procRuneId(s, 'rune_replication');
              for (let k = 0; k < runeStacksOf(s, 'rune_replication'); k++) weldMagnetic(s, leftMech, { ...weldPayload, source: `${weldPayload.source} (Replication)` }, card.cardId === 'cling' ? 1 : 0);
            }
          }
          // A golden Magnetic still "plays" the triple when welded in — grant its Discover.
          if (card.golden) grantGoldenDiscover(s);
          return s;
        }
      }

      if (s.board.length >= CONFIG.boardMax) return state;
      s.hand.splice(i, 1);
      // Track every card played this turn (by cardId). Rune of Action reads its raw length ("each card you
      // played"); Pack Leader / Spirit Worgen filter it by tribe ("Beasts/Dragons you played"). Spells,
      // Discover-on-play cards and welded Magnetics also push into it below (they return before this line),
      // so the count is every hand card that resolved — tribe-filtered readers ignore the non-tribe ones.
      s.playedThisTurn = [...(s.playedThisTurn ?? []), card.cardId];
      const to =
        action.toIndex === undefined
          ? s.board.length
          : Math.max(0, Math.min(s.board.length, action.toIndex));
      s.board.splice(to, 0, card);
      // Odelle (Exhibition): landing a minion BETWEEN two others, where the three can be read as three
      // different types, buffs all three. Checked on the PLAY only (owner ruling 2026-08-16) — repositioning
      // into the same sandwich later does nothing — and read from the drop index, so it needs a real neighbour
      // on each side. `threeDistinctTypes` resolves a dual-type card to whichever of its types avoids a clash.
      if (hasPower(s, 'exhibition') && to > 0 && to < s.board.length - 1) {
        const trio = [s.board[to - 1]!, card, s.board[to + 1]!];
        if (threeDistinctTypes(trio)) {
          const amt = exhibitionGrantOf(s) * wishboneReps(s); // Wishbone: the Exhibition pays twice
          for (const m of trio) addBuff(m, 'Exhibition', amt, amt);
        }
      }
      playCard(s, card);
      // A STANDALONE Magnetic play (no host — it took a board slot) is still "playing an Attachment": the
      // first each turn gets Tempering's Ward on itself, and Replication still copies it onto the leftmost
      // Mech (the standalone body itself qualifies if it's the leftmost Mech-tribe minion... it welds a copy).
      if (card.keywords.includes('M')) {
        s.attachmentsThisTurn = (s.attachmentsThisTurn ?? 0) + 1;
        // Same duplicate rules as the weld path above: Tempering widens its window per copy; Replication welds
        // one copy per copy held on the turn's first attachment.
        if (s.runeTempering && s.attachmentsThisTurn <= runeStacksOf(s, 'rune_tempering') && !card.keywords.includes('DS')) {
          card.keywords = [...card.keywords, 'DS'];
        }
        if (s.attachmentsThisTurn === 1 && s.runeReplication) {
          const sDef = CARD_INDEX[card.cardId];
          const leftMech = s.board.find((c) => c.uid !== card.uid && isTribe(c, 'mech'));
          if (sDef && leftMech) {
            procRuneId(s, 'rune_replication');
            for (let k = 0; k < runeStacksOf(s, 'rune_replication'); k++) weldMagnetic(s, leftMech, {
              source: `${sDef.name} (Replication)`,
              attack: card.attack,
              health: card.health,
              keywords: card.keywords,
              mana: (sDef.manaPerTurn ?? 0) * (card.golden ? 2 : 1),
            }, card.cardId === 'cling' ? 1 : 0);
          }
        }
      }
      // Rune of Refrain (reworked 2026-07-21, 20% -> 25% owner 2026-08-07): each Shout (Battlecry) minion you play has a 25% chance to
      // return to your hand right after — the actual instance, buffs/golden intact, its Shout already fired,
      // so replaying it fires again. (Was: the 3rd Shout each turn returned that turn's first.) The roll is
      // drawn off the run cursor so a reloaded/replayed run resolves it identically. No-op if the hand is full.
      {
        const playedDef = CARD_INDEX[card.cardId];
        if (playedDef && hasBattlecry(playedDef)) {
          s.shoutsThisTurn = (s.shoutsThisTurn ?? 0) + 1;
          if (s.shoutsThisTurn === 1) s.firstShoutUid = card.uid;
          // Rune of Hoardcalling: the first DRAGON Shout each turn hands over a random Shop spell. Gated on
          // the played card being a Dragon, so a turn of Beast Shouts never spends the freebie.
          if (s.runeHoardcalling && !s.hoardcallingUsedThisTurn && isTribe(card, 'dragon')) {
            procRune(s, 'runeHoardcalling');
            s.hoardcallingUsedThisTurn = true;
            const spells = poolOf(s).spells.filter((c) => c.tier <= s.tier && !ALE_IDS.includes(c.id));
            // One Shop spell per copy held (recurring family, owner 2026-08-27).
            if (spells.length > 0) conjureToHand(s, spells, runeStacksOf(s, 'rune_hoardcalling'), true);
          }
          if (s.runeRefrain) {
            const rrng = makeRng(s.rngCursor);
            // 25% per copy held (owner 2026-08-27, unique-engine doubling), capped below certainty.
            const returns = rrng.int(100) < Math.min(95, 25 * runeStacksOf(s, 'rune_refrain'));
            s.rngCursor = rrng.state();
            if (returns && s.hand.length < handCap(s)) {
              procRune(s, 'runeRefrain'); // the 25% roll actually HIT — a miss is not the rune firing
              const idx = s.board.findIndex((c) => c.uid === card.uid);
              if (idx >= 0) {
                const [ret] = s.board.splice(idx, 1);
                if (ret) s.hand.push(ret);
              }
            }
          }
        }
      }
      // Choose One: the branch was decided BEFORE the body ever reached the board (see the deferral at the top
      // of this case), so by the time we get here either a pick is in hand or every branch is already enabled.
      const coDef = CARD_INDEX[card.cardId];
      if (coDef?.chooseOne?.length) {
        // (BOTH) — a golden Orivax, or Veinbreaker under the Rune of the Unbroken Vein: apply every option.
        // Both halves resolve through the same `applyChooseOne` path a picked option uses, so each keeps its
        // own golden scaling and buff-FX attribution, in printed order.
        if (chooseBothActive(s, card, coDef)) {
          if (s.runeUnbrokenVein && card.cardId === 'k_veinbreaker') procRuneId(s, 'rune_unbroken_vein');
          for (const opt of coDef.chooseOne) applyChooseOne(s, card, opt.effects);
        } else {
          const pick = s.chooseOnePick?.uid === card.uid ? s.chooseOnePick : undefined;
          const option = pick ? coDef.chooseOne[pick.index] : undefined;
          // No pick reached us — the deferral guard above should have caught it. Re-open rather than resolve
          // an arbitrary branch (the play is already committed at this point, so it must not silently vanish).
          if (!pick || !option) { s.chooseOne = { uid: card.uid, cardId: card.cardId }; return s; }
          s.chooseOnePick = undefined;
          card.chosenOption = pick.index; // the body only ever does this one thing now — its text narrows to it
          // A TARGETED branch (Runic Beetle) lands on the target the aim step already chose; with no legal
          // target the grant auto-picks (falls back to self), exactly as it always did.
          const target = pick.targetUid ? s.board.find((c) => c.uid === pick.targetUid) : undefined;
          if (target) applyChooseOneTarget(s, card, option.effects, target);
          else applyChooseOne(s, card, option.effects);
        }
      }
      // Targeted Battlecry (Toxin Tender → a friendly Undead): pause for the player to pick the target
      // (resolved in `battlecryTarget`) — but only if a *viable* target exists. The tribe-restricted pick
      // needs another matching friend; with none, the Battlecry simply doesn't fire and the minion plays
      // as-is (no prompt).
      // A Mage-Pup taught an AIMED spell opens the picker too (owner 2026-07-24). Checked BEFORE the def-level
      // test because the Pup's own CardDef is untargeted — the taught spell on the INSTANCE is what needs an
      // aim, so the usual `def.target` route can't see it. `playCard` skips its Shout for the same reason, and
      // `applyBattlecryTarget` fires it with the chosen target.
      if (taughtAimSpell(card)) {
        s.pendingTarget = { uid: card.uid, cardId: card.cardId };
        return s;
      }
      const playedDef = CARD_INDEX[card.cardId];
      // A Choose One owns its OWN targeting (the aim step ran before this replay, and the branch is already
      // applied above), so it must not fall into the generic targeted-Battlecry prompt as well — Runic Beetle
      // would open a second, meaningless aim. Before the deferral this block was unreachable for a Choose One
      // because the prompt returned early.
      if (playedDef?.target === 'friendly' && !playedDef.chooseOne?.length) {
        const hasTarget = playedDef.targetTribe
          ? s.board.some((c) => c.uid !== card.uid && isTribe(c, playedDef.targetTribe!))
          // `targetNotSelf` (Graverobber): a board holding ONLY this minion has no legal pick, so don't
          // prompt — the Battlecry simply doesn't fire and it plays as a plain body.
          : playedDef.targetNotSelf
            ? s.board.some((c) => c.uid !== card.uid)
            : true;
        if (hasTarget) {
          s.pendingTarget = { uid: card.uid, cardId: card.cardId };
          return s;
        }
      }
      checkTriples(s);
      if (card.golden) grantGoldenDiscover(s);
      return s;
    }

    case 'chooseOne': {
      if (!s.chooseOne) return state;
      const co = s.chooseOne;
      const def = CARD_INDEX[co.cardId];
      const option = def?.chooseOne?.[action.index];
      if (!def || !option) return state;
      // ── LEGACY TARGET-FIRST SPELL (old recordings only) ────────────────────────────────────────────────
      // A `play` that carried its `targetUid` opened this prompt with the target already pinned, and the card
      // was already counted as played. Resolve it in place — do NOT replay the play, or the cards-played meter
      // would tick twice for one card.
      if (co.spell && co.targetUid) {
        const out = resolveChooseOneSpell(s, s.hand.find((c) => c.uid === co.uid), def, action.index, co.targetUid);
        s.chooseOne = undefined;
        return out ?? s;
      }
      // ── THE PICK, DEFERRED-PLAY FLOW ───────────────────────────────────────────────────────────────────
      // Nothing has been played yet: the card is still in hand exactly as it was. A branch that needs a TARGET
      // hands off to the aim step first; otherwise the play is replayed now, carrying the pick, so every
      // consequence fires once and in order (see the deferral in `play`).
      const held = s.hand.find((c) => c.uid === co.uid);
      if (!held) { s.chooseOne = undefined; return s; }
      // Per-option `target` (The Godfodder's consume option) takes precedence over the card-level one
      // (Runic Beetle / Crest of the Climb, whose options all target).
      const optTarget = option.target ?? def.target;
      if (optTarget === 'friendly' || optTarget === 'any') {
        // Only aim when there is something legal to aim AT. With none, a spell has already fizzled at play
        // time and a minion resolves now with the grant auto-picking (falls back to self) — unchanged.
        if (chooseOneTargetPool(s, def).length > 0) {
          s.chooseOne = undefined;
          s.pendingTarget = {
            uid: co.uid, cardId: co.cardId, optionIndex: action.index,
            spell: !!co.spell, deferredPlay: true, toIndex: co.toIndex,
          };
          return s;
        }
      }
      s.chooseOne = undefined;
      s.chooseOnePick = { uid: co.uid, index: action.index };
      const after = reduceCore(s, { type: 'play', uid: co.uid, toIndex: co.toIndex });
      if (after === s) { s.chooseOnePick = undefined; return s; } // the replay refused — leave the card in hand
      openNextStartOfTurnModal(after); // this modal owned the screen — open whatever queued behind it
      return after;
    }

    case 'cancelChoice': {
      // CLICK AWAY = CANCEL (owner ruling 2026-08-28). Because a Choose One commits NOTHING until its branch
      // (and target) are settled, backing out is a pure no-op: the card never left hand, no Gold moved, no
      // trigger fired, and — deliberately — no RNG was drawn, so `rngCursor` and `uidSeq` are untouched.
      // Recorded as an action so a replay lives the abandoned play the same way the player did.
      //
      // It only ever cancels a DEFERRED Choose One. A legacy target-first prompt (`co.targetUid`) and an
      // ordinary battlecry aim (Toxin Tender, already on the board with its body committed) are both left
      // alone — there is no clean "untouched" state to return those to.
      if (s.chooseOne && !s.chooseOne.targetUid) { s.chooseOne = undefined; return s; }
      if (s.pendingTarget?.deferredPlay) { s.pendingTarget = undefined; return s; }
      return state;
    }

    case 'closeScout': {
      // Farseer's Report: dismiss the read-only scout reveal.
      s.scoutedNextOpponent = undefined;
      return s;
    }

    case 'battlecryTarget': {
      if (!s.pendingTarget) return state;
      const pt = s.pendingTarget;
      // ── CHOOSE ONE, TARGET STEP (owner ruling 2026-08-28: choose → target → resolve) ────────────────────
      // Nothing has been played yet — the card is still in hand. Validate the aim against the SAME pool the
      // play-time guard and the pick step read, then complete the play by replaying it with the branch and
      // the target in hand. A refused aim leaves the prompt up, so the player can pick again or click away.
      if (pt.deferredPlay) {
        const ptDefC = CARD_INDEX[pt.cardId];
        if (!ptDefC) return state;
        if (!chooseOneTargetPool(s, ptDefC, pt.uid).includes(action.targetUid)) return state;
        s.pendingTarget = undefined;
        s.chooseOnePick = { uid: pt.uid, index: pt.optionIndex ?? 0, targetUid: action.targetUid };
        const done = reduceCore(s, { type: 'play', uid: pt.uid, toIndex: pt.toIndex });
        if (done === s) { s.chooseOnePick = undefined; return s; } // the replay refused — card stays in hand
        openNextStartOfTurnModal(done); // this modal owned the screen — open whatever queued behind it
        return done;
      }
      // Common Ground (spell two-target): `pt.uid` is a HAND spell, not a board minion. The picker chose the
      // SECOND friendly minion — cast the average onto it (the factory reads the FIRST from `pt.spellFirstUid`),
      // then consume the spell. A missing/duplicate target fizzles but still consumes the spell.
      if (pt.spell) {
        const hi = s.hand.findIndex((c) => c.uid === pt.uid);
        const first = s.board.find((c) => c.uid === pt.spellFirstUid);
        const second = s.board.find((c) => c.uid === action.targetUid);
        const spellDef = CARD_INDEX[pt.cardId];
        if (hi >= 0 && spellDef && first && second && first.uid !== second.uid) {
          castSpell(s, spellDef, second); // factory averages `second` with `pt.spellFirstUid` BEFORE we clear pt
          s.hand.splice(hi, 1);
          s.playedThisTurn = [...(s.playedThisTurn ?? []), pt.cardId]; // counts as a card played (Rune of Action)
        }
        s.pendingTarget = undefined;
        checkTriples(s);
        return s;
      }
      const card = s.board.find((c) => c.uid === pt.uid);
      const target = s.board.find((c) => c.uid === action.targetUid);
      if (!card || !target) return state; // a friendly target is required
      // Self-targeting guard (Graverobber: destroying itself deleted the body that was paying for the spell).
      // Authoritative — the aim UI mirrors it, but the reducer is what actually decides.
      const ptDef = CARD_INDEX[pt.cardId];
      if ((ptDef?.targetNotSelf || ptDef?.targetTribe) && target.uid === card.uid) return state;
      // A tribe-restricted Battlecry may only resolve onto that tribe. This guard was MISSING: the aim UI
      // filtered the pick, but the reducer accepted whatever uid it was handed — so an off-tribe target was
      // fully resolved (an Appetite Agent could feed a Beast). Exactly the hole Cupcakes had on the SPELL
      // path (fixed 2026-08-03); this is the Battlecry twin, and it covers all five `targetTribe` cards, not
      // just the reported one. Refused outright: the card stays where it is and nothing resolves.
      if (ptDef?.targetTribe && !isTribe(target, ptDef.targetTribe)) return state;
      // A deferred targeted Choose One (Runic Beetle) resolves the CHOSEN option's effects on the target; a
      // normal targeted Battlecry (Toxin Tender) re-fires the card's own onPlay effects.
      const opt = pt.optionIndex !== undefined ? CARD_INDEX[pt.cardId]?.chooseOne?.[pt.optionIndex] : undefined;
      if (opt) applyChooseOneTarget(s, card, opt.effects, target);
      else applyBattlecryTarget(s, card, target);
      s.pendingTarget = undefined;
      checkTriples(s);
      if (card.golden) grantGoldenDiscover(s);
      openNextStartOfTurnModal(s); // this modal owned the screen — open whatever queued behind it
      return s;
    }

    case 'sell': {
      // Sell from the board or the hand.
      let sold: BoardCard | undefined;
      const bi = s.board.findIndex((c) => c.uid === action.uid);
      if (bi >= 0) {
        sold = s.board[bi];
        s.board.splice(bi, 1);
      } else {
        const hi = s.hand.findIndex((c) => c.uid === action.uid);
        if (hi < 0) return state;
        // Spells can't be sold — they're only played for their effect.
        if (CARD_INDEX[s.hand[hi]!.cardId]?.spell) return state;
        sold = s.hand[hi];
        s.hand.splice(hi, 1);
      }
      // Hoarder sells for a flat 2 Gold (golden 4); everything else for the base sell value. Rune of
      // Bartering (Shout minions sell for 2) is folded into the shared helper, so the UI coin matches.
      // Quick Sale: the next minion sold this turn gets a one-shot bonus on top, then the bonus is spent.
      if (sold) {
        // `sellValueWithBonus` — the SAME helper the UI's sell float reads, so the Gold paid and the number
        // floated can't drift (they did: the bonus used to be added inline here only).
        // Rune of Bartering earns its 2 Gold only on a Shout minion — the same condition `sellValueOf`
        // applies. Stamped HERE and not in that helper: it is a pure display query the sell float also calls,
        // so a stamp there would fire on every render rather than on the sale.
        if (s.runeBartering && hasBattlecry(CARD_INDEX[sold.cardId])) procRune(s, 'runeBartering');
        gainGold(s, sellValueWithBonus(sold, s));
        // Rune of Liquidation: the sold minion's FULL (live) stats transfer to the right-most Shop minion
        // (owner 2026-08-11; was BONUS-above-base only). No shop minion (all spells/Rubies, or an empty
        // tavern) → nothing to give.
        if (s.runeLiquidation) {
          const target = [...s.shop].reverse().find((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
          // Stats land once per copy held (owner 2026-08-27, unique-engine doubling).
          if (target && (sold.attack > 0 || sold.health > 0)) { procRuneId(s, 'rune_liquidation'); const lq = runeStacksOf(s, 'rune_liquidation'); addOfferBuff(target, 'Rune of Liquidation', sold.attack * lq, sold.health * lq); }
        }
        // Rune of Investment (owner 2026-08-18): every 2 minions sold mints Rubies at the run's live strength.
        if (s.runeSellRubies) {
          s.runeSellRubiesSold = (s.runeSellRubiesSold ?? 0) + 1;
          // The badge bursts on the MINT, not on every sale — the first sale of a pair banks toward the
          // threshold and is not the rune firing (same contract as Bulk Order's `per`).
          if (s.runeSellRubiesSold >= 2) { procRune(s, 'runeSellRubies'); mintRubies(s, s.runeSellRubies); s.runeSellRubiesSold -= 2; }
        }
        // Rune of the Aftermarket: the FIRST sale each turn gives HALF the sold minion's (live) stats to the
      // RIGHT-MOST Shop minion (owner 2026-08-11; was full BASE stats to every Shop minion).
      if (s.runeAftermarket && !s.aftermarketUsedThisTurn) {
        procRune(s, 'runeAftermarket');
        const soldDef = CARD_INDEX[sold.cardId];
        if (soldDef && !soldDef.spell && !soldDef.ruby) {
          s.aftermarketUsedThisTurn = true;
          const target = [...s.shop].reverse().find((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
          // Half stats per copy held (owner 2026-08-27, unique-engine doubling — two copies pass the full stats).
          const am = runeStacksOf(s, 'rune_aftermarket');
          const halfA = Math.floor(sold.attack / 2) * am;
          const halfH = Math.floor(sold.health / 2) * am;
          if (target && (halfA > 0 || halfH > 0)) addOfferBuff(target, 'Rune of the Aftermarket', halfA, halfH);
        }
      }
      // Rune of the Foundry: every `per` minions sold hands over a random Dragon (the run's pinned pool).
        if (s.runeFoundry) {
          const fd = { ...s.runeFoundry, sold: s.runeFoundry.sold + 1 };
          if (fd.sold >= fd.per) {
            fd.sold -= fd.per;
            const dragons = poolOf(s).all.filter((c) => !c.spell && !c.token && !c.ruby && (c.tribe === 'dragon' || c.tribe2 === 'dragon'));
            // Same 5-sale meter, one Dragon per copy held per trip (threshold family, owner 2026-08-27).
            if (dragons.length > 0) { procRuneId(s, 'rune_foundry'); conjureToHand(s, dragons, runeStacksOf(s, 'rune_foundry'), true); }
          }
          s.runeFoundry = fd;
        }
        if (s.nextSellBonus) s.nextSellBonus = 0;
      }
      // On-sell effects (Hoard Whelp → get 6 Gold), fired after the card leaves the board/hand.
      if (sold) fireOnSell(s, sold);
      // Set 2 — record the sale, then tell the BOARD about it (Voicekeeper). Recorded FIRST so a watcher
      // counting "the first Dragon sold this turn" sees this sale included, the way `playedThisTurn` works.
      if (sold) {
        s.soldThisTurn = [...(s.soldThisTurn ?? []), sold.cardId];
        fireOnMinionSold(s, sold);
      }
      // Rune of the Seller's Market: every minion you sell pumps your whole board +4/+3.
      if (sold && s.runeSellersMarket) { procRuneId(s, 'rune_sellers_market'); const sm = runeStacksOf(s, 'rune_sellers_market'); for (const c of s.board) addBuff(c, "Rune of the Seller's Market", 4 * sm, 3 * sm); }
      // Rune of Trade-In: your FIRST sale each turn arms a 1-Gold discount on your next minion of that TYPE.
      if (sold && s.runeTradeIn && s.soldThisTurn?.length === 1) {
        const t = CARD_INDEX[sold.cardId]?.tribe;
        if (t && t !== 'neutral') s.tradeInTribe = t;
      }
      // Robin's Spoils: each minion you sell banks +1 Gold for the START of next turn — stacks all turn, lands
      // on top of the cap, then is consumed + reset when next turn's Gold is set (Hoarder's bonus channel).
      if (sold && hasPower(s, 'sellGold')) s.bonusEmbersNextTurn = (s.bonusEmbersNextTurn ?? 0) + 1;
      // Return the copies to the shared pool (a golden ate three). Tokens aren't pooled → ignored.
      if (sold) returnToPool(s, sold.cardId, sold.golden ? 3 : 1);
      return s;
    }

    case 'roll': {
      // Rune of Window Shopping: your first 3 Refreshes each turn are free (counted before charging) — 3 per
      // copy held (owner 2026-08-27, unique-engine doubling: "Window Shopping 3→6 free refreshes").
      // The UI pill reads `nextRefreshCostOf` (above) — keep this branch and that helper in lockstep.
      const wsFree = !!s.runeWindowShopping && (s.windowShopRolls ?? 0) < 3 * runeStacksOf(s, 'rune_window_shopping');
      if (s.runeWindowShopping) s.windowShopRolls = (s.windowShopRolls ?? 0) + 1;
      // Refreshing Texts bank free rerolls — spend one before charging Mana.
      if (s.freeRolls > 0) {
        s.freeRolls -= 1;
      } else if (wsFree) {
        procRuneId(s, 'rune_window_shopping');
        // free — Window Shopping covers it
      } else {
        const rc = refreshCostOf(s); // Tradesman pays 2
        if (s.embers < rc) return state;
        spendGold(s, rc); // gold spent → Acid / Banksly meter
      }
      s.frozen = false;
      refreshTavern(s);
      // Rune of the Bargain Bin: the FIRST refresh each turn fills the row with 1-Gold minions that sell for 0
      // — one binned refresh per copy held (owner 2026-08-27, unique-engine doubling).
      if (s.runeBargainBin && gateUses(s.bargainBinUsedThisTurn) < runeStacksOf(s, 'rune_bargain_bin')) { s.bargainBinUsedThisTurn = gateUses(s.bargainBinUsedThisTurn) + 1; procRuneId(s, 'rune_bargain_bin'); fillBargainBin(s); }
      // Set 2 — tell the board a refresh happened (Hellrider counts them). Fired AFTER `refreshTavern`, so a
      // watcher that eats a Shop minion sees the NEW row rather than the one that just rolled away.
      applyShopRefreshed(s);
      // Rune of Open Enrollment: after a refresh, add ONE extra offer of your most common type per copy held
      // (owner 2026-08-27, unique-engine doubling).
      if (s.runeOpenEnrollment) { procRune(s, 'runeOpenEnrollment'); for (let k = 0; k < runeStacksOf(s, 'rune_open_enrollment'); k++) appendDominantTypeOffer(s); }
      // Pete (Contrabanana): every 3rd refresh guarantees the RIGHT-MOST offer is from the tier above.
      if (hasPower(s, 'contraband')) {
        s.refreshCount = (s.refreshCount ?? 0) + 1;
        if (s.refreshCount % 3 === 0) upgradeRightmostOffer(s);
      }
      return s;
    }

    case 'freeze': {
      s.frozen = !s.frozen;
      return s;
    }

    case 'upgrade': {
      const cost = upgradeCostOf(s); // includes Hermit Hank's +2 surcharge
      // Summit rift raises the ceiling to 7 — and so does a quest that grants `tier7Access` (Fi's Open Road,
      // Coran's Summit Passage). This branch read `maxTierFor` alone, so the flag opened Tier-7 DISCOVERS while
      // the shop ladder itself still stopped at 6: "Tier 7 is unlocked this game" has to mean the ladder too.
      const ceiling = hasTier7Access(s) ? 7 : maxTierFor(s.rift);
      if (s.tier >= ceiling || s.embers < cost) return state;
      spendGold(s, cost);
      s.aceTierDiscount = undefined; // Ayse's Ace: banked until an upgrade spends it, then gone
      s.tier += 1;
      // Rune of the Vault: 10 Gold the moment the shop reaches Tier 5 — then the rune is spent.
      if (s.runeVault && s.tier >= 5) {
        procRune(s, 'runeVault');
        // 10 Gold per copy held (threshold family, owner 2026-08-27: doubled payoff, still once per run).
        const vaultGold = 10 * runeStacksOf(s, 'rune_vault');
        s.runeVault = undefined;
        gainGold(s, vaultGold);
      }
      // Emerald Warden (Vanguard): every tavern-up also hands you a random minion of the tier you JUST reached
      // — read after `s.tier += 1`, so it always pays out the new pool, never the one you left. `exactTier`
      // semantics like Jensen's dig: the reward is the tier you bought, not "up to" it.
      if (hasPower(s, 'vanguard')) {
        const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier === s.tier);
        if (pool.length > 0 && s.hand.length < handCap(s)) conjureToHand(s, pool, wishboneReps(s)); // Wishbone: two
      }
      s.upgradeCost = s.tier >= ceiling ? 0 : (CONFIG.upgradeCost[s.tier + 1] ?? 0);
      return s;
    }

    case 'buyQuest': {
      // Quest shop (waves 4/8/12): "buy" the offered quest at `index` for 0 Gold → it moves to activeQuests and
      // the offer clears. The tavern was already rolled at quest-open (advanceCombat), so the shop already sits
      // behind the overlay for a shop-informed pick — nothing to roll here.
      const offer = s.questOffer;
      if (!offer) return state; // no quest shop open
      const questId = offer[action.index];
      if (questId == null || !QUEST_INDEX[questId]) return state; // invalid pick
      (s.activeQuests ??= []).push({ questId, progress: 0, completed: false });
      // A quest that IS the hero's power takes the power slot: its art replaces the button art, its objective
      // replaces the power text, and QuestBadges drops its node (the button is its home — owner ask
      // 2026-08-21, "should not go to the rune slot"). Two generations of this:
      //  · the 2026-08-21 hero quests — matched by the DEF (`heroQuest`), because Fi/Coran also take the
      //    universal turn-5/11 quests now and those must stay ordinary badges;
      //  · the retired lesserQuest/pathfinder powers (old saves) — their bonus shop was the only one they
      //    opened, so any taken quest was the granted one.
      {
        const kind = getHero(s.heroId).power.kind;
        if ((kind === 'heroQuest' && QUEST_INDEX[questId]!.heroQuest)
          || kind === 'lesserQuest' || kind === 'pathfinder') s.heroGrantArt = { kind: 'quest', id: questId };
      }
      s.questOffer = undefined;
      openNextStartOfTurnModal(s); // a quest turn can line up the Epic Runeforge / Discovers behind it — open next
      return s;
    }

    // The second half of the shop's two-step death. Resolved HERE rather than in `reduce`'s guard so it flows
    // through every piece of machinery an ordinary action gets — the hand-arrival diff (an Echo that grants a
    // card), the onGainAttack diff, quest ticks, the FX scratch buffers. An early return from the guard skipped
    // all of it, and a borrowed Echo's Ruby cue silently never fired.
    /**
     * SELECT an Equipment — swapping what the second slot shows. FREE by contract: no Gold, no activation,
     * no cooldown or exhaustion change (handoff). A real action rather than UI state so a recording replays
     * the swap the player actually made.
     */
    case 'selectEquipment':
      if (s.phase !== 'recruit') return state;
      return selectEquipment(s, action.equipmentId) ? s : state;

    /**
     * ACTIVATE the selected Equipment — ATOMIC, matching every hero power in this engine (owner ruling
     * 2026-08-28). Validate, pay, spend one shared allowance, resolve every trigger, in ONE action.
     *
     * There is no pending-activation state, which is exactly why "cancelling costs nothing" needs no
     * bookkeeping: a cancel never reaches the reducer at all. The UI arms the Equipment, the player picks a
     * target, and only then is this dispatched.
     */
    case 'activateEquipment': {
      if (s.phase !== 'recruit') return state;
      const granted = selectedEquipment(s);
      const def = granted ? EQUIPMENT_INDEX[granted.equipmentId] : undefined;
      if (!granted || !def) return state;
      if (equipmentUsesLeft(s) <= 0) return state; // the shared allowance is spent
      const cost = equipmentCostOf(s, def);
      if (s.embers < cost) return state; // unaffordable — visible but disabled, never a half-activation
      // A targeted Equipment needs a real, legal target. No target → the activation never happened: no Gold,
      // no allowance, nothing to undo.
      const target = def.targetMode === 'friendly'
        ? s.board.find((c) => c.uid === action.targetUid)
        : undefined;
      if (def.targetMode === 'friendly' && !target) return state;

      s.embers -= cost;
      const eq = s.equipment!;
      eq.activationsSpent += 1;
      eq.lastUsedEquipmentId = def.id; // "last used" means last successfully ACTIVATED, not last viewed
      // Additional triggers stack ADDITIVELY, and the count is SNAPSHOT here rather than re-read per trigger —
      // a repeat must never reproduce the modifier that created it (handoff).
      const triggers = 1 + (s.equipmentExtraTriggers ?? 0);
      // The SOURCE body for attribution, when one survives — a grant outlives its source within a turn, so a
      // stand-in carries the Equipment's own name for buff itemisation when the source has been sold.
      const src = s.board.find((c) => granted.sourceUids.includes(c.uid));
      const self: BoardCard = src ?? {
        uid: `eq:${def.id}`, cardId: def.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false,
      };
      if (!fireEquipmentTriggers(s, def, granted.version, self, target, triggers)) return state;
      // ONE use cue per ACTIVATION, not per trigger — the handoff's rule for repeats is that they "communicate
      // repetition without replaying the full animation", so a three-trigger Bloodpot is one travel, not three.
      stampEquipFx(s, {
        kind: 'use', uid: self.uid, cardId: self.cardId, equipmentId: def.id,
        ...(target ? { targetUid: target.uid } : {}),
      });
      checkTriples(s); // an Equipment that summons or grants can still complete a triple
      return s;
    }

    case 'resolveShopDeath':
      settlePendingDeath(s);
      // An Echo (or a Rise) can put a THIRD copy of something on the board — Mama Pup's two Pups beside one
      // you already own, a risen body beside its twins. The old borrowed path returned before ever reaching a
      // triple check, so Funeral on Loan could hand you three of a kind and simply leave them there (owner
      // report 2026-08-28). Graverobber's destroy already checked, via its battlecryTarget case.
      checkTriples(s);
      return s;
    case 'devGrant': {
      // DEV Scene Builder only — drop a quest or rune into the run without playing to the turn that offers it.
      // Everything routes through the SAME reward engine a real buy/completion uses (`applyQuestReward`), so a
      // reward that conjures cards, opens a Discover or schedules a delayed re-fire behaves exactly as it would
      // in a real run. That is the whole point of the rig: test the interaction, not a mock of it.
      if (action.kind === 'rune') {
        const rune = RUNE_INDEX[action.id];
        if (!rune) return state;
        applyQuestReward(s, { id: rune.id, name: rune.name, reward: rune.reward } as unknown as QuestDef, true, 'rune');
        (s.ownedRunes ??= []).push(rune.id);
      } else {
        const def = QUEST_INDEX[action.id];
        if (!def) return state;
        // Completed (the default) fills the bar and pays out once, exactly like a real completion. A REPEATABLE
        // quest never sets `completed` — it re-arms — so mirror that here rather than freezing it done.
        const completed = action.completed !== false;
        (s.activeQuests ??= []).push({
          questId: def.id,
          progress: completed ? def.objective.count : 0,
          completed: completed && !def.repeatable,
          completionCount: completed ? 1 : undefined,
        });
        if (completed) applyQuestReward(s, def, true);
      }
      checkTriples(s); // a granted copy can complete a triple (which opens its own Discover)
      openNextStartOfTurnModal(s); // a reward can raise a Discover — open it, or leave it queued behind an open modal
      return s;
    }

    case 'buyHenchman': {
      // Recruit your hero's HENCHMAN (owner spec 2026-08-03): a hero-bound minion, once per run, for its
      // decayed cost (win −3 / loss −2 per round, floored at 0 — `henchmanOffer`). Granted to HAND like a
      // conjured reward, NOT bought from the shop: no shop slot is consumed and no on-buy watchers fire
      // (`applyCardsBought` is deliberately absent — recruiting your henchman is not a tavern purchase).
      if (s.phase !== 'recruit') return state;
      const offer = henchmanOffer(s);
      if (!offer) return state; // no henchman on this hero, or already recruited
      const def = CARD_INDEX[offer.cardId];
      if (!def) return state; // unresolvable card — refuse rather than crash (same doctrine as loadSave)
      if (s.embers < offer.cost) return state; // can't afford — no-op (the UI greys it out)
      spendGold(s, offer.cost);
      s.henchmanBought = true;
      grantMinionToHandOrBoard(s, def, false, true);
      keshiCrownBuy(s, def); // Keshi: Gold spent on your henchman is Gold spent on a card
      checkTriples(s); // future-proof: an explicitly-shop-offered henchman copy could complete a triple
      return s;
    }

    case 'buyRune': {
      // Runeforge (turn 6): buy ONE offered rune for its Gold cost. Its reward applies for the run (via the
      // shared quest-reward engine), it joins `ownedRunes` (shown as a run-buff badge), and the forge closes.
      const offer = s.runeforgeOffer;
      if (!offer) return state;
      const runeId = offer[action.index];
      const rune = runeId != null ? RUNE_INDEX[runeId] : undefined;
      if (!rune) return state; // invalid pick
      const runeCost = Math.max(0, rune.cost - (s.runeforgeDiscounts?.[action.index] ?? 0)); // pivot discount
      if (s.embers < runeCost) return state; // can't afford — no-op (the UI greys it out)
      spendGold(s, runeCost);
      // DUPLICATES (owner rulings 2026-08-27, decisions q-runedup-*): a duplicate that cannot meaningfully
      // stack pays the universal SWEETENER (Gold = half the rune's printed cost rounded up, plus a free
      // refresh); a ruled-UNIQUE duplicate (Ornate Clock) does nothing at all; every OTHER duplicate simply
      // re-applies its reward — and the counted `runeStacks` (ticked in `applyQuestReward`) is what turns
      // that re-application into real stacking behaviour at every consumer (see runeDup.ts).
      const applyRuneCopy = (isDuplicate: boolean): void => {
        if (isDuplicate && RUNE_DUP_UNIQUE.has(rune.id)) return; // owner: unique — a duplicate does nothing
        if (isDuplicate && RUNE_DUP_SWEETENER.has(rune.id)) {
          gainGold(s, Math.ceil(rune.cost / 2));
          s.freeRolls += 1;
          return;
        }
        // ONE-SHOT re-grants that cannot pay right now BANK to next turn (owner 2026-08-27: "rune of the
        // armory would get 10 random attachments, and then next turn it would fire again, since you cannot
        // have 20 cards in hand"). The pendingQuestRewards channel resolves rune ids at the rollover.
        if (isDuplicate && (rune.id === 'rune_armory' || rune.id === 'rune_spare_parts')) {
          const count = (rune.reward as { randomFilterCount?: number }).randomFilterCount ?? 0;
          if (count > 0 && s.hand.length + count > handCap(s)) {
            (s.pendingQuestRewards ??= []).push({ questId: rune.id, turnsLeft: 1 });
            return;
          }
        }
        if (isDuplicate && rune.id === 'rune_altar' && s.board.length === 0) {
          (s.pendingQuestRewards ??= []).push({ questId: rune.id, turnsLeft: 1 }); // an empty board sells nothing — fire next turn instead
          return;
        }
        // Reuse the quest-reward engine — it reads only `reward` + `name` off the def.
        applyQuestReward(s, { id: rune.id, name: rune.name, reward: rune.reward } as unknown as QuestDef, true, 'rune');
      };
      applyRuneCopy((s.ownedRunes ?? []).includes(rune.id));
      // Rune of Duplication: "after you forge your Epic Rune, this transforms into a copy of it" — the Epic's
      // reward applies a SECOND time (owner ruling 2026-07-30: a rune that grants a minion grants two). Spent on
      // use, and only on an EPIC buy, so the basic forge that sold you Duplication cannot consume it. The copy
      // is always a DUPLICATE application, so a non-stacking Epic pays the sweetener instead of a silent no-op.
      if (s.runeDuplication && s.runeforgeEpic) {
        procRune(s, 'runeDuplication');
        s.runeDuplication = undefined;
        applyRuneCopy(true);
        (s.ownedRunes ??= []).push(rune.id); // shows as a second badge — the copy is a real rune you hold
      }
      (s.ownedRunes ??= []).push(rune.id);
      // The Runesmith's forge is a once-per-game HERO POWER; the quest-opened Epic forge is not — leave the
      // hero-power charge alone for it.
      if (!s.runeforgeEpic && !s.runeforgeNoCharge) s.heroPowerSpent = true;
      // The power button now wears this rune — but only when the forge was the HERO's, not a quest's.
      {
        const kind = getHero(s.heroId).power.kind;
        const mine = (kind === 'runeforge' && !s.runeforgeNoCharge) || (kind === 'epicRuneforge' && s.runeforgeEpic);
        if (mine) s.heroGrantArt = { kind: 'rune', id: rune.id };
      }
      closeRuneforge(s);
      checkTriples(s); // a rune-granted copy might complete a triple (opens its own Discover)
      openNextStartOfTurnModal(s); // forge closed — open the next queued start-of-turn modal (unless a Discover just opened)
      return s;
    }

    case 'skipRuneforge': {
      // Leave the Runeforge without buying (e.g. you can't afford any) — closes it for the run.
      if (!s.runeforgeOffer) return state;
      if (!s.runeforgeEpic && !s.runeforgeNoCharge) s.heroPowerSpent = true;
      closeRuneforge(s);
      openNextStartOfTurnModal(s); // forge closed — open the next queued start-of-turn modal
      return s;
    }

    case 'rerollRuneforge': {
      // Re-roll the offered runes — FREE, but once per GAME (owner rules change 2026-07-31: spending it on the
      // basic forge forfeits the epic forge's re-roll). A fresh set is drawn (preferring runes NOT currently
      // shown) from whichever runeset this forge is; seeded off a salted stream so it's deterministic.
      if (!s.runeforgeOffer || s.runeforgeRerolled || s.runeforgeRerollUsed) return state;
      const rng = makeRng(mixSeed(s.seed, s.wave, TAG.QUEST, 1));
      const redrawn = drawRuneOffer(s, rng, new Set(s.runeforgeOffer));
      s.runeforgeOffer = redrawn.offer;
      s.runeforgeDiscounts = redrawn.discounts;
      applyHeroForgeDiscount(s, rng); // a re-roll keeps the hero's own forge discounted
      s.runeforgeRerolled = true;
      s.runeforgeRerollUsed = true;
      return s;
    }

    case 'reposition': {
      const i = s.board.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(s.board.length - 1, action.toIndex));
      const [card] = s.board.splice(i, 1);
      if (card) s.board.splice(to, 0, card);
      return s;
    }

    case 'reorderShop': {
      // Purely cosmetic — rearrange the current offers (so dragging an offer lands where
      // you drop it, like the warband, instead of snapping back to its slot).
      const i = s.shop.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(s.shop.length - 1, action.toIndex));
      const [card] = s.shop.splice(i, 1);
      if (card) s.shop.splice(to, 0, card);
      return s;
    }

    case 'reorderHand': {
      // Purely cosmetic — rearrange the hand (drag a card sideways to reorder it), the hand's parallel to
      // reorderShop. Hand order has no gameplay effect; this just lets the player organize their cards.
      const i = s.hand.findIndex((c) => c.uid === action.uid);
      if (i < 0) return state;
      const to = Math.max(0, Math.min(s.hand.length - 1, action.toIndex));
      const [card] = s.hand.splice(i, 1);
      if (card) s.hand.splice(to, 0, card);
      return s;
    }

    case 'heroPower': {
      // WHICH wielded power fires: slot 0 is the main button (everyone), slot 1 is Void's second power.
      // `activePowers` resolves Mimic's adopted power and Void's pair; a plain hero has exactly one entry, so
      // slot is inert for the whole existing roster.
      const slot = action.slot === 1 ? 1 : 0;
      const power = activePowers(s)[slot];
      if (!power) return state; // slot 1 with only one power wielded
      // Some powers unlock on a later turn; locked before then.
      if (s.wave < (power.unlockWave ?? 1)) return state;
      // Once-per-game powers (Gild) gate on heroPowerSpent; maxUses powers (Gildmaster: 2 total) gate on the
      // whole-game count AND the once-per-turn charge; the rest just recharge each wave. Slot 1 keeps its own
      // sibling fields so Void's two actives charge and spend independently.
      const heroUses = (slot === 1 ? s.heroPowerUses2 : s.heroPowerUses) ?? 0;
      const slotReady = slot === 1 ? (s.heroReady2 ?? true) : s.heroReady;
      const slotSpent = slot === 1 ? s.heroPowerSpent2 : s.heroPowerSpent;
      const usesThisTurn = s.heroUsesThisTurn ?? 0;
      const available = power.usesPerTurn
        ? usesThisTurn < power.usesPerTurn // Fibbsy: N times a turn, not the plain once-per-turn heroReady
        : power.maxUses
        ? heroUses < power.maxUses && slotReady
        : power.oncePerGame
          ? !slotSpent
          : slotReady;
      if (!available) return state;
      // Powers with a Mana cost (Nadja's Mana Font) also need the Mana on hand.
      if (power.cost && s.embers < power.cost) return state;
      const card = s.board.find((c) => c.uid === action.uid);
      // Rune of Empowerment (Epic): the hero power's effect triggers twice. Threaded into the value/generate
      // powers below (scalingGold / gainMaxMana / fortify / dynamiteDig — the DOUBLEABLE_POWERS the rune is
      // gated to). A targeted single-application power (Gild / Ward) can't meaningfully double, so `reps` is
      // only read by those four branches.
      const reps = 1 + (s.runeEmpowerment ? 1 : 0) + (s.runeWishbone ? runeStacksOf(s, 'rune_wishbone') : 0);
      if (s.runeWishbone) procRuneId(s, 'rune_wishbone');

      if (power.kind === 'gild') {
        // Indy: make a friendly board minion Golden — doubles its BASE stats (recorded as a "Gild" buff so the
        // inspect breakdown still sums; accrued buffs are NOT doubled — see `gildMinion`) AND flips the golden
        // flag, which doubles its effects (Deathrattles fire twice, ×N multipliers, etc.). Board only; a no-op
        // (and no charge spent) on a missing target or an already-golden minion.
        if (!card || card.golden) return state;
        gildMinion(card);
        // Indy: arm the recharge — the charge comes back after INDY_GILD_RECHARGE_GOLD more Gold is spent.
        s.indyGildRearmAt = (s.goldSpent ?? 0) + INDY_GILD_RECHARGE_GOLD;
      } else if (power.kind === 'replayBattlecry') {
        // Myra: re-trigger a friendly board minion's Battlecry. Board only; a no-op (no charge
        // spent) on a missing target or a minion with no Battlecry to replay.
        if (!card || !replayBattlecry(s, card)) return state;
        for (let r = 1; r < reps; r++) replayBattlecry(s, card); // Wishbone: the Pulse fires again
      } else if (power.kind === 'replayEndOfTurn') {
        // (legacy) proc a single friendly board minion's End of Turn now. No-op on a missing target or a
        // minion with no End-of-Turn effect.
        if (!card || !replayEndOfTurn(s, card)) return state;
        // Same endOfTurn advance as Djinn below — not on a live hero today, but it carries the identical bug.
        if ((s.lastEotFires ?? 0) > 0) advanceQuestsBy(s, (o) => o.event === 'endOfTurn', s.lastEotFires);
      } else if (power.kind === 'replayAllEndOfTurn') {
        // Djinn's Cadence: trigger EVERY friendly End of Turn now (untargeted) — BOTH halves of the player's
        // End-of-Turn engine, exactly as the natural end of turn (`applyEndOfTurn`) does: every board minion's
        // `endOfTurn` effects, AND the quest/rune-granted recurring rewards (Echoing Roar, The Hoard Wakes,
        // Rune of Spending/Action, …). Covering only the board silently skipped half of what the player built
        // (owner ruling 2026-07-22). Fires on a snapshot of the board so a minion an EoT summons doesn't also
        // proc this activation. No-op (no charge spent) if there was nothing at all to trigger.
        let any = false;
        for (const c of [...s.board]) if (replayEndOfTurn(s, c)) any = true;
        if (replayRecurringEndOfTurn(s)) any = true;
        if (!any) return state;
        // Advance Parliament of Flame here, at the source. `replayEndOfTurn` accumulated its fires into
        // `lastEotFires` (zeroed at action start), and this is the ONLY writer this action — the natural
        // end-of-turn (1268) and Conductor (2100) reads live on different dispatches, so advancing here can't
        // double-count them. Without this a heroPower action reaches neither read (audit 2026-07-21).
        if ((s.lastEotFires ?? 0) > 0) advanceQuestsBy(s, (o) => o.event === 'endOfTurn', s.lastEotFires);
      } else if (power.kind === 'grantWard') {
        // Warden's Aegis: give a friendly board minion a PERMANENT Ward (Divine Shield) for 4 Gold. No-op (no
        // charge/gold spent) on a missing target or one that already has a Ward.
        if (!card || card.keywords.includes('DS')) return state;
        card.keywords.push('DS');
        // …and every minion that now HAS Ward (the fresh one included) gains +Tier/+Tier+1 (owner 2026-08-16).
        const g = aegisGrantOf(s);
        for (const c of s.board) if (c.keywords.includes('DS')) addBuff(c, 'Aegis', g.attack, g.health);
      } else if (power.kind === 'scalingGold') {
        // Bagger Ben's Bag It: gain Gold now, the payout climbing +1 each turn (turn 1 → 2, turn 2 → 3, …).
        // Untargeted; the once-per-turn charge is spent by the shared block below.
        gainGold(s, (1 + s.wave) * reps);
      } else if (power.kind === 'dynamiteDig') {
        // Jensen: Discover a minion of your CURRENT tier — the FIRST dig is free, then the cost climbs 1
        // each use (0, 1, 2, …). Untargeted; cost + use count handled here (not the shared block).
        const digCost = heroUses;
        if (s.embers < digCost) return state; // can't afford this use → no charge spent
        spendGold(s, digCost);
        if (slot === 1) s.heroPowerUses2 = heroUses + 1; else s.heroPowerUses = heroUses + 1; // escalate the FIRING slot's next cost (a Void slot-1 Dig must not tax slot 0)
        // Empowerment: two Discovers. queueDiscover opens the first and queues the rest on its own.
        for (let r = 0; r < reps; r++) queueDiscover(s, { kind: 'minion', tier: s.tier, exactTier: s.tier });
      } else if (power.kind === 'dragonTamer') {
        // Tiff: Discover a Dragon for 5 Gold, reduced 1 per Dragon/spell bought since the last use
        // (`tiffDiscount` via dragonTamerCostOf, floor 0). Untargeted; the shrinking cost is charged here
        // (not the shared block) and the discount bank resets on use.
        const tamerCost = dragonTamerCostOf(s);
        if (s.embers < tamerCost) return state; // can't afford → no charge spent
        spendGold(s, tamerCost);
        s.tiffDiscount = 0;
        // Empowerment: two Discovers. queueDiscover opens the first and queues the rest on its own.
        for (let r = 0; r < reps; r++) queueDiscover(s, { kind: 'minion', tier: s.tier, tribe: 'dragon' });
      } else if (power.kind === 'resummon') {
        // The Reclaimer: mark a friendly board minion to be destroyed + resummoned at start of
        // combat (the combat sim does the work). Mark exactly one (clear any previous mark).
        if (!card) return state;
        for (const c of s.board) c.resummon = false;
        card.resummon = true;
      } else if (power.kind === 'displace') {
        // Darah: swap a friendly board minion with a random tavern minion. No-op (no charge spent) on a
        // missing target, a golden minion (can't trade away a triple — enforced in swapWithTavern), or an
        // empty tavern.
        if (!card || !swapWithTavern(s, card)) return state;
      } else if (power.kind === 'grantReborn') {
        // Lord of the Risen: give a friendly board minion Rise for the NEXT combat only. The 'R' keyword
        // shows immediately (pill + snapshot); `tempReborn` marks it so settleCombat strips it after the
        // fight. No-op (no charge spent) on a missing target or one that already has Rise.
        if (!card || card.keywords.includes('R')) return state;
        card.keywords.push('R');
        card.tempReborn = true;
      } else if (power.kind === 'pocketMagic') {
        // Merrin: a random Shop spell (up to the current tier) to hand. No-op (no charge) if none exist or the
        // hand is full. Untargeted; the 1-Gold cost is spent by the shared block.
        const pool = poolOf(s).spells.filter((c) => c.tier <= s.tier);
        if (pool.length === 0 || s.hand.length >= handCap(s)) return state;
        conjureToHand(s, pool, reps); // Wishbone: two spells (conjureToHand is hand-cap safe)
      } else if (power.kind === 'dice') {
        // Gambler: locked until `heroDiceLockUntil`. Roll 1–6 (seeded), gain that Gold, then lock the power for
        // that many turns — a big roll pays more but costs more downtime. No charge while locked.
        if (s.wave < (s.heroDiceLockUntil ?? 0)) return state;
        const rng = makeRng(s.rngCursor);
        const roll = 1 + rng.int(6);
        s.rngCursor = rng.state();
        gainGold(s, roll);
        s.heroDiceLockUntil = s.wave + roll;
        // Display-only: the panel keeps showing the rolled face for the rest of THIS turn (owner ruling
        // 2026-08-16) rather than snapping back the instant the tumble settles. Expired by wave comparison.
        s.heroDiceRoll = roll;
        s.heroDiceRollWave = s.wave;
      } else if (power.kind === 'copyMachine') {
        // Xerox: SUMMON a plain copy of a friendly board minion directly beside it (owner ruling 2026-08-14 —
        // a board summon, not a hand grant, so it needs a free board slot). No-op (no charge) on a missing
        // target or a full board. Once per game (the shared block sets heroPowerSpent).
        if (!card || s.board.length >= CONFIG.boardMax) return state;
        // An EXACT copy (owner ruling 2026-08-15): every per-instance field rides along — current stats, the
        // buff breakdown, granted keywords, golden, accrued counters (summonBonus / attachments / copiedEcho).
        // A full instance spread is the only faithful way to say "exact"; rebuilding from the CardDef would
        // hand back a base-stat body and silently drop everything the minion had earned.
        const copy: BoardCard = {
          ...card,
          uid: `b${s.uidSeq++}`,
          buffs: card.buffs ? card.buffs.map((b) => ({ ...b })) : undefined,
          keywords: [...card.keywords],
          copiedEcho: card.copiedEcho ? card.copiedEcho.map((e) => ({ ...e })) : undefined,
          resummon: false, // a Soren mark is a per-body choice, not part of the stat line
        };
        s.board.splice(s.board.findIndex((c) => c.uid === card.uid) + 1, 0, copy);
        // Wishbone: a second copy, each needing its OWN free slot — a full board simply stops the extras
        // rather than overfilling (the same rule the first copy is gated on above).
        for (let r = 1; r < reps && s.board.length < CONFIG.boardMax; r++) {
          const extra: BoardCard = {
            ...card,
            uid: `b${s.uidSeq++}`,
            buffs: card.buffs ? card.buffs.map((b) => ({ ...b })) : undefined,
            keywords: [...card.keywords],
            copiedEcho: card.copiedEcho ? card.copiedEcho.map((e) => ({ ...e })) : undefined,
            resummon: false,
          };
          s.board.splice(s.board.findIndex((c) => c.uid === card.uid) + 1, 0, extra);
        }
      } else if (power.kind === 'roundedSpellbook') {
        // Hunch: a copy of the LAST spell you cast — run-lifetime (`lastSpellCastId`), so it carries across
        // turns. Cost shrinks 1 per turn since the last use (charged here, not the shared block; using it
        // re-bases the countdown). No-op (no charge) with no spell cast yet or a full hand.
        const spellId = s.lastSpellCastId;
        const def = spellId ? CARD_INDEX[spellId] : undefined;
        if (!def?.spell || s.hand.length >= handCap(s)) return state;
        const bookCost = roundedSpellbookCostOf(s);
        if (s.embers < bookCost) return state; // can't afford → no charge spent
        spendGold(s, bookCost);
        s.hunchResetWave = s.wave;
        conjureToHand(s, [def], reps); // Wishbone: two copies
      } else if (power.kind === 'clearance') {
        // Frantic Frank: refresh the Shop (free — the 1-Gold power cost is the shared block's) and mark this
        // turn so its minions cost 2 Gold (read in the buy case). Once per turn via heroReady.
        refreshTavern(s);
        applyShopRefreshed(s);
        // The 2-Gold price belongs to THIS SHOP, not the turn (owner clarification 2026-08-16): refresh again
        // normally, or roll into the next turn, and minions are back to full price. Stamping the price onto
        // the offers themselves is what makes that true by construction — any later roll builds new offers
        // with no stamp, so there is no flag to expire and no way for the discount to leak.
        for (const o of s.shop) {
          const d = CARD_INDEX[o.cardId];
          if (d && !d.spell && !d.ruby) o.cost = 2;
        }
      } else if (power.kind === 'archive') {
        // Quillen: archive a chosen minion — FRIENDLY (board) or SHOP (owner ruling 2026-08-14). It leaves
        // play and its TYPE is recorded. Once per turn (heroReady). On the 3rd archived minion, immediately
        // Discover one random minion per recorded type (so 2 Dragons + a Demon → 2 Dragons + a Demon), then reset.
        const shopIdx = s.shop.findIndex((o) => o.uid === action.uid);
        const src = card ?? (shopIdx >= 0 ? s.shop[shopIdx]! : undefined);
        if (!src) return state; // must target a friendly board minion or a Shop offer
        const def = CARD_INDEX[src.cardId];
        if (!def || def.spell || def.ruby) return state; // minions only
        returnToPool(s, def.id); // the archived body goes back to the shared pool, like an un-bought reroll
        if (card) s.board = s.board.filter((c) => c.uid !== card.uid);
        else s.shop.splice(shopIdx, 1);
        const t = (def.tribe && def.tribe !== 'neutral') ? def.tribe : (def.tribe2 ?? def.tribe);
        // Wishbone: the archived minion's TYPE is recorded `reps` times (owner ruling — "2 counts added of the
        // targeted minion type"). The bucket below drains exactly 3 and leaves the remainder in place, so an
        // overflow count carries toward the NEXT bucket rather than being discarded.
        const banked = (s.archivedTribes ??= []);
        for (let r = 0; r < reps; r++) banked.push(t as Tribe);
        if (banked.length >= 3) {
          const rng = makeRng(s.rngCursor);
          const picks: string[] = [];
          // Exactly THREE counts pay out; anything above that stays banked toward the next bucket (owner
          // ruling — an overflow from a doubled archive must not be discarded). Identical to the old
          // clear-everything for an undoubled Quillen, which can never bank more than 3.
          for (const tribe of banked.slice(0, 3)) {
            // `defIsTribe`, not a hand-rolled tribe/tribe2 pair: an All-types card counts as EVERY tribe, so
            // archiving a type the SET does not carry (Undead / Mech) still offers Paragon / Standard Bearer
            // rather than silently returning nothing (owner report 2026-08-20).
            const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier <= s.tier && defIsTribe(c, tribe));
            if (pool.length > 0) picks.push(pool[rng.int(pool.length)]!.id);
          }
          s.rngCursor = rng.state();
          s.archivedTribes = banked.slice(3); // keep the overflow
          if (picks.length > 0) s.discover = picks;
        }
      } else if (power.kind === 'investment') {
        // Bram: bank 1 Gold a turn; the 5th invested pays out a random GILDED minion (up to your Shop tier,
        // owner ruling 2026-08-16) and resets the bank. Untargeted; the 1-Gold cost is spent by the shared
        // block. A full hand blocks the payout, so the bank is only advanced when it can actually pay.
        const invested = (s.bramInvested ?? 0) + reps; // Wishbone: two counts banked per use
        if (invested >= 5) {
          if (s.hand.length >= handCap(s)) return state; // no room for the payout → no charge, bank untouched
          const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier <= s.tier);
          if (pool.length === 0) return state;
          const rng = makeRng(s.rngCursor);
          const pick = pool[rng.int(pool.length)]!;
          s.rngCursor = rng.state();
          conjureToHand(s, [pick], 1);
          const granted = s.hand[s.hand.length - 1];
          if (granted) gildMinion(granted); // the payout arrives already Gilded, like a golden Discover
          s.bramInvested = 0;
        } else {
          s.bramInvested = invested;
        }
      } else if (power.kind === 'buyout') {
        // Harlan: take the WHOLE Shop, then reroll it. The price falls 1 a turn and re-bases on use, so it is
        // charged here rather than by the shared block (the dragonTamer/roundedSpellbook pattern).
        const price = buyoutCostOf(s);
        if (s.embers < price) return state; // can't afford → no charge spent
        spendGold(s, price);
        s.harlanResetWave = s.wave;
        // Owner ruling 2026-08-16: take what fits and DROP the rest — the hand cap is not raised for this.
        // Dropped offers go back to the shared pool, exactly as an un-bought reroll would return them.
        for (const offer of s.shop) {
          const def = CARD_INDEX[offer.cardId];
          if (!def) continue;
          if (s.hand.length >= handCap(s)) { returnToPool(s, offer.cardId); continue; }
          s.hand.push({
            uid: `b${s.uidSeq++}`, cardId: def.id, tribe: def.tribe,
            ...conjuredStats(s, def, cardBuff(s, def.id)),
            keywords: [...def.keywords], golden: offer.golden ?? false,
          });
        }
        s.shop = [];
        refreshTavern(s);
        applyShopRefreshed(s);
        // Wishbone: take the FRESHLY ROLLED shop too (owner ruling — "2 consecutive shops"), then roll again
        // so the player is still left with a row. Same take-what-fits rule as the first sweep.
        for (let r = 1; r < reps; r++) {
          for (const offer of s.shop) {
            const d = CARD_INDEX[offer.cardId];
            if (!d) continue;
            if (s.hand.length >= handCap(s)) { returnToPool(s, offer.cardId); continue; }
            s.hand.push({
              uid: `b${s.uidSeq++}`, cardId: d.id, tribe: d.tribe,
              ...conjuredStats(s, d, cardBuff(s, d.id)),
              keywords: [...d.keywords], golden: offer.golden ?? false,
            });
          }
          s.shop = [];
          refreshTavern(s);
          applyShopRefreshed(s);
        }
      } else if (power.kind === 'allIn') {
        // Rascal: 1 Gold + 2 per turn since the last use, then re-base. Twice a game (`maxUses`), still once
        // per turn through `heroReady`. Untargeted and free, so the shared block only spends the charge.
        gainGold(s, allInPayoutOf(s) * reps);
        s.rascalResetWave = s.wave;
      } else if (power.kind === 'soulbind') {
        // Sable: bind the OUTERMOST minions for this turn — a stat gain on one is gained by the other, in
        // full, one hop only. Needs two distinct bodies, so a board of 0 or 1 is a no-op (no charge spent).
        if (s.board.length < 2) return state;
        s.sableBond = { a: s.board[0]!.uid, b: s.board[s.board.length - 1]!.uid, wave: s.wave };
        stampSableBond(s); // take effect immediately — a buff later in THIS dispatch should already mirror
      } else if (power.kind === 'commission') {
        // Cassen: pick one of the offered commissions; it matures `delay` turns later. Free and untargeted.
        // Only one runs at a time — a second click while one is in flight is a no-op (no charge spent), and
        // the UI hides the arm state for the same reason.
        if (s.commission) return state;
        const pick = action.commission as CommissionKind | undefined;
        if (!pick || !commissionOffer(s).includes(pick)) return state; // must be one of the OFFERED three
        s.commission = { kind: pick, dueWave: s.wave + COMMISSION_DELAY[pick] };
        s.lastCommission = pick; // …so the next offer can exclude it
      } else if (power.kind === 'firstOrLast') {
        // Flash: arm which end of next combat's kills to claim. The 1-Gold cost is spent by the shared block.
        // Re-arming before the fight simply replaces the choice — it is a mark, not a stacking charge.
        const pick = action.flashPick;
        if (pick !== 'first' && pick !== 'last') return state; // must carry a choice
        s.flashPick = pick;
      } else if (power.kind === 'devour') {
        // Devourer: eat a friendly BOARD minion and hand its stats to a random OTHER friendly. Needs a real
        // second body to receive them, so a board of one is a no-op (no charge, nothing eaten) — otherwise the
        // power would silently delete a minion for 1 Gold.
        if (!card) return state;
        const others = s.board.filter((c) => c.uid !== card.uid);
        if (others.length === 0) return state;
        const rng = makeRng(s.rngCursor);
        const eater = others[rng.int(others.length)]!;
        s.rngCursor = rng.state();
        // Its CURRENT stats, buffs included — you are eating the body you built, not its printed line.
        addBuff(eater, 'Devour', card.attack, card.health);
        returnToPool(s, card.cardId); // the eaten body goes back, exactly as a sell would return it
        s.board = s.board.filter((c) => c.uid !== card.uid);
      } else if (power.kind === 'memory') {
        // Membrance: restock the Shop with PLAIN copies of the last opponent's board — the Rune of the Muster
        // shape, pointed at `lastCombat.initial.enemy` instead of your own board. Plain: no buffs, never
        // golden, so you buy the shell of what beat you rather than the statted body.
        const foe = s.lastCombat?.initial.enemy ?? [];
        const ids = foe.map((m) => m.cardId).filter((id) => { const d = CARD_INDEX[id]; return d && !d.spell && !d.ruby; });
        if (ids.length === 0) return state; // no fight yet (turn 1) → no charge spent
        for (const offer of s.shop) returnToPool(s, offer.cardId);
        s.shop = ids.map((cardId) => ({ uid: `s${s.uidSeq++}`, cardId }));
        applyShopRefreshed(s);
      } else if (power.kind === 'soulkeeper') {
        // Underdweller: Discover among the minions that died last combat — BOTH sides (owner ruling
        // 2026-08-16). Untargeted; the 3-Gold cost is spent by the shared block. No-op (no charge, no Gold) when
        // nothing died or the hand is full, so a dead turn never eats the once-per-turn charge.
        const dead = diedLastCombat(s);
        if (dead.length === 0 || s.hand.length >= handCap(s)) return state;
        const rng = makeRng(s.rngCursor);
        const pool = [...dead];
        const picks: string[] = [];
        while (picks.length < 3 && pool.length > 0) picks.push(pool.splice(rng.int(pool.length), 1)[0]!);
        s.rngCursor = rng.state();
        s.discover = picks;
        // Wishbone: a second Discover, QUEUED behind the open one so the player resolves them in turn rather
        // than the second silently overwriting the first.
        for (let r = 1; r < reps; r++) queueDiscover(s, { kind: 'minion', tier: s.tier });
      } else if (power.kind === 'empowerment') {
        // Albus: a SHOP minion becomes a Discover from the tier above it. The tier step follows the standard
        // ceiling (`hasTier7Access`), so on a Tier-6 offer it re-rolls within Tier 6 unless Tier 7 is open —
        // the same clamp Pete's Contrabanana uses. Targeted at a Shop offer only (not a board minion).
        const shopIdx = s.shop.findIndex((o) => o.uid === action.uid);
        if (shopIdx < 0) return state;
        const def = CARD_INDEX[s.shop[shopIdx]!.cardId];
        if (!def || def.spell || def.ruby) return state; // minions only
        // Wishbone: the power happening TWICE steps the tier twice (tier + 2) rather than opening a second
        // Discover — the pick REPLACES the targeted offer, so a second one would have no offer to land on.
        const tgt = Math.min(def.tier + reps, hasTier7Access(s) ? 7 : 6);
        const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier === tgt);
        if (pool.length === 0) return state;
        const rng = makeRng(s.rngCursor);
        const opts = [...pool];
        const picks: string[] = [];
        while (picks.length < 3 && opts.length > 0) picks.push(opts.splice(rng.int(opts.length), 1)[0]!.id);
        s.rngCursor = rng.state();
        // The pick REPLACES the targeted offer rather than landing in hand — see `discoverIntoShopUid`.
        s.discoverIntoShopUid = s.shop[shopIdx]!.uid;
        s.discover = picks;
      } else if (
        power.kind === 'spellAmplify' || power.kind === 'quest' || power.kind === 'collision' || power.kind === 'sellGold'
        || power.kind === 'contraband' || power.kind === 'companyRate' || power.kind === 'unitedFront'
        || power.kind === 'chaos' || power.kind === 'cheapMinions' || power.kind === 'discoLock'
        || power.kind === 'questChronos' || power.kind === 'lesserQuest' || power.kind === 'runeforge'
        || power.kind === 'pathfinder' || power.kind === 'epicRuneforge' || power.kind === 'recurringGoldcrafter'
        || power.kind === 'vanguard' || power.kind === 'luckySeat' || power.kind === 'exhibition'
        || power.kind === 'startingReflector'
        // `heroQuest` (Fi / Coran) joined this list on 2026-08-28 with the quest archive. It was always a
        // start-of-run passive and always belonged here; the omission was masked because both heroes opened
        // the run holding a quest modal, and `modalOpen` refused the click before it could reach this chain.
        // With the offer archived that shield is gone, and without this line a `heroPower` action would fall
        // through to the FORTIFY else-branch — an archived power handing out a free buff (the smell already
        // documented in heroPowerFamilies.ts). A passive power does nothing when clicked, archived or not.
        || power.kind === 'heroQuest'
      ) {
        // Passive powers have no activation — the work happens elsewhere (spell math, the buy/sell case,
        // settleCombat, the turn-advance quest/discover/Goldcrafter hooks). Nothing to do on a power click.
        return state;
      } else if (power.kind === 'rubyWealth') {
        // Fibbsy: 1 Gold → 2 Rubies. Untargeted; the Gold cost + the per-turn charge are handled by the shared
        // block below. `mintRubies` runs the full onGetRuby / onGainCard rounds, so a board that reacts to
        // Rubies (Runefire, Gem Sage) fires exactly as it would for a shop-bought Ruby.
        mintRubies(s, 2);
      } else if (power.kind === 'gainMaxMana') {
        // Nadja: +1 max Gold permanently, ABOVE the cap and PERSISTENT. Routes through `maxGoldBonus` (the
        // Shop-License channel that stacks on top of the natural curve) — NOT `s.maxEmbers`. The old
        // `s.maxEmbers += reps` looked uncapped while she powered every turn, but the natural-growth line
        // (`Math.max(maxEmbers, min(cap, maxEmbers+1))`) can never push maxEmbers past the cap — so reaching 10
        // early just pre-spent the natural growth she'd have gotten anyway, and her lead evaporated the moment
        // she stopped (owner report 2026-07-22: powered turns 1–4 → stuck at 10, a normal player catches up).
        // `maxGoldBonus` sits above the base 10 that maxEmbers still climbs to on its own, so powering turns 1–4
        // reads 11/12/13/14 across turns 5–8 — the lead persists. Untargeted; falls through to the shared spend.
        s.maxGoldBonus = (s.maxGoldBonus ?? 0) + reps;
      } else if (power.kind === 'preparation') {
        // Aster the Guide (tutorial-only): +1/+1 to a friendly board minion. Recharges every OTHER turn — the
        // `preparationLockUntil` wave is the REAL gate here, mirroring Gambler's Dice lock: `heroReady` resets
        // on every wave advance and would otherwise re-arm the power next turn, so without this check it would
        // be usable every turn. No-op (no charge, no lock set) on a still-locked power or a missing target, so
        // a whiffed activation costs nothing (matching grantWard / fortify above).
        if (s.wave < (s.preparationLockUntil ?? 0)) return state;
        if (!card) return state;
        addBuff(card, 'Preparation', 1, 1);
        s.preparationLockUntil = s.wave + 2;
      } else if (power.kind === 'gildcrafter') {
        // Gildmaster (active): complete a triple - grant a THIRD copy of a minion you already hold exactly 2
        // non-golden copies of (board + hand); `checkTriples` below merges the three into the golden. No valid
        // pair -> no-op (no charge/spend), like Preparation above.
        const counts = new Map<string, number>();
        for (const c of [...s.board, ...s.hand]) {
          if (c.golden) continue;
          const gd = CARD_INDEX[c.cardId];
          if (!gd || gd.spell || gd.ruby || gd.noTriple) continue;
          counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
        }
        let pick: string | undefined; let pickTier = -1;
        for (const [cid, n] of counts) {
          if (n !== 2) continue;
          const tier = CARD_INDEX[cid]?.tier ?? 0;
          if (tier > pickTier) { pickTier = tier; pick = cid; }
        }
        if (!pick) return state; // no pair to complete -> activation is a no-op
        const gdef = CARD_INDEX[pick]!;
        s.hand.push({ uid: `b${s.uidSeq++}`, cardId: pick, tribe: gdef.tribe, attack: gdef.attack, health: gdef.health, keywords: [...gdef.keywords], golden: false });
      } else {
        // Warden's Fortify: +Tier/+Tier (scales with Tavern Tier). Targets "a minion" — a
        // warband minion directly, or a tavern offer (the buff bakes in when it's bought).
        const amt = s.tier * reps;
        if (card) addBuff(card, 'Fortify', amt, amt); // raises Attack → the reduce() boundary fires Hunter's onGainAttack
        else {
          const offer = s.shop.find((c) => c.uid === action.uid);
          if (!offer) return state;
          addOfferBuff(offer, 'Fortify', amt, amt);
        }
      }

      if (power.usesPerTurn) {
        // Fibbsy: count this turn's use; heroReady stays TRUE until the last charge is spent, so the button is
        // still armed for the second press. On the final use it flips false, which is how every "used" UI cue
        // (dimmed art, "used" line) reads the power as spent for the turn.
        s.heroUsesThisTurn = (s.heroUsesThisTurn ?? 0) + 1;
        if (s.heroUsesThisTurn >= power.usesPerTurn) s.heroReady = false;
      } else if (power.oncePerGame) { if (slot === 1) s.heroPowerSpent2 = true; else s.heroPowerSpent = true; }
      else if (slot === 1) s.heroReady2 = false;
      else s.heroReady = false;
      if (power.maxUses) { if (slot === 1) s.heroPowerUses2 = heroUses + 1; else s.heroPowerUses = heroUses + 1; } // whole-game activation budget (Gildmaster: 2)
      if (power.cost) spendGold(s, Math.min(s.embers, power.cost)); // gold spent → Acid / Banksly meter
      // A power that summons or generates a minion (Myra's Battlecry replay → an Alleycat's Stray,
      // Dusk's End-of-Turn replay) can complete a triple — check now, like buy / play / discover do.
      checkTriples(s);
      return s;
    }

    case 'pickPower': {
      // Hero-power Discover (Mimic every turn / Void turn 4): adopt the picked hero's power. 0-cost and
      // mandatory — the offer blocks every other action, exactly like the quest shop it is modelled on.
      const offer = s.powerOffer;
      if (!offer) return state;
      const heroId = offer.heroIds[action.index];
      if (heroId == null || !getHero(heroId)) return state;
      s.powerOffer = undefined;
      if (offer.slot === 'shifter') {
        // POWER SHIFTER (T5 spell): replace the power the run is wielding, for the rest of the run.
        // On VOID that means slot 0 in place — collapsing his pair to one would delete a power the shifter
        // never claimed to touch.
        if (s.voidPowerIds?.length) s.voidPowerIds = [heroId, ...s.voidPowerIds.slice(1)];
        else s.adoptedPowerId = heroId;
        s.heroReady = true; // a new power arrives charged, whatever the old one had spent
        seedAdoptedPower(s, heroId);
      } else if (offer.slot === 'mimic') {
        s.adoptedPowerId = heroId;
        // A fresh disguise is a fresh charge: the adopted power arms now even when the previous one was
        // spent this same turn (each turn's power is its own).
        s.heroReady = true;
        seedAdoptedPower(s, heroId);
      } else if (offer.slot === 'void1') {
        s.voidPowerIds = [heroId];
        s.heroReady = true;
        seedAdoptedPower(s, heroId);
        // Chain straight into the second pick — the two are one turn-4 ceremony. The pool re-derives with the
        // first pick excluded, so the same power can never be held twice.
        mintPowerOffer(s, 'void2');
      } else {
        (s.voidPowerIds ??= []).push(heroId);
        s.heroReady2 = true;
        seedAdoptedPower(s, heroId);
      }
      openNextStartOfTurnModal(s); // a quest turn / forge can be queued behind the ceremony
      return s;
    }

    case 'discover': {
      if (!s.discover) return state;
      if (!takeDiscoverPick(s, action.index)) return state;
      s.discoverLockTier = undefined; // consumed — the next queued Discover sets its own (or none)
      s.discoverLockGold = undefined;
      s.discoverLockWave = undefined;
      s.discoverBorrowed = undefined;
      s.discoverGolden = undefined;
      s.discoverSetStats = undefined;
      s.discoverKeywords = undefined;
      s.discoverIntoShopUid = undefined;
      // Open the next queued Discover (golden / Drakko-doubled Brian, Yazzus-multiplied Help Wanted /
      // Sprout); only clear the offer once the queue is empty. A spec whose pool is empty opens nothing
      // (offerDiscover/offerSpellDiscover leave `discover` unset) — keep draining the rest so the queue
      // never strands behind a closed Discover.
      s.discover = undefined;
      while (!s.discover && s.discoverQueue && s.discoverQueue.length > 0) {
        openDiscover(s, s.discoverQueue.shift()!);
      }
      checkTriples(s); // the discovered copy might itself complete a triple
      openNextStartOfTurnModal(s); // if this Discover was the last thing blocking a queued start-of-turn modal, open it
      return s;
    }

    case 'faceOmen': {
      // Layaway: its "keep through refreshes" is a THIS-SHOP-PHASE effect, not a permanent one — clear the
      // `kept` marks now, going into combat, so the first refresh AFTER combat sweeps the offer (the discount
      // rides the offer while it lasts). Recast Layaway next turn to keep it again (owner ruling 2026-07-23).
      for (const o of s.shop) if (o.kept) o.kept = false;
      // An unresolved targeted Battlecry (the player ended the turn mid-pick) auto-resolves on the
      // carry — never strand a played Toxin Tender without its grant.
      if (s.pendingTarget?.deferredPlay) {
        // A DEFERRED Choose One aim (the card is still in hand and nothing has resolved): ending the turn
        // abandons it exactly like a click-away cancel — the card stays in hand untouched. Auto-resolving it
        // would summon a minion the player never confirmed, into a board they can no longer arrange.
        s.pendingTarget = undefined;
      } else if (s.pendingTarget) {
        const pt = s.pendingTarget;
        const src = s.board.find((c) => c.uid === pt.uid);
        const def = src ? CARD_INDEX[src.cardId] : undefined;
        // A tribe-restricted pick (Toxin Tender → another friendly Undead, never self) must respect it;
        // otherwise any friend works. No eligible target → the play resolves with no effect.
        const autoTribe = effectiveTargetTribe(s, def);
        const pool = autoTribe ? s.board.filter((c) => c !== src && isTribe(c, autoTribe)) : s.board;
        const carry = pool.length ? pool.reduce((a, b) => (b.attack > a.attack ? b : a)) : undefined;
        if (src && carry) {
          // A deferred targeted Choose One (Runic Beetle) auto-resolves the chosen option on the carry.
          const opt = pt.optionIndex !== undefined ? def?.chooseOne?.[pt.optionIndex] : undefined;
          if (opt) applyChooseOneTarget(s, src, opt.effects, carry);
          else applyBattlecryTarget(s, src, carry);
        }
        s.pendingTarget = undefined;
      }
      // End-of-turn triggers fire first and bake into the board's stats (handoff C.5).
      applyEndOfTurn(s);
      // Unused Equipment activations and any temporary cost reduction expire with the turn (handoff).
      // The COLLECTION is deliberately left intact — it is cleared by the next Start-of-Turn rebuild,
      // which is also what keeps an activated combat effect's provenance readable through the fight.
      expireEquipmentTurn(s);
      // Any Discover an EoT trigger raised (Moira re-firing a Discover Shout) auto-resolves to a random pick —
      // no interactive window at the combat hand-off (owner 2026-08-11).
      autoResolveEotDiscovers(s);
      // Re-Pete's Second Hand: at the END of every 3rd turn (3, 6, 9, …), conjure a PLAIN copy of the
      // left-most card in hand — base stats only (no buffs/golden/welds carried) and NO pool take (a
      // conjured card). Hand-cap-safe; an empty hand grants nothing. (Owner correction 2026-07-16:
      // end-of-turn, not start-of-shop.)
      if (hasPower(s, 'secondHand') && s.wave % 3 === 0 && s.hand.length > 0) {
        // CHOREOGRAPHER PR 9 — hero powers emit. Re-Pete's Second Hand conjured a card into hand with no
        // event at all, so it had no beat to schedule and nothing in the Beat Lab to reclassify: the owner
        // flipping it from folded to its own beat correctly changed nothing, because there was no beat.
        // The hero is the SOURCE, so the cue can anchor on the portrait rather than on the card that appears.
        const heroDef = getHero(s.heroId);
        const cardId = s.hand[0]!.cardId;
        heroBeat(s, 'secondHand', heroDef.name, () => {
          for (let r = 1; r < wishboneReps(s); r++) conjurePlainCopy(s, cardId); // Wishbone: a second copy
          conjurePlainCopy(s, cardId);
          const made = s.hand[s.hand.length - 1];
          const c = currentCollector();
          if (c.enabled && made) {
            c.emit({ type: 'cardGranted', target: { zone: 'hand', uid: made.uid, cardId: made.cardId, side: 'player' }, cardId: made.cardId });
          }
        });
      }
      advanceQuestsBy(s, (o) => o.event === 'endOfTurn', s.lastEotFires ?? 0); // Parliament of Flame: "Trigger N End-of-Turn effects"
      // Resolve combat now (deterministic) but don't apply the outcome yet —
      // the UI replays the event log, then dispatches `resolveCombat`.
      // Serve a strength-matched real board from the opponent pool when one exists (getting off the
      // procedural omen blobs); otherwise fall back to the procedural threat. `nextOpponent` (which the
      // recruit-phase opponent frame previewed) makes the pick; the fallback gets its own fresh rng, so an
      // empty / no-match pool stays byte-identical to before the pool seam existed.
      // OPPONENT PINNING: if this wave's board was already decided (a restored / replayed run carries it in
      // `servedBoards`), serve THAT exact board — so the fight reproduces even if the shared pool has since
      // changed. Otherwise pick fresh (deterministic from seed+wave GIVEN the pool) and record the choice.
      // `null` = the procedural threat was used; key presence marks the wave as decided. No behavior change on a
      // normal forward turn (the key is absent → picks + records exactly as before).
      const pinned = s.servedBoards ? Object.prototype.hasOwnProperty.call(s.servedBoards, s.wave) : false;
      const served = pinned ? (s.servedBoards![s.wave] ?? null) : nextOpponent(s);
      if (!pinned) s.servedBoards = { ...(s.servedBoards ?? {}), [s.wave]: served };
      // CELESTIAL: alignment LOCKS here. The recruit board's live centring is stamped onto each body as it
      // enters combat, and combat never recomputes it — deaths don't re-centre the line, so a Celestial
      // fights the half of the sky you built it into (owner ruling 2026-08-03). Computed once for the whole
      // board rather than per-minion, so it costs one pass regardless of board size.
      const playerAligns = alignmentsOf(s.board);
      const player: BoardMinion[] = s.board.map((b, bi) => ({
        cardId: b.cardId,
        attack: b.attack,
        health: b.health,
        align: playerAligns[bi],
        keywords: [...b.keywords],
        golden: b.golden,
        ...(b.addedTribes && b.addedTribes.length ? { addedTribes: [...b.addedTribes] } : {}), // Anomaly Reactor: a spell-added tribe (→ combat tribe2) — was dropped, so the tribe stopped counting in the player's own fights
        ...(b.bloodlust ? { bloodlust: true } : {}), // Bloodlust: a Start-of-Combat immune out-of-turn strike — was dropped, so it never fired
        ...(b.bloodlustRally ? { bloodlustRally: true } : {}), // Bloodlust's welded Rally (give a friendly minion this minion's Attack)
        ...(b.chosenOption !== undefined ? { chosenOption: b.chosenOption } : {}), // Choose One: display-only, so the combat card prints the same single branch
        ...(b.taughtSpellId ? { taughtSpellId: b.taughtSpellId } : {}), // Mage-Pup: display-only, so the combat card names the spell it cast
        summonBonus: b.summonBonus ?? 0,
        // Rune of the Chef: what this Chef granted during the shop phase that just ended, spent as a combat
        // Rally. Same fix as Bucky's Ales — read the LIVE tally, since the reset runs after this combat.
        ...(b.chefGranted ? { chefGrantedLast: b.chefGranted } : {}),
        overflowBonus: b.overflowBonus, // Flowing Monk: flat grant bonus from the triple combine
        hpGrantBonus: b.hpGrantBonus ?? 0, // Sergeant: seed the Deathrattle HP-grant accrual into combat
        ascendProgress: b.ascendProgress ?? 0, // Tara: seed the prior ascend tally so the live tracker shows the total
        spellProgress: b.spellProgress, // Guel: seed his on-board spell tally so the live combat text scales (not stuck at base)
        eotBonus: b.eotBonus, // Ritualist: seed the End-of-Turn grant so the live combat text reads its current per-tick value
        sellBonus: b.sellBonus, // Trail Forager: seed the accrued sell value for the live combat text (no combat effect)
        eotTick: b.eotTick, // Frontdrake / Money Maker / Vineweaver: seed the cadence counter for the live combat text
        sourceUid: b.uid, // so combat can carry Avenge improvements back to this card
        rallyMechAtk: b.rallyMechAtk, // Better Bot's accrued Rally (own base added at instantiate)
        rallySpellWeld: b.rallySpellWeld, // Perfect Core's welded Rally (grant a spell on attack) — was dropped
        resummon: b.resummon, // The Reclaimer's start-of-combat destroy + resummon mark
        partingCry: b.partingCry,   // Parting Cry: its Shout fires when it dies this fight
        closedCasket: b.closedCasket, // Closed Casket: Echo at SoC, suppressed on the first death
        ...(b.copiedEcho?.length ? { copiedEcho: b.copiedEcho } : {}), // Gravetwin: its copied Echo procs on combat death
        ...(b.grantedEffects?.length ? { grantedEffects: b.grantedEffects } : {}), // runtime shop grafts (Echo Mimic / Grave Body / Contract Rewrite / Rune of Rebirth) fire in combat too (owner ruling 2026-08-27)
        ...(b.echoStripped ? { echoStripped: true } : {}), // "summon a copy WITHOUT the Echo": the shop mark now silences the Echo in combat too (owner ruling 2026-08-27)
        ...(b.impBank ? { impBank: { ...b.impBank } } : {}), // Ashen Heir: the SHOP bank rides in (cloned — combat spends its own copy; the run's bank persists)
        ...(b.bloodbinderMode ? { bloodbinderMode: b.bloodbinderMode } : {}), // Bloodbinder: seed this fight's Rally stat (atk/hp)
        ...(b.allTribes ? { universalTribe: true } : {}), // Anomaly Reactor: "All" types → universal in combat
        buffs: b.buffs, // recruit-phase buff breakdown → carried into combat so the inspect panel itemizes it
      }));
      // Fleeting Vigor — a one-shot Start-of-Combat buff banked last shop: pump the player's COMBAT board
      // (not the run board, so it's gone after this fight), then spend it. Applied before the odds sims so
      // every simulation sees the same buffed board. Captured so we can telegraph it once combat resolves —
      // a pre-baked buff with no event reads as "nothing happened", so we narrate the surge below.
      // Rune of Twilight doubles Start-of-Combat effects. These pending SoC effects (Fleeting Vigor's buff,
      // Open the Gates' Imps) are pre-baked HERE, before the simulator's Start-of-Combat pass, so the sim's
      // Twilight loop (which re-fires minion `startOfCombat` effects) never sees them — they were silently
      // exempt (owner report 2026-08-12). Apply the extra trigger here instead: ×2 when Twilight is armed.
      const twilightMult = s.questFlags?.runeTwilight ? 2 : 1;
      // CHOREOGRAPHER PR 7 — these pending Start-of-Combat payouts now EMIT. They were the archetype of the
      // problem this project exists to fix: applied silently into the combat board here, before the
      // simulator's Start-of-Combat pass, with no source-attributed event anywhere. The result was a buff
      // that appeared already-baked into `lastCombat.initial` — indistinguishable, on screen, from "the
      // minions just have those stats", which is exactly the owner's report that Fleeting Vigor's stats
      // land before Start of Combat. Emitting them gives each a real moment to be scheduled against; the
      // playback half (withholding the value until its beat) is the follow-up.
      const socCollector = currentCollector();
      const socBeat = (policyKey: string, id: string, label: string, run: () => void): void => {
        if (!socCollector.enabled) { run(); return; }
        socCollector.withTrigger(
          { phase: 'startOfCombat', source: { kind: 'system', id, label, side: 'player' }, trigger: 'startOfCombat', ...beatIdentity(policyKey) },
          run,
        );
      };
      const fleeting = s.fleetingVigor && (s.fleetingVigor.attack !== 0 || s.fleetingVigor.health !== 0)
        ? { ...s.fleetingVigor } : null;
      // How many combat minions the Vigor actually covered. Imps are pushed AFTER it, so they are not buffed —
      // the presentation rewind below must not subtract from them.
      const fleetingCovered = fleeting ? player.length : 0;
      if (fleeting) {
        socBeat('system:startOfCombat:fleetingVigor', 'fleetingVigor', 'Fleeting Vigor', () => {
          const a = fleeting.attack * twilightMult;
          const h = fleeting.health * twilightMult;
          for (const m of player) {
            m.attack += a;
            m.health += h;
            // One consequence PER MINION, carrying the delta gameplay actually applied — so presentation can
            // stagger the surge across the board and never has to subtract its way to the number.
            if (socCollector.enabled) socCollector.emit({
              type: 'statsChanged',
              target: { zone: 'board', uid: m.sourceUid, cardId: m.cardId, side: 'player' },
              attack: a, health: h, permanent: false, channel: 'ordinary',
            });
          }
        });
        s.fleetingVigor = { attack: 0, health: 0 };
      }
      // Next-combat keyword grants (Field Maneuvers / Last Stand / Executioner's Edge): stamp each banked
      // keyword onto its minion's COMBAT instance only (matched by sourceUid), then spend the bank — gone
      // after this fight, exactly like Fleeting Vigor. A grant whose minion was sold/died simply finds no match.
      if (s.pendingCombatKeywords?.length) {
        const grants = s.pendingCombatKeywords;
        socBeat('system:startOfCombat:pendingKeywords', 'pendingKeywords', 'Banked keywords', () => {
          for (const grant of grants) {
            const m = player.find((p) => p.sourceUid === grant.uid);
            if (!m) continue; // its minion was sold or died — nothing to grant, and nothing to narrate
            m.keywords ??= [];
            if (!m.keywords.includes(grant.keyword)) m.keywords.push(grant.keyword);
            if (grant.keyword === 'CR' && grant.critChance !== undefined) m.critChance = grant.critChance;
            if (socCollector.enabled) socCollector.emit({
              type: 'keywordChanged',
              target: { zone: 'board', uid: grant.uid, cardId: m.cardId, side: 'player' },
              keyword: grant.keyword, gained: true,
            });
          }
        });
        s.pendingCombatKeywords = [];
      }
      // The display-only temp grants (Last Stand's gold tag, …) are consumed alongside the real keyword bank
      // above — combat is what they promised. Their 0/0 buff-list entries go with them.
      for (const c of s.board) {
        if (!c.tempGrants) continue;
        c.buffs = c.buffs?.filter((b) => !c.tempGrants!.some((g) => `(${g.label})` === b.source));
        c.tempGrants = undefined;
      }
      // Open the Gates (Set 2): banked Imps enter this fight on the player board, as many as fit the 7-slot cap
      // (the "whenever you have room" clause). Added before the odds sims so every sim sees them, then spent.
      if (s.pendingSCImps) {
        const impDef = CARD_INDEX['impscrap'];
        const room = Math.max(0, CONFIG.boardMax - player.length);
        const n = Math.min(s.pendingSCImps * twilightMult, room); // Rune of Twilight doubles this SoC summon too
        socBeat('system:startOfCombat:pendingImps', 'pendingImps', 'Open the Gates', () => {
          for (let k = 0; k < n && impDef; k++) {
            player.push({ cardId: 'impscrap', attack: impDef.attack, health: impDef.health, keywords: [...impDef.keywords], golden: false });
            // `summon.appear` is the staged marker the compiler anchors an arrival to, rather than the
            // source's primary delivery — an Imp should be seen arriving, not simply be present.
            if (socCollector.enabled) socCollector.emit({
              type: 'cardSummoned',
              target: { zone: 'board', cardId: 'impscrap', index: player.length - 1, side: 'player' },
              cardId: 'impscrap', deliveryKey: 'summon.appear',
            });
          }
        });
        s.pendingSCImps = 0;
      }
      // The procedural threat board for this wave — the always-fightable fallback (built from current
      // cards, so it can never throw). `enemyTier` (loss-damage scaling) is the served board's tavern tier,
      // or the player's own tier as the foe's stand-in for the procedural board.
      const proceduralEnemy = (): { enemy: BoardMinion[]; tier: number } => ({
        enemy: buildEnemyBoard(s.threat, s.wave, makeRng(mixSeed(s.seed, s.wave, TAG.ENEMY))),
        tier: s.tier,
      });
      // Resolve the real combat + its win/draw/loss odds against one enemy board. Throws only if that board
      // is unfightable (a served board referencing a card this build removed → `instantiate` throws) — caught
      // below. Odds: re-simulate the same two boards on independent seeds (a separate ODDS stream, so they're
      // reproducible and don't disturb the real combat RNG). ~1000 sims keeps the margin to ~±1.5%.
      // Pack Leader: Beasts you PLAYED this turn (frozen for combat), threaded into simulate like spellsThisTurn.
      const beastsPlayed = (s.playedThisTurn ?? []).filter((id) => defIsTribe(CARD_INDEX[id], 'beast')).length;
      // The PLAYER side's run-level combat context — one symmetric `CombatSideState`, built once from the live
      // RunState and shared by the real fight + the 1000-sim odds probe.
      const playerState: CombatSideState = combatSide({
        // The run's PINNED set — every random pick in combat narrows to this. Without it a Set-1 run could be
        // handed a Set-2 card (owner report 2026-07-27: Badgington's Slaughter, Sea Urchin's Discover). `all`
        // rather than `buyable`, because a legitimate pick can be a non-buyable card of the set.
        poolIds: poolOf(s).all.map((c) => c.id),
        spellsThisTurn: s.spellsThisTurn,
        spellsCast: s.spellsCast,
        deathrattles: s.deathrattlesTriggered,
        spellPowerAtk: spellAttackBonus(s),
        wildHuntGrown: s.runeWildHuntGrown ?? 0, // Wild Hunt's permanent escalation resumes where it left off
        spellPowerHp: spellHealthBonus(s),
        undeadAtk: s.undeadAttackBonus,
        undeadHp: s.undeadHealthBonus,
        undeadBuyAtk: s.undeadBuyAtk ?? 0,
        impAtk: s.impBuff?.attack ?? 0,
        conductorBuff: s.conductorBuff ?? 0, // CONDUCTOR: carry the run's snowball so a mid-fight Shout re-fire pays it
        impHp: s.impBuff?.health ?? 0,
        fodderConsumedAtk: s.fodderConsumedThisTurn?.attack ?? 0,
        fodderConsumedHp: s.fodderConsumedThisTurn?.health ?? 0,
        beastBuyAtk: s.beastBuyAtk ?? 0,
        beastsPlayed,
        cardsBoughtThisTurn: s.cardsBoughtThisTurn ?? 0,
        magneticAtk: s.magneticBuyAtk ?? 0,
        magneticHp: s.magneticBuyHp ?? 0,
        // `rubyStatBonus`, not the raw accumulator: Rune of the Spellstone folds the run's SPELL power into
        // every Ruby (2026-08-14). Folding it once HERE is what makes combat-played Rubies inherit it without
        // the combat side needing to know the rune exists — `rubyBonusFor` reads this value verbatim.
        rubyBonus: rubyStatBonus(s),
        tier: s.tier,
        tribes: s.tribes,
        cardBuffs: s.cardBuffs ?? {},
        // Set 2 — the spell ids in hand at combat start, in hand order (Vault Curator copies the left-most).
        handSpellIds: s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).map((c) => c.cardId),
        // Bucky: the Ales cast during the shop phase that JUST ENDED. Read live rather than from a banked
        // field — `faceOmen` builds this side BEFORE `resolveCombat` does the per-turn reset, so
        // `alesCastThisTurn` is exactly "the brewing you just did". Banking it first put the payout a whole
        // turn late (owner report 2026-08-07: 3 Ales paid 0 that combat and only landed the combat after).
        alesLastTurn: s.alesCastThisTurn ?? 0,
        spellEscalation: { attack: s.frontToBackBonus, health: s.frontToBackBonusH },
        lastSpellCastId: s.lastSpellCastId,
        rememberedSpellIds: s.rememberedSpellIds ?? [], // Runesnout Archivist's journal
        spellhide: s.spellhidePending ?? [], // Rune of Spellhide's Start-of-Combat re-casts
        growthBonus: s.growthBonus ?? 0, // Rune of Living Growth: combat Growth casts pay the improved value
        // Rope Wrangler's Echo summons a random hand MINION with its live stats (buffs + gilding intact).
        handMinions: s.hand
          .filter((c) => { const d = CARD_INDEX[c.cardId]; return !!d && !d.spell && !d.ruby; })
          .map((c) => ({ uid: c.uid, cardId: c.cardId, attack: c.attack, health: c.health, keywords: c.keywords, golden: c.golden })),
        // Set 2 — Elderhorn's chosen mode(s), so its tribe-scoped trigger multipliers apply in the fight.
        beastHuntExtra: s.beastHuntExtra ?? 0,
        beastRitualExtra: s.beastRitualExtra ?? 0,
        questMods: questCombatMods(s),
        pendingQuests: buildPendingCombatQuests(s),
      });
      // Player-only one-fight rune overrides.
      const config: CombatConfig = {
        playerAttacksFirst:
          (s.attackFirstNext ?? false) || (s.mode === 'tutorial' && !!s.tutorialAttackFirst?.[s.wave - 1]), // Forthcoming strike, or a tutorial round that forces the player to swing first
        forceEnemyFirstTargetCard:
          s.mode === 'tutorial' ? (s.tutorialForceEnemyTarget?.[s.wave - 1] || undefined) : undefined,
        playerRallyDouble: s.rallyDoubleNext ?? false,
      };
      const resolveCombatVs = (enemy: BoardMinion[], enemyState: CombatSideState): CombatResult => {
        // Marked Target: the enemy's right-most minion enters with Taunt (applied to the enemy board that's
        // actually fought — served or procedural — before the real fight and the odds sims all read it).
        if (s.markEnemyRightmostTaunt && enemy.length > 0) {
          const last = enemy[enemy.length - 1]!;
          if (!(last.keywords ?? []).includes('T')) last.keywords = [...(last.keywords ?? []), 'T'];
        }
        const combat = simulate(player, enemy, makeRng(mixSeed(s.seed, s.wave, TAG.COMBAT)), CARD_INDEX, playerState, enemyState, config);
        // PRACTICE BOTS bite harder (owner ask 2026-08-25: games ran far too long). The stock formula is
        // `opponent tier + 1 per surviving minion`, which tops out ~13 even at tier 6 with a full board — against
        // 30 Resolve + 15 Armor that is ~10 losing rounds, and far longer for a player winning some. Scale the
        // bot's damage by difficulty BEFORE the round cap, so the cap still bounds the early rounds.
        combat.playerDamage = Math.round(combat.playerDamage * practiceBotDamageMult(s));
        combat.playerDamage = Math.min(combat.playerDamage, lossDamageCap(s.wave)); // round cap
        // DEFERRED odds (perf audit 2026-08-01, owner call): the 200 Monte Carlo sims used to run right here —
        // ~10 ms on the End Turn click, feeding nothing but the Combat Summary's display bar. Stash the sim
        // inputs instead (post-Marked-Target, so the probe sees the same enemy board the real fight did) and
        // let the UI run `computeCombatOdds` in idle time after the transition. Same seeds → identical odds.
        combat.oddsInput = { player, enemy, playerState, enemyState, config };
        return combat;
      };
      // Belt-and-suspenders: a stale served board is filtered at load (`registerOpponents`), but if one ever
      // slips through, serving it must NEVER hard-lock End Turn (the old "froze on End of Turn" bug — the
      // throw escaped into the UI's end-of-turn timer and the phase never flipped to combat). So fall back to
      // the procedural threat on any serve-time failure: combat ALWAYS resolves.
      // The served board's ENEMY-side context — the SAME `CombatSideState`, reconstituted from its snapshot so its
      // Grim / Taragosa / Pack Leader / Runescale / Watcher fights + reads at the OPPONENT's value, not ours. The
      // procedural threat has none (a synthetic foe with no run economy → the neutral side / printed base is correct).
      // ONE builder for the enemy side, used by the served-board path AND the lobby path. Previously the lobby
      // built its own bare `combatSide({ tier })`, which silently dropped all seventeen run-level scalers below
      // — so the identical board was materially weaker as a lobby seat than as an Ascent opponent. Sharing the
      // function is the point: a new scaler added here reaches both, and neither can drift from the other.
      const enemySideFrom = (snap: BoardSnapshot, fallbackTier: number): CombatSideState =>
        sideFromSnapshot(snap, fallbackTier, poolOf(s).all.map((c) => c.id));
      const servedState: CombatSideState = served
        ? enemySideFrom(served, s.tier)
        : combatSide();
      try {
        // LOBBY MODE: the opponent is the seat the lobby paired you with, not a pool pick. Everything
        // downstream — carry-backs, settlement, the replay — is unchanged; only the board differs.
        const lobbyFoe = s.lobby ? lobbyOpponentBoard(s.lobby) : null;
        const e = lobbyFoe
          ? { enemy: lobbyFoe.minions, tier: lobbyFoe.tier }
          : served ? { enemy: opponentBoard(served), tier: served.tier ?? s.tier } : proceduralEnemy();
        // A lobby seat goes through the SAME enemy-side builder as a served board, so it fights with its run's
        // spell power, auras, fodder and quest/rune modifiers exactly as it would in Ascent.
        const enemyState = lobbyFoe?.snapshot
          ? enemySideFrom(lobbyFoe.snapshot, e.tier)
          : lobbyFoe || !served ? combatSide({ tier: e.tier, poolIds: poolOf(s).all.map((c) => c.id) }) : servedState;
        s.lastCombat = resolveCombatVs(e.enemy, enemyState);
      } catch {
        const e = proceduralEnemy();
        s.lastCombat = resolveCombatVs(e.enemy, combatSide({ tier: e.tier }));
      }
      s.markEnemyRightmostTaunt = false; // Marked Target is a one-fight debuff — spent by the combat just resolved
      // Telegraph the Fleeting Vigor surge as a Start-of-Combat narration so the pre-baked buff reads as a
      // real effect (a banner + glow on your line as combat opens) instead of silently bigger minions.
      if (fleeting) {
        // CHOREOGRAPHER PR 8 — make the surge actually HAPPEN on screen instead of being pre-applied.
        //
        // The buff was baked into the combat board before `simulate`, so `initial` already held the buffed
        // stats: combat opened with bigger minions and a banner explaining, after the fact, that they had
        // been bigger all along. That is the owner's report — "Fleeting Vigor triggers the stats before the
        // start of combat triggers" — and no timing tool could fix it, because the numbers were never
        // animated at all.
        //
        // `initial` is PRESENTATION ONLY: the combat was already simulated from the buffed board, and the
        // replay is a pure fold of `(initial, events, upto)`. So rewinding `initial` to the pre-buff stats and
        // adding real `buff` events reconstructs the exact same board — it just shows the gain LANDING at its
        // Start-of-Combat moment rather than being true from frame one. Gameplay, RNG and the outcome are
        // untouched; `socBoard` still reads the buffed board because these events sit in the Start-of-Combat
        // slice it folds through.
        const a = fleeting.attack * twilightMult;
        const h = fleeting.health * twilightMult;
        const buffed = s.lastCombat.initial.player.slice(0, fleetingCovered);
        const opening: CombatEvent[] = [];
        const firstUid = buffed[0]?.uid;
        if (firstUid) {
          opening.push({
            type: 'sc', source: firstUid,
            text: `Fleeting Vigor — your minions surge +${a}/+${h}`,
          });
        }
        for (const m of buffed) {
          m.attack -= a;   // rewind to the pre-Start-of-Combat board…
          m.health -= h;
          opening.push({ type: 'buff', target: m.uid, attack: a, health: h, source: m.uid }); // …and land it here
        }
        if (opening.length) s.lastCombat.events.unshift(...opening);
      }
      s.combatSettled = false; // a fresh combat — its outcome hasn't been applied yet
      s.phase = 'combat';
      return s;
    }

    case 'combatEscalationPreview': {
      // Display-only (see `fxEscalationPreview`): the replay narrates an escalating spell improving itself
      // mid-fight, and the held card's printed value moves with it. The REAL gain lands at settle through
      // `playerSpellEscalationGain`; settle clears this, so the two can never stack.
      const cur = s.fxEscalationPreview ?? { attack: 0, health: 0 };
      s.fxEscalationPreview = { attack: cur.attack + action.attack, health: cur.health + action.health };
      return s;
    }
    case 'combatSpellCastPreview': {
      s.fxSpellsCastPreview = (s.fxSpellsCastPreview ?? 0) + 1; // display-only — see fxSpellsCastPreview
      return s;
    }
    case 'combatFriendlyDeathPreview': {
      s.fxFriendlyDeathPreview = (s.fxFriendlyDeathPreview ?? 0) + 1; // display-only — Cindara's live Avenge tracker
      return s;
    }
    case 'combatBladeAttackPreview': {
      s.fxBladeAttacksPreview = (s.fxBladeAttacksPreview ?? 0) + 1; // display-only — Gorun's live grant/countdown
      return s;
    }
    case 'settleCombat': {
      // Combat replay finished — apply the outcome (damage + carry-backs) now, in the combat view, so the
      // Resolve hit lands before you return to the shop. Idempotent: only the first call settles.
      if (s.phase !== 'combat' || !s.lastCombat || s.combatSettled) return state;
      settleCombat(s, s.lastCombat);
      // `s.lastCombat` is already the SAME object reference as the input's (shared, not cloned, at the top
      // of reduceCore) — which is what the UI needs: its replay hook + combat-stage effect reset when the
      // reference changes, so a fresh clone here would restart the just-finished combat.
      return s;
    }

    case 'resolveCombat': {
      // Leave combat for the next wave. Settle first if the player skipped the replay (so the damage still
      // applies), then advance past it (terminal check / next wave).
      if (s.phase !== 'combat' || !s.lastCombat) return state;
      if (!s.combatSettled) settleCombat(s, s.lastCombat);
      // The lobby round settles HERE rather than when the replay ended, so the table's new health, the
      // eliminations and your next opponent all appear together when you choose to leave the fight.
      settleLobbyRound(s, s.lastCombat);
      advanceCombat(s);
      return s;
    }
  }
}

/** Playing a golden minion grants a Discover spell (peek one tier up) into the hand. */
/**
 * The legal aim for a Choose One's target step — board minions the card may hit, plus (for an `any` card) the
 * tavern's minion offers. ONE pool, read by the play-time fizzle guard, the pick step's "is there anything to
 * aim at" test, and the target step's validation, so those three can never disagree about what is aimable.
 * `selfUid` excludes the card itself; under the deferred flow the body is still in hand, so it rarely applies.
 */
function chooseOneTargetPool(s: RunState, def: CardDef, selfUid?: string): string[] {
  const tribe = effectiveTargetTribe(s, def); // Rune of Open Appetite can lift a tribe restriction
  const board = s.board.filter((c) => c.uid !== selfUid && (!tribe || isTribe(c, tribe)));
  const offers = def.target === 'any' ? s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell) : [];
  return [...board.map((c) => c.uid), ...offers.map((o) => o.uid)];
}

/**
 * Resolve a SPELL Choose One: cast the chosen branch (or EVERY branch, under `chooseBothActive`) on the
 * optional target, then consume the spell from hand. Not a Battlecry — it is a spell cast, so it carries the
 * full cast bookkeeping (Nimbus/Thesis/Shared Pour charges, `playedThisTurn`, triples).
 *
 * Shared by all three routes into it — the pick step for an untargeted spell, the target step for an aimed
 * one, and the play itself when the card already does both — so they cannot drift. Returns the state, or
 * `null` when the spell is no longer in hand (the caller keeps its own state).
 */
function resolveChooseOneSpell(
  s: RunState, card: BoardCard | undefined, def: CardDef, index: number, targetUid?: string,
): RunState | null {
  if (!card) return null;
  const hi = s.hand.findIndex((c) => c.uid === card.uid);
  if (hi < 0) return null;
  const target = targetUid ? s.board.find((c) => c.uid === targetUid) : undefined;
  // An `any` Choose One (Crest of the Climb) may have aimed at a tavern offer, not a board minion — buff it pre-buy.
  const offer = targetUid && !target ? s.shop.find((o) => o.uid === targetUid && !CARD_INDEX[o.cardId]?.spell) : undefined;
  // The aim was answered but the target has gone (sold) since — fizzle the cast, still consume the spell.
  if (targetUid && !target && !offer) { s.hand.splice(hi, 1); return s; }
  const casts = spellCasts(s, def);
  // (BOTH) — Rune of Facetwright's "they give both effects": resolve EVERY branch instead of the picked one.
  const both = chooseBothActive(s, card, def);
  const branches = both ? (def.chooseOne ?? []) : (def.chooseOne?.[index] ? [def.chooseOne[index]] : []);
  const synthetic = { ...def, effects: branches.flatMap((o) => o.effects) };
  for (let n = 0; n < casts; n++) {
    if (offer) castSpellOnOffer(s, synthetic, offer);
    else castSpell(s, synthetic, target);
  }
  if (!def.singleCast) s.nextSpellExtraCasts = undefined; // Nimbus charge spent (already folded into `casts`)
  if (!def.singleCast && s.spellFirstDoubleEachTurn) s.spellFirstUsedThisTurn = true; // Spell Thesis freebie spent
  if (!def.singleCast && s.runeSharedPour && ALE_IDS.includes(def.id) && !s.sharedPourUsedThisTurn) procRuneId(s, 'rune_shared_pour');
  if (!def.singleCast && s.runeSharedPour && ALE_IDS.includes(def.id)) s.sharedPourUsedThisTurn = true; // Shared Pour freebie spent
  s.hand.splice(hi, 1);
  s.playedThisTurn = [...(s.playedThisTurn ?? []), def.id]; // counts as a card played (Rune of Action)
  checkTriples(s);
  return s;
}

function grantGoldenDiscover(s: RunState): void {
  // MIDAS: his Gilds pay a Gold Pouch instead of the Triple Reward. Swapped HERE rather than at the call sites
  // because every Gild route funnels through this one function — doing it per-site would guarantee a missed
  // path (the `applySpellBought` lesson).
  if (hasPower(s, 'midasTouch')) {
    const pouch = CARD_INDEX['emberpouch'];
    if (pouch && s.hand.length < handCap(s)) conjureToHand(s, [pouch], 1);
    return;
  }
  // Rune of the Corrupted Tome: a Triple Reward grants TWO — and +1 more per extra copy held (repeat family,
  // owner 2026-08-27). Recursion is bounded by the flag being cleared for the inner calls, so the extras can
  // never compound however many Tomes are owned.
  if (s.runeCorruptedTome) {
    procRuneId(s, 'rune_corrupted_tome');
    s.runeCorruptedTome = undefined;
    try {
      for (let k = 0; k < runeStacksOf(s, 'rune_corrupted_tome'); k++) grantGoldenDiscover(s);
    } finally { s.runeCorruptedTome = true; }
  }
  if (s.hand.length >= handCap(s)) return; // the hand cap — raised while the Runeforge is open (see handCap)
  s.hand.push({
    uid: `b${s.uidSeq++}`,
    cardId: 'discoverspell',
    tribe: 'neutral',
    attack: 0,
    health: 1,
    keywords: [],
    golden: false,
    grantedTier: s.tier, // freeze "peek one tier up" at the tier it was granted — taverning up later can't inflate it
  });
}

/**
 * Battlegrounds triple: three non-golden copies of a card (across hand + board)
 * combine into one golden copy at 2× base stats, and the triple grants a
 * Discover. Loops so a combine that frees a slot can reveal another triple.
 */
function checkTriples(s: RunState): void {
  for (let guard = 0; guard < 10; guard++) {
    const counts = new Map<string, number>();
    for (const c of [...s.board, ...s.hand]) {
      // Spells + Rubies are never minions — they don't triple (they're cast for their effect; owner: Rubies
      // are spells for this purpose). Both play from hand for an effect, never combine into a golden.
      // `noTriple` opts a MINION out too (Mage-Pup): its identity is per-instance, so copies aren't
      // interchangeable and a combine would destroy information. Excluded from the COUNT, not just from the
      // combine, so three Pups don't sit at a permanent phantom 3/3 triple that never fires.
      const cd = CARD_INDEX[c.cardId];
      if (!c.golden && !cd?.spell && !cd?.ruby && !cd?.noTriple) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
    }
    // Rune of Twin Gilding AND Midas' Touch both Gild at 2 — either one is enough, so they cannot stack into 1.
    // Shared with the shop's "this completes a Gild" indicator via `gildCopiesNeeded` so the two cannot drift.
    const need = gildCopiesNeeded(s);
    let tripleId: string | undefined;
    for (const [id, n] of counts) {
      if (n >= need) {
        tripleId = id;
        break;
      }
    }
    if (!tripleId) return;
    combineIntoGolden(s, tripleId, pullCopies(s, tripleId, need));
  }
}

/** Pull up to `count` non-golden copies of `cardId` out of the hand (first) then the board, removing them
 *  and returning them with their current stats/keywords — the copies a combine consumes. */
function pullCopies(s: RunState, cardId: string, count: number): BoardCard[] {
  const combined: BoardCard[] = [];
  const pull = (arr: BoardCard[]): void => {
    for (let i = arr.length - 1; i >= 0 && combined.length < count; i--) {
      if (arr[i]!.cardId === cardId && !arr[i]!.golden) {
        combined.push(arr[i]!);
        arr.splice(i, 1);
      }
    }
  };
  pull(s.hand); // consume from the hand first, then the board
  pull(s.board);
  return combined;
}

/**
 * Combine the pulled `combined` copies of `tripleId` into one golden copy pushed to the hand — the shared
 * core of a natural triple (3 copies) and Gildmaster's Golden Gild (2 copies). Carries every per-instance
 * accrual through the combine. No-op on an empty set. The triple's Discover isn't granted here — it comes
 * from a spell when the golden is played.
 */
function combineIntoGolden(s: RunState, tripleId: string, combined: BoardCard[]): void {
  if (combined.length === 0) return;
  // Golden = the two best copies (by total stats) stacked: their stats summed, their per-source
  // buff breakdowns merged (so the golden's inspect panel still itemizes its buffs), and the union
  // of all copies' keywords. For uniform buffs / fresh triples this equals the old "top-two atk +
  // top-two hp" result; it only differs for oddly asymmetric per-copy buffs (rare), and in exchange
  // the breakdown stays consistent with the stats.
  const kept = [...combined].sort((a, b) => (b.attack + b.health) - (a.attack + a.health)).slice(0, 2);
  const goldenBuffs = mergeBuffs(kept.flatMap((c) => c.buffs ?? []));
  const def = CARD_INDEX[tripleId]!;
  // A host that RECEIVED attachments gains the 'M' keyword (owner ruling — it counts as an Attachment for the
  // aura), but that must NOT carry into its triple: a golden Moe / Beatboxer is a normal minion, not an
  // Attachment, so it should never magnetize when played. Keep 'M' only if the BASE card is genuinely Magnetic
  // (Better Bot / Money Bot / Cling Drone / …).
  // TEMPORARY keywords do not survive a triple (owner report 2026-08-08: a one-combat Rise came out of the
  // combine permanent). Maw of the Pit's Ward and Lord of the Risen's Rise are marked on the INSTANCE
  // (`tempShield` / `tempReborn`) and stripped at the end of the fight they were granted for — but the union
  // below reads only `keywords`, so a triple copied the pill and left the marker behind, making it permanent.
  // A temp keyword is kept only when some combined copy holds it for real (the base card prints it, or an
  // untagged copy carries it).
  const tempOnly = (k: Keyword): boolean =>
    !def.keywords.includes(k)
    && combined.every((c) => !c.keywords.includes(k) || (k === 'DS' ? c.tempShield : k === 'R' ? c.tempReborn : false));
  const keywords = [...new Set(combined.flatMap((c) => c.keywords))]
    .filter((k) => k !== 'M' || def.keywords.includes('M'))
    .filter((k) => !((k === 'DS' || k === 'R') && tempOnly(k)));
  // A summon-buff card (Kennelmaster / Bristleback Matron) carries its accrued buff
  // through the triple: the golden's summonBonus = its base buff + the two highest
  // bonuses combined, so the granted magnitude (base + summonBonus) is the SUM of the
  // top-two copies' magnitudes — two boosted Kennelmasters at +6/+4 combine to +10, and
  // a fresh triple just doubles the base (the golden doubling falls out of the combine).
  // Effects whose accrual has its OWN merge below — the universal fallback must not ALSO write `summonBonus`
  // for them, or the accrual double-counts (measured 2026-07-31: it broke Flowing Monk's "countdown starts
  // fresh" rule). Runescale merges via `spellProgress`, the Monk via `overflowBonus`.
  const OWN_MERGE = ['overflowBuffRandom', 'spellCastImproveSelf'];
  const summonEffect = def.effects.find((e) => e.do === 'buffOnSummon' || e.do === 'scBeastAura');
  const improveEffect = def.effects.find((e) => e.do === 'summonBuffTribeImprove' || e.do === 'countTribeSummon' || e.do === 'onGainAttackBuffImproving');
  let summonBonus: number | undefined;
  if (summonEffect) {
    const base = Number((summonEffect.params as { attack?: number })?.attack ?? 0);
    const sbs = combined.map((c) => c.summonBonus ?? 0).sort((a, b) => b - a);
    summonBonus = base + (sbs[0] ?? 0) + (sbs[1] ?? 0);
  } else if (improveEffect) {
    // Mama Bear: the golden picks up the accrual at its CURRENT value (the highest of the copies) —
    // not reset, not summed/doubled. The bigger per-summon step (+6/+6) comes from gold(self) in the
    // factory, so all the triple must do is preserve where the accrual already is.
    const maxBonus = Math.max(...combined.map((c) => c.summonBonus ?? 0));
    summonBonus = maxBonus > 0 ? maxBonus : undefined;
  } else if (def.effects.some((e) => e.do === 'onKillBuffUndeadAttack' || e.do === 'onAllyAttackBuffAll')) {
    // Karthus / Crypt Drake (owner ruling 2026-07-16): the golden COMBINES the two highest copies'
    // accrued improvements. The doubled base grant + doubled improve step come from mul(self) in the
    // factory, so the triple only merges where the accruals already are.
    const sbs = combined.map((c) => c.summonBonus ?? 0).sort((a, b) => b - a);
    const sum = (sbs[0] ?? 0) + (sbs[1] ?? 0);
    summonBonus = sum > 0 ? sum : undefined;
  } else if (!def.effects.some((e) => OWN_MERGE.includes(e.do))) {
    // THE UNIVERSAL RULE (owner, restated 2026-08-02: "the buff is not supposed to reset when tripled" — ever).
    //
    // The 2026-07-31 fix was an opt-in registry (`ACCRUES_SUMMON_BONUS`), and every accruing effect added
    // AFTER it silently inherited the reset bug — Menagerie Mammoth (the owner's report), King Oona,
    // Broodwright and Trophy Stalker had all fallen through it. There is no registry now: ANY copy carrying a
    // nonzero `summonBonus` keeps it through gilding, combining the two highest copies (the Karthus / Crypt
    // Drake precedent — the golden's own doubling comes from `gold(self)`/`mul(self)` inside each factory).
    // A card with no accrual sums to 0 and stays `undefined`, exactly as before. The only exclusions are the
    // OWN_MERGE effects above, whose accruals are merged through their own fields below.
    const sbs = combined.map((c) => c.summonBonus ?? 0).sort((a, b) => b - a);
    const sum = (sbs[0] ?? 0) + (sbs[1] ?? 0);
    summonBonus = sum > 0 ? sum : undefined;
  }
  // Flowing Monk (owner ruling 2026-07-03): the golden COMBINES the two highest copies' CURRENT grants —
  // e.g. +10/+10 and +4/+4 copies triple into a golden granting +14/+14. Since the stepped formula can't
  // express an arbitrary start, the surplus over the golden base rides in a flat `overflowBonus`; the
  // overflow countdown starts fresh (summonBonus stays unset → "5 to go").
  const overflowEffect = def.effects.find((e) => e.do === 'overflowBuffRandom');
  let overflowBonus: number | undefined;
  if (overflowEffect) {
    const p = overflowEffect.params as { attack?: number; improveEvery?: number } | undefined;
    const base = Number(p?.attack ?? 2);
    const every = Math.max(1, Number(p?.improveEvery ?? 5));
    const grants = combined
      .map((c) => base * (1 + Math.floor((c.summonBonus ?? 0) / every)) + (c.overflowBonus ?? 0))
      .sort((a, b) => b - a);
    const surplus = (grants[0] ?? base) + (grants[1] ?? base) - base * 2; // over the golden's own base grant
    overflowBonus = surplus > 0 ? surplus : undefined;
  }
  // Sergeant: the golden keeps the HIGHEST accrued Deathrattle HP-grant bonus of the copies (not
  // summed/reset) — the bigger per-Attack step (+4) comes from gold(self) in the factory, so the triple
  // only preserves where the accrual already is.
  const hpGrantEffect = def.effects.find((e) => e.do === 'onGainAttackImproveHpGrant');
  let hpGrantBonus: number | undefined;
  if (hpGrantEffect) {
    const maxBonus = Math.max(...combined.map((c) => c.hpGrantBonus ?? 0));
    hpGrantBonus = maxBonus > 0 ? maxBonus : undefined;
  }
  // Frontdrake / Money Maker: keep the copy furthest into its cadence (closest to the next proc) — tripling
  // one about to proc keeps the "procs this turn" timing. Only the cycle position (mod every) matters, so the
  // golden inherits the max position; a fresh/just-procced set (all 0) starts a clean cycle. Any End-of-Turn
  // effect with an `every` param counts (Frontdrake's conjure, Money Maker's card grant).
  const cadenceEffect = def.effects.find((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined);
  let goldenEotTick: number | undefined;
  if (cadenceEffect) {
    const every = Math.max(1, Number((cadenceEffect.params as { every?: number })?.every ?? 3));
    const pos = Math.max(...combined.map((c) => (c.eotTick ?? 0) % every));
    goldenEotTick = pos > 0 ? pos : undefined;
  }
  // Absorbed mana-per-turn (a Money Bot magnetized into one of the copies) carries through the
  // triple so the income survives (the golden's own def.manaPerTurn handles the un-merged case).
  const absorbedMana = combined.reduce((sum, c) => sum + (c.manaBonus ?? 0), 0);
  // Same for the other welded magnetic fields: Better Bot's Rally (`rallyMechAtk`) and Harry Botter's
  // spell aura (`spellAuraBonus`) — sum them across the copies so a magnetized host keeps its attachments
  // through a triple (the golden's own def handles a standalone Better Bot's Rally at instantiate time).
  const absorbedRally = combined.reduce((sum, c) => sum + (c.rallyMechAtk ?? 0), 0);
  const absorbedRallySpell = combined.reduce((sum, c) => sum + (c.rallySpellWeld ?? 0), 0); // Perfect Core's welded Rally
  const absorbedSpellAura = combined.reduce((sum, c) => sum + (c.spellAuraBonus ?? 0), 0);
  const absorbedFodderAura = combined.reduce(
    (sum, c) => ({ attack: sum.attack + (c.fodderAuraBonus?.attack ?? 0), health: sum.health + (c.fodderAuraBonus?.health ?? 0) }),
    { attack: 0, health: 0 },
  );
  // Spirit Pup / Guel: the golden keeps the *highest* spell progress of the copies (= the lowest spells-left),
  // so a 2-left + 8-left + 5-left triple needs only 2 more spells to evolve. Runescale Drake instead SUMS the
  // copies' progress (owner ruling: "tripling takes the combined values" — a +20 and two fresh +1 → +21), so
  // its accrued Dragon buff isn't thrown away by the merge. Keyed on the `spellCastImproveSelf` effect.
  const sumsProgress = def.effects.some((e) => e.do === 'spellCastImproveSelf');
  const goldenProgress = sumsProgress
    ? combined.reduce((sum, c) => sum + (c.spellProgress ?? 0), 0)
    : Math.max(...combined.map((c) => c.spellProgress ?? 0));
  // Tara: the golden keeps the *highest* ascend progress of the copies (= the lowest "to go"), so tripling a
  // Tara that's close to ascending doesn't reset it back to 20-to-go.
  const goldenAscend = def.ascendAt ? Math.max(...combined.map((c) => c.ascendProgress ?? 0)) : 0;
  // Hoarder: the golden keeps the EARLIEST (minimum) boughtWave of the copies, so a golden Hoarder
  // inherits the oldest copy's age → its highest sell value as the starting point (sell =
  // (wave - boughtWave + 1) × 2 golden). Generic — harmless on cards that don't read it — but Hoarder
  // is the one that matters. Copies with no boughtWave (not from a buy) are ignored; undefined if none had one.
  const boughtWaves = combined.map((c) => c.boughtWave).filter((w): w is number => w !== undefined);
  const goldenBoughtWave = boughtWaves.length > 0 ? Math.min(...boughtWaves) : undefined;
  const goldenCard: BoardCard = {
    uid: `b${s.uidSeq++}`,
    cardId: def.id,
    tribe: def.tribe,
    attack: kept.reduce((sum, c) => sum + c.attack, 0),
    health: kept.reduce((sum, c) => sum + c.health, 0),
    keywords,
    golden: true,
    summonBonus,
    overflowBonus,
    hpGrantBonus,
    manaBonus: absorbedMana > 0 ? absorbedMana : undefined,
    rallyMechAtk: absorbedRally > 0 ? absorbedRally : undefined,
    rallySpellWeld: absorbedRallySpell > 0 ? absorbedRallySpell : undefined,
    spellAuraBonus: absorbedSpellAura > 0 ? absorbedSpellAura : undefined,
    fodderAuraBonus: absorbedFodderAura.attack > 0 || absorbedFodderAura.health > 0 ? absorbedFodderAura : undefined,
    buffs: goldenBuffs.length > 0 ? goldenBuffs : undefined,
    spellProgress: goldenProgress > 0 ? goldenProgress : undefined,
    ascendProgress: goldenAscend > 0 ? goldenAscend : undefined,
    boughtWave: goldenBoughtWave,
    eotTick: goldenEotTick,
  };
  // Respect the hard 10-card hand cap. A triple always frees board slots (it consumes ≥1 board copy), so if
  // the hand is full the golden goes onto the board rather than over-capping the hand — the reward is never lost.
  if (s.hand.length < handCap(s)) s.hand.push(goldenCard);
  else s.board.push(goldenCard);
  carrySableBond(s, combined, goldenCard.uid);
  s.triplesMade++; // run-wide tally — surfaced as opponent intel in board snapshots
}

/**
 * SABLE'S SOULBIND ACROSS A TRIPLE (owner report 2026-08-29: "sable's hero power breaks if a minion who is
 * soulbound gets tripled").
 *
 * The bond is two run-board UIDs, and a triple destroys its copies and mints a golden with a fresh uid — so a
 * bonded body that tripled left `sableBond` pointing at a uid nothing could resolve. The mirror needs BOTH
 * ends, so the power went dead for the rest of the turn, in silence, in both phases (combat matches on the
 * same run-board uid via `sourceUid`).
 *
 * The bond FOLLOWS the body, which is what every other per-instance value in `combineIntoGolden` already does
 * — buffs, spell progress, ascend progress, the earliest boughtWave. A triple is a merge, not a death.
 *
 * TWO ends collapsing into ONE golden ends the bond instead. A self-bond is not a bond: `addBuff` would find
 * the partner to be the same body and pay every buff twice, which is a worse bug than the one being fixed and
 * exactly the trap the Rune of Shared Spoils already documents ("a single Dwarf on the board is both ends, so
 * it must not pay itself").
 */
function carrySableBond(s: RunState, consumed: readonly BoardCard[], goldenUid: string): void {
  const bond = s.sableBond;
  if (!bond) return;
  const gone = new Set(consumed.map((c) => c.uid));
  const hitA = gone.has(bond.a);
  const hitB = gone.has(bond.b);
  if (!hitA && !hitB) return;         // this triple touched neither end
  if (hitA && hitB) s.sableBond = undefined; // both ends merged — no pair left to bond
  else s.sableBond = { ...bond, a: hitA ? goldenUid : bond.a, b: hitB ? goldenUid : bond.b };
  // RE-STAMP, for the same reason the hero power stamps on activation: `SABLE` is captured ONCE at the top of
  // `reduceCore` and holds the uids as they were then. A triple resolves mid-dispatch — the played body's own
  // Battlecry, or any effect after it, can still buff — so without this the rest of THIS action would keep
  // mirroring against the uid that just stopped existing.
  stampSableBond(s);
}

/**
 * LOBBY MODE: settle the whole ROUND from the player's fight.
 *
 * The player's fight is authoritative and just happened, so both sides' damage reads straight off that ONE
 * result, then the other three pairings resolve. Combat is not symmetric (the winner flips 22% of the time when
 * the sides are swapped), so re-simulating the player's fight from the opponent's chair would contradict the
 * replay they just watched.
 *
 * DEFERRED TO THE END-COMBAT BUTTON (owner ask 2026-07-31). This used to run inside `settleCombat`, i.e. the
 * moment the replay finished — so the rail showed the table's new health, the eliminations and your NEXT
 * opponent while you were still looking at the fight you had just watched. It now runs on `resolveCombat`, the
 * action behind "return to shop", so the round's consequences land when the player asks to see them.
 *
 * Idempotent via `lobbySettledRound`: settling twice would resolve the other pairings a second time and charge
 * every seat twice for one round.
 */
function settleLobbyRound(s: RunState, result: CombatResult): void {
  if (!s.lobby) return; // practice carries a lobby too (2026-07-31) — the machinery keys on its presence
  if (s.lobbySettledRound === s.lobby.round) return;
  s.lobbySettledRound = s.lobby.round;
  s.lobby = settleRunLobbyRound(
    { ...s.lobby, seats: s.lobby.seats.map((x) => ({ ...x })), encounters: [...s.lobby.encounters] },
    result,
  );
  const me = s.lobby.seats[0]!;
  // PRACTICE invulnerability: the player's seat shrugs the round off — health restored to what it was going in,
  // never eliminated. The other seven seats fight and die normally, so the lobby still runs its course.
  // Practice OPTIONS (2026-08-24): `health: 'normal'` opts OUT of this — the seat takes real damage and can be
  // eliminated like any lobby seat, falling through to the ordinary seat→run sync below.
  if (s.mode === 'practice' && s.practiceConfig?.health !== 'normal') {
    me.resolve = s.resolve;
    me.armor = s.armor;
    me.alive = true;
    me.placement = undefined;
    return;
  }
  // The seat's health becomes the run's, so the HUD and every health-aware effect read the number that actually
  // matters. The ordinary damage path in `settleCombat` is explicitly skipped for lobby mode, so this is the
  // only writer and there is no double-charge.
  s.resolve = Math.max(0, me.resolve);
  s.armor = Math.max(0, me.armor);
}

/** Apply a resolved combat's outcome and advance to the next wave — or end the run. */
function settleCombat(s: RunState, result: CombatResult): void {
  // Record this wave's result for the end-screen W-L-W summary (every combat, win or lose).
  s.history.push(result.result);
  // Loss-streak tracking (matchmaking softener): a loss extends the streak; a WIN breaks it and re-arms the
  // once-per-streak softener. A draw neither extends nor breaks — it just doesn't stop the bleeding.
  if (result.result === 'lose') s.lossStreak = (s.lossStreak ?? 0) + 1;
  else if (result.result === 'win') { s.lossStreak = 0; s.streakSoftened = undefined; }
  // HENCHMAN decay (owner spec 2026-08-03): the hero's henchman gets cheaper every round — WIN −3 Gold,
  // LOSS −2. A draw decays −2 as well (assumption: the spec keys the two named outcomes, and "every round"
  // means the price always moves; a draw is a non-win). Accrued even before any hero carries a henchman —
  // the counter is inert until `henchmanOffer` reads it, and this keeps the decay retroactively correct for
  // heroes that gain one mid-development. Settle runs once per combat (combatSettled guards), so no double tick.
  s.henchmanDiscount = (s.henchmanDiscount ?? 0) + (result.result === 'win' ? 3 : 2);
  // Dupes: "Win N rounds" advances on a won combat.
  if (result.result === 'win') advanceQuests(s, (o) => o.event === 'winRound');
  // The Author's Hand compound objective: its Echo + Rally halves accrue from this combat's tallies (its Shout
  // half accrues from recruit-phase plays).
  bumpAuthorsHand(s, 'echo', result.playerDeathrattles);
  bumpAuthorsHand(s, 'rally', result.playerRallies ?? 0);
  // Attribute this combat's player damage + mechanic procs into the run-wide tallies (→ MVP + most-triggered).
  accumulateContribution((s.runDamage ??= {}), (s.runProcs ??= {}), tallyCombat(result));
  // Accumulate this combat's player Deathrattles into the run-wide "this game" count (Grim scales off it).
  s.deathrattlesTriggered += result.playerDeathrattles;
  // Record who survived — read at the next shop start to fire a surviving Gravetwin's copied Echo.
  s.lastSurvivorCardIds = result.playerSurvivorCardIds;
  // Persist per-instance combat state (Kennelmaster's Avenge permanently improves its
  // summon buff for the rest of the run), keyed back to the originating board card.
  if (result.playerSummonBonus) {
    for (const { sourceUid, bonus } of result.playerSummonBonus) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (card) card.summonBonus = bonus;
    }
  }
  // Sergeant: persist its Deathrattle HP-grant accrual (seeded value + this combat's Attack-gain
  // improvements) so the bonus is permanent across fights — keyed back to the originating board card.
  if (result.playerHpGrantBonus) {
    for (const { sourceUid, bonus } of result.playerHpGrantBonus) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (card) card.hpGrantBonus = bonus;
    }
  }
  // Archmagus Guel: persist his on-board spell tally (seeded + this combat's casts) so combat casts count
  // permanently toward his per-instance improvement — keyed back to the originating board card.
  if (result.playerSpellProgress) {
    for (const { sourceUid, progress } of result.playerSpellProgress) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (!card) continue;
      card.spellProgress = progress;
      // Spirit Pup: combat spell casts count toward its transform too — swap the form now if the carried-back
      // tally reached `at` (the recruit half only swaps on a SHOP cast, so combat progress would otherwise stall
      // at ≥`at` without transforming). Keeps the instance's stats / golden / buffs — only the identity changes.
      const t = CARD_INDEX[card.cardId]?.effects.find((e) => e.do === 'spellCastTransform')?.params as { at?: number; into?: string } | undefined;
      if (t?.into && CARD_INDEX[t.into] && progress >= (t.at ?? 10)) {
        card.cardId = t.into;
        card.spellProgress = undefined;
      }
    }
  }
  // Tara → Taragosa: accumulate this combat's stat-grants; at the `ascendAt` threshold, ascend the board card
  // to its `ascendInto` form (keeping its stats / golden / buffs — only the identity changes, like Spirit Pup).
  if (result.playerAscendCount) {
    for (const { sourceUid, count } of result.playerAscendCount) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (!card) continue;
      card.ascendProgress = (card.ascendProgress ?? 0) + count;
      const def = CARD_INDEX[card.cardId];
      if (def?.ascendAt && def.ascendInto && card.ascendProgress >= def.ascendAt && card.cardId !== def.ascendInto) {
        card.cardId = def.ascendInto;
        card.tribe = CARD_INDEX[def.ascendInto]?.tribe ?? card.tribe;
      }
    }
  }
  // Permanent mid-combat gains carry back to the run board (recorded as a buff so the inspect view shows
  // the source), win or lose. `engraved` comes from the *combat* minion's live keywords — so a minion
  // Engraved only at Start of Combat (Taurus's neighbor) carries its gains back and is labelled "Engraved",
  // even though its run-board card never had the EG keyword. A non-Engraved carrier got Flowing Monk's gift.
  if (result.playerPermaBuffs) {
    for (const { sourceUid, attack, health, engraved, ruby } of result.playerPermaBuffs) {
      const card = s.board.find((c) => c.uid === sourceUid);
      if (!card) continue;
      // Taragosa's Heir amplifies stat gains from ALL sources — combat included. It's Engraved, so its combat
      // gains reach here; multiply its carry-back ×2 (golden ×3) so combat matches its recruit-phase amplifier.
      const mult = card.cardId === 'taragosaheir' ? (card.golden ? 3 : 2) : 1;
      // 'Ruby' keeps the inspect breakdown honest AND makes the gain visible to Deepdelve Paragon next fight,
      // which looks for exactly that source.
      addBuff(card, ruby ? 'Ruby' : engraved ? 'Engraved' : 'Flowing Monk', attack * mult, health * mult);
    }
  }
  // Set 2 — Rubies gained IN COMBAT (Rikk's Rally, Gemline's Avenge): mint them into hand now, baked with the
  // run's live rubyBonus (identical to a shop-minted Ruby).
  if (result.playerRubyGrants) mintRubies(s, result.playerRubyGrants);
  // Set 2 — Ruby STRENGTH gained in combat (Veinbreaker's Avenge "buff your Rubies"): raise the run's rubyBonus
  // AND grow every held Ruby — the same effect as the recruit-phase `rubyStatGain`.
  if (result.playerNextTurnSpellCopies) {
    // Scalefeather Echoes fired this combat → arm the copy for NEXT turn. `s.wave` is still this combat's wave
    // at settle (advanceCombat increments it later), so `s.wave + 1` is exactly next turn — the same "next
    // turn" marker Hourglass Reserve uses. Multiple Scalefeathers sum; the earliest activation wave wins so a
    // pending copy is never dropped.
    const prev = s.nextTurnSpellCopies;
    s.nextTurnSpellCopies = {
      activateWave: prev ? Math.min(prev.activateWave, s.wave + 1) : s.wave + 1,
      count: (prev?.count ?? 0) + result.playerNextTurnSpellCopies,
    };
  }
  // Demon Horse's Rally: the Shop buff it earned in combat lands on the run-wide tavern channel, so it applies
  // to every future offer rather than evaporating with the fight.
  if (result.playerWildHuntGrown != null && result.playerWildHuntGrown > (s.runeWildHuntGrown ?? 0)) {
    s.runeWildHuntGrown = result.playerWildHuntGrown; // Wild Hunt: this fight's growth is permanent
  }
  if (result.playerTavernBuyGain) {
    s.tavernBuyBonus.atk += result.playerTavernBuyGain.attack;
    s.tavernBuyBonus.hp += result.playerTavernBuyGain.health;
  }
  if (result.playerRubyBonusGain && (result.playerRubyBonusGain.attack > 0 || result.playerRubyBonusGain.health > 0)) {
    const g = result.playerRubyBonusGain;
    const b = s.rubyBonus ?? { attack: 0, health: 0 };
    s.rubyBonus = { attack: b.attack + g.attack, health: b.health + g.health };
    for (const card of s.hand) if (CARD_INDEX[card.cardId]?.ruby) { card.attack += g.attack; card.health += g.health; }
  }
  // A combat-refired "get N Rubies" Shout: the REAL mint (rubyBonus baked in — the bonus gain above lands
  // first deliberately — Candle Conduit fired, hand cap respected), not a plain hand grant.
  if (result.playerRubyMints) mintRubies(s, result.playerRubyMints);
  // ROPE WRANGLER no longer EATS the card it summons (owner report 2026-08-08: "summons a minion and then
  // you don't have it next turn"). Its printed text is "Echo: summon a random minion from your hand" — it
  // never says the card is spent, and the summoned body is a combat-only body like every other summon, so
  // the hand card survives the fight. `playerHandSummoned` still rides back (the replay and any future
  // consumer can see WHICH cards fought); it simply no longer deletes them.
  void result.playerHandSummoned;
  // Cards a combat effect added to the hand land in the hand for the next recruit, win or lose — capped by
  // the hand limit. This is the single channel for ALL in-combat card grants: a SPECIFIC card (Arcane Weaver →
  // a Spirit Fire copy) AND a RANDOM card already picked in combat (Sporebat's spell, Ryme re-firing Sea Urchin
  // / Black Belt Brian — the `toHand` event showed the real card flying). Each carries the run's per-card
  // enchant + Undead bond and leaves the shared pool (both no-ops for spells), matching a normal conjure.
  if (result.playerHandGrants) {
    for (const cardId of result.playerHandGrants) {
      const def = CARD_INDEX[cardId];
      if (!def || s.hand.length >= handCap(s)) continue;
      const cb = cardBuff(s, cardId);
      s.hand.push({
        uid: `b${s.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        ...conjuredStats(s, def, cb),
        keywords: [...def.keywords],
        golden: false,
      });
      takeFromPool(s, cardId);
    }
  }
  // Rune of the Trophy: the first friendly minion to Slaughter this combat arrives as a plain base-stat
  // copy in hand for the next shop (the same conjure shape as playerHandGrants above — run enchants +
  // tribe bonds apply; a full hand forfeits it).
  if (result.playerSlaughterCopy) {
    const def = CARD_INDEX[result.playerSlaughterCopy];
    if (def && s.hand.length < handCap(s)) {
      const cb = cardBuff(s, def.id);
      s.hand.push({
        uid: `b${s.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        ...conjuredStats(s, def, cb),
        keywords: [...def.keywords],
        golden: false,
      });
    }
  }
  // Skullblade: permanent run-wide spell power gained from its combat Deathrattle (+Attack to your
  // spells), win or lose. Folds into spellAttackBonus / spellHealthBonus from now on, so every future
  // stat spell + its display picks it up. Stacks across combats.
  if (result.playerSpellPower) {
    s.spellBonus ??= { attack: 0, health: 0 };
    s.spellBonus.attack += result.playerSpellPower.attack;
    s.spellBonus.health += result.playerSpellPower.health;
  }
  // Grave Knit: a combat death permanently buffs the Grave Knit card type run-wide (+3/+2 to every
  // Grave Knit — board, hand, and future copies), win or lose. Mirrors Ritualist's Fodder enchant;
  // multiple deaths stack (each carried entry already sums this combat's firings).
  if (result.playerCardBuffs) {
    for (const { cardId, attack, health } of result.playerCardBuffs) {
      buffCardTypeRunWide(s, cardId, attack, health, CARD_INDEX[cardId]?.name ?? cardId);
    }
  }
  // Burial Imp: Fodder queued by its combat Deathrattle drops into the next tavern (a Demon eats it there).
  if (result.playerFodderGrants) {
    (s.pendingTavern ??= []).push(...Array(result.playerFodderGrants).fill('fred'));
  }
  // Pit Supplier: Fodder scheduled across the next several shops → merge index-for-index into fodderSchedule.
  if (result.playerFodderSchedule) {
    s.fodderSchedule ??= [];
    result.playerFodderSchedule.forEach((n, i) => { if (n > 0) s.fodderSchedule![i] = (s.fodderSchedule![i] ?? 0) + n; });
  }
  // Ryme re-firing an ECONOMY battlecry in combat (Soulfeeder's Fodder, Hoarder's Gold, Demonic Anomaly's shop
  // buff, a gain-a-minion) couldn't run in the pure fight — replay each through its recruit factory now, with
  // full RunState access. Recorded once per re-fire in combat, so Drakko's doubling is already baked in.
  if (result.playerDeferredBattlecries) {
    for (const { cardId, golden } of result.playerDeferredBattlecries) replayEconomyBattlecry(s, cardId, golden);
  }
  // Imp King / Brood Matron Avenge: their in-combat Imp buffs are permanent — accrue them into the run-wide
  // Imp buff so future Imps (next fights) inherit them.
  // Rune of Overflow: fold the combat's permanent board buff onto every minion the run still holds. Applied to
  // hand as well as board — a body you were about to play earned it too.
  if (result.playerBoardBuffGain) {
    const g = result.playerBoardBuffGain;
    for (const c of [...s.board, ...s.hand]) addBuff(c, 'Rune of Overflow', g.attack, g.health);
  }
  if (result.playerImpBuffGain) {
    // REPLACED, not mutated — same reason as `buffImpsRunWide`: the UI's live-text memos key on `impBuff` by
    // reference, so an in-place bump never reached the printed Imp stats (owner report 2026-08-19).
    const prevImp = s.impBuff ?? { attack: 0, health: 0 };
    s.impBuff = {
      attack: prevImp.attack + result.playerImpBuffGain.attack,
      health: prevImp.health + result.playerImpBuffGain.health,
    };
  }
  // Right Hand Hank's Echo: grow the run's right-most Shop-slot accumulator (the same total Market Tormentor
  // feeds). The next shop roll's applyShopRefreshed re-lands it on the right-most offer.
  if (result.playerRightmostSlotBuff) {
    s.rightmostSlotBuff = {
      attack: (s.rightmostSlotBuff?.attack ?? 0) + result.playerRightmostSlotBuff.attack,
      health: (s.rightmostSlotBuff?.health ?? 0) + result.playerRightmostSlotBuff.health,
    };
  }
  // Rune of Beastial Swarm: the Avenge(2) improvement raised the per-death buff amount — persist it.
  if (result.playerBeastialSwarmLevel) s.beastialSwarmLevel = result.playerBeastialSwarmLevel;
  // Chorus Engine's Rally: its Attachment enchant is permanent and reaches them "wherever they are" — the
  // same contract Scrap Herald's Battlecry already has, so it is applied the same way rather than through a
  // second, subtly different path. Combat could only touch the UNWELDED Attachments still on the field; this
  // catches the welded hosts, the ones sitting in hand, and every future copy via the aura.
  if (result.playerMagneticBuffGain) {
    const { attack, health } = result.playerMagneticBuffGain;
    for (const card of [...s.board, ...s.hand]) {
      if (card.keywords.includes('M')) addBuff(card, 'Chorus Engine', attack, health);
    }
    s.magneticBuyAtk = (s.magneticBuyAtk ?? 0) + attack;
    s.magneticBuyHp = (s.magneticBuyHp ?? 0) + health;
  }
  // Bane (combat, via Ryme's battlecry replays): its run-wide Fodder enchant is permanent — apply it the
  // same way the recruit-phase Bane does, so every Fodder (board, hand, future copies) keeps the gain.
  if (result.playerFodderBuffGain) {
    buffFodderRunWide(s, result.playerFodderBuffGain.attack, result.playerFodderBuffGain.health, 'Bane');
  }
  // Soulsman: permanent max-Gold gained from its Avenge in combat (uncapped, like Nadja's Gold Font).
  // grantMaxGold is Soulsman-only, so playerMaxGoldGain IS Soulsman's contribution — tally it run-wide
  // for the "gained X Gold" metric shown on the card.
  if (result.playerMaxGoldGain) {
    s.maxEmbers += result.playerMaxGoldGain;
    s.soulsmanGold = (s.soulsmanGold ?? 0) + result.playerMaxGoldGain;
  }
  // Bounty Bot: one-time Gold granted into the next shop (added to the next turn's starting Gold).
  if (result.playerBonusGold) {
    s.bonusEmbersNextTurn = (s.bonusEmbersNextTurn ?? 0) + result.playerBonusGold;
  }
  // Gryphon: free shop rerolls banked from taking damage in combat.
  if (result.playerFreeRolls) {
    s.freeRolls += result.playerFreeRolls;
  }
  if (result.playerGuaranteedAttachments) {
    s.guaranteedAttachmentShops = (s.guaranteedAttachmentShops ?? 0) + result.playerGuaranteedAttachments;
  }
  // Taragosa: spells cast IN combat permanently bump the run's spellsCast — so they count toward
  // spell-count payoffs just like tavern spells. Guel's improvement is per-instance now (spells cast
  // while HE is on board), so combat casts also tick the on-board Guels' `spellProgress` — he was on
  // the board for the fight, so they count for him (parity with the old run-wide counter).
  if (result.playerSpellsCast) {
    s.spellsCast += result.playerSpellsCast;
    for (const c of s.board) {
      if (CARD_INDEX[c.cardId]?.effects.some((e) => e.do === 'spellCastBuffOthers' || e.do === 'spellCastImproveSelf')) {
        c.spellProgress = (c.spellProgress ?? 0) + result.playerSpellsCast;
      }
    }
  }
  // Discover spells cast mid-fight (Quil / Sporebat / a taught Pup): the modal can't open in combat, so the
  // cast carried back and the real pick queues here, exactly as a hand cast would have queued it.
  // A DISCOVER spell cast mid-combat grants a RANDOM pick from its pool (owner ruling 2026-08-08) — it no
  // longer opens the Discover UI at settle. The offer is still BUILT by the real `openDiscover` (same pools,
  // same tier rules, same rng stream), but the choice is rolled rather than asked, and the pick lands through
  // the exact take path a clicked Discover uses (`takeDiscoverPick`), so stat conjury and pool bookkeeping
  // can't drift from the interactive path.
  if (result.playerDiscoverCasts) {
    for (const id of result.playerDiscoverCasts) {
      const d = CARD_INDEX[id];
      const spec = d ? discoverSpecFor(s, d) : undefined;
      if (!spec) continue;
      openDiscover(s, { ...spec });
      if (s.discover && s.discover.length > 0) {
        const rng = makeRng(s.rngCursor);
        const pick = rng.int(s.discover.length);
        s.rngCursor = rng.state();
        takeDiscoverPick(s, pick);
      }
      // Clear the offer state whether or not a pick landed — nothing here may leave a modal open.
      s.discover = undefined;
      s.discoverLockTier = undefined; s.discoverLockGold = undefined; s.discoverLockWave = undefined;
      s.discoverBorrowed = undefined; s.discoverGolden = undefined; s.discoverSetStats = undefined;
    }
  }
  // Shop-buff spells cast mid-fight: a one-time buff for the NEXT shop (the `nextShopBuff` channel).
  if (result.playerNextShopBuff) {
    s.nextShopBuff ??= { attack: 0, health: 0 };
    s.nextShopBuff.attack += result.playerNextShopBuff.attack;
    s.nextShopBuff.health += result.playerNextShopBuff.health;
  }
  // Front to Back improved itself mid-fight (Quil casting it). The STATS that cast handed out were temporary
  // like any combat buff and are already gone; the SPELL keeps what it learned (owner ruling 2026-08-07), so
  // the escalation lands on the run here and the next hand cast grants the improved value.
  if (result.playerSpellEscalationGain) {
    s.frontToBackBonus += result.playerSpellEscalationGain.attack;
    s.frontToBackBonusH += result.playerSpellEscalationGain.health;
  }
  s.fxEscalationPreview = undefined; // the display preview retires — the real gain just landed above
  s.fxSpellsCastPreview = undefined; // ditto: `playerSpellsCast` was applied above
  s.fxFriendlyDeathPreview = undefined; // Cindara's live Avenge tracker retires — a new fight re-counts from 0
  s.fxBladeAttacksPreview = undefined; // Gorun's live counter retires — `bladeAttacks` already banked the real total
  // Permanent Undead attack AURA gained in combat (Karthus's on-kill, Deathswarmer re-fired by Ryme) —
  // stack into undeadBuyAtk AND apply to all current run-board Undead immediately so they benefit without
  // being re-bought. Labelled 'Undead Bond' to match the buy-time aura (the source varies, the aura is one).
  if (result.playerUndeadBuyAtkGain) {
    const gain = result.playerUndeadBuyAtkGain;
    s.undeadBuyAtk = (s.undeadBuyAtk ?? 0) + gain;
    for (const c of [...s.board, ...s.hand]) {
      if (isTribe(c, 'undead')) addBuff(c, 'Undead Bond', gain, 0);
    }
  }
  // Elderhorn refired in combat: extra BEAST trigger fires, stacked into the run exactly as its shop half does.
  if (result.playerBeastExtraGain) {
    if (result.playerBeastExtraGain.hunt) s.beastHuntExtra = (s.beastHuntExtra ?? 0) + result.playerBeastExtraGain.hunt;
    if (result.playerBeastExtraGain.ritual) s.beastRitualExtra = (s.beastRitualExtra ?? 0) + result.playerBeastExtraGain.ritual;
  }
  // Watcher's Lantern of Souls (combat): raise the run-wide Undead aura (+Attack/+Health everywhere) — the
  // same `undeadAttackBonus`/`undeadHealthBonus` channel a shop-cast Lantern uses, so it shows and behaves
  // identically on the run board.
  if (result.playerUndeadAuraGain) {
    s.undeadAttackBonus += result.playerUndeadAuraGain.attack;
    s.undeadHealthBonus += result.playerUndeadAuraGain.health;
  }
  // ── Quests: combat-phase objectives + combat-armed reward carry-backs ─────────────────────────────────
  // Advance combat objectives (attack / summonCombat / slaughter / deathrattle) from this fight's tally, +N,
  // tribe-narrowed. Completing here applies the reward straight into the post-combat state (grants → hand).
  const handBeforeQuests = s.hand.length;
  advanceCombatQuests(s, result);
  // A combat-completed quest may have granted a card to hand — if so, check for a triple (your 3rd copy → golden).
  if (s.hand.length > handBeforeQuests) checkTriples(s);
  // Decoy Sigil / Weaken were spent on the fight that just resolved — clear the banks.
  s.pendingDecoys = undefined;
  s.pendingWeaken = undefined;
  // Rune of Slaying (owner change 2026-07-31, second pass): kills BANK across combats — every 6th pays a
  // minion of the board's dominant type into hand (the same resolver Reinforcing Ale uses). Replaces the
  // max-Gold-per-Slaughter shape entirely; the leftover progress carries in `runeSlayingKills`.
  // RUNE OF ASHEN PAYROLL: 3 Imps summoned in a fight pays 4 Gold into next turn's opening, ONCE per combat
  // however far past the threshold the fight went ("Once per combat" is printed on the rune). Settled here off
  // the carried Imp tally rather than inside the sim, the same shape Rune of Slaying uses just below.
  // RUNE OF LIVING GROWTH, the combat half (owner ruling 2026-08-07: combat counts too). Every Growth a
  // MUSHY created during the fight ticks the improver at settle — read off the `toHand` events, whose
  // `source` is the granting body's uid, resolved against the starting board plus mid-fight summons so a
  // resummoned Mushy counts. Its shop grants tick live in the grant factories; this is the missing half.
  if (s.runeLivingGrowth) {
    const bodies = new Map<string, string>();
    for (const m of result.initial.player) bodies.set(m.uid, m.cardId);
    for (const e of result.events) if (e.type === 'summon' && e.side === 'player') bodies.set(e.minion.uid, e.minion.cardId);
    const grown = result.events.filter((e) =>
      e.type === 'toHand' && e.side === 'player' && e.cardId === 'growth'
      && e.source && bodies.get(e.source) === 'd2_scalefeather').length;
    // +1 per Growth per copy held (recurring family, owner 2026-08-27).
    if (grown > 0) { procRuneId(s, 'rune_living_growth'); s.growthBonus = (s.growthBonus ?? 0) + grown * runeStacksOf(s, 'rune_living_growth'); }
  }
  // Rune of Ashen Payroll (owner 2026-08-11): 1 Gold next turn for EACH Imp summoned in combat — no threshold,
  // no once-per-combat cap. The armed flag just needs to be truthy.
  if (s.questFlags?.runeAshenPayroll) {
    procRune(s, 'runeAshenPayroll');
    s.bonusEmbersNextTurn = (s.bonusEmbersNextTurn ?? 0) + (result.playerImpsSummoned ?? 0);
  }
  // ── HERO TALLIES (owner batch 2026-08-23). Accumulated UNCONDITIONALLY, not gated on wielding the power.
  // A run can adopt Tempest or Blade Mastery mid-run through Mimic / Void / Power Shifter, and a tally that
  // only started on adoption would open at zero — printing a threshold the player had in fact already passed,
  // and (for Mimic, which re-picks every turn) resetting whenever they wielded something else for a round.
  // Counting always is both cheaper and the only version that reads honestly.
  if (result.playerQuestTally?.slaughter) s.tempestKills = (s.tempestKills ?? 0) + result.playerQuestTally.slaughter;
  if (result.playerQuestTally?.attack) s.bladeAttacks = (s.bladeAttacks ?? 0) + result.playerQuestTally.attack;
  if (result.playerHoardGain) {
    // REPLACED, not mutated — the same reference-identity rule `impBuff` documents above: the live-text memos
    // key on this object, so an in-place bump would never reach the printed Whelp stats.
    const prev = s.hoardWhelpBuff ?? { attack: 0, health: 0 };
    s.hoardWhelpBuff = {
      attack: prev.attack + result.playerHoardGain.attack,
      health: prev.health + result.playerHoardGain.health,
    };
  }
  if (s.questFlags?.runeSlaying && result.playerQuestTally?.slaughter) {
    s.runeSlayingKills = (s.runeSlayingKills ?? 0) + result.playerQuestTally.slaughter;
    while (s.runeSlayingKills >= 6) {
      procRune(s, 'runeSlaying'); // one per payout — 12 kills is two fires, and banking below 6 is none
      s.runeSlayingKills -= 6;
      grantTopTypeMinion(s);
    }
  }
  // The Old Hunt: the Beast Attack aura pumped this combat is permanent — fold it into the run + apply to
  // current run-board/hand Beasts (so they keep the gain without re-buying).
  // The Old Hunt (Attack) + Pack Mentality (Attack + Health) both grow the run-wide Beast aura live in combat;
  // fold their carried-back gain into `beastBuyAtk`/`beastBuyHp` + every current run-board Beast.
  if (result.playerBeastBuyAtkGain || result.playerBeastBuyHpGain) {
    grantTribeAura(s, 'beast', result.playerBeastBuyAtkGain ?? 0, result.playerBeastBuyHpGain ?? 0, result.playerBeastBuyHpGain ? 'Pack Mentality' : 'The Old Hunt');
  }
  // Pack Mentality: grow any scaling tribe auras by this combat's tally of their trigger event.
  growScalingAuras(s, result);
  // (Random spell/minion grants — Sporebat, Ryme re-firing Sea Urchin / Black Belt Brian — are now picked in
  //  combat and added above via playerHandGrants, so the real card animates in. No separate settle pick.)
  // Cassen's Collision: bank this combat's enemy kills; every 5 grants a minion of the board's most
  // common tribe (then spends 5). A failed grant (full hand / no tribe) keeps the kills banked for later.
  // Flash: the copy itself was granted INSIDE the fight (via `playerHandGrants`, so it flew to hand as it was
  // earned — owner ask 2026-08-17: real-time, not at resolution). Settle only spends the claim, and spends it
  // whether or not a body was available, so a fight with no kills cannot bank it for a later one.
  if (s.flashPick && hasPower(s, 'firstOrLast')) s.flashPick = undefined;
  if (hasPower(s, 'collision')) {
    s.cassenKills += result.enemyDeaths;
    while (s.cassenKills >= 5) {
      if (!grantTopTypeMinion(s)) break;
      s.cassenKills -= 5;
    }
  }
  // LOBBY / TUTORIAL: the seat already took this hit (with the lobby's own cap and stall pressure) and the run
  // was synced to it above, so applying it again here charges the player twice — visible as the HUD reading 2
  // lower than the table for the same fight. A tutorial carries a lobby too, so it is excluded for the same reason.
  if (result.result === 'lose' && s.mode !== 'practice' && s.mode !== 'lobby' && s.mode !== 'tutorial') {
    // Armor absorbs the hit first (extra effective HP), the overflow chips Resolve. Practice: unlimited health.
    const absorbed = Math.min(s.armor, result.playerDamage);
    s.armor -= absorbed;
    s.resolve = Math.max(0, s.resolve - (result.playerDamage - absorbed));
  }
  // LOBBY-FAMILY (lobby / tutorial / practice on `normal` health): the SEAT owns health, and the table settles
  // later — at `resolveCombat` — so the eliminations, every seat's new health and your next opponent appear
  // together when you choose to leave the fight. That grouping is deliberate, but it also left YOUR OWN number
  // frozen at its pre-combat value all the way back to the shop (owner report 2026-08-25: the health number
  // doesn't change until returning to shop). Apply the player's own hit HERE, the moment the replay settles,
  // via the same shared `playerLossDamage` the loss counter animates and the same armor-first order the seat's
  // `hit()` uses — so when `settleLobbyRound` later syncs `s.resolve = me.resolve` it lands on the identical
  // number: nothing jumps, and nothing is charged twice (the seat damages its own pools from the same inputs).
  //
  // PRACTICE INVULNERABILITY is excluded on purpose: there `settleLobbyRound` restores the seat FROM the run
  // (`me.resolve = s.resolve`), so damaging the run here would leak into the seat and undo the invulnerability.
  if (s.lobby && !(s.mode === 'practice' && s.practiceConfig?.health !== 'normal')) {
    const seatDmg = playerLossDamage(s.lobby, result);
    if (seatDmg > 0) {
      const fromArmor = Math.min(s.armor, seatDmg);
      s.armor -= fromArmor;
      s.resolve = Math.max(0, s.resolve - (seatDmg - fromArmor));
    }
  }
  // Maw of the Pit's one-combat Divine Shield is spent — strip the temp DS so it doesn't carry to the
  // next fight (consuming again re-arms it). Same for Lord of the Risen's one-combat Rise (temp R).
  for (const c of s.board) {
    if (c.tempShield) {
      c.keywords = c.keywords.filter((k) => k !== 'DS');
      c.tempShield = false;
    }
    if (c.tempReborn) {
      c.keywords = c.keywords.filter((k) => k !== 'R');
      c.tempReborn = false;
    }
    // Bloodlust is a one-combat mark — spent by the fight that just resolved (both the immune swing and its
    // welded Rally).
    if (c.bloodlust) c.bloodlust = false;
    if (c.bloodlustRally) c.bloodlustRally = false;
    // Parting Cry / Closed Casket are ONE-COMBAT marks too — spent by the fight they were bought for, whether
    // or not the body actually died in it.
    if (c.partingCry) c.partingCry = false;
    if (c.closedCasket) c.closedCasket = false;
  }
  // The side-wide one-combat spell banks are spent the same way (Solid Ground's remaining charges included —
  // an unspent charge does not roll into the next fight).
  s.solidGroundLeft = undefined;
  s.solidGroundStat = undefined;
  s.containFirstEnemySummon = undefined;
  s.stolenInitiative = undefined;
  // Pre-emptive Assault + Rallying Offensive are spent — each override covers exactly one fight.
  s.attackFirstNext = false;
  s.rallyDoubleNext = false;
  s.combatSettled = true;
}

/** Advance past a settled combat: the terminal check (gameover / victory), else roll the next wave. */
function advanceCombat(s: RunState): void {
  // Practice runs the SAME fixed course as Ascent (`courseRounds`), so the HUD reads identically — it just
  // can't be lost (health is unlimited, so the resolve<=0 check never fires) and settles into a practice
  // summary instead of a scored victory. Ends when the course is done, regardless of W/L.
  // Both practice end-caps below are ONLY for the invulnerable case (`health` unlimited): a player who cannot die
  // needs a run length. With `health: 'normal'` the run ends by real elimination / the lobby finishing, so skip
  // them and let it run the full lobby (owner ask 2026-08-24).
  const practiceInvulnerable = s.mode === 'practice' && s.practiceConfig?.health !== 'normal';
  // The invulnerable player never earns an elimination placement (and the identical-board bots stalemate), so
  // stamp a WIN-BASED placement onto their seat as the run ends — else the end screen falls back to "alive
  // count" and a dominant run reads as dead-last (owner bug 2026-08-24).
  const endPractice = (): void => {
    s.phase = 'gameover';
    if (s.lobby) s.lobby.seats[0]!.placement = practicePlayerPlacement(s.lobby);
  };
  if (practiceInvulnerable && s.wave >= CONFIG.courseRounds) {
    endPractice();
    return;
  }
  // PRACTICE-lobby curtain: the player can't die (invulnerable), so the run ends after round 15 unless the
  // lobby already finished (every bot dead = the practice "win", handled by the lobby check below).
  if (practiceInvulnerable && s.lobby && !s.lobby.finished && s.wave >= 15) {
    endPractice();
    return;
  }
  // A lobby seat's Resolve is the LOBBY's to manage; the run's own copy is bookkeeping and must not end it.
  // The run ends when the PLAYER'S SEAT is knocked out, whatever the lobby does afterwards.
  if (s.lobby) {
    if (playerEliminated(s.lobby) || s.lobby.finished) {
      s.phase = 'gameover';
      // An invulnerable practice run that ends here (its bot table actually resolved) still needs the win-based
      // placement rather than the just-cleared seat placement.
      if (practiceInvulnerable) s.lobby.seats[0]!.placement = practicePlayerPlacement(s.lobby);
      return;
    }
  } else if (s.resolve <= 0) {
    s.phase = 'gameover';
    return;
  }

  // Course complete (A1): a run plays a fixed course of `courseRounds` rounds; survive them all and the
  // run is done — the record IS the score, whatever it is. The just-fought round's result is already in
  // history. The only early exit is Resolve 0 (handled above); you never "win early" by a win count.
  // A LOBBY seat has no course clock: the lobby ends by elimination, with no fixed round count, so the seat
  // must keep shopping and scaling for as long as the lobby lasts. Without this a bot seat froze at wave 17
  // and every late round was fought with a stale board — the exact pacing failure the prototype measured.
  // Tutorial is excluded alongside lobby/practice: it carries a lobby and ends by the lobby's round cap (above),
  // never by the 17-round course clock.
  if (s.mode !== 'practice' && s.mode !== 'lobby' && s.mode !== 'tutorial' && s.wave >= CONFIG.courseRounds) {
    s.phase = 'victory';
    return;
  }

  // Advance to the next wave (handoff A.1 step 5).
  s.wave += 1;
  // Grow toward the cap (10) but never DROP maxEmbers — so Nadja / Mana Font bonuses that pushed it
  // past the cap persist instead of being clamped away each wave.
  s.maxEmbers = Math.max(s.maxEmbers, Math.min(CONFIG.embersCap, s.maxEmbers + CONFIG.embersPerWave));
  // Money Bot & co. raise the effective max above the base curve while on the board — added on
  // top of the cap (a deliberate economy card), recomputed each turn so selling it removes it.
  // Hoarder's Battlecry banks bonus Gold for this turn (consumed now).
  s.embers = s.maxEmbers + (s.maxGoldBonus ?? 0) + boardManaBonus(s) + (s.bonusEmbersNextTurn ?? 0);
  s.bonusEmbersNextTurn = 0;
  s.heroReady = true;
  s.heroReady2 = true; // Void's second power recharges on the same clock
  s.heroUsesThisTurn = 0; // Fibbsy's twice-per-turn budget refills
  // Tutorial: a scripted shop reads roll 0 (the turn-start offer) each new wave. Reset before the wave's shop
  // rolls so the first roll of the turn serves the authored initial offer, refreshes then advancing 1, 2, …
  if (s.tutorialShopScript) s.tutorialShopRoll = 0;
  // Cassen: a commission that has come due pays out as this shop opens. Checked AFTER the wave bump, so
  // `dueWave` names the turn the reward actually lands on.
  if (s.commission && s.wave >= s.commission.dueWave) payCommission(s, s.commission);
  // Pin the opponent match to the board you START the turn with, so it won't shift as you shop today.
  s.turnStartPower = s.board.reduce((sum, b) => sum + b.attack + b.health, 0);
  // PER-TURN-RESET BEGIN — Doc Bot's carry-over scan (docbot/carryOverScan.ts) parses the `s.<field> = …`
  // assignments between these markers to derive its subject list: every field cleared here is per-turn state
  // whose unspent value could carry meaning into the combat that just resolved (the War Drum bug class,
  // owner ruling 2026-08-26). Keep per-turn field clears INSIDE the markers; move a clear out only with a
  // scan-registry update.
  s.spellsThisTurn = 0; // Spirit Worgen's per-turn spell scaling resets each wave
  s.echoFirstUsedThisTurn = false; // Grave Contract's first-SHOP-Echo bonus re-arms each turn (see state.ts)
  // Set 2 — the per-minion "spells cast on this" counter is per TURN too (Mirrorwing / Runefire read "first
  // spell each turn"), so it clears with the rest. Cleared on hand cards as well: a minion can be bounced back
  // to hand and replayed, and a stale count would eat its first proc next turn.
  for (const c of [...s.board, ...s.hand]) {
    if (c.spellsOnThisTurn) c.spellsOnThisTurn = 0;
    if (c.rubiesOnThisTurn) c.rubiesOnThisTurn = 0; // Runefire counts Rubies landed on it per TURN too
    // The per-instance "spells since placed" counter (Spellkeeper Drake, Ashscribe Whelp) is per-turn too
    // — clear both halves.
    if (c.boardSpellCount) c.boardSpellCount = 0;
    if (c.soldSeen) c.soldSeen = 0; // Voicekeeper: "each turn" — its per-instance sold counter resets
    if (c.teachTick) c.teachTick = 0; // Moonhowl Mentor: its per-instance teach latch re-arms
    if (c.boardFirstSpellId) c.boardFirstSpellId = undefined;
  }
  s.playedThisTurn = []; // Pack Leader / Spirit Worgen: minions-played-this-turn resets each turn
  s.soldThisTurn = []; // Voicekeeper: minions-sold-this-turn resets each turn (symmetric with the above)
  s.moonhowlTeachesThisTurn = 0; // Moonhowl Mentor's per-turn teach cap resets (its Pups mint on the buy itself)
  s.goldSpentThisTurn = 0; // Patch Job's per-turn Gold-spent scaling resets each wave
  s.alesCastThisTurn = 0; // Chef Gary Toast's per-turn Ale tally resets each wave (Bucky read it at faceOmen)
  s.summonTauntsNextCombat = undefined; // Summoning Bulwark is for the NEXT combat only — spent or not, it lapses
  s.tavernBuyBonusTurn = undefined; // Merchant's Chorus: the THIS-TURN shop buff does not carry across the rollover
  for (const c of s.board) if (c.bredThisTurn) c.bredThisTurn = 0; // Brood Matron's shop breed cap resets per turn (owner ruling 2026-08-26)
  s.runeWarDrumUsedThisTurn = undefined; // Rune of the War Drum: its one charge comes back each turn
  // Batch-4 per-turn gates (Shared Pour / Aftermarket / Hoardcalling all read "the first … each turn").
  s.sharedPourUsedThisTurn = undefined;
  s.aftermarketUsedThisTurn = undefined;
  s.hoardcallingUsedThisTurn = undefined;
  // Aug-11 economy runes' per-turn latches.
  s.windowShopRolls = 0;
  s.restockUsedThisTurn = false;
  s.bargainBinUsedThisTurn = false;
  s.collectorUsedThisTurn = false;
  s.tradeInTribe = undefined;
  s.typesBoughtThisTurn = [];
  s.consumeDoubleUsedThisTurn = false; // Bottomless Banquet re-arms each turn
  s.spellMultMark = 0; // Orivax: a new turn re-arms at the turn's first spell
  for (const t of s.runeThresholds ?? []) t.usedThisTurn = false; // oncePerTurn threshold runes re-arm
  if (s.runeOpenMarket) s.runeOpenMarket.usedThisTurn = false; // the Open Market re-arms each turn
  s.cardsBoughtThisTurn = 0; // Frenzied Excavator's per-turn cards-bought scaling resets each wave
  if (s.nextSellBonus) s.nextSellBonus = 0; // Quick Sale is a THIS-TURN bonus — expires unused at turn end
  // Funeral on Loan (owner 2026-07-31): the loan lasts ONE turn. A borrowed card that wasn't played stays in
  // hand (owner 2026-07-29 — it used to be discarded outright), and at the next turn the `borrowed` flag
  // clears: the die-on-play deal only applies the turn you Discovered it. From here on it plays as a perfectly
  // normal minion.
  for (const c of s.hand) if (c.borrowed) c.borrowed = undefined;
  s.pendingSummonBuff = undefined; // Wolvie's one-shot next-summon buff never carries past its shop turn
  if (s.scoutedNextOpponent) s.scoutedNextOpponent = undefined; // Farseer's Report: the scout is for one opponent — clear it as a new one is drawn
  for (const c of s.board) c.rubyRecvTick = 0; // Ruby Broker's per-turn Gold cap resets each wave
  s.attachmentsThisTurn = 0; // Tempering/Replication's "first Attachment each turn" gate resets each wave
  s.shoutsThisTurn = 0; // Rune of Refrain's Shout counter resets each wave
  s.firstShoutUid = undefined;
  s.consumesThisTurn = 0; // Endless Appetite's "first Consume each turn" gate resets each wave
  s.firstSpellThisTurnId = undefined; // Rune of Recurrence's first-spell record resets each wave
  s.lastSpellThisTurnId = undefined; // Recaller's last-spell-this-turn record resets each wave
  s.rememberedThisTurn = false; // Runesnout Archivist may record one entry again next turn
  s.spellhideUsedThisTurn = false;  // Rune of Spellhide records one spell per turn
  s.spellmarketUsedThisTurn = false; // Rune of the Spellmarket feeds the Shop once per turn
  s.lastWordUsedThisTurn = false;    // Rune of the Last Word triggers one sold Dragon's Shout per turn
  s.banquetUsedThisTurn = false;     // Rune of the Banquet Hall feeds the board off one buy per turn
  s.spellhidePending = [];           // …and the recorded re-casts are spent by the combat that just began
  s.contrabandRubyUsed = undefined; // Rune of Contraband's two first-each-turn latches
  s.contrabandAleUsed = undefined;
  s.gemscriptSpellUsed = undefined; // Rune of Gemscript's two first-each-turn latches
  s.gemscriptRubyUsed = undefined;
  if (s.runeSpellEcho) s.runeSpellEcho = { ...s.runeSpellEcho, used: 0 }; // Living Magic / Perfect Recall refill
  // Set 2 — Living Grimoire RE-ARMS at the start of each turn, which is what makes its printed rule ("the
  // first spell you cast EACH TURN casts twice") true. It used to arm only on play and via the 3-Shout reset,
  // so on any later turn where you hadn't triggered 3 Shouts the card silently did nothing — the owner read
  // that as "it only works on targeted spells" (2026-07-24), since the turn it was played happened to be a
  // targeted cast. The 3-Shout reset still exists for a SECOND charge within the same turn.
  // Re-armed to the strongest Grimoire on board (golden = 3) so two copies don't compound; selling them all
  // leaves nothing to arm.
  {
    const grimoires = s.board.filter((c) => CARD_INDEX[c.cardId]?.effects.some((e) => e.do === 'battlecryArmGrimoire'));
    if (grimoires.length) {
      s.grimoireMult = Math.max(...grimoires.map((c) => (c.golden ? 3 : 2)));
      for (const c of grimoires) c.shoutTick = 0; // a fresh turn's charge restarts the Shout count
    }
  }
  s.extraEotThisTurn = false; // Chrono Staff's one-shot End-of-Turn extra is per-turn
  s.shoutFirstUsedThisTurn = false; // Warm Embers' "first Shout each round triggers twice" freebie resets each turn
  // GIFTS — the turn-scoped channels (Demand an Encore, Arcane Clearance, Friends and Family) all expire here.
  s.shoutExtraTurn = 0;
  s.spellCostOffTurn = 0;
  s.minionCostOffTurn = 0;
  s.dupeUsedThisTurn = false; // Dupes: the first-buy copy is a per-turn freebie
  s.gorrBuys = undefined; // Gorr: the per-turn minion-buy tally resets
  s.freeBuyUsedThisTurn = false; // Freedom rift: the first minion each turn is free again
  s.spellFirstUsedThisTurn = false; // Spell Thesis: "first spell each turn casts twice" resets each turn
  // Ruby per-turn gates. NEITHER was reset before 2026-08-06 (owner report on Resonance): "first Ruby each
  // turn casts extra" fired once per RUN, and Gemscript's first-Ruby spell-power bump did the same.
  // Chef Gary Toast: clear each Chef's per-turn grant tally. NOT banked into a second field — the combat that
  // just finished already read the live figure when it was built, and banking here is precisely what made the
  // payout arrive a turn late (owner report 2026-08-07).
  for (const c of s.board) if (c.chefGranted) c.chefGranted = 0;
  s.rubyCastsThisTurn = 0;
  s.gemscriptRubyUsed = false;
  // Rune of the Treasure Map: tick the countdown at each new shop; pay out and retire at zero.
  if (s.runeTreasureMap) {
    const tm = { ...s.runeTreasureMap, turns: s.runeTreasureMap.turns - 1 };
    if (tm.turns <= 0) {
      procRune(s, 'runeTreasureMap'); // the countdown REACHED zero — ticking down is not a fire
      gainGold(s, tm.gold);
      s.runeTreasureMap = undefined;
    } else {
      s.runeTreasureMap = tm;
    }
  }
  // The ARRAY variant (every purchase since the 2026-08-27 duplicate rulings) — each entry ticks and pays
  // independently, so a duplicate Map is a real second payout on its own schedule.
  if (s.runeTreasureMaps?.length) {
    const still: { turns: number; gold: number }[] = [];
    for (const tm of s.runeTreasureMaps) {
      if (tm.turns - 1 <= 0) {
        procRune(s, 'runeTreasureMap');
        gainGold(s, tm.gold);
      } else {
        still.push({ turns: tm.turns - 1, gold: tm.gold });
      }
    }
    s.runeTreasureMaps = still.length > 0 ? still : undefined;
  }
  s.fodderConsumedThisTurn = { attack: 0, health: 0 }; // Abhorrent Horror's SoC window resets each wave
  // PER-TURN-RESET END — see the BEGIN marker above (Doc Bot carry-over scan boundary).
  for (const c of s.board) {
    c.resummon = false; // The Reclaimer's mark is a per-turn choice
  }
  if (s.tier < maxTierFor(s.rift)) {
    s.upgradeCost = Math.max(CONFIG.upgradeCostFloor, s.upgradeCost - CONFIG.upgradeDiscountPerWave);
  }
  const previous = s.threat;
  s.threat = selectThreat(s.wave, makeRng(mixSeed(s.seed, s.wave, TAG.THREAT)), previous);

  // A frozen tavern carries over, but still tops up any empty minion slots / missing spell
  // (freezing a partial shop shouldn't leave you with fewer options); otherwise full reroll.
  // Either way, queued Fodder (Soulfeeder) still gets injected — freezing must not strand the
  // promised Fodder in `pendingTavern` forever.
  // Quest-turns (waves 5 & 11 — consolidated from the old 4/8/12): open the quest shop. The tavern still ROLLS
  // this turn — deferred to just after `checkTriples` below (the same rngCursor point the old post-`buyQuest` roll
  // used, so runs stay byte-identical) — so the shop sits behind the quest overlay and the pick is shop-informed.
  // An empty offer (no content, or quests disabled) falls through to a normal turn — a content gap never soft-locks.
  // The "quest phase" is just "questOffer is set" (no new phase enum); the modal guard locks every action but
  // buyQuest until it resolves. Fi's Errand (bonus Lesser offer on turn 3) and Coran's Pathfinder (turn-11 bucket on
  // turn 7, no turn-5 quest) are folded into `questOfferPlan`.
  // TUTORIAL: quests and the Runeforge are DISABLED until the course teaches them (blueprint §6.4) — they must
  // never pop over a coached step and hijack the turn.
  const questPlan = s.mode === 'tutorial' ? null : questOfferPlan(s);
  const questOffer = questPlan ? generateQuestOffer(s, questPlan) : [];
  // Runesmith: the Runeforge opens exactly once, on turn 5 — offer a random 3 of the runes for the player to buy
  // ONE. Like the quest shop, the tavern is rolled behind the overlay so the shop is ready once the forge closes.
  // The HERO forge is turn 5 — deliberately EARLIER than the universal system's turn-6 basic forge, so a
  // Runesmith is ahead of the curve rather than redundant with it (owner 2026-07-31).
  const forge = s.mode !== 'tutorial' && hasPower(s, 'runeforge') && s.wave === 5 && !s.heroPowerSpent;
  if (forge) {
    s.runeforgeEpic = undefined; // basic forge — set before runeforgePool so it reads the normal set
    s.runeforgeRerolled = undefined;
    const forgeRng = makeRng(mixSeed(s.seed, s.wave, TAG.QUEST));
    const drawn = drawRuneOffer(s, forgeRng);
    s.runeforgeOffer = drawn.offer;
    s.runeforgeDiscounts = drawn.discounts;
    applyHeroForgeDiscount(s, forgeRng);
  } else if (s.mode === 'tutorial' && s.tutorialRuneScript?.[s.wave] && !s.tutorialRuneScript[s.wave]!.epic) {
    // TUTORIAL: the course's own scripted BASIC forge (round 6). Queued like every other start-of-turn modal
    // so it sequences behind whatever else the round opens, rather than racing it.
    s.pendingBasicForge = { deferred: false };
  } else if (s.mode !== 'tutorial' && (CONFIG.runeforgeEnabled || s.rift === 'runic') && s.wave === 6) {
    // Universal basic Runeforge on turn 6 — driven by EITHER the runeforge system (CONFIG.runeforgeEnabled) or
    // the "Runic Behavior" rift. Either way it opens exactly ONE free (no hero-power charge) forge, queued so it
    // slots into the normal start-of-turn modal priority (behind any quest offer, via openNextStartOfTurnModal).
    // Turn 6 has no quest, so it opens directly. (Runesmith still gets its own turn-7 forge on top — this is an
    // extra visit, not a replacement.)
    s.pendingBasicForge = { deferred: false };
  }
  if (s.mode === 'tutorial' && s.tutorialShopScript) {
    // The scripted shop ALWAYS wins on a new tutorial turn: a frozen tavern would otherwise carry the last
    // round's offers (topped up from the pool), and the round's lesson would never see the card it needs. The
    // freeze lesson stays coherent by re-scripting the kept card into the next round's offers. Clear the freeze
    // so the fresh scripted roll takes — `refreshTavern` → `rollShop` serves `tutorialShopScript`.
    s.frozen = false;
    refreshTavern(s, true);
  } else if (questOffer.length > 0) {
    s.questOffer = questOffer;
  } else if (s.frozen) {
    topUpTavern(s);
    injectPendingTavern(s, true); // defer the eat — a Runeforge / queued modal may be about to open (see holdFodderConsume)
    s.frozen = false;
  } else {
    refreshTavern(s, true);
    // A NEW TURN's shop is a fresh roll too — the most common one. Firing the event only on the manual reroll
    // meant Market Tormentor never touched the turn-start row (owner report 2026-07-25). A FROZEN shop is
    // deliberately excluded above: it wasn't re-rolled, so there's no new right-most to buff.
    applyShopRefreshed(s);
  }
  // Start-of-turn modals resolve ONE AT A TIME, in priority order (Quest > Runeforge > Discover/other). A quest
  // offer or the Runesmith forge (set above) shows first; the Epic Runeforge + any queued Discovers wait their
  // turn and open as each higher modal closes (see openNextStartOfTurnModal, called from every modal-close path).
  s.phase = 'recruit';
  // Rune of the Epic Forge: it armed the Epic Runeforge for THIS wave — turn it into a pending open, which the
  // start-of-turn sequencing below presents (behind any quest offer / Runesmith forge). Never in a tutorial.
  if (s.mode !== 'tutorial' && s.epicForgeWave != null && s.wave >= s.epicForgeWave) { s.pendingEpicRuneforge = true; s.epicForgeWave = undefined; }
  // Runeforge system: EVERY hero visits the Epic Runeforge on turn 9 (free — openEpicRuneforge flags it
  // no-charge). Independent of Runeguard's own epic forge on turn 8, which its power schedules separately.
  // The tutorial teaches runes in its own scripted way (or defers them), so it never auto-opens the forge.
  // The standing turn-9 Epic Runeforge — UNLESS the run already claimed its Epic forge early. Rune of the
  // Ornate Clock reads "next turn INSTEAD OF turn 9", so without this guard the player got BOTH (owner report
  // 2026-08-26): the rune opened its forge next turn and this line opened a second one on turn 9.
  if (s.mode !== 'tutorial' && CONFIG.runeforgeEnabled && s.wave === 9 && !s.epicForgeClaimed) s.pendingEpicRuneforge = true;
  // TUTORIAL: the course's own scripted EPIC forge (round 9).
  if (s.mode === 'tutorial' && s.tutorialRuneScript?.[s.wave]?.epic) s.pendingEpicRuneforge = true;
  // Promote any forge armed mid-turn (deferred): now that we're at the START of the next turn, it's openable.
  s.pendingForgeDeferred = false;
  if (s.pendingBasicForge) s.pendingBasicForge.deferred = false;
  // Bloodbinder: its Rally alternates the stat it gives Fodder — flip each board Bloodbinder every turn
  // (undefined/'atk' ↔ 'hp'), so this turn's combat reads the freshly-swapped stat.
  for (const c of s.board) if (c.cardId === 'bloodbinder') c.bloodbinderMode = c.bloodbinderMode === 'hp' ? 'atk' : 'hp';
  // MIMIC: a fresh power Discover at the start of EVERY turn (owner spec 2026-08-22); the previous turn's
  // disguise stays wielded until the pick lands, so the run is never power-less mid-modal. VOID: the one-time
  // turn-4 double ceremony. Both are QUEUED rather than opened, so a quest offer on the same turn keeps its
  // place at the front (the sequencer opens the power pick right behind it).
  if (s.mode !== 'tutorial') {
    const nativeKind = getHero(s.heroId).power.kind;
    if (nativeKind === 'mimic') s.pendingPowerOffer = { slot: 'mimic' };
    if (nativeKind === 'voidTwin' && s.wave === 4 && !s.voidPowerIds?.length) s.pendingPowerOffer = { slot: 'void1' };
  }
  openNextStartOfTurnModal(s);
  // Rune of the Long Shift (owner 2026-08-11): Discover 2 Shop spells at the start of each turn. Queued AFTER
  // the start-of-turn modal so any quest offer / forge takes priority and the two Discovers stack behind it.
  // These are shop-phase Discovers, so the window opens normally (the no-window rule is END-of-turn only).
  if (s.runeLongShift) { procRuneId(s, 'rune_long_shift'); queueDiscover(s, { kind: 'spell' }); queueDiscover(s, { kind: 'spell' }); }
  // GIFTS (owner design 2026-08-26). Merry Christmas offers a Gift every Start of Turn; Happy Birthday hands
  // one over every SECOND turn (its tick counts the waves between payouts). Both queue behind the start-of-turn
  // modal like the Long Shift, so a quest offer or forge still takes priority.
  if (s.runeMerryChristmas) { procRuneId(s, 'rune_merry_christmas'); queueDiscover(s, { kind: 'pool', ids: [...GIFT_IDS] }); }
  if (s.runeHappyBirthday) {
    s.giftBirthdayTick = (s.giftBirthdayTick ?? 0) + 1;
    // Same 2-turn cadence, one Gift per copy held (recurring family, owner 2026-08-27).
    if (s.giftBirthdayTick >= 2) { s.giftBirthdayTick = 0; procRuneId(s, 'rune_happy_birthday'); for (let k = 0; k < runeStacksOf(s, 'rune_happy_birthday'); k++) grantRandomGift(s); }
  }
  // GIFT — Royal Allowance: once cast, a Gold Pouch every Start of Turn for the rest of the run.
  if (s.giftAllowance) {
    const pouch = CARD_INDEX['emberpouch'];
    if (pouch) conjureToHand(s, [pouch], 1);
  }
  // Gravetwin: if it survived the last combat, fire its copied Echo now (start of the shop). Then clear the
  // survivor list so it fires exactly once per fight.
  fireGravetwinEchoes(s);
  s.lastSurvivorCardIds = undefined;
  // Chaos hero power: at the START of every 5th turn, add a Chaos Attachment token to the hand
  // (the checkTriples below also combines it if it completes a triple). The hero starts with one token
  // (createRun); this is the recurring grant — turns 5, 10, 15, …
  if (hasPower(s, 'chaos') && s.wave % 5 === 0) {
    const def = CARD_INDEX['symbioticattachment'];
    if (def && s.hand.length < handCap(s)) {
      const grantUid = `b${s.uidSeq++}`;
      // Same instantiation as settleCombat's hand grants: the run's per-card enchant + the tribe-gated
      // Undead buy bonus (the old inline version applied undeadBuyAtk raw, tribe-unchecked, and skipped
      // the card enchant).
      const cb = cardBuff(s, 'symbioticattachment');
      s.hand.push({
        uid: grantUid,
        cardId: 'symbioticattachment',
        tribe: def.tribe,
        ...conjuredStats(s, def, cb),
        keywords: [...def.keywords],
        golden: false,
      });
      // Signal the UI to fly the new token in from the hero portrait (one-shot, like fodderEatenSeq).
      s.chaosGrantSeq = (s.chaosGrantSeq ?? 0) + 1;
      s.chaosGrantUid = grantUid;
    }
  }
  // Gildmaster: get a Goldcrafter (a spell that makes a friendly minion golden) at the START of every 4th
  // turn — turns 4, 8, 12, …. Conjured to hand (hand-cap-safe); a granted spell can't complete a triple.
  if (hasPower(s, 'recurringGoldcrafter') && s.wave % 4 === 0) {
    conjureToHand(s, CARD_INDEX['goldcrafter'] ? [CARD_INDEX['goldcrafter']!] : [], 1);
  }
  // KINDNESS — Great Presence (owner design 2026-08-26): Discover a Gift at the start of every 4th turn
  // (4, 8, 12, …), the same cadence Gildmaster's grant uses. Queued like the other start-of-turn Discovers,
  // so a quest offer or forge still takes priority.
  if (hasPower(s, 'greatPresence') && s.wave % 4 === 0) {
    queueDiscover(s, { kind: 'pool', ids: [...GIFT_IDS] });
  }
  // Quest delayed rewards (Trail Rations' "repeat in 2 turns"): tick each pending grant down a turn and
  // re-apply the ones that come due — WITHOUT re-scheduling (allowRepeat=false) — here with the other
  // shop-open hand grants (Chaos above), so a granted copy can still complete a triple below.
  if (s.pendingQuestRewards?.length) {
    const remaining: { questId: string; turnsLeft: number }[] = [];
    for (const p of s.pendingQuestRewards) {
      if (p.turnsLeft - 1 <= 0) {
        // Resolve the scheduling def — a quest OR a rune (Rune of the Gilded Spark's "get another in 2 turns").
        const d = QUEST_INDEX[p.questId] ?? (RUNE_INDEX[p.questId] as unknown as QuestDef | undefined);
        if (d) applyQuestReward(s, d, false);
      } else {
        remaining.push({ questId: p.questId, turnsLeft: p.turnsLeft - 1 });
      }
    }
    s.pendingQuestRewards = remaining;
  }
  // Feed the Alpha: the recurring end-of-turn grant — conjure each armed card to hand every turn setup for the
  // rest of the run (one Feed the Alpha spell per turn). Hand-cap-safe (conjureToHand no-ops on a full hand).
  if (s.questRecurringGrants?.length) {
    for (const id of s.questRecurringGrants) {
      conjureToHand(s, CARD_INDEX[id] ? [CARD_INDEX[id]!] : [], 1);
      if (id === 'hoardflame') procRuneId(s, 'rune_hoardflame');
      if (id === 'sp_dragonflame') procRuneId(s, 'rune_dragon_breath');
    }
  }
  // The CADENCED twin of the list above (Clockwork Promotion / the Muckbroker / Rare Goods): a card every
  // `everyTurns` turn setups instead of every one. `tick` counts setups since the last payout, so the badge's
  // x/N countdown and the payout read the same number. `overflow` for the same reason as every earned grant.
  for (const g of s.runeCadenceGrants ?? []) {
    g.tick += 1;
    if (g.tick < g.everyTurns) continue;
    g.tick = 0;
    const def2 = CARD_INDEX[g.cardId];
    if (!def2) continue;
    conjureToHand(s, [def2], 1, true);
    procRuneId(s, g.sourceId);
  }
  // Rune of Shifting Facets: one tick per turn setup is the whole alternation — the axis is DERIVED from its
  // parity (see `questCombatMods`), so nothing can drift out of step with the printed side.
  if (s.questFlags?.runeShiftingFacets) s.runeShiftingFacetsTick = (s.runeShiftingFacetsTick ?? 0) + 1;
  // Rune of the Deep (Epic): each turn setup, a random minion of the armed tier. `overflow` so an earned
  // reward is never dropped to a full hand, matching the quest/rune grant rule.
  if (s.runeDeep) {
    const pool = poolOf(s).all.filter((c) => !c.spell && !c.token && !c.ruby && c.tier === s.runeDeep);
    // One minion per copy held (recurring family, owner 2026-08-27).
    if (pool.length > 0) { procRuneId(s, 'rune_deep'); conjureToHand(s, pool, runeStacksOf(s, 'rune_deep'), true); }
  }
  // Rune of Basic/Epic <tribe>: the same turn-setup faucet as the Deep, filtered by TRIBE instead of tier.
  // `payTribeDrip` is THE payout — shared verbatim with the immediate one at purchase, so the tier cap, the
  // tribe filter and the count can never drift between "the turn it was taken" and every turn after.
  for (const drip of s.runeTribeDrip ?? []) payTribeDrip(s, drip);
  // Rune of the Pendant: gild a random friendly minion at or below the armed tier. Seeded off the run cursor
  // like every other random pick, and a no-op when nothing on the board qualifies (or it is already gilded).
  if (s.runePendant) {
    // One gild per copy held (recurring family, owner 2026-08-27) — each draws a fresh eligible pick.
    for (let k = 0; k < runeStacksOf(s, 'rune_pendant'); k++) {
      const eligible = s.board.filter((c) => !c.golden && (CARD_INDEX[c.cardId]?.tier ?? 99) <= (typeof s.runePendant === 'number' ? s.runePendant : 99));
      if (eligible.length === 0) break;
      const rng = makeRng(s.rngCursor);
      const pick = eligible[rng.int(eligible.length)]!;
      s.rngCursor = rng.state();
      gildMinion(pick);
      procRuneId(s, 'rune_pendant');
    }
  }
  // Rune of the Guiding Candle: the per-turn allowance of tier-locked refreshes refills at each shop.
  if (s.runeGuidingCandle) s.runeGuidingCandle = { ...s.runeGuidingCandle, left: s.runeGuidingCandle.count };
  // ── EQUIPMENT REBUILD — THE FIRST Start-of-Turn operation (owner handoff 2026-08-28) ──────────────────
  // Deliberately ahead of every rune, quest and board Start-of-Turn effect: anything that reads or spends
  // Equipment this turn must see THIS turn's collection, not last turn's. The engine has no Start-of-Turn
  // priority layers (it is an imperative sequence), so this guarantee is POSITIONAL — `equipment.test.ts`
  // pins it by proving a Start-of-Turn effect observes the rebuilt state.
  //
  // Clears the collection, resets the shared allowance, re-equips every surviving source left to right, and
  // restores the last-used Equipment when its source survived. One cue per SOURCE BODY for the UI, even
  // though duplicates collapse into a single selector entry.
  for (const cue of rebuildEquipment(s)) {
    stampEquipFx(s, { kind: 'reequip', uid: cue.uid, cardId: cue.cardId, equipmentId: cue.equipmentId });
  }
  // Rune of Copies (Epic): each turn setup, copy a random board minion to hand (the immediate copy fired on
  // buy) — one copy per rune copy held (recurring family, owner 2026-08-27).
  if (s.runeCopies && s.board.length > 0) procRuneId(s, 'rune_copies');
  if (s.runeCopies) for (let k = 0; k < runeStacksOf(s, 'rune_copies'); k++) copyRandomBoardMinion(s);
  // Rune of the Conductor (Epic): the shop OPENS by triggering all your End of Turn effects — the warband's
  // EoT minions + quest/rune recurring rewards, exactly like a real End of Turn (Chronos repeats included).
  // Per-turn scalers (Rune of Spending / Rune of Action read Gold-spent / cards-played) see the FRESH turn's
  // zeroed counters at shop open, so those specific rewards contribute nothing here by design. Wrapped
  // sourceless for FX (descends onto every gainer via the recruitFxSeq boundary), and the triggers count
  // toward "Trigger N End of Turn effects" quests like real ones.
  // (Rune of the Conductor's old start-of-shop EoT re-trigger lived here; the 2026-07-31 rework moved it to
  // `endOfTurnExtra` — the rune now simply repeats your End of Turn twice more, like Parliament of Flame.)
  // Rune of the Summit: every 2nd shop opens a Tier 7 Discover. `exactTier: 7` is a FIXED-tier offer, so it
  // resolves with no rift active — which is the entire point (Tier 7 is otherwise unreachable outside one).
  if (s.runeSummit) {
    s.runeSummitTick = (s.runeSummitTick ?? 0) + 1;
    // Only the 3rd shop pays; the two in between are the countdown, not the rune firing.
    // Same 3-turn cadence, one Discover per copy held (recurring family, owner 2026-08-27) — they queue in sequence.
    if (s.runeSummitTick % 3 === 0) { procRune(s, 'runeSummit'); for (let k = 0; k < runeStacksOf(s, 'rune_summit'); k++) queueDiscover(s, { kind: 'minion', tier: 7, exactTier: 7 }); } // every 3rd shop (owner sheet 2026-07-31)
  }
  // Set 2 — the warband's own Start-of-Turn effects (Gemline Martyr), the symmetric twin of End of Turn. Fired
  // here as the shop opens, alongside the Start-of-Turn rune rewards below.
  applyStartOfTurn(s);
  // Rune of the Strange Caravan: Start of Turn, get a random minion from a type you do NOT control.
  if (s.runeStrangeCaravan) {
    procRune(s, 'runeStrangeCaravan');
    // One minion per copy held (recurring family, owner 2026-08-27) — each re-reads what is uncontrolled.
    for (let k = 0; k < runeStacksOf(s, 'rune_strange_caravan'); k++) {
      const un = uncontrolledTribes(s);
      if (un.length === 0) break;
      const rng = makeRng(s.rngCursor);
      const tribe = un[rng.int(un.length)]!;
      s.rngCursor = rng.state();
      grantRandomTribeMinion(s, tribe, 1, true);
    }
  }
  // Rune of Fresh Pages: Start of Turn, Discover a Shop spell (queues behind any start-of-turn modal).
  if (s.runeFreshPages) { procRune(s, 'runeFreshPages'); queueDiscover(s, { kind: 'spell' }); }
  // Triples can be completed by a combat carry-back that lands a 3rd copy in the hand (e.g. a
  // Deathrattle-granted minion) AFTER the last recruit action that would have checked. Every other
  // path checks on the mutation; this is the one entry the player never triggers, so check once here
  // as the shop opens. Idempotent + loop-guarded, and the only settle/advance-path call (no double-Discover).
  // No hand overflow here: a shop-start triple always includes ≥1 hand-granted copy (3 board copies would
  // have tripled back in recruit), and checkTriples pulls from the hand first — removing it offsets the
  // golden it pushes back, so the hand never grows past the cap.
  checkTriples(s);
  // Quest turns roll the tavern HERE (after checkTriples — matching the old deferred `buyQuest` roll's rngCursor
  // position, so the run stays byte-identical) so the shop is populated behind the quest overlay for a
  // shop-informed pick. Honors a carried-over freeze; `buyQuest` now just closes the offer (no re-roll).
  if (s.questOffer) {
    if (s.frozen) {
      topUpTavern(s);
      injectPendingTavern(s, true); // defer the eat until the quest offer closes (openNextStartOfTurnModal)
      s.frozen = false;
    } else {
      refreshTavern(s, true);
      applyShopRefreshed(s); // same fresh-roll rule as the main start-of-turn path above
    }
  }
}

/** Advance every active, incomplete quest whose objective matches `pred`, by 1; complete + apply the reward at
 *  the threshold. Called once per tracked action (buy/play/sell/roll/shout) and once per newly-summoned minion. */
function advanceQuests(s: RunState, pred: (o: QuestObjective) => boolean): void {
  advanceQuestsBy(s, pred, 1);
}

/** The Author's Hand compound objective: bump one key (Shout / Echo / Rally) toward the shared `count`; complete
 *  when all three reach it. `progress` mirrors the min of the three (for the panel bar). */
function bumpAuthorsHand(s: RunState, key: 'shout' | 'echo' | 'rally', n: number): void {
  if (n <= 0) return;
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def || def.objective.event !== 'authorsHand') continue;
    const sp = (aq.subProgress ??= { shout: 0, echo: 0, rally: 0 });
    sp[key] = Math.min(def.objective.count, sp[key] + n);
    aq.progress = Math.min(sp.shout, sp.echo, sp.rally);
    if (sp.shout >= def.objective.count && sp.echo >= def.objective.count && sp.rally >= def.objective.count) {
      aq.completed = true;
      applyQuestReward(s, def, true);
    }
  }
}

/** Advance every active, incomplete quest matching `pred` by `amount` (≥1); complete + apply the reward at the
 *  threshold. Used for amount-based objectives (spendGold, tribeStats, End-of-Turn / Shout trigger counts). */
function advanceQuestsBy(s: RunState, pred: (o: QuestObjective) => boolean, amount: number): void {
  if (amount <= 0) return;
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def) continue;
    if (def.objective.event === 'compound') {
      // Route the tick to whichever compound parts match this predicate (a compound can mix recruit + combat events).
      advanceCompound(s, aq, def, (def.objective.parts ?? []).map((p) => (pred(p as QuestObjective) ? amount : 0)));
      continue;
    }
    if (!pred(def.objective)) continue;
    aq.progress += amount;
    resolveQuestThreshold(s, aq, def);
  }
}

/** Advance a compound quest's parts by the per-part `amounts` (index-aligned with `objective.parts`); complete +
 *  apply the reward once EVERY part has filled. `progress` = Σ part progress (the panel renders per-part lines). */
function advanceCompound(s: RunState, aq: ActiveQuest, def: QuestDef, amounts: number[]): void {
  const parts = def.objective.parts ?? [];
  const pp = (aq.partProgress ??= parts.map(() => 0));
  let changed = false;
  parts.forEach((part, i) => {
    const add = amounts[i] ?? 0;
    if (add > 0 && pp[i]! < part.count) { pp[i] = Math.min(part.count, pp[i]! + add); changed = true; }
  });
  if (!changed) return;
  aq.progress = pp.reduce((a, b) => a + b, 0);
  if (parts.every((part, i) => (pp[i] ?? 0) >= part.count)) {
    aq.completed = true;
    aq.completionCount = (aq.completionCount ?? 0) + 1;
    applyQuestReward(s, def, true);
  }
}

/** Complete a quest at its threshold (apply the reward, mark done) — or, for a REPEATABLE quest (Ossuary Rite),
 *  fire the reward and re-arm (subtract the count, stay active) as many times as the progress covers, so one big
 *  combat can grant it more than once. */
function resolveQuestThreshold(s: RunState, aq: ActiveQuest, def: QuestDef): void {
  if (def.repeatable) {
    while (aq.progress >= def.objective.count) {
      aq.progress -= def.objective.count;
      aq.completionCount = (aq.completionCount ?? 0) + 1; // never sets `completed`; bumps so telemetry still sees it
      applyQuestReward(s, def, true);
    }
  } else if (aq.progress >= def.objective.count) {
    aq.completed = true;
    aq.completionCount = (aq.completionCount ?? 0) + 1;
    applyQuestReward(s, def, true);
  }
}

/** Conjure `reps` random minions of `tribe` (≤ current tier) into the hand — the quest-reward draw (Grave
 *  Toll's "random Undead", Trail Rations' "random Beast"). Shares `conjureToHand`'s seeded pick + hand cap. */
function grantRandomTribeMinion(s: RunState, tribe: Tribe, reps: number, overflow = false): void {
  const pool = poolOf(s).buyable.filter((c) => (c.tribe === tribe || c.tribe2 === tribe) && c.tier <= s.tier);
  conjureToHand(s, pool, reps, overflow);
}

/** Conjure `reps` random buyable minions of EXACTLY `tier` (in your tribes / neutral) — Rune of the Pair's
 *  "2 random Tier 4 minions". */
function grantRandomTierMinion(s: RunState, tier: number, reps: number, overflow = false): void {
  const pool = poolOf(s).buyable.filter((c) => c.tier === tier && (c.tribe === 'neutral' || s.tribes.includes(c.tribe)));
  conjureToHand(s, pool, reps, overflow);
}

/** Whether a card matches a reward's minion "class" filter (a Shout=Battlecry, an End-of-Turn, an Echo=Deathrattle,
 *  a Rally=RL keyword, or an Attachment=Magnetic). Shared by the filtered grant + the recurring-attachment EoT. */
function matchesFilter(c: CardDef, filter: 'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment'): boolean {
  switch (filter) {
    case 'shout': return hasBattlecry(c);
    case 'endOfTurn': return c.effects.some((e) => e.on === 'endOfTurn');
    case 'echo': return c.effects.some((e) => e.on === 'onDeath');
    case 'rally': return c.keywords.includes('RL');
    case 'attachment': return c.keywords.includes('M');
  }
}

/** Conjure `reps` random buyable minions matching a class filter into the hand. `exactTier` restricts to the
 *  CURRENT tavern tier (fallback ≤ tier if none there); otherwise ≤ current tier. Powers the "get a random
 *  Shout / End-of-Turn / Echo / Rally / Attachment minion" rewards. */
function grantRandomFilterMinion(s: RunState, filter: 'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment', reps: number, exactTier = false, overflow = false): void {
  const base = poolOf(s).buyable.filter((c) => matchesFilter(c, filter));
  let pool = base.filter((c) => (exactTier ? c.tier === s.tier : c.tier <= s.tier));
  if (pool.length === 0) pool = base.filter((c) => c.tier <= s.tier); // exact-tier gap → fall back to ≤ tier
  conjureToHand(s, pool, reps, overflow);
}

/**
 * Apply a completed quest's reward. `allowRepeat` gates the delayed re-grant so the repeat fire itself doesn't
 * schedule another (Trail Rations). Keep in lockstep with the `QuestReward` union in @game/core:
 *  - buffBoard   → a flat +atk/+hp on every board minion (itemized via `addBuff`).
 *  - grant       → conjure the random-tribe minion(s) + each listed card (Gold Pouch) to hand; maybe schedule
 *                  the whole reward to repeat `repeatInTurns` turns later.
 *  - shoutDouble → bank charges so the next N played Shouts each trigger twice (spent in `playedShoutRepeats`).
 */
/** How many runes each Runeforge visit offers (basic + Epic). */
const RUNEFORGE_OFFER = 4;

/** Hero-power kinds that get value from a double trigger — the (dormant) gate for Rune of Empowerment. Keep in
 *  sync with the `reps`-reading branches in the `heroPower` case (scalingGold / gainMaxMana / fortify / dynamiteDig). */
/**
 * The hero powers a "your Hero Power triggers twice" rune may be offered for (Rune of the Wishbone; the
 * retired Rune of Empowerment shared this gate). The owner named the roster 2026-08-19.
 *
 * ONLY the ACTIVE powers are listed. Their reducer branch runs `reps` times, so doubling is real the moment
 * the rune is held. The owner also named ten PASSIVE powers — Emerald Warden (`vanguard`), Emissary
 * (`unitedFront`), Ayse (`luckySeat`), Keshi (`crownTally`), Gorr (`fourPeat`), Re-Pete (`secondHand`), Braum
 * (`investment`), Flash (`firstOrLast`), Odelle (`exhibition`), Juggler (`baldgecoin`) — which never pass
 * through the activation branch at all and each need doubling at their own fire site. They are DELIBERATELY
 * absent until that lands: a rune offered to a hero it silently does nothing for is worse than one that is
 * offered less often. Add each here as its passive learns to repeat.
 */
export const DOUBLEABLE_POWERS = new Set([
  // ACTIVE — their branch in the power-activation switch runs `reps` times.
  'empowerment',      // Albus — the Discover steps TWO tiers (the pick replaces the offer, so a second
                      //         Discover would have nothing to land on)
  'replayBattlecry',  // Auctioneer (Pulse) / Myra — the Battlecry is replayed twice
  'buyout',           // Harlan — two consecutive Shops (take, reroll, take again)
  'roundedSpellbook', // Hunch — two copies of the last spell
  'dynamiteDig',      // Jensen — 2 Discovers
  'pocketMagic',      // Merrin — 2 Shop spells
  'gainMaxMana',      // Nadja — +2 max Gold
  'archive',          // Quillen — the type is banked twice; the overflow carries to the next bucket
  'dragonTamer',      // Tiff — 2 Discovers
  'soulkeeper',       // Underdweller — a second Discover, queued behind the first
  'copyMachine',      // Xerox — two copies, each needing its own board slot
  'investment',       // Braum — two counts banked per use
  // PASSIVE — no activation to run twice, so each doubles at its OWN fire site via `wishboneReps`.
  'luckySeat',        // Ayse — the prize pays twice
  'vanguard',         // Emerald Warden — the tavern-up hands over 2
  'unitedFront',      // Emissary — the Start-of-Combat grant pays double
  'fourPeat',         // Gorr — another copy, re-rolled among the same three
  'baldgecoin',       // Juggler — 2 Carnival Coins
  'crownTally',       // Keshi — the purchase banks its tier twice
  'exhibition',       // Odelle — the Exhibition trio is paid twice
  'secondHand',       // Re-Pete — 2 copies (stacks with a Chronos replay, which re-enters the same beat)
  'firstOrLast',      // Flash — the CLAIM grants 2 copies (owner ruling 2026-08-19). The mark itself can't
                      //         double — arming it twice is the same mark — so the payout is what doubles.
]);

/** The eligible rune-id pool for whichever forge is open (normal or Epic), filtered by the current hero's power:
 *  a `requiresDoublePower` rune (Empowerment) is dropped for a hero whose power can't double. */
function runeforgePool(s: RunState): string[] {
  const set = s.runeforgeEpic ? EPIC_RUNES : RUNES;
  const canDouble = activePowers(s).some((p) => DOUBLEABLE_POWERS.has(p.kind)); // a mimicked/Void-held power doubles too
  // SET SCOPING (owner report 2026-07-29): a rune whose reward names another set's mechanics — Fodder,
  // Attachments and Undead in set 1; Rubies and Ales in set 2 — can never pay off in this run, and offering it
  // burns one of the forge's few slots. `sets` absent means "general mechanics only", so it stays offerable
  // everywhere; the run's PINNED set decides, never the live registry.
  const runSet = setIdOf(s);
  return set
    .filter((rn) => !rn.requiresDoublePower || canDouble)
    .filter((rn) => !rn.sets || rn.sets.includes(runSet))
    // FORGE FILTER (owner approve 2026-08-27, q-runedup-forge-filter): never re-offer an owned rune whose
    // duplicate would only pay the sweetener (or, for the ruled-unique ones, nothing). Stacking runes stay
    // offerable; Rune of Duplication still reaches everything deliberately.
    .filter((rn) => !forgeFilteredDuplicate(s, rn.id))
    .map((rn) => rn.id);
}

/** The synergy tags the player's BOARD currently exhibits: its tribes, plus the mechanics its cards carry
 *  (Rally keyword, Echo/Shout/Avenge triggers, Consume/Ruby/Ale/spell/Gold/summon effect families). Derived
 *  from the card defs, so new cards profile themselves. */
export function boardSynergyTags(s: RunState): Set<SynergyTag> {
  const tags = new Set<SynergyTag>();
  for (const c of s.board) {
    const def = CARD_INDEX[c.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) if (t && t !== 'neutral') tags.add(t);
    if (c.keywords.includes('RL') || def.keywords.includes('RL')) tags.add('rally');
    if (def.ruby) tags.add('ruby');
    for (const e of def.effects) {
      const doId = e.do.toLowerCase();
      if (e.on === 'onDeath') tags.add('echo');
      if (e.on === 'onPlay') tags.add('shout');
      if (e.on === 'avenge') tags.add('avenge');
      if (e.on === 'onAttack') tags.add('rally');
      if (e.on === 'spellCast' || e.on === 'cast' || e.on === 'spellBought') tags.add('spells');
      if (e.on === 'goldSpent') tags.add('gold');
      if (e.on === 'onSummon') tags.add('summon');
      if (e.on === 'onConsume' || doId.includes('consume')) tags.add('consume');
      if (doId.includes('rub')) tags.add('ruby');
      if (doId.includes('ale')) tags.add('ale');
      if (doId.includes('summon')) tags.add('summon');
    }
  }
  return tags;
}

/** The pivot-discount roll: offered runes that do NOT follow the board get a seeded chance of a Gold discount
 *  (basic 1–2, epic 2–4) — a nudge toward changing direction rather than a tax on staying the course. */
const PIVOT_DISCOUNT_CHANCE = 0.4;

/** Build a forge offer with the synergy guarantee (owner ask 2026-07-31): ONE slot is drawn from the runes
 *  that follow something on the player's board (a tribe or a mechanic), when any such rune exists; the rest
 *  draw uniformly. Returns the ids plus the aligned pivot discounts, both seeded off `rng` so replays hold. */
function drawRuneOffer(s: RunState, rng: ReturnType<typeof makeRng>, avoid: Set<string> = new Set()): { offer: string[]; discounts: (number | undefined)[] } {
  // TUTORIAL: an AUTHORED offer, never a draw. The coach names what each rune does, which it can only do for
  // runes the course chose. No pivot discounts either — a discounted price is a lesson of its own, and this
  // round is teaching what a rune IS.
  const scripted = s.mode === 'tutorial' ? s.tutorialRuneScript?.[s.wave] : undefined;
  if (scripted && scripted.runes.length > 0) {
    const offer = scripted.runes.filter((id) => RUNE_INDEX[id]);
    if (offer.length > 0) return { offer, discounts: offer.map(() => undefined) };
  }
  const pool = runeforgePool(s);
  const tags = boardSynergyTags(s);
  const matches = (id: string): boolean => {
    const rn = RUNE_INDEX[id];
    return !!rn && runeSynergies(rn).some((t) => tags.has(t));
  };
  const synergyPool = pool.filter((id) => matches(id) && !avoid.has(id));
  const offer = drawRunes(pool, RUNEFORGE_OFFER, rng, avoid);
  // Guarantee: if nothing drawn follows the board but a follower exists, swap one in at a seeded slot.
  if (synergyPool.length > 0 && !offer.some(matches)) {
    const pick = synergyPool[rng.int(synergyPool.length)]!;
    offer[rng.int(offer.length)] = pick;
  }
  // Pivot discounts — only on runes that do NOT follow the board.
  const span = s.runeforgeEpic ? [2, 3, 4] : [1, 2];
  const discounts = offer.map((id) => {
    if (matches(id)) return undefined;
    if (rng.next() >= PIVOT_DISCOUNT_CHANCE) return undefined;
    return span[rng.int(span.length)]!;
  });
  return { offer, discounts };
}

/** Draw `n` distinct rune ids from `ids`, preferring ones not in `avoid` (a re-roll's current offer) but falling
 *  back to the avoided set if there aren't enough fresh ones — so a small Epic pool still yields a full offer. */
function drawRunes(ids: string[], n: number, rng: ReturnType<typeof makeRng>, avoid: Set<string> = new Set()): string[] {
  const fresh = ids.filter((id) => !avoid.has(id));
  const rest = ids.filter((id) => avoid.has(id));
  const picks: string[] = [];
  const take = (arr: string[]) => { while (picks.length < n && arr.length > 0) picks.push(arr.splice(rng.int(arr.length), 1)[0]!); };
  take(fresh);
  take(rest);
  return picks;
}

/** Open the EPIC Runeforge (a quest reward): present a random 3 of the eligible Epic runeset. Reuses the same
 *  offer/buy/skip/reroll machinery as the Runesmith's forge, flagged `runeforgeEpic` so the reroll draws from the
 *  Epic pool, the UI labels it "Epic", and closing it doesn't spend a hero-power charge. Salted distinct from the
 *  normal forge's stream. */
/**
 * Guardian + Runesmith: the forge their OWN power opens is discounted across every slot (owner ask
 * 2026-08-17) — it is their hero power's shop, so it should feel like one.
 *
 * Fills the gaps rather than overwriting: a slot that already earned a PIVOT discount keeps it, since that one
 * can be larger and the two would otherwise fight. Uses the same span as the pivot so a "discounted rune"
 * means one consistent thing, and draws from the passed `rng` so replays hold.
 */
function applyHeroForgeDiscount(s: RunState, rng: ReturnType<typeof makeRng>): void {
  const kind = getHero(s.heroId).power.kind;
  if (kind !== 'runeforge' && kind !== 'epicRuneforge') return;
  const span = s.runeforgeEpic ? [2, 3, 4] : [1, 2];
  s.runeforgeDiscounts = (s.runeforgeOffer ?? []).map((_, i) =>
    s.runeforgeDiscounts?.[i] ?? span[rng.int(span.length)]!);
}

export function openEpicRuneforge(s: RunState): void {
  s.runeforgeEpic = true;
  s.runeforgeNoCharge = true; // reached by a quest/rune, not the hero power
  s.runeforgeRerolled = undefined;
  const epicRng = makeRng(mixSeed(s.seed, s.wave, TAG.QUEST, 2));
  const drawn = drawRuneOffer(s, epicRng);
  s.runeforgeOffer = drawn.offer;
  s.runeforgeDiscounts = drawn.discounts;
  applyHeroForgeDiscount(s, epicRng);
}

/** Open the BASIC Runeforge from a quest/rune (The Runeforge quest), granting `gold` this turn. Uses the normal
 *  runeset but is flagged `runeforgeNoCharge` (it's not the Runesmith hero power, so buying spends no charge). */
function openScheduledBasicRuneforge(s: RunState, gold = 0): void {
  s.runeforgeEpic = undefined;
  s.runeforgeNoCharge = true;
  s.runeforgeRerolled = undefined;
  const schedRng = makeRng(mixSeed(s.seed, s.wave, TAG.QUEST, 3));
  const drawn = drawRuneOffer(s, schedRng);
  s.runeforgeOffer = drawn.offer;
  s.runeforgeDiscounts = drawn.discounts;
  // The discount follows the HERO, not the route: Runesmith's forge can also arrive on this scheduled path,
  // and it is still his shop either way.
  applyHeroForgeDiscount(s, schedRng);
  if (gold > 0) gainGold(s, gold);
}

/** The distinct minion ids that GREATER-tier quests grant as rewards (grant/recurringGrant/multi cards) — the pool
 *  Rune of the Second Path Discovers from. Excludes spells. */
function greaterQuestRewardMinions(): string[] {
  const ids = new Set<string>();
  const collect = (r: QuestDef['reward']): void => {
    if (r.kind === 'grant') for (const id of r.cards ?? []) ids.add(id);
    else if (r.kind === 'recurringGrant') for (const id of r.cards) ids.add(id);
    else if (r.kind === 'multi') for (const sub of r.rewards) collect(sub);
  };
  for (const q of Object.values(QUEST_INDEX)) if (q.tier === 'greater') collect(q.reward);
  return [...ids].filter((id) => CARD_INDEX[id] && !CARD_INDEX[id]!.spell);
}

/** Rune of Copies: conjure a fresh copy of a RANDOM board minion into the hand (base card + run auras, like the
 *  Dupes copy). No-op on an empty board or a full hand. */
function copyRandomBoardMinion(s: RunState): void {
  const pool = s.board.map((c) => CARD_INDEX[c.cardId]).filter((d): d is CardDef => !!d);
  conjureToHand(s, pool, 1);
}

/** Close any open forge — clears the offer + its per-visit flags. */
function closeRuneforge(s: RunState): void {
  s.runeforgeOffer = undefined;
  s.runeforgeDiscounts = undefined;
  s.runeforgeEpic = undefined;
  s.runeforgeNoCharge = undefined;
  s.runeforgeRerolled = undefined;
}

/** Open the next start-of-turn modal in priority order — **Quest > Runeforge > Discover / other** — but only if
 *  none is currently open. This lets a turn that lines up several start-of-turn events (a quest offer, the Epic
 *  Runeforge, queued Discovers) resolve them SEQUENTIALLY instead of dropping or deferring the lower-priority ones.
 *  Quest offers + the Runesmith forge are opened directly by `advanceCombat` (top priority); this drains what waits
 *  behind them, and is called from every modal-close path (buyQuest / forge close / discover resolve). */
/**
 * Open a hero-power Discover: 2 random eligible hero powers (owner spec 2026-08-22). `void2` re-derives the
 * pool with the first pick excluded. Draws from `rngCursor` like every other shop-side pick. An empty pool
 * (impossible with the shipped roster, but a content change could starve it) opens nothing — the turn just
 * proceeds, the same no-soft-lock rule the quest offer follows.
 */
function mintPowerOffer(s: RunState, slot: 'mimic' | 'void1' | 'void2'): void {
  const rng = makeRng(s.rngCursor);
  const pool = powerDiscoverPool(slot === 'mimic' ? 'mimic' : 'void', s.voidPowerIds ?? []);
  const heroIds: string[] = [];
  while (heroIds.length < 2 && pool.length > 0) heroIds.push(pool.splice(rng.int(pool.length), 1)[0]!);
  s.rngCursor = rng.state();
  if (heroIds.length > 0) s.powerOffer = { heroIds, slot };
}

/**
 * Seed the minimum run-state an ADOPTED power needs to function mid-run. Most powers are self-contained, but
 * a few passives normally get set up at `createRun` — without this a mimicked Lucky Seat would pay its prize
 * off an unset suit and show a blank suit card.
 */
function seedAdoptedPower(s: RunState, heroId: string): void {
  // ONCE per hero per run. Mimic re-picks every turn, so an unguarded seed turns every creation-time grant
  // into a faucet — re-adopting Brackus was a Tier-7 Discover per turn.
  if (s.seededPowers?.includes(heroId)) return;
  (s.seededPowers ??= []).push(heroId);
  const kind = getHero(heroId).power.kind;
  if (kind === 'luckySeat') {
    if (!s.ciaSuit) {
      const rng = makeRng(s.rngCursor);
      s.ciaSuit = (['hearts', 'spades', 'diamonds', 'clubs', 'ace'] as const)[rng.int(5)];
      s.rngCursor = rng.state();
    }
    // …and the shop already on screen rolls its Enchanted marks NOW — otherwise the power sits inert until
    // the next fill, which on Mimic's one-turn disguise could be never.
    rollCiaEnchants(s);
  }
  // CREATION-TIME powers pay their start-of-game reward ON ADOPTION (owner ask 2026-08-22: "for hero powers
  // that grant a minion — Yirin for a Void selection — Void should get that start-of-game reward"). Each
  // block mirrors its `createRun` twin; without these the power's whole value lives at a moment the adopter
  // was someone else.
  if (kind === 'startingReflector') {
    const def = CARD_INDEX['n2_reflector'];
    if (def && s.hand.length < handCap(s)) {
      s.hand.push({ uid: `b${s.uidSeq++}`, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false });
    }
  }
  if (kind === 'chaos') {
    const def = CARD_INDEX['symbioticattachment'];
    if (def && s.hand.length < handCap(s)) {
      s.hand.push({ uid: `b${s.uidSeq++}`, cardId: 'symbioticattachment', tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false });
    }
  }
  // Brackus: the Tier-7 pick, still locked behind 70 Gold spent THIS RUN — an adopter who has already spent
  // 70 gets it unlocked, which is the same rule the native hero lives under (the lock reads run.goldSpent).
  if (kind === 'summitLock') queueDiscover(s, { kind: 'minion', tier: 7, exactTier: 7, lockGold: 70 });
  // Guardian: schedule the Epic Runeforge — turn 8 as authored when that is still ahead, else the next turn
  // (an adopted power must never schedule a visit into the past, which would simply never open).
  if (kind === 'epicRuneforge' && !s.epicForgeWave) s.epicForgeWave = Math.max(8, s.wave + 1);
}

function openNextStartOfTurnModal(s: RunState): void {
  if (s.questOffer || s.powerOffer || s.runeforgeOffer || s.discover || s.chooseOne || s.pendingTarget) return; // one modal at a time
  // A deferred hero-power Discover (Mimic's turn-start / Void's turn 4) — behind a quest offer, ahead of the
  // forges: the power shapes what the forge/Discover picks are worth, so it resolves first.
  if (s.pendingPowerOffer) { const slot = s.pendingPowerOffer.slot; s.pendingPowerOffer = undefined; mintPowerOffer(s, slot); if (s.powerOffer) return; }
  // A forge armed MID-TURN is `deferred` — it must wait for the NEXT turn's start (advanceCombat promotes it by
  // clearing the flag) so a mid-turn modal-close drain can't open it on the completing turn (owner bug 2026-07-13).
  if (s.pendingEpicRuneforge && !s.pendingForgeDeferred) { openEpicRuneforge(s); s.pendingEpicRuneforge = false; return; } // Runeforge before Discovers
  if (s.pendingBasicForge && !s.pendingBasicForge.deferred) { const g = s.pendingBasicForge.gold ?? 0; s.pendingBasicForge = undefined; openScheduledBasicRuneforge(s, g); return; }
  if (s.discoverQueue?.length) { openDiscover(s, s.discoverQueue.shift()!); return; } // then any queued start-of-turn Discovers
  // Every start-of-turn modal has cleared — the recruit phase is now interactive, so run any DEFERRED Fodder eat
  // (held at turn setup so the player saw the Fodder in the shop behind the quest/Runeforge overlay first).
  if (s.holdFodderConsume) { s.holdFodderConsume = undefined; consumeTavernFodder(s); }
}

/**
 * CHOREOGRAPHER PR 15 — quest/rune payouts announce themselves.
 *
 * `applyQuestReward` is the single chokepoint for BOTH quest completions and rune acquisitions, so wrapping
 * it here gives ~100 classified-but-silent keys a beat without touching a hundred reward branches.
 *
 * Consequences are discovered by DIFFING the reward, the same technique the End-of-Turn primitive uses: a
 * reward can move board stats, hand contents and Gold through many helpers, and instrumenting each one would
 * be a hundred chances to miss one. Read-only with respect to gameplay — the diff never mutates.
 */
function withQuestRewardBeat(s: RunState, key: string | undefined, label: string, kind: 'quest' | 'rune', id: string, run: () => void): void {
  const collector = currentCollector();
  if (!collector.enabled || !key) { run(); return; }
  const statOf = (c: { uid: string; attack: number; health: number }) => [c.uid, { a: c.attack, h: c.health }] as const;
  const before = new Map([...s.board, ...s.hand].map(statOf));
  const handBefore = new Set(s.hand.map((c) => c.uid));
  const goldBefore = s.embers;
  const maxGoldBefore = s.maxEmbers;
  collector.withTrigger(
    { phase: 'recruit', source: { kind, id, label, side: 'player' }, trigger: 'reward', ...beatIdentity(key) },
    () => {
      run();
      for (const c of [...s.board, ...s.hand]) {
        const was = before.get(c.uid);
        if (!was) continue; // a card that did not exist before is a GRANT, emitted below
        const da = c.attack - was.a;
        const dh = c.health - was.h;
        if (da === 0 && dh === 0) continue;
        const zone = s.hand.some((h) => h.uid === c.uid) ? 'hand' : 'board';
        collector.emit({ type: 'statsChanged', target: { zone, uid: c.uid, cardId: c.cardId, side: 'player' }, attack: da, health: dh, permanent: true, channel: 'ordinary' });
      }
      for (const c of s.hand) {
        if (handBefore.has(c.uid)) continue;
        collector.emit({ type: 'cardGranted', target: { zone: 'hand', uid: c.uid, cardId: c.cardId, side: 'player' }, cardId: c.cardId });
      }
      if (s.embers !== goldBefore) collector.emit({ type: 'resourceChanged', resource: 'gold', amount: s.embers - goldBefore, valueAfter: s.embers });
      if (s.maxEmbers !== maxGoldBefore) collector.emit({ type: 'resourceChanged', resource: 'maxGold', amount: s.maxEmbers - maxGoldBefore, valueAfter: s.maxEmbers });
    },
  );
}


/**
 * ONE tribe-faucet payout (Rune of Basic/Epic Beasts/Demons/Dragons/Dwarves/Kobolds).
 *
 * Capped at the TAVERN tier (a rune must not hand you a card the shop couldn't offer) and filtered on either
 * printed tribe. `overflow` so an earned grant is never dropped to a full hand, matching every other rune
 * grant. Extracted (2026-08-20) because the rune now pays TWICE from two call sites — once immediately when
 * it is taken and once at every following turn setup — and the owner's report was exactly the drift a second
 * copy invites: taking the rune granted nothing at all until the next turn.
 */
function payTribeDrip(s: RunState, drip: { tribe: Tribe; count: number }): void {
  const pool = poolOf(s).all.filter((c) =>
    !c.spell && !c.token && !c.ruby && c.tier <= s.tier && (c.tribe === drip.tribe || c.tribe2 === drip.tribe));
  if (pool.length === 0) return;
  conjureToHand(s, pool, drip.count, true);
  procRuneId(s, `rune_${drip.count >= 2 ? 'epic' : 'basic'}_${drip.tribe}`);
}

function applyQuestReward(s: RunState, def: QuestDef, allowRepeat: boolean, sourceKind: 'quest' | 'rune' = 'quest'): void {
  // RUNE DUPLICATE STACKING (owner rulings 2026-08-27): count every rune-reward application — buy, Rune of
  // Duplication's copy, a granted rune — so consumers can scale by the copy count (`runeStacksOf`). Ticked
  // here, the one chokepoint every rune application flows through. Banked re-fires (pendingQuestRewards)
  // arrive with sourceKind 'quest', so they never inflate the count.
  if (sourceKind === 'rune') s.runeStacks = { ...(s.runeStacks ?? {}), [def.id]: (s.runeStacks?.[def.id] ?? 0) + 1 };
  const collector = currentCollector();
  if (collector.enabled) {
    // Resolve the key the SURFACE files this content under, rather than guessing a phase segment — a guessed
    // key would be an orphan identity presentation could not time.
    const key = sourceKind === 'rune' ? surfaceKeyForRune(def.id) : surfaceKeyForQuest(def.id);
    if (key) {
      withQuestRewardBeat(s, key, def.name, sourceKind, def.id, () => applyQuestRewardInner(s, def, allowRepeat));
      return;
    }
  }
  applyQuestRewardInner(s, def, allowRepeat);
}

function applyQuestRewardInner(s: RunState, def: QuestDef, allowRepeat: boolean): void {
  const r = def.reward;
  // Every rune reward records which rune installed it, so a trigger site can attribute itself back to the
  // badge. Harmless for quests (they key their own pulse off `completionCount`) and cheap — one write per
  // purchase, never on a hot path.
  //
  // A `combatFlag` reward is keyed by its FLAG, not by the kind: 29 runes share that one kind, so keying by
  // kind would credit every combat proc to whichever was bought last. Flags are `runeXxx` and reward kinds
  // are distinct names, so the two never collide in this map. (`runeThreshold` — the other shared kind —
  // needs no entry here: those are stored as a list, each carrying its own `sourceId`; see `procRuneId`.)
  const attrKey = r.kind === 'combatFlag' && typeof (r as { flag?: string }).flag === 'string'
    ? (r as { flag: string }).flag
    : r.kind;
  s.runeIdByKind = { ...(s.runeIdByKind ?? {}), [attrKey]: def.id };
  switch (r.kind) {
    case 'buffBoard':
      for (const c of s.board) addBuff(c, `Quest: ${def.name}`, r.attack, r.health);
      break;
    case 'grant':
      // Quest / rune reward cards are guaranteed delivery — they OVERFLOW the hand cap rather than being dropped
      // when hand + board are full (owner ruling: never lose an earned reward). `overflow = true` on every grant.
      if (r.randomTribe && (r.randomCount ?? 0) > 0) grantRandomTribeMinion(s, r.randomTribe, r.randomCount!, true);
      if ((r.randomSpell ?? 0) > 0) conjureToHand(s, poolOf(s).spells.filter((c) => c.tier <= s.tier), r.randomSpell!, true); // Hoard Spark's random spell
      // Set 2 — N random Dwarven ALES specifically (owner 2026-07-29). Drawn from the run's pool like every other
      // grant, so a set without the Ales grants nothing instead of injecting cards the run can't otherwise have.
      if ((r.randomAle ?? 0) > 0) conjureToHand(s, poolOf(s).spells.filter((c) => ALE_IDS.includes(c.id)), r.randomAle!, true);
      // Rubies are MINTED, never conjured: a Ruby's stats are base 1/1 plus the run's live `rubyBonus`, so
      // handing over a raw pool copy would give a late-run Kobold deck 1/1 Rubies while every other source
      // pays full strength.
      if ((r.randomRuby ?? 0) > 0) mintRubies(s, r.randomRuby!);
      if (r.randomFilter) grantRandomFilterMinion(s, r.randomFilter, r.randomFilterCount ?? 1, r.randomFilterExactTier, true); // "N random Shout/Echo/Rally/Attachment minions"
      if (r.randomTier) grantRandomTierMinion(s, r.randomTier, r.randomCount ?? 1, true); // Rune of the Pair — N random Tier-K minions
      for (const id of r.grantGolden ?? []) { // Leader of the Pack / Stormcalling — a GILDED copy (board-overflow safe)
        if (CARD_INDEX[id]) grantMinionToHandOrBoard(s, CARD_INDEX[id]!, true, true);
      }
      for (const id of r.cards ?? []) {
        if (!CARD_INDEX[id]) continue;
        const card = grantMinionToHandOrBoard(s, CARD_INDEX[id]!, false, true);
        // Apex Hunt: stamp the granted card (a Badgington) with extra keywords (Flurry + Ward) on the way in.
        if (r.grantKeywords) for (const kw of r.grantKeywords) if (!card.keywords.includes(kw)) card.keywords.push(kw);
      }
      if (allowRepeat && (r.repeatInTurns ?? 0) > 0) {
        (s.pendingQuestRewards ??= []).push({ questId: def.id, turnsLeft: r.repeatInTurns! });
      }
      break;
    case 'shoutDouble':
      s.shoutDoubleCharges = (s.shoutDoubleCharges ?? 0) + r.count;
      break;
    case 'tribeAura':
      // Den Marker: "your <tribe> have +A/+H wherever they are" — fold into the tribe's run aura + buff now.
      grantTribeAura(s, r.tribe, r.attack, r.health, `Quest: ${def.name}`);
      break;
    case 'scalingTribeAura':
      // Pack Mentality: apply the base aura now, then register it to GROW as its trigger event accrues.
      grantTribeAura(s, r.tribe, r.attack, r.health, `Quest: ${def.name}`);
      (s.questScalingAuras ??= []).push({ tribe: r.tribe, per: r.per, event: r.event, stepAttack: r.stepAttack, stepHealth: r.stepHealth, progress: 0 });
      break;
    case 'recurringGrant':
      // Feed the Alpha: conjure these cards to hand at the end of every turn for the rest of the run.
      // `everyTurns` (2026-08-20) is the CADENCE: absent = every turn (the flat list); set = the cadenced list,
      // which carries its own tick so the badge can count down. One field, one reader — not three rune flags.
      if ((r.everyTurns ?? 1) > 1) {
        for (const cardId of r.cards) (s.runeCadenceGrants ??= []).push({ cardId, everyTurns: r.everyTurns!, tick: 0, sourceId: def.id });
      } else {
        (s.questRecurringGrants ??= []).push(...r.cards);
      }
      break;
    // ── 2026-08-19 owner rune batch ──────────────────────────────────────────────────────────────────────
    case 'runeTribeDrip': {
      // Rune of Basic/Epic <tribe>: a per-turn tribe faucet. PUSHED (not assigned) so two tribe runes both pay.
      const drip = { tribe: r.tribe, count: r.count };
      (s.runeTribeDrip ??= []).push(drip);
      // …and it pays ONCE IMMEDIATELY on top of the recurrence (owner report 2026-08-20: taking the rune
      // granted nothing until the next turn). Same rule Rune of Ruby Resonance follows above — buying a rune
      // mid-turn must not feel like buying nothing. The Runeforge opens DURING a shop turn, after that turn's
      // setup faucet has already run, so this can't double-pay on the turn it is taken.
      payTribeDrip(s, drip);
      break;
    }
    case 'runeSpellDouble':
      // Rune of Hoardflame / Dragon Breath: this spell id casts an extra time. Pushed so a duplicated rune
      // stacks (`spellCasts` multiplies once per entry), matching how the other multicast sources behave.
      (s.runeSpellDouble ??= []).push(r.spellId);
      break;
    case 'runeGlider':
      // Rune of the Glider: stacks additively, so two Gliders give the Dragon both grants on a play.
      s.runeGlider = { attack: (s.runeGlider?.attack ?? 0) + r.attack, health: (s.runeGlider?.health ?? 0) + r.health };
      break;
    case 'runeWarDrum':
      // Stacks: two Drums make the turn's charged Shout trigger that many more times.
      s.runeWarDrum = (s.runeWarDrum ?? 0) + r.extra;
      break;
    case 'runeEmbers':
      s.runeEmbers = true;
      break;
    case 'runeRefreshments':
      s.runeRefreshments = true;
      break;
    case 'runeBaller':
      // `sales` starts at 0 — the FIRST sale after taking it is the +1 Attack step.
      s.runeBaller = { step: r.step, sales: s.runeBaller?.sales ?? 0 };
      break;
    case 'runeWishbone':
      s.runeWishbone = true;
      break;
    case 'runeMight':
      s.runeMight = true;
      break;
    case 'runeChipperSticker':
      s.runeChipperSticker = true;
      break;
    // ── 2026-08-20 owner rune batch ──────────────────────────────────────────────────────────────────
    case 'runeSpellEcho':
      // ONE budget shared by Living Magic (1) and Perfect Recall (2): holding both raises the per-turn ceiling
      // to 3 rather than the two firing independently. `used` is preserved so a mid-turn purchase doesn't
      // silently refund a copy already spent this turn.
      s.runeSpellEcho = { uses: (s.runeSpellEcho?.uses ?? 0) + r.uses, used: s.runeSpellEcho?.used ?? 0 };
      break;
    case 'runeDraconicCuriosity':
      s.runeDraconicCuriosity = true;
      break;
    case 'runeSeasonedLedger':
      // Accumulates: a second copy makes every play pay both grants, and the shared `played` count keeps one
      // countdown rather than two drifting ones.
      s.runeSeasonedLedger = {
        attack: (s.runeSeasonedLedger?.attack ?? 0) + r.attack,
        health: (s.runeSeasonedLedger?.health ?? 0) + r.health,
        per: r.per,
        played: s.runeSeasonedLedger?.played ?? 0,
      };
      break;
    case 'runeEchoedArrival':
      s.runeEchoedArrival = { per: r.per, tick: s.runeEchoedArrival?.tick ?? 0 };
      break;
    case 'runeSharedSpoils':
      s.runeSharedSpoils = true;
      break;
    case 'runeHeavyPayroll':
      s.runeHeavyPayroll = {
        attack: (s.runeHeavyPayroll?.attack ?? 0) + r.attack,
        health: (s.runeHeavyPayroll?.health ?? 0) + r.health,
      };
      break;
    case 'runeHeldStrength':
      // OWNER REWORK 2026-08-27 (q-runedup-oneshot revise): no longer a one-shot on acquire — now a standing
      // "Start of Combat: give your left and right-most minions the stats of the left-most card in your hand"
      // rune. Armed here; the held stats are read LIVE when the combat is built (`questCombatMods`), and a
      // duplicate fires the grant once per copy (`runeStacksOf`).
      s.runeHeldStrength = true;
      break;
    case 'runePendant':
      // Rune of the Pendant: a duplicate can only ever RAISE the ceiling it gilds within, never lower it.
      s.runePendant = Math.max(s.runePendant ?? 0, r.maxTier);
      break;
    case 'impAura':
      // Imp Census: permanently improve your Imps +A/+H run-wide (bumps `impBuff`; also buffs current board/hand
      // Imps). Repeats via the reward's `repeatInTurns` (folded through `multi`).
      buffImpsRunWide(s, r.attack, r.health, `Quest: ${def.name}`);
      break;
    case 'beastPlayBuff':
      // Den Marker: arm the run-wide Den-Mother aura — every Beast played/summoned gains +A/+H (climbing every
      // `per` Beasts). Applied in the recruit onSummon path (see `applyDenMarker`); stacks with a real Den Mother.
      s.denMarker = { attack: r.attack, health: r.health, step: r.step, per: r.per, count: 0 };
      break;
    case 'combatFlag': {
      // Blood Trail / Echoing Coop / Law of Teeth / The Old Hunt / Shared Circuit: arm the run-wide combat mod.
      s.questFlags ??= {};
      // DUPLICATION (owner ruling 2026-08-06). Applying the same combat flag twice used to write the same
      // value over itself, so Rune of Duplication was a silent no-op on 23 Epic runes — the owner held two
      // Rune of the Procession and saw one trigger. Two shapes, both handled here:
      //  · AMOUNT-carrying flags ACCUMULATE (`+=`), so two Finality = 14 Imps, two Gemstorm = 4 Rubies.
      //  · BOOLEAN flags can't express "more", so the copy count is recorded and the DISPATCHER fires that
      //    many times (see `flagCopies` + `runeAvenge`).
      const add = (prev: number | undefined, amount: number): number => (prev ?? 0) + amount;
      s.flagCopies ??= {};
      if (r.flag === 'oldHunt') s.questFlags.oldHunt = add(s.questFlags.oldHunt, r.amount ?? 0);
      else if (r.flag === 'sharedCircuit') s.sharedCircuitWard = add(s.sharedCircuitWard, r.amount ?? 0); // amount = Mechs warded at SoC
      else if (r.flag === 'pitWithoutEnd') s.pitWithoutEndImps = add(s.pitWithoutEndImps, r.amount ?? 0); // amount = Imps on board wipe
      else if (r.flag === 'assemblyLine') s.questFlags.assemblyLine = r.amount ?? 4; // Avenge N → a Money Bot to hand
      // The Burning Legion carries a USE COUNT rather than a boolean — an unbounded "Imps copy themselves"
      // fills the board on the first swing.
      else if (r.flag === 'burningLegion') s.questFlags.burningLegion = add(s.questFlags.burningLegion, r.amount ?? 3);
      else if (r.flag === 'runeFinality') s.questFlags.runeFinality = add(s.questFlags.runeFinality, r.amount ?? 7); // amount = Warded Imps summoned
      else if (r.flag === 'runeCinderLedger') s.questFlags.runeCinderLedger = add(s.questFlags.runeCinderLedger, r.amount ?? 6); // amount = the Imp improve
      else if (r.flag === 'runeGemstorm') s.questFlags.runeGemstorm = add(s.questFlags.runeGemstorm, r.amount ?? 2); // amount = Rubies per Kobold
      else if (r.flag === 'runeEngraving') s.questFlags.runeEngraving = true;
      else if (r.flag === 'runeUnderdog') s.questFlags.runeUnderdog = true;
      else if (r.flag === 'runeStokedMenagerie') s.questFlags.runeStokedMenagerie = true;
      else if (r.flag === 'runeGemGolem') s.questFlags.runeGemGolem = true;
      else if (r.flag === 'runeChef') s.questFlags.runeChef = true;
      else if (r.flag === 'runeDragonscale') s.questFlags.runeDragonscale = add(s.questFlags.runeDragonscale, r.amount ?? 3);
      else if (r.flag === 'runeTemperedTime') s.questFlags.runeTemperedTime = true;
      else if (r.flag === 'runeSavagery') s.questFlags.runeSavagery = true;
      else if (r.flag === 'runeCrucible') s.questFlags.runeCrucible = add(s.questFlags.runeCrucible, r.amount ?? 3);
      else if (r.flag === 'runeHerald') s.questFlags.runeHerald = true;
      else if (r.flag === 'runeBloodAndCoin') s.questFlags.runeBloodAndCoin = add(s.questFlags.runeBloodAndCoin, r.amount ?? 4); // amount = Gold banked
      else if (r.flag === 'runeWildHunt') s.questFlags.runeWildHunt = add(s.questFlags.runeWildHunt, r.amount ?? 1);        // amount = Health per Beast attack (the rune authors 1 since the 2026-08-02 rebalance; the old ?? 3 fallback was a trap)
      else if (r.flag === 'runeRemains') s.questFlags.runeRemains = add(s.questFlags.runeRemains, r.amount ?? 3);           // amount = Shop buff per 5 summons
      else if (r.flag === 'runeReinvestment') s.questFlags.runeReinvestment = add(s.questFlags.runeReinvestment, r.amount ?? 1); // amount = Shop buff per summon
      else if (r.flag === 'runeBrood') s.questFlags.runeBrood = add(s.questFlags.runeBrood, r.amount ?? 3);               // amount = Imps per combat
      else if (r.flag === 'runeLivingEchoes') s.questFlags.runeLivingEchoes = add(s.questFlags.runeLivingEchoes, r.amount ?? 3); // amount = Heralds per combat
      else if (r.flag === 'runeAttackingGems') s.questFlags.runeAttackingGems = add(s.questFlags.runeAttackingGems, r.amount ?? 1); // amount = Rubies per attack
      else if (r.flag === 'runeOverflow') s.questFlags.runeOverflow = add(s.questFlags.runeOverflow, r.amount ?? 4);           // amount = the permanent board buff
      else if (r.flag === 'runeCarrionCoin') s.questFlags.runeCarrionCoin = add(s.questFlags.runeCarrionCoin, r.amount ?? 4); // amount = the Avenge threshold
      else if (r.flag === 'runeUndertow') s.questFlags.runeUndertow = add(typeof s.questFlags.runeUndertow === 'number' ? s.questFlags.runeUndertow : 0, r.amount ?? 4); // amount = the Ward budget
      else if (r.flag === 'runeAshenPayroll') s.questFlags.runeAshenPayroll = add(s.questFlags.runeAshenPayroll, r.amount ?? 3); // amount = Imps needed
      // The 2026-08-20 pair: `amount` is a THRESHOLD, not a magnitude, so a second copy must NOT accumulate it
      // (two Returning Packs would mean "every 12 Beasts" — strictly worse than one). Assigned, and the copy
      // count below is what makes the dispatcher pay twice per trip.
      else if (r.flag === 'runeReturningPack') s.questFlags.runeReturningPack = r.amount ?? 6;   // amount = Beasts per payout
      else if (r.flag === 'runeGraveRefreshment') s.questFlags.runeGraveRefreshment = r.amount ?? 2; // amount = Echoes per free refresh
      else s.questFlags[r.flag] = true;
      // Every flag records how many copies are held; the boolean ones are the reason it exists (a second
      // `true` says nothing), and the amount ones carry it harmlessly for the badge/live-text layer.
      s.flagCopies[r.flag] = (s.flagCopies[r.flag] ?? 0) + 1;
      break;
    }
    case 'questGoldTribeBuff':
      s.questGoldTribeBuff = { tribe: r.tribe, per: r.per, attack: r.attack, health: r.health, tick: 0 };
      break;
    case 'rubyStatGain': {
      // Raises Ruby STRENGTH rather than buffing anything on the board: Rubies in hand grow with it (see
      // `rubyStatGain` in recruit.ts), and every future Ruby is minted at the new value.
      const rb = s.rubyBonus ?? { attack: 0, health: 0 };
      s.rubyBonus = { attack: rb.attack + r.attack, health: rb.health + r.health };
      for (const c of s.hand) if (CARD_INDEX[c.cardId]?.ruby) { c.attack += r.attack; c.health += r.health; }
      break;
    }
    case 'rubyExtraCasts':
      if (r.scope === 'firstEachTurn') {
        s.rubyFirstExtraCasts = (s.rubyFirstExtraCasts ?? 0) + r.amount;
        // The widest window wins when sources stack (Gem Circuit's 1 + Resonance's 2 → 2).
        s.rubyFirstCastWindow = Math.max(s.rubyFirstCastWindow ?? 1, r.firstN ?? 1);
      } else s.rubyExtraCasts = (s.rubyExtraCasts ?? 0) + r.amount;
      break;
    case 'runeFacetwright':
      s.runeFacetwright = true;
      break;
    case 'runeDuplication':
      s.runeDuplication = true;
      break;
    case 'runeSpellstone': {
      s.runeSpellstone = true;
      // Fold the run's CURRENT spell power into Rubies already in hand (2026-08-14). A minted Ruby bakes its
      // stats, and the spell-power hand-walk in `reduce` only fires on a DELTA — buying the rune moves no
      // delta, so without this a Ruby you were holding would sit at its old value forever while every Ruby
      // minted after the purchase came in bigger. Same bookkeeping `rubyStatGain` does for a `rubyBonus` gain.
      const spA = spellAttackBonus(s);
      const spH = spellHealthBonus(s);
      if (spA > 0 || spH > 0) {
        for (const card of s.hand) {
          if (CARD_INDEX[card.cardId]?.ruby) { card.attack += spA; card.health += spH; }
        }
      }
      break;
    }
    case 'runeWhiteWolf':
      // A COUNT, so a duplicated copy is a second Mentor's worth of teaching (owner ruling 2026-08-06).
      // `=== true` covers a legacy save that stored the old boolean.
      s.runeWhiteWolf = (typeof s.runeWhiteWolf === 'number' ? s.runeWhiteWolf : s.runeWhiteWolf === true ? 1 : 0) + 1;
      break;
    case 'runeProfitSharing':
      // ACCUMULATES: a duplicate makes every Gold gain pay both grants (recurring family, owner 2026-08-27).
      s.runeProfitSharing = { tribe: r.tribe, attack: (s.runeProfitSharing?.attack ?? 0) + r.attack, health: (s.runeProfitSharing?.health ?? 0) + r.health };
      break;
    case 'runeSharedTable':
      // ACCUMULATES: a duplicate doubles what each Ale cast hands out (unique-engine doubling, owner 2026-08-27).
      s.runeSharedTable = { attack: (s.runeSharedTable?.attack ?? 0) + r.attack, health: (s.runeSharedTable?.health ?? 0) + r.health };
      break;
    case 'runeDistillation':
      s.runeDistillation = true;
      break;
    case 'runeLiquidation':
      s.runeLiquidation = true;
      break;
    case 'runeRedirection':
      s.runeRedirection = true;
      break;
    case 'runeBrokerage':
      s.runeBrokerage = true;
      break;
    case 'runeSellRubies':
      s.runeSellRubies = (s.runeSellRubies ?? 0) + r.count;
      break;
    case 'runeOpenMarket':
      // ACCUMULATES (+ keeps the turn gate): a duplicate doubles the permanent Shop buff per trigger
      // (unique-engine doubling, owner 2026-08-27).
      s.runeOpenMarket = { attack: (s.runeOpenMarket?.attack ?? 0) + r.attack, health: (s.runeOpenMarket?.health ?? 0) + r.health, usedThisTurn: s.runeOpenMarket?.usedThisTurn ?? false };
      break;
    case 'runeThreshold':
      // An ARRAY: several threshold runes can be held at once, each banking its own remainder.
      // `buff` is CLONED, never shared with the (frozen, module-level) rune def: an escalating threshold
      // (Compounding Wages' `step`) mutates its own grant in place, and writing through to the def would
      // grow the printed rune for every future run in the process.
      (s.runeThresholds ??= []).push({ sourceId: def.id, meter: r.meter, per: r.per, tick: 0, grantSpell: r.grantSpell, grantAle: r.grantAle, grantRuby: r.grantRuby, grantCards: r.grantCards ? [...r.grantCards] : undefined, castStatSpell: r.castStatSpell, buff: r.buff ? { ...r.buff, step: r.buff.step ? { ...r.buff.step } : undefined } : undefined, rubyAll: r.rubyAll, oncePerTurn: r.oncePerTurn, once: r.once, grantGoldNextTurn: r.grantGoldNextTurn, resetEachTurn: r.resetEachTurn });
      break;
    case 'motherlode':
      // ACCUMULATES: two Motherlodes play each incoming Ruby on 4 random minions (recurring family, owner 2026-08-27).
      s.motherlode = { count: (s.motherlode?.count ?? 0) + r.count, tribe: r.tribe };
      break;
    case 'consumeDoubleFirstEachTurn':
      s.consumeDoubleFirstEachTurn = true;
      break;
    case 'spellCost':
      s.spellCostMod += r.cost;
      break;
    case 'endlessVerse':
      s.spellFirstDoubleEachTurn = true;
      s.endlessVerse = { per: r.per, tick: 0 };
      break;
    case 'shopBuff':
      applyRunShopBuff(s, r.attack, r.health, 'Quest reward');
      break;
    case 'shopBuffPerShouts':
      s.shopBuffPerShouts = { per: r.per, attack: r.attack, health: r.health, tick: 0 };
      break;
    case 'shopBuffOnRefresh':
      s.shopBuffOnRefresh = { attack: r.attack, health: r.health, step: r.step, per: r.per, grown: 0, tick: 0 };
      break;
    case 'shopAuraGrowing':
      // Rune of the Wheel: the base +A/+H lands ONCE, now — it's a standing aura, so it rides the permanent
      // `tavernBuyBonus` channel (current AND future offers inherit it). The meter then improves it by
      // +step/+step every `per`-th refresh — see `applyShopRefreshQuestBuff`.
      applyRunShopBuff(s, r.attack, r.health, 'Rune of the Wheel');
      s.shopAuraGrow = { step: r.step, per: r.per, tick: 0, grown: 0 };
      break;
    case 'aleExtraCasts':
      s.aleExtraCasts = (s.aleExtraCasts ?? 0) + (r.amount ?? 1);
      break;
    case 'tribeRallySlaughterExtra':
      // War Council: arm the tribe-scoped extra trigger. One field, any tribe — see the note on the flag.
      s.questTribeRallySlaughter = r.tribe;
      break;
    case 'shoutRepeat':
      // Hoardwake / The Hoard Wakes (always) → +1 permanent Battlecry trigger (stacks); Warm Embers
      // (firstEachRound) → the first Shout each turn triggers twice.
      if (r.scope === 'always') s.shoutExtraAlways = (s.shoutExtraAlways ?? 0) + 1;
      else s.shoutFirstDoubleEachRound = true;
      break;
    case 'endOfTurnRepeat':
      // Parliament of Flame: your End-of-Turn effects trigger an extra time (stacks, like Chronos).
      s.endOfTurnExtra = (s.endOfTurnExtra ?? 0) + 1;
      break;
    case 'recurringEndOfTurn':
      // Ruby grants pay out ONCE IMMEDIATELY on top of the per-turn recurrence (owner ask 2026-08-06:
      // "when you get the rune it should give you a gem immediately") — buying Resonance mid-turn should
      // not feel like buying nothing until End of Turn. Scoped to the Ruby effects only: the other
      // recurring effects (shop-eating Demons, Facetwright) are turn-structure rituals, not resources.
      if (r.effect === 'grantRuby') mintRubies(s, 1);
      if (r.effect === 'grantRuby2') mintRubies(s, 2);
      // Echoing Roar / The Hoard Wakes: a recurring End-of-Turn effect fired every turn for the rest of the run.
      // `turns` bounds the recurrence (Quick Study); without it the effect lasts the run, as before.
      if (r.turns) (s.questRecurringLimited ??= []).push({ effect: r.effect, turnsLeft: r.turns });
      else (s.questRecurringEndOfTurn ??= []).push(r.effect);
      break;
    case 'gainGold':
      // `immediate` → spend it THIS shop (Rune of Small Fortune: "Get N Gold immediately"). Otherwise bank it
      // into your NEXT shop (Bone Ledger — the standard "Get N Gold" channel, surviving the per-turn embers
      // reset like Hoarder / Bounty Bot's bonus Gold). A Runeforge opens during a shop turn, so += is immediate.
      if (r.immediate) gainGold(s, r.amount);
      else s.bonusEmbersNextTurn = (s.bonusEmbersNextTurn ?? 0) + r.amount;
      break;
    case 'echoRepeat':
      // Funeral Engine (always) → +1 permanent Echo trigger (stacks like Sylus); Grave Contract / Last Rites
      // (firstEachCombat) → the first Echo each combat fires one extra time (additive across both).
      if (r.scope === 'always') s.echoExtraAlways = (s.echoExtraAlways ?? 0) + 1;
      else s.echoFirstEachCombat = (s.echoFirstEachCombat ?? 0) + 1;
      break;
    case 'boneThrone':
      // The Bone Throne: every `every` friendly deaths in combat, trigger your leftmost Echo (permanent).
      s.boneThroneStep = r.every;
      break;
    case 'rallyRepeat':
      // Infinite Assembly (always) → +1 permanent Rally trigger; Spark Permit / Overclocked Core
      // (firstEachCombat) → the first Rally each combat fires one extra time (additive across both).
      if (r.scope === 'always') s.rallyExtraAlways = (s.rallyExtraAlways ?? 0) + 1;
      else s.rallyFirstEachCombat = (s.rallyFirstEachCombat ?? 0) + 1;
      break;
    case 'fodderReward':
      // Small Offering: queue Fodder into your next shop + a persistent run-wide Fodder buff.
      for (let i = 0; i < (r.fodder ?? 0); i++) (s.pendingTavern ??= []).push('fred');
      if ((r.attack ?? 0) > 0 || (r.health ?? 0) > 0) buffFodderRunWide(s, r.attack ?? 0, r.health ?? 0, `Quest: ${def.name}`);
      break;
    case 'gainMaxGold':
      s.maxGoldBonus = (s.maxGoldBonus ?? 0) + r.amount; // Shop License: permanent +max Gold, above the cap
      gainGold(s, r.amount); // reflect the raised max in THIS turn's spendable Gold too
      break;
    case 'discover': {
      // Reward-kind 'discover' — open a minion Discover at your CURRENT tier, or at `r.tier` when the reward
      // PINS one (Rune of the Scout → Tier 5, Rune of the Champion → Tier 6, Rune of the Summit → Tier 7).
      // An AUTHORED tier is honoured as written: it is deliberate content, and clamping it to the run's
      // ceiling would silently downgrade a Tier 7 reward to Tier 6 whenever the Summit rift is off — which
      // is exactly when those rewards are the ONLY way to reach Tier 7. Only a DERIVED tier (falling back to
      // the live shop tier) is clamped, since that one can legitimately overshoot.
      const t = r.tier ?? Math.min(s.tier, maxTierFor(s.rift));
      // queueDiscover, NOT openDiscover: a quest can complete on the same turn the Runeforge opens, and two
      // quests can pay out together — a direct open would draw this offer on top of the other modal.
      // `filter` (Catacomb / Rising Echoes → an Echo minion) narrows the offer; `grantKeywords` (Rising Echoes
      // → Rise + Taunt) rides on the RUN rather than the spec, because it is consumed when the PICK is taken,
      // not when the offer opens. Note it drops `exactTier` when filtered: pinning the exact tier as well as
      // the trigger usually empties the pool, and an empty Discover is a reward that silently never arrives.
      if (r.filter) queueDiscover(s, { kind: 'minion', tier: t, filter: r.filter });
      else queueDiscover(s, { kind: 'minion', tier: t, exactTier: t });
      if (r.grantKeywords?.length) s.discoverKeywords = [...r.grantKeywords];
      break;
    }
    case 'discoverGreaterQuest':
      // Rune of the Second Path: Discover one of the minions Greater Quests grant as rewards.
      queueDiscover(s, { kind: 'pool', ids: greaterQuestRewardMinions() });
      break;
    case 'dupeFirstBuy':
      s.dupeFirstBuyEachTurn = true; // Dupes: the first minion bought each turn is copied to hand
      break;
    case 'spellRepeat':
      // Ancient Runes (always) → all spells cast twice; Spell Thesis (firstEachTurn) → first spell each turn twice.
      if (r.scope === 'always') s.spellDoubleAlways = true;
      else s.spellFirstDoubleEachTurn = true;
      break;
    case 'minionCost':
      s.minionCostOverride = r.cost; // Merchant's Mark / Coran's Merchant's Road: shop minions cost this much
      break;
    // ── Hero quest rewards (Fi / Coran, 2026-08-21) ──
    case 'grantRune': {
      // Spare Forge / Runic Passage: a random rune of that rarity, handed over outright — no forge, no pick,
      // no Gold. It goes through the SAME apply-then-own path a BOUGHT rune takes (`case 'buyRune'`), so a
      // granted rune is indistinguishable from a forged one downstream: badge row, tallies, saves, replays.
      const owned = new Set(s.ownedRunes ?? []);
      const pool = (r.rarity === 'epic' ? EPIC_RUNES : RUNES).filter((rn) => !owned.has(rn.id));
      if (pool.length === 0) break; // owns every rune of the rarity — a no-op beats granting a duplicate
      const rng = makeRng(s.rngCursor);
      const rune = pool[rng.int(pool.length)]!;
      s.rngCursor = rng.state();
      applyQuestReward(s, { id: rune.id, name: rune.name, reward: rune.reward } as unknown as QuestDef, true, 'rune');
      (s.ownedRunes ??= []).push(rune.id);
      break;
    }
    case 'freeFirstBuy':
      // First Pick: shares the Freedom rift's per-turn spend marker, so holding both never yields two freebies.
      s.questFreeFirstBuy = true;
      break;
    case 'tier7Access':
      s.tier7Access = true; // Open Road / Summit Passage — the flag `hasTier7Access` reads
      break;
    case 'gildCopies':
      s.gildCopies = r.copies; // Gilded Shortcut: Gild at 2 copies (read via `gildCopiesNeeded`)
      break;
    case 'upgradeShopTier': {
      // Summit Passage's free step: raise the tier without charging, then re-base the next price off the new
      // tier exactly as a paid upgrade does (the `payCommission` citadel idiom). Reads `hasTier7Access`, so the
      // Tier-7 unlock sitting EARLIER in the same `multi` reward is already in effect and this step can use it.
      const ceiling = hasTier7Access(s) ? 7 : maxTierFor(s.rift);
      for (let i = 0; i < r.by && s.tier < ceiling; i++) s.tier += 1;
      s.upgradeCost = s.tier >= ceiling ? 0 : (CONFIG.upgradeCost[s.tier + 1] ?? 0);
      break;
    }
    case 'attachmentDeal':
      // Attachment Issues: every shop is guaranteed a Magnetic offer, and every Attachment costs `cost` Gold.
      s.attachmentCost = r.cost;
      s.alwaysAttachmentShop = true;
      // Apply to the CURRENT shop right away: price every Magnetic offer at the deal (the next roll re-applies +
      // guarantees one). No Magnetic in the current shop → it appears after the next refresh.
      for (const o of s.shop) if (CARD_INDEX[o.cardId]?.keywords.includes('M')) o.cost = r.cost;
      break;
    case 'friedCircuits':
      s.friedCircuitsStepAtk = r.stepAttack; // Fried Circuits: each buy buffs shop Mechs by step × buys (escalating)
      s.friedCircuitsStepHp = r.stepHealth;
      s.friedCircuitsBuys = 0;
      break;
    case 'undeadSpellAura':
      s.forsakenWillAttack = r.attack; // Forsaken Will: each spell cast grants your Undead aura +attack
      break;
    case 'baneDemonAura':
      // Bane's Existence: arm the widen — Banes now also buff all your Demons run-wide on each Battlecry trigger.
      s.baneBuffsDemons = { attack: r.attack, health: r.health };
      break;
    case 'slaughterRepeat':
      s.slaughterFirstEachCombat = (s.slaughterFirstEachCombat ?? 0) + 1; // Author's Hand
      break;
    case 'shoutEdgeBuff':
      // Twin Sun Oath: every Shout you trigger buffs your leftmost + rightmost board minion (stacks if re-armed).
      s.shoutEdgeBuff = {
        attack: (s.shoutEdgeBuff?.attack ?? 0) + r.attack,
        health: (s.shoutEdgeBuff?.health ?? 0) + r.health,
      };
      break;
    case 'goldFodder':
      // Food for Gold: arm the per-`per`-Gold Fodder drip (spendGold ticks it). Fresh remainder on arm.
      s.foodForGold = { per: r.per, attack: r.attack, health: r.health };
      s.foodForGoldTick = 0;
      break;
    // ── Runeforge rune rewards ──
    case 'runeSpellDrip':
      s.spellDripPer = r.per; // Rune of Spellslinging: every `per` Gold spent → a random spell (spendGold ticks it)
      s.spellDripTick = 0;
      break;
    case 'runeStructure':
      s.runeStructure = true; // Rune of Structure: playing an Attachment also gives a random spell
      break;
    case 'runeConsume':
      // Rune of Consumption: each Consume bumps the Fodder aura. ACCUMULATES — a duplicate doubles the bump
      // per Consume (recurring family, owner 2026-08-27).
      s.runeConsume = { attack: (s.runeConsume?.attack ?? 0) + r.attack, health: (s.runeConsume?.health ?? 0) + r.health };
      break;
    case 'goldPouchValue':
      s.goldPouchValue = r.value; // Rune of Pillaging: your Gold Pouches are worth this much
      break;
    case 'runeSummoning':
      s.runeSummoning = true; // Rune of Summoning: each spell cast improves your Imps +1/+1
      break;
    case 'runeKindling':
      s.runeKindling = true; // Rune of Kindling: each spell cast gives your leftmost minion +3/+3
      break;
    case 'runeScales':
      s.runeScales = true; // Rune of Scales: each spell cast gives your Dragons +1/+1
      break;
    case 'runeHappyBirthday':
      // GIFTS (owner design 2026-08-26): a random Gift now, then another every 2 turns. The tick counts waves
      // since the last payout, so "every 2 turns" is exact regardless of when the rune was bought.
      s.runeHappyBirthday = true;
      s.giftBirthdayTick = 0;
      grantRandomGift(s);
      break;
    case 'runeMerryChristmas':
      // The epic half: a CHOICE of Gift, every Start of Turn — first one immediately, like the Long Shift.
      s.runeMerryChristmas = true;
      queueDiscover(s, { kind: 'pool', ids: [...GIFT_IDS] });
      break;
    case 'runeLongShift':
      s.runeLongShift = true; // Rune of the Long Shift: Discover 2 Shop spells, repeated every Start of Turn
      // Owner reword 2026-08-17 ("Discover 2 Shop Spells. Repeat every start of turn"): the first pair fires
      // the moment you take the rune, rather than making you wait a turn for a 2-cost epic to do anything.
      queueDiscover(s, { kind: 'spell' });
      queueDiscover(s, { kind: 'spell' });
      break;
    case 'runeBartering':
      s.runeBartering = true; // Rune of Bartering: Shout minions sell for 2 Gold
      break;
    case 'runeTwinGilding':
      s.runeTwinGilding = true; // Rune of Twin Gilding: Gild at 2 copies instead of 3
      break;
    case 'runeDenMother':
      s.runeDenMother = true; // Rune of the Den Mother: Den Mother buffs herself too
      break;
    case 'runeDisplayCase':
      s.runeDisplayCase = true; // Rune of the Display Case: Market Tormentor also enchants the left-most slot
      break;
    case 'runeBlart':
      s.runeBlart = true; // Rune of Blart: Bob Blart gains both end Shop minions' stats
      break;
    case 'runeVaultkeeper':
      s.runeVaultkeeper = true; // Rune of the Vaultkeeper: Vaultkeeper also buffs an adjacent minion
      break;
    case 'runeSellersMarket': s.runeSellersMarket = true; break; // sell → board +4/+3
    case 'runeFreshPages':
      s.runeFreshPages = true; // Discover a Shop spell, repeated every Start of Turn
      // Owner reword 2026-08-20 ("Discover a spell. Repeat at start of turn."), same shape as
      // `runeLongShift`: the first Discover fires on purchase instead of making you wait a turn.
      queueDiscover(s, { kind: 'spell' });
      break;
    case 'runeStrangeCaravan': s.runeStrangeCaravan = true; break; // Start of Turn: uncontrolled-type minion
    case 'runeWindowShopping': s.runeWindowShopping = true; break; // first 3 Refreshes each turn are free
    case 'runeOpenEnrollment': s.runeOpenEnrollment = true; break; // Refresh offers an extra dominant-type minion
    case 'runeTradeIn': s.runeTradeIn = true; break;             // first sale → next minion of that type −1 Gold
    case 'runeRestocking': s.runeRestocking = true; break;       // first buy refills its slot with a 2-Gold minion
    case 'runeCollector': s.runeCollector = true; break;         // 3 types bought → Discover one of them
    case 'runeBargainBin': s.runeBargainBin = true; break;       // first Refresh fills the Shop with 1-Gold minions
    case 'runeShopkeep':
      // Rune of Shopkeep: reduce the upgrade cost by 3 NOW, and again each End of Turn (see applyEndOfTurn).
      s.runeShopkeep = true;
      s.upgradeCost = Math.max(CONFIG.upgradeCostFloor, s.upgradeCost - 3);
      break;
    case 'runeScale':
      s.runeScale = { count: r.count, attack: r.attack, health: r.health, per: r.per, tick: 0 }; // Gold-spend buffs random allies
      break;
    case 'runeCopies':
      // Rune of Copies: arm the per-turn copy — at the start of each shop, copy a random board minion to hand.
      s.runeCopies = true;
      break;
    case 'runeEmpowerment':
      s.runeEmpowerment = true; // Rune of Empowerment (Epic): your hero power triggers twice
      break;
    case 'runeTempering':
      s.runeTempering = true; // Rune of Tempering: the first Attachment each turn also grants Ward
      break;
    case 'runeReplication':
      s.runeReplication = true; // Rune of Replication: the first Attachment each turn copies onto the leftmost Mech
      break;
    case 'runeCoffers': s.runeCoffers = true; break;
    case 'runeEnchantment': s.runeEnchantment = true; break;
    // Rune of the Crown ACCUMULATES its payoff: same 6-spell meter, doubled extra per copy (threshold family,
    // owner 2026-08-27: "double the OUTPUT", never the meter).
    case 'runeCrown': s.runeCrown = { per: r.per, attack: (s.runeCrown?.attack ?? 0) + r.attack, health: (s.runeCrown?.health ?? 0) + r.health }; break;
    case 'runeLapidary': s.runeLapidary = true; break;
    case 'runeLastingCadence': s.runeLastingCadence = true; break;
    case 'runeCombatProwess': s.runeCombatProwess = true; break;
    case 'runeDeep': s.runeDeep = r.tier; break;
    // Guiding Candle ACCUMULATES the window: two copies = the first FOUR refreshes each turn are Tier-6-only
    // (unique-engine doubling, owner 2026-08-27). The live `left` widens with it so the extra lands this turn too.
    case 'runeGuidingCandle': s.runeGuidingCandle = { count: (s.runeGuidingCandle?.count ?? 0) + r.count, tier: r.tier, left: (s.runeGuidingCandle?.left ?? 0) + r.count }; break;
    // Muster COUNTS its armed refreshes: a duplicate re-arms, so two copies make the next two refreshes
    // musters (one-shot family, owner 2026-08-27: "work for the first 2 refreshes this turn").
    case 'runeMuster': s.runeMuster = (typeof s.runeMuster === 'number' ? s.runeMuster : s.runeMuster ? 1 : 0) + 1; break;
    // Foundry keeps its meter on a re-apply (a duplicate must not reset progress); the payout doubles via
    // `runeStacksOf` at the trip (threshold family, owner 2026-08-27).
    case 'runeFoundry': s.runeFoundry = { per: r.per, sold: s.runeFoundry?.sold ?? 0 }; break;
    case 'runeCorruptedTome': s.runeCorruptedTome = true; break;
    case 'runeGroveweaver': s.runeGroveweaver = true; break;
    case 'runeSharedPour': s.runeSharedPour = true; break;
    case 'runeAftermarket': s.runeAftermarket = true; break;
    case 'runeSpellhide': s.runeSpellhide = true; break;
    case 'runeSpellmarket': s.runeSpellmarket = true; break;
    case 'runeLastWord': s.runeLastWord = true; break;
    case 'runeRunicHoard': s.runeRunicHoard = true; break;
    case 'runeBanquetHall': s.runeBanquetHall = true; break;
    case 'runeCrucibleChoir': s.runeCrucibleChoir = true; break;
    case 'runeFullMeasure': s.runeFullMeasure = true; break;
    case 'runeMountainTrade': s.runeMountainTrade = true; break;
    case 'runeOpenAppetite': s.runeOpenAppetite = true; break;
    case 'runeBroodmaster': s.runeBroodmaster = true; break;
    case 'runeSharedReflection': s.runeSharedReflection = true; break;
    case 'runeUnbrokenVein': s.runeUnbrokenVein = true; break;
    case 'runeLivingGrowth': s.runeLivingGrowth = true; break;
    case 'runeSecondLife': {
      // Taunt + Rise on every Scavver, the ones already on the board included — a rune that only reached
      // FUTURE copies would read as doing nothing to the board you bought it for. New arrivals are covered by
      // `applySecondLife` on the buy/play paths.
      s.runeSecondLife = true;
      for (const c of s.board) applySecondLife(s, c);
      for (const c of s.hand) applySecondLife(s, c);
      break;
    }
    case 'runeHoardcalling': s.runeHoardcalling = true; break;
    case 'runeConduit': s.runeConduit = true; break;
    case 'runeVault': s.runeVault = true; break;
    case 'runeAltar': {
      // Sell the ENTIRE board through the sell case's own rituals: the shared value helper, then the on-sell
      // and minion-sold notifications, so Hoard Whelp / Voicekeeper behave exactly as a manual sell. The
      // 3-Gold premium lands once per body on top of the normal sell value.
      const toSell = [...s.board];
      for (const sold of toSell) {
        const i = s.board.findIndex((c) => c.uid === sold.uid);
        if (i < 0) continue; // an on-sell effect removed it already
        s.board.splice(i, 1);
        gainGold(s, sellValueWithBonus(sold, s) + (r.goldPer ?? 3));
        if (s.nextSellBonus) s.nextSellBonus = 0;
        fireOnSell(s, sold);
        s.soldThisTurn = [...(s.soldThisTurn ?? []), sold.cardId];
        fireOnMinionSold(s, sold);
      }
      break;
    }
    case 'runeLorekeeping': s.runeLorekeeping = true; break;
    case 'runeThrift': s.runeThrift = true; break;
    case 'runeFlagship': s.runeFlagship = true; break;
    case 'runeBrew': s.runeBrew = true; break;
    case 'runeEvolution': {
      // Transform each board minion into a random minion of `tier` from the run's pinned pool. Buffs and
      // golden do NOT carry — it is a transform, the same contract as spellTransformSameTier.
      const pool = poolOf(s).all.filter((c) => !c.spell && !c.token && !c.ruby && c.tier === (r.tier ?? 4));
      if (pool.length > 0) {
        const rng = makeRng(s.rngCursor);
        s.board = s.board.map((c) => {
          const pick = pool[rng.int(pool.length)]!;
          return { uid: c.uid, cardId: pick.id, tribe: pick.tribe, attack: pick.attack, health: pick.health, keywords: [...pick.keywords], golden: false };
        });
        s.rngCursor = rng.state();
      }
      break;
    }
    case 'runeTranscription': s.runeTranscription = (s.runeTranscription ?? 0) + (r.count ?? 2); break;
    // Treasure Map schedules into an ARRAY: a duplicate books a SECOND payout with its own countdown instead
    // of resetting the first (one-shot family, owner 2026-08-27). Legacy single-slot saves still tick.
    case 'runeTreasureMap': (s.runeTreasureMaps ??= []).push({ turns: r.turns ?? 2, gold: r.gold ?? 10 }); break;
    case 'runeGoldenSplinter': s.runeGoldenSplinter = { at: r.at ?? 15, tier: r.tier ?? 5 }; break;
    case 'runeRefrain':
      s.runeRefrain = true; // Rune of Refrain: your 3rd Shout each turn returns the turn's first Shout to hand
      break;
    case 'runeTransfusion':
      s.runeTransfusion = true; // Rune of Transfusion: a Demon Consume also feeds your leftmost minion
      break;
    case 'runeEndlessAppetite':
      s.runeEndlessAppetite = true; // Rune of Endless Appetite: the first Consume each turn fans out to all other Demons
      break;
    case 'runeSummit':
      // Rune of the Summit: every 2nd shop from here opens a Tier 7 Discover. Tick starts at 0, so the
      // first payout lands on the SECOND shop after purchase — "in 2 turns", as written.
      s.runeSummit = true;
      s.runeSummitTick = 0;
      break;
    case 'mintRubies':
      // Rune of Gemcutting: Rubies at a FIXED stat line, not 1/1 + rubyBonus.
      mintRubies(s, r.count, undefined, { attack: r.attack, health: r.health });
      break;
    case 'runeSecondPath':
      // Two Tier-6 Discovers whose picks are overwritten to 20/20 (owner sheet 2026-07-31).
      queueDiscover(s, { kind: 'minion', tier: 6, exactTier: 6, setStats: { attack: 20, health: 20 } });
      queueDiscover(s, { kind: 'minion', tier: 6, exactTier: 6, setStats: { attack: 20, health: 20 } });
      break;
    case 'runeChampion': {
      // A T4, T5 and T6 Discover of the board's dominant tribe, resolved NOW (forge time) — the same
      // dominant-tribe read Tribe Portal uses. No dominant tribe (empty/neutral board) → untyped Discovers.
      const champTribe = dominantBoardTribe(s) ?? undefined;
      for (const t of [4, 5, 6]) queueDiscover(s, { kind: 'minion', tier: t, exactTier: t, tribe: champTribe });
      break;
    }
    case 'runeContraband':
      s.runeContraband = true;
      break;
    case 'runeCadence':
      s.runeCadence = true;
      break;
    case 'runeGemscript':
      s.runeGemscript = true;
      break;
    case 'runeMatriarch':
      s.runeMatriarch = true;
      break;
    case 'runeConductor':
      // Owner sheet 2026-07-31: End of Turn effects trigger 2 MORE times — riding `endOfTurnExtra`, the same
      // permanent repeat counter Parliament of Flame uses (was: a start-of-shop full EoT re-trigger).
      s.endOfTurnExtra = (s.endOfTurnExtra ?? 0) + 2;
      break;
    case 'runeMastery':
      s.runeMastery = true; // Rune of Mastery: every Improve step applies twice (shop + combat)
      break;
    case 'openEpicRuneforge':
      // Deferred: arm it now, open at the START of NEXT turn (after this turn's combat). `pendingForgeDeferred`
      // blocks the mid-turn modal-close drains from opening it early (owner bug 2026-07-13: it opened mid-turn
      // and the player had already spent the Gold they needed for the runes). Reached by The Epic Runeforge quest.
      s.pendingEpicRuneforge = true;
      s.pendingForgeDeferred = true;
      break;
    case 'scheduleRuneforge':
      // Arm a Runeforge visit for a future turn's start (opened by advanceCombat's start-of-turn sequencing).
      // `onWave` pins the Epic forge to an absolute wave (Rune of the Epic Forge → 8); otherwise it's next turn —
      // deferred so a mid-turn modal-close can't open it on the turn the quest completed (owner bug 2026-07-13).
      // The slot already booked (the Runeguard hero schedules its own wave-8 forge): the "ADDITIONAL" forge
      // must not silently merge into the one they were already getting (audit find 2026-08-06) — it arrives
      // as a deferred next-turn forge instead.
      if (r.onWave != null && s.epicForgeWave != null) { s.pendingEpicRuneforge = true; s.pendingForgeDeferred = true; }
      else if (r.onWave != null) s.epicForgeWave = r.onWave;
      else if (r.forge === 'epic') {
        s.pendingEpicRuneforge = true;
        s.pendingForgeDeferred = true;
        // "…next turn INSTEAD OF turn 9": claim the run's Epic forge so the standing turn-9 one stands down.
        s.epicForgeClaimed = true;
      }
      else s.pendingBasicForge = { gold: r.gold, deferred: true };
      break;
    case 'multi':
      // The Hoard Wakes: several rewards at once — apply each sub-reward through this same path.
      for (const sub of r.rewards) applyQuestReward(s, { ...def, reward: sub }, allowRepeat);
      break;
  }
}

/** Fold a persistent "your <tribe> have +A/+H wherever they are" aura into the run: stack it into the tribe's
 *  buy-time aura channel (so future creations inherit it) AND buff every current board + hand member now. Only
 *  Beast ships a quest aura today (its `beastBuyAtk`/`beastBuyHp` channel); other tribes still get the immediate
 *  board/hand buff and wire their own buy-channel when they get auras. Shared by tribeAura / scalingTribeAura /
 *  The Old Hunt / Pack Mentality growth. */
function grantTribeAura(s: RunState, tribe: Tribe, attack: number, health: number, label: string): void {
  if (tribe === 'beast') {
    s.beastBuyAtk = (s.beastBuyAtk ?? 0) + attack;
    s.beastBuyHp = (s.beastBuyHp ?? 0) + health;
  }
  if (attack !== 0 || health !== 0) {
    for (const c of [...s.board, ...s.hand]) {
      if (isTribe(c, tribe)) addBuff(c, label, attack, health);
    }
  }
}

/** This combat's count of a quest objective's event (combat-phase only): the Echo objective reads the
 *  Deathrattle tally; attack / summonCombat / slaughter read `playerQuestTally`, tribe-narrowed. */
function combatEventCount(result: CombatResult, o: { event: QuestObjectiveEvent; tribe?: Tribe }): number {
  if (o.event === 'deathrattle') return result.playerDeathrattles;
  if (o.event === 'friendlyDeath') return result.playerDeaths ?? 0;
  if (o.event === 'rally') return result.playerRallies ?? 0;
  if (o.event === 'summonImp') return result.playerImpsSummoned ?? 0;
  const t = result.playerQuestTally;
  if (!t) return 0;
  if (o.event === 'attack') return o.tribe ? (t.attackByTribe[o.tribe] ?? 0) : t.attack;
  // A `summon` objective (Forest Grove's "Summon 5 Beasts") counts summons in BOTH phases — recruit summons tick
  // via the reducer's `advanceQuests`, and combat summons add here (they read the same combat summon tally).
  if (o.event === 'summonCombat' || o.event === 'summon') return o.tribe ? (t.summonCombatByTribe[o.tribe] ?? 0) : t.summonCombat;
  if (o.event === 'slaughter') return o.tribe ? (t.slaughterByTribe[o.tribe] ?? 0) : t.slaughter;
  if (o.event === 'slaughterKeyword') return t.slaughterKeyword; // The Red Trail — tribe-agnostic
  // "Give <tribe> N total stats" (Skybound Pact / Taragosa's Inheritance): combat buffs to that tribe, on top of
  // the recruit-phase diff (see the `tribeStats` advance in advanceQuests).
  if (o.event === 'tribeStats') return o.tribe ? (t.statGainByTribe[o.tribe] ?? 0) : 0;
  return 0;
}

/** Advance every active, incomplete COMBAT-phase quest by this fight's tally (+N); complete + apply the reward
 *  at the threshold. Called once per settled combat (the recruit-phase `advanceQuests` handles +1 actions). */
function advanceCombatQuests(s: RunState, result: CombatResult): void {
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def) continue;
    if (def.objective.event === 'compound') {
      advanceCompound(s, aq, def, (def.objective.parts ?? []).map((p) => combatEventCount(result, p)));
      continue;
    }
    const inc = combatEventCount(result, def.objective);
    if (inc <= 0) continue;
    aq.progress += inc;
    resolveQuestThreshold(s, aq, def);
  }
}

/** Pack Mentality: grow each registered scaling aura by this combat's tally of its trigger event, stepping the
 *  aura up once per `per` accrued (leftover carries in `progress`). */
function growScalingAuras(s: RunState, result: CombatResult): void {
  for (const sa of s.questScalingAuras ?? []) {
    // A Beast + summon-in-combat aura (Pack Mentality) grows LIVE during the fight — its magnitude is already
    // folded in via `playerBeastBuy*Gain` above, so here we only sync the leftover progress the engine reported
    // (re-growing from the tally would double-count).
    if (sa.tribe === 'beast' && sa.event === 'summonCombat') {
      if (result.playerBeastScaleProgress !== undefined) sa.progress = result.playerBeastScaleProgress;
      continue;
    }
    const inc = combatEventCount(result, { event: sa.event, tribe: sa.tribe });
    if (inc <= 0) continue;
    sa.progress += inc;
    while (sa.progress >= sa.per) {
      sa.progress -= sa.per;
      grantTribeAura(s, sa.tribe, sa.stepAttack, sa.stepHealth, 'Pack Mentality');
    }
  }
}

/** The ONGOING combat mods a not-yet-completed quest's reward would arm — so `simulate` can activate them the
 *  instant the quest completes MID-COMBAT (Feeding Line → `{feedingLine:true}`). Only boolean `combatFlag`
 *  rewards whose mod key equals the flag name (the common ongoing effects); the amount-based flags
 *  (oldHunt / assemblyLine / sharedCircuit / pitWithoutEnd) and non-flag rewards get no mid-combat mod — they
 *  still complete + arm at settle for the NEXT fight. Walks `multi` rewards. Returns undefined when none. */
function pendingQuestMods(reward: QuestDef['reward']): QuestCombatMods | undefined {
  const out: Record<string, boolean> = {};
  const walk = (r: QuestDef['reward']): void => {
    if (r.kind === 'combatFlag' && r.flag !== 'oldHunt' && r.flag !== 'assemblyLine' && r.flag !== 'sharedCircuit' && r.flag !== 'pitWithoutEnd') {
      out[r.flag] = true;
    } else if (r.kind === 'multi') for (const sub of r.rewards) walk(sub);
  };
  walk(reward);
  return Object.keys(out).length ? (out as QuestCombatMods) : undefined;
}

/** The first CARD a quest's reward grants (named grant / gilded copy), walking `multi` — flown to hand as the
 *  live "→ hand" visual the moment the quest completes mid-combat. Undefined for non-card rewards. */
function pendingRewardCard(reward: QuestDef['reward']): string | undefined {
  let found: string | undefined;
  const walk = (r: QuestDef['reward']): void => {
    if (found) return;
    if (r.kind === 'grant') found = r.cards?.[0] ?? r.grantGolden?.[0];
    else if (r.kind === 'multi') for (const sub of r.rewards) walk(sub);
  };
  walk(reward);
  return found;
}

/** The player's active, INCOMPLETE quests whose objective counts a COMBAT event — threaded into `simulate` so
 *  they can complete + activate mid-fight (see `CombatSideState.pendingQuests`). Compound / recruit-only
 *  objectives are excluded (they settle post-combat as before). */
const PENDING_COMBAT_EVENTS = new Set<QuestObjectiveEvent>(['attack', 'summonCombat', 'summon', 'slaughter', 'slaughterKeyword', 'deathrattle', 'rally']);
export function buildPendingCombatQuests(s: RunState): PendingCombatQuest[] {
  const out: PendingCombatQuest[] = [];
  for (const aq of s.activeQuests ?? []) {
    if (aq.completed) continue;
    const def = QUEST_INDEX[aq.questId];
    if (!def) continue;
    const o = def.objective;
    if (!PENDING_COMBAT_EVENTS.has(o.event) || typeof o.count !== 'number') continue;
    out.push({ questId: aq.questId, event: o.event, count: o.count, tribe: o.tribe, progress: aq.progress, mods: pendingQuestMods(def.reward), rewardCardId: pendingRewardCard(def.reward) });
  }
  return out;
}

/** Build the run-wide combat modifiers (`QuestCombatMods`) threaded into `simulate()`: the Beast Health aura
 *  plus any armed quest combat flags. */
export function questCombatMods(s: RunState): QuestCombatMods {
  const f = s.questFlags;
  // Pack Mentality's LIVE growth config, if a Beast + summon-in-combat scaling aura is armed — the combat engine
  // grows the aura per `per` Beasts summoned and carries the gain back (so settle skips re-growing it, below).
  const beastScale = (s.questScalingAuras ?? []).find((a) => a.tribe === 'beast' && a.event === 'summonCombat');
  return {
    beastAuraHp: s.beastBuyHp || undefined,
    beastSummonScale: beastScale ? { per: beastScale.per, stepAttack: beastScale.stepAttack, stepHealth: beastScale.stepHealth, progress: beastScale.progress } : undefined,
    flagCopies: s.flagCopies, // Duplication: how many copies of each flag — dispatchers fire that many times
    // Sable: the bond only carries into the fight it was forged for (it "lasts 1 turn", combat included).
    soulbind: s.sableBond && s.sableBond.wave === s.wave ? { a: s.sableBond.a, b: s.sableBond.b } : undefined,
    flashPick: hasPower(s, 'firstOrLast') ? s.flashPick : undefined,
    flashCopies: hasPower(s, 'firstOrLast') ? wishboneReps(s) : undefined, // Wishbone: 2 copies
    bloodTrail: f?.bloodTrail,
    echoingCoop: f?.echoingCoop,
    lawOfTeeth: f?.lawOfTeeth,
    tribeRallySlaughterExtra: s.questTribeRallySlaughter, // War Council: the tribe-scoped twin
    oldHuntStep: f?.oldHunt,
    runeMatriarch: s.runeMatriarch || undefined, // the combat half of Runebloom's proc doubles too
    runeMammoth: s.questFlags?.runeMammoth || undefined, // Mammoths give Health 1:1
    runeWarpath: s.questFlags?.runeWarpath || undefined, // left-most's attack chains into the right-most's
    echoExtraAlways: s.echoExtraAlways || undefined,
    echoFirstEachCombat: s.echoFirstEachCombat || undefined,
    boneThroneStep: s.boneThroneStep || undefined,
    assemblyLineStep: f?.assemblyLine || undefined, // Assembly Line: Avenge N → a Money Bot to hand
    rallyExtraAlways: s.rallyExtraAlways || undefined,
    rallyFirstEachCombat: s.rallyFirstEachCombat || undefined,
    sharedCircuitWard: s.sharedCircuitWard || undefined,
    deepHunger: f?.deepHunger,
    contractRewrite: f?.contractRewrite,
    pitWithoutEndImps: s.pitWithoutEndImps || undefined,
    doubleLeftmostAttack: f?.doubleLeftmostAttack,
    possession: hasPower(s, 'possession') || undefined, // Atrius: SoC leftmost/rightmost stat trade
    // GORUN + CINDARA (owner batch 2026-08-23). Both go through `hasPower`, not `heroId`, so an ADOPTED power
    // (Mimic / Void / Power Shifter) behaves identically to the native one. And because `questCombatMods` is
    // the same builder a SNAPSHOT uses, a rival seat that ran either hero brings its own values into the fight
    // on its own side — which is why both are read via `modsFor(side)` in simulate rather than player-side.
    bladeMastery: hasPower(s, 'bladeMastery') ? { attacks: s.bladeAttacks ?? 0 } : undefined,
    hoard: hasPower(s, 'hoard') ? { ...(s.hoardWhelpBuff ?? { attack: 0, health: 0 }) } : undefined,
    slaughterFirstEachCombat: s.slaughterFirstEachCombat || undefined,
    feedingLine: f?.feedingLine,
    umbralEnergy: f?.umbralEnergy,
    emptyGraves: f?.emptyGraves,
    crateringMissive: f?.crateringMissive, // Cratering Missive: Hulk overflow buffs ALL tribes, not just Undead
    passingSpears: f?.passingSpears, // Passing Spears: Spear Wardens give their stats to a friendly minion on death

    runeWarding: f?.runeWarding, // Rune of Warding: SoC give leftmost minion Ward
    runeFury: f?.runeFury, // Rune of Fury: Avenges trigger twice
    candlelightToll: f?.candlelightToll, // Candlelight Toll: a dying Kobold grants a Ruby
    gemheartCharge: f?.gemheartCharge,   // Heart of the Mountain: Gemheart Golems attack on summon
    burningLegionUses: f?.burningLegion, // The Burning Legion: bounded Imp self-copies
    decoySigils: s.pendingDecoys || undefined, // Decoy Sigil: next-combat Training Dummy slot-fillers
    weakenTargets: s.pendingWeaken || undefined, // Weaken: SoC set N random enemies to 1 Health
    runeVanguard: f?.runeVanguard,         // Rune of the Vanguard: SoC Crit + Ward on your 3 left-most
    runeFinality: f?.runeFinality,         // Rune of Finality: your last death summons Warded Imps
    // Rune of the Hatchery and Rayse's Empowering Vines share one channel — both are "bodies summoned in
    // combat enter +A/+H with Taunt" — and they SUM when held together (rune +3/+3, Rayse +2/+3).
    runeHatchery: f?.runeHatchery || hasPower(s, 'empoweringVines')
      ? {
          // The rune half pays +3/+3 once per copy held (boolean-flag family, owner 2026-08-27).
          attack: (f?.runeHatchery ? 3 * Math.max(1, s.flagCopies?.runeHatchery ?? 1) : 0) + (hasPower(s, 'empoweringVines') ? 2 : 0),
          health: (f?.runeHatchery ? 3 * Math.max(1, s.flagCopies?.runeHatchery ?? 1) : 0) + (hasPower(s, 'empoweringVines') ? 3 : 0),
        }
      : undefined,
    runeLastCall: f?.runeLastCall,           // Avenge (3): a random Dwarven Ale to hand
    runeCinderLedger: f?.runeCinderLedger,   // Avenge (3): improve your Imps run-wide
    runeProcession: f?.runeProcession,       // Avenge (4): double your right-most minion
    runeGemstorm: f?.runeGemstorm,           // Avenge (2): Rubies onto every friendly Kobold
    runeBloodAndCoin: f?.runeBloodAndCoin,   // every 4 friendly deaths banks Gold for next turn
    runeWildHunt: f?.runeWildHunt,           // a Beast attacking pumps a board-wide Health aura
    runeLivingTreasure: f?.runeLivingTreasure, // Gemheart Golems gain the exact-copy Echo
    runeRemains: f?.runeRemains,             // every 5 combat summons buffs the Shop
    runeReinvestment: f?.runeReinvestment,   // after combat, the Shop gains per friendly summon
    runeHuntingBell: f?.runeHuntingBell,     // Avenge (3): fire your left-most Rally, free
    runeBrood: f?.runeBrood,                 // fill a free slot with a Warded, Taunting Imp (bounded)
    runeLivingEchoes: f?.runeLivingEchoes,   // fill a free slot with a Sunmane Herald that strikes now
    runeWarChorus: f?.runeWarChorus,         // your first Rally each combat fires your left-most Shout
    runeFoodChain: f?.runeFoodChain,         // your first summon inherits your left-most Demon's stats
    runeAttackingGems: f?.runeAttackingGems, // every friendly attack plays a Ruby on your whole board
    runeOverflow: f?.runeOverflow,           // an overflowed summon permanently buffs your warband
    runeCounterpoint: f?.runeCounterpoint,   // a friendly death frees your left-most for a swing
    avengeFirstDouble: f?.avengeFirstDouble, // The Sealed Vault: the FIRST Avenge each combat triggers twice
    runeRallying: f?.runeRallying, // Rune of Rallying: SoC trigger your Rally (on-attack) effects
    runeForthcoming: f?.runeForthcoming, // Rune of Forthcoming: SoC left-most gains Ward + attacks immediately (2026-07-31 rework)
    runeRisingGraves: f?.runeRisingGraves, // Rune of Rising Graves: SoC give 2 Undead Rise
    runeBroodpit: f?.runeBroodpit, // Rune of the Broodpit: Avenge 4 → 2 Taunt Imps (the '6' here was stale)
    runeSpearline: f?.runeSpearline, // Rune of the Spearline: Avenge 4 → Spear Warden attacks now
    runeAppraisal: f?.runeAppraisal, // Rune of Appraisal: Avenge 3 → spells +1/+1
    runeSoulTaxes: f?.runeSoulTaxes, // Rune of Soul Taxes: Avenge 4 → +1 max Gold
    runeFirstClaws: f?.runeFirstClaws, // Rune of First Claws: SoC leftmost+rightmost Beasts attack now
    runePackcraft: f?.runePackcraft, // Rune of Packcraft: combat summon → Beasts +1 Atk
    baneDemonWiden: s.baneBuffsDemons, // Bane's Existence widen fires in combat too (owner ruling 2026-08-04)
    runeInheritance: f?.runeInheritance, // Rune of Inheritance: leftmost dies → rightmost gains its stats
    runeSalvage: f?.runeSalvage, // Rune of Salvage: friendly Mech loses Ward → Attachment to hand
    runeTwilight: f?.runeTwilight, // Rune of Twilight: your Start-of-Combat effects trigger an extra time
    runeWarden: f?.runeWarden, // Rune of the Warden: SoC summon a Spear Warden if there's room
    runeRebirth: f?.runeRebirth, // Rune of Rebirth: your minions Rise with full Health
    runeAftershocks: f?.runeAftershocks, // Rune of Aftershocks: Echo summons gain +4/+4
    runeEngraving: f?.runeEngraving,         // Rune of Engraving: Avenge (3) — Rubies permanently +1 Health
    runeUnderdog: f?.runeUnderdog,           // Rune of the Underdog: SoC — double the two lowest-Attack minions
    runeStokedMenagerie: f?.runeStokedMenagerie, // Rune of the Stoked Menagerie: SoC — all types → double 3 at random
    summonTaunts: s.summonTauntsNextCombat,  // Summoning Bulwark: the first N summons this combat gain Taunt
    runeGemGolem: f?.runeGemGolem,           // Rune of the Gem Golem: a dying Kobold leaves a token of its Rubies
    runeRuins: f?.runeRuins,                 // Rune of Ruins: a friendly Demon's landed hit buffs that board
    runeGolems: f?.runeGolems,               // Rune of the Golems (reserved — see the Gem Golem note in runes.ts)
    runeEngravingGems: f?.runeEngravingGems, // Rune of Engraving Gems: combat Rubies carry back
    runeHerdingHorn: f?.runeHerdingHorn,     // Rune of the Herding Horn: each Rally banks a free refresh
    runeDeathtouchedApple: f?.runeDeathtouchedApple, // Rune of the Deathtouched Apple: Rise re-arms (2/combat)
    runeChef: f?.runeChef,                   // Rune of the Chef: the Chef's Rally pays last turn's granted total
    runeCarrionCoin: f?.runeCarrionCoin,     // Rune of Carrion Coin: Avenge (N) grants a Shop spell
    runeFiveBanners: f?.runeFiveBanners,     // Rune of the Five Banners: SoC — one of each type +6/+6
    // Emissary: SoC — one friendly of each type gains +1/+1 for EVERY spell cast this game.
    unitedFront: hasPower(s, 'unitedFront') ? s.spellsCast * wishboneReps(s) : undefined, // Wishbone: triggers twice
    solidGroundLeft: s.solidGroundLeft,           // Solid Ground: first N summons next combat land bigger
    solidGroundStat: s.solidGroundStat,
    containFirstEnemySummon: s.containFirstEnemySummon, // Containment Rune: pin the foe's first summon to 1/1
    stolenInitiative: s.stolenInitiative,         // Stolen Initiative: strike back after their opening swing

    runeCenterline: f?.runeCenterline,       // Rune of the Centerline: SoC — middle minion Ward + Crit
    runeEmberline: f?.runeEmberline,         // Rune of Emberline: the first dead Imp feeds the next one
    runeAshenPayroll: f?.runeAshenPayroll,   // Rune of Ashen Payroll: read at SETTLE off the Imp tally
    runeBackbeat: f?.runeBackbeat,           // Rune of Backbeat: first Echo also fires the left-most Rally
    runeSpareChair: f?.runeSpareChair,       // Rune of the Spare Chair: the 7th seat arrives Warded + swinging
    runeAncestralRoar: f?.runeAncestralRoar, // Rune of Ancestral Roar: a dying Dragon fires its own Shout
    runeRubyShrapnel: f?.runeRubyShrapnel,   // Rune of Ruby Shrapnel: a dying Ruby body splits its stats
    runeSharedScripture: f?.runeSharedScripture, // Rune of Shared Scripture: first combat cast → Shout + Rally
    runeMoonhowl: f?.runeMoonhowl,           // Rune of Moonhowl: a dying Mage-Pup casts its taught spell
    runeFloodedVault: f?.runeFloodedVault,   // Rune of the Flooded Vault: the Avenge also casts the left-most hand spell
    runeBattleRefraction: f?.runeBattleRefraction, // Rune of Battle Refraction: Prismcasters repeat combat Rubies
    runeWrangler: f?.runeWrangler,           // Rune of the Wrangler: Imp Wrangler's Imps get Ward + Taunt
    runeLivingGeode: f?.runeLivingGeode,     // Rune of the Living Geode: Geode Guardian's Golems get Ward
    runeDawnclaw: f?.runeDawnclaw,           // Rune of Dawnclaw: Dawnclaws also fire their Echo at Start of Combat
    runeSylus: f?.runeSylus,                 // Rune of Sylus: your Sylus double their own Health at Start of Combat
    oldPack: f?.oldPack,                     // Rune of the Old Pack: first Beast resummoned each combat returns at full stats
    runeJungle: f?.runeJungle,               // Rune of the Jungle: a summoned Beast doubles its Health
    runeBurrow: f?.runeBurrow,               // Rune of the Burrow: first Echo-Beast death is resummoned without its Echo
    runeBeastialSwarm: f?.runeBeastialSwarm, // Rune of Beastial Swarm: your Beasts gain +N/+N per friendly Beast death
    runeZoo: f?.runeZoo,                     // Rune of the Zoo: Beardsley's summon buff scales with the summon count
    beastialSwarmLevel: f?.runeBeastialSwarm ? (s.beastialSwarmLevel ?? 2) : undefined, // the current per-death amount (run-persisted)
    runeSecondLitter: f?.runeSecondLitter,   // Rune of the Second Litter: the first Beast summoned copies
    runeGroveweaver: s.runeGroveweaver,      // Rune of the Groveweaver: the self-buff works in combat too
    runeBroodmaster: s.runeBroodmaster,      // Rune of the Broodmaster: the Imp buff also lands on the Broodwright
    // Rune of Enchantment: a COMBAT cast gives +4/+6 (shop half gives +2/+3) — passed as the COPY COUNT since
    // the 2026-08-27 duplicate rulings, so a duplicate doubles the combat grant too (`true` in old snapshots = 1).
    runeEnchantment: s.runeEnchantment ? runeStacksOf(s, 'rune_enchantment') : undefined,
    runeDragonscale: f?.runeDragonscale,     // Rune of Dragonscale: N Dragon attacks earn Ward this combat
    runeTemperedTime: f?.runeTemperedTime,   // Rune of Tempered Time: SoC — +Health equal to half Attack
    runeSavagery: f?.runeSavagery,           // Rune of Savagery: a summoned Beast doubles its Attack
    runeCrucible: f?.runeCrucible,           // Rune of the Crucible: sacrifice N left-most, resummon at the end
    runeHerald: f?.runeHerald,               // Rune of the Herald: SoC — trigger all your Echoes
    runeUndertow: f?.runeUndertow, // Rune of the Undertow: the first N combat summons gain Ward (stale comment fixed 2026-08-08 — it never granted charge)
    runeMirrorMarch: f?.runeMirrorMarch, // Rune of the Mirror March: SoC summon a copy of your leftmost
    runeTrophy: f?.runeTrophy, // Rune of the Trophy: first Slaughter → a copy of the slaughterer next shop
    // Rune of Mastery: +1 extra Improve step per copy held (repeat family, owner 2026-08-27) — the COPY COUNT
    // rides in (`true` in old snapshots = 1), and simulate's `improveRepsFor` turns it into 1 + copies.
    runeMastery: s.runeMastery ? runeStacksOf(s, 'rune_mastery') : undefined,
    runeSpellstone: s.runeSpellstone, // Rune of the Spellstone: combat Rubies also count as spell casts
    // ── 2026-08-20 rune batch ──
    runeReturningPack: f?.runeReturningPack || undefined,       // every N Beasts summoned → a random Beast next shop
    runeGraveRefreshment: f?.runeGraveRefreshment || undefined, // every N friendly Echoes → a free refresh next turn
    // Rune of Shifting Facets: the AXIS in force this turn rides in, not a boolean — even turn-ticks are the
    // printed Health half, odd are Attack, so the fight resolves whatever the shop was advertising.
    runeShiftingFacets: f?.runeShiftingFacets ? ((s.runeShiftingFacetsTick ?? 0) % 2 === 0 ? 'health' : 'attack') : undefined,
    runeDeepeningVein: f?.runeDeepeningVein,   // Avenge (3): Rubies +1/+1 and a Ruby on every friendly Kobold
    // SHOP→COMBAT CARRY-OVER (owner ruling 2026-08-26): "war drum should have a 1/1 use, and that use resets
    // at start of turn, therefore if it is not used in shop, then the first shout triggered in combat should
    // work." Present only while the per-turn charge is UNSPENT; combat consumes it on the first triggered
    // Shout. Warm Embers' legacy shoutDouble charges ride the same channel (next N combat Shouts fire twice) —
    // combat use does NOT decrement the run's charge pool (no carry-back channel; the shop pool stays intact).
    // Because snapshots build their questMods through this same function, a served rival's unspent charges
    // carry onto its own side for free.
    warDrumExtra: s.runeWarDrum && !s.runeWarDrumUsedThisTurn ? s.runeWarDrum : undefined,
    shoutDoubleCharges: s.shoutDoubleCharges || undefined,
    // Demand an Encore (R-TURN-01, owner ruling 2026-08-27: "'this turn' … runs from shop through that
    // turn's combat"): the turn-scoped Shout extras apply to every Shout triggered in combat too. Threaded
    // whenever armed — it is a turn-long buff (the shop counter never consumes it), so there is no
    // "unspent" latch to check; the rollover that clears `shoutExtraTurn` happens after the combat.
    encoreExtra: s.shoutExtraTurn || undefined,
    // Rune of Held Strength (owner rework 2026-08-27 — was a one-shot on purchase): Start of Combat, the left
    // and right-most minions gain the stats of the LEFT-MOST non-spell card in hand, read live here at combat
    // build; `copies` fires the grant once per copy held. No qualifying held card → no grant this fight.
    runeHeldStrength: (() => {
      if (!s.runeHeldStrength) return undefined;
      const held = s.hand[0];
      const hd = held ? CARD_INDEX[held.cardId] : undefined;
      if (!held || !hd || hd.spell || hd.ruby) return undefined;
      return { attack: held.attack, health: held.health, copies: runeStacksOf(s, 'rune_held_strength') };
    })(),
  };
}

/**
 * Refresh the tavern: roll new offers, inject any Fodder queued for the next tavern
 * (Soulfeeder), then let your Demons devour Fodder that just entered. Both the manual
 * Refresh and the post-combat refresh route through here, so anything that interacts
 * with "tavern refresh" hooks in one place.
 */
function refreshTavern(s: RunState, hold = false): void {
  // Rune of the Muster: the armed free refresh is stocked with PLAIN copies of your board instead of a draw.
  // Spent on use, and only when there is a board to copy (an empty board would produce an empty shop).
  if (s.runeMuster && s.board.length > 0) {
    procRuneId(s, 'rune_muster');
    // Spend ONE armed muster per refresh (a duplicate armed a second — owner one-shot ruling 2026-08-27).
    const armed = gateUses(s.runeMuster);
    s.runeMuster = armed > 1 ? armed - 1 : undefined;
    for (const offer of s.shop) returnToPool(s, offer.cardId);
    s.shop = s.board.map((c) => ({ uid: `s${s.uidSeq++}`, cardId: c.cardId })); // plain: no buffs, never golden
    injectPendingTavern(s, hold);
    return;
  }
  // Rune of the Guiding Candle: the turn's first `count` refreshes draw ONLY tier-`tier` minions. `rollShop`
  // reads the lock off the state, so the allowance is spent AFTER the draw — decrementing first made the
  // second refresh see left=0 and go unrestricted (off-by-one, caught by its own test).
  const gc = s.runeGuidingCandle;
  if (gc && gc.left > 0) procRuneId(s, 'rune_guiding_candle');
  rollShop(s);
  if (gc && gc.left > 0) s.runeGuidingCandle = { ...gc, left: gc.left - 1 };
  // Apples (Choose One → "the next shop"): fold the banked buff onto the freshly-rolled offers, then clear it.
  const nb = s.nextShopBuff;
  if (nb && (nb.attack || nb.health)) {
    for (const offer of s.shop) addOfferBuff(offer, 'Apples', nb.attack, nb.health);
    s.nextShopBuff = undefined;
  }
  injectPendingTavern(s, hold);
  // Croupier Ayse (Lucky Seat): roll the fresh offers for Enchanted marks — see `rollCiaEnchants`.
  rollCiaEnchants(s);
}

/** Pay a matured commission and clear it. Called from the turn advance, so the reward lands as the shop opens. */
function payCommission(s: RunState, c: Commission): void {
  s.commission = undefined;
  if (c.kind === 'gold') { gainGold(s, 2); return; }
  if (c.kind === 'fortress') { grantGoldenDiscover(s); return; } // the Triple Reward, same grant a triple gives
  if (c.kind === 'citadel') {
    // A FREE upgrade — the tier rises without charging `upgradeCostOf`, then the next price is re-based off
    // the new tier exactly as a paid upgrade does, so the ladder stays consistent.
    const ceiling = maxTierFor(s.rift);
    if (s.tier < ceiling) {
      s.tier += 1;
      s.upgradeCost = s.tier >= ceiling ? 0 : (CONFIG.upgradeCost[s.tier + 1] ?? 0);
    }
    return;
  }
  if (c.kind === 'spell') {
    const pool = poolOf(s).spells.filter((x) => x.tier <= s.tier);
    if (pool.length > 0 && s.hand.length < handCap(s)) conjureToHand(s, pool, 1);
    return;
  }
  // `queueDiscover` builds the offer itself from the spec (same pools / tier rules / rng stream as every other
  // Discover), so there is nothing to pre-roll here.
  queueDiscover(s, { kind: 'minion', tier: s.tier, exactTier: s.tier });
}

/** Croupier Ayse's four rewards, and the suit that will pay next.
 *
 * The suit is PUBLIC and chosen in advance (`RunState.ciaSuit`) rather than rolled at payout time, because the
 * hero-power button shows its art — the player is meant to see what they are working toward. After a payout
 * the next suit is drawn from the OTHER THREE, so it can never repeat twice in a row (owner spec 2026-08-16).
 */
const CIA_SUITS: readonly CiaSuit[] = ['hearts', 'spades', 'diamonds', 'clubs', 'ace'];

/** Draw the next suit, excluding `avoid`. Seeded like every other pick, so a replay lands the same sequence. */
function rollCiaSuit(s: RunState, avoid?: CiaSuit): CiaSuit {
  const pool = CIA_SUITS.filter((x) => x !== avoid);
  const rng = makeRng(s.rngCursor);
  const next = pool[rng.int(pool.length)]!;
  s.rngCursor = rng.state();
  return next;
}

/**
 * Juggler (Baldgecoin): every 3 minions bought hands over a Carnival Coin.
 *
 * The counter WRAPS at 3 rather than accumulating, so a full hand costs you that pouch instead of banking it
 * — the same call Ayse's prize makes. Counted on every buy route, since a hook wired to only one of them is
 * the recurring bug in this file (see `applySpellBought`).
 */
function jugglerBuy(s: RunState): void {
  if (!hasPower(s, 'baldgecoin')) return;
  const n = (s.jugglerBuys ?? 0) + 1;
  if (n < 3) { s.jugglerBuys = n; return; }
  s.jugglerBuys = 0;
  const coin = CARD_INDEX['carnivalcoin'];
  if (coin && s.hand.length < handCap(s)) conjureToHand(s, [coin], wishboneReps(s)); // Wishbone: two coins
}

/**
 * Croupier Ayse (Lucky Seat): count an Enchanted purchase, and pay the queued suit on the 3rd.
 *
 * Called from EVERY buy path (spell slot in the minion row, a restored/held offer, and the ordinary minion
 * buy) rather than one of them — the same lesson as `applySpellBought`, which silently did nothing for spells
 * bought from the row because it was only wired to the slot.
 *
 * The counter resets and the suit re-rolls whether or not the reward could land (a full hand forfeits it, like
 * a Discover into a full hand), so a streak can never be banked indefinitely.
 */
function ciaBuyEnchanted(s: RunState, offer: ShopCard): void {
  if (!offer.enchanted || !hasPower(s, 'luckySeat')) return;
  const n = (s.ciaEnchantedBought ?? 0) + 1;
  if (n < 3) { s.ciaEnchantedBought = n; return; }
  s.ciaEnchantedBought = 0;
  const suit = s.ciaSuit ?? 'hearts';
  const cap = hasTier7Access(s) ? 7 : 6;
  // Wishbone: the prize pays TWICE (owner ruling — "doubles reward"). Wrapped around the whole switch rather
  // than doubling each arm, so a suit added later doubles for free instead of silently paying once.
  for (let rep = 0; rep < wishboneReps(s); rep++)
  switch (suit) {
    case 'hearts': {
      // Discover a minion of your CURRENT tier.
      const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier === s.tier);
      if (pool.length > 0) {
        const rng = makeRng(s.rngCursor);
        const opts = [...pool];
        const picks: string[] = [];
        while (picks.length < 3 && opts.length > 0) picks.push(opts.splice(rng.int(opts.length), 1)[0]!.id);
        s.rngCursor = rng.state();
        s.discover = picks;
      }
      break;
    }
    case 'spades': {
      // DISCOVER a Shop spell (owner change 2026-08-22 — was two random ones conjured straight to hand). A pick
      // beats a handful: two random spells often landed dead, where choosing one lets the prize answer the
      // board in front of you.
      //
      // `queueDiscover` rather than assigning `s.discover` (what the Hearts arm above still does): this prize
      // fires from a BUY, which can happen while another modal is mid-flight, and queueing stacks behind it
      // instead of clobbering it. It is also what makes Wishbone's second rep open a second pick rather than
      // overwrite the first.
      // `kind: 'spell'` — the purpose-built spell Discover (tier-capped, honouring DISCOVER_EXCLUDED_SPELLS).
      // NOT `kind: 'pool'`: that spec filters spells OUT by construction (it exists for minion id-lists), so
      // handing it spell ids yields an empty pool and opens nothing at all.
      queueDiscover(s, { kind: 'spell' });
      break;
    }
    case 'diamonds': {
      // A random minion from the tier ABOVE you, under the standard Tier-7 ceiling (Pete's clamp).
      const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier === Math.min(s.tier + 1, cap));
      if (pool.length > 0 && s.hand.length < handCap(s)) conjureToHand(s, pool, 1);
      break;
    }
    case 'clubs':
      gainGold(s, 3);
      break;
    case 'ace': {
      // THE ACE (owner 2026-08-22): a coin flip between two halves.
      //   · −`ACE_TIER_DISCOUNT` Gold off the next Shop upgrade — offered ONLY at Tier 5 and below.
      //   · Discover a minion from the tier ABOVE you, reaching Tier 7 (see below).
      //
      // Above Tier 5 the discount half is not merely unlikely, it is OFF THE TABLE: at Tier 6 a discount buys
      // at most one more step and at the ceiling it buys nothing, so a coin flip there would pay out dead half
      // the time. The flip collapses to the Discover, which is always worth something.
      const canDiscount = s.tier <= ACE_DISCOUNT_MAX_TIER;
      const rng = makeRng(s.rngCursor);
      const discount = canDiscount && rng.int(2) === 0;
      s.rngCursor = rng.state();
      if (discount) {
        // Banked, not applied to `upgradeCost` directly: that number is re-based on every tier-up, so writing
        // the discount into it would be erased by the next upgrade rather than spent by it.
        s.aceTierDiscount = (s.aceTierDiscount ?? 0) + ACE_TIER_DISCOUNT;
        break;
      }
      // "Up to Tier 7" — AUTHORED, so this reaches Tier 7 from a Tier-6 shop without Summit/`tier7Access`,
      // the same licence Teleport Summit's authored `reward.tier` takes. Deliberately unlike the DIAMONDS
      // arm above, which clamps to the run's own ceiling.
      const target = Math.min(s.tier + 1, 7);
      const pool = poolOf(s).buyable.filter((c) => !c.spell && !c.ruby && c.tier === target);
      if (pool.length > 0) queueDiscover(s, { kind: 'minion', tier: target, exactTier: target });
      break;
    }
  }
  s.ciaSuit = rollCiaSuit(s, suit); // never the same suit twice running
}

/**
 * Inject any Fodder queued for this tavern (Soulfeeder) into the shop, then let Demons devour what
 * just arrived. Runs for both a fresh reroll and a frozen carry-over, so a queued Fred always
 * arrives (and is consumed) exactly once rather than being stranded in `pendingTavern`.
 */
function injectPendingTavern(s: RunState, hold = false): void {
  // Multi-shop schedule (Soulfeeder / Pit Supplier): pop THIS refresh's due Fodder into the pending queue, then
  // shift the schedule down so the rest arrive on later refreshes.
  if (s.fodderSchedule?.length) {
    const due = s.fodderSchedule.shift() ?? 0;
    for (let i = 0; i < due; i++) (s.pendingTavern ??= []).push('fred');
    if (s.fodderSchedule.length === 0) s.fodderSchedule = undefined;
  }
  const pending = s.pendingTavern ?? [];
  s.pendingTavern = []; // always cleared — Fodder is never stored; with no Demon to eat it, it's wasted
  if (pending.length === 0) return;
  // Only bring queued Fodder out if a Demon is on the board to consume it — otherwise it would just
  // clutter the tavern with un-buyable garbage, so it goes to waste instead (handoff: no Fodder storage).
  if (!s.board.some((c) => isTribe(c, 'demon'))) return; // dual-types (Bane = Dragon/Demon) count as Demons
  for (const id of pending) {
    if (CARD_INDEX[id]) s.shop.push({ uid: `s${s.uidSeq++}`, cardId: id });
  }
  // `hold`: a turn-setup roll behind a start-of-turn modal defers the eat — the Fodder sits in the shop (visible
  // to the player) and `openNextStartOfTurnModal` runs the consume once the quest/Runeforge overlay clears.
  if (hold) s.holdFodderConsume = true;
  else consumeTavernFodder(s); // the Demons eat the Fodder that just arrived
}

/** Hand over ONE random Gift (owner design 2026-08-26) — the payout Happy Birthday and Kindness's power share.
 *  Drawn from `GIFT_IDS` (the whole class) with the run's seeded RNG, so a replay reproduces the same Gift. */
function grantRandomGift(s: RunState): void {
  const pool = GIFT_IDS.map((id) => CARD_INDEX[id]).filter((d): d is CardDef => !!d);
  if (pool.length === 0) return;
  const rng = makeRng(s.rngCursor);
  const pick = pool[rng.int(pool.length)]!;
  s.rngCursor = rng.state();
  conjureToHand(s, [pick], 1);
}
