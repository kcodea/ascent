import type { WikiEntry } from './types';

// Checked against packages/sim/src/config.ts (costs, caps), reducer.ts (roll / freeze / upgrade / turn start,
// checkTriples) and recruit.ts (sellValueOf) on 2026-09-28.
export const ENTRIES: readonly WikiEntry[] = [
  {
    id: 'gold-per-turn',
    topic: 'shop',
    q: 'How much Gold do I get each turn?',
    a: "You start with **3 Gold** and get **1 more each turn**, up to **10**. Your Gold refills to that amount at the start of every turn, so there's no saving it up. Spend it! A few cards can push you past 10 or hand you extra Gold.",
    aliases: ['money', 'income', 'coins', 'mana', 'save gold', 'bank'],
    seeAlso: ['what-things-cost'],
  },
  {
    id: 'what-things-cost',
    topic: 'shop',
    q: 'How much does everything cost?',
    a: "A minion costs **3 Gold**. A refresh costs **1**. Freezing is **free**. Selling a minion gives you **1 Gold** back (a few cards sell for more, and some for nothing). Spells cost whatever is printed on them, and they can't be sold.",
    aliases: ['price', 'buy cost', 'refresh cost', 'sell value', 'how much'],
    seeAlso: ['gold-per-turn', 'sell-a-minion', 'freeze', 'sell-trigger'],
    covers: [{ keyword: 'shopspell', fp: '29456d92' }],
  },
  {
    id: 'freeze',
    topic: 'shop',
    q: 'What does Freeze do?',
    a: "It keeps your current shop for **next turn**, so you can come back with more Gold and buy what you saw. It's free. It only lasts one turn: next turn the frozen cards are still there (with any empty slots filled in) and the freeze switches itself off. Refreshing throws the frozen shop away.",
    aliases: ['lock', 'hold', 'keep shop', 'save shop'],
    seeAlso: ['refresh-and-freeze-buttons'],
  },
  {
    id: 'tavern-tier-cost',
    topic: 'shop',
    q: 'How much does it cost to upgrade my tavern, and why does it get cheaper?',
    a: "There are 6 tiers. Going up costs **5, 7, 8, 11 and 10 Gold** (for Tier 2 through 6). Every turn you don't upgrade, the price drops by **1**, so waiting a turn or two can save you a lot. Higher tiers sell stronger minions.",
    aliases: ['level up', 'tier', 'upgrade', 'tavern up', 'discount', 'cheaper'],
    seeAlso: ['tavern-up-button'],
  },
  {
    id: 'board-and-hand-size',
    topic: 'shop',
    q: 'How many minions can I have?',
    a: "Up to **7 on your board** and **10 cards in your hand**.",
    aliases: ['board limit', 'hand limit', 'max minions', 'full board', 'full hand', 'slots'],
    seeAlso: ['play-from-hand'],
  },
  {
    id: 'triples',
    topic: 'shop',
    q: 'What happens when I get three of the same minion?',
    a: "They merge into one **Gilded** (golden) version. It gets the stats of your two best copies added together, keeps every buff and keyword they had, and its ability is usually **doubled** (the card says so if it works differently). It counts copies on your board and in your hand. When you **play** the Gilded minion, you get a **Triple Reward** card, which lets you **Discover** a minion from one tier **above** your current tavern tier.",
    aliases: ['triple', 'golden', 'gold minion', 'three copies', 'merge', 'combine'],
    seeAlso: ['discover'],
    covers: [{ keyword: 'gilded', fp: '14fa614f' }, { rule: 'R-GILD-01', fp: 'd0abe88d' }],
  },
];
