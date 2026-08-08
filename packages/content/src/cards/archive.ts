import type { CardDef } from '@game/core';

/**
 * THE MINION ARCHIVE (owner 2026-08-04) — cards REMOVED from play but not from code. An archived card
 * belongs to NO set: it can never be drawn, offered, Discovered, granted or conjured (every generation path
 * resolves through a set pool, and this list is in none). It stays in `CARD_INDEX` so anything that already
 * holds one keeps working — saved runs, pinned opponent boards, replays, and old leaderboard entries all
 * resolve ids through the global index.
 *
 * To archive a card: MOVE its def here from its set file (verbatim — keep its comments), and check nothing
 * still *generates* it by id (a quest/rune reward naming an archived id would be a dead reward). To restore
 * one, move it back. Set counts in tests change by exactly the cards moved.
 */
export const ARCHIVED_CARDS: CardDef[] = [
  {
    // ARCHIVED 2026-08-08 (owner). Moved verbatim from set2/beasts.ts — belongs to no set now, so it can't be
    // drawn, offered, Discovered or granted. Rune of the Second Life ("your Scavvers have Taunt and Rise")
    // named this card and is archived alongside it; nothing else generates the id.
    // Owner rework 2026-08-02 (from the Avenge tribe-buff): a token engine — every 4 friendly deaths summons
    // a Ninja Pal that strikes out of turn order. Reuses Steadfast Champion's `avengeSummonAttack` verbatim;
    // GOLDEN summons a GILDED Pal (the factory's golden rule), not two.
    id: 'b2_scavenger',
    name: 'Scavvers', // renamed 2026-08-07 (owner); id unchanged so saved runs and pool boards still resolve
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    // Owner rework 2026-08-07: the Ninja Pal Avenge is out; its Echo now fires a NEIGHBOUR's Rally through
    // the shared free-rally primitive (tallies and quest halves ride along). Golden triggers twice — both
    // neighbours when both have a Rally.
    effects: [
      { on: 'onDeath', do: 'deathrattleTriggerAdjacentRally' },
    ],
    text: '**Echo:** trigger an adjacent **Rally**.',
    goldenText: '**Echo:** trigger **2** adjacent **Rallies**.',
  },
  {
    // Dragon/DEMON. Owner rework 2026-07-31 (second pass): from the capped friendly-Demon consume payoff to a
    // RALLY that casts a Staff of Guel — permanent (the tavern-buy enchant carries out of combat), scaled by
    // the run's spell power, and a real spell cast that feeds Guel / Groveweaver / Runebloom.
    id: 'd2_broodlord',
    name: 'Ashen Broodlord',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 5,
    attack: 6,
    health: 8,
    keywords: ['RL'], // Rally — the badge has to match the trigger
    effects: [{ on: 'onAttack', do: 'rallyCastShopBuffSpell', params: { attack: 2, health: 2 } }],
    text: '**Rally:** cast a **Staff of Guel**.',
    goldenText: '**Rally:** cast **2 Staves of Guel**.',
  },
  {
    // The wide version of Mirrorwing: instead of doubling on itself, it copies the spell onto its Dragon
    // neighbours — so seating matters, and it scales with a built board rather than with one big spell.
    id: 'd2_runefire',
    name: 'Runefire',
    tribe: 'dragon',
    tier: 6,
    attack: 6,
    health: 9,
    keywords: [],
    // Owner rework 2026-07-27 — reuses the same End-of-Turn recast Runic Archivist had (which now reads
    // `lastSpellCastId`), so the two cards share one primitive rather than two near-identical ones.
    effects: [{ on: 'endOfTurn', do: 'endOfTurnRecastFirstSpell', params: { count: 1 } }],
    text: '**End of Turn:** cast the last **Shop spell** you cast this turn again.',
    goldenText: '**End of Turn:** cast the last **Shop spell** you cast this turn **2 additional** times.',
  },
  {
    id: 'dm_chancellor',
    name: 'Rouge Rogue',
    tribe: 'demon',
    tier: 6,
    attack: 4,
    health: 12,
    keywords: [],
    // AUDIT FIND 2026-07-31: the printed rule and the wired effect had come apart — the text has said "Imp
    // attacks / improves" since the rename, but the card still carried `spellCastBuffImps` (a recruit-phase
    // per-spell buff, +1/+1). The matching combat factory `onImpAttackBuffImps` existed, schema-registered,
    // with NO card referencing it. Its escalation is per-combat (rides `summonBonus`, which `simulate` now
    // excludes from the carry-back for this card so "this combat" stays true).
    effects: [{ on: 'onAttack', do: 'onImpAttackBuffImps', params: { attack: 3, health: 3, improve: 1, improveEvery: 3 } }],
    text: 'Whenever an **Imp** attacks, give your Imps **+3/+3** this combat. Improves by **+1/+1** every **3** Imp attacks.',
    goldenText: 'Whenever an **Imp** attacks, give your Imps **+6/+6** this combat. Improves by **+2/+2** every **3** Imp attacks.',
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

  // ── The 2026-08-03 CELESTIAL TEST UNITS ─────────────────────────────────────────────────────────────
  // Seven cards whose only job was to prove Alignment + Orbit end to end. Superseded by the real Celestial
  // tribe (owner roster 2026-08-05); archived rather than deleted so a saved run, a replay, or a captured
  // board from that fortnight still resolves them. Note they predate the tribe: they are `tribe: 'neutral'`
  // with the `celestial` FLAG, which is exactly why the flag is still honoured alongside the tribe.

  {
    // ORBIT, both halves — the headline test. Sitting in Dawn it PAYS the arriver; sitting in Dusk it FEEDS
    // ITSELF; Eclipsed it does both, which is the clearest single demonstration of the eclipse rule.
    id: 'c3_orbiter',
    name: 'Twinlight Orbiter',
    tribe: 'neutral',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffArriver', params: { attack: 2, health: 2 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffSelf', params: { attack: 2, health: 2 }, align: 'dusk' },
    ],
    text: '**Dawn Orbit:** give the minion **+2/+2**. **Dusk Orbit:** this minion gains **+2/+2**.',
    goldenText: '**Dawn Orbit:** give the minion **+4/+4**. **Dusk Orbit:** this minion gains **+4/+4**.',
  },
  {
    // ALIGNMENT on a SHOUT — proves the gate works on an ordinary trigger, not just the new one. The Shout
    // reads the alignment the card lands in (playing it re-centres the board, and the read happens after).
    id: 'c3_herald',
    name: 'Herald of the Divide',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'onPlay', do: 'battlecryGainGoldNextTurn', params: { gold: 2 }, align: 'dawn' },
      { on: 'onPlay', do: 'onBattlecryBuffSelf', params: { attack: 2, health: 2 }, align: 'dusk' },
    ],
    text: '**Dawn Shout:** gain **2 Gold** next turn. **Dusk Shout:** this minion gains **+2/+2**.',
    goldenText: '**Dawn Shout:** gain **4 Gold** next turn. **Dusk Shout:** this minion gains **+4/+4**.',
  },
  {
    // ALIGNMENT in COMBAT — proves the LOCK. Its Start-of-Combat half is chosen by the alignment frozen at
    // combat setup, so re-centring caused by deaths mid-fight can never flip which half it runs.
    id: 'c3_sentinel',
    name: 'Horizon Sentinel',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'startOfCombat', do: 'scDamage', params: { amount: 3, target: 'leftmost', text: 'Dawnfire' }, align: 'dawn' },
      { on: 'startOfCombat', do: 'scDamage', params: { amount: 3, target: 'all', text: 'Duskfall' }, align: 'dusk' },
    ],
    text: '**Dawn:** Start of Combat — deal **3** to the left-most enemy. **Dusk:** deal **3** to ALL enemies.',
    goldenText: '**Dawn:** Start of Combat — deal **6** to the left-most enemy. **Dusk:** deal **6** to ALL enemies.',
  },

  {
    // Start of Combat with BOTH halves align-gated: the simplest "my text depends on where I stand" body.
    id: 'c3_acolyte',
    name: 'Daybreak Acolyte',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 2,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'startOfCombat', do: 'scBuffSelf', params: { attack: 2 }, align: 'dawn' },
      { on: 'startOfCombat', do: 'scBuffSelf', params: { health: 2 }, align: 'dusk' },
    ],
    text: 'Start of Combat — **Dawn:** gain **+2 Attack**. **Dusk:** gain **+2 Health**.',
    goldenText: 'Start of Combat — **Dawn:** gain **+4 Attack**. **Dusk:** gain **+4 Health**.',
  },
  {
    // An UNGATED Orbit — fires whatever the Familiar's alignment. The contrast case to the Twinlight
    // Orbiter, whose halves are both gated.
    id: 'c3_starweft',
    name: 'Starweft Familiar',
    tribe: 'neutral',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffArriver', params: { attack: 1, health: 1 } },
    ],
    text: '**Orbit:** give the played card **+1/+1**.',
    goldenText: '**Orbit:** give the played card **+2/+2**.',
  },
  {
    // Alignment across TWO different combat triggers on one card: a Dawn Rally and a Dusk Echo. Eclipsed it
    // carries both, which is the intended payoff for centring it.
    id: 'c3_equinox',
    name: 'Equinox Duelist',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: ['RL'],
    celestial: true,
    effects: [
      { on: 'onAttack', do: 'rallyBuffCelestials', params: { attack: 2 }, align: 'dawn' },
      { on: 'onDeath', do: 'deathrattleBuffCelestials', params: { health: 2 }, align: 'dusk' },
    ],
    text: '**Dawn — Rally:** give your Celestials **+2 Attack**. **Dusk — Echo:** give them **+2 Health**.',
    goldenText: '**Dawn — Rally:** give your Celestials **+4 Attack**. **Dusk — Echo:** give them **+4 Health**.',
  },
  {
    // Alignment on END OF TURN — the recruit-phase economy shape (and the reason applyEndOfTurn + its
    // projection twin both gained the align gate in this PR).
    id: 'c3_nym',
    name: 'Starbroker Nym',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'endOfTurn', do: 'endOfTurnBonusGold', params: { amount: 2 }, align: 'dawn' },
      { on: 'endOfTurn', do: 'endOfTurnGetRandomSpells', params: { count: 1 }, align: 'dusk' },
    ],
    text: 'End of Turn — **Dawn:** gain **2 Gold** next turn. **Dusk:** get a **random spell**.',
    goldenText: 'End of Turn — **Dawn:** gain **4 Gold** next turn. **Dusk:** get **2 random spells**.',
  },
];
