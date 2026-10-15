import type { CardDef } from '@game/core';

/**
 * SET 3 — THE WHISPERS (owner 2026-10-13, authored for Set 4; MOVED to Set 3 with the Whisper Dragons 2026-10-14;
 * ids unchanged). A Whisper is a SPELL a card GRANTS: a copy lands in hand when the
 * granting minion is played from hand, and again at every Start of Turn while that minion is on your board. An
 * unused Whisper vanishes at End of Turn (and so never counts as cast). Whispers are the Gift class (`gift: true`):
 * every cast counts as a spell cast, but a Whisper is never a Shop spell, never offered, never copy food for the
 * spell-copy effects, and absent from every set manifest. `giftMulticast`: the one cast multiplier a Gift honours
 * (Yazzus: "your targeted spells cast an additional time"), so a repeat is a real extra cast.
 *
 * A Whisper's stat grant is TEMPORARY (owner rule): applied in the Shop, kept through that turn's combat, removed
 * at the next Start of Turn (`BoardCard.whisperBuffs`). Engraved does not keep it. Its value is read at CAST from
 * run state, so a Whisper in hand always prints the number it will grant right now.
 *
 * `target: 'friendly'` (judgement call, flagged in the devlog): a temporary grant needs a real body to expire from.
 * `attack`/`health` are the schema's required stat fields; a spell's are inert.
 */
export const SET3_WHISPERS: CardDef[] = [
  {
    // Galas's Whisper: +1/+1, plus +1/+1 for every 4 spells cast this game (retroactive, read at cast).
    id: 'w4_tome',
    name: 'Tome',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'whisperBuffTarget', params: { attack: 1, health: 1, perSpells: 4 } }],
    text: 'Give a friendly minion **+1/+1** until your next turn. Improves every 4 spells cast this game.',
  },
  {
    // Tolan's Whisper: +2/+2, then improve EVERY Runebind (held, future, a later Tolan's) by +2/+2 for the run.
    id: 'w4_runebind',
    name: 'Runebind',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'whisperBuffTarget', params: { attack: 2, health: 2, improve: 2 } }],
    text: 'Give a friendly minion **+2/+2** until your next turn. Improve this.',
  },
  {
    // Falx's Whisper (owner 2026-10-14): trigger the target's Shout (the shared `replayBattlecry` path Resonance uses,
    // so every Shout multiplier and tally sees it). A target with no Shout REFUSES the cast (kept in hand), the
    // Resonance precedent. A gilded Ripple (from a Gilded Falx) triggers it twice.
    id: 'w3_ripple',
    name: 'Ripple',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'whisperReplayShout' }],
    text: "Trigger a friendly minion's **Shout**.",
  },
  {
    // Well Watcher's Whisper (owner 2026-10-15): Discover a Dragon (the run's set pool, up to your tier). UNTARGETED.
    // A gilded Well (from a Gilded Well Watcher) Discovers twice, two separate Discovers.
    id: 'w3_wellofdragons',
    name: 'Well of Dragons',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    giftMulticast: true,
    cost: 0,
    effects: [{ on: 'cast', do: 'whisperDiscoverTribe', params: { tribe: 'dragon' } }],
    text: '**Discover** a **Dragon**.',
  },
  {
    // Gardener's Whisper SEED (owner 2026-10-15): the target gains "Echo: Summon a 3/3 Drake Pup with Taunt" until the
    // start of your next turn (`seedEchoesTemp`); a Hum keeps it as a PERMANENT stack (`seedEchoes`, no cap). Every
    // stack is its own Echo. A gilded Seed grants 2.
    id: 'w3_seed',
    name: 'Seed',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    giftMulticast: true,
    cost: 0,
    target: 'friendly',
    effects: [{ on: 'cast', do: 'whisperGrantSeedEcho' }],
    text: 'Give a friendly minion "**Echo:** Summon a 3/3 Drake Pup with **Taunt**" until your next turn.',
  },
];
