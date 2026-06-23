import type { CardDef } from '@game/core';

/**
 * Undead (handoff A.7) — Venomous application + Deathrattle value. Answers Ironwall
 * (Venomous melts giant Taunts) and Glass Cannon (Venomous trades up; bodies absorb).
 * Toxin Tender / Plaguebringer grant Venomous (+Windfury) at recruit; the rest pay
 * off in combat (Deathrattles, Reborn, an innate Venomous body). Venomous now drops off
 * after its first proc in combat (one-shot per fight unless re-granted).
 */
export const UNDEAD: CardDef[] = [
  {
    id: 'spore',
    name: 'Sporeling',
    tribe: 'undead',
    tier: 1,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffAllRandomStat', params: { amount: 1 } }],
    text: '**Deathrattle:** Give all friends **+1 Attack** or **+1 Health** (random).',
  },
  {
    id: 'toxin',
    name: 'Toxin Tender',
    tribe: 'undead',
    tier: 5,
    attack: 3,
    health: 1,
    keywords: [],
    target: 'friendly',
    targetTribe: 'undead',
    effects: [{ on: 'onPlay', do: 'battlecryGrantKeyword', params: { keywords: ['V'] } }],
    text: '**Battlecry:** give a friendly **Undead** **Venomous**.',
  },
  {
    id: 'knit',
    name: 'Grave Knit',
    tribe: 'undead',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffCardTypeRunWide', params: { cardId: 'knit', attack: 3, health: 2 } }],
    text: 'When a **Grave Knit** dies in combat, all Grave Knits gain **+3/+2** permanently.',
  },
  {
    // Spell-power Deathrattle: each death permanently raises the run-wide spell ATTACK bonus by 1.
    // Fires in COMBAT, so it carries back via CombatResult.playerSpellPower → applied in settleCombat.
    // Stacks (each Skullblade death = +1). Shares the "Skullblade" name only with itself.
    id: 'skullblade',
    name: 'Skullblade',
    tribe: 'undead',
    tier: 3,
    attack: 5,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffSpellPower', params: { attack: 1, health: 0 } }],
    text: '**Deathrattle:** give your spells **+1 Attack** for the rest of the run.',
    goldenText: '**Deathrattle:** give your spells **+2 Attack** for the rest of the run.',
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
