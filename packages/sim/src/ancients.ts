/**
 * ANCIENTS (proof of concept, owner rulings 2026-09-25) — a run-defining transformation of the HERO POWER.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * Scene Builder, Set 3 only, behind `RunState.ancientsEnabled`. Nothing here runs unless that flag is on AND the
 * run carries an `ancients` block, so a lobby / practice / normal run (and every replay and golden) is untouched:
 * every hook below returns before reading or writing anything when `state.ancients` is absent.
 *
 * ── The loop ──────────────────────────────────────────────────────────────────────────────────────────────────
 *  1. THE METER FILLS (owner ruling 2, re-worded on the first playable: "it should fill the meter not deplete it"):
 *     it starts empty, every Shop refresh ADDS `refresh` (1, paid or free, no distinction), every combat fought ADDS
 *     `combat` (2), and it awakens when it reaches `cost` (16). All three are tuner values stamped on the run at
 *     creation, and `ANCIENT_METER_BY_HERO` is the per-hero override seam.
 *  2. AT FULL the Ancient awakens ONCE: the Shop pauses behind a Discover of 3 of the 5 Ancients, a seeded pick off a
 *     salted stream (never the run cursor, so the rest of the run's RNG is unaffected by when it awakens).
 *  3. THE PICK locks it for the run. Its effect is the PAIRING for the current hero: DATA in `ANCIENT_PAIRINGS`
 *     (Ancient × hero → text + effect primitives). A hero with no written pairing shows "Not written yet" and
 *     does nothing.
 *
 * ── Where each primitive fires ────────────────────────────────────────────────────────────────────────────────
 *  · `powerTargetGainsKeywords`   the reducer's `gild` hero-power branch, after the gild (Death: Rebirth + Taunt).
 *  · `powerGivesCopiesInstead`    the same branch, INSTEAD of the gild (Genesis); the branch's `checkTriples`.
 *  · `sellGildedGetsPlainCopy`    `settleMinionSale`, the one chokepoint every sale walks (Fortune).
 *  · `friendlyDeathBuffsGilded`   SHOP: `afterShopDestroy`, the one chokepoint both shop-destroy paths walk;
 *                                 COMBAT: `QuestCombatMods.ancientWar`, an `onDeath` listener in `simulate`, with
 *                                 the gain recorded as `permaGain` so it carries back (War, cross-phase).
 *  · `socGildRightmost`           COMBAT only: `QuestCombatMods.ancientTimeGild`, at Start of Combat (Time). The
 *                                 gild lives on the combat body only, so it reverts after the fight.
 *  · `powerTargetsGilded`         the reducer's `gild` branch: an already-Gilded target is legal (Bonds).
 *  · `powerBuffPerGild`           the same branch, after the gild: the target gains +a/+h × the run's gild count
 *                                 (`AncientsState.gilds`, ticked by `noteGilded` in `gildMinion` + the triple).
 *
 *  WARDEN (Aegis, `grantWard`; owner pairings 2026-09-26):
 *  · `aegisDestroyGivesAttackAndWard`  the reducer's `grantWard` branch: the Aegis target is destroyed (a real
 *                                 shop death) and a RANDOM other friendly minion gains its Attack and Ward, preferring
 *                                 one without Ward. REPLACES the power (no +5 Attack to Warded minions). (Death)
 *  · `wardBreakGold`              `ancientAfterCombat` (settle): +gold next turn per FRIENDLY Ward that broke. (Fortune)
 *  · `aegisUpgradesWardToResilient`  the `grantWard` branch: an Aegis on a minion that ALREADY has Ward upgrades it
 *                                 to RESILIENT Ward (every Aegis, a standing rule; owner 2026-09-26). (War)
 *  · `wardBreaksGetCopy`          REAL-TIME (owner 2026-09-26): `QuestCombatMods.ancientWardCopy` carries the running
 *                                 break window into the fight; the moment the `every`th Ward breaks, a plain copy of
 *                                 one of those minions goes to hand mid-fight (a live `toHand`). `ancientAfterCombat`
 *                                 only stores the window the fight hands back. (Genesis)
 *  · `eotBuffWarded`              a virtual recurring End-of-Turn entry (`ancientTimeWard` in `recurringEotEffects`):
 *                                 every minion with Ward gains +a/+h, permanently. (Time)
 *  · `wardedGainBuffsWarded`      SHOP: `ancientBondsReact` at the reducer's per-action stat diff (+ an End-of-Turn
 *                                 pass so its grants land before the fight); COMBAT: `QuestCombatMods.ancientBonds`
 *                                 in `ctx.buff`. Its own grant never re-triggers it. (Bonds)
 *
 *  AUCTIONEER (`myra`, Pulse, `replayBattlecry`; owner pairings 2026-09-26):
 *  · `pulseRepeatThenDestroy`     the reducer's `replayBattlecry` branch: the Shout fires `1 + extra` times per Pulse,
 *                                 then the target is destroyed (a real shop death via `destroyMinionInShop`). (Death)
 *  · `shopShoutGold`              `fireBattlecryTriggered` (every SHOP Shout fire walks it): +gold next turn per fire,
 *                                 real time. Combat Shouts do not count (the text says Shop phase). (Fortune)
 *  · `pulseGrantsRallyShout`      the `replayBattlecry` branch, after the Shout: the target gains the Rally keyword and a
 *                                 grafted `rallyTriggerOwnShout` (`grantedEffects`, so it rides into combat, snapshots
 *                                 and replays). Once per minion: a second Pulse does not stack it. (War)
 *  · `pulseDiscoverShout`         the `replayBattlecry` branch REPLACED: untargeted, `cost` Gold (the pairing's `power`
 *                                 override), a Discover of a Shout minion at your tier or below. (Genesis)
 *  · `socTriggerEdgeShouts`       COMBAT: `QuestCombatMods.ancientEdgeShouts`, at Start of Combat. The power turns
 *                                 passive (the pairing's `power` override). (Time)
 *  · `shoutBuffsAdjacent`         SHOP: `fireBattlecryTriggered` (per fire, real time); COMBAT:
 *                                 `QuestCombatMods.ancientShoutAdjacent`, a `battlecryTriggered` listener. (Bonds)
 *
 *  LORD OF THE RISEN (`risen`, Undying, `grantReborn`; owner pairings 2026-09-26). Undying marks its target with
 *  `tempReborn`; the combat halves find that body by its run uid (`QuestCombatMods.ancientUndying.uids`, matched
 *  against each combat body's `sourceUid`), so nothing new rides the board card or a snapshot.
 *  · `undyingRegainsRise`         COMBAT: `ancientUndying.regainRise` in `killOrReborn`'s Rise branch: the Undying
 *                                 body regains Rise right after it returns, once per combat (a BLUE Rise). (Death)
 *  · `riseGold`                   COMBAT: `ancientCountRises` counts every friendly Rise (an `onRise` listener, the
 *                                 moment it happens); `ancientAfterCombat` banks +gold next turn per Rise. (Fortune)
 *  · `undyingReturnsDoubleAndAttacks` COMBAT: `ancientUndying.war` in the Rise branch: double Attack on the return,
 *                                 then an interrupting "attacks immediately" strike (R-ORD-05). A RED Rise. (War)
 *  · `summonsSummonExtra`         COMBAT: `ancientSummonExtra` in `placeSummon` (landed or overflowed) and on every
 *                                 Rise / Rebirth return (a copy without the returning keyword). (Genesis)
 *  · `sotBuffPerCombatSummon`     COMBAT counts (`ancientCountSummons`, at the summon-entry chokepoint); the next
 *                                 Start of Turn (`ancientStartOfTurn`) buffs the board per summon, permanently. (Time)
 *  · `riseTriggersAdjacentEcho`   COMBAT: `ancientRiseEcho`, an `onRise` listener (`triggerEcho`); SHOP: `fireOnRise`
 *                                 (`ancientOnShopRise`, the shop Echo ritual). (Bonds)
 *
 *  ALBUS (Empowerment, `empowerment`; owner pairings 2026-09-28). Empowerment = "Choose a Shop minion. Discover a
 *  minion from the tier above it for it to become." The pick REPLACES the Shop offer (`discoverIntoShopUid`), so
 *  "a minion discovered by Empowerment" is that new Shop offer (or the hand card, when the offer was gone by the
 *  time a queued pick resolved). `ancientOnEmpowerPick` is the one hook, called from `takeDiscoverPick`.
 *  · `empowerEchoGainsRise`       the pick, when it has an Echo, gains Rise (on the offer: baked in when bought). (Death)
 *  · `empowerFree`                the new Shop offer costs 0 Gold (`ShopCard.cost`, the set-price channel). (Fortune)
 *  · `pummelGrantsCards`          COMBAT: `QuestCombatMods.ancientPummel`, a HERO-level Pummel read at the keyword's
 *                                 own damage site (`noteDamageDealt`): every friendly landed hit, one lifetime tally
 *                                 (`AncientsState.pummelDealt`), once per combat, paid to hand mid-fight. (War)
 *  · `empowerCopyToHand`          the pick also sends a plain copy to hand; Empowerment costs 3 Gold (`power`). (Genesis)
 *  · `sotDiscoverTierAbove`       Empowerment turns passive (`power`); `ancientStartOfTurn` queues a Discover of a
 *                                 minion from the tier above your Shop tier, on its own Start of Turn beat. (Time)
 *  · `playParityBuff`             SHOP: `playCard` (the one "played from hand" chokepoint): playing an odd-tier minion
 *                                 gives your OTHER odd-tier minions +a/+h, even likewise. Combat has no play. (Bonds)
 *
 *  HUNCH (Rounded Spellbook, `roundedSpellbook`; owner pairings 2026-09-30). Rounded Spellbook = "Get a copy of the
 *  last spell you cast. Costs 3 Gold, reduced by 1 each turn." (once per turn; the price is `roundedSpellbookCostOf`).
 *  "A spell cast" for Genesis and Bonds is EVERY spell cast (a Shop spell, a Gift / Clue, a Ruby; never a reward
 *  token), the owner's "all spells count" rule (2026-09-18 / 09-23): the Shop's every-spell chokepoint is
 *  `noteSpellForCountRunes`, combat's is `ctx.castSpell` (one per cast repetition).
 *  · `avengeImproveSpells`        COMBAT: `QuestCombatMods.ancientAvengeSpells`, an Avenge (4) on the fight's friendly
 *                                 deaths that improves your spells +1/+1 (`grantSpellPower`, the Rune of Appraisal
 *                                 shape). Avenge is combat-only in this game. (Death)
 *  · `spellbookMaxGold`           the reducer's `roundedSpellbook` branch: each use also gives +1 max Gold, permanently
 *                                 (`maxGoldBonus`, the Gold Font channel). (Fortune)
 *  · `shopSpellsCastExtraInCombat` COMBAT: `QuestCombatMods.ancientSpellCastExtra`, Runebloom Matriarch's
 *                                 `spellCastRepsFor` channel seeded for the whole fight. (War)
 *  · `spellsRechargeSpellbook`    every `every`th spell cast (a running count since the pick, across turns and phases)
 *                                 recharges Rounded Spellbook and sets its price to 1 Gold (never raising it). Shop:
 *                                 `ancientOnSpellCast`; combat casts count at settle (`ancientAfterCombat`). (Genesis)
 *  · `spellbookCastsTwice`        the `roundedSpellbook` branch stamps each copy `castMult: 2` ("casts twice"). (Time)
 *  · `spellCastBuffsEdges`        SHOP: `ancientOnSpellCast` (every spell, real time); COMBAT:
 *                                 `QuestCombatMods.ancientSpellEdges` in `ctx.castSpell`. (Bonds)
 *  FRANTIC FRANK (Clearance, `clearance`; owner pairings 2026-09-30). Clearance = "Refresh the Shop. Its minions cost 2
 *  Gold this turn." Its 2 Gold rides the refreshed offers' own `cost`; on an Ancients run each stamped offer also
 *  carries `ShopCard.clearance`, and a minion bought from one carries `BoardCard.clearanceBuy` (a "Clearance minion").
 *  · `clearanceDestroyFirstFree`  the reducer's `clearance` branch: the Clearance offers are stamped 0 Gold
 *                                 (`clearanceFree`) until the first is bought (`ancientOnClearanceBuy` re-prices the
 *                                 rest to 2), then the left-most board minion is destroyed (a real shop death). (Death)
 *  · `clearanceSellValue`         `sellValueOf`: a Clearance minion sells for `gold` (every sale path reads it). (Fortune)
 *  · `avengeClearanceStack`       COMBAT: `QuestCombatMods.ancientClearanceStacks`, an Avenge (N) on the avenge bus
 *                                 (Rune of Fury doubles it); each fire is a stack, live (a `questTrigger`), carried back
 *                                 to `AncientsState.clearanceStacks`. SHOP: a spent Clearance fires again on a stack. (War)
 *  · `clearanceTopTribe`          the `clearance` branch's refresh draws only your most common type
 *                                 (`AncientsState.rollTribe`, read by `rollShopRow`); Clearance costs 3 (`power`). (Genesis)
 *  · `firstBuysCost`              Clearance is passive (`power`); `offerBuyPrice` caps the first N minion buys each
 *                                 turn at `price` (`ancientTimePrice`, counted by `ancientNoteMinionBuy`). (Time)
 *  · `clearanceSaleGivesStats`    `settleMinionSale` (`ancientOnSale`): a sold Clearance minion's current stats go to
 *                                 a random friendly board minion, real time. (Bonds)
 *  XEROX (Copy Machine, `copyMachine`; owner pairings 2026-10-02). Copy Machine = "Summon an exact copy of a friendly
 *  minion. Needs a free board slot. Once per game." "A copy" means Copy Machine's EXACT copy everywhere (`exactBoardCopy`
 *  in the Shop: current stats, buffs, keywords, gilding, counters; combat: the body's current stats + Ward / Rise, the
 *  Mirror March `copyStats` path), never a pool body.
 *  · `avengeCopyTopAttack`        a hero Avenge (N) on ONE running count of friendly deaths across BOTH phases
 *                                 (`AncientsState.xeroxDeaths`, the Rune of Body Counting meter shape): SHOP deaths tick it
 *                                 at `fireOnFriendDeath` (`ancientXeroxShopDeath`); COMBAT carries it in
 *                                 (`QuestCombatMods.ancientXeroxAvenge`) and settle adds the fight's deaths. Each Nth death
 *                                 summons a copy of your highest-Attack living minion (ties: left-most). Full board: nothing.
 *                                 Rune of Fury fires the combat half again (every hero Avenge's rule). (Death)
 *  · `pairsGoldNextTurn`          a virtual recurring End-of-Turn entry (`ancientXeroxPairs`): +gold next turn per PAIR on
 *                                 the board (two minions of the same card, Gilded or not; floor(n / 2) per card). (Fortune)
 *  · `socCopyTopHealth`           COMBAT: `QuestCombatMods.ancientXeroxSoc`, Start of Combat: summon a copy of your
 *                                 highest-Health living minion (ties: left-most), room permitting. (War)
 *  · `copyMachineExtraCharge`     the pick banks `charges` more Copy Machine uses (`AncientsState.xeroxCharges`); the
 *                                 reducer's `chargeUse` spends one once the once-per-game use is gone. (Genesis)
 *  · `sotCopyToHand`              `ancientStartOfTurn`: a copy of a random board minion to hand (seeded), its own Start
 *                                 of Turn beat. Empty board / full hand: nothing. (Time)
 *  · `copyMachineBonds`           Copy Machine binds the copy and its original (`AncientsState.xeroxBond`). A stat GAIN on
 *                                 either is gained by the other, real time: SHOP through `addBuff` (`stampXeroxBond`, the
 *                                 Sable Soulbind hook); COMBAT through `ctx.buff` (`QuestCombatMods.ancientXeroxBond`,
 *                                 matched on `sourceUid`). One hop (guarded). The bond breaks for good when either end is
 *                                 consumed into a triple, sold, destroyed in the Shop, or otherwise leaves the run. (Bonds)
 *  TRADESMAN (`hermithank`, Frugal, PASSIVE; owner pairings 2026-10-02). "A Refresh" = the reducer's `refreshTavern`
 *  with `hold` off (paid, free, a power's), the same refresh the meter counts; never the turn-start roll.
 *  · `avengeFreeRefresh`          a hero Avenge (N) on ONE running count across BOTH phases (`tradesDeaths`, the Xerox
 *                                 Death shape): SHOP at `fireOnFriendDeath` (`ancientTradesShopDeath`); COMBAT through
 *                                 `QuestCombatMods.ancientRefreshAvenge` (`grantFreeRolls`, the free-roll carry-back). (Death)
 *  · `buyNextRefreshFree`         the reducer's minion-buy paths (`ancientTradesBuy`) set ONE pending "next Refresh costs 0"
 *                                 (`tradesNextRefreshFree`, never stacks); the `roll` branch spends it first. (Fortune)
 *  · `minionsRallyGold`           a graft on every friendly minion (`applyRuneGrafts` in the Shop, `ancientRallyGold` for
 *                                 combat summons): "Rally: gain N Gold next turn" (`rallyGoldNextTurn`). (War)
 *  · `refreshesCastSpell`         `ancientAfterRefresh`: every Nth Refresh casts the spell through `castSpell`. (Genesis)
 *  · `eotUpgradeDiscount`         a virtual recurring End-of-Turn entry (`ancientTradesUpgrade`): the FINAL upgrade price −N,
 *                                 Frugal's +2 included, down to 0 (`cutUpgradeCost` + `tradesSurchargeOff`). (Time)
 *  · `refreshUpgradeDiscount`     `ancientAfterRefresh`: every Refresh, the same −N on the final price. (Bonds)
 *  SOREN (Reclaim, `resummon`; owner pairings 2026-10-02). Reclaim = "Choose a friendly minion. At the start of combat,
 *  destroy it and resummon a copy when there is room." (free, once per turn). The Shop half MARKS the minion
 *  (`BoardCard.resummon`); combat's Start-of-Combat loop destroys it as a true death (its Echo fires) and queues an
 *  exact copy that returns the moment its side has room. The combat halves ride `QuestCombatMods.ancientReclaim`.
 *  · `reclaimEchoExtra`           COMBAT: the Echo Reclaim's destroy triggers fires `extra` more times, through
 *                                 `playerEchoExtras` (the shared Echo-multiplier fold), so Echo watchers hear each. (Death)
 *  · `reclaimInShop`              the reducer's `resummon` branch: no mark; the minion is destroyed in the Shop right away
 *                                 (`destroyMinionInShop`, a true death: no Rise / Rebirth, its Echo fires), an exact copy
 *                                 returns to its slot (a summon: `fireSummonBuffs`), and the use gains `gold`. No room
 *                                 after the Echo: an overflow (`fireSummonOverflow`), and the copy is lost. (Fortune)
 *  · `reclaimGainImproves`        COMBAT: each returned copy gains +X/+X, a combat buff (Engraved keeps it); X starts at
 *                                 `amount` and `ancientStartOfTurn` improves it by `amount` (`AncientsState.sorenWarGain`). (War)
 *  · `reclaimCopyLocked`          the `resummon` branch, after the mark: a plain copy of the target to hand, locked for
 *                                 `turns` turns (`lockedUntilWave`, Hourglass Reserve's lock). Hand full: none. (Genesis)
 *  · `reclaimSummonsTwice`        COMBAT: the Reclaimed body is resummoned `copies` times, each waiting for room. (Time)
 *  · `reclaimBondsAdjacent`       COMBAT: when a returned copy lands, its living neighbours gain its Attack, a combat buff. (Bonds)
 *  ROBIN (Spoils, `sellGold`, PASSIVE; owner pairings 2026-10-02). Spoils = "For each minion you sell, gain 1 Gold next
 *  turn." A Spoils count is ONE sale: every sale banks it, the manual sale and the spell sales alike (`settleMinionSale`,
 *  Fodder Treatment, Feed the Alpha), and all three call `ancientOnRobinSale` (via recruit's `bankSpoils`), so the
 *  sale-keyed pairings below hear every sale exactly once. Sales only happen in the Shop.
 *  · `summonGainPerSpoils`        SHOP: the `onSummon` fire chokepoint (`ancientOnShopSummon`: a play from hand, a token
 *                                 summon), a permanent gain; COMBAT: `QuestCombatMods.ancientSummonGain` at the summon-
 *                                 entry chokepoint, a combat buff. The amount is +a/+h x this turn's Spoils count
 *                                 (`AncientsState.robinSpoils`, keyed on the wave so a new turn reads 0). (Death)
 *  · `sellsGrantFreeRefresh`      every `every`th sale (one running count since the pick, `robinSales`) banks a free
 *                                 Refresh (`RunState.freeRolls`) right then. (Fortune)
 *  · `saleBuffsLeftmost`          every sale: the left-most board minion (after the sale) gains +a/+h, permanently. (War)
 *  · `sellsGetCopy`               every `every`th sale (`robinWindow`, the sold cardIds since the last payout): a plain copy
 *                                 of a random one of them (seeded), hand first, the board when the hand is full. (Genesis)
 *  · `eotMaxGold`                 a virtual recurring End-of-Turn entry (`ancientRobinMaxGold`): +gold max Gold,
 *                                 permanently (`maxGoldBonus`, the Gold Font / Shop License channel; no cap). (Time)
 *  · `saleDiscountsTribe`         every sale marks the sold minion's type(s) (`robinBonds`); the next minion of a marked
 *                                 type you buy costs at most `price` (`offerBuyPrice`), and the buy spends that mark. (Bonds)
 *  RE-PETE (Second Hand, `secondHand`, PASSIVE; owner pairings 2026-10-02). Second Hand = "At the end of every 3rd turn,
 *  get a plain copy of the left-most card in your hand." It resolves in the reducer's End-of-Turn tail (turns 3, 6, 9,
 *  ...), a conjured plain copy (no pool take), Rune of Wishbone adding copies. Its shape hooks are read there:
 *  `ancientSecondHandEvery` (the cadence), `ancientSecondHandSources` (what it copies), `ancientSecondHandExact` (how it
 *  copies) and `ancientAfterSecondHand` (what the copies gain).
 *  · `combatLastDeathCopy`        COMBAT: `QuestCombatMods.ancientLastDeathCopy`: the avenge bus remembers the side's
 *                                 last friendly death; when the fight ends, a plain copy of it flies to hand
 *                                 (`grantToHand`, a live `toHand`). No death: nothing. (Death)
 *  · `buysDiscoverLocked`         every `every`th card bought (one running count since the pick, spells included,
 *                                 `repeteBuys`): a Discover of those cards (spells offered too, owner 2026-10-02), the
 *                                 pick locked in hand for `turns` turns (`lockedUntilWave`). (Fortune)
 *  · `secondHandBuffImproves`     every minion Second Hand makes gains +X/+X permanently; X starts at `amount` and
 *                                 improves by `amount` after each trigger (`repeteWarGain`). (War)
 *  · `secondHandExact`            Second Hand makes EXACT copies (`exactBoardCopy`). (Genesis)
 *  · `secondHandEvery`            Second Hand triggers every `turns` turns instead of every 3. (Time)
 *  · `secondHandEdges`            Second Hand copies the left-most AND right-most board minions instead (one copy when
 *                                 they are the same minion; an empty board copies nothing). (Bonds)
 *  GORR (Four Peat, `fourPeat`, PASSIVE; owner pairings 2026-10-02). Four Peat = "When you buy 3 minions in a turn, get a
 *  plain copy of one of them at random." Every pairing below hears buys through `ancientOnBuy` (the reducer's post-buy
 *  block, every buy path once), which keeps the per-turn log of minions bought (`gorrBuys`, the bodied buys of the last
 *  two turns) and the per-turn minion-buy count (`gorrMinionBuys`, the Starform included) while Ancients are on, so buys
 *  made before the pick count. "Get a copy" is a PLAIN copy to hand (hand full: none).
 *  · `avengeCopyLastTurnBuy`      a hero Avenge (N) on ONE running count of friendly deaths across the Shop
 *                                 (`ancientGorrShopDeath` at `fireOnFriendDeath`) and combat (`QuestCombatMods.
 *                                 ancientGorrAvenge`, real time): each fire, a plain copy of a random minion bought LAST
 *                                 turn (wave - 1). None bought: nothing. (Death)
 *  · `firstMinionFree`            the first minion bought each turn is free: `offerBuyPrice`'s `freeBuy` (the Freedom rift /
 *                                 First Pick marker, so the UI coin and the bots read it), only while no minion has been
 *                                 bought this turn. (Fortune)
 *  · `pummelCopyWarband`          COMBAT: `QuestCombatMods.ancientPummelCopy`, a HERO-level Pummel on Albus' tally
 *                                 (lifetime, `pummelDealt`), repeating: every multiple crossed sends a plain copy of a
 *                                 random living friendly minion to hand, mid-fight. (War)
 *  · `firstBuyExtraCopy`          the first minion bought each turn also gives a plain copy to hand. (Genesis)
 *  · `eotCopyThisTurnBuy`         a virtual recurring End-of-Turn entry (`ancientGorrEotCopy`): a plain copy of a random
 *                                 minion bought this turn. None bought: nothing. (Time)
 *  · `buysBuffImproves`           every `every`th card bought (a running count, spells included, `gorrBondsWindow`): the
 *                                 MINIONS among those buys gain +X/+X permanently wherever they are now (hand or board;
 *                                 a spell, the Starform, or a body that left gets nothing); X starts at `amount` and
 *                                 improves by `amount` per payout (`gorrBondsGain`). (Bonds)
 *
 * Serialisable plain data throughout, so saves / snapshots / replays can carry it cheaply later (not in the MVP).
 */
import { makeRng, type CardDef, type EffectDef, type Keyword, type QuestCombatMods, type RiseTint, type Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { handCap, mixSeed, type BoardCard, type RunState, type ShopCard, type SotBeatFx } from './state';
import { pushSotBeat, recordSotBeat } from './sotBeat';
import { STARFORM_ID } from './starform';
import { hasPower, type HeroPower } from './heroes';
import type { CombatResult } from '@game/core';
import { castSpell, exactBoardCopy, stampXeroxBond, addBuff, aegisGrantOf, captureBuffFx, destroyMinionInShop, fireShopEchoOf, grantMinionToHandOrBoard, improveReps, instanceEffects, makeContext, queueDiscover, dominantBoardTribe, fireSummonBuffs, fireSummonOverflow, gainGold } from './recruit';
import { CONFIG, INDY_GILD_RECHARGE_GOLD, hasTier7Access, maxTierFor } from './config';

export type AncientId = 'death' | 'fortune' | 'war' | 'genesis' | 'time' | 'bonds';
export const ANCIENT_IDS: readonly AncientId[] = ['death', 'fortune', 'war', 'genesis', 'time', 'bonds'];

export interface AncientDef {
  id: AncientId;
  name: string;
  /** THE ANCIENT'S COLOUR TABLE (owner 2026-09-25: Death green/teal, Fortune gold; War crimson, Genesis leaf green and
   *  Time azure are placeholders): its pill, its preview dot, and the flat placeholder emblem. `glyph` is the placeholder
   *  emblem's mark; `color2` is spare. The ✦ Ancients tuner can override each colour live. */
  glyph: string;
  color: string;
  color2: string;
}

export const ANCIENTS: Record<AncientId, AncientDef> = {
  death: { id: 'death', name: 'Ancient of Death', glyph: '☠', color: '#1fa89a', color2: '#2a1f45' },
  fortune: { id: 'fortune', name: 'Ancient of Fortune', glyph: '⚜', color: '#e3aa2b', color2: '#5a3f0c' },
  war: { id: 'war', name: 'Ancient of War', glyph: '⚔', color: '#c9363b', color2: '#4a1410' },
  genesis: { id: 'genesis', name: 'Ancient of Genesis', glyph: '✺', color: '#5aae3c', color2: '#12402a' },
  time: { id: 'time', name: 'Ancient of Time', glyph: '⧗', color: '#2f8fd8', color2: '#10334a' },
  // Purple (owner 2026-09-26: "purple aesthetic"): a warm violet, clear of Time's azure and the teal curtain.
  bonds: { id: 'bonds', name: 'Ancient of Bonds', glyph: '∞', color: '#9b5de5', color2: '#2e1650' },
};

// ── Effect primitives ────────────────────────────────────────────────────────────────────────────────────────
/** The Ancient effect vocabulary. A new pairing is data built from these; a genuinely new behaviour adds ONE
 *  primitive here plus its single hook (the card-effect contract, applied to Ancients). */
export type AncientEffect =
  /** The hero power's TARGET also gains these keywords, permanently. */
  | { do: 'powerTargetGainsKeywords'; keywords: Keyword[] }
  /** The hero power no longer does its own thing: it gives `count` PLAIN copies of the target instead (triples checked). */
  | { do: 'powerGivesCopiesInstead'; count: number }
  /** Selling a GILDED minion (any source) gets a plain copy of it. */
  | { do: 'sellGildedGetsPlainCopy'; count: number }
  /** Whenever a friendly minion dies (Shop AND combat), your gilded minions gain +a/+h, permanently. */
  | { do: 'friendlyDeathBuffsGilded'; attack: number; health: number }
  /** Start of Combat: your right-most minion becomes Gilded for that combat (reverts after). */
  | { do: 'socGildRightmost' }
  /** The hero power may target an already-Gilded minion (it is not gilded again; the rest still applies). */
  | { do: 'powerTargetsGilded' }
  /** The hero power's target gains +a/+h for every minion that became Gilded this run, permanently. */
  | { do: 'powerBuffPerGild'; attack: number; health: number }
  // ── Warden (Aegis) ──
  /** Aegis destroys its target; a random other friendly minion (one without Ward first) gains its Attack (permanent)
   *  and Ward. Replaces the power's own grant. */
  | { do: 'aegisDestroyGivesAttackAndWard' }
  /** Each FRIENDLY Ward that breaks in combat: gain `gold` next turn (stacking). */
  | { do: 'wardBreakGold'; gold: number }
  /** The next `count` Aegis casts after the pick grant Resilient Ward instead of Ward. */
  | { do: 'aegisUpgradesWardToResilient' }
  /** Every `every` friendly Ward breaks in combat (a running count across combats): get a plain copy of one of the
   *  minions whose Ward broke in that window. */
  | { do: 'wardBreaksGetCopy'; every: number }
  /** End of Turn: every friendly minion with Ward gains +a/+h, permanently. */
  | { do: 'eotBuffWarded'; attack: number; health: number }
  /** When a friendly minion with Ward gains stats, another random friendly minion with Ward gains +attack Attack.
   *  That grant never re-triggers it. */
  | { do: 'wardedGainBuffsWarded'; attack: number }
  // ── Auctioneer (Pulse) ──
  /** Pulse fires the target's Shout `extra` more times, then destroys it (a real shop death). */
  | { do: 'pulseRepeatThenDestroy'; extra: number }
  /** Every Shout FIRE in the Shop phase: gain `gold` next turn. Combat Shouts do not count. */
  | { do: 'shopShoutGold'; gold: number }
  /** The Pulse target also gains "Rally: trigger this minion's Shout" (once per minion). */
  | { do: 'pulseGrantsRallyShout' }
  /** Pulse is replaced: Discover a Shout minion at your tier or below (the cost rides the pairing's `power`). */
  | { do: 'pulseDiscoverShout' }
  /** Start of Combat: trigger your left-most and right-most Shouts (once when they are the same minion). */
  | { do: 'socTriggerEdgeShouts' }
  /** Whenever a friendly Shout triggers (Shop AND combat), the minions next to it gain +a/+h. */
  | { do: 'shoutBuffsAdjacent'; attack: number; health: number }
  // ── Lord of the Risen (Undying) ──
  /** The Undying body regains Rise right after it Rises in combat, once per combat. */
  | { do: 'undyingRegainsRise' }
  /** Every friendly Rise in combat: gain `gold` next turn. */
  | { do: 'riseGold'; gold: number }
  /** The Undying body returns from its Rise with double Attack and attacks immediately. */
  | { do: 'undyingReturnsDoubleAndAttacks' }
  /** Every friendly summon in combat (a Rise and a Rebirth included) summons `extra` more copies. */
  | { do: 'summonsSummonExtra'; extra: number }
  /** Start of Turn: your minions gain +a/+h for every friendly minion summoned in the last combat. */
  | { do: 'sotBuffPerCombatSummon'; attack: number; health: number }
  /** Whenever a friendly minion Rises (Shop AND combat), trigger the Echo of a minion next to it. */
  | { do: 'riseTriggersAdjacentEcho' }
  // ── Albus (Empowerment) ──
  /** A minion Empowerment discovers gains Rise when it has an Echo. */
  | { do: 'empowerEchoGainsRise' }
  /** A minion Empowerment discovers costs 0 Gold to buy. */
  | { do: 'empowerFree' }
  /** Hero-level Pummel (X): every friendly landed hit fills one tally; each multiple of `every` gets `count` × `cardId`
   *  to hand, once per combat. */
  | { do: 'pummelGrantsCards'; every: number; count: number; cardId: string }
  /** Empowerment also sends a plain copy of the chosen minion to hand (the cost rides the pairing's `power`). */
  | { do: 'empowerCopyToHand' }
  /** Empowerment is passive; Start of Turn: Discover a minion from the tier above your Shop tier. */
  | { do: 'sotDiscoverTierAbove' }
  /** Playing an odd-tier minion from hand gives your other odd-tier minions +a/+h (even likewise). */
  | { do: 'playParityBuff'; attack: number; health: number }
  // ── Hunch (Rounded Spellbook) ──
  /** Avenge (`every`) in combat: improve your spells by +a/+h (spell power, permanent). */
  | { do: 'avengeImproveSpells'; every: number; attack: number; health: number }
  /** Each Rounded Spellbook use also gives +`gold` max Gold, permanently. */
  | { do: 'spellbookMaxGold'; gold: number }
  /** Your Shop Spells cast `extra` more times in combat. */
  | { do: 'shopSpellsCastExtraInCombat'; extra: number }
  /** Every `every` spells cast: Rounded Spellbook recharges and costs `price` Gold (never more than it already did). */
  | { do: 'spellsRechargeSpellbook'; every: number; price: number }
  /** Spells from Rounded Spellbook cast `mult` times. */
  | { do: 'spellbookCastsTwice'; mult: number }
  /** Whenever you cast a spell (Shop AND combat), your left-most and right-most minions gain +a/+h. */
  | { do: 'spellCastBuffsEdges'; attack: number; health: number }
  // ── Frantic Frank (Clearance) ──
  /** Clearance also destroys your left-most minion, and the first minion bought from its Shop is free. */
  | { do: 'clearanceDestroyFirstFree' }
  /** A minion bought from a Clearance Shop sells for `gold`. */
  | { do: 'clearanceSellValue'; gold: number }
  /** Avenge (`every`): gain a Clearance stack. A stack is one more Clearance use (kept until used). */
  | { do: 'avengeClearanceStack'; every: number }
  /** Clearance's refresh draws only minions of your most common type (the cost rides the pairing's `power`). */
  | { do: 'clearanceTopTribe' }
  /** Clearance is passive; the first `count` minions you buy each turn cost `price` Gold. */
  | { do: 'firstBuysCost'; count: number; price: number }
  /** Selling a minion bought from a Clearance Shop gives its current stats to a random friendly minion. */
  | { do: 'clearanceSaleGivesStats' }
  // ── Xerox (Copy Machine) ──
  /** Avenge (`every`), Shop AND combat (one running count): summon a copy of your highest-Attack minion. */
  | { do: 'avengeCopyTopAttack'; every: number }
  /** End of Turn: gain `gold` next turn for every pair of minions (same card) on your board. */
  | { do: 'pairsGoldNextTurn'; gold: number }
  /** Start of Combat: summon a copy of your highest-Health minion. */
  | { do: 'socCopyTopHealth' }
  /** Copy Machine gains `charges` more uses (banked at the pick). */
  | { do: 'copyMachineExtraCharge'; charges: number }
  /** Start of Turn: get a copy of a random minion you control. */
  | { do: 'sotCopyToHand' }
  /** Copy Machine's copy and its original are bound: a stat gain on one is gained by the other. A triple breaks it. */
  | { do: 'copyMachineBonds' }
  // ── Tradesman (Frugal) ──
  /** Avenge (`every`), Shop AND combat (one running count): gain a free Refresh. */
  | { do: 'avengeFreeRefresh'; every: number }
  /** Buying a minion from the Shop gains `count` free Refreshes. */
  | { do: 'buyNextRefreshFree' }
  /** Your minions have "Rally: gain `gold` Gold next turn." (a graft on every friendly minion, both phases). */
  | { do: 'minionsRallyGold'; gold: number }
  /** Every `every` Refreshes (free ones included), cast `spellId`. */
  | { do: 'refreshesCastSpell'; every: number; spellId: string }
  /** End of Turn: the Shop upgrade costs `amount` less (floored). */
  | { do: 'eotUpgradeDiscount'; amount: number }
  /** Every Refresh (free ones included): the Shop upgrade costs `amount` less (floored). */
  | { do: 'refreshUpgradeDiscount'; amount: number }
  // ── Soren (Reclaim) ──
  /** The Echo Reclaim's Start-of-Combat destroy triggers fires `extra` more times. */
  | { do: 'reclaimEchoExtra'; extra: number }
  /** Reclaim resolves in the Shop instead (destroy + resummon right away), and each use gains `gold`. */
  | { do: 'reclaimInShop'; gold: number }
  /** Reclaimed copies gain +X/+X on their return (combat); X starts at `amount` and improves by `amount` each Start of Turn. */
  | { do: 'reclaimGainImproves'; amount: number }
  /** Reclaim also gives a plain copy of its target to hand, locked for `turns` turns. */
  | { do: 'reclaimCopyLocked'; turns: number }
  /** Reclaim resummons `copies` copies in all. */
  | { do: 'reclaimSummonsTwice'; copies: number }
  /** When a Reclaimed copy returns, the minions next to it gain its Attack (combat). */
  | { do: 'reclaimBondsAdjacent' }
  // ── Robin (Spoils) ──
  /** Every friendly minion summoned (Shop AND combat) gains +a/+h for every Spoils count (sale) this turn. */
  | { do: 'summonGainPerSpoils'; attack: number; health: number }
  /** Every `every` minions sold (a running count): bank a free Refresh. */
  | { do: 'sellsGrantFreeRefresh'; every: number }
  /** Every minion sold: your left-most minion gains +a/+h, permanently. */
  | { do: 'saleBuffsLeftmost'; attack: number; health: number }
  /** Every `every` minions sold: get a plain copy of one of them (random, seeded). */
  | { do: 'sellsGetCopy'; every: number }
  /** End of Turn: +`gold` max Gold, permanently. */
  | { do: 'eotMaxGold'; gold: number }
  /** Selling a minion marks its type; the next minion of that type you buy costs `price` Gold. */
  | { do: 'saleDiscountsTribe'; price: number }
  // ── Re-Pete (Second Hand) ──
  /** When a combat ends, get a plain copy of the last friendly minion that died in it. */
  | { do: 'combatLastDeathCopy' }
  /** Every `every` cards bought: Discover one of them, locked in hand for `turns` turns. */
  | { do: 'buysDiscoverLocked'; every: number; turns: number }
  /** Second Hand's minion copies gain +X/+X; X starts at `amount` and improves by `amount` per trigger. */
  | { do: 'secondHandBuffImproves'; amount: number }
  /** Second Hand makes exact copies. */
  | { do: 'secondHandExact' }
  /** Second Hand triggers every `turns` turns. */
  | { do: 'secondHandEvery'; turns: number }
  /** Second Hand copies the left-most and right-most board minions instead. */
  | { do: 'secondHandEdges' }
  // ── Gorr (Four Peat) ──
  /** Avenge (`every`), across the Shop and combat: get a plain copy of a minion you bought last turn. */
  | { do: 'avengeCopyLastTurnBuy'; every: number }
  /** The first minion you buy each turn is free. */
  | { do: 'firstMinionFree' }
  /** Pummel (`every`), repeating: get a plain copy of a minion in your warband. */
  | { do: 'pummelCopyWarband'; every: number }
  /** The first minion you buy each turn also gives a plain copy. */
  | { do: 'firstBuyExtraCopy' }
  /** End of Turn: a plain copy of a random minion you bought this turn. */
  | { do: 'eotCopyThisTurnBuy' }
  /** Every `every` cards bought: those minions gain +X/+X; X starts at `amount`, improves by `amount` per payout. */
  | { do: 'buysBuffImproves'; every: number; amount: number };

export interface AncientPairing {
  /** The Ancient's text for this hero, as shown on the offer and the preview (the owner's words). */
  offerText: string;
  /** The RESOLVED hero-power text (owner ruling 5: "shows the combined power"). `{base}` = the base power's live
   *  text; `{recharge}` = Indy's live recharge Gold; `{gilds}` / `{gildA}` / `{gildH}` = the run's gild count and
   *  the live Bonds total it grants right now; `{aegis}` = Warden's live Aegis grant ("+5 Attack"); `{wardLeft}` =
   *  Ward breaks still needed for Genesis' next copy; `{riseGold}` = Gold the Risen's last combat banked;
   *  `{summons}` / `{timeA}` / `{timeH}` = the Risen's summon count and the Start-of-Turn grant it pays: LIVE during a
   *  fight (the replay's running count, `{timeWhen}` = "This combat"), else the last combat's (`{timeWhen}` = "Last
   *  combat"), R-ANCRISEN-07. Albus: `{timeTier}` = the tier Time's next Discover draws from; `{pummelNow}` /
   *  `{pummelEvery}` = War's live Pummel progress (toward the next payout, the badge rule) and its X. Frank:
   *  `{deathFree}` = " Free buy ready." while a Death free Clearance offer waits; `{stacks}` = War's banked Clearance stacks
   *  (plus those gained so far in the fight on screen); `{genesisTribe}` = the type Genesis would refresh into right now;
   *  `{timeLeft}` = Time's discounted buys left this turn. Xerox: `{xDeathLeft}` = friendly deaths still needed for
   *  Death's next copy (live through a fight); `{pairs}` / `{pairGold}` = the pairs on the board right now and the Gold
   *  they would bank; `{charges}` = Genesis' Copy Machine uses left; `{bond}` = Bonds' live bond state. Soren: `{reclaimGain}` = War's
   *  live +X/+X. Robin: `{spoils}` / `{spoilA}` / `{spoilH}` = this turn's Spoils count and the summon gain it gives right
   *  now; `{refreshLeft}` / `{copyLeft}` = sales still needed for Fortune's next free Refresh / Genesis' next copy;
   *  `{maxGold}` = Time's max Gold so far; `{bondsTypes}` = Bonds' marked types. */
  powerText: string;
  /** Changes to the hero power's own SHAPE while this pairing is live (Auctioneer: Time makes Pulse passive, Genesis
   *  makes it an untargeted 2 Gold Discover). Stamped on the run at the pick (`AncientsState.powerOverride`) and
   *  folded in by `activePowers`, so the button, the cost coin, the reducer's gates and the bots all read one shape. */
  power?: AncientPowerOverride;
  effects: AncientEffect[];
}

/** The hero-power fields a pairing may override. */
export type AncientPowerOverride = Partial<Pick<HeroPower, 'passive' | 'untargeted' | 'cost'>>;

/** Shown for a hero × Ancient with no written pairing. Has no effect. */
export const ANCIENT_NOT_WRITTEN = 'Not written yet.';

/** The pairing registry: hero id → Ancient → pairing. Indy is the MVP hero (owner ruling 5). */
export const ANCIENT_PAIRINGS: Record<string, Partial<Record<AncientId, AncientPairing>>> = {
  indy: {
    death: {
      // Rebirth, not Rise (owner 2026-09-25: "change indy's ancient of death to give it rebirth instead of rise. it
      // still gets taunt").
      offerText: 'Masterwork targets gain **Rebirth** and **Taunt**.',
      powerText: 'Make a friendly minion **Gilded**. It also gains **Rebirth** and **Taunt**. Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerTargetGainsKeywords', keywords: ['RB', 'T'] }],
    },
    fortune: {
      offerText: 'Selling a **Gilded** minion gets you a plain copy of it.',
      powerText: '{base} Selling a **Gilded** minion gets you a plain copy of it.',
      effects: [{ do: 'sellGildedGetsPlainCopy', count: 1 }],
    },
    war: {
      offerText: '**Gilded** minions gain **+8/+8** when a friendly minion dies, permanently.',
      powerText: '{base} Whenever a friendly minion dies, your **Gilded** minions gain **+8/+8** permanently.',
      effects: [{ do: 'friendlyDeathBuffsGilded', attack: 8, health: 8 }],
    },
    genesis: {
      offerText: 'Masterwork gets **2** copies of a chosen minion instead.',
      powerText: 'Get **2** plain copies of a friendly minion. Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerGivesCopiesInstead', count: 2 }],
    },
    time: {
      offerText: '**Start of Combat:** your right-most minion becomes **Gilded** for that combat.',
      powerText: '{base} **Start of Combat:** your right-most minion becomes **Gilded** for that combat.',
      effects: [{ do: 'socGildRightmost' }],
    },
    bonds: {
      // Owner 2026-09-26: "Ancient of Bonds for Indy -> Masterwork grants +20/+20 for every Gilded minion this game.
      // Can target Gilded minions." The count is `AncientsState.gilds` (see `noteGilded`); gilding a fresh target
      // counts that gild too, so the printed total is what an already-Gilded target would get.
      offerText: 'Masterwork also gives **+20/+20** for every **Gilded** minion this game. It can target **Gilded** minions.',
      powerText: 'Make a friendly minion **Gilded**, or pick a **Gilded** one. It gains **+{gildA}/+{gildH}** (+20/+20 for every **Gilded** minion this game: **{gilds}** so far). Recharges after you spend {recharge} Gold.',
      effects: [{ do: 'powerTargetsGilded' }, { do: 'powerBuffPerGild', attack: 20, health: 20 }],
    },
  },
  // THE WARDEN (owner pairings 2026-09-26, quoted above each entry). Aegis = "Give a friendly minion Ward, then give
  // your minions with Ward +5 Attack."
  warden: {
    death: {
      // "Aegis destroys a friendly minion and gives its Attack and Ward to a friendly minion." The power is REPLACED
      // (judgement call, flagged): the recipient gets the Attack + Ward, and no +5 Attack wave follows. Owner
      // 2026-09-26: the recipient is RANDOM and smart-targeted (a minion without Ward first, else a random Warded one).
      offerText: 'Aegis destroys a friendly minion and gives its Attack and **Ward** to another random friendly minion.',
      powerText: 'Destroy a friendly minion. Give its Attack and **Ward** to another random friendly minion (one without **Ward** first).',
      effects: [{ do: 'aegisDestroyGivesAttackAndWard' }],
    },
    fortune: {
      // "When a Ward breaks in combat, gain 2 gold next turn." Friendly Wards only; one payout per break.
      offerText: 'When one of your **Wards** breaks in combat, gain **2 Gold** next turn.',
      powerText: '{base} When one of your **Wards** breaks in combat, gain **2 Gold** next turn.',
      effects: [{ do: 'wardBreakGold', gold: 2 }],
    },
    war: {
      // Owner 2026-09-26 (replacing "Your next Aegis grants Resilient Ward"): "using aegis on a warded minion grants it
      // resilient ward". A standing rule: every Aegis on a minion that already has Ward upgrades it; the +5 wave stays.
      offerText: 'Aegis on a minion with **Ward** gives it **Resilient Ward** instead. It takes 2 hits to break.',
      powerText: 'Give a friendly minion **Ward**. If it already has **Ward**, it gets **Resilient Ward**. Then give your minions with **Ward** **{aegis}**.',
      effects: [{ do: 'aegisUpgradesWardToResilient' }],
    },
    genesis: {
      // "When 3 Wards break in combat, get a copy of one of the Warded minions." A running count across combats.
      offerText: 'When 3 of your **Wards** break in combat, get a copy of one of those minions.',
      powerText: '{base} When 3 of your **Wards** break in combat, get a copy of one of those minions (**{wardLeft}** more to go).',
      effects: [{ do: 'wardBreaksGetCopy', every: 3 }],
    },
    time: {
      // "End of Turn: Give your Warded minions +5/+5." Permanent.
      offerText: '**End of Turn:** give your minions with **Ward** **+5/+5**.',
      powerText: '{base} **End of Turn:** give your minions with **Ward** **+5/+5**.',
      effects: [{ do: 'eotBuffWarded', attack: 5, health: 5 }],
    },
    bonds: {
      // "When a Warded minion gains stats, give another Warded minion +5 attack. this doesnt re-trigger itself".
      offerText: 'When a minion with **Ward** gains stats, give another minion with **Ward** **+5 Attack**. This does not trigger itself.',
      powerText: '{base} When a minion with **Ward** gains stats, give another minion with **Ward** **+5 Attack**. This does not trigger itself.',
      effects: [{ do: 'wardedGainBuffsWarded', attack: 5 }],
    },
  },
  // THE AUCTIONEER (hero id `myra`; owner pairings 2026-09-26, quoted above each entry). Pulse = "Trigger a friendly
  // minion's Shout." (free, once per turn).
  myra: {
    death: {
      // "Pulse triggers the chosen minion's Shout an additional time, then destroys it."
      offerText: "Pulse triggers the minion's **Shout** one more time, then destroys it.",
      powerText: "Trigger a friendly minion's **Shout** twice, then destroy it.",
      effects: [{ do: 'pulseRepeatThenDestroy', extra: 1 }],
    },
    fortune: {
      // "Whenever you trigger a Shout during the Shop phase, gain 1 Gold next turn."
      offerText: 'Whenever you trigger a **Shout** in the Shop, gain **1 Gold** next turn.',
      powerText: '{base} Whenever you trigger a **Shout** in the Shop, gain **1 Gold** next turn. **{shoutGold} Gold** banked this turn.',
      effects: [{ do: 'shopShoutGold', gold: 1 }],
    },
    war: {
      // "The minion you Pulse gains 'Rally: trigger this minion's Shout'".
      offerText: 'The minion you Pulse also gains "**Rally:** trigger this minion\'s **Shout**."',
      powerText: '{base} It also gains "**Rally:** trigger this minion\'s **Shout**."',
      effects: [{ do: 'pulseGrantsRallyShout' }],
    },
    genesis: {
      // "Pulse becomes: 2g - Discover a Shout minion."
      offerText: 'Pulse becomes: pay **2 Gold** to **Discover** a **Shout** minion.',
      powerText: '**Discover** a **Shout** minion.',
      power: { untargeted: true, cost: 2 },
      effects: [{ do: 'pulseDiscoverShout' }],
    },
    time: {
      // "Pulse becomes passive. Start of Combat: trigger your left-most and right-most Shouts. If you have only one
      // Shout, trigger it once."
      offerText: 'Pulse becomes passive. **Start of Combat:** trigger your left-most and right-most **Shouts**. With only one, trigger it once.',
      powerText: '**Start of Combat:** trigger your left-most and right-most **Shouts**. With only one, trigger it once.',
      power: { passive: true },
      effects: [{ do: 'socTriggerEdgeShouts' }],
    },
    bonds: {
      // "Shout triggers buff adjacent minions +4/+3."
      offerText: 'Whenever you trigger a **Shout**, the minions next to it gain **+4/+3**.',
      powerText: '{base} Whenever you trigger a **Shout**, the minions next to it gain **+4/+3**.',
      effects: [{ do: 'shoutBuffsAdjacent', attack: 4, health: 3 }],
    },
  },
  // LORD OF THE RISEN (hero id `risen`; owner pairings 2026-09-26, quoted above each entry). Undying = "Give a friendly
  // minion Rise for the next combat."
  risen: {
    death: {
      // "Undying's target gains Rise after rising. (Once per combat.)" Shown as a BLUE Rise.
      offerText: "Undying's target gains **Rise** again after it Rises. Once per combat.",
      powerText: '{base} After it Rises, it gains **Rise** again. Once per combat.',
      effects: [{ do: 'undyingRegainsRise' }],
    },
    fortune: {
      // "When a minion Rises each combat, gain 1 Gold next turn."
      offerText: 'When one of your minions Rises in combat, gain **1 Gold** next turn.',
      powerText: '{base} When one of your minions Rises in combat, gain **1 Gold** next turn. Last combat: **{riseGold} Gold**.',
      effects: [{ do: 'riseGold', gold: 1 }],
    },
    war: {
      // "The minion chosen by Undying returns with double Attack and attacks immediately." Shown as a RED Rise.
      offerText: 'The minion you pick with Undying Rises with double Attack and attacks immediately.',
      powerText: '{base} When it Rises, it has double Attack and attacks immediately.',
      effects: [{ do: 'undyingReturnsDoubleAndAttacks' }],
    },
    genesis: {
      // "Your summons summon an extra minion in combat." (owner: "adds 1 to any and all summon effects in combat,
      // including rise"; "make sure these count as overflows"; "this also makes echo summons summon an extra body")
      // Owner text trim 2026-09-26: "remove the sentence 'This includes minions that Rise.'" (behaviour unchanged: a
      // Rise still gets its extra copy).
      offerText: 'In combat, each minion you summon summons an extra copy.',
      powerText: '{base} In combat, each minion you summon summons an extra copy.',
      effects: [{ do: 'summonsSummonExtra', extra: 1 }],
    },
    time: {
      // "Start of Turn: Give your minions +3/+2 for every minion summoned in combat." (owner: the previous combat only;
      // "summoned counts anything from hand, echo summons, and rising bodies")
      offerText: '**Start of Turn:** give your minions **+3/+2** for each minion you summoned last combat.',
      powerText: '{base} **Start of Turn:** give your minions **+3/+2** for each minion you summoned last combat. {timeWhen}: **{summons}** summoned (**+{timeA}/+{timeH}**).',
      effects: [{ do: 'sotBuffPerCombatSummon', attack: 3, health: 2 }],
    },
    bonds: {
      // "When a minion Rises, trigger an adjacent Echo." (owner: a random one when both neighbours have one; nothing
      // when neither; "this stacks with any other potential effects and triggers")
      offerText: 'When one of your minions Rises, trigger the **Echo** of a minion next to it.',
      powerText: '{base} When one of your minions Rises, trigger the **Echo** of a minion next to it.',
      effects: [{ do: 'riseTriggersAdjacentEcho' }],
    },
  },
  // ALBUS (owner pairings 2026-09-28, quoted above each entry). Empowerment = "Choose a Shop minion. Discover a minion
  // from the tier above it for it to become." (1 Gold, once per turn). The pick replaces the Shop offer.
  albus: {
    death: {
      // "Echo minions discovered from Empowerment gain Rise."
      offerText: 'Minions you **Discover** with Empowerment that have an **Echo** gain **Rise**.',
      powerText: '{base} If it has an **Echo**, it gains **Rise**.',
      effects: [{ do: 'empowerEchoGainsRise' }],
    },
    fortune: {
      // "Minions discovered by Empowerment are free."
      offerText: 'Minions you **Discover** with Empowerment are free.',
      powerText: '{base} It costs **0 Gold**.',
      effects: [{ do: 'empowerFree' }],
    },
    war: {
      // "Pummel (80): Get 2 Strange Revisions. (Once per Combat)" A hero-level Pummel over your minions' damage.
      offerText: '**Pummel (80):** get **2** Strange Revisions. Once per combat. Counts damage dealt by all your minions.',
      powerText: '{base} **Pummel (80):** get **2** Strange Revisions. Once per combat. Counts damage dealt by all your minions (**{pummelNow}/{pummelEvery}**).',
      effects: [{ do: 'pummelGrantsCards', every: 80, count: 2, cardId: 'strangerevision' }],
    },
    genesis: {
      // "Empowerment costs 3g. You also get a copy of the chosen minion sent to your hand."
      offerText: 'Empowerment costs **3 Gold**. You also get a copy of the minion you choose in your hand.',
      powerText: '{base} You also get a copy of it in your hand.',
      power: { cost: 3 },
      effects: [{ do: 'empowerCopyToHand' }],
    },
    time: {
      // "Empowerment becomes Start of Turn: Discover a minion from the tier above you."
      offerText: 'Empowerment becomes passive. **Start of Turn:** **Discover** a minion from the tier above your Shop.',
      powerText: '**Start of Turn:** **Discover** a minion from the tier above your Shop (**Tier {timeTier}**).',
      power: { passive: true },
      effects: [{ do: 'sotDiscoverTierAbove' }],
    },
    bonds: {
      // "Playing odd tier units grants +3/+3 to friendly odd tier units. Playing even tier units grants +3/+3 to
      // friendly even tier units." The played minion itself is not included (the "other" convention).
      offerText: 'Playing an odd-tier minion gives your other odd-tier minions **+3/+3**. Playing an even-tier minion gives your other even-tier minions **+3/+3**.',
      powerText: '{base} Playing an odd-tier minion gives your other odd-tier minions **+3/+3**. Playing an even-tier minion gives your other even-tier minions **+3/+3**.',
      effects: [{ do: 'playParityBuff', attack: 3, health: 3 }],
    },
  },
  // HUNCH (owner pairings 2026-09-30, quoted above each entry). Rounded Spellbook = "Get a copy of the last spell you
  // cast. Costs 3 Gold, reduced by 1 each turn." (once per turn).
  hunch: {
    death: {
      // "Avenge (4) Improve your spells by +1/+1."
      offerText: '**Avenge (4):** improve your spells by **+1/+1**.',
      powerText: '{base} **Avenge (4):** improve your spells by **+1/+1** (**{avengeNow}/4**). Improved so far: **+{deathA}/+{deathH}**.',
      effects: [{ do: 'avengeImproveSpells', every: 4, attack: 1, health: 1 }],
    },
    fortune: {
      // "Rounded Spellbook also increases max gold by 1."
      offerText: 'Rounded Spellbook also gives you **+1 max Gold**.',
      powerText: '{base} It also gives you **+1 max Gold**. **+{bookGold}** so far.',
      effects: [{ do: 'spellbookMaxGold', gold: 1 }],
    },
    war: {
      // "Shop Spells cast an additional time in combat" (Runebloom Matriarch's rule, from the hero).
      offerText: 'Your **Shop Spells** cast an extra time in combat.',
      powerText: '{base} Your **Shop Spells** cast an extra time in combat.',
      effects: [{ do: 'shopSpellsCastExtraInCombat', extra: 1 }],
    },
    genesis: {
      // "Casting 5 spells resets rounded spellbook at 1g"
      offerText: 'Every **5** spells you cast, Rounded Spellbook recharges and costs **1 Gold**.',
      powerText: '{base} Every **5** spells you cast, it recharges and costs **1 Gold** (**{genesisLeft}** more to go).',
      effects: [{ do: 'spellsRechargeSpellbook', every: 5, price: 1 }],
    },
    time: {
      // "Spells from rounded spellbook cast twice."
      offerText: 'Spells you get from Rounded Spellbook cast **twice**.',
      powerText: '{base} The copy casts **twice**.',
      effects: [{ do: 'spellbookCastsTwice', mult: 2 }],
    },
    bonds: {
      // "Casting spells grants your left and right-most minion +2/+3."
      offerText: 'Whenever you cast a spell, give your left and right-most minions **+2/+3**.',
      powerText: '{base} Whenever you cast a spell, give your left and right-most minions **+2/+3**.',
      effects: [{ do: 'spellCastBuffsEdges', attack: 2, health: 3 }],
    },
  },
  // FRANTIC FRANK (owner pairings 2026-09-30, quoted above each entry). Clearance = "Refresh the Shop. Its minions cost
  // 2 Gold this turn." (1 Gold, once per turn). "Clearance minions" = minions bought from a Clearance-marked Shop.
  frank: {
    death: {
      // Owner 2026-09-30 (replacing "makes the Shop free this turn"): "make death - destroy leftmost minion and makes the
      // first minion you buy from clearance free".
      offerText: 'Clearance also destroys your left-most minion. The first minion you buy from it is free.',
      powerText: 'Destroy your left-most minion. Refresh the Shop. Its minions cost 2 Gold this turn, and the first one you buy is free.{deathFree}',
      effects: [{ do: 'clearanceDestroyFirstFree' }],
    },
    fortune: {
      // "Clearance minions sell for 2g"
      offerText: 'Minions you buy from Clearance sell for **2 Gold**.',
      powerText: '{base} Minions you buy from it sell for **2 Gold**.',
      effects: [{ do: 'clearanceSellValue', gold: 2 }],
    },
    war: {
      // "Avenge (3): Gain a Clearance stack. * this lets clearance be used more than once per turn, up to however many
      // stacks they have". Stacks are kept until used; a use once the turn's own Clearance is spent takes one.
      offerText: '**Avenge (3):** gain a Clearance stack. Each stack lets you use Clearance one more time.',
      powerText: '{base} **Avenge (3):** gain a Clearance stack. Each stack is one more use (**{stacks}** banked).',
      effects: [{ do: 'avengeClearanceStack', every: 3 }],
    },
    genesis: {
      // "Clearance costs 3g but refreshes with minions of your most common type."
      offerText: 'Clearance costs **3 Gold**, and it refreshes the Shop with minions of your most common type.',
      powerText: 'Refresh the Shop with minions of your most common type{genesisTribe}. Its minions cost 2 Gold this turn.',
      power: { cost: 3 },
      effects: [{ do: 'clearanceTopTribe' }],
    },
    time: {
      // "Clearance becomes 'The first 3 minions you buy each turn cost 2g.'"
      offerText: 'Clearance becomes passive: the first **3** minions you buy each turn cost **2 Gold**.',
      powerText: 'The first **3** minions you buy each turn cost **2 Gold** (**{timeLeft}** left this turn).',
      power: { passive: true },
      effects: [{ do: 'firstBuysCost', count: 3, price: 2 }],
    },
    bonds: {
      // "Selling Clearance minions grants the minions stats to a random friendly minion."
      offerText: 'Selling a minion you bought from Clearance gives its stats to a random friendly minion.',
      powerText: '{base} Selling a minion you bought from it gives its stats to a random friendly minion.',
      effects: [{ do: 'clearanceSaleGivesStats' }],
    },
  },
  // XEROX (owner pairings 2026-10-02, quoted above each entry). Copy Machine = "Summon an exact copy of a friendly
  // minion. Needs a free board slot. Once per game." Every "copy" below is Copy Machine's exact copy.
  xerox: {
    death: {
      // "Avenge (5): Summon a copy of your highest attack minion"
      offerText: '**Avenge (5):** summon a copy of your highest Attack minion.',
      powerText: '{base} **Avenge (5):** summon a copy of your highest Attack minion (**{xDeathLeft}** more to go).',
      effects: [{ do: 'avengeCopyTopAttack', every: 5 }],
    },
    fortune: {
      // "Gain 4g next turn for every pair you have on board"
      offerText: '**End of Turn:** gain **4 Gold** next turn for every pair of minions on your board.',
      powerText: '{base} **End of Turn:** gain **4 Gold** next turn for every pair of minions on your board (**{pairs}** now: **{pairGold} Gold**).',
      effects: [{ do: 'pairsGoldNextTurn', gold: 4 }],
    },
    war: {
      // "Start of Combat: Summon a copy of your highest health minion"
      offerText: '**Start of Combat:** summon a copy of your highest Health minion.',
      powerText: '{base} **Start of Combat:** summon a copy of your highest Health minion.',
      effects: [{ do: 'socCopyTopHealth' }],
    },
    genesis: {
      // "Gain another charge of Copy Machine"
      offerText: 'Copy Machine gains another use.',
      powerText: 'Summon an exact copy of a friendly minion. Needs a free board slot. **{charges}** uses left.',
      effects: [{ do: 'copyMachineExtraCharge', charges: 1 }],
    },
    time: {
      // "Start of Turn: Get a copy of a minion you control."
      offerText: '**Start of Turn:** get a copy of a random minion you control.',
      powerText: '{base} **Start of Turn:** get a copy of a random minion you control.',
      effects: [{ do: 'sotCopyToHand' }],
    },
    bonds: {
      // "The copy and the original are bound. Stats one gains, the other gains too. * if this triples, the effect breaks"
      offerText: 'The copy and the original are bound: when one gains stats, the other gains them too. A triple breaks the bond.',
      powerText: '{base} The copy and the original are bound: when one gains stats, the other gains them too. A triple breaks the bond.{bond}',
      effects: [{ do: 'copyMachineBonds' }],
    },
  },
  // TRADESMAN (hero id `hermithank`; owner pairings 2026-10-02, quoted above each entry). Frugal is PASSIVE: "Shop
  // minions cost 2 Gold. Shop upgrades cost 2 more, and rerolls cost 2 Gold." So every pairing adds to it. "A
  // Refresh" is every Shop refresh the Ancients meter counts (paid, free, a power's), never the turn-start roll.
  hermithank: {
    death: {
      // "Avenge (3): Gain a free Refresh"
      offerText: '**Avenge (3):** gain a free Refresh.',
      powerText: '{base} **Avenge (3):** gain a free Refresh (**{tDeathLeft}** more to go). Free Refreshes banked: **{freeRolls}**.',
      effects: [{ do: 'avengeFreeRefresh', every: 3 }],
    },
    fortune: {
      // "when you buy a minion, your next refresh costs 0" (owner 2026-10-02, replacing "gain a free Refresh": "this
      // way it doesn't stack up multiple free refreshes")
      offerText: 'When you buy a minion, your next Refresh costs 0.',
      powerText: '{base} When you buy a minion, your next Refresh costs 0. Next Refresh free: **{tNextFree}**.',
      effects: [{ do: 'buyNextRefreshFree' }],
    },
    war: {
      // "Your minions gain Rally: Gain 1g next turn"
      offerText: 'Your minions gain "**Rally:** gain **1 Gold** next turn."',
      powerText: '{base} Your minions have "**Rally:** gain **1 Gold** next turn." **{rallyGold} Gold** banked for next turn.',
      effects: [{ do: 'minionsRallyGold', gold: 1 }],
    },
    genesis: {
      // "Every 2 Refreshes, cast Lasso."
      offerText: 'Every **2** Refreshes, cast **Lasso**.',
      powerText: '{base} Every **2** Refreshes, cast **Lasso** (**{lassoLeft}** more to go).',
      effects: [{ do: 'refreshesCastSpell', every: 2, spellId: 'lasso' }],
    },
    time: {
      // "End of Turn: Reduce the cost of upgrading the Shop by 3."
      offerText: '**End of Turn:** reduce the cost of upgrading the Shop by **3**.',
      powerText: '{base} **End of Turn:** reduce the cost of upgrading the Shop by **3**.{upgradeNow}',
      effects: [{ do: 'eotUpgradeDiscount', amount: 3 }],
    },
    bonds: {
      // "Refreshing the shop reduces the cost of upgrading the Shop by 1."
      offerText: 'Refreshing the Shop reduces the cost of upgrading the Shop by **1**.',
      powerText: '{base} Refreshing the Shop reduces the cost of upgrading the Shop by **1**.{upgradeNow}',
      effects: [{ do: 'refreshUpgradeDiscount', amount: 1 }],
    },
  },
  // SOREN (owner pairings 2026-10-02, quoted above each entry). Reclaim = "Choose a friendly minion. At the start of
  // combat, destroy it and resummon a copy when there is room." (free, once per turn).
  soren: {
    death: {
      // "Echoes triggered by Reclaim trigger an additional time."
      offerText: 'The **Echo** Reclaim triggers fires an extra time.',
      powerText: '{base} Its **Echo** triggers an extra time.',
      effects: [{ do: 'reclaimEchoExtra', extra: 1 }],
    },
    fortune: {
      // "Reclaim works in Recruit phase instead. Gain 5g when it is used." Owner 2026-10-02 on a full board: "it'd be an
      // 'overflow' technically, but if no room then it is lost".
      offerText: 'Reclaim works in the Shop instead. Gain **5 Gold** when you use it.',
      powerText: 'Choose a friendly minion. Destroy it and resummon a copy right away, if there is room. Gain **5 Gold**.',
      effects: [{ do: 'reclaimInShop', gold: 5 }],
    },
    war: {
      // "Reclaimed minions gain +10/+10 on re-summon. Start of Turn: Improve this." Owner 2026-10-02: "fight only, but
      // engraving etc would carry it back".
      offerText: 'Reclaimed minions gain **+10/+10** when they return. **Start of Turn:** improve this by **+10/+10**.',
      powerText: '{base} The copy gains **+{reclaimGain}/+{reclaimGain}** for that combat. **Start of Turn:** improve this by **+10/+10**.',
      effects: [{ do: 'reclaimGainImproves', amount: 10 }],
    },
    genesis: {
      // "Reclaim grants a plain copy of the minion you target, but it is locked for 3 turns."
      offerText: 'Reclaim also gets you a plain copy of the minion you choose. It is locked for **3** turns.',
      powerText: '{base} You also get a plain copy of it in your hand, locked for **3** turns.',
      effects: [{ do: 'reclaimCopyLocked', turns: 3 }],
    },
    time: {
      // "Reclaim summons twice."
      offerText: 'Reclaim resummons **2** copies.',
      powerText: 'Choose a friendly minion. At the start of combat, destroy it and resummon **2** copies when there is room.',
      effects: [{ do: 'reclaimSummonsTwice', copies: 2 }],
    },
    bonds: {
      // "When the reclaimed minion summons, grant its attack to adjacent minions." Owner 2026-10-02: "That fight only".
      offerText: 'When a Reclaimed minion returns, the minions next to it gain its Attack.',
      powerText: '{base} When it returns, the minions next to it gain its Attack for that combat.',
      effects: [{ do: 'reclaimBondsAdjacent' }],
    },
  },
  // ROBIN (owner pairings 2026-10-02, quoted above each entry). Spoils (passive) = "For each minion you sell, gain 1 Gold
  // next turn." A Spoils count is one sale.
  robin: {
    death: {
      // "Summoned minions gain +3/+2 for every count of Spoils this turn."
      offerText: 'Minions you summon gain **+3/+2** for every minion you sold this turn.',
      powerText: '{base} Minions you summon gain **+3/+2** for every minion you sold this turn (**{spoils}** sold: **+{spoilA}/+{spoilH}**).',
      effects: [{ do: 'summonGainPerSpoils', attack: 3, health: 2 }],
    },
    fortune: {
      // "Every 2 minions sold also grants a free refresh."
      offerText: 'Every **2** minions you sell also give you a free Refresh.',
      powerText: '{base} Every **2** minions you sell also give you a free Refresh (**{refreshLeft}** more to go).',
      effects: [{ do: 'sellsGrantFreeRefresh', every: 2 }],
    },
    war: {
      // "Give your left-most minion +2/+3 every time you sell a minion."
      offerText: 'Whenever you sell a minion, give your left-most minion **+2/+3**.',
      powerText: '{base} Whenever you sell a minion, give your left-most minion **+2/+3**.',
      effects: [{ do: 'saleBuffsLeftmost', attack: 2, health: 3 }],
    },
    genesis: {
      // "When you sell 7 minions, get a copy of one of them."
      offerText: 'Every **7** minions you sell, get a plain copy of one of them.',
      powerText: '{base} Every **7** minions you sell, get a plain copy of one of them (**{copyLeft}** more to go).',
      effects: [{ do: 'sellsGetCopy', every: 7 }],
    },
    time: {
      // "End of Turn: Increase your max gold by 1"
      offerText: '**End of Turn:** gain **+1 max Gold**.',
      powerText: '{base} **End of Turn:** gain **+1 max Gold**. **+{maxGold}** so far.',
      effects: [{ do: 'eotMaxGold', gold: 1 }],
    },
    bonds: {
      // "Selling a minion makes the next of its tribe cost 2g."
      offerText: 'Selling a minion makes the next minion of its type you buy cost **2 Gold**.',
      powerText: '{base} Selling a minion makes the next minion of its type you buy cost **2 Gold**.{bondsTypes}',
      effects: [{ do: 'saleDiscountsTribe', price: 2 }],
    },
  },
  // RE-PETE (owner pairings 2026-10-02, quoted above each entry). Second Hand (passive) = "At the end of every 3rd turn,
  // get a plain copy of the left-most card in your hand." Its copies are PLAIN by default (which is what Genesis changes).
  repete: {
    death: {
      // "Get a copy of the last minion that died in combat" (owner 2026-10-02: "Yours only")
      offerText: '**After combat:** get a plain copy of the last friendly minion that died in it.',
      powerText: '{base} **After combat:** get a plain copy of the last friendly minion that died in it.',
      effects: [{ do: 'combatLastDeathCopy' }],
    },
    fortune: {
      // "When you buy 6 cards, discover one of them. It's locked in your hand for 1 turn." (owner 2026-10-02: "Offer spells too")
      offerText: 'Every **6** cards you buy, Discover one of them. It is locked in your hand for **1** turn.',
      powerText: '{base} Every **6** cards you buy, Discover one of them. It is locked in your hand for **1** turn (**{rBuysLeft}** more to go).',
      effects: [{ do: 'buysDiscoverLocked', every: 6, turns: 1 }],
    },
    war: {
      // "Copied cards gain +10/+10. Improve this every time Second Hand triggers."
      offerText: 'Minions Second Hand copies gain **+10/+10**. Improve this every time Second Hand triggers.',
      powerText: '{base} Minions it copies gain **+{rWarGain}/+{rWarGain}**. This improves by **+10/+10** every time it triggers.',
      effects: [{ do: 'secondHandBuffImproves', amount: 10 }],
    },
    genesis: {
      // "Copied minions are now exact copies"
      offerText: 'Second Hand makes **exact** copies.',
      powerText: 'At the end of every 3rd turn, get an **exact** copy of the left-most card in your hand.',
      effects: [{ do: 'secondHandExact' }],
    },
    time: {
      // "second hand triggers every 2 turns instead"
      offerText: 'Second Hand triggers every **2** turns instead.',
      powerText: 'At the end of every **2nd** turn, get a plain copy of the left-most card in your hand. Next: turn **{shNext}**.',
      effects: [{ do: 'secondHandEvery', turns: 2 }],
    },
    bonds: {
      // "Second hand copies the Left and Right-most minions on board instead."
      offerText: 'Second Hand copies your **left-most and right-most minions** instead.',
      powerText: 'At the end of every 3rd turn, get a plain copy of your **left-most and right-most minions**.',
      effects: [{ do: 'secondHandEdges' }],
    },
  },
  // GORR (owner pairings 2026-10-02, quoted above each entry). Four Peat (passive) = "When you buy 3 minions in a turn,
  // get a plain copy of one of them at random."
  gorr: {
    death: {
      // "Avenge (6): Get a copy of a minion you bought last turn."
      offerText: '**Avenge (6):** get a plain copy of a minion you bought last turn.',
      powerText: '{base} **Avenge (6):** get a plain copy of a minion you bought last turn (**{gDeathLeft}** more to go).',
      effects: [{ do: 'avengeCopyLastTurnBuy', every: 6 }],
    },
    fortune: {
      // "The first minion you buy each turn is free."
      offerText: 'The first minion you buy each turn is **free**.',
      powerText: '{base} The first minion you buy each turn is **free**.{gFreeNow}',
      effects: [{ do: 'firstMinionFree' }],
    },
    war: {
      // "pummel (200): get a copy of a minion in your warband."
      offerText: '**Pummel (200):** get a plain copy of a random friendly minion. Counts damage dealt by all your minions.',
      powerText: '{base} **Pummel (200):** get a plain copy of a random friendly minion. Counts damage dealt by all your minions (**{gPummelNow}/{gPummelEvery}**).',
      effects: [{ do: 'pummelCopyWarband', every: 200 }],
    },
    genesis: {
      // "get a second copy of the first minion you buy each turn"
      offerText: 'The first minion you buy each turn also gives you a plain copy of it.',
      powerText: '{base} The first minion you buy each turn also gives you a plain copy of it.{gFirstNow}',
      effects: [{ do: 'firstBuyExtraCopy' }],
    },
    time: {
      // "End of Turn: Get a random copy of a minion you bought this turn."
      offerText: '**End of Turn:** get a plain copy of a random minion you bought this turn.',
      powerText: '{base} **End of Turn:** get a plain copy of a random minion you bought this turn (**{gBoughtNow}** bought).',
      effects: [{ do: 'eotCopyThisTurnBuy' }],
    },
    bonds: {
      // "When you buy 3 cards, give them +2/+2 and improve this."
      offerText: 'Every **3** cards you buy, give those minions **+2/+2** and improve this by **+2/+2**.',
      powerText: '{base} Every **3** cards you buy, give those minions **+{gBondsGain}/+{gBondsGain}** and improve this by **+2/+2** (**{gBondsLeft}** more to go).',
      effects: [{ do: 'buysBuffImproves', every: 3, amount: 2 }],
    },
  },
};

export function ancientPairingFor(heroId: string, id: AncientId): AncientPairing | undefined {
  return ANCIENT_PAIRINGS[heroId]?.[id];
}

/** The text an Ancient shows for a hero (the offer card / the hover preview). */
export function ancientOfferText(heroId: string, id: AncientId): string {
  return ancientPairingFor(heroId, id)?.offerText ?? ANCIENT_NOT_WRITTEN;
}

// ── The meter ────────────────────────────────────────────────────────────────────────────────────────────────
export interface AncientMeterTuning {
  /** Points the meter needs to awaken (full). */
  cost: number;
  /** Points one Shop refresh adds. */
  refresh: number;
  /** Points one combat adds. */
  combat: number;
}
export const ANCIENT_METER_DEFAULTS: AncientMeterTuning = { cost: 16, refresh: 1, combat: 2 };
/** PER-HERO overrides (owner: "per-hero balance later"). Empty today; a hero entry wins over the defaults, and a
 *  tuner override wins over both. */
export const ANCIENT_METER_BY_HERO: Record<string, Partial<AncientMeterTuning>> = {};

export function ancientMeterFor(heroId: string, override?: Partial<AncientMeterTuning>): AncientMeterTuning {
  return { ...ANCIENT_METER_DEFAULTS, ...(ANCIENT_METER_BY_HERO[heroId] ?? {}), ...(override ?? {}) };
}

/** The run's Ancient state. Present only when `ancientsEnabled`. */
export interface AncientsState {
  /** Points FILLED so far (counts up to `cost`, which awakens it). */
  points: number;
  cost: number;
  refresh: number;
  combat: number;
  /** The open offer (3 distinct Ancients) — the Shop is paused while set. */
  offer?: AncientId[];
  /** The Ancient locked in for the run. */
  picked?: AncientId;
  /** The wave it awakened (the offer opened). */
  awakenedWave?: number;
  /** Monotonic UI cues: a gain (with its size + why), the offer opening, the pick. */
  gainSeq?: number;
  lastGain?: { amount: number; why: 'refresh' | 'combat' | 'set' };
  offerSeq?: number;
  pickSeq?: number;
  /** Minions that became Gilded this run (Bonds' count): +1 per `gildMinion` call that gilds a minion (Masterwork,
   *  Golden Touch, gilded Discovers and payouts, every other gild effect) and +1 per triple. Ticks from the run's
   *  start whichever Ancient is picked, so Bonds counts gilds made before it awakened. */
  gilds?: number;
  /** WARDEN × GENESIS: friendly Ward breaks counted since the pick (carries across combats), and the cardIds of the
   *  minions whose Ward broke in the CURRENT window (cleared each time a copy is paid). */
  wardBreaks?: number;
  wardWindow?: string[];
  /** WARDEN × BONDS: board uids whose gain (or Bonds grant) the End-of-Turn pass already handled this action, so the
   *  reducer's per-action diff does not handle them again. Transient: cleared by the diff. */
  bondsHandled?: string[];
  /** The picked pairing's hero-power shape override (`AncientPairing.power`), stamped at the pick. Read by
   *  `activePowers` (heroes.ts), which cannot import this module without a cycle. */
  powerOverride?: AncientPowerOverride;
  /** AUCTIONEER × FORTUNE: Gold banked by Shop Shouts on `wave` (the live power text prints it). */
  shoutGold?: { wave: number; gold: number };
  /** RISEN × FORTUNE: Gold the last combat's Rises banked for this turn (the live power text prints it). */
  riseGold?: number;
  /** RISEN × TIME: friendly minions summoned in the last combat (paid at the next Start of Turn; printed live). */
  lastSummons?: number;
  /** ALBUS × WAR: the hero-Pummel LIFETIME tally (friendly damage dealt), carried across combats like the keyword. */
  pummelDealt?: number;
  /** HUNCH × DEATH: the total spell improvement its Avenges have granted (banked at settle; printed live). */
  spellImproved?: { attack: number; health: number };
  /** HUNCH × FORTUNE: max Gold Rounded Spellbook has granted this run (printed live). */
  bookMaxGold?: number;
  /** HUNCH × GENESIS: spells cast since the pick (every phase), the running count toward the next recharge. */
  genesisSpells?: number;
  /** HUNCH presentation cues (monotonic; the UI plays one beat per bump): Fortune's +max Gold on the Gold pill, and
   *  Genesis' recharge on the hero-power button. Never read by gameplay. */
  bookGoldFxSeq?: number;
  rechargeFxSeq?: number;
  /** FRANK × WAR: banked Clearance stacks (each = one more Clearance use). Kept across turns until used. */
  clearanceStacks?: number;
  /** FRANK × TIME: minions bought on `wave` (the first `count` each turn are capped at the Time price). */
  timeBuys?: { wave: number; n: number };
  /** FRANK × GENESIS: the type Clearance's refresh is narrowed to, set ONLY while that refresh rolls (read by
   *  `rollShopRow`). Transient: cleared the moment the roll is done. */
  rollTribe?: Tribe;
  /** XEROX × DEATH: friendly deaths since the last copy (Shop + combat), the running Avenge (5) count. */
  xeroxDeaths?: number;
  /** XEROX × FORTUNE: Gold the board's pairs banked at End of Turn on `wave`. */
  xeroxPairGold?: { wave: number; gold: number };
  /** XEROX × GENESIS: banked extra Copy Machine uses (spent once the once-per-game use is gone). */
  xeroxCharges?: number;
  /** XEROX × BONDS: the bound pair (run uids of the original and Copy Machine's copy). Cleared for good when it breaks
   *  (`xeroxBondBroken` then stays true for the power text). */
  xeroxBond?: { a: string; b: string };
  xeroxBondBroken?: boolean;
  /** TRADESMAN × DEATH: friendly deaths since the last free Refresh (Shop + combat), the running Avenge (3) count. */
  tradesDeaths?: number;
  /** TRADESMAN × GENESIS: Refreshes since the pick (free ones included), the running count toward the next Lasso. */
  tradesRefreshes?: number;
  /** TRADESMAN × WAR: Gold the Rally graft banked for next turn on `wave` (Shop rallies + that wave's fight, at settle). */
  tradesRallyGold?: { wave: number; gold: number };
  /** TRADESMAN × TIME / BONDS: the share of Frugal's upgrade surcharge the discounts have eaten at `tier` (owner ruling
   *  2026-10-02: "Yes, down to 0"). Banked once the running cost is already at its floor; ignored at any other tier, so
   *  every tier-up path clears it by construction. */
  tradesSurchargeOff?: { tier: number; gold: number };
  /** SOREN × WAR: the live +X/+X a Reclaimed copy gains on its return (set at the pick, improved each Start of Turn). */
  sorenWarGain?: number;
  /** ROBIN × DEATH: Spoils counts (sales) on `wave`. Ticked by every Spoils sale while Ancients are on (whatever is
   *  picked), so sales made before the pick count this turn. A new wave reads 0. */
  robinSpoils?: { wave: number; n: number };
  /** ROBIN × FORTUNE: sales since the last free Refresh (the running count, since the pick). */
  robinSales?: number;
  /** ROBIN × GENESIS: the cardIds sold since the last copy (the window the copy is drawn from). */
  robinWindow?: string[];
  /** ROBIN × TIME: max Gold the End-of-Turn grant has given this run (printed live). */
  robinMaxGold?: number;
  /** ROBIN × BONDS: the marked types, in the order they were marked (one each; `'all'` = an All-types sale, which
   *  matches any typed minion). A buy of a matching minion spends the first match. Kept until used, across turns. */
  robinBonds?: (Tribe | 'all')[];
  /** TRADESMAN × FORTUNE: a minion was bought, so the next Refresh costs 0 (owner 2026-10-02). One pending flag, never a
   *  count: more buys while it is set add nothing. Carries across turns until a Refresh spends it. */
  tradesNextRefreshFree?: boolean;
  /** RE-PETE × FORTUNE: the cardIds bought since the last Discover (every card, spells included; the running count). */
  repeteBuys?: string[];
  /** RE-PETE × WAR: the live +X/+X Second Hand's minion copies gain (set at the pick, improved after each trigger). */
  repeteWarGain?: number;
  /** GORR: the BODIED minions bought per turn (cardIds), the current and the previous turn only. Death reads `wave - 1`,
   *  Time reads `wave`. Ticked while Ancients are on, whatever is picked. */
  gorrBuys?: { wave: number; ids: string[] }[];
  /** GORR × FORTUNE / GENESIS: minions bought on `wave` (the Starform included): 0 = the next one is "the first". */
  gorrMinionBuys?: { wave: number; n: number };
  /** GORR × DEATH: friendly deaths since the last copy (Shop + combat), the running Avenge (6) count. */
  gorrDeaths?: number;
  /** GORR × BONDS: the cards bought since the last payout, one entry per buy: the bought body's uid, or null (a spell,
   *  the Starform). */
  gorrBondsWindow?: (string | null)[];
  /** GORR × BONDS: the live +X/+X the next payout gives (set at the pick, improved after each payout). */
  gorrBondsGain?: number;
}

/** Turn Ancients on for a run (the Scene Builder's Set 3 flag). Pure: returns a new run. */
export function enableAncients(run: RunState, override?: Partial<AncientMeterTuning>): RunState {
  const t = ancientMeterFor(run.heroId, override);
  return { ...run, ancientsEnabled: true, ancients: { points: 0, cost: t.cost, refresh: t.refresh, combat: t.combat } };
}

/** The Ancient state when this run plays with Ancients, else undefined (the single gate every hook reads). */
function live(state: RunState): AncientsState | undefined {
  return state.ancientsEnabled ? state.ancients : undefined;
}

/** Salt for the offer's own seeded stream (distinct from the TAG table in state.ts). */
const ANCIENT_SALT = 0x41;

/** Open the awakening offer: 3 distinct Ancients, seeded off the run seed + wave (never the run cursor). */
function awaken(state: RunState, a: AncientsState): void {
  if (a.picked || a.offer) return;
  const rng = makeRng(mixSeed(state.seed, ANCIENT_SALT, state.wave));
  const pool = [...ANCIENT_IDS];
  const offer: AncientId[] = [];
  while (offer.length < 3 && pool.length > 0) offer.push(pool.splice(rng.int(pool.length), 1)[0]!);
  a.offer = offer;
  a.awakenedWave = state.wave;
  a.offerSeq = (a.offerSeq ?? 0) + 1;
}

/** Add `amount` points (capped at full); awakens EXACTLY once, the moment it first fills. */
function fill(state: RunState, amount: number, why: 'refresh' | 'combat'): void {
  const a = live(state);
  if (!a || a.picked || a.offer || a.points >= a.cost || amount <= 0) return;
  const before = a.points;
  a.points = Math.min(a.cost, a.points + amount);
  a.lastGain = { amount: a.points - before, why };
  a.gainSeq = (a.gainSeq ?? 0) + 1;
  if (a.points >= a.cost) awaken(state, a);
}

/** A Shop refresh happened (any refresh, paid or free): the meter fills by `refresh`. */
export function ancientsRefreshTick(state: RunState): void {
  const a = live(state);
  if (a) fill(state, a.refresh, 'refresh');
}

/** A combat was fought (called as the next Shop opens): the meter fills by `combat`. */
export function ancientsCombatTick(state: RunState): void {
  const a = live(state);
  if (a) fill(state, a.combat, 'combat');
}

/** DEV (Scene Builder "Fill meter" / set-meter): set the points filled. Full awakens it. */
export function ancientsSetMeter(state: RunState, points: number): void {
  const a = live(state);
  if (!a || a.picked || a.offer) return;
  a.points = Math.max(0, Math.min(a.cost, Math.floor(points)));
  a.lastGain = { amount: 0, why: 'set' };
  a.gainSeq = (a.gainSeq ?? 0) + 1;
  if (a.points >= a.cost) awaken(state, a);
}

/** Lock an offered Ancient in. Returns false (a refused action) when `id` was not offered. */
export function pickAncient(state: RunState, id: AncientId): boolean {
  const a = live(state);
  if (!a?.offer?.includes(id)) return false;
  a.picked = id;
  a.offer = undefined;
  a.pickSeq = (a.pickSeq ?? 0) + 1;
  const shape = activeAncientPairing(state)?.power;
  if (shape) a.powerOverride = { ...shape };
  const extra = effectOf(state, 'copyMachineExtraCharge');
  if (extra) a.xeroxCharges = (a.xeroxCharges ?? 0) + extra.charges; // XEROX × GENESIS: banked at the pick
  const war = effectOf(state, 'reclaimGainImproves');
  if (war) a.sorenWarGain = war.amount; // SOREN × WAR: starts at the printed amount
  const rWar = effectOf(state, 'secondHandBuffImproves');
  if (rWar) a.repeteWarGain = rWar.amount; // RE-PETE × WAR: starts at the printed amount
  const gBonds = effectOf(state, 'buysBuffImproves');
  if (gBonds) a.gorrBondsGain = gBonds.amount; // GORR × BONDS: starts at the printed amount
  return true;
}

/** The Shop is paused behind the awakening offer. */
export function ancientOfferOpen(state: RunState): boolean {
  return !!live(state)?.offer?.length;
}

/** The picked Ancient's pairing for the current hero (undefined = none picked, or "Not written yet"). */
export function activeAncientPairing(state: RunState): AncientPairing | undefined {
  const a = live(state);
  return a?.picked ? ancientPairingFor(state.heroId, a.picked) : undefined;
}

function effectOf<K extends AncientEffect['do']>(state: RunState, kind: K): Extract<AncientEffect, { do: K }> | undefined {
  return activeAncientPairing(state)?.effects.find((e): e is Extract<AncientEffect, { do: K }> => e.do === kind);
}

/** Live combat values the Ancient power text folds in (undefined outside a fight being replayed). */
export interface AncientPowerLive {
  /** ALBUS × WAR: friendly damage LANDED so far in the fight on screen (the replay's `dmg` events whose dealer is a
   *  player body, Heavy Hand folded), added to the carried-in tally so the Pummel readout ticks with each hit. */
  friendlyDamage?: number;
  /** Friendly minions summoned SO FAR in the fight on screen (the replay's step-tagged `summonCombat` tally, the same
   *  summon-entry chokepoint `ancientCountSummons` counts), so Time's printed count follows the replay beat. */
  combatSummons?: number;
  /** FRANK × WAR: Clearance stacks gained SO FAR in the fight on screen (the replay's `questTrigger` events for
   *  `ANCIENT_CLEARANCE_STACK_FLAG`), added to the banked count so the readout ticks with each Avenge. */
  clearanceStacks?: number;
  /** XEROX × DEATH: friendly deaths SO FAR in the fight on screen (the replay's tally), added to the carried-in running
   *  count so the Avenge (5) readout ticks with each death. */
  friendlyDeaths?: number;
  /** TRADESMAN × DEATH: free Refreshes the fight on screen has gained SO FAR (the replay's `questTrigger` events for
   *  `ANCIENT_REFRESH_AVENGE_FLAG`), added to the banked count so the readout ticks with each Avenge. */
  freeRefreshes?: number;
  /** TRADESMAN × WAR: the Rally graft's fires SO FAR in the fight on screen (the replay's `questTrigger` events for
   *  `ANCIENT_RALLY_GOLD_FLAG`, one per fire); the text multiplies by the pairing's Gold. */
  rallyFires?: number;
}

/** The resolved hero-power text, or undefined when no pairing is active (the caller keeps its base text). */
export function ancientPowerText(state: RunState, base: string, combat: AncientPowerLive = {}): string | undefined {
  const p = activeAncientPairing(state);
  if (!p) return undefined;
  const per = effectOf(state, 'powerBuffPerGild');
  const a = live(state);
  const gilds = a?.gilds ?? 0;
  let text = p.powerText;
  const g = aegisGrantOf(state);
  const aegis = g.health > 0 ? `+${g.attack}/+${g.health}` : `+${g.attack} Attack`;
  const copy = effectOf(state, 'wardBreaksGetCopy');
  const wardLeft = copy ? copy.every - ((a?.wardWindow?.length ?? 0) % copy.every) : 0;
  const shoutGold = a?.shoutGold?.wave === state.wave ? a.shoutGold.gold : 0;
  const time = effectOf(state, 'sotBuffPerCombatSummon');
  // RISEN × TIME, REAL TIME (R-REALTIME-01 / R-ANCRISEN-07): during a fight the count is the replay's running tally of
  // friendly summons up to the beat on screen, so it ticks with each summon instead of jumping at resolution.
  const liveSummons = !!time && combat.combatSummons !== undefined;
  const summons = liveSummons ? combat.combatSummons! : a?.lastSummons ?? 0;
  const pummel = effectOf(state, 'pummelGrantsCards');
  const pummelNow = pummel ? ((a?.pummelDealt ?? 0) + (combat.friendlyDamage ?? 0)) % Math.max(1, pummel.every) : 0;
  const hunch = hunchLive(state);
  const stacks = (a?.clearanceStacks ?? 0) + (combat.clearanceStacks ?? 0);
  const deathFree = effectOf(state, 'clearanceDestroyFirstFree') && state.shop.some((o) => o.clearanceFree) ? ' Free buy ready.' : '';
  const top = effectOf(state, 'clearanceTopTribe') ? dominantBoardTribe(state) : null;
  const genesisTribe = top ? ` (**${top.charAt(0).toUpperCase()}${top.slice(1)}**)` : '';
  // XEROX: Death's countdown (live through a fight), Fortune's pairs + Gold, Genesis' uses, Bonds' bond.
  const xDeathLeft = ancientXeroxAvengeLeft(state, combat.friendlyDeaths ?? 0) ?? 0;
  const pairs = boardPairs(state);
  const pairGold = (effectOf(state, 'pairsGoldNextTurn')?.gold ?? 0) * pairs;
  text = text.replace('{xDeathLeft}', String(xDeathLeft)).replace('{pairs}', String(pairs)).replace('{pairGold}', String(pairGold))
    .replace('{charges}', String(ancientCopyUsesLeft(state))).replace('{bond}', xeroxBondText(state));
  // TRADESMAN: Death's countdown (live through a fight) + the banked free Refreshes (plus the fight's so far),
  // Genesis' Refreshes to the next Lasso, War's Gold banked for next turn, Time / Bonds' live upgrade price.
  text = text.replace('{tDeathLeft}', String(ancientTradesAvengeLeft(state, combat.friendlyDeaths ?? 0) ?? 0))
    .replace('{freeRolls}', String(Math.max(0, state.freeRolls ?? 0) + (combat.freeRefreshes ?? 0)))
    .replace('{lassoLeft}', String(tradesLassoLeft(state))).replace('{rallyGold}', String(tradesRallyGoldNow(state) + (effectOf(state, 'minionsRallyGold')?.gold ?? 0) * (combat.rallyFires ?? 0)))
    .replace('{upgradeNow}', tradesUpgradeText(state)).replace('{tNextFree}', ancientTradesRefreshFree(state) ? 'Yes' : 'No');
  // SOREN × WAR: the live +X/+X (it improves every Start of Turn). Printed twice, so every occurrence.
  text = text.split('{reclaimGain}').join(String(ancientReclaimGain(state)));
  // ROBIN: Death's live per-summon gain, Fortune / Genesis countdowns, Time's total, Bonds' marked types.
  const spoils = robinSpoilsThisTurn(state);
  const sg = effectOf(state, 'summonGainPerSpoils');
  const fr = effectOf(state, 'sellsGrantFreeRefresh');
  const gc = effectOf(state, 'sellsGetCopy');
  text = text.replace('{spoils}', String(spoils)).replace('{spoilA}', String((sg?.attack ?? 0) * spoils)).replace('{spoilH}', String((sg?.health ?? 0) * spoils))
    .replace('{refreshLeft}', String(fr ? Math.max(1, fr.every) - ((a?.robinSales ?? 0) % Math.max(1, fr.every)) : 0))
    .replace('{copyLeft}', String(gc ? Math.max(1, gc.every) - ((a?.robinWindow?.length ?? 0) % Math.max(1, gc.every)) : 0))
    .replace('{maxGold}', String(a?.robinMaxGold ?? 0)).replace('{bondsTypes}', robinBondsText(state));
  // RE-PETE: Fortune's countdown, War's live +X/+X (printed twice), Time's next trigger turn.
  const rd = effectOf(state, 'buysDiscoverLocked');
  text = text.replace('{rBuysLeft}', String(rd ? Math.max(1, rd.every) - ((a?.repeteBuys?.length ?? 0) % Math.max(1, rd.every)) : 0))
    .split('{rWarGain}').join(String(ancientSecondHandGain(state))).replace('{shNext}', String(ancientSecondHandNextTurn(state)));
  // GORR: Death's countdown (live through a fight), Fortune / Genesis "this turn" state, War's Pummel progress (live
  // through a fight), Time's buys this turn, Bonds' live +X/+X (printed twice) and countdown.
  const gp = effectOf(state, 'pummelCopyWarband');
  const gpEvery = Math.max(1, gp?.every ?? 1);
  const gb = effectOf(state, 'buysBuffImproves');
  const firstOpen = gorrMinionBuysThisTurn(state) === 0;
  text = text.replace('{gDeathLeft}', String(ancientGorrAvengeLeft(state, combat.friendlyDeaths ?? 0) ?? 0))
    .replace('{gFreeNow}', firstOpen && !state.freeBuyUsedThisTurn ? ' Ready this turn.' : ' Used this turn.')
    .replace('{gFirstNow}', firstOpen ? ' Ready this turn.' : ' Used this turn.')
    .replace('{gPummelNow}', String(gp ? ((a?.pummelDealt ?? 0) + (combat.friendlyDamage ?? 0)) % gpEvery : 0)).replace('{gPummelEvery}', String(gp?.every ?? 0))
    .replace('{gBoughtNow}', String(gorrBuysOn(state, state.wave).length))
    .split('{gBondsGain}').join(String(gb ? a?.gorrBondsGain ?? gb.amount : 0))
    .replace('{gBondsLeft}', String(gb ? Math.max(1, gb.every) - ((a?.gorrBondsWindow?.length ?? 0) % Math.max(1, gb.every)) : 0));
  return text.replace('{base}', base).replace('{avengeNow}', String(hunch.avengeNow)).replace('{deathA}', String(hunch.deathA)).replace('{deathH}', String(hunch.deathH))
    .replace('{bookGold}', String(a?.bookMaxGold ?? 0)).replace('{genesisLeft}', String(hunch.genesisLeft)).replace('{timeTier}', String(albusTimeTier(state)))
    .replace('{stacks}', String(stacks)).replace('{deathFree}', deathFree).replace('{genesisTribe}', genesisTribe).replace('{timeLeft}', String(ancientTimeBuysLeft(state)))
    .replace('{pummelNow}', String(pummelNow)).replace('{pummelEvery}', String(pummel?.every ?? 0)).replace('{timeWhen}', liveSummons ? 'This combat' : 'Last combat').replace('{shoutGold}', String(shoutGold))
    .replace('{riseGold}', String(a?.riseGold ?? 0)).replace('{summons}', String(summons))
    .replace('{timeA}', String((time?.attack ?? 0) * summons)).replace('{timeH}', String((time?.health ?? 0) * summons)).replace('{aegis}', aegis).replace('{wardLeft}', String(wardLeft)).replace('{recharge}', String(INDY_GILD_RECHARGE_GOLD))
    .replace('{gilds}', String(gilds)).replace('{gildA}', String((per?.attack ?? 0) * gilds)).replace('{gildH}', String((per?.health ?? 0) * gilds));
}

/**
 * HUNCH's live readouts (R-REALTIME-01): during a fight being replayed they fold the replay's display-only previews
 * (`fxFriendlyDeathPreview`, `fxSpellsCastPreview`, the same folds Cindara and Yirin print from), so the numbers tick
 * with each death / cast and land exactly where settle banks them.
 *  - DEATH: `avengeNow` = friendly deaths this fight toward the next Avenge (0 outside a fight); `deathA` / `deathH` =
 *    the improvement banked so far plus what this fight's Avenges have already granted (Rune of Fury's extra fire
 *    and Rune of Mastery's improve reps, the simulator's own rule).
 *  - GENESIS: `genesisLeft` = spells still to cast before the next recharge.
 */
function hunchLive(state: RunState): { avengeNow: number; deathA: number; deathH: number; genesisLeft: number } {
  const a = live(state);
  const death = effectOf(state, 'avengeImproveSpells');
  const deaths = state.fxFriendlyDeathPreview ?? 0;
  let avengeNow = 0, deathA = a?.spellImproved?.attack ?? 0, deathH = a?.spellImproved?.health ?? 0;
  if (death) {
    const every = Math.max(1, death.every);
    avengeNow = deaths % every;
    const fury = state.questFlags?.runeFury ? Math.max(1, state.flagCopies?.runeFury ?? 1) : 0;
    const steps = Math.floor(deaths / every) * (1 + fury) * improveReps(state);
    deathA += steps * death.attack;
    deathH += steps * death.health;
  }
  const gen = effectOf(state, 'spellsRechargeSpellbook');
  const genesisLeft = gen ? gen.every - (((a?.genesisSpells ?? 0) + (state.fxSpellsCastPreview ?? 0)) % Math.max(1, gen.every)) : 0;
  return { avengeNow, deathA, deathH, genesisLeft };
}

/**
 * HUNCH × DEATH: friendly deaths still needed for the next Avenge (4) in the fight on screen (the replay's
 * `fxFriendlyDeathPreview`, live; the full 4 outside a fight, since the Avenge count is per combat). Null when Death is
 * not the picked pairing. The hero power prints it in its centre (owner 2026-09-30).
 */
export function ancientSpellbookAvengeLeft(state: RunState, deaths = state.fxFriendlyDeathPreview ?? 0): number | null {
  const e = live(state) ? effectOf(state, 'avengeImproveSpells') : undefined;
  if (!e) return null;
  const every = Math.max(1, e.every);
  return every - (Math.max(0, deaths) % every);
}

/**
 * THE ONE AVENGE COUNTDOWN the hero power prints in its centre, on the shared disc (`.hpb-avenge`), for whichever hero
 * Ancient runs a hero-level Avenge: Frantic Frank × War (Avenge (3), a Clearance stack) or Hunch × Death (Avenge (4),
 * +1/+1 spells). `deaths` = friendly deaths so far in the fight on screen (0 outside one: the count is per combat).
 * Null = no hero Avenge is live.
 */
export function ancientAvengeCountdown(state: RunState, deaths = 0): number | null {
  return ancientClearanceAvengeLeft(state, deaths) ?? ancientSpellbookAvengeLeft(state, deaths) ?? ancientXeroxAvengeLeft(state, deaths)
    ?? ancientTradesAvengeLeft(state, deaths) ?? ancientGorrAvengeLeft(state, deaths);
}

// ── Hooks ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The `gild` hero power resolving on `card`. Returns true when the Ancient REPLACED the gild (Genesis), so the
 * caller skips its own gild; false = gild as normal (and `ancientAfterPowerGild` runs after).
 */
export function ancientReplacesPowerGild(state: RunState, card: BoardCard): boolean {
  const e = effectOf(state, 'powerGivesCopiesInstead');
  if (!e) return false;
  const def = CARD_INDEX[card.cardId];
  if (!def) return true;
  // Plain copies (printed card, never gilded) — the same grant the Rune of Last Rites uses: hand first, the
  // board when the hand is full. The reducer's `checkTriples` after the power completes a triple with the original.
  for (let i = 0; i < e.count; i++) grantMinionToHandOrBoard(state, def, false);
  return true;
}

/** The `gild` hero power may take an already-Gilded target (Bonds). */
export function ancientPowerTargetsGilded(state: RunState): boolean {
  return !!effectOf(state, 'powerTargetsGilded');
}

/** After the `gild` hero power resolved on `card` (Death: it also gains Rebirth + Taunt, permanently; Bonds: it gains
 *  +a/+h for every minion Gilded this run, the gild just made included). */
export function ancientAfterPowerGild(state: RunState, card: BoardCard): void {
  const e = effectOf(state, 'powerTargetGainsKeywords');
  if (e) for (const k of e.keywords) if (!card.keywords.includes(k)) card.keywords.push(k);
  const per = effectOf(state, 'powerBuffPerGild');
  const gilds = live(state)?.gilds ?? 0;
  if (per && gilds > 0) {
    captureBuffFx(state, undefined, 'spell', () => addBuff(card, ANCIENTS.bonds.name, per.attack * gilds, per.health * gilds));
  }
}

/** A minion was sold (Indy's Fortune: a gilded one gets a plain copy to hand; Frank's Bonds: a Clearance minion's
 *  stats go to a random friendly minion). */
export function ancientOnSale(state: RunState, sold: BoardCard): void {
  ancientClearanceSale(state, sold);
  xeroxBreakIfEnd(state, sold.uid); // XEROX × BONDS: selling either end breaks the bond
  const e = effectOf(state, 'sellGildedGetsPlainCopy');
  if (!e || !sold.golden) return;
  const def = CARD_INDEX[sold.cardId];
  if (!def || def.spell) return;
  for (let i = 0; i < e.count; i++) grantMinionToHandOrBoard(state, def, false);
}

/** A friendly minion died in the Shop (War: every OTHER gilded board minion gains, permanently). */
export function ancientOnShopDeath(state: RunState, died: BoardCard): void {
  const e = effectOf(state, 'friendlyDeathBuffsGilded');
  if (!e) return;
  const gilded = state.board.filter((c) => c.golden && c.uid !== died.uid);
  if (gilded.length === 0) return;
  captureBuffFx(state, undefined, 'spell', () => {
    for (const c of gilded) addBuff(c, ANCIENTS.war.name, e.attack, e.health);
  });
}

/** The combat modifiers the picked Ancient threads into the player's fight (War / Time). Player-only: never part
 *  of a snapshot (opponents' Ancients are out of the MVP). */
export function ancientCombatMods(state: RunState): Partial<QuestCombatMods> {
  const out: Partial<QuestCombatMods> = {};
  const war = effectOf(state, 'friendlyDeathBuffsGilded');
  if (war) out.ancientWar = { attack: war.attack, health: war.health, label: ANCIENTS.war.name };
  if (effectOf(state, 'socGildRightmost')) out.ancientTimeGild = { label: ANCIENTS.time.name };
  const bonds = effectOf(state, 'wardedGainBuffsWarded');
  if (bonds) out.ancientBonds = { attack: bonds.attack, label: ANCIENTS.bonds.name };
  if (effectOf(state, 'wardBreakGold') || effectOf(state, 'wardBreaksGetCopy')) out.ancientTrackWardBreaks = true;
  const copy = effectOf(state, 'wardBreaksGetCopy');
  if (copy) out.ancientWardCopy = { every: copy.every, window: [...(live(state)?.wardWindow ?? [])] };
  if (effectOf(state, 'socTriggerEdgeShouts')) out.ancientEdgeShouts = { label: ANCIENTS.time.name };
  const adj = effectOf(state, 'shoutBuffsAdjacent');
  if (adj) out.ancientShoutAdjacent = { attack: adj.attack, health: adj.health, label: ANCIENTS.bonds.name };
  // LORD OF THE RISEN: the Undying body is the board card Undying marked (`tempReborn`) this turn.
  const regain = effectOf(state, 'undyingRegainsRise');
  const riseWar = effectOf(state, 'undyingReturnsDoubleAndAttacks');
  if (regain || riseWar) {
    const uids = state.board.filter((c) => c.tempReborn && c.keywords.includes('R')).map((c) => c.uid);
    if (uids.length > 0) {
      out.ancientUndying = { uids, label: (riseWar ? ANCIENTS.war : ANCIENTS.death).name, ...(regain ? { regainRise: true } : {}), ...(riseWar ? { war: true } : {}) };
    }
  }
  if (effectOf(state, 'riseGold')) out.ancientCountRises = true;
  const extra = effectOf(state, 'summonsSummonExtra');
  if (extra) out.ancientSummonExtra = extra.extra;
  if (effectOf(state, 'sotBuffPerCombatSummon')) out.ancientCountSummons = true;
  if (effectOf(state, 'riseTriggersAdjacentEcho')) out.ancientRiseEcho = { label: ANCIENTS.bonds.name };
  const pummel = effectOf(state, 'pummelGrantsCards');
  if (pummel) {
    out.ancientPummel = { every: pummel.every, count: pummel.count, cardId: pummel.cardId, dealt: live(state)?.pummelDealt ?? 0, label: ANCIENTS.war.name };
  }
  const avenge = effectOf(state, 'avengeImproveSpells');
  if (avenge) out.ancientAvengeSpells = { every: avenge.every, attack: avenge.attack, health: avenge.health, label: ANCIENTS.death.name };
  const castExtra = effectOf(state, 'shopSpellsCastExtraInCombat');
  if (castExtra) out.ancientSpellCastExtra = castExtra.extra;
  const edges = effectOf(state, 'spellCastBuffsEdges');
  // Labelled with the POWER's name: a label-sourced combat grant named in `HERO_POWER_BUFF_LABELS` (ui bindings) plays
  // the generic tendril from the hero-power button, the way Emissary's United Front does.
  if (edges) out.ancientSpellEdges = { attack: edges.attack, health: edges.health, label: HUNCH_BONDS_COMBAT_LABEL };
  const stack = effectOf(state, 'avengeClearanceStack');
  if (stack) out.ancientClearanceStacks = { every: stack.every, flag: ANCIENT_CLEARANCE_STACK_FLAG, label: ANCIENTS.war.name };
  // XEROX: Death's running Avenge carried in; War's Start-of-Combat copy; the Bonds pair (matched on `sourceUid`).
  const xd = effectOf(state, 'avengeCopyTopAttack');
  if (xd) out.ancientXeroxAvenge = { every: xd.every, tick: live(state)?.xeroxDeaths ?? 0, label: ANCIENTS.death.name };
  if (effectOf(state, 'socCopyTopHealth')) out.ancientXeroxSoc = { label: ANCIENTS.war.name };
  const bond = ancientXeroxBondOf(state);
  if (bond) out.ancientXeroxBond = { a: bond.a, b: bond.b, label: ANCIENTS.bonds.name };
  // TRADESMAN: Death's running Avenge carried in (each fire a free Refresh, through the free-roll carry-back); War's
  // Rally graft for bodies SUMMONED mid-fight (the board's bodies already carry it from the Shop sweep).
  const td = effectOf(state, 'avengeFreeRefresh');
  if (td) out.ancientRefreshAvenge = { every: td.every, tick: live(state)?.tradesDeaths ?? 0, flag: ANCIENT_REFRESH_AVENGE_FLAG, label: ANCIENTS.death.name };
  const rally = ancientRallyGoldGraft(state);
  if (rally) out.ancientRallyGold = rally;
  // SOREN: Reclaim's Start-of-Combat destroy + return, reshaped (Death / War / Time / Bonds). One field, one label.
  const rEcho = effectOf(state, 'reclaimEchoExtra');
  const rTime = effectOf(state, 'reclaimSummonsTwice');
  const rWar = effectOf(state, 'reclaimGainImproves');
  const rBonds = effectOf(state, 'reclaimBondsAdjacent');
  if (rEcho || rTime || rWar || rBonds) {
    const id: AncientId = rEcho ? 'death' : rTime ? 'time' : rWar ? 'war' : 'bonds';
    out.ancientReclaim = {
      label: ANCIENTS[id].name,
      ...(rEcho ? { echoExtra: rEcho.extra } : {}),
      ...(rTime ? { copies: rTime.copies } : {}),
      ...(rWar ? { gain: ancientReclaimGain(state) } : {}),
      ...(rBonds ? { bonds: true } : {}),
    };
  }
  // ROBIN × DEATH: this turn's Spoils count, frozen for the fight (nothing is sold mid-combat).
  const sg = effectOf(state, 'summonGainPerSpoils');
  const spoils = robinSpoilsThisTurn(state);
  if (sg && spoils > 0) out.ancientSummonGain = { attack: sg.attack * spoils, health: sg.health * spoils, label: ANCIENTS.death.name };
  // RE-PETE × DEATH: the fight's last friendly death comes home as a plain copy (paid as the fight ends).
  if (effectOf(state, 'combatLastDeathCopy')) out.ancientLastDeathCopy = { label: ANCIENTS.death.name };
  // GORR: Death's running Avenge (carried in) with last turn's buys; War's repeating hero Pummel on the lifetime tally.
  const gd = effectOf(state, 'avengeCopyLastTurnBuy');
  if (gd) out.ancientGorrAvenge = { every: gd.every, tick: live(state)?.gorrDeaths ?? 0, ids: [...gorrBuysOn(state, state.wave - 1)], label: ANCIENTS.death.name };
  const gw = effectOf(state, 'pummelCopyWarband');
  if (gw) out.ancientPummelCopy = { every: gw.every, dealt: live(state)?.pummelDealt ?? 0, label: ANCIENTS.war.name };
  return out;
}

// ── Warden (Aegis) hooks ─────────────────────────────────────────────────────────────────────────────────────
/** DEATH: the Aegis destroys its target and gives the Attack + Ward to a random other friendly minion. */
export function ancientAegisDestroys(state: RunState): boolean {
  return !!effectOf(state, 'aegisDestroyGivesAttackAndWard');
}

/** DEATH: the recipient, picked BEFORE the destroy (so a Rebirth / Rise return or an Echo summon is never it): a
 *  random other friendly board minion WITHOUT Ward, or a random Warded one when every other minion has Ward. */
export function ancientAegisRecipient(state: RunState, victim: BoardCard): BoardCard | undefined {
  const others = state.board.filter((c) => c !== victim);
  if (others.length === 0) return undefined;
  const bare = others.filter((c) => !c.keywords.includes('DS'));
  const pool = bare.length > 0 ? bare : others;
  const rng = makeRng(state.rngCursor);
  const pick = pool[rng.int(pool.length)]!;
  state.rngCursor = rng.state();
  return pick;
}

/** DEATH: destroy `victim` (a real shop death: its Echo, the death watchers, a Rebirth / Rise return) and give
 *  `recipient` the Attack it had (permanent) and Ward. A Resilient Ward on the victim travels as a Resilient Ward. */
export function ancientAegisDestroyAndGive(state: RunState, victim: BoardCard, recipient: BoardCard): void {
  const attack = victim.attack;
  const resilient = victim.keywords.includes('RW');
  destroyMinionInShop(makeContext(state), victim);
  if (!state.board.includes(recipient)) return;
  captureBuffFx(state, undefined, 'spell', () => {
    if (attack > 0) addBuff(recipient, ANCIENTS.death.name, attack, 0);
    if (!recipient.keywords.includes('DS')) recipient.keywords.push('DS');
    if (resilient && !recipient.keywords.includes('RW')) recipient.keywords.push('RW');
  });
}

/** WAR: an Aegis on a minion that ALREADY has Ward upgrades it to Resilient Ward (every Aegis; owner 2026-09-26).
 *  `hadWard` = the target's Ward BEFORE this Aegis. */
export function ancientAegisResilient(state: RunState, hadWard: boolean): boolean {
  return hadWard && !!live(state) && !!effectOf(state, 'aegisUpgradesWardToResilient');
}

/** TIME: the End-of-Turn grant to every minion with Ward, when the pairing is live. */
export function ancientEotWardBuff(state: RunState): { attack: number; health: number } | undefined {
  const e = effectOf(state, 'eotBuffWarded');
  return e ? { attack: e.attack, health: e.health } : undefined;
}

/** TIME: run the End-of-Turn grant (the `ancientTimeWard` recurring entry). `apply` wraps it (the recurring
 *  runner's `step`, which captures the buff FX in the projection). */
export function ancientRunEotWardBuff(state: RunState, apply: (run: () => void) => void): void {
  const g = ancientEotWardBuff(state);
  if (!g) return;
  const warded = state.board.filter((c) => c.keywords.includes('DS'));
  if (warded.length === 0) return;
  apply(() => { for (const c of warded) addBuff(c, ANCIENTS.time.name, g.attack, g.health); });
}

/**
 * BONDS, Shop half: every BOARD minion with Ward whose stats rose since `before` gives a random OTHER board minion
 * with Ward +attack Attack. Gainers are resolved before any grant, and the grants are never re-diffed, so a Bonds
 * grant cannot trigger Bonds (the owner's "this doesnt re-trigger itself"). With `mark` (the End-of-Turn pass) every
 * uid it handled (gainers and recipients) is recorded, so the reducer's per-action diff skips them.
 */
export function ancientBondsReact(state: RunState, before: Map<string, { attack: number; health: number }>, mark = false): void {
  const a = live(state);
  const e = effectOf(state, 'wardedGainBuffsWarded');
  if (!a || !e) return;
  const handled = new Set(a.bondsHandled ?? []);
  if (!mark) a.bondsHandled = undefined; // the per-action diff is the last reader
  const warded = (c: BoardCard): boolean => c.keywords.includes('DS');
  const gainers = state.board.filter((c) => {
    if (!warded(c) || handled.has(c.uid)) return false;
    const p = before.get(c.uid);
    return !!p && (c.attack > p.attack || c.health > p.health);
  });
  if (gainers.length === 0) return;
  const touched: string[] = [];
  for (const g of gainers) {
    const others = state.board.filter((c) => c !== g && warded(c));
    if (others.length === 0) continue;
    const rng = makeRng(state.rngCursor);
    const pick = others[rng.int(others.length)]!;
    state.rngCursor = rng.state();
    captureBuffFx(state, g, 'minion', () => addBuff(pick, ANCIENTS.bonds.name, e.attack, 0));
    touched.push(g.uid, pick.uid);
  }
  if (mark) a.bondsHandled = [...handled, ...touched];
}

/** FORTUNE / GENESIS: the fight is settled. Fortune banks Gold for next turn per friendly Ward break (its text says
 *  "next turn"). Genesis already paid its copies DURING the fight (real-time, see `ancientWardCopy`); here it only
 *  keeps the running count and the window the fight handed back. */
export function ancientAfterCombat(state: RunState, result: CombatResult): void {
  const a = live(state);
  if (!a) return;
  const breaks = result.playerWardBreaks ?? [];
  const gold = effectOf(state, 'wardBreakGold');
  if (gold && breaks.length > 0) state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + gold.gold * breaks.length;
  // RISEN × FORTUNE: +gold next turn per friendly Rise (counted the moment each happened, in the fight).
  const riseGold = effectOf(state, 'riseGold');
  if (riseGold) {
    a.riseGold = riseGold.gold * (result.playerRises ?? 0);
    if (a.riseGold > 0) state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + a.riseGold;
  }
  // RISEN × TIME: the count the next Start of Turn pays on.
  if (effectOf(state, 'sotBuffPerCombatSummon')) a.lastSummons = result.playerSummonsMade ?? 0;
  // ALBUS × WAR: the lifetime Pummel tally the fight hands back (the payout already happened mid-fight).
  if ((effectOf(state, 'pummelGrantsCards') || effectOf(state, 'pummelCopyWarband')) && result.playerAncientPummelDealt !== undefined) a.pummelDealt = result.playerAncientPummelDealt;
  // GORR × DEATH: the fight's friendly deaths join the running Avenge count (its copies already flew to hand mid-fight).
  const gd = effectOf(state, 'avengeCopyLastTurnBuy');
  if (gd) a.gorrDeaths = ((a.gorrDeaths ?? 0) + (result.playerDeaths ?? 0)) % Math.max(1, gd.every);
  // HUNCH x DEATH: bank the improvement this fight's Avenges granted (the spell power itself settles through
  // `playerSpellPower`, like every combat spell-power gain).
  const imp = result.playerAncientSpellImproved;
  if (effectOf(state, 'avengeImproveSpells') && imp && (imp.attack > 0 || imp.health > 0)) {
    a.spellImproved = { attack: (a.spellImproved?.attack ?? 0) + imp.attack, health: (a.spellImproved?.health ?? 0) + imp.health };
  }
  // HUNCH x GENESIS: combat casts count toward the running total. A recharge earned in combat lands on the NEXT Shop
  // (at settle the run is still on the fight's wave; the power recharges at the new turn anyway), at 1 Gold.
  if (effectOf(state, 'spellsRechargeSpellbook')) {
    for (let i = 0; i < (result.playerSpellsCast ?? 0); i++) hunchGenesisTick(state, 1);
  }
  // FRANK × WAR: the stacks the fight's Avenges gained (each already shown live, mid-fight) join the bank.
  if (effectOf(state, 'avengeClearanceStack') && (result.playerAncientClearanceStacks ?? 0) > 0) {
    a.clearanceStacks = (a.clearanceStacks ?? 0) + result.playerAncientClearanceStacks!;
  }
  // XEROX × DEATH: the fight's friendly deaths join the running Avenge count (its copies already landed mid-fight).
  const xd = effectOf(state, 'avengeCopyTopAttack');
  if (xd) a.xeroxDeaths = ((a.xeroxDeaths ?? 0) + (result.playerDeaths ?? 0)) % Math.max(1, xd.every);
  // TRADESMAN × DEATH: the fight's deaths join the running count (its free Refreshes already came home through
  // `playerFreeRolls`, the Gryphon carry-back). WAR: the Gold the fight's Rallies banked (one flag per fire) is
  // recorded for the live text; the Gold itself came home through `playerBonusGold`.
  const td = effectOf(state, 'avengeFreeRefresh');
  if (td) a.tradesDeaths = ((a.tradesDeaths ?? 0) + (result.playerDeaths ?? 0)) % Math.max(1, td.every);
  const rg = effectOf(state, 'minionsRallyGold');
  if (rg) {
    const fires = (result.events ?? []).filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === ANCIENT_RALLY_GOLD_FLAG).length;
    if (fires > 0) noteTradesRallyGold(state, fires * rg.gold);
  }
  if (!effectOf(state, 'wardBreaksGetCopy')) return;
  a.wardBreaks = (a.wardBreaks ?? 0) + breaks.length;
  if (result.playerWardWindow) a.wardWindow = [...result.playerWardWindow];
}

// ── Auctioneer (Pulse) hooks ─────────────────────────────────────────────────────────────────────────────────
/** DEATH: how many EXTRA times Pulse fires the Shout before destroying the target (0 = the pairing is not live). */
export function ancientPulseExtraThenDestroy(state: RunState): number {
  return effectOf(state, 'pulseRepeatThenDestroy')?.extra ?? 0;
}

/** GENESIS: Pulse is a Discover of a Shout minion instead of a replay. */
export function ancientPulseDiscovers(state: RunState): boolean {
  return !!effectOf(state, 'pulseDiscoverShout');
}

/** TIME: Pulse is passive (its Start-of-Combat half rides `ancientCombatMods`). */
export function ancientPulsePassive(state: RunState): boolean {
  return !!effectOf(state, 'socTriggerEdgeShouts');
}

/** The grafted Rally War's Pulse gives (`grantedEffects`): "Rally: trigger this minion's Shout." */
export const ANCIENT_RALLY_SHOUT: EffectDef = { on: 'onAttack', do: 'rallyTriggerOwnShout', params: {} };

/** WAR: after Pulse fired `card`'s Shout, it gains the Rally keyword and "Rally: trigger this minion's Shout" (once;
 *  a second Pulse on the same minion does not stack it). Permanent: a per-instance graft on the run card. */
export function ancientAfterPulse(state: RunState, card: BoardCard): void {
  if (!effectOf(state, 'pulseGrantsRallyShout')) return;
  if (!card.grantedEffects?.some((e) => e.do === ANCIENT_RALLY_SHOUT.do)) {
    (card.grantedEffects ??= []).push({ ...ANCIENT_RALLY_SHOUT, params: {} });
  }
  if (!card.keywords.includes('RL')) card.keywords.push('RL');
}

/**
 * ONE SHOP Shout fire (called from `fireBattlecryTriggered`, once per fire, so a Drakko-doubled Shout counts twice).
 * FORTUNE banks Gold for next turn; BONDS gives the minions next to `source` +a/+h, permanently, in real time.
 * `source` is the minion whose Shout fired (absent / off the board = no neighbours, e.g. a borrowed play).
 */
export function ancientOnShopShout(state: RunState, source: BoardCard | undefined): void {
  const a = live(state);
  if (!a) return;
  const gold = effectOf(state, 'shopShoutGold');
  if (gold) {
    state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + gold.gold;
    const cur = a.shoutGold?.wave === state.wave ? a.shoutGold.gold : 0;
    a.shoutGold = { wave: state.wave, gold: cur + gold.gold };
  }
  const adj = effectOf(state, 'shoutBuffsAdjacent');
  if (adj && source) {
    const i = state.board.indexOf(source);
    if (i < 0) return;
    const near = [state.board[i - 1], state.board[i + 1]].filter((c): c is BoardCard => !!c);
    if (near.length === 0) return;
    captureBuffFx(state, source, 'minion', () => { for (const c of near) addBuff(c, ANCIENTS.bonds.name, adj.attack, adj.health); });
  }
}

// ── Lord of the Risen (Undying) hooks ─────────────────────────────────────────────────────────────────────────
/** WAR: the Undying target's Rise wears the RED look in the Shop too (the combat body reads `riseTint` off its
 *  snapshot). Undefined = the ordinary Rise look. */
export function ancientRiseTint(state: RunState, card: BoardCard): RiseTint | undefined {
  // Owner 2026-09-26 ("they look identical"): the Undying target wears its pairing's colour from the moment Undying
  // lands, not only once it has risen: War RED, Death BLUE.
  if (!card.tempReborn || !card.keywords.includes('R')) return undefined;
  if (effectOf(state, 'undyingReturnsDoubleAndAttacks')) return 'red';
  if (effectOf(state, 'undyingRegainsRise')) return 'blue';
  return undefined;
}

/** TIME: Start of Turn, every board minion gains +a/+h for each friendly minion summoned in the last combat,
 *  permanently (owner 2026-09-26: the previous combat only). */
export function ancientStartOfTurn(state: RunState): void {
  albusStartOfTurn(state);
  xeroxStartOfTurn(state);
  sorenStartOfTurn(state);
  const a = live(state);
  const e = effectOf(state, 'sotBuffPerCombatSummon');
  const n = a?.lastSummons ?? 0;
  if (!a || !e || n <= 0 || state.board.length === 0) return;
  // ITS OWN START-OF-TURN BEAT (owner 2026-09-26, R-SOT-BEAT-01): the grant is recorded on the Start-of-Turn beat
  // channel (the power button pulses, then each minion's gain lands, after the return wipe), NOT the per-action
  // buff-FX channel, whose replay fired under the return-to-shop curtain where nobody saw it. Gains are the real
  // per-minion deltas (a buff multiplier or mirror can change them), measured around the grant.
  const before = new Map(state.board.map((c) => [c.uid, { attack: c.attack, health: c.health }]));
  for (const c of state.board) addBuff(c, ANCIENTS.time.name, e.attack * n, e.health * n);
  const gains: SotBeatFx['gains'] = [];
  for (const c of state.board) {
    const p = before.get(c.uid);
    if (!p) continue;
    const da = c.attack - p.attack, dh = c.health - p.health;
    if (da > 0 || dh > 0) gains.push({ uid: c.uid, attack: da, health: dh });
  }
  if (gains.length === 0) return;
  pushSotBeat(state, { source: { kind: 'hero', id: state.heroId, label: ANCIENTS.time.name }, gains });
}

/** BONDS, Shop half: a friendly minion Rose in the Shop (a shop destroy's Rise return). Trigger the Echo of a
 *  minion next to it, a random one when both neighbours have an Echo, through the shop's own Echo ritual (the
 *  Echo multipliers and the Echo tally apply). Nothing when neither neighbour has one. */
export function ancientOnShopRise(state: RunState, risen: BoardCard): void {
  if (!effectOf(state, 'riseTriggersAdjacentEcho')) return;
  const i = state.board.indexOf(risen);
  if (i < 0) return;
  const near = [state.board[i - 1], state.board[i + 1]].filter((c): c is BoardCard => !!c && instanceEffects(c).some((e) => e.on === 'onDeath'));
  if (near.length === 0) return;
  let target = near[0]!;
  if (near.length > 1) {
    const rng = makeRng(state.rngCursor);
    target = near[rng.int(near.length)]!;
    state.rngCursor = rng.state();
  }
  captureBuffFx(state, risen, 'minion', () => fireShopEchoOf(state, target));
}

// ── Albus (Empowerment) hooks ────────────────────────────────────────────────────────────────────────────────
/** TIME: Empowerment is passive (its Start of Turn half is `albusStartOfTurn`). */
export function ancientEmpowerPassive(state: RunState): boolean {
  return !!effectOf(state, 'sotDiscoverTierAbove');
}

/** TIME: the tier the Start of Turn Discover draws from: one above your Shop tier, clamped at the ceiling the way
 *  Empowerment itself clamps (Tier 6, or Tier 7 with access), so at the top it Discovers from your own top tier. */
export function albusTimeTier(state: RunState): number {
  return Math.min(state.tier + 1, hasTier7Access(state) ? 7 : 6);
}

/** TIME: Start of Turn, queue a Discover of a minion from the tier above your Shop tier, as its own beat (R-SOT-BEAT-01). */
function albusStartOfTurn(state: RunState): void {
  if (!live(state) || !effectOf(state, 'sotDiscoverTierAbove')) return;
  const tier = albusTimeTier(state);
  recordSotBeat(state, { kind: 'hero', id: state.heroId, label: ANCIENTS.time.name }, () => {
    queueDiscover(state, { kind: 'minion', tier, exactTier: tier });
  });
}

/**
 * A minion Empowerment discovered has just arrived: `offer` is the Shop offer it became (the usual case), or `card`
 * the hand card it became when the targeted offer was already gone. DEATH: it gains Rise when it has an Echo. FORTUNE:
 * the offer costs 0 Gold. GENESIS: a plain copy of it goes to hand (hand first, the board when the hand is full).
 */
export function ancientOnEmpowerPick(state: RunState, def: CardDef, offer?: ShopCard, card?: BoardCard): void {
  if (!live(state)) return;
  if (effectOf(state, 'empowerEchoGainsRise') && def.effects.some((e) => e.on === 'onDeath')) {
    if (offer && !def.keywords.includes('R') && !(offer.keywords ?? []).includes('R')) (offer.keywords ??= []).push('R');
    if (card && !card.keywords.includes('R')) card.keywords.push('R');
  }
  if (offer && effectOf(state, 'empowerFree')) offer.cost = 0;
  if (effectOf(state, 'empowerCopyToHand')) grantMinionToHandOrBoard(state, def, false);
}

/** BONDS, Shop: a minion was PLAYED from hand. Every OTHER board minion of the same tier parity (odd / even) gains
 *  +a/+h, permanently, in real time. The played minion is not included. */
export function ancientOnPlay(state: RunState, played: BoardCard): void {
  const e = effectOf(state, 'playParityBuff');
  if (!e) return;
  const tier = CARD_INDEX[played.cardId]?.tier;
  if (tier === undefined) return;
  const parity = tier % 2;
  const mates = state.board.filter((c) => c !== played && (CARD_INDEX[c.cardId]?.tier ?? -1) % 2 === parity);
  if (mates.length === 0) return;
  captureBuffFx(state, played, 'minion', () => { for (const c of mates) addBuff(c, ANCIENTS.bonds.name, e.attack, e.health); });
}

/** The combat buff label for Hunch × Bonds (the key the UI's hero-power tendril route matches). */
export const HUNCH_BONDS_COMBAT_LABEL = 'Rounded Spellbook';

// ── Hunch (Rounded Spellbook) hooks ──────────────────────────────────────────────────────────────────────────
/**
 * GENESIS: one spell was cast. Every `every`th (a running count since the pick) recharges Rounded Spellbook (usable
 * again if already used this turn) and sets its price to `price` Gold, never RAISING it (a Spellbook already down to
 * 0 stays at 0). The price rides Hunch's own clock (`hunchResetWave`): re-basing it `3 - price` turns back makes the
 * coin read `price` now and keep shrinking 1 per turn from there, exactly like the native countdown. `waveAhead` = 1
 * for a combat cast counted at settle, so the price is set for the next Shop.
 */
function hunchGenesisTick(state: RunState, waveAhead: 0 | 1): void {
  const a = live(state);
  const e = effectOf(state, 'spellsRechargeSpellbook');
  if (!a || !e) return;
  a.genesisSpells = (a.genesisSpells ?? 0) + 1;
  if (a.genesisSpells % Math.max(1, e.every) !== 0) return;
  const wave = state.wave + waveAhead;
  const priceThen = Math.max(0, 3 - Math.max(0, wave - (state.hunchResetWave ?? 1)));
  if (priceThen > e.price) state.hunchResetWave = wave - (3 - e.price);
  if (!waveAhead) state.heroReady = true;
  a.rechargeFxSeq = (a.rechargeFxSeq ?? 0) + 1; // the hero-power pulse (presentation only)
}

/**
 * A SPELL WAS CAST in the Shop (Shop spell, Gift / Clue or Ruby; never a reward token): called once per cast
 * resolution from `noteSpellForCountRunes`, the Shop's every-spell chokepoint. GENESIS counts it; BONDS gives the
 * left-most and right-most board minions +a/+h, permanently, in real time (once when they are the same minion).
 */
export function ancientOnSpellCast(state: RunState): void {
  if (!live(state)) return;
  hunchGenesisTick(state, 0);
  const e = effectOf(state, 'spellCastBuffsEdges');
  if (!e || state.board.length === 0) return;
  const ends = state.board.length === 1 ? [state.board[0]!] : [state.board[0]!, state.board[state.board.length - 1]!];
  // The grants leave the HERO-POWER button (the generic tendril, `fromHeroPower`), the shop twin of the combat
  // replay's `HERO_POWER_BUFF_LABELS` route: stamp the records this capture pushed.
  const from = state.recruitBuffFx.length;
  captureBuffFx(state, undefined, 'spell', () => { for (const c of ends) addBuff(c, ANCIENTS.bonds.name, e.attack, e.health); });
  for (let i = from; i < state.recruitBuffFx.length; i++) state.recruitBuffFx[i]!.fromHeroPower = true;
}

/**
 * Rounded Spellbook just resolved and handed `copies` to hand. FORTUNE: +gold max Gold, permanently (the Gold Font
 * channel `maxGoldBonus`: above the natural cap, no Gold this turn). TIME: each copy casts twice (`castMult`).
 */
export function ancientOnSpellbook(state: RunState, copies: BoardCard[]): void {
  const a = live(state);
  if (!a) return;
  const gold = effectOf(state, 'spellbookMaxGold');
  if (gold) {
    state.maxGoldBonus = (state.maxGoldBonus ?? 0) + gold.gold;
    a.bookMaxGold = (a.bookMaxGold ?? 0) + gold.gold;
    a.bookGoldFxSeq = (a.bookGoldFxSeq ?? 0) + 1; // the Gold pill's coin burst (presentation only)
  }
  const twice = effectOf(state, 'spellbookCastsTwice');
  if (twice) for (const c of copies) c.castMult = Math.max(c.castMult ?? 1, twice.mult);
}

// ── Frantic Frank (Clearance) hooks ──────────────────────────────────────────────────────────────────────────
/** The `questTrigger` flag War's combat Avenge emits once per stack gained (the replay counts them for the live text). */
export const ANCIENT_CLEARANCE_STACK_FLAG = 'ancientClearanceStack';

/** TIME: Clearance is passive (its half is the first-buys price, `ancientTimePrice`). */
export function ancientClearancePassive(state: RunState): boolean {
  return !!effectOf(state, 'firstBuysCost');
}

/** WAR: banked Clearance stacks (0 unless the pairing is live). */
export function ancientClearanceStacks(state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'heroId'>): number {
  const s = state as RunState;
  return effectOf(s, 'avengeClearanceStack') ? Math.max(0, live(s)?.clearanceStacks ?? 0) : 0;
}

/**
 * WAR: the Clearance uses available right now = the turn's own use (while unspent) + the banked stacks + `gained`
 * (stacks gained so far in the fight on screen). The power's red uses badge shows it ONLY when it is 2 or more (owner
 * 2026-09-30: "when there are multiple stacks of clearance, show the # in Red in the center top of the hero power");
 * null = no badge (War not picked, or a single use needs none).
 */
export function ancientClearanceUsesBadge(state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'heroId' | 'heroReady'>, gained = 0): number | null {
  const s = state as RunState;
  if (!effectOf(s, 'avengeClearanceStack')) return null;
  const uses = (state.heroReady ? 1 : 0) + ancientClearanceStacks(state) + Math.max(0, gained);
  return uses >= 2 ? uses : null;
}

/**
 * WAR: the Avenge (N) countdown shown in the CENTRE of the power (owner 2026-09-30: "show it in the center of the hero
 * power when war is active"): friendly deaths still needed for the next stack. Avenge counts deaths within ONE fight
 * (the avenge bus's `count`), so outside a fight it reads the full N; `deaths` = friendly deaths so far in the fight on
 * screen. null = War not picked.
 */
export function ancientClearanceAvengeLeft(state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'heroId'>, deaths = 0): number | null {
  const e = effectOf(state as RunState, 'avengeClearanceStack');
  if (!e) return null;
  const every = Math.max(1, e.every);
  return every - (Math.max(0, deaths) % every);
}

/** WAR: a Clearance use past the turn's own charge spends one stack. */
export function ancientSpendClearanceStack(state: RunState): void {
  const a = live(state);
  if (a && (a.clearanceStacks ?? 0) > 0) a.clearanceStacks = a.clearanceStacks! - 1;
}

/**
 * Run Clearance's refresh (`refresh` = the reducer's `refreshTavern` + `applyShopRefreshed`). GENESIS narrows it to
 * your most common type (`dominantBoardTribe`, the Reinforcing Ale tie-break: first seen on the board wins): the
 * type is parked on `AncientsState.rollTribe` for exactly this roll. No type on the board = an ordinary refresh.
 */
export function ancientClearanceRefresh(state: RunState, refresh: () => void): void {
  const a = live(state);
  const tribe = a && effectOf(state, 'clearanceTopTribe') ? dominantBoardTribe(state) : null;
  if (!a || !tribe) { refresh(); return; }
  a.rollTribe = tribe;
  try { refresh(); } finally { a.rollTribe = undefined; }
}

/** GENESIS: the type the roll in progress is narrowed to (read by `rollShopRow`), else undefined. */
export function ancientRollTribe(state: RunState): Tribe | undefined {
  return live(state)?.rollTribe;
}

/** A Clearance offer was just stamped at 2 Gold: mark it as a Clearance offer (Ancients runs only, so every other run's
 *  state is byte-identical). DEATH: the whole set starts at 0 Gold, "the first one you buy is free". */
export function ancientMarkClearanceOffer(state: RunState, offer: ShopCard): void {
  if (!live(state)) return;
  offer.clearance = true;
  if (effectOf(state, 'clearanceDestroyFirstFree')) { offer.cost = 0; offer.clearanceFree = true; }
}

/** DEATH: after Clearance refreshed, destroy the left-most board minion (a real shop death: its Echo, the death
 *  watchers, a Rebirth / Rise return). An empty board skips it. */
export function ancientAfterClearance(state: RunState): void {
  if (!effectOf(state, 'clearanceDestroyFirstFree')) return;
  const left = state.board[0];
  if (left) destroyMinionInShop(makeContext(state), left);
}

/** A Shop offer is being bought. DEATH: buying one of the free Clearance offers spends the free buy, so the rest go
 *  back to the Clearance 2 Gold. Returns whether the bought minion is a Clearance minion (`BoardCard.clearanceBuy`). */
export function ancientOnClearanceBuy(state: RunState, offer: ShopCard): boolean {
  if (!live(state)) return false;
  if (offer.clearanceFree) {
    for (const o of state.shop) if (o.clearanceFree && o !== offer) { o.cost = 2; o.clearanceFree = undefined; }
  }
  return !!offer.clearance;
}

/** TIME: discounted buys left this turn (0 unless the pairing is live). */
export function ancientTimeBuysLeft(state: RunState): number {
  const e = effectOf(state, 'firstBuysCost');
  if (!e) return 0;
  const tb = live(state)?.timeBuys;
  return Math.max(0, e.count - (tb?.wave === state.wave ? tb.n : 0));
}

/** TIME: the price cap on the next minion buy (the Time price while buys are left this turn), else undefined. */
export function ancientTimePrice(state: RunState): number | undefined {
  const e = effectOf(state, 'firstBuysCost');
  return e && ancientTimeBuysLeft(state) > 0 ? e.price : undefined;
}

/** TIME: a minion was bought (every buy counts toward "the first 3", discounted or not). */
export function ancientNoteMinionBuy(state: RunState): void {
  const a = live(state);
  if (!a || !effectOf(state, 'firstBuysCost')) return;
  const n = a.timeBuys?.wave === state.wave ? a.timeBuys.n : 0;
  a.timeBuys = { wave: state.wave, n: n + 1 };
}

/** FORTUNE: what a Clearance minion sells for (undefined = not a Clearance minion, or the pairing is not live). */
export function ancientClearanceSellValue(card: BoardCard, state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'heroId'>): number | undefined {
  if (!card.clearanceBuy) return undefined;
  return effectOf(state as RunState, 'clearanceSellValue')?.gold;
}

/** BONDS: a sold Clearance minion's CURRENT stats go to a random friendly board minion, permanently, right then. The
 *  sold minion has already left, so it is never its own recipient. No other minion = nothing. */
function ancientClearanceSale(state: RunState, sold: BoardCard): void {
  if (!sold.clearanceBuy || !effectOf(state, 'clearanceSaleGivesStats')) return;
  if (state.board.length === 0 || (sold.attack <= 0 && sold.health <= 0)) return;
  const rng = makeRng(state.rngCursor);
  const pick = state.board[rng.int(state.board.length)]!;
  state.rngCursor = rng.state();
  // A `deathrattle`-kind capture keeps the sold body as its source: the UI streams the buff tendril from the slot it
  // just left (its last-known position) to the recipient, with the recipient's stat pop.
  captureBuffFx(state, sold, 'deathrattle', () => addBuff(pick, ANCIENTS.bonds.name, Math.max(0, sold.attack), Math.max(0, sold.health)));
}

// ── Xerox (Copy Machine) hooks ───────────────────────────────────────────────────────────────────────────────
/** The friendly minion a Xerox copy is made of: the highest `stat` among `board` (ties: the left-most). */
function topBy(board: readonly BoardCard[], stat: 'attack' | 'health'): BoardCard | undefined {
  let best: BoardCard | undefined;
  for (const c of board) if (!best || c[stat] > best[stat]) best = c;
  return best;
}

/**
 * XEROX × FORTUNE: the PAIRS on the board right now: minions sharing a card (a Gilded and a plain copy of one card are
 * the same card), floor(n / 2) per card.
 */
export function boardPairs(state: Pick<RunState, 'board'>): number {
  const n = new Map<string, number>();
  for (const c of state.board) n.set(c.cardId, (n.get(c.cardId) ?? 0) + 1);
  let pairs = 0;
  for (const k of n.values()) pairs += Math.floor(k / 2);
  return pairs;
}

/** XEROX × FORTUNE: is the End-of-Turn pair payout live (the `ancientXeroxPairs` recurring entry)? */
export function ancientXeroxPairsLive(state: RunState): boolean {
  return !!live(state) && !!effectOf(state, 'pairsGoldNextTurn');
}

/** XEROX × FORTUNE: End of Turn, bank `gold` per pair for next turn (the `ancientXeroxPairs` recurring entry). */
export function ancientRunXeroxPairs(state: RunState): void {
  const a = live(state);
  const e = effectOf(state, 'pairsGoldNextTurn');
  if (!a || !e) return;
  const gold = e.gold * boardPairs(state);
  if (gold <= 0) return;
  state.bonusEmbersNextTurn = (state.bonusEmbersNextTurn ?? 0) + gold;
  const cur = a.xeroxPairGold?.wave === state.wave ? a.xeroxPairGold.gold : 0;
  a.xeroxPairGold = { wave: state.wave, gold: cur + gold };
}

/**
 * XEROX × DEATH: friendly deaths still needed for the next copy. ONE running count across the Shop and combat (the
 * carried `xeroxDeaths` plus `deaths`, the deaths so far in the fight on screen). Null when Death is not picked.
 */
export function ancientXeroxAvengeLeft(state: RunState, deaths = 0): number | null {
  const e = live(state) ? effectOf(state, 'avengeCopyTopAttack') : undefined;
  if (!e) return null;
  const every = Math.max(1, e.every);
  return every - (((live(state)?.xeroxDeaths ?? 0) + Math.max(0, deaths)) % every);
}

/**
 * A friendly minion died in the Shop (`fireOnFriendDeath`: every Shop death path, once; a sale never). BONDS: a bound
 * end dying breaks the bond. DEATH: the running Avenge count ticks; each `every`th death summons a copy of your
 * highest-Attack minion beside it (the dying body, still in its slot while it vacates, is never the source and never
 * holds a slot). No minion to copy, or no room: nothing happens (the count still resets).
 */
export function ancientXeroxShopDeath(state: RunState, dead: BoardCard): void {
  const a = live(state);
  if (!a) return;
  xeroxBreakIfEnd(state, dead.uid);
  const e = effectOf(state, 'avengeCopyTopAttack');
  if (!e) return;
  a.xeroxDeaths = ((a.xeroxDeaths ?? 0) + 1) % Math.max(1, e.every);
  if (a.xeroxDeaths !== 0) return;
  const others = state.board.filter((c) => c.uid !== dead.uid && c.uid !== state.vacatingUid);
  const src = topBy(others, 'attack');
  if (!src || others.length >= CONFIG.boardMax) return;
  const copy = exactBoardCopy(state, src);
  state.board.splice(state.board.indexOf(src) + 1, 0, copy);
}

/** TIME: Start of Turn, a copy of a random board minion to hand, as its own beat (R-SOT-BEAT-01). */
function xeroxStartOfTurn(state: RunState): void {
  if (!live(state) || !effectOf(state, 'sotCopyToHand')) return;
  if (state.board.length === 0 || state.hand.length >= handCap(state)) return;
  recordSotBeat(state, { kind: 'hero', id: state.heroId, label: ANCIENTS.time.name }, () => {
    const rng = makeRng(state.rngCursor);
    const src = state.board[rng.int(state.board.length)]!;
    state.rngCursor = rng.state();
    state.hand.push(exactBoardCopy(state, src));
  });
}

/** GENESIS: Copy Machine uses banked beyond the once-per-game one (0 unless the pairing is live). */
export function ancientCopyCharges(state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'heroId'>): number {
  const s = state as RunState;
  return live(s) && effectOf(s, 'copyMachineExtraCharge') ? Math.max(0, live(s)?.xeroxCharges ?? 0) : 0;
}

/** GENESIS: Copy Machine uses left right now (the once-per-game use while unspent + the banked charges). */
export function ancientCopyUsesLeft(state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'heroId' | 'heroPowerSpent'>): number {
  return (state.heroPowerSpent ? 0 : 1) + ancientCopyCharges(state);
}

/** GENESIS: a use past the once-per-game one spends a banked charge. */
export function ancientSpendCopyCharge(state: RunState): void {
  const a = live(state);
  if (a && (a.xeroxCharges ?? 0) > 0) a.xeroxCharges = a.xeroxCharges! - 1;
}

/** BONDS: Copy Machine just made `copy` of `original`: bind them (a later Copy Machine re-binds to its own pair). */
export function ancientOnCopyMachine(state: RunState, original: BoardCard, copy: BoardCard): void {
  const a = live(state);
  if (!a || !effectOf(state, 'copyMachineBonds')) return;
  a.xeroxBond = { a: original.uid, b: copy.uid };
  a.xeroxBondBroken = undefined;
  stampXeroxBond(state); // live for the rest of THIS dispatch too
}

/** BONDS: the live bond, or undefined (none, broken, or Bonds not picked). Pure read. */
export function ancientXeroxBondOf(state: RunState): { a: string; b: string } | undefined {
  const a = live(state);
  return a?.xeroxBond && effectOf(state, 'copyMachineBonds') ? a.xeroxBond : undefined;
}

/** BONDS: the bond, after checking both ends still exist on the run (board or hand). An end that is gone (sold,
 *  consumed, eaten, destroyed) breaks it for good. Called by `stampXeroxBond`, so every action re-checks it. */
export function ancientXeroxBondValidate(state: RunState): { a: string; b: string } | undefined {
  const bond = ancientXeroxBondOf(state);
  if (!bond) return undefined;
  const has = (uid: string): boolean => state.board.some((c) => c.uid === uid) || state.hand.some((c) => c.uid === uid);
  if (has(bond.a) && has(bond.b)) return bond;
  xeroxBreak(state, false);
  return undefined;
}

/** BONDS: "if this triples, the effect breaks": either end consumed into a triple ends the bond for good. */
export function ancientXeroxBondTripled(state: RunState, consumed: readonly BoardCard[]): void {
  for (const c of consumed) xeroxBreakIfEnd(state, c.uid);
}

function xeroxBreakIfEnd(state: RunState, uid: string): void {
  const bond = live(state)?.xeroxBond;
  if (bond && (bond.a === uid || bond.b === uid)) xeroxBreak(state, true);
}

function xeroxBreak(state: RunState, restamp: boolean): void {
  const a = live(state);
  if (!a?.xeroxBond) return;
  a.xeroxBond = undefined;
  a.xeroxBondBroken = true;
  if (restamp) stampXeroxBond(state); // stop mirroring for the rest of THIS dispatch
}

/** BONDS: the live bond line the power prints (who is bound right now, or that the bond is broken). */
function xeroxBondText(state: RunState): string {
  const a = live(state);
  if (!a || !effectOf(state, 'copyMachineBonds')) return '';
  const bond = a.xeroxBond;
  if (bond) {
    const c = state.board.find((x) => x.uid === bond.a) ?? state.hand.find((x) => x.uid === bond.a);
    const name = c ? CARD_INDEX[c.cardId]?.name ?? c.cardId : 'a minion';
    return ` Bound now: **${name}** and its copy.`;
  }
  return a.xeroxBondBroken ? ' The bond is broken.' : '';
}

// ── Tradesman (Frugal) hooks ─────────────────────────────────────────────────────────────────────────────────
/** The `questTrigger` flag Death's combat Avenge emits once per free Refresh (the replay counts them for the text). */
export const ANCIENT_REFRESH_AVENGE_FLAG = 'ancientRefreshAvenge';
/** The `questTrigger` flag War's Rally graft emits once per fire in combat (the replay + settle count them). */
export const ANCIENT_RALLY_GOLD_FLAG = 'ancientRallyGold';

/**
 * TRADESMAN × DEATH: friendly deaths still needed for the next free Refresh. ONE running count across the Shop and
 * combat (the carried `tradesDeaths` plus `deaths`, the deaths so far in the fight on screen), the Xerox Death shape.
 * Null when Death is not the picked pairing.
 */
export function ancientTradesAvengeLeft(state: RunState, deaths = 0): number | null {
  const e = live(state) ? effectOf(state, 'avengeFreeRefresh') : undefined;
  if (!e) return null;
  const every = Math.max(1, e.every);
  return every - (((live(state)?.tradesDeaths ?? 0) + Math.max(0, deaths)) % every);
}

/** TRADESMAN × DEATH, Shop half: a friendly minion died in the Shop (`fireOnFriendDeath`, every Shop death path once;
 *  a sale never). The running count ticks; every `every`th death banks a free Refresh, right then. */
export function ancientTradesShopDeath(state: RunState): void {
  const a = live(state);
  const e = a ? effectOf(state, 'avengeFreeRefresh') : undefined;
  if (!a || !e) return;
  a.tradesDeaths = ((a.tradesDeaths ?? 0) + 1) % Math.max(1, e.every);
  if (a.tradesDeaths === 0) state.freeRolls = (state.freeRolls ?? 0) + 1;
}

/** TRADESMAN × FORTUNE: a minion was BOUGHT from the Shop (a normal buy, the Starform, a displaced body re-bought).
 *  "Your next Refresh costs 0" (owner 2026-10-02): sets ONE pending flag, right then. Already set = nothing more (it
 *  never stacks). Separate from the `freeRolls` bank. Spells, Discovers and generated cards never reach this. */
export function ancientTradesBuy(state: RunState): void {
  const a = live(state);
  if (a && effectOf(state, 'buyNextRefreshFree')) a.tradesNextRefreshFree = true;
}

/** TRADESMAN × FORTUNE: is the next Refresh's 0 cost pending (the price `refreshCostOf` shows, the power text)? */
export function ancientTradesRefreshFree(state: RunState): boolean {
  return !!live(state)?.tradesNextRefreshFree && !!effectOf(state, 'buyNextRefreshFree');
}

/** TRADESMAN × FORTUNE: the `roll` branch spends the pending 0-cost Refresh FIRST (before the `freeRolls` bank, so a
 *  banked free Refresh is kept). Returns true when it paid for this Refresh. */
export function ancientTradesSpendFreeRefresh(state: RunState): boolean {
  if (!ancientTradesRefreshFree(state)) return false;
  state.ancients!.tradesNextRefreshFree = false;
  return true;
}

/** TRADESMAN × WAR: the graft every friendly minion carries ("Rally: gain N Gold next turn"), or undefined when War is
 *  not the picked pairing. `fixed`: a Gilded minion gives the same Gold (a hero-granted Rally, the rune-graft rule). */
export function ancientRallyGoldGraft(state: RunState): { gold: number } | undefined {
  const e = live(state) ? effectOf(state, 'minionsRallyGold') : undefined;
  return e ? { gold: e.gold } : undefined;
}

/** The effect War grafts (`grantedEffects`), shared by the Shop sweep and the combat summon graft. */
export function rallyGoldGraftEffect(gold: number): EffectDef {
  return { on: 'onAttack', do: 'rallyGoldNextTurn', params: { gold, fixed: true } };
}

/** TRADESMAN × WAR: record Gold the graft banked for next turn (the live text; the Gold itself is already banked). */
export function noteTradesRallyGold(state: RunState, gold: number): void {
  const a = live(state);
  if (!a || gold <= 0) return;
  const cur = a.tradesRallyGold?.wave === state.wave ? a.tradesRallyGold.gold : 0;
  a.tradesRallyGold = { wave: state.wave, gold: cur + gold };
}

/** TRADESMAN × WAR: Gold banked for next turn by the graft this turn (0 once the next Shop has paid it out). */
function tradesRallyGoldNow(state: RunState): number {
  const g = live(state)?.tradesRallyGold;
  return g && g.wave === state.wave ? g.gold : 0;
}

/** TRADESMAN × GENESIS: Refreshes still needed for the next Lasso. 0 when Genesis is not picked. */
function tradesLassoLeft(state: RunState): number {
  const e = effectOf(state, 'refreshesCastSpell');
  if (!e) return 0;
  const every = Math.max(1, e.every);
  return every - ((live(state)?.tradesRefreshes ?? 0) % every);
}

/** Frugal's surcharge on a Shop upgrade ("Shop upgrades cost 2 more"). The reducer's `upgradeCostOf` reads it too. */
export const FRUGAL_UPGRADE_SURCHARGE = 2;

/** TRADESMAN × TIME / BONDS: Gold of Frugal's surcharge the discounts have eaten at the CURRENT tier (0 otherwise). */
export function ancientUpgradeSurchargeOff(state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'tier'>): number {
  const off = (state.ancientsEnabled ? state.ancients : undefined)?.tradesSurchargeOff;
  return off && off.tier === state.tier ? off.gold : 0;
}

/** The price an upgrade charges right now: the reducer's `upgradeCostOf` (running cost + Frugal's surcharge, less what
 *  the Time / Bonds discounts ate of that surcharge and Ayse's banked discount, floored at 0). Restated here because
 *  ancients.ts cannot import the reducer (a cycle); a test pins the two equal. */
export function tradesUpgradeCost(state: RunState): number {
  const base = state.upgradeCost + (hasPower(state, 'cheapMinions') ? FRUGAL_UPGRADE_SURCHARGE : 0);
  return Math.max(0, base - ancientUpgradeSurchargeOff(state) - (state.aceTierDiscount ?? 0));
}

/** TIME / BONDS: the live upgrade line (the price right now, or nothing at the top tier). */
function tradesUpgradeText(state: RunState): string {
  const ceiling = hasTier7Access(state) ? 7 : maxTierFor(state.rift);
  return state.tier >= ceiling ? '' : ` Upgrading costs **${tradesUpgradeCost(state)} Gold** now.`;
}

/**
 * TIME / BONDS: knock `amount` off the upgrade price (owner ruling 2026-10-02: "Yes, down to 0"). The running cost goes
 * first (the Rune of Shopkeep mechanism, floored at `CONFIG.upgradeCostFloor`); whatever is left over then eats into
 * Frugal's surcharge, banked for this tier (`tradesSurchargeOff`, capped at the surcharge), so the FINAL price floors
 * at 0, never at Frugal's 2.
 */
function cutUpgradeCost(state: RunState, amount: number): void {
  const want = state.upgradeCost - amount;
  state.upgradeCost = Math.max(CONFIG.upgradeCostFloor, want);
  const overflow = state.upgradeCost - want;
  const a = live(state);
  if (!a || overflow <= 0 || !hasPower(state, 'cheapMinions')) return;
  const cur = ancientUpgradeSurchargeOff(state);
  a.tradesSurchargeOff = { tier: state.tier, gold: Math.min(FRUGAL_UPGRADE_SURCHARGE, cur + overflow) };
}

/** TRADESMAN × TIME: is the End-of-Turn upgrade cut live (the `ancientTradesUpgrade` recurring entry)? */
export function ancientTradesUpgradeLive(state: RunState): boolean {
  return !!live(state) && !!effectOf(state, 'eotUpgradeDiscount');
}

/** TRADESMAN × TIME: End of Turn, the upgrade costs `amount` less (the `ancientTradesUpgrade` recurring entry). */
export function ancientRunTradesUpgrade(state: RunState): void {
  const e = live(state) ? effectOf(state, 'eotUpgradeDiscount') : undefined;
  if (e) cutUpgradeCost(state, e.amount);
}

/**
 * A Shop REFRESH just rolled (the reducer's `refreshTavern`, never the turn-start roll): the same "refresh" the meter
 * counts, paid or free. BONDS: the upgrade costs `amount` less. GENESIS: the running count ticks, and every `every`th
 * casts the spell through `castSpell`, the real Shop cast pipeline (spell watchers, cast counters, Rune of Lassoing),
 * AFTER the new row is in, so Lasso steals from the fresh Shop. The beam leaves the hero power (`origin: 'hero'`).
 */
export function ancientAfterRefresh(state: RunState): void {
  const a = live(state);
  if (!a) return;
  const bonds = effectOf(state, 'refreshUpgradeDiscount');
  if (bonds) cutUpgradeCost(state, bonds.amount);
  const gen = effectOf(state, 'refreshesCastSpell');
  if (!gen) return;
  a.tradesRefreshes = (a.tradesRefreshes ?? 0) + 1;
  if (a.tradesRefreshes % Math.max(1, gen.every) !== 0) return;
  const spell = CARD_INDEX[gen.spellId];
  if (spell?.spell) castSpell(state, spell, undefined, 'hero');
}

// ── Soren (Reclaim) hooks ────────────────────────────────────────────────────────────────────────────────────
/** WAR: the +X/+X a Reclaimed copy gains on its return right now (0 unless the pairing is live). */
export function ancientReclaimGain(state: RunState): number {
  const e = live(state) ? effectOf(state, 'reclaimGainImproves') : undefined;
  return e ? live(state)?.sorenWarGain ?? e.amount : 0;
}

/** WAR: "Start of Turn: Improve this." The amount grows by its printed base each Start of Turn (the "Improve this"
 *  convention: grow by the base amount). No board change, so no beat: the power text reads the new number. */
function sorenStartOfTurn(state: RunState): void {
  const a = live(state);
  const e = effectOf(state, 'reclaimGainImproves');
  if (!a || !e) return;
  a.sorenWarGain = (a.sorenWarGain ?? e.amount) + e.amount;
}

/** FORTUNE: Reclaim resolves in the Shop instead of marking the minion for Start of Combat. */
export function ancientReclaimInShop(state: RunState): boolean {
  return !!effectOf(state, 'reclaimInShop');
}

/**
 * FORTUNE: Reclaim, in the Shop, right now. Combat's Reclaim exactly, moved to the Recruit phase: `card` is destroyed as
 * a TRUE death (`rise: false`, so no Rise / Rebirth return, as combat forces), its Echo fires where it stood, and an
 * exact copy of the body it had returns to its slot (to the right of anything its Echo summoned there), as a summon
 * (`fireSummonBuffs`). No room left after the Echo: an overflow (`fireSummonOverflow`, the Rise-return rule), and the
 * copy is lost (owner 2026-10-02). The use gains `gold` immediately.
 */
export function ancientShopReclaim(state: RunState, card: BoardCard): void {
  const e = effectOf(state, 'reclaimInShop');
  if (!e) return;
  const slot = state.board.indexOf(card);
  if (slot < 0) return;
  const copy = exactBoardCopy(state, card); // the body as it is NOW (stats, buffs, keywords, counters)
  const before = state.board.length;
  destroyMinionInShop(makeContext(state), card, { rise: false });
  if (state.board.length >= CONFIG.boardMax) fireSummonOverflow(state);
  else {
    const grew = state.board.length - (before - 1); // bodies the Echo added
    state.board.splice(Math.min(state.board.length, slot + Math.max(0, grew)), 0, copy);
    fireSummonBuffs(state, copy);
  }
  gainGold(state, e.gold);
}

/** GENESIS: after Reclaim marks `card`, a plain copy (the printed card, never gilded) goes to hand, locked for `turns`
 *  turns (`lockedUntilWave`: unplayable this turn and the next `turns - 1`). Hand full: no copy (never onto the board). */
export function ancientAfterReclaimMark(state: RunState, card: BoardCard): void {
  const e = effectOf(state, 'reclaimCopyLocked');
  if (!e) return;
  const def = CARD_INDEX[card.cardId];
  if (!def || def.spell || state.hand.length >= handCap(state)) return;
  const copy = grantMinionToHandOrBoard(state, def, false);
  if (state.hand.includes(copy)) copy.lockedUntilWave = state.wave + e.turns;
}

// ── Robin (Spoils) hooks ─────────────────────────────────────────────────────────────────────────────────────
/** ROBIN × DEATH: Spoils counts (sales) this turn. */
export function robinSpoilsThisTurn(state: Pick<RunState, 'ancientsEnabled' | 'ancients' | 'wave'>): number {
  const sp = state.ancientsEnabled ? state.ancients?.robinSpoils : undefined;
  return sp && sp.wave === state.wave ? sp.n : 0;
}

/** ROBIN × DEATH, Shop half: a friendly minion was summoned (`fire`'s `onSummon`: a play from hand, a token summon). It
 *  gains +a/+h for every Spoils count this turn, permanently. */
export function ancientOnShopSummon(state: RunState, minion: BoardCard): void {
  const e = live(state) ? effectOf(state, 'summonGainPerSpoils') : undefined;
  const n = e ? robinSpoilsThisTurn(state) : 0;
  if (!e || n <= 0 || !state.board.includes(minion)) return;
  captureBuffFx(state, undefined, 'spell', () => addBuff(minion, ANCIENTS.death.name, e.attack * n, e.health * n));
}

/**
 * ROBIN: a minion was sold (recruit's `bankSpoils`, called by EVERY sale path: the manual sale and the spell sales). The
 * caller has already removed `sold`. `spoils`: the seller has the Spoils power (a Spoils count was banked). Ticks the
 * per-turn Spoils count, then runs the picked sale pairing (Fortune / War / Genesis / Bonds), in real time.
 */
export function ancientOnRobinSale(state: RunState, sold: BoardCard, spoils: boolean): void {
  const a = live(state);
  if (!a) return;
  if (spoils) a.robinSpoils = { wave: state.wave, n: robinSpoilsThisTurn(state) + 1 };
  const fr = effectOf(state, 'sellsGrantFreeRefresh');
  if (fr) {
    a.robinSales = (a.robinSales ?? 0) + 1;
    if (a.robinSales >= Math.max(1, fr.every)) { a.robinSales = 0; state.freeRolls += 1; }
  }
  const war = effectOf(state, 'saleBuffsLeftmost');
  const left = state.board[0];
  if (war && left) captureBuffFx(state, undefined, 'spell', () => addBuff(left, ANCIENTS.war.name, war.attack, war.health));
  const gc = effectOf(state, 'sellsGetCopy');
  if (gc) {
    const win = [...(a.robinWindow ?? []), sold.cardId];
    if (win.length >= Math.max(1, gc.every)) {
      const rng = makeRng(state.rngCursor);
      const pick = win[rng.int(win.length)]!;
      state.rngCursor = rng.state();
      a.robinWindow = [];
      const def = CARD_INDEX[pick];
      if (def && !def.spell) grantMinionToHandOrBoard(state, def, false);
    } else a.robinWindow = win;
  }
  if (effectOf(state, 'saleDiscountsTribe')) {
    const cur = a.robinBonds ?? [];
    const add = robinTribesOf(CARD_INDEX[sold.cardId]).filter((m) => !cur.includes(m));
    if (add.length > 0) a.robinBonds = [...cur, ...add];
  }
}

/** ROBIN × BONDS: the marks a sold minion makes: `'all'` for an All-types minion, else its real type(s); a minion with
 *  no type (neutral) marks nothing. */
function robinTribesOf(def: CardDef | undefined): (Tribe | 'all')[] {
  if (!def) return [];
  if (def.universalTribe) return ['all'];
  return [def.tribe, def.tribe2].filter((t): t is Tribe => !!t && t !== 'neutral');
}

/** ROBIN × BONDS: the index of the first mark a minion of `def` would spend (-1 = none). An All-types minion matches any
 *  mark; an `'all'` mark matches any typed minion. A neutral minion matches nothing. */
function robinBondsMatch(state: Pick<RunState, 'ancientsEnabled' | 'ancients'>, def: CardDef | undefined): number {
  const marks = state.ancientsEnabled ? state.ancients?.robinBonds : undefined;
  if (!marks?.length || !def || def.spell || def.ruby) return -1;
  const typed = !!def.universalTribe || (!!def.tribe && def.tribe !== 'neutral') || (!!def.tribe2 && def.tribe2 !== 'neutral');
  if (!typed) return -1;
  return marks.findIndex((m) => m === 'all' || !!def.universalTribe || def.tribe === m || def.tribe2 === m);
}

/** ROBIN × BONDS: the set price a Shop minion buys at right now (undefined = no matching mark, or Bonds is not live). */
export function ancientRobinBondsPrice(state: RunState, cardId: string): number | undefined {
  const e = live(state) ? effectOf(state, 'saleDiscountsTribe') : undefined;
  if (!e || robinBondsMatch(state, CARD_INDEX[cardId]) < 0) return undefined;
  return e.price;
}

/** ROBIN × BONDS: a minion was bought; spend the mark it matched (nothing when none matched). */
export function ancientSpendRobinBonds(state: RunState, cardId: string): void {
  const a = live(state);
  if (!a?.robinBonds || !effectOf(state, 'saleDiscountsTribe')) return;
  const i = robinBondsMatch(state, CARD_INDEX[cardId]);
  if (i < 0) return;
  const next = [...a.robinBonds];
  next.splice(i, 1);
  a.robinBonds = next;
}

function robinBondsText(state: RunState): string {
  const marks = live(state)?.robinBonds ?? [];
  if (marks.length === 0) return '';
  const name = (m: Tribe | 'all'): string => (m === 'all' ? 'Any type' : `${m.charAt(0).toUpperCase()}${m.slice(1)}`);
  return ` Ready: **${marks.map(name).join(', ')}**.`;
}

/** ROBIN × TIME: is the End-of-Turn max Gold grant live (the `ancientRobinMaxGold` recurring entry)? */
export function ancientRobinMaxGoldLive(state: RunState): boolean {
  return !!live(state) && !!effectOf(state, 'eotMaxGold');
}

/** ROBIN × TIME: End of Turn, +gold max Gold, permanently (`maxGoldBonus`: above the natural cap, no ceiling). */
export function ancientRunRobinMaxGold(state: RunState): void {
  const a = live(state);
  const e = effectOf(state, 'eotMaxGold');
  if (!a || !e || e.gold <= 0) return;
  state.maxGoldBonus = (state.maxGoldBonus ?? 0) + e.gold;
  a.robinMaxGold = (a.robinMaxGold ?? 0) + e.gold;
}

// ── Re-Pete (Second Hand) hooks ──────────────────────────────────────────────────────────────────────────────
/** The Second Hand cadence: it triggers at the end of every Nth turn (3 natively; Time makes it 2). */
export function ancientSecondHandEvery(state: RunState): number {
  const e = live(state) ? effectOf(state, 'secondHandEvery') : undefined;
  return e ? Math.max(1, e.turns) : 3;
}

/** RE-PETE × TIME: the next turn Second Hand triggers on (this turn when it is due now). */
export function ancientSecondHandNextTurn(state: RunState): number {
  const every = ancientSecondHandEvery(state);
  return Math.ceil(Math.max(1, state.wave) / every) * every;
}

/** What Second Hand copies: natively the left-most HAND card (a spell included); Bonds makes it the left-most and
 *  right-most BOARD minions (one when they are the same body). Empty = nothing to copy. */
export function ancientSecondHandSources(state: RunState): BoardCard[] {
  if (live(state) && effectOf(state, 'secondHandEdges')) {
    const first = state.board[0];
    const last = state.board[state.board.length - 1];
    if (!first || !last) return [];
    return first === last ? [first] : [first, last];
  }
  return state.hand[0] ? [state.hand[0]] : [];
}

/** RE-PETE × GENESIS: is Second Hand making EXACT copies (the caller uses `ancientSecondHandExactCopy`)? */
export function ancientSecondHandIsExact(state: RunState): boolean {
  return !!live(state) && !!effectOf(state, 'secondHandExact');
}

/** RE-PETE × GENESIS: an EXACT copy (current stats, buffs, keywords, gilding) of `src` to hand. Hand full: none. */
export function ancientSecondHandExactCopy(state: RunState, src: BoardCard): BoardCard | undefined {
  if (state.hand.length >= handCap(state)) return undefined;
  const copy = exactBoardCopy(state, src);
  state.hand.push(copy);
  return copy;
}

/** RE-PETE × WAR: the live +X/+X a Second Hand minion copy gains right now. */
export function ancientSecondHandGain(state: RunState): number {
  return live(state) && effectOf(state, 'secondHandBuffImproves') ? live(state)?.repeteWarGain ?? 0 : 0;
}

/**
 * RE-PETE × WAR: Second Hand just triggered and made `made` (every copy, Wishbone's included). Each MINION copy gains the
 * CURRENT +X/+X (a spell copy has no body to grow), then X improves by the printed amount, once per trigger.
 */
export function ancientAfterSecondHand(state: RunState, made: readonly BoardCard[]): void {
  const a = live(state);
  const e = effectOf(state, 'secondHandBuffImproves');
  if (!a || !e) return;
  const x = a.repeteWarGain ?? e.amount;
  for (const c of made) {
    const def = CARD_INDEX[c.cardId];
    if (!def || def.spell || def.ruby || x <= 0) continue;
    addBuff(c, ANCIENTS.war.name, x, x);
  }
  a.repeteWarGain = x + e.amount;
}

/**
 * A card was bought: the reducer's post-buy block, which every successful buy walks (a Shop minion, a held minion, the
 * spell slot, a spell in the minion row, the Starform). `cardId` = what was bought; `starform` = it was the Starform
 * (no body); `body` = the bought minion as it stands now (undefined for a spell, the Starform, or a body a triple
 * already consumed).
 * RE-PETE × FORTUNE: the running count; every `every`th buy opens a Discover of those cards (spells offered too, owner
 * 2026-10-02; up to 3 distinct ids, the pool Discover's draw), the pick locked in hand for `turns` turns.
 */
export function ancientOnBuy(state: RunState, cardId: string, starform: boolean, body: BoardCard | undefined): void {
  const a = live(state);
  if (!a) return;
  const rd = effectOf(state, 'buysDiscoverLocked');
  if (rd) {
    const win = [...(a.repeteBuys ?? []), cardId];
    if (win.length >= Math.max(1, rd.every)) {
      a.repeteBuys = [];
      // The Starform is a buy (it counts) but no card: it is never offered.
      const ids = [...new Set(win)].filter((id) => id !== STARFORM_ID);
      queueDiscover(state, { kind: 'pool', ids, spells: true, lockWave: state.wave + Math.max(1, rd.turns) });
    } else a.repeteBuys = win;
  }
  gorrOnBuy(state, a, cardId, starform, body);
}

// ── Gorr (Four Peat) hooks ───────────────────────────────────────────────────────────────────────────────────
/** GORR: the bodied minions bought on `wave` (cardIds, in buy order). */
export function gorrBuysOn(state: RunState, wave: number): string[] {
  return live(state)?.gorrBuys?.find((b) => b.wave === wave)?.ids ?? [];
}

/** GORR: minions bought this turn (the Starform included). */
function gorrMinionBuysThisTurn(state: RunState): number {
  const m = live(state)?.gorrMinionBuys;
  return m && m.wave === state.wave ? m.n : 0;
}

/** GORR: a plain copy of `cardId` to hand (the pool body with run-wide card buffs). Hand full, or not a minion: none. */
function gorrCopyToHand(state: RunState, cardId: string): BoardCard | undefined {
  const def = CARD_INDEX[cardId];
  if (!def || def.spell || state.hand.length >= handCap(state)) return undefined;
  return grantMinionToHandOrBoard(state, def, false);
}

/** A random element of `ids` off the run cursor (undefined when empty). */
function pickId(state: RunState, ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const rng = makeRng(state.rngCursor);
  const id = ids[rng.int(ids.length)];
  state.rngCursor = rng.state();
  return id;
}

/** GORR: the per-buy bookkeeping (always, while Ancients are on) and the buy-keyed pairings (Genesis, Bonds). */
function gorrOnBuy(state: RunState, a: AncientsState, cardId: string, starform: boolean, body: BoardCard | undefined): void {
  const def = CARD_INDEX[cardId];
  const minion = !!def && !def.spell && !def.ruby;
  if (minion) {
    const first = gorrMinionBuysThisTurn(state) === 0;
    a.gorrMinionBuys = { wave: state.wave, n: gorrMinionBuysThisTurn(state) + 1 };
    if (!starform) {
      const cur = gorrBuysOn(state, state.wave);
      a.gorrBuys = [...(a.gorrBuys ?? []).filter((b) => b.wave === state.wave - 1), { wave: state.wave, ids: [...cur, cardId] }];
    }
    // GENESIS: the first minion bought each turn also gives a plain copy (the Starform has no body to copy).
    if (first && !starform && effectOf(state, 'firstBuyExtraCopy')) gorrCopyToHand(state, cardId);
  }
  // BONDS: every `every`th card bought (any card) pays the minions among them, wherever they are now.
  const gb = effectOf(state, 'buysBuffImproves');
  if (gb) {
    const win = [...(a.gorrBondsWindow ?? []), body ? body.uid : null];
    if (win.length < Math.max(1, gb.every)) { a.gorrBondsWindow = win; return; }
    a.gorrBondsWindow = [];
    const x = a.gorrBondsGain ?? gb.amount;
    const targets = win.map((uid) => (uid ? state.board.find((c) => c.uid === uid) ?? state.hand.find((c) => c.uid === uid) : undefined))
      .filter((c): c is BoardCard => !!c);
    if (targets.length > 0 && x > 0) captureBuffFx(state, undefined, 'spell', () => { for (const c of targets) addBuff(c, ANCIENTS.bonds.name, x, x); });
    a.gorrBondsGain = x + gb.amount;
  }
}

/** GORR × FORTUNE: is the next minion buy free (Fortune picked, no minion bought yet this turn)? `offerBuyPrice` folds it
 *  into its `freeBuy` (still subject to the shared one-freebie-per-turn marker). */
export function ancientGorrFirstFree(state: RunState): boolean {
  return !!live(state) && !!effectOf(state, 'firstMinionFree') && gorrMinionBuysThisTurn(state) === 0;
}

/** GORR × DEATH: friendly deaths still needed for the next copy (the carried count plus `deaths` so far in the fight on
 *  screen). Null when Death is not picked. */
export function ancientGorrAvengeLeft(state: RunState, deaths = 0): number | null {
  const e = live(state) ? effectOf(state, 'avengeCopyLastTurnBuy') : undefined;
  if (!e) return null;
  const every = Math.max(1, e.every);
  return every - (((live(state)?.gorrDeaths ?? 0) + Math.max(0, deaths)) % every);
}

/** GORR × DEATH, Shop half: a friendly minion died in the Shop (`fireOnFriendDeath`, every Shop death path once). The
 *  running count ticks; each `every`th death gets a plain copy of a random minion bought last turn. */
export function ancientGorrShopDeath(state: RunState): void {
  const a = live(state);
  const e = a ? effectOf(state, 'avengeCopyLastTurnBuy') : undefined;
  if (!a || !e) return;
  a.gorrDeaths = ((a.gorrDeaths ?? 0) + 1) % Math.max(1, e.every);
  if (a.gorrDeaths !== 0) return;
  const id = pickId(state, gorrBuysOn(state, state.wave - 1));
  if (id) gorrCopyToHand(state, id);
}

/** GORR × TIME: is the End-of-Turn copy live (the `ancientGorrEotCopy` recurring entry)? */
export function ancientGorrEotCopyLive(state: RunState): boolean {
  return !!live(state) && !!effectOf(state, 'eotCopyThisTurnBuy');
}

/** GORR × TIME: End of Turn, a plain copy of a random minion bought this turn (none bought: nothing). */
export function ancientRunGorrEotCopy(state: RunState): void {
  if (!ancientGorrEotCopyLive(state)) return;
  const id = pickId(state, gorrBuysOn(state, state.wave));
  if (id) gorrCopyToHand(state, id);
}

