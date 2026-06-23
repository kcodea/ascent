import type { CardDef } from '@game/core';

/**
 * Demons (handoff A.7) — Consume Fodder to feed a carry. The Fodder supply is
 * recruit-time: Soulfeeder (Battlecry) and Maw of the Pit (End of Turn) queue
 * Fodder into the next tavern, and Voracious Imp eats it for 2× stats. Brood
 * Matron (breeds Imps on death) resolves in combat.
 */
export const DEMONS: CardDef[] = [
  {
    // Fred is the Fodder token — no longer rollable (token: true). It only enters the
    // tavern from other sources (Soulfeeder's Battlecry); your Demons then eat it.
    id: 'fred',
    name: 'Fred',
    tribe: 'demon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: ['FD'],
    effects: [],
    text: 'A 1/1 Demon **Fodder** — your Demons devour it from the tavern.',
    token: true,
  },
  {
    id: 'feed',
    name: 'Soulfeeder',
    tribe: 'demon',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'addTavernFodder' }],
    text: '**Battlecry:** add Fodder to your next tavern.',
    goldenText: '**Battlecry:** add **2** Fodder to your next tavern.',
  },
  {
    id: 'imp',
    name: 'Voracious Imp',
    tribe: 'demon',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: ['CN'],
    fodderMult: 2,
    effects: [],
    text: 'Gains **2x** stats from Fodder.',
  },
  {
    id: 'brood',
    name: 'Brood Matron',
    tribe: 'demon',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'onFriendDeathSummon', params: { tokenId: 'impscrap' } }],
    text: 'Each time a friend dies, summon a 1/1 Imp.',
    goldenText: 'Each time a friend dies, summon **two** 1/1 Imps.',
  },
  {
    // Dual-type Demon/Mech. Magnetic — and because it's also a Mech it can weld onto a friendly
    // Mech *or* Demon, merging its 3/3 in. A flexible glue body for either tribe.
    id: 'heckbinder',
    name: 'Heckbinder',
    tribe: 'demon',
    tribe2: 'mech',
    tier: 4,
    attack: 3,
    health: 3,
    keywords: ['M'],
    effects: [],
    text: 'Magnetize onto a friendly **Mech** or **Demon**.',
  },
  {
    id: 'maw',
    name: 'Maw of the Pit',
    tribe: 'demon',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: ['T'],
    effects: [{ on: 'endOfTurn', do: 'addTavernFodder' }],
    text: '**End of Turn:** add a **Fodder** to your next tavern.',
    goldenText: '**End of Turn:** add **2** Fodder to your next tavern.',
  },
  {
    id: 'ritualist',
    name: 'Ritualist',
    tribe: 'demon',
    tier: 5,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'buffFodderEverywhere', params: { attack: 1, health: 1 } }],
    text: '**End of Turn:** all Fodder gets **+1/+1**, wherever it is.',
  },
];
