import type { CardDef } from '@game/core';

/**
 * Undead (set 3) — the owner's set-3 Undead roster, 2026-09-09.
 *
 * Twenty-two cards on the sheet (Ossuary Colossus was pulled by the owner the same day). ELEVEN are set-1 Undead
 * carried over by id (`SET1_UNDEAD_IN_SET3` in `sets.ts` — shared definitions; four were re-specced in place
 * because set 1 is disabled). This file holds the roster's ELEVEN NEW cards, and only those.
 *
 * The tribe's spine is RISE and the things that watch it. Owner rulings that shaped the engine work
 * (2026-09-09):
 *  - "When a minion Rises" means a FRIENDLY minion, and it fires in BOTH phases — a shop Rise (a destroy, a
 *    Deathfibrillator, Cage Breaker) wakes Revenant and Rising Tide too, and a recruit-phase payout is
 *    permanent. The `onRise` trigger is combat's `bus.emit` + the shop's `fireOnRise`, off the same return.
 *  - Rising Tide's board half is a normal combat gain; its hand half is permanent (R-HAND-02) — the first card
 *    on that channel.
 *  - Revenant stacks per Rise; in the shop both the stats and the Ward are permanent.
 *  - Cage Breaker's Discover is any Undead up to the current tavern tier; a combat-triggered fire grants a
 *    random Undead instead (the usual Discover-in-combat rule) and skips the destroy.
 *  - "Nearly everything should be wired to be usable in both phases": every automatic effect here has a body
 *    in both tables except the two Equipment (shop by nature) and the Avenge (combat by nature).
 *
 * NOTE ON ORDER. A set's pool order is load-bearing — shop draws are `rng.int(pool.length)` over it — so new
 * cards are APPENDED here and opted into `SETS.set3.own` in declaration order. Never insert in the middle.
 */
export const SET3_UNDEAD: CardDef[] = [
  {
    // The vanilla body with the tribe's keyword: it returns once.
    id: 'u3_poochy',
    name: 'Poochy',
    tribe: 'undead',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: ['T', 'R'],
    effects: [],
    text: '**Taunt. Rise.**',
  },
  {
    // A random friendly Undead, both phases (owner 2026-09-09) — seeded off the phase's own rng.
    id: 'u3_noggin',
    name: 'Noggin',
    tribe: 'undead',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffRandomTribe', params: { tribe: 'undead', attack: 2, health: 2 } }],
    text: '**Echo:** give a random friendly **Undead +2/+2**.',
    goldenText: '**Echo:** give a random friendly **Undead +4/+4**.',
  },
  {
    // An EQUIP Undead: Coffin Flop is a real Discover from the run's pinned pool at the tavern tier.
    id: 'u3_robinson',
    name: 'Robinson',
    tribe: 'undead',
    tier: 3,
    attack: 3,
    health: 6,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'coffin_flop' } }],
    text: '**Equip Coffin Flop (2):** Discover an **Undead** minion.',
    goldenText: '**Equip Coffin Flop (2):** Discover an **Undead** minion, twice.',
  },
  {
    // Run-wide spell power on an Echo. Combat rides `grantSpellPower` (Skullblade's carry-back); the shop half
    // is Coppercoat's arena body behind an own-death guard.
    id: 'u3_adeptus',
    name: 'Adeptus',
    tribe: 'undead',
    tier: 3,
    attack: 4,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffSpellPower', params: { attack: 1, health: 0 } }],
    text: '**Echo:** give your **Shop spells +1 Attack**.',
    goldenText: '**Echo:** give your **Shop spells +2 Attack**.',
  },
  {
    // An EQUIP Undead whose Equipment is a paid, aimed "fire this Echo and keep the body": Rise, then destroy.
    id: 'u3_ems',
    name: 'EMS',
    tribe: 'undead',
    tier: 4,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'deathfibrillator' } }],
    text: '**Equip Deathfibrillator (2):** give a target **Undead** **Rise**, then destroy it.',
  },
  {
    // Aimed Shout: Graverobber's two-step death (the Echo, the departure and any Rise get their beat), then a
    // Discover at the tavern tier. In combat: a random Undead, no destroy (see the header).
    id: 'u3_cagebreaker',
    name: 'Cage Breaker',
    tribe: 'undead',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    target: 'friendly',
    effects: [{ on: 'onPlay', do: 'battlecryDestroyForDiscover', params: { tribe: 'undead' } }],
    text: '**Shout:** destroy a friendly **Undead** to Discover an **Undead**.',
    goldenText: '**Shout:** destroy a friendly **Undead** to Discover an **Undead**, twice.',
  },
  {
    // The Rise watcher that grows itself. `onRise` is side-guarded; the riser may be Revenant.
    id: 'u3_revenant',
    name: 'Revenant',
    tribe: 'undead',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [{ on: 'onRise', do: 'onRiseBuffSelfWard', params: { attack: 7, health: 7 } }],
    text: 'After a friendly minion **Rises**, gain **Ward** and **+7/+7**.',
    goldenText: 'After a friendly minion **Rises**, gain **Ward** and **+14/+14**.',
  },
  {
    // The Rise watcher that grows everyone — board and HAND (R-HAND-02's first card). Text fixed from the
    // sheet's "a minion" to "a friendly minion" (owner 2026-09-09).
    id: 'u3_risingtide',
    name: 'Rising Tide',
    tribe: 'undead',
    tier: 5,
    attack: 8,
    health: 2,
    keywords: [],
    effects: [{ on: 'onRise', do: 'onRiseBuffBoardAndHand', params: { attack: 4, health: 5 } }],
    text: 'When a friendly minion **Rises**, give your minions on board and in hand **+4/+5**.',
    goldenText: 'When a friendly minion **Rises**, give your minions on board and in hand **+8/+10**.',
  },
  {
    // Cratering Hulk's overflow half, any tribe, permanent in both phases (combat: an Engrave-style carry-back).
    id: 'u3_squatimus',
    name: 'Squatimus',
    tribe: 'undead',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    effects: [{ on: 'summonOverflow', do: 'overflowBuffAllPermanent', params: { attack: 2, health: 2 } }],
    text: 'Whenever a summoned minion does not fit, give your minions **+2/+2** permanently.',
    goldenText: 'Whenever a summoned minion does not fit, give your minions **+4/+4** permanently.',
  },
  {
    // Summons a real Spear Warden (the set-1 card, base 3/2 + its Aura), Footman Captain's factory.
    id: 'u3_rodrick',
    name: 'Warden Rodrick',
    tribe: 'undead',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'knit' } }],
    text: '**Echo:** summon a **Spear Warden**.',
    goldenText: '**Echo:** summon **2 Spear Wardens**.',
  },
  {
    // Watcher's Lantern body behind the shared Avenge window: every 3 friendly deaths, +3 Undead Aura for the run.
    id: 'u3_hierophant',
    name: 'Soul-Lantern Hierophant',
    tribe: 'undead',
    tier: 6,
    attack: 6,
    health: 9,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeCastTribeAttack', params: { count: 3, tribe: 'undead', amount: 3, spellId: 'lanternofsouls' } }],
    text: '**Avenge (3):** cast **Lantern of Souls** — your Undead get **+3 Attack** for the rest of the run.',
    goldenText: '**Avenge (3):** cast **Lantern of Souls** twice — your Undead get **+6 Attack** for the rest of the run.',
  },
];
