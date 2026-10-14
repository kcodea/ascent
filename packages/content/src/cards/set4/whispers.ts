import type { CardDef } from '@game/core';

/**
 * SET 4 — THE WHISPERS (owner 2026-10-13). A Whisper is a SPELL a card GRANTS: a copy lands in hand when the
 * granting minion is played from hand, and again at every Start of Turn while that minion is on your board. An
 * unused Whisper vanishes at End of Turn (and so never counts as cast). Whispers are the Gift class (`gift: true`):
 * every cast counts as a spell cast, but a Whisper is never a Shop spell, never offered, never copy food for the
 * spell-copy effects, and absent from every set manifest. `giftMulticast`: the one cast multiplier a Gift honours
 * (Yazzus: "your targeted spells cast an additional time"), so a repeat is a real extra cast.
 *
 * A Whisper's stat grant is TEMPORARY (owner rule): applied in the Shop, kept through that turn's combat, removed
 * at the next Start of Turn (`BoardCard.whisperBuffs`). Engraved does not keep it. Its value is read at CAST from
 * run state, so a Whisper in hand always prints the number it will grant right now.
 *
 * `target: 'friendly'` (judgement call, flagged in the devlog): a temporary grant needs a real body to expire from.
 * `attack`/`health` are the schema's required stat fields; a spell's are inert.
 */
export const SET4_WHISPERS: CardDef[] = [
  {
    // Galas's Whisper: +1/+1, plus +1/+1 for every 4 spells cast this game (retroactive, read at cast).
    id: 'w4_tome',
    name: 'Tome',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'whisperBuffTarget', params: { attack: 1, health: 1, perSpells: 4 } }],
    text: 'Give a friendly minion **+1/+1** until your next turn. Improves every 4 spells cast this game.',
  },
  {
    // Tolan's Whisper: +2/+2, then improve EVERY Runebind (held, future, a later Tolan's) by +2/+2 for the run.
    id: 'w4_runebind',
    name: 'Runebind',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'whisperBuffTarget', params: { attack: 2, health: 2, improve: 2 } }],
    text: 'Give a friendly minion **+2/+2** until your next turn. Improve this.',
  },
];
