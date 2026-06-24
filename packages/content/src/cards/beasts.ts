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
    goldenText: '**Battlecry:** summon two 1/1 Strays next to it.',
  },
  {
    id: 'pack',
    name: 'Mama Pup',
    tribe: 'beast',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'pup', count: 2 } }],
    text: '**Deathrattle:** summon two 1/1 Pups.',
    goldenText: '**Deathrattle:** summon four 1/1 Pups.',
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
    id: 'gnash',
    name: 'Gnasher, the Overrun',
    tribe: 'beast',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [
      { on: 'onKill', do: 'reAttackOnKill' },
      { on: 'onKill', do: 'onKillBuffSpellPower', params: { attack: 1, health: 1 } },
    ],
    text: 'When it kills a minion, it **attacks again** and your spells permanently gain **+1/+1**.',
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
    effects: [{ on: 'onDeath', do: 'deathrattleBuffTribeByTally', params: { tribe: 'beast', per: 1 } }],
    text: '**Deathrattle:** give your Beasts **+1/+1** for each Deathrattle triggered this game.',
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
    goldenText: '**Choose One:** give your Beasts +2/+2; or summon four 1/1 Strays.',
  },
  {
    id: 'spiritpup',
    name: 'Spirit Pup',
    tribe: 'beast',
    tribe2: 'dragon',
    tier: 5,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastTransform', params: { at: 10, into: 'spiritworgen' } }],
    text: 'Cast **10 spells** with this on board to transform into **Spirit Worgen**.',
  },
  {
    // The transform target — obtained only via Spirit Pup, so `token: true` keeps it out of the shop
    // pool while still living in CARD_INDEX (for the transform + its art). It keeps the Pup's stats at
    // transform; its base 4/6 is only the schema floor.
    id: 'spiritworgen',
    name: 'Spirit Worgen',
    tribe: 'beast',
    tribe2: 'dragon',
    tier: 5,
    attack: 4,
    health: 6,
    keywords: [],
    token: true,
    effects: [
      { on: 'onSummon', do: 'summonBuffSelfTribe', params: { tribes: ['beast', 'dragon'], attack: 1, health: 1 } },
    ],
    text: 'Gains **+1/+1** each time you summon a **Beast** or **Dragon** — improves per spell cast this turn.',
  },

  // --- New beasts (2026-06-24 content batch). Manasaber is a token-summoner (data only); Raptor and Sea
  //     Urchin use new effect factories on existing triggers (broadcast onAttack / a tribe-filtered Discover). ---
  {
    // Deathrattle cub-summoner — a fragile 4/1 that leaves a 0/2 Taunt body behind. Golden → 2 cubs.
    id: 'manasaber',
    name: 'Manasaber',
    tribe: 'beast',
    tier: 1,
    attack: 4,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'sabercub', count: 1 } }],
    text: '**Deathrattle:** summon a 0/2 Saber Cub with **Taunt**.',
    goldenText: '**Deathrattle:** summon two 0/2 Saber Cubs with **Taunt**.',
  },
  {
    // Combat support: when ANOTHER friendly Beast attacks, pump it +3/+1 before the hit lands (onAttack
    // is emitted pre-damage). A tanky 2/8 enabler for a go-wide Beast board — does NOT buff itself (a
    // support body, not a self-ramp). Golden → +6/+2.
    id: 'raptor',
    name: 'Raptor',
    tribe: 'beast',
    tier: 3,
    attack: 2,
    health: 8,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onFriendlyAttackBuffTribe', params: { tribe: 'beast', attack: 3, health: 1 } }],
    text: 'When a friendly **Beast** attacks, give it **+3/+1**.',
    goldenText: 'When a friendly **Beast** attacks, give it **+6/+2**.',
  },
  {
    // Battlecry tribe-Discover: peek 3 Beasts (up to your tavern tier), pick one. Golden → Discover twice.
    id: 'seaurchin',
    name: 'Sea Urchin',
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion', params: { tribe: 'beast' } }],
    text: '**Battlecry:** Discover a Beast.',
    goldenText: '**Battlecry:** Discover **2** Beasts.',
  },
];
