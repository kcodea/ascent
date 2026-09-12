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
  {
    // THE STARFORM (owner design 2026-09-12) — a 1/1 Celestial TOKEN that lives IN THE SHOP as a shop offer, not
    // on the board: created into the right-most Shop slot, only one at a time, it survives every refresh in its
    // own slot and grows from every shop buff + consume until a Celestial consumes it (100% of its stats to one
    // body) or collapses it (50% to three). Its printed stats ARE the counter, so it carries no rules text
    // (owner: "printed stats are the live counter"); the engine that moves it is `packages/sim/src/starform.ts`.
    // `token: true` keeps it out of every draw pool — a card CREATES it (Star Seed & co., the content PR), the
    // shop never rolls it. Buying it costs 0 and DISMISSES it (nothing enters the hand).
    id: 'ce3_starform',
    name: 'Starform',
    tribe: 'celestial',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    token: true,
    text: '',
  },
  // ── THE STARFORM ROSTER (owner spec 2026-09-12) — the sixteen bodies that create, feed and cash in the token.
  // Gilded doubles the printed numbers unless a comment says otherwise. Every gain the Starform takes here rides
  // `buffStarform` (Twin Star hears it); every removal rides `consumeStarform` / `collapseStarform` (Zenith hears it).
  {
    // T1: creates the token (right-most slot, eating the right-most minion when the row is full); with one already
    // out, gives it +2/+2 instead. Gilded: +4/+4 instead (the create itself has no number to double).
    id: 'ce3_starseed',
    name: 'Star Seed',
    tribe: 'celestial',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryCreateStarformOrBuff', params: { attack: 2, health: 2 } }],
    text: '**Shout:** create a **Starform** in the Shop. If you already have one, give it **+2/+2** instead.',
    goldenText: '**Shout:** create a **Starform** in the Shop. If you already have one, give it **+4/+4** instead.',
  },
  {
    // T1 Taunt: Noggin's Echo shape (`deathrattleBuffRandomTribe`, one arena body for both phases) aimed at a
    // random OTHER friendly Celestial. Gilded: +4/+2.
    id: 'ce3_dawnsentinel',
    name: 'Dawn Sentinel',
    tribe: 'celestial',
    tier: 1,
    attack: 1,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffRandomTribe', params: { tribe: 'celestial', attack: 2, health: 1 } }],
    text: '**Taunt.** **Echo:** give a random friendly Celestial **+2/+1**.',
    goldenText: '**Taunt.** **Echo:** give a random friendly Celestial **+4/+2**.',
  },
  {
    // T2: an `onBuy` watcher. The Starform's own 0-Gold dismiss buy COUNTS as a buy (rule 5) but the token is
    // gone by the time the watchers hear it — a no-op by construction. Gilded: +2/+2 per buy.
    id: 'ce3_peddler',
    name: 'Stardust Peddler',
    tribe: 'celestial',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'onBuy', do: 'onBuyBuffStarform', params: { attack: 1, health: 1 } }],
    text: 'Whenever you buy a minion, give your **Starform +1/+1**.',
    goldenText: 'Whenever you buy a minion, give your **Starform +2/+2**.',
  },
  {
    // T2 Shout AND Echo, one factory on two triggers: "this shop" = the offers standing in the row right now
    // (Apples' branch, owner vocabulary 2026-07-25) — baked per offer, so the Starform KEEPS it through the next
    // refresh and every other offer loses it. The Echo half fires in the shop only (a combat death has no shop
    // to buff — PHASE_EXCUSED `no-surface`). Gilded: +4/+4 each half.
    id: 'ce3_wishingstar',
    name: 'Wishing Star',
    tribe: 'celestial',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [
      { on: 'onPlay', do: 'buffThisShop', params: { attack: 2, health: 2 } },
      { on: 'onDeath', do: 'buffThisShop', params: { attack: 2, health: 2 } },
    ],
    text: '**Shout:** give **this shop +2/+2**. **Echo:** give **this shop +2/+2**.',
    goldenText: '**Shout:** give **this shop +4/+4**. **Echo:** give **this shop +4/+4**.',
  },
  {
    // T3: the Starform eats the highest-Tier Shop minion (ties → the right-most; no Starform → nothing; the token
    // never eats itself). Gilded: the Starform gains DOUBLE the meal's stats (`times` 2 — Cinder Clerk's rider).
    id: 'ce3_accretionwarden',
    name: 'Accretion Warden',
    tribe: 'celestial',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryStarformConsumeShop', params: { pick: 'highestTier' } }],
    text: '**Shout:** your **Starform** consumes the highest-Tier minion in the Shop.',
    goldenText: '**Shout:** your **Starform** consumes the highest-Tier minion in the Shop and gains **double** its stats.',
  },
  {
    // T3 Flurry: "this shop" +3/+3 per Shop spell cast this turn (`spellsThisTurn`, the Spirit Worgen read — a
    // multiplied cast counts each time, as it does for every spells-this-turn scaler). LIVE TEXT prints the
    // current total (`shootingStarText`) on both chains. Gilded: +6/+6 per spell.
    id: 'ce3_shootingstar',
    name: 'Shooting Star',
    tribe: 'celestial',
    tier: 3,
    attack: 3,
    health: 2,
    keywords: ['W'],
    effects: [{ on: 'onPlay', do: 'battlecryBuffThisShopPerSpellsThisTurn', params: { attack: 3, health: 3 } }],
    text: '**Flurry.** **Shout:** give **this shop +3/+3** for each Shop spell you cast this turn.',
    goldenText: '**Flurry.** **Shout:** give **this shop +6/+6** for each Shop spell you cast this turn.',
  },
  {
    // T3 Avenge (3): a Star Crash to hand mid-fight (`avengeGrantSpell`, Arcane Weaver's shape — rides
    // `ctx.grantToHand`, per-instance window under the R-AVWIN rulings). Gilded: 2 per proc.
    id: 'ce3_eclipsewarden',
    name: 'Eclipse Warden',
    tribe: 'celestial',
    tier: 3,
    attack: 3,
    health: 6,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGrantSpell', params: { count: 3, cardId: 'starcrash' } }],
    text: '**Avenge (3):** get a **Star Crash**.',
    goldenText: '**Avenge (3):** get **2 Star Crashes**.',
  },
  {
    // T4: End of Turn feeds the token (+2/+2; nothing without one); Start of Turn re-creates it when none is out
    // (a full row eats its right-most minion, rule 1). Gilded: End of Turn +4/+4 (the create has no number).
    id: 'ce3_orbitkeeper',
    name: 'Orbit Keeper',
    tribe: 'celestial',
    tier: 4,
    attack: 3,
    health: 6,
    keywords: [],
    effects: [
      { on: 'endOfTurn', do: 'endOfTurnBuffStarform', params: { attack: 2, health: 2 } },
      { on: 'startOfTurn', do: 'startOfTurnCreateStarform' },
    ],
    text: '**End of Turn:** give your **Starform +2/+2**. **Start of Turn:** if you have no Starform, create one.',
    goldenText: '**End of Turn:** give your **Starform +4/+4**. **Start of Turn:** if you have no Starform, create one.',
  },
  {
    // T4: CONSUME — the token leaves and this gains 100% of its stats (base 1/1 included, rule 7). No Starform →
    // nothing. Gilded: gains DOUBLE its stats (`times` 2).
    id: 'ce3_coronadevotee',
    name: 'Corona Devotee',
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryConsumeStarform' }],
    text: '**Shout:** Consume your **Starform** — this gains all of its stats.',
    goldenText: '**Shout:** Consume your **Starform** — this gains **double** its stats.',
  },
  {
    // T4: Discover a Celestial (Sea Urchin's factory: never itself via `exclude`; the Starform is a token and sits
    // outside every draw pool, so it is never offered). Gilded: Discover twice.
    id: 'ce3_starcharter',
    name: 'Star Charter',
    tribe: 'celestial',
    tier: 4,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion', params: { tribe: 'celestial' } }],
    text: '**Shout:** **Discover** a Celestial.',
    goldenText: '**Shout:** **Discover** a Celestial twice.',
  },
  {
    // T5 Equip: Stellar Lens (2 Gold) — "this shop" +10/+10 (the Wishing Star factory, params carrying the
    // gilding: a gilded Grinder's Lens gives +20/+20 via `gildedParams`). Registry: `equipment.ts`.
    id: 'ce3_lensgrinder',
    name: 'Lens Grinder',
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'stellar_lens' } }],
    text: '**Equip Stellar Lens (2):** give **this shop +10/+10**.',
    goldenText: '**Equip Stellar Lens (2):** give **this shop +20/+20**.',
  },
  {
    // T5 Echo, both phases (one arena body): a random OTHER friendly Celestial gains this minion's MAX stats —
    // its current Attack and its undamaged max Health (owner: a 10/10 damaged to 10/5 then buffed +5/+5 hands
    // over 15/15). "This minion's stats" is the by-name live reference; a gilded body's doubled stats ARE its
    // stats, so the gilded text is the same line.
    id: 'ce3_lodestar',
    name: 'Lodestar',
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 9,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGiveMaxStatsRandomTribe', params: { tribe: 'celestial' } }],
    text: "**Echo:** give a friendly Celestial this minion's stats.",
    goldenText: "**Echo:** give a friendly Celestial this minion's stats.",
  },
  {
    // T6: the `starformGained` watcher — mirrors every gain the token takes (a buff, a shop buff, its consumes, a
    // Star Crash aimed at it, a slot enchant on a roll). Gilded: gains double the mirrored amount.
    id: 'ce3_twinstar',
    name: 'Twin Star',
    tribe: 'celestial',
    tier: 6,
    attack: 6,
    health: 8,
    keywords: [],
    effects: [{ on: 'starformGained', do: 'onStarformGainedBuffSelf' }],
    text: 'Whenever your **Starform** gains stats, this gains the same.',
    goldenText: 'Whenever your **Starform** gains stats, this gains **double**.',
  },
  {
    // T6: COLLAPSE — the token leaves; 3 random friendly Celestials each gain HALF its stats (rounded up, base
    // included, rule 7). Fewer than 3 Celestials → each present one gets it; a Starform but NO Celestial → the
    // token still collapses and the stats go nowhere; no Starform → nothing happens (owner 2026-09-12).
    // Gilded: each of the 3 gains its FULL stats (double the half).
    id: 'ce3_novaherald',
    name: 'Nova Herald',
    tribe: 'celestial',
    tier: 6,
    attack: 6,
    health: 9,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryCollapseStarform', params: { count: 3 } }],
    text: '**Shout:** Collapse your **Starform** — **3** random friendly Celestials each gain half its stats.',
    goldenText: '**Shout:** Collapse your **Starform** — **3** random friendly Celestials each gain **all** its stats.',
  },
  {
    // T7: a spell of ANY kind (Gravestar Seer's ruling — `includeRubies`) feeds the token +3/+3; when the token is
    // Consumed or Collapses (NOT dismissed — the `starformRemoved` reason), a new one is created carrying HALF its
    // stats above the base 1/1, rounded up (a full row eats its right-most minion as usual). Gilded: +6/+6 per
    // spell, and the new token carries the FULL stats.
    id: 'ce3_zenith',
    name: 'Zenith',
    tribe: 'celestial',
    tier: 7,
    attack: 8,
    health: 12,
    keywords: [],
    effects: [
      { on: 'spellCast', do: 'spellCastBuffStarform', params: { attack: 3, health: 3, includeRubies: true } },
      { on: 'starformRemoved', do: 'onStarformRemovedRecreateHalf' },
    ],
    text: 'Whenever you cast a spell, give your **Starform +3/+3**. When your Starform Collapses or is Consumed, create a new one with half its stats.',
    goldenText: 'Whenever you cast a spell, give your **Starform +6/+6**. When your Starform Collapses or is Consumed, create a new one with **all** its stats.',
  },
  {
    // T7: the passive is read by Star Crash's own factory (`primeExtraPrimaryLands`, the Yazzus id-read shape):
    // every Star Crash's PRIMARY +5/+7 lands one extra time on the chosen Celestial; the secondary random-friendly
    // half still fires once per cast (owner 2026-09-12). Stacks with Comet / Nimbus per cast: every multiplied
    // cast re-lands the primary too. Gilded: the primary lands 2 extra times, and the Shout mints 4.
    id: 'ce3_constellationprime',
    name: 'Constellation Prime',
    tribe: 'celestial',
    tier: 7,
    attack: 9,
    health: 9,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'starcrash', count: 2 } }],
    text: 'Your **Star Crashes** cast an additional time. **Shout:** get **2 Star Crashes**.',
    goldenText: 'Your **Star Crashes** cast **2** additional times. **Shout:** get **4 Star Crashes**.',
  },
];
