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
    attack: 2,
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
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'buffFodderEverywhere', params: { attack: 2, health: 2 } }],
    text: '**End of Turn:** give your Imps and Fodder **+2/+2**, wherever they are.',
    goldenText: '**End of Turn:** give your Imps and Fodder **+4/+4**, wherever they are.',
  },
  {
    // Spend-gold payoff: every 7 Gold you spend (a continuous per-instance meter, carried across turns)
    // permanently buffs your Fodder + Imps run-wide (like Bane) AND queues a Fodder into the next tavern.
    // Golden doubles both the grant and the Fodder count.
    id: 'acid',
    name: 'Koron, the Hungerer',
    tribe: 'demon',
    tier: 6,
    attack: 8,
    health: 8,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentBuffFodderImps', params: { every: 7, attack: 1, health: 1, fodder: 1 } }],
    text: 'When you spend **7 Gold**, give your Fodder and Imps **+1/+1** and add **1 Fodder** to your next tavern.',
    goldenText: 'When you spend **7 Gold**, give your Fodder and Imps **+2/+2** and add **2 Fodder** to your next tavern.',
  },
  {
    // Battlecry (targeted): make a chosen friendly minion immediately eat one Fodder from the
    // shop — consuming it off the tavern exactly like the auto-consume pipeline (stat transfer ×
    // their multiplier, on-consume payoffs). Golden consumes 2 Fodder. No-op if no Fodder is in the
    // shop. The card needs `target: 'friendly'` so the UI shows the targeting cursor.
    id: 'godfodder',
    name: 'The Godfodder',
    tribe: 'demon',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    target: 'friendly',
    effects: [{ on: 'onPlay', do: 'battlecryTargetConsumeFodder', params: {} }],
    text: '**Battlecry:** Target a friendly minion. They consume a **Fodder** from the shop.',
    goldenText: '**Battlecry:** Target a friendly minion. They consume **2 Fodder** from the shop.',
  },
  {
    // Battlecry: buff every friendly Demon on the board +1/+3 (golden +2/+6). A wide-board payoff
    // for the Consume tribe — rewards having many Demons in play at once.
    id: 'hexflayer',
    name: 'Hex Flayer',
    tribe: 'demon',
    tier: 4,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'demon', attack: 1, health: 3 } }],
    text: '**Battlecry:** Give your **Demons** **+1/+3**.',
    goldenText: '**Battlecry:** Give your **Demons** **+2/+6**.',
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
    keywords: ['W'],
    effects: [{ on: 'onKill', do: 'onKillBuffFodderImps', params: { attack: 3, health: 3 } }],
    text: '**Windfury.** When this kills an enemy, give your Fodder and Imps **+3/+3** permanently.',
    goldenText: '**Windfury.** When this kills an enemy, give your Fodder and Imps **+6/+6** permanently.',
  },
];
