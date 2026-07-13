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
    effects: [{ on: 'onKill', do: 'onKillBuffFodder', params: { attack: 1, health: 1 } }],
    text: '**Slaughter:** give your **Fodder** **+1/+1**.',
    goldenText: '**Slaughter:** give your **Fodder** **+2/+2**.',
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
      { on: 'onDeath', do: 'deathrattleBuffImps', params: { attack: 3, health: 3 } },
    ],
    text: '**Deathrattle:** Summon 2 **Imps** and give your Imps **+3/+3** permanently.',
    goldenText: '**Deathrattle:** Summon 2 **Imps** and give your Imps **+6/+6** permanently.',
  },
  {
    id: 'feed',
    name: 'Soulfeeder',
    tribe: 'demon',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'addFodderNextShops', params: { count: 1, shops: 2 } }],
    text: '**Shout:** add a Fodder to the next **2** shops.',
    goldenText: '**Shout:** add **2** Fodder to the next **2** shops.',
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
    fodderAura: { attack: 3, health: 3 },
    effects: [],
    text: 'Magnetize onto a friendly **Mech** or **Demon**. While on your board, your **Fodder** gets **+3/+3**.',
    goldenText: 'Magnetize onto a friendly **Mech** or **Demon**. While on your board, your **Fodder** gets **+6/+6**.',
  },
  {
    id: 'maw',
    name: 'Maw of the Pit',
    tribe: 'demon',
    tier: 3,
    attack: 4,
    health: 5,
    keywords: ['T'],
    effects: [
      { on: 'endOfTurn', do: 'battlecryBuffFodder', params: { attack: 1, health: 1 } },
      { on: 'endOfTurn', do: 'addTavernFodder' },
    ],
    text: '**End of Turn:** give your Fodder **+1/+1** and add a **Fodder** to your next shop.',
    goldenText: '**End of Turn:** give your Fodder **+2/+2** and add **2** Fodder to your next shop.',
  },
  {
    id: 'ritualist',
    name: 'Ritualist',
    tribe: 'demon',
    tier: 5,
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'buffFodderImpsImproving', params: { step: 3 } }],
    text: '**End of Turn:** give your Imps and Fodder **+3/+3**. This improves by **+3/+3** each time it triggers.',
    goldenText: '**End of Turn:** give your Imps and Fodder **+6/+6**. This improves by **+6/+6** each time it triggers.',
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
    effects: [],
    chooseOne: [
      { text: 'Add **2** Fodder to your next shop.', effects: [{ on: 'onPlay', do: 'addTavernFodder', params: { count: 2 } }] },
      { text: 'Give your **Fodder** **+3/+3**.', effects: [{ on: 'onPlay', do: 'battlecryBuffFodder', params: { attack: 3, health: 3 } }] },
    ],
    combo: { chooseBoth: true },
    text: '**Choose One:** add **2** Fodder to your next shop, or give your **Fodder** **+3/+3**. **Combo:** do both.',
    goldenText: '**Choose One:** add **4** Fodder to your next shop, or give your **Fodder** **+6/+6**. **Combo:** do both.',
  },
  {
    // Imp-payoff engine: converts your run-wide Imp Aura into a board-wide buff. On death (Echo) it fires in
    // combat off the live aura; with a Combo primer it ALSO fires on play (the recruit half reads run `impBuff`).
    id: 'chefraag',
    name: 'Chef Raag',
    tribe: 'demon',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffAllByImpAura' }],
    combo: { effects: [{ on: 'onPlay', do: 'buffAllByImpAura' }] },
    text: '**Echo:** give your minions stats equal to your **Imp Aura**. **Combo:** do it on play too.',
    goldenText: '**Echo:** give your minions **double** your **Imp Aura**. **Combo:** do it on play too.',
  },
  {
    id: 'trickster',
    name: 'Trickster',
    tribe: 'demon',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGiveHealth', params: { count: 2 } }],
    text: "**Deathrattle:** give **2** random friendly minions this minion's Health.",
    goldenText: "**Deathrattle:** give **4** random friendly minions this minion's Health.",
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
    effects: [
      { on: 'onDeath', do: 'deathrattleBuffFodder', params: { attack: 1, health: 1 } },
      { on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 1 } },
    ],
    text: '**Echo:** give your Fodder **+1/+1** and summon an **Imp**.',
    goldenText: '**Echo:** give your Fodder **+2/+2** and summon **2 Imps**.',
  },
  {
    // Critical Strike bruiser: Flurry (two swings) + Ward, each swing a 50% chance to deal double damage
    // (critChance, rolled per swing in the sim). A high-variance finisher rather than an economy engine.
    id: 'impala',
    name: 'Commander Impala',
    tribe: 'demon',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: ['W', 'DS', 'CR'],
    critChance: 0.5,
    effects: [],
    text: '**Flurry. Ward. Critical Strike (50%).**',
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
    effects: [
      { on: 'onPlay', do: 'battlecryBuffImps', params: { attack: 2, health: 2 } },
      { on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 1 } },
    ],
    text: '**Battlecry:** Your Imps have **+2/+2** wherever they are. **Echo:** summon an Imp.',
    goldenText: '**Battlecry:** Your Imps have **+4/+4** wherever they are. **Echo:** summon 2 Imps.',
  },
  {
    // Bleed engine: at Start of Combat it arms a combat-wide attack counter — every 6 attacks (either side),
    // it deals its own Attack to 3 random enemies. A persistent AoE clock as long as it stays alive.
    id: 'bloodbinder',
    name: 'Bloodbinder',
    tribe: 'demon',
    tier: 4,
    attack: 5,
    health: 2,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'scArmBleed', params: { every: 6, targets: 3 } }],
    text: "**Start of Combat — Bleed:** every 6 attacks in combat, deal this minion's Attack to 3 random enemies.",
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
    effects: [{ on: 'avenge', do: 'avengeAddFodder', params: { count: 3, fodder: 2, shops: 2 } }],
    text: '**Avenge (3):** add **2 Fodder** to your next **2** shops.',
    goldenText: '**Avenge (3):** add **4 Fodder** to your next **2** shops.',
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
  {
    // Rune of the Feast's signature Demon — grant-only (token, never rolls in the shop). It feeds ITSELF a Fodder
    // each turn and shares the meal with both neighbours.
    id: 'feastingbogrot',
    name: 'Feasting Bogrot',
    tribe: 'demon',
    tier: 5,
    attack: 6,
    health: 4,
    keywords: [],
    token: true,
    effects: [{ on: 'endOfTurn', do: 'endOfTurnFeastConsume' }],
    text: '**End of Turn:** **Consume** a Fodder and also give its stats to adjacent minions.',
    goldenText: '**End of Turn:** **Consume** 2 Fodder and also give their stats to adjacent minions.',
  },

  // --- Demon quest rewards (2026-07-08). token: true → reward-only, never rolled in the tavern. ---
  {
    // Dark Bargain reward. Shout: pump BOTH your Fodder and your Imps by +3/+3 (golden +6/+6).
    id: 'contractimp',
    name: 'Contract Imp',
    tribe: 'demon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [
      { on: 'onPlay', do: 'battlecryBuffFodder', params: { attack: 3, health: 3 } },
      { on: 'onPlay', do: 'battlecryBuffImps', params: { attack: 3, health: 3 } },
    ],
    text: '**Shout:** give your **Fodder** and **Imps** **+3/+3**.',
    goldenText: '**Shout:** give your **Fodder** and **Imps** **+6/+6**.',
    token: true,
  },
  {
    // The True Contract reward. Battlecry: every friendly Demon Consumes a Fodder at once — a board-wide feed.
    id: 'heraldapoc',
    name: 'Herald of the Apocalypse',
    tribe: 'demon',
    tier: 6,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryAllDemonsConsume' }],
    text: '**Battlecry:** all of your Demons **Consume** a Fodder.',
    goldenText: '**Battlecry:** all of your Demons **Consume** 2 Fodder.',
    token: true,
  },
  {
    // Maw of the Run reward. Start of Combat: sacrifice your weakest minion and hand 50% of its stats to every
    // Demon (golden 100%). A payoff that turns a spare body into a board-wide Demon buff.
    id: 'runmaw',
    name: 'Run Maw',
    tribe: 'demon',
    tier: 6,
    attack: 10,
    health: 8,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scConsumeWeakestBuffDemons', params: { pct: 50 } }],
    text: '**Start of Combat:** consume your weakest minion, then your Demons gain **50%** of its stats.',
    goldenText: '**Start of Combat:** consume your weakest minion, then your Demons gain **100%** of its stats.',
    token: true,
  },
];
