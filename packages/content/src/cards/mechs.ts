import type { CardDef } from '@game/core';

/**
 * Mechs (handoff A.7) — Divine Shield walls + Magnetic + shield-break payoffs.
 * Answers Venom Swarm (Shields soak the one-touch Venomous) and Glass Cannon
 * (a Shield eats the single big hit). The shield-break chain is the engine of
 * the tribe: every popped Shield can regrant a Shield (Capacitor) or deal damage
 * (Arclight Reactor). Magnetic merges a Cling Drone's
 * stats onto a friendly Mech at recruit (resolved in `@game/sim`); Beatboxer
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
    // Passive (resolved in @game/sim's magnetize path): every magnetization that lands on another
    // friendly minion is mirrored onto Beatboxer too. Golden mirrors each one twice.
    id: 'beatboxer',
    name: 'Beatboxer',
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
    // Passive spell-power aura (resolved in @game/sim's `spellStatBonus` via `spellAura`): while Harry Botter
    // (or a Mech it magnetized into) is on the board, every stat-granting spell gets +1/+1 (golden +2/+2).
    // Live — sell the body and the bonus goes; two stack. Magnetic — welds the aura onto a host Mech (the
    // host carries it via `spellAuraBonus`). No combat factory → inert in combat (just a 1/5 body).
    id: 'harrybotter',
    name: 'Harry Botter',
    tribe: 'mech',
    tier: 3,
    attack: 1,
    health: 5,
    keywords: ['M'],
    effects: [],
    spellAura: 1,
    text: 'Your spells get **+1/+1** while this is in play.',
    goldenText: 'Your spells get **+2/+2** while this is in play.',
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
    tier: 5,
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
];
