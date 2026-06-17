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
    tier: 1,
    attack: 0,
    health: 1, // unused for a spell; kept positive so the shared schema validates
    keywords: [],
    spell: true,
    cost: 2,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellBuffTarget', params: { attack: 3, health: 3 } }],
    text: 'Give a friendly minion **+3/+3**.',
  },
];
