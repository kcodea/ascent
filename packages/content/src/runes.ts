import type { RuneDef } from '@game/core';
import { RuneDefSchema } from './schema';

/**
 * Runes — the Basic Runeforge stock (opened by the Runesmith hero on turn 5; the Epic Runeforge — via the
 * Runeguard hero on turn 8, or the Epic Commission quest — draws from EPIC_RUNES below). The forge offers a
 * random few of these; the player buys ONE
 * for its Gold `cost` and its `reward` applies for the rest of the run (no objective — it just takes effect).
 * Each rune reuses the quest `QuestReward` application engine (see `applyQuestReward`), so a rune's effect is a
 * reward: some reuse existing kinds (combatFlag / recurringEndOfTurn / grant), some use rune-only kinds.
 *
 * These are ONLY available in the Runeforge (never in the shop / Discover / quest pool).
 */
export const RUNES: RuneDef[] = [
  {
    // GIFTS (owner design 2026-08-26). Pays out IMMEDIATELY on purchase, then every 2 turns — the same
    // "don't make them wait a turn" convention Rune of the Gilded Spark and the Long Shift both use.
    id: 'rune_happy_birthday',
    name: 'Happy Birthday',
    cost: 2,
    text: 'Get a random **Gift**. Repeat every **2 turns**.',
    reward: { kind: 'runeHappyBirthday' },
  },
  {
    id: 'rune_spellslinging',
    name: 'Rune of Spellslinging',
    cost: 5,
    text: 'Every **5 Gold** spent, get a random Shop spell.',
    reward: { kind: 'runeSpellDrip', per: 5 },
  },
  {
    id: 'rune_warding',
    name: 'Rune of Warding',
    cost: 3,
    text: '**Start of Combat:** give your **right-most** minion **Ward** and **triple its Health**.',
    reward: { kind: 'combatFlag', flag: 'runeWarding' },
  },
  {
    id: 'rune_structure',
    name: 'Rune of Structure',
    cost: 3,
    text: 'After you play an **Attachment** from hand, get a random Shop spell.',
    reward: { kind: 'runeStructure' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    // Owner change 2026-07-31 (second pass): a KILL-COUNTER payoff, replacing the max-Gold-per-Slaughter
    // shape. Kills accumulate across combats; every 6th pays a minion of the board's dominant type.
    id: 'rune_slaying',
    name: 'Rune of Slaying',
    cost: 3,
    text: 'When you kill **6 enemies**, get a minion of your **most common type**.',
    reward: { kind: 'combatFlag', flag: 'runeSlaying' },
  },
  {
    // Cross-currency smuggling: each turn, the first Ruby pays an Ale and the first Ale pays a Ruby.
    id: 'rune_contraband',
    name: 'Rune of Contraband',
    cost: 6, // owner balance 2026-08-11
    text: 'The first **Ruby** you cast each turn gives you a random **Dwarven Ale**. The first **Dwarven Ale** you cast gives you a **Ruby**.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'runeContraband' },
    sets: ['set2'], // Rubies + Ales are set-2 currencies
  },
  {
    id: 'rune_spending',
    name: 'Rune of Spending',
    cost: 3,
    text: '**End of Turn:** give your left-most minion **+1/+2** for each Gold spent this turn.',
    reward: { kind: 'recurringEndOfTurn', effect: 'runeSpending' },
  },
  {
    id: 'rune_consumption',
    name: 'Rune of Consumption',
    cost: 4,
    text: 'Whenever you **Consume** Fodder, improve future Fodder by **+1 Attack** or **+1 Health** (random).',
    reward: { kind: 'runeConsume', attack: 1, health: 1 },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    // Owner 2026-08-20: ENABLED in every set (the `sets: ['set1']` gate is why it never appeared — set 1 is
    // `enabled: false`), and repriced 6 -> 4. Its Pillager is an out-of-set UNDEAD body; the owner accepted
    // that ("those minions won't be in the shop, but it's fine if they are given as rewards") — CARD_INDEX is
    // global, so the grant resolves. NOTE: the Gold-Pouch half is INERT outside set 1 (no `emberpouch` there).
    id: 'rune_pillaging',
    name: 'Rune of Pillaging',
    cost: 4,
    text: 'Get a **Pillager**. Your **Gold Pouches** are worth **2 Gold** for the rest of the run.',
    previewCards: ['emberpouch'], // text names it — the forge hover shows the card
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['pillager'] }, { kind: 'goldPouchValue', value: 2 }] },
  },
  {
    id: 'rune_fury',
    name: 'Rune of Fury',
    cost: 2, // owner balance 2026-08-04
    text: 'Your **Avenge** effects trigger twice.',
    reward: { kind: 'combatFlag', flag: 'runeFury' },
  },
  {
    id: 'rune_summoning',
    name: 'Rune of Summoning',
    cost: 4, // owner balance 2026-08-11
    text: 'Whenever you cast a Shop spell, improve your **Imp Aura** by **+2/+2**.',
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'runeSummoning' },
  },
  {
    id: 'rune_forthcoming',
    name: 'Rune of Forthcoming',
    cost: 2,
    text: '**Start of Combat:** your left-most minion attacks immediately and gains **Ward**.',
    reward: { kind: 'combatFlag', flag: 'runeForthcoming' },
  },
  // ── Moved into the Basic forge (2026-07-10 re-batch) ──
  {
    id: 'rune_rallying',
    name: 'Rune of Rallying',
    cost: 5,
    text: '**Start of Combat:** trigger your **left-most Rally** effect.',
    reward: { kind: 'combatFlag', flag: 'runeRallying' },
  },
  {
    // RENAMED from "Rune of Scale" (owner 2026-07-29): it sat one character from the epic "Rune of Scales", which
    // is a Dragon card — scales belong to Dragons, so the Gold-scaling rune is the one that moves. The ID is
    // deliberately unchanged: `ownedRunes` on saved runs stores ids, and renaming it would orphan them.
    id: 'rune_scale',
    name: 'Rune of Bulk Order',   // the owner re-confirmed Bulk Order over the sheet's "Scale" (2026-07-31)
    cost: 5,
    text: 'Every **5 Gold** you spend, give **3 random allies +3/+3**.',
    reward: { kind: 'runeScale', count: 3, attack: 3, health: 3, per: 5 },
  },
  {
    // Shares Runic Refrain's EoT primitive — a COPY to hand, not a recast (that is Rune of Recurrence).
    id: 'rune_recollection',
    name: 'Rune of Recollection',
    cost: 3,
    text: '**End of Turn:** get a **copy** of the first spell you cast this turn.',
    reward: { kind: 'recurringEndOfTurn', effect: 'copyFirstSpell' },
    sets: ['set2'],
  },
  {
    // Shares Open Tab's primitive (2 random Ales at End of Turn).
    id: 'rune_first_round',
    name: 'Rune of the First Round',
    cost: 5, // owner balance 2026-08-11
    text: '**End of Turn:** get **2 random Dwarven Ales**.',
    reward: { kind: 'recurringEndOfTurn', effect: 'grantAles' },
    sets: ['set2'], // Ales
  },
  {
    id: 'rune_chorus',
    name: 'Rune of the Chorus',
    cost: 3,
    text: 'When you trigger **4 Shouts**, get a random **Shop spell**.',
    reward: { kind: 'runeThreshold', meter: 'shout', per: 4, grantSpell: 1 },
  },
  {
    id: 'rune_overtime',
    name: 'Rune of Overtime',
    cost: 1,
    text: 'Every **15 Gold** you spend, get a random **Dwarven Ale**.',
    reward: { kind: 'runeThreshold', meter: 'gold', per: 15, grantAle: 1 },
    sets: ['set2'], // Ales
  },
  {
    id: 'rune_infernal_ink',
    name: 'Rune of Infernal Ink',
    cost: 3, // owner balance 2026-08-07
    // Owner rework 2026-08-19: EVERY cast (`per: 1`) rather than every third, at +1/+1. The `shop` buff target
    // writes `tavernBuyBonus`, which is the run-wide "minions in the Shop everywhere" the owner asked for —
    // every future roll inherits it, not just the row on screen.
    text: 'Whenever you cast a **Shop Spell**, give minions in the **Shop +1/+1**.',
    reward: { kind: 'runeThreshold', meter: 'spellCast', per: 1, buff: { target: 'shop', attack: 1, health: 1 } },
  },
  {
    id: 'rune_cindergem',
    name: 'Rune of the Cindergem',
    cost: 4,
    text: 'Every **3 Rubies** you cast, improve your **Imps by +4/+4**.',
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'runeThreshold', meter: 'castRuby', per: 3, buff: { target: 'imps', attack: 4, health: 4 } },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_showcase',
    name: 'Rune of the Showcase',
    cost: 3,
    // Owner 2026-08-11: the buff is now PERMANENT (accumulates on the right-most slot across refreshes, like
    // Market Tormentor) rather than decorating only the current row. See the shopRightmost branch in payRuneThreshold.
    text: 'When you spend **10 Gold**, give the **right-most minion** in the Shop **+4/+4 permanently**.',
    reward: { kind: 'runeThreshold', meter: 'gold', per: 10, buff: { target: 'shopRightmost', attack: 4, health: 4 } },
  },
  {
    // `oncePerTurn` is the whole difference from the Chorus — a Shout-heavy turn pays once, not four times.
    id: 'rune_merchants_chorus',
    name: "Rune of the Merchant's Chorus",
    cost: 3,
    // Owner rework 2026-08-19: EVERY Shout (`per: 1`) grants +3/+3, and the grant is scoped to THIS TURN —
    // the `shopTurn` target banks it in `tavernBuyBonusTurn`, which accumulates across every roll you make this
    // turn (so a Shout-heavy turn really does spike the row) and is wiped at the rollover. Deliberately NOT the
    // `shop` target: that one is permanent, which is what the rune used to be.
    text: 'When you trigger a **Shout**, give minions in the **Shop +3/+3** for this turn.',
    reward: { kind: 'runeThreshold', meter: 'shout', per: 1, buff: { target: 'shopTurn', attack: 3, health: 3 } },
  },
  {
    // Pure data — `rallyRepeat`/`firstEachCombat` already exists (Spark Permit, Overclocked Core).
    id: 'rune_stampede',
    name: 'Rune of the Stampede',
    cost: 5, // owner balance 2026-08-11
    text: 'Your **first** friendly **Rally** each combat triggers **twice**.',
    reward: { kind: 'rallyRepeat', scope: 'firstEachCombat' },
  },
  {
    id: 'rune_hatchery',
    name: 'Rune of the Hatchery',
    cost: 4,
    text: 'Minions summoned in **combat** have **+3/+3** and **Taunt**.', // owner rework 2026-08-03 (was Echo-only)
    reward: { kind: 'combatFlag', flag: 'runeHatchery' },
  },
  {
    // Reworked 2026-08-06 (owner): first TWO Rubies each turn double, 2 Rubies per turn, and buying it pays
    // the first 2 Rubies immediately (the recurringEndOfTurn Ruby effects fire once on purchase).
    id: 'rune_resonance',
    name: 'Rune of Resonance',
    cost: 3,
    text: 'Your **first 2 Rubies** played from hand each turn cast an **extra time**. Get **2 Rubies** every turn.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'multi', rewards: [{ kind: 'rubyExtraCasts', amount: 1, scope: 'firstEachTurn', firstN: 2 }, { kind: 'recurringEndOfTurn', effect: 'grantRuby2' }] },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_investment',
    name: 'Rune of Investment',
    cost: 3, // owner balance 2026-08-04
    text: 'Get **2 Rubies** when you **sell 2 minions**.',
    previewCards: ['ruby'], // names Rubies — forge hover shows the live Ruby (audit 2026-08-06)
    reward: { kind: 'runeSellRubies', count: 2 },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_last_call',
    name: 'Rune of Last Call',
    cost: 2, // owner balance 2026-08-11 (1 → 2)
    text: '**Avenge (4):** get **2 random Dwarven Ales**.', // owner 2026-08-11 (was Avenge 3 / 1 Ale)
    reward: { kind: 'combatFlag', flag: 'runeLastCall' },
    sets: ['set2'], // Ales
  },
  {
    id: 'rune_hunger',
    name: 'Rune of Hunger',
    cost: 5, // owner balance 2026-08-04
    text: '**End of Turn:** your **left-most Demon** Consumes the **right-most Shop** minion.',
    reward: { kind: 'recurringEndOfTurn', effect: 'demonEatsRightmostShop' },
    sets: ['set2'], // Consuming Shop minions is a set-2 Demon mechanic
  },
  {
    id: 'rune_blood_and_coin',
    name: 'Rune of Blood and Coin',
    cost: 3,
    text: '**Avenge (5):** gain **3 Gold** next turn.', // owner 2026-08-11 (was every 4 deaths / 4 Gold)
    reward: { kind: 'combatFlag', flag: 'runeBloodAndCoin', amount: 3 },
  },
  {
    // Pays ONCE at settle rather than per summon, so the Shop sees one combined buff instead of a drip.
    id: 'rune_reinvestment',
    name: 'Rune of Reinvestment',
    cost: 5,
    // TEXT fix only (owner 2026-07-31): the buff always landed on `tavernBuyBonus` — the PERMANENT run-wide
    // shop channel — so "the next Shop" under-sold what the rune actually does.
    text: 'After combat, permanently give the **Shop +1/+1** for every friendly minion you summoned during combat.',
    reward: { kind: 'combatFlag', flag: 'runeReinvestment', amount: 1 },
  },
  {
    id: 'rune_hunting_bell',
    name: 'Rune of the Hunting Bell',
    cost: 4,
    text: '**Avenge (3):** trigger your **left-most Rally**.',
    reward: { kind: 'combatFlag', flag: 'runeHuntingBell' },
  },
  {
    // Bounded per combat: unbounded, a slot refills the instant it empties and the board can never shrink.
    id: 'rune_brood',
    name: 'Rune of the Brood',
    cost: 3,
    text: 'When you have **space** in combat, summon an **Imp** with **Ward** and **Taunt**. **2 times** per combat.',
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeBrood', amount: 2 }, // owner balance 2026-08-11 (3 → 2)
  },
  {
    id: 'rune_war_chorus',
    name: 'Rune of the War Chorus',
    cost: 3,
    text: 'Your **first Rally** each combat triggers your **left-most Shout**.',
    reward: { kind: 'combatFlag', flag: 'runeWarChorus' },
  },
  {
    // Owner add 2026-08-02. A cheap tempo rune for spell builds: the shop-buff cast pays twice.
    id: 'rune_distillation',
    name: 'Rune of Distillation',
    cost: 2,
    text: 'Spells cast on **Shop minions** also cast on your **left-most** minion.',
    sets: ['set2'], // casting on shop offers is a set-2 pattern (Rubies / offer-targeted spells)
    reward: { kind: 'runeDistillation' },
  },
  {
    id: 'rune_facetwright',
    name: 'Rune of Facetwright',
    cost: 4,
    // Owner fix 2026-08-02: the FIRST copy lands the moment the rune is bought (the plain `grant` up front) —
    // it used to arrive only at the first recurring payout. And the recurring grant fires at END of turn
    // (`recurringEndOfTurn`), which the old text mis-stated as "start of every turn".
    text: "Get a **Facetwright's Choice**. Repeats at **end of turn**. They give **both** effects.",
    previewCards: ['facetwright'], // text names it — the forge hover shows the card
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['facetwright'] }, { kind: 'runeFacetwright' }, { kind: 'recurringEndOfTurn', effect: 'grantFacetwright' }] },
    sets: ['set2'], // Facetwright's Choice is a set-2 spell
  },
  {
    // Owner ruling 2026-07-30: only offered when the rune system is on, and an Epic forge is then guaranteed —
    // so this is never a dead pick.
    id: 'rune_duplication',
    name: 'Rune of Duplication',
    cost: 4,
    text: 'After you forge your **Epic Rune**, this transforms into a **copy of it**.',
    reward: { kind: 'runeDuplication' },
  },
  {
    id: 'rune_action',
    name: 'Rune of Action',
    cost: 5, // owner balance 2026-08-11
    text: '**End of Turn:** give your **three left-most minions +1/+1** for each card you played this turn.',
    reward: { kind: 'recurringEndOfTurn', effect: 'runeAction' },
  },
  {
    id: 'rune_epic_forge',
    name: 'Rune of the Epic Forge',
    cost: 4, // owner balance 2026-08-11
    // An EARLY epic forge: turn 8, one turn ahead of the systemic turn-9 visit (owner 2026-07-31). A
    // schedule to wave 9 itself would do nothing — the baseline already sets the same boolean there.
    text: 'Visit an **additional Epic Forge** on turn 8.',
    reward: { kind: 'scheduleRuneforge', forge: 'epic', onWave: 8 },
  },
  {
    id: 'rune_kindling',
    name: 'Rune of Kindling',
    cost: 4, // owner balance 2026-08-07
    text: 'Whenever you cast a Shop spell, give your **left and right-most minions +4/+6**.', // owner balance 2026-08-19
    reward: { kind: 'runeKindling' },
  },
  {
    id: 'rune_pair',
    name: 'Rune of the Pair',
    cost: 5,
    text: 'Get **2 random Tier 4 minions**.',
    reward: { kind: 'grant', randomTier: 4, randomCount: 2 },
  },
  {
    id: 'rune_menagerie',
    name: 'Rune of the Menagerie',
    cost: 5,
    // PER-SET line-up (owner ruling 2026-07-29). One rune per set, each `sets`-scoped, because the tribes a
    // Menagerie can grant only exist in one set: asking a set-2 run for Mech/Undead granted NOTHING, and the
    // reverse would be just as dead. Same id prefix, different ids, so `ownedRunes` stays unambiguous.
    text: 'Get a random **Beast, Demon, Dragon, Mech, and Undead**.',
    sets: ['set1'],
    reward: { kind: 'multi', rewards: [
      { kind: 'grant', randomTribe: 'beast', randomCount: 1 },
      { kind: 'grant', randomTribe: 'demon', randomCount: 1 },
      { kind: 'grant', randomTribe: 'dragon', randomCount: 1 },
      { kind: 'grant', randomTribe: 'mech', randomCount: 1 },
      { kind: 'grant', randomTribe: 'undead', randomCount: 1 },
    ] },
  },
  {
    // The set-2 twin of the Menagerie — same shape, this set's tribes.
    id: 'rune_menagerie_set2',
    name: 'Rune of the Menagerie',
    cost: 5,
    text: 'Get a random **Beast, Demon, Dragon, Kobold, and Dwarf**.',
    sets: ['set2'],
    reward: { kind: 'multi', rewards: [
      { kind: 'grant', randomTribe: 'beast', randomCount: 1 },
      { kind: 'grant', randomTribe: 'demon', randomCount: 1 },
      { kind: 'grant', randomTribe: 'dragon', randomCount: 1 },
      { kind: 'grant', randomTribe: 'kobold', randomCount: 1 },
      { kind: 'grant', randomTribe: 'dwarf', randomCount: 1 },
    ] },
  },
  // ── Set 2 rune batch (owner roster 2026-07-29) — the GRANT-shaped ones, which need no new reward kind. ──
  {
    // Rubies are ordinary Set 2 cards, so "get 5 Rubies" is a plain card grant.
    id: 'rune_gemcutting',
    name: 'Rune of Gemcutting',
    cost: 1, // 4 → 1 (owner 2026-08-02)
    // Owner sheet 2026-07-31: SEVEN Rubies minted at a fixed 3/3, not the run's 1/1+bonus line.
    text: 'Get **5 Rubies** that give **+3/+3**.',
    previewCards: ['ruby'], // names Rubies — forge hover shows the live Ruby (audit 2026-08-06)
    reward: { kind: 'mintRubies', count: 5, attack: 3, health: 3 },
    sets: ['set2'], // Rubies / Ales / set-2 cards
  },
  // ── Batch 1 additions (grants / discovers / economy — no new combat mechanics) ──
  {
    id: 'rune_small_fortune',
    name: 'Rune of Small Fortune',
    cost: 3,
    text: 'Get **7 Gold** immediately.',
    reward: { kind: 'gainGold', amount: 7, immediate: true },
  },
  {
    // Owner rebalance 2026-08-02: BOUNDED to 2 turns (it recurred for the whole run). `turns` on the reward
    // is the general mechanism — see `questRecurringLimited`.
    id: 'rune_quick_study',
    name: 'Rune of Quick Study',
    cost: 6, // owner balance 2026-08-11
    text: 'Get a **Gold Font** and **2 random spells** at End of Turn, for the **next 2 turns**.',
    previewCards: ['manafont'], // text names it — the forge hover shows the card
    reward: { kind: 'recurringEndOfTurn', effect: 'quickStudy', turns: 2 },
  },
  {
    // The BASIC route to Tier 7 (Summit is parked, so no rift grants it). Every 2nd shop, Discover a Tier 7
    // minion — the reward's tier is AUTHORED, so the reducer honours it rather than clamping to the run's
    // ceiling. Repeats for the rest of the run.
    id: 'rune_summit',
    name: 'Rune of the Summit',
    cost: 3, // owner balance 2026-08-11
    text: '**In 3 turns:** **Discover** a **Tier 7** minion. Repeats every **3 turns**.',
    reward: { kind: 'runeSummit' },
  },
  {
    id: 'rune_scout',
    name: 'Rune of the Scout',
    cost: 3,
    text: '**Discover** a **Tier 5** minion.',
    reward: { kind: 'discover', tier: 5 },
  },
  {
    id: 'rune_spare_parts',
    name: 'Rune of Spare Parts',
    cost: 2,
    text: 'Get **5 random Attachments**.',
    reward: { kind: 'grant', randomFilter: 'attachment', randomFilterCount: 5 },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    id: 'rune_bartering',
    name: 'Rune of Bartering',
    cost: 6, // owner balance 2026-08-11
    text: '**Shout** minions sell for **2 Gold**.',
    reward: { kind: 'runeBartering' },
  },
  {
    id: 'rune_packcraft',
    name: 'Rune of Packcraft',
    cost: 2,
    text: 'Minions you summon in combat have **+6/+6**.',
    reward: { kind: 'combatFlag', flag: 'runePackcraft' },
  },
  {
    id: 'rune_salvage',
    name: 'Rune of Salvage',
    cost: 1,
    text: 'Whenever a friendly **Mech loses Ward**, get a random **Attachment** next shop.',
    reward: { kind: 'combatFlag', flag: 'runeSalvage' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    id: 'rune_warden',
    sets: ['set1'],
    name: 'Rune of the Warden',
    cost: 5,
    text: 'Get a **Spear Warden**. When you have room in combat, summon a **Spear Warden**.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['knit'] }, { kind: 'combatFlag', flag: 'runeWarden' }] },
  },
  // ── Batch 7a additions (owner designs 2026-07-17) ──
  {
    // Owner sheet 2026-07-31: ONE random minion gains the exact-copy Echo (was: 2 random gain Rise — the
    // same Rise-vs-exact-copy distinction Living Treasure hit; Rise returns the printed body).
    id: 'rune_rebirth',
    name: 'Rune of Rebirth',
    cost: 3, // owner balance 2026-08-11
    text: '**Start of Combat:** give a random friendly minion **Echo:** summon an exact copy of this without Echo.',
    reward: { kind: 'combatFlag', flag: 'runeRebirth' },
  },
  {
    id: 'rune_tempering',
    name: 'Rune of Tempering',
    cost: 4,
    text: 'The first **Attachment** you play each turn also gives that minion **Ward**.',
    reward: { kind: 'runeTempering' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    id: 'rune_aftershocks',
    name: 'Rune of Aftershocks',
    cost: 4,
    text: 'Triggering an **Echo** gives your minions **+4/+4** this combat.',
    reward: { kind: 'combatFlag', flag: 'runeAftershocks' },
  },
  {
    id: 'rune_refrain',
    name: 'Rune of Refrain',
    cost: 3, // owner balance 2026-08-07
    text: 'Your **Shout** minions have a **25%** chance to return to your hand after you play them.',
    reward: { kind: 'runeRefrain' },
  },
  {
    id: 'rune_trophy',
    name: 'Rune of the Trophy',
    cost: 3, // owner balance 2026-08-07
    text: 'Get a copy of the first minion you **kill** in combat.',
    reward: { kind: 'combatFlag', flag: 'runeTrophy' },
  },
  // ── the 2026-08-07 owner batch (16 Basic runes) ──
  {
    id: 'rune_coffers',
    name: 'Rune of the Coffers',
    cost: 5,
    text: '**End of Turn:** increase your **maximum Gold** by **1**.',
    reward: { kind: 'runeCoffers' },
  },
  {
    id: 'rune_vault',
    name: 'Rune of the Vault',
    cost: 2,
    text: 'When you reach **Shop Tier 5**, gain **10 Gold**.',
    reward: { kind: 'runeVault' },
  },
  {
    // Immediate, destructive on purpose: the whole board cashes out at a premium. The sell goes through the
    // real sell path so on-sell effects (Voicekeeper, sell-value cards) behave exactly as a manual sell.
    id: 'rune_altar',
    name: 'Rune of the Altar',
    cost: 1,
    text: 'Sell your **entire board**. Gain **3 Gold** for each minion sold.',
    reward: { kind: 'runeAltar', goldPer: 3 },
  },
  {
    id: 'rune_lorekeeping',
    name: 'Rune of Lorekeeping',
    cost: 3, // owner balance 2026-08-11
    text: 'Whenever you cast a **Shop spell on a minion**, give it an extra **+4/+4**.',
    reward: { kind: 'runeLorekeeping' },
  },
  {
    id: 'rune_thrift',
    name: 'Rune of Thrift',
    cost: 3,
    text: 'Shop spells that **give stats** cost **2 less**.',
    reward: { kind: 'runeThrift' },
  },
  {
    id: 'rune_engraving',
    name: 'Rune of Engraving',
    cost: 3,
    text: '**Avenge (3):** your **Rubies** permanently give **+1 more Health**.',
    previewCards: ['ruby'],
    reward: { kind: 'combatFlag', flag: 'runeEngraving' },
    sets: ['set2'], // Rubies
  },
  {
    // A STANDING shop aura that improves every 4th refresh. It first shipped on `shopBuffOnRefresh` — whose
    // comment above claimed "base +A/+H on every offer" but whose engine (Endless Inventory's) grants a NEW
    // permanent +2/+2 on EVERY refresh — so the rune compounded ~5× its printed text (owner report 2026-08-21).
    id: 'rune_wheel',
    name: 'Rune of the Wheel',
    cost: 4,
    text: 'Minions in the **Shop** have **+2/+2**. Improves every **4 refreshes**.',
    reward: { kind: 'shopAuraGrowing', attack: 2, health: 2, step: 2, per: 4 },
  },
  {
    id: 'rune_flagship',
    name: 'Rune of the Flagship',
    cost: 3,
    text: 'Whenever you cast a **Shop spell**, give your **Dwarves +2/+2**.',
    reward: { kind: 'runeFlagship' },
    sets: ['set2'], // Dwarves
  },
  {
    id: 'rune_brew',
    name: 'Rune of the Brew',
    cost: 4,
    text: 'Whenever you **spend Gold**, give a friendly **Dwarf +4/+3**.',
    reward: { kind: 'runeBrew' },
    sets: ['set2'], // Dwarves
  },
  {
    id: 'rune_underdog',
    name: 'Rune of the Underdog',
    cost: 4,
    text: '**Start of Combat:** double the stats of your **two lowest-Attack** minions.',
    reward: { kind: 'combatFlag', flag: 'runeUnderdog' },
  },
  {
    id: 'rune_top_hat',
    name: 'Rune of the Top Hat',
    cost: 3,
    text: 'Get **two random minions** each from **Tiers 1, 2, and 3**.',
    reward: { kind: 'multi', rewards: [
      { kind: 'grant', randomTier: 1, randomCount: 2 },
      { kind: 'grant', randomTier: 2, randomCount: 2 },
      { kind: 'grant', randomTier: 3, randomCount: 2 },
    ] },
  },
  {
    id: 'rune_evolution',
    name: 'Rune of Evolution',
    cost: 3,
    text: 'Transform your minions into random **Tier 4** minions.',
    reward: { kind: 'runeEvolution', tier: 4 },
  },
  {
    id: 'rune_transcription',
    name: 'Rune of Transcription',
    cost: 4,
    text: 'The next **2 minions** you buy each come with a **free extra copy**.',
    reward: { kind: 'runeTranscription', count: 2 },
  },
  {
    id: 'rune_treasure_map',
    name: 'Rune of the Treasure Map',
    cost: 2,
    text: 'In **2 turns**, gain **10 Gold**.',
    reward: { kind: 'runeTreasureMap', turns: 2, gold: 10 },
  },
  {
    id: 'rune_golden_splinter',
    name: 'Rune of the Golden Splinter',
    cost: 3,
    text: 'When you have **15 Gold**, get a random **Golden Tier 5** minion. Once per run.',
    reward: { kind: 'runeGoldenSplinter', at: 15, tier: 5 },
  },
  // ── the 2026-08-07 owner batch 4 (tranche 1: the pattern-reuse nine) ──
  {
    // Reuses the threshold engine with a new `consume` meter.
    id: 'rune_empty_plate',
    name: 'Rune of the Empty Plate',
    cost: 2, // owner balance 2026-08-11
    text: 'After you **Consume 3 Shop minions**, get a random **Shop spell**.',
    reward: { kind: 'runeThreshold', meter: 'consume', per: 3, grantSpell: 1 },
  },
  {
    // Threshold again, with the new next-turn Gold payout. Per the sheet the window is a TURN, so the meter
    // resets each turn rather than banking a remainder across them.
    id: 'rune_gem_dividend',
    name: 'Rune of the Gem Dividend',
    cost: 3,
    text: 'After you cast **5 Rubies** in a turn, gain **3 Gold** next turn.',
    previewCards: ['ruby'],
    reward: { kind: 'runeThreshold', meter: 'castRuby', per: 5, grantGoldNextTurn: 3, resetEachTurn: true },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_carrion_coin',
    name: 'Rune of Carrion Coin',
    cost: 3,
    text: '**Avenge (4):** get a random **Shop spell**.',
    reward: { kind: 'combatFlag', flag: 'runeCarrionCoin', amount: 4 },
  },
  {
    id: 'rune_five_banners',
    name: 'Rune of the Five Banners',
    cost: 4,
    text: '**Start of Combat:** give one friendly minion of **each type +6/+6**.',
    reward: { kind: 'combatFlag', flag: 'runeFiveBanners' },
  },
  {
    id: 'rune_centerline',
    name: 'Rune of the Centerline',
    cost: 3,
    text: '**Start of Combat:** if your **end minions** have different types, give your **middle** minion **Ward** and **Critical Strike**.',
    reward: { kind: 'combatFlag', flag: 'runeCenterline' },
  },
  {
    id: 'rune_second_litter',
    name: 'Rune of the Second Litter',
    cost: 2, // owner balance 2026-08-11
    text: 'The first **Beast** summoned each combat summons **another copy**.',
    reward: { kind: 'combatFlag', flag: 'runeSecondLitter' },
  },
  {
    id: 'rune_shared_pour',
    name: 'Rune of Shared Pour',
    cost: 3, // owner balance 2026-08-11
    text: 'Your first **Dwarven Ale** each turn casts an **additional time**.',
    reward: { kind: 'runeSharedPour' },
    sets: ['set2'], // Ales
  },
  {
    id: 'rune_aftermarket',
    name: 'Rune of the Aftermarket',
    cost: 4,
    text: 'The first minion you **sell** each turn gives **half its stats** to the **right-most** minion in the current **Shop**.', // owner 2026-08-11
    reward: { kind: 'runeAftermarket' },
  },
  {
    id: 'rune_hoardcalling',
    name: 'Rune of Hoardcalling',
    cost: 4, // owner balance 2026-08-11
    text: 'After your first **Dragon Shout** each turn, get a random **Shop spell**.',
    reward: { kind: 'runeHoardcalling' },
  },

  // ── the 2026-08-07 owner batch 4 (tranche 3: the contained-machinery eight) ──
  {
    id: 'rune_emberline',
    name: 'Rune of Emberline',
    cost: 3,
    text: 'The first **Imp** that dies each combat gives its stats to the next Imp you summon.',
    previewCards: ['impscrap'],
    reward: { kind: 'combatFlag', flag: 'runeEmberline' },
  },
  {
    id: 'rune_ashen_payroll',
    name: 'Rune of Ashen Payroll',
    cost: 4,
    // Owner 2026-08-11: per-Imp payout, no threshold and no once-per-combat cap. `amount` stays only to arm the
    // flag truthily — the settle handler now pays 1 Gold for EACH Imp summoned (see reducer runeAshenPayroll).
    text: 'Gain **1 Gold** next turn for each **Imp** you summon in combat.',
    previewCards: ['impscrap'],
    reward: { kind: 'combatFlag', flag: 'runeAshenPayroll', amount: 1 },
  },
  {
    id: 'rune_backbeat',
    name: 'Rune of Backbeat',
    cost: 4,
    text: 'The first **Echo** you trigger each combat triggers your left-most **Rally**.',
    reward: { kind: 'combatFlag', flag: 'runeBackbeat' },
  },
  {
    id: 'rune_spare_chair',
    name: 'Rune of the Spare Chair',
    cost: 4,
    text: 'If you begin combat with exactly **6 minions**, the first minion you summon gains **Ward** and attacks immediately.',
    reward: { kind: 'combatFlag', flag: 'runeSpareChair' },
  },
  {
    id: 'rune_spellmarket',
    name: 'Rune of the Spellmarket',
    cost: 4,
    text: 'The first stat-granting **Shop spell** you cast on a friendly minion each turn also gives its stats to the right-most **Shop** minion.',
    reward: { kind: 'runeSpellmarket' },
  },
  {
    id: 'rune_last_word',
    name: 'Rune of the Last Word',
    cost: 4,
    text: 'The first **Dragon** with a **Shout** you sell each turn triggers its Shout before being sold.',
    reward: { kind: 'runeLastWord' },
  },
  {
    id: 'rune_runic_hoard',
    name: 'Rune of the Runic Hoard',
    cost: 4,
    text: 'After you add a copy of a **Shop spell** to your hand, give your **Dragons +1/+1**.',
    reward: { kind: 'runeRunicHoard' },
  },

  // ── the 2026-08-07 owner card-keyed batch (all Set 2 — each names a Set-2 card) ──
  {
    id: 'rune_full_measure',
    name: 'Rune of Full Measure',
    cost: 4,
    // Owner 2026-08-11: now also HANDS OVER a Baby Gastrid, on top of the Attack-symmetry effect.
    text: 'Get a **Baby Gastrid**. Your **Baby Gastrids** also grant **Attack** equal to the Health they grant.',
    previewCards: ['dw_dorrin'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['dw_dorrin'] }, { kind: 'runeFullMeasure' }] },
    sets: ['set2'],
  },
  {
    id: 'rune_mountain_trade',
    name: 'Rune of Mountain Trade',
    cost: 5,
    // Owner 2026-08-11: full rework — a "cards played" threshold that showers the board with a Ruby every 6.
    // Uses the runeThreshold engine's new `cardsPlayed` meter (see advanceRuneThresholds / applyCardsPlayed).
    text: 'After you play **6 cards**, cast a **Ruby** on your minions.',
    previewCards: ['ruby'],
    reward: { kind: 'runeThreshold', meter: 'cardsPlayed', per: 6, rubyAll: true },
    sets: ['set2'],
  },
  {
    id: 'rune_open_appetite',
    name: 'Rune of Open Appetite',
    cost: 5,
    // Owner 2026-08-11: now also HANDS OVER an Appetite Agent, on top of the any-type targeting.
    text: 'Get an **Appetite Agent**. Your **Appetite Agents** can target a minion of **any type**.',
    previewCards: ['dm_agent'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['dm_agent'] }, { kind: 'runeOpenAppetite' }] },
    sets: ['set2'],
  },

  {
    id: 'rune_unbroken_vein',
    name: 'Rune of the Unbroken Vein',
    cost: 5,
    // Owner 2026-08-11: now also HANDS OVER a Veinbreaker, on top of the both-effects grant.
    text: 'Get a **Veinbreaker**. Your **Veinbreakers** give **both** Choose One effects.',
    previewCards: ['k_veinbreaker'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['k_veinbreaker'] }, { kind: 'runeUnbrokenVein' }] },
    sets: ['set2'],
  },
  // ── Aug-11 minion-grant runes (Basic) ──
  {
    id: 'rune_display_case',
    name: 'Rune of the Display Case',
    cost: 4,
    text: 'Get a **Market Tormentor**. Your **Market Tormentors** also enchant the **left-most** Shop slot.',
    previewCards: ['dm_tormentor'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['dm_tormentor'] }, { kind: 'runeDisplayCase' }] },
    sets: ['set2'],
  },
  {
    id: 'rune_living_geode',
    name: 'Rune of the Living Geode',
    cost: 4,
    text: 'Get a **Geode Guardian**. **Gemheart Golems** summoned by your **Geode Guardians** have **Ward**.',
    previewCards: ['k_geode', 'gemheart-shard'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['k_geode'] }, { kind: 'combatFlag', flag: 'runeLivingGeode' }] },
    sets: ['set2'],
  },
  // ── Aug-11 economy runes (Basic) ──
  {
    id: 'rune_open_enrollment',
    name: 'Rune of Open Enrollment',
    cost: 5,
    text: 'After you **Refresh**, the Shop offers an additional minion of your **most common type**.',
    reward: { kind: 'runeOpenEnrollment' },
  },
  {
    id: 'rune_strange_caravan',
    name: 'Rune of the Strange Caravan',
    cost: 3,
    text: '**Start of Turn:** get a random minion from a type you **do not control**.',
    reward: { kind: 'runeStrangeCaravan' },
  },
  {
    id: 'rune_lassoing',
    name: 'Rune of Lassoing',
    cost: 2,
    text: '**End of Turn:** Cast **Lasso** and grant a random friendly minion **+2/+2**.',
    previewCards: ['lasso'],
    reward: { kind: 'recurringEndOfTurn', effect: 'lassoing' },
  },
  {
    id: 'rune_restocking',
    name: 'Rune of Restocking',
    cost: 3,
    text: 'The first minion you **buy** each turn refills its Shop slot with a minion of the same **Tier** that costs **2 Gold**.',
    reward: { kind: 'runeRestocking' },
  },
  {
    id: 'rune_trade_in',
    name: 'Rune of Trade-In',
    cost: 2,
    text: 'After you **sell** your first minion each turn, your next minion of that **type** costs **1 less**.',
    reward: { kind: 'runeTradeIn' },
  },
  {
    id: 'rune_window_shopping',
    name: 'Rune of Window Shopping',
    cost: 3,
    text: 'Your first **3 Refreshes** each turn are **free**.',
    reward: { kind: 'runeWindowShopping' },
  },
  {
    id: 'rune_fresh_pages',
    name: 'Rune of Fresh Pages',
    cost: 3,
    text: 'Discover a **Shop Spell**. Repeat at **Start of Turn**.',
    reward: { kind: 'runeFreshPages' },
  },
  {
    id: 'rune_collector',
    name: 'Rune of the Collector',
    cost: 4,
    text: 'After you buy cards from **3 different types** in a turn, **Discover** a minion from one of those types. Once per turn.',
    reward: { kind: 'runeCollector' },
  },
  {
    id: 'rune_shopkeep',
    name: 'Rune of Shopkeep',
    cost: 5,
    text: "Reduce your Shop's **upgrade cost** by **3**. **End of Turn:** repeat this.",
    reward: { kind: 'runeShopkeep' },
  },
  {
    // Owner rework 2026-08-19: no longer a resummon — triggering a Beast's Echo banks a FREE REFRESH. Read in
    // `simulate` at the `asEcho` chokepoint, so a forced Echo (Hawkus / Spots / the Reliquary) pays too.
    id: 'rune_burrow',
    name: 'Rune of the Burrow',
    cost: 1, // owner rework 2026-08-19
    text: "Whenever you trigger a **Beast's Echo**, get a **free refresh**.",
    reward: { kind: 'combatFlag', flag: 'runeBurrow' },
  },

  // ── 2026-08-19 owner rune batch: BASIC ────────────────────────────────────────────────────────────────
  {
    id: 'rune_refraction',
    name: 'Rune of Refraction',
    cost: 4,
    text: 'Get a **Reflector**.',
    previewCards: ['n2_reflector'],
    reward: { kind: 'grant', cards: ['n2_reflector'] },
    sets: ['set2'],
  },
  {
    // NB: Resonance Idol is ARCHIVED (owner call 2026-08-19) — it is out of the draw pool, so this rune is the
    // ONLY way to obtain one. Deliberate, and the exception to the archive rule in `cards/archive.ts` that a
    // reward must not name an archived id: here the reward IS the point. Archived cards still resolve through
    // `CARD_INDEX`, so the grant works.
    id: 'rune_ruby_resonance',
    name: 'Rune of Ruby Resonance',
    cost: 3,
    text: 'Get a **Resonance Idol**.',
    previewCards: ['k_resonance'],
    reward: { kind: 'grant', cards: ['k_resonance'] },
    sets: ['set2'],
  },
  {
    id: 'rune_basic_dwarf',
    name: 'Rune of Basic Dwarves',
    cost: 3,
    text: 'Get a **Dwarve**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'dwarf', count: 1 },
    sets: ['set2'],
  },
  {
    id: 'rune_basic_dragon',
    name: 'Rune of Basic Dragons',
    cost: 3,
    text: 'Get a **Dragon**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'dragon', count: 1 },
    sets: ['set2'],
  },
  {
    id: 'rune_basic_beast',
    name: 'Rune of Basic Beasts',
    cost: 3,
    text: 'Get a **Beast**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'beast', count: 1 },
    sets: ['set2'],
  },
  {
    id: 'rune_basic_demon',
    name: 'Rune of Basic Demons',
    cost: 3,
    text: 'Get a **Demon**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'demon', count: 1 },
    sets: ['set2'],
  },
  {
    id: 'rune_basic_kobold',
    name: 'Rune of Basic Kobolds',
    cost: 3,
    text: 'Get a **Kobold**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'kobold', count: 1 },
    sets: ['set2'],
  },
  {
    // The multicast rides `runeSpellDouble`, which `spellCasts` reads — so the card's x N badge shows the
    // doubled count while the rune is armed, rather than the rune being invisible until you cast.
    id: 'rune_hoardflame',
    name: 'Rune of Hoardflame',
    cost: 2,
    text: 'Get a **Hoardflame**. Repeat every **Start of Turn**. They cast **twice**.',
    previewCards: ['hoardflame'],
    reward: { kind: 'multi', rewards: [{ kind: 'recurringGrant', cards: ['hoardflame'] }, { kind: 'runeSpellDouble', spellId: 'hoardflame' }] },
  },
  {
    id: 'rune_glider',
    name: 'Rune of the Glider',
    cost: 1,
    text: 'Whenever you play a card, give a **Dragon +4/+4**.',
    reward: { kind: 'runeGlider', attack: 4, health: 4 },
  },
  {
    // `shoutEdgeBuff` already existed in the engine with no rune using it — this is its first consumer.
    id: 'rune_drake_skull',
    name: 'Rune of the Drake Skull',
    cost: 3,
    text: 'Whenever you trigger a **Shout**, give your **left and right-most minions +5/+5**.',
    reward: { kind: 'shoutEdgeBuff', attack: 5, health: 5 },
  },
  {
    id: 'rune_catacomb',
    name: 'Rune of the Catacomb',
    cost: 3,
    text: 'Discover an **Echo** minion. Your first **Echo** triggered in combat triggers **twice**.',
    reward: { kind: 'multi', rewards: [{ kind: 'discover', filter: 'deathrattle' }, { kind: 'echoRepeat', scope: 'firstEachCombat' }] },
  },
  {
    id: 'rune_pendant',
    name: 'Rune of the Pendant',
    cost: 3,
    text: '**Start of Turn:** make a random friendly minion **Tier 4 or below Gilded**.',
    reward: { kind: 'runePendant', maxTier: 4 },
  },
  {
    // `scheduleRuneforge` carries the Gold, so this is one reward rather than a `multi`. `onWave` is resolved
    // at acquire time as "next turn" — see the reducer branch — which is what MOVES the Epic forge earlier
    // rather than adding a second one.
    id: 'rune_ornate_clock',
    name: 'Rune of the Ornate Clock',
    cost: 2,
    text: 'Gain **2 Gold**. Visit the **Epic Runeforge** next turn instead of turn 9.',
    reward: { kind: 'scheduleRuneforge', forge: 'epic', gold: 2 },
  },

  // ── 2026-08-19 owner rune batch (second wave) ─────────────────────────────────────────────────────────
  {
    // Hooked into the sim's own `bumpRally`, so it counts exactly what the `rally` quest objective counts —
    // every fire, doubler re-fires included — rather than drifting from the game's definition of "a Rally".
    id: 'rune_herding_horn',
    name: 'Rune of the Herding Horn',
    cost: 2,
    text: 'Whenever you trigger a **Rally**, gain a **free refresh**.',
    reward: { kind: 'combatFlag', flag: 'runeHerdingHorn' },
  },
  {
    // `once` parks the meter at its cap after paying, so the x/12 counter reads 12/12 rather than resetting
    // and implying another payout is coming. The `spells` target feeds the run's spell power.
    id: 'rune_bubble_crown',
    name: 'Rune of the Bubble Crown',
    cost: 1,
    text: 'When you cast **12 spells**, your **spells gain +6/+6**. (Once)',
    reward: { kind: 'runeThreshold', meter: 'spellCast', per: 12, once: true, buff: { target: 'spells', attack: 6, health: 6 } },
  },
  {
    // Its own per-turn latch rather than Warm Embers' — so the two stack, and so the charge readout can say
    // 1 or 0 for this rune independently.
    id: 'rune_war_drum',
    name: 'Rune of the War Drum',
    cost: 2,
    text: 'One **Shout** triggers **2 extra times** per turn.',
    reward: { kind: 'runeWarDrum', extra: 2 },
  },
  {
    // The tally lives on the RUNE, not on a card — a sell payoff whose counter died with the body it was
    // stored on would reset every time you cashed one in, which is the opposite of what it rewards.
    id: 'rune_baller',
    name: 'Rune of the Baller',
    cost: 4,
    text: 'When you **sell** a minion, give your minions **+1 Attack**. Alternates between **Attack** and **Health**, improving every **2 sales**.',
    reward: { kind: 'runeBaller', step: 1 },
  },
  {
    // `requiresDoublePower` hides it for a hero whose power cannot express "twice" — the gate is
    // `DOUBLEABLE_POWERS` in the reducer, which carries the owner's roster and the reason it is the ACTIVE
    // half of it. Machinery reused from the retired Rune of Empowerment, which nothing had used since.
    id: 'rune_wishbone',
    name: 'Rune of the Wishbone',
    cost: 2,
    text: 'Your **Hero Power** triggers **twice**.',
    requiresDoublePower: true,
    reward: { kind: 'runeWishbone' },
  },

  // -- 2026-08-20 owner rune batch: BASIC --------------------------------------------------------------
  // Twenty runes; the rune-only minions they hand over shipped in eb88a82c. Where a rune is a plain
  // "get a <minion>" it is a bare `grant` -- no new machinery, and the forge hover comes free from the grant.
  {
    // The threshold engine, paying a CARD instead of a spell/Ale/Ruby (`grantCards`, new): the Chef is a
    // named body, so nothing in the existing payout palette could hand it over.
    id: 'rune_deep_feast',
    name: 'Rune of the Deep Feast',
    cost: 5,
    text: 'Every **25 Gold** spent, get a **Deepwater Chef**.',
    previewCards: ['n2_deepchef'], // the reward is a threshold, not a grant - the hover needs telling
    reward: { kind: 'runeThreshold', meter: 'gold', per: 25, grantCards: ['n2_deepchef'] },
  },
  {
    id: 'rune_gem_sage',
    name: 'Rune of the Gem Sage',
    cost: 5,
    text: 'Get a **Gem Sage**.',
    reward: { kind: 'grant', cards: ['k_gemsage'] },
    sets: ['set2'], // the Sage doubles RUBIES - dead weight in a set without them
  },
  {
    id: 'rune_ancient_expenditure',
    name: 'Rune of Ancient Expenditure',
    cost: 4,
    text: 'Get an **Ancient Wanderer**.',
    reward: { kind: 'grant', cards: ['n2_wanderer'] },
  },
  {
    // The CADENCE rune: `everyTurns` on the existing `recurringGrant`, not a bespoke flag. Three runes in this
    // batch share it (see the Muckbroker + Rare Goods below).
    id: 'rune_clockwork_promotion',
    name: 'Rune of Clockwork Promotion',
    cost: 4,
    text: 'Every **2 turns**, get a **Clockwork Assistant**.',
    reward: { kind: 'recurringGrant', cards: ['n2_clockwork'], everyTurns: 2 },
  },
  {
    id: 'rune_night_market',
    name: 'Rune of the Night Market',
    cost: 5,
    text: 'Get a **Night Market Horror**.',
    reward: { kind: 'grant', cards: ['dm_nightmarket'] },
  },
  {
    id: 'rune_muckbroker',
    name: 'Rune of the Muckbroker',
    cost: 4,
    text: 'Every **2 turns**, get a **Muckslinger**.',
    reward: { kind: 'recurringGrant', cards: ['n2_muckslinger'], everyTurns: 2 },
  },
  {
    // Living Magic and Perfect Recall (Epic) are the SAME mechanism at 1 vs 2 uses - one parameterised budget
    // rather than two near-copies, so holding both raises the per-turn ceiling instead of firing twice over.
    id: 'rune_living_magic',
    name: 'Rune of Living Magic',
    cost: 4,
    text: '**Once per turn**, after you cast a spell, get a **copy** of it.',
    reward: { kind: 'runeSpellEcho', uses: 1 },
  },
  {
    id: 'rune_draconic_curiosity',
    name: 'Rune of Draconic Curiosity',
    cost: 4,
    text: 'Whenever you **Discover** a **Dragon**, get a random **Shop spell**.',
    reward: { kind: 'runeDraconicCuriosity' },
  },
  {
    // A `cardsPlayed`-shaped threshold on a new `playDragon` meter, so the remainder BANKS across turns
    // exactly like every other threshold - which is what "progress carries" means.
    id: 'rune_dragons_pantry',
    name: "Rune of the Dragon's Pantry",
    cost: 4,
    text: 'After you play **5 Dragons**, get **2 random Shop spells**. Progress carries between turns.',
    reward: { kind: 'runeThreshold', meter: 'playDragon', per: 5, grantSpell: 2 },
  },
  {
    // A COMBAT meter that pays into the next shop: the Beast rides `playerHandGrants` (the carry-back every
    // in-combat card grant already uses), so it flies to hand during the replay rather than snapping in.
    id: 'rune_returning_pack',
    name: 'Rune of the Returning Pack',
    cost: 4,
    text: 'After you summon **6 Beasts** in combat, get a random **Beast**.',
    reward: { kind: 'combatFlag', flag: 'runeReturningPack', amount: 6 },
  },
  {
    // The other combat meter, paying the OTHER carry-back: `ctx.grantFreeRolls` -> `playerFreeRolls`, the same
    // channel Rune of the Burrow and the Herding Horn bank into.
    id: 'rune_grave_refreshment',
    name: 'Rune of Grave Refreshment',
    cost: 3,
    text: 'For every **2** friendly **Echoes** triggered in combat, gain a **free refresh** next turn.',
    reward: { kind: 'combatFlag', flag: 'runeGraveRefreshment', amount: 2 },
  },
  {
    id: 'rune_seasoned_ledger',
    name: 'Rune of the Seasoned Ledger',
    cost: 5,
    text: 'Whenever you play a minion, give it **+1/+1**. Improves by **+1/+1** after every **5** minions played.',
    reward: { kind: 'runeSeasonedLedger', attack: 1, health: 1, per: 5 },
  },
  {
    id: 'rune_echoed_arrival',
    name: 'Rune of Echoed Arrival',
    cost: 4,
    text: 'Every **5th** **Echo** minion you play triggers its Echo.',
    reward: { kind: 'runeEchoedArrival', per: 5 },
  },
  {
    id: 'rune_rare_goods',
    name: 'Rune of Rare Goods',
    cost: 4,
    text: 'Every **2 turns**, get a **Traveling Salesman**.',
    reward: { kind: 'recurringGrant', cards: ['n2_salesman'], everyTurns: 2 },
  },
  {
    id: 'rune_kegheart',
    name: 'Rune of Kegheart',
    cost: 4,
    text: 'Get a **Kegheart Dwarf**.',
    reward: { kind: 'grant', cards: ['dw_kegheart'] },
    sets: ['set2'], // the Kegheart eats ALES - a set without them makes it a vanilla body
  },
  {
    // The Engraving's shape with a MOVING axis: the same `gainRubyBonus` carry-back, but which half it feeds
    // flips at every turn setup. The axis in force rides into combat on the mod (see `runeShiftingFacets`),
    // so a fight always resolves the axis the shop was showing.
    id: 'rune_shifting_facets',
    name: 'Rune of Shifting Facets',
    cost: 3,
    text: '**Avenge (3):** improve your **Rubies** by **+1 Health**. Each turn this **alternates** between Health and Attack.',
    previewCards: ['ruby'],
    reward: { kind: 'combatFlag', flag: 'runeShiftingFacets' },
    sets: ['set2'], // Rubies
  },
  {
    // Rides the SAME stateless `addBuff` hook Sable's Soulbind uses - the one chokepoint every recruit-phase
    // stat gain passes through - rather than being wired into the dozen sites that grant stats.
    id: 'rune_shared_spoils',
    name: 'Rune of Shared Spoils',
    cost: 4,
    text: 'Whenever your **left-most Dwarf** gains stats, give your **right-most Dwarf** the same stats.',
    reward: { kind: 'runeSharedSpoils' },
    sets: ['set2'], // Dwarves
  },
  {
    id: 'rune_heavy_payroll',
    name: 'Rune of Heavy Payroll',
    cost: 4,
    text: 'Whenever you get a **Dwarf**, give your **left-most minion +12/+12**.',
    reward: { kind: 'runeHeavyPayroll', attack: 12, health: 12 },
    sets: ['set2'], // Dwarves
  },
  {
    // The threshold engine again, with the two new knobs: a TRIBE buff target and a `step` that escalates the
    // payout. "Improve this by +1/+1" is therefore data, not a bespoke rune.
    id: 'rune_compounding_wages',
    name: 'Rune of Compounding Wages',
    cost: 4,
    text: 'Every **10 Gold** spent, give your **Dwarves +1/+1** and improve this by **+1/+1**.',
    reward: { kind: 'runeThreshold', meter: 'gold', per: 10, buff: { target: 'tribe', tribe: 'dwarf', attack: 1, health: 1, step: { attack: 1, health: 1 } } },
    sets: ['set2'], // Dwarves
  },
  {
    // `castStatSpell` CASTS the spell rather than handing it over - so spell power, the cast counters and every
    // on-cast watcher all see it, which "cast a random spell" has to mean.
    id: 'rune_gilded_ledger',
    name: 'Rune of the Gilded Ledger',
    cost: 4,
    text: 'Every **7 Gold** spent, cast a random **stat-granting Shop spell**.',
    reward: { kind: 'runeThreshold', meter: 'gold', per: 7, castStatSpell: 1 },
  },
];

/**
 * Epic Runes — the **Epic Runeforge's** stock. A second, higher-power forge that functions identically to the
 * normal Runeforge (offer a random few, buy ONE for Gold, re-roll once for 2 Gold) but draws from THIS set and is
 * NOT tied to a hero power — reached by a quest reward (`openEpicRuneforge`, the Epic Commission quest).
 *
 * The designed Epic roster is now wired out — **31 Epic runes** across grants, discovers, recurring-end-of-turn,
 * Start-of-Combat / Avenge combat flags, and recruit-phase mechanics (Copies, Reliquary, Rising Graves, Broodpit,
 * Spearline, Appraisal, Assembly, Stormcalling, Frontline Glory, Soul Taxes, Scales, Twin Gilding, Den Mother,
 * Banking, First Claws, Inheritance, Second Path, Twilight, Feast, Reconfiguration, Champion, Armory, Gilded Spark).
 */
export const EPIC_RUNES: RuneDef[] = [
  {
    // The epic half of the Gift pair: a CHOICE of Gift rather than a random one, every turn.
    id: 'rune_merry_christmas',
    name: 'Merry Christmas',
    cost: 4,
    epic: true,
    text: 'Discover a **Gift**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeMerryChristmas' },
  },
  {
    id: 'rune_copies',
    name: 'Rune of Copies',
    cost: 3,
    epic: true,
    text: '**Start of shop:** get a copy of a random minion on your board.',
    reward: { kind: 'runeCopies' },
  },
  {
    id: 'rune_reliquary',
    name: 'Rune of the Reliquary',
    cost: 3,
    epic: true,
    text: '**End of Turn:** trigger your **2 left-most Echoes**.', // owner 2026-08-19: was one
    reward: { kind: 'recurringEndOfTurn', effect: 'triggerLeftmostEcho' },
  },
  // ── Batch 3: combat runes (Start of Combat + Avenge) ──
  {
    id: 'rune_rising_graves',
    name: 'Rune of Rising Graves',
    cost: 1,
    epic: true,
    text: '**Start of Combat:** give two friendly **Undead Rise**.',
    reward: { kind: 'combatFlag', flag: 'runeRisingGraves' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    id: 'rune_broodpit',
    name: 'Rune of the Broodpit',
    cost: 3,
    epic: true,
    text: '**Avenge (4):** summon **2 Imps with Taunt**.', // owner rebalance 2026-08-03 (was 3)
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeBroodpit' },
  },
  {
    id: 'rune_spearline',
    sets: ['set1'],
    name: 'Rune of the Spearline',
    cost: 7,
    epic: true,
    text: '**Avenge (4):** summon a **Spear Warden**. It attacks immediately.',
    previewCards: ['knit'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeSpearline' },
  },
  {
    id: 'rune_appraisal',
    name: 'Rune of Appraisal',
    cost: 3,
    epic: true,
    text: '**Avenge (3):** improve your Shop spells by **+1/+1**.',
    reward: { kind: 'combatFlag', flag: 'runeAppraisal' },
  },
  // ── Batch 4: grant runes (existing cards + a Gilded-grant option) ──
  {
    id: 'rune_assembly',
    name: 'Rune of Assembly',
    cost: 6,
    epic: true,
    text: 'Get a **Beatbot** and **2 Attachments**.',
    reward: { kind: 'grant', cards: ['beatboxer'], randomFilter: 'attachment', randomFilterCount: 2 },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    // The shop's two purchases discount each other, alternating.
    id: 'rune_cadence',
    name: 'Rune of Cadence',
    cost: 5, // owner balance 2026-08-11
    epic: true,
    text: 'After you buy a minion, your next **Shop spell** costs **1 less**. After you cast a **Shop spell**, your next **minion** costs **1 less**.',
    reward: { kind: 'runeCadence' },
  },
  {
    // The two currencies feed each other's power, one step per turn each.
    id: 'rune_gemscript',
    name: 'Rune of Gemscript',
    cost: 4,
    epic: true,
    text: 'The first **Shop spell** you cast each turn gives your **Rubies +1/+1**. The first **Ruby** you cast gives your **Shop spells +1/+1**.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'runeGemscript' },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_stormcalling',
    name: 'Rune of Stormcalling',
    cost: 4, // owner balance 2026-08-11
    epic: true,
    text: 'Get a **Karwind** and a random **Shout** minion.',
    // Ungilded (owner sheet 2026-07-31 — it granted a Gilded copy before).
    reward: { kind: 'grant', cards: ['karwind'], randomFilter: 'shout', randomFilterCount: 1 },
  },
  {
    id: 'rune_frontline_glory',
    sets: ['set1'],
    name: 'Rune of Frontline Glory',
    cost: 8,
    epic: true,
    text: 'Get a **Gilded Yazzus** and **Front to Back**.',
    reward: { kind: 'grant', grantGolden: ['yazzus'], cards: ['fronttoback'] },
  },
  {
    // Owner 2026-08-20: ENABLED in every set (was gated to the disabled set 1) and repriced 4 -> 3. Souls Man
    // is an out-of-set UNDEAD body, granted rather than drawn — same acceptance as Rune of Pillaging.
    id: 'rune_soul_taxes',
    name: 'Rune of Soul Taxes',
    cost: 3,
    epic: true,
    text: '**Avenge (4):** gain **+1 max Gold**. Get **Souls Man**.',
    reward: { kind: 'multi', rewards: [{ kind: 'combatFlag', flag: 'runeSoulTaxes' }, { kind: 'grant', cards: ['soulsman'] }] },
  },
  // ── Batch 5: recruit-phase runes ──
  {
    id: 'rune_scales',
    name: 'Rune of Scales',
    cost: 2,
    epic: true,
    text: 'Whenever you cast a **Shop spell**, give your **Dragons +4/+5**.', // owner 2026-08-11 (was +2/+2)
    reward: { kind: 'runeScales' },
  },
  {
    id: 'rune_twin_gilding',
    name: 'Rune of Twin Gilding',
    cost: 7,
    epic: true,
    text: 'You only need **2 copies** of cards to **Gild** them.',
    reward: { kind: 'runeTwinGilding' },
  },
  {
    id: 'rune_den_mother',
    sets: ['set1'],
    name: 'Rune of the Den Mother',
    cost: 7,
    epic: true,
    text: 'Get **Den Mother**. Your Den Mother also **buffs herself** when she buffs other Beasts.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['mamabear'] }, { kind: 'runeDenMother' }] },
  },
  {
    id: 'rune_banking',
    name: 'Rune of Banking',
    cost: 7,
    epic: true,
    text: '**End of Turn:** attach **Money Bots** to your left-most and right-most Mechs.',
    previewCards: ['moneybot'], // text names it — the forge hover shows the card
    reward: { kind: 'recurringEndOfTurn', effect: 'weldMoneyBotsEdgeMechs' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  // ── Batch 6: combat runes + Second Path ──
  {
    id: 'rune_first_claws',
    name: 'Rune of First Claws',
    cost: 7,
    epic: true,
    text: '**Start of Combat:** your left-most and right-most **Beasts** attack immediately.',
    reward: { kind: 'combatFlag', flag: 'runeFirstClaws' },
  },
  {
    id: 'rune_inheritance',
    name: 'Rune of Inheritance',
    cost: 4,
    epic: true,
    text: 'When your **left-most minion dies**, your **right-most minion** gains its stats.',
    reward: { kind: 'combatFlag', flag: 'runeInheritance' },
  },
  {
    // Owner sheet 2026-07-31 (was: Discover a Greater-Quest reward minion).
    id: 'rune_second_path',
    name: 'Rune of the Second Path',
    cost: 4,
    epic: true,
    text: '**Discover 2 Tier 6** minions and set their stats to **20/20**.',
    reward: { kind: 'runeSecondPath' },
  },
  {
    id: 'rune_twilight',
    name: 'Rune of Twilight',
    cost: 4,
    epic: true,
    text: 'Your **Start-of-Combat** effects trigger an **additional time**.',
    reward: { kind: 'combatFlag', flag: 'runeTwilight' },
  },
  // ── Batch 4b: the two new signature cards ──
  {
    id: 'rune_feast',
    sets: ['set1'],
    name: 'Rune of the Feast',
    cost: 5,
    epic: true,
    text: 'Get **Feasting Bogrot**.',
    reward: { kind: 'grant', cards: ['feastingbogrot'] },
  },
  {
    id: 'rune_reconfiguration',
    sets: ['set1'],
    name: 'Rune of Reconfiguration',
    cost: 6,
    epic: true,
    text: 'Get **Reconfigured Combinator**.',
    reward: { kind: 'grant', cards: ['reconfiguredcombinator'] },
  },
  // ── Batch 1 additions (grants / discovers — no new combat mechanics) ──
  {
    // Owner sheet 2026-07-31 (was: Discover a Tier 6 minion). The tribe resolves against the board at forge
    // time — the same dominant-tribe read Tribe Portal uses.
    id: 'rune_champion',
    name: 'Rune of the Champion',
    cost: 3,
    epic: true,
    text: '**Discover** a **Tier 4, 5, and 6** minion of your **most common type**.',
    reward: { kind: 'runeChampion' },
  },
  {
    id: 'rune_armory',
    name: 'Rune of the Armory',
    cost: 3,
    epic: true,
    text: 'Get **10 random Attachments**.',
    reward: { kind: 'grant', randomFilter: 'attachment', randomFilterCount: 10 },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    id: 'rune_gilded_spark',
    name: 'Rune of the Gilded Spark',
    cost: 1,
    epic: true,
    text: 'Get a **Goldcrafter**. Get another in **2 turns**.',
    reward: { kind: 'grant', cards: ['goldcrafter'], repeatInTurns: 2 },
  },
  // ── Batch 7a additions (owner designs 2026-07-17; Rune of Mastery follows separately in 7b) ──
  {
    id: 'rune_transfusion',
    name: 'Rune of Transfusion',
    cost: 4,
    epic: true,
    text: 'Whenever a **Demon Consumes** Fodder, your **left-most minion** also gains its stats.',
    // Set 1 only — set 2 has no Fodder. Its set-2 twin consumes a SHOP minion instead (owner ruling 2026-07-29).
    reward: { kind: 'runeTransfusion' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    id: 'rune_mirror_march',
    name: 'Rune of the Mirror March',
    cost: 5,
    epic: true,
    text: '**Start of Combat:** when you have room, summon a **copy of your left-most minion**.',
    reward: { kind: 'combatFlag', flag: 'runeMirrorMarch' },
  },
  {
    id: 'rune_recurrence',
    name: 'Rune of Recurrence',
    cost: 4,
    epic: true,
    text: '**End of Turn:** cast the **first Shop spell** you cast this turn again, **twice**.',
    reward: { kind: 'recurringEndOfTurn', effect: 'recastFirstSpell' },
  },
  {
    id: 'rune_replication',
    name: 'Rune of Replication',
    cost: 1,
    epic: true,
    text: 'The first **Attachment** you play each turn also attaches a **copy** to your left-most Mech.',
    reward: { kind: 'runeReplication' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  {
    id: 'rune_conductor',
    name: 'Rune of the Conductor',
    cost: 4,
    epic: true,
    text: 'Your **End of Turn** effects trigger **2 more times**.',
    reward: { kind: 'runeConductor' },
  },
  {
    id: 'rune_undertow',
    name: 'Rune of the Undertow',
    cost: 4,
    epic: true,
    text: 'The first **4** minions summoned in combat gain **Ward**.',
    reward: { kind: 'combatFlag', flag: 'runeUndertow', amount: 4 },
  },
  {
    id: 'rune_mastery',
    sets: ['set1'],
    name: 'Rune of Mastery',
    cost: 7,
    epic: true,
    text: 'Whenever one of your effects **Improves**, it improves an **additional time**.',
    reward: { kind: 'runeMastery' },
  },
  {
    id: 'rune_endless_appetite',
    name: 'Rune of Endless Appetite',
    cost: 8,
    epic: true,
    text: 'The first time you **Consume** Fodder each turn, all your other **Demons Consume** a copy of it.',
    reward: { kind: 'runeEndlessAppetite' },
    sets: ['set1'], // Fodder/Attachment/Mech/Undead mechanics — absent from set 2
  },
  // ── Set 2 rune batch (owner roster 2026-07-29) — "get a named minion" runes. Each names a card that now
  // exists, so they are pure grants; the rest of the roster needs new reward kinds and is not shipped yet.
  {
    // Owner add 2026-08-02: sell-to-invest. The bonus stats are everything above the printed base, so a
    // heavily-buffed body cashes out into the tavern rather than being lost.
    id: 'rune_liquidation',
    name: 'Rune of Liquidation',
    cost: 4,
    epic: true,
    text: 'When you **sell** a minion, give its **stats** to the **right-most Shop** minion.', // owner 2026-08-11 (was bonus stats)
    reward: { kind: 'runeLiquidation' },
  },
  {
    // Owner add 2026-08-02: an extra attack every round, paid for by board ORDER — the two ends of your line.
    id: 'rune_warpath',
    name: 'Rune of the Warpath',
    cost: 5,
    epic: true,
    text: 'After your **left-most** minion attacks, your **right-most** minion attacks.',
    reward: { kind: 'combatFlag', flag: 'runeWarpath' },
  },
  {
    // Owner add 2026-08-02: the Gold sink for a Ruby board — 10 Gold spent showers the whole line.
    id: 'rune_gemspam',
    name: 'Rune of Gemspam',
    cost: 4, // owner balance 2026-08-11
    epic: true,
    text: 'When you spend **10 Gold**, cast a **Ruby** on all of your minions.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'runeThreshold', meter: 'gold', per: 10, rubyAll: true },
    sets: ['set2'], // Rubies are a set-2 mechanic
  },
  {
    // Owner add 2026-08-02: a GIFT spell (not a Shop spell — see the token-gift branch in the reducer) that
    // copies a friendly minion EXACTLY: stats, buffs, keywords, gilding, per-instance improvements.
    id: 'rune_copycat',
    name: 'Rune of Copycat',
    cost: 5,
    epic: true,
    text: 'Get a **Copycat**.',
    reward: { kind: 'grant', cards: ['copycat'] },
  },
  {
    // Owner add 2026-08-02: the set-1 Taurus (T6, Engraves its neighbors), rune-granted — same named-minion
    // shape as Rune of Yazzus. Grants from CARD_INDEX, so it works regardless of the run's pinned set.
    id: 'rune_taurus',
    name: 'Rune of Taurus',
    cost: 3,
    epic: true,
    text: 'Get a **Taurus**.',
    reward: { kind: 'grant', cards: ['taurus'] },
  },
  {
    id: 'rune_yazzus',
    name: 'Rune of Yazzus',
    cost: 4, // owner balance 2026-08-11 (6 → 4)
    epic: true,
    text: 'Get a **Yazzus**.',
    reward: { kind: 'grant', cards: ['yazzus'] },
    sets: ['set2'], // Rubies / Ales / set-2 cards
  },
  {
    id: 'rune_lazarus',
    name: 'Rune of Lazarus',
    cost: 5,
    epic: true,
    text: 'Get a **Lazarus**.',
    reward: { kind: 'grant', cards: ['lazarus'] },
    sets: ['set2'], // Rubies / Ales / set-2 cards
  },
  {
    // Distinct from Rune of Mykel (which grants High King Mykel) — this one is the Brill grant. This rune was
    // DUPLICATED for a while (a second identical entry landed further down in the 96-rune batch, #762): the
    // Runeforge could stock it twice and the Compendium's duplicate React keys smeared it across the gallery.
    // `validateRunes` now rejects duplicate ids/names so a repeat cannot land silently.
    id: 'rune_high_king',
    name: 'Rune of the High King',
    cost: 4,
    epic: true,
    text: 'Get a **Dwarf King, Brill**.',
    reward: { kind: 'grant', cards: ['dw_brill'] },
    sets: ['set2'], // Rubies / Ales / set-2 cards
  },
  {
    id: 'rune_exgalloper',
    name: 'Rune of Exgalloper',
    cost: 3,
    epic: true,
    text: 'Get an **Exgalloper**.',
    reward: { kind: 'grant', cards: ['dw_exgalloper'] },
    sets: ['set2'], // Rubies / Ales / set-2 cards
  },
  {
    // Owner add 2026-08-03. Same shape as the other forge-only body grants (Brill, Mykel): the minion is
    // `token: true` so it exists ONLY through this rune.
    id: 'rune_baal',
    name: 'Rune of Baal',
    cost: 6,
    epic: true,
    text: 'Get a **Baal**.',
    previewCards: ['dw_baal'], // text names it — the forge hover shows the card
    reward: { kind: 'grant', cards: ['dw_baal'] },
    sets: ['set2'], // Dwarf/Demon + Ales — set-2 mechanics
  },
  {
    id: 'rune_brisbane',
    name: 'Rune of Mykel',
    cost: 4,
    epic: true,
    text: 'Get a **High King Mykel**.',
    reward: { kind: 'grant', cards: ['dw_brisbane'] },
    sets: ['set2'], // Rubies / Ales / set-2 cards
  },
  {
    // 3 RANDOM Ales (owner 2026-07-29), not a fixed trio — the variety is the point.
    id: 'rune_double_fisting',
    name: 'Rune of Double Fisting',
    cost: 6,
    epic: true,
    // Owner sheet 2026-07-31: the Ales RECUR — 2 random Ales every turn (owner balance 2026-08-11, was 3).
    text: 'Get an **Edward Keg-hands**, and **2 random Dwarven Ales** every turn.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['dw_edward'] }, { kind: 'recurringEndOfTurn', effect: 'grantAles' }] },
    sets: ['set2'], // Rubies / Ales / set-2 cards
  },
  {
    // Shares Bottomless Cellar's primitive — the run-wide Ale multiplier, additive with Edward Keg-hands.
    id: 'rune_bottomless_cask',
    name: 'Rune of the Bottomless Cask',
    cost: 5,
    epic: true,
    text: 'Your **Dwarven Ales** trigger an **additional time**.',
    sets: ['set2'],
    reward: { kind: 'aleExtraCasts', amount: 1 },
  },
  {
    // The run-wide twin of the Motherlode quest — same primitive, no tribe filter (any friendly minion).
    id: 'rune_motherlode',
    name: 'Rune of the Motherlode',
    cost: 5,
    epic: true,
    text: 'Whenever you get a **Ruby**, play a copy on **2 random friendly minions**.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'motherlode', count: 2 },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_adventuring',
    name: 'Rune of Adventuring',
    cost: 6,
    epic: true,
    text: 'Your **Rally** effects trigger **twice**.',
    reward: { kind: 'rallyRepeat', scope: 'always' },
  },
  {
    id: 'rune_choir',
    name: 'Rune of the Choir',
    cost: 4,
    epic: true,
    text: 'Your **Shouts** trigger an **additional time**. Get a **Shout** minion.',
    reward: { kind: 'multi', rewards: [{ kind: 'shoutRepeat', scope: 'always' }, { kind: 'grant', randomFilter: 'shout' }] },
  },
  {
    id: 'rune_long_shift',
    name: 'Rune of the Long Shift',
    cost: 2,
    epic: true,
    // Owner rework 2026-08-11: from a buy-meter to a double Discover. Reworded 2026-08-17 — the pair now fires
    // IMMEDIATELY on taking the rune and repeats every Start of Turn, rather than waiting for the next turn.
    // The window opens in the shop as normal (the "no window" ruling is only for END-of-turn discovers, which
    // fire mid-transition).
    text: 'Discover **2 Shop Spells**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeLongShift' },
  },
  {
    id: 'rune_vanguard',
    name: 'Rune of the Vanguard',
    cost: 1,
    epic: true,
    text: '**Start of Combat:** give your **three left-most** minions **Critical Strike** and **Ward**.',
    reward: { kind: 'combatFlag', flag: 'runeVanguard' },
  },
  {
    // The Warded sibling of Pit Without End — its own latch, so holding both pays both.
    id: 'rune_finality',
    name: 'Rune of Finality',
    cost: 6,
    epic: true,
    text: 'When your **last minion dies**, summon **7 Imps** with **Ward**.',
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeFinality', amount: 7 },
  },
  {
    id: 'rune_open_market',
    name: 'Rune of the Open Market',
    cost: 2,
    epic: true,
    text: 'The first time you **Consume a Shop minion** each turn, give your **Shop +3/+3** permanently.',
    reward: { kind: 'runeOpenMarket', attack: 3, health: 3 },
    sets: ['set2'], // Shop-minion Consume is a set-2 Demon mechanic
  },
  {
    // The meter excludes Ales — the payout IS an Ale, so counting them would let the rune feed itself.
    id: 'rune_runic_exchange',
    name: 'Rune of Runic Exchange',
    cost: 2,
    epic: true,
    text: 'Every **3 Shop spells** you cast, get a random **Dwarven Ale**. Dwarven Ales do not count.',
    reward: { kind: 'runeThreshold', meter: 'spellCastNonAle', per: 3, grantAle: 1 },
    sets: ['set2'], // Ales
  },
  {
    id: 'rune_cinder_ledger',
    name: 'Rune of the Cinder Ledger',
    cost: 3,
    epic: true,
    text: '**Avenge (3):** improve your **Imp Aura** by **+6/+6**.',
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeCinderLedger', amount: 6 },
  },
  {
    id: 'rune_procession',
    name: 'Rune of the Procession',
    cost: 3,
    epic: true,
    text: '**Avenge (4):** **double** your **right-most** minion’s stats.',
    reward: { kind: 'combatFlag', flag: 'runeProcession' },
  },
  {
    id: 'rune_gemstorm',
    name: 'Rune of Gemstorm',
    cost: 2,
    epic: true,
    text: '**Avenge (2):** cast **2 Rubies** on each friendly **Kobold**.',
    previewCards: ['ruby'], // names Rubies — forge hover shows the live Ruby (audit 2026-08-06)
    reward: { kind: 'combatFlag', flag: 'runeGemstorm', amount: 2 },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_shared_table',
    name: 'Rune of the Shared Table',
    cost: 3,
    epic: true,
    text: 'Your **Dwarven Ale** casts each give **one friendly minion of each type +2/+2**.',
    reward: { kind: 'runeSharedTable', attack: 2, health: 2 },
    sets: ['set2'], // Ales
  },
  {
    id: 'rune_redirection',
    name: 'Rune of Redirection',
    cost: 4,
    epic: true,
    text: 'Rubies played on your **left-most** minion also cast on your **right-most** minion.',
    previewCards: ['ruby'], // names Rubies — forge hover shows the live Ruby (audit 2026-08-06)
    reward: { kind: 'runeRedirection' },
    sets: ['set2'], // Rubies
  },
  {
    // The single-body Attack snowball next to The Old Hunt's board-wide aura — and its step GROWS, where the
    // quest's does not.
    id: 'rune_wild_hunt',
    name: 'Rune of the Wild Hunt',
    cost: 3,
    epic: true,
    // Owner rework 2026-08-19: the grant went from board-wide +Health to the ATTACKER's own +Attack, at +2 a
    // swing. `amount` is BOTH the grant and the escalation step (see the wildHunt block in simulate), so one
    // number moves both halves together.
    text: 'When a **Beast** attacks, give it **+2 Attack** and improve this by **2** permanently.',
    reward: { kind: 'combatFlag', flag: 'runeWildHunt', amount: 2 },
  },
  {
    // Grafts Exgalloper's exact-copy Echo (NOT Rise — Rise resummons the printed body, so a grown shard came
    // back at base stats; owner report 2026-07-31).
    id: 'rune_living_treasure',
    name: 'Rune of Living Treasure',
    cost: 4,
    epic: true,
    text: 'Your **Gemheart Golems** gain **Echo:** summon an exact copy of this without Echo.',
    previewCards: ['gemheart-shard'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeLivingTreasure' },
    sets: ['set2'], // Gemheart Golems are a set-2 Kobold token
  },
  {
    // Same "while you have room" shape as the Brood, with a body that strikes on arrival.
    id: 'rune_living_echoes',
    name: 'Rune of Living Echoes',
    cost: 5,
    epic: true,
    text: 'When you have **space** on your board, summon a **Sunmane Herald** that **attacks immediately**. **3 times** per combat.',
    previewCards: ['b2_sunmane'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeLivingEchoes', amount: 3 },
    sets: ['set2'], // Sunmane Herald is a set-2 Beast
  },
  {
    // The Demon's stats are CAPTURED at Start of Combat, not read when the summon lands — so a Demon that dies
    // first still pays out, and the rune reads as a promise made at the bell.
    id: 'rune_food_chain',
    name: 'Rune of the Food Chain',
    cost: 5,
    epic: true,
    text: '**Start of Combat:** the **first minion you summon** gains your **left-most Demon’s stats** this combat.',
    reward: { kind: 'combatFlag', flag: 'runeFoodChain' },
  },
  {
    id: 'rune_attacking_gems',
    name: 'Rune of Attacking Gems',
    cost: 4,
    epic: true,
    text: 'Cast a **Ruby** on all of your minions every friendly **attack** in combat.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeAttackingGems', amount: 1 },
    sets: ['set2'], // Rubies
  },
  {
    // Rides the run's single gold-GAIN chokepoint (`gainGold`), added for this rune — Gold was credited in a
    // dozen places, and wiring eleven would have shipped a rune that silently misses the twelfth.
    id: 'rune_profit_sharing',
    name: 'Rune of Profit Sharing',
    cost: 4,
    epic: true,
    text: 'Whenever you **gain Gold**, give your **Dwarves +3/+3**.',
    reward: { kind: 'runeProfitSharing', tribe: 'dwarf', attack: 3, health: 3 },
    sets: ['set2'], // Dwarves
  },
  {
    // Shares the Moonhowl Mentor's per-turn teach ceiling rather than owning its own, so holding both raises the
    // cap instead of the two firing independently.
    id: 'rune_white_wolf',
    name: 'Rune of the White Wolf',
    cost: 4,
    epic: true,
    text: 'Once per turn, when you **buy a Shop spell**, teach it to a **Mage-Pup**.',
    previewCards: ['b2_magepup'], // text names it — the forge hover shows the card
    reward: { kind: 'runeWhiteWolf' },
    sets: ['set2'], // Mage-Pup is a set-2 Beast token
  },
  {
    // "Permanently" required a new carry-back channel — every other one is tribe-scoped, so an untyped
    // whole-warband buff had nowhere to land and would have vanished at settle.
    id: 'rune_overflow',
    name: 'Rune of Overflow',
    cost: 4, // owner balance 2026-08-11
    epic: true,
    text: 'Whenever you summon a minion that **does not fit**, give your minions **+4/+4 permanently**.',
    reward: { kind: 'combatFlag', flag: 'runeOverflow', amount: 4 },
  },
  {
    // Counted through a narrow helper, NOT `noteSpellCast` — the Ruby path already fires the Ruby+Spell umbrella
    // and spends the Grimoire charge, so reusing that function would double-fire every "every 3 casts" card.
    id: 'rune_spellstone',
    name: 'Rune of the Spellstone',
    cost: 3,
    epic: true,
    // Owner ask 2026-08-14: "counts as a Shop spell" now means it too — a Ruby picks up your Shop-spell buffs
    // on top of your Ruby buffs, and everything downstream of a Ruby's stats inherits that (combat-played
    // Rubies, Veinstorm's shop stamp, Motherlode, Mountainbond). Before this the rune made a Ruby count as a
    // spell for every purpose except the one thing a spell is actually worth. See `rubyStatBonus`.
    text: '**Rubies** you cast count as **Shop spells**, and gain your **Shop spell** bonuses.',
    previewCards: ['ruby'], // names Rubies — forge hover shows the live Ruby (audit 2026-08-06)
    reward: { kind: 'runeSpellstone' },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_counterpoint',
    name: 'Rune of Counterpoint',
    cost: 7,
    epic: true,
    text: 'When a friendly minion **dies**, your **left-most** minion **attacks immediately**.',
    reward: { kind: 'combatFlag', flag: 'runeCounterpoint' },
  },
  {
    // Epic, like every other named-minion grant rune (Yazzus, Lazarus, Exgalloper, Mykel, the High King).
    id: 'rune_chimerus',
    name: 'Rune of Chimerus',
    cost: 3,
    epic: true,
    text: 'Get a **Chimerus**.',
    reward: { kind: 'grant', cards: ['chimerus'] },
  },
  // ── the 2026-08-07 owner Epic batch (14 runes) ──
  {
    id: 'rune_enchantment',
    name: 'Rune of Enchantment',
    cost: 5,
    epic: true,
    text: 'Whenever you cast a **Shop spell**, give your minions **+2/+3** permanently (**+4/+6** during combat).', // owner 2026-08-11
    reward: { kind: 'runeEnchantment' },
  },
  {
    id: 'rune_crown',
    name: 'Rune of the Crown',
    cost: 4,
    epic: true,
    text: 'After you cast **6 Shop spells**, your Shop spells give an extra **+4/+4**.',
    reward: { kind: 'runeCrown', per: 6, attack: 4, health: 4 },
  },
  {
    id: 'rune_lapidary',
    name: 'Rune of the Lapidary',
    cost: 5,
    epic: true,
    text: '**End of Turn:** cast a **Ruby** on a random minion for every card you played this turn.', // owner 2026-08-11
    previewCards: ['ruby'],
    reward: { kind: 'runeLapidary' },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_gem_golem',
    name: 'Rune of the Gem Golem',
    cost: 4,
    epic: true,
    text: 'When a friendly **Kobold** dies in combat, summon a token with stats equal to its **Ruby** bonuses.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeGemGolem' },
    sets: ['set2'], // Rubies
  },
  {
    // Owner add 2026-08-19. The Demon board's Shop-economy payoff: a wide Demon curve turns every play into
    // another look at the row. Rides the same play chokepoint as the Chipper Sticker (`fireSummonBuffs`).
    id: 'rune_refreshments',
    name: 'Rune of Refreshments',
    cost: 1,
    epic: true,
    text: 'When you play a **Demon**, gain a **free refresh**.',
    reward: { kind: 'runeRefreshments' },
  },
  {
    // Owner add 2026-08-19. A refresh-paced Health faucet on the slot the Shop's eaters and copiers already
    // fight over (Hellrider, Bob Blart, Market Tormentor), so it compounds with them rather than sitting apart.
    id: 'rune_embers',
    name: 'Rune of the Embers',
    cost: 4,
    epic: true,
    text: 'When you **refresh**, **double** the Health of the **right-most** minion in the Shop.',
    reward: { kind: 'runeEmbers' },
  },
  {
    // Owner rework 2026-08-19: was a BASIC 6-Gold rune for 3 Gold / +3 max. Promoted to Epic at 0 Gold for
    // 4 / +4 — a free Epic that pays for itself the turn you take it. Promoting a rune is an ARRAY move
    // (`RUNES` -> `EPIC_RUNES`), not a flag flip: `runeforgePool` reads membership, and `epic` is the kicker.
    id: 'rune_tip_jar',
    name: 'Rune of the Tip Jar',
    cost: 0,
    epic: true,
    text: 'Gain **4 Gold** and increase your **maximum Gold** by **4**.',
    reward: { kind: 'multi', rewards: [{ kind: 'gainGold', amount: 4, immediate: true }, { kind: 'gainMaxGold', amount: 4 }] },
  },
  {
    // Owner add 2026-08-19. The Menagerie payoff as a rune: a full house of every active type, cashed once at
    // Start of Combat. Three bodies picked WITHOUT replacement, each doubled at its CURRENT stats — so it pays
    // more the later the board is built, and rewards holding a wide board rather than a single-tribe stack.
    id: 'rune_stoked_menagerie',
    name: 'Rune of the Stoked Menagerie',
    cost: 5,
    epic: true,
    text: '**Start of Combat:** if you control all **5 minion types**, **double** the stats of **3 random minions**.',
    reward: { kind: 'combatFlag', flag: 'runeStokedMenagerie' },
  },
  {
    id: 'rune_dragonscale',
    name: 'Rune of Dragonscale',
    cost: 4,
    epic: true,
    text: 'Whenever a friendly **Dragon** attacks, give it **Ward**. **3 times** per combat.',
    reward: { kind: 'combatFlag', flag: 'runeDragonscale', amount: 3 },
  },
  {
    id: 'rune_tempered_time',
    name: 'Rune of Tempered Time',
    cost: 4,
    epic: true,
    text: '**Start of Combat:** give each of your minions **Health** equal to **half its Attack**.',
    reward: { kind: 'combatFlag', flag: 'runeTemperedTime' },
  },
  {
    id: 'rune_savagery',
    name: 'Rune of Savagery',
    cost: 5,
    epic: true,
    text: 'After you summon a **Beast** in combat, **double its Attack**.',
    reward: { kind: 'combatFlag', flag: 'runeSavagery' },
  },
  {
    id: 'rune_crucible',
    name: 'Rune of the Crucible',
    cost: 4,
    epic: true,
    text: '**Start of Combat:** destroy your **3 left-most** minions. After your last minion dies, **resummon** them.',
    reward: { kind: 'combatFlag', flag: 'runeCrucible', amount: 3 },
  },
  {
    id: 'rune_herald',
    name: 'Rune of the Herald',
    cost: 5,
    epic: true,
    text: '**Start of Combat:** trigger all your **Echoes**.',
    reward: { kind: 'combatFlag', flag: 'runeHerald' },
  },
  {
    id: 'rune_deep',
    name: 'Rune of the Deep',
    cost: 6,
    epic: true,
    text: 'Each turn, get a random **Tier 7** minion.',
    reward: { kind: 'runeDeep', tier: 7 },
  },
  {
    id: 'rune_guiding_candle',
    name: 'Rune of the Guiding Candle',
    cost: 4,
    epic: true,
    text: 'Your first **2 Shop refreshes** each turn contain only **Tier 6** minions.',
    reward: { kind: 'runeGuidingCandle', count: 2, tier: 6 },
  },
  {
    id: 'rune_muster',
    name: 'Rune of the Muster',
    cost: 3,
    epic: true,
    text: 'Get a **free Shop refresh** filled with **plain copies** of your minions.',
    reward: { kind: 'runeMuster' },
  },
  {
    id: 'rune_foundry',
    name: 'Rune of the Foundry',
    cost: 4,
    epic: true,
    text: 'After you sell **5 minions**, get a random **Dragon**.',
    reward: { kind: 'runeFoundry', per: 5 },
  },
  {
    id: 'rune_corrupted_tome',
    name: 'Rune of the Corrupted Tome',
    cost: 4,
    epic: true,
    text: 'Whenever you get a **Triple Reward**, get **two** Triple Rewards instead.',
    previewCards: ['discoverspell'], // text names it — the forge hover shows the card
    reward: { kind: 'runeCorruptedTome' },
  },
  {
    id: 'rune_conduit',
    name: 'Rune of the Conduit',
    cost: 5,
    epic: true,
    text: 'Your **Rubies** all bounce an additional time.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'runeConduit' },
    sets: ['set2'], // Rubies
  },
  {
    // The Chef banks what it handed out each shop turn; this rune spends LAST turn's total as a combat Rally.
    // Per-instance, so two Chefs each pay their own tally.
    id: 'rune_chef',
    name: 'Rune of the Chef',
    cost: 6,
    epic: true,
    text: 'Your **Chef Gary Toasts** gain **Rally:** buff **another** random Dwarf for the combined stats this granted last turn.',
    previewCards: ['dw_chef'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeChef' },
    sets: ['set2'], // Dwarves
  },
  {
    id: 'rune_bucky',
    name: 'Rune of Bucky',
    cost: 7,
    epic: true,
    text: 'Get a **Bucky**.',
    previewCards: ['dw_bucky'], // text names it — the forge hover shows the card
    reward: { kind: 'grant', cards: ['dw_bucky'] },
    sets: ['set2'], // Dwarven Ales
  },
  // ── batch 4, tranche 2 (2026-08-07): the three grant runes for the new T6 bodies ──
  {
    id: 'rune_ashen_heir',
    name: 'Rune of the Ashen Heir',
    cost: 5,
    text: 'Get an **Ashen Heir**.',
    previewCards: ['ashen_heir'],
    epic: true,
    reward: { kind: 'grant', cards: ['ashen_heir'] },
  },
  {
    id: 'rune_ancient_den',
    name: 'Rune of the Ancient Den',
    cost: 6,
    text: 'Get a **Mossmemory Colossus**.',
    previewCards: ['mossmemory_colossus'],
    epic: true,
    reward: { kind: 'grant', cards: ['mossmemory_colossus'] },
  },

  // ── batch 4, tranche 4 (2026-08-07): the five hard Epics ──
  {
    id: 'rune_ancestral_roar',
    name: 'Rune of Ancestral Roar',
    cost: 5,
    text: 'Your **Dragons** with **Shout** gain "**Echo:** trigger this minion’s Shout."',
    epic: true,
    reward: { kind: 'combatFlag', flag: 'runeAncestralRoar' },
  },
  {
    id: 'rune_ruby_shrapnel',
    name: 'Rune of Ruby Shrapnel',
    cost: 5,
    text: 'When a **Ruby**-buffed minion dies, split its Ruby bonus stats among your surviving minions.',
    previewCards: ['ruby'],
    epic: true,
    reward: { kind: 'combatFlag', flag: 'runeRubyShrapnel' },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_shared_scripture',
    name: 'Rune of Shared Scripture',
    cost: 6,
    text: 'The first **Shop spell** cast by your warband in combat triggers your left-most **Shout** and **Rally**.',
    epic: true,
    reward: { kind: 'combatFlag', flag: 'runeSharedScripture' },
  },
  {
    id: 'rune_banquet_hall',
    name: 'Rune of the Banquet Hall',
    cost: 5,
    text: 'The first **Shop-buffed** minion you buy each turn splits its bonus stats among one friendly minion of **each type**.',
    epic: true,
    reward: { kind: 'runeBanquetHall' },
  },
  {
    id: 'rune_crucible_choir',
    name: 'Rune of the Crucible Choir',
    cost: 6,
    text: '**End of Turn:** trigger your left-most **Shout**, then your left-most **Echo**.',
    epic: true,
    reward: { kind: 'runeCrucibleChoir' },
  },

  {
    id: 'rune_moonhowl',
    name: 'Rune of Moonhowl',
    cost: 5,
    text: 'Your **Mage-Pups** gain "**Echo:** cast the Shop spell this learned."',
    previewCards: ['b2_magepup'],
    epic: true,
    reward: { kind: 'combatFlag', flag: 'runeMoonhowl' },
    sets: ['set2'],
  },
  {
    id: 'rune_shared_reflection',
    name: 'Rune of Shared Reflection',
    cost: 5,
    // Owner 2026-08-11: now also HANDS OVER a Mirrorwing, on top of the cast-on-adjacent-Dragons effect.
    text: 'Get a **Mirrorwing**. The first **Shop spell** cast on each **Mirrorwing** every turn also casts on adjacent **Dragons**.',
    previewCards: ['d2_mirrorwing'],
    epic: true,
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['d2_mirrorwing'] }, { kind: 'runeSharedReflection' }] },
    sets: ['set2'],
  },
  {
    id: 'rune_living_growth',
    name: 'Rune of Living Growth',
    cost: 5,
    text: 'Whenever **Mushy** creates a **Growth**, improve future Growths by **+1/+1**.',
    previewCards: ['d2_scalefeather', 'growth'],
    epic: true,
    reward: { kind: 'runeLivingGrowth' },
    sets: ['set2'],
  },
  // ── Aug-11 minion-grant runes (Epic) ──
  {
    id: 'rune_dawnclaw',
    name: 'Rune of Dawnclaw',
    cost: 5,
    epic: true,
    text: 'Get a **Dawnclaw**. Your **Dawnclaws** also trigger their Echo at **Start of Combat**.',
    previewCards: ['b2_dawnclaw'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['b2_dawnclaw'] }, { kind: 'combatFlag', flag: 'runeDawnclaw' }] },
    sets: ['set2'],
  },
  {
    id: 'rune_sylus',
    name: 'Rune of Sylus',
    cost: 5,
    epic: true,
    text: "Get a **Sylus**. Your **Sylus** gain **Start of Combat:** double this minion's **Health**.",
    previewCards: ['sylus'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['sylus'] }, { kind: 'combatFlag', flag: 'runeSylus' }] },
  },
  {
    id: 'rune_kobold_bebes',
    name: 'Rune of Kobold Bebes',
    cost: 6,
    epic: true,
    text: 'Get a **Kobebes** with **Taunt** and **Rise**.',
    previewCards: ['k_kobabyboldies'],
    reward: { kind: 'grant', cards: ['k_kobabyboldies'], grantKeywords: ['T', 'R'] },
    sets: ['set2'],
  },
  {
    id: 'rune_herzog', // id kept (saved runs store ids); renamed Rune of Herzog → Rune of the Vaultkeeper 2026-08-12
    name: 'Rune of the Vaultkeeper',
    cost: 5,
    epic: true,
    text: 'Get a **Vaultkeeper**. Your **Vaultkeepers** also give their stats to an adjacent **Dragon**.',
    previewCards: ['d2_herzog'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['d2_herzog'] }, { kind: 'runeVaultkeeper' }] },
    sets: ['set2'],
  },
  // ── Aug-11 economy runes (Epic) ──
  {
    id: 'rune_bargain_bin',
    name: 'Rune of the Bargain Bin',
    cost: 7,
    epic: true,
    text: 'Your first **Refresh** each turn fills the Shop with minions that cost **1 Gold**. They sell for **0 Gold**.',
    reward: { kind: 'runeBargainBin' },
  },
  {
    id: 'rune_sellers_market',
    name: "Rune of the Seller's Market",
    cost: 3,
    epic: true,
    text: 'Whenever you **sell** a minion, give your minions **+4/+3**.',
    reward: { kind: 'runeSellersMarket' },
  },
  {
    id: 'rune_old_pack',
    name: 'Rune of the Old Pack',
    cost: 6,
    epic: true,
    text: 'The first **Beast** you **Resummon** each combat returns with its **full stats**.',
    reward: { kind: 'combatFlag', flag: 'oldPack' },
  },
  {
    // Owner add 2026-08-12. Grants the rune-only Voidmother (T6 Beast 6/1, Echo: summon a Void Panther).
    id: 'rune_voidmother',
    name: 'Rune of the Voidmother',
    cost: 4,
    epic: true,
    text: 'Get a **Voidmother**.',
    previewCards: ['b2_voidmother'],
    reward: { kind: 'grant', cards: ['b2_voidmother'] },
    sets: ['set2'],
  },
  {
    // Owner add 2026-08-12. Combat flag (`runeJungle`): a Beast summoned in combat doubles its Health — the
    // Health sibling of Rune of Savagery. Read in `simulate` at the summon chokepoint.
    id: 'rune_jungle',
    name: 'Rune of the Jungle',
    cost: 6,
    epic: true,
    text: 'Your **Beasts** gain **double their Health** when summoned in combat.',
    reward: { kind: 'combatFlag', flag: 'runeJungle' },
    sets: ['set2'],
  },
  {
    // Owner add 2026-08-12. Combat flag: your Beasts gain +N/+N whenever a friendly Beast dies (N starts 2),
    // and every 2 friendly deaths Avenge(2) raises N permanently (carried across combats via
    // `RunState.beastialSwarmLevel`). Read + carried back in `simulate`.
    id: 'rune_beastial_swarm',
    name: 'Rune of Beastial Swarm',
    cost: 5,
    epic: true,
    text: 'Your **Beasts** gain **+2/+2** when a friendly **Beast** dies. **Avenge (2):** Improve this permanently.',
    reward: { kind: 'combatFlag', flag: 'runeBeastialSwarm' },
    sets: ['set2'],
  },
  {
    // Owner add 2026-08-12. Grants a Beardsley + the `runeZoo` combat flag: each Beardsley's summon buff scales
    // with the running combat-summon count (1st summon 1×, 2nd 2×, …). Stacks across Beardsleys and golden.
    id: 'rune_zoo',
    name: 'Rune of the Zoo',
    cost: 6,
    epic: true,
    text: 'Get a **Beardsley**. Your **Beardsleys** trigger **1 more time** for every summon in combat.',
    previewCards: ['b2_beardsley'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['b2_beardsley'] }, { kind: 'combatFlag', flag: 'runeZoo' }] },
    sets: ['set2'],
  },

  // ── 2026-08-19 owner rune batch: EPIC ─────────────────────────────────────────────────────────────────
  // The Epic tribe faucets are the Basic ones at DOUBLE rate (owner correction 2026-08-19 — the two lists
  // reading identically was a typo). Same cost, twice the bodies.
  {
    id: 'rune_epic_dwarf',
    name: 'Rune of Epic Dwarves',
    cost: 3,
    epic: true,
    text: 'Get **2 Dwarves**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'dwarf', count: 2 },
    sets: ['set2'],
  },
  {
    id: 'rune_epic_dragon',
    name: 'Rune of Epic Dragons',
    cost: 3,
    epic: true,
    text: 'Get **2 Dragons**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'dragon', count: 2 },
    sets: ['set2'],
  },
  {
    id: 'rune_epic_beast',
    name: 'Rune of Epic Beasts',
    cost: 3,
    epic: true,
    text: 'Get **2 Beasts**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'beast', count: 2 },
    sets: ['set2'],
  },
  {
    id: 'rune_epic_demon',
    name: 'Rune of Epic Demons',
    cost: 3,
    epic: true,
    text: 'Get **2 Demons**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'demon', count: 2 },
    sets: ['set2'],
  },
  {
    id: 'rune_epic_kobold',
    name: 'Rune of Epic Kobolds',
    cost: 3,
    epic: true,
    text: 'Get **2 Kobolds**. Repeat every **Start of Turn**.',
    reward: { kind: 'runeTribeDrip', tribe: 'kobold', count: 2 },
    sets: ['set2'],
  },
  {
    id: 'rune_dragon_breath',
    name: 'Rune of Dragon Breath',
    cost: 4,
    epic: true,
    text: 'Get a **Dragonflame**. Repeat every **Start of Turn**. They cast **twice**.',
    previewCards: ['sp_dragonflame'],
    reward: { kind: 'multi', rewards: [{ kind: 'recurringGrant', cards: ['sp_dragonflame'] }, { kind: 'runeSpellDouble', spellId: 'sp_dragonflame' }] },
    sets: ['set2'],
  },
  {
    // Rides the `friendlyDemonDealtDamage` emit, so it counts exactly what the Demon-damage minions count: a
    // LANDED hit (a Ward-absorbed one never reaches the emit). Combat-only — the gains carry back only for a
    // body that is Engraved, the standing rule for every combat stat gain.
    id: 'rune_ruins',
    name: 'Rune of Ruins',
    cost: 6,
    epic: true,
    text: 'When a friendly **Demon** deals damage, give your minions **+2/+2**.',
    reward: { kind: 'combatFlag', flag: 'runeRuins' },
    sets: ['set2'], // Demons + the Demon-damage trigger
  },
  {
    id: 'rune_engraving_gems',
    name: 'Rune of Engraving Gems',
    cost: 4,
    epic: true,
    text: 'Your **Rubies** applied in combat are **permanent**.',
    previewCards: ['ruby'],
    reward: { kind: 'combatFlag', flag: 'runeEngravingGems' },
    sets: ['set2'], // Rubies
  },
  {
    // Two stacked `shoutRepeat: always` grants — the reward stacks by design (see the reducer branch), so this
    // is +2 triggers rather than a new flag. Rune of the Choir is the +1 version at a lower cost.
    id: 'rune_blasting_voices',
    name: 'Rune of Blasting Voices',
    cost: 6,
    epic: true,
    text: 'Your **Shouts** trigger **2 extra times** in combat.',
    reward: { kind: 'multi', rewards: [{ kind: 'shoutRepeat', scope: 'always' }, { kind: 'shoutRepeat', scope: 'always' }] },
  },

  // ── 2026-08-19 owner rune batch (third wave) ──────────────────────────────────────────────────────────
  {
    // BACK to Epic 2026-08-19 (owner) — the def moves between arrays, since `runeforgePool` reads membership.
    // Reworked with it: the clause is no longer a second EAT but the meal SHARED SIDEWAYS to the neighbours.
    id: 'rune_blart',
    name: 'Rune of Blart',
    cost: 4,
    epic: true,
    text: 'Get a **Bob Blart**. Whenever your **Bob Blarts** trigger, grant the stats to **adjacent minions**, too.',
    previewCards: ['dm_gourmand'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['dm_gourmand'] }, { kind: 'runeBlart' }] },
    sets: ['set2'],
  },
  {
    // Budgeted at 2 per combat in the sim — re-granting Rise on a Rise is otherwise unbounded, since each
    // return would arm the next forever.
    id: 'rune_deathtouched_apple',
    name: 'Rune of the Deathtouched Apple',
    cost: 4,
    epic: true,
    text: 'When a minion **Rises**, give it **Rise**. (2 uses per combat)',
    reward: { kind: 'combatFlag', flag: 'runeDeathtouchedApple' },
  },
  {
    id: 'rune_held_strength',
    name: 'Rune of Held Strength',
    cost: 3,
    epic: true,
    // OWNER REWORK 2026-08-27 (q-runedup-oneshot revise): "rune of the held strength should not be a one-shot
    // rune and should be a 'Start of Combat: give xyz' rune" — now a standing Start-of-Combat grant, read
    // live off the hand each fight.
    text: '**Start of Combat:** give your **left and right-most minions** the stats of the **left-most minion card in your hand**.',
    reward: { kind: 'runeHeldStrength' },
  },
  {
    // Chipper's own shape as a run-wide rune. "ANOTHER" is load-bearing — the Demon you just played never
    // feeds itself (that is Chipper's `self: true`, a different card).
    id: 'rune_chipper_sticker',
    name: 'Rune of the Chipper Sticker',
    cost: 5,
    epic: true,
    text: 'Whenever you play a **Demon**, another friendly **Demon** Consumes a minion in the Shop.',
    reward: { kind: 'runeChipperSticker' },
    sets: ['set2'], // Consume-from-the-Shop
  },
  {
    id: 'rune_rising_echoes',
    name: 'Rune of Rising Echoes',
    cost: 4,
    epic: true,
    text: 'Discover an **Echo** minion. Give it **Rise** and **Taunt**. Your first **Echo** triggers an additional time in combat.',
    reward: { kind: 'multi', rewards: [
      { kind: 'discover', filter: 'deathrattle', grantKeywords: ['R', 'T'] },
      { kind: 'echoRepeat', scope: 'firstEachCombat' },
    ] },
  },
  {
    // The triggered cast is a REAL cast (spell power, the spell counters) but latched against re-entry — the
    // cast it fires would otherwise re-enter the hook that cast it.
    id: 'rune_might',
    name: 'Rune of Might',
    cost: 6,
    epic: true,
    text: 'Whenever you cast a spell, cast **Might of Aeon**.',
    previewCards: ['mightofaeon'],
    reward: { kind: 'runeMight' },
  },

  // -- 2026-08-20 owner rune batch: EPIC ---------------------------------------------------------------
  {
    // Living Magic's budget at 2 uses - the same reward kind, one number apart.
    id: 'rune_perfect_recall',
    name: 'Rune of Perfect Recall',
    cost: 6,
    epic: true,
    text: '**Twice per turn**, after you cast a spell, get a **copy** of it.',
    reward: { kind: 'runeSpellEcho', uses: 2 },
  },
  {
    id: 'rune_ninefold_commerce',
    name: 'Rune of Ninefold Commerce',
    cost: 6,
    epic: true,
    text: 'Get a **Ninefold Broker**.',
    reward: { kind: 'grant', cards: ['n2_ninefold'] },
  },
  {
    id: 'rune_borrowed_echoes',
    name: 'Rune of Borrowed Echoes',
    cost: 5,
    epic: true,
    text: 'Get an **Echo Mimic**.',
    reward: { kind: 'grant', cards: ['n2_echomimic'] },
  },
  {
    // RENAMED from the owner's "Rune of the Muster" (2026-08-20): that name is already taken by the free-refresh
    // rune, and two runes cannot share a name inside one set (`validateRunes`).
    id: 'rune_muster_general',
    name: 'Rune of the Muster General',
    cost: 5,
    epic: true,
    text: 'Get a **Muster General**.',
    reward: { kind: 'grant', cards: ['n2_muster'] },
  },
  {
    id: 'rune_delayed_duplication',
    name: 'Rune of Delayed Duplication',
    cost: 5,
    epic: true,
    text: 'Get a **Stonehorn Archivist**.',
    reward: { kind: 'grant', cards: ['b2_stonehorn'] },
  },
  {
    id: 'rune_ascension',
    name: 'Rune of Ascension',
    cost: 5,
    epic: true,
    text: 'Get a **Skybound Ascendant**.',
    reward: { kind: 'grant', cards: ['d2_ascendant'] },
  },
  {
    // END OF TURN, as the owner's sheet always said. It shipped as Start of Combat only because there was no
    // recruit-phase Rally dispatch in the engine (Rally is an `onAttack` COMBAT trigger). The Effect Arena's
    // Rally family (Step 3 item 4) put every Rally body on one shared implementation, and `fireRallies` /
    // `fireShopRally` (Step 4) dispatch them from the shop — so the rune now pays out where it reads, one
    // BEAT PER RALLY so each has room to animate.
    id: 'rune_lasting_cadence',
    name: 'Rune of Lasting Cadence',
    cost: 5,
    epic: true,
    text: '**End of Turn:** trigger **all** your **Rally** effects.',
    reward: { kind: 'runeLastingCadence' },
  },
  {
    // The SECOND cross-phase dispatcher rune (2026-08-20), built on Lasting Cadence's motion: the Effect
    // Arena's Start-of-Combat family (Step 3 item 4) put every SC body on one shared implementation, and
    // `fireShopStartOfCombat` (Step 4) dispatches them from the shop at End of Turn — one BEAT PER EFFECT
    // so each has room to animate. Combat behaviour is untouched: the real Start of Combat still fires.
    id: 'rune_combat_prowess',
    name: 'Rune of Combat Prowess',
    cost: 5,
    epic: true,
    text: 'Your **Start of Combat** effects also trigger at **End of Turn**.',
    reward: { kind: 'runeCombatProwess' },
  },
  {
    // RENAMED from the owner's "Rune of Living Geodes" (2026-08-20) - Rune of the Living Geode already exists
    // and is a different rune (the Geode Guardian grant). Engraving + Gemstorm in one Avenge.
    id: 'rune_deepening_vein',
    name: 'Rune of the Deepening Vein',
    cost: 5,
    epic: true,
    text: '**Avenge (3):** improve your **Rubies** by **+1/+1** and cast a **Ruby** on every friendly **Kobold**.',
    previewCards: ['ruby'],
    reward: { kind: 'combatFlag', flag: 'runeDeepeningVein' },
    sets: ['set2'], // Rubies + Kobolds
  },
  {
    // RENAMED from the owner's "Rune of Evolution" (2026-08-20) - Rune of Evolution already exists and is the
    // transform-your-board rune.
    id: 'rune_abomination',
    name: 'Rune of the Abomination',
    cost: 5,
    epic: true,
    text: 'Get an **Evolving Abomination**.',
    reward: { kind: 'grant', cards: ['n2_abomination'] },
  },
  {
    id: 'rune_bottomless_portrait',
    name: 'Rune of the Bottomless Portrait',
    cost: 5,
    epic: true,
    text: 'Get an **Arcane Behemoth**.',
    reward: { kind: 'grant', cards: ['dm_behemoth'] },
  },
];

/**
 * THE RUNE ARCHIVE (owner 2026-08-04) — the rune counterpart of `cards/archive.ts`: removed from play, not
 * from code. An archived rune is in NEITHER forge stock, so it can never be offered — but it stays in
 * `RUNE_INDEX`, so a saved run that already owns it keeps its badge, text and reward machinery.
 * Brokerage went in alongside its subject: Ruby Broker was archived the same day.
 */
export const ARCHIVED_RUNES: RuneDef[] = [
  // ── 2026-08-18 owner archive batch (each retired alongside its now-archived subject minion) ──────────────
  {
    // ARCHIVED 2026-08-18 (owner). Was an Epic rune. Quil (b2_quil) itself stays in the pool.
    id: 'rune_wildscript',
    name: 'Rune of the Wildscript',
    cost: 5,
    epic: true,
    text: 'Get a **Quil**.',
    previewCards: ['b2_quil'],
    reward: { kind: 'grant', cards: ['b2_quil'] },
  },
  {
    // ARCHIVED 2026-08-18 (owner) — Water Dragon archived
    id: 'rune_flooded_vault',
    name: 'Rune of the Flooded Vault',
    cost: 5,
    text: "When **Water Dragon’s** Avenge triggers, also cast the **left-most spell** in your hand without consuming it.",
    previewCards: ['d2_curator'],
    reward: { kind: 'combatFlag', flag: 'runeFloodedVault' },
    sets: ['set2'],
  },
  {
    // ARCHIVED 2026-08-18 (owner) alongside Imp Wrangler (dm_wrangler).
    id: 'rune_wrangler',
    name: 'Rune of the Wrangler',
    cost: 3,
    text: 'Get an **Imp Wrangler**. Imps summoned by your **Imp Wranglers** have **Ward** and **Taunt**.',
    previewCards: ['dm_wrangler'],
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['dm_wrangler'] }, { kind: 'combatFlag', flag: 'runeWrangler' }] },
    sets: ['set2'],
  },
  {
    // ARCHIVED 2026-08-18 (owner) alongside Broodwright (dm_broodwright).
    id: 'rune_broodmaster',
    name: 'Rune of the Broodmaster',
    cost: 5,
    text: 'Whenever a **Broodwright** buffs an Imp, it also gains those stats.',
    previewCards: ['dm_broodwright', 'impscrap'], // text names the Imp too
    epic: true,
    reward: { kind: 'runeBroodmaster' },
    sets: ['set2'],
  },
  {
    // ARCHIVED 2026-08-18 (owner) alongside Prismcaster (k_prismcaster).
    id: 'rune_battle_refraction',
    name: 'Rune of Battle Refraction',
    cost: 6,
    text: 'Your **Prismcasters** also repeat **Rubies** played during combat.',
    previewCards: ['k_prismcaster'],
    epic: true,
    reward: { kind: 'combatFlag', flag: 'runeBattleRefraction' },
    sets: ['set2'],
  },
  // ── 2026-08-12 owner archive batch (each retired alongside its subject minion, except Spellhide) ─────────
  {
    // Archived 2026-08-12 (owner) alongside Groveweaver.
    id: 'rune_groveweaver',
    name: 'Rune of the Groveweaver',
    cost: 6,
    epic: true,
    text: 'When your **Groveweavers** buff a friendly Beast, they also buff **themselves**.',
    previewCards: ['b2_groveweaver'], // text names it — the forge hover shows the card
    reward: { kind: 'runeGroveweaver' },
  },
  {
    // Archived 2026-08-12 (owner) alongside Runebloom Matriarch.
    // Doubles Runebloom Matriarch's per-spell trigger — recruit-phase, where the card actually fires.
    id: 'rune_matriarch',
    name: 'Rune of the Matriarch',
    cost: 5,
    epic: true,
    text: 'Your **Runebloom Matriarchs** trigger spells in combat an **additional time**.',
    previewCards: ['b2_runebloom'], // text names it — the forge hover shows the card
    reward: { kind: 'runeMatriarch' },
    sets: ['set2'], // Runebloom Matriarch is a set-2 Beast
  },
  {
    // Archived 2026-08-12 (owner) alongside Badgington.
    // Pure data: the existing grant reward already carries `grantKeywords`, so the Badger is a Badgington
    // handed over with Flurry (W) and Ward (DS) stamped on.
    id: 'rune_badger',
    name: 'Rune of the Badger',
    cost: 5,
    text: 'Get a **Badgington** with **Flurry** and **Ward**.',
    previewCards: ['badgington'], // text names it — the forge hover shows the card
    reward: { kind: 'grant', cards: ['badgington'], grantKeywords: ['W', 'DS'] },
  },
  {
    // Archived 2026-08-12 (owner). Its `runeSpellhide` reward stays wired for saved runs that hold it.
    id: 'rune_spellhide',
    name: 'Rune of Spellhide',
    cost: 4,
    text: 'The first stat-granting **Shop spell** you cast on a **Beast** each turn is cast on it again at **Start of Combat**.',
    reward: { kind: 'runeSpellhide' },
  },
  {
    // Archived 2026-08-08 (owner) alongside Scavvers itself — with the card out of every set pool the rune
    // had nothing left to modify. The def stays so a saved run holding it still resolves through `RUNE_INDEX`.
    id: 'rune_second_life',
    name: 'Rune of the Second Life',
    cost: 4,
    text: 'Your **Scavvers** have **Taunt** and **Rise**.',
    previewCards: ['b2_scavenger'],
    epic: true,
    reward: { kind: 'runeSecondLife' },
    sets: ['set2'],
  },
  {
    // Archived 2026-08-07 (owner), the day it shipped. The def stays here so a saved run that already holds it
    // still resolves through `RUNE_INDEX`; it is simply no longer stocked by the Runeforge.
    //
    // NOTE: this was the ONLY way to obtain a Runesnout Archivist (the card is `token: true`, so it never
    // rolls in the tavern). With the rune out of stock the Archivist is unreachable in a new run — its card,
    // its effects and its art all remain wired and tested, ready for whatever grants it next.
    id: 'rune_wild_memory',
    name: 'Rune of Wild Memory',
    cost: 5,
    text: 'Get a **Runesnout Archivist**.',
    previewCards: ['runesnout_archivist'],
    epic: true,
    reward: { kind: 'grant', cards: ['runesnout_archivist'] },
  },
  {
    // Archived 2026-08-07 (owner) alongside Menagerie Mammoth's rework — its subject no longer has the
    // Attack-only grant this rune symmetrised. The def and `runeMammoth` flag stay for saved runs.
    id: 'rune_mammoth',
    name: 'Rune of the Mammoth',
    cost: 4,
    epic: true,
    text: 'Your **Menagerie Mammoths** also give **Health**, 1:1 with their Attack.',
    previewCards: ['b2_mammoth'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeMammoth' },
    sets: ['set2'], // the Mammoth is a set-2 Beast
  },
  {
    // Archived 2026-08-07 (owner): out of both forge stocks, but the def and its `runeRemains` combat flag stay
    // so a saved or replayed run that already owns it keeps its badge, text and payout.
    id: 'rune_remains',
    name: 'Rune of the Remains',
    cost: 3,
    text: 'When you summon **5 minions** in combat, **permanently** give minions in the **Shop +3/+3**.',
    reward: { kind: 'combatFlag', flag: 'runeRemains', amount: 3 },
  },
  {
    id: 'rune_brokerage',
    name: 'Rune of the Brokerage',
    cost: 2,
    epic: true,
    text: 'Your **Ruby Brokers** can be triggered **endlessly**.',
    previewCards: ['k_rubybroker'], // its subject is in the MINION archive — the pair retire together
    reward: { kind: 'runeBrokerage' },
    sets: ['set2'], // Rubies
  },
];

/** Lookup across BOTH runesets AND the archive — the forge stocks share one id space with the archived
 *  runes, so the owned-rune badges / card lookups resolve any rune a run has ever picked up. */
export const RUNE_INDEX: Record<string, RuneDef> = Object.fromEntries(
  [...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES].map((r) => [r.id, r]),
);

/** Zod-validate every rune in BOTH sets (shape + reward palette), and reject DUPLICATE ids or names.
 *  Throws on a malformed rune. The duplicate check exists because a second identical Rune of the High King
 *  actually shipped (2026-07-31): `RUNE_INDEX` silently collapses duplicate ids, the Runeforge stocked the
 *  rune twice, and the Compendium's duplicate React keys smeared extra copies across the gallery. */
export function validateRunes(runes: RuneDef[] = [...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES]): void {
  const ids = new Set<string>();
  // Names are unique PER SET, not globally: the Menagerie deliberately exists twice under one name — a set-1
  // and a set-2 twin with disjoint `sets`, so no single run can ever be offered both. A rune with no `sets`
  // is available everywhere and therefore collides with every scope.
  const names = new Map<string, Set<string>>();
  for (const r of runes) {
    RuneDefSchema.parse(r);
    if (ids.has(r.id)) throw new Error(`duplicate rune id: ${r.id}`);
    ids.add(r.id);
    const scopes = r.sets ?? ['*'];
    const seen = names.get(r.name) ?? new Set<string>();
    for (const sc of scopes) {
      if (seen.has(sc) || seen.has('*') || (sc === '*' && seen.size > 0)) {
        throw new Error(`duplicate rune name in one set: ${r.name} (${sc})`);
      }
      seen.add(sc);
    }
    names.set(r.name, seen);
  }
}

/**
 * RUNE DUPLICATE CLASSIFICATION (owner rulings 2026-08-27, decisions q-runedup-*). Since the duplicate-
 * stacking pass, EVERY duplicate does something: most stack per their family rule (recurring effects fire per
 * copy, meters pay double at the trip, repeats add +1, one-shots re-grant, engines double their output); the
 * two sets below are the ruled exceptions. The sim's buy path and forge filter consume these
 * (`packages/sim/src/runeDup.ts`); the Runeforge card shows the matching pill while Duplication is held.
 */
/** Duplicates that pay the universal SWEETENER (Gold = half the rune's printed cost rounded up, plus a free
 *  refresh) instead of stacking — each is genuinely idempotent. Per-rune reasons in `runeDup.ts`. */
export const RUNE_DUP_SWEETENER: ReadonlySet<string> = new Set([
  'rune_twin_gilding', 'rune_spellstone', 'rune_trophy', 'rune_engraving_gems', 'rune_centerline',
  'rune_vanguard', 'rune_living_treasure', 'rune_chef', 'rune_ancestral_roar', 'rune_moonhowl',
]);

/** Duplicates that do NOTHING — owner ruled unique ("rune of the ornate clock should do nothing if
 *  duplicated, that one is unique"). The forge filter never re-offers them once owned. */
export const RUNE_DUP_UNIQUE: ReadonlySet<string> = new Set(['rune_ornate_clock']);

/** True when a second copy of `rune` genuinely stacks (the overwhelming majority since 2026-08-27) — the
 *  Runeforge shows a sweetener/no-stack pill for the exceptions while Rune of Duplication is held, so the
 *  promise on the card stays honest. */
export function runeStacks(rune: RuneDef): boolean {
  return !RUNE_DUP_SWEETENER.has(rune.id) && !RUNE_DUP_UNIQUE.has(rune.id);
}
