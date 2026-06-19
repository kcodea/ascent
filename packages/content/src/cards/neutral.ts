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
    goldenText: '**In combat,** your summon effects make **2 more** tokens.',
  },
  {
    id: 'buddy',
    name: 'Buddy Buddy',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 1 } }],
    text: '**Battlecry:** add a random **Tier 1** minion to your hand.',
    goldenText: '**Battlecry:** add **two** random **Tier 1** minions to your hand.',
  },
  {
    // Spell payoff. Each tavern spell you cast pumps two *other* friends (the triple-reward Discover
    // is not a tavern spell, so it doesn't proc). Targets are chosen randomly among your other minions.
    id: 'guel',
    name: 'Archmagus Guel',
    tribe: 'neutral',
    tier: 4,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffOthers', params: { attack: 1, health: 1, count: 2 } }],
    text: 'After you cast a tavern spell, give 2 other friendly minions **+1/+1**.',
    goldenText: 'After you cast a tavern spell, give 2 other friendly minions **+2/+2**.',
  },
  {
    // Overflow payoff. When a summon can't fit your full board, a random friend gets the wasted body's
    // worth of stats instead — turning board-cap overflow into value.
    id: 'monk',
    name: 'Flowing Monk',
    tribe: 'neutral',
    tier: 4,
    attack: 1,
    health: 4,
    keywords: [],
    effects: [{ on: 'summonOverflow', do: 'overflowBuffRandom', params: { attack: 3, health: 3 } }],
    text: "When you summon a minion that doesn't fit, give a random friendly minion **+3/+3**.",
    goldenText: "When you summon a minion that doesn't fit, give a random friendly minion **+6/+6**.",
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
    goldenText: 'Your **Battlecries** fire **2 more** times.',
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
    goldenText: '**In combat,** your Deathrattles proc **2 more** times.',
  },
  {
    // End-of-Turn doubler (recruit). Golden triggers 2 more times; multiple Chronos do NOT
    // stack (best one counts) — mirrors Drakko. Resolved in `applyEndOfTurn` (@game/sim).
    id: 'chronos',
    name: 'Chronos',
    tribe: 'neutral',
    tier: 5,
    attack: 1,
    health: 6,
    keywords: [],
    effects: [],
    text: 'Your **End of Turn** effects trigger **1 more** time.',
    goldenText: 'Your **End of Turn** effects trigger **2 more** times.',
  },
];
