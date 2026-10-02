import type { WikiEntry } from './types';

// Checked against packages/core/src/combat/simulate.ts (first attacker, attack loop, chooseTarget, outcome +
// damage) and reducer.ts (lossDamageCap) on 2026-10-02.
export const ENTRIES: readonly WikiEntry[] = [
  {
    id: 'who-attacks-first',
    topic: 'combat',
    q: 'Who attacks first?',
    a: "Whoever has **more minions** when the fight starts (after any Start of Combat effects go off). Tied? It's a coin flip.",
    aliases: ['first attack', 'goes first', 'initiative', 'turn order', 'who starts'],
    seeAlso: ['attack-order'],
    covers: [{ keyword: 'startofcombat', fp: '52c70216' }],
  },
  {
    id: 'attack-order',
    topic: 'combat',
    q: 'Which of my minions attacks, and who does it hit?',
    a: "The two sides take turns. On your side, minions attack **left to right**, one at a time, then it loops back to the left. Each attacker hits a **random** enemy, but if the enemy has any **Taunt** minions, it has to hit one of those. **Stealth** minions can't be picked until they lose Stealth.",
    aliases: ['targeting', 'random target', 'who gets attacked', 'order'],
    seeAlso: ['who-attacks-first', 'board-order'],
    covers: [{ keyword: 'taunt', fp: '0646dff9' }, { keyword: 'stealth', fp: 'd1114538' }],
  },
  {
    id: 'how-much-damage',
    topic: 'combat',
    q: 'How much damage do I take when I lose a fight?',
    a: "Your opponent's **tavern tier** plus the **tiers of each of their minions still standing**. So a Tier 4 player left with a Tier 4 and a Tier 3 minion hits you for 4 + 4 + 3 = **11**. Early on it's capped: at most **5** in rounds 1–3, **10** in rounds 4–7, **15** in 8–11 and **20** in 12–14. From round 15 on there's no cap.",
    aliases: ['damage', 'lose health', 'hero damage', 'loss', 'how much do i lose'],
    seeAlso: ['health-and-armor', 'tie-fight'],
  },
  {
    id: 'tie-fight',
    topic: 'combat',
    q: 'What happens if both boards die at the same time?',
    a: "It's a **draw** and nobody takes any damage. The same goes for a fight that just goes on forever with both sides still standing.",
    aliases: ['draw', 'tie', 'stalemate', 'both die'],
    seeAlso: ['how-much-damage'],
  },
];
