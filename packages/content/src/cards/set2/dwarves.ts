import type { CardDef } from '@game/core';

/**
 * SET 2 — DWARVES. The Gold-and-Ale tribe: it converts *throughput* (Gold spent, cards bought, spells cast)
 * into permanent Attack and a stream of **Ales** — the five cheap Tier-3 Shop spells in `set2/spells.ts`.
 *
 * The tribe's shape, so a new card lands in the right place: Dwarves pay you for SHOPPING rather than for
 * board-building. Kobolds want Rubies cast; Dragons want spells recurred; Dwarves want Gold moving. That is why
 * so many of them hang off `goldSpent` / `cardsBought` thresholds rather than Shout/Echo.
 *
 * COMPLETE as of 2026-07-29 — the whole roster ships. The machinery the last five needed:
 *   · Paymaster Pimm    — none, as it turned out: `bonusEmbersNextTurn` already existed and pays at turn start
 *   · Mountainbond      — a new `cardsPlayed` event + `applyCardsPlayed`, the twin of the buy-count meter
 *   · Edward Keg-hands  — an Ale-scoped branch inside `spellCasts`, the one place cast counts are computed
 *   · Chef Gary Toast    — `alesCastThisTurn`, reset with the other per-turn tallies
 *   · High King Mykel          — a per-instance `spellProgress` threshold reusing Moira's `replayBattlecry` path
 */
export const SET2_DWARVES: CardDef[] = [
  {
    id: 'dw_orin',
    name: 'Oathshield Orin',
    tribe: 'dwarf',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGainKeyword', params: { keyword: 'DS' } }],
    text: '**Shout:** gain **Ward**.',
    // A keyword doesn't stack, so the gild is deliberately no stronger — matches the owner's identical text.
    goldenText: '**Shout:** gain **Ward**.',
  },
  {
    id: 'dw_ironlung',
    name: 'Ironlung Captain',
    tribe: 'dwarf',
    tier: 3,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribeOthersAttack', params: { tribe: 'dwarf', attack: 3 } }],
    text: '**Shout:** give your other **Dwarves +3 Attack**.',
    goldenText: '**Shout:** give your other **Dwarves +6 Attack**.',
  },
  {
    id: 'dw_brunni',
    name: 'Brunni',
    tribe: 'dwarf',
    tier: 3,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'grantRandomAle', params: { count: 1 } }],
    text: '**End of Turn:** get a **Dwarven Ale**.',
    goldenText: '**End of Turn:** get **2 Dwarven Ales**.',
  },
  {
    // Reuses the Set 1 spell-power channel, so a Dwarf and a Dragon raising your Shop spells are the same
    // mechanic — one number on the run, shown in the run-buffs panel.
    id: 'dw_wardkeeper',
    name: 'Wardkeeper',
    tribe: 'dwarf',
    tier: 3,
    attack: 3,
    health: 1,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpellPowerRun', params: { attack: 1, health: 0 } }],
    text: '**Shout:** your **Shop spells** gain **+1 Attack**.',
    goldenText: '**Shout:** your **Shop spells** gain **+2 Attack**.',
  },
  {
    // The `every` threshold is applied by `applyGoldSpent` itself — the factory only does the buff.
    id: 'dw_coinfire',
    name: 'Coinfire Forewoman',
    tribe: 'dwarf',
    tier: 3,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentBuffTribeAttack', params: { every: 5, tribe: 'dwarf', attack: 2 } }],
    text: 'When you spend **5 Gold**, give your **Dwarves +2 Attack**.',
    goldenText: 'When you spend **5 Gold**, give your **Dwarves +4 Attack**.',
  },
  {
    id: 'dw_brakka',
    name: 'Broad-Axe Brakka',
    tribe: 'dwarf',
    tier: 4,
    attack: 4,
    health: 2,
    keywords: ['C'],
    effects: [],
    text: '**Cleave**.',
    goldenText: '**Cleave**.',
  },
  {
    // Rides the existing "on spell cast, buff N random of a tribe" channel — the Dwarves' reward for the
    // Dragon/spell half of set 2.
    id: 'dw_runekeg',
    name: 'Runekeg',
    tribe: 'dwarf',
    tier: 4,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastBuffRandomTribe', params: { tribe: 'dwarf', count: 2, attack: 2, health: 2 } }],
    text: 'When you cast a **Shop spell**, give **2 random** friendly **Dwarves +2/+2**.',
    goldenText: 'When you cast a **Shop spell**, give **2 random** friendly **Dwarves +4/+4**.',
  },
  {
    // Targeted Shout: the target arrives on the payload via `applyBattlecryTarget`. Its magnitude is live, so
    // shopping BEFORE playing it is the play — and the printed number has to fold that in (see `cardText`).
    id: 'dw_dorrin',
    name: 'Quartermaster Dorrin',
    tribe: 'dwarf',
    tier: 4,
    attack: 2,
    health: 4,
    keywords: [],
    target: 'friendly',
    effects: [{ on: 'onPlay', do: 'battlecryBuffTargetPerGoldSpent', params: { health: 1 } }],
    text: '**Shout:** give a friendly minion **+1 Health** per Gold spent this turn.',
    goldenText: '**Shout:** give a friendly minion **+2 Health** per Gold spent this turn.',
  },
  {
    // Left-most rather than targeted, so you pick the recipient by ARRANGING your line — deterministic, no RNG.
    id: 'dw_foreman',
    name: 'Closing-Time Foreman',
    tribe: 'dwarf',
    tier: 5,
    attack: 3,
    health: 7,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnBuffLeftmostTribePerCard', params: { tribe: 'dwarf', attack: 1 } }],
    text: '**End of Turn:** give your **left-most Dwarf +1 Attack** per card played this turn.',
    goldenText: '**End of Turn:** give your **left-most Dwarf +2 Attack** per card played this turn.',
  },
  {
    // The buy tally lives on the CARD (`buyTick`), like every other cards-bought effect, which is what makes
    // "carries over through combat" true without extra wiring.
    id: 'dw_chirurgeon',
    name: 'Chirurgeon',
    tribe: 'dwarf',
    tier: 5,
    attack: 5,
    health: 4,
    keywords: [],
    effects: [{ on: 'cardsBought', do: 'cardsBoughtGrantRandomSpell', params: { every: 3, count: 1 } }],
    text: 'Every **3 cards** you buy, get a random **Shop spell**.',
    goldenText: 'Every **3 cards** you buy, get **2** random **Shop spells**.',
  },
  {
    // Both halves: the Shout pours in the shop, the Echo pours from combat via `ctx.grantToHand`.
    id: 'dw_brewer',
    name: 'Doubletap Brewer',
    tribe: 'dwarf',
    tier: 5,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [
      { on: 'onPlay', do: 'grantRandomAle', params: { count: 1 } },
      { on: 'onDeath', do: 'combatGrantAle', params: { guard: 'self', count: 1 } },
    ],
    text: '**Shout:** get a **Dwarven Ale**. **Echo:** get a **Dwarven Ale**.',
    goldenText: '**Shout:** get **2 Dwarven Ales**. **Echo:** get **2 Dwarven Ales**.',
  },
  {
    id: 'dw_tapkeeper',
    name: 'Tapkeeper',
    tribe: 'dwarf',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'grantRandomAle', params: { every: 10, count: 1 } }],
    text: 'When you spend **10 Gold**, get a **Dwarven Ale**.',
    goldenText: 'When you spend **10 Gold**, get **2 Dwarven Ales**.',
  },
  {
    // Tier 7, so it only appears once the run has Tier 7 access. Reuses the spell path's gild, so a Shout-gild
    // and a spell-gild are one operation.
    id: 'dw_runemaster',
    name: 'Auric Runemaster',
    tribe: 'dwarf',
    tier: 7,
    attack: 8,
    health: 9,
    keywords: [],
    target: 'friendly',
    effects: [{ on: 'onPlay', do: 'battlecryGildTarget' }],
    text: '**Shout: Gild** a target friendly minion.',
    goldenText: '**Shout: Gild** a target friendly minion.',
  },
  {
    // Slaughter = on-kill, a COMBAT trigger, so the Ale rides the carry-back and lands in hand after the fight.
    id: 'dw_korr',
    name: 'Kegbreaker Korr',
    tribe: 'dwarf',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: ['SL'],
    effects: [{ on: 'onKill', do: 'combatGrantAle', params: { guard: 'attacker', count: 1 } }],
    text: '**Slaughter:** get a **Dwarven Ale**.',
    goldenText: '**Slaughter:** get **2 Dwarven Ales**.',
  },
  {
    id: 'dw_bladethrower',
    name: 'Blade Thrower',
    tribe: 'dwarf',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'combatGrantAle', params: { guard: 'rally', count: 1 } }],
    text: '**Rally:** get a **Dwarven Ale**.',
    goldenText: '**Rally:** get **2 Dwarven Ales**.',
  },
  {
    // The token's printed 3 Attack is a FLOOR — it inherits the Smith's Attack when that's higher, so buffing
    // the Smith buffs what its death produces.
    id: 'dw_anvilshade',
    name: 'Anvilshade Smith',
    tribe: 'dwarf',
    tier: 5,
    attack: 6,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'echoSummonInheritAttackAndCharge', params: { token: 'dw_soldier', count: 1 } }],
    text: "**Echo:** summon a **Charging Soldier** that gains this minion's **Attack** and attacks immediately.",
    goldenText: "**Echo:** summon **2 Charging Soldiers** that gain this minion's **Attack** and attack immediately.",
  },
  {
    id: 'dw_thane',
    name: 'Lieutenant Thane',
    tribe: 'dwarf',
    tier: 6,
    attack: 5,
    health: 6,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGiveAttackToOthers', params: { count: 3 } }],
    text: "**Rally:** give this minion's **Attack** to **3** friendly minions.",
    goldenText: "**Rally:** give this minion's **Attack** to **3** friendly minions **twice**.",
  },
  {
    // `bonusEmbersNextTurn` already existed and is paid at turn start — no new run state was needed after all.
    id: 'dw_pimm',
    name: 'Paymaster Pimm',
    tribe: 'dwarf',
    tier: 1,
    attack: 3,
    health: 1,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGainGoldNextTurn', params: { amount: 1 } }],
    text: '**Shout:** gain **1 Gold** next turn.',
    goldenText: '**Shout:** gain **2 Gold** next turn.',
  },
  {
    // "Your Ales trigger twice" is scoped to the Ale ids inside `spellCasts`, the one place cast counts are
    // computed — so it composes with Yazzus/Grimoire instead of competing with them.
    id: 'dw_edward',
    name: 'Edward Keg-hands',
    tribe: 'dwarf',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [],
    text: 'Your **Dwarven Ales** trigger **twice**.',
    goldenText: 'Your **Dwarven Ales** trigger **three times**.',
  },
  {
    // The magnitude climbs with Ales cast this turn, which is what ties the Chef to the tribe's engine rather
    // than making it a generic tribe-buffer.
    id: 'dw_chef',
    name: 'Chef Gary Toast',
    tribe: 'dwarf',
    tier: 6,
    attack: 6,
    health: 7,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'onPlayTribeBuffTribeByAles', params: { tribe: 'dwarf', count: 3, attack: 3, step: 1 } }],
    text: 'When you play a **Dwarf**, give **3** friendly **Dwarves +3/+3**. Improves per **Ale** triggered this turn.',
    goldenText: 'When you play a **Dwarf**, give **3** friendly **Dwarves +6/+6**. Improves per **Ale** triggered this turn.',
  },
  {
    // The Dwarf/Kobold bridge: it pays the Ruby engine from the Dwarves' card-throughput side. The tally is
    // CUMULATIVE (`playTick`) — `playedThisTurn` clears each turn and could never reach 8 on a normal curve.
    id: 'dw_mountainbond',
    name: 'Mountainbond',
    tribe: 'dwarf',
    tribe2: 'kobold',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'cardsPlayed', do: 'cardsPlayedPlayRubies', params: { every: 8, count: 1 } }],
    text: 'After you play **8 cards**, play a **Ruby** on your minions.',
    goldenText: 'After you play **8 cards**, play **2 Rubies** on your minions.',
  },
];

/** Anvilshade Smith's token. */
export const SET2_DWARF_TOKENS: CardDef[] = [
  {
    id: 'dw_soldier',
    name: 'Charging Soldier',
    tribe: 'dwarf',
    tier: 1,
    attack: 3,
    health: 1,
    keywords: [],
    effects: [],
    token: true,
    text: '',
  },
];

/**
 * Rune-granted minions — the roster marks these **Source: Rune**, so they are `token: true`: forge-only, never
 * in the tavern. That follows Goldcrafter (also rune-granted and flagged) rather than Pillager (rune-granted but
 * left buyable) — the codebase has both patterns, and "Source: Rune" is the deciding evidence.
 */
export const SET2_DWARF_RUNE_MINIONS: CardDef[] = [
  {
    id: 'dw_brill',
    name: 'Dwarf King, Brill',
    tribe: 'dwarf',
    tier: 6,
    attack: 5,
    health: 8,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentGrantTribeMinion', params: { every: 10, tribe: 'dwarf', count: 1 } }],
    token: true, // forge-only: Source = Rune
    text: 'When you spend **10 Gold**, get a random **Dwarf**.',
    goldenText: 'When you spend **10 Gold**, get **2** random **Dwarves**.',
  },
  {
    // Beast, not Dwarf — a Rune minion that happens to arrive with this batch. The copy drops its own Echo, which
    // is what stops it chaining to the board cap.
    id: 'dw_exgalloper',
    name: 'Exgalloper',
    tribe: 'beast',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'echoSummonCopyNoEcho', params: { count: 1 } }],
    token: true, // forge-only: Source = Rune
    text: '**Echo:** summon an exact copy of this **without Echo**.',
    goldenText: '**Echo:** summon **2** exact copies of this **without Echo**.',
  },
  {
    // Dwarf/Dragon — the bridge between the Ale tribe and the spell tribe. Its meter is per-instance and carries
    // round to round, like every other "every N spells" card.
    id: 'dw_brisbane',
    name: 'High King Mykel',
    tribe: 'dwarf',
    tribe2: 'dragon',
    tier: 6,
    attack: 7,
    health: 7,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastTriggerAdjacentShouts', params: { every: 8 } }],
    token: true, // forge-only: Source = Rune
    text: 'When you cast **8 Shop spells**, trigger an **adjacent Shout**.',
    goldenText: 'When you cast **8 Shop spells**, trigger **both adjacent Shouts**.',
  },
];
