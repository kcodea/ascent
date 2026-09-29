import type { WikiEntry } from './types';

// Checked against packages/core/src/effects/arena.ts (friends()), recruit.ts (othersOnBoard) and the
// R-TARGET rules on 2026-09-28.
export const ENTRIES: readonly WikiEntry[] = [
  {
    id: 'friendly',
    topic: 'glossary',
    q: 'What counts as a "friendly" minion?',
    a: "Any minion on **your** side of the board. One catch: when a card **picks** a friendly minion (\"give a random friendly minion +1/+1\", or one you aim at), it **never picks itself**. If it's alone, the effect just fizzles. Effects that hit a group, like \"your minions\" or \"adjacent minions\", don't pick anything, so they do include the card itself. Cards in your hand aren't \"friendly minions\"; anything that affects your hand says \"in your hand\".",
    aliases: ['friendly unit', 'ally', 'allies', 'my minions', 'another', 'other', 'itself', 'target itself', 'self'],
    seeAlso: ['another-vs-different'],
    covers: [{ rule: 'R-TARGET-03', fp: '214c61db' }],
  },
  {
    id: 'another-vs-different',
    topic: 'glossary',
    q: 'What\'s the difference between "another" and "different"?',
    a: "**Another** (or **other**) just means \"not this exact minion\", so a second copy of the same card still counts. **Different** means a different *card*: every copy with the same name is left out.",
    aliases: ['other', 'different', 'copies', 'same card'],
    seeAlso: ['friendly'],
    covers: [{ rule: 'R-TARGET-02', fp: '52e8bea2' }],
  },
];
