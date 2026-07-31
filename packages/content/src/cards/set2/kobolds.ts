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
    // A Shout since the owner's rework; the golden text (and the SC keyword badge) had been left behind from
    // the old Start-of-Combat scaler shape, promising a trigger the card no longer has (owner report 2026-07-31).
    id: 'k_frenzied',
    name: 'Frenzied Excavator',
    tribe: 'kobold',
    tier: 5,
    attack: 6,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryPlayRubiesAll', params: { rubies: 1 } }],
    text: '**Shout:** play a Ruby on all of your minions.',
    goldenText: '**Shout:** play **2 Rubies** on all of your minions.',
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
    // `battlecryGrantSpell` isn't Shout-specific — the recruit factories are event-agnostic, so the same
    // grant works off End of Turn without a near-duplicate factory.
    effects: [{ on: 'endOfTurn', do: 'battlecryGrantSpell', params: { spellId: 'veinstorm', count: 1 } }],
    text: '**End of Turn:** get a **Veinstorm**.',
    goldenText: '**End of Turn:** get **2 Veinstorms**.',
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
    // Owner rework 2026-07-27 — a Choose One between the long game (every future Ruby is bigger) and the
    // burst (four Rubies right now). Both halves reuse primitives that already exist.
    effects: [],
    chooseOne: [
      { text: 'Give your Rubies **+1/+1**.', goldenText: 'Give your Rubies **+2/+2**.',
        effects: [{ on: 'onPlay', do: 'rubyStatGain', params: { attack: 1, health: 1 } }] },
      { text: 'Get **4 Rubies**.', goldenText: 'Get **8 Rubies**.',
        effects: [{ on: 'onPlay', do: 'battlecryGetRubies', params: { count: 4 } }] },
    ],
    text: '**Choose One:** give your Rubies **+1/+1**, or get **4 Rubies**.',
    goldenText: '**Choose One:** give your Rubies **+2/+2**, or get **8 Rubies**.',
  },
  {
    // End of Turn (recruit) → mint a Warding Ruby (a Ruby that also grants Ward) into hand.
    id: 'k_wardstone',
    name: 'Wardstone Jeweler',
    tribe: 'kobold',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnGetRubies', params: { count: 1, rubyId: 'warding-ruby' } }],
    text: '**End of Turn:** Get a **Warding Ruby**.',
    goldenText: '**End of Turn:** Get **2 Warding Rubies**.',
  },
  {
    // Two Rally effects (both fire on this minion's attack): buff your Rubies AND play a Ruby on 2 Kobolds.
    id: 'k_crownvein',
    name: 'Crownvein Vanguard',
    tribe: 'kobold',
    tier: 6,
    attack: 5,
    health: 8,
    keywords: ['RL'],
    // Owner ruling 2026-07-29 (found by `npm run text:audit`): the Ruby-play half is CUT. The card is the stat
    // gain only — the extra clause was strictly more than the roster says, so the game was ahead of the sheet
    // rather than behind it, which is the rarer and easier-to-miss direction of drift.
    effects: [{ on: 'onAttack', do: 'rallyRubyStatGain', params: { attack: 1, health: 1 } }],
    text: '**Rally:** give your Rubies **+1/+1**.',
    goldenText: '**Rally:** give your Rubies **+2/+2**.',
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
    // Echo (owner change 2026-07-25, was an onDamaged trigger) → raise your Ruby strength for the rest of the
    // run. `deathrattleRubyStatGain` carries the gain back out of combat, so dying in the fight still pays.
    id: 'k_faultline',
    name: 'Faultline Scrapper',
    tribe: 'kobold',
    tier: 3,
    attack: 1,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleRubyStatGain', params: { attack: 1, health: 0 } }],
    text: '**Echo:** your Rubies gain **+1 Attack**.',
    goldenText: '**Echo:** your Rubies gain **+2 Attack**.',
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
    // Echo (combat Deathrattle): summon a Gemheart Golem that is a 1/1 PLUS the Rubies played on THIS minion —
    // both the shop-phase ones (its `Ruby` buff entry) and any played mid-fight (`rubyGain`). Golden doubles
    // the whole Shard, base included. It always summons, even with no Rubies on it (owner 2026-07-24).
    id: 'k_gemheart',
    name: 'Gemheart Carver',
    tribe: 'kobold',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummonRubyStats', params: { tokenId: 'gemheart-shard' } }],
    text: "**Echo:** Summon a **1/1 Gemheart Golem**, plus this minion's Rubies.",
    goldenText: "**Echo:** Summon a **2/2 Gemheart Golem**, plus double this minion's Rubies.",
  },
  {
    // Rubies APPLIED DURING COMBAT are worth double (triple Gilded) — owner spec 2026-07-25. Nothing happens
    // at Start of Combat and Rubies already on the board are untouched: it purely doubles what each in-combat
    // Ruby grants. Implemented as a passive marker that `playRubyOn` reads, so there is no trigger to mis-time.
    id: 'k_deepdelve',
    name: 'Deepdelve Paragon',
    tribe: 'kobold',
    tier: 6,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'passive', do: 'rubyStatMultiplier' }],
    text: 'Rubies applied **in combat** give **2× stats**.',
    goldenText: 'Rubies applied **in combat** give **3× stats**.',
  },
  {
    // Kobold/DEMON — every 3 Rubies cast, Consume a Shop minion (gain its stats, Demon-style).
    id: 'k_gemgorge',
    name: 'Gemgorge Fiend',
    tribe: 'kobold',
    tribe2: 'demon',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'rubyCast', do: 'rubyCastConsumeShop', params: { every: 3 } }],
    text: 'When you cast **3 spells**, Consume a minion in the Shop.',
    goldenText: 'When you cast **3 spells**, Consume **2 minions** in the Shop.',
  },
  {
    // Taunt + Echo (combat Deathrattle): on death, play a Ruby on each adjacent minion (permanent carry-back).
    id: 'k_geode',
    name: 'Geode Guardian',
    tribe: 'kobold',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattlePlayRubiesAdjacent', params: { rubies: 1 } }],
    text: 'Taunt. **Echo:** Play a Ruby on adjacent minions.',
    goldenText: 'Taunt. **Echo:** Play **2 Rubies** on adjacent minions.',
  },
  {
    // Three triggers: Shout (onPlay) + Echo (combat death) both buff your Rubies; End of Turn plays a Ruby on
    // a random friendly Kobold. The Echo's Ruby-strength gain carries back from combat.
    id: 'k_alchemist',
    name: 'Alchemist Brisbane',
    tribe: 'kobold',
    tier: 7,
    attack: 9,
    health: 6,
    keywords: [],
    effects: [
      { on: 'onPlay', do: 'rubyStatGain', params: { attack: 1, health: 1 } },
      { on: 'onDeath', do: 'deathrattleRubyStatGain', params: { attack: 1, health: 1 } },
      { on: 'endOfTurn', do: 'endOfTurnPlayRuby', params: { tribe: 'kobold', count: 1 } },
    ],
    text: '**Shout and Echo:** Your Rubies gain **+1/+1**. **End of Turn:** Play a Ruby on your Kobold.',
    goldenText: '**Shout and Echo:** Your Rubies gain **+2/+2**. **End of Turn:** Play **2 Rubies** on your Kobold.',
  },
  {
    // A cheap Ruby-build enabler: hands you the tribe's shop-wide Ruby spell instead of a body. Same
    // `battlecryGrantSpell` crossover mechanism Pouchpincher used for the Gold Pouch.
    id: 'k_stormchaser',
    name: 'Storm Chaser',
    tribe: 'kobold',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'veinstorm', count: 1 } }],
    text: '**Shout:** get a **Veinstorm**.',
    goldenText: '**Shout:** get **2 Veinstorms**.',
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
    // "When a Ruby is played on THIS minion" trigger — the buff bounces on to random friends. Owner rework
    // 2026-07-27: Ward, and random targets instead of the two neighbours (so position no longer gates it).
    id: 'k_resonance',
    name: 'Resonance Idol',
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: ['DS'], // Ward
    effects: [{ on: 'onRubyPlayed', do: 'rubyPlayedBounce', params: { goldenReps: 2, random: 2 } }],
    text: '**Ward.** Rubies cast on this minion bounce to **2 random** friendly minions.',
    goldenText: '**Ward.** Rubies cast on this minion bounce to **2 random** friendly minions **twice**.',
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
    effects: [{ on: 'onRubyPlayed', do: 'rubyPlayedGold', params: { gold: 2, cap: 3 } }],
    text: 'Rubies played on this minion give you **2 Gold** (three times per turn).',
    goldenText: 'Rubies played on this minion give you **3 Gold** (three times per turn).',
  },
  {
    // Recruit-phase economy: the `cardsBought` cadence (`every: 3`) mints a Ruby every 3 cards you buy.
    id: 'k_hoardmaster',
    name: 'Hoardmaster Krik',
    tribe: 'kobold',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    // `goldSpent` carries the same continuous per-instance meter `cardsBought` does (see `applyGoldSpent`), so
    // the cadence needs no new plumbing — only the event and the threshold change.
    effects: [{ on: 'goldSpent', do: 'cardsBoughtGetRubies', params: { every: 5, count: 1 } }],
    text: 'When you spend **5 Gold**, get a Ruby.',
    goldenText: 'When you spend **5 Gold**, get **2 Rubies**.',
  },
  {
    // Owner add 2026-07-28. The Kobold Rally payoff: it doesn't need a Rally of its own — ANY friendly Rally
    // showers the tribe in Rubies, so it turns a single Rally body into a board-wide permanent buff that scales
    // with the run's Ruby strength.
    id: 'k_mineralmaster',
    name: 'Mineral Master',
    tribe: 'kobold',
    tier: 6,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onRallyPlayRubiesTribe', params: { tribe: 'kobold', rubies: 2 } }],
    text: 'When you trigger a **Rally**, play **2 Rubies** on your Kobolds.',
    goldenText: 'When you trigger a **Rally**, play **4 Rubies** on your Kobolds.',
  },
];
