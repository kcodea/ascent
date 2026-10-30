import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY DRAGONS (owner design 2026-10-30, R-DUOS-CARDS-01). Drawable only in a Duos run whose set fields Dragons
 * (`duosPoolFor`). Append new cards; never insert (pool order seeds the Shop).
 */
export const DUOS_DRAGONS: readonly CardDef[] = [
  {
    // "Shout: Give your team +1 max gold." You AND your teammate (`teamGainMaxGold`: Gold Font's permanent
    // `maxGoldBonus` route on both runs; the teammate's half rides the pass channel). Gilded gives 2.
    id: 'duo_richmond',
    name: 'Richmond',
    tribe: 'dragon',
    tier: 5,
    attack: 7,
    health: 3,
    keywords: [],
    duos: true,
    effects: [{ on: 'onPlay', do: 'teamGainMaxGold', params: { amount: 1 } }],
    text: '**Shout:** Give your team **+1 max Gold**.',
    goldenText: '**Shout:** Give your team **+2 max Gold**.',
  },
  {
    // GALFAGAN — "When you pass a Shop Spell, get a copy of it. (Once per turn)". A pass YOU make (`passedCard`,
    // `spellOnly`); only a Shop-pool spell counts (`passedSpellGetCopy`: a Ruby, a Clue or a token is not a Shop
    // Spell). The first each turn per copy of Galfagan (`oncePerTurn`). Gilded gets 2 copies.
    id: 'duo_galfagan',
    name: 'Galfagan',
    tribe: 'dragon',
    tier: 4,
    attack: 5,
    health: 4,
    keywords: [],
    duos: true,
    effects: [{ on: 'passedCard', do: 'passedSpellGetCopy', params: { spellOnly: true, oncePerTurn: true } }],
    text: 'When you pass a **Shop Spell**, get a copy of it. **(Once per turn)**',
    goldenText: 'When you pass a **Shop Spell**, get **2** copies of it. **(Once per turn)**',
  },
];
