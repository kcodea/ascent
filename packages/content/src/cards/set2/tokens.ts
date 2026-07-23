import type { CardDef } from '@game/core';

/**
 * Set 2 tokens — reached ONLY through a card that mints or references them (never drawn), so they live
 * globally in `ALL_CARDS` and in no set's drawable pool, exactly like the set-1 tokens.
 */
export const SET2_TOKENS: CardDef[] = [
  {
    // The Ruby: a spell-like token (NOT a Shop Spell) that Kobolds mint into your hand. It plays like a
    // targeted spell — drag it onto a friendly minion to grant that minion the Ruby's current Attack/Health
    // as a permanent shop buff, then it's consumed. Its stats are baked at mint time (base 1/1 + the run's
    // `rubyBonus`), so "Your Rubies gain +X" only grows FUTURE Rubies.
    id: 'ruby',
    name: 'Ruby',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [],
    token: true,
    ruby: true,
    target: 'friendly',
    text: 'Give a minion **+1/+1**.',
  },
];
