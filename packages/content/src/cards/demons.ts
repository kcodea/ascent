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
    // A cheap Demon attacker that pumps your Fodder every time it trades up. A 3/1 dies easily, so Slaughter
    // fires on the kill even if it then dies to retaliation (see onKillBuffFodder — no survival check).
    id: 'swordbored',
    name: 'Sword and Bored',
    tribe: 'demon',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: ['SL'],
    effects: [{ on: 'onKill', do: 'onKillBuffFodder', params: { attack: 1, health: 0 } }],
    text: '**Slaughter:** give your **Fodder** **+1/+0**.',
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
    id: 'brood',
    name: 'Brood Matron',
    tribe: 'demon',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'onFriendDeathSummon', params: { tokenId: 'impscrap', max: 3 } },
      { on: 'avenge', do: 'avengeBuffImps', params: { count: 3, attack: 1, health: 1 } },
    ],
    text: 'Each time a friend dies, summon an **Imp** (max 3). **Avenge (3):** give your Imps **+1/+1** permanently.',
    goldenText: 'Each time a friend dies, summon an **Imp** (max 3). **Avenge (3):** give your Imps **+2/+2** permanently.',
  },
  {
    // Dual-type Demon/Mech. Magnetic — and because it's also a Mech it can weld onto a friendly
    // Mech *or* Demon, merging its 3/3 in. While on the board (or welded onto a host that is), it
    // enriches every NEW Fodder by +1/+2 (a live aura — leaves when it does; golden ×2).
    id: 'heckbinder',
    name: 'Heckbinder',
    tribe: 'demon',
    tribe2: 'mech',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: ['M'],
    fodderAura: { attack: 1, health: 2 },
    effects: [],
    text: 'Magnetize onto a friendly **Mech** or **Demon**. While on your board, your **Fodder** gets **+1/+2**.',
    goldenText: 'Magnetize onto a friendly **Mech** or **Demon**. While on your board, your **Fodder** gets **+2/+4**.',
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
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'buffFodderEverywhere', params: { attack: 2, health: 2 } }],
    text: '**End of Turn:** give your Imps and Fodder **+2/+2**, wherever they are.',
    goldenText: '**End of Turn:** give your Imps and Fodder **+4/+4**, wherever they are.',
  },
  {
    // Spend-gold payoff: every 7 Gold you spend (a continuous per-instance meter, carried across turns)
    // permanently buffs your Fodder run-wide (like Bane) AND queues a Fodder into the next tavern.
    // Golden doubles both the grant and the Fodder count. (No longer affects Imps.)
    id: 'acid',
    name: 'Korok, the Hungerer',
    tribe: 'demon',
    tier: 6,
    attack: 8,
    health: 8,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentBuffFodder', params: { every: 7, attack: 1, health: 1, fodder: 1 } }],
    text: 'When you spend **7 Gold**, give your Fodder **+1/+1** and add **1 Fodder** to your next tavern.',
    goldenText: 'When you spend **7 Gold**, give your Fodder **+2/+2** and add **2 Fodder** to your next tavern.',
  },
  {
    // Battlecry (targeted): create a Fodder and feed it to a chosen friendly minion — it gains the
    // Fodder's stats × its fodder multiplier and fires the on-consume pipeline (Pactstone / Maw /
    // Glutton), exactly like the Consume spell. Golden feeds 2. Always resolves (the Fodder is created,
    // not pulled from the shop). The card needs `target: 'friendly'` so the UI shows the targeting cursor.
    id: 'godfodder',
    name: 'The Godfodder',
    tribe: 'demon',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    target: 'friendly',
    effects: [{ on: 'onPlay', do: 'battlecryTargetConsumeFodder', params: {} }],
    text: '**Battlecry:** Target a friendly minion — it consumes a **Fodder**.',
    goldenText: '**Battlecry:** Target a friendly minion — it consumes **2 Fodder**.',
  },
  {
    id: 'trickster',
    name: 'Trickster',
    tribe: 'demon',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGiveHealth', params: {} }],
    text: '**Deathrattle:** Give a random friendly minion this minion\'s Health.',
    goldenText: '**Deathrattle:** Give a random friendly minion this minion\'s Health **twice**.',
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
  {
    // On-kill engine: each kill permanently buffs your Fodder + Imps (combat → carried back, like Bane).
    // Golden doubles the grant.
    id: 'impala',
    name: 'Commander Impala',
    tribe: 'demon',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: ['W', 'SL'],
    effects: [{ on: 'onKill', do: 'onKillBuffFodderImps', params: { attack: 3, health: 3 } }],
    text: '**Windfury. Slaughter:** give your Fodder and Imps **+3/+3** permanently.',
    goldenText: '**Windfury. Slaughter:** give your Fodder and Imps **+6/+6** permanently.',
  },
  {
    // Imp payoff Battlecry: a persistent +2/+2 to every Imp you have or make (board / hand / future copies) —
    // the shared imp enchant (impBuff), like Impala's on-kill but on a Shout. Golden doubles.
    id: 'impoverseer',
    name: 'Imp Overseer',
    tribe: 'demon',
    tier: 3,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffImps', params: { attack: 2, health: 2 } }],
    text: '**Battlecry:** Your Imps have **+2/+2** wherever they are.',
    goldenText: '**Battlecry:** Your Imps have **+4/+4** wherever they are.',
  },
  {
    // Rally engine: each time it attacks, hand another friendly Demon Attack equal to its OWN (a golden
    // Bloodbinder has double Attack, so it gives double). Snowballs a Demon carry on a wide board.
    id: 'bloodbinder',
    name: 'Bloodbinder',
    tribe: 'demon',
    tier: 4,
    attack: 5,
    health: 2,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGiveDemonAttack' }],
    text: "**Rally:** give another friendly Demon Attack equal to this minion's Attack.",
  },
  {
    // Avenge (3): every 3 friendly deaths in combat, queue a Fodder into your next shop (golden: 2). Feeds the
    // Demon Consume engine off attrition — carried back after combat.
    id: 'pitsupplier',
    name: 'Pit Supplier',
    tribe: 'demon',
    tier: 3,
    attack: 4,
    health: 2,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeAddFodder', params: { count: 3 } }],
    text: '**Avenge (3):** add a **Fodder** to your next shop.',
    goldenText: '**Avenge (3):** add **2 Fodder** to your next shop.',
  },
  {
    // End of Turn: both board-adjacent minions Consume a Fodder (gain its enchanted stats + fire the consume
    // payoffs). A Demon anchor that feeds its neighbors every turn — pairs with onConsume growers. Golden →
    // each neighbor Consumes 2.
    id: 'abyssalfeeder',
    name: 'Abyssal Feeder',
    tribe: 'demon',
    tier: 6,
    attack: 7,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnAdjacentConsumeFodder' }],
    text: '**End of Turn:** adjacent minions each **Consume** a Fodder.',
    goldenText: '**End of Turn:** adjacent minions each **Consume** 2 Fodder.',
  },
];
