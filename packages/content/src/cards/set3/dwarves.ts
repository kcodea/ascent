import type { CardDef } from '@game/core';

/**
 * Dwarves (set 3) — the owner's set-3 Dwarf roster, 2026-09-09.
 *
 * Twenty-two cards on the sheet; FOURTEEN are set-2 Dwarves carried over unchanged (see
 * `SET2_DWARVES_IN_SET3` in `sets.ts` — shared definitions, not forks, exactly like the Kobolds). This file
 * holds the roster's EIGHT NEW cards, and only those.
 *
 * The tribe keeps its two set-2 axes — Gold SPENT and Dwarven ALES — and adds a third: **"when a Dwarf gains
 * Attack"** (Kneel, Tankerchief). The owner's rulings for that watcher (2026-09-09):
 *  - fires in BOTH phases — a Coinfire threshold in the shop and a Thane Rally in combat both count;
 *  - board only, never a Dwarf in hand;
 *  - PER DWARF: a Coinfire proc that lifts four Dwarves fires the watcher four times;
 *  - the watcher never counts its OWN gain, and a watcher's grant never re-fires other watchers (two
 *    Tankerchiefs would otherwise ping-pong forever).
 *
 * NOTE ON ORDER. A set's pool order is load-bearing — shop draws are `rng.int(pool.length)` over it — so new
 * cards are APPENDED here and opted into `SETS.set3.own` in declaration order. Never insert in the middle.
 */
export const SET3_DWARVES: CardDef[] = [
  {
    // "When you sell a minion, gain +1 Attack" — any minion, any tribe (owner 2026-09-09). Board sells only,
    // because a card in hand cannot be sold. Rides the same `minionSold` broadcast Voicekeeper watches.
    id: 'dw3_shiftbroker',
    name: 'Shift Broker',
    tribe: 'dwarf',
    tier: 1,
    attack: 1,
    health: 4,
    keywords: [],
    effects: [{ on: 'minionSold', do: 'minionSoldBuffSelf', params: { attack: 1 } }],
    text: 'When you **sell** a minion, gain **+1 Attack**.',
    goldenText: 'When you **sell** a minion, gain **+2 Attack**.',
  },
  {
    // Kringle's shape pointed at its neighbours: the same `playedThisTurn` counter (minions AND spells), any
    // tribe on either side, and Striker's own play counts if it was played this turn (owner 2026-09-09).
    id: 'dw3_striker',
    name: 'Striker',
    tribe: 'dwarf',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnBuffAdjacentPerCard', params: { attack: 1 } }],
    text: '**End of Turn:** give adjacent minions **+1 Attack** for each card you played this turn.',
    goldenText: '**End of Turn:** give adjacent minions **+2 Attack** for each card you played this turn.',
  },
  {
    // An EQUIP Dwarf: the Keg is an Equipment (`equipment.ts`), and this card is one SOURCE of it. Every Ale
    // is untargeted, so the Keg aims at nothing; the cast goes through the real Shop-spell pipeline, so
    // Edward's extra trigger and every Ale-watcher see it exactly as a hand-cast Ale.
    id: 'dw3_pourman',
    name: 'Pourman',
    tribe: 'dwarf',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'pourmans_keg' } }],
    text: "**Equip Pourman's Keg (1):** cast a random **Dwarven Ale**.",
    goldenText: "**Equip Pourman's Keg (1):** cast **2 random Dwarven Ales**.",
  },
  {
    // "Give 3 other Dwarves +1/+1" — three RANDOM other Dwarves on the BOARD (the arriving Dwarf may be one).
    // Hank never buffs himself and does not fire on his own arrival (owner 2026-09-09).
    id: 'dw3_hankpepe',
    name: 'Hank Pepe',
    tribe: 'dwarf',
    tier: 3,
    attack: 2,
    health: 7,
    keywords: [],
    effects: [{ on: 'onSummon', do: 'onTribeSummonedBuffRandomOthers', params: { tribe: 'dwarf', count: 3, attack: 1, health: 1 } }],
    text: 'When you play a **Dwarf**, give **3 other Dwarves +1/+1**.',
    goldenText: 'When you play a **Dwarf**, give **3 other Dwarves +2/+2**.',
  },
  {
    // Echo: Gold for the NEXT turn only, NOT capped at 10 (owner 2026-09-09) — it rides `bonusEmbersNextTurn`,
    // the same one-turn bank Pimm and Bounty Bot use, which sits on top of the cap by design. Every Echo
    // multiplier (Sylus, Funeral Engine, the Catacomb's first-Echo bonus…) pays it again.
    id: 'dw3_tromboneer',
    name: 'Tromboneer',
    tribe: 'dwarf',
    tier: 4,
    attack: 6,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGoldNextTurn', params: { amount: 3 } }],
    text: '**Echo:** gain **3 Gold** next turn.',
    goldenText: '**Echo:** gain **6 Gold** next turn.',
  },
  {
    // The tribe's new watcher, Health-only: a Health grant never raises Attack, so Kneel can never wake itself
    // or another watcher. See the header for the rulings.
    id: 'dw3_kneel',
    name: 'Kneel',
    tribe: 'dwarf',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'onGainAttack', do: 'onTribeGainAttackBuffSelf', params: { tribe: 'dwarf', attack: 0, health: 2 } }],
    text: 'When a **Dwarf** gains Attack, this gains **+2 Health**.',
    goldenText: 'When a **Dwarf** gains Attack, this gains **+4 Health**.',
  },
  {
    // An EQUIP Dwarf whose Equipment touches the CLOCK rather than the board: +30s on next turn's timer. The
    // seconds bank in `bonusTurnSecondsNextTurn` and move to `bonusTurnSeconds` at the turn flip, where the
    // UI's clock adds them on top of the wave's base time. Two uses stack.
    id: 'dw3_thymes',
    name: 'Thymes',
    tribe: 'dwarf',
    tier: 6,
    attack: 8,
    health: 10,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'thymepiece' } }],
    text: '**Equip Thymepiece (3):** gain **30 seconds** on your turn timer next turn.',
    goldenText: '**Equip Thymepiece (3):** gain **60 seconds** on your turn timer next turn.',
  },
  {
    // Kneel's Tier-7 sibling, and the reason the watcher has a re-entrancy guard: its grant carries +1 Attack,
    // which is itself "a Dwarf gaining Attack". Its own gain is excluded, and a watcher's grant never re-fires
    // the other watchers (owner 2026-09-09).
    id: 'dw3_tankerchief',
    name: 'Tankerchief',
    tribe: 'dwarf',
    tier: 7,
    attack: 8,
    health: 14,
    keywords: [],
    effects: [{ on: 'onGainAttack', do: 'onTribeGainAttackBuffSelf', params: { tribe: 'dwarf', attack: 1, health: 4 } }],
    text: 'When a **Dwarf** gains Attack, this gains **+1/+4**.',
    goldenText: 'When a **Dwarf** gains Attack, this gains **+2/+8**.',
  },
];
