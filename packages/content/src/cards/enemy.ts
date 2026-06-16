import type { CardDef } from '@game/core';

/**
 * Generic enemy filler. Threat boards (handoff A.5) are composed of anonymous
 * "Omen" minions — stats plus at most one keyword, no effects — matching "enemy
 * archetypes have no Start-of-Combat effects" (A.3). `buildEnemyBoard` supplies
 * each unit's stats and keyword; this card just provides identity for the
 * simulator. `token: true` keeps it out of the shop pool.
 */
export const ENEMY: CardDef[] = [
  {
    id: 'omen',
    name: 'Omen Minion',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    text: 'An enemy minion conjured by the Omen.',
    token: true,
  },
];
