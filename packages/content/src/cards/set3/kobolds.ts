import type { CardDef } from '@game/core';

/**
 * Kobolds (set 3) — the owner's full set-3 roster, 2026-08-30.
 *
 * Set 3's Kobolds are the same RUBY tribe as set 2's, and nine set-2 cards carry over unchanged (see
 * `SET2_KOBOLDS_IN_SET3` in `sets.ts` — shared definitions, not forks). This file holds the roster's NEW
 * cards, and only those.
 *
 * ── The tribe's second axis: CHOOSE ONE ───────────────────────────────────────────────────────────────────
 *
 * Set 2's Kobolds were about Rubies alone. This roster keeps that and adds Choose One as the tribe's other
 * spine — most of the new cards are a fork in the road, and the roster's payoff cards (Dealer, Ruby
 * Roach, Prismpick Artificer) reward taking those forks. That is why so many entries here carry `chooseOne`
 * rather than plain `effects`.
 *
 * ── Vocabulary ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * "**Cast** a Ruby" throughout, matching every shipped set-2 Kobold. The owner's sheet alternated between
 * "cast" and "play" for the same action and ruled them the same thing (2026-08-30), normalising to "cast".
 * The ENGINE's own word is `playRubiesOn`, which is a naming mismatch to live with rather than churn: the
 * printed word is the one players read, and the set-2 tribe already set it.
 *
 * NOTE ON ORDER. A set's pool order is load-bearing — shop draws are `rng.int(pool.length)` over it — so new
 * cards are APPENDED here and opted into `SETS.set3.own` in declaration order. Never insert in the middle.
 */
export const SET3_KOBOLDS: CardDef[] = [
  {
    // The roster's T1 Ruby engine: one Ruby on itself per attack. `rallyPlayRubiesSelf` already carries the
    // golden doubling, so the Gilded text is the same sentence with the count doubled.
    id: 'k3_korn',
    name: 'Korn and the Kob',
    tribe: 'kobold',
    tier: 1,
    attack: 2,
    health: 3,
    keywords: ['RL'],
    // Owner rework 2026-09-18: the Ruby is PERMANENT (`permanent: true` — the same flag Boulderdash threads
    // through `playRubiesOn`, so a Rally Ruby earned in combat carries back to the run board).
    effects: [{ on: 'onAttack', do: 'rallyPlayRubiesSelf', params: { count: 1, permanent: true } }],
    text: '**Rally:** Cast a **permanent Ruby** on this.',
    goldenText: '**Rally:** Cast **2 permanent Rubies** on this.',
  },
  {
    // Choose One — the roster's introduction to the fork: a Shop spell (tempo, unknown) against Rubies
    // (stats, certain). Both branches are one existing primitive each.
    id: 'k3_splitpick',
    name: 'Pickles', // 'Splitpick Apprentice' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'kobold',
    tier: 2, // owner balance 2026-09-09: T2 2/3 → T3 5/3; 2026-09-24: T3 5/3 → T2 3/3
    attack: 3,
    health: 3,
    keywords: [],
    effects: [],
    // Owner 2026-09-24: the random-Shop-spell branch becomes a Facetwright (the set-2 Ruby spell, granted by
    // id through `battlecryGrantSpell`, ×2 gilded); the Ruby branch still pays 3 (owner 2026-09-18), gilded 6.
    chooseOne: [
      { text: 'Get **3 Rubies**.', goldenText: 'Get **6 Rubies**.',
        effects: [{ on: 'onPlay', do: 'battlecryGetRubies', params: { count: 3 } }] },
      { text: 'Get a **Facetwright**.', goldenText: 'Get **2 Facetwrights**.',
        effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'facetwright' } }] },
    ],
    text: '**Choose One:** Get **3 Rubies** or a **Facetwright**.',
    goldenText: '**Choose One:** Get **6 Rubies** or **2 Facetwrights**.',
  },
  {
    // Owner 2026-09-24: a random Kobold (the shared `battlecryGainRandomMinion` pick — the run's pool, ≤ the
    // shop tier, ×2 gilded) against +1 max Gold (`gainMaxMana` — Gold Font's permanent `maxGoldBonus` route,
    // above the natural cap, ×2 gilded). Was a Kobold Discover / Shop-spell Discover fork.
    id: 'k3_jeweler',
    name: 'Jewel',
    tribe: 'kobold',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Get a random **Kobold**.', goldenText: 'Get **2** random **Kobolds**.',
        effects: [{ on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tribe: 'kobold', count: 1 } }] },
      { text: 'Increase your max **Gold** by **1**.', goldenText: 'Increase your max **Gold** by **2**.',
        effects: [{ on: 'onPlay', do: 'gainMaxMana', params: { amount: 1 } }] },
    ],
    text: '**Choose One:** Get a random **Kobold** or increase your max **Gold** by **1**.',
    goldenText: '**Choose One:** Get **2** random **Kobolds** or increase your max **Gold** by **2**.',
  },
  {
    // The roster's Equip minion. Blast Pump is an EQUIPMENT SPELL — it casts `rubyblast` (a token Shop spell,
    // "Cast a Ruby on all of your minions", owner Ruby batch 2026-09-24), rather than re-implementing it. That
    // classification is not cosmetic: the Rubies land through the real Shop-spell pipeline, so using the
    // Equipment counts as casting a Shop spell and every "after you cast a Shop spell" listener sees it.
    id: 'k3_blastsurveyor',
    name: 'Blast Surveyor',
    tribe: 'kobold',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'blast_pump' } }],
    text: '**Equip Blast Pump (2):** Cast a **Ruby** on all of your minions.',
    goldenText: '**Equip Blast Pump (2):** Cast **2 Rubies** on all of your minions.',
  },
  {
    /**
     * DOUBLE TROUBLE — every Ruby that lands on someone else lands here too.
     *
     * PER RUBY, not per cast (owner ruling 2026-08-31: "a ruby being cast is 1 ruby, so if 2 rubies are cast,
     * that would be 2 rubies"). A board-wide effect casting 2 Rubies across five other minions therefore pays
     * this ten, which is why it is a 6-drop and not a cheap one.
     *
     * "ANOTHER minion" is a real separation (same day's ruling): a Ruby cast on THIS never triggers it, and
     * two Troubles do not feed each other -- its own Rubies land as stats and notify nobody, the guard
     * that already stops two Resonance Idols pinging a Ruby between them forever.
     *
     * PERMANENCE IS INHERITED (owner note): a Ruby cast off a permanent one is itself permanent.
     */
    id: 'k3_doubletrouble',
    name: 'Trouble',
    tribe: 'kobold',
    tier: 6,
    attack: 8,
    health: 7,
    keywords: [],
    effects: [{ on: 'rubyPlayedAnywhere', do: 'rubySelfCastPerOtherRuby', params: { count: 1 } }],
    text: 'When a **Ruby** is cast on another minion in combat, cast a **Ruby** on this.',
    goldenText: 'When a **Ruby** is cast on another minion in combat, cast **2 Rubies** on this.',
  },
  {
    // Rally: a Choose One card to hand. `grantRandomChooseOne` draws from the RUN's pool, so it can only
    // ever hand back something this set actually fields.
    id: 'k3_forksong',
    name: 'Flagrunner',
    tribe: 'kobold',
    tier: 3, // T4 4/6 → T3 5/4 (owner 2026-09-24)
    attack: 5,
    health: 4,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'grantRandomChooseOne', params: { count: 1 } }],
    text: '**Rally:** get a **Choose One** card.',
    goldenText: '**Rally:** get **2 Choose One** cards.',
  },
  {
    // The Choose One payoff: every fork you take pays the whole board in Rubies.
    id: 'k3_rubyroach',
    name: 'Ruby Roach',
    tribe: 'kobold',
    tier: 6,
    attack: 6,
    health: 8,
    keywords: [],
    effects: [{ on: 'chooseOnePlayed', do: 'chooseOnePlayedPlayRubies', params: { count: 1 } }],
    text: 'Whenever you play a **Choose One** card, cast a **Ruby** on your minions.',
    goldenText: 'Whenever you play a **Choose One** card, cast **2 Rubies** on your minions.',
  },
  {
    // PORKBELLY — the set's capstone, and the only card here that reaches into the attack sequence itself
    // (`vanguardGolem` on the card def; the swing lives in `simulate`). Owner spec 2026-08-31:
    //
    //   "When Porkbelly attacks, if there is space to summon a minion, he summons a Gemheart Golem that gains
    //    his Ruby bonuses (or double if gilded), and the golem attacks Porkbelly's target FIRST. If the target
    //    dies, Porkbelly settles and does not attack or take any damage. If it does not die, Porkbelly
    //    completes his attack. If the golem survives it remains on board (to the right of Porkbelly) and is
    //    the next minion in line to attack."
    //
    // So he is a 13/6 that trades a disposable, Ruby-sized body into every swing: on a Ruby-fed board the
    // vanguard clears the target outright and Porkbelly never takes retaliation at all, which is what makes
    // a 6-Health capstone survivable. A full board summons nothing and he simply attacks.
    id: 'k3_porkbelly',
    name: 'Porkbelly',
    tribe: 'kobold',
    tier: 7,
    attack: 13,
    health: 6,
    keywords: [],
    vanguardGolem: true,
    effects: [],
    text: "Before this attacks, summon a **Gemheart Golem** with this minion's Rubies, and it attacks first.",
    goldenText: "Before this attacks, summon a **2/2 Gemheart Golem** with double this minion's Rubies, and it attacks first.",
  },
  {
    // The roster's SECOND Equip minion, and the first Equipment anywhere to open the Choose One window (owner
    // ask 2026-08-31). The branches live on the Equipment (`PRISMATIC_PICK`), not here: the choice is made
    // when the Pick is USED, once per activation, not once when the Artificer is played.
    //
    // Both branches point back at the set's Choose One theme — one hands you another fork, the other makes
    // the next fork pay both ways — so the Artificer is the payoff for a board already built around forks.
    id: 'k3_prismpick',
    name: 'Picksy', // 'Prismpick Artificer' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'kobold',
    tier: 5, // T6 → T5 (owner 2026-09-18)
    attack: 8,
    health: 8,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'prismatic_pick' } }],
    // Owner rework 2026-10-22: the Ruby branch Discovers 2 Rubies (was 1); the Equipment's own text says the same.
    text: '**Equip Prismatic Pick (1): Choose One.** **Discover 2 special Rubies** or your next **Choose One** card this turn gains **both** effects.',
    goldenText: '**Equip Prismatic Pick (1): Choose One.** **Discover 4 special Rubies** or your next **2 Choose One** cards this turn gain **both** effects.',
  },
  {
    // Set 3 — the SPELL-reactive Kobold. "Shop spell" is load-bearing (owner vocabulary rule): a Ruby is not
    // a Shop spell, so a Ruby landing on a neighbour cannot re-trigger this — which is also what keeps two
    // Channelers side by side from cascading Rubies at each other forever.
    //
    // The owner's table printed the Gilded half as "play 2 Rubies"; normalised to CAST here so both halves
    // use one verb for one mechanic. Play/cast are genuinely different hooks in this engine, and a card whose
    // two texts disagree about which one it is would be a real ambiguity rather than a wording nicety.
    id: 'k3_runespark',
    name: 'Livewire', // 'Runespark Channeler' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'kobold',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    // Owner rework 2026-09-18: RANDOM, not adjacent — a Ruby on Livewire itself plus `others` (2) random OTHER
    // Kobolds, distinct picks off the run cursor. The self Ruby is the one deliberate self-inclusion ("on this"
    // is printed); the random half never re-picks Livewire (the global no-self-target rule).
    effects: [{ on: 'spellCast', do: 'onSpellCastPlayRubiesSelfAndRandomTribe', params: { count: 1, others: 2, tribe: 'kobold' } }],
    text: 'Whenever you cast a **Shop spell**, cast a **Ruby** on this and 2 other random **Kobolds**.',
    goldenText: 'Whenever you cast a **Shop spell**, cast **2 Rubies** on this and 2 other random **Kobolds**.',
  },
  {
    // Set 3 — the THIRD Equip minion. Her Equipment improves your Rubies and then throws two at the ends of
    // your Kobold line, in that order, so the Rubies it throws are minted at the strength it just set.
    id: 'k3_kaura',
    name: "Kaura L'roft",
    tribe: 'kobold',
    tier: 4,
    attack: 6,
    health: 4,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'dueling_rubettas' } }],
    text: "**Equip Dual Rubetta's (2):** Improve your **Rubies** by **+1/+1** and cast a **Ruby** on your left-most and right-most **Kobold**.",
    goldenText: "**Equip Dual Rubetta's (2):** Improve your **Rubies** by **+2/+2** and cast **2 Rubies** on your left-most and right-most **Kobold**.",
  },
  {
    // KURSE (owner handoff 2026-09-18) — Gemheart Carver's Golem on an AVENGE trigger. `avengeSummonRubyStats` is
    // a thin combat wrapper around the SAME arena body Carver's Echo runs (`deathrattleSummonRubyStats`), so
    // the Golem is a 1/1 plus every Ruby stacked on Kurse at the moment the count is reached, landing beside
    // Kurse (a full board = `summonOverflow`, like any summon). Fires EVERY time the tally hits a multiple of
    // `count` — six friendly deaths is two Golems. Golden = Carver's convention exactly (owner ruling
    // 2026-08-04): ONE Golem at double stats, not two.
    //
    // Printed "1/1" is static, matching Carver: the referenced-card hover shows the Golem at its live stats
    // (`tokenRefView`'s `ownerRuby` branch reads the Rubies off the summoner), so the two never diverge.
    id: 'k3_kurse',
    name: 'Kurse',
    tribe: 'kobold',
    tribe2: 'undead', // Kobold/Undead dual tribe (owner 2026-09-24) — counts as both through the shared tribe helpers
    tier: 4, // T5 10/5 → T4 7/4 (owner 2026-09-19)
    attack: 7,
    health: 4,
    keywords: [],
    // Owner 2026-09-24: "It attacks immediately." — a MECHANIC change specific to Kurse (`charge: true` → the
    // arena body's immediate-attack lane, `attackNow`); Carver / Porkbelly / Rune of the Gem Golem keep their own
    // timing and only share the "Summon a Gemheart Golem with <whose> Rubies" wording.
    effects: [{ on: 'avenge', do: 'avengeSummonRubyStats', params: { count: 3, tokenId: 'gemheart-shard', charge: true } }],
    text: "**Avenge (3):** Summon a **Gemheart Golem** with this minion's Rubies. It attacks immediately.",
    goldenText: "**Avenge (3):** Summon a **2/2 Gemheart Golem** with double this minion's Rubies. It attacks immediately.",
  },
  {
    // GOLDVEIN (owner handoff 2026-09-19; PUMMEL keyword 2026-09-21; carry-over ruling later that day). "Pummel
    // (6): Gain 3 Gold next turn. (Once per combat)" — Han Gover's damage-dealt meter (`noteDamageDealt` in
    // simulate.ts — every landed hit this body deals) with a Gold body: each time the LIFETIME tally crosses a
    // multiple of 6, +3 Gold is banked for next turn through the same `grantBonusGold` channel Tromboneer /
    // Bounty Bot use — at most ONCE per combat: the latch rides the combat instance (`pummelFired`, Yeti's
    // convention), so a Risen body does not re-arm and a fresh combat does. Gilded: 6 Gold, still once. The
    // tally itself carries over between combats (seeded from the run card, carried back whole, snapshotted —
    // owner 2026-09-21: "it needs to carry over from turn to turn and combat to shop etc."; the 2026-09-19
    // per-combat reset is retired), and the step-counter badge prints `total mod 6` on every surface (7 dealt
    // → 1/6, never clamped at 6/6). The `pummelTrigger` event + the owner's `pummel-trigger` def present the
    // fire on the medallion.
    id: 'k3_goldvein',
    name: 'Goldvein',
    tribe: 'kobold',
    tier: 1,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'passive', do: 'dealtDamageGoldNextTurn', params: { every: 6, gold: 3 } }],
    text: '**Pummel (6):** Gain **3 Gold** next turn. (Once per combat)',
    goldenText: '**Pummel (6):** Gain **6 Gold** next turn. (Once per combat)',
  },
  {
    // GEMHEART LEGIONNAIRE (owner Ruby batch 2026-09-24): "When you summon a Gemheart Golem, this casts 5 permanent
    // Rubies on itself." Every friendly Golem summon counts — Carver, Geode, Kurse, Porkbelly, a rune — in the Shop
    // and in combat (`onSummon` is dispatched by both phases' summon chokepoints). PERMANENT, so a combat Golem's
    // Rubies carry back to the run card. Gilded: 10.
    id: 'k3_legionnaire',
    name: 'Gemheart', // was 'Gemheart Legionnaire' (owner 2026-10-09: names fit on one line); id unchanged
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 8,
    keywords: [],
    effects: [{ on: 'onSummon', do: 'onSummonCardPlayRubiesSelf', params: { cardId: 'gemheart-shard', count: 5 } }],
    text: 'When you summon a **Gemheart Golem**, this casts **5 permanent Rubies** on itself.',
    goldenText: 'When you summon a **Gemheart Golem**, this casts **10 permanent Rubies** on itself.',
  },
  {
    // DEALSKI (owner Ruby batch 2026-09-24): "When you play a Choose One card, get 2 Rubies." Plain Rubies, minted
    // through the shared `getRubies` body on Ruby Roach's `chooseOnePlayed` trigger. Gilded: 4.
    // Owner rework 2026-10-22: "When you play a Choose One card, get a random Ruby." One RANDOM Ruby (all six types,
    // the shared `getRandomRubies` body Ruby Shipment uses, drawn on the run cursor). Gilded: 2 random Rubies (the
    // `gold(self)` doubling every "get a random Ruby" card uses: Beggy, Kobe).
    id: 'k3_dealski',
    name: 'Dealski',
    tribe: 'kobold',
    tier: 4,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'chooseOnePlayed', do: 'getRandomRubies', params: { count: 1 } }],
    text: 'When you play a **Choose One** card, get a random **Ruby**.',
    goldenText: 'When you play a **Choose One** card, get **2** random **Rubies**.',
  },  {
    // RESTORED to Set 3 2026-10-22 (owner Set 3 Kobold pool call: "add back into Set 3"). Archived 2026-10-13; moved back verbatim, unchanged.
    // Echo (a death trigger) hands back the Veinstorm spell.
    //
    // `cardId`, NOT `spellId`, and NO `count` — the factory reads `params.cardId` and grants `mul(self)`
    // copies, so golden's "2 Veinstorms" is automatic. Set 2's Staff of Guel carries the same warning after
    // the wrong key granted the empty string and crashed the hand-grant preview (owner report 2026-07-25);
    // the content schema catches it now, which is how this one was caught.
    id: 'k3_veinchant',
    name: 'Delver', // 'Veinchant Delver' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'kobold',
    tier: 2, // T3 5/3 → T2 4/3 (owner 2026-09-24)
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'veinstorm' } }],
    text: '**Echo:** get a **Veinstorm**.',
    goldenText: '**Echo:** get **2 Veinstorms**.',
  },
  {
    // RESTORED to Set 3 2026-10-22 (owner Set 3 Kobold pool call: "add back into Set 3"). Archived 2026-10-13; moved back verbatim, unchanged.
    // Owner Ruby batch 2026-09-24 (T5 5/4 -> T6 8/5): the left branch plays 3 PLAIN Rubies, EACH on a random
    // OTHER friendly Kobold (`battlecryPlayRubiesRandomTribe` — dual-tribe and All-types bodies count; never itself, R-TARGET-03);
    // the right branch casts Veinstorm 3 times through the REAL Shop-spell pipeline, so each cast counts as a
    // Shop spell cast and wakes every cast-watcher. Gilded: 6 Rubies / 6 Veinstorms.
    id: 'k3_facetbound',
    name: 'Shardluck', // 'Facetbound Martyr' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'kobold',
    tier: 6,
    attack: 8,
    health: 5,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Play **3 Rubies** on your **Kobolds**.', goldenText: 'Play **6 Rubies** on your **Kobolds**.',
        effects: [{ on: 'onPlay', do: 'battlecryPlayRubiesRandomTribe', params: { count: 3, tribe: 'kobold' } }] },
      { text: 'Cast **Veinstorm** 3 times.', goldenText: 'Cast **Veinstorm** 6 times.',
        effects: [{ on: 'onPlay', do: 'battlecryCastNamedSpell', params: { spellId: 'veinstorm', count: 3 } }] },
    ],
    text: '**Choose One:** Play **3 Rubies** on your **Kobolds** or cast **Veinstorm** 3 times.',
    goldenText: '**Choose One:** Play **6 Rubies** on your **Kobolds** or cast **Veinstorm** 6 times.',
  },
  {
    // RESTORED 2026-10-22 as a SET 3 card (owner Set 3 Kobold pool call: "add Gemgorge Fiend back into Set 3"). Archived from every set 2026-10-10; moved back verbatim and unchanged into set 3 only (set 2 does not regain it). Its Demon second tribe stays: Set 3 fields no Demon tribe, so it plays as a Kobold there.
    // Kobold/DEMON — every 3 Rubies cast, Consume a Shop minion (gain its stats, Demon-style).
    id: 'k_gemgorge',
    name: 'Cavern Fiend', // was 'Gemgorge Fiend' (owner 2026-10-09); id unchanged
    tribe: 'kobold',
    tribe2: 'demon',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    // Owner balance 2026-10-10: the meal is the HIGHEST-HEALTH Shop minion (was random). `pick` names the target
    // rule; ties go to the right-most (the shared `pickShopMinionFor`). Gilded eats twice, re-picking each time.
    effects: [{ on: 'rubyCast', do: 'rubyCastConsumeShop', params: { every: 3, pick: 'highestHealth' } }],
    text: 'When you cast **3 spells**, Consume the highest-Health minion in the Shop.',
    goldenText: 'When you cast **3 spells**, Consume the **2** highest-Health minions in the Shop.',
  },
  // ── Owner Set 3 Kobold batch, 2026-10-22 (five new cards, appended in sheet order) ──────────────────────────
  {
    // BOY SCOUT: "Shout: Gain 2 free Refreshes." The run's one free-refresh bank (`freeRolls`, spent before Gold on a
    // roll: Refreshing Texts, Gryphon, Rune of Refreshments) through a Shout body that knows its gild
    // (`battlecryGrantFreeRolls`; a combat Shout replay banks through the same carry-back as Gryphon). Gilded: 4.
    id: 'k3_boyscout',
    name: 'Boy Scout',
    tribe: 'kobold',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantFreeRolls', params: { count: 2 } }],
    text: '**Shout:** Gain **2 free Refreshes**.',
    goldenText: '**Shout:** Gain **4 free Refreshes**.',
  },
  {
    // GRAMPS: "Sell: Play a Ruby on all of your minions." PLAY is printed as CAST (the 2026-08-30 ruling above: one
    // action, one verb). "A Ruby" = the PLAIN Ruby (owner confirmed 2026-10-22: no "random", no special type). It is
    // Frenzied Excavator's per-Ruby body (`battlecryPlayRubiesAll`, each Ruby its own landing so every on-Ruby
    // watcher hears each one) on the Sell trigger. The sell removes Gramps from the board BEFORE its Sell fires, so
    // "all of your minions" never includes Gramps itself. Gilded: 2 Rubies on each.
    id: 'k3_gramps',
    name: 'Gramps',
    tribe: 'kobold',
    tier: 3,
    attack: 4,
    health: 2,
    keywords: [],
    effects: [{ on: 'onSell', do: 'battlecryPlayRubiesAll', params: { rubies: 1 } }],
    text: '**Sell:** Cast a **Ruby** on all of your minions.',
    goldenText: '**Sell:** Cast **2 Rubies** on all of your minions.',
  },
  {
    // ZAPDASH: "Pummel (10): Cast a Ruby on your Kobolds. (Twice per combat)". A Pummel marker on the shared
    // damage-dealt meter (`DAMAGE_METER_MARKERS`): lifetime tally, a payout per multiple of 10 crossed, at most
    // `maxPerCombat` (2) payouts a fight; the fire count (`pummelFires`) re-arms on a Rise / Rebirth return
    // (R-RETURN-RESET-01). Each payout casts a PLAIN Ruby (`playRubyOn`, the one combat Ruby primitive) on every
    // living friendly Kobold, itself, dual tribes and All-types bodies included. Combat Rubies, so combat-only stats
    // (buff permanence). Gilded (owner): 2 Rubies per Kobold per payout, still twice per combat.
    id: 'k3_zapdash',
    name: 'Zapdash',
    tribe: 'kobold',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'passive', do: 'dealtDamageCastRubiesTribe', params: { every: 10, count: 1, maxPerCombat: 2, tribe: 'kobold' } }],
    text: '**Pummel (10):** Cast a **Ruby** on your **Kobolds**. (Twice per combat)',
    goldenText: '**Pummel (10):** Cast **2 Rubies** on your **Kobolds**. (Twice per combat)',
  },
  {
    // FRACK ATTACK: "Start of Combat: Cast 3 Rubies on this. Repeat after 3 friendly attacks." The Start of Combat
    // is Kobe's self-Ruby body with no neighbours (`adjacent: false`). The repeat is a per-combat meter on the body
    // (`attackSeen`) over EVERY friendly attack, itself included and each Flurry swing counted on its own (owner
    // confirmed 2026-10-22); every 3rd casts the 3 Rubies again. The meter re-arms on a Rise / Rebirth return
    // (`resetPerCombatLimits`). Combat Rubies are combat-only (buff permanence). Gilded: 6 Rubies each time.
    id: 'k3_frackattack',
    name: 'Frack Attack',
    tribe: 'kobold',
    tier: 4,
    attack: 6,
    health: 5,
    keywords: [],
    effects: [
      { on: 'startOfCombat', do: 'scPlayRubiesSelfAndAdjacentTribe', params: { count: 3, adjacent: false } },
      { on: 'onAttack', do: 'friendlyAttacksPlayRubiesSelf', params: { every: 3, count: 3 } },
    ],
    text: '**Start of Combat:** Cast **3 Rubies** on this. Repeat after **3** friendly attacks.',
    goldenText: '**Start of Combat:** Cast **6 Rubies** on this. Repeat after **3** friendly attacks.',
  },
  {
    // ROSEY: "When you cast a Ruby, this gains +2/+1 permanently. Improves every 3 Refreshes." Per RUBY (the Trouble
    // ruling: two Rubies cast is two), from any source, on any friendly minion (Rosey included), in the Shop and in
    // combat. Heard at each phase's one Ruby-cast chokepoint (`fireOnRubyPlayed` / `playRubyOn`), so a bounce hop
    // (stats only, never a cast) pays nothing and Rosey's own gain is a plain buff no Ruby watcher hears: no loop.
    // PERMANENT in combat too (owner confirmed 2026-10-22: carries back like Engraved). "Improves": +2/+1 more per
    // step, every 3 Refreshes pressed while on the board (Indy's meter: the `roll` action only, `eotTick`). Gilded
    // doubles base and steps.
    id: 'k3_rosey',
    name: 'Rosey',
    tribe: 'kobold',
    tier: 6,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [
      { on: 'rubyPlayedAnywhere', do: 'rubyCastGainSelfImproving', params: { attack: 2, health: 1 } },
      { on: 'shopRefreshed', do: 'shopRefreshTallySelf', params: { every: 3 } },
    ],
    text: 'When you cast a **Ruby**, this gains **+2/+1** permanently. Improves every **3** Refreshes.',
    goldenText: 'When you cast a **Ruby**, this gains **+4/+2** permanently. Improves every **3** Refreshes.',
  },
];
