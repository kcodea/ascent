import type { CardDef } from '@game/core';

/**
 * Demons (handoff A.7) — Consume Fodder to feed a carry + destroy. Answers
 * Undying (the Sovereign destroys a Reborn/Glass carry outright) and Venom
 * Swarm (a fat consumed body soaks Poison; Maw buys a Shield). The Consume
 * loop is recruit-time: Soulfeeder eats a friend and Voracious Imp eats Fodder
 * tokens, each firing `onConsume` — which Pactstone Acolyte (+1/+1), Maw of the
 * Pit (Divine Shield) and Ravening Glutton (+2/+2) all pay off. Brood Matron
 * (breeds Imps on death) and Abyssal Sovereign (destroy) resolve in combat.
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
    effects: [{ on: 'onPlay', do: 'battlecryAddTavernFodder' }],
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
    id: 'pact',
    name: 'Pactstone Acolyte',
    tribe: 'demon',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'onConsume', do: 'onConsumeBuffSelf', params: { attack: 1, health: 1 } }],
    text: 'When you consume a minion, gain an extra **+1/+1**.',
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
    effects: [{ on: 'onConsume', do: 'onConsumeGrantSelfKeyword', params: { keyword: 'DS' } }],
    text: 'On consume, gain a **Divine Shield**.',
  },
  {
    id: 'glut',
    name: 'Ravening Glutton',
    tribe: 'demon',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: ['C', 'CN'],
    effects: [{ on: 'onConsume', do: 'onConsumeBuffSelf', params: { attack: 2, health: 2 } }],
    text: 'On consume, gain **+2/+2**.',
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
  {
    id: 'sov',
    name: 'Abyssal Sovereign',
    tribe: 'demon',
    tier: 6,
    attack: 7,
    health: 7,
    keywords: ['SC'],
    effects: [
      {
        on: 'startOfCombat',
        do: 'scDestroyHighestAttack',
        params: { text: 'Abyssal Sovereign drags down the mightiest' },
      },
    ],
    text: '**Start of Combat:** destroy the enemy with the highest Attack.',
  },
];
