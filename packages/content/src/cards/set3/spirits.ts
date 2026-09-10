import type { CardDef } from '@game/core';

/**
 * SET 3 — SPIRITS (owner roster 2026-09-09), a brand-new tribe. Two engines run through the roster:
 *   • THE REVELERS — Flame / Tide / Grove Reveler are sold, not kept: each sale pays a SHARED, run-wide value
 *     (`RunState.revelerX`, starts at 1 — Flame → Attack, Tide → Health, Grove → both) and then raises it by one
 *     for every Reveler. "Your Reveler bonus" (Festival Luminary) IS that value. Revelator / Revelmaker hand out
 *     more Revelers; Festival Treasurer and Grand Procession pay off selling them.
 *   • SPIRITS PLAYED — a per-turn tally (`spiritsPlayedThisTurn`, derived from `playedThisTurn`) and a new
 *     `onTribePlayed` trigger with PER-INSTANCE tallies (`spiritTally`): Festival Keeper (every 3 → a spell),
 *     Aspect Choreographer (improves every 3), Forest Colossus (counts only Spirits played AFTER it — owner
 *     2026-09-09).
 * Tranche 2 adds the HAND-SUMMON cards (Dreamtide Caller, Dreaming Deep, Seedling Spirit, Handbound Titan,
 * Flamebanner Marshal, Hearth Whisperer, Slumbering Colossus).
 * Golden doubles every number (owner 2026-09-09); a golden Reveler pays 2X.
 */

/** The three Revelers — a CLASS other Spirits name ("a random Reveler", "whenever you sell a Reveler"). */
export const REVELER_IDS: readonly string[] = ['sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler'];

export const SET3_SPIRITS: readonly CardDef[] = [
  {
    // Rally: +1 Attack per Spirit played this turn. Combat reads the tally frozen at combat start
    // (`spiritsPlayedFor`); a shop-triggered Rally reads the live count. Combat-only in a fight (owner: "all
    // attack only unless something else modifies or engraves them").
    id: 'sp3_kindled',
    name: 'Kindled Sprite',
    tribe: 'spirit',
    tier: 1,
    attack: 3,
    health: 1,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGainAttackPerSpiritsPlayed', params: { per: 1 } }],
    text: '**Rally:** gain **+1 Attack** for each Spirit you played this turn.',
    goldenText: '**Rally:** gain **+2 Attack** for each Spirit you played this turn.',
  },
  {
    // Shout: ONE random Spirit on the board AND one random Spirit in hand, +2 Health each (owner: two recipients).
    id: 'sp3_tidebud',
    name: 'Tidebud',
    tribe: 'spirit',
    tier: 1,
    attack: 1,
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
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onSell', do: 'revelerSell', params: { stat: 'attack' } }],
    text: 'When you **sell** this, give your Spirits **+1 Attack**, then increase that by 1.',
    goldenText: 'When you **sell** this, give your Spirits **+2 Attack**, then increase that by 1.',
  },
  {
    id: 'sp3_tidereveler',
    name: 'Tide Reveler',
    tribe: 'spirit',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'onSell', do: 'revelerSell', params: { stat: 'health' } }],
    text: 'When you **sell** this, give your Spirits **+1 Health**, then increase that by 1.',
    goldenText: 'When you **sell** this, give your Spirits **+2 Health**, then increase that by 1.',
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
    text: 'When you **sell** this, give your minions **+1/+1**, then increase that by 1.',
    goldenText: 'When you **sell** this, give your minions **+2/+2**, then increase that by 1.',
  },
  {
    // Equip minion: Spiritbringer (2 Gold) — a TARGETED Spirit on the board and a random Spirit in hand, +6/+6 each.
    id: 'sp3_bondweaver',
    name: 'Bondweaver Shaman',
    tribe: 'spirit',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'spiritbringer' } }],
    text: '**Equip Spiritbringer (2):** give a Spirit on your board and in your hand **+6/+6**.',
    goldenText: '**Equip Spiritbringer (2):** give a Spirit on your board and in your hand **+12/+12**.',
  },
  {
    // Every 3 Spirits played → a random Shop spell (≤ tavern tier). Per-instance progress that CARRIES ACROSS
    // TURNS (owner: "if you're at 2/3 you keep that progress"). The live text prints the count.
    id: 'sp3_festivalkeeper',
    name: 'Festival Keeper',
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
    name: 'Nurturer',
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
    name: 'Dreamcurrent Mystic',
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
    name: 'Parade Artificer',
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
    name: 'Gathering Guide',
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
    // Whenever you play a Spirit: 3 random friendly Spirits +N/+N, where N starts at 1 and improves by 1 every
    // 3 triggers (per copy — owner 2026-09-09). Golden doubles both the grant and the improvement.
    id: 'sp3_aspect',
    name: 'Aspect Choreographer',
    tribe: 'spirit',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [{ on: 'onTribePlayed', do: 'tribePlayedBuffRandomTribeImproving', params: { tribe: 'spirit', count: 3, attack: 1, health: 1, every: 3 } }],
    text: 'Whenever you play a Spirit, give **3** random friendly Spirits **+1/+1**. Improve this by **+1/+1** every 3 times this triggers.',
    goldenText: 'Whenever you play a Spirit, give **3** random friendly Spirits **+2/+2**. Improve this by **+2/+2** every 3 times this triggers.',
  },
  {
    // Whenever you sell a Reveler: your next Spirit this turn costs 1 less — stacks to −3 (owner 2026-09-09).
    id: 'sp3_treasurer',
    name: 'Festival Treasurer',
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
    name: 'Festival Luminary',
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
    // per-instance tally (`spiritTally`) that the combat body carries in. Start of Combat: Spirits +1/+1 each.
    id: 'sp3_forestcolossus',
    name: 'Forest Colossus',
    tribe: 'spirit',
    tier: 6,
    attack: 7,
    health: 10,
    keywords: [],
    effects: [
      { on: 'onTribePlayed', do: 'tribePlayedTally', params: { tribe: 'spirit' } },
      { on: 'startOfCombat', do: 'scBuffTribePerTally', params: { tribe: 'spirit', attack: 1, health: 1 } },
    ],
    text: '**Start of Combat:** give your Spirits **+1/+1** for each Spirit you played since this was played.',
    goldenText: '**Start of Combat:** give your Spirits **+2/+2** for each Spirit you played since this was played.',
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
];
