import type { RuneDef } from '@game/core';
import { RuneDefSchema } from './schema';

/**
 * Runes — the Runesmith's Runeforge stock. On turn 6 the forge offers a random 3 of these; the player buys ONE
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
    text: 'Every **5 Gold** spent, get a random spell.',
    reward: { kind: 'runeSpellDrip', per: 5 },
  },
  {
    id: 'rune_warding',
    name: 'Rune of Warding',
    cost: 4,
    text: '**Start of Combat:** give your left-most minion **Ward**.',
    reward: { kind: 'combatFlag', flag: 'runeWarding' },
  },
  {
    id: 'rune_structure',
    name: 'Rune of Structure',
    cost: 3,
    text: 'After you play an **Attachment** from hand, get a random spell.',
    reward: { kind: 'runeStructure' },
  },
  {
    id: 'rune_slaying',
    name: 'Rune of Slaying',
    cost: 3,
    text: 'Whenever you trigger **Slaughter**, gain **+2 Gold** next shop.',
    reward: { kind: 'combatFlag', flag: 'runeSlaying', amount: 2 },
  },
  {
    id: 'rune_spending',
    name: 'Rune of Spending',
    cost: 6,
    text: '**End of Turn:** gain **+1 max Gold** and give your left-most minion **+1/+1** for each Gold spent this turn.',
    reward: { kind: 'recurringEndOfTurn', effect: 'runeSpending' },
  },
  {
    id: 'rune_consumption',
    name: 'Rune of Consumption',
    cost: 4,
    text: 'Whenever you **Consume** Fodder, improve future Fodder by **+2/+1**.',
    reward: { kind: 'runeConsume', attack: 2, health: 1 },
  },
  {
    id: 'rune_pillaging',
    name: 'Rune of Pillaging',
    cost: 6,
    text: 'Get a **Pillager**. Your **Gold Pouches** are worth **2 Gold** for the rest of the run.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['pillager'] }, { kind: 'goldPouchValue', value: 2 }] },
  },
  {
    id: 'rune_fury',
    name: 'Rune of Fury',
    cost: 5,
    text: 'Your **Avenge** effects trigger twice.',
    reward: { kind: 'combatFlag', flag: 'runeFury' },
  },
  {
    id: 'rune_summoning',
    name: 'Rune of Summoning',
    cost: 5,
    text: 'Whenever you cast a spell, improve your **Imps** by **+1/+1** wherever they are.',
    reward: { kind: 'runeSummoning' },
  },
  {
    id: 'rune_forthcoming',
    name: 'Rune of Forthcoming',
    cost: 6,
    text: 'You **always attack first**.',
    reward: { kind: 'combatFlag', flag: 'runeForthcoming' },
  },
  // ── Moved into the Basic forge (2026-07-10 re-batch) ──
  {
    id: 'rune_rallying',
    name: 'Rune of Rallying',
    cost: 6,
    text: '**Start of Combat:** trigger your **Rally** effects.',
    reward: { kind: 'combatFlag', flag: 'runeRallying' },
  },
  {
    id: 'rune_scale',
    name: 'Rune of Scale',
    cost: 5,
    text: 'Whenever you spend Gold, give **3 random allies +2/+2**.',
    reward: { kind: 'runeScale', count: 3, attack: 2, health: 2 },
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
    cost: 4,
    text: 'Whenever you cast a spell, give your **left-most minion +3/+3**.',
    reward: { kind: 'runeKindling' },
  },
  {
    id: 'rune_pair',
    name: 'Rune of the Pair',
    cost: 2,
    text: 'Get **2 random Tier 4 minions**.',
    reward: { kind: 'grant', randomTier: 4, randomCount: 2 },
  },
  {
    id: 'rune_menagerie',
    name: 'Rune of the Menagerie',
    cost: 5,
    text: 'Get a random **Beast, Demon, Dragon, Mech, and Undead**.',
    reward: { kind: 'multi', rewards: [
      { kind: 'grant', randomTribe: 'beast', randomCount: 1 },
      { kind: 'grant', randomTribe: 'demon', randomCount: 1 },
      { kind: 'grant', randomTribe: 'dragon', randomCount: 1 },
      { kind: 'grant', randomTribe: 'mech', randomCount: 1 },
      { kind: 'grant', randomTribe: 'undead', randomCount: 1 },
    ] },
  },
  // ── Batch 1 additions (grants / discovers / economy — no new combat mechanics) ──
  {
    id: 'rune_small_fortune',
    name: 'Rune of Small Fortune',
    cost: 1,
    text: 'Get **6 Gold**.',
    reward: { kind: 'gainGold', amount: 6 },
  },
  {
    id: 'rune_quick_study',
    name: 'Rune of Quick Study',
    cost: 1,
    text: 'Get **3 random spells**.',
    reward: { kind: 'grant', randomSpell: 3 },
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
    cost: 1,
    text: 'Get **4 random Attachments**.',
    reward: { kind: 'grant', randomFilter: 'attachment', randomFilterCount: 4 },
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
    cost: 5,
    text: 'Whenever you summon a minion in combat, give your **Beasts +1 Attack** wherever they are.',
    reward: { kind: 'combatFlag', flag: 'runePackcraft' },
  },
  {
    id: 'rune_salvage',
    name: 'Rune of Salvage',
    cost: 5,
    text: 'Whenever a friendly **Mech loses Ward**, get a random **Attachment** next shop.',
    reward: { kind: 'combatFlag', flag: 'runeSalvage' },
  },
  {
    id: 'rune_warden',
    name: 'Rune of the Warden',
    cost: 5,
    text: 'Get a **Spear Warden**. When you have room in combat, summon a **Spear Warden**.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['knit'] }, { kind: 'combatFlag', flag: 'runeWarden' }] },
  },
];

/**
 * Epic Runes — the **Epic Runeforge's** stock. A second, higher-power forge that functions identically to the
 * normal Runeforge (offer a random few, buy ONE for Gold, re-roll once for 2 Gold) but draws from THIS set and is
 * NOT tied to a hero power — reached by a quest reward (`openEpicRuneforge`, the Epic Commission quest).
 *
 * NOTE (2026-07-10 re-batch): the designed Epic roster (Stormcalling / Twin Gilding / Broodpit / Feast / Frontline
 * Glory / Assembly / Banking / Appraisal / Den Mother / Twilight / Spearline / Scales / First Claws /
 * Reconfiguration / Soul Taxes / Rising Graves / Copies) is being built out in follow-up batches — most need new
 * card grants + combat/recruit mechanics. Only **Rune of Copies** is wired so far, so the Epic forge is thin until
 * the rest land.
 */
export const EPIC_RUNES: RuneDef[] = [
  {
    id: 'rune_copies',
    name: 'Rune of Copies',
    cost: 6,
    epic: true,
    text: '**Start of shop:** get a copy of a random minion on your board.',
    reward: { kind: 'runeCopies' },
  },
  {
    id: 'rune_reliquary',
    name: 'Rune of the Reliquary',
    cost: 7,
    epic: true,
    text: '**End of Turn:** trigger your left-most **Echo**.',
    reward: { kind: 'recurringEndOfTurn', effect: 'triggerLeftmostEcho' },
  },
  // ── Batch 3: combat runes (Start of Combat + Avenge) ──
  {
    id: 'rune_rising_graves',
    name: 'Rune of Rising Graves',
    cost: 5,
    epic: true,
    text: '**Start of Combat:** give two friendly **Undead Rise**.',
    reward: { kind: 'combatFlag', flag: 'runeRisingGraves' },
  },
  {
    id: 'rune_broodpit',
    name: 'Rune of the Broodpit',
    cost: 7,
    epic: true,
    text: '**Avenge (6):** summon **2 Imps with Taunt**.',
    reward: { kind: 'combatFlag', flag: 'runeBroodpit' },
  },
  {
    id: 'rune_spearline',
    name: 'Rune of the Spearline',
    cost: 7,
    epic: true,
    text: '**Avenge (4):** summon a **Spear Warden**. It attacks immediately.',
    reward: { kind: 'combatFlag', flag: 'runeSpearline' },
  },
  {
    id: 'rune_appraisal',
    name: 'Rune of Appraisal',
    cost: 6,
    epic: true,
    text: '**Avenge (4):** improve your spells by **+1/+1**.',
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
  },
  {
    id: 'rune_stormcalling',
    name: 'Rune of Stormcalling',
    cost: 6,
    epic: true,
    text: 'Get a **Gilded Karwind** and a random **Shout** minion.',
    reward: { kind: 'grant', grantGolden: ['karwind'], randomFilter: 'shout', randomFilterCount: 1 },
  },
  {
    id: 'rune_frontline_glory',
    name: 'Rune of Frontline Glory',
    cost: 8,
    epic: true,
    text: 'Get a **Gilded Yazzus** and **Front to Back**.',
    reward: { kind: 'grant', grantGolden: ['yazzus'], cards: ['fronttoback'] },
  },
  {
    id: 'rune_soul_taxes',
    name: 'Rune of Soul Taxes',
    cost: 8,
    epic: true,
    text: '**Avenge (4):** gain **+1 max Gold**. Get **Souls Man**.',
    reward: { kind: 'multi', rewards: [{ kind: 'combatFlag', flag: 'runeSoulTaxes' }, { kind: 'grant', cards: ['soulsman'] }] },
  },
  // ── Batch 5: recruit-phase runes ──
  {
    id: 'rune_scales',
    name: 'Rune of Scales',
    cost: 6,
    epic: true,
    text: 'Whenever you cast a spell, give your **Dragons +1/+1**.',
    reward: { kind: 'runeScales' },
  },
  {
    id: 'rune_twin_gilding',
    name: 'Rune of Twin Gilding',
    cost: 8,
    epic: true,
    text: 'You only need **2 copies** of cards to **Gild** them.',
    reward: { kind: 'runeTwinGilding' },
  },
  {
    id: 'rune_den_mother',
    name: 'Rune of the Den Mother',
    cost: 7,
    epic: true,
    text: 'Get **Den Mother**. Your Den Mother also **buffs herself** when she buffs other Beasts.',
    reward: { kind: 'multi', rewards: [{ kind: 'grant', cards: ['mamabear'] }, { kind: 'runeDenMother' }] },
  },
  {
    id: 'rune_banking',
    name: 'Rune of Banking',
    cost: 8,
    epic: true,
    text: '**End of Turn:** attach **Money Bots** to your left-most and right-most Mechs.',
    reward: { kind: 'recurringEndOfTurn', effect: 'weldMoneyBotsEdgeMechs' },
  },
  // ── Batch 6: combat runes + Second Path ──
  {
    id: 'rune_first_claws',
    name: 'Rune of First Claws',
    cost: 8,
    epic: true,
    text: '**Start of Combat:** your left-most and right-most **Beasts** attack immediately.',
    reward: { kind: 'combatFlag', flag: 'runeFirstClaws' },
  },
  {
    id: 'rune_inheritance',
    name: 'Rune of Inheritance',
    cost: 8,
    epic: true,
    text: 'When your **left-most minion dies**, your **right-most minion** gains its stats.',
    reward: { kind: 'combatFlag', flag: 'runeInheritance' },
  },
  {
    id: 'rune_second_path',
    name: 'Rune of the Second Path',
    cost: 6,
    epic: true,
    text: '**Discover** a **Greater Quest** reward minion.',
    reward: { kind: 'discoverGreaterQuest' },
  },
  {
    id: 'rune_twilight',
    name: 'Rune of Twilight',
    cost: 8,
    epic: true,
    text: 'Your **Start-of-Combat** effects trigger an **additional time**.',
    reward: { kind: 'combatFlag', flag: 'runeTwilight' },
  },
  // ── Batch 4b: the two new signature cards ──
  {
    id: 'rune_feast',
    name: 'Rune of the Feast',
    cost: 6,
    epic: true,
    text: 'Get **Feasting Bogrot**.',
    reward: { kind: 'grant', cards: ['feastingbogrot'] },
  },
  {
    id: 'rune_reconfiguration',
    name: 'Rune of Reconfiguration',
    cost: 8,
    epic: true,
    text: 'Get **Reconfigured Combinator**.',
    reward: { kind: 'grant', cards: ['reconfiguredcombinator'] },
  },
  // ── Batch 1 additions (grants / discovers — no new combat mechanics) ──
  {
    id: 'rune_champion',
    name: 'Rune of the Champion',
    cost: 4,
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
  },
  {
    id: 'rune_gilded_spark',
    name: 'Rune of the Gilded Spark',
    cost: 3,
    epic: true,
    text: 'Get a **Goldcrafter**. Get another in **2 turns**.',
    reward: { kind: 'grant', cards: ['goldcrafter'], repeatInTurns: 2 },
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
