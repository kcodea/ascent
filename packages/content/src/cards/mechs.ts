import type { CardDef } from '@game/core';

/**
 * Mechs (handoff A.7) — Divine Shield walls + Magnetic + shield-break payoffs.
 * Answers Venom Swarm (Shields soak the one-touch Venomous) and Glass Cannon
 * (a Shield eats the single big hit). The shield-break chain is the engine of
 * the tribe: every popped Shield can regrant a Shield (Capacitor) or deal damage
 * (Arclight Reactor). Magnetic merges a Cling Drone's
 * stats onto a friendly Mech at recruit (resolved in `@game/sim`); Beatbot
 * mimics every magnetization that lands on another friendly unit; Junkyard Titan's
 * Deathrattle refills your hand with a random Magnetic to keep the chain going.
 */
export const MECHS: CardDef[] = [
  {
    id: 'drone',
    name: 'Warding Drone',
    tribe: 'mech',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: ['DS'],
    effects: [],
    text: '',
  },
  {
    // T1 economy Mech (2026-07-06): every 2 turns, conjure a Gold Pouch or Safety Deposit Box (random,
    // seeded). A slow-drip income engine — triples into a golden that grants 2 per proc, and plugs into Mech
    // synergies. The live "procs in N turns" countdown surfaces via cardText's cadence helper (like Frontdrake).
    id: 'moneymaker',
    name: 'Money Maker',
    tribe: 'mech',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnGrantSpellChoice', params: { every: 2, cards: ['emberpouch', 'depositbox'] } }],
    text: '**Every 2 turns:** get a **Gold Pouch** or **Safety Deposit Box**.',
    goldenText: '**Every 2 turns:** get **2** — each a **Gold Pouch** or **Safety Deposit Box**.',
  },
  {
    id: 'cling',
    name: 'Cling Drone',
    tribe: 'mech',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: ['M'],
    effects: [],
    text: 'Each time a Cling Drone is magnetized, your Cling Drones get **+1/+1**.',
  },
  {
    id: 'selfless',
    name: 'Selfless Sentinel',
    tribe: 'mech',
    tier: 2,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantShield' }],
    text: '**Deathrattle:** give a friend a **Divine Shield**.',
    goldenText: '**Deathrattle:** give two friends a **Divine Shield**.',
  },
  {
    // Magnetic mech whose value is passive economy: while it (or a Mech it merged into) is on
    // the board, the player's max Gold per turn is raised. Magnetize it onto Spare Part Drone to
    // carry the income on a sturdier body (and through a triple); selling that body removes it.
    id: 'moneybot',
    name: 'Money Bot',
    tribe: 'mech',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: ['M'],
    effects: [],
    manaPerTurn: 1,
    text: 'While on your board, you have **+1 max Gold** each turn.',
  },
  {
    id: 'junk',
    name: 'Junkyard Titan',
    tribe: 'mech',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantMagnetic' }],
    text: '**Deathrattle:** Add a random Magnetic minion to your hand.',
    goldenText: '**Deathrattle:** Add **two** random Magnetic minions to your hand.',
  },
  {
    // End of Turn: magnetize a RANDOM Magnetic Mech (Cling / Money Bot / Better Bot…) onto a friendly
    // Mech (golden: 2). The bot rolls fresh each turn, so the welds vary — a Cling, an income, a Rally.
    id: 'combinator',
    name: 'Combinator',
    tribe: 'mech',
    tier: 5,
    attack: 6,
    health: 7,
    keywords: [],
    effects: [
      {
        on: 'endOfTurn',
        do: 'endOfTurnMagnetizeMechs',
        params: { targets: 1 },
      },
    ],
    text: '**End of Turn:** magnetize a random **Magnetic** Mech onto a friendly Mech.',
    goldenText: '**End of Turn:** magnetize a random **Magnetic** Mech onto **2** friendly Mechs.',
  },
  {
    // End-of-Turn spell-power ramp: each turn it survives, your spells permanently give +1/+1 more —
    // the run-wide spellBonus channel (same as Cinderwing Matron's Battlecry, on a cadence). Golden +2/+2.
    id: 'aeonguard',
    name: 'Aeon Guard',
    tribe: 'mech',
    tier: 5,
    attack: 6,
    health: 5,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'battlecryBuffSpellPower', params: { attack: 1, health: 1 } }],
    text: '**End of Turn:** give your spells **+1/+1**.',
    goldenText: '**End of Turn:** give your spells **+2/+2**.',
  },
  {
    // Passive (resolved in @game/sim's magnetize path): every magnetization that lands on another
    // friendly minion is mirrored onto Beatbot too. Golden mirrors each one twice.
    id: 'beatboxer',
    name: 'Beatbot',
    tribe: 'mech',
    tier: 6,
    attack: 8,
    health: 8,
    keywords: [],
    effects: [],
    text: 'Whenever a **Magnetic** attaches to another friendly minion, **copy** it onto this too.',
    goldenText: 'Whenever a **Magnetic** attaches to another friendly minion, **copy it twice** onto this.',
  },
  {
    // Magnetic — welds its Windfury (+ 4/4 body) onto a host Mech.
    id: 'speedy',
    name: 'Speedy',
    tribe: 'mech',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: ['W', 'M'],
    effects: [],
    text: '',
  },
  {
    // Rally + Magnetic. Standalone: when it attacks, your OTHER Mechs get +5 Attack (built-in combat
    // behavior off `rallyMechAtk`, not a factory). Magnetic: welds the Rally onto a host Mech (applyWeld
    // adds `rallyMechAtk`), and it STACKS — 5 welded onto one Mech → that Mech grants +25 on attack.
    id: 'betterbot',
    name: 'Better Bot',
    tribe: 'mech',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: ['M', 'RL'],
    rallyMechAtk: 5,
    effects: [],
    text: '**Rally:** give your other Mechs **+5 Attack**. **Magnetic** — welds onto a Mech, which then grants the buff (stacks).',
  },
  {
    // T6 flood-or-pump finisher: its Deathrattle dumps 6 Nanobots, and any that can't fit a full board are
    // converted into a board-wide Mech buff (+2/+2 each, golden +4/+4 — the count stays 6, so a packed board
    // turns the wasted bodies into a big pump instead). Pairs with go-wide Mech boards. Nanobot is a 1/1 token.
    id: 'nanon',
    name: 'Nanon',
    tribe: 'mech',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummonOverflowBuff', params: { tokenId: 'nanobot', count: 6, tribe: 'mech', attack: 3, health: 4 } }],
    text: "**Deathrattle:** summon 6 Nanobots. For each one that can't fit, give your Mechs **+3/+4**.",
    goldenText: "**Deathrattle:** summon 6 Nanobots. For each one that can't fit, give your Mechs **+6/+8**.",
  },
  {
    // Spend-gold payoff (the gold meter shared with Acid): every 10 Gold you spend, weld a RANDOM Magnetic
    // minion's stats + keywords onto Banksly himself (like Combinator, but onto self). Golden welds 2.
    id: 'banksly',
    name: 'Banksly',
    tribe: 'mech',
    tier: 6,
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'goldSpent', do: 'goldSpentMagnetize', params: { every: 10, count: 1 } }],
    text: 'When you spend **10 Gold**, magnetize a random **Magnetic** onto this.',
    goldenText: 'When you spend **10 Gold**, magnetize **2** random **Magnetics** onto this.',
  },
  {
    // Rally engine: each time it attacks in combat, add a random Magnetic Mech to your hand (carried back
    // after combat). Golden grants 2 per attack. Pairs with Windfury / Rally enablers.
    id: 'jouster',
    name: 'Mechanical Jouster',
    tribe: 'mech',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGrantMagnetic', params: { count: 1 } }],
    text: '**Rally:** get a random **Magnetic** Mech.',
    goldenText: '**Rally:** get **2** random **Magnetic** Mechs.',
  },
  {
    // Slaughter (on kill): bank 2 free rerolls for your next shop (golden: 4). Carried back after combat — a
    // tempo/econ Mech that pays off an aggressive board.
    id: 'moe',
    name: 'Moe',
    tribe: 'mech',
    tier: 3,
    attack: 4,
    health: 3,
    keywords: ['SL'],
    effects: [{ on: 'onKill', do: 'onKillGrantFreeRolls', params: { count: 2 } }],
    text: '**Slaughter:** gain **2 free refreshes** next shop.',
    goldenText: '**Slaughter:** gain **4 free refreshes** next shop.',
  },
  {
    // Slaughter (on kill): grant 2 Gold into your next shop (golden: 4). A high-Attack finisher that snowballs
    // the economy off kills — carried back after combat.
    id: 'bountybot',
    name: 'Bounty Bot',
    tribe: 'mech',
    tier: 5,
    attack: 7,
    health: 3,
    keywords: ['SL'],
    effects: [{ on: 'onKill', do: 'onKillGrantGold', params: { gold: 2 } }],
    text: '**Slaughter:** gain **2 Gold** next shop.',
    goldenText: '**Slaughter:** gain **4 Gold** next shop.',
  },
  {
    // Battlecry fetches a Patch Job spell into your hand (a stat spell that scales with Gold spent this turn).
    // Golden fetches two. Cheap Mech tempo that seeds a spell-payoff / gold-sink turn.
    id: 'fieldmechanic',
    name: 'Field Mechanic',
    tribe: 'mech',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'patchjob' } }],
    text: '**Battlecry:** add a **Patch Job** to your hand.',
    goldenText: '**Battlecry:** add **2 Patch Jobs** to your hand.',
  },
  {
    // Avenge (4): every 4 friendly deaths, cast a random stat spell on your lowest-Health Mech (its buff +
    // combat spell power). A tanky Mech payoff that rewards a sacrificial board. Golden doubles the grant.
    id: 'sparkcapacitor',
    name: 'Spark Capacitor',
    tribe: 'mech',
    tier: 4,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeCastRandomStatSpell', params: { count: 4 } }],
    text: '**Avenge (4):** cast a random spell on your lowest-Health Mech.',
    goldenText: '**Avenge (4):** cast a random spell on your lowest-Health Mech, **doubled**.',
  },
];
