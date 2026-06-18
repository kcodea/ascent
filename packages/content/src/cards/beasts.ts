import type { CardDef } from '@game/core';

/**
 * Beasts (handoff A.7) — token swarm + buff-on-summon + Cleave. The M0 tribe:
 * it exercises in-combat summons (Deathrattle), summon-triggered buffs, Cleave,
 * on-kill re-attack, and a board-wide Deathrattle buff — a full workout for the
 * combat-time effect system. Stats and text ship per spec.
 *
 * Alleycur's Battlecry is a recruit-phase effect (wired in `@game/sim`, M1), so
 * it is inert during combat for now.
 */
export const BEASTS: CardDef[] = [
  {
    id: 'alley',
    name: 'Alleycat',
    tribe: 'beast',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecrySummon', params: { tokenId: 'stray', count: 1 } }],
    text: '**Battlecry:** summon a 1/1 Stray next to it.',
  },
  {
    id: 'pack',
    name: 'Pack Scrounger',
    tribe: 'beast',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'pup', count: 2 } }],
    text: '**Deathrattle:** summon two 1/1 Pups.',
  },
  {
    id: 'kennel',
    name: 'Kennelmaster',
    tribe: 'beast',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [
      { on: 'onSummon', do: 'buffOnSummon', params: { tribe: 'beast', attack: 1, health: 1 } },
      { on: 'avenge', do: 'avengeImproveSummon', params: { count: 3 } },
    ],
    text: 'Each **Beast** you summon gains **+1/+1**. **Avenge (3):** Improve this.',
  },
  {
    id: 'cleaver',
    name: 'Ravenous Cleaver',
    tribe: 'beast',
    tier: 3,
    attack: 2,
    health: 4,
    keywords: ['C'],
    effects: [],
    text: '',
  },
  {
    id: 'matron',
    name: 'Bristleback Matron',
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onSummon', do: 'buffOnSummon', params: { tribe: 'beast', attack: 2, health: 2 } }],
    text: 'Each Beast you summon gets **+2/+2**.',
  },
  {
    id: 'gnash',
    name: 'Gnasher, the Overrun',
    tribe: 'beast',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'onKill', do: 'reAttackOnKill' }],
    text: 'When it kills a minion, it **attacks again**.',
  },
  {
    // A glass-cannon finisher: a 7/1 that pays off enormously when it dies.
    id: 'grim',
    name: 'Grim',
    tribe: 'beast',
    tier: 6,
    attack: 7,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffTribe', params: { tribe: 'beast', attack: 6, health: 6 } }],
    text: '**Deathrattle:** give your Beasts **+6/+6** for the rest of combat.',
  },
  {
    // Sample Choose One card — picks one Battlecry when played (see CardDef.chooseOne).
    id: 'shaper',
    name: 'Wildwood Shaper',
    tribe: 'beast',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [],
    chooseOne: [
      {
        text: 'Give your Beasts **+1/+1**.',
        effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'beast', attack: 1, health: 1 } }],
      },
      {
        text: 'Summon two 1/1 **Strays**.',
        effects: [{ on: 'onPlay', do: 'battlecrySummon', params: { tokenId: 'stray', count: 2 } }],
      },
    ],
    text: '**Choose One:** give your Beasts +1/+1; or summon two 1/1 Strays.',
  },
];
