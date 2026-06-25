import type { CardDef } from '@game/core';

/**
 * Demons (handoff A.7) — Consume Fodder to feed a carry. The Fodder supply is
 * recruit-time: Soulfeeder (Battlecry) and Maw of the Pit (End of Turn) queue
 * Fodder into the next tavern, and Voracious Imp eats it for 2× stats. Brood
 * Matron (breeds Imps on death) resolves in combat.
 */
export const DEMONS: CardDef[] = [
  {
    // Fred is the Fodder token — no longer rollable (token: true). It only enters the
    // tavern from other sources (Soulfeeder's Battlecry); your Demons then eat it.
    id: 'fred',
    name: 'Fred',
    tribe: 'demon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: ['FD'],
    effects: [],
    text: 'A 1/1 Demon **Fodder** — your Demons devour it from the tavern.',
    token: true,
  },
  {
    // When SOLD (handled in the reducer's sell case — no combat/recruit factory): queue a Fodder into the
    // next tavern + buff your Imps everywhere (run-wide `impBuff`). Golden doubles both.
    id: 'fodderfeeder',
    name: 'Fodder Feeder',
    tribe: 'demon',
    tier: 1,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [],
    text: 'When you **sell** this, add a **Fodder** to your next tavern and give your **Imps +1/+1** everywhere.',
    goldenText: 'When you **sell** this, add **2 Fodder** to your next tavern and give your **Imps +2/+2** everywhere.',
  },
  {
    // Deathrattle (combat): summon 2 Imps, then buff all your Imps (the new ones included) +2/+3. Golden 2×.
    id: 'impking',
    name: 'Imp King',
    tribe: 'demon',
    tier: 4,
    attack: 6,
    health: 5,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 2, fixed: true } },
      { on: 'onDeath', do: 'deathrattleBuffImps', params: { attack: 2, health: 3 } },
    ],
    text: '**Deathrattle:** Summon 2 **Imps** and give your Imps **+2/+3** permanently.',
    goldenText: '**Deathrattle:** Summon 2 **Imps** and give your Imps **+4/+6** permanently.',
  },
  {
    id: 'feed',
    name: 'Soulfeeder',
    tribe: 'demon',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'addTavernFodder' }],
    text: '**Battlecry:** add Fodder to your next tavern.',
    goldenText: '**Battlecry:** add **2** Fodder to your next tavern.',
  },
  {
    id: 'imp',
    name: 'Voracious Imp',
    tribe: 'demon',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: ['CN'],
    fodderMult: 2,
    effects: [],
    text: 'Gains **2x** stats from Fodder.',
    // Golden eats at 3× (fodderMultiplier = base + 1), not the naive 2× doubling — set it explicitly.
    goldenText: 'Gains **3x** stats from Fodder.',
  },
  {
    id: 'brood',
    name: 'Brood Matron',
    tribe: 'demon',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'onFriendDeathSummon', params: { tokenId: 'impscrap', max: 3 } },
      { on: 'avenge', do: 'avengeBuffImps', params: { count: 3, attack: 3, health: 2 } },
    ],
    text: 'Each time a friend dies, summon an **Imp** (max 3). **Avenge (3):** give your Imps **+3/+2** permanently.',
    goldenText: 'Each time a friend dies, summon an **Imp** (max 3). **Avenge (3):** give your Imps **+6/+4** permanently.',
  },
  {
    // Dual-type Demon/Mech. Magnetic — and because it's also a Mech it can weld onto a friendly
    // Mech *or* Demon, merging its 3/3 in. A flexible glue body for either tribe.
    id: 'heckbinder',
    name: 'Heckbinder',
    tribe: 'demon',
    tribe2: 'mech',
    tier: 4,
    attack: 3,
    health: 3,
    keywords: ['M'],
    effects: [],
    text: 'Magnetize onto a friendly **Mech** or **Demon**.',
  },
  {
    id: 'maw',
    name: 'Maw of the Pit',
    tribe: 'demon',
    tier: 3,
    attack: 4,
    health: 5,
    keywords: ['T'],
    effects: [{ on: 'endOfTurn', do: 'addTavernFodder' }],
    text: '**End of Turn:** add a **Fodder** to your next tavern.',
    goldenText: '**End of Turn:** add **2** Fodder to your next tavern.',
  },
  {
    id: 'ritualist',
    name: 'Ritualist',
    tribe: 'demon',
    tier: 5,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'buffFodderEverywhere', params: { attack: 2, health: 2 } }],
    text: '**End of Turn:** give your Imps and Fodder **+2/+2**, wherever they are.',
    goldenText: '**End of Turn:** give your Imps and Fodder **+4/+4**, wherever they are.',
  },
  {
    // Every 4 manual refreshes, consumes a random non-Fodder offer from the tavern and gains its stats
    // (golden doubles the stats gained). Uses `rollTick` on the BoardCard to count refreshes per wave;
    // rollTick resets in advanceCombat so the every-4 cadence is wave-scoped.
    id: 'acid',
    name: 'Acid',
    tribe: 'demon',
    tier: 6,
    attack: 7,
    health: 7,
    keywords: ['CN'],
    effects: [{ on: 'onRoll', do: 'onRollConsumeShop', params: { every: 4 } }],
    text: 'Every 4 refreshes, consume a random tavern minion.',
    goldenText: 'Every 4 refreshes, consume a random tavern minion (gain **double** its stats).',
  },
  {
    id: 'trickster',
    name: 'Trickster',
    tribe: 'demon',
    tier: 1,
    attack: 1,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGiveHealth', params: {} }],
    text: '**Deathrattle:** Give a random friendly minion this minion\'s Health.',
    goldenText: '**Deathrattle:** Give a random friendly minion this minion\'s Health **twice**.',
  },
  {
    id: 'demonanomaly',
    name: 'Demonic Anomaly',
    tribe: 'demon',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryFreeRollsAndBuffShop', params: { rolls: 2, buff: 3 } }],
    text: '**Battlecry:** Gain 2 free refreshes. Give all Tavern minions **+3/+3** this game.',
    goldenText: '**Battlecry:** Gain **4** free refreshes. Give all Tavern minions **+6/+6** this game.',
  },
  {
    // Start of Combat: gains the full attack + health of all Fodder consumed this turn (before combat).
    // `fodderConsumedThisTurn` is tracked in consumeTavernFodder and passed to simulate() as
    // fodderConsumedAtk/Hp on the CombatContext. Golden doubles everything.
    id: 'abhorrenthorror',
    name: 'Abhorrent Horror',
    tribe: 'demon',
    tier: 6,
    attack: 1,
    health: 1,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scGainFodderStats', params: {} }],
    text: '**Start of Combat:** Gain +Attack/+Health equal to the Fodder consumed this turn.',
    goldenText: '**Start of Combat:** Gain **double** the Attack/Health of Fodder consumed this turn.',
  },
  {
    // Deathrattle feeds the Fodder engine from combat: a death queues Fodder into your next tavern (carried
    // back via CombatResult.playerFodderGrants → settleCombat). Golden queues 2.
    id: 'burialimp',
    name: 'Burial Imp',
    tribe: 'demon',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleAddFodder', params: { count: 1 } }],
    text: '**Deathrattle:** add a Fodder to your next tavern.',
    goldenText: '**Deathrattle:** add **2** Fodder to your next tavern.',
  },
];
