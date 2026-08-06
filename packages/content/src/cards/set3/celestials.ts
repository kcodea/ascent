import type { CardDef } from '@game/core';

/**
 * ── SET 3 — THE CELESTIALS (owner roster 2026-08-05) ────────────────────────────────────────────────────
 *
 * A real tribe now (`tribe: 'celestial'`), replacing the seven test units that proved the mechanics on
 * 2026-08-03 — those moved to the MINION ARCHIVE rather than being deleted, so any saved run or captured
 * board still resolves them.
 *
 * Two mechanics carry the whole tribe:
 *
 *  • **ALIGNMENT** — the board splits around its centre: **Dawn** left, **Dusk** right, **Eclipse** the exact
 *    middle body, which counts as BOTH. Derived from board SIZE, so it re-centres as minions come and go (a
 *    lone minion is Eclipsed; an EVEN board has no Eclipse). It moves freely in the shop and LOCKS at combat.
 *    The `align` field on an EFFECT is the entire mechanism: `align: 'dawn'` fires for a Dawn *or Eclipse*
 *    body, `align: 'dusk'` for Dusk *or Eclipse*. Eclipse getting both halves falls out of that rule — which
 *    is why a two-halves card is simply two effect entries, and why none of these needs a special case.
 *
 *  • **ORBIT** — fires when a card is PLAYED FROM HAND into a slot adjacent to this minion. Written
 *    **Orbit (N)** when it pays out only every Nth arrival (`params.every`, a per-instance tick — the same
 *    cadence shape as Avenge (N)). A separate `orbitFired` trigger is the BOARD-WIDE watcher, "whenever an
 *    Orbit triggers" anywhere, with `params.others` excluding your own.
 *
 * Positioning is therefore the tribe's real cost: alignment is decided by where a body sits, and an Orbit
 * only pays the two neighbours of the slot you drop into.
 */
export const SET3_CELESTIALS: readonly CardDef[] = [
  {
    // T1 opener: a Shout that pays either way, so the tribe has a turn-1 body whose value doesn't depend on
    // having built anything yet. Which half you get is the first alignment decision a player ever makes.
    id: 'c3_courier',
    name: 'Horizon Courier',
    tribe: 'celestial',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 1, count: 1 }, align: 'dawn' },
      { on: 'onPlay', do: 'battlecryGrantRandomSpell', params: { count: 1 }, align: 'dusk' },
    ],
    text: '**Shout — Dawn:** get a random Tier 1 minion. **Dusk:** get a random Shop spell.',
    goldenText: '**Shout — Dawn:** get **2** random Tier 1 minions. **Dusk:** get **2** random Shop spells.',
  },
  {
    // The tribe's Orbit primer: a 3/1 that turns every later play into board value. It buffs a RANDOM friend
    // rather than the arriver, so it rewards a wide board instead of the one card you just dropped.
    id: 'c3_familiar',
    name: 'Orbiting Familiar',
    tribe: 'celestial',
    tier: 1,
    attack: 3,
    health: 1,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffRandomFriend', params: { attack: 2 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffRandomFriend', params: { health: 2 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** give a random friendly minion **+2 Attack**. **Dusk:** give one **+2 Health**.',
    goldenText: '**Orbit — Dawn:** give a random friendly minion **+4 Attack**. **Dusk:** give one **+4 Health**.',
  },
  {
    // Economy Orbit. The Dawn half compounds on the Vendor itself (capped, so it can't run away); the Dusk
    // half pays forward into the Shop — the two halves are "save" and "spend".
    id: 'c3_vendor',
    name: 'Starpath Vendor',
    tribe: 'celestial',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitSellValue', params: { amount: 1, cap: 3 }, align: 'dawn' },
      { on: 'orbit', do: 'buffShopPermanent', params: { attack: 1, health: 1 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** gain **+1 sell value**, up to **+3**. **Dusk:** give minions in the current Shop **+1/+1**.',
    goldenText: '**Orbit — Dawn:** gain **+2 sell value**, up to **+3**. **Dusk:** give minions in the current Shop **+2/+2**.',
  },
  {
    // A combat-facing Celestial: the same body is an aggressive Flurry in Dawn or a durable Ward in Dusk, so
    // where you seat it is a read on the fight you expect.
    id: 'c3_twilight',
    name: 'Twilight Sentinel',
    tribe: 'celestial',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'startOfCombat', do: 'scGainKeyword', params: { keyword: 'W' }, align: 'dawn' },
      { on: 'startOfCombat', do: 'scGainKeyword', params: { keyword: 'DS' }, align: 'dusk' },
    ],
    text: '**Start of Combat — Dawn:** gain **Flurry**. **Dusk:** gain **Ward**.',
  },
  {
    // Orbit (4): a slow, permanent spell-power engine. The cadence is what keeps a run-wide buff honest.
    id: 'c3_cartographer',
    name: 'Star Cartographer',
    tribe: 'celestial',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitGrantSpellPower', params: { every: 4, attack: 1 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitGrantSpellPower', params: { every: 4, health: 1 }, align: 'dusk' },
    ],
    text: '**Orbit (4) — Dawn:** improve your **Shop spells** by **+1 Attack**. **Dusk:** improve them by **+1 Health**.',
    goldenText: '**Orbit (4) — Dawn:** improve your **Shop spells** by **+2 Attack**. **Dusk:** improve them by **+2 Health**.',
  },
  {
    // The payoff for committing to one half of the sky — and the card that makes Eclipse feel best, since an
    // Eclipsed Tender pays BOTH sides at once.
    id: 'c3_tender',
    name: 'Constellation Tender',
    tribe: 'celestial',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffAlignedCelestials', params: { side: 'dawn', attack: 2 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffAlignedCelestials', params: { side: 'dusk', health: 2 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** give your **Dawn Celestials +2 Attack**. **Dusk:** give your **Dusk Celestials +2 Health**.',
    goldenText: '**Orbit — Dawn:** give your **Dawn Celestials +4 Attack**. **Dusk:** give your **Dusk Celestials +4 Health**.',
  },
  {
    // A board-wide Orbit WATCHER, not an Orbit itself: it counts everyone's Orbits, so it rewards a tribe
    // board rather than its own adjacency.
    id: 'c3_shopkeeper',
    name: 'Astral Shopkeeper',
    tribe: 'celestial',
    tier: 3,
    attack: 2,
    health: 6,
    keywords: [],
    celestial: true,
    effects: [{ on: 'orbitFired', do: 'onOrbitBuffShopRightmost', params: { every: 3, attack: 3, health: 3 } }],
    text: 'After **3** of your **Orbits** trigger, give the **right-most** minion in the current Shop **+3/+3**.',
    goldenText: 'After **3** of your **Orbits** trigger, give the **right-most** minion in the current Shop **+6/+6**.',
  },
  {
    // Orbit (3) casting a REAL spell — it counts for every per-spell watcher the run has, and Sprout opens
    // its Discover exactly as a hand-cast would.
    id: 'c3_gardener',
    name: 'Worldseed Gardener',
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitCastSpell', params: { every: 3, spellId: 'sprout' }, align: 'dawn' },
      { on: 'orbit', do: 'orbitCastSpell', params: { every: 3, spellId: 'growth' }, align: 'dusk' },
    ],
    text: '**Orbit (3) — Dawn:** cast **Sprout**. **Dusk:** cast **Growth**.',
    goldenText: '**Orbit (3) — Dawn:** cast **Sprout** twice. **Dusk:** cast **Growth** twice.',
  },
  {
    // Catch-up statting: it always feeds whatever is furthest behind, which keeps a wide board viable rather
    // than forcing everything into one carry.
    id: 'c3_channeler',
    name: 'Equinox Channeler',
    tribe: 'celestial',
    tier: 4,
    attack: 3,
    health: 8,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffLowest', params: { stat: 'attack', amount: 4 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffLowest', params: { stat: 'health', amount: 4 }, align: 'dusk' },
    ],
    text: '**Orbit — Dawn:** give your **lowest-Attack** minion **+4 Attack**. **Dusk:** give your **lowest-Health** minion **+4 Health**.',
    goldenText: '**Orbit — Dawn:** give your **lowest-Attack** minion **+8 Attack**. **Dusk:** give your **lowest-Health** minion **+8 Health**.',
  },
  {
    // A pure positional multiplier — no Orbit of its own, it just makes its NEIGHBOURS' Orbits pay twice.
    // Seating it between two Orbits is the whole card.
    id: 'c3_binary',
    name: 'Binary Star',
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    celestial: true,
    orbitExtraAdjacent: true,
    effects: [],
    text: '**Adjacent Orbit** effects trigger an **additional time**.',
  },
  {
    // The board-wide payoff: at this tier every arrival should move the whole line, not one body.
    id: 'c3_weaver',
    name: 'Worldline Weaver',
    tribe: 'celestial',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbitFired', do: 'onOrbitBuffAll', params: { attack: 2 }, align: 'dawn' },
      { on: 'orbitFired', do: 'onOrbitBuffAll', params: { health: 2 }, align: 'dusk' },
    ],
    text: 'Whenever an **Orbit** triggers, **Dawn:** give all friendly minions **+2 Attack**. **Dusk:** give them **+2 Health**.',
    goldenText: 'Whenever an **Orbit** triggers, **Dawn:** give all friendly minions **+4 Attack**. **Dusk:** give them **+4 Health**.',
  },
  {
    // The tribe's stat sink: it copies what a bought minion already carries, so it rewards buying INTO your
    // investment — a heavily bought-up minion pays the Collector the most. It COPIES; it never steals.
    id: 'c3_collector',
    name: 'Horizon Collector',
    tribe: 'celestial',
    tier: 6,
    attack: 5,
    health: 12,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitGainArriverBonus', params: { side: 'dawn' }, align: 'dawn' },
      { on: 'orbit', do: 'orbitGainArriverBonus', params: { side: 'dusk' }, align: 'dusk' },
    ],
    text: "**Orbit:** gain the played minion's **bonus stats**. **Dawn:** also give its **Attack** to your left-most other Celestial. **Dusk:** also give its **Health** to your right-most other Celestial.",
  },
  {
    // The tribe's own Orbit BUTTON: everything else waits for you to play a card next to it, the Relay makes
    // the arrival optional. Its two halves are two different clocks — Dawn pays the moment it lands, Dusk pays
    // every turn it survives — so where you seat it decides whether it is burst or engine.
    id: 'c3_relay',
    name: 'Astral Relay',
    tribe: 'celestial',
    tier: 4,
    attack: 5,
    health: 6,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'onPlay', do: 'triggerAdjacentOrbits', align: 'dawn' },
      { on: 'endOfTurn', do: 'triggerAdjacentOrbits', align: 'dusk' },
    ],
    text: '**Shout — Dawn:** trigger adjacent **Orbits**. **End of Turn — Dusk:** trigger adjacent **Orbits**.',
    goldenText: '**Shout — Dawn:** trigger adjacent **Orbits** twice. **End of Turn — Dusk:** trigger adjacent **Orbits** twice.',
  },
  {
    // Pays for INVESTMENT rather than for tempo: an unbuffed body is worth nothing to the Crucible, a minion
    // you have poured three Rubies into is worth three. That makes it the tribe's reason to hold a card back
    // and fatten it in the shop before dropping it next door.
    id: 'c3_crucible',
    name: 'Celestial Crucible',
    tribe: 'celestial',
    tier: 4,
    attack: 4,
    health: 7,
    keywords: [],
    celestial: true,
    effects: [{ on: 'orbit', do: 'orbitBuffCelestialsPerBuffStack', params: { attack: 1, health: 1 } }],
    text: 'Orbit: give your **Celestials +1/+1** for each stack of **Shop buffs** on the played minion.',
    goldenText: 'Orbit: give your **Celestials +2/+2** for each stack of **Shop buffs** on the played minion.',
  },
  {
    // The tribe's sacrifice outlet: it eats what you drop next to it and hands the investment on. Because the
    // devoured body's Echo FIRES (owner ruling 2026-08-06), the Broker is a deliberate Deathrattle enabler —
    // feed it something whose death you WANTED, and you collect twice.
    id: 'c3_broker',
    name: 'Constellation Broker',
    tribe: 'celestial',
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    celestial: true,
    effects: [{ on: 'orbit', do: 'orbitDevourArriver' }],
    text: 'Orbit: **destroy** the played minion and give its **bonus stats** to another friendly **Celestial**.',
    goldenText: 'Orbit: **destroy** the played minion and give **double** its **bonus stats** to another friendly **Celestial**.',
  },
  {
    // The tribe's capstone devourer. Its passive half pays the whole SHOP for everyone else's Orbits, and its
    // own Orbit (3) is the Broker writ large — the parcel is split across every Celestial you own rather than
    // handed to one, so it rewards the wide board the rest of the tribe has been building toward.
    id: 'c3_orrery',
    name: 'Orrery, World Devourer',
    tribe: 'celestial',
    tier: 7,
    attack: 8,
    health: 8,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbitFired', do: 'onOrbitBuffShop', params: { others: true, attack: 1, health: 1 } },
      { on: 'orbit', do: 'orbitDevourArriver', params: { every: 3, mode: 'split' } },
    ],
    text: 'Whenever **another Orbit** triggers, give minions in the current Shop **+1/+1**. **Orbit (3):** **destroy** the played minion and split its **bonus stats** among your **Celestials**.',
    goldenText: 'Whenever **another Orbit** triggers, give minions in the current Shop **+2/+2**. **Orbit (3):** **destroy** the played minion and split **double** its **bonus stats** among your **Celestials**.',
  },
];
