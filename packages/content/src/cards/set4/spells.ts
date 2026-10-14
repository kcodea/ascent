import type { CardDef } from '@game/core';

/**
 * SET 4 SPELLS — the Celestial tribe's own Shop spells, Star Crash and Black Hole (`accretion`). Both were authored
 * for Set 3 (owner sheet 2026-09-10 / spec 2026-09-12) and MOVED here with the Celestial tribe on 2026-10-14 (owner:
 * "move celestials to set 4 along with their runes etc."). Ids unchanged. A tribe spell is offered only while its
 * tribe is a run tribe (`runSpells`). Spells are never golden (owner 2026-09-10).
 */
export const SET4_SPELLS: readonly CardDef[] = [
  {
    // T3 (Celestial), aimed at a friendly Celestial: +5/+7 to it, and the same to a random friendly minion — "a random
    // friendly minion" includes the target (R-TARGET-01: no "other" printed, so the whole side is eligible).
    id: 'starcrash',
    name: 'Star Crash',
    tribe: 'celestial',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    target: 'friendly',
    targetTribe: 'celestial',
    effects: [{ on: 'cast', do: 'spellBuffTargetAndRandomFriendly', params: { attack: 5, health: 7 } }],
    text: 'Give a **Celestial +5/+7**. It also casts on a random friendly minion.',
  },
  {
    // T3 (Celestial, offered only while Celestial is a run tribe): the Starform eats the highest-HEALTH Shop minion
    // (ties -> the right-most, like Accretion Warden's tier pick; no Starform -> the consume is skipped) and you
    // get a Star Crash EITHER WAY (owner spec 2026-09-12 left the no-Starform case open; assumed: the grant is
    // unconditional, only the consume needs the token). Untargeted, so no cast multiplier reaches it (Yazzus);
    // a Comet / Nimbus charge repeats the whole cast (another consume + another Star Crash), as for any spell.
    id: 'accretion',
    name: 'Black Hole', // 'Accretion' until 2026-09-14 (owner rename; id + art unchanged)
    tribe: 'celestial',
    tier: 3,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    cost: 2,
    // 2026-09-14 (owner): three RANDOM Shop minions; the Star Crash grant is gone with the rename.
    effects: [{ on: 'cast', do: 'spellStarformConsumeShop', params: { pick: 'random', count: 3 } }],
    text: 'Your **Starform** consumes **3** random Shop minions.',
  },
];
