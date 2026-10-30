import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY SHOP SPELLS (owner design 2026-10-30, R-DUOS-CARDS-01). Neutral, so drawable in every set's Duos runs
 * (`duosPoolFor`). Append new cards; never insert (pool order seeds the Shop).
 */
export const DUOS_SPELLS: readonly CardDef[] = [
  {
    // "Pass a minion." Aimed at a Shop minion OR one of yours (`target: 'any'`); it goes to your teammate's hand at no
    // extra Gold (the spell is the price). A Golden minion can never be passed (`targetNoGolden`, owner 2026-10-30).
    id: 'duo_handout',
    name: 'Handout',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    target: 'any',
    targetNoGolden: true,
    duos: true,
    effects: [{ on: 'cast', do: 'passTargetMinion' }],
    text: '**Pass** a minion.',
  },
  {
    // "Gain 1 max gold, and give your teammate a Gold Pouch." Gold Font's permanent +1 (`gainMaxMana`), then a Gold
    // Pouch for the teammate (`giftTeammate`, landed by their run; a full hand refuses it).
    id: 'duo_sharewealth',
    name: 'Share the Wealth',
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 3,
    duos: true,
    effects: [
      { on: 'cast', do: 'gainMaxMana', params: { amount: 1 } },
      { on: 'cast', do: 'giftTeammate', params: { cardId: 'emberpouch' } },
    ],
    text: 'Gain **+1 max Gold**. Give your teammate a **Gold Pouch**.',
  },
  {
    // BROSHAKE — "Give you and your teammate's left-most minion +3/+5". Your left-most board minion now, your
    // teammate's when it lands on their run (`spellBuffTeamLeftmost`, a `buffLeftmost` team effect). Spell power folds
    // in (the caster's). Permanent, like every Shop buff.
    id: 'duo_broshake',
    name: 'Broshake',
    tribe: 'neutral',
    tier: 2,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    duos: true,
    effects: [{ on: 'cast', do: 'spellBuffTeamLeftmost', params: { attack: 3, health: 5 } }],
    text: "Give your **left-most** minion and your teammate's **left-most** minion **+3/+5**.",
  },
  {
    // TRIBE BUNDLE — "Give your teammate a minion of their most common type". Resolved on the RECEIVER's board (ties a
    // seeded 50/50, R-DUOS-CARDS-04), rolled from their pool up to their Shop tier (`giftTeammate` `mateTribe`).
    id: 'duo_tribebundle',
    name: 'Tribe Bundle',
    tribe: 'neutral',
    tier: 2,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    duos: true,
    effects: [{ on: 'cast', do: 'giftTeammate', params: { mateTribe: true } }],
    text: 'Give your teammate a minion of their **most common type**.',
  },
];
