import type { CardDef } from '@game/core';

/**
 * SET 2 — DWARVES. The Gold-and-Ale tribe: it converts *throughput* (Gold spent, cards bought, spells cast)
 * into permanent Attack and a stream of **Ales** — the five cheap Tier-3 Shop spells in `set2/spells.ts`.
 *
 * The tribe's shape, so a new card lands in the right place: Dwarves pay you for SHOPPING rather than for
 * board-building. Kobolds want Rubies cast; Dragons want spells recurred; Dwarves want Gold moving. That is why
 * so many of them hang off `goldSpent` / `cardsBought` thresholds rather than Shout/Echo.
 *
 * TRANCHE A (2026-07-29): the recruit-side cards. Deliberately excluded for now, because each needs machinery
 * that does not exist yet rather than another card entry — they are the honest remainder, not an oversight:
 *   · Paymaster Pimm      — "Gold next turn" needs a banked-income field on `RunState`
 *   · Mountainbond        — playing a Ruby outside combat has no recruit-side helper (`playRubyOn` is combat)
 *   · Kegbreaker Korr     — Slaughter (on-kill) is a COMBAT trigger; the Ale must carry back
 *   · Blade Thrower       — Rally (on-attack), same carry-back
 *   · Anvilshade Smith    — a summon that inherits its parent's Attack AND attacks immediately
 *   · Lieutenant Thane    — Rally spreading this minion's Attack to 3 friendlies
 *   · Edward Keg-hands    — an Ale-scoped trigger multiplier
 *   · Guildhall Chef      — scales off "Ales triggered this turn", a per-turn counter that does not exist
 *   · Exgalloper, Brisbane — the two remaining Rune minions
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
    // Only the Shout half ships in tranche A — its Echo needs the combat→run Ale carry-back.
    id: 'dw_brewer',
    name: 'Doubletap Brewer',
    tribe: 'dwarf',
    tier: 5,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'grantRandomAle', params: { count: 1 } }],
    text: '**Shout:** get a **Dwarven Ale**.',
    goldenText: '**Shout:** get **2 Dwarven Ales**.',
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
];

/** Anvilshade Smith's token. Shipped ahead of its summoner so the body exists when the Echo lands. */
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

/** Rune-granted minions. `Dwarf King, Brill` is the Dwarf entry; the other two are in tranche B. */
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
    text: 'When you spend **10 Gold**, get a random **Dwarf**.',
    goldenText: 'When you spend **10 Gold**, get **2** random **Dwarves**.',
  },
];
