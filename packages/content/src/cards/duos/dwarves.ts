import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY DWARVES (owner design 2026-10-30, R-DUOS-CARDS-01). Drawable only in a Duos run whose set fields Dwarves
 * (`duosPoolFor`). Append new cards; never insert (pool order seeds the Shop).
 */
export const DUOS_DWARVES: readonly CardDef[] = [
  {
    // BRATWORST BUCK — "When you cast an Ale, give your teammate a copy. (Twice per turn)". Any Dwarven Ale cast, any
    // caster (`aleCastGiftTeammate`): the teammate gets a fresh copy of that Ale. Two per turn per copy of Bratworst in
    // the Shop; a combat Ale cast has its own two per fight (rides the team carry). Gilded sends 2 copies each time.
    id: 'duo_bratworst',
    name: 'Bratworst Buck',
    tribe: 'dwarf',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    duos: true,
    effects: [{ on: 'spellCast', do: 'aleCastGiftTeammate', params: { perTurn: 2 } }],
    text: 'When you cast a **Dwarven Ale**, give your teammate a copy. **(Twice per turn)**',
    goldenText: 'When you cast a **Dwarven Ale**, give your teammate **2** copies. **(Twice per turn)**',
  },
  {
    // SPENCER — "Echo: Reduce the cost of upgrading your team's shops by 1". You AND your teammate
    // (`teamUpgradeDiscount`). A combat Echo rides the team carry (lands at settle today; switches to the real-time
    // channel when it lands). `guard: 'self'`: only its OWN death. Gilded: by 2.
    id: 'duo_spencer',
    name: 'Spencer',
    tribe: 'dwarf',
    tier: 4,
    attack: 6,
    health: 2,
    keywords: [],
    duos: true,
    effects: [{ on: 'onDeath', do: 'teamUpgradeDiscount', params: { amount: 1, guard: 'self' } }],
    text: "**Echo:** Reduce the cost of upgrading your team's Shops by **1**.",
    goldenText: "**Echo:** Reduce the cost of upgrading your team's Shops by **2**.",
  },
];
