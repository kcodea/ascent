import type { CardDef } from '@game/core';

/**
 * THE MINION ARCHIVE (owner 2026-08-04) — cards REMOVED from play but not from code. An archived card
 * belongs to NO set: it can never be drawn, offered, Discovered, granted or conjured (every generation path
 * resolves through a set pool, and this list is in none). It stays in `CARD_INDEX` so anything that already
 * holds one keeps working — saved runs, pinned opponent boards, replays, and old leaderboard entries all
 * resolve ids through the global index.
 *
 * To archive a card: MOVE its def here from its set file (verbatim — keep its comments), and check nothing
 * still *generates* it by id (a quest/rune reward naming an archived id would be a dead reward). To restore
 * one, move it back. Set counts in tests change by exactly the cards moved.
 */
export const ARCHIVED_CARDS: CardDef[] = [
  {
    // Dragon/DEMON. Owner rework 2026-07-31 (second pass): from the capped friendly-Demon consume payoff to a
    // RALLY that casts a Staff of Guel — permanent (the tavern-buy enchant carries out of combat), scaled by
    // the run's spell power, and a real spell cast that feeds Guel / Groveweaver / Runebloom.
    id: 'd2_broodlord',
    name: 'Ashen Broodlord',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 5,
    attack: 6,
    health: 8,
    keywords: ['RL'], // Rally — the badge has to match the trigger
    effects: [{ on: 'onAttack', do: 'rallyCastShopBuffSpell', params: { attack: 2, health: 2 } }],
    text: '**Rally:** cast a **Staff of Guel**.',
    goldenText: '**Rally:** cast **2 Staves of Guel**.',
  },
  {
    // The wide version of Mirrorwing: instead of doubling on itself, it copies the spell onto its Dragon
    // neighbours — so seating matters, and it scales with a built board rather than with one big spell.
    id: 'd2_runefire',
    name: 'Runefire',
    tribe: 'dragon',
    tier: 6,
    attack: 6,
    health: 9,
    keywords: [],
    // Owner rework 2026-07-27 — reuses the same End-of-Turn recast Runic Archivist had (which now reads
    // `lastSpellCastId`), so the two cards share one primitive rather than two near-identical ones.
    effects: [{ on: 'endOfTurn', do: 'endOfTurnRecastFirstSpell', params: { count: 1 } }],
    text: '**End of Turn:** cast the last **Shop spell** you cast this turn again.',
    goldenText: '**End of Turn:** cast the last **Shop spell** you cast this turn **2 additional** times.',
  },
  {
    id: 'dm_chancellor',
    name: 'Rouge Rogue',
    tribe: 'demon',
    tier: 6,
    attack: 4,
    health: 12,
    keywords: [],
    // AUDIT FIND 2026-07-31: the printed rule and the wired effect had come apart — the text has said "Imp
    // attacks / improves" since the rename, but the card still carried `spellCastBuffImps` (a recruit-phase
    // per-spell buff, +1/+1). The matching combat factory `onImpAttackBuffImps` existed, schema-registered,
    // with NO card referencing it. Its escalation is per-combat (rides `summonBonus`, which `simulate` now
    // excludes from the carry-back for this card so "this combat" stays true).
    effects: [{ on: 'onAttack', do: 'onImpAttackBuffImps', params: { attack: 3, health: 3, improve: 1, improveEvery: 3 } }],
    text: 'Whenever an **Imp** attacks, give your Imps **+3/+3** this combat. Improves by **+1/+1** every **3** Imp attacks.',
    goldenText: 'Whenever an **Imp** attacks, give your Imps **+6/+6** this combat. Improves by **+2/+2** every **3** Imp attacks.',
  },
  {
    // End of Turn (recruit) → mint a Warding Ruby (a Ruby that also grants Ward) into hand.
    id: 'k_wardstone',
    name: 'Wardstone Jeweler',
    tribe: 'kobold',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnGetRubies', params: { count: 1, rubyId: 'warding-ruby' } }],
    text: '**End of Turn:** Get a **Warding Ruby**.',
    goldenText: '**End of Turn:** Get **2 Warding Rubies**.',
  },
  {
    // "When a Ruby is played on THIS minion" → Gold, capped per turn (per-instance `rubyRecvTick`).
    id: 'k_rubybroker',
    name: 'Ruby Broker',
    tribe: 'kobold',
    tier: 5,
    attack: 2,
    health: 6,
    keywords: [],
    effects: [{ on: 'onRubyPlayed', do: 'rubyPlayedGold', params: { gold: 2, cap: 3 } }],
    text: 'Rubies played on this minion give you **2 Gold** (three times per turn).',
    goldenText: 'Rubies played on this minion give you **3 Gold** (three times per turn).',
  },
];
