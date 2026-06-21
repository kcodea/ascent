import type { CardDef } from '@game/core';

/**
 * Tavern spells (handoff: one spell is always offered, on the right of the shop).
 * Unlike minions (flat `CONFIG.minionCost`), each spell sets its own `cost`. A spell
 * is bought into the hand, then cast — it never takes a board slot. `target: 'friendly'`
 * spells make the player pick a friendly minion when cast.
 */
export const SPELLS: CardDef[] = [
  {
    id: 'spiritfire',
    name: 'Spirit Fire',
    tribe: 'neutral',
    tier: 2,
    attack: 0,
    health: 1, // unused for a spell; kept positive so the shared schema validates
    keywords: [],
    spell: true,
    cost: 2,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellBuffTarget', params: { attack: 4, health: 4 } }],
    text: 'Give a friendly minion **+4/+4**.',
  },
  {
    id: 'emberpouch',
    name: 'Mana Pouch',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [{ on: 'cast', do: 'gainEmbers', params: { amount: 1 } }],
    text: 'Gain **1 Mana**.',
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellBuffTarget', params: { attack: 0, health: 1, keyword: 'T' } }],
    text: 'Give a friendly minion **+0/+1** and **Taunt**.',
  },
  {
    // Untargeted board-wide buff. Scales with spell power like every stat spell (spellStatBonus).
    id: 'growth',
    name: 'Growth',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellBuffAll', params: { attack: 3, health: 4 } }],
    text: 'Give your minions **+3/+4**.',
  },
  {
    // Targeted sacrifice: the picked minion is devoured (removed) and a RANDOM other friend inherits its
    // stats. `singleCast` keeps spell-quantity multipliers from devouring twice. No spell-power scaling
    // (it transfers existing stats, not a flat grant).
    id: 'devour',
    name: 'Channeling the Devourer',
    tribe: 'neutral',
    tier: 5,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    singleCast: true,
    cost: 3,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellDevour' }],
    text: 'Devour a friendly minion and spit its stats onto a random other friend.',
  },
];
