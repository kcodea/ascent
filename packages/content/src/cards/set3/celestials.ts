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
    name: 'Cosmo Express', // 'Horizon Courier' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'celestial',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantRandomSpell', params: { count: 1 } }],
    text: '**Echo:** get a random Shop spell.',
    goldenText: '**Echo:** get **2** random Shop spells.',
  },
  {
    // T2 4/2 (owner handoff 2026-09-18; was 2/4 +2/+2): banks +4/+4 for the NEXT Shop spell (`nextSpellBonus`), a
    // run field — so it CARRIES through End Turn → combat → the next shop unspent (pinned in set3Celestials.test.ts).
    // Folded into spell power's read (`spellAttackBonus` / `spellHealthBonus`) so every Shop spell offer, hand
    // spell and hover preview prints the boosted number live, in place; spent by exactly the next Shop-spell cast.
    // Gifts and Rubies are not Shop spells: they neither read nor spend it. Fires again → banks again (additive).
    id: 'ce3_vendor',
    name: 'Sugarnova', // 'Starpath Vendor' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'celestial',
    tier: 2,
    attack: 4,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffNextSpell', params: { attack: 4, health: 4 } }],
    text: '**Shout:** give your next Shop spell **+4/+4**.',
    goldenText: '**Shout:** give your next Shop spell **+8/+8**.',
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
    attack: 0,
    health: 8,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffSelf', params: { attack: 4, health: 0, includeRubies: true } }],
    text: 'Whenever you cast a spell, this gains **+4 Attack** permanently.',
    goldenText: 'Whenever you cast a spell, this gains **+8 Attack** permanently.',
  },
  {
    // T4 Rally: the run remembers the turn's first Shop spell (`firstSpellThisTurnId`), combat carries it on the
    // side state, and the Rally hands a copy to hand mid-fight (`grantToHand`) — EVERY attack (owner rework
    // 2026-09-18 dropped the once-per-combat latch from the sentence, so the latch went with it).
    id: 'ce3_conductor',
    name: 'Neptus', // 'Comet Conductor' until 2026-09-12 (owner rename; id + art unchanged)
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'rallyGrantFirstSpellCopy' }],
    text: '**Rally:** get a copy of the first **Shop spell** you cast this turn.',
    goldenText: '**Rally:** get **2** copies of the first **Shop spell** you cast this turn.',
  },
  {
    // T4: the tribe's Star Crash engine — one on play, one on death. Two effect entries (there is no "Shout and
    // Echo" factory): the Shout mints the real Shop spell to hand, the Echo grants it through the arena channel
    // in either phase. Golden doubles both.
    id: 'ce3_herald',
    name: 'Plummet', // 'Falling Star Herald' until 2026-09-14 (owner rename handoff; id + art unchanged)
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
    // T5 (owner handoff 2026-09-18: "functions similar to Mirrorwing but specific to Star Crash"): the first Star
    // Crash cast on this each turn casts AGAIN on this — a FULL re-cast scaled by the cast multiplier (the
    // Mirrorwing ruling 2026-09-01), gated on the NAMED spell, once per turn per copy (`namedSpreadUsedThisTurn`,
    // so a Tower Shield first does not spend it). Golden: 2 additional casts. (Was: spread to 2 other Celestials.)
    id: 'ce3_adept',
    name: 'Crash Course', // 'Crashborn Adept' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    effects: [{ on: 'spellCastOnThis', do: 'onSpellCastOnThisRecastNamed', params: { spellId: 'starcrash', count: 1 } }],
    text: 'The first **Star Crash** you cast on this each turn casts an additional time.',
    goldenText: 'The first **Star Crash** you cast on this each turn casts **2** additional times.',
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
    name: 'Cometius', // 'Orrery Artificer' until 2026-09-12 (owner rename; id + art unchanged)
    tribe: 'celestial',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'comet' } }],
    text: '**Equip Comet (3):** your next spell casts **2** additional times.',
    goldenText: '**Equip Comet (3):** your next spell casts **4** additional times.',
  },
  {
    // THE STARFORM (owner design 2026-09-12) — a 1/1 Celestial TOKEN that lives IN THE SHOP as a shop offer, not
    // on the board: created into the right-most Shop slot, only one at a time, it survives every refresh in its
    // own slot and grows from every shop buff + consume until it is bought (your LEFT-MOST Celestial consumes it
    // for 100% of its stats — rules v2 2026-09-13) or collapsed (50% to 3 unique Celestials + extras, owner 2026-09-18). It spawns
    // at 6 Gold and every refresh knocks 1 off (`ShopCard.cost`); its printed stats ARE the counter, so it carries
    // no rules text (owner: "printed stats are the live counter"); the engine that moves it is
    // `packages/sim/src/starform.ts`. `token: true` keeps it out of every draw pool — a card CREATES it (Star Seed
    // & co.), the shop never rolls it. While it exists the player holds the Star Destroyer Equipment (a 0-Gold
    // silent removal, `equipment.ts`).
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
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryCreateStarformOrBuff', params: { attack: 4, health: 4 } }], // +2/+2 until 2026-09-14
    text: '**Shout:** create a **Starform**. If you already have one, give it **+4/+4**.',
    goldenText: '**Shout:** create a **Starform**. If you already have one, give it **+8/+8**.',
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
    // T2 2/5 (owner handoff 2026-09-18; was an `onBuy` watcher): a GOLD-SPENT meter — every 5 Gold spent while it
    // stands (`goldTick`, the Coinfire Forewoman / Billings shape: the remainder carries, one big spend can cross
    // it twice) creates the token when there is none, otherwise +3/+3. The step counter shows N/5 (the shared
    // tracker rule, owner 2026-09-11). Gilded: +6/+6 (the create has no number to double).
    id: 'ce3_peddler',
    name: 'Stardust Peddler',
    tribe: 'celestial',
    tier: 2,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentCreateStarformOrBuff', params: { every: 5, attack: 3, health: 3 } }],
    text: 'When you spend **5 Gold**, create a **Starform**, or give it **+3/+3**.',
    goldenText: 'When you spend **5 Gold**, create a **Starform**, or give it **+6/+6**.',
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
    // 2026-09-14 (owner): a plain adjacent buff (was Shout + Echo "this shop +2/+2").
    effects: [{ on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 3, health: 4 } }],
    text: '**Shout:** give adjacent minions **+3/+4**.',
    goldenText: '**Shout:** give adjacent minions **+6/+8**.',
  },
  {
    // T3: the Starform eats the highest-Tier Shop minion (ties → the right-most; no Starform → nothing; the token
    // never eats itself). Gilded: the Starform gains DOUBLE the meal's stats (`times` 2 — Cinder Clerk's rider).
    id: 'ce3_accretionwarden',
    name: 'The Great Attractor', // 'Accretion Warden' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'celestial',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    // 2026-09-14 (owner): buff THIS shop first, then the token eats the highest-HEALTH offer (so the meal carries the
    // buff). "Buff the shop" in the handoff read as the current offers, not the permanent Staff-of-Guel channel.
    effects: [
      { on: 'onPlay', do: 'buffThisShop', params: { attack: 4, health: 3 } },
      { on: 'onPlay', do: 'battlecryStarformConsumeShop', params: { pick: 'highestHealth' } },
    ],
    text: '**Shout:** give **this shop +4/+3**. Your **Starform** consumes the highest-Health minion.',
    goldenText: '**Shout:** give **this shop +8/+6**. Your **Starform** consumes the highest-Health minion and gains **double** its stats.',
  },
  {
    // T3 Flurry: "this shop" +3/+3 per Shop spell cast this turn (`spellsThisTurn`, the Spirit Worgen read — a
    // multiplied cast counts each time, as it does for every spells-this-turn scaler). LIVE TEXT prints the
    // current total (`shootingStarText`) on both chains. Gilded: +6/+6 per spell.
    id: 'ce3_shootingstar',
    name: 'Rocket Power', // 'Shooting Star' until 2026-09-14 (owner rename; id + art unchanged); Flurry dropped the same day
    tribe: 'celestial',
    tier: 3,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffThisShopPerSpellsThisTurn', params: { attack: 3, health: 3 } }],
    // 2026-09-14 (owner): a BASE +3/+3 that repeats per spell — (1 + spells) × 3, so it always does something.
    text: '**Shout:** give **this shop +3/+3**. Repeat for every Shop spell you cast this turn.',
    goldenText: '**Shout:** give **this shop +6/+6**. Repeat for every Shop spell you cast this turn.',
  },
  {
    // T3 Avenge (3): a Star Crash to hand mid-fight (`avengeGrantSpell`, Arcane Weaver's shape — rides
    // `ctx.grantToHand`, per-instance window under the R-AVWIN rulings). Gilded: 2 per proc.
    id: 'ce3_eclipsewarden',
    name: 'Totality', // 'Eclipse Warden' until 2026-09-14 (owner rename handoff; id + art unchanged)
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
    // T5 (owner handoff 2026-09-18; was "EoT: the token eats the row / SoT: create one"): End of Turn CREATES the
    // token when none is out (rule 1 — a full row eats its right-most minion) and gives it +10/+10 — with one
    // already out the create is the no-op it always is (rule 2) and the +10/+10 lands on it. Gilded: +20/+20.
    id: 'ce3_orbitkeeper',
    name: 'Roundabout', // 'Orbit Keeper' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'celestial',
    tier: 5,
    attack: 7,
    health: 5,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCreateStarformThenBuff', params: { attack: 10, health: 10 } }],
    text: '**End of Turn:** create a **Starform** and give it **+10/+10**.',
    goldenText: '**End of Turn:** create a **Starform** and give it **+20/+20**.',
  },
  {
    // T4 (rules v2 2026-09-13; 3 hits since 2026-09-18): COLLAPSE — the token leaves; 3 UNIQUE random friendly Celestials each gain HALF its
    // stats (rounded up, base included, rule 7), plus the extras Nova Herald adds (with replacement). One Celestial
    // → it takes the one original + every extra; a Starform but NO Celestial → the token still collapses and the
    // stats go nowhere; no Starform → nothing happens. The Devotee itself is eligible. Gilded: each hit gains its
    // FULL stats (double the half). (Its old Shout — Consume for 100% — is now the token's BUY.)
    id: 'ce3_coronadevotee',
    name: 'Solburn', // 'Corona Devotee' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryCollapseStarform' }],
    text: '**Shout:** Collapse your **Starform**.',
    goldenText: '**Shout:** Collapse your **Starform** — each gains its **full** stats.',
  },
  {
    // T4: Discover a Celestial (Sea Urchin's factory: never itself via `exclude`; the Starform is a token and sits
    // outside every draw pool, so it is never offered). Gilded: Discover twice.
    id: 'ce3_starcharter',
    name: 'Maestro Lux', // 'Star Charter' until 2026-09-14 (owner rename handoff; id + art unchanged)
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
    // T5 Equip: Stellar Lens (2 Gold) — "this shop" +10/+10 (`equipmentBuffThisShop`, Wishing Star's shape read from
    // params only; a gilded Grinder's Lens gives +20/+20 via `gildedParams`). Registry: `equipment.ts`.
    id: 'ce3_lensgrinder',
    name: 'Lens Grinder',
    tribe: 'celestial',
    tier: 4, // T5 5/6 until 2026-09-14 (owner)
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'stellar_lens' } }],
    text: '**Equip Stellar Lens (2):** create a **Starform**, then give **this shop +7/+7**.',
    goldenText: '**Equip Stellar Lens (2):** create a **Starform**, then give **this shop +14/+14**.',
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
    health: 5,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGiveMaxStatsRandomTribe', params: { tribe: 'celestial' } }],
    text: "**Echo:** give a friendly Celestial this minion's stats.",
    goldenText: "**Echo:** give a friendly Celestial this minion's stats.",
  },
  {
    // T6: the `starformGained` watcher — mirrors every gain the token takes (a buff, a shop buff, its consumes, a
    // Star Crash aimed at it, a slot enchant on a roll). Gilded: gains double the mirrored amount.
    id: 'ce3_twinstar',
    name: 'Twinning', // 'Twin Star' until 2026-09-14 (owner rename; id + art unchanged)
    tribe: 'celestial',
    tier: 5, // T6 until 2026-09-14 (owner)
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'starformGained', do: 'onStarformGainedBuffSelf' }],
    text: 'Whenever your **Starform** gains stats, this does, too.',
    goldenText: 'Whenever your **Starform** gains stats, this gains **double**.',
  },
  {
    // T6 (rules v2 2026-09-13): a PASSIVE — while on board, every Collapse (Corona Devotee's Shout) hits 2 EXTRA
    // random friendly Celestials, drawn WITH replacement (an extra may land on a Celestial that already took a
    // hit — with two Celestials one can take 3 and the other 1). Two Heralds → 4 extras; gilded → 4 each. Read off
    // the card at collapse time (`collapseExtraTargetsOf`, the Constellation Prime id-read shape) — never
    // dispatched. The text prints the static "2" (owner: "table for now" — no live total).
    id: 'ce3_novaherald',
    name: 'Fuse Aldrin', // 'Nova Herald' until 2026-09-14 (owner rename handoff; id + art unchanged)
    tribe: 'celestial',
    tier: 6,
    attack: 6,
    health: 9,
    keywords: [],
    effects: [{ on: 'passive', do: 'collapseExtraTargets', params: { extra: 2 } }],
    text: 'When you Collapse a **Starform**, it buffs **2** additional random Celestials.',
    goldenText: 'When you Collapse a **Starform**, it buffs **4** additional random Celestials.',
  },
  {
    // T7: a spell of ANY kind (Gravestar Seer's ruling — `includeRubies`) feeds the token +3/+3; when the token is
    // Consumed (the buy into your left-most Celestial, a Demon eating it) or Collapses (Corona Devotee, Herald-
    // assisted or not), a new one is created carrying HALF its stats above the base 1/1, rounded up, at the fresh
    // 6-Gold price (a full row eats its right-most minion as usual). NOT after the Star Destroyer's silent exit.
    // Gilded: +6/+6 per spell, and the new token carries the FULL stats.
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
