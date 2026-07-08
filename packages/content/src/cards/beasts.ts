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
    name: 'Pennycat',
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
    attack: 3,
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
    attack: 1,
    health: 4,
    keywords: ['SC'],
    effects: [
      { on: 'startOfCombat', do: 'scBeastAura', params: { tribe: 'beast', attack: 1, health: 1 } },
      { on: 'avenge', do: 'avengeImproveSummon', params: { count: 2 } },
    ],
    // Start of Combat: a Beast aura +N/+N that lasts the fight — current Beasts + any summoned later inherit
    // it (the "wherever they are" aura). N = 1 + its Avenge-grown summonBonus (carried across combats). The
    // live value + Avenge countdown surface via cardText's kennelmaster helper on every surface.
    text: '**Start of Combat:** give your Beasts **+1/+1** wherever they are. **Avenge (2):** Improve this.',
    goldenText: '**Start of Combat:** give your Beasts **+2/+2** wherever they are. **Avenge (2):** Improve this.',
  },
  {
    id: 'gnash',
    name: 'Gnasher, the Overrun',
    tribe: 'beast',
    tier: 6,
    attack: 7,
    health: 6,
    keywords: ['SL'],
    effects: [
      { on: 'onKill', do: 'onKillBuffSpellPower', params: { attack: 1, health: 1 } },
    ],
    text: '**Slaughter:** your spells permanently gain **+1/+1**.',
  },
  {
    // A tempo Beast that mills spells: throws one to hand whenever it swings (Rally) or scores a kill
    // (Slaughter). The random spell obeys the current shop tier (via ctx.grantRandomSpell at settle).
    id: 'badgington',
    name: 'Badgington',
    tribe: 'beast',
    tier: 4,
    attack: 5,
    health: 6,
    keywords: ['RL', 'SL'],
    effects: [
      { on: 'onAttack', do: 'rallyGrantRandomSpell', params: { count: 1 } },
      { on: 'onKill', do: 'onKillGrantRandomSpell', params: { count: 1 } },
    ],
    text: '**Rally:** get a random spell. **Slaughter:** get a random spell.',
    goldenText: '**Rally:** get **2** random spells. **Slaughter:** get **2** random spells.',
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
    text: '**Deathrattle:** give your Beasts **+1/+1** wherever they are for each Deathrattle triggered this game.',
  },
  {
    id: 'shaper',
    name: 'Wildwood Shaper',
    tribe: 'beast',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Give your Beasts **+1/+3**.', effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'beast', attack: 1, health: 3 } }] },
      { text: 'Summon a 1/1 **Stray**.', effects: [{ on: 'onPlay', do: 'battlecrySummon', params: { tokenId: 'stray', count: 1 } }] },
    ],
    text: '**Choose One:** Give your Beasts **+1/+3**, or summon a 1/1 **Stray**.',
    goldenText: '**Choose One:** Give your Beasts **+2/+6**, or summon two 1/1 **Strays**.',
  },
  {
    id: 'spiritpup',
    name: 'Spirit Pup',
    tribe: 'beast',
    tribe2: 'dragon',
    tier: 5,
    attack: 6,
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
      { on: 'endOfTurn', do: 'endOfTurnBuffPerTribePlayed', params: { tribes: ['beast', 'dragon'], attack: 2, health: 2 } },
    ],
    text: '**End of Turn:** gain **+2/+2** for each **Beast** or **Dragon** you played this turn. Improve this by **+1/+1** for each spell you cast.',
    goldenText: '**End of Turn:** gain **+4/+4** for each **Beast** or **Dragon** you played this turn. Improve this by **+2/+2** for each spell you cast.',
  },

  // --- New beasts (2026-06-24 content batch). Manasaber is a token-summoner (data only); Raptor and Sea
  //     Urchin use new effect factories on existing triggers (broadcast onAttack / a tribe-filtered Discover). ---
  {
    // Deathrattle cub-summoner — a fragile 4/1 that leaves two 0/2 Taunt bodies behind. Golden keeps the
    // count and GILDS the cubs instead (0/4 each — `fixed` + `goldenTokens`).
    id: 'manasaber',
    name: 'Void Panther',
    tribe: 'beast',
    tier: 1,
    attack: 4,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'sabercub', count: 2, fixed: true, goldenTokens: true } }],
    text: '**Deathrattle:** summon two 0/2 Void Cubs with **Taunt**.',
    goldenText: '**Deathrattle:** summon two 0/4 Void Cubs with **Taunt**.',
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
    health: 6,
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
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion', params: { tribe: 'beast' } }],
    text: '**Battlecry:** Discover a Beast.',
    goldenText: '**Battlecry:** Discover **2** Beasts.',
  },

  // --- Final beasts (2026-06-24) — combat→run carry-backs (Sporebat, Gryphon) + a dual-surface summon
  //     engine (Mama Bear). ---
  {
    // Defensive value engine: a Taunt body that, on death, hands you a random tavern-tier spell. Golden → 2.
    id: 'sporebat',
    name: 'Sporebat',
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantRandomSpell', params: { count: 1 } }],
    text: '**Taunt. Deathrattle:** add a random tavern-tier spell to your hand.',
    goldenText: '**Taunt. Deathrattle:** add **2** random tavern-tier spells to your hand.',
  },
  {
    // Economy Taunt: each time it takes damage, bank a free shop reroll — up to 4 hits a combat (the cap
    // keeps a Taunt that soaks a whole board from rolling unlimited refreshes). Golden banks 2 per hit.
    id: 'gryphon',
    name: 'Gryphon',
    tribe: 'beast',
    tier: 3,
    attack: 2,
    health: 5,
    keywords: ['T'],
    effects: [{ on: 'onDamaged', do: 'onDamagedGrantRefresh', params: { count: 1, max: 4 } }],
    text: '**Taunt.** Each time this takes damage, gain a **free refresh** — up to **4 hits** a combat.',
    goldenText: '**Taunt.** Each time this takes damage, gain **2 free refreshes** — up to **4 hits** a combat.',
  },
  {
    // Summon-payoff that snowballs: each Beast you summon (in OR out of combat) gets buffed, and the buff
    // grows by +3/+3 every time. Pairs with token-summoners (Manasaber, Mama Pup). Golden doubles.
    id: 'mamabear',
    name: 'Den Mother',
    tribe: 'beast',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'onSummon', do: 'summonBuffTribeImprove', params: { tribe: 'beast', attack: 2, health: 2 } }],
    text: 'When you summon a **Beast**, give it **+2/+2** — and improve this by **+2/+2**.',
    goldenText: 'When you summon a **Beast**, give it **+4/+4** — and improve this by **+4/+4**.',
  },
  {
    // Rally payoff for a Den Mother board: each of its own attacks permanently improves every friendly Den
    // Mother's summon aura by +5/+5 (bumps the accrued summonBonus, which carries back so the bigger aura
    // persists in AND out of combat). Golden → +10/+10 per attack. Dead weight without a Den Mother out.
    id: 'babycub',
    name: 'Baby Cub',
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyImproveSummonAura', params: { amount: 5, cardId: 'mamabear' } }],
    text: '**Rally:** improve your **Den Mother** aura by **+5/+5**.',
    goldenText: '**Rally:** improve your **Den Mother** aura by **+10/+10**.',
  },

  // --- 2026-07-06 content batch ---
  {
    // Choose One battlecry: pick a buff (Rise or Flurry), THEN pick a friendly Beast to receive it — the
    // Choose One defers to targeting (reducer sets `pendingTarget` after the option). `target: 'friendly'`
    // + `targetTribe: 'beast'` drive the pick; `battlecryGrantKeyword` grants to the chosen minion. With no
    // other Beast on board it auto-grants to itself. A tempo enabler for a go-wide Beast board.
    id: 'beetle',
    name: 'Runic Beetle',
    tribe: 'beast',
    tier: 3,
    attack: 3,
    health: 1,
    keywords: [],
    target: 'friendly',
    targetTribe: 'beast',
    effects: [],
    chooseOne: [
      { text: 'Give a friendly Beast **Rise**.', effects: [{ on: 'onPlay', do: 'battlecryGrantKeyword', params: { keywords: ['R'] } }] },
      { text: 'Give a friendly Beast **Flurry**.', effects: [{ on: 'onPlay', do: 'battlecryGrantKeyword', params: { keywords: ['W'] } }] },
    ],
    text: '**Choose One:** give a friendly Beast **Rise**, or **Flurry**.',
  },
  {
    // Dual-type Beast/Mech finisher. Rally builds a rest-of-combat Beast Attack aura that catches summons
    // ("wherever they are"); Avenge shields it and sends it in for a bonus swing. Snowballs its own Attack
    // each time it attacks (it's a Beast). Golden doubles the Rally grant + the immediate strikes.
    id: 'solaris',
    name: 'Solaris Fang',
    tribe: 'beast',
    tribe2: 'mech',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: ['RL'],
    effects: [
      { on: 'onAttack', do: 'rallyTribeAura', params: { tribe: 'beast', attack: 5, health: 0 } },
      { on: 'avenge', do: 'avengeShieldAttack', params: { count: 3 } },
    ],
    text: '**Rally:** give your Beasts **+5 Attack** wherever they are. **Avenge (3):** gain **Ward** and attack immediately.',
    goldenText: '**Rally:** give your Beasts **+10 Attack** wherever they are. **Avenge (3):** gain **Ward** and attack immediately.',
  },
  {
    // Start of Combat: mirror itself — summon a copy of its current body (stats + granted keywords). Golden
    // summons two. Combat summons don't re-fire Start of Combat, so it never chains. A T6 board-doubler.
    id: 'mirrorrhino',
    name: 'Mirrorhide Rhino',
    tribe: 'beast',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'scSummonCopy' }],
    text: '**Start of Combat:** Summon a copy of this minion.',
    goldenText: '**Start of Combat:** Summon **two** copies of this minion.',
  },
  {
    // Start of Combat: buff your Beasts +1/+2, improved +1/+1 for each Beast you played this recruit turn
    // (frozen at combat start, threaded into the sim like spellsThisTurn). A go-wide Beast SoC payoff that
    // rewards a busy beast turn. Golden doubles the whole grant.
    id: 'packleader',
    name: 'Pack Leader',
    tribe: 'beast',
    tier: 3,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'scTribeBuffPerPlayed', params: { tribe: 'beast', attack: 1, health: 2, perPlayed: 1 } }],
    text: '**Start of Combat:** Give your **Beasts** **+1/+2**. Improve this by **+1/+1** for each **Beast** you played this turn.',
    goldenText: '**Start of Combat:** Give your **Beasts** **+2/+4**. Improve this by **+2/+2** for each **Beast** you played this turn.',
  },
];
