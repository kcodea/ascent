import type { CardDef } from '@game/core';

/**
 * Mechs (handoff A.7) — Divine Shield walls + Magnetic + shield-break payoffs.
 * Answers Venom Swarm (Shields soak the one-touch Poison) and Glass Cannon
 * (a Shield eats the single big hit). The shield-break chain is the engine of
 * the tribe: every popped Shield can regrant a Shield (Capacitor), ping an
 * enemy (Reactor), or buff the board (Titan). Magnetic merges a Cling Drone's
 * stats onto a friendly Mech at recruit (resolved in `@game/sim`); Omega
 * Bulwark re-arms the whole wall at Start of Combat.
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
    text: '**Divine Shield** — blocks the first hit it takes.',
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
    text: '**Magnetic** — merge onto a Mech to add its stats.',
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
    id: 'cap',
    name: 'Shield Capacitor',
    tribe: 'mech',
    tier: 3,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'onLoseDivineShield', do: 'onShieldBreakGrantShield' }],
    text: 'When a friendly Shield breaks, give another friend a Shield.',
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
    id: 'omega',
    name: 'Omega Bulwark',
    tribe: 'mech',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: ['DS', 'T'],
    effects: [
      {
        on: 'startOfCombat',
        do: 'scGrantShieldTribe',
        params: { tribe: 'mech', text: 'Omega Bulwark raises the shieldwall' },
      },
    ],
    text: '**Start of Combat:** give all your Mechs a Shield.',
  },
];
