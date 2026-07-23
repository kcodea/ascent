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
    // Start of Combat scaler: plays Rubies on your Kobolds based on the run's per-turn cards-bought count
    // (threaded into combat). Permanent carry-back.
    id: 'k_frenzied',
    name: 'Frenzied Excavator',
    tribe: 'kobold',
    tier: 5,
    attack: 6,
    health: 3,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scPlayRubiesPerBuy', params: { every: 4, rubies: 1, tribe: 'kobold' } }],
    text: '**Start of Combat:** Play **1 Ruby** on your Kobolds for every **4 cards** bought this turn.',
    goldenText: '**Start of Combat:** Play **2 Rubies** on your Kobolds for every **4 cards** bought this turn.',
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
  {
    // Two Avenge effects at one trigger (both fire): get a Ruby (to hand) AND play Rubies on your left-most
    // minion. `count` = the Avenge threshold on each half.
    id: 'k_gemline',
    name: 'Gemline Martyr',
    tribe: 'kobold',
    tier: 3,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [
      { on: 'avenge', do: 'avengeGetRubies', params: { count: 2, rubies: 1 } },
      { on: 'avenge', do: 'avengePlayRubiesLeftmost', params: { count: 2, rubies: 2 } },
    ],
    text: '**Avenge (2):** Get a Ruby and Play **2** on your left-most minion.',
    goldenText: '**Avenge (2):** Get **2 Rubies** and Play **4** on your left-most minion.',
  },
  {
    // Rally is a COMBAT trigger (on this minion's attack) — the Rubies are minted into hand for the next shop,
    // baked with the run's live rubyBonus.
    id: 'k_tunnelcharger',
    name: 'Tunnelcharger Rikk',
    tribe: 'kobold',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGetRubies', params: { count: 3 } }],
    text: '**Rally:** Get **3 Rubies**.',
    goldenText: '**Rally:** Get **6 Rubies**.',
  },
  {
    // Avenge (combat): every 3 friendly deaths, raise your Ruby strength — grows held + future Rubies (carried
    // back from combat).
    id: 'k_veinbreaker',
    name: 'Veinbreaker',
    tribe: 'kobold',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeRubyStatGain', params: { count: 3, attack: 1, health: 1 } }],
    text: '**Avenge (3):** Buff your Rubies **+1/+1**.',
    goldenText: '**Avenge (3):** Buff your Rubies **+2/+2**.',
  },
  {
    // Recruit-phase economy: the `cardsBought` cadence (`every: 3`) mints a Ruby every 3 cards you buy.
    id: 'k_hoardmaster',
    name: 'Hoardmaster Krik',
    tribe: 'kobold',
    tier: 6,
    attack: 5,
    health: 9,
    keywords: [],
    effects: [{ on: 'cardsBought', do: 'cardsBoughtGetRubies', params: { every: 3, count: 1 } }],
    text: 'When you buy **3 cards**, get a Ruby.',
    goldenText: 'When you buy **3 cards**, get **2 Rubies**.',
  },
];
