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
    name: 'Warhorn Captain',
    tribe: 'dwarf',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribeOthersAttack', params: { tribe: 'dwarf', attack: 3 } }],
    text: '**Shout:** give your other **Dwarves +3 Attack**.',
    goldenText: '**Shout:** give your other **Dwarves +6 Attack**.',
  },
  {
    id: 'dw_brunni',
    name: 'Brunni',
    tribe: 'dwarf',
    tier: 3, // owner balance 2026-08-04: T2 → T3, 2/1 → 3/1
    attack: 3,
    health: 1,
    keywords: ['T'],
    effects: [{ on: 'endOfTurn', do: 'grantRandomAle', params: { count: 1 } }],
    text: '**Taunt.** **End of Turn:** get a **Dwarven Ale**.',
    goldenText: '**End of Turn:** get **2 Dwarven Ales**.',
  },
  {
    // Reuses the Set 1 spell-power channel, so a Dwarf and a Dragon raising your Shop spells are the same
    // mechanic — one number on the run, shown in the run-buffs panel.
    id: 'dw_wardkeeper',
    name: 'Wardkeeper',
    tribe: 'dwarf',
    tier: 3,
    attack: 6,
    health: 4,
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
    // Targeted Shout: the target arrives on the payload via `applyBattlecryTarget`. Its magnitude is live, so
    // shopping BEFORE playing it is the play — and the printed number has to fold that in (see `cardText`).
    id: 'dw_dorrin',
    name: 'Baby Gastrid', // renamed from Quartermaster Dorrin (owner 2026-08-02); the id stays — saved runs store ids
    tribe: 'dwarf',
    tier: 4,
    attack: 2,
    health: 4,
    keywords: [],
    target: 'friendly',
    targetTribe: 'dwarf', // owner ruling 2026-08-04: Dwarves only — enforced by the reducer, mirrored by the aim UI
    effects: [{ on: 'onPlay', do: 'battlecryBuffTargetPerGoldSpent', params: { health: 2 } }],
    text: '**Shout:** give a friendly **Dwarf** **+2 Health** per Gold spent this turn.',
    goldenText: '**Shout:** give a friendly **Dwarf** **+4 Health** per Gold spent this turn.',
  },
  {
    // Left-most rather than targeted, so you pick the recipient by ARRANGING your line — deterministic, no RNG.
    id: 'dw_foreman',
    name: 'Kringle', // renamed from Closing-Time Foreman (owner 2026-08-02); the id stays
    tribe: 'dwarf',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnBuffLeftmostTribePerCard', params: { tribe: 'dwarf', attack: 1, health: 2 } }], // owner balance 2026-08-04: +1 Attack → +1/+1; 2026-08-15: → +1/+2
    text: '**End of Turn:** give your **left-most Dwarf +1/+2** per card played this turn.',
    goldenText: '**End of Turn:** give your **left-most Dwarf +2/+4** per card played this turn.',
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
    attack: 7,
    health: 3,
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
    attack: 9,
    health: 5,
    keywords: ['RL'],
    // Owner 2026-08-11: 3 → 2 recipients, and it can no longer feed OTHER Lieutenant Thanes (the id is
    // excluded in `rallyGiveAttackToOthers`) — so two Thanes don't pump each other into a runaway loop.
    effects: [{ on: 'onAttack', do: 'rallyGiveAttackToOthers', params: { count: 2, excludeId: 'dw_thane' } }],
    text: "**Rally:** give this minion's **Attack** to **2 other** friendly minions.",
    goldenText: "**Rally:** give this minion's **Attack** to **2 other** friendly minions **twice**.",
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
    effects: [{ on: 'onSummon', do: 'onTribeSummonedBuffTribe', params: { tribe: 'dwarf', attack: 3 } }],
    text: 'When you play a **Dwarf**, give your **Dwarves +3/+3**.',
    goldenText: 'When you play a **Dwarf**, give your **Dwarves +6/+6**.',
  },
  {
    // The Ale payoff banked a turn late (owner 2026-08-07): Start of Combat reads the Ales you cast LAST
    // shop turn, so the fight's opening is decided by how hard you brewed before it, not during it.
    // Rune-exclusive (`token: true`), the same shape as Quil.
    id: 'dw_bucky',
    name: 'Bucky',
    tribe: 'dwarf',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: ['SC'],
    token: true,
    effects: [{ on: 'startOfCombat', do: 'scTribeBuffPerAle', params: { tribe: 'dwarf', attack: 5, health: 5 } }],
    text: '**Start of Combat:** give your Dwarves **+5/+5** for every **Dwarven Ale** you cast last turn.',
    goldenText: '**Start of Combat:** give your Dwarves **+10/+10** for every **Dwarven Ale** you cast last turn.',
  },
  {
    // The Dwarf/Kobold bridge: it pays the Ruby engine from the Dwarves' side. Owner rework 2026-08-14 — the
    // meter moved from cards PLAYED to Gold SPENT (every 8), and the payout is now split: 2 Rubies to HAND plus
    // one played on each Kobold. The `every` threshold is metered per-instance by `applyGoldSpent`.
    id: 'dw_mountainbond',
    name: 'Mountainbond',
    tribe: 'dwarf',
    tribe2: 'kobold',
    tier: 5, // owner rework 2026-08-18: T6 → T5
    attack: 7,
    health: 6,
    keywords: ['DS', 'CR'],
    critChance: 0.5,
    // Owner rework 2026-08-18: the hand-mint half is dropped and the board half now hits ALL your minions
    // (`tribe: 'all'`, `count: 0` = mint nothing). `every` still metered per-instance by `applyGoldSpent`.
    effects: [{ on: 'goldSpent', do: 'goldSpentGetRubiesPlayOnTribe', params: { every: 8, count: 0, play: 1, tribe: 'all' } }],
    text: '**Ward. Critical Strike (50%).** When you spend **8 Gold**, cast a **Ruby** on your minions.',
    goldenText: '**Ward. Critical Strike (50%).** When you spend **8 Gold**, cast **2 Rubies** on your minions.',
  },
  {
    // Set 2 — Billings (owner add 2026-08-18): every 5 Gold spent, two random Dwarves get a big +5/+5. The
    // recipient count is fixed; golden doubles the STAT (+10/+10).
    id: 'dw_billings',
    name: 'Billings',
    tribe: 'dwarf',
    tier: 5,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentBuffRandomTribe', params: { every: 5, tribe: 'dwarf', count: 2, attack: 5, health: 5 } }],
    text: 'When you spend **5 Gold**, give **2 random** friendly **Dwarves +5/+5**.',
    goldenText: 'When you spend **5 Gold**, give **2 random** friendly **Dwarves +10/+10**.',
  },
  {
    // Set 2 — Gangplank (owner add 2026-08-18): every card added to your hand (an Ale, a conjured spell, a
    // granted minion, a minted Ruby) buffs a RANDOM friendly Dwarf. Golden doubles the grant.
    // (Owner fix 2026-08-20: it used to take the left-most match — a seating decision the card never claimed.)
    id: 'dw_gangplank',
    name: 'Gangplank',
    tribe: 'dwarf',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'onGainCard', do: 'onGainCardBuffTribe', params: { tribe: 'dwarf', attack: 1, health: 2 } }],
    text: 'When a card is added to your hand, give a **random** friendly **Dwarf +1/+2**.',
    goldenText: 'When a card is added to your hand, give a **random** friendly **Dwarf +2/+4**.',
  },
];

/** The Charging Soldier — the token BOTH Anvilshade Smith and Chicken Brawl summon. */
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
    // The charge lives on the TOKEN, not on the summoning effect. Anvilshade's factory
    // (`echoSummonInheritAttackAndCharge`) also forces it via `attackNow`, which is the same single deferred
    // strike — but Chicken Brawl summons through the plain `deathrattleSummon` factory, which has no such
    // lever and relies entirely on this flag. It was missing until 2026-08-06, so Chicken Brawl's soldier
    // just joined the back of the rotation instead of swinging (owner report).
    attackOnSummon: true,
    token: true,
    text: 'A 3/1 Dwarf that attacks immediately when summoned.',
  },
];

/**
 * Rune-granted minions — the roster marks these **Source: Rune**, so they are `token: true`: forge-only, never
 * in the tavern. That follows Goldcrafter (also rune-granted and flagged) rather than Pillager (rune-granted but
 * left buyable) — the codebase has both patterns, and "Source: Rune" is the deciding evidence.
 */
export const SET2_DWARF_RUNE_MINIONS: CardDef[] = [
  {
    // Dwarf/Demon — the two set-2 economies in one body: the Demon side eats, and each meal pays out on the
    // DWARF side (a fatter shop row + an Ale). Forge-only, like High King Mykel above: reachable through
    // Rune of Baal and nowhere else, so `token: true` keeps it out of the drawable pool.
    //
    // "for this turn" is the offer buff, not the run-wide tavern bonus — see `onConsumeBuffShopOffers`.
    id: 'dw_baal',
    name: 'Baal',
    tribe: 'dwarf',
    tribe2: 'demon',
    tier: 6,
    attack: 8,
    health: 7,
    keywords: [],
    token: true, // forge-only: Source = Rune of Baal
    effects: [{ on: 'spellCast', do: 'spellCastDemonConsumesShop', params: { every: 2 } }],
    // Owner fix 2026-08-14: "2 spells" was under-specified. The meter is the SHOP-SPELL counter (`spellCast`) —
    // the same one Vaultkeeper and Runic Apprenticeship print as "Shop spells" — so the card now says so.
    // Text-only: the effect is unchanged.
    text: 'Whenever you cast **2 Shop spells**, a friendly **Demon** consumes a minion in the **Shop**.',
    goldenText: 'Whenever you cast **2 Shop spells**, a friendly **Demon** consumes **2 minions** in the **Shop**.',
  },
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
    // Owner add 2026-08-04. An aggressive Echo body for the tribe's early game: it dies forward — the
    // soldier's immediate swing is the payoff (the Whelp/`attackOnSummon` mechanism).
    id: 'dw_chickenbrawl',
    name: 'Chicken Brawl',
    tribe: 'dwarf',
    tier: 2,
    attack: 3,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'dw_soldier', count: 1, fixed: true, goldenTokens: true } }],
    text: '**Echo:** summon a **Charging Soldier** that attacks immediately.',
    goldenText: '**Echo:** summon a **Golden Charging Soldier** that attacks immediately.',
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
  {
    // Owner add 2026-08-19. The steal package's body: a Shout that hands over a Deep Delve Writ (steal a random
    // Dwarf from the Shop). Reuses the trigger-agnostic `battlecryGrantSpell`; golden hands over two.
    id: 'dw_sharpshooter',
    name: 'Dwarven Sharpshooter',
    tribe: 'dwarf',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'deepdelvewrit', count: 1 } }],
    text: '**Shout:** get a **Deep Delve Writ**.',
    goldenText: '**Shout:** get **2 Deep Delve Writs**.',
  },
  {
    // Owner add 2026-08-19. A Dwarf capstone that grows ITSELF rather than the board: Beefy hits the target and
    // both neighbours, so a centre Arnold pays three ways off one cast. Distinct from `endOfTurnCastSpellEscalating`
    // (which climbs and picks the biggest OTHER friend) — this one is a flat once-per-turn cast, aimed at self.
    id: 'dw_arnold',
    name: 'Arnold',
    tribe: 'dwarf',
    tier: 6,
    attack: 9,
    health: 10,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCastSpellOnSelf', params: { spellId: 'sp_beefy' } }],
    text: '**End of Turn:** cast **Beefy** on this.',
    goldenText: '**End of Turn:** cast **Beefy** on this **twice**.',
  },
  {
    // KEGHEART DWARF (rune-only, owner batch 2026-08-20) - the Ale build's payoff body. It watches the shared
    // grant-to-hand chokepoint (`onGainCard`) and filters on the arriving card being one of the five Ales, so
    // Brunni's Shout, the Tapkeeper's End of Turn, a Gold-spent Ale and Rune of Last Call all feed it without
    // any of them knowing this card exists. GETTING the Ale is what pays - casting it is a separate reward.
    id: 'dw_kegheart',
    name: 'Kegheart Dwarf',
    tribe: 'dwarf',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onGainCard', do: 'onGainAleBuffSelf', params: { attack: 3, health: 3 } }],
    text: 'Whenever you get a **Dwarven Ale**, gain **+3/+3**.',
    goldenText: 'Whenever you get a **Dwarven Ale**, gain **+6/+6**.',
  },
];
