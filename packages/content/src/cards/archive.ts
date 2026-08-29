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
    // ARCHIVED 2026-08-19 (owner). Moved verbatim from set2/dwarves.ts.
    // Owner add 2026-08-14. The Ale package's cheap payoff: one +2/+2 on a dry turn, one MORE per Ale you brewed,
    // each rep re-rolling its target (owner ruling). Owner balance 2026-08-15: +2/+2 → +3/+3 per Ale.
    id: 'dw_oaf',
    name: 'Drunken Oaf',
    tribe: 'dwarf',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scBuffRandomTribePerAle', params: { tribe: 'dwarf', attack: 3, health: 3 } }],
    text: '**Start of Combat:** give a **Dwarf +3/+3**. Repeat for every **Dwarven Ale** cast this turn.',
    goldenText: '**Start of Combat:** give a **Dwarf +6/+6**. Repeat for every **Dwarven Ale** cast this turn.',
  },
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set1/neutral.ts — belonged to set 1 (+ carried into set 2).
    id: 'blaster',
    name: 'Blaster',
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleDamageAll', params: { amount: 3 } }],
    text: '**Deathrattle:** deal **3** damage to ALL minions.',
    goldenText: '**Deathrattle:** deal **6** damage to ALL minions.',
  },
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

  // ── The 2026-08-05 CELESTIAL TRIBE — ARCHIVED 2026-08-28 (owner) ────────────────────────────────
  // "celestials have been extremely and completely re-worked — remove the current minions that are in set 3
  // from the game, leaving set 3 empty of minions now." The redesign supersedes all sixteen.
  //
  // Archived rather than deleted, for the same reason the seven test units below were (and the reason the
  // archive exists at all): a saved run, a replay, a captured board or a Scene Builder scenario from this
  // fortnight still has to resolve them by id. They belong to NO set pool, so they are gone from play
  // — unreachable in a shop, a Discover or any random grant — which is what "removed from the game" means here.
  //
  // Their Alignment and Orbit MECHANICS are untouched: the effects, the `align` gating and the orbit triggers
  // all still exist, so the reworked tribe can reuse whichever of them survive the redesign.

  {
    // T1 opener: a Shout that pays either way, so the tribe has a turn-1 body whose value doesn't depend on
    // having built anything yet. Which half you get is the first alignment decision a player ever makes.
    id: 'c3_courier',
    name: 'Horizon Courier',
    tribe: 'celestial',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 1, count: 1 }, align: 'dawn' },
      { on: 'onPlay', do: 'battlecryGrantRandomSpell', params: { count: 1 }, align: 'dusk' },
    ],
    text: '**Shout — Dawn:** get a random Tier 1 minion. **Dusk:** get a random Shop spell.',
    goldenText: '**Shout — Dawn:** get **2** random Tier 1 minions. **Dusk:** get **2** random Shop spells.',
  },
  {
    // The tribe's Orbit primer: a 3/1 that turns every later play into board value. It buffs a RANDOM friend
    // rather than the arriver, so it rewards a wide board instead of the one card you just dropped.
    id: 'c3_familiar',
    name: 'Orbiting Familiar',
    tribe: 'celestial',
    tier: 1,
    attack: 3,
    health: 1,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffRandomFriend', params: { attack: 2 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffRandomFriend', params: { health: 2 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** give a random friendly minion **+2 Attack**. **Dusk:** give one **+2 Health**.',
    goldenText: '**Orbit — Dawn:** give a random friendly minion **+4 Attack**. **Dusk:** give one **+4 Health**.',
  },
  {
    // Economy Orbit. The Dawn half compounds on the Vendor itself (capped, so it can't run away); the Dusk
    // half pays forward into the Shop — the two halves are "save" and "spend".
    id: 'c3_vendor',
    name: 'Starpath Vendor',
    tribe: 'celestial',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitSellValue', params: { amount: 1, cap: 3 }, align: 'dawn' },
      { on: 'orbit', do: 'buffShopPermanent', params: { attack: 1, health: 1 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** gain **+1 sell value**, up to **+3**. **Dusk:** give minions in the current Shop **+1/+1**.',
    goldenText: '**Orbit — Dawn:** gain **+2 sell value**, up to **+3**. **Dusk:** give minions in the current Shop **+2/+2**.',
  },
  {
    // A combat-facing Celestial: the same body is an aggressive Flurry in Dawn or a durable Ward in Dusk, so
    // where you seat it is a read on the fight you expect.
    id: 'c3_twilight',
    name: 'Twilight Sentinel',
    tribe: 'celestial',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'startOfCombat', do: 'scGainKeyword', params: { keyword: 'W' }, align: 'dawn' },
      { on: 'startOfCombat', do: 'scGainKeyword', params: { keyword: 'DS' }, align: 'dusk' },
    ],
    text: '**Start of Combat — Dawn:** gain **Flurry**. **Dusk:** gain **Ward**.',
  },
  {
    // Orbit (4): a slow, permanent spell-power engine. The cadence is what keeps a run-wide buff honest.
    id: 'c3_cartographer',
    name: 'Star Cartographer',
    tribe: 'celestial',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitGrantSpellPower', params: { every: 4, attack: 1 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitGrantSpellPower', params: { every: 4, health: 1 }, align: 'dusk' },
    ],
    text: '**Orbit (4) — Dawn:** improve your **Shop spells** by **+1 Attack**. **Dusk:** improve them by **+1 Health**.',
    goldenText: '**Orbit (4) — Dawn:** improve your **Shop spells** by **+2 Attack**. **Dusk:** improve them by **+2 Health**.',
  },
  {
    // The payoff for committing to one half of the sky — and the card that makes Eclipse feel best, since an
    // Eclipsed Tender pays BOTH sides at once.
    id: 'c3_tender',
    name: 'Constellation Tender',
    tribe: 'celestial',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffAlignedCelestials', params: { side: 'dawn', attack: 2 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffAlignedCelestials', params: { side: 'dusk', health: 2 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** give your **Dawn Celestials +2 Attack**. **Dusk:** give your **Dusk Celestials +2 Health**.',
    goldenText: '**Orbit — Dawn:** give your **Dawn Celestials +4 Attack**. **Dusk:** give your **Dusk Celestials +4 Health**.',
  },
  {
    // A board-wide Orbit WATCHER, not an Orbit itself: it counts everyone's Orbits, so it rewards a tribe
    // board rather than its own adjacency.
    id: 'c3_shopkeeper',
    name: 'Astral Shopkeeper',
    tribe: 'celestial',
    tier: 3,
    attack: 2,
    health: 6,
    keywords: [],
    celestial: true,
    effects: [{ on: 'orbitFired', do: 'onOrbitBuffShopRightmost', params: { every: 3, attack: 3, health: 3 } }],
    text: 'After **3** of your **Orbits** trigger, give the **right-most** minion in the current Shop **+3/+3**.',
    goldenText: 'After **3** of your **Orbits** trigger, give the **right-most** minion in the current Shop **+6/+6**.',
  },
  {
    // Orbit (3) casting a REAL spell — it counts for every per-spell watcher the run has, and Sprout opens
    // its Discover exactly as a hand-cast would.
    id: 'c3_gardener',
    name: 'Worldseed Gardener',
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitCastSpell', params: { every: 3, spellId: 'sprout' }, align: 'dawn' },
      { on: 'orbit', do: 'orbitCastSpell', params: { every: 3, spellId: 'growth' }, align: 'dusk' },
    ],
    text: '**Orbit (3) — Dawn:** cast **Sprout**. **Dusk:** cast **Growth**.',
    goldenText: '**Orbit (3) — Dawn:** cast **Sprout** twice. **Dusk:** cast **Growth** twice.',
  },
  {
    // Catch-up statting: it always feeds whatever is furthest behind, which keeps a wide board viable rather
    // than forcing everything into one carry.
    id: 'c3_channeler',
    name: 'Equinox Channeler',
    tribe: 'celestial',
    tier: 4,
    attack: 3,
    health: 8,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffLowest', params: { stat: 'attack', amount: 4 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffLowest', params: { stat: 'health', amount: 4 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** give your **lowest-Attack** minion **+4 Attack**. **Dusk:** give your **lowest-Health** minion **+4 Health**.',
    goldenText: '**Orbit — Dawn:** give your **lowest-Attack** minion **+8 Attack**. **Dusk:** give your **lowest-Health** minion **+8 Health**.',
  },
  {
    // A pure positional multiplier — no Orbit of its own, it just makes its NEIGHBOURS' Orbits pay twice.
    // Seating it between two Orbits is the whole card.
    id: 'c3_binary',
    name: 'Binary Star',
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    celestial: true,
    orbitExtraAdjacent: true,
    effects: [],
    text: '**Adjacent Orbit** effects trigger an **additional time**.',
  },
  {
    // The board-wide payoff: at this tier every arrival should move the whole line, not one body.
    id: 'c3_weaver',
    name: 'Worldline Weaver',
    tribe: 'celestial',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbitFired', do: 'onOrbitBuffAll', params: { attack: 2 }, align: 'dawn' },
      { on: 'orbitFired', do: 'onOrbitBuffAll', params: { health: 2 }, align: 'dusk' },
    ],
    text: 'Whenever an **Orbit** triggers, **Dawn:** give all friendly minions **+2 Attack**. **Dusk:** give them **+2 Health**.',
    goldenText: 'Whenever an **Orbit** triggers, **Dawn:** give all friendly minions **+4 Attack**. **Dusk:** give them **+4 Health**.',
  },
  {
    // The tribe's stat sink: it copies what a bought minion already carries, so it rewards buying INTO your
    // investment — a heavily bought-up minion pays the Collector the most. It COPIES; it never steals.
    id: 'c3_collector',
    name: 'Horizon Collector',
    tribe: 'celestial',
    tier: 6,
    attack: 5,
    health: 12,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitGainArriverBonus', params: { side: 'dawn' }, align: 'dawn' },
      { on: 'orbit', do: 'orbitGainArriverBonus', params: { side: 'dusk' }, align: 'dusk' },
    ],
    text: "**Orbit:** gain the played minion's **bonus stats**. **Dawn:** also give its **Attack** to your left-most other Celestial. **Dusk:** also give its **Health** to your right-most other Celestial.",
  },
  {
    // The tribe's own Orbit BUTTON: everything else waits for you to play a card next to it, the Relay makes
    // the arrival optional. Its two halves are two different clocks — Dawn pays the moment it lands, Dusk pays
    // every turn it survives — so where you seat it decides whether it is burst or engine.
    id: 'c3_relay',
    name: 'Astral Relay',
    tribe: 'celestial',
    tier: 4,
    attack: 5,
    health: 6,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'onPlay', do: 'triggerAdjacentOrbits', align: 'dawn' },
      { on: 'endOfTurn', do: 'triggerAdjacentOrbits', align: 'dusk' },
    ],
    text: '**Shout — Dawn:** trigger adjacent **Orbits**. **End of Turn — Dusk:** trigger adjacent **Orbits**.',
    goldenText: '**Shout — Dawn:** trigger adjacent **Orbits** twice. **End of Turn — Dusk:** trigger adjacent **Orbits** twice.',
  },
  {
    // Pays for INVESTMENT rather than for tempo: an unbuffed body is worth nothing to the Crucible, a minion
    // you have poured three Rubies into is worth three. That makes it the tribe's reason to hold a card back
    // and fatten it in the shop before dropping it next door.
    id: 'c3_crucible',
    name: 'Celestial Crucible',
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 7,
    keywords: [],
    celestial: true,
    effects: [{ on: 'orbit', do: 'orbitBuffCelestialsPerBuffStack', params: { attack: 1, health: 1 } }],
    text: 'Orbit: give your **Celestials +1/+1** for each stack of **Shop buffs** on the played minion.',
    goldenText: 'Orbit: give your **Celestials +2/+2** for each stack of **Shop buffs** on the played minion.',
  },
  {
    // The tribe's sacrifice outlet: it eats what you drop next to it and hands the investment on. Because the
    // devoured body's Echo FIRES (owner ruling 2026-08-06), the Broker is a deliberate Deathrattle enabler —
    // feed it something whose death you WANTED, and you collect twice.
    id: 'c3_broker',
    name: 'Constellation Broker',
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    celestial: true,
    effects: [{ on: 'orbit', do: 'orbitDevourArriver' }],
    text: 'Orbit: **destroy** the played minion and give its **bonus stats** to another friendly **Celestial**.',
    goldenText: 'Orbit: **destroy** the played minion and give **double** its **bonus stats** to another friendly **Celestial**.',
  },
  {
    // The tribe's capstone devourer. Its passive half pays the whole SHOP for everyone else's Orbits, and its
    // own Orbit (3) is the Broker writ large — the parcel is split across every Celestial you own rather than
    // handed to one, so it rewards the wide board the rest of the tribe has been building toward.
    id: 'c3_orrery',
    name: 'Orrery, World Devourer',
    tribe: 'celestial',
    tier: 7,
    attack: 8,
    health: 8,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbitFired', do: 'onOrbitBuffShop', params: { others: true, attack: 1, health: 1 } },
      { on: 'orbit', do: 'orbitDevourArriver', params: { every: 3, mode: 'split' } },
    ],
    text: 'Whenever **another Orbit** triggers, give minions in the current Shop **+1/+1**. **Orbit (3):** **destroy** the played minion and split its **bonus stats** among your **Celestials**.',
    goldenText: 'Whenever **another Orbit** triggers, give minions in the current Shop **+2/+2**. **Orbit (3):** **destroy** the played minion and split **double** its **bonus stats** among your **Celestials**.',
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
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set2/dragons.ts (SET2_DRAGONS).
    // The tribe's Tier-1 spell payoff: a body that grows every turn you cast, so casting early has a floor
    // even when you have no other Dragon out. Permanent growth (owner ruling 2026-07-24).
    id: 'd2_ashscribe',
    name: 'Ashscribe',
    tribe: 'dragon',
    tier: 1,
    attack: 1,
    health: 3,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastFirstBuffSelf', params: { attack: 2, health: 2 } }],
    text: 'The first time you cast a **Shop spell** each turn, gain **+2/+2**.',
    goldenText: 'The first time you cast a **Shop spell** each turn, gain **+4/+4**.',
  },
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set2/dragons.ts (SET2_DRAGONS).
    // The tribe's combat headline: one Start of Combat that fires the whole board's Shouts. Pairs with
    // Karwind (also a Dragon) — every trigger procs it, so the two together are the tribe's payoff turn.
    id: 'd2_sovereign',
    name: 'Thunderous Sovereign',
    tribe: 'dragon',
    tier: 6,
    attack: 8,
    health: 8,
    keywords: ['SC'],
    // The improvement is PER-INSTANCE and non-retroactive: it counts only spells cast while THIS body has
    // been on the board (`onSpellCastImproveSummon` ticks `summonBonus`), so a Sovereign bought late doesn't
    // inherit the turn's history. `scBeastAura` spends that accrual as the Start-of-Combat grant — the same
    // pairing Kennelmaster uses, tribe-swapped to Dragons.
    effects: [
      // Owner balance 2026-08-07: the per-cast improvement is +2/+2 (golden +4/+4 — `scBeastAura` applies the
      // golden multiplier to the WHOLE grant, base and accrual alike, so the step doubles for free).
      { on: 'startOfCombat', do: 'scBeastAura', params: { tribe: 'dragon', attack: 1, health: 1, stepAttack: 2, stepHealth: 2 } },
      { on: 'spellCast', do: 'onSpellCastImproveSummon', params: { step: 1 } },
    ],
    // TWO "+N/+N" groups: the GRANT (slot 0, which `summonBuffText` rewrites live as the accrual builds) and
    // the per-cast STEP (slot 1, static — the helper only ever replaces the first). The step is printed rather
    // than left as a bare "Improves" so the card states the number it is actually paying, per the text rule.
    text: '**Start of Combat:** give your Dragons **+1/+1**. Improves by **+2/+2** with every Shop spell you cast.',
    goldenText: '**Start of Combat:** give your Dragons **+2/+2**. Improves by **+4/+4** with every Shop spell you cast.',
  },
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set2/dragons.ts (SET2_DRAGONS).
    // The combat spell-supply piece: dying allies feed you copies of your best held spell. Reads the hand
    // snapshot taken at combat start (Vault Curator copies the left-most spell you took INTO the fight).
    id: 'd2_curator',
    name: 'Water Dragon',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    // Owner balance 2026-08-04: back to the Vault-Curator copy shape (the factory survived), at Avenge (3) —
    // it copies the LEFT-MOST spell in the hand snapshot taken at combat start; no spell held = clean no-op.
    effects: [{ on: 'avenge', do: 'avengeCopyLeftmostHandSpell', params: { count: 3 } }],
    text: '**Avenge (3):** get a copy of the **left-most Spell** in your hand.',
    goldenText: '**Avenge (3):** get **2** copies of the **left-most Spell** in your hand.',
  },
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set2/dragons.ts (SET2_DRAGONS).
    id: 'd2_archivist',
    name: 'Runic Archivist',
    tribe: 'dragon',
    tier: 5,
    attack: 6,
    health: 7,
    keywords: [],
    // Owner rework 2026-07-27 — the recast moved to Water Dragon; the Archivist now pays for SELLING. The
    // tally rides on the card (`soldProgress`) and carries round to round.
    effects: [{ on: 'minionSold', do: 'minionSoldGrantSpell', params: { count: 5 } }],
    text: 'After you sell **5 minions**, get a **Shop spell**.',
    goldenText: 'After you sell **5 minions**, get **2 Shop spells**.',
  },
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set2/dragons.ts (SET2_DRAGONS).
    // The End-of-Turn half of the same idea — it pays out AFTER the turn's casting is done, so it rewards
    // opening with your best spell rather than saving it.
    id: 'd2_spellvault',
    name: 'Spellvault Drake',
    tribe: 'dragon',
    tier: 5,
    attack: 6,
    health: 7,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCopyCastSpell', params: { which: 'first', count: 1 } }],
    text: '**End of Turn:** get a copy of the first **Shop spell** you cast this turn.',
    goldenText: '**End of Turn:** get **2** copies of the first **Shop spell** you cast this turn.',
  },
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set2/dragons.ts (SET2_DRAGONS).
    // Set 1's Karwind pays on Battlecries; the Matriarch is the Attack-only Dragon version, so the tribe has a
    // Shout payoff that isn't a full Karwind. Same `battlecryTriggered` channel.
    id: 'd2_matriarch',
    name: 'Bathing Matriarch', // renamed 2026-07-29 (owner); id unchanged so saved runs and pool boards still resolve
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    // Owner rework 2026-08-07: the alternating Attack/Health mode is GONE — it now pays a flat +1/+1 on every
    // Shout trigger, the same shape as Karwind one tier up. `onBattlecryBuffTribe` is Karwind's own factory.
    effects: [
      { on: 'battlecryTriggered', do: 'onBattlecryBuffTribe', params: { tribe: 'dragon', attack: 1, health: 1 } },
    ],
    text: 'Whenever a **Shout** triggers, give your Dragons **+1/+1**.',
    goldenText: 'Whenever a **Shout** triggers, give your Dragons **+1/+1** twice.',
  },
  {
    // ARCHIVED 2026-08-18 (owner). Moved verbatim from set2/demons.ts (SET2_DEMONS). Name: Errand Fiend.
    // Owner rework 2026-08-04: Echo → RALLY. (Owner 2026-08-11: Flurry removed — the Rally now fires once per
    // attack rather than twice.)
    id: 'dm_errand',
    name: 'Errand Fiend',
    tribe: 'demon',
    tier: 2,
    attack: 1,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallySummonImpBuffImps', params: { amount: 1 } }],
    text: '**Rally:** summon an **Imp** and give your **Imps +1/+1**.',
    goldenText: '**Rally:** summon **2 Imps** and give your **Imps +2/+2**.',
  },
];
