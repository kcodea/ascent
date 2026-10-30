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
  {
    // MONSTROCITY — "When you buy or Discover this, your teammate gets a copy." An ALL-TYPE minion (owner correction
    // 2026-10-30: it counts as every tribe), so it prints `tribe: 'neutral'` + `universalTribe` and joins every set's
    // Duos pool. `selfObtain`: its OWN buy (`applyOnBuy`) or Discover pick (`takeDiscoverPick`) gives the teammate a
    // fresh copy (`giftTeammate`); a copy that ARRIVES some other way (a gift, a pass) does not chain. Gilded gives 2.
    id: 'duo_monstrocity',
    name: 'Monstrocity',
    tribe: 'neutral',
    universalTribe: true,
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    duos: true,
    effects: [{ on: 'onBuy', do: 'giftTeammate', params: { cardId: 'duo_monstrocity', selfObtain: true } }],
    text: 'When you buy or **Discover** this, your teammate gets a copy.',
    goldenText: 'When you buy or **Discover** this, your teammate gets **2** copies.',
  },
  {
    // THE MEGAMIMED RUNE's token (owner design 2026-10-30, R-DUOS-RUNES-03): "Start of combat, transform into an exact
    // copy of your teammate's highest health minion." Never in the Shop (`token`). At every Start of Combat `simulate`
    // swaps it for a combat-only copy of the teammate's highest-Health minion on their locked board (ties seeded); the
    // run keeps the 1/1, so the next fight copies again (core `megamimic.ts`). A passive marker only.
    id: 'duo_megamimic',
    name: 'Megamimic',
    tribe: 'neutral',
    tier: 6,
    attack: 1,
    health: 1,
    keywords: [],
    token: true,
    duos: true,
    effects: [{ on: 'passive', do: 'megamimicCopy' }],
    text: "**Start of Combat:** transform into an exact copy of your teammate's highest Health minion.",
  },
];

/** The Discover + pass batch (2026-10-30, R-DUOS-CARDS-05): a list of its own, APPENDED at the end of `DUOS_CARDS`, so
 *  no earlier Duos pool position moves (pool order seeds the Shop). */
export const DUOS_NEUTRAL_DISCOVER_PASS: readonly CardDef[] = [
  {
    // "Shout: Discover a minion of your teammate's most common type and pass it to them." The type is read from the
    // teammate's board as this run last saw it (`duos.mateTribes`, recorded by `noteMateTribes`; ties a seeded 50/50).
    // The options come from the set's Duos pool (any tribe of the set, up to your Shop tier); the pick is an EFFECT
    // pass (free, counts as a pass). In combat (a Shout re-fire) it gives the teammate a random minion of their most
    // common type instead (a combat gift, sent in real time) (no Discover or pass mid-fight). Gilded: Discover twice.
    id: 'duo_matchmaker',
    name: 'Matchmaker',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 2,
    keywords: [],
    duos: true,
    effects: [{ on: 'onPlay', do: 'discoverMateTribePass' }],
    text: "**Shout:** **Discover** a minion of your teammate's most common type and **Pass** it to them.",
    goldenText: "**Shout:** **Discover** a minion of your teammate's most common type and **Pass** it to them. Do this twice.",
  },
  {
    // "Whisper: Pass." The NEUTRAL Whisper granter (the Dragon Whisper system, `grantWhisper`): a free Pass in hand on
    // play and every Start of Turn while on the board; it vanishes at End of Turn and counts as a spell cast.
    // `goldenCopies`: Gilded hands over 2 Passes (a Pass has no magnitude to double).
    id: 'duo_cuebee',
    name: 'CueBee',
    tribe: 'neutral',
    tier: 4,
    attack: 6,
    health: 6,
    keywords: [],
    duos: true,
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'duo_w_pass', goldenCopies: true } }],
    text: '**Whisper:** **Pass** a minion in the Shop or on your board.',
    goldenText: '**Whisper:** **Pass** a minion in the Shop or on your board. Get 2.',
  },
];
