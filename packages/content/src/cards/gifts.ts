import type { CardDef } from '@game/core';

/**
 * GIFTS (owner design 2026-08-26) — a new class of spell.
 *
 * A Gift casts exactly like a Shop spell: it sits in your hand, it wears the spell plate and frame, and
 * casting it COUNTS AS A SPELL CAST (the tallies, the `spellCast` watchers, the Ruby+Spell umbrella all fire).
 *
 * What a Gift is NOT is a **Shop spell**, and that distinction is the whole point:
 *   • it never appears in the shop,
 *   • it is never offered by a spell Discover or a random-spell grant (Merrin's Pocket Magic and friends),
 *   • it can never be duplicated — not by the spell-copy effects (Steward of Spells, Recaller, Rune of
 *     Recurrence, Mushy, the echo runes) nor repeated by a cast multiplier (the Dragons' spell recursion).
 *
 * The pool exclusions are STRUCTURAL rather than filtered: this array is deliberately absent from every set
 * manifest in `sets.ts`, so `poolOf()` — which is built from a set's `own` list — cannot contain a Gift in the
 * first place. It is added to `ALL_CARDS` (alongside TOKENS/HENCHMEN) purely so `CARD_INDEX` resolves the ids
 * a rune or hero hands out. The `gift: true` flag is what the CAST-time copy/repeat paths key on.
 *
 * Gifts are free (`cost: 0`) and arrive in hand from a rune or a hero power. `singleCast: true` on every one
 * is the "no cast multiplier" half of "cannot be duplicated".
 *
 * `attack`/`health` are the schema's required stat fields; a spell's are inert (they are never a body).
 */
export const GIFTS: CardDef[] = [
  {
    // The Shout multiplier the Dragons' `shoutExtraAlways` channel already models — but for ONE turn, so it
    // rides `shoutExtraThisTurn` and is cleared at end of turn rather than persisting for the run.
    id: 'gift_encore',
    name: 'Demand an Encore',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftShoutExtraTurn', params: { count: 1 } }],
    text: 'Your **Shouts** trigger an extra time this turn.',
  },
  {
    // Grants the Gold Pouch spell (`emberpouch`) now and again at every Start of Turn for the rest of the run.
    id: 'gift_allowance',
    name: 'Royal Allowance',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftRoyalAllowance', params: {} }],
    text: 'Get a **Gold Pouch**. Repeat every **Start of Turn**.',
  },
  {
    // The run-wide shop channel (`tavernBuyBonus`) — permanent, folded into every present and future offer.
    id: 'gift_premium_stock',
    name: 'Premium Stock',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftShopBuffGame', params: { attack: 4, health: 4 } }],
    text: 'Give minions in the **Shop +4/+4** this game.',
  },
  {
    id: 'gift_perfect_pick',
    name: 'Perfect Pick',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [],
    // `exactCurrentTier` tracks the LIVE tavern tier (Key Findings' "a minion from your tier"), so the pick is
    // always exactly your tier rather than "up to" it.
    discoverOnPlay: { exactCurrentTier: true },
    text: 'Discover a minion of your **Tier**.',
  },
  {
    id: 'gift_ironclad',
    name: 'Ironclad Favor',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'giftIroncladFavor', params: {} }],
    text: 'Give a friendly minion **Taunt** and **double its Health**.',
  },
  {
    id: 'gift_unbridled',
    name: 'Unbridled Might',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'giftUnbridledMight', params: { attack: 2 } }],
    text: 'Give a friendly minion **+2 Attack**, then **double its Attack**.',
  },
  {
    // Ward = DS, Critical Strike = CR, Flurry = W (the display names; see the keyword glossary).
    id: 'gift_regalia',
    name: "Champion's Regalia",
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'giftRegalia', params: {} }],
    text: 'Give a friendly minion **Ward**, **Critical Strike**, and **Flurry**.',
  },
  {
    // Owner ruling 2026-08-26: takes as many as the hand can hold; the remainder are lost, then the shop rolls.
    id: 'gift_larceny',
    name: 'Grand Larceny',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftGrandLarceny', params: {} }],
    text: 'Steal all of the cards in the **Shop**, then **Refresh** it.',
  },
  {
    id: 'gift_arcane_clearance',
    name: 'Arcane Clearance',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftSpellDiscountTurn', params: { amount: 1 } }],
    text: '**Shop Spells** cost **1 less** this turn.',
  },
  {
    id: 'gift_friends_family',
    name: 'Friends and Family',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftMinionDiscountTurn', params: { amount: 1 } }],
    text: 'Minions in the **Shop** cost **1 less** this turn.',
  },
  {
    // A Discover restricted to minions that HAVE an Echo (Deathrattle), then the pick gains Rise + Taunt.
    id: 'gift_grave_invitation',
    name: 'Grave Invitation',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [],
    // `filter: 'deathrattle'` is the Echo pool; `grantKeywords` bakes Rise + Taunt onto the picked card.
    discoverOnPlay: { filter: 'deathrattle', grantKeywords: ['R', 'T'] },
    text: 'Discover an **Echo** minion and give it **Rise** and **Taunt**.',
  },
  {
    id: 'gift_fast_track',
    name: 'Fast Track',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftUpgradeDiscount', params: { amount: 5 } }],
    text: 'Reduce the cost of **upgrading the Shop** by **5**.',
  },
  {
    // Owner clarification 2026-08-26: the tier ABOVE yours, capped at 7 (so a tier-7 shop still pays out).
    id: 'gift_special_delivery',
    name: 'Special Delivery',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftTierAboveMinion', params: {} }],
    text: 'Get a random minion from the **tier above** you.',
  },
  {
    // Owner clarification 2026-08-26: REPLACES an existing second power rather than being skipped.
    id: 'gift_second_calling',
    name: 'Second Calling',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'giftSecondCalling', params: {} }],
    text: 'Get a random **second hero power**.',
  },
  {
    id: 'gift_parting_gifts',
    name: 'Parting Gifts',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    singleCast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'giftPartingGifts', params: { count: 2 } }],
    text: 'Sell a friendly minion. Give its stats to **2 random** friendly minions.',
  },
];

/** Every Gift id — the pool a "get a random Gift" / "Discover a Gift" grant draws from. */
export const GIFT_IDS: readonly string[] = GIFTS.map((g) => g.id);
