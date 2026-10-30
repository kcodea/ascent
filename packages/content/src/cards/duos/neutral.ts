import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY NEUTRALS (owner design 2026-10-30, R-DUOS-CARDS-01). Neutral, so drawable in EVERY set's Duos runs
 * (`duosPoolFor`). Append new cards; never insert (pool order seeds the Shop).
 */
export const DUOS_NEUTRAL: readonly CardDef[] = [
  {
    // "When your team passes a card, gain +1/+2." Fires on BOTH teammates' runs: the sender's at the pass, the
    // receiver's when the card lands (`teamPassedCard`). Permanent (a Shop buff). Gilded doubles.
    id: 'duo_hitchhiker',
    name: 'Hitchhiker',
    tribe: 'neutral',
    tier: 1,
    attack: 2,
    health: 3,
    keywords: [],
    duos: true,
    effects: [{ on: 'teamPassedCard', do: 'teamPassBuffSelf', params: { attack: 1, health: 2 } }],
    text: 'When your team passes a card, gain **+1/+2**.',
    goldenText: 'When your team passes a card, gain **+2/+4**.',
  },
  {
    // "Your first pass each turn is free." A passive marker `duosPassCost` reads: while one is on your board, the
    // turn's first PAID pass (a drag to the teammate) costs 0. Gilded: the first TWO passes each turn.
    id: 'duo_brianspal',
    name: "Brian's Pal",
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 4,
    keywords: [],
    duos: true,
    effects: [{ on: 'passive', do: 'duosFirstPassFree', params: { passes: 1 } }],
    text: 'Your first pass each turn is free.',
    goldenText: 'Your first **2** passes each turn are free.',
  },
];
