import type { CardDef } from '@game/core';

/**
 * SET 3 — NEUTRALS (owner roster 2026-09-09). Set 3's OWN neutral cards; the carried-over set-1 / set-2
 * neutrals are opted in BY ID in `sets.ts` (`SET1_NEUTRALS_IN_SET3` / `SET2_NEUTRALS_IN_SET3`), shared
 * definitions exactly like the Kobolds, Dwarves and Undead before them.
 *
 * Tranche 1 (this file's first cut): Blaster (restored from the archive — a set-3 card again, id unchanged so
 * every old save / replay still resolves it), Splitboon Adept (new) and the set-3 Yazzus (a FORK — set 1's
 * `yazzus` stays T7 5/7 and "Shop spells"; this one is T6 4/8 and doubles EVERY targeted spell, Rubies
 * included — owner 2026-09-09). Still to come: Defender + Tower Shields, Inspector Pell + Clues, Highway
 * Hustler + Whiplass-o, Warband Recruiter, Equipment Inspector + Start of Turn.
 */
export const SET3_NEUTRAL: readonly CardDef[] = [
  {
    // Un-archived for set 3 (owner 2026-09-09) — as it was: a Taunt body whose Echo hits EVERY minion for 3.
    // Set 1 (disabled) and set 2 never listed it, so moving the def here changes no other pool.
    id: 'blaster',
    name: 'Blaster',
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 3,
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
    attack: 2,
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
    attack: 2,
    health: 3,
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
    name: 'Warband Recruiter',
    tribe: 'neutral',
    tier: 4,
    attack: 4,
    health: 5,
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
    name: 'Equipment Charger',
    tribe: 'neutral',
    tier: 4,
    attack: 6,
    health: 2,
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
    name: 'Splitboon Adept',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
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
    // Set 3's Yazzus — a FORK of set 1's `yazzus` (T7 5/7, "targeted SHOP spells"), not an edit: set 2 keeps
    // the original untouched (owner 2026-09-09). This one sits at T7 (owner 2026-09-11, "as he is in set 2"; it
    // opened at T6) on a 4/8 and widens the doubling to EVERY
    // targeted spell — Shop spells, Rubies, and the hand spells set 3 adds (Tower Shield, Clue). Resolved in
    // @game/sim: `spellCastMult` (aimed Shop spells) and `rubyCastCount` (Rubies) both read it. Best single
    // copy wins, like the original — golden = 2 additional casts. No combat factory; a sturdy body in a fight.
    id: 'n3_yazzus',
    name: 'Yazzus',
    tribe: 'neutral',
    tier: 7,
    attack: 4,
    health: 8,
    keywords: [],
    effects: [],
    text: 'Your **targeted** spells cast **an additional** time.',
    goldenText: 'Your **targeted** spells cast **2 additional** times.',
  },
];
