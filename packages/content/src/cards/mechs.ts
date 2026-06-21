import type { CardDef } from '@game/core';

/**
 * Mechs (handoff A.7) — Divine Shield walls + Magnetic + shield-break payoffs.
 * Answers Venom Swarm (Shields soak the one-touch Venomous) and Glass Cannon
 * (a Shield eats the single big hit). The shield-break chain is the engine of
 * the tribe: every popped Shield can regrant a Shield (Capacitor), ping an
 * enemy (Reactor), or buff the board (Titan). Magnetic merges a Cling Drone's
 * stats onto a friendly Mech at recruit (resolved in `@game/sim`); Beatboxer
 * mimics every magnetization that lands on another friendly unit.
 */
export const MECHS: CardDef[] = [
  {
    id: 'drone',
    name: 'Spare Part Drone',
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
  },
  {
    // Magnetic mech whose value is passive economy: while it (or a Mech it merged into) is on
    // the board, the player's max mana per turn is raised. Magnetize it onto Spare Part Drone to
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
    text: 'While on your board, you have **+1 max mana** each turn.',
  },
  {
    id: 'arc',
    name: 'Arclight Reactor',
    tribe: 'mech',
    tier: 4,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onLoseDivineShield', do: 'onShieldBreakDamage', params: { amount: 3 } }],
    text: 'When a friendly Mech Shield breaks, deal **3** to a random enemy.',
  },
  {
    id: 'junk',
    name: 'Junkyard Titan',
    tribe: 'mech',
    tier: 5,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onLoseDivineShield', do: 'onShieldBreakBuffAll', params: { attack: 1, health: 1 } }],
    text: 'When any friendly Shield breaks, give your minions **+1/+1**.',
  },
  {
    // End of Turn: weld a Cling Drone's stats onto two friendly Mechs (golden: two each).
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
        params: { tokenId: 'cling', targets: 2, count: 1 },
      },
    ],
    text: '**End of Turn:** magnetize a Cling Drone onto 2 friendly Mechs.',
    goldenText: '**End of Turn:** magnetize **two** Cling Drones onto 2 friendly Mechs.',
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
];
