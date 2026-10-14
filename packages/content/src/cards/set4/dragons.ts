import type { CardDef } from '@game/core';

/**
 * SET 4 — DRAGONS (owner 2026-10-13): the WHISPER Dragons. Galas and Tolan GRANT a Whisper (`grantWhisper`: a Start of
 * Turn effect while on the board, and the reducer's minion play reads the same marker to hand one over the moment
 * the minion is played from hand, see `sim/whisper.ts`); Tamby and Whisp react to Whispers being cast on minions. No art yet (missing-art convention).
 */
export const SET4_DRAGONS: readonly CardDef[] = [
  {
    // T1 3/1. Whisper: Tome. Gilded: its Tome is worth double (+2/+2, improving by +2/+2 every 4 spells).
    id: 'd4_galas',
    name: 'Galas',
    tribe: 'dragon',
    tier: 1,
    attack: 3,
    health: 1,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w4_tome' } }],
    text: '**Whisper:** Give a friendly minion **+1/+1**. Improves every 4 spells cast this game.',
    goldenText: '**Whisper:** Give a friendly minion **+2/+2**. Improves by **+2/+2** every 4 spells cast this game.',
  },
  {
    // T2 2/5. Whisper: Runebind (+2/+2, improve this: run-wide, every copy). Gilded: double the value and the improve.
    id: 'd4_tolan',
    name: 'Tolan',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w4_runebind' } }],
    text: '**Whisper:** Give a friendly minion **+2/+2**. Improve this.',
    goldenText: '**Whisper:** Give a friendly minion **+4/+4**. Improve this twice.',
  },
  {
    // T3 3/4. A Whisper cast on this hands back a copy (once per turn). Gilded: 2 copies.
    id: 'd4_tamby',
    name: 'Tamby',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'spellCastOnThis', do: 'whisperCastOnThisCopy', params: { count: 1 } }],
    text: 'When you cast a **Whisper** on this, get a copy of it. (Once per turn)',
    goldenText: 'When you cast a **Whisper** on this, get **2** copies of it. (Once per turn)',
  },
  {
    // T6 7/6. A Whisper cast on a Dragon is ALSO cast on this (a full cast). Gilded: twice.
    id: 'd4_whisp',
    name: 'Whisp',
    tribe: 'dragon',
    tier: 6,
    attack: 7,
    health: 6,
    keywords: [],
    effects: [{ on: 'passive', do: 'whisperEchoOnDragon', params: { count: 1 } }],
    text: 'When you cast a **Whisper** on a Dragon, also cast it on this.',
    goldenText: 'When you cast a **Whisper** on a Dragon, also cast it on this twice.',
  },
];
