import type { WikiEntry } from './types';

// Checked against packages/core/src/combat/simulate.ts (first attacker, attack loop, chooseTarget, outcome +
// damage) and reducer.ts (lossDamageCap) on 2026-10-02.
export const ENTRIES: readonly WikiEntry[] = [
  {
    id: 'who-attacks-first',
    topic: 'combat',
    q: 'Who attacks first?',
    a: "Whoever has **more minions** when the fight starts (after any Start of Combat effects go off). Tied? It's a coin flip. A few cards can override this, like the **Pre-emptive Assault** spell.",
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
  {
    id: 'what-counts-for-damage',
    topic: 'combat',
    q: 'Do tokens or Gilded minions count extra toward the damage I take?',
    a: "No. Every enemy minion still standing adds its own **tier** and nothing more. A Gilded minion counts the same as a regular one, and minions summoned during the fight count too (most tokens are Tier 1). Their Attack and Health don't matter.",
    aliases: ['damage formula', 'survivor damage', 'token damage', 'gilded damage', 'tier damage'],
    seeAlso: ['how-much-damage'],
  },
  {
    id: 'fight-summary',
    topic: 'combat',
    q: 'How do I see what happened in a fight, or watch it again?',
    a: "When a fight ends, a **Summary** button pops up just above the End Turn diamond. It opens the **Fight Recap**: the result, the damage both ways, the **odds** that fight had (how often you'd win, draw or lose it) and what you get to keep, with the full log under **Details**. Hit **Watch replay** to play the fight again from the start. You can skip the rewatch too, and it brings you back to the recap.",
    aliases: ['summary', 'fight recap', 'combat summary', 'odds', 'win chance', 'watch replay', 'combat log', 'what happened'],
    seeAlso: ['combat-speed', 'rewatch-a-game'],
  },
  {
    id: 'opponent-hand',
    topic: 'combat',
    q: "Can I see my opponent's hand?",
    a: "Only how many cards they hold. In a fight their hand sits **face down** next to their runes. Cards they gain mid-fight show up there, and a minion they summon from hand lifts out of its card.",
    aliases: ['enemy hand', 'face down cards', 'opponent cards', 'their hand'],
    seeAlso: ['scout-a-player'],
  },
];
