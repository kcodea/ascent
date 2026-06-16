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
    id: 'imp',
    name: 'Voracious Imp',
    tribe: 'demon',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: ['CN'],
    effects: [{ on: 'onSummon', do: 'consumeFodderOnSummon' }],
    text: 'When you play a **Fodder** token, this **eats it and gains its stats**.',
  },
  {
    id: 'feed',
    name: 'Soulfeeder',
    tribe: 'demon',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: ['CN'],
    effects: [{ on: 'onPlay', do: 'battlecryConsume' }],
    text: '**Battlecry:** destroy a friend and add its stats to this.',
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
