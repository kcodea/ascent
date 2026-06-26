import type { CardDef } from '@game/core';

/** Non-buyable tokens summoned by other cards. */
export const TOKENS: CardDef[] = [
  {
    id: 'pup',
    name: 'Pup',
    tribe: 'beast',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    text: 'A 1/1 Beast token.',
    token: true,
  },
  {
    // Nanon's Deathrattle swarm — a plain 1/1 Mech body. Not in the shop.
    id: 'nanobot',
    name: 'Nanobot',
    tribe: 'mech',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    text: 'A 1/1 Mech.',
    token: true,
  },
  {
    id: 'stray',
    name: 'Stray',
    tribe: 'beast',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    text: 'A 1/1 Beast token.',
    token: true,
  },
  {
    id: 'impscrap',
    name: 'Imp',
    tribe: 'demon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    // A plain 1/1 with no keyword and no Fodder interaction — no body text (the stats say it all).
    text: '',
    token: true,
    imp: true, // the target of imp-buff effects (Fodder Feeder / Imp King / Brood / Ritualist / Bane)
  },
  {
    id: 'discoverspell',
    name: 'Triple Reward',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    effects: [],
    // The displayed text is overridden in the UI to name the exact Tier (current + 1, capped) —
    // see `discoverSpellText` in Recruit. This is the fallback if that ever isn't applied.
    text: '**Discover** a minion from one Tier up.',
    token: true,
  },
  {
    // Manasaber's Deathrattle cub — a 0/2 Taunt body that screens the line. Not in the shop.
    id: 'sabercub',
    name: 'Saber Cub',
    tribe: 'beast',
    tier: 1,
    attack: 0,
    health: 2,
    keywords: ['T'],
    effects: [],
    text: 'A 0/2 Beast with **Taunt**.',
    token: true,
  },
  {
    // Tara's ascend form (obtained only via Tara, so `token: true` keeps it out of the shop). Engraved; on
    // EVERY ally attack it casts Growth (+3/+4 to your minions) — explosive on a wide board. Golden casts it
    // twice. Keeps Tara's accumulated stats at ascension; its 3/3 base is only the schema floor.
    id: 'taragosa',
    name: 'Taragosa',
    tribe: 'dragon',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: ['EG'],
    token: true,
    effects: [{ on: 'onAttack', do: 'onAllyAttackCastGrowth', params: { attack: 3, health: 4 } }],
    text: 'All stats are **Engraved**. When a minion attacks, cast **Growth** (+3/+4 to your minions).',
    goldenText: 'All stats are **Engraved**. When a minion attacks, cast **Growth twice** (+6/+8 to your minions).',
  },
  {
    // Chaos hero power token (id kept as `symbioticattachment` for save/pool compatibility) — a 1/1 Magnetic
    // Reborn that counts as every tribe. Magnetizes onto ANY non-neutral minion (all-type magnetic targeting
    // handled in magnetizesTo). Gives the welder +1/+1 AND grants it Reborn (its keywords ride along on the weld
    // via applyWeld), regardless of tribe, and counts for all tribe-buff effects on the board / in hand.
    id: 'symbioticattachment',
    name: 'Chaos Attachment',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: ['M', 'R'],
    effects: [],
    text: '**Magnetic**, **Reborn**. Counts as all tribes.',
    token: true,
    universalTribe: true,
  },
  {
    // Deathless Hand's Deathrattle summon — a 1/1 Undead with Reborn. Not in the shop.
    id: 'footman',
    name: 'Footman',
    tribe: 'undead',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: ['R'],
    effects: [],
    text: '**Reborn.**',
    token: true,
  },
  {
    // Twilight Whelp's Deathrattle cub — a 3/3 Dragon that ATTACKS IMMEDIATELY when summoned (out of turn
    // order), then joins the rotation. Not in the shop. (Broodmother → Twilight Whelps → these.)
    id: 'whelpling',
    name: 'Whelp',
    tribe: 'dragon',
    tier: 1,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [],
    attackOnSummon: true,
    text: 'A 3/3 Dragon that attacks immediately when summoned.',
    token: true,
  },
];
