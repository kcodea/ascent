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
 * spine — most of the new cards are a fork in the road, and the roster's payoff cards (Forked Crown, Ruby
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
    effects: [{ on: 'onAttack', do: 'rallyPlayRubiesSelf', params: { count: 1 } }],
    text: '**Rally:** cast a **Ruby** on this.',
    goldenText: '**Rally:** cast **2 Rubies** on this.',
  },
  {
    // Choose One — the roster's introduction to the fork: a Shop spell (tempo, unknown) against Rubies
    // (stats, certain). Both branches are one existing primitive each.
    id: 'k3_splitpick',
    name: 'Splitpick Apprentice',
    tribe: 'kobold',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Get a random **Shop spell**.', goldenText: 'Get **2** random **Shop spells**.',
        effects: [{ on: 'onPlay', do: 'battlecryGrantRandomSpell', params: { count: 1 } }] },
      { text: 'Get **2 Rubies**.', goldenText: 'Get **4 Rubies**.',
        effects: [{ on: 'onPlay', do: 'battlecryGetRubies', params: { count: 2 } }] },
    ],
    text: '**Choose One:** get a random **Shop spell**, or get **2 Rubies**.',
    goldenText: '**Choose One:** get **2** random **Shop spells**, or get **4 Rubies**.',
  },
  {
    // Both branches raise Ruby STRENGTH (`rubyBonus`) — the run-wide stat every future Ruby carries — split
    // into the Attack half and the Health half. Deepvein Tender (set 2) is the same primitive with the
    // health half only, so this is that card's choice made explicit.
    id: 'k3_forkvein',
    name: 'Forkvein Prospector',
    tribe: 'kobold',
    tier: 2,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Your Rubies gain **+1 Attack**.', goldenText: 'Your Rubies gain **+2 Attack**.',
        effects: [{ on: 'onPlay', do: 'rubyStatGain', params: { attack: 1, health: 0 } }] },
      { text: 'Your Rubies gain **+1 Health**.', goldenText: 'Your Rubies gain **+2 Health**.',
        effects: [{ on: 'onPlay', do: 'rubyStatGain', params: { attack: 0, health: 1 } }] },
    ],
    text: '**Choose One:** give your Rubies **+1 Attack**, or **+1 Health**.',
    goldenText: '**Choose One:** give your Rubies **+2 Attack**, or **+2 Health**.',
  },
  {
    // The T3 fork: a body now against Ruby fuel. `battlecryGainRandomMinion` with no tribe draws from the
    // run's pool at or below the tavern tier, so in a set-3 run it pulls Kobolds and neutrals.
    id: 'k3_forkroad',
    name: 'Forkroad Scavenger',
    tribe: 'kobold',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Get a random minion.', goldenText: 'Get **2** random minions.',
        effects: [{ on: 'onPlay', do: 'battlecryGainRandomMinion', params: { count: 1 } }] },
      { text: 'Get **3 Rubies**.', goldenText: 'Get **6 Rubies**.',
        effects: [{ on: 'onPlay', do: 'battlecryGetRubies', params: { count: 3 } }] },
    ],
    text: '**Choose One:** get a random minion, or get **3 Rubies**.',
    goldenText: '**Choose One:** get **2** random minions, or get **6 Rubies**.',
  },
  {
    // Echo (a death trigger) hands back the Veinstorm spell.
    //
    // `cardId`, NOT `spellId`, and NO `count` — the factory reads `params.cardId` and grants `mul(self)`
    // copies, so golden's "2 Veinstorms" is automatic. Set 2's Staff of Guel carries the same warning after
    // the wrong key granted the empty string and crashed the hand-grant preview (owner report 2026-07-25);
    // the content schema catches it now, which is how this one was caught.
    id: 'k3_veinchant',
    name: 'Veinchant Delver',
    tribe: 'kobold',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'veinstorm' } }],
    text: '**Echo:** get a **Veinstorm**.',
    goldenText: '**Echo:** get **2 Veinstorms**.',
  },
  {
    // The tribe's Discover fork. `battlecryDiscoverMinion` takes a tribe, so the left branch is a true
    // three-card Kobold peek rather than a random grant; the right is the shared Shop-spell Discover.
    id: 'k3_jeweler',
    name: 'Prismatic Jeweler',
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Discover a **Kobold**.', goldenText: 'Discover **2 Kobolds**.',
        effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion', params: { tribe: 'kobold' } }] },
      { text: 'Discover a **Shop spell**.', goldenText: 'Discover **2 Shop spells**.',
        effects: [{ on: 'onPlay', do: 'battlecryDiscoverSpell', params: {} }] },
    ],
    text: '**Choose One:** Discover a **Kobold**, or a **Shop spell**.',
    goldenText: '**Choose One:** Discover **2 Kobolds**, or **2 Shop spells**.',
  },
  {
    // The roster's Equip minion. Blast Pump is an EQUIPMENT SPELL — it casts `rubyexcavation`, the shipped
    // set-2 Shop spell whose text is already this exact payload, rather than re-implementing it. That
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
    text: '**Equip Blast Pump (1):** Cast **2 Rubies** on your minions.',
    goldenText: '**Equip Blast Pump (1):** Cast **4 Rubies** on your minions.',
  },
  {
    // Owner rework 2026-08-30: the left branch is a WARDING RUBY (the set-2 token that also grants Ward),
    // not a board-wide Ruby cast. `getRubies` names it through `rubyId`, the same way Wardstone Jeweler does
    // on its End-of-Turn half. The right branch casts Veinstorm twice through the REAL Shop-spell pipeline,
    // so each cast counts as a Shop spell cast and wakes every cast-watcher.
    id: 'k3_facetbound',
    name: 'Facetbound Martyr',
    tribe: 'kobold',
    tier: 5,
    attack: 5,
    health: 4,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Get a **Warding Ruby**.', goldenText: 'Get **2 Warding Rubies**.',
        effects: [{ on: 'onPlay', do: 'getRubies', params: { count: 1, rubyId: 'warding-ruby' } }] },
      { text: 'Cast **Veinstorm** 2 times.', goldenText: 'Cast **Veinstorm** 4 times.',
        effects: [{ on: 'onPlay', do: 'battlecryCastNamedSpell', params: { spellId: 'veinstorm', count: 2 } }] },
    ],
    text: '**Choose One:** get a **Warding Ruby**, or cast **Veinstorm** 2 times.',
    goldenText: '**Choose One:** get **2 Warding Rubies**, or cast **Veinstorm** 4 times.',
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
     * two Double Troubles do not feed each other -- its own Rubies land as stats and notify nobody, the guard
     * that already stops two Resonance Idols pinging a Ruby between them forever.
     *
     * PERMANENCE IS INHERITED (owner note): a Ruby cast off a permanent one is itself permanent.
     */
    id: 'k3_doubletrouble',
    name: 'Double Trouble',
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
    name: 'Forksong Herald',
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'grantRandomChooseOne', params: { count: 1 } }],
    text: '**Rally:** get a **Choose One** card.',
    goldenText: '**Rally:** get **2 Choose One** cards.',
  },
  {
    // `set` (not add) — "the FIRST Choose One card you play each turn", so the charge refreshes to exactly one
    // per turn and is never banked. The turn boundary clears charges first, then this re-grants.
    id: 'k3_forkedcrown',
    name: 'Forked Crown',
    tribe: 'kobold',
    tier: 4,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantChooseBothCharges', params: { count: 1, set: 1 } }],
    text: 'The **first Choose One** card you play each turn gains **both** effects.',
    goldenText: 'The **first 2 Choose One** cards you play each turn gain **both** effects.',
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
];
