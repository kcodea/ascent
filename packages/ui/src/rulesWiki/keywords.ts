import type { WikiEntry } from './types';

// Each answer expands its KEYWORD_GLOSSARY definition (keywordGlossary.ts, engine-checked 2026-09-18) and was
// re-read against simulate.ts (chooseTarget, attack loop) on 2026-09-28.
export const ENTRIES: readonly WikiEntry[] = [
  {
    id: 'taunt',
    topic: 'keywords',
    q: 'What does Taunt do?',
    a: "Enemies **have to attack a Taunt minion** before they're allowed to hit anything else. If there are several Taunts, attackers pick randomly among them. Great for protecting your fragile, important minions.",
    aliases: ['protect', 'guard', 'tank', 'must attack'],
    seeAlso: ['attack-order', 'stealth'],
    covers: [{ keyword: 'taunt', fp: '0646dff9' }],
  },
  {
    id: 'ward',
    topic: 'keywords',
    q: 'What does Ward do?',
    a: "It **blocks the first hit** the minion would take (the damage is completely ignored), and then the Ward breaks.",
    aliases: ['divine shield', 'bubble', 'shield', 'block'],
    seeAlso: ['resilient-ward'],
    covers: [{ keyword: 'ward', fp: '7855e365' }],
  },
  {
    id: 'resilient-ward',
    topic: 'keywords',
    q: "What's a Resilient Ward?",
    a: "A tougher **Ward** that takes **two hits** to break instead of one.",
    aliases: ['double ward', 'strong shield'],
    seeAlso: ['ward'],
    covers: [{ keyword: 'resilientward', fp: 'd8424d5d' }],
  },
  {
    id: 'stealth',
    topic: 'keywords',
    q: 'What does Stealth do?',
    a: "A Stealth minion **can't be attacked** until it attacks for the first time, and then it loses Stealth. If every enemy minion has Stealth, your attacker just can't find a target that turn.",
    aliases: ['hidden', 'invisible', 'untargetable'],
    seeAlso: ['attack-order', 'taunt'],
    covers: [{ keyword: 'stealth', fp: 'd1114538' }],
  },
  {
    id: 'start-of-combat',
    topic: 'keywords',
    q: 'When does "Start of Combat" happen?',
    a: "Right when the fight begins, **before anyone attacks**. Those effects all go off first, and only then is it decided who attacks first (so a Start of Combat summon can change that!).",
    aliases: ['start of fight', 'beginning of combat', 'before combat'],
    seeAlso: ['who-attacks-first'],
    covers: [{ keyword: 'startofcombat', fp: '52c70216' }],
  },
  {
    id: 'discover',
    topic: 'keywords',
    q: 'What does Discover mean?',
    a: "You get shown **three cards** and **pick one** to keep in your hand. A card that makes you Discover never offers you a copy of itself.",
    aliases: ['choose a card', 'pick one of three', 'offer'],
    seeAlso: ['triples'],
    covers: [{ keyword: 'discover', fp: 'dc85b48f' }],
  },
  {
    id: 'sell-trigger',
    topic: 'keywords',
    q: 'What does "Sell:" on a card mean?',
    a: "That effect happens **when you sell the minion**. So selling it isn't just for Gold, it's part of the plan.",
    aliases: ['when sold', 'on sell', 'sell effect'],
    seeAlso: ['sell-a-minion', 'what-things-cost'],
    covers: [{ keyword: 'sell', fp: '2b305b36' }],
  },
];
