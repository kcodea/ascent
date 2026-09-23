import type { CardDef } from '@game/core';

/**
 * SET 3 — SPIRITS (owner roster 2026-09-09), a brand-new tribe. Two engines run through the roster:
 *   • THE REVELERS — Flame / Tide / Grove Reveler are sold, not kept: each sale pays a SHARED, run-wide value
 *     (`RunState.revelerX`, starts at 1 — Flame → Attack, Tide → Health, Grove → both) and then raises it by one
 *     for every Reveler. "Your Reveler bonus" (Festival Luminary) IS that value. Revelator / Revelmaker hand out
 *     more Revelers; Festival Treasurer and Grand Procession pay off selling them.
 *   • SPIRITS PLAYED — a per-turn tally (`spiritsPlayedThisTurn`, derived from `playedThisTurn`) and a new
 *     `onTribePlayed` trigger with PER-INSTANCE tallies (`spiritTally`): Festival Keeper (every 3 → a spell),
 *     Aspect (improves every 3), Old Timber (counts only Spirits played AFTER it — owner
 *     2026-09-09; a base +3/+2 that improves per Spirit since 2026-09-18).
 * Tranche 2 adds the HAND-SUMMON cards (Tide Caller, Dreaming Deep, Seedling Spirit, Handbound Titan,
 * Flamebanner Marshal, Hearth Whisperer, Slumbering Colossus).
 * Golden doubles every number (owner 2026-09-09); a golden Reveler pays 2X.
 */

/** The three Revelers — a CLASS other Spirits name ("a random Reveler", "whenever you sell a Reveler"). */
export const REVELER_IDS: readonly string[] = ['sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler'];

export const SET3_SPIRITS: readonly CardDef[] = [
  /* ── the HAND-SUMMON cards (tranche 2). A minion can be SUMMONED from hand once per combat: an EXACT copy at
     the moment of summon, the card stays in hand (greyed for the fight) and keeps taking buffs that never reach
     the copy (owner design 2026-09-09). Shop-triggered Rallies / Echoes follow the same rule per turn. ── */
  {
    // Taunt. Whenever this takes damage (combat): a random minion in your hand +1/+2, permanent (R-HAND-02).
    id: 'sp3_hearthwhisperer',
    name: 'Hearth Whisperer',
    tribe: 'spirit',
    tier: 2,
    attack: 2,
    health: 6,
    keywords: ['T'],
    effects: [{ on: 'onDamaged', do: 'onDamagedBuffRandomHand', params: { attack: 1, health: 2 } }],
    text: '**Taunt.** Whenever this takes damage, give a random minion in your hand **+1/+2**.',
    goldenText: '**Taunt.** Whenever this takes damage, give a random minion in your hand **+2/+4**.',
  },
  {
    // Rally: summon a COPY of a random Spirit from your hand (the card stays; once per card per combat).
    id: 'sp3_seedling',
    name: 'Seedling Spirit',
    tribe: 'spirit',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallySummonRandomTribeFromHand', params: { tribe: 'spirit' } }],
    text: '**Rally:** summon a random Spirit from your hand.',
    goldenText: '**Rally:** summon **2** random Spirits from your hand.',
  },
  {
    // A HAND watcher (`inHand: true`): while this is in your hand, every Spirit you play grows it +4/+4.
    id: 'sp3_slumbering',
    name: 'Dozer', // 'Slumbering Colossus' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'onTribePlayed', do: 'tribePlayedBuffSelfInHand', params: { tribe: 'spirit', attack: 4, health: 4, inHand: true } }],
    text: 'While this is in your hand, whenever you play a Spirit, give this **+4/+4**.',
    goldenText: 'While this is in your hand, whenever you play a Spirit, give this **+8/+8**.',
  },
  {
    // Echo: summon a COPY of the highest-Health minion in your hand.
    id: 'sp3_dreamtide',
    name: 'Tide Caller', // 'Dreamtide Caller' on the sheet; renamed by the owner 2026-09-09 (id unchanged)
    tribe: 'spirit',
    tier: 5,
    attack: 6,
    health: 5,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummonHighestHealthFromHand', params: {} }],
    text: '**Echo:** summon the highest-Health minion from your hand.',
    goldenText: '**Echo:** summon the **2** highest-Health minions from your hand.',
  },
  {
    // Rally: 2 friendly Spirits gain the Attack of the highest-Attack minion in your hand — combat-only.
    id: 'sp3_flamebanner',
    name: 'Flamebanner Marshal',
    tribe: 'spirit',
    tier: 6,
    attack: 8,
    health: 7,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGiveTribeAttackOfHighestAttackHand', params: { tribe: 'spirit', count: 2 } }],
    text: '**Rally:** give **2** friendly Spirits the Attack of the highest-Attack minion in your hand.',
    goldenText: '**Rally:** give **4** friendly Spirits the Attack of the highest-Attack minion in your hand.',
  },
  {
    // Start of Combat: gain the stats of the highest-Health minion in your hand — this combat.
    id: 'sp3_handboundtitan',
    name: 'Handbound Titan',
    tribe: 'spirit',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'scGainStatsOfHighestHealthHand', params: {} }],
    text: '**Start of Combat:** gain the stats of the highest-Health minion in your hand this combat.',
    goldenText: '**Start of Combat:** gain **twice** the stats of the highest-Health minion in your hand this combat.',
  },
  {
    // Echo: summon a COPY of the highest-Health minion in your hand and give it Ward.
    id: 'sp3_dreamingdeep',
    name: 'Dreaming Deep',
    tribe: 'spirit',
    tier: 7,
    attack: 8,
    health: 14,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummonHighestHealthFromHand', params: { ward: true } }],
    text: '**Echo:** summon the highest-Health minion from your hand and give it **Ward**.',
    goldenText: '**Echo:** summon the **2** highest-Health minions from your hand and give them **Ward**.',
  },
  {
    // Rally: +1 Attack PERMANENTLY per Spirit played this turn (owner handoff 2026-09-18 — was combat-only, 3/1).
    // Combat reads the tally frozen at combat start (`spiritsPlayedFor`) and books the gain as `permaGain` so it
    // carries back to the run card (Target Dummy's channel); a shop-triggered Rally reads the live count and is
    // permanent as every shop grant is. The live text prints the current total on both chains (`spiritText`).
    id: 'sp3_kindled',
    name: 'Kindled Sprite',
    tribe: 'spirit',
    tier: 1,
    attack: 1,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGainAttackPerSpiritsPlayed', params: { per: 1 } }],
    text: '**Rally:** gain **+1 Attack** permanently for every Spirit played this turn.',
    goldenText: '**Rally:** gain **+2 Attack** permanently for every Spirit played this turn.',
  },
  {
    // Shout: ONE random Spirit on the board AND one random Spirit in hand, +2 Health each (owner: two recipients).
    id: 'sp3_tidebud',
    name: 'Tidebud',
    tribe: 'spirit',
    tier: 1,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffRandomTribeBoardAndHand', params: { tribe: 'spirit', attack: 0, health: 2 } }],
    text: '**Shout:** give a random Spirit on your board and in your hand **+2 Health**.',
    goldenText: '**Shout:** give a random Spirit on your board and in your hand **+4 Health**.',
  },
  {
    id: 'sp3_flamereveler',
    name: 'Flame Reveler',
    tribe: 'spirit',
    tier: 2,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onSell', do: 'revelerSell', params: { stat: 'attack' } }],
    text: '**Sell:** give your Spirits **+1 Attack**, then increase that by 1.',
    goldenText: '**Sell:** give your Spirits **+2 Attack**, then increase that by 1.',
  },
  {
    id: 'sp3_tidereveler',
    name: 'Tide Reveler',
    tribe: 'spirit',
    tier: 2,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onSell', do: 'revelerSell', params: { stat: 'health' } }],
    text: '**Sell:** give your Spirits **+1 Health**, then increase that by 1.',
    goldenText: '**Sell:** give your Spirits **+2 Health**, then increase that by 1.',
  },
  {
    // The Grove pays EVERY minion, both stats — the same shared value.
    id: 'sp3_grovereveler',
    name: 'Grove Reveler',
    tribe: 'spirit',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'onSell', do: 'revelerSell', params: { stat: 'both' } }],
    text: '**Sell:** give your minions **+1/+1**, then increase that by 1.',
    goldenText: '**Sell:** give your minions **+2/+2**, then increase that by 1.',
  },
  {
    // Equip minion: Spiritbinder (2 Gold; 'Spiritbringer' until 2026-09-13, id unchanged) — a RANDOM Spirit on the board and a random Spirit in hand, +6/+6 each (untargeted since 2026-09-14).
    id: 'sp3_bondweaver',
    name: 'Knot', // 'Bondweaver Shaman' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'spiritbringer' } }],
    text: '**Equip Spiritbinder (2):** give a random Spirit on your board and in your hand **+6/+6**.',
    goldenText: '**Equip Spiritbinder (2):** give a random Spirit on your board and in your hand **+12/+12**.',
  },
  {
    // Every 3 Spirits played → a random Shop spell (≤ tavern tier). Per-instance progress that CARRIES ACROSS
    // TURNS (owner: "if you're at 2/3 you keep that progress"). The live text prints the count.
    id: 'sp3_festivalkeeper',
    name: 'Tally', // 'Festival Keeper' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'onTribePlayed', do: 'tribePlayedEveryNGrantRandomSpell', params: { tribe: 'spirit', every: 3, count: 1 } }],
    text: 'After you play **3** Spirits, get a random spell.',
    goldenText: 'After you play **3** Spirits, get **2** random spells.',
  },
  {
    // End of Turn: a random Spirit +3/+4, then once more per Spirit played this turn (1 + N fires, each random).
    id: 'sp3_nurturer',
    name: 'Mother Moss', // 'Nurturer' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 3,
    attack: 2,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnBuffRandomTribeRepeatPerPlayed', params: { tribe: 'spirit', attack: 3, health: 4 } }],
    text: '**End of Turn:** give a random Spirit **+3/+4**. Repeat for every Spirit played this turn.',
    goldenText: '**End of Turn:** give a random Spirit **+6/+8**. Repeat for every Spirit played this turn.',
  },
  {
    // Whenever you cast a Shop spell → a random minion in your HAND +4/+6 (permanent — R-HAND-02).
    id: 'sp3_dreamcurrent',
    name: 'Lullaby Lou', // 'Dreamcurrent Mystic' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 4,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffRandomHand', params: { attack: 4, health: 6 } }],
    text: 'Whenever you cast a Shop spell, give a minion in your hand **+4/+6**.',
    goldenText: 'Whenever you cast a Shop spell, give a minion in your hand **+8/+12**.',
  },
  {
    // Equip minion: Revelmaker (2 Gold) — a random Reveler to hand (gilded: two).
    id: 'sp3_paradeartificer',
    name: 'Revelsmith', // 'Spirit Artificer' until 2026-09-14 (owner rename handoff; id + art unchanged) // 'Parade Artificer' on the sheet; renamed by the owner 2026-09-09 (id unchanged)
    tribe: 'spirit',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'revelmaker' } }],
    text: '**Equip Revelmaker (2):** get a random **Reveler**.',
    goldenText: '**Equip Revelmaker (2):** get **2** random **Revelers**.',
  },
  {
    // Shout: if you control a Spirit (this one does not count — it is the one being played), Discover a Spirit.
    id: 'sp3_gatheringguide',
    name: 'Branch Manager', // 'Gathering Guide' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverTribeIfControl', params: { tribe: 'spirit' } }],
    text: '**Shout:** if you control a Spirit, **Discover** a Spirit.',
    goldenText: '**Shout:** if you control a Spirit, **Discover** a Spirit, twice.',
  },
  {
    // Whenever you play a Spirit: 3 random friendly Spirits +N/+N, where N starts at 2 and improves by 2 every
    // 3 triggers (per copy — owner 2026-09-09; +2 step since the 2026-09-18 handoff). Golden doubles both the
    // grant and the improvement. The live text prints the current grant; the step counter shows N/3.
    id: 'sp3_aspect',
    name: 'Aspect', // renamed from Aspect (owner 2026-09-11); id kept
    tribe: 'spirit',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [{ on: 'onTribePlayed', do: 'tribePlayedBuffRandomTribeImproving', params: { tribe: 'spirit', count: 3, attack: 2, health: 2, every: 3 } }],
    text: 'When you play a Spirit, give **3** random Spirits **+2/+2**. Improves every **3** times this triggers.',
    goldenText: 'When you play a Spirit, give **3** random Spirits **+4/+4**. Improves every **3** times this triggers.',
  },
  {
    // Whenever you sell a Reveler: your next Spirit this turn costs 1 less — stacks to −3 (owner 2026-09-09).
    id: 'sp3_treasurer',
    name: 'Smokey Joe', // 'Festival Treasurer' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 5,
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'minionSold', do: 'minionSoldRevelerDiscount', params: { amount: 1, max: 3 } }],
    text: 'Whenever you **sell** a **Reveler**, your next Spirit costs **1** less this turn.',
    goldenText: 'Whenever you **sell** a **Reveler**, your next Spirit costs **2** less this turn.',
  },
  {
    id: 'sp3_revelator',
    name: 'Revelator',
    tribe: 'spirit',
    tier: 5,
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantRandomReveler', params: { count: 1 } }],
    text: '**Shout:** get a random **Reveler**.',
    goldenText: '**Shout:** get **2** random **Revelers**.',
  },
  {
    // Shout: 3 random Spirits +1/+1 PLUS the shared Reveler value on both stats (owner: "the same X amount").
    id: 'sp3_luminary',
    name: 'Limelight', // 'Festival Luminary' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 6,
    attack: 6,
    health: 8,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffRandomTribePlusReveler', params: { tribe: 'spirit', count: 3, attack: 1, health: 1 } }],
    text: '**Shout:** give **3** random Spirits **+1/+1** plus your **Reveler** bonus.',
    goldenText: '**Shout:** give **3** random Spirits **+2/+2** plus **twice** your **Reveler** bonus.',
  },
  {
    // Renamed from Parade Colossus (owner 2026-09-09). Counts only Spirits played AFTER it was played — a
    // per-instance tally (`spiritTally`) that the combat body carries in. Start of Combat (owner handoff
    // 2026-09-18): a BASE +3/+2 that improves by +3/+2 per Spirit played — (1 + tally) steps (`base: 1`).
    id: 'sp3_forestcolossus',
    name: 'Old Timber', // 'Forest Colossus' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'spirit',
    tier: 6,
    attack: 7,
    health: 10,
    keywords: [],
    effects: [
      { on: 'onTribePlayed', do: 'tribePlayedTally', params: { tribe: 'spirit' } },
      { on: 'startOfCombat', do: 'scBuffTribePerTally', params: { tribe: 'spirit', attack: 3, health: 2, base: 1 } },
    ],
    text: '**Start of Combat:** give your Spirits **+3/+2**. Improves for every Spirit played.',
    goldenText: '**Start of Combat:** give your Spirits **+6/+4**. Improves for every Spirit played.',
  },
  {
    // The first Flame, Tide and Grove Reveler sold each turn each return a PLAIN copy (base stats, not golden)
    // to hand — the Reveler's own sell effect still fires. Golden: two copies.
    id: 'sp3_grandprocession',
    name: 'Grand Procession',
    tribe: 'spirit',
    tier: 7,
    attack: 11,
    health: 9,
    keywords: [],
    effects: [{ on: 'minionSold', do: 'minionSoldRevelerReturn', params: { count: 1 } }],
    text: 'The first **Flame**, **Tide** and **Grove Reveler** you sell each turn return a plain copy to your hand.',
    goldenText: 'The first **Flame**, **Tide** and **Grove Reveler** you sell each turn return **2** plain copies to your hand.',
  },
  {
    // RUNE-EXCLUSIVE TOKEN (Rune of the Handy Flame, Set 3 batch 2 — owner 2026-09-16). `token: true` keeps it out
    // of every draw pool; the rune is the only way in. "Whenever this gains stats" is the SHOP-phase `onGainStats`
    // trigger, dispatched by the reducer's per-action stat diff — in hand or on the board — and pays a random
    // OTHER minion in your hand (a Handy Flame never feeds itself, and two Handy Flames feed each other once per
    // action, so the chain is bounded). Combat does not emit `onGainStats` yet (no combat half). No art yet.
    id: 'sp3_handyflame',
    name: 'Handy Flame',
    tribe: 'spirit',
    tier: 5,
    attack: 2,
    health: 13,
    keywords: [],
    token: true,
    effects: [{ on: 'onGainStats', do: 'onGainStatsBuffRandomHand', params: { attack: 6, health: 4 } }],
    text: 'Whenever this gains stats, give a random minion in your hand **+6/+4**.',
    goldenText: 'Whenever this gains stats, give a random minion in your hand **+12/+8**.',
  },
];
