import type { CardDef } from '@game/core';

/**
 * Set 2's OWN tavern spells — the ones that only make sense with the Ruby engine (they mint or buff Rubies),
 * so they live in Set 2's pool and NOT in Set 1's. Set-agnostic spells stay in `set1/spells.ts` and carry over
 * via `SET1_SPELLS_IN_SET2` (see `sets.ts`); these are the Kobold/Ruby-specific additions on top.
 */
export const SET2_SPELLS: CardDef[] = [
  {
    // Ruby Shipment — cast: mint 2 Rubies into your hand (each base 1/1 + the run's `rubyBonus`). Untargeted;
    // routes through the same `getRubies` factory the Kobold minions use (self is ignored → no golden multiplier).
    id: 'rubyshipment',
    name: 'Ruby Shipment',
    tribe: 'neutral',
    tier: 2,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [{ on: 'cast', do: 'getRubies', params: { count: 2 } }],
    text: 'Get **2 Rubies**.',
  },
  {
    // Facetwright's Choice — Choose One: your Rubies gain +1 Attack, or +1 Health (`rubyStatGain` → run
    // `rubyBonus`, which also grows Rubies already in hand). Untargeted; a flat +1 (no scaling), so the printed
    // value is always exact. Only already-cast Rubies don't grow (owner ruling 2026-07-23).
    id: 'facetwright',
    name: "Facetwright's Choice",
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [],
    chooseOne: [
      { text: 'Your Rubies gain **+1 Attack**.', effects: [{ on: 'cast', do: 'rubyStatGain', params: { attack: 1, health: 0 } }] },
      { text: 'Your Rubies gain **+1 Health**.', effects: [{ on: 'cast', do: 'rubyStatGain', params: { attack: 0, health: 1 } }] },
    ],
    text: '**Choose One:** your Rubies gain **+1 Attack**, or **+1 Health**.',
  },
  {
    // Open the Gates — cast: bank 3 Imps to enter the next combat on your board (as many as fit the 7-slot cap).
    // Reuses the Set-1 `impscrap` Imp token (owner ruling). Untargeted.
    id: 'openthegates',
    name: 'Open the Gates',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 3,
    effects: [{ on: 'cast', do: 'spellSummonImpsNextCombat', params: { count: 3 } }],
    text: '**Start of combat:** summon an **Imp**, three times (as room allows).',
  },
];
