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
    // Passive: a Ruby played from hand casts an extra time while this is on board (see the reducer play-Ruby
    // branch reading `rubyExtraCast`). No `effects` — it's a board aura like Money Bot's mana.
    id: 'k_prismcaster',
    name: 'Prismcaster',
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [],
    rubyExtraCast: 1,
    text: 'Rubies played from hand cast an extra time.',
    goldenText: 'Rubies played from hand cast 2 extra times.',
  },
  {
    // onDamaged (combat) → raise your Ruby strength (carried back). Each hit it survives buffs your Rubies.
    id: 'k_faultline',
    name: 'Faultline Scrapper',
    tribe: 'kobold',
    tier: 3,
    attack: 1,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDamaged', do: 'damagedGainRubyBonus', params: { attack: 1, health: 0 } }],
    text: 'When this minion takes damage, give your Rubies **+1 Attack**.',
    goldenText: 'When this minion takes damage, give your Rubies **+2 Attack**.',
  },
  {
    // Taunt + onDamaged (combat) → get a Ruby, capped 2×/fight (per-instance rubyRecvTick on the combat minion).
    id: 'k_candleback',
    name: 'Candleback Bulwark',
    tribe: 'kobold',
    tier: 1,
    attack: 1,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDamaged', do: 'damagedGetRubies', params: { count: 1, cap: 2 } }],
    text: 'Taunt. Get a Ruby when this takes damage. (2 times per turn)',
    goldenText: 'Taunt. Get 2 Rubies when this takes damage. (2 times per turn)',
  },
  {
    // Crossover: "Get a Gold Pouch" grants the SET-1 Gold Pouch spell (`emberpouch`) to hand — CARD_INDEX is
    // global, so `battlecryGrantSpell` reuses it directly (owner: there will be crossover cards between sets).
    id: 'k_pouchpincher',
    name: 'Pouchpincher',
    tribe: 'kobold',
    tier: 2,
    attack: 4,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'emberpouch', count: 1 } }],
    text: '**Shout:** Get a **Gold Pouch**.',
    goldenText: '**Shout:** Get **2 Gold Pouches**.',
  },
  {
    // "When you GET a Ruby" trigger (fires in mintRubies) — casts a Ruby on a random friendly Kobold.
    id: 'k_candleconduit',
    name: 'Candle Conduit',
    tribe: 'kobold',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'onGetRuby', do: 'rubyGainedCast', params: { tribe: 'kobold' } }],
    text: 'When you get a Ruby, this casts a Ruby on a random friendly Kobold.',
    goldenText: 'When you get a Ruby, this casts a Ruby on a random friendly minion twice.',
  },
  {
    // "When a Ruby is played on THIS minion" trigger — the buff also lands on both neighbours.
    id: 'k_resonance',
    name: 'Resonance Idol',
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'onRubyPlayed', do: 'rubyPlayedBounce', params: { goldenReps: 2 } }],
    text: 'Rubies cast on this minion bounce to both adjacent minions.',
    goldenText: 'Rubies cast on this minion bounce to both adjacent minions twice.',
  },
  {
    // "When a Ruby is played on THIS minion" → Gold, capped per turn (per-instance `rubyRecvTick`).
    id: 'k_rubybroker',
    name: 'Ruby Broker',
    tribe: 'kobold',
    tier: 5,
    attack: 2,
    health: 6,
    keywords: [],
    effects: [{ on: 'onRubyPlayed', do: 'rubyPlayedGold', params: { gold: 3, cap: 2 } }],
    text: 'Rubies played on this minion give you **3 Gold** (two times per turn).',
    goldenText: 'Rubies played on this minion give you **3 Gold** (three times per turn).',
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
