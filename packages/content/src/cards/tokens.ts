import type { CardDef } from '@game/core';

/** Non-buyable tokens summoned by other cards. */
export const TOKENS: CardDef[] = [
  {
    id: 'pup',
    name: 'Pup',
    tribe: 'beast',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    text: 'A 1/1 Beast token.',
    token: true,
  },
  {
    id: 'stray',
    name: 'Stray',
    tribe: 'beast',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    text: 'A 1/1 Beast token.',
    token: true,
  },
];
