import type { CardDef } from '@game/core';

/**
 * Dragons (handoff A.7) — Battlecry stat-scaling + Start-of-Combat AoE. The M1
 * second tribe: it exercises both halves of the effect system at once. The
 * Battlecry buffs (`battlecryBuffTribe`) bake into board stats during recruit
 * (`@game/sim`); the Start-of-Combat effects (`scDamage` / `scSplitDamage` /
 * `scAoePerTribe`) fire inside `simulate()` and emit `sc` log events.
 */
export const DRAGONS: CardDef[] = [
  {
    id: 'whelp',
    name: 'Ember Whelp',
    tribe: 'dragon',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: ['SC'],
    effects: [
      {
        on: 'startOfCombat',
        do: 'scDamage',
        params: { amount: 1, target: 'leftmost', text: 'Ember Whelp scorches the front line' },
      },
    ],
    text: '**Start of Combat:** deal 1 to the enemy on the far left.',
  },
  {
    id: 'cleric',
    name: 'Hoard Cleric',
    tribe: 'dragon',
    tier: 2,
    attack: 1,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 1, health: 1 } }],
    text: '**Battlecry:** give all your Dragons +1/+1.',
  },
  {
    id: 'cinder',
    name: 'Cinderwing Matron',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [
      {
        on: 'onPlay',
        do: 'battlecryBuffTribe',
        params: { tribe: 'dragon', attack: 1, health: 2, includeSelf: false },
      },
    ],
    text: '**Battlecry:** give other Dragons +1/+2.',
  },
  {
    id: 'razor',
    name: 'Razorscale Warlord',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 1 } }],
    text: '**Battlecry:** give your Dragons +2/+1.',
  },
  {
    id: 'weaver',
    name: 'Arcane Weaver',
    tribe: 'dragon',
    tier: 4,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'spiritfire' } }],
    text: '**Deathrattle:** add a copy of **Spirit Fire** to your hand.',
    goldenText: '**Deathrattle:** add two copies of **Spirit Fire** to your hand.',
  },
  {
    // Each Battlecry *resolution* pumps your Dragons — so Drakko (which fires Battlecries an extra
    // time) procs Karwind once per fire. A recruit-phase engine that rewards a Battlecry-heavy board.
    id: 'karwind',
    name: 'Karwind',
    tribe: 'dragon',
    tier: 6,
    attack: 2,
    health: 12,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffTribe', params: { tribe: 'dragon', attack: 1, health: 2 } }],
    text: 'Whenever a **Battlecry** triggers, give your Dragons **+1/+2**.',
  },
  {
    // Dual-type Dragon/Demon payoff. Every Battlecry *fire* on your board permanently enchants the Fodder
    // card type +1/+1 run-wide (Ritualist's mechanism, on a battlecry trigger instead of End of Turn). Fires
    // per fire, so Drakko's doubling procs it twice; multiple Banes stack. Bridges Demon Fodder with a
    // Battlecry-heavy build. No combat factory → inert in combat (just a 12/12 body).
    id: 'bane',
    name: 'Bane',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 6,
    attack: 12,
    health: 12,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffFodder', params: { attack: 1, health: 1 } }],
    text: 'After you trigger a Battlecry, give Fodder **+1/+1** this run.',
    goldenText: 'After you trigger a Battlecry, give Fodder **+2/+2** this run.',
  },
];
