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
  {
    id: 'impscrap',
    name: 'Imp Scrap',
    tribe: 'demon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    // A plain 1/1 with no keyword and no Fodder interaction — no body text (the stats say it all).
    text: '',
    token: true,
  },
  {
    id: 'discoverspell',
    name: 'Glimpse Beyond',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    effects: [],
    text: '**Discover** a minion from the next tier up.',
    token: true,
  },
];
