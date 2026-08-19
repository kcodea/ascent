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
  // ── 2026-08-12 owner archive batch ─────────────────────────────────────────────────────────────────────
  {
    // ARCHIVED 2026-08-12 (owner). Moved verbatim from set2/demons.ts — belongs to no set now.
    id: 'dm_tallymonger',
    name: 'Void Curator',
    tribe: 'demon',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnBuffSpellsAndImps', params: { attack: 1, health: 1, impAttack: 3, impHealth: 1 } }],
    text: '**End of Turn:** give your **Shop Spells +1/+1** and your **Imps +3/+1**.',
    goldenText: '**End of Turn:** give your **Shop Spells +2/+2** and your **Imps +6/+2**.',
  },
  {
    // ARCHIVED 2026-08-12 (owner). Moved verbatim from set1/beasts.ts — belongs to no set now.
    // Defensive value engine: a Taunt body that, on death, hands you a random tavern-tier spell. Golden → 2.
    id: 'sporebat',
    name: 'Sporebat',
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 3,
    keywords: ['T'],
    // Owner rework 2026-08-07: it stores the run's LAST-cast Shop spell and re-casts it on death. The stored
    // spell is run-level (`lastSpellCastId`, snapshot-captured for served boards); a targeted spell picks a
    // random friendly Beast, an untargeted one simply casts (owner ruling). Golden casts twice.
    effects: [{ on: 'onDeath', do: 'deathrattleCastLastSpell' }],
    text: '**Taunt.** Store the last spell you cast. **Echo:** cast that spell on a random friendly Beast.',
    goldenText: '**Taunt.** Store the last spell you cast. **Echo:** cast that spell on a random friendly Beast **twice**.',
  },
  {
    // ARCHIVED 2026-08-12 (owner) alongside Rune of the Groveweaver. Moved verbatim from set2/beasts.ts.
    // The tribe's two halves in one card: it pays your summons, and your SPELLS make that payment bigger.
    id: 'b2_groveweaver',
    name: 'Groveweaver',
    tribe: 'beast',
    tier: 5,
    attack: 4,
    health: 8,
    keywords: [],
    effects: [
      // Owner balance 2026-08-04: the base grant is +3/+3 (was +2/+2); each spell still improves it +2/+2.
      { on: 'onSummon', do: 'summonBuffTribeAsym', params: { tribe: 'beast', attack: 3, health: 3, step: 2 } },
      { on: 'spellCast', do: 'onSpellCastImproveSummon', params: { step: 2 } },
    ],
    text: 'When you summon a Beast, give it **+3/+3**. Improve this by **+2/+2** when you cast a Shop spell.',
    goldenText: 'When you summon a Beast, give it **+6/+6**. Improve this by **+4/+4** when you cast a Shop spell.',
  },
  {
    // ARCHIVED 2026-08-12 (owner) alongside Rune of the Matriarch. Moved verbatim from set2/beasts.ts.
    // The top-end spell payoff. Owner rework 2026-08-07: instead of paying out PER cast, it multiplies the
    // casts themselves — every Shop Spell your board casts mid-fight resolves an extra time. It reads the
    // combat cast path (`castInCombat`), so it reaches every caster at once rather than a hand-kept list.
    // Start of Combat, so the grant is locked in and does not retract if the Matriarch dies.
    id: 'b2_runebloom',
    name: 'Runebloom Matriarch',
    tribe: 'beast',
    tier: 6,
    attack: 5,
    health: 9,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scGrantSpellCastExtra', params: { extra: 1 } }],
    text: 'Your **Shop Spells** cast an extra time in combat.',
    goldenText: 'Your **Shop Spells** cast **2** extra times in combat.',
  },
  {
    // ARCHIVED 2026-08-12 (owner) alongside Rune of the Badger. Moved verbatim from set1/beasts.ts.
    // A tempo Beast that mills spells: throws one to hand whenever it scores a kill (Slaughter). The random
    // spell obeys the current shop tier (via ctx.grantRandomSpell at settle). The Rally half was cut in the
    // 2026-07-21 balance pass — killing is now the only way to mill.
    id: 'badgington',
    name: 'Badgington',
    tribe: 'beast',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: ['RL'],
    // Owner rework 2026-08-11: back to the simple "Rally: get a random Shop Spell." `rallyGrantSpell` is the
    // shared Rally spell-grant (Perfect Core's), which draws a random non-token spell from the run pool, routes
    // it through the combat→hand carry-back, and doubles on golden.
    effects: [
      { on: 'onAttack', do: 'rallyGrantSpell' },
    ],
    text: '**Rally:** get a random **Shop Spell**.',
    goldenText: '**Rally:** get **2** random **Shop Spells**.',
  },
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

  // ── 2026-08-18 owner archive batch (Set 2 Kobold / Dwarf / Demon cull) ───────────────────────────────────
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/kobolds.ts.
    // Owner rework 2026-08-11: from a Ruby-bounce passive to a ruby-gain reactor. `rubyGainedCast` (no tribe
    // filter) casts a Ruby on ONE random friendly minion each time you get a Ruby; golden casts 2.
    id: 'k_candleconduit',
    name: 'Candle Conduit',
    tribe: 'kobold',
    tier: 6,
    attack: 7,
    health: 7,
    keywords: [],
    effects: [{ on: 'onGetRuby', do: 'rubyGainedCast' }],
    text: 'When you get a **Ruby**, cast a **Ruby** on a random friendly minion.',
    goldenText: 'When you get a **Ruby**, cast a **Ruby** on **2** random friendly minions.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/kobolds.ts.
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
    // ARCHIVED 2026-08-18. Moved verbatim from set2/kobolds.ts.
    // Passive: a Ruby played from hand casts an extra time while this is on board (see the reducer play-Ruby
    // branch reading `rubyExtraCast`). No `effects` — it's a board aura like Money Bot's mana.
    id: 'k_prismcaster',
    name: 'Prismcaster',
    tribe: 'kobold',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [],
    rubyExtraCast: 1,
    text: 'Rubies played from hand cast an extra time.',
    goldenText: 'Rubies played from hand cast 2 extra times.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/kobolds.ts.
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
    // ARCHIVED 2026-08-18. Moved verbatim from set2/kobolds.ts.
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
    text: '**Shout:** play a Ruby on all of your minions.',
    goldenText: '**Shout:** play **2 Rubies** on all of your minions.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/dwarves.ts (SET2_DWARVES). Name: Ayves.
    // The buy tally lives on the CARD (`buyTick`), like every other cards-bought effect, which is what makes
    // "carries over through combat" true without extra wiring.
    id: 'dw_chirurgeon',
    name: 'Ayves', // renamed from Chirurgeon (owner 2026-07-31); the id stays — saved runs store ids
    tribe: 'dwarf',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'cardsBought', do: 'cardsBoughtGrantRandomSpell', params: { every: 3, count: 1 } }],
    text: 'Every **3 cards** you buy, get a random **Shop spell**.',
    goldenText: 'Every **3 cards** you buy, get **2** random **Shop spells**.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/dwarves.ts (SET2_DWARVES).
    // Rides the existing "on spell cast, buff N random of a tribe" channel — the Dwarves' reward for the
    // Dragon/spell half of set 2.
    id: 'dw_runekeg',
    name: 'Runekeg',
    tribe: 'dwarf',
    tier: 3,
    attack: 2,
    health: 4,
    keywords: [],
    // `excludeSelf` (owner 2026-07-31): "Other Dwarves" — the keg fuels the crew, never itself.
    effects: [{ on: 'spellCast', do: 'onSpellCastBuffRandomTribe', params: { tribe: 'dwarf', count: 2, attack: 2, health: 1, excludeSelf: true } }], // owner balance 2026-08-04: +2/+2 → +2/+1
    text: 'When you cast a **Shop spell**, give **2 random other** friendly **Dwarves +2/+1**.',
    goldenText: 'When you cast a **Shop spell**, give **2 random** friendly **Dwarves +4/+2**.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/demons.ts (SET2_DEMONS). Name: Cinder Clerk.
    // The tribe's Tier-1 statement of intent: a 1/1 that turns a tavern minion into stats.
    id: 'dm_clerk',
    name: 'Cinder Clerk',
    tribe: 'demon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryConsumeShopRandom', params: { times: 1 } }],
    text: '**Shout:** Consume a minion in the Shop.',
    goldenText: '**Shout:** Consume a minion in the Shop and gain **double** its stats.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/demons.ts (SET2_DEMONS). Name: Imp Wrangler.
    id: 'dm_wrangler',
    name: 'Imp Wrangler',
    tribe: 'demon',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'summonImps', params: { count: 1 } }],
    text: '**Start of Combat:** summon an **Imp**.',
    goldenText: '**Start of Combat:** summon **2 Imps**.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/demons.ts (SET2_DEMONS). Name: Broodwright.
    id: 'dm_broodwright',
    name: 'Broodwright',
    tribe: 'demon',
    tier: 3,
    attack: 1,
    health: 6,
    keywords: [],
    effects: [
      { on: 'onSummon', do: 'onSummonImpBuff', params: { attack: 2, health: 2 } },
      { on: 'avenge', do: 'avengeImproveSummonBuff', params: { count: 3, step: 1 } },
    ],
    text: 'Whenever you summon an **Imp**, give it **+2/+2**. **Avenge (3):** improve this by **+1/+1**.',
    goldenText: 'Whenever you summon an **Imp**, give it **+4/+4**. **Avenge (3):** improve this by **+2/+2**.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/demons.ts (SET2_DEMONS). Name: Avarice Incarnate.
    id: 'dm_avarice',
    name: 'Avarice Incarnate',
    tribe: 'demon',
    tier: 5,
    attack: 4,
    health: 5,
    keywords: [],
    // Flat Gold rather than the eaten minion's tier (owner change 2026-07-25): the tier version paid 1 Gold off
    // a Tier-1 offer, which is negligible on a Tier-6 card and swingy depending on what the shop showed.
    effects: [{ on: 'onConsume', do: 'onOtherDemonConsumeEcho', params: { gold: 3 } }],
    text: 'The **first time** another friendly **Demon** Consumes a Shop minion each turn, this gains **the same stats** and grants **3 Gold**.',
    goldenText: 'The **first 2 times** another friendly **Demon** Consumes a Shop minion each turn, this gains **the same stats** and grants **3 Gold**.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/demons.ts (SET2_DEMONS). Name: Feastmaster Vhal.
    // Owner rework 2026-08-12: a Gold-sink payoff. Every 10 Gold spent, permanently buff the right-most Shop
    // minion — the `every` threshold is metered per-instance by `applyGoldSpent`; the buff reuses Market
    // Tormentor's `rightmostSlotBuff` accumulator. Golden gives +16/+16.
    id: 'dm_vhal',
    name: 'Feastmaster Vhal',
    tribe: 'demon',
    tier: 6,
    attack: 6,
    health: 8,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentBuffRightmostSlot', params: { every: 10, attack: 8, health: 8 } }],
    text: 'When you spend **10 Gold**, give the **right-most Shop minion +8/+8** permanently.',
    goldenText: 'When you spend **10 Gold**, give the **right-most Shop minion +16/+16** permanently.',
  },
  {
    // ARCHIVED 2026-08-18. Moved verbatim from set2/demons.ts (SET2_DEMONS). Name: Endless Overseer.
    // Owner rework 2026-08-12: an Avenge summoner — every 4 friendly deaths, summon an Imp with Taunt and Ward
    // (`avengeSummonImps`). No keyword pill, matching the other Avenge cards; golden summons 2.
    id: 'dm_overseer',
    name: 'Endless Overseer',
    tribe: 'demon',
    tier: 6,
    attack: 5,
    health: 9,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeSummonImps', params: { count: 4, summon: 1 } }],
    text: '**Avenge (4):** summon an **Imp** with **Taunt** and **Ward**.',
    goldenText: '**Avenge (4):** summon **2 Imps** with **Taunt** and **Ward**.',
  },
];
