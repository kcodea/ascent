import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY DEMONS (owner design 2026-10-30, R-DUOS-CARDS-01). Drawable only in a Duos run whose set fields Demons
 * (`duosPoolFor`). Append new cards; never insert (pool order seeds the Shop).
 */
export const DUOS_DEMONS: readonly CardDef[] = [
  {
    // PROXUS — "When you pass a card, a Demon consumes a minion in the Shop." Every pass YOU make (`passedCard`): a
    // random friendly Demon (Proxus counts) eats a random Shop minion through the shared consume. Gilded: the Demon
    // gains double its stats (the Demon tribe's Gilded consume rider).
    id: 'duo_proxus',
    name: 'Proxus',
    tribe: 'demon',
    tier: 5,
    attack: 8,
    health: 5,
    keywords: [],
    duos: true,
    effects: [{ on: 'passedCard', do: 'demonConsumesShop' }],
    text: 'When you pass a card, a **Demon** consumes a minion in the Shop.',
    goldenText: 'When you pass a card, a **Demon** consumes a minion in the Shop and gains **double** its stats.',
  },
  {
    // HIPPIE HULK — "When your teammate sells a minion, this gains its stats. (Once per turn)". The teammate's every
    // sale reaches this run (`teammateSold`, the stats it sold at); the first each turn lands, permanently. Gilded
    // gains double (owner 2026-10-30).
    id: 'duo_hippiehulk',
    name: 'Hippie Hulk',
    tribe: 'demon',
    tier: 6,
    attack: 9,
    health: 9,
    keywords: [],
    duos: true,
    effects: [{ on: 'teammateSold', do: 'teammateSoldGainStats', params: { oncePerTurn: true } }],
    text: 'When your teammate **Sells** a minion, this gains its stats. **(Once per turn)**',
    goldenText: 'When your teammate **Sells** a minion, this gains **double** its stats. **(Once per turn)**',
  },
];
