import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY KOBOLDS (owner design 2026-10-30, R-DUOS-CARDS-01). Drawable only in a Duos run whose set fields Kobolds
 * (`duosPoolFor`). Append new cards; never insert (pool order seeds the Shop).
 */
export const DUOS_KOBOLDS: readonly CardDef[] = [
  {
    // ROO — "When you pass a card, get 2 Rubies." Every pass YOU make (a drag, Handout, any effect pass) on
    // `passedCard`; plain Rubies (`getRubies`, Prospector's mint). Gilded gets 4.
    id: 'duo_roo',
    name: 'Roo',
    tribe: 'kobold',
    tier: 2,
    attack: 3,
    health: 1,
    keywords: [],
    duos: true,
    effects: [{ on: 'passedCard', do: 'getRubies', params: { count: 2 } }],
    text: 'When you pass a card, get **2 Rubies**.',
    goldenText: 'When you pass a card, get **4 Rubies**.',
  },
  {
    // TOOT TOOT — "Rally: Give your teammate a minion of their most common type." The receiver resolves the type on
    // ITS board (ties a seeded 50/50, R-DUOS-CARDS-04) and rolls the minion from its own pool up to its Shop tier. A
    // combat Rally rides the team carry (lands at settle today); a Shop Rally sends it at once. `guard: 'rally'`: only
    // its OWN swing. Gilded gives 2.
    id: 'duo_toottoot',
    name: 'Toot Toot',
    tribe: 'kobold',
    tier: 4,
    attack: 5,
    health: 4,
    keywords: ['RL'],
    duos: true,
    effects: [{ on: 'onAttack', do: 'giftTeammate', params: { mateTribe: true, guard: 'rally' } }],
    text: '**Rally:** Give your teammate a minion of their **most common type**.',
    goldenText: '**Rally:** Give your teammate **2** minions of their **most common type**.',
  },
];
