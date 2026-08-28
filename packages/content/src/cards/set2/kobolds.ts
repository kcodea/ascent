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
    attack: 3,
    health: 1,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'getRubies', params: { count: 2 } }],
    text: '**Shout:** Get 2 Rubies.',
    goldenText: '**Shout:** Get 4 Rubies.',
  },
  {
    id: 'k_deepvein',
    name: 'Deepvein Tender',
    tribe: 'kobold',
    tier: 2,
    attack: 1,
    health: 2,
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
    attack: 5,
    health: 10,
    keywords: [], // Avenge has no keyword pill (matches set-1 Avenge cards); the text conveys it
    // Owner balance 2026-08-18: now Kobolds-only.
    effects: [{ on: 'avenge', do: 'avengePlayRubies', params: { count: 2, rubies: 2, tribe: 'kobold' } }],
    text: '**Avenge (2):** Cast **2 Rubies** on your **Kobolds**.',
    goldenText: '**Avenge (2):** Cast **4 Rubies** on your **Kobolds**.',
  },
  {
    // Two Avenge effects at one trigger (both fire): get a Ruby (to hand) AND play Rubies on your left-most
    // minion. `count` = the Avenge threshold on each half.
    id: 'k_gemline',
    name: 'Gemline Martyr',
    tribe: 'kobold',
    tier: 4,
    attack: 3,
    health: 5,
    keywords: [],
    // Owner rework 2026-08-19: back to End of Turn, and the Ruby-improvement half is dropped — it is a plain
    // spell faucet again. `battlecryGrantSpell` is trigger-agnostic, so no End-of-Turn-specific factory is
    // needed; golden hands over two.
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
    // Two Rally effects (both fire on this minion's attack): buff your Rubies AND play a Ruby on 2 Kobolds.
    id: 'k_crownvein',
    name: 'Crownvein Vanguard',
    tribe: 'kobold',
    tier: 5,
    attack: 4,
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
    // Echo (owner change 2026-07-25, was an onDamaged trigger) → raise your Ruby strength for the rest of the
    // run. `deathrattleRubyStatGain` carries the gain back out of combat, so dying in the fight still pays.
    id: 'k_faultline',
    name: 'Faultline Scrapper',
    tribe: 'kobold',
    tier: 3,
    attack: 5,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleRubyStatGain', params: { attack: 1, health: 0 } }],
    text: '**Echo:** your Rubies gain **+1 Attack**.',
    goldenText: '**Echo:** your Rubies gain **+2 Attack**.',
  },
  {
    // Un-archived 2026-08-19 (owner) — back in the pool at its archived spec.
    // A Shout since the owner's rework; the golden text (and the SC keyword badge) had been left behind from
    // the old Start-of-Combat scaler shape, promising a trigger the card no longer has (owner report 2026-07-31).
    id: 'k_frenzied',
    name: 'Frenzied Excavator',
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryPlayRubiesAll', params: { rubies: 1 } }],
    text: '**Shout:** cast a Ruby on all of your minions.',
    goldenText: '**Shout:** cast **2 Rubies** on all of your minions.',
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
    health: 2,
    keywords: ['T'],
    // Owner rework 2026-07-31 (from "play a Ruby on adjacent"). The COUNT is fixed — a Gilded copy still
    // summons 2 (the owner was explicit); gilding doubles the Rubies played on them instead.
    effects: [{ on: 'onDeath', do: 'deathrattleSummonGolemsWithRuby', params: { count: 2, rubies: 1 } }],
    text: '**Taunt.** **Echo:** summon **two** 1/1 **Gemheart Golems** with **Taunt**, and cast a **Ruby** on them.',
    goldenText: '**Taunt.** **Echo:** summon **two** 1/1 **Gemheart Golems** with **Taunt**, and cast **2 Rubies** on them.',
  },
  {
    // Owner add 2026-08-11. A Ruby payoff that pays the whole Kobold line on death — the more Kobolds you
    // field, the more Rubies land. Gilded doubles the count (6 each). The Ruby strength (1/1 + rubyBonus)
    // is threaded in by playRubyOn, so a late-run Kobebes pays full-strength Rubies.
    id: 'k_kobabyboldies',
    name: 'Kobebes',
    tribe: 'kobold',
    tier: 5,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattlePlayRubiesTribe', params: { count: 3, tribe: 'kobold' } }],
    text: '**Echo:** cast **3 Rubies** on each of your **Kobolds**.',
    goldenText: '**Echo:** cast **6 Rubies** on each of your **Kobolds**.',
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
    text: '**Shout and Echo:** Your Rubies gain **+1/+1**. **End of Turn:** Cast a Ruby on **each** of your Kobolds.',
    goldenText: '**Shout and Echo:** Your Rubies gain **+2/+2**. **End of Turn:** Cast **2 Rubies** on **each** of your Kobolds.',
  },
  {
    // A cheap Ruby-build enabler: hands you the tribe's shop-wide Ruby spell instead of a body. Same
    // `battlecryGrantSpell` crossover mechanism Pouchpincher used for the Gold Pouch.
    id: 'k_stormchaser',
    name: 'Storm Chaser',
    tribe: 'kobold',
    tier: 3, // T2 -> T3 (owner 2026-08-02)
    attack: 4,
    health: 1,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'veinstorm', count: 1 } }],
    text: '**Shout:** get a **Veinstorm**.',
    goldenText: '**Shout:** get **2 Veinstorms**.',
  },
  {
    // Owner add 2026-07-28. The Kobold Rally payoff: it doesn't need a Rally of its own — ANY friendly Rally
    // showers the tribe in Rubies, so it turns a single Rally body into a board-wide permanent buff that scales
    // with the run's Ruby strength.
    id: 'k_mineralmaster',
    name: 'Mineral Master',
    tribe: 'kobold',
    tier: 6,
    attack: 7,
    health: 9,
    keywords: [],
    // Owner balance 2026-08-18: now ALL your minions (empty tribe = no filter).
    effects: [{ on: 'onAttack', do: 'onRallyPlayRubiesTribe', params: { rubies: 2 } }],
    text: 'When you trigger a **Rally**, cast **2 Rubies** on your **minions**.',
    goldenText: 'When you trigger a **Rally**, cast **4 Rubies** on your **minions**.',
  },
  {
    // Two Avenge effects (both fire at the threshold): improve your Rubies AND get a random Kobold from the
    // run's buyable pool. `avengeRubyStatGain` + `avengeGrantRandomTribeMinion` both already exist.
    id: 'k_portsmith',
    name: 'Gem Portsmith',
    tribe: 'kobold',
    tier: 5,
    attack: 6,
    health: 7,
    keywords: ['DS'],
    effects: [
      { on: 'avenge', do: 'avengeRubyStatGain', params: { count: 3, attack: 1, health: 1 } },
      { on: 'avenge', do: 'avengeGrantRandomTribeMinion', params: { count: 3, tribe: 'kobold', grant: 1 } },
    ],
    text: '**Ward.** **Avenge (3):** improve your Rubies **+1/+1** and get a random **Kobold**.',
    goldenText: '**Ward.** **Avenge (3):** improve your Rubies **+2/+2** and get **2 random Kobolds**.',
  },
  {
    // Start of Combat: play PERMANENT Rubies on this and its living same-tribe neighbours (carry back to the
    // run board). Golden doubles the count.
    id: 'k_kobe',
    name: 'Kobe',
    tribe: 'kobold',
    tier: 4,
    attack: 5,
    health: 6,
    keywords: ['T', 'SC'],
    effects: [{ on: 'startOfCombat', do: 'scPlayRubiesSelfAndAdjacentTribe', params: { tribe: 'kobold', count: 2, permanent: true } }],
    text: '**Taunt.** **Start of Combat:** cast **2 permanent Rubies** on this and adjacent **Kobolds**.',
    goldenText: '**Taunt.** **Start of Combat:** cast **4 permanent Rubies** on this and adjacent **Kobolds**.',
  },
  {
    // Rally: each attack plays PERMANENT Rubies on itself. Golden doubles the count.
    id: 'k_boulderdash',
    name: 'Boulderdash',
    tribe: 'kobold',
    tier: 5,
    attack: 6,
    health: 7,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyPlayRubiesSelf', params: { count: 3, permanent: true } }],
    text: '**Rally:** cast **3 permanent Rubies** on this.',
    goldenText: '**Rally:** cast **6 permanent Rubies** on this.',
  },
  {
    // A cheap Ruby payout on sale — get Rubies when this leaves the board for Gold. Golden doubles.
    id: 'k_beggy',
    name: 'Beggy',
    tribe: 'kobold',
    tier: 1,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [{ on: 'onSell', do: 'onSellGetRubies', params: { count: 2 } }],
    text: 'When you **sell** this, get **2 Rubies**.',
    goldenText: 'When you **sell** this, get **4 Rubies**.',
  },
  {
    // Flurry + Rally: every attack (twice, with Flurry) plays a PERMANENT Ruby on your whole board.
    id: 'k_blazer',
    name: 'Blazer',
    tribe: 'kobold',
    tier: 4,
    attack: 3,
    health: 8,
    keywords: ['W', 'RL'],
    effects: [{ on: 'onAttack', do: 'rallyPlayRubiesAll', params: { count: 1 } }],
    text: '**Flurry.** **Rally:** cast a **Ruby** on your minions.',
    goldenText: '**Flurry.** **Rally:** cast **2 Rubies** on your minions.',
  },
  {
    // -- RUNE-ONLY (Source: Rune), owner batch 2026-08-20 --------------------------------------------------
    // GEM SAGE - the Ruby engine's multiplier. Every Ruby source in the set (Chipwick, Motherlode, the
    // Jeweler, a Kobold Shout) pays double while it is out, which makes it the piece the whole Kobold build
    // wants to find rather than another body that mints on its own.
    //
    // `token: true`, like `dw_baal`: forge-only, never in the tavern.
    //
    // The duplicate is minted SILENTLY (see `onGetRubyDuplicate`) - a Ruby-gained reaction that itself gains
    // a Ruby is the one shape in this system that can recurse, so the extra copy deliberately does not
    // re-open the `onGetRuby` round. It still counts as a card arriving in hand (Gangplank sees it).
    id: 'k_gemsage',
    name: 'Gem Sage',
    tribe: 'kobold',
    tier: 4,
    attack: 3,
    health: 7,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onGetRuby', do: 'onGetRubyDuplicate', params: { count: 1 } }],
    text: 'Whenever you get a **Ruby**, get an additional copy.',
    goldenText: 'Whenever you get a **Ruby**, get **2** additional copies.',
  },
];
