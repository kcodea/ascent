import type { CardDef } from '@game/core';

/**
 * DUOS-ONLY WHISPERS (owner design 2026-10-30, R-DUOS-CARDS-05). Granted Gift-class spells (the Whisper system,
 * `sim/whisper.ts`): never drawable, never a Shop spell, so they sit OUTSIDE `DUOS_CARDS` (whose spells join the Duos
 * Shop pool) and join the global index beside the Set 3 Whispers. A Whisper's tier is stamped from its owner (CueBee,
 * Tier 4, `WHISPER_TIERS`).
 */
export const DUOS_WHISPERS: readonly CardDef[] = [
  {
    // CueBee's Whisper: pass the targeted minion (a Shop minion or one of yours) to your teammate, FREE (the effect
    // pass, `passTargetMinion`, Handout's body). Never a Golden one. A full teammate hand refuses it: a board minion
    // comes back to your board, a Shop minion to the Shop. Not `giftMulticast`: one minion, one pass.
    id: 'duo_w_pass',
    name: 'Pass',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 1,
    keywords: [],
    spell: true,
    gift: true,
    whisper: true,
    cost: 0,
    target: 'any',
    targetNoGolden: true,
    effects: [{ on: 'cast', do: 'passTargetMinion' }],
    text: '**Pass** a minion in the Shop or on your board.',
  },
];
