import type { WikiEntry } from './types';

// Checked against packages/sim/src/lobby/runLobby.ts (seats, hitSeat, knock-outs), state.ts (createRun) and
// the hero roster on 2026-09-28.
export const ENTRIES: readonly WikiEntry[] = [
  {
    id: 'goal-of-the-game',
    topic: 'basics',
    q: "What's the goal? How do I win?",
    a: "Every game is an **8-player lobby**. Each round you build up your board in the shop, then it auto-battles someone else's. Lose a fight and you take damage; hit 0 and you're out. **Last one standing wins**, and everyone else is ranked by when they went out.",
    aliases: ['win', 'objective', 'how to play', 'lobby', 'placement', 'first place'],
    seeAlso: ['health-and-armor', 'who-do-i-fight', 'placement-and-rating'],
  },
  {
    id: 'health-and-armor',
    topic: 'basics',
    q: 'How do Health and Armor work?',
    a: "Everyone starts at **30 Health**, and your hero also gives you some **Armor** on top (it's different for each hero). Damage hits your Armor first, and only what's left over reaches your Health. Armor never comes back once it's gone. When your Armor and Health are both gone, you're eliminated.",
    aliases: ['hp', 'life', 'resolve', 'shield', 'eliminated', 'die', 'knocked out'],
    seeAlso: ['how-much-damage', 'goal-of-the-game'],
    covers: [{ rule: 'R-ARMOR-01', fp: '2a7cb924' }],
  },
];
