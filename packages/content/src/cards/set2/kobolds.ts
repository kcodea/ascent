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
];
