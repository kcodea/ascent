import type { CardDef } from '@game/core';

/**
 * SET 3 — NEUTRALS (owner roster 2026-09-09). Set 3's OWN neutral cards; the carried-over set-1 / set-2
 * neutrals are opted in BY ID in `sets.ts` (`SET1_NEUTRALS_IN_SET3` / `SET2_NEUTRALS_IN_SET3`), shared
 * definitions exactly like the Kobolds, Dwarves and Undead before them.
 *
 * Tranche 1 (this file's first cut): Blaster (restored from the archive — a set-3 card again, id unchanged so
 * every old save / replay still resolves it) and Splitboon Adept (new). The set-3 Yazzus FORK (`n3_yazzus`,
 * 2026-09-09) that opened here is gone: it BECAME the one permanent `yazzus` (owner 2026-09-16 — "there is no
 * legacy or new Yazzus"), a shared definition in `cards/set1/neutral.ts` that set 3 opts in by id like every
 * other carry-over. Still to come: Defender + Tower Shields, Inspector Pell + Clues, Highway
 * Hustler + Whiplass-o, Warband Recruiter, Equipment Inspector + Start of Turn.
 */
export const SET3_NEUTRAL: readonly CardDef[] = [
  {
    // Un-archived for set 3 (owner 2026-09-09) — as it was: a Taunt body whose Echo hits EVERY minion for 3.
    // Set 1 (disabled) and set 2 never listed it, so moving the def here changes no other pool.
    id: 'blaster',
    name: 'Blaster',
    tribe: 'neutral',
    tier: 3, // T4 until 2026-10-13 (owner Set 3 batch)
    attack: 8,
    health: 2,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleDamageAll', params: { amount: 3 } }],
    text: '**Taunt. Echo:** deal **3** damage to ALL minions.',
    goldenText: '**Taunt. Echo:** deal **6** damage to ALL minions.',
  },
  {
    // Shout: two Tower Shields to hand (a free +2/+1-and-Taunt hand spell each — `cards/set3/handSpells.ts`).
    // Golden mints four. The mint is the shared `battlecryGetHandSpell`, the same factory the Magnifying Glass
    // uses for Clues, so one primitive serves every card that hands out a hand spell.
    id: 'n3_defender',
    name: 'Defender',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGetHandSpell', params: { cardId: 'tower_shield', count: 2 } }],
    text: '**Shout:** get **2 Tower Shields**.',
    goldenText: '**Shout:** get **4 Tower Shields**.',
  },
  {
    // Equip minion: its Magnifying Glass (1 Gold) mints two Clues (`cards/set3/handSpells.ts`) — the run's
    // Clue value grows by one per Clue cast, so the Glass is a self-improving engine. `equipmentId` is the
    // only place the card names its Equipment; cost, wording and effect come from the registry entry.
    id: 'n3_pell',
    name: 'Inspector Pell',
    tribe: 'neutral',
    tier: 3,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'magnifying_glass' } }],
    text: '**Equip Magnifying Glass (1):** get **2 Clues**.',
    goldenText: '**Equip Magnifying Glass (1):** get **4 Clues**.',
  },
  {
    // Equip minion: Whiplass-o (2 Gold) steals the highest-TIER minion in the Shop into your hand (owner
    // 2026-09-09: highest tier, not highest Attack; a gilded Hustler steals two). The theft is the existing
    // `stealTavernMinion` primitive with a `pick` rule, so a stolen card carries exactly what a bought one does.
    id: 'n3_hustler',
    name: 'Highway Hustler',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'whiplasso' } }],
    text: '**Equip Whiplass-o (2):** steal the highest-Tier minion in the Shop.',
    goldenText: '**Equip Whiplass-o (2):** steal the **2** highest-Tier minions in the Shop.',
  },
  {
    // Rally: SUMMON a random Rally minion beside this AND GET a copy in hand (owner 2026-09-09: "yes and yes").
    // Both phases: in combat the summon fights now and the copy carries back to hand at settle; in the shop
    // (a triggered Rally) the summon lands on the board and the copy goes to hand. Golden: twice. The pool is
    // the run's set's Rally minions, never the Recruiter itself — a chain of Recruiters summoning Recruiters
    // is bounded by the board, but it reads as a loop and adds nothing.
    id: 'n3_recruiter',
    name: 'Uncle Orc', // 'Warband Recruiter' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 8,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallySummonAndGetRally', params: {} }],
    text: '**Rally:** summon and get a random **Rally** minion.',
    goldenText: '**Rally:** summon and get **2** random **Rally** minions.',
  },
  {
    // Start of Turn (fires as the shop reopens, right after the Equipment charges are rebuilt): one bonus
    // Equipment charge this turn, into the SHARED pool any held Equipment may spend (and spends first). The
    // pool lives in `equipment.bonusActivations`, which the turn rebuild zeroes — a per-turn grant, never
    // banked. Golden: two. Renamed from "Equipment Inspector" on the
    // owner's sheet (2026-09-09: "rename Equipment Inspector -> Equipment Charger").
    id: 'n3_charger',
    name: 'Jumpstart Jules', // 'Equipment Charger' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'neutral',
    tier: 4,
    attack: 6,
    health: 7,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'startOfTurnEquipmentCharge', params: { count: 1 } }],
    text: '**Start of Turn:** gain an **Equipment charge**.',
    goldenText: '**Start of Turn:** gain **2 Equipment charges**.',
  },
  {
    // A Choose One between one big body and two medium ones. Option 1 TARGETS (a per-option `target`, the
    // Godfodder shape) and rides the shared targeted-Shout body; option 2 is a new Shout-family arena effect
    // (`battlecryBuffAdjacent`) so a combat re-fire (Ryme, Myra) buffs its neighbours there too. Golden doubles.
    id: 'n3_splitboon',
    name: 'Halfsies', // 'Splitboon Adept' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'neutral',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Give a friendly minion **+6/+6**.', goldenText: 'Give a friendly minion **+12/+12**.', target: 'friendly',
        effects: [{ on: 'onPlay', do: 'battlecryBuffTarget', params: { attack: 6, health: 6 } }] },
      { text: 'Give adjacent minions **+3/+3**.', goldenText: 'Give adjacent minions **+6/+6**.',
        effects: [{ on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 3, health: 3 } }] },
    ],
    text: '**Choose One:** give a friendly minion **+6/+6**, or give adjacent minions **+3/+3**.',
    goldenText: '**Choose One:** give a friendly minion **+12/+12**, or give adjacent minions **+6/+6**.',
  },
  {
    // Owner handoff 2026-09-18, reworked 2026-10-13 (owner Set 3 batch; was "your left-most and right-most minions
    // +4/+4"). End of Turn: EVERY friendly minion gains +2/+3 for EVERY Equipment the player holds whose charge was
    // NOT spent this turn (`unusedEquipmentCount` — the per-turn `usedThisTurn` mark Rune of Amplification also
    // reads, taken BEFORE `expireEquipmentTurn` clears it). `scope: 'all'` widens the shared factory from the two
    // ends to the whole board. Permanent shop buff; golden +4/+6 per Equipment. The live text prints the current
    // total (`shredderText`) on every surface.
    id: 'n3_shredder',
    name: 'Shredder',
    tribe: 'neutral',
    tier: 4,
    attack: 8,
    health: 4,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnBuffEndsPerUnusedEquipment', params: { attack: 2, health: 3, scope: 'all' } }],
    text: '**End of Turn:** give your minions **+2/+3** for every **Equipment** unused this turn.',
    goldenText: '**End of Turn:** give your minions **+4/+6** for every **Equipment** unused this turn.',
  },
  {
    // Owner handoff 2026-09-18. Equip minion: the Calibration Wrench (1 Gold) arms the run so the NEXT Equipment
    // activation — any Equipment but the Wrench itself — resolves Amplified (triggers twice), riding the same
    // `amplified` machinery Rune of Amplification / the Grand Workshop feed (`packages/sim/src/equipment.ts`,
    // `calibrationPending`). Gilded: the next TWO activations.
    id: 'n3_calibration',
    name: 'Calibration Master',
    tribe: 'neutral',
    tier: 4, // T5 9/6 until 2026-10-13 (owner Set 3 batch)
    attack: 6,
    health: 4,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'calibration_wrench' } }],
    text: '**Equip Calibration Wrench (1):** your next **Equipment** activation is **Amplified**.',
    goldenText: '**Equip Calibration Wrench (1):** your next **2 Equipment** activations are **Amplified**.',
  },
  {
    // Owner handoff 2026-09-18. Whenever the player ACTIVATES an Equipment from the slot (the reducer's
    // `activateEquipment` success path — the Calibration Wrench counts, it is an activation like any other),
    // every Rig ON THE BOARD gains +4/+4 permanently (golden +8/+8). Hand copies never fire: the
    // `equipmentActivated` trigger is dispatched to board bodies only (`fireEquipmentActivated`).
    id: 'n3_rig',
    name: 'Rig',
    tribe: 'neutral',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'equipmentActivated', do: 'equipmentActivatedBuffSelf', params: { attack: 4, health: 4 } }],
    text: 'When you use **Equipment**, this gains **+4/+4**.',
    goldenText: 'When you use **Equipment**, this gains **+8/+8**.',
  },
  {
    // Owner Set 3 batch 2026-10-13. A roll meter that pays out in the SHOP: every 5th Shop refresh while this is on
    // the board adds a Golden Monkey to the Shop (gilded: 2). The meter is Hellrider's: a per-instance tally on
    // `eotTick`, counted by the `shopRefreshed` trigger (every refresh that rebuilds the row, the turn's fresh row
    // included), cumulative since this body arrived and repeating every 5. The board badge counts down the
    // refreshes left (`stepProgress`). Named after the hero Indy on purpose (owner); the id is distinct.
    id: 'n3_indy',
    name: 'Indy',
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'shopRefreshed', do: 'onShopRefreshAddToShop', params: { every: 5, cardId: 'n3_goldenmonkey', count: 1 } }],
    text: 'When you roll **5** times, add a **Golden Monkey** to the Shop.',
    goldenText: 'When you roll **5** times, add **2 Golden Monkeys** to the Shop.',
  },
  {
    // Owner Set 3 batch 2026-10-13. Indy's TOKEN: never drawn (`token: true`), only added to the Shop by Indy. Sell:
    // Discover a minion from the tier ABOVE your current Shop tier, capped at Tier 7 (owner: "one above your current
    // Shop tier, capped at 7"); a fixed-tier offer like Salvatore's (`onSellDiscover`, `tierOffset`). Gilded: the
    // offered minions are gilded.
    id: 'n3_goldenmonkey',
    name: 'Golden Monkey',
    tribe: 'neutral',
    tier: 1,
    attack: 6,
    health: 6,
    keywords: ['T'],
    token: true,
    effects: [{ on: 'onSell', do: 'onSellDiscover', params: { tierOffset: 1, count: 1 } }],
    text: '**Taunt. Sell:** Discover a minion from the Tier above yours (up to Tier 7).',
    goldenText: '**Taunt. Sell:** Discover a **gilded** minion from the Tier above yours (up to Tier 7).',
  },
  {
    // Owner Set 3 batch 2026-10-13. A PASSIVE marker (never dispatched): while this is on your board, EVERY Equipment
    // activation resolves Amplified (triggers twice), read at activation by `equipmentAmplifiedByAura`. Nothing is
    // spent: a banked Amplified stack or a pending Calibration stays for later. Only while on the board (owner).
    // Amplified is ×2 at most, so a gilded copy cannot do more: the gilded card is the same rule on a doubled body.
    id: 'n3_agnus',
    name: 'Amplification Agnus',
    tribe: 'neutral',
    tier: 7,
    attack: 10,
    health: 10,
    keywords: [],
    effects: [{ on: 'passive', do: 'equipmentAmplifyAll' }],
    text: 'All **Equipment** is **Amplified**.',
    goldenText: 'All **Equipment** is **Amplified**.',
  },
];
