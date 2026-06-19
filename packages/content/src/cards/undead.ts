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
    effects: [{ on: 'onDeath', do: 'deathrattleBuffRandom', params: { attack: 1, health: 1 } }],
    text: '**Deathrattle:** give a random friend +1/+1.',
  },
  {
    id: 'toxin',
    name: 'Toxin Tender',
    tribe: 'undead',
    tier: 5,
    attack: 1,
    health: 2,
    keywords: [],
    target: 'friendly',
    effects: [{ on: 'onPlay', do: 'battlecryGrantKeyword', params: { keywords: ['V'] } }],
    text: '**Battlecry:** give a friendly minion **Venomous**.',
  },
  {
    id: 'knit',
    name: 'Grave Knit',
    tribe: 'undead',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: ['R'],
    effects: [],
    text: '',
  },
  {
    id: 'rot',
    name: 'Rot Weaver',
    tribe: 'undead',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'onFriendDeathBuffRandom', params: { attack: 1, health: 1 } }],
    text: 'Each time a friend dies, give a random friend **+1/+1**.',
  },
  {
    id: 'maex',
    name: 'Webspinner Matron',
    tribe: 'undead',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: ['V'],
    effects: [],
    text: '',
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
    id: 'plague',
    name: 'Plaguebringer',
    tribe: 'undead',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantKeyword', params: { keywords: ['V', 'W'] } }],
    text: '**Battlecry:** give a friend **Venomous and Windfury**.',
  },
  {
    id: 'ghast',
    name: 'Ghastweaver',
    tribe: 'undead',
    tier: 6,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [
      {
        on: 'onDeath',
        do: 'deathrattleFillTribe',
        params: { pool: ['spore', 'toxin', 'knit', 'rot', 'maex', 'plague'] },
      },
    ],
    text: '**Deathrattle:** fill your board with random Undead.',
  },
];
