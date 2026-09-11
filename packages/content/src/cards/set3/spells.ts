import type { CardDef } from '@game/core';

/**
 * SET 3 SPELLS — the NEW rows of the owner's Set 3 spell sheet (2026-09-10). The shared neutral toolkit and the
 * carried tribe spells are opted in by id in `sets.ts`; only spells that did not exist live here. Spells are
 * never golden (owner 2026-09-10). Tabled for now, by owner call: Refraction, Stardust, Stellar Chorus and
 * Split Decision follow in their own tranche.
 *
 * Owner answers (2026-09-10): Aspect's Blessing / Shared Spirit pick RANDOM hand (and board) minions; Hand Soap
 * is the left-most MINION in hand (spells skipped); a tribe spell (Rush Order → Dwarf, Star Crash → Celestial,
 * Crescendo → Spirit) is offered only when that tribe is a run tribe (`runSpells`).
 */
export const SET3_SPELLS: readonly CardDef[] = [
  {
    // T4, aimed (board or tavern minion): +2/+2, improved by +3/+3 for EACH spell cast this turn before it — any spell:
    // Shop spells, Rubies, Gifts (Tower Shield, Clue) all count (owner 2026-09-10). The cast itself is not counted
    // (the tally is read while the effect resolves, before the cast is noted). Spell power folds into the base.
    id: 'stellarchorus',
    name: 'Stellar Chorus',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    target: 'any',
    effects: [{ on: 'cast', do: 'spellBuffTargetPerSpellsCast', params: { attack: 2, health: 2, perAttack: 3, perHealth: 3 } }],
    text: 'Give a minion **+2/+2**. Improve this by **+3/+3** for each spell you cast this turn.',
  },
  {
    // T5 Choose One — Discover a minion (the standard pool: every tier up to yours — owner: "any tier"), or Discover
    // a Shop spell. Each branch queues its Discover from the cast effect (Rival's Reflection's shape).
    id: 'splitdecision',
    name: 'Split Decision',
    tribe: 'neutral',
    tier: 5,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [],
    chooseOne: [
      { text: '**Discover** a minion.', effects: [{ on: 'cast', do: 'spellDiscoverMinion' }] },
      { text: '**Discover** a **Shop spell**.', effects: [{ on: 'cast', do: 'spellDiscoverShopSpell' }] },
    ],
    text: '**Choose One:** **Discover** a minion, or **Discover** a **Shop spell**.',
  },
  {
    // T1 Choose One — a random HAND minion +3/+1 or +1/+3. Spell power folds in (the standard cast rule).
    id: 'aspectsblessing',
    name: "Aspect's Blessing",
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [],
    chooseOne: [
      { text: 'Give a random minion in your hand **+3/+1**.', effects: [{ on: 'cast', do: 'spellBuffRandomHand', params: { attack: 3, health: 1 } }] },
      { text: 'Give a random minion in your hand **+1/+3**.', effects: [{ on: 'cast', do: 'spellBuffRandomHand', params: { attack: 1, health: 3 } }] },
    ],
    text: '**Choose One:** give a random minion in your hand **+3/+1**, or **+1/+3**.',
  },
  {
    // T2 (Dwarf) Choose One — a random Dwarven Ale to hand, or 3 Gold next turn (the Safety Deposit Box shape).
    id: 'rushorder',
    name: 'Rush Order',
    tribe: 'dwarf',
    tier: 2,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [],
    chooseOne: [
      { text: 'Get a random **Dwarven Ale**.', effects: [{ on: 'cast', do: 'grantRandomAle', params: { count: 1 } }] },
      { text: 'Gain **3 Gold** next turn.', effects: [{ on: 'cast', do: 'battlecryBonusGoldNextTurn', params: { gold: 3 } }] },
    ],
    text: '**Choose One:** get a random **Dwarven Ale**, or gain **3 Gold** next turn.',
  },
  {
    // T2 — one random BOARD minion and one random HAND minion each get +3/+2 (owner: both random). Spell power in.
    id: 'sharedspirit',
    name: 'Shared Spirit',
    tribe: 'neutral',
    tier: 2,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellBuffRandomBoardAndHand', params: { attack: 3, health: 2 } }],
    text: 'Give a random minion on your board and a random minion in your hand **+3/+2**.',
  },
  {
    // T3 (Celestial), aimed at a friendly Celestial: +5/+7 to it, and the same to a random friendly minion — "a random
    // friendly minion" includes the target (R-TARGET-01: no "other" printed, so the whole side is eligible).
    id: 'starcrash',
    name: 'Star Crash',
    tribe: 'celestial',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    target: 'friendly',
    targetTribe: 'celestial',
    effects: [{ on: 'cast', do: 'spellBuffTargetAndRandomFriendly', params: { attack: 5, health: 7 } }],
    text: 'Give a **Celestial +5/+7**. It also casts on a random friendly minion.',
  },
  {
    // T3, aimed: DESTROY a friendly minion (the two-step death Graverobber uses — its Echo, departure and Rise get
    // their beats), then get a random Shop spell (tier-eligible, never an Ale — the "random spell" grant shape).
    id: 'graverobbery',
    name: 'Grave Robbery',
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellDestroyTargetGetSpell', params: { count: 1 } }],
    text: 'Destroy a friendly minion. Get a random **Shop spell**.',
  },
  {
    // T4 — the LEFT-MOST MINION in hand +8/+8 (spells in hand are skipped — owner 2026-09-10). Spell power in.
    id: 'handsoap',
    name: 'Hand Soap',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellBuffLeftmostHandMinion', params: { attack: 8, health: 8 } }],
    text: 'Give the left-most minion in your hand **+8/+8**.',
  },
  {
    // T6 (Spirit) — the whole board +1/+1 for each Spirit PLAYED this turn (Hoardflame's per-tribe shape, board-wide).
    // Prints its live value (spellDisplayText). Spell power folds in once, like Growth.
    id: 'crescendo',
    name: 'Crescendo',
    tribe: 'spirit',
    tier: 6,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 3,
    effects: [{ on: 'cast', do: 'spellBuffAllPerTribePlayed', params: { tribe: 'spirit', attack: 1, health: 1 } }],
    text: 'Give your minions **+1/+1** for each **Spirit** you played this turn.',
  },
];
