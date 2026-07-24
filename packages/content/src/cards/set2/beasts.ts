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
    // A low-tier spell payoff: your first cast each turn washes the board of Beasts with +1/+1.
    id: 'b2_mosswhisker',
    name: 'Mosswhisker Adept',
    tribe: 'beast',
    tier: 2,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastFirstBuffTribe', params: { tribe: 'beast', attack: 1, health: 1 } }],
    text: 'The first time you cast a spell each turn, give your Beasts **+1/+1** wherever they are.',
    goldenText: 'The first time you cast a spell each turn, give your Beasts **+2/+2** wherever they are.',
  },
  {
    // The top-end spell payoff: every cast rains +3/+3 onto three Beasts. Rewards a spell-heavy Beast board.
    id: 'b2_runebloom',
    name: 'Runebloom Matriarch',
    tribe: 'beast',
    tier: 6,
    attack: 5,
    health: 9,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastBuffRandomTribe', params: { tribe: 'beast', count: 3, attack: 3, health: 3 } }],
    text: 'Whenever you cast a spell, give 3 Beasts **+3/+3**.',
    goldenText: 'Whenever you cast a spell, give 3 Beasts **+6/+6**.',
  },
  {
    // Reuses Ryme's adjacent-Battlecry re-fire (`deathrattleReplayAdjacentBattlecry`): on death in combat, both
    // neighbours' Shouts fire again (golden fires each twice) — exactly the shared primitive.
    id: 'b2_dawnclaw',
    name: 'Dawnclaw',
    tribe: 'beast',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry' }],
    text: "**Echo:** trigger adjacent minions' **Shouts**.",
    goldenText: "**Echo:** trigger adjacent minions' **Shouts** twice.",
  },
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
