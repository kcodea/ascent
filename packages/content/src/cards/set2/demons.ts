import type { CardDef } from '@game/core';

/**
 * Set 2's DEMON tribe (owner roster 2026-07-25). The tribe's identity is **Consume from the Shop** — eight cards
 * eat a tavern minion for its stats — braided with an **Imp** swarm line. Set 1's Demons consume FODDER; these
 * eat any Shop minion, which is what `consumeShopMinion` adds.
 *
 * A recurring Gilded rider, "and gain double its stats", is the shared primitive's `times` multiplier rather than
 * a separate effect — so the golden text is a number change, not a second code path.
 */
export const SET2_DEMONS: CardDef[] = [
  {
    id: 'dm_butcher',
    name: 'Contract Butcher',
    tribe: 'demon',
    tier: 3,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'buffShopPermanent', params: { attack: 1, health: 1 } }],
    text: '**Shout:** give minions in the Shop **+1/+1**.',
    goldenText: '**Shout:** give minions in the Shop **+2/+2**.',
  },
  {
    // Owner rework 2026-08-04: Echo → RALLY. (Owner 2026-08-11: Flurry removed — the Rally now fires once per
    // attack rather than twice.)
    id: 'dm_errand',
    name: 'Errand Fiend',
    tribe: 'demon',
    tier: 2,
    attack: 1,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallySummonImpBuffImps', params: { amount: 1 } }],
    text: '**Rally:** summon an **Imp** and give your **Imps +1/+1**.',
    goldenText: '**Rally:** summon **2 Imps** and give your **Imps +2/+2**.',
  },
  {
    // The eater is the TARGET, not this card — so it can feed whichever Demon you want to grow.
    // Owner ruling 2026-08-03: DEMONS ONLY. `targetTribe` is enforced by the reducer on every Battlecry
    // target path and mirrored by the aim UI, so an off-tribe pick is refused rather than silently eaten.
    id: 'dm_agent',
    name: 'Appetite Agent',
    tribe: 'demon',
    tier: 2, // owner balance 2026-08-04: T3 → T2
    attack: 3,
    health: 2,
    keywords: [],
    target: 'friendly',
    targetTribe: 'demon',
    effects: [{ on: 'onPlay', do: 'battlecryTargetConsumesShop', params: { count: 1 } }],
    text: '**Shout:** target a friendly **Demon**. It Consumes a minion in the Shop.',
    goldenText: '**Shout:** target a friendly **Demon**. It Consumes **2** minions in the Shop.',
  },
  {
    id: 'dm_hungerling',
    name: 'Demon Horse',
    tribe: 'demon',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: ['RL'],
    // Owner fix 2026-07-29: the TEXT described a different card entirely — "End of Turn: Consume the right-most
    // Shop minion" — while the effect has always been a Rally shop-buff. The effect was right; the text is now
    // what it actually does, and the gild doubles (the factory already scales on `gold(self)`).
    effects: [{ on: 'onAttack', do: 'rallyBuffShopPermanent', params: { attack: 1, health: 2 } }],
    text: '**Rally:** give minions in the Shop **+1/+2**.',
    goldenText: '**Rally:** give minions in the Shop **+2/+4**.',
  },
  {
    // PERMANENT means the buff rides the OFFER into the bought minion (via `offerBuyStats`) rather than
    // expiring with the shop — not that it is run-wide on every copy of that card id.
    id: 'dm_tormentor',
    name: 'Market Tormentor',
    tribe: 'demon',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    // THIRD SHAPE, and this one is the owner's full spec (2026-07-31): a SHOUT that buffs the right-most Shop
    // SLOT for the rest of the run. The buff lands on the current shop when played, RE-lands on every fresh
    // roll's right-most, STACKS across plays (two normals + a gilded = +28/+28), and does NOT need the
    // Tormentor to stay on board — the slot remembers, not the minion. The first shape (per-refresh watcher)
    // died with the body; the second (one-shot Shout) buffed exactly one offer ever. Both were wrong.
    // Owner balance 2026-08-12: +4/+2 → +7/+7 (gild +14/+14). Owner balance 2026-08-14: +7/+7 → +7/+6.
    effects: [{ on: 'onPlay', do: 'buffRightmostSlotPermanent', params: { attack: 4, health: 5 } }],
    // Owner retext 2026-08-12: the simpler "minion + permanently" phrasing (matches Right Hand Hank). The
    // MECHANIC is unchanged — it's still the slot accumulator that re-lands on every refresh and stacks.
    text: '**Shout:** give the **right-most Shop minion +4/+5** permanently.',
    goldenText: '**Shout:** give the **right-most Shop minion +8/+10** permanently.',
  },
  {
    // An escalating shop buff: the longer it lives, the bigger every offer gets.
    id: 'dm_curator',
    name: 'Soul Defiler',
    tribe: 'demon',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'buffShopPermanent', params: { attack: 1, improve: 1, alternate: true } }],
    text: '**End of Turn:** give minions in the Shop **+1 Attack**. Improves **+1** each time, and swaps between **Attack** and **Health** each round.',
    goldenText: '**End of Turn:** give minions in the Shop **+2 Attack**. Improves **+2** each time, and swaps between **Attack** and **Health** each round.',
  },
  {
    // A Demon eats every time you play a Demon — the tribe's engine card.
    id: 'dm_glutton',
    name: 'Chipper',
    tribe: 'demon',
    tier: 5, // owner balance 2026-08-14: T4 4/4 → T5 8/7
    attack: 4,
    health: 5,
    keywords: ['T'], // Taunt
    effects: [{ on: 'onSummon', do: 'onTribePlayedConsumeShop', params: { tribe: 'demon', times: 1, self: true } }],
    text: '**Taunt.** Whenever you play a **Demon**, this Consumes a minion in the Shop.',
    goldenText: '**Taunt.** Whenever you play a **Demon**, this Consumes a minion in the Shop and gains **double** its stats.',
  },
  {
    // Owner rework 2026-08-14: Blart now EATS the offer instead of copying its stats — same right-most target,
    // but it leaves the row (and fires the consume payoffs: Avarice, Pactstone, Bottomless Banquet). Stats and
    // tier came down with it (T5 7/7 → T4 6/5) because the eat is the stronger half of the trade.
    // (The old copy-don't-eat shape is still live on `endOfTurnGainRightmostShopStats`, which Hellrider uses.)
    id: 'dm_gourmand',
    name: 'Bob Blart',
    tribe: 'demon',
    tier: 4, // owner balance 2026-08-11: T4 → T5; 2026-08-14: back to T4
    attack: 5,
    health: 4,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'consumeShopRightmost', params: { times: 1 } }],
    text: '**End of Turn:** Consume the **right-most** minion in the Shop.',
    goldenText: '**End of Turn:** Consume the **right-most** minion in the Shop and gain **double** its stats.',
  },
  {
    id: 'dm_velvet',
    name: 'Big Huggies',
    tribe: 'demon',
    tier: 4,
    attack: 5,
    health: 2,
    keywords: ['T'],
    // `cardId`, NOT `spellId` — the factory reads `params.cardId`, so the wrong key granted the EMPTY string and
    // the hand-grant preview then crashed on `CARD_INDEX['']` (owner report 2026-07-25). `count` is likewise not
    // a param here: the factory grants `mul(self)` copies, which is already the golden "2 Staves".
    effects: [{ on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'staffofguel' } }],
    text: '**Taunt.** **Echo:** get a **Staff of Guel**.',
    goldenText: '**Taunt.** **Echo:** get **2 Staves of Guel**.',
  },
  {
    // The pay-off scales with the room you LEFT — a lone Shepherd fills six slots and buffs six times.
    id: 'dm_shepherd',
    name: 'Legion Shepherd',
    tribe: 'demon',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleImpsOverflowGrant', params: { count: 4, attack: 2, health: 2 } }],
    text: '**Echo:** summon **4 Imps**. Your Imps gain **+2/+2** everywhere for each one that had no room.',
    goldenText: '**Echo:** summon **4 Imps**. Your Imps gain **+4/+4** everywhere for each one that had no room.',
  },
  {
    id: 'dm_maw',
    name: 'Hellrider',
    tribe: 'demon',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    // Owner rework 2026-08-14: Hellrider no longer EATS — it COPIES the right-most offer's stats and leaves it
    // buyable (Bob Blart's old shape, now on a refresh meter). The two Demons traded jobs deliberately: the
    // cheap one eats the row, the Tier-6 one farms it without shrinking your options.
    effects: [{ on: 'shopRefreshed', do: 'onShopRefreshGainRightmostShopStats', params: { every: 4, times: 1 } }],
    text: "Every **4 refreshes**, gain the **right-most** Shop minion's stats.",
    goldenText: "Every **4 refreshes**, gain the **right-most** Shop minion's stats **twice**.",
  },
  {
    // The tribe capstone: a Choose One splitting the two halves of the tribe — Feast is the Consume line,
    // Legion is the Imp line. Gilded doubles whichever you picked.
    id: 'dm_malphas',
    name: 'Malphas, Lord of Want',
    tribe: 'demon',
    tier: 7,
    attack: 10,
    health: 6,
    keywords: [],
    // Owner balance 2026-08-18: reworked from the Choose-One (Feast / Legion) into a straight Avenge Imp lord.
    effects: [{ on: 'avenge', do: 'avengeBuffImps', params: { count: 3, attack: 7, health: 5 } }],
    text: '**Avenge (3):** give your Imps **+7/+5** wherever they are.',
    goldenText: '**Avenge (3):** give your Imps **+14/+10** wherever they are.',
  },
  {
    // Owner add 2026-08-12. A glass-cannon 4/1 built to die: its Echo feeds your shop. The buff is a combat→run
    // carry-back (`grantRightmostSlotBuff`) onto Market Tormentor's right-most-slot accumulator, so it survives
    // into the next recruit phase and re-lands on every fresh roll. Owner balance 2026-08-14: +6/+3 → +3/+2
    // (gild +6/+4) — the Echo stacked far too fast on a body this cheap to replay.
    id: 'dm_hank',
    name: 'Right Hand Hank',
    tribe: 'demon',
    tier: 2,
    attack: 3,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffRightmostSlot', params: { attack: 3, health: 2 } }],
    text: '**Echo:** give the **right-most Shop minion +3/+2** permanently.',
    goldenText: '**Echo:** give the **right-most Shop minion +6/+4** permanently.',
  },
  {
    // Owner add 2026-08-14. The tribe's Avenge body-refiller: a fat T4 stat-line that turns friendly deaths into
    // more Demons in hand. `avengeGrantRandomTribeMinion` picks from the run's BUYABLE pool at settle (≤ tavern
    // tier, pinned set), so an early Grobbus hands you Tier-1s and a late one hands you the real thing. No
    // keyword pill, matching every other Avenge card. Golden grants 2 per proc.
    id: 'dm_grobbus',
    name: 'Grobbus',
    tribe: 'demon',
    tier: 4,
    attack: 3,
    health: 6,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGrantRandomTribeMinion', params: { count: 3, tribe: 'demon', grant: 1 } }],
    text: '**Avenge (3):** get a random **Demon**.',
    goldenText: '**Avenge (3):** get **2 random Demons**.',
  },
];
