import type { CardDef } from '@game/core';

/**
 * Undead (handoff A.7) — Venomous application + Deathrattle value. Answers Ironwall
 * (Venomous melts giant Taunts) and Glass Cannon (Venomous trades up; bodies absorb).
 * Plaguebringer grants Venomous (+Windfury) at recruit; the rest pay
 * off in combat (Deathrattles, Reborn, an innate Venomous body). Venomous now drops off
 * after its first proc in combat (one-shot per fight unless re-granted).
 */
export const UNDEAD: CardDef[] = [
  {
    id: 'spore',
    name: 'Sporeling',
    tribe: 'undead',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } },
      { on: 'battlecryTriggered', do: 'battlecryTriggeredOwnDeathrattle' },
    ],
    text: '**Deathrattle:** Give your minions **+1/+1**. Triggers each time you play a **Battlecry**.',
    goldenText: '**Deathrattle:** Give your minions **+2/+2**. Triggers each time you play a **Battlecry**.',
  },
  {
    // A spell-mill Undead: every third friendly death coughs up a random tavern-tier spell (golden: two).
    id: 'profgreg',
    name: 'Professor Greg',
    tribe: 'undead',
    tier: 4,
    attack: 3,
    health: 7,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGrantRandomSpell', params: { count: 3 } }],
    text: '**Avenge (3):** get a random spell.',
    goldenText: '**Avenge (3):** get **2** random spells.',
  },
  {
    id: 'knit',
    name: 'Spear Warden',
    tribe: 'undead',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffCardTypeRunWide', params: { cardId: 'knit', attack: 3, health: 2 } }],
    text: 'When a **Spear Warden** dies in combat, all Spear Wardens gain **+3/+2** permanently.',
  },
  {
    // On-kill permanent Undead attack buff. Carries back via playerUndeadBuyAtkGain — applied to existing
    // run-board Undead AND stacked into undeadBuyAtk for future buys.
    id: 'karthus',
    name: 'Karthus',
    tribe: 'undead',
    tier: 5,
    attack: 7,
    health: 8,
    keywords: ['DS', 'SL'],
    effects: [{ on: 'onKill', do: 'onKillBuffUndeadAttack', params: { attack: 3 } }],
    text: '**Slaughter:** give your Undead **+3 Attack** permanently.',
    goldenText: '**Slaughter:** give your Undead **+6 Attack** permanently.',
  },
  {
    // Deathrattle (combat): re-fire an adjacent minion's Battlecry — only combat-meaningful battlecries
    // (summon / tribe buff / undead-attack / grant-keyword) do anything; economy battlecries no-op. Golden
    // re-fires BOTH neighbours; non-golden picks one at random when both have a replayable battlecry.
    id: 'ryme',
    name: 'Ryme',
    tribe: 'undead',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry', params: {} }],
    text: "**Deathrattle:** Trigger an adjacent minion's **Battlecry**.",
    goldenText: "**Deathrattle:** Trigger **both** adjacent minions' **Battlecries**.",
  },
  {
    // Deathrattle: summon a Footman (T1 1/1 Reborn Undead token). Golden summons 2.
    id: 'deathlesshand',
    name: 'Footman Captain',
    tribe: 'undead',
    tier: 3,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'footman' } }],
    text: '**Deathrattle:** Summon a **Footman**.',
    goldenText: '**Deathrattle:** Summon **2 Footmen**.',
  },
  {
    // Rally engine: each time it attacks, it fires your leftmost friendly Deathrattle *before* the hit
    // lands (so any buffs/summons resolve first). Modest stats — the value is the repeated proc.
    id: 'deathsayer',
    name: 'Deathsayer',
    tribe: 'undead',
    tier: 4,
    attack: 3,
    health: 5,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyProcDeathrattle' }],
    text: '**Rally:** before this attacks, trigger your leftmost Deathrattle.',
    goldenText: '**Rally:** before this attacks, trigger your leftmost Deathrattle **twice**.',
  },
  {
    // Battlecry: give your Undead +1 Attack wherever they are (board + hand immediately via
    // battlecryBuffUndeadAttack), AND stacks undeadBuyAtk so future Undead buys carry the bonus.
    id: 'deathswarmer',
    name: 'Deathswarmer',
    tribe: 'undead',
    tier: 2,
    attack: 1,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffUndeadAttack', params: { amount: 1 } }],
    text: '**Battlecry:** Give your Undead **+1 Attack** wherever they are.',
    goldenText: '**Battlecry:** Give your Undead **+2 Attack** wherever they are.',
  },
  {
    id: 'pillager',
    name: 'Pillager',
    tribe: 'undead',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantCardToHand', params: { cardId: 'emberpouch', count: 1 } }],
    text: '**Deathrattle:** Get a **Gold Pouch**.',
    goldenText: '**Deathrattle:** Get **2 Gold Pouches**.',
  },
  {
    // Rise-spreader: a fragile glass body whose Deathrattle hands a random friendly Undead a Rise
    // (skipping ones that already have — or already spent — it). Golden grants two.
    id: 'mumi',
    name: 'Mumi',
    tribe: 'undead',
    tier: 2,
    attack: 5,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantReborn', params: { tribe: 'undead' } }],
    text: '**Deathrattle:** give a friendly **Undead** **Rise**.',
    goldenText: '**Deathrattle:** give **two** friendly **Undead** **Rise**.',
  },
  {
    // Grave Body: at Start of Combat (or when summoned mid-fight — Empty Graves' token), copy the Deathrattle of
    // your leftmost living friendly Echo onto itself. Same factory on both triggers; a board minion uses SoC, a
    // mid-combat summon uses onSummon (never both). The reward card for the Undead "Empty Graves" quest.
    id: 'gravebody',
    name: 'Grave Body',
    tribe: 'undead',
    tier: 3,
    attack: 1,
    health: 1,
    keywords: [],
    token: true, // reward/token-exclusive (Empty Graves summons it) — never rolls in the shop / Discover / grants
    effects: [
      { on: 'startOfCombat', do: 'copyLeftmostEcho' },
      { on: 'onSummon', do: 'copyLeftmostEcho' },
    ],
    text: 'Copy your leftmost **Echo** when summoned.',
  },
  {
    // Engraved: stat gains carry back to the run board. Gains +3/+3 per friendly summon in combat.
    // Overflow summons (board full) also buff your Undead +2/+2. Golden doubles both gains.
    id: 'thunderingabomination',
    name: 'Cratering Hulk',
    tribe: 'undead',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [
      { on: 'onSummon', do: 'onSummonSelfBuff', params: { attack: 3, health: 3 } },
      { on: 'summonOverflow', do: 'onSummonOverflowBuffTribe', params: { tribe: 'undead', attack: 2, health: 2, engrave: true } },
    ],
    text: 'Gain **+3/+3** when a minion is summoned in combat. Overflow summons **Engrave** your Undead **+2/+2**.',
    goldenText: 'Gain **+6/+6** when a minion is summoned in combat. Overflow summons **Engrave** your Undead **+4/+4**.',
  },
  {
    // Deathrattle: give all living friendly minions +2 Health (golden +4). Each time Sergeant itself
    // gains Attack in combat, the HP grant permanently improves by +2 (golden +4). Tracked via
    // `self.hpGrantBonus` on the Minion instance.
    id: 'sergeant',
    name: 'Sergeant',
    tribe: 'undead',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'deathrattleBuffAllHealth', params: { health: 2 } },
      { on: 'onGainAttack', do: 'onGainAttackImproveHpGrant', params: { improve: 2 } },
    ],
    text: '**Deathrattle:** Give your minions **+2 Health**. Improves each time Sergeant gains Attack.',
    goldenText: '**Deathrattle:** Give your minions **+4 Health**. Improves **+4** each time Sergeant gains Attack.',
  },
  {
    // When you cast a spell, give your Undead +3 Attack wherever they are (board + hand) and stack the
    // bonus into undeadBuyAtk for future buys. Golden doubles the per-cast grant.
    id: 'forsakenweaver',
    name: 'Forsaken Mage',
    tribe: 'undead',
    tier: 6,
    attack: 5,
    health: 8,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffUndeadAttack', params: { attack: 3 } }],
    text: 'When you cast a spell, give your Undead **+3 Attack** wherever they are.',
    goldenText: 'When you cast a spell, give your Undead **+6 Attack** wherever they are.',
  },
  {
    // Avenge engine: every 3rd friendly death summons a Spear Warden that attacks IMMEDIATELY (out of
    // turn order — the Whelp attack-on-summon queue). Golden summons a GOLDEN Spear Warden instead of
    // two. The summons carry the card's real Echo, so each one that dies keeps feeding the run-wide
    // Spear Warden enchant ("the aura") as usual.
    id: 'steadfast',
    name: 'Steadfast Champion',
    tribe: 'undead',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeSummonAttack', params: { count: 4, cardId: 'knit' } }],
    text: '**Avenge (4):** summon a **Spear Warden**. It attacks immediately.',
    goldenText: '**Avenge (4):** summon a **Golden Spear Warden**. It attacks immediately.',
  },
  {
    // Dual-type Undead/Beast. Deathrattle: summon 3 Crypt Wolves (1/1 undead beasts). Golden
    // summons 6 (the standard ×2 via mul). Good at flooding the board after death.
    id: 'wolvesden',
    name: 'Wolves Den',
    tribe: 'undead',
    tribe2: 'beast',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'cryptwolf', count: 3 } }],
    text: '**Deathrattle:** Summon 3 **Crypt Wolves**.',
    goldenText: '**Deathrattle:** Summon 6 **Crypt Wolves**.',
  },
  {
    // Avenge: every 4 friendly deaths in combat, permanently raise your max Gold by 1 (golden +2).
    // Carried back via CombatResult.playerMaxGoldGain → settleCombat bumps maxEmbers.
    id: 'soulsman',
    name: 'Soulsman',
    tribe: 'undead',
    tier: 3,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeMaxGold', params: { count: 4 } }],
    text: '**Avenge (4):** raise your maximum Gold by **1**.',
    goldenText: '**Avenge (4):** raise your maximum Gold by **2**.',
  },
  {
    // Start of Combat: hand a friendly Undead Rise (Reborn) so it returns once. Golden Rises two. Skips
    // minions that already have Rise. A resilience enabler for a go-tall Undead board.
    id: 'gravewarden',
    name: 'Gravewarden',
    tribe: 'undead',
    tier: 3,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'scGrantReborn', params: { tribe: 'undead' } }],
    text: '**Start of Combat:** Give a friendly **Undead** Rise.',
    goldenText: '**Start of Combat:** Give **two** friendly **Undead** Rise.',
  },
  {
    // End of Turn: conjure 2 random spells into hand (golden: 4). A spell engine on a tanky Undead body —
    // fuels spell-payoff builds (Spirit Pup's transform, Archmagus Guel, spell-power stacking).
    id: 'cryptscribe',
    name: 'Crypt Scribe',
    tribe: 'undead',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnGetRandomSpells', params: { count: 2 } }],
    text: '**End of Turn:** Get **2 random spells**.',
    goldenText: '**End of Turn:** Get **4 random spells**.',
  },

  // --- 2026-07-06 content batch (part 2) ---
  {
    // Rally engine: casts Lantern of Souls each time it attacks — your Undead get +3/+0 for the rest of the
    // run (the permanent Undead aura), with the run's spell power folded into BOTH stats. A REAL spell cast,
    // so it feeds Spirit Pup's transform, Archmagus Guel, and a friendly Forsaken Weaver. Golden casts twice.
    id: 'watcher',
    name: 'Watcher',
    tribe: 'undead',
    tier: 6,
    attack: 8,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyCastTribeAttack', params: { tribe: 'undead', amount: 3 } }],
    text: '**Rally:** cast **Lantern of Souls** — your Undead get **+3/+0** for the rest of the run.',
    goldenText: '**Rally:** cast **Lantern of Souls** twice — your Undead get **+6/+0** for the rest of the run.',
  },
  {
    // Battlecry: destroy a targeted friendly minion — proccing its Deathrattle in the shop (summons/buffs bake
    // in) — then add a random Tavern spell of that minion's tier to your hand. A sac-for-value engine that
    // turns a spent Deathrattle body into a spell. Golden adds two spells.
    id: 'graverobber',
    name: 'Graverobber',
    tribe: 'undead',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    target: 'friendly',
    primer: true,
    effects: [{ on: 'onPlay', do: 'battlecryDestroyForSpell' }],
    text: '**Battlecry:** Destroy a friendly minion (procs its **Deathrattle**), then add a random spell of its tier to your hand. **Primer.**',
    goldenText: '**Battlecry:** Destroy a friendly minion (procs its **Deathrattle**), then add **2** random spells of its tier to your hand. **Primer.**',
  },

  // --- Undead quest rewards (2026-07-08). token: true → reward-only, never rolled in the tavern. ---
  {
    // Kingdom of Bones reward. An Undead economy engine: bank Gold next shop on every 4th friendly death, and
    // when it dies raise your max Gold permanently. Both halves carry back from combat (bonusGold + maxGold).
    id: 'bonetaxer',
    name: 'Bone Taxer',
    tribe: 'undead',
    tier: 3,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [
      { on: 'avenge', do: 'avengeBonusGold', params: { count: 4, amount: 2 } },
      { on: 'onDeath', do: 'deathrattleMaxGold', params: { amount: 1 } },
    ],
    text: '**Avenge (4):** get **2 Gold** next shop. **Deathrattle:** raise your maximum Gold by **1**.',
    goldenText: '**Avenge (4):** get **4 Gold** next shop. **Deathrattle:** raise your maximum Gold by **2**.',
    token: true,
  },
  {
    // Grave Robber reward. Battlecry payoff: get a random Echo (Deathrattle) minion to hand AND trigger its Echo
    // out of combat right away (summons/buffs bake in, Sylus-doubled + tallied). Golden gets + triggers two. A
    // 3/3 body you play for Echo value. Reward-only (token).
    id: 'cryptbroker',
    name: 'Crypt Broker',
    tribe: 'undead',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'getEchoAndTrigger' }],
    text: '**Battlecry:** get a random **Echo** minion and trigger its Echo.',
    goldenText: '**Battlecry:** get **2** random **Echo** minions and trigger their Echoes.',
    token: true,
  },
  {
    // Death Writes Twice reward. Battlecry (targeted): copy a friendly Echo minion's Deathrattle onto Gravetwin.
    // The copied Echo fires at the START OF YOUR NEXT SHOP if Gravetwin survived the coming combat (tracked via
    // the run's copiedEcho + the combat's survivor list). Golden fires the copied Echo twice next shop.
    id: 'gravetwin',
    name: 'Gravetwin',
    tribe: 'undead',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    target: 'friendly',
    effects: [{ on: 'onPlay', do: 'battlecryCopyEcho' }],
    text: "**Battlecry:** copy a friendly **Echo** minion's Deathrattle. If Gravetwin survives combat, trigger it at the start of your next shop.",
    goldenText: "**Battlecry:** copy a friendly **Echo** minion's Deathrattle. If Gravetwin survives combat, trigger it **twice** at the start of your next shop.",
    token: true,
  },
];
