import type { CardDef } from '@game/core';

/**
 * Set 2's OWN tavern spells — the ones that only make sense with the Ruby engine (they mint or buff Rubies),
 * so they live in Set 2's pool and NOT in Set 1's. Set-agnostic spells stay in `set1/spells.ts` and carry over
 * via `SET1_SPELLS_IN_SET2` (see `sets.ts`); these are the Kobold/Ruby-specific additions on top.
 */
export const SET2_SPELLS: CardDef[] = [
  {
    // GREAT POT (owner design 2026-08-26) — the "one minion of each type" spread Fatecarver and Rune of the
    // Shared Table already use: ONE friendly minion per tribe, so a dual-tribe body fills BOTH its slots
    // rather than being counted twice, and an all-types body fills every remaining slot.
    id: 'greatpot',
    name: 'Great Pot',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 3,
    effects: [{ on: 'cast', do: 'buffOnePerTribe', params: { attack: 4, health: 4 } }],
    text: 'Give a minion of each type **+4/+4**.',
  },
  {
    // Ruby Shipment — cast: mint 2 Rubies into your hand (each base 1/1 + the run's `rubyBonus`). Untargeted;
    // routes through the same `getRubies` factory the Kobold minions use (self is ignored → no golden multiplier).
    id: 'rubyshipment',
    name: 'Ruby Shipment',
    tribe: 'neutral',
    tier: 2,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [{ on: 'cast', do: 'getRubies', params: { count: 2 } }],
    text: 'Get **2 Rubies**.',
  },
  {
    // Facetwright's Choice — Choose One: your Rubies gain +1 Attack, or +1 Health (`rubyStatGain` → run
    // `rubyBonus`, which also grows Rubies already in hand). Untargeted; a flat +1 (no scaling), so the printed
    // value is always exact. Only already-cast Rubies don't grow (owner ruling 2026-07-23).
    id: 'facetwright',
    name: "Facetwright's Choice",
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [],
    chooseOne: [
      { text: 'Your Rubies gain **+1 Attack**.', effects: [{ on: 'cast', do: 'rubyStatGain', params: { attack: 1, health: 0 } }] },
      { text: 'Your Rubies gain **+1 Health**.', effects: [{ on: 'cast', do: 'rubyStatGain', params: { attack: 0, health: 1 } }] },
    ],
    text: '**Choose One:** your Rubies gain **+1 Attack**, or **+1 Health**.',
  },
  {
    // Open the Gates — cast: bank 3 Imps to enter the next combat on your board (as many as fit the 7-slot cap).
    // Reuses the Set-1 `impscrap` Imp token (owner ruling). Untargeted.
    id: 'openthegates',
    name: 'Open the Gates',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 3,
    effects: [{ on: 'cast', do: 'spellSummonImpsNextCombat', params: { count: 3 } }],
    text: '**Start of combat:** summon an **Imp**, three times (as room allows).',
  },
  {
    // Give every tavern minion offer stats equal to your Rubies (base 1/1 + rubyBonus). Untargeted; the printed
    // +1/+1 greens to the live Ruby value via spellDisplayText.
    id: 'veinstorm',
    name: 'Veinstorm',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    effects: [{ on: 'cast', do: 'spellBuffShopByRuby' }],
    text: 'Your Shop minions **permanently** get stats equal to your Rubies (**+1/+1**), as **Rubies**.',
  },
  {
    // Ruby Transfer (owner add 2026-08-06) — consolidate a row's Rubies onto one body. `target: 'any'` so it
    // works on a SHOP offer too, where it steals from the shop neighbours instead (owner spec) — that is the
    // combo line: fatten a tavern minion off its neighbours, then buy it.
    id: 'rubytransfer',
    name: 'Ruby Transfer',
    tribe: 'neutral',
    tier: 5,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 1,
    target: 'any',
    effects: [{ on: 'cast', do: 'spellStealAdjacentRubies' }],
    text: "Cast **2 Rubies** on a minion. It **steals all Ruby buffs** from adjacent minions.",
  },
  // ── Ales (owner batch 2026-07-25; renamed from Work Orders 2026-07-26) ─────────────────────────────────────────────────────────────
  // A cycle of five cheap Tier-3 utility spells on one template: same tier, same cost, each paying a different
  // axis (economy / bodies / a spike / spread health / spread attack). SET 2 ONLY — they live in this file, so
  // they're in `SET2_SPELLS` and never reachable from a set-1 run.
  {
    id: 'wo_mine',
    name: 'Golden Ale',
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'gainEmbers', params: { amount: 2 } }],
    text: 'Gain **2 Gold**.',
  },
  {
    // "Most common type" resolves through the shared `grantTopTypeMinion`, so it means the same thing here as
    // everywhere else: your dominant board tribe, capped at your tavern tier, drawn from the shared pool.
    id: 'wo_reinforcement',
    name: 'Reinforcing Ale',
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellGrantTopTypeMinion' }],
    text: 'Get a minion of your **most common type**.',
  },
  {
    // Untargeted by design: you pick the recipient by ARRANGING your line, which also keeps the spell
    // deterministic (board order, no RNG).
    id: 'wo_champion',
    name: "Champion's Ale",
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellBuffLeftmost', params: { attack: 6, health: 6 } }],
    text: 'Give your **left-most** minion **+6/+6**.',
  },
  {
    id: 'wo_health',
    name: 'Defensive Ale',
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellBuffRandomFriendlies', params: { count: 3, attack: 0, health: 4 } }],
    text: 'Give **3 random** friendly minions **+4 Health**.',
  },
  {
    id: 'wo_attack',
    name: 'Bloody Ale',
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellBuffRandomFriendlies', params: { count: 3, attack: 4, health: 0 } }],
    text: 'Give **3 random** friendly minions **+4 Attack**.',
  },
  {
    // SET 2 ONLY (owner correction 2026-07-31): Ales are a set-2 currency, so this lives here rather than in
    // the shared set-1 toolkit.
    id: 'onthehouse',
    name: 'On the House',
    tribe: 'neutral',
    tier: 5,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 4,
    effects: [{ on: 'cast', do: 'grantRandomAle', params: { count: 3 } }],
    text: 'Get **3 random Dwarven Ales**.',
  },
  {
    // SET 2 ONLY (owner correction 2026-07-31): Rubies are a set-2 currency.
    id: 'rubyexcavation',
    name: 'Ruby Excavation',
    tribe: 'neutral',
    tier: 6,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 3,
    effects: [{ on: 'cast', do: 'spellPlayRubiesAll', params: { rubies: 2 } }],
    text: 'Cast **2 Rubies** on all of your minions.',
  },
  {
    // "Steal" = take the offer into hand for free, exactly as a buy would shape it (offer buffs fold in).
    id: 'deepdelvewrit',
    name: 'Deep Delve Writ',
    tribe: 'neutral',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellStealShop', params: { tribe: 'dwarf', count: 1 } }],
    text: 'Steal a random **Dwarf** from the Shop.',
  },
  {
    id: 'ironcladreq',
    name: 'Ironclad Requisition',
    tribe: 'neutral',
    tier: 6,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 7,
    effects: [{ on: 'cast', do: 'spellStealShop', params: { perTribe: 'dwarf' } }],
    text: 'Steal a random card from the Shop for each **Dwarf** you control.',
  },

  {
    // The bait: point a Demon at the buffet. Four RANDOM shop consumes with the target as the eater, so every
    // consume payoff (Broodlord, Transfusion, Open Market, the eater's own on-consume) sees a real Demon eat.
    id: 'cupcakes',
    name: 'Cupcakes',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 4,
    target: 'friendly',
    targetTribe: 'demon',
    effects: [{ on: 'cast', do: 'spellTargetConsumesShop', params: { times: 4 } }],
    text: 'Target a **Demon**. It **Consumes 4** minions in the Shop.',
  },

  {
    // Owner add 2026-08-15. A plain, big targeted stat spell — the Spirit Fire line at a higher tier.
    id: 'sp_blessing',
    name: 'Blessing',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    target: 'any',
    effects: [
      { on: 'cast', do: 'spellBuffTarget', params: { attack: 3, health: 4 } },
      { on: 'cast', do: 'spellBuffTarget', params: { attack: 3, health: 4 } },
    ],
    text: 'Give a minion **+3/+4** twice.',
  },
  {
    // Owner add 2026-08-15. Rewards a tight board: the chosen minion AND both neighbours, so a centre pick
    // pays three times and an edge pick only twice.
    id: 'sp_beefy',
    name: 'Beefy',
    tribe: 'neutral',
    tier: 6,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 4,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellBuffTargetAndNeighbours', params: { attack: 8, health: 8 } }],
    text: 'Give a minion and its neighbours **+8/+8**.',
  },
  {
    // Owner add 2026-08-15. The die face IS the tier — a 2-Gold spell that can hand over a Tier-6 card, or a
    // Tier-1 one. Untargeted; the pull is seeded off the run cursor like every other random grant.
    id: 'sp_gamble',
    name: 'Gamble',
    tribe: 'neutral',
    tier: 5,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    effects: [{ on: 'cast', do: 'spellGambleTierPull', params: {} }],
    text: 'Roll a die. Get a random minion or spell of that Tier.',
  },

  {
    // Owner add 2026-08-15. Marks a friendly Shout minion: its Shout fires again as it dies next combat.
    id: 'sp_partingcry',
    name: 'Parting Cry',
    tribe: 'neutral', tier: 4, attack: 0, health: 1, keywords: [], spell: true, cost: 3,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellMarkPartingCry', params: {} }],
    text: 'Choose a friendly **Shout** minion. When it dies next combat, trigger its **Shout**.',
  },
  {
    // Owner add 2026-08-15. Front-loads a summon build: the first three bodies arrive already big.
    id: 'sp_solidground',
    name: 'Solid Ground',
    tribe: 'neutral', tier: 3, attack: 0, health: 1, keywords: [], spell: true, cost: 4,
    effects: [{ on: 'cast', do: 'spellSolidGround', params: { count: 3, attack: 4, health: 4 } }],
    text: 'The first **3** minions you summon next combat gain **+4/+4**.',
  },
  {
    // Owner add 2026-08-15 (reworked same day): it simply DESTROYS the chosen minion at Start of Combat. The
    // Echo is the obvious payoff, but because it is a real death everything else that keys off one fires too
    // (Avenge, friend-death watchers, the Deathrattle tally).
    id: 'sp_closedcasket',
    name: 'Closed Casket',
    tribe: 'neutral', tier: 5, attack: 0, health: 1, keywords: [], spell: true, cost: 2,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellMarkClosedCasket', params: {} }],
    text: 'Choose a minion. **Start of Combat:** destroy it.',
  },
  {
    // Owner add 2026-08-15. Buys a swing out of turn order — queued through the same lane an attack-on-summon
    // uses, so the running order itself is never rewritten.
    id: 'sp_stoleninitiative',
    name: 'Stolen Initiative',
    tribe: 'neutral', tier: 5, attack: 0, health: 1, keywords: [], spell: true, cost: 3,
    effects: [{ on: 'cast', do: 'spellStolenInitiative', params: {} }],
    text: "Your **right-most** minion attacks immediately after the enemy's first attack.",
  },
  {
    // Owner add 2026-08-15. Answers a summon build — but it is spent on whatever lands FIRST, token included.
    id: 'sp_containmentrune',
    name: 'Containment Rune',
    tribe: 'neutral', tier: 5, attack: 0, health: 1, keywords: [], spell: true, cost: 3,
    effects: [{ on: 'cast', do: 'spellContainFirstEnemySummon', params: {} }],
    text: 'Set the first enemy minion summoned next combat to **1/1**.',
  },

  {
    // Owner add 2026-08-18. The Dragon payoff spell — buff a random friendly, then again for EVERY Dragon you
    // control (random each time, with replacement). Untargeted, so Flamebeat Drake and Warflame can cast it
    // mid-combat with no aim (`spellBuffRandomPerTribe` resolves in both phases).
    id: 'sp_dragonflame',
    name: 'Dragonflame',
    tribe: 'neutral',
    tier: 5,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 3,
    effects: [{ on: 'cast', do: 'spellBuffRandomPerTribe', params: { tribe: 'dragon', base: 1, attack: 4, health: 4 } }],
    text: 'Give a friendly minion **+4/+4**. Repeat for every **Dragon** you control.',
  },
  {
    // Owner add 2026-08-18. A cheap Health pump that turns a Dragon into a Flurry threat. Targeted.
    id: 'sp_flutter',
    name: 'Flutter',
    tribe: 'neutral',
    tier: 4,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'spellBuffHealthGrantFlurryDragon', params: { health: 10 } }],
    text: 'Give a minion **+10 Health**. If it is a **Dragon**, also give it **Flurry**.',
  },

];
