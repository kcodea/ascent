import type { CardDef } from '@game/core';

/**
 * Beasts (set 2) — the tribe brought forward from set 1 with a spell/summon-synergy tilt (owner roster
 * 2026-07-24). Several set-1 Beasts carry over unchanged (see `SET1_BEASTS_IN_SET2` in `sets.ts`); the cards
 * authored HERE are the set-2 additions.
 *
 * IN PROGRESS — this tranche holds only the fully-specified new cards. The rest of the owner's 21-card roster
 * is blocked on missing Attack/Health (14 cards list none) and a few genuinely new mechanics (Moonhowl Mentor's
 * "teach a bought spell to a Mage-Pup", the self-replicating Rally on Sunmane Herald / Solaris); those land once
 * the owner supplies stats + rulings.
 */
export const SET2_BEASTS: CardDef[] = [
  {
    // A go-wide Rally payoff: the more Beasts you field, the harder it hits. Buffs ITSELF (not the board) so
    // it's a finisher you build around rather than an aura.
    id: 'b2_packstrider',
    name: 'Packstrider',
    tribe: 'beast',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyBuffSelfPerTribe', params: { tribe: 'beast', attack: 1, health: 1 } }],
    text: '**Rally:** gain **+1/+1** for every Beast you control.',
    goldenText: '**Rally:** gain **+2/+2** for every Beast you control.',
  },
];
