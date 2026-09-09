import type { CardDef } from '@game/core';

/**
 * SET 3 — HAND SPELLS (owner design 2026-09-09): spells a CARD mints into your hand, cast by aiming at a
 * friendly minion. They are the GIFT class exactly (`gift: true` — see `cards/gifts.ts`): a real spell cast
 * for every tally and `spellCast` watcher, never a Shop spell (never in the shop, never Discovered, never
 * copied by Steward / Recaller / Recurrence / Mushy), free, and absent from every set manifest so `poolOf()`
 * can never offer one. Two things set them apart from the rune Gifts:
 *   • they are minted by CARDS (`battlecryGetHandSpell`), not handed out by a rune or hero, so they stay out
 *     of `GIFT_IDS` — Merry Christmas's Gift Discover must not offer a Tower Shield;
 *   • `giftMulticast`: a TARGETED hand spell may be repeated by the set-3 Yazzus ("your targeted spells cast
 *     an additional time") — the one cast multiplier a Gift honours. Set 1's Yazzus says "Shop spells" and
 *     never touches them.
 * Neither takes spell power or any other buff (owner 2026-09-09: "as of now").
 * `attack`/`health` are the schema's required stat fields; a spell's are inert.
 */
export const SET3_HAND_SPELLS: CardDef[] = [
  {
    // Defender's Shout mints two. Fixed +2/+1 and Taunt — `flat: true` opts the stat grant out of spell power,
    // exactly as Crest of the Climb's single-stat branches do. `target: 'friendly'`: Taunt needs a real body.
    id: 'tower_shield',
    name: 'Tower Shield',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellBuffTarget', params: { attack: 2, health: 1, keyword: 'T', flat: true } }],
    text: 'Give a friendly minion **+2/+1** and **Taunt**.',
  },
  {
    // Inspector Pell's Magnifying Glass mints two. A Clue grants the run's CURRENT Clue value (base 1/1 plus
    // `clueBonus`), then raises that value by one — so every later Clue, held or minted, is bigger. The value
    // is read at CAST from run state rather than baked per instance (the Ruby shape), which is what lets every
    // Clue in hand print the live number through `spellDisplayText` with no per-card bookkeeping.
    id: 'clue',
    name: 'Clue',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'clueBuffTarget', params: {} }],
    text: 'Give a friendly minion **+1/+1**. Improve your Clues by **+1/+1**.',
  },
];
