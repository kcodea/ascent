import type { CardDef } from '@game/core';

/**
 * Kobolds (set 2) — the RUBY tribe. Every Kobold is built around Rubies (the spell-like token in
 * `cards/set2/tokens.ts`, engine in `@game/sim`): mint them, play them onto minions, and scale off them.
 *
 * This file fills in as the Ruby engine grows. For now it holds only the recruit-phase (**Shout** = `onPlay`)
 * Kobolds the engine already supports; the combat-phase casters (Rally / Avenge / Start-of-Combat "Play a
 * Ruby"), the Gold-Pouch and Warding-Ruby cards, and the umbrella cast-triggers land with their primitives.
 */
export const SET2_KOBOLDS: CardDef[] = [
  {
    id: 'k_chipwick',
    name: 'Chipwick Prospector',
    tribe: 'kobold',
    tier: 1,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'getRubies', params: { count: 2 } }],
    text: '**Shout:** Get 2 Rubies.',
    goldenText: '**Shout:** Get 4 Rubies.',
  },
  {
    id: 'k_deepvein',
    name: 'Deepvein Tender',
    tribe: 'kobold',
    tier: 3,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'rubyStatGain', params: { attack: 0, health: 1 } }],
    text: '**Shout:** Your Rubies gain **+1 Health**.',
    goldenText: '**Shout:** Your Rubies gain **+2 Health**.',
  },
  {
    // Avenge is a COMBAT trigger — every 2 friendly deaths, each of your minions gets 2 Rubies (permanent,
    // carried back to the run board). `rubies` is per-minion (matching Crownvein's "a Ruby on 2 minions").
    id: 'k_gemstorm',
    name: 'Gemstorm Instigator',
    tribe: 'kobold',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [], // Avenge has no keyword pill (matches set-1 Avenge cards); the text conveys it
    effects: [{ on: 'avenge', do: 'avengePlayRubies', params: { count: 2, rubies: 2 } }],
    text: '**Avenge (2):** Play **2 Rubies** on your minions.',
    goldenText: '**Avenge (2):** Play **4 Rubies** on your minions.',
  },
];
