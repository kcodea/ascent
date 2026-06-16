import type { CardDef } from '@game/core';

/**
 * Undead (handoff A.7) — Poison application + Deathrattle value. Answers Ironwall
 * (Poison melts giant Taunts) and Glass Cannon (Poison trades up; bodies absorb).
 * Toxin Tender / Plaguebringer grant Poison (+Windfury) at recruit; the rest pay
 * off in combat (Deathrattles, Reborn, an innate Poison body).
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
    tier: 2,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantKeyword', params: { keywords: ['P'] } }],
    text: '**Battlecry:** give a friend **Poison**.',
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
    text: '**Reborn** — the first time it dies, it returns with 1 Health.',
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
    keywords: ['P'],
    effects: [],
    text: '**Poison** — destroys any minion it damages. Melts giant Taunts.',
  },
  {
    id: 'plague',
    name: 'Plaguebringer',
    tribe: 'undead',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantKeyword', params: { keywords: ['P', 'W'] } }],
    text: '**Battlecry:** give a friend **Poison and Windfury**.',
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
