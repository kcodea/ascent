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
    cost: 5, // owner balance 2026-08-04
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
    id: 'rune_pillaging',
    sets: ['set1'],
    name: 'Rune of Pillaging',
    cost: 6,
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
    cost: 5,
    text: 'Whenever you cast a Shop spell, improve your **Imps** by **+1/+1** wherever they are.',
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
    cost: 4,
    text: '**End of Turn:** get **2 random Dwarven Ales**.',
    reward: { kind: 'recurringEndOfTurn', effect: 'grantAles' },
    sets: ['set2'], // Ales
  },
  {
    id: 'rune_chorus',
    name: 'Rune of the Chorus',
    cost: 3,
    text: 'When you trigger **3 Shouts**, get a random **Shop spell**.',
    reward: { kind: 'runeThreshold', meter: 'shout', per: 3, grantSpell: 1 },
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
    cost: 4,
    text: 'Every **3 Shop spells** you cast, give minions in the **Shop +3/+3**.',
    reward: { kind: 'runeThreshold', meter: 'spellCast', per: 3, buff: { target: 'shop', attack: 3, health: 3 } },
  },
  {
    id: 'rune_cindergem',
    name: 'Rune of the Cindergem',
    cost: 4,
    text: 'Every **3 Rubies** you cast, improve your **Imps by +2/+2**.',
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'runeThreshold', meter: 'castRuby', per: 3, buff: { target: 'imps', attack: 2, health: 2 } },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_showcase',
    name: 'Rune of the Showcase',
    cost: 3,
    text: 'When you spend **10 Gold**, give the **right-most minion** in the Shop **+4/+4**.',
    reward: { kind: 'runeThreshold', meter: 'gold', per: 10, buff: { target: 'shopRightmost', attack: 4, health: 4 } },
  },
  {
    // `oncePerTurn` is the whole difference from the Chorus — a Shout-heavy turn pays once, not four times.
    id: 'rune_merchants_chorus',
    name: "Rune of the Merchant's Chorus",
    cost: 3,
    text: 'After you trigger **3 Shouts** in a turn, give minions in the **Shop +4/+4**. Once per turn.',
    reward: { kind: 'runeThreshold', meter: 'shout', per: 3, buff: { target: 'shop', attack: 4, health: 4 }, oncePerTurn: true },
  },
  {
    // Pure data — `rallyRepeat`/`firstEachCombat` already exists (Spark Permit, Overclocked Core).
    id: 'rune_stampede',
    name: 'Rune of the Stampede',
    cost: 4,
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
    cost: 1,
    text: 'Your **first 2 Rubies** played from hand each turn cast an **extra time**. Get **2 Rubies** every turn.',
    previewCards: ['ruby'], // text names it — the forge hover shows the card
    reward: { kind: 'multi', rewards: [{ kind: 'rubyExtraCasts', amount: 1, scope: 'firstEachTurn', firstN: 2 }, { kind: 'recurringEndOfTurn', effect: 'grantRuby2' }] },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_investment',
    name: 'Rune of Investment',
    cost: 3, // owner balance 2026-08-04
    text: 'Get **2 Rubies** when you **sell** a minion.',
    previewCards: ['ruby'], // names Rubies — forge hover shows the live Ruby (audit 2026-08-06)
    reward: { kind: 'runeSellRubies', count: 2 },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_last_call',
    name: 'Rune of Last Call',
    cost: 1,
    text: '**Avenge (3):** get a random **Dwarven Ale**.',
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
    text: 'Every **4 friendly deaths** in combat, gain **4 Gold** next turn.',
    reward: { kind: 'combatFlag', flag: 'runeBloodAndCoin', amount: 4 },
  },
  {
    id: 'rune_remains',
    name: 'Rune of the Remains',
    cost: 3,
    text: 'When you summon **5 minions** in combat, **permanently** give minions in the **Shop +3/+3**.',
    reward: { kind: 'combatFlag', flag: 'runeRemains', amount: 3 },
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
    text: 'When you have **space** in combat, summon an **Imp** with **Ward** and **Taunt**. **3 times** per combat.',
    previewCards: ['impscrap'], // text names it — the forge hover shows the card
    reward: { kind: 'combatFlag', flag: 'runeBrood', amount: 3 },
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
    cost: 6,
    text: '**End of Turn:** give your **three left-most minions +1/+1** for each card you played this turn.',
    reward: { kind: 'recurringEndOfTurn', effect: 'runeAction' },
  },
  {
    id: 'rune_epic_forge',
    name: 'Rune of the Epic Forge',
    cost: 3,
    // An EARLY epic forge: turn 8, one turn ahead of the systemic turn-9 visit (owner 2026-07-31). A
    // schedule to wave 9 itself would do nothing — the baseline already sets the same boolean there.
    text: 'Visit an **additional Epic Forge** on turn 8.',
    reward: { kind: 'scheduleRuneforge', forge: 'epic', onWave: 8 },
  },
  {
    id: 'rune_kindling',
    name: 'Rune of Kindling',
    cost: 5, // owner balance 2026-08-04
    text: 'Whenever you cast a Shop spell, give your **left-most minion +3/+3**.',
    reward: { kind: 'runeKindling' },
  },
  {
    id: 'rune_pair',
    name: 'Rune of the Pair',
    cost: 3,
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
    text: 'Get **7 Rubies** that give **+3/+3**.',
    previewCards: ['ruby'], // names Rubies — forge hover shows the live Ruby (audit 2026-08-06)
    reward: { kind: 'mintRubies', count: 7, attack: 3, health: 3 },
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
    cost: 5,
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
    cost: 5,
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
    cost: 5,
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
    cost: 4,
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
    cost: 6,
    text: 'Your **Shout** minions have a **20%** chance to return to your hand after you play them.',
    reward: { kind: 'runeRefrain' },
  },
  {
    id: 'rune_trophy',
    name: 'Rune of the Trophy',
    cost: 5,
    text: 'Get a copy of the first minion you **kill** in combat.',
    reward: { kind: 'combatFlag', flag: 'runeTrophy' },
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
    text: '**End of Turn:** trigger your left-most **Echo**.',
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
    cost: 3,
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
    // Doubles Runebloom Matriarch's per-spell trigger — recruit-phase, where the card actually fires.
    id: 'rune_matriarch',
    name: 'Rune of the Matriarch',
    cost: 5,
    epic: true,
    text: 'Your **Runebloom Matriarchs** trigger **twice**.',
    previewCards: ['b2_runebloom'], // text names it — the forge hover shows the card
    reward: { kind: 'runeMatriarch' },
    sets: ['set2'], // Runebloom Matriarch is a set-2 Beast
  },
  {
    id: 'rune_stormcalling',
    name: 'Rune of Stormcalling',
    cost: 5,
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
    id: 'rune_soul_taxes',
    sets: ['set1'],
    name: 'Rune of Soul Taxes',
    cost: 4,
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
    text: 'Whenever you cast a **Shop spell**, give your **Dragons +2/+2**.',
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
    text: 'Minions summoned in combat gain **Ward**.',
    reward: { kind: 'combatFlag', flag: 'runeUndertow' },
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
    text: 'When you **sell** a minion, give its **bonus stats** to the **right-most Shop** minion.',
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
    cost: 5,
    epic: true,
    text: 'When you spend **10 Gold**, play a **Ruby** on all of your minions.',
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
    // Owner add 2026-08-02: the Mammoth's Attack-only grant becomes 1:1 symmetric (+3/+3, +6/+6, …).
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
    cost: 6,
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
    // Owner sheet 2026-07-31: the Ales RECUR — 3 random Ales every turn, not a one-shot trio.
    text: 'Get an **Edward Keg-hands**, and **3 random Dwarven Ales** every turn.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['dw_edward'] }, { kind: 'recurringEndOfTurn', effect: 'grantAles3' }] },
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
    text: 'Every **3 cards** you buy, get a random **Shop spell**.',
    reward: { kind: 'runeThreshold', meter: 'cardsBought', per: 3, grantSpell: 1 },
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
    text: '**Avenge (3):** improve your **Imps by +6/+6** wherever they are.',
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
    text: '**Avenge (2):** play **2 Rubies** on each friendly **Kobold**.',
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
    // The Health-only, board-wide sibling of The Old Hunt — and its step GROWS, where the quest's does not.
    id: 'rune_wild_hunt',
    name: 'Rune of the Wild Hunt',
    cost: 3,
    epic: true,
    // Owner rebalance 2026-08-02: 3 -> 1 Health per attack. `amount` is BOTH the grant and the escalation
    // step (see the wildHunt block in simulate), so one number moves both halves together.
    text: 'When a **Beast** attacks, give your minions **+1 Health** and improve this by **1** permanently.',
    reward: { kind: 'combatFlag', flag: 'runeWildHunt', amount: 1 },
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
    text: 'Play a **Ruby** on all of your minions every friendly **attack** in combat.',
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
    cost: 5,
    epic: true,
    text: 'Whenever you summon a minion that **does not fit**, give your minions **+4/+4 permanently**.',
    reward: { kind: 'combatFlag', flag: 'runeOverflow', amount: 4 },
  },
  {
    // Counted through a narrow helper, NOT `noteSpellCast` — the Ruby path already fires the Ruby+Spell umbrella
    // and spends the Grimoire charge, so reusing that function would double-fire every "every 3 casts" card.
    id: 'rune_spellstone',
    name: 'Rune of the Spellstone',
    cost: 6,
    epic: true,
    text: '**Rubies** you cast count as **Shop spells**.',
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
];

/**
 * THE RUNE ARCHIVE (owner 2026-08-04) — the rune counterpart of `cards/archive.ts`: removed from play, not
 * from code. An archived rune is in NEITHER forge stock, so it can never be offered — but it stays in
 * `RUNE_INDEX`, so a saved run that already owns it keeps its badge, text and reward machinery.
 * Brokerage went in alongside its subject: Ruby Broker was archived the same day.
 */
export const ARCHIVED_RUNES: RuneDef[] = [
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
