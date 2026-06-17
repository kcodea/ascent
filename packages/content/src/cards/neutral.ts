import type { CardDef } from '@game/core';

/**
 * Neutral glue (handoff A.7). `broker` is a recruit-phase buff-on-buy (baked in
 * by `@game/sim`). `echo` (extra summons) and `drummer` (double Battlecries) are
 * global modifiers deferred to a later pass; they ship with text but no factory
 * yet. None carry combat factories, so all are inert during `simulate()`.
 */
export const NEUTRAL: CardDef[] = [
  {
    id: 'sandbag',
    name: 'Target Dummy',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 4,
    keywords: ['T'],
    effects: [],
    text: '',
  },
  {
    id: 'broker',
    name: 'Brightwing Broker',
    tribe: 'neutral',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'onBuy', do: 'buffOnBuy', params: { attack: 1, health: 1 } }],
    text: 'Every minion you buy gets **+1/+1**.',
  },
  {
    id: 'echo',
    name: 'Echo Warden',
    tribe: 'neutral',
    tier: 3,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [],
    text: '**In combat,** your summon effects make **1 more** token.',
  },
  {
    // Battlecry doubler. Golden "triples" (fire 2 more times); multiple Drakkos do NOT stack.
    id: 'drummer',
    name: 'Drakko the Drummer',
    tribe: 'neutral',
    tier: 5,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [],
    text: 'Your **Battlecries** fire **1 more** time.',
  },
  {
    // Deathrattle doubler. Golden procs 2 more times; multiple Sylus DO stack (additive).
    id: 'sylus',
    name: 'Sylus the Reaper',
    tribe: 'neutral',
    tier: 5,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [],
    text: '**In combat,** your Deathrattles proc **1 more** time.',
  },
];
