import type { CardDef } from '@game/core';

/**
 * Dragons (handoff A.7) — Battlecry stat-scaling + Start-of-Combat AoE. The M1
 * second tribe: it exercises both halves of the effect system at once. The
 * Battlecry buffs (`battlecryBuffTribe`) bake into board stats during recruit
 * (`@game/sim`); the Start-of-Combat effects (`scDamage` / `scSplitDamage` /
 * `scAoePerTribe`) fire inside `simulate()` and emit `sc` log events.
 */
export const DRAGONS: CardDef[] = [
  {
    id: 'whelp',
    name: 'Ember Whelp',
    tribe: 'dragon',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: ['SC'],
    effects: [
      {
        on: 'startOfCombat',
        do: 'scDamage',
        params: { amount: 1, target: 'leftmost', text: 'Ember Whelp scorches the front line' },
      },
    ],
    text: '**Start of Combat:** deal 1 to the enemy on the far left.',
  },
  {
    id: 'cleric',
    name: 'Hoard Cleric',
    tribe: 'dragon',
    tier: 2,
    attack: 1,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 1, health: 1 } }],
    text: '**Battlecry:** give all your Dragons +1/+1.',
  },
  {
    id: 'cinder',
    name: 'Cinderwing Matron',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [
      {
        on: 'onPlay',
        do: 'battlecryBuffTribe',
        params: { tribe: 'dragon', attack: 1, health: 2, includeSelf: false },
      },
    ],
    text: '**Battlecry:** give other Dragons +1/+2.',
  },
  {
    id: 'razor',
    name: 'Razorscale Warlord',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 1 } }],
    text: '**Battlecry:** give your Dragons +2/+1.',
  },
  {
    id: 'chrom',
    name: 'Chromatic Caller',
    tribe: 'dragon',
    tier: 4,
    attack: 3,
    health: 5,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scSplitDamage', params: { text: 'Chromatic Caller splits its breath' } }],
    text: '**Start of Combat:** deal damage equal to its Attack, split across enemies.',
  },
  {
    id: 'weaver',
    name: 'Arcane Weaver',
    tribe: 'dragon',
    tier: 4,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'spiritfire' } }],
    text: '**Deathrattle:** add a copy of **Spirit Fire** to your hand.',
  },
  {
    id: 'nadir',
    name: 'Nadir, Hoardlord',
    tribe: 'dragon',
    tier: 5,
    attack: 5,
    health: 6,
    keywords: ['T', 'DS'],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 2 } }],
    text: '**Battlecry:** give your Dragons +2/+2.',
  },
  {
    id: 'gale',
    name: 'Galewing Apex',
    tribe: 'dragon',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: ['SC'],
    effects: [
      {
        on: 'startOfCombat',
        do: 'scAoePerTribe',
        params: { base: 3, perTribe: 3, tribe: 'dragon', text: 'Galewing Apex rains fire on the omen' },
      },
    ],
    text: '**Start of Combat:** 3 to every enemy, then 3 more to a random enemy per other Dragon.',
  },
];
