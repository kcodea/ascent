import type { CardDef } from '@game/core';

/**
 * ── SET 3 — THE CELESTIALS (owner roster 2026-09-11) ────────────────────────────────────────────────────
 *
 * The SPELL tribe: every body here feeds, multiplies, copies or is fed by spells — Shop spells first, and the
 * tribe's own Star Crash (`starcrash`, a Celestial-only spell in `set3/spells.ts`). Nothing here uses Orbit or
 * Alignment: those two mechanics (the 2026-08-05 roster, archived 2026-08-28 into `cards/archive.ts`) stay
 * implemented and PARKED in `@game/rules/parked` until the owner picks them back up. The `celestial` flag
 * (the alignment HUD) is deliberately absent on every card below.
 *
 * Ids are `ce3_*` — NOT `c3_*`, which is the archived roster's prefix and is excluded from the art audit.
 * Two names are reused from that roster (Horizon Courier, Starpath Vendor); the archived defs were renamed
 * with an "(Orbit)" suffix so the two never share a display name.
 */
export const SET3_CELESTIALS: readonly CardDef[] = [
  {
    // T1: an Echo that pays a spell. Dies in the shop (Consume, a sell with a Sacrifice) or in combat — the Echo
    // grants through the same channel either way (`deathrattleGrantRandomSpell`, Sporebat's factory).
    id: 'ce3_courier',
    name: 'Horizon Courier',
    tribe: 'celestial',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantRandomSpell', params: { count: 1 } }],
    text: '**Echo:** get a random Shop spell.',
    goldenText: '**Echo:** get **2** random Shop spells.',
  },
  {
    // T2: banks +2/+2 for the NEXT Shop spell (`nextSpellBonus`), folded into spell power's read so every stat
    // spell and its hover preview show the boosted number; spent by that cast. Gifts and Rubies are not Shop
    // spells: they neither read nor spend it. Fires again → banks again (additive).
    id: 'ce3_vendor',
    name: 'Starpath Vendor',
    tribe: 'celestial',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffNextSpell', params: { attack: 2, health: 2 } }],
    text: '**Shout:** give your next Shop spell **+2/+2**.',
    goldenText: '**Shout:** give your next Shop spell **+4/+4**.',
  },
  {
    // T3 Celestial-Undead: "a spell" is ANY spell (owner 2026-09-10, Stellar Chorus: "count rubies and tower
    // shields aka any spell") — `includeRubies` opts the watcher into Ruby casts; Gifts already route through
    // `castSpell`. A permanent +4 Attack on the run card (`spellCastBuffSelf`, the dormant primitive, now used).
    id: 'ce3_seer',
    name: 'Gravestar Seer',
    tribe: 'celestial',
    tribe2: 'undead',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffSelf', params: { attack: 4, health: 0, includeRubies: true } }],
    text: 'Whenever you cast a spell, this gains **+4 Attack** permanently.',
    goldenText: 'Whenever you cast a spell, this gains **+8 Attack** permanently.',
  },
  {
    // T4 Rally: the run remembers the turn's first spell (`firstSpellThisTurnId`), combat carries it on the side
    // state, and the Rally hands a copy to hand mid-fight (`grantToHand`) — once per combat, per-instance latch.
    id: 'ce3_conductor',
    name: 'Comet Conductor',
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'rallyGrantFirstSpellCopy' }],
    text: '**Rally:** get a copy of the first spell you cast this turn. Once per combat.',
    goldenText: '**Rally:** get **2** copies of the first spell you cast this turn. Once per combat.',
  },
  {
    // T4: the tribe's Star Crash engine — one on play, one on death. Two effect entries (there is no "Shout and
    // Echo" factory): the Shout mints the real Shop spell to hand, the Echo grants it through the arena channel
    // in either phase. Golden doubles both.
    id: 'ce3_herald',
    name: 'Falling Star Herald',
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [
      { on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'starcrash' } },
      { on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'starcrash' } },
    ],
    text: '**Shout and Echo:** get a **Star Crash**.',
    goldenText: '**Shout and Echo:** get **2 Star Crashes**.',
  },
  {
    // T5: the "also casts on" family (Mirrorwing / Reflector / Runefire ruling — a FULL cast per target, scaled by
    // the cast multiplier), gated on the NAMED spell and on 2 random OTHER friendly Celestials. Once per turn
    // per copy (`namedSpreadUsedThisTurn`). Golden: 4 others.
    id: 'ce3_adept',
    name: 'Crashborn Adept',
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    effects: [{ on: 'spellCastOnThis', do: 'onSpellCastOnThisSpreadTribeNamed', params: { spellId: 'starcrash', count: 2, tribe: 'celestial' } }],
    text: 'The first time each turn you cast **Star Crash** on this, cast it on **2** other friendly Celestials.',
    goldenText: 'The first time each turn you cast **Star Crash** on this, cast it on **4** other friendly Celestials.',
  },
  {
    // T6: every 3 Shop spells cast while it is ON THE BOARD (owner 2026-09-11: hand-time casts do not count;
    // repeatable, not once per turn) — this copy's own `spellProgress` meter, shown Avenge-style as N/3 by the
    // shared step counter, never in the text. A Ruby under Rune of the Spellstone counts (booked as a Shop
    // spell); a bare Ruby does not. Buffs every friendly Celestial on the board, itself included.
    id: 'ce3_spellcore',
    name: 'Astral Spellcore',
    tribe: 'celestial',
    tier: 6,
    attack: 7,
    health: 9,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastEveryNBuffTribe', params: { every: 3, tribe: 'celestial', attack: 6, health: 6 } }],
    text: 'When you cast **3** Shop spells, give your Celestials **+6/+6**.',
    goldenText: 'When you cast **3** Shop spells, give your Celestials **+12/+12**.',
  },
  {
    // T6 Equip: Comet (4 Gold) banks 2 extra casts for the next spell — Nimbus' own charge, so it stacks with a
    // Nimbus and with Yazzus. `equipmentId` is the only place the card names it (registry: `equipment.ts`).
    id: 'ce3_artificer',
    name: 'Orrery Artificer',
    tribe: 'celestial',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'comet' } }],
    text: '**Equip Comet (4):** your next spell casts **2** additional times.',
    goldenText: '**Equip Comet (4):** your next spell casts **4** additional times.',
  },
];
