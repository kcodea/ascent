import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY BEASTS (owner design 2026-10-30, R-DUOS-CARDS-01). Drawable only in a Duos run whose set fields Beasts
 * (`duosPoolFor`). Append new cards; never insert (pool order seeds the Shop).
 */
export const DUOS_BEASTS: readonly CardDef[] = [
  {
    // ANTSY — "Echo: Give your teammate a random T1 Shop Spell." The receiver rolls the spell from ITS run's Tier 1
    // Shop Spells (`giftTeammate` `randomSpellTier`). A combat Echo rides the team carry (`sendTeam`): today it lands at
    // fight settle; when the real-time combat channel lands it switches with no card change. A Shop Echo (a destroy,
    // Deathsayer) sends it at once. `guard: 'self'`: only its OWN death. Gilded gives 2.
    id: 'duo_antsy',
    name: 'Antsy',
    tribe: 'beast',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: [],
    duos: true,
    effects: [{ on: 'onDeath', do: 'giftTeammate', params: { randomSpellTier: 1, guard: 'self' } }],
    text: '**Echo:** Give your teammate a random **Tier 1** Shop Spell.',
    goldenText: '**Echo:** Give your teammate **2** random **Tier 1** Shop Spells.',
  },
  {
    // SALANDAMAN — "has +4/+4 for each of your team's Salandaman's that have died this game" (owner 2026-11-01:
    // "this means it counts both sides game wide"). Spear Warden's shape (`cardDeathScaler`): every Salandaman death
    // (combat or Shop, any copy, a summoned one too) grows the run-wide `cardBuffs` enchant every copy wears now and
    // every future copy is minted with. Permanent. `team: true` makes it TEAM-WIDE (R-DUOS-SALANDAMAN-TEAM-01): each
    // death is also sent to the teammate (a `cardDeath` team effect, real time), and in a tag-team fight the
    // teammate's board steps in already carrying the first board's deaths. The live text prints the total.
    id: 'duo_salandaman',
    name: 'Salandaman',
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    duos: true,
    effects: [{ on: 'passive', do: 'cardDeathScaler', params: { cardId: 'duo_salandaman', attack: 4, health: 4, team: true } }],
    text: "Has **+4/+4** for each of your team's **Salandamans** that died this game.",
  },
];
