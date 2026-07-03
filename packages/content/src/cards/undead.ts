import type { CardDef } from '@game/core';

/**
 * Undead (handoff A.7) — Venomous application + Deathrattle value. Answers Ironwall
 * (Venomous melts giant Taunts) and Glass Cannon (Venomous trades up; bodies absorb).
 * Plaguebringer grants Venomous (+Windfury) at recruit; the rest pay
 * off in combat (Deathrattles, Reborn, an innate Venomous body). Venomous now drops off
 * after its first proc in combat (one-shot per fight unless re-granted).
 */
export const UNDEAD: CardDef[] = [
  {
    id: 'spore',
    name: 'Sporeling',
    tribe: 'undead',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } },
      { on: 'battlecryTriggered', do: 'battlecryTriggeredOwnDeathrattle' },
    ],
    text: '**Deathrattle:** Give your minions **+1/+1**. Triggers each time you play a **Battlecry**.',
    goldenText: '**Deathrattle:** Give your minions **+2/+2**. Triggers each time you play a **Battlecry**.',
  },
  {
    id: 'knit',
    name: 'Eternal Knight',
    tribe: 'undead',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffCardTypeRunWide', params: { cardId: 'knit', attack: 3, health: 2 } }],
    text: 'When an **Eternal Knight** dies in combat, all Eternal Knights gain **+3/+2** permanently.',
  },
  {
    // Spell-power Deathrattle: each death permanently raises the run-wide spell ATTACK bonus by 1.
    // Fires in COMBAT, so it carries back via CombatResult.playerSpellPower → applied in settleCombat.
    // Stacks (each Ghastly Bladesmith death = +1). Shares the "Ghastly Bladesmith" name only with itself.
    id: 'skullblade',
    name: 'Ghostsmith',
    tribe: 'undead',
    tier: 2,
    attack: 4,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffSpellPower', params: { attack: 1, health: 0 } }],
    text: '**Deathrattle:** give your spells **+1 Attack** for the rest of the run.',
    goldenText: '**Deathrattle:** give your spells **+2 Attack** for the rest of the run.',
  },
  {
    // On-kill permanent Undead attack buff. Carries back via playerUndeadBuyAtkGain — applied to existing
    // run-board Undead AND stacked into undeadBuyAtk for future buys.
    id: 'karthus',
    name: 'Karthus',
    tribe: 'undead',
    tier: 5,
    attack: 7,
    health: 8,
    keywords: ['DS'],
    effects: [{ on: 'onKill', do: 'onKillBuffUndeadAttack', params: { attack: 3 } }],
    text: 'When this kills an enemy, give your Undead **+3 Attack** permanently.',
    goldenText: 'When this kills an enemy, give your Undead **+6 Attack** permanently.',
  },
  {
    // Deathrattle (combat): re-fire an adjacent minion's Battlecry — only combat-meaningful battlecries
    // (summon / tribe buff / undead-attack / grant-keyword) do anything; economy battlecries no-op. Golden
    // re-fires BOTH neighbours; non-golden picks one at random when both have a replayable battlecry.
    id: 'ryme',
    name: 'Ryme',
    tribe: 'undead',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry', params: {} }],
    text: "**Deathrattle:** Trigger an adjacent minion's **Battlecry**.",
    goldenText: "**Deathrattle:** Trigger **both** adjacent minions' **Battlecries**.",
  },
  {
    // Deathrattle: summon a Footman (T1 1/1 Reborn Undead token). Golden summons 2.
    id: 'deathlesshand',
    name: 'Footman Leader',
    tribe: 'undead',
    tier: 3,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'footman' } }],
    text: '**Deathrattle:** Summon a **Footman**.',
    goldenText: '**Deathrattle:** Summon **2 Footmen**.',
  },
  {
    // Rally engine: each time it attacks, it fires your leftmost friendly Deathrattle *before* the hit
    // lands (so any buffs/summons resolve first). Modest stats — the value is the repeated proc.
    id: 'deathsayer',
    name: 'Deathsayer',
    tribe: 'undead',
    tier: 4,
    attack: 3,
    health: 5,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyProcDeathrattle' }],
    text: '**Rally:** before this attacks, trigger your leftmost Deathrattle.',
    goldenText: '**Rally:** before this attacks, trigger your leftmost Deathrattle **twice**.',
  },
  {
    // Battlecry: give your Undead +1 Attack wherever they are (board + hand immediately via
    // battlecryBuffUndeadAttack), AND stacks undeadBuyAtk so future Undead buys carry the bonus.
    id: 'deathswarmer',
    name: 'Deathswarmer',
    tribe: 'undead',
    tier: 2,
    attack: 1,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffUndeadAttack', params: { amount: 1 } }],
    text: '**Battlecry:** Give your Undead **+1 Attack** wherever they are.',
    goldenText: '**Battlecry:** Give your Undead **+2 Attack** wherever they are.',
  },
  {
    id: 'pillager',
    name: 'Pillager',
    tribe: 'undead',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantCardToHand', params: { cardId: 'emberpouch', count: 1 } }],
    text: '**Deathrattle:** Get a **Gold Pouch**.',
    goldenText: '**Deathrattle:** Get **2 Gold Pouches**.',
  },
  {
    // Rise-spreader: a fragile glass body whose Deathrattle hands a random friendly Undead a Rise
    // (skipping ones that already have — or already spent — it). Golden grants two.
    id: 'mumi',
    name: 'Mumi',
    tribe: 'undead',
    tier: 3,
    attack: 5,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantReborn', params: { tribe: 'undead' } }],
    text: '**Deathrattle:** give a friendly **Undead** **Rise**.',
    goldenText: '**Deathrattle:** give **two** friendly **Undead** **Rise**.',
  },
  {
    // Engraved: stat gains carry back to the run board. Gains +3/+3 per friendly summon in combat.
    // Overflow summons (board full) also buff your Undead +2/+2. Golden doubles both gains.
    id: 'thunderingabomination',
    name: 'Cratering Hulk',
    tribe: 'undead',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [
      { on: 'onSummon', do: 'onSummonSelfBuff', params: { attack: 3, health: 3 } },
      { on: 'summonOverflow', do: 'onSummonOverflowBuffTribe', params: { tribe: 'undead', attack: 2, health: 2, engrave: true } },
    ],
    text: 'Gain **+3/+3** when a minion is summoned in combat. Overflow summons **Engrave** your Undead **+2/+2**.',
    goldenText: 'Gain **+6/+6** when a minion is summoned in combat. Overflow summons **Engrave** your Undead **+4/+4**.',
  },
  {
    // Deathrattle: give all living friendly minions +2 Health (golden +4). Each time Sergeant itself
    // gains Attack in combat, the HP grant permanently improves by +2 (golden +4). Tracked via
    // `self.hpGrantBonus` on the Minion instance.
    id: 'sergeant',
    name: 'Sergeant',
    tribe: 'undead',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'deathrattleBuffAllHealth', params: { health: 2 } },
      { on: 'onGainAttack', do: 'onGainAttackImproveHpGrant', params: { improve: 2 } },
    ],
    text: '**Deathrattle:** Give your minions **+2 Health**. Improves each time Sergeant gains Attack.',
    goldenText: '**Deathrattle:** Give your minions **+4 Health**. Improves **+4** each time Sergeant gains Attack.',
  },
  {
    // When you cast a spell, give your Undead +3 Attack wherever they are (board + hand) and stack the
    // bonus into undeadBuyAtk for future buys. Golden doubles the per-cast grant.
    id: 'forsakenweaver',
    name: 'Forsaken Weaver',
    tribe: 'undead',
    tier: 6,
    attack: 5,
    health: 8,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffUndeadAttack', params: { attack: 3 } }],
    text: 'When you cast a spell, give your Undead **+3 Attack** wherever they are.',
    goldenText: 'When you cast a spell, give your Undead **+6 Attack** wherever they are.',
  },
  {
    // Dual-type Undead/Beast. Deathrattle: summon 3 Crypt Wolves (1/1 undead beasts). Golden
    // summons 6 (the standard ×2 via mul). Good at flooding the board after death.
    id: 'wolvesden',
    name: 'Wolves Den',
    tribe: 'undead',
    tribe2: 'beast',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'cryptwolf', count: 3 } }],
    text: '**Deathrattle:** Summon 3 **Crypt Wolves**.',
    goldenText: '**Deathrattle:** Summon 6 **Crypt Wolves**.',
  },
  {
    // Avenge: every 4 friendly deaths in combat, permanently raise your max Gold by 1 (golden +2).
    // Carried back via CombatResult.playerMaxGoldGain → settleCombat bumps maxEmbers.
    id: 'soulsman',
    name: 'Soulsman',
    tribe: 'undead',
    tier: 3,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeMaxGold', params: { count: 4 } }],
    text: '**Avenge (4):** raise your maximum Gold by **1**.',
    goldenText: '**Avenge (4):** raise your maximum Gold by **2**.',
  },
];
