import type { RuneDef } from '@game/core';
import { RuneDefSchema } from './schema';

/**
 * Runes — the Basic Runeforge stock (opened by the Runesmith hero on turn 7; the Epic Runeforge — via the
 * Runeguard hero on turn 12, or the Epic Commission quest — draws from EPIC_RUNES below). The forge offers a
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
    id: 'rune_slaying',
    name: 'Rune of Slaying',
    cost: 3,
    text: 'Whenever you trigger **Slaughter**, gain **+1 max Gold**.',
    reward: { kind: 'combatFlag', flag: 'runeSlaying' },
  },
  {
    id: 'rune_spending',
    name: 'Rune of Spending',
    cost: 3,
    text: '**End of Turn:** gain **+1 max Gold** and give your left-most minion **+1/+1** for each Gold spent this turn.',
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
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['pillager'] }, { kind: 'goldPouchValue', value: 2 }] },
  },
  {
    id: 'rune_fury',
    name: 'Rune of Fury',
    cost: 6,
    text: 'Your **Avenge** effects trigger twice.',
    reward: { kind: 'combatFlag', flag: 'runeFury' },
  },
  {
    id: 'rune_summoning',
    name: 'Rune of Summoning',
    cost: 5,
    text: 'Whenever you cast a Shop spell, improve your **Imps** by **+1/+1** wherever they are.',
    reward: { kind: 'runeSummoning' },
  },
  {
    id: 'rune_forthcoming',
    name: 'Rune of Forthcoming',
    cost: 2,
    text: 'You **always attack first**.',
    reward: { kind: 'combatFlag', flag: 'runeForthcoming' },
  },
  // ── Moved into the Basic forge (2026-07-10 re-batch) ──
  {
    id: 'rune_rallying',
    name: 'Rune of Rallying',
    cost: 5,
    text: '**Start of Combat:** trigger your **Rally** effects.',
    reward: { kind: 'combatFlag', flag: 'runeRallying' },
  },
  {
    // RENAMED from "Rune of Scale" (owner 2026-07-29): it sat one character from the epic "Rune of Scales", which
    // is a Dragon card — scales belong to Dragons, so the Gold-scaling rune is the one that moves. The ID is
    // deliberately unchanged: `ownedRunes` on saved runs stores ids, and renaming it would orphan them.
    id: 'rune_scale',
    name: 'Rune of Bulk Order',
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
    text: 'Minions summoned by an **Echo** have **+3/+3** and **Taunt**.',
    reward: { kind: 'combatFlag', flag: 'runeHatchery' },
  },
  {
    // Two halves, both existing primitives: the per-turn Ruby multicast and an End-of-Turn Ruby.
    id: 'rune_resonance',
    name: 'Rune of Resonance',
    cost: 1,
    text: 'Your **first Ruby** played from hand each turn casts an **extra time**. Get a **Ruby** every turn.',
    reward: { kind: 'multi', rewards: [{ kind: 'rubyExtraCasts', amount: 1, scope: 'firstEachTurn' }, { kind: 'recurringEndOfTurn', effect: 'grantRuby' }] },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_investment',
    name: 'Rune of Investment',
    cost: 1,
    text: 'Get **2 Rubies** when you **sell** a minion.',
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
    text: 'Visit the **Epic Forge** on turn 9.',
    reward: { kind: 'scheduleRuneforge', forge: 'epic', onWave: 9 },
  },
  {
    id: 'rune_kindling',
    name: 'Rune of Kindling',
    cost: 6,
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
    cost: 4,
    text: 'Get **5 Rubies**.',
    reward: { kind: 'grant', cards: ['ruby', 'ruby', 'ruby', 'ruby', 'ruby'] },
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
    id: 'rune_quick_study',
    name: 'Rune of Quick Study',
    cost: 5,
    text: 'Get **3 random Shop spells**.',
    reward: { kind: 'grant', randomSpell: 3 },
  },
  {
    // The BASIC route to Tier 7 (Summit is parked, so no rift grants it). Every 2nd shop, Discover a Tier 7
    // minion — the reward's tier is AUTHORED, so the reducer honours it rather than clamping to the run's
    // ceiling. Repeats for the rest of the run.
    id: 'rune_summit',
    name: 'Rune of the Summit',
    cost: 5,
    text: '**In 2 turns:** **Discover** a **Tier 7** minion. Repeats every **2 turns**.',
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
    text: 'Whenever you summon a **Beast** in combat, give your **Beasts +1/+1**.',
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
    id: 'rune_rebirth',
    name: 'Rune of Rebirth',
    cost: 4,
    text: '**Start of Combat:** give **2 random** friendly minions **Rise**.',
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
    text: 'Triggering an **Echo** gives your minions **+4/+4**.',
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
    text: '**Avenge (4):** summon **2 Imps with Taunt**.',
    reward: { kind: 'combatFlag', flag: 'runeBroodpit' },
  },
  {
    id: 'rune_spearline',
    sets: ['set1'],
    name: 'Rune of the Spearline',
    cost: 7,
    epic: true,
    text: '**Avenge (4):** summon a **Spear Warden**. It attacks immediately.',
    reward: { kind: 'combatFlag', flag: 'runeSpearline' },
  },
  {
    id: 'rune_appraisal',
    name: 'Rune of Appraisal',
    cost: 3,
    epic: true,
    text: '**Avenge (4):** improve your Shop spells by **+1/+1**.',
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
    id: 'rune_stormcalling',
    name: 'Rune of Stormcalling',
    cost: 5,
    epic: true,
    text: 'Get a **Gilded Karwind** and a random **Shout** minion.',
    reward: { kind: 'grant', grantGolden: ['karwind'], randomFilter: 'shout', randomFilterCount: 1 },
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
    text: 'Whenever you cast a **Shop spell**, give your **Dragons +1/+1**.',
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
    id: 'rune_second_path',
    name: 'Rune of the Second Path',
    cost: 4,
    epic: true,
    text: '**Discover** a **Greater Quest** reward minion.',
    reward: { kind: 'discoverGreaterQuest' },
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
    id: 'rune_champion',
    name: 'Rune of the Champion',
    cost: 3,
    epic: true,
    text: '**Discover** a **Tier 6** minion.',
    reward: { kind: 'discover', tier: 6 },
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
    text: '**End of Turn:** cast the **first Shop spell** you cast this turn again.',
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
    text: '**Start of Shop:** trigger all your **End of Turn** effects.',
    reward: { kind: 'runeConductor' },
  },
  {
    id: 'rune_undertow',
    name: 'Rune of the Undertow',
    cost: 4,
    epic: true,
    text: 'Minions summoned by an **Echo** attack immediately.',
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
    text: 'Get an **Edward Keg-hands** and **3 Dwarven Ales**.',
    reward: { kind: 'grant', cards: ['dw_edward'], randomAle: 3 },
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
    // Distinct from Rune of Mykel (which grants High King Mykel) — this one is the Brill grant.
    id: 'rune_high_king',
    name: 'Rune of the High King',
    cost: 4,
    epic: true,
    text: 'Get a **Dwarf King, Brill**.',
    reward: { kind: 'grant', cards: ['dw_brill'] },
    sets: ['set2'],
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
    id: 'rune_brokerage',
    name: 'Rune of the Brokerage',
    cost: 2,
    epic: true,
    text: 'Your **Ruby Brokers** can be triggered **endlessly**.',
    reward: { kind: 'runeBrokerage' },
    sets: ['set2'], // Rubies
  },
  {
    id: 'rune_cinder_ledger',
    name: 'Rune of the Cinder Ledger',
    cost: 3,
    epic: true,
    text: '**Avenge (3):** improve your **Imps by +6/+6** wherever they are.',
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
];

/** Lookup across BOTH runesets — the normal forge stock and the Epic forge stock share one id space so the
 *  owned-rune badges / card lookups resolve any rune the run has picked up. */
export const RUNE_INDEX: Record<string, RuneDef> = Object.fromEntries(
  [...RUNES, ...EPIC_RUNES].map((r) => [r.id, r]),
);

/** Zod-validate every rune in BOTH sets (shape + reward palette). Throws on a malformed rune. */
export function validateRunes(runes: RuneDef[] = [...RUNES, ...EPIC_RUNES]): void {
  for (const r of runes) RuneDefSchema.parse(r);
}
